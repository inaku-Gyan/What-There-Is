// Geometric helpers that produce home positions for particles.
// Every scene module composes its object out of these primitives.
import { rng_range, rng_gauss } from "./rng.js";
import { TUNING } from "./tuning.js";

// Particle factory — keeps shape consistent across all seeders.
export function mkParticle(rand, hx, hy, opts = {}) {
  const aMin = opts.aMin ?? TUNING.particleAlpha.min;
  const aMax = opts.aMax ?? TUNING.particleAlpha.max;
  const sMin = opts.sMin ?? TUNING.particleSize.min;
  const sMax = opts.sMax ?? TUNING.particleSize.max;
  return {
    homeX: hx, homeY: hy,
    x: hx, y: hy,
    size:  rng_range(rand, sMin, sMax),
    alpha: rng_range(rand, aMin, aMax),
    phase: rand() * 6.2831,
    objectId: "ambient",
  };
}

// uniform scatter inside a rect
export function sampleRectFill(rand, rect, n, opts = {}) {
  const { x, y, w, h } = rect;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(mkParticle(rand, x + rand() * w, y + rand() * h, opts));
  }
  return out;
}

// scatter modulated by a density(x,y) → [0,1] function via rejection sampling.
export function sampleDensityField(rand, rect, n, density, opts = {}) {
  const { x, y, w, h } = rect;
  const out = [];
  let safety = n * 12; // avoid pathological loops
  while (out.length < n && safety-- > 0) {
    const px = x + rand() * w;
    const py = y + rand() * h;
    if (rand() < density(px, py)) {
      out.push(mkParticle(rand, px, py, opts));
    }
  }
  return out;
}

// points along a line, with a perpendicular jitter so it reads as stippling
export function sampleLine(rand, ax, ay, bx, by, n, jitter = 1.5, opts = {}) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len; // unit perpendicular
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = rand();
    const j = rng_gauss(rand) * jitter;
    out.push(mkParticle(rand, ax + dx * t + px * j, ay + dy * t + py * j, opts));
  }
  return out;
}

// closed-rectangle edges (for window frame outline)
export function sampleRectEdge(rand, rect, n, jitter = 1.2, opts = {}) {
  const { x, y, w, h } = rect;
  const perim = 2 * (w + h);
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = rand() * perim;
    let px, py;
    if (s < w)               { px = x + s;          py = y; }
    else if ((s -= w) < h)   { px = x + w;          py = y + s; }
    else if ((s -= h) < w)   { px = x + (w - s);    py = y + h; }
    else                     { px = x;              py = y + (h - (s - w)); }
    const jx = rng_gauss(rand) * jitter;
    const jy = rng_gauss(rand) * jitter;
    out.push(mkParticle(rand, px + jx, py + jy, opts));
  }
  return out;
}

// points along a polyline (open). Used for curtains, candle, santa silhouette.
export function samplePolyline(rand, pts, n, jitter = 1.2, opts = {}) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
    segs.push(len);
    total += len;
  }
  if (total === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = rand() * total;
    let k = 0;
    while (k < segs.length - 1 && s > segs[k]) { s -= segs[k]; k++; }
    const t = s / segs[k];
    const ax = pts[k][0],   ay = pts[k][1];
    const bx = pts[k+1][0], by = pts[k+1][1];
    const dx = bx - ax,     dy = by - ay;
    const len = segs[k] || 1;
    const nxp = -dy / len,  nyp = dx / len;
    const j = rng_gauss(rand) * jitter;
    out.push(mkParticle(rand, ax + dx * t + nxp * j, ay + dy * t + nyp * j, opts));
  }
  return out;
}

// fill a quadrilateral (4 corners, in order). Used for table top in perspective.
export function sampleQuadFill(rand, corners, n, opts = {}) {
  const [a, b, c, d] = corners;
  const out = [];
  for (let i = 0; i < n; i++) {
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    // bilinear-ish sample: split quad into two triangles a-b-c and a-c-d
    let px, py;
    if (rand() < 0.5) {
      px = a[0] + (b[0]-a[0])*u + (c[0]-a[0])*v;
      py = a[1] + (b[1]-a[1])*u + (c[1]-a[1])*v;
    } else {
      px = a[0] + (c[0]-a[0])*u + (d[0]-a[0])*v;
      py = a[1] + (c[1]-a[1])*u + (d[1]-a[1])*v;
    }
    out.push(mkParticle(rand, px, py, opts));
  }
  return out;
}
