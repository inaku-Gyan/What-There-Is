// Loads the baked particle field from particles.json into typed arrays
// and renders it letterboxed to the viewport with a per-particle staggered
// twinkle (lighter ↔ darker brightness cycle).
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

export class Particles {
  constructor(data) {
    const { width, height, groups } = data;
    this.srcW = width;
    this.srcH = height;

    let total = 0;
    for (const g of groups) total += g.particles.length;
    this.total = total;

    this.px    = new Float32Array(total);
    this.py    = new Float32Array(total);
    this.pb    = new Float32Array(total);
    this.phase = new Float32Array(total);

    this.groups = {};
    this.groupOrder = [];

    const TWO_PI = Math.PI * 2;
    const Fx = TUNING.twinkle.phaseFx;
    const Fy = TUNING.twinkle.phaseFy;

    let cursor = 0;
    for (const g of groups) {
      const start = cursor;
      const arr = g.particles;
      for (let j = 0; j < arr.length; j++) {
        const i = cursor + j;
        const x = arr[j][0];
        const y = arr[j][1];
        this.px[i] = x;
        this.py[i] = y;
        this.pb[i] = arr[j][2];
        // Position-based phase: nearby particles get nearby phases, so
        // entire regions of the image breathe in sync. Bright/dark bands
        // drift diagonally across the canvas as t advances.
        this.phase[i] = (x * Fx + y * Fy) * TWO_PI;
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
        level:       0,   // 0 → at baseline, 1 → at invoked
        levelTarget: 0,
        activeCount: 0,   // recomputed in tick()
      };
      this.groupOrder.push(g.name);
    }

    this.viewX = 0; this.viewY = 0; this.viewW = 0; this.viewH = 0;
    this.viewRatio = 1;
    this.dpr = 1;
  }

  // Letterbox + responsive base ratio. Active per-group counts depend on
  // both this ratio AND each group's current density level, so they are
  // updated in tick() rather than here.
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

  // Toggle a group's emphasis target between 0 (baseline) and 1 (invoked).
  setEmphasis(name, on) {
    const g = this.groups[name];
    if (!g) return;
    g.levelTarget = on ? 1 : 0;
  }

  // Advance per-group emphasis level + recompute active count. Exponential
  // smoothing is framerate-independent and naturally critically damped.
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

    const speed   = TUNING.twinkle.speed;
    const depth   = TUNING.twinkle.depth;
    const dotSize = Math.max(1, Math.round(this.dpr));
    const px = this.px, py = this.py, pb = this.pb, phase = this.phase;
    const vx = this.viewX, vy = this.viewY, vw = this.viewW, vh = this.viewH;

    for (const name of this.groupOrder) {
      const g = this.groups[name];
      if (g.activeCount <= 0) continue;

      const brightness = lerp(g.baseline.brightness, g.invoked.brightness, g.level);
      const end = g.start + g.activeCount;
      for (let i = g.start; i < end; i++) {
        const tw = Math.sin(t * speed + phase[i]);
        // brightness > 1 may push the alpha past 1; the canvas clamps to 1
        // automatically, which is exactly the "saturate the bright dots"
        // effect we want for emphasis.
        const a  = pb[i] * (1 - depth + depth * (0.5 + 0.5 * tw)) * brightness;
        const sx = vx + px[i] * vw;
        const sy = vy + py[i] * vh;
        ctx.globalAlpha = a;
        ctx.fillRect(sx, sy, dotSize, dotSize);
      }
    }
    ctx.globalAlpha = 1;
  }
}
