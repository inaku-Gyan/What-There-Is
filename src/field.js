// The shared particle pool plus the universal update/render rule.
// Every "object" in the scene is just a labeled subset of this pool.
import { TUNING } from "./tuning.js";

// Cheap, deterministic pseudo-noise. Two stacked sines hashed by position.
// Returns roughly in [-1, 1]. Visually indistinguishable from real noise
// at our particle density and far cheaper.
function pnoise(x, y, t) {
  const a = Math.sin(x * 1.3 + y * 2.1 + t * 1.7);
  const b = Math.sin(x * 0.7 - y * 1.1 + t * 0.9 + 2.0);
  return (a + b) * 0.5;
}

export class Field {
  constructor() {
    // particle pool. Plain object literals — V8 will optimize.
    this.particles = [];

    // current and target coherence per objectId. Defaults from TUNING.baseline.
    this.coherence = { ...TUNING.baseline };
    this.target    = { ...TUNING.baseline };

    // per-frame buckets, computed once after seeding (size,alpha) pairs.
    this._buckets = null;
  }

  // Add particles to the pool. `seedFn(push)` calls push(particle) for each.
  add(objectId, seedFn) {
    if (!(objectId in this.coherence)) {
      this.coherence[objectId] = TUNING.baseline[objectId] ?? 1.0;
      this.target[objectId]    = TUNING.baseline[objectId] ?? 1.0;
    }
    const pool = this.particles;
    seedFn((p) => {
      p.x = p.homeX;
      p.y = p.homeY;
      p.objectId = objectId;
      pool.push(p);
    });
    this._buckets = null; // invalidate render buckets
  }

  // After all objects are seeded, sort by (size, alpha) so render groups
  // share fillStyle and avoid setter churn.
  finalize() {
    this.particles.sort((a, b) => {
      if (a.size !== b.size) return a.size - b.size;
      return a.alpha - b.alpha;
    });
    // build buckets of contiguous particles sharing rounded (size, alpha).
    const buckets = [];
    let start = 0;
    const key = (p) => Math.round(p.size * 4) * 1000 + Math.round(p.alpha * 100);
    for (let i = 1; i <= this.particles.length; i++) {
      if (
        i === this.particles.length ||
        key(this.particles[i]) !== key(this.particles[start])
      ) {
        buckets.push({ start, end: i, sample: this.particles[start] });
        start = i;
      }
    }
    this._buckets = buckets;

    // Warmup: settle particles to their steady-state noise distribution so
    // we don't flash a fully-coherent scene on the first frame.
    for (let i = 0; i < 30; i++) this.update(1 / 60, i * 0.1);
  }

  setTarget(objectId, value) {
    this.target[objectId] = value;
  }

  updateCoherence(dt) {
    const k = 1 - Math.exp(-TUNING.coherenceLerp * dt);
    for (const id in this.target) {
      this.coherence[id] += (this.target[id] - this.coherence[id]) * k;
    }
  }

  // Universal per-particle update: settle toward `home + (1-c) * noise * driftAmp`.
  update(dt, t) {
    const ps = this.particles;
    const ns = TUNING.noise.spaceScale;
    const ts = TUNING.noise.timeScale;
    const k  = 1 - Math.exp(-TUNING.spring * dt);
    const c  = this.coherence;
    const da = TUNING.driftAmp;

    for (let i = 0, n = ps.length; i < n; i++) {
      const p = ps[i];
      const ci = c[p.objectId];
      const off = (1 - ci) * (da[p.objectId] ?? 20);
      const phase = p.phase;
      const nx = pnoise(p.homeX * ns + phase, p.homeY * ns, t * ts);
      const ny = pnoise(p.homeX * ns, p.homeY * ns + phase, t * ts + 5.0);
      const tx = p.homeX + nx * off;
      const ty = p.homeY + ny * off;
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
    }
  }

  render(ctx, dpr) {
    const ps = this.particles;
    const buckets = this._buckets ?? [{ start: 0, end: ps.length, sample: ps[0] }];

    // black clear (no trails)
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for (const b of buckets) {
      const s = b.sample;
      // fill style = white at the sample's alpha
      ctx.fillStyle = `rgba(255,255,255,${s.alpha.toFixed(3)})`;
      const r = s.size * dpr;
      if (r < 1.05) {
        // single-pixel-ish: cheaper as fillRect
        for (let i = b.start; i < b.end; i++) {
          const p = ps[i];
          ctx.fillRect(p.x * dpr, p.y * dpr, r, r);
        }
      } else {
        ctx.beginPath();
        for (let i = b.start; i < b.end; i++) {
          const p = ps[i];
          ctx.moveTo(p.x * dpr + r, p.y * dpr);
          ctx.arc(p.x * dpr, p.y * dpr, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  }
}
