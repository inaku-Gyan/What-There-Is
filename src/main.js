import { TUNING } from "./tuning.js";
import { Field } from "./field.js";
import { buildScene } from "./scene.js";
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
let santa = null;

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
  // we want. (Bucket order is by size/alpha, but snow's slightly larger
  // bright flakes naturally land in later buckets than Santa's dimmer ones.)
  santa = new Santa(field, geom);
  snow  = new Snow(field, geom.window);
  field.finalize();
  mountUI(field);
}

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  const t = now / 1000;

  field.updateCoherence(dt);
  santa.update(dt, t);
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
