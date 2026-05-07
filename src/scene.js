// Composes the scene by seeding objects into the shared particle field.
// Geometry here is *screen-relative* (a function of W, H) so resizing
// re-builds everything cleanly.
import { TUNING } from "./tuning.js";
import { makeRng } from "./rng.js";
import {
  sampleRectFill,
  sampleDensityField,
  sampleLine,
  samplePolyline,
  sampleQuadFill,
} from "./seeds.js";

// Camera is low and to the left of center, looking up and slightly to the
// right. The window dominates the right two-thirds with a strong upward
// trapezoid (top is wider, bottom is narrower — we're under it). The wall
// corner sits just left of the window's left edge.
export function geom(W, H) {
  // Wall corner where the left wall meets the back wall — runs from the
  // floor up toward the ceiling, just left of the window.
  const cornerBottom = { x: W * 0.34, y: H };
  const cornerTop    = { x: W * 0.40, y: H * 0.04 };

  // Ceiling rim — slopes from upper-left of canvas toward the corner-top.
  const ceilingStart = { x: 0,            y: H * 0.16 };
  const ceilingEnd   = { x: cornerTop.x,  y: cornerTop.y };

  // Window — large, dominates the right portion. Strong upward trapezoid.
  // Corners listed CW from top-left.
  const window = [
    [W * 0.34, H * 0.04],   // top-left
    [W * 0.99, H * 0.02],   // top-right (effectively off-canvas)
    [W * 0.85, H * 0.80],   // bottom-right
    [W * 0.45, H * 0.85],   // bottom-left
  ];

  // Small table in the lower-left, in front of the wall. The legs run off
  // the bottom of the canvas — the camera is below the floor edge slightly.
  const tableTop = [
    [W * 0.04, H * 0.55],   // back-left  (against wall, far)
    [W * 0.30, H * 0.61],   // back-right (against wall, less far)
    [W * 0.27, H * 0.74],   // front-right
    [W * 0.00, H * 0.78],   // front-left (closest, biggest)
  ];

  return { W, H, cornerBottom, cornerTop, ceilingStart, ceilingEnd, window, tableTop };
}

// Linear interpolation; used for the ceiling and corner lines.
const lerp = (a, b, t) => a + (b - a) * t;

// Density function for the "room" object — sparse base scatter with subtle
// emphasis near the ceiling rim and the wall-meets-wall corner. Room density
// drops to zero inside the window opening so we don't double-stipple there.
function roomDensity(x, y, g) {
  if (pointInQuad(x, y, g.window)) return 0;

  // corner column (x interpolated by y between the floor and the ceiling)
  const tCorner = (y - g.cornerBottom.y) / (g.cornerTop.y - g.cornerBottom.y);
  const cornerX = lerp(g.cornerBottom.x, g.cornerTop.x,
                       Math.max(0, Math.min(1, tCorner)));
  const dCorner = Math.abs(x - cornerX);

  // ceiling rim (linearly interpolated y given x)
  const tCeil = Math.min(1, Math.max(0, x / (g.ceilingEnd.x || 1)));
  const ceilY = lerp(g.ceilingStart.y, g.ceilingEnd.y, tCeil);
  const dCeil = Math.abs(y - ceilY);

  const cornerBoost  = Math.exp(-dCorner / 22) * 0.40;
  const ceilingBoost = y < g.ceilingEnd.y + 80 ? Math.exp(-dCeil / 24) * 0.35 : 0;

  // base wall scatter — softens the wall area without making it noisy.
  const base = 0.05;
  return Math.min(1, base + cornerBoost + ceilingBoost);
}

export function buildScene(field, W, H) {
  const rand = makeRng(TUNING.seed);
  const g = geom(W, H);

  // ---- ambient: dense thin scatter across the entire canvas ----
  // This is the "particle weather" — visible everywhere, brighter outside the
  // window (read as deep-space dust on the wall) and cooperating with snow
  // inside the window. Higher count + brighter range than v1 to match
  // the reference image's density.
  {
    const n = Math.round(TUNING.counts.ambient * TUNING.density);
    const parts = sampleRectFill(rand, { x: 0, y: 0, w: W, h: H }, n, {
      aMin: 0.18, aMax: 0.65,
    });
    field.add("ambient", (push) => { for (const p of parts) push(p); });
  }

  // ---- room: density-modulated scatter (walls, ceiling, corner) ----
  {
    const n = Math.round(TUNING.counts.room * TUNING.density);
    const parts = sampleDensityField(
      rand,
      { x: 0, y: 0, w: W, h: H },
      n,
      (x, y) => roomDensity(x, y, g),
      { aMin: 0.20, aMax: 0.55 },
    );
    field.add("room", (push) => { for (const p of parts) push(p); });
  }

  // ---- structural seam lines: ceiling rim + wall corner ----
  {
    const ne = Math.round(360 * TUNING.density);
    const ceil = sampleLine(rand,
      g.ceilingStart.x, g.ceilingStart.y,
      g.ceilingEnd.x,   g.ceilingEnd.y,
      ne, 3.0,
      { aMin: 0.25, aMax: 0.65, sMin: 0.4, sMax: 1.0 });
    const corner = sampleLine(rand,
      g.cornerBottom.x, g.cornerBottom.y,
      g.cornerTop.x,    g.cornerTop.y,
      ne, 2.5,
      { aMin: 0.25, aMax: 0.65, sMin: 0.4, sMax: 1.0 });
    field.add("room", (push) => {
      for (const p of ceil)   push(p);
      for (const p of corner) push(p);
    });
  }

  // ---- window frame: outer rectangle + 2x2 cross mullions ----
  {
    const [tl, tr, br, bl] = g.window;
    const tm = mid(tl, tr), bm = mid(bl, br);
    const lm = mid(tl, bl), rm = mid(tr, br);

    const opts = { aMin: 0.45, aMax: 0.92, sMin: 0.5, sMax: 1.5 };
    const segs = [
      [tl, tr], [tr, br], [br, bl], [bl, tl], // outer frame
      [tm, bm],                                // vertical mullion
      [lm, rm],                                // horizontal mullion
    ];
    const lengths = segs.map(([a, b]) => Math.hypot(b[0]-a[0], b[1]-a[1]));
    const totalLen = lengths.reduce((s, l) => s + l, 0);
    const total = Math.round(TUNING.counts.window * TUNING.density);
    const winParts = [];
    for (let i = 0; i < segs.length; i++) {
      const [a, b] = segs[i];
      const n = Math.round(total * (lengths[i] / totalLen));
      // a tighter perpendicular jitter than v1 — frame reads as crisper
      const ps = sampleLine(rand, a[0], a[1], b[0], b[1], n, 1.1, opts);
      for (const p of ps) winParts.push(p);
    }
    // a faint scatter inside the window to suggest the lit pane plane;
    // these mix with snow visually without being snow themselves.
    const interiorN = Math.round(1200 * TUNING.density);
    const interiorRect = bbox(g.window);
    const inside = sampleDensityField(
      rand, interiorRect, interiorN,
      (x, y) => pointInQuad(x, y, g.window) ? 0.6 : 0,
      { aMin: 0.18, aMax: 0.45, sMin: 0.4, sMax: 0.9 },
    );
    for (const p of inside) winParts.push(p);

    field.add("window", (push) => { for (const p of winParts) push(p); });
  }

  // ---- curtains: many wavy vertical folds on either side of the window ----
  // The curtains hang on the wall, just outside the window's left and right
  // edges. Density is high — they read as the most "fabric-like" object.
  {
    const [tl, tr, br, bl] = g.window;
    const opts = { aMin: 0.25, aMax: 0.75, sMin: 0.4, sMax: 1.2 };
    const total = Math.round(TUNING.counts.curtain * TUNING.density);

    const FOLDS_PER_SIDE = 6;
    const POINTS_PER_FOLD = 18;
    const allFolds = [];

    // band width — how far outside the window edge the curtain hangs
    const BAND = Math.max(40, (br[0] - bl[0]) * 0.10);

    // left curtain
    for (let f = 0; f < FOLDS_PER_SIDE; f++) {
      const t = f / (FOLDS_PER_SIDE - 1);
      const xTop = lerp(tl[0] - BAND, tl[0] + 4, t);
      const xBot = lerp(bl[0] - BAND * 0.7, bl[0] + 6, t);
      const yTop = lerp(tl[1] - 8, tl[1] + 6, t);
      const yBot = lerp(bl[1] + 4, bl[1] - 4, t);
      allFolds.push(curtainFold(xTop, yTop, xBot, yBot, POINTS_PER_FOLD, f * 0.7));
    }
    // right curtain (mirror — band extends to the right)
    for (let f = 0; f < FOLDS_PER_SIDE; f++) {
      const t = f / (FOLDS_PER_SIDE - 1);
      const xTop = lerp(tr[0] - 4, tr[0] + BAND, t);
      const xBot = lerp(br[0] - 6, br[0] + BAND * 0.7, t);
      const yTop = lerp(tr[1] + 6, tr[1] - 8, t);
      const yBot = lerp(br[1] - 4, br[1] + 4, t);
      allFolds.push(curtainFold(xTop, yTop, xBot, yBot, POINTS_PER_FOLD, f * 0.7 + 1.3));
    }

    const perFold = Math.floor(total / allFolds.length);
    const curtParts = [];
    for (const fold of allFolds) {
      const ps = samplePolyline(rand, fold, perFold, 1.4, opts);
      for (const p of ps) curtParts.push(p);
    }
    field.add("curtain", (push) => { for (const p of curtParts) push(p); });
  }

  // ---- table: top quad + 3 visible legs + front-edge bias + candle ----
  // Coherence baseline is low, so the table sits as a faint suggestion
  // until "Some tables are made of wood." is clicked.
  {
    const opts = { aMin: 0.25, aMax: 0.70, sMin: 0.5, sMax: 1.4 };
    const total = Math.round(TUNING.counts.table * TUNING.density);

    const TOP_FRAC    = 0.48;
    const LEGS_FRAC   = 0.24;
    const RIM_FRAC    = 0.20;
    const CANDLE_FRAC = 0.08;

    const tableParts = [];

    const top = sampleQuadFill(rand, g.tableTop, Math.round(total * TOP_FRAC), opts);
    for (const p of top) tableParts.push(p);

    const fr = sampleLine(
      rand,
      g.tableTop[2][0], g.tableTop[2][1],
      g.tableTop[3][0], g.tableTop[3][1],
      Math.round(total * RIM_FRAC), 1.0,
      { aMin: 0.35, aMax: 0.80, sMin: 0.6, sMax: 1.4 },
    );
    for (const p of fr) tableParts.push(p);

    // Legs run off the bottom of the canvas — the camera is below floor.
    const FLOOR_Y = H + 60;
    const legCorners = [g.tableTop[1], g.tableTop[2], g.tableTop[3]];
    const perLeg = Math.round((total * LEGS_FRAC) / legCorners.length);
    for (const c of legCorners) {
      const ax = c[0], ay = c[1];
      const bx = c[0] - 1.0, by = FLOOR_Y;
      const ps = sampleLine(rand, ax, ay, bx, by, perLeg, 1.6, opts);
      for (const p of ps) tableParts.push(p);
    }

    // candle on the table top
    const cBase = mid(mid(g.tableTop[0], g.tableTop[1]),
                      mid(g.tableTop[2], g.tableTop[3]));
    cBase[0] -= (g.tableTop[1][0] - g.tableTop[0][0]) * 0.10;
    const candle = [
      [cBase[0],         cBase[1] + 4],
      [cBase[0] + 0.4,   cBase[1] - 22],   // top of stem
      [cBase[0] - 1.4,   cBase[1] - 28],   // flame curl
      [cBase[0] + 0.8,   cBase[1] - 34],
      [cBase[0] - 0.5,   cBase[1] - 38],
    ];
    const cParts = samplePolyline(
      rand, candle, Math.round(total * CANDLE_FRAC), 0.7,
      { aMin: 0.40, aMax: 0.90, sMin: 0.5, sMax: 1.3 },
    );
    for (const p of cParts) tableParts.push(p);

    field.add("table", (push) => { for (const p of tableParts) push(p); });
  }

  // NOTE: caller is responsible for calling field.finalize() after adding any
  // dynamic systems (Snow, Santa) that also push particles into the pool.
  return g;
}

// ---------- shared geometric helpers ----------

function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

function bbox(pts) {
  let x0 =  Infinity, y0 =  Infinity;
  let x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Convex-quad point-in-polygon. Exported so callers (e.g. main.js) can build
// a Santa visibility mask that exactly matches the window opening.
export function pointInQuad(x, y, q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
  }
  return true;
}

// Curtain fold polyline: top→bottom path with horizontal sin sway, fading
// inward at the bottom so the fall reads as gravity-pulled fabric.
function curtainFold(xTop, yTop, xBot, yBot, n, phase) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = lerp(xTop, xBot, t) + Math.sin(phase + t * 6.0) * 4.5 * (1 - t * 0.4);
    const y = lerp(yTop, yBot, t);
    pts.push([x, y]);
  }
  return pts;
}
