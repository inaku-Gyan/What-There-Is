// Central place for visual constants. Adjust here, not in module code.
export const TUNING = {
  // global density multiplier for all particle counts
  density: 1.0,

  // dpr cap — keep at 1.5 to avoid 4x cost on retina
  dprCap: 1.5,

  // baseline coherence per object (ambient world before any naming)
  baseline: {
    ambient: 1.0,
    room:    0.40,
    window:  0.70,
    curtain: 0.55,
    table:   0.22,
    santa:   0.10,
    snow:    1.0,
  },

  // coherence target when an object's sentence is "invoked"
  invoked: {
    table:   0.85,
    santa:   0.75,
  },

  // per-second rate at which actual coherence approaches its target
  coherenceLerp: 1.6,

  // how far each object's particles can wander from home when fully incoherent
  driftAmp: {
    ambient: 90,
    room:    28,
    window:   8,
    curtain: 10,
    table:   16,
    santa:   24,
    snow:     6,
  },

  // particle size & alpha ranges (px / 0..1)
  particleAlpha: { min: 0.18, max: 0.85 },
  particleSize:  { min: 0.5,  max: 1.6 },

  // spring constant for settle toward noise-perturbed home (per-second)
  spring: 3.2,

  // pseudo-noise scales
  noise: { spaceScale: 0.012, timeScale: 0.06 },

  // per-object ambient particle counts (scaled by `density`)
  counts: {
    ambient: 4000,
    room:    6000,
    window:  2500,
    curtain: 2500,
    table:   3500,
    snow:    2000,
    santa:    600,
  },

  // snow physics
  snow: { fallMin: 14, fallMax: 38, drift: 6 },

  // santa anchor sweep
  santa: { period: 65, sweepDuration: 40, yArcAmp: 30 },

  // master seed for deterministic layouts
  seed: 0xC0FFEE,
};
