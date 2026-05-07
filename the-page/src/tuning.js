// Central place for visual constants. Adjust here, not in module code.
export const TUNING = {
  // global multiplier on the responsive active-particle count
  density: 1.0,

  // dpr cap — keep at 1.5 to avoid 4x cost on retina displays
  dprCap: 1.5,

  // Brownian-like wander: each particle gently orbits its baked
  // (homeX, homeY). Two superimposed sinusoids per axis with uncorrelated
  // per-particle phases give a quasi-random trajectory — visible aliveness
  // without the noise of a true random walk, and bounded so the scene
  // doesn't drift away from its baked composition over time.
  wander: {
    // Amplitude in normalized [0,1] source-image units. Multiplied by the
    // viewport view-width/height at render time to land in pixels.
    // 0.004 → ~6px of wander on a 1500px-wide letterboxed view.
    amp: 0.004,
    // Two angular speeds (rad/ms). Incommensurate ratio so the trajectory
    // doesn't repeat — looks like wander, not a circular orbit.
    // 0.0011 → ~5.7s cycle, 0.00073 → ~8.6s cycle.
    speedA: 0.0011,
    speedB: 0.00073,
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
