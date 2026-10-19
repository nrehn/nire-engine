/* Physically-inspired engine synthesizer (runs in an AudioWorklet).
 *
 * Model per sample:
 *   crank angle advances with rpm (0..720° = one 4-stroke cycle)
 *   each cylinder fires at its own crank angle -> short exhaust pressure pulse
 *     (amplitude follows load, with per-cylinder trim and per-cycle random jitter)
 *   pulses go into their bank's exhaust: header pipe -> main pipe (delay-line waveguides)
 *   banks merge in a collector pipe -> muffler low-pass (opens with load)
 *   + intake roar, turbo whine / blow-off, overrun crackle
 *
 * The uneven per-bank firing of a crossplane V8, pipe resonances and cycle-to-cycle
 * variation are what make it sound like an engine instead of an oscillator.
 */
const TAU = Math.PI * 2;
const rand = () => Math.random();

class Biquad {
  constructor() { this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  set(type, f, q, sr) {
    f = Math.max(20, Math.min(f, sr * 0.45));
    const w = (TAU * f) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass, 0 dB peak
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cs) / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Delay-line pipe with lossy, low-passed reflection (negative fb = open-end reflection). */
class Pipe {
  constructor(len, fb, damp) {
    this.len = Math.max(1, Math.round(len));
    this.buf = new Float32Array(this.len);
    this.i = 0; this.fb = fb; this.damp = damp; this.lp = 0;
  }
  run(x) {
    const d = this.buf[this.i];
    this.lp += (d - this.lp) * this.damp;
    const y = x + this.fb * this.lp;
    this.buf[this.i] = y;
    this.i = (this.i + 1) % this.len;
    return y;
  }
}

class EngineCore {
  constructor(p, sr) {
    this.p = p; this.sr = sr;
    const ms = (v) => (v * sr) / 1000;
    this.cyl = p.firing.map(([angle, bank]) => ({
      angle, bank, a: angle,
      trim: 1 + (rand() - 0.5) * p.trim, // fixed per-cylinder character
      t: 1e9, T: 1, A: 0, noise: 0,
    }));
    this.banks = p.pipes.map(([h, m]) => ({ header: new Pipe(ms(h), -0.5, 0.55), main: new Pipe(ms(m), -0.62, 0.28), sig: 0 }));
    this.collector = new Pipe(ms(p.collectorMs), -0.35, 0.3);
    this.muffler = new Biquad();
    this.intakeBp = new Biquad();
    this.bovBp = new Biquad();
    this.bovBp.set('bp', 2600, 1.2, sr);
    this.phase = 0; this.rpm = p.idle; this.load = 0;
    this.idlePh = 0; this.turboPh = 0; this.boost = 0; this.bov = 0; this.prevLoad = 0;
    this.intakeEnv = 0; this.dcx = 0; this.dcy = 0;
    this.intakeDecay = Math.exp(-1 / (sr * 0.004));
  }

  fire(c, rpmN) {
    const p = this.p, load = this.load;
    let A = (0.28 + 0.72 * load) * c.trim * (1 + (rand() - 0.5) * 2 * p.jitter);
    let noise = p.pulseNoise * (0.6 + 0.8 * rand());
    // Overrun: unburnt fuel pops in the exhaust
    if (load < 0.06 && rpmN > 0.35 && rand() < p.crackle * 0.12) { A = 1.4 + rand(); noise = 0.85; }
    c.A = A; c.noise = noise; c.t = 0;
    // Sharper pulses under load and at high rpm
    c.T = Math.max(3, (this.sr * p.pulseMs) / 1000 * (1.35 - 0.5 * load) * (1.25 - 0.45 * rpmN));
    this.intakeEnv += A * 0.4;
  }

  /** Render n samples into out. rpm/load are block targets (interpolated per sample). */
  render(out, n, rpmTarget, loadTarget) {
    const p = this.p, sr = this.sr, cyl = this.cyl, banks = this.banks;
    const rpm0 = this.rpm, load0 = this.load;
    const rpmN = Math.min(1, rpmTarget / p.redline);

    // Block-rate updates
    const [mLo, mHi] = p.muffler;
    this.muffler.set('lp', mLo + (mHi - mLo) * Math.min(1, 0.35 * rpmN + 0.65 * loadTarget), 0.8, sr);
    this.intakeBp.set('bp', p.intakeHz * (0.6 + 0.8 * rpmN), 2.5, sr);
    if (p.turbo) {
      const tgt = loadTarget * rpmN;
      this.boost += (tgt - this.boost) * (tgt > this.boost ? 0.012 : 0.06);
      if (this.prevLoad - loadTarget > 0.2 && this.boost > 0.3) this.bov = this.boost;
    }
    this.prevLoad = loadTarget;
    const bovDecay = Math.exp(-1 / (sr * 0.18));

    for (let s = 0; s < n; s++) {
      const k = (s + 1) / n;
      this.rpm = rpm0 + (rpmTarget - rpm0) * k;
      this.load = load0 + (loadTarget - load0) * k;

      // Slight idle hunting
      this.idlePh += (TAU * 1.3) / sr;
      const rpmEff = this.rpm * (1 + 0.007 * Math.sin(this.idlePh) * (1 - rpmN));

      // Advance crank and fire cylinders whose angle was crossed
      const prev = this.phase;
      this.phase += ((rpmEff / 60) * 720) / sr;
      for (let i = 0; i < cyl.length; i++) {
        const a = cyl[i].a;
        if ((a > prev && a <= this.phase) || (a + 720 > prev && a + 720 <= this.phase)) this.fire(cyl[i], rpmN);
      }
      if (this.phase >= 720) {
        this.phase -= 720;
        for (const c of cyl) c.a = (c.angle + (rand() - 0.5) * 2 * p.timingJitter + 720) % 720;
      }

      // Exhaust pulses into banks
      for (const b of banks) b.sig = 0;
      for (let i = 0; i < cyl.length; i++) {
        const c = cyl[i];
        if (c.t > c.T * 3) continue;
        const x = c.t / c.T;
        const shape = x < 0.12 ? x / 0.12 : Math.exp(-(x - 0.12) * 4);
        const w = rand() * 2 - 1;
        banks[c.bank].sig += c.A * shape * (1 - c.noise + c.noise * w * 1.7);
        c.t++;
      }

      let sum = 0;
      for (const b of banks) sum += b.main.run(b.header.run(b.sig));
      const col = this.collector.run(sum / banks.length);
      let y = this.muffler.run(col) + col * p.raw;

      // Intake roar, pulsed by the firing
      this.intakeEnv *= this.intakeDecay;
      y += this.intakeBp.run(rand() * 2 - 1) * (0.15 + this.intakeEnv) * p.intake * this.load * (0.3 + rpmN);

      if (p.turbo) {
        this.turboPh += (TAU * (2200 + 9000 * this.boost)) / sr;
        if (this.turboPh > TAU) this.turboPh -= TAU;
        y += Math.sin(this.turboPh) * 0.035 * this.boost * p.turbo;
        this.bov *= bovDecay;
        y += this.bovBp.run(rand() * 2 - 1) * this.bov * 0.5 * p.turbo;
      }

      // DC blocker + soft clip
      y *= p.gain;
      const dc = y - this.dcx + 0.995 * this.dcy;
      this.dcx = y; this.dcy = dc;
      out[s] = Math.tanh(dc);
    }
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class EngineProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'rpm', defaultValue: 800, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
        { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      ];
    }
    constructor(options) {
      super();
      this.core = new EngineCore(options.processorOptions.profile, sampleRate);
      this.alive = true;
      this.port.onmessage = (e) => { if (e.data === 'stop') this.alive = false; };
    }
    process(_inputs, outputs, params) {
      const out = outputs[0][0];
      this.core.render(out, out.length, params.rpm[0], params.load[0]);
      for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
      return this.alive;
    }
  }
  registerProcessor('engine', EngineProcessor);
} else if (typeof module !== 'undefined') {
  module.exports = { EngineCore }; // for offline tests
}
