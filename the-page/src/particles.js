// Loads the baked particle field from particles.json into typed arrays
// and renders it letterboxed to the viewport with a per-particle staggered
// twinkle (lighter ↔ darker brightness cycle).
//
// The JSON format (produced by particle_generation/extract_particles.py):
//   { width, height, count, particles: [[x, y, brightness], ...] }
// where x, y ∈ [0,1] of the source image and brightness ∈ [0,1].
import { TUNING } from "./tuning.js";

export class Particles {
  constructor(data) {
    const { width, height, particles } = data;
    this.srcW = width;
    this.srcH = height;
    this.total = particles.length;

    // Pack into typed arrays — much faster to iterate than an array of
    // 3-tuples, and lets us drop the original JS array for GC.
    this.px    = new Float32Array(this.total);
    this.py    = new Float32Array(this.total);
    this.pb    = new Float32Array(this.total);
    this.phase = new Float32Array(this.total);

    for (let i = 0; i < this.total; i++) {
      this.px[i] = particles[i][0];
      this.py[i] = particles[i][1];
      this.pb[i] = particles[i][2];
      // Deterministic per-index phase, uniformly distributed in [0, 2π).
      // This staggers the twinkle so no two adjacent particles flash in
      // sync — the cycling reads as a soft shimmer, not a strobe.
      this.phase[i] = ((i * 9301 + 49297) % 233280) / 233280 * Math.PI * 2;
    }

    this.activeCount = this.total;
    this.viewX = 0; this.viewY = 0; this.viewW = 0; this.viewH = 0;
    this.dpr = 1;
  }

  // Recompute letterbox + responsive active-particle count for the
  // current viewport. Active count scales with CSS-pixel viewport area
  // as a fraction of the source image area, so a small window renders
  // proportionally fewer particles (and stays smooth on weak devices).
  resize(W, H, dpr) {
    this.dpr = dpr;
    const cw = W * dpr;
    const ch = H * dpr;
    const srcAspect = this.srcW / this.srcH;
    const winAspect = cw / ch;
    if (winAspect > srcAspect) {
      // viewport is wider than source: letterbox left/right
      this.viewH = ch;
      this.viewW = ch * srcAspect;
      this.viewX = (cw - this.viewW) / 2;
      this.viewY = 0;
    } else {
      // viewport is taller than source: letterbox top/bottom
      this.viewW = cw;
      this.viewH = cw / srcAspect;
      this.viewX = 0;
      this.viewY = (ch - this.viewH) / 2;
    }

    // Responsive count: viewArea / srcArea, capped at 1 (the full bake).
    // CSS pixels on both sides; using physical px would fight DPR.
    const srcArea  = this.srcW * this.srcH;
    const viewArea = W * H;
    const ratio = Math.min(1, viewArea / srcArea);
    const target = Math.round(this.total * ratio * TUNING.density);
    this.activeCount = Math.max(1000, Math.min(this.total, target));
  }

  render(ctx, t) {
    const N = this.activeCount;
    // black clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = "#fff";

    const speed   = TUNING.twinkle.speed;
    const depth   = TUNING.twinkle.depth;
    const dotSize = Math.max(1, Math.round(this.dpr));
    const px = this.px, py = this.py, pb = this.pb, phase = this.phase;
    const vx = this.viewX, vy = this.viewY, vw = this.viewW, vh = this.viewH;

    for (let i = 0; i < N; i++) {
      // staggered brightness cycle: each particle has a fixed phase so the
      // shimmer is incoherent across the field.
      const tw = Math.sin(t * speed + phase[i]);
      const a  = pb[i] * (1 - depth + depth * (0.5 + 0.5 * tw));
      const sx = vx + px[i] * vw;
      const sy = vy + py[i] * vh;
      ctx.globalAlpha = a;
      ctx.fillRect(sx, sy, dotSize, dotSize);
    }
    ctx.globalAlpha = 1;
  }
}
