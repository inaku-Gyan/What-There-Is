// Snow is the only system whose particle homes change every frame. We
// keep it inside the universal field — Snow just mutates `homeY` on its
// slice of the pool *before* field.update() runs. The field's spring then
// makes each particle settle to the new home position, which gives us
// falling motion for free.
import { TUNING } from "./tuning.js";
import { makeRng, rng_range } from "./rng.js";

export class Snow {
  constructor(field, windowQuad) {
    this.field = field;
    this.window = windowQuad;
    this.particles = [];     // direct references into field.particles
    this.bbox = bboxOf(windowQuad);
    this._rand = makeRng(TUNING.seed ^ 0xA1A1);

    const rand = this._rand;
    const n = Math.round(TUNING.counts.snow * TUNING.density);
    const newParts = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = randomInQuad(rand, windowQuad);
      const fall = rng_range(rand, TUNING.snow.fallMin, TUNING.snow.fallMax);
      // smaller / dimmer flakes fall slower → reads as depth
      const depth = (fall - TUNING.snow.fallMin) /
                    (TUNING.snow.fallMax - TUNING.snow.fallMin);
      const size  = 0.5 + depth * 1.0;
      const alpha = 0.25 + depth * 0.55;
      const p = {
        homeX: x, homeY: y, x, y,
        size, alpha,
        phase: rand() * 6.2831,
        objectId: "snow",
        // snow-specific:
        fall, swayPhase: rand() * 6.2831, swayAmp: rng_range(rand, 1.5, 4.0),
      };
      newParts.push(p);
    }
    field.add("snow", (push) => {
      for (const p of newParts) {
        push(p);
        this.particles.push(p);
      }
    });
  }

  update(dt, t) {
    const ps = this.particles;
    const sway = TUNING.snow.drift;
    const bb = this.bbox;
    const rand = this._rand;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.homeY += p.fall * dt;
      // gentle horizontal sway, modulated per-particle
      p.homeX += Math.sin(t * 0.6 + p.swayPhase) * sway * dt;
      // recycle when past the bottom of the window region
      if (p.homeY > bb.y + bb.h + 6) {
        // re-seed at top with a fresh x inside the quad
        const [nx] = randomInQuad(rand, this.window);
        p.homeX = nx;
        p.homeY = bb.y - 6;
      }
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

// Rejection-sampled point inside a convex quad.
function randomInQuad(rand, q) {
  const bb = bboxOf(q);
  for (let tries = 0; tries < 30; tries++) {
    const x = bb.x + rand() * bb.w;
    const y = bb.y + rand() * bb.h;
    if (pointInQuad(x, y, q)) return [x, y];
  }
  // fallback: return centroid
  return [bb.x + bb.w / 2, bb.y + bb.h / 2];
}

function pointInQuad(x, y, q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (c !== 0) {
      const s = c > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
  }
  return true;
}
