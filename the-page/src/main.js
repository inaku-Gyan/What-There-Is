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

let prevNow = 0;
function frame(now) {
  if (particles) {
    // Clamp dt so a tab-resume doesn't snap brightness lerps.
    const dt = prevNow ? Math.min(0.05, (now - prevNow) / 1000) : 0;
    particles.tick(dt);
    particles.render(ctx, now);
  }
  prevNow = now;
  requestAnimationFrame(frame);
}

let resizeRaf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(resize);
});

function wireTextButtons() {
  const buttons = document.querySelectorAll(".line[data-group]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.group;
      const g = particles.groups[name];
      if (!g) return;
      // Source of truth for invoked-or-not is the group's own target.
      const isInvoked = g.target >= TUNING.group.invoked - 1e-3;
      const next = !isInvoked;
      particles.setEmphasis(name, next);
      btn.classList.toggle("invoked", next);
      btn.setAttribute("aria-pressed", String(next));
    });
  });
}

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
  wireTextButtons();
  requestAnimationFrame(frame);
})();
