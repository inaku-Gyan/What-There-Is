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
  }

  render(ctx, t) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = "#fff";

    const dotSize = Math.max(1, Math.round(this.dpr));
    const px = this.px, py = this.py, pb = this.pb;
    const phAx = this.phAx, phAy = this.phAy, phBx = this.phBx, phBy = this.phBy;
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
      const end = g.start + g.activeCount;
      for (let i = g.start; i < end; i++) {
        const ox = ampX * (Math.sin(tA + phAx[i]) + Math.sin(tB + phBx[i]));
        const oy = ampY * (Math.sin(tA + phAy[i]) + Math.sin(tB + phBy[i]));
        const sx = vx + px[i] * vw + ox;
        const sy = vy + py[i] * vh + oy;
        ctx.globalAlpha = pb[i] * brightness;
        ctx.fillRect(sx, sy, dotSize, dotSize);
      }
    }
    ctx.globalAlpha = 1;
  }
}
