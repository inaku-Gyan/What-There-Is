import { TUNING } from "./tuning.js";
import { Field } from "./field.js";
import { buildScene, pointInQuad } from "./scene.js";
import { Snow } from "./snow.js";
import { Santa } from "./santa.js";
import { mountUI } from "./ui.js";

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: false });

let dpr = 1;
let W = 0, H = 0;       // CSS pixels
let field = null;
let geom  = null;
let snow  = null;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, TUNING.dprCap);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";

  field = new Field();
  geom  = buildScene(field, W, H);
  // Santa is added BEFORE snow so snow renders later in the bucket order
  // and visually occludes Santa — exactly the "partially obscured" feeling
  // we want. Santa is a one-shot seeder; we don't need to keep the instance.
  new Santa(field, geom);
  snow  = new Snow(field, geom.window);
  field.finalize();

  // Both Santa and Snow are confined to the window opening. The mask is
  // checked per-particle at render time using the live position, so any
  // particle whose drift takes it outside the window simply doesn't draw —
  // Santa never bleeds through the wall, snow never falls past the slanted
  // edges of the trapezoid before being recycled.
  const winQuad = geom.window;
  const inWindow = (x, y) => pointInQuad(x, y, winQuad);
  field.setMask("santa", inWindow);
  field.setMask("snow",  inWindow);

  mountUI(field);
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  const t = now / 1000;

  field.updateCoherence(dt);
  snow.update(dt, t);
  field.update(dt, t);
  field.render(ctx, dpr);

  requestAnimationFrame(frame);
}

let resizeRaf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(resize);
});

resize();
requestAnimationFrame(frame);
