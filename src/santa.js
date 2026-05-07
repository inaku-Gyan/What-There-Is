// Santa: a small silhouette of sleigh + reindeer drifting across the sky.
// Like Snow, Santa lives inside the universal field; we only animate the
// `homeX`/`homeY` of its slice each frame. The silhouette is encoded as
// offsets from a moving anchor — one anchor update per frame translates
// the whole figure.
import { TUNING } from "./tuning.js";
import { makeRng } from "./rng.js";

// Silhouette as line segments in **anchor-local** coordinates. Each segment
// is sampled in proportion to its length. The shape is intentionally
// simple — at the densities we run, the outline reads as "something
// pulled through the sky" rather than as anatomy.
const SILHOUETTE = (() => {
  // sleigh body (right end), points then chained as polyline
  const sleigh = [[60, 0], [55, -7], [42, -9], [22, -7], [10, -3], [5, 0]];
  // harness curve into the deer
  const harness = [[5, 0], [-4, -1]];
  // four reindeer, walking-front-leg-forward, smallest minimal shape
  function deer(cx) {
    const body = [
      [cx + 7, -3], [cx - 6, -3],          // back
      [cx - 7, 0],  [cx + 8, 0],           // belly
      [cx + 7, -3],
    ];
    const head = [
      [cx + 7, -3], [cx + 11, -7], [cx + 12, -10],
    ];
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
  // 4 deer, each ~16px wide, walking left
  segs.push(...deer(-12));
  segs.push(...deer(-30));
  segs.push(...deer(-48));
  segs.push(...deer(-66));
  return segs;
})();

// Pre-compute the per-segment lengths once so we can sample proportionally.
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
    // sample `count` points along this polyline uniformly by arc length
    const subs = [];
    let acc = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      subs.push({
        i,
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

export class Santa {
  constructor(field, geom) {
    this.field = field;
    this.geom = geom;
    this.particles = [];
    this._rand = makeRng(TUNING.seed ^ 0xBABE);
    this.t = 0; // global time accumulator

    const rand = this._rand;
    const offsets = buildSamples(rand, Math.round(TUNING.counts.santa * TUNING.density));

    const newParts = [];
    for (let i = 0; i < offsets.length; i++) {
      const [ox, oy] = offsets[i];
      const p = {
        homeX: 0, homeY: 0, x: 0, y: 0,
        size:  0.5 + rand() * 0.6,
        alpha: 0.45 + rand() * 0.35,
        phase: rand() * 6.2831,
        objectId: "santa",
        ox, oy,
      };
      newParts.push(p);
    }
    field.add("santa", (push) => {
      for (const p of newParts) {
        push(p);
        this.particles.push(p);
      }
    });
  }

  // Anchor traverses right-to-left across the sky inside the window region.
  // Outside the active sweep (most of the time) the anchor is offscreen so
  // the silhouette is irrelevant. While sweeping, all santa-particles
  // update their homes derivatively.
  update(dt, t) {
    this.t = t;
    const period   = TUNING.santa.period;
    const sweepDur = TUNING.santa.sweepDuration;
    const phase = (t % period) / period;     // 0..1
    const sweepPhase = (t % period) / sweepDur; // 0..>1

    const bb = bboxOf(this.geom.window);
    let ax, ay;
    if (sweepPhase <= 1) {
      // sweep from right (off-window) to left (off-window), with a mild arc
      const u = sweepPhase;
      ax = bb.x + bb.w + 80 - (bb.w + 160) * u;  // overscan both ends
      const arc = Math.sin(u * Math.PI) * TUNING.santa.yArcAmp;
      ay = bb.y + bb.h * 0.30 - arc;
    } else {
      // dormant: park anchor just off-right of the window so when the next
      // sweep begins, particles spring in from the correct direction
      // (right-to-left). Parking far offscreen-left would cause the figure
      // to "stream backwards" into its starting pose.
      ax = bb.x + bb.w + 200;
      ay = bb.y + bb.h * 0.30;
    }
    const ps = this.particles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.homeX = ax + p.ox;
      p.homeY = ay + p.oy;
    }
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
