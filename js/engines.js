/* Engine profiles. All sound is synthesized – no audio files.
 *
 * Sound model (see engine-worklet.js):
 *   firing:       [crank angle 0..720°, exhaust bank] per cylinder, in firing order
 *   pipes:        [header ms, main pipe ms] per bank (delay = length / speed of sound in hot gas)
 *   collectorMs:  pipe after the banks merge
 *   pulseMs:      exhaust pulse length at idle (shorter = sharper, raspier)
 *   pulseNoise:   how much of each pulse is turbulent noise vs. clean pressure
 *   jitter / timingJitter: cycle-to-cycle amplitude (fraction) / timing (degrees) variation
 *   trim:         fixed per-cylinder amplitude spread
 *   muffler:      [closed, open] low-pass Hz, raw: unmuffled share
 *   intake/intakeHz: intake roar level / resonance, crackle: overrun pops, turbo: whine level
 *
 * Drivetrain: idle/redline/limiter rpm, gears, final drive.
 */
const evenFire = (n, banks) => Array.from({ length: n }, (_, i) => [(720 / n) * i, banks > 1 ? i % banks : 0]);

window.ENGINES = [
  {
    id: 'v8', name: 'Muscle V8', spec: '6.2 L · crossplane V8',
    // Firing order 1-8-7-2-6-5-4-3, odd cylinders on bank 0 -> uneven per-bank pulses = burble
    firing: [[0, 0], [90, 1], [180, 0], [270, 1], [360, 1], [450, 0], [540, 1], [630, 0]],
    pipes: [[1.1, 5.2], [1.3, 5.9]], collectorMs: 2.4,
    pulseMs: 3.2, pulseNoise: 0.35, jitter: 0.18, timingJitter: 2.5, trim: 0.25,
    muffler: [450, 2600], raw: 0.06, intake: 0.25, intakeHz: 450, crackle: 0.5, gain: 1.6,
    idle: 700, redline: 6500, limiter: 6700,
    gears: [2.97, 2.07, 1.43, 1.0, 0.84, 0.56], final: 3.42,
  },
  {
    id: 'v12', name: 'Grand Tourer V12', spec: '6.5 L · V12',
    firing: evenFire(12, 2),
    pipes: [[0.7, 3.6], [0.75, 3.8]], collectorMs: 1.6,
    pulseMs: 1.4, pulseNoise: 0.25, jitter: 0.08, timingJitter: 1, trim: 0.1,
    muffler: [900, 6500], raw: 0.15, intake: 0.4, intakeHz: 700, crackle: 0.25, gain: 1.4,
    idle: 900, redline: 8500, limiter: 8700,
    gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.63], final: 3.44,
  },
  {
    id: 'v10', name: 'Race V10', spec: '5.2 L · V10',
    firing: evenFire(10, 2),
    pipes: [[0.8, 3.4], [0.8, 3.5]], collectorMs: 1.5,
    pulseMs: 1.6, pulseNoise: 0.4, jitter: 0.12, timingJitter: 1.5, trim: 0.15,
    muffler: [800, 6000], raw: 0.2, intake: 0.45, intakeHz: 650, crackle: 0.6, gain: 1.5,
    idle: 1000, redline: 8500, limiter: 8700,
    gears: [3.13, 2.59, 1.96, 1.55, 1.24, 1.0, 0.85], final: 3.9,
  },
  {
    id: 'f6', name: 'Flat-Six', spec: '4.0 L · boxer 6',
    firing: evenFire(6, 2),
    pipes: [[1.0, 3.2], [1.6, 3.0]], collectorMs: 1.8,
    pulseMs: 2.0, pulseNoise: 0.4, jitter: 0.12, timingJitter: 1.5, trim: 0.2,
    muffler: [700, 5500], raw: 0.18, intake: 0.5, intakeHz: 600, crackle: 0.4, gain: 1.6,
    idle: 900, redline: 9000, limiter: 9200,
    gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], final: 3.97,
  },
  {
    id: 'i6', name: 'Turbo Inline-6', spec: '3.0 L · I6 twin-turbo',
    // Two 3-into-1 manifolds (front/rear cylinders), firing order 1-5-3-6-2-4
    firing: evenFire(6, 2),
    pipes: [[0.9, 4.4], [0.9, 4.4]], collectorMs: 2.0,
    pulseMs: 2.4, pulseNoise: 0.3, jitter: 0.1, timingJitter: 1.2, trim: 0.12,
    muffler: [500, 3600], raw: 0.05, intake: 0.35, intakeHz: 500, crackle: 0.35, turbo: 1, gain: 1.7,
    idle: 750, redline: 7000, limiter: 7200,
    gears: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64], final: 2.81,
  },
  {
    id: 'i4', name: 'Hot Hatch I4', spec: '2.0 L · I4 turbo',
    firing: evenFire(4, 1),
    pipes: [[1.2, 4.8]], collectorMs: 2.2,
    pulseMs: 2.6, pulseNoise: 0.45, jitter: 0.15, timingJitter: 2, trim: 0.2,
    muffler: [550, 3800], raw: 0.08, intake: 0.4, intakeHz: 520, crackle: 0.7, turbo: 1, gain: 1.9,
    idle: 850, redline: 6800, limiter: 7000,
    gears: [3.36, 2.09, 1.47, 1.1, 0.87, 0.73], final: 4.05,
  },
  {
    id: 'f1', name: 'Formula V6 Hybrid', spec: '1.6 L · V6 turbo · 15k',
    firing: evenFire(6, 2),
    pipes: [[0.45, 1.6], [0.45, 1.6]], collectorMs: 0.8,
    pulseMs: 0.7, pulseNoise: 0.3, jitter: 0.06, timingJitter: 0.8, trim: 0.08,
    muffler: [2500, 10000], raw: 0.35, intake: 0.3, intakeHz: 1200, crackle: 0.3, turbo: 0.6, gain: 1.3,
    idle: 4000, redline: 14500, limiter: 15000,
    gears: [3.1, 2.4, 1.95, 1.62, 1.38, 1.2, 1.06, 0.94], final: 3.6,
  },
];
