// Central place for visual constants. Adjust here, not in module code.
export const TUNING = {
  // global multiplier on the responsive active-particle count
  density: 1.0,

  // dpr cap — keep at 1.5 to avoid 4x cost on retina displays
  dprCap: 1.5,

  // Brightness cycling. Each particle's phase is derived from its baked
  // (x, y) position, so spatially-nearby particles share phases — the
  // image breathes in zones (slowly drifting bright/dark patches) rather
  // than as incoherent per-particle shimmer. Easier on the eye, and much
  // more visible since whole regions pulse together.
  twinkle: {
    // angular speed of the cycle, radians per millisecond.
    // 0.0014 → each particle completes a full cycle ≈ every 4.5s.
    speed: 0.0014,
    // fraction of base brightness modulated. 0 = no twinkle, 1 = full
    // off-and-on. 0.7 keeps the field present at the dim trough.
    depth: 0.7,
    // Spatial phase frequency in cycles across the source image.
    // (Fx, Fy) = (2.5, 1.7) → ~2-3 bright/dark bands diagonally across
    // the canvas at any moment, drifting as t advances. Larger numbers
    // → smaller zones; (0, 0) reduces to a synchronized whole-image strobe.
    phaseFx: 2.5,
    phaseFy: 1.7,
  },

  // Emphasis state for santa & table. Each group's emphasis level lerps
  // 0→1 between `baseline` and `invoked`. Background ignores both and
  // always renders at brightness=1, density=1.
  //   brightness — alpha multiplier per particle (>1 lifts mid-tones).
  //   density    — fraction of the group's baked particles drawn.
  // Default: santa/table look like part of the scene. Invoked: brighter
  // and visibly denser, so the named referent "emerges" rather than fades.
  group: {
    baseline: { brightness: 1.0, density: 0.5 },
    invoked:  { brightness: 1.7, density: 2.5 },
    // exponential lerp rate, 1/sec. ~0.6s to reach ~92% of target.
    lerpRate: 4.0,
  },
};
