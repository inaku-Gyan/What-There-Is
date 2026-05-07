// DOM text overlay. Each line is an ontological commitment — clicking it
// raises the coherence target of the named object; clicking again lowers it.
import { TUNING } from "./tuning.js";

// Sentence → object that gets stabilized by saying it. Both sentences are
// names regardless of their truth value: in Quine's framework, *to be* is
// to be the value of a bound variable, and the variable is bound the
// moment we utter the noun.
const LINES = [
  { id: "santa", text: "Santa Claus does not exist." },
  { id: "table", text: "Some tables are made of wood." },
];

export function mountUI(field) {
  const root = document.getElementById("texts");
  root.innerHTML = "";
  const invoked = new Set();

  for (const { id, text } of LINES) {
    const btn = document.createElement("button");
    btn.className = "line";
    btn.dataset.target = id;
    btn.textContent = text;
    btn.addEventListener("click", () => {
      const isOn = invoked.has(id);
      if (isOn) {
        invoked.delete(id);
        btn.classList.remove("invoked");
        field.setTarget(id, TUNING.baseline[id]);
      } else {
        invoked.add(id);
        btn.classList.add("invoked");
        field.setTarget(id, TUNING.invoked[id]);
      }
    });
    root.appendChild(btn);
  }
}
