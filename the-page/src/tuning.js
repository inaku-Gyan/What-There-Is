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
};
