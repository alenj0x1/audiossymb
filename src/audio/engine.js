// Motor de audio: administra el AudioContext, la fuente activa (archivo, micrófono,
// captura de pantalla/sistema o pista demo) y expone los AnalyserNode.
//
// Grafo:  fuente → input → analyser(mono, FFT 4096) → master(volumen) → salida
//                       └→ splitter → analyserL / analyserR   (panorama estéreo)
import { FeatureExtractor } from './features.js';
import { DemoTrack } from './demo.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.audioEl = null;          // <audio> para archivos
    this.elSource = null;         // MediaElementSource (solo se puede crear una vez por elemento)
    this.streamSource = null;     // micrófono / captura
    this.stream = null;
    this.demo = null;
    this.kind = 'none';           // none | file | mic | capture | demo | spotify
    this.features = null;
    this.onEnded = null;
    this.volume = 0.9;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && (this.kind === 'file' || this.kind === 'demo')) this.master.gain.value = v;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

      // punto de entrada común: todas las fuentes se conectan aquí
      this.input = this.ctx.createGain();
      this.input.gain.value = 1;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;             // ~5 Hz por bin: bandas graves mucho más definidas
      this.analyser.smoothingTimeConstant = 0.5;
      this.analyser.minDecibels = -96;
      this.analyser.maxDecibels = -8;
      this.input.connect(this.analyser);

      // analizadores por canal para el panorama (FFT pequeña: sólo necesitamos energía)
      this.splitter = this.ctx.createChannelSplitter(2);
      this.analyserL = this.ctx.createAnalyser();
      this.analyserR = this.ctx.createAnalyser();
      for (const a of [this.analyserL, this.analyserR]) {
        a.fftSize = 512;
        a.smoothingTimeConstant = 0.6;
      }
      this.input.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);

      // analizador → master (volumen / silencio para evitar eco) → salida
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume ?? 0.9;
      this.analyser.connect(this.master);
      this.master.connect(this.ctx.destination);

      this.features = new FeatureExtractor(this.analyser, this.ctx.sampleRate, { left: this.analyserL, right: this.analyserR });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _disconnectCurrent() {
    if (this.audioEl) { this.audioEl.pause(); }
    if (this.elSource) { try { this.elSource.disconnect(); } catch {} }
    if (this.streamSource) { try { this.streamSource.disconnect(); } catch {} this.streamSource = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.demo) { this.demo.stop(); this.demo = null; }
    this.features?.reset();
  }

  // ---------- Archivo local ----------
  async loadFile(file) {
    this.ensureContext();
    this._disconnectCurrent();
    if (!this.audioEl) {
      this.audioEl = new Audio();
      this.audioEl.crossOrigin = 'anonymous';
      this.audioEl.preload = 'auto';
      this.audioEl.addEventListener('ended', () => this.onEnded?.());
      this.elSource = this.ctx.createMediaElementSource(this.audioEl);
    }
    if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
    this._objectUrl = URL.createObjectURL(file);
    this.audioEl.src = this._objectUrl;
    this.elSource.connect(this.input);
    this.master.gain.value = this.volume;
    this.kind = 'file';
    await this.audioEl.play();
  }

  // ---------- Micrófono ----------
  async useMicrophone() {
    this.ensureContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this._attachStream(stream, 'mic');
  }

  // ---------- Salida del sistema como entrada (sin diálogo de compartir) ----------
  // Windows y muchas tarjetas exponen la mezcla de salida como un dispositivo de entrada
  // ("Mezcla estéreo", "Stereo Mix", cables virtuales…). Si existe, es la mejor vía: el
  // permiso de micrófono se concede una vez y el navegador lo recuerda, así que en las
  // siguientes visitas el audio real está disponible sin que el usuario haga nada.
  static LOOPBACK_RE = /mezcla est|stereo ?mix|loopback|what ?u ?hear|lo que oyes|monitor of|cable output|voicemeeter|virtual (audio|cable)|wave ?out/i;

  async listAudioInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
  }

  // Devuelve el dispositivo de salida-como-entrada si lo hay. Las etiquetas sólo están
  // visibles con permiso concedido; `askPermission` lo pide una única vez.
  async findLoopbackDevice({ askPermission = false } = {}) {
    let inputs = await this.listAudioInputs();
    const named = inputs.some(d => d.label);
    if (!named && askPermission) {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(t => t.stop());
      inputs = await this.listAudioInputs();
    }
    return inputs.find(d => AudioEngine.LOOPBACK_RE.test(d.label)) || null;
  }

  async useAudioInput(deviceId) {
    this.ensureContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      },
    });
    this._attachStream(stream, 'loopback');
    return stream.getAudioTracks()[0]?.label || '';
  }

  // ---------- Captura de pestaña / sistema ----------
  async useDisplayCapture({ preferCurrentTab = false } = {}) {
    this.ensureContext();
    const constraints = {
      video: true, // Chrome exige vídeo para poder ofrecer audio
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      systemAudio: 'include',
      selfBrowserSurface: 'include',
      surfaceSwitching: 'include',
    };
    if (preferCurrentTab) constraints.preferCurrentTab = true;
    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No se compartió audio. Vuelve a intentarlo y marca "Compartir audio" en el diálogo.');
    }
    // No necesitamos el vídeo; detenerlo ahorra CPU.
    stream.getVideoTracks().forEach(t => t.stop());
    this._attachStream(stream, 'capture');
  }

  _attachStream(stream, kind) {
    this._disconnectCurrent();
    this.master.gain.value = 0; // no reenviamos el micro/captura a los altavoces: evitamos eco
    this.stream = stream;
    this.streamSource = this.ctx.createMediaStreamSource(stream);
    this.streamSource.connect(this.input);
    this.kind = kind;
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (this.kind === kind) { this.kind = 'none'; this.onEnded?.('stream'); }
    });
  }

  // ---------- Pista demo procedural ----------
  startDemo(seed) {
    this.ensureContext();
    this._disconnectCurrent();
    this.demo = new DemoTrack(this.ctx, seed);
    this.demo.output.connect(this.input);
    this.master.gain.value = this.volume;
    this.demo.start();
    this.kind = 'demo';
  }

  // ---------- Silencio (modo Spotify sin captura) ----------
  goSilent() {
    this._disconnectCurrent();
    this.kind = 'spotify';
  }

  // ---------- Transporte ----------
  get isPlaying() {
    if (this.kind === 'file') return !!this.audioEl && !this.audioEl.paused;
    if (this.kind === 'demo') return !!this.demo?.playing;
    return this.kind === 'mic' || this.kind === 'capture' || this.kind === 'loopback';
  }
  togglePlay() {
    if (this.kind === 'file' && this.audioEl) {
      this.audioEl.paused ? this.audioEl.play() : this.audioEl.pause();
    } else if (this.kind === 'demo' && this.demo) {
      this.demo.toggle();
    }
  }
  get currentTime() { return this.kind === 'file' ? this.audioEl?.currentTime || 0 : 0; }
  get duration() { return this.kind === 'file' ? this.audioEl?.duration || 0 : 0; }
  seek(fraction) {
    if (this.kind === 'file' && this.audioEl?.duration) this.audioEl.currentTime = fraction * this.audioEl.duration;
  }

  // Extrae las características del frame actual; si no hay fuente, devuelve un estado en reposo.
  update(dt, sensitivity = 1) {
    if (!this.features) return FeatureExtractor.idle();
    return this.features.update(dt, sensitivity, this.kind !== 'none' && this.kind !== 'spotify');
  }
}
