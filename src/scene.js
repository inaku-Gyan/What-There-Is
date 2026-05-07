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

// Geometry of the camera. Camera is low, looking slightly up. The vanishing
// point sits a little above and right of center so the left wall takes a
// noticeable wedge of the frame.
export function geom(W, H) {
  const vp = { x: W * 0.56, y: H * 0.40 };
  // Corner where the left wall meets the back wall. It runs from a point
  // on the floor going up toward (but not reaching) the vanishing point.
  const cornerBottom = { x: W * 0.21, y: H };
  const cornerTop    = { x: vp.x - (vp.x - cornerBottom.x) * 0.45, y: vp.y + 30 };

  // Window: a slightly trapezoidal opening on the back wall. Top is a hair
  // wider than the bottom because we're looking up. Corners listed CW from
  // top-left.
  const window = [
    [W * 0.40, H * 0.07],
    [W * 0.82, H * 0.05],
    [W * 0.79, H * 0.66],
    [W * 0.43, H * 0.68],
  ];

  // Table top corners, CW from back-left. The back edge sits against the
  // left wall so the table reads as anchored to the room's geometry. Camera
  // is below + in front, so the front edge is closer (and lower) on screen.
  const tableTop = [
    [W * 0.03, H * 0.62],   // back-left  (against wall, deep)
    [W * 0.26, H * 0.65],   // back-right (against wall, less deep)
    [W * 0.22, H * 0.79],   // front-right
    [W * 0.01, H * 0.84],   // front-left (closest, biggest)
  ];

  return { W, H, vp, cornerBottom, cornerTop, window, tableTop };
}

// Linear interpolation; used for the ceiling and corner lines.
const lerp = (a, b, t) => a + (b - a) * t;

// Density function for the "room" object — sparse everywhere, with subtle
// emphasis near the ceiling line and the wall-meets-wall corner. The viewer
// reads structure from the *gradient* of density, not from outlines.
function roomDensity(x, y, g) {
  // corner line x at this y (linear interp between bottom & top of corner)
  const t = (y - g.cornerBottom.y) / (g.cornerTop.y - g.cornerBottom.y);
  const cornerX = lerp(g.cornerBottom.x, g.cornerTop.x, Math.max(0, Math.min(1, t)));
  const dCorner = Math.abs(x - cornerX);

  // ceiling line: a curve sloping down from top-left to vp
  const ceilY = lerp(0, g.vp.y, Math.min(1, x / g.vp.x));
  const dCeil = Math.abs(y - ceilY);

  // floor: only a hint, near the very bottom
  const dFloor = Math.max(0, H_HINT_FLOOR - (g.H - y));

  const cornerBoost  = Math.exp(-dCorner / 22) * 0.45;
  const ceilingBoost = y < g.vp.y + 50 ? Math.exp(-dCeil / 26) * 0.40 : 0;
  const floorBoost   = dFloor > 0 ? 0.10 : 0;

  // base ambient room scatter so walls feel filled, not just outlined.
  const base = 0.06;
  return Math.min(1, base + cornerBoost + ceilingBoost + floorBoost);
}
const H_HINT_FLOOR = 60;

export function buildScene(field, W, H) {
  const rand = makeRng(TUNING.seed);
  const g = geom(W, H);

  // ---- ambient: uniform thin scatter across the entire canvas ----
  {
    const n = Math.round(TUNING.counts.ambient * TUNING.density);
    const parts = sampleRectFill(rand, { x: 0, y: 0, w: W, h: H }, n, {
      aMin: 0.10, aMax: 0.45,
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
      { aMin: 0.18, aMax: 0.60 },
    );
    field.add("room", (push) => { for (const p of parts) push(p); });
  }

  // ---- subtle "edge bias" lines: ceiling rim & corner column ----
  // These are extra particles tightly hugging the structural seams. They give
  // the room its perspective without being a hard outline — when room
  // coherence drops, they smear with everything else.
  {
    const ne = Math.round(280 * TUNING.density);
    const ceil = sampleLine(rand, 0, 0, g.vp.x, g.vp.y, ne, 4.0, {
      aMin: 0.20, aMax: 0.55, sMin: 0.4, sMax: 1.0,
    });
    const corner = sampleLine(
      rand,
      g.cornerBottom.x, g.cornerBottom.y,
      g.cornerTop.x,    g.cornerTop.y,
      ne, 3.0,
      { aMin: 0.20, aMax: 0.55, sMin: 0.4, sMax: 1.0 },
    );
    field.add("room", (push) => {
      for (const p of ceil)   push(p);
      for (const p of corner) push(p);
    });
  }

  // ---- window frame: outer rectangle + 2x2 cross mullions ----
  // The frame reads as bright stippled lines because window coherence is
  // high in TUNING.baseline; particles cluster tight to their home lines.
  {
    const [tl, tr, br, bl] = g.window;
    // midpoints define the cross mullions
    const tm = mid(tl, tr), bm = mid(bl, br);
    const lm = mid(tl, bl), rm = mid(tr, br);
    const cm = mid(tm, bm); // center

    const opts = { aMin: 0.35, aMax: 0.85, sMin: 0.5, sMax: 1.4 };
    const segs = [
      [tl, tr], [tr, br], [br, bl], [bl, tl], // outer frame
      [tm, bm],                                // vertical mullion
      [lm, rm],                                // horizontal mullion
    ];
    // distribute the budget proportional to segment length
    const lengths = segs.map(([a, b]) => Math.hypot(b[0]-a[0], b[1]-a[1]));
    const totalLen = lengths.reduce((s, l) => s + l, 0);
    const total = Math.round(TUNING.counts.window * TUNING.density);
    const winParts = [];
    for (let i = 0; i < segs.length; i++) {
      const [a, b] = segs[i];
      const n = Math.round(total * (lengths[i] / totalLen));
      const ps = sampleLine(rand, a[0], a[1], b[0], b[1], n, 1.4, opts);
      for (const p of ps) winParts.push(p);
    }
    // a faint scatter inside the window to suggest the lit pane plane;
    // these pick up snow visually later.
    const interiorN = Math.round(800 * TUNING.density);
    const interiorRect = bbox(g.window);
    const inside = sampleDensityField(
      rand, interiorRect, interiorN,
      (x, y) => pointInQuad(x, y, g.window) ? 0.6 : 0,
      { aMin: 0.10, aMax: 0.30, sMin: 0.4, sMax: 0.9 },
    );
    for (const p of inside) winParts.push(p);

    field.add("window", (push) => { for (const p of winParts) push(p); });
  }

  // ---- curtains: wavy vertical polylines hanging on either side ----
  {
    const [tl, tr, br, bl] = g.window;
    const opts = { aMin: 0.18, aMax: 0.55, sMin: 0.4, sMax: 1.1 };
    const total = Math.round(TUNING.counts.curtain * TUNING.density);

    // 4 folds per side, each is a vertical-ish polyline with sin perturbation
    const FOLDS_PER_SIDE = 4;
    const POINTS_PER_FOLD = 14;
    const allFolds = [];

    // left curtain: hangs from a band slightly outside-left of the window
    for (let f = 0; f < FOLDS_PER_SIDE; f++) {
      const t = f / (FOLDS_PER_SIDE - 1);
      const xTop = lerp(tl[0] - 32, tl[0] + 4, t);
      const xBot = lerp(bl[0] - 22, bl[0] + 6, t);
      const yTop = lerp(tl[1] - 6, tl[1] + 4, t);
      const yBot = lerp(bl[1] + 4, bl[1] - 4, t);
      allFolds.push(curtainFold(xTop, yTop, xBot, yBot, POINTS_PER_FOLD, f * 0.7));
    }
    // right curtain: same idea mirrored
    for (let f = 0; f < FOLDS_PER_SIDE; f++) {
      const t = f / (FOLDS_PER_SIDE - 1);
      const xTop = lerp(tr[0] - 4, tr[0] + 32, t);
      const xBot = lerp(br[0] - 6, br[0] + 22, t);
      const yTop = lerp(tr[1] + 4, tr[1] - 6, t);
      const yBot = lerp(br[1] - 4, br[1] + 4, t);
      allFolds.push(curtainFold(xTop, yTop, xBot, yBot, POINTS_PER_FOLD, f * 0.7 + 1.3));
    }

    const perFold = Math.floor(total / allFolds.length);
    const curtParts = [];
    for (const fold of allFolds) {
      const ps = samplePolyline(rand, fold, perFold, 1.5, opts);
      for (const p of ps) curtParts.push(p);
    }
    field.add("curtain", (push) => { for (const p of curtParts) push(p); });
  }

  // ---- table: top quad fill + 3 visible legs + front-edge bias + candle ----
  // Coherence baseline is intentionally low (TUNING.baseline.table ≈ 0.22)
  // so the table is barely there until "Some tables are made of wood." is
  // clicked, at which point it condenses into structure.
  {
    const opts = { aMin: 0.20, aMax: 0.65, sMin: 0.5, sMax: 1.4 };
    const total = Math.round(TUNING.counts.table * TUNING.density);

    // budgets: top fills more than legs / candle / rim
    const TOP_FRAC    = 0.50;
    const LEGS_FRAC   = 0.22;
    const RIM_FRAC    = 0.20;
    const CANDLE_FRAC = 0.08;

    const tableParts = [];

    // top surface (perspective parallelogram)
    const top = sampleQuadFill(rand, g.tableTop, Math.round(total * TOP_FRAC), opts);
    for (const p of top) tableParts.push(p);

    // front rim: extra particles along the front edge for definition
    const fr = sampleLine(
      rand,
      g.tableTop[2][0], g.tableTop[2][1],
      g.tableTop[3][0], g.tableTop[3][1],
      Math.round(total * RIM_FRAC), 1.0,
      { aMin: 0.30, aMax: 0.75, sMin: 0.6, sMax: 1.4 },
    );
    for (const p of fr) tableParts.push(p);

    // 3 legs: from each visible top corner down to the floor with a small
    // horizontal taper. We skip the back-left leg because it would be hidden
    // behind the table mass when coherence is high.
    const FLOOR_Y = H - 6;
    const legCorners = [g.tableTop[1], g.tableTop[2], g.tableTop[3]];
    const perLeg = Math.round((total * LEGS_FRAC) / legCorners.length);
    for (const c of legCorners) {
      const ax = c[0], ay = c[1];
      const bx = c[0] - 1.0, by = FLOOR_Y;
      const ps = sampleLine(rand, ax, ay, bx, by, perLeg, 1.6, opts);
      for (const p of ps) tableParts.push(p);
    }

    // candle on top — a tiny vertical stem with a flame nub
    const cBase = mid(mid(g.tableTop[0], g.tableTop[1]), g.tableTop[1]);
    cBase[1] -= 4;
    const candle = [
      [cBase[0],         cBase[1]],
      [cBase[0] + 0.3,   cBase[1] - 18],   // top of stem
      [cBase[0] - 1.0,   cBase[1] - 22],   // flame curl
      [cBase[0] + 0.6,   cBase[1] - 27],
      [cBase[0] - 0.4,   cBase[1] - 30],
    ];
    const cParts = samplePolyline(
      rand, candle, Math.round(total * CANDLE_FRAC), 0.6,
      { aMin: 0.30, aMax: 0.85, sMin: 0.5, sMax: 1.3 },
    );
    for (const p of cParts) tableParts.push(p);

    field.add("table", (push) => { for (const p of tableParts) push(p); });
  }

  // NOTE: caller is responsible for calling field.finalize() after adding any
  // dynamic systems (Snow, Santa) that also push particles into the pool.
  return g;
}

// ---------- small geometric helpers used in this file ----------

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

// Point-in-polygon for convex quad (corners CW or CCW). Used to mask the
// window's interior so the lit-pane scatter doesn't leak past the frame.
function pointInQuad(x, y, q) {
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

// Build a curtain fold polyline: top→bottom path with horizontal sin sway,
// fading slightly inward at the bottom so the curtain reads as falling.
function curtainFold(xTop, yTop, xBot, yBot, n, phase) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = lerp(xTop, xBot, t) + Math.sin(phase + t * 6.0) * 4 * (1 - t * 0.4);
    const y = lerp(yTop, yBot, t);
    pts.push([x, y]);
  }
  return pts;
}
