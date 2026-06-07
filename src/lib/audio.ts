/* ============================================================
   Ambient audio — synthesized oud-like drone + courtyard wind.
   No external assets. Web Audio only. Ported from the
   dar-design-2 bundle (js/audio.js) into a typed singleton.

   SSR-safe: nothing touches `window` until a method runs
   (always behind a user gesture / effect).
   ============================================================ */

type Stoppable = { stop: (when?: number) => void };

class DarAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  on = false;
  private playing = false;
  private nodes: Stoppable[] = [];

  init(): void {
    if (this.ctx) return;
    const Ctx: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
  }

  /** Toggle the ambient bed. Returns the new on/off state. */
  toggle(): boolean {
    this.init();
    if (this.ctx!.state === "suspended") void this.ctx!.resume();
    if (this.playing) this.stop();
    else this.start();
    this.on = this.playing;
    return this.on;
  }

  private start(): void {
    if (this.playing || !this.ctx || !this.master) return;
    this.playing = true;
    const ctx = this.ctx;
    const master = this.master;
    const now = ctx.currentTime;

    // Drone tones — open-fifth-ish, slowly detuned. Suggests oud.
    const baseFreqs = [110, 165, 220, 247];
    baseFreqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 3 ? "triangle" : "sine";
      osc.frequency.value = f;

      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.06 - i * 0.012, now + 3);

      // slow LFO detune for breath
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + i * 0.04;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 1.2 + i * 0.5;
      lfo.connect(lfoG).connect(osc.detune);

      // gentle low-pass
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 800 + i * 200;
      filt.Q.value = 1.2;

      osc.connect(filt).connect(g).connect(master);
      osc.start();
      lfo.start();
      this.nodes.push(osc, lfo);
    });

    // Wind — filtered noise
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() - 0.5) * 2;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilt = ctx.createBiquadFilter();
    noiseFilt.type = "bandpass";
    noiseFilt.frequency.value = 700;
    noiseFilt.Q.value = 0.7;
    // very slow modulation
    const noiseLfo = ctx.createOscillator();
    noiseLfo.frequency.value = 0.04;
    const noiseLfoG = ctx.createGain();
    noiseLfoG.gain.value = 300;
    noiseLfo.connect(noiseLfoG).connect(noiseFilt.frequency);
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noiseGain.gain.linearRampToValueAtTime(0.025, now + 4);

    noise.connect(noiseFilt).connect(noiseGain).connect(master);
    noise.start();
    noiseLfo.start();
    this.nodes.push(noise, noiseLfo);

    // Master fade-in
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.6, now + 4);
  }

  private stop(): void {
    if (!this.playing || !this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.8);
    const nodes = this.nodes;
    setTimeout(() => {
      nodes.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      });
    }, 850);
    this.nodes = [];
    this.playing = false;
  }

  /** Short brass chime on transformation complete. */
  chime(): void {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const ctx = this.ctx;
    const dest = this.master ?? ctx.destination;
    const now = ctx.currentTime;
    [392, 587, 784].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.type = "sine";
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now + i * 0.18);
      g.gain.linearRampToValueAtTime(0.12, now + i * 0.18 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 2.4);
      osc.connect(g).connect(dest);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 2.6);
    });
  }
}

/** Process-wide ambient audio singleton. */
export const DarAudio = new DarAudioEngine();
