import { TUNING } from "./tuning.js";
import { Particles } from "./particles.js";

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: false });

let dpr = 1, W = 0, H = 0;
let particles = null;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, TUNING.dprCap);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";
  if (particles) particles.resize(W, H, dpr);
}

function frame(now) {
  if (particles) particles.render(ctx, now);
  requestAnimationFrame(frame);
}

let resizeRaf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(resize);
});

(async () => {
  resize();
  // particles.json sits next to index.html — written there by
  // particle_generation/extract_particles.py (default output path).
  const res = await fetch("particles.json");
  if (!res.ok) {
    console.error(`failed to load particles.json (HTTP ${res.status}). Serve the the-page/ directory over http.`);
    return;
  }
  const data = await res.json();
  particles = new Particles(data);
  particles.resize(W, H, dpr);
  requestAnimationFrame(frame);
})();
