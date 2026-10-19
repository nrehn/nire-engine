/* Main-thread side of the engine sound: loads the AudioWorklet and feeds it rpm/load.
 * Chain: worklet -> body EQ (low shelf + cabin-ish peak) -> bus (fade in/out) -> master volume -> compressor -> out
 */
class EngineSound {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.volume = 0.8;
  }

  /** Must be called from a user gesture (click/tap) so the browser allows audio. */
  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 8;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(this.ctx.destination);
      if (!this.ctx.audioWorklet) throw new Error('This browser does not support AudioWorklet');
      // Needs http(s)://, not file://
      this.ready = this.ctx.audioWorklet.addModule('js/engine-worklet.js');
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    await this.ready;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  start(profile) {
    this.stop(0.05);
    const c = this.ctx, t = c.currentTime;
    const node = new AudioWorkletNode(c, 'engine', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { profile },
    });
    // Body: a bit of chest-thump and a soft cabin resonance, tame the fizz
    const low = c.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 140; low.gain.value = 5;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 320; body.Q.value = 1; body.gain.value = 2;
    const high = c.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000; high.gain.value = -6;
    const bus = c.createGain(); bus.gain.value = 0;
    node.connect(low).connect(body).connect(high).connect(bus).connect(this.master);
    bus.gain.setTargetAtTime(1, t, 0.12);

    this.node = node;
    this.bus = bus;
    this.rpmParam = node.parameters.get('rpm');
    this.loadParam = node.parameters.get('load');
    this.rpmParam.value = profile.idle;
  }

  /** rpm: crank rpm, load: 0..1 */
  update(rpm, load) {
    if (!this.node) return;
    const t = this.ctx.currentTime;
    this.rpmParam.setTargetAtTime(rpm, t, 0.015);
    this.loadParam.setTargetAtTime(load, t, 0.02);
  }

  stop(fade = 0.6) {
    if (!this.node) return;
    const t = this.ctx.currentTime, node = this.node, bus = this.bus;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(0, t, fade / 4);
    // Engine winds down while fading
    this.rpmParam.setTargetAtTime(0, t, fade / 2);
    this.loadParam.setTargetAtTime(0, t, 0.02);
    setTimeout(() => { node.port.postMessage('stop'); node.disconnect(); }, (fade + 0.2) * 1000);
    this.node = null;
  }

  /** Short beep to check the car's speakers are working. */
  beep() {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.02);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.45);
  }
}
window.EngineSound = EngineSound;
