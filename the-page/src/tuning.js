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

  // Mouse-driven scramble. Each cursor sample drops a "stamp" — a circular
  // ring that grows outward over time. Each frame only the *new annulus*
  // (the band of space the ring just swept across) hits fresh particles,
  // so the disturbance reads as a diffusing ripple rather than a fixed
  // brushstroke: a bright leading edge with a trailing wake that fades
  // via per-particle decay. Emphasized groups (wander damped to zero)
  // are naturally immune — multiplying zero amplitude by anything stays
  // zero, no separate exemption code path needed.
  mouse: {
    // Initial stamp radius in normalized [0,1] source units. Multiplied
    // by min(viewW, viewH) at render so the footprint is a circle in
    // canvas pixels regardless of source aspect.
    // 0.025 → ~25px on a 1000px-tall view.
    startRadius: 0.025,
    // Outward growth rate of the disk (normalized units / sec). The disk
    // has a parabolic radial falloff and a linear age-intensity fade, so
    // its visible boundary feathers smoothly into the field instead of
    // appearing as a hard ring. Geometric reach at age=maxAge equals
    // startRadius + spreadSpeed × maxAge (= 0.165 with these defaults).
    spreadSpeed: 0.20,
    // Stamp lifespan (sec). After this the stamp is dropped; particles
    // that were ever hit continue to decay via decayRate below.
    maxAge: 0.7,
    // Wander amplification when disturb=1 (immediately after a hit).
    ampMultiplier: 12.0,
    // Per-particle disturb decay rate (1/sec). This determines how long
    // the wake trails the moving ring — 2.5 → 50% in ~0.28s.
    decayRate: 2.5,
    // Min spacing between successive stamps along the mouse polyline,
    // normalized. Should be ≤ startRadius so stamps overlap into a
    // continuous bristle. Smaller = denser stamps = higher per-frame cost.
    pathSpacing: 0.020,
    // Hard cap on simultaneous active stamps. Bounds worst-case cost
    // under runaway input; never reached in normal use.
    maxStamps: 256,
  },
};
