// Sample-clock analysis shared by AudioWorklet and deterministic offline tests.
// Instrument names describe transient signatures, not isolated stems.
const clamp = v => Math.max(0, Math.min(1, v));

class Bandpass {
  constructor(rate, hz, q) {
    const w = 2 * Math.PI * hz / rate, a = Math.sin(w) / (2 * q);
    this.b = a / (1 + a); this.a1 = -2 * Math.cos(w) / (1 + a);
    this.a2 = (1 - a) / (1 + a); this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  sample(x) {
    const y = this.b * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export class SyncDSP {
  constructor(rate) {
    this.rate = rate;
    this.hop = Math.round(rate * 0.008);
    this.filters = [new Bandpass(rate, 75, 0.8), new Bandpass(rate, 1500, 0.65), new Bandpass(rate, Math.min(8000, rate * 0.42), 0.8)];
    this.sum = [0, 0, 0]; this.previous = [0, 0, 0]; this.mean = [0, 0, 0];
    this.deviation = [0, 0, 0]; this.last = [-10, -10, -10];
    this.count = 0; this.total = 0; this.windows = 0;
  }
  // A callback only every 8 ms; no per-sample allocations or dependence on graphics FPS.
  process(channels, frame, emit) {
    const length = channels[0]?.length || 0;
    for (let i = 0; i < length; i++) {
      // Caller supplies one independent channel; never downmix anti-phase audio.
      const x = channels[0][i];
      this.total += x * x;
      for (let b = 0; b < 3; b++) { const y = this.filters[b].sample(x); this.sum[b] += y * y; }
      if (++this.count < this.hop) continue;
      const time = (frame + i + 1) / this.rate;
      const rms = Math.sqrt(this.total / this.count);
      const levels = this.sum.map(s => Math.sqrt(s / this.count));
      const events = [];
      for (let b = 0; b < 3; b++) {
        const rise = Math.max(0, levels[b] - this.previous[b]);
        const threshold = this.mean[b] + 2.5 * this.deviation[b] + 0.0012;
        const contrast = rise / Math.max(0.001, levels[b]);
        const presence = levels[b] / Math.max(0.001, rms);
        const refractory = [0.16, 0.12, 0.055][b];
        if (this.windows > 5 && rms > 0.002 && presence > 0.16 && rise > threshold && contrast > 0.17 && time - this.last[b] > refractory) {
          events.push({ type: ['kick', 'snare', 'hat'][b], time, strength: clamp(rise / (threshold * 3)), confidence: clamp(contrast * 1.6) });
          this.last[b] = time;
        }
        this.deviation[b] += (Math.abs(rise - this.mean[b]) - this.deviation[b]) * 0.035;
        this.mean[b] += (rise - this.mean[b]) * 0.035;
        this.previous[b] = levels[b]; this.sum[b] = 0;
      }
      emit({ time, rms, levels, events });
      this.windows++; this.count = 0; this.total = 0;
    }
  }
}
