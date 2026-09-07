// Pista de demostración generada por síntesis: bombo, caja, hi-hat, bajo, pad y arpegio.
// Sirve para probar el visualizador sin archivos ni cuenta de Spotify.
import { mulberry32 } from '../visual/seed.js';

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

export class DemoTrack {
  constructor(ctx, seed = Date.now()) {
    this.ctx = ctx;
    this.rand = mulberry32(seed >>> 0);
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;
    this.bpm = 96 + Math.floor(this.rand() * 50);
    this.root = 36 + Math.floor(this.rand() * 10);
    const names = Object.keys(SCALES);
    this.scale = SCALES[names[Math.floor(this.rand() * names.length)]];
    this.step = 0;
    this.playing = false;
    this.nextTime = 0;
    this.timer = null;
    this.progression = [0, 5, 3, 4].map(d => d + Math.floor(this.rand() * 2));
    this.pattern = this._makePattern();

    // buses
    this.drumBus = ctx.createGain(); this.drumBus.gain.value = 1;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.5;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.drumBus.connect(this.comp); this.musicBus.connect(this.comp); this.comp.connect(this.output);

    // ruido para caja y hi-hat
    const len = ctx.sampleRate * 1;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _makePattern() {
    const r = this.rand;
    const kick = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    if (r() < 0.5) kick[10] = 1; if (r() < 0.4) kick[7] = 1; if (r() < 0.3) kick[14] = 1;
    const snare = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
    if (r() < 0.35) snare[15] = 0.6;
    const hat = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 1 : r() < 0.6 ? 0.6 : 0));
    const bass = Array.from({ length: 16 }, (_, i) => (i % 4 === 0 || r() < 0.3 ? 1 : 0));
    const arp = Array.from({ length: 16 }, () => (r() < 0.55 ? Math.floor(r() * 7) : -1));
    return { kick, snare, hat, bass, arp };
  }

  midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  degree(bar, deg, oct = 0) {
    const chordRoot = this.progression[bar % this.progression.length];
    const idx = chordRoot + deg;
    return this.root + this.scale[idx % 7] + 12 * Math.floor(idx / 7) + 12 * oct;
  }

  start() { this.playing = true; this.nextTime = this.ctx.currentTime + 0.05; this._schedule(); }
  stop() { this.playing = false; clearTimeout(this.timer); }
  toggle() { this.playing ? this.stop() : this.start(); }

  _schedule() {
    if (!this.playing) return;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.25) {
      this._playStep(this.step, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
    this.timer = setTimeout(() => this._schedule(), 60);
  }

  _playStep(step, t, dur) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const section = Math.floor(bar / 8) % 3; // 0 intro suave · 1 pleno · 2 break
    const p = this.pattern;
    const ctx = this.ctx;

    if (s === 0 && bar % 4 === 0) this._pad(t, bar, dur * 64);
    if (section !== 2 || bar % 8 >= 6) {
      if (p.kick[s]) this._kick(t, p.kick[s]);
      if (p.snare[s] && section > 0) this._snare(t, p.snare[s]);
    }
    if (p.hat[s]) this._hat(t, p.hat[s] * (section === 2 ? 0.5 : 1), s % 4 === 2);
    if (p.bass[s] && section !== 2) this._bass(t, bar, dur * 1.8);
    if (p.arp[s] >= 0 && (section >= 1 || bar % 8 >= 4)) this._pluck(t, this.degree(bar, p.arp[s], 2), dur * 2.5);

    void ctx;
  }

  _env(node, t, a, d, peak = 1, sustain = 0) {
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }

  _kick(t, vel) {
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this._env(g, t, 0.003, 0.32, 1.2 * vel);
    o.connect(g).connect(this.drumBus); o.start(t); o.stop(t + 0.4);
  }
  _snare(t, vel) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = this.ctx.createGain(); this._env(g, t, 0.002, 0.18, 0.7 * vel);
    n.connect(f).connect(g).connect(this.drumBus); n.start(t); n.stop(t + 0.25);
    const o = this.ctx.createOscillator(); o.frequency.value = 190; const g2 = this.ctx.createGain();
    this._env(g2, t, 0.002, 0.08, 0.5 * vel); o.connect(g2).connect(this.drumBus); o.start(t); o.stop(t + 0.1);
  }
  _hat(t, vel, open) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = this.ctx.createGain(); this._env(g, t, 0.001, open ? 0.16 : 0.045, 0.28 * vel);
    n.connect(f).connect(g).connect(this.drumBus); n.start(t); n.stop(t + 0.2);
  }
  _bass(t, bar, dur) {
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = this.midi(this.degree(bar, 0, -1));
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, 0.005, dur, 0.55);
    o.connect(f).connect(g).connect(this.musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  _pluck(t, note, dur) {
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = this.midi(note);
    const g = this.ctx.createGain(); this._env(g, t, 0.004, dur, 0.35);
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = this.rand() * 1.4 - 0.7; o.connect(g).connect(pan).connect(this.musicBus); }
    else o.connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _pad(t, bar, dur) {
    const notes = [0, 2, 4].map(d => this.degree(bar, d, 1));
    const g = this.ctx.createGain(); this._env(g, t, dur * 0.25, dur * 0.7, 0.12);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    g.connect(f).connect(this.musicBus);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.midi(n); o.detune.value = det;
        o.connect(g); o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }
}
