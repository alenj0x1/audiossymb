// Extracción de características musicales en tiempo real a partir de uno o varios
// AnalyserNode. Produce:
//   · 64 bandas logarítmicas normalizadas (control automático de ganancia por banda)
//   · picos por banda (ataque instantáneo, caída lenta) para elementos que "saltan"
//   · bandas gruesas (sub, bass, lowMid, mid, high, treble) suavizadas
//   · detección de golpes por flujo espectral con umbral adaptativo (bombo / caja / hi-hat)
//   · tempo, fase de pulso y fase de compás
//   · brillo (centroide), planitud espectral, factor de cresta
//   · cromagrama de 12 clases de altura → tónica estimada (mueve el color)
//   · panorama estéreo (izquierda/derecha) → movimiento lateral de la escena
//   · "ánimo" de largo plazo que orienta la estética

const NUM_BANDS = 64;
const NUM_CHROMA = 12;
const WAVE_POINTS = 256;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

class RingBuffer {
  constructor(n) { this.buf = new Float32Array(n); this.i = 0; this.count = 0; }
  push(v) { this.buf[this.i] = v; this.i = (this.i + 1) % this.buf.length; if (this.count < this.buf.length) this.count++; }
  mean() { let s = 0; for (let k = 0; k < this.count; k++) s += this.buf[k]; return this.count ? s / this.count : 0; }
  std(mean) { let s = 0; for (let k = 0; k < this.count; k++) { const d = this.buf[k] - mean; s += d * d; } return this.count ? Math.sqrt(s / this.count) : 0; }
}

// Seguidor de picos: normaliza cada señal respecto a su máximo reciente para que canciones
// silenciosas o comprimidas reaccionen igual de bien.
class AutoGain {
  constructor(floor = 0.05, decay = 0.9985) { this.peak = floor; this.floor = floor; this.decay = decay; }
  norm(v) {
    if (v > this.peak) this.peak = this.peak + (v - this.peak) * 0.55;
    else this.peak = Math.max(this.floor, this.peak * this.decay);
    return clamp01(v / this.peak);
  }
  reset() { this.peak = this.floor; }
}

class OnsetDetector {
  constructor({ refractoryMs = 120, k = 1.6, history = 43, decay = 7.5 }) {
    this.history = history;
    this.hist = new RingBuffer(history);
    this.prev = null;
    this.lastOnset = -1e9;
    this.refractory = refractoryMs;
    this.k = k;
    this.decay = decay;
    this.impulse = 0;
    this.strength = 0;
  }
  // frame: Float32Array de magnitudes (ya lineales) de la región que vigila
  process(frame, now, dt) {
    let flux = 0;
    if (this.prev && this.prev.length === frame.length) {
      for (let i = 0; i < frame.length; i++) {
        const d = frame[i] - this.prev[i];
        if (d > 0) flux += d;
      }
      flux /= frame.length;
    } else {
      this.prev = new Float32Array(frame.length);
    }
    this.prev.set(frame);

    const mean = this.hist.mean();
    const std = this.hist.std(mean);
    const threshold = mean + this.k * std + 0.004;
    let onset = false;
    if (flux > threshold && now - this.lastOnset > this.refractory && this.hist.count > 8) {
      onset = true;
      this.lastOnset = now;
      this.strength = clamp01((flux - threshold) / (threshold + 1e-3));
      this.impulse = Math.max(this.impulse, 0.55 + 0.45 * this.strength);
    }
    this.hist.push(flux);
    this.impulse *= Math.exp(-dt * this.decay);
    if (this.impulse < 0.002) this.impulse = 0;
    return { onset, flux, strength: this.strength };
  }
  reset() { this.prev = null; this.impulse = 0; this.lastOnset = -1e9; this.hist = new RingBuffer(this.history); }
}

// Estimación de tempo a partir de los intervalos entre golpes de bombo.
class TempoTracker {
  constructor() { this.times = []; this.bpm = 0; this.confidence = 0; this.lastBeat = 0; this.period = 0; }
  addOnset(t) {
    this.times.push(t);
    if (this.times.length > 24) this.times.shift();
    if (this.times.length < 6) return;
    // histograma de intervalos plegados al rango 70–180 BPM
    const buckets = new Map();
    for (let i = 1; i < this.times.length; i++) {
      for (let j = Math.max(0, i - 4); j < i; j++) {
        let ioi = this.times[i] - this.times[j];
        if (ioi <= 0) continue;
        while (ioi < 60000 / 180) ioi *= 2;
        while (ioi > 60000 / 70) ioi /= 2;
        const key = Math.round(ioi / 15) * 15; // resolución 15 ms
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
    }
    let best = 0, bestKey = 0, total = 0;
    for (const [k, v] of buckets) { total += v; if (v > best) { best = v; bestKey = k; } }
    if (bestKey) {
      const bpm = 60000 / bestKey;
      this.bpm = this.bpm ? lerp(this.bpm, bpm, 0.35) : bpm;
      this.period = 60000 / this.bpm;
      this.confidence = clamp01(best / Math.max(1, total) * 2.5);
      this.lastBeat = t; // re-ancla la fase con el último golpe
    }
  }
  phase(now) {
    if (!this.period) return 0;
    return ((now - this.lastBeat) % this.period) / this.period;
  }
  reset() { this.times = []; this.bpm = 0; this.confidence = 0; this.period = 0; }
}

export class FeatureExtractor {
  constructor(analyser, sampleRate, stereo = null) {
    this.analyser = analyser;
    this.stereo = stereo;                       // { left, right } opcional
    this.sampleRate = sampleRate;
    this.binCount = analyser.frequencyBinCount;
    this.freqData = new Uint8Array(this.binCount);
    this.dbData = new Float32Array(this.binCount);
    this.timeData = new Float32Array(analyser.fftSize);
    this.lin = new Float32Array(this.binCount);

    this.bands = new Float32Array(NUM_BANDS);
    this.bandsSmooth = new Float32Array(NUM_BANDS);
    this.bandsPeak = new Float32Array(NUM_BANDS);
    this.bandsSlow = new Float32Array(NUM_BANDS);
    this.bandGain = Array.from({ length: NUM_BANDS }, () => new AutoGain(0.07, 0.9992));
    this.bandEdges = FeatureExtractor.logEdges(28, 17000, NUM_BANDS, sampleRate, analyser.fftSize);

    this.chroma = new Float32Array(NUM_CHROMA);
    this.chromaAcc = new Float32Array(NUM_CHROMA);
    this.chromaMap = FeatureExtractor.chromaMap(this.binCount, sampleRate / analyser.fftSize);
    this.wave = new Float32Array(WAVE_POINTS);
    this.waveSmooth = new Float32Array(WAVE_POINTS);

    if (stereo) {
      this.stereoData = {
        left: new Float32Array(stereo.left.fftSize),
        right: new Float32Array(stereo.right.fftSize),
      };
    }

    const hz = (f) => Math.min(this.binCount - 1, Math.round(f / (sampleRate / analyser.fftSize)));
    this.ranges = {
      sub: [hz(20), hz(60)], bass: [hz(60), hz(250)], lowMid: [hz(250), hz(600)],
      mid: [hz(600), hz(2500)], high: [hz(2500), hz(6000)], treble: [hz(6000), hz(16000)],
    };
    this.kickDet = new OnsetDetector({ refractoryMs: 170, k: 1.55, history: 40, decay: 7 });
    this.snareDet = new OnsetDetector({ refractoryMs: 140, k: 1.7, history: 40, decay: 9 });
    this.hatDet = new OnsetDetector({ refractoryMs: 70, k: 1.5, history: 30, decay: 14 });
    this.fullDet = new OnsetDetector({ refractoryMs: 90, k: 1.9, history: 34, decay: 11 });
    this.tempo = new TempoTracker();
    this.gains = {
      sub: new AutoGain(), bass: new AutoGain(), lowMid: new AutoGain(), mid: new AutoGain(),
      high: new AutoGain(), treble: new AutoGain(), energy: new AutoGain(0.04, 0.999),
    };
    this.reset();
  }

  static logEdges(fmin, fmax, n, sr, fft) {
    fmax = Math.min(fmax, sr * 0.48);
    const hzPerBin = sr / fft;
    const edges = new Int32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const f = fmin * Math.pow(fmax / fmin, i / n);
      edges[i] = Math.max(1, Math.min(fft / 2 - 1, Math.round(f / hzPerBin)));
    }
    for (let i = 1; i <= n; i++) if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] + 1;
    return edges;
  }

  // Cada bin de la FFT cae en una de las 12 clases de altura (o en ninguna).
  static chromaMap(bins, hzPerBin) {
    const map = new Int8Array(bins).fill(-1);
    for (let i = 1; i < bins; i++) {
      const f = i * hzPerBin;
      if (f < 55 || f > 4200) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      map[i] = ((Math.round(midi) % 12) + 12) % 12;
    }
    return map;
  }

  reset() {
    this.smooth = {
      sub: 0, bass: 0, lowMid: 0, mid: 0, high: 0, treble: 0, energy: 0,
      centroid: 0.4, flux: 0, flatness: 0.4, crest: 0.3, pan: 0, width: 0,
    };
    this.mood = { energy: 0.3, brightness: 0.4, bassiness: 0.4, dynamics: 0.3, density: 0.3, roughness: 0.3 };
    this.bandsSmooth.fill(0); this.bandsPeak.fill(0); this.bandsSlow.fill(0);
    this.chroma.fill(0); this.waveSmooth.fill(0); this.wave.fill(0);
    this.bandGain.forEach(g => g.reset());
    for (const k in this.gains) this.gains[k].reset();
    this.kickDet.reset(); this.snareDet.reset(); this.hatDet.reset(); this.fullDet.reset();
    this.tempo.reset();
    this.silenceFrames = 0;
    this.now = 0;
    this.beatIndex = 0;
    this.sectionEnergy = 0.3;
    this.tonic = 0;
    this.tonicStrength = 0;
    this.harmonicity = 0;
    this._prevPhase = 0;
    this._lastSection = -1e9;
  }

  static idle() {
    return {
      active: false,
      bands: new Float32Array(NUM_BANDS), bandsPeak: new Float32Array(NUM_BANDS), bandsSlow: new Float32Array(NUM_BANDS),
      chroma: new Float32Array(NUM_CHROMA), spectrum: null,
      wave: new Float32Array(WAVE_POINTS), waveRaw: new Float32Array(WAVE_POINTS),
      sub: 0, bass: 0, lowMid: 0, mid: 0, high: 0, treble: 0, energy: 0,
      kick: 0, snare: 0, hat: 0, transient: 0,
      onset: false, snareOnset: false, hatOnset: false, fullOnset: false, beat: false,
      beatPhase: 0, barPhase: 0, beatIndex: 0, bpm: 0, tempoConfidence: 0,
      centroid: 0.4, flux: 0, flatness: 0.4, crest: 0.3, pan: 0, width: 0,
      tonic: 0, tonicStrength: 0, sectionChange: false,
      mood: { energy: 0.3, brightness: 0.4, bassiness: 0.4, dynamics: 0.3, density: 0.3, roughness: 0.3 },
    };
  }

  avg(range) {
    const [a, b] = range;
    let s = 0;
    for (let i = a; i < b; i++) s += this.lin[i];
    return b > a ? s / (b - a) : 0;
  }

  // Panorama estéreo: sólo disponible si el motor creó analizadores por canal.
  _stereoPan() {
    if (!this.stereo) return { pan: 0, width: 0, rms: 0 };
    const { left, right } = this.stereo;
    left.getFloatTimeDomainData(this.stereoData.left);
    right.getFloatTimeDomainData(this.stereoData.right);
    let l = 0, r = 0, side = 0;
    const n = this.stereoData.left.length;
    for (let i = 0; i < n; i++) {
      const a = this.stereoData.left[i], b = this.stereoData.right[i];
      l += a * a; r += b * b; side += (a - b) ** 2;
    }
    const sum = l + r;
    return {
      pan: sum > 0.002 ? Math.max(-1, Math.min(1, (r - l) / sum)) : 0,
      width: sum > 0.002 ? clamp01(side / (2 * sum)) : 0,
      rms: Math.sqrt(sum / (2 * n)),
    };
  }

  update(dt, sensitivity = 1, active = true, audioTime = null) {
    this.now = audioTime === null ? this.now + dt * 1000 : audioTime * 1000;
    const now = this.now;
    const an = this.analyser;
    an.getByteFrequencyData(this.freqData);
    an.getFloatFrequencyData(this.dbData);
    an.getFloatTimeDomainData(this.timeData);

    // magnitudes lineales (0..1) con una curva que realza detalles suaves
    let sum = 0, wsum = 0, sumLog = 0;
    for (let i = 0; i < this.binCount; i++) {
      const v = this.freqData[i] / 255;
      const l = v * v * (0.6 + 0.4 * v);
      this.lin[i] = l;
      sum += l; wsum += l * i;
      sumLog += Math.log(l + 1e-6);
    }

    // forma de onda: RMS, cresta y versión reducida/suavizada para las capas
    let rms = 0, peak = 0;
    const td = this.timeData, tdN = td.length;
    for (let i = 0; i < tdN; i++) { const s = td[i]; rms += s * s; const a = s < 0 ? -s : s; if (a > peak) peak = a; }
    rms = Math.sqrt(rms / tdN);
    const stereo = this._stereoPan();
    rms = Math.max(rms, stereo.rms);
    const step = tdN / WAVE_POINTS;
    const waveSm = 1 - Math.exp(-dt * 26);
    for (let i = 0; i < WAVE_POINTS; i++) {
      const s = td[Math.floor(i * step)];
      this.wave[i] = s;
      this.waveSmooth[i] += (s - this.waveSmooth[i]) * waveSm;
    }
    const silent = rms < 0.0015 && sum < 0.5;
    this.silenceFrames = silent ? this.silenceFrames + 1 : 0;

    // bandas logarítmicas normalizadas + picos + envolvente lenta
    const sm = 1 - Math.exp(-dt * 16);
    const slowSm = 1 - Math.exp(-dt * 1.6);
    for (let b = 0; b < NUM_BANDS; b++) {
      const a = this.bandEdges[b], e = this.bandEdges[b + 1];
      let s = 0;
      for (let i = a; i < e; i++) s += this.lin[i];
      const raw = this.bandGain[b].norm(s / (e - a));
      this.bands[b] = raw;
      const target = clamp01(raw * sensitivity);
      // subida rápida, bajada suave
      this.bandsSmooth[b] = target > this.bandsSmooth[b]
        ? lerp(this.bandsSmooth[b], target, Math.min(1, sm * 2.4))
        : lerp(this.bandsSmooth[b], target, sm * 0.65);
      // pico: sube al instante, baja despacio (da "chispazos" a anillos y partículas)
      this.bandsPeak[b] = target > this.bandsPeak[b] ? target : this.bandsPeak[b] * Math.exp(-dt * 2.6);
      this.bandsSlow[b] = lerp(this.bandsSlow[b], target, slowSm);
    }

    // cromagrama → tónica estimada (rota la paleta con la armonía)
    const chromaDecay = 1 - Math.exp(-dt * 2.2);
    this.chromaAcc.fill(0);
    // Only prominent spectral peaks vote for pitch. Log-byte magnitudes used by the
    // visual equalizer otherwise make broadband drums look like a twelve-note chord.
    let tonalPower = 0, totalPower = 0;
    const hzPerBin = this.sampleRate / an.fftSize;
    for (let i = 2; i < this.binCount - 2; i++) {
      const hz = i * hzPerBin;
      if (hz < 140 || hz > 4200) continue;
      const db = this.dbData[i];
      const power = Math.pow(10, db / 10);
      totalPower += power;
      if (db < -75 || db <= this.dbData[i - 1] || db <= this.dbData[i + 1]) continue;
      const prominence = db - (this.dbData[i - 2] + this.dbData[i + 2]) * 0.5;
      if (prominence < 3) continue;
      const left = this.dbData[i - 1], right = this.dbData[i + 1];
      const shift = Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / (left - 2 * db + right || 1)));
      const midi = 69 + 12 * Math.log2((i + shift) * hzPerBin / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      this.chromaAcc[pc] += Math.sqrt(power);
      tonalPower += power;
    }
    this.harmonicity = lerp(this.harmonicity, clamp01(tonalPower / (totalPower + 1e-12) * 1.8), chromaDecay);
    let chromaMax = 1e-6, tonic = this.tonic;
    for (let c = 0; c < NUM_CHROMA; c++) if (this.chromaAcc[c] > chromaMax) { chromaMax = this.chromaAcc[c]; tonic = c; }
    let chromaSum = 0;
    for (let c = 0; c < NUM_CHROMA; c++) {
      this.chroma[c] = lerp(this.chroma[c], clamp01(this.chromaAcc[c] / chromaMax), chromaDecay);
      chromaSum += this.chroma[c];
    }
    this.tonic = tonic;
    this.tonicStrength = clamp01(1 - (chromaSum - 1) / (NUM_CHROMA - 1));

    // bandas gruesas
    const sub = this.gains.sub.norm(this.avg(this.ranges.sub));
    const bass = this.gains.bass.norm(this.avg(this.ranges.bass));
    const lowMid = this.gains.lowMid.norm(this.avg(this.ranges.lowMid));
    const mid = this.gains.mid.norm(this.avg(this.ranges.mid));
    const high = this.gains.high.norm(this.avg(this.ranges.high));
    const treble = this.gains.treble.norm(this.avg(this.ranges.treble));
    const energy = this.gains.energy.norm(rms);
    const centroidRaw = sum > 0 ? wsum / sum / this.binCount : 0.2; // 0..1 (posición ponderada)
    const centroid = clamp01(Math.log10(1 + centroidRaw * 40) / Math.log10(41)); // escala log
    // planitud espectral: ruido (→1) frente a tonos definidos (→0)
    const geo = Math.exp(sumLog / this.binCount);
    const flatness = clamp01(geo / (sum / this.binCount + 1e-6));
    const crest = clamp01(rms > 1e-5 ? (peak / rms - 1) / 6 : 0);
    const { pan, width } = stereo;

    const up = 1 - Math.exp(-dt * 24), down = 1 - Math.exp(-dt * 6.5);
    const follow = (key, target) => {
      const t = clamp01(target * sensitivity);
      const cur = this.smooth[key];
      this.smooth[key] = t > cur ? lerp(cur, t, up) : lerp(cur, t, down);
    };
    follow('sub', sub); follow('bass', bass); follow('lowMid', lowMid);
    follow('mid', mid); follow('high', high); follow('treble', treble); follow('energy', energy);
    this.smooth.centroid = lerp(this.smooth.centroid, centroid, 1 - Math.exp(-dt * 3));
    this.smooth.flatness = lerp(this.smooth.flatness, flatness, 1 - Math.exp(-dt * 2));
    this.smooth.crest = lerp(this.smooth.crest, crest, 1 - Math.exp(-dt * 4));
    this.smooth.pan = lerp(this.smooth.pan, pan, 1 - Math.exp(-dt * 2.5));
    this.smooth.width = lerp(this.smooth.width, width, 1 - Math.exp(-dt * 2.5));

    // detección de golpes en regiones espectrales distintas
    const kickFrame = this.lin.subarray(this.ranges.sub[0], this.ranges.bass[1]);
    const snareFrame = this.lin.subarray(this.ranges.lowMid[0], this.ranges.high[0]);
    const hatFrame = this.lin.subarray(this.ranges.high[0], this.ranges.treble[1]);
    const k = this.kickDet.process(kickFrame, now, dt);
    const s = this.snareDet.process(snareFrame, now, dt);
    const h = this.hatDet.process(hatFrame, now, dt);
    const full = this.fullDet.process(this.bandsSmooth, now, dt);
    this.smooth.flux = lerp(this.smooth.flux, clamp01((k.flux + s.flux + h.flux) * 8), 1 - Math.exp(-dt * 8));

    const onset = k.onset && !silent;
    if (onset) this.tempo.addOnset(now);

    // pulso predicho por tempo (la interfaz respira aunque el golpe sea sutil)
    let beat = false;
    if (this.tempo.period && this.tempo.confidence > 0.25) {
      const ph = this.tempo.phase(now);
      if (ph < this._prevPhase) { beat = true; this.beatIndex++; }
      this._prevPhase = ph;
    }
    const beatPhase = this.tempo.phase(now);
    const barPhase = ((this.beatIndex % 4) + beatPhase) / 4;

    // ánimo de largo plazo (≈ 12 s) y cambios de sección (≈ 2.5 s vs largo plazo)
    const slow = 1 - Math.exp(-dt / 12);
    const mid2 = 1 - Math.exp(-dt / 2.5);
    this.sectionEnergy = lerp(this.sectionEnergy, this.smooth.energy, mid2);
    const m = this.mood;
    m.energy = lerp(m.energy, this.smooth.energy, slow);
    m.brightness = lerp(m.brightness, this.smooth.centroid, slow);
    m.bassiness = lerp(m.bassiness, clamp01(this.smooth.bass / (this.smooth.treble + this.smooth.bass + 1e-3)), slow);
    m.dynamics = lerp(m.dynamics, clamp01(Math.abs(this.smooth.energy - m.energy) * 3), slow);
    m.roughness = lerp(m.roughness, this.smooth.flatness, slow);
    const density = this.tempo.bpm ? clamp01((this.tempo.bpm - 60) / 120) : m.density;
    m.density = lerp(m.density, density, slow);

    let sectionChange = false;
    const diff = Math.abs(this.sectionEnergy - m.energy);
    if (diff > 0.22 && now - this._lastSection > 9000 && now > 6000) {
      sectionChange = true;
      this._lastSection = now;
    }

    const isActive = active && !silent;
    return {
      active: isActive,
      bands: this.bandsSmooth, bandsPeak: this.bandsPeak, bandsSlow: this.bandsSlow, rawBands: this.bands,
      chroma: this.chroma, spectrum: this.lin, wave: this.waveSmooth, waveRaw: this.wave,
      sub: this.smooth.sub, bass: this.smooth.bass, lowMid: this.smooth.lowMid,
      mid: this.smooth.mid, high: this.smooth.high, treble: this.smooth.treble,
      energy: this.smooth.energy,
      kick: this.kickDet.impulse, snare: this.snareDet.impulse, hat: this.hatDet.impulse, transient: this.fullDet.impulse,
      onset, snareOnset: s.onset && !silent, hatOnset: h.onset && !silent, fullOnset: full.onset && !silent,
      beat, beatPhase, barPhase, beatIndex: this.beatIndex,
      bpm: Math.round(this.tempo.bpm), tempoConfidence: this.tempo.confidence,
      centroid: this.smooth.centroid, flux: this.smooth.flux, flatness: this.smooth.flatness, crest: this.smooth.crest,
      pan: this.smooth.pan, width: this.smooth.width,
      tonic: this.tonic, tonicStrength: this.tonicStrength,
      harmonicity: this.harmonicity,
      sectionChange,
      mood: m,
    };
  }
}

export { NUM_BANDS, NUM_CHROMA, WAVE_POINTS };
