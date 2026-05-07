// Tiny seeded PRNG (mulberry32). Produces reproducible particle layouts —
// without this, every resize would re-randomize the whole scene differently.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rand() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// random in [a, b)
export const rng_range = (rand, a, b) => a + (b - a) * rand();

// gaussian-ish via central limit (sum of 3 uniforms)
export const rng_gauss = (rand) =>
  (rand() + rand() + rand() - 1.5) * (2 / 3);
