// Loads the baked particle field from particles.json into typed arrays
// and renders it letterboxed to the viewport. Each particle wanders
// gently around its baked (homeX, homeY) via two superimposed sinusoids
// per axis (Brownian-like, but bounded and deterministic).
//
// The JSON format (produced by particle_generation/extract_particles.py):
//   { width, height, groups: [{ name, particles: [[x, y, b], ...] }, ...] }
// where x, y ∈ [0,1] of the source image and brightness ∈ [0,1].
// Group declaration order is the rendering order (background first, etc.).
//
// Each group has an `emphasis level` that lerps 0 → 1 between TUNING.group
// `baseline` and `invoked` configs. The level drives both brightness
// (alpha multiplier) and density (fraction of baked particles drawn).
import { TUNING } from "./tuning.js";

const lerp = (a, b, t) => a + (b - a) * t;

// Four uncorrelated deterministic per-index hashes in [0, 2π). Different
// LCG-style multipliers per channel keep the four phases independent so
// no particle traces a perfect ellipse. Computed once at bake time.
function hashPhase(i, mul, add, mod) {
  return ((i * mul + add) % mod) / mod * Math.PI * 2;
}

export class Particles {
  constructor(data) {
    const { width, height, groups } = data;
    this.srcW = width;
    this.srcH = height;

    let total = 0;
    for (const g of groups) total += g.particles.length;
    this.total = total;

    this.px = new Float32Array(total);
    this.py = new Float32Array(total);
    this.pb = new Float32Array(total);
    // Phase pairs for the two harmonics on each axis. Pre-computed so the
    // render loop only does sin() calls, no hashing.
    this.phAx = new Float32Array(total);
    this.phAy = new Float32Array(total);
    this.phBx = new Float32Array(total);
    this.phBy = new Float32Array(total);
    // Per-particle scramble level [0,1]; rises to 1 when the mouse passes
    // nearby and decays exponentially. Read as a wander-amplitude multiplier.
    this.disturb = new Float32Array(total);

    this.groups = {};
    this.groupOrder = [];

    let cursor = 0;
    for (const g of groups) {
      const start = cursor;
      const arr = g.particles;
      for (let j = 0; j < arr.length; j++) {
        const i = cursor + j;
        this.px[i] = arr[j][0];
        this.py[i] = arr[j][1];
        this.pb[i] = arr[j][2];
        this.phAx[i] = hashPhase(i,    9301,    49297,     233280);
        this.phAy[i] = hashPhase(i,  196314,    71993,    1048576);
        this.phBx[i] = hashPhase(i,   75773,    13849,    4194304);
        this.phBy[i] = hashPhase(i, 1442695, 1013904223, 4294967296);
      }
      cursor += arr.length;

      // Background ignores baseline/invoked and always renders fully.
      const isBackground = g.name === "background";
      const baselineCfg = isBackground
        ? { brightness: 1.0, density: 1.0 }
        : TUNING.group.baseline;
      const invokedCfg  = isBackground
        ? { brightness: 1.0, density: 1.0 }
        : TUNING.group.invoked;

      this.groups[g.name] = {
        start,
        end: cursor,
        baseline: baselineCfg,
        invoked:  invokedCfg,
        level:       0,
        levelTarget: 0,
        activeCount: 0,
      };
      this.groupOrder.push(g.name);
    }

    this.viewX = 0; this.viewY = 0; this.viewW = 0; this.viewH = 0;
    this.viewRatio = 1;
    this.dpr = 1;

    // Mouse-sample buffer — flat [x0, y0, x1, y1, ...] in canvas-pixel coords.
    // Populated by addMouseSample() (called once per coalesced pointer event)
    // and drained once per tick. The previous tick's last sample persists in
    // prevSampleX/Y so we can walk a continuous polyline across frame boundaries.
    this.mouseSamples = [];
    this.prevSampleX = null;
    this.prevSampleY = null;

    // Active stamps. Each stamp is a ring centered at (stampX, stampY) that
    // started at startRadius when age=0 and grows outward at spreadSpeed.
    // Only the annulus newly swept *this frame* (between last frame's
    // radius and this frame's) hits fresh particles, so the wake reads
    // as an expanding ripple rather than a uniformly-disturbed disk.
    // Stored in canvas pixels and parallel-arrayed; appended FIFO.
    this.stampX = [];
    this.stampY = [];
    this.stampAge = [];
  }

  resize(W, H, dpr) {
    this.dpr = dpr;
    const cw = W * dpr;
    const ch = H * dpr;
    const srcAspect = this.srcW / this.srcH;
    const winAspect = cw / ch;
    if (winAspect > srcAspect) {
      this.viewH = ch;
      this.viewW = ch * srcAspect;
      this.viewX = (cw - this.viewW) / 2;
      this.viewY = 0;
    } else {
      this.viewW = cw;
      this.viewH = cw / srcAspect;
      this.viewX = 0;
      this.viewY = (ch - this.viewH) / 2;
    }

    const srcArea  = this.srcW * this.srcH;
    const viewArea = W * H;
    this.viewRatio = Math.min(1, viewArea / srcArea) * TUNING.density;

    // Stamp positions are in canvas pixels — invalidated by a resize, so
    // start the ripple state from a clean slate rather than displaying a
    // wake at stale coordinates.
    this.mouseSamples.length = 0;
    this.prevSampleX = null;
    this.prevSampleY = null;
    this.stampX.length = 0;
    this.stampY.length = 0;
    this.stampAge.length = 0;
    this.disturb.fill(0);
  }

  setEmphasis(name, on) {
    const g = this.groups[name];
    if (!g) return;
    g.levelTarget = on ? 1 : 0;
  }

  addMouseSample(canvasX, canvasY) {
    this.mouseSamples.push(canvasX, canvasY);
  }

  tick(dt) {
    const k = dt > 0 ? 1 - Math.exp(-TUNING.group.lerpRate * dt) : 0;
    const ratio = this.viewRatio;
    for (const name of this.groupOrder) {
      const g = this.groups[name];
      g.level += (g.levelTarget - g.level) * k;
      const total = g.end - g.start;
      const density = lerp(g.baseline.density, g.invoked.density, g.level);
      g.activeCount = Math.min(total, Math.max(0, Math.round(total * ratio * density)));
    }

    // Decay disturb toward zero. One multiply per particle — trivially
    // cheap even at 400k particles, and it keeps the math closed-form.
    if (dt > 0) {
      const decayK = Math.exp(-TUNING.mouse.decayRate * dt);
      const disturb = this.disturb;
      for (let i = 0; i < disturb.length; i++) {
        disturb[i] *= decayK;
      }
    }

    // --- Mouse stamps: ripple model ---
    // Each stamp is a circle that started at startRadius and grows outward
    // at spreadSpeed. Per-particle disturb decays exponentially (above), so
    // a particle hit by the leading edge keeps its disturb=1 momentarily
    // and then fades — that's the trailing wake.

    // Age existing stamps and drop those that have lived past maxAge.
    // Stamps are appended FIFO, so the oldest are at the front.
    const maxAge = TUNING.mouse.maxAge;
    if (dt > 0 && this.stampAge.length > 0) {
      for (let i = 0; i < this.stampAge.length; i++) {
        this.stampAge[i] += dt;
      }
      let removeCount = 0;
      while (removeCount < this.stampAge.length && this.stampAge[removeCount] >= maxAge) {
        removeCount++;
      }
      if (removeCount > 0) {
        this.stampX.splice(0, removeCount);
        this.stampY.splice(0, removeCount);
        this.stampAge.splice(0, removeCount);
      }
    }

    // Drain new mouse samples into stamps. The "anchor" lx/ly is the last
    // *stamped* position — it only advances when we drop a stamp, so a
    // sequence of small sub-sample moves accumulates until it crosses the
    // path-spacing threshold, rather than burning one stamp per sample.
    // Long jumps get subdivided so a fast slash leaves a continuous trail.
    const samples = this.mouseSamples;
    if (samples.length > 0 && this.viewW > 0 && this.viewH > 0) {
      const spacingPx = TUNING.mouse.pathSpacing * Math.min(this.viewW, this.viewH);
      const spacing2 = spacingPx * spacingPx;
      let lx = this.prevSampleX, ly = this.prevSampleY;
      for (let s = 0; s < samples.length; s += 2) {
        const nx = samples[s], ny = samples[s + 1];
        if (lx === null) {
          this.stampX.push(nx);
          this.stampY.push(ny);
          this.stampAge.push(0);
          lx = nx; ly = ny;
        } else {
          const dx = nx - lx, dy = ny - ly;
          const d2 = dx * dx + dy * dy;
          if (d2 >= spacing2) {
            const dist = Math.sqrt(d2);
            // Cap so a window-refocus teleport doesn't drop hundreds of stamps.
            const subdivs = Math.min(32, Math.ceil(dist / spacingPx));
            for (let k = 1; k <= subdivs; k++) {
              const t = k / subdivs;
              this.stampX.push(lx + dx * t);
              this.stampY.push(ly + dy * t);
              this.stampAge.push(0);
            }
            lx = nx; ly = ny;
          }
          // else: too close to anchor — accumulate, no new stamp.
        }
      }
      this.prevSampleX = lx;
      this.prevSampleY = ly;
      samples.length = 0;
    }

    // Hard cap. With normal cursor input we sit well below this; the cap
    // exists to bound runaway scenarios (stuck-mouse, synthetic events).
    const maxStamps = TUNING.mouse.maxStamps;
    if (this.stampX.length > maxStamps) {
      const drop = this.stampX.length - maxStamps;
      this.stampX.splice(0, drop);
      this.stampY.splice(0, drop);
      this.stampAge.splice(0, drop);
    }

    // Per-stamp annulus particle scan. We compute prev and current radii
    // for each stamp; only particles in (prevR², currR²] get hit this frame
    // (i.e., they were outside the ring last frame and inside it now).
    // Newborn stamps treat prevR=0, so the first frame stamps a full disk.
    const stampCount = this.stampX.length;
    if (stampCount > 0 && this.viewW > 0 && this.viewH > 0) {
      const minView = Math.min(this.viewW, this.viewH);
      const startRPx = TUNING.mouse.startRadius * minView;
      const spreadPxPerSec = TUNING.mouse.spreadSpeed * minView;

      // Precompute per-stamp disk + AABB + age-intensity; track union AABB.
      // intensity(age) = 1 - age/maxAge fades the disk smoothly to zero at
      // maxAge so there's no abrupt ring cutoff. Combined with the parabolic
      // radial falloff (computed in the inner loop), the disk feathers in
      // both space and time — no visible "wall".
      const csR2   = new Float32Array(stampCount);
      const csI    = new Float32Array(stampCount);
      const csXmin = new Float32Array(stampCount);
      const csXmax = new Float32Array(stampCount);
      const csYmin = new Float32Array(stampCount);
      const csYmax = new Float32Array(stampCount);
      let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
      for (let s = 0; s < stampCount; s++) {
        const age = this.stampAge[s];
        const r = startRPx + age * spreadPxPerSec;
        csR2[s] = r * r;
        csI[s]  = Math.max(0, 1 - age / maxAge);
        const sx = this.stampX[s], sy = this.stampY[s];
        const xmin = sx - r, xmax = sx + r;
        const ymin = sy - r, ymax = sy + r;
        csXmin[s] = xmin; csXmax[s] = xmax;
        csYmin[s] = ymin; csYmax[s] = ymax;
        if (xmin < gMinX) gMinX = xmin;
        if (xmax > gMaxX) gMaxX = xmax;
        if (ymin < gMinY) gMinY = ymin;
        if (ymax > gMaxY) gMaxY = ymax;
      }

      const px = this.px, py = this.py, disturb = this.disturb;
      const sxArr = this.stampX, syArr = this.stampY;
      const vx = this.viewX, vy = this.viewY, vw = this.viewW, vh = this.viewH;
      for (const name of this.groupOrder) {
        const g = this.groups[name];
        // Fully-emphasized groups have wander damped to zero — disturb is
        // invisible there, so skip the scan.
        if (g.level > 0.999) continue;
        const end = g.end;
        for (let i = g.start; i < end; i++) {
          const ppx = vx + px[i] * vw;
          if (ppx < gMinX || ppx > gMaxX) continue;
          const ppy = vy + py[i] * vh;
          if (ppy < gMinY || ppy > gMaxY) continue;
          // Parabolic falloff inside each stamp's disk, max-accumulated
          // across all stamps the particle is inside. The result is then
          // max-merged with the existing disturb (which decays per-frame),
          // so a fading stamp leaves a trailing wake via per-particle decay.
          let maxI = 0;
          for (let s = 0; s < stampCount; s++) {
            if (csI[s] <= 0) continue;
            if (ppx < csXmin[s] || ppx > csXmax[s]) continue;
            if (ppy < csYmin[s] || ppy > csYmax[s]) continue;
            const dx = ppx - sxArr[s];
            const dy = ppy - syArr[s];
            const d2 = dx * dx + dy * dy;
            const r2 = csR2[s];
            if (d2 >= r2) continue;
            const intensity = csI[s] * (1 - d2 / r2);
            if (intensity > maxI) maxI = intensity;
          }
          if (maxI > disturb[i]) disturb[i] = maxI;
        }
      }
    }
  }

  render(ctx, t) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = "#fff";

    const dotSize = Math.max(1, Math.round(this.dpr));
    const px = this.px, py = this.py, pb = this.pb;
    const phAx = this.phAx, phAy = this.phAy, phBx = this.phBx, phBy = this.phBy;
    const disturb = this.disturb;
    const ampMul = TUNING.mouse.ampMultiplier;
    const vx = this.viewX, vy = this.viewY, vw = this.viewW, vh = this.viewH;

    // Wander offset = amp * (sin(t·wA + phA) + sin(t·wB + phB)) per axis.
    // Hoist the time-dependent terms so each particle only does fixed-cost
    // sinusoid evaluations.
    const ampX = TUNING.wander.amp * vw * 0.5;
    const ampY = TUNING.wander.amp * vh * 0.5;
    const tA = t * TUNING.wander.speedA;
    const tB = t * TUNING.wander.speedB;

    for (const name of this.groupOrder) {
      const g = this.groups[name];
      if (g.activeCount <= 0) continue;

      const brightness = lerp(g.baseline.brightness, g.invoked.brightness, g.level);
      // Wander damps to zero as a group is invoked, so the named referent
      // visually "settles" into its baked silhouette while everything else
      // (background, plus any un-invoked group) keeps breathing.
      const wanderScale = 1 - g.level;
      const groupAmpX = ampX * wanderScale;
      const groupAmpY = ampY * wanderScale;
      const end = g.start + g.activeCount;
      if (wanderScale <= 0.001) {
        // Fully settled — skip the trig entirely for this group.
        for (let i = g.start; i < end; i++) {
          const sx = vx + px[i] * vw;
          const sy = vy + py[i] * vh;
          ctx.globalAlpha = pb[i] * brightness;
          ctx.fillRect(sx, sy, dotSize, dotSize);
        }
      } else {
        for (let i = g.start; i < end; i++) {
          // Per-particle wander amplifier: 1 normally, up to (1 + ampMul)
          // when the cursor just swept past. Multiplied onto the group's
          // already-damped amplitude so emphasized groups stay still.
          const scale = 1 + disturb[i] * ampMul;
          const ox = groupAmpX * scale * (Math.sin(tA + phAx[i]) + Math.sin(tB + phBx[i]));
          const oy = groupAmpY * scale * (Math.sin(tA + phAy[i]) + Math.sin(tB + phBy[i]));
          const sx = vx + px[i] * vw + ox;
          const sy = vy + py[i] * vh + oy;
          ctx.globalAlpha = pb[i] * brightness;
          ctx.fillRect(sx, sy, dotSize, dotSize);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
