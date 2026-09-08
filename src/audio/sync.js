const clamp = v => Math.max(0, Math.min(1, v));

export class PulseClock {
  constructor() { this.reset(); }
  reset() { this.times = []; this.period = 0; this.confidence = 0; this.anchor = 0; }
  add(t) {
    if (this.times.length && t - this.times.at(-1) > 3) this.reset();
    if (this.times.length && t - this.times.at(-1) < 0.16) return;
    this.times.push(t); if (this.times.length > 32) this.times.shift();
    if (this.times.length < 5) return;
    const intervals = [];
    for (let i = 1; i < this.times.length; i++) {
      let d = this.times[i] - this.times[i - 1];
      if (d > 2 || d < 0.16) continue;
      while (d < 60 / 180) d *= 2;
      while (d > 60 / 65) d /= 2;
      intervals.push(d);
    }
    if (!intervals.length) return;
    let best = [];
    for (const d of intervals) {
      const group = intervals.filter(x => Math.abs(x - d) < 0.025);
      if (group.length > best.length) best = group;
    }
    const candidate = best.reduce((a, b) => a + b, 0) / best.length;
    this.confidence = best.length / intervals.length * Math.min(1, intervals.length / 8);
    if (this.confidence < 0.45) return;
    this.period = this.period && Math.abs(this.period - candidate) < 0.08 ? this.period * 0.8 + candidate * 0.2 : candidate;
    this.anchor = t;
  }
  sample(t) {
    const confidence = this.confidence * Math.exp(-Math.max(0, t - (this.times.at(-1) ?? t) - 2) / 2);
    return { bpm: confidence >= 0.45 && this.period ? 60 / this.period : 0, confidence,
      phase: this.period ? ((t - this.anchor) / this.period % 1 + 1) % 1 : 0 };
  }
}

// Separates musical evidence from visual interpretation. Never labels a genre as fact.
export class AudioSync {
  constructor() { this.epoch = 0; this.reset(); }
  reset() {
    this.epoch++; this.queue = []; this.clock = new PulseClock();
    this.last = { kick: -10, snare: -10, hat: -10 }; this.strength = { kick: 0, snare: 0, hat: 0 };
    this.context = { melody: 0, sustain: 0, pluck: 0, percussion: 0, drive: 0, tenderness: 0 };
    this.latest = null; this.previousBeat = -1; this.beatIndex = 0;
  }
  ingest(packet) {
    if (packet.epoch !== this.epoch) return;
    this.latest = this.latest?.time === packet.time
      ? { ...packet, rms: Math.max(this.latest.rms, packet.rms) } : packet;
    this.queue.push(...packet.events);
    if (this.queue.length > 256) this.queue.splice(0, this.queue.length - 256);
  }
  enrich(f, dt, now, precise = false) {
    const events = [];
    if (precise) {
      this.queue.sort((a, b) => a.time - b.time);
      while (this.queue.length && this.queue[0].time <= now) {
        const e = this.queue.shift();
        if (e.time - this.last[e.type] < 0.045) continue;
        this.last[e.type] = e.time; this.strength[e.type] = e.strength;
        if (e.type === 'kick') this.clock.add(e.time);
        if (now - e.time < 0.15) events.push(e);
      }
      for (const type of ['kick', 'snare', 'hat']) f[type] = this.strength[type] * Math.exp(-Math.max(0, now - this.last[type]) * ({ kick: 8, snare: 11, hat: 18 }[type]));
      f.onset = events.some(e => e.type === 'kick');
      f.snareOnset = events.some(e => e.type === 'snare'); f.hatOnset = events.some(e => e.type === 'hat');
      f.fullOnset = events.length > 0; f.transient = Math.max(f.kick, f.snare, f.hat);
      const pulse = this.clock.sample(now);
      f.bpm = Math.round(pulse.bpm); f.tempoConfidence = pulse.confidence; f.beatPhase = pulse.phase;
      // Predicted phase is guidance only. Impacts always require measured events.
      f.beat = f.onset; if (f.beat) this.beatIndex++;
      f.beatIndex = this.beatIndex; f.barPhase = ((this.beatIndex % 4) + pulse.phase) / 4;
    } else {
      for (const [type, key] of [['kick', 'onset'], ['snare', 'snareOnset'], ['hat', 'hatOnset']]) {
        if (f[key]) events.push({ type, time: now, strength: f[type], confidence: 0.4 });
      }
    }
    const audible = f.active && (!precise || (this.latest && now - this.latest.time < 0.3 && this.latest.rms > 0.0015));
    if (!f.active) {
      events.length = 0;
      f.onset = f.snareOnset = f.hatOnset = f.fullOnset = f.beat = false;
    }
    const tonal = f.harmonicity ?? clamp(1 - f.flatness * 2.5);
    const targets = {
      melody: tonal * (f.mid * 0.65 + f.lowMid * 0.35) * (1 - f.transient * 0.5),
      sustain: tonal * f.energy * (1 - f.flux),
      pluck: tonal * f.mid * f.transient,
      percussion: Math.max(f.kick, f.snare, f.hat),
      drive: clamp(f.energy * 0.45 + f.bass * 0.25 + f.transient * 0.3),
      tenderness: tonal * (1 - f.mood.energy) * (1 - f.transient * 0.7),
    };
    for (const key in targets) {
      const target = audible ? targets[key] : 0;
      this.context[key] += (target - this.context[key]) * (1 - Math.exp(-dt * (key === 'percussion' || key === 'pluck' ? 14 : 1.8)));
    }
    const c = this.context;
    const character = !audible ? 'En reposo' : c.drive > 0.65 ? 'Intenso' : c.tenderness > 0.35 ? 'Delicado' : c.melody > 0.45 ? 'Melódico' : 'Rítmico';
    f.sync = { mode: precise ? 'sample-clock' : 'spectral', time: now, epoch: this.epoch, events, context: c, character, audible,
      analysisAgeMs: this.latest ? Math.max(0, now - this.latest.time) * 1000 : null };
    return f;
  }
}
