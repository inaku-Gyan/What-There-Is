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

  // Mouse-driven scramble: as the cursor moves, particles within `radius`
  // get their wander amplitude briefly amplified, then decay back. The
  // wander multiplier is (1 + disturb · ampMultiplier), so an emphasized
  // group whose wander is already damped to zero is naturally immune —
  // multiplying zero by anything stays zero, no separate exemption needed.
  mouse: {
    // Radius of disturbance in normalized [0,1] source units. Multiplied
    // by min(viewW, viewH) at runtime so the footprint reads as a circle
    // regardless of the source's aspect ratio.
    // 0.05 → ~50px on a 1000px-tall letterboxed view.
    radius: 0.05,
    // Peak wander amplification. 10 means a fully disturbed particle
    // wanders 11× wider than its calm baseline.
    ampMultiplier: 12.0,
    // Disturb decay rate (1/sec). 2.0 → ~50% in 0.35s, ~95% in 1.5s.
    decayRate: 2.0,
  },
};
