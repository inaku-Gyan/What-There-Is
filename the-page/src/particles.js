// Loads the baked particle field from particles.json into typed arrays
// and renders it letterboxed to the viewport with a per-particle staggered
// twinkle (lighter ↔ darker brightness cycle).
//
// The JSON format (produced by particle_generation/extract_particles.py):
//   { width, height, groups: [{ name, particles: [[x, y, b], ...] }, ...] }
// where x, y ∈ [0,1] of the source image and brightness ∈ [0,1].
// Group declaration order is the rendering order (background first, etc.).
import { TUNING } from "./tuning.js";

export class Particles {
  constructor(data) {
    const { width, height, groups } = data;
    this.srcW = width;
    this.srcH = height;

    // Total over all groups, used to size the packed typed arrays.
    let total = 0;
    for (const g of groups) total += g.particles.length;
    this.total = total;

    this.px    = new Float32Array(total);
    this.py    = new Float32Array(total);
    this.pb    = new Float32Array(total);
    this.phase = new Float32Array(total);

    // Per-group state: render range + brightness multiplier (current/target).
    // background renders at 1.0 by default; santa & table sit at baseline.
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
        // Deterministic per-index phase, uniformly distributed in [0, 2π).
        // Index `i` is the global packed index, so the phase pattern is
        // continuous across group boundaries — staggering is preserved.
        this.phase[i] = ((i * 9301 + 49297) % 233280) / 233280 * Math.PI * 2;
      }
      cursor += arr.length;

      const isBackground = g.name === "background";
      const init = isBackground ? 1.0 : TUNING.group.baseline;
      this.groups[g.name] = {
        start,
        end: cursor,
        activeCount: arr.length,
        current: init,
        target:  init,
      };
      this.groupOrder.push(g.name);
    }

    this.viewX = 0; this.viewY = 0; this.viewW = 0; this.viewH = 0;
    this.dpr = 1;
  }

  // Recompute letterbox + responsive active-particle count for the
  // current viewport. Active count scales with CSS-pixel viewport area
  // as a fraction of the source image area, so a small window renders
  // proportionally fewer particles per group (and stays smooth).
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
    const ratio = Math.min(1, viewArea / srcArea) * TUNING.density;
    for (const name of this.groupOrder) {
      const g = this.groups[name];
      const total = g.end - g.start;
      g.activeCount = Math.min(total, Math.round(total * ratio));
    }
  }

  // Toggle a group's brightness target between baseline and invoked.
  setEmphasis(name, on) {
    const g = this.groups[name];
    if (!g) return;
    g.target = on ? TUNING.group.invoked : TUNING.group.baseline;
  }

  // Advance per-group brightness lerp. Framerate-independent exponential
  // smoothing: critically damped, hits ~92% of target in 1/lerpRate * 2.5 s.
  tick(dt) {
    const k = 1 - Math.exp(-TUNING.group.lerpRate * dt);
    for (const name of this.groupOrder) {
      const g = this.groups[name];
      g.current += (g.target - g.current) * k;
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
      // Skip wholly invisible groups — saves the inner loop entirely when
      // a group's brightness has lerped down to ~0 (won't happen with
      // baseline > 0, but keeps the path tight if tuning ever changes).
      if (g.current <= 0.001) continue;

      const mul = g.current;
      const end = g.start + g.activeCount;
      for (let i = g.start; i < end; i++) {
        const tw = Math.sin(t * speed + phase[i]);
        const a  = pb[i] * (1 - depth + depth * (0.5 + 0.5 * tw)) * mul;
        const sx = vx + px[i] * vw;
        const sy = vy + py[i] * vh;
        ctx.globalAlpha = a;
        ctx.fillRect(sx, sy, dotSize, dotSize);
      }
    }
    ctx.globalAlpha = 1;
  }
}
