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

    // Apply this frame's mouse disturbance. We get one sample per coalesced
    // pointer event (typically several per frame on high-poll-rate mice),
    // plus we subdivide any segment longer than the disturb radius so fast
    // sweeps still leave a continuous trail rather than dotted stamps.
    const samples = this.mouseSamples;
    if (samples.length > 0 && this.viewW > 0 && this.viewH > 0) {
      const rPx = TUNING.mouse.radius * Math.min(this.viewW, this.viewH);
      const r2 = rPx * rPx;
      // 0.6 → adjacent stamps overlap with margin; smaller = denser, slower.
      const stepSize = rPx * 0.6;

      // Walk the polyline (prevSample → samples[0] → samples[1] → ...) and
      // emit dense stamps. Cap subdivisions per segment so a freak teleport
      // (tab refocus, drag-drop) can't blow up cost.
      const stamps = [];
      let lx = this.prevSampleX, ly = this.prevSampleY;
      for (let s = 0; s < samples.length; s += 2) {
        const nx = samples[s], ny = samples[s + 1];
        if (lx !== null) {
          const dx = nx - lx, dy = ny - ly;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const subdivs = Math.min(32, Math.max(1, Math.ceil(dist / stepSize)));
          for (let k = 1; k <= subdivs; k++) {
            const t = k / subdivs;
            stamps.push(lx + dx * t, ly + dy * t);
          }
        } else {
          stamps.push(nx, ny);
        }
        lx = nx; ly = ny;
      }
      this.prevSampleX = lx;
      this.prevSampleY = ly;
      samples.length = 0;

      // Bounding box of all stamps, inflated by r — particles outside this
      // box can't possibly be hit by any stamp, so we bail before the inner
      // loop. This keeps cost roughly proportional to trail area, not N×M.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const stampLen = stamps.length;
      for (let s = 0; s < stampLen; s += 2) {
        const x = stamps[s], y = stamps[s + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      minX -= rPx; maxX += rPx; minY -= rPx; maxY += rPx;

      const px = this.px, py = this.py, disturb = this.disturb;
      const vx = this.viewX, vy = this.viewY, vw = this.viewW, vh = this.viewH;
      for (const name of this.groupOrder) {
        const g = this.groups[name];
        // Fully-emphasized groups have wander damped to zero, so disturb
        // is invisible there — skip the distance check entirely.
        if (g.level > 0.999) continue;
        const end = g.end;
        for (let i = g.start; i < end; i++) {
          const ppx = vx + px[i] * vw;
          if (ppx < minX || ppx > maxX) continue;
          const ppy = vy + py[i] * vh;
          if (ppy < minY || ppy > maxY) continue;
          for (let s = 0; s < stampLen; s += 2) {
            const dx = ppx - stamps[s];
            const dy = ppy - stamps[s + 1];
            if (dx * dx + dy * dy <= r2) {
              disturb[i] = 1.0;
              break;
            }
          }
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
