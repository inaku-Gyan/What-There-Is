// Central place for visual constants. Adjust here, not in module code.
export const TUNING = {
  // global multiplier on the responsive active-particle count
  density: 1.0,

  // dpr cap — keep at 1.5 to avoid 4x cost on retina displays
  dprCap: 1.5,

  // brightness cycling for the staggered shimmer effect
  twinkle: {
    // angular speed of the cycle, radians per millisecond.
    // 0.0018 → period ≈ 3.5 s
    speed: 0.0018,
    // fraction of base brightness modulated. 0 = no twinkle, 1 = full
    // off-and-on. 0.45 keeps the field present even at the dim trough.
    depth: 0.45,
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
    invoked:  { brightness: 1.7, density: 1.0 },
    // exponential lerp rate, 1/sec. ~0.6s to reach ~92% of target.
    lerpRate: 4.0,
  },
};
