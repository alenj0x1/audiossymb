// Reproduce, a partir del análisis precalculado de Spotify, el mismo juego de
// características que produce el analizador de audio en vivo. Así los visuales van
// sincronizados con la canción real sin necesidad de capturar el sonido del sistema.
//
// Del análisis se usan:
//   · segments  → sonoridad (envolvente por segmento), 12 clases de altura, 12 de timbre
//   · beats / bars / tatums → pulso, compás y golpes
//   · sections  → cambios de sección (la escena salta de color)
//   · track     → tempo, confianza, sonoridad media
//
// El espectro de 64 bandas no existe en el análisis, así que se sintetiza: cada banda toma
// la clase de altura que le corresponde por frecuencia y se inclina con el brillo del
// timbre. No es una FFT real, pero sigue la armonía y el color del sonido de la canción.
import { NUM_BANDS, NUM_CHROMA, WAVE_POINTS, FeatureExtractor } from './features.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

// dB de Spotify (≈ -60..0) a un 0..1 utilizable
const db01 = (db) => clamp01((db + 40) / 40);

// Recorre una lista de intervalos ordenados manteniendo un cursor: O(1) por frame mientras
// la reproducción avanza, y búsqueda binaria cuando el usuario salta de posición.
class Cursor {
  constructor(list) { this.list = list || []; this.i = 0; }
  seek(t) {
    const l = this.list;
    if (!l.length) return null;
    if (t < l[this.i].start) {
      // salto hacia atrás: búsqueda binaria
      let lo = 0, hi = l.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (l[m].start <= t) lo = m + 1; else hi = m; }
      this.i = Math.max(0, lo - 1);
    }
    while (this.i + 1 < l.length && l[this.i + 1].start <= t) this.i++;
    return l[this.i];
  }
  get index() { return this.i; }
}

// Frecuencia central de cada banda logarítmica → clase de altura (0..11)
function bandPitchClasses(n, fmin = 28, fmax = 17000) {
  const map = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const f = fmin * Math.pow(fmax / fmin, (i + 0.5) / n);
    const midi = 69 + 12 * Math.log2(f / 440);
    map[i] = ((Math.round(midi) % 12) + 12) % 12;
  }
  return map;
}

export class SpotifyTimeline {
  constructor(analysis, features = null) {
    this.track = analysis.track || {};
    this.segments = analysis.segments || [];
    this.beats = new Cursor(analysis.beats);
    this.bars = new Cursor(analysis.bars);
    this.tatums = new Cursor(analysis.tatums);
    this.sections = new Cursor(analysis.sections);
    this.segCursor = new Cursor(this.segments);
    this.features = features;

    this.bandPc = bandPitchClasses(NUM_BANDS);
    this.bands = new Float32Array(NUM_BANDS);
    this.bandsPeak = new Float32Array(NUM_BANDS);
    this.bandsSlow = new Float32Array(NUM_BANDS);
    this.chroma = new Float32Array(NUM_CHROMA);
    this.wave = new Float32Array(WAVE_POINTS);

    this.smooth = { energy: 0, sub: 0, bass: 0, lowMid: 0, mid: 0, high: 0, treble: 0, centroid: 0.4, flat: 0.4 };
    this.mood = { energy: 0.4, brightness: 0.4, bassiness: 0.4, dynamics: 0.3, density: 0.4, roughness: 0.3 };
    this.kick = 0; this.snare = 0; this.hat = 0; this.transient = 0;
    this.lastBeat = -1; this.lastTatum = -1; this.lastBar = -1; this.lastSection = -1;
    this.beatIndex = 0;
    this.wavePhase = 0;
    this.reset();
  }

  reset() {
    this.bands.fill(0); this.bandsPeak.fill(0); this.bandsSlow.fill(0);
    this.chroma.fill(0); this.wave.fill(0);
    this.kick = this.snare = this.hat = this.transient = 0;
    this.lastBeat = this.lastTatum = this.lastBar = this.lastSection = -1;
  }

  // Envolvente de sonoridad dentro del segmento: sube hasta loudness_max y luego cae hacia
  // el arranque del siguiente. Es lo que da el "ataque" de cada nota o golpe.
  _segmentEnvelope(seg, t) {
    const start = db01(seg.loudness_start);
    const peak = db01(seg.loudness_max);
    const tPeak = seg.loudness_max_time || 0;
    const rel = t - seg.start;
    if (rel <= tPeak || tPeak <= 0) {
      const k = tPeak > 0 ? clamp01(rel / tPeak) : 1;
      return lerp(start, peak, k * k * (3 - 2 * k));
    }
    const tail = Math.max(0.02, seg.duration - tPeak);
    const k = clamp01((rel - tPeak) / tail);
    const end = db01(seg.loudness_end ?? seg.loudness_start);
    return lerp(peak, Math.max(end, start * 0.7), k);
  }

  // Devuelve un objeto con la misma forma que FeatureExtractor.update()
  sample(tSec, dt, sensitivity = 1, playing = true) {
    const f = FeatureExtractor.idle();
    const seg = this.segCursor.seek(tSec);
    if (!seg) return f;

    const env = this._segmentEnvelope(seg, tSec) * sensitivity;
    const pitches = seg.pitches || [];
    const timbre = seg.timbre || [];

    // timbre[1] ≈ brillo, timbre[2] ≈ planitud, timbre[3] ≈ ataque
    const brightness = clamp01(timbre[1] !== undefined ? timbre[1] / 200 + 0.5 : 0.5);
    const flatness = clamp01(timbre[2] !== undefined ? timbre[2] / 200 + 0.5 : 0.4);
    const attack = clamp01(timbre[3] !== undefined ? timbre[3] / 200 + 0.5 : 0.5);

    // ---- cromagrama ----
    const chromaSm = 1 - Math.exp(-dt * 9);
    for (let i = 0; i < NUM_CHROMA; i++) {
      this.chroma[i] = lerp(this.chroma[i], clamp01(pitches[i] ?? 0), chromaSm);
    }
    let tonic = 0, best = -1;
    for (let i = 0; i < NUM_CHROMA; i++) if (this.chroma[i] > best) { best = this.chroma[i]; tonic = i; }

    // ---- espectro sintetizado ----
    // Inclinación grave/agudo según el brillo del timbre, modulada por la clase de altura.
    const up = 1 - Math.exp(-dt * 20), down = 1 - Math.exp(-dt * 6);
    for (let b = 0; b < NUM_BANDS; b++) {
      const x = b / (NUM_BANDS - 1);
      // con brillo alto, el peso se desplaza hacia las bandas altas
      const tilt = Math.pow(1 - Math.abs(x - brightness * 0.85) * 1.15, 2);
      const pc = clamp01(pitches[this.bandPc[b]] ?? 0.3);
      const noise = flatness * 0.35;                    // el ruido rellena todo el espectro
      const target = clamp01(env * Math.max(0, tilt) * (0.35 + pc * 0.95 + noise));
      this.bands[b] = target > this.bands[b] ? lerp(this.bands[b], target, up) : lerp(this.bands[b], target, down);
      this.bandsPeak[b] = target > this.bandsPeak[b] ? target : this.bandsPeak[b] * Math.exp(-dt * 2.6);
      this.bandsSlow[b] = lerp(this.bandsSlow[b], target, 1 - Math.exp(-dt * 1.6));
    }

    // ---- bandas gruesas ----
    const avg = (a, b2) => {
      let s = 0;
      const i0 = Math.floor(a * NUM_BANDS), i1 = Math.floor(b2 * NUM_BANDS);
      for (let i = i0; i < i1; i++) s += this.bands[i];
      return i1 > i0 ? s / (i1 - i0) : 0;
    };
    const follow = (key, target) => {
      this.smooth[key] = target > this.smooth[key]
        ? lerp(this.smooth[key], target, up) : lerp(this.smooth[key], target, down);
    };
    follow('sub', avg(0, 0.08));
    follow('bass', avg(0.05, 0.25));
    follow('lowMid', avg(0.22, 0.42));
    follow('mid', avg(0.38, 0.62));
    follow('high', avg(0.6, 0.82));
    follow('treble', avg(0.78, 1));
    follow('energy', env);
    this.smooth.centroid = lerp(this.smooth.centroid, brightness, 1 - Math.exp(-dt * 3));
    this.smooth.flat = lerp(this.smooth.flat, flatness, 1 - Math.exp(-dt * 2));

    // ---- pulso, compás y golpes ----
    const beat = this.beats.seek(tSec);
    const tatum = this.tatums.seek(tSec);
    const bar = this.bars.seek(tSec);
    const section = this.sections.seek(tSec);

    let onset = false, snareOnset = false, hatOnset = false, isBeat = false;
    if (playing && beat && this.beats.index !== this.lastBeat) {
      this.lastBeat = this.beats.index;
      this.beatIndex++;
      isBeat = true;
      const strength = 0.55 + env * 0.45 + attack * 0.25;
      // el pulso del compás pega más fuerte; los intermedios suenan a caja
      const onBar = bar && Math.abs(beat.start - bar.start) < 0.06;
      if (onBar || this.beatIndex % 2 === 1) { this.kick = Math.max(this.kick, strength); onset = true; }
      else { this.snare = Math.max(this.snare, strength * 0.85); snareOnset = true; }
    }
    if (playing && tatum && this.tatums.index !== this.lastTatum) {
      this.lastTatum = this.tatums.index;
      this.hat = Math.max(this.hat, 0.3 + this.smooth.treble * 0.6);
      hatOnset = true;
    }
    this.kick *= Math.exp(-dt * 7);
    this.snare *= Math.exp(-dt * 9);
    this.hat *= Math.exp(-dt * 14);
    this.transient = Math.max(this.kick, this.snare) * 0.8;

    let sectionChange = false;
    if (section && this.sections.index !== this.lastSection) {
      if (this.lastSection >= 0) sectionChange = true;
      this.lastSection = this.sections.index;
    }

    const beatPhase = beat ? clamp01((tSec - beat.start) / Math.max(0.05, beat.duration)) : 0;
    const barPhase = bar ? clamp01((tSec - bar.start) / Math.max(0.1, bar.duration)) : 0;

    // ---- forma de onda sintetizada ----
    // Una onda con la altura tónica y sus armónicos, con la envolvente del segmento: da a
    // las cintas una forma que se mueve con la música en lugar de una línea recta.
    const baseHz = 55 * Math.pow(2, tonic / 12);
    this.wavePhase = (this.wavePhase + dt * baseHz * 0.04) % 1;
    const amp = this.smooth.energy;
    for (let i = 0; i < WAVE_POINTS; i++) {
      const x = i / WAVE_POINTS;
      let v = 0;
      for (let h = 1; h <= 4; h++) {
        const pc = this.chroma[(tonic + (h - 1) * 4) % 12] || 0.2;
        v += Math.sin((x * h * 6 + this.wavePhase * 6.283 * h)) * pc / h;
      }
      this.wave[i] = v * amp * 0.55 * (0.5 + this.kick * 0.8);
    }

    // ---- ánimo de largo plazo ----
    const slow = 1 - Math.exp(-dt / 8);
    const m = this.mood;
    const sectionLoud = section ? db01(section.loudness) : this.smooth.energy;
    m.energy = lerp(m.energy, (this.smooth.energy * 0.6 + sectionLoud * 0.4), slow);
    m.brightness = lerp(m.brightness, brightness, slow);
    m.bassiness = lerp(m.bassiness, clamp01(this.smooth.bass / (this.smooth.bass + this.smooth.treble + 1e-3)), slow);
    m.dynamics = lerp(m.dynamics, clamp01(Math.abs(this.smooth.energy - m.energy) * 3), slow);
    m.roughness = lerp(m.roughness, flatness, slow);
    const tempo = section?.tempo || this.track.tempo || 0;
    m.density = lerp(m.density, clamp01((tempo - 60) / 120), slow);

    // ---- salida ----
    f.active = true;
    f.bands = this.bands; f.bandsPeak = this.bandsPeak; f.bandsSlow = this.bandsSlow;
    f.rawBands = this.bands; f.chroma = this.chroma;
    f.wave = this.wave; f.waveRaw = this.wave;
    f.sub = this.smooth.sub; f.bass = this.smooth.bass; f.lowMid = this.smooth.lowMid;
    f.mid = this.smooth.mid; f.high = this.smooth.high; f.treble = this.smooth.treble;
    f.energy = this.smooth.energy;
    f.kick = this.kick; f.snare = this.snare; f.hat = this.hat; f.transient = this.transient;
    f.onset = onset; f.snareOnset = snareOnset; f.hatOnset = hatOnset; f.fullOnset = onset || snareOnset;
    f.beat = isBeat; f.beatPhase = beatPhase; f.barPhase = barPhase; f.beatIndex = this.beatIndex;
    f.bpm = Math.round(tempo);
    f.tempoConfidence = section?.tempo_confidence ?? this.track.tempo_confidence ?? 0.5;
    f.centroid = this.smooth.centroid;
    f.flux = this.transient;
    f.flatness = this.smooth.flat;
    f.crest = attack;
    // El análisis es mono: el "panorama" se deriva de la fase del compás para que la escena
    // siga meciéndose de lado a lado.
    f.pan = Math.sin(barPhase * Math.PI * 2) * 0.5;
    f.width = 0.3;
    f.tonic = tonic;
    f.tonicStrength = clamp01(best);
    f.sectionChange = sectionChange;
    f.mood = m;
    return f;
  }
}
