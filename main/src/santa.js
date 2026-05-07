// Santa: a fixed silhouette of sleigh + reindeer placed inside the window.
// No movement — the figure simply *is* there, dissolved into the noise at
// baseline coherence and re-condensed when its sentence is invoked. The
// universal noise drift in field.js gives the silhouette a faint breathing
// quality even at rest.
import { TUNING } from "./tuning.js";
import { makeRng } from "./rng.js";

// Silhouette as line segments in **anchor-local** coordinates. Each segment
// is sampled in proportion to its length. The shape is intentionally
// simple — at the densities we run, the outline reads as "something
// pulled through the sky" rather than as anatomy.
const SILHOUETTE = (() => {
  const sleigh = [[60, 0], [55, -7], [42, -9], [22, -7], [10, -3], [5, 0]];
  const harness = [[5, 0], [-4, -1]];
  function deer(cx) {
    const body = [
      [cx + 7, -3], [cx - 6, -3],
      [cx - 7, 0],  [cx + 8, 0],
      [cx + 7, -3],
    ];
    const head    = [[cx + 7, -3], [cx + 11, -7], [cx + 12, -10]];
    const antlers = [
      [cx + 12, -10], [cx + 11, -13], [cx + 13, -12],
      [cx + 12, -10], [cx + 14, -11],
    ];
    const legs = [
      [cx - 5, 0], [cx - 5, 5],
      [cx + 6, 0], [cx + 6, 5],
    ];
    return [body, head, antlers, legs];
  }
  const segs = [sleigh, harness];
  segs.push(...deer(-12));
  segs.push(...deer(-30));
  segs.push(...deer(-48));
  segs.push(...deer(-66));
  return segs;
})();

function buildSamples(rand, n) {
  const all = [];
  let total = 0;
  const segLens = SILHOUETTE.map(poly => {
    let L = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      L += Math.hypot(poly[i+1][0] - poly[i][0], poly[i+1][1] - poly[i][1]);
    }
    total += L;
    return L;
  });
  if (total === 0) return all;
  for (let s = 0; s < SILHOUETTE.length; s++) {
    const poly = SILHOUETTE[s];
    const count = Math.max(2, Math.round(n * (segLens[s] / total)));
    const subs = [];
    let acc = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      subs.push({
        ax: poly[i][0],   ay: poly[i][1],
        bx: poly[i+1][0], by: poly[i+1][1],
        len: Math.hypot(poly[i+1][0] - poly[i][0], poly[i+1][1] - poly[i][1]),
        cum: acc,
      });
      acc += subs[subs.length - 1].len;
    }
    const polyLen = acc || 1;
    for (let k = 0; k < count; k++) {
      const u = rand() * polyLen;
      let chosen = subs[0];
      for (const sb of subs) {
        if (u >= sb.cum && u <= sb.cum + sb.len) { chosen = sb; break; }
      }
      const t = (u - chosen.cum) / (chosen.len || 1);
      const ox = chosen.ax + (chosen.bx - chosen.ax) * t;
      const oy = chosen.ay + (chosen.by - chosen.ay) * t;
      all.push([ox, oy]);
    }
  }
  return all;
}

// Static Santa seeder. Constructor seeds particles into the field at fixed
// home positions — there is no per-frame update.
export class Santa {
  constructor(field, geom) {
    const rand = makeRng(TUNING.seed ^ 0xBABE);
    const offsets = buildSamples(rand, Math.round(TUNING.counts.santa * TUNING.density));

    // Anchor: upper-third of the window, slightly right of center.
    const bb = bboxOf(geom.window);
    const ax = bb.x + bb.w * 0.55;
    const ay = bb.y + bb.h * 0.30;

    // Scale the silhouette so it spans roughly 35% of the window width.
    // Raw silhouette spans ~140 px in the SILHOUETTE constants.
    const scale = (bb.w * 0.35) / 140;

    const newParts = [];
    for (let i = 0; i < offsets.length; i++) {
      const [ox, oy] = offsets[i];
      const hx = ax + ox * scale;
      const hy = ay + oy * scale;
      newParts.push({
        homeX: hx, homeY: hy, x: hx, y: hy,
        size:  0.5 + rand() * 0.7,
        alpha: 0.45 + rand() * 0.40,
        phase: rand() * 6.2831,
        objectId: "santa",
      });
    }
    field.add("santa", (push) => {
      for (const p of newParts) push(p);
    });
  }
}

function bboxOf(quad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of quad) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
