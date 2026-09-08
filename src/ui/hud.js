// Interfaz: pantalla de inicio, barra superior, reproductor, panel lateral, tarjetas y avisos.
const $ = (id) => document.getElementById(id);
const fmt = (sec) => { if (!isFinite(sec) || sec < 0) sec = 0; const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${s.toString().padStart(2, '0')}`; };
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const LAYER_INFO = {
  resonance: { name: 'Resonancia', desc: 'Impactos rítmicos y filamentos armónicos', icon: 'i-wave' },
  hero: { name: 'Escultura', desc: 'Protagonista de cristal, cromo o iridiscente', icon: 'i-hero' },
  nebula: { name: 'Nebulosa', desc: 'Lienzo volumétrico de fondo', icon: 'i-nebula' },
  aurora: { name: 'Auroras', desc: 'Cortinas de luz de lado a lado', icon: 'i-aurora' },
  liquid: { name: 'Metaformas', desc: 'Masas líquidas que se fusionan', icon: 'i-liquid' },
  flow: { name: 'Campo de flujo', desc: 'Motas arrastradas por corrientes', icon: 'i-flow' },
  particles: { name: 'Partículas', desc: 'Polvo estelar ligado al espectro', icon: 'i-particles' },
  rings: { name: 'Anillos', desc: 'Espectro radial con simetría', icon: 'i-rings' },
  ribbons: { name: 'Cintas', desc: 'La onda cruzando el espacio', icon: 'i-ribbon' },
  tunnel: { name: 'Túnel', desc: 'Aros que avanzan con la energía', icon: 'i-tunnel' },
  terrain: { name: 'Superficie', desc: 'Olas espectrales arriba y abajo', icon: 'i-terrain' },
  orbs: { name: 'Orbes', desc: 'Esferas de luz difusa flotando', icon: 'i-orbs' },
  shapes: { name: 'Formas', desc: 'Geometría que nace con cada golpe', icon: 'i-shapes' },
};
const SCHEME_NAMES = {
  analogous: 'Análoga', complementary: 'Complementaria', triadic: 'Triádica',
  split: 'Complementaria dividida', tetradic: 'Tetrádica', neon: 'Neón', duotone: 'Duotono',
  sunset: 'Atardecer', ocean: 'Océano', ember: 'Brasa', ice: 'Hielo', jungle: 'Selva',
  candy: 'Caramelo', mono: 'Monocroma', album: 'Portada del álbum',
};
const SOURCE_LABELS = {
  none: 'Sin fuente', file: 'Archivo local', mic: 'Micrófono', capture: 'Audio del sistema',
  loopback: 'Salida del sistema',
  demo: 'Pista generada', spotify: 'Spotify', analysis: 'Spotify · sincronizado',
  ambient: 'Spotify · sin análisis',
};
const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const CAMERA_NAMES = { orbit: 'órbita', drift: 'deriva', dolly: 'avance', spiral: 'espiral' };

export function toast(msg, { error = false, ms = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.style.setProperty('--ms', `${ms}ms`);
  el.innerHTML = `<svg><use href="#${error ? 'i-warn' : 'i-info'}"/></svg><span></span>`;
  el.querySelector('span').textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, ms);
}

export class Hud {
  constructor() {
    this.el = {
      welcome: $('welcome'), drawer: $('drawer'), tabs: $('tabs'), ink: $('tabs').querySelector('.tab-ink'),
      title: $('track-title'), artist: $('track-artist'),
      art: $('art'), artWrap: $('art-wrap'), artGlow: $('art-glow'),
      artView: $('art-view'), avMedia: $('av-media'), avImg: $('av-img'), avGlow: $('av-glow'),
      avTitle: $('av-title'), avArtist: $('av-artist'), avAlbum: $('av-album'), avPalette: $('av-palette'),
      avClose: $('av-close'), avBackdrop: $('av-backdrop'), avCaption: $('av-caption'),
      bar: $('progress-bar'), progress: $('progress'),
      cur: $('time-cur'), dur: $('time-dur'), beatline: $('beatline-bar'),
      play: $('btn-play'), prev: $('btn-prev'), next: $('btn-next'), volumeWrap: $('volume-wrap'),
      vibeName: $('vibe-name'), bpm: $('bpm'), sourceBadge: $('source-badge'), sourceLabel: $('source-label'),
      captureCta: $('btn-capture-cta'),
      spectrum: $('spectrum'), playerViz: $('player-viz'), chroma: $('chroma'),
      pVibeName: $('p-vibe-name'), pVibeMeta: $('p-vibe-meta'), pPalette: $('p-palette'),
      layerList: $('layer-list'), layerCount: $('layer-count'),
      stEnergy: $('st-energy'), stBass: $('st-bass'), stMid: $('st-mid'), stTreble: $('st-treble'),
      stCentroid: $('st-centroid'), stFlat: $('st-flat'), stPan: $('st-pan'),
      stBpm: $('st-bpm'), stConf: $('st-conf'), stScheme: $('st-scheme'), stMood: $('st-mood'), stTonic: $('st-tonic'),
      spotifyCard: $('spotify-card'), spotifyStatus: $('spotify-status'), spotifySub: $('spotify-sub'),
      logout: $('btn-spotify-logout'), connect: $('btn-spotify-connect'), deviceRow: $('spotify-device-row'),
      clientId: $('client-id'), redirect: $('redirect-uri'),
      quality: $('quality'), sens: $('sensitivity'), sensVal: $('sens-val'),
      intensity: $('intensity'), intensityVal: $('intensity-val'),
      trails: $('trails'), trailsVal: $('trails-val'), grain: $('grain'), grainVal: $('grain-val'),
      vibeCard: $('vibe-card'), vcName: $('vc-name'), vcMeta: $('vc-meta'), vcSwatches: $('vc-swatches'),
      dropHint: $('drop-hint'),
    };
    this.hasSource = false;
    this.manualHidden = false;
    this.autoHide = true;
    this.vibeCards = true;
    this.onLayerToggle = null;
    this.onQuality = null;
    this.activeTab = 'vibe';
    this.statTick = 0;
    this.beat = 0;
    this._peaks = new Float32Array(48);
    this._ctxSpectrum = this.el.spectrum.getContext('2d');
    this._ctxViz = this.el.playerViz.getContext('2d');
    this._ctxChroma = this.el.chroma.getContext('2d');
    this.track = {};
    this.artOpen = false;
    this._initTabs();
    this._initQuality();
    this._initArtView();
    this._autoHideLoop();
  }

  // ---------- overlays ----------
  showWelcome(show) { this.el.welcome.hidden = !show; }
  setHasSource(v) { this.hasSource = v; document.body.classList.toggle('no-source', !v); if (v) this.showWelcome(false); }
  openDrawer(tab = this.activeTab) { this.el.drawer.hidden = false; this.setTab(tab); }
  closeDrawer() { this.el.drawer.hidden = true; }
  toggleDrawer(tab) { if (!this.el.drawer.hidden && this.activeTab === tab) this.closeDrawer(); else this.openDrawer(tab); }
  get drawerOpen() { return !this.el.drawer.hidden || this.artOpen; }

  _initTabs() {
    this.el.tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) this.setTab(b.dataset.tab); });
    window.addEventListener('resize', () => this._moveInk());
  }
  setTab(tab) {
    this.activeTab = tab;
    this.el.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    this.el.drawer.querySelectorAll('.panel').forEach(p => (p.hidden = p.dataset.panel !== tab));
    requestAnimationFrame(() => this._moveInk());
  }
  _moveInk() {
    const b = this.el.tabs.querySelector('button.on');
    if (!b) return;
    this.el.ink.style.left = `${b.offsetLeft}px`;
    this.el.ink.style.width = `${b.offsetWidth}px`;
  }
  _initQuality() {
    this.el.quality.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      this.setQuality(b.dataset.value);
      this.onQuality?.(b.dataset.value);
    });
  }
  setQuality(v) { this.el.quality.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === v)); }

  _slider(el, label, v, fmtFn, min, max) {
    el.value = v;
    label.textContent = fmtFn(v);
    el.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
  }
  setSensitivity(v) { this._slider(this.el.sens, this.el.sensVal, v, x => Number(x).toFixed(2), 0.4, 2.2); }
  setIntensity(v) { this._slider(this.el.intensity, this.el.intensityVal, v, x => Number(x).toFixed(2), 0.3, 1.8); }
  setTrails(v) { this._slider(this.el.trails, this.el.trailsVal, v, x => `${Math.round(x * 100)}%`, 0, 1.3); }
  setGrain(v) { this._slider(this.el.grain, this.el.grainVal, v, x => `${Math.round(x * 100)}%`, 0, 1.6); }

  // ---------- reproductor ----------
  // La fuente ya se indica en la barra superior, así que el título va limpio.
  setTrack({ title, artist, image, imageLarge = null, album = '' }) {
    this.el.title.textContent = title || 'Sin título';
    this.el.artist.textContent = artist || '';
    this.track = { title, artist, album };
    this.setArt(image, imageLarge);
  }
  setArt(url, largeUrl = null) {
    const a = this.el.art;
    this.artLarge = largeUrl || url || null;
    document.body.classList.toggle('no-art', !url);
    if (!url && this.artOpen) this.closeArt();
    if (url) {
      if (a.dataset.url === url) return;
      a.dataset.url = url;
      a.innerHTML = `<img alt="" src="${url}" crossorigin="anonymous">`;
    } else {
      delete a.dataset.url;
      a.innerHTML = '<div class="art-fallback"><svg><use href="#i-wave"/></svg></div>';
    }
  }

  // ---------- portada ampliada ----------
  _initArtView() {
    this.el.artWrap.addEventListener('click', () => this.toggleArt());
    this.el.artWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleArt(); }
    });
    this.el.avClose.addEventListener('click', () => this.closeArt());
    this.el.avBackdrop.addEventListener('click', () => this.closeArt());
    // inclinación suave siguiendo el cursor: la portada se siente como un objeto físico
    this.el.artView.addEventListener('pointermove', (e) => {
      const r = this.el.avMedia.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      this.el.avImg.style.setProperty('--ry', (Math.max(-1, Math.min(1, nx)) * 7).toFixed(2));
      this.el.avImg.style.setProperty('--rx', (Math.max(-1, Math.min(1, -ny)) * 7).toFixed(2));
    });
    this.el.artView.addEventListener('pointerleave', () => {
      this.el.avImg.style.setProperty('--rx', 0);
      this.el.avImg.style.setProperty('--ry', 0);
    });
  }

  toggleArt() { this.artOpen ? this.closeArt() : this.openArt(); }

  // Transición de elemento compartido: se mide el rectángulo de la miniatura y la imagen
  // grande arranca exactamente ahí, así que parece la misma portada acercándose.
  openArt() {
    if (this.artOpen || !this.artLarge) return;
    const { artView, avMedia, avImg } = this.el;
    avImg.src = this.artLarge;
    avImg.crossOrigin = 'anonymous';
    this.el.avTitle.textContent = this.track.title || '';
    this.el.avArtist.textContent = this.track.artist || '';
    this.el.avAlbum.textContent = this.track.album || '';
    this.el.avAlbum.hidden = !this.track.album;
    if (this._palette) this.el.avPalette.innerHTML = this._palette;

    artView.hidden = false;
    this.artOpen = true;
    const from = this.el.art.getBoundingClientRect();
    const to = avMedia.getBoundingClientRect();
    const s = from.width / to.width;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    avMedia.style.transition = 'none';
    avMedia.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    avMedia.style.borderRadius = `${15 / s}px`;
    // Un reflow forzado compromete el estado inicial para que la transición lo vea. Con
    // requestAnimationFrame esto no ocurriría en una pestaña de fondo (no se programa
    // ningún frame) y la portada se quedaría a medio abrir.
    void avMedia.offsetWidth;
    avMedia.style.transition = 'transform .55s var(--ease-out), border-radius .55s var(--ease-out)';
    avMedia.style.transform = '';
    avMedia.style.borderRadius = '';
    artView.classList.add('on');
    document.body.classList.add('art-open');
  }

  closeArt() {
    if (!this.artOpen) return;
    const { artView, avMedia } = this.el;
    const from = this.el.art.getBoundingClientRect();
    const to = avMedia.getBoundingClientRect();
    const s = from.width / to.width;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    artView.classList.remove('on');
    document.body.classList.remove('art-open');
    avMedia.style.transition = 'transform .42s var(--ease), border-radius .42s var(--ease)';
    avMedia.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    avMedia.style.borderRadius = `${15 / s}px`;
    this.artOpen = false;
    clearTimeout(this._artTimer);
    this._artTimer = setTimeout(() => {
      artView.hidden = true;
      avMedia.style.transition = 'none';
      avMedia.style.transform = '';
      avMedia.style.borderRadius = '';
    }, 430);
  }
  setProgress(cur, dur, seekable = true) {
    const frac = dur > 0 ? Math.min(1, cur / dur) : 0;
    const pct = `${frac * 100}%`;
    this.el.bar.style.width = pct;
    this.el.beatline.style.width = pct;
    this.el.cur.textContent = fmt(cur);
    this.el.dur.textContent = dur > 0 ? fmt(dur) : '—';
    this.el.progress.style.pointerEvents = seekable ? '' : 'none';
    this.el.progress.style.opacity = seekable ? '' : '.45';
  }
  setPlaying(playing) { this.el.play.classList.toggle('playing', !!playing); }
  setTransport({ canSkip = false, canPlay = true, volume = false } = {}) {
    this.el.prev.disabled = !canSkip; this.el.next.disabled = !canSkip; this.el.play.disabled = !canPlay;
    this.el.volumeWrap.hidden = !volume;
  }

  // ---------- fuente / estado ----------
  setSource(kind) {
    const b = this.el.sourceBadge;
    b.className = 'pill source-badge';
    if (kind === 'spotify' || kind === 'analysis') b.classList.add('spotify');
    else if (kind === 'ambient') b.classList.add('ambient');
    else if (kind !== 'none') b.classList.add('live');
    this.el.sourceLabel.textContent = SOURCE_LABELS[kind] || kind;
  }
  setCaptureCta(show) { this.el.captureCta.hidden = !show; }

  // ---------- vibra ----------
  setVibe(vibe, { announce = true } = {}) {
    const active = Object.keys(vibe.layers).filter(k => vibe.layers[k]);
    const scheme = SCHEME_NAMES[vibe.palette.scheme] || vibe.palette.scheme;
    const cam = CAMERA_NAMES[vibe.camera.mode] || vibe.camera.mode;
    this.el.vibeName.textContent = vibe.name;
    this.el.pVibeName.textContent = vibe.name;
    const bits = [
      `paleta ${scheme.toLowerCase()}`,
      `cámara en ${cam}`,
      vibe.post.mirror > 1 ? `simetría ×${vibe.post.mirror}` : 'sin simetría',
      vibe.variant ? `semilla #${vibe.variant + 1}` : 'semilla original',
    ];
    this.el.pVibeMeta.textContent = bits.join(' · ');
    this.el.stScheme.textContent = scheme;
    this.el.layerCount.textContent = `${active.length} de ${Object.keys(LAYER_INFO).length} activas`;
    this.renderPalette(vibe.palette);
    this.renderLayers(vibe);
    if (announce && this.vibeCards && this.hasSource) {
      this.showVibeCard(vibe.name, active.map(k => LAYER_INFO[k]?.name).filter(Boolean).join(' · '), vibe.palette);
    }
  }
  renderPalette(palette) {
    this.el.pPalette.innerHTML = palette.colors.concat([palette.bg]).map(c => {
      const hex = '#' + c.getHexString();
      return `<i style="background:${hex};color:${hex}" data-hex="${hex}"></i>`;
    }).join('');
    this._palette = palette.colors.map(c => `<i style="background:#${c.getHexString()}"></i>`).join('');
    if (this.artOpen) this.el.avPalette.innerHTML = this._palette;
  }
  renderLayers(vibe) {
    this.el.layerList.innerHTML = Object.keys(LAYER_INFO).map(k => {
      const info = LAYER_INFO[k];
      const on = !!vibe.layers[k];
      return `<label class="layer-row${on ? '' : ' off'}" data-layer="${k}">
        <span class="ico"><svg><use href="#${info.icon}"/></svg></span>
        <div><b>${info.name}</b><small>${info.desc}</small></div>
        <input type="checkbox" class="switch" ${on ? 'checked' : ''}>
      </label>`;
    }).join('');
    this.el.layerList.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        const row = inp.closest('.layer-row');
        row.classList.toggle('off', !inp.checked);
        this.onLayerToggle?.(row.dataset.layer, inp.checked);
        const n = this.el.layerList.querySelectorAll('input:checked').length;
        this.el.layerCount.textContent = `${n} de ${Object.keys(LAYER_INFO).length} activas`;
      });
    });
  }
  showVibeCard(name, meta, palette) {
    const c = this.el.vibeCard;
    this.el.vcName.textContent = name;
    this.el.vcMeta.textContent = meta || '';
    if (palette) {
      this.el.vcSwatches.innerHTML = palette.colors
        .map(col => `<i style="background:#${col.getHexString()}"></i>`).join('');
    }
    c.classList.remove('show');
    void c.offsetWidth; // reinicia la animación
    c.classList.add('show');
  }

  // ---------- reactividad por frame ----------
  update(f, dt = 0.016) {
    const root = document.documentElement.style;
    if (f.beat) this.beat = 1;
    this.beat *= Math.exp(-dt * 4);
    root.setProperty('--pulse', f.kick.toFixed(3));
    root.setProperty('--energy', f.energy.toFixed(3));
    root.setProperty('--bass', f.bass.toFixed(3));
    root.setProperty('--treble', f.treble.toFixed(3));
    root.setProperty('--beat', this.beat.toFixed(3));

    const uiVisible = !document.body.classList.contains('ui-hidden') && !document.body.classList.contains('no-source');
    if (uiVisible) {
      this._drawSpectrum(f);
      this._drawPlayerViz(f);
    }
    if ((this.statTick++ & 3) === 0) {
      if (this.drawerOpen && this.activeTab === 'visual') {
        const s = f.sync;
        $('sync-mode').textContent = !s ? (f.active ? 'Análisis de pista' : 'Ambiental') : s.mode === 'sample-clock' ? 'Reloj de audio · 8 ms' : 'Análisis espectral';
        $('sync-character').textContent = s?.character || (f.active ? 'Datos de Spotify' : 'Sin audio analizable');
        for (const key of ['kick', 'snare', 'hat', 'melody', 'sustain', 'pluck']) {
          $('sync-' + key).value = s?.audible ? clamp01(s.context[key] ?? f[key] ?? 0) : 0;
        }
      }
      const bpm = f.bpm && f.tempoConfidence > 0.2 ? f.bpm : null;
      this.el.bpm.innerHTML = `${bpm ?? '—'} <small>BPM</small>`;
      if (this.drawerOpen && this.activeTab === 'vibe') {
        this.el.stEnergy.style.width = `${f.energy * 100}%`;
        this.el.stBass.style.width = `${f.bass * 100}%`;
        this.el.stMid.style.width = `${f.mid * 100}%`;
        this.el.stTreble.style.width = `${f.treble * 100}%`;
        this.el.stCentroid.style.width = `${f.centroid * 100}%`;
        this.el.stFlat.style.width = `${clamp01(f.flatness * 1.6) * 100}%`;
        this.el.stPan.style.left = `${(f.pan * 0.5 + 0.5) * 100}%`;
        this.el.stBpm.textContent = bpm ? `${bpm} BPM` : '—';
        this.el.stConf.textContent = f.bpm ? `${Math.round(f.tempoConfidence * 100)}%` : '—';
        this.el.stMood.textContent = moodLabel(f.mood);
        this.el.stTonic.textContent = f.active && f.tonicStrength > 0.15 ? `tónica ${NOTES[f.tonic]}` : '—';
        this._drawChroma(f);
      }
    }
  }

  _fit(canvas, ctx) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { w, h };
  }

  // Espectro compacto del reproductor: barras con tope de pico que cae despacio.
  _drawSpectrum(f) {
    const g = this._ctxSpectrum;
    const { w: W, h: H } = this._fit(this.el.spectrum, g);
    const key = cssVar('--c0') + cssVar('--c1');
    if (this._gradKey !== key) {
      this._gradKey = key;
      this._grad = g.createLinearGradient(0, H, 0, 0);
      this._grad.addColorStop(0, cssVar('--c1'));
      this._grad.addColorStop(1, cssVar('--c0'));
    }
    const n = 30, gap = 1.6, bw = (W - gap * (n - 1)) / n;
    const bands = f.bands, peaks = f.bandsPeak;
    g.fillStyle = this._grad;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor((i / n) * bands.length);
      const v = bands[idx] || 0;
      const h = Math.max(2, v * (H - 4));
      const x = i * (bw + gap), y = H - h;
      g.beginPath(); g.roundRect(x, y, bw, h, 2); g.fill();
      // tope de pico
      const pv = peaks ? peaks[idx] || 0 : 0;
      if (pv > v + 0.02) {
        const py = H - Math.max(3, pv * (H - 4));
        g.globalAlpha = 0.75;
        g.fillRect(x, py, bw, 1.6);
        g.globalAlpha = 1;
      }
    }
  }

  // Onda ancha dentro de la tarjeta del reproductor: llena todo su ancho.
  _drawPlayerViz(f) {
    const g = this._ctxViz;
    const { w: W, h: H } = this._fit(this.el.playerViz, g);
    if (!W || !H) return;
    const bands = f.bands, n = bands.length;
    const mid = H;
    const c0 = cssVar('--c0'), c1 = cssVar('--c1'), c3 = cssVar('--c3');
    if (this._vizKey !== c0 + c1 + c3 + W) {
      this._vizKey = c0 + c1 + c3 + W;
      this._vizGrad = g.createLinearGradient(0, 0, W, 0);
      this._vizGrad.addColorStop(0, c3);
      this._vizGrad.addColorStop(0.5, c0);
      this._vizGrad.addColorStop(1, c1);
    }
    // silueta espejada: grave en el centro, agudos hacia los lados
    g.beginPath();
    g.moveTo(0, mid);
    const pts = 64;
    for (let i = 0; i <= pts; i++) {
      const t = i / pts;
      const d = Math.abs(t - 0.5) * 2;              // 0 en el centro, 1 en los bordes
      const idx = Math.min(n - 1, Math.floor(d * n * 0.92));
      const v = bands[idx] || 0;
      const y = mid - (v * H * 0.82 + 2) * (0.35 + 0.65 * Math.sin(t * Math.PI));
      g.lineTo(t * W, y);
    }
    g.lineTo(W, mid);
    g.closePath();
    g.fillStyle = this._vizGrad;
    g.globalAlpha = 0.5;
    g.fill();
    g.globalAlpha = 0.9;
    g.strokeStyle = this._vizGrad;
    g.lineWidth = 1.4;
    g.stroke();
    g.globalAlpha = 1;
  }

  // Cromagrama: qué notas suenan ahora mismo.
  _drawChroma(f) {
    const g = this._ctxChroma;
    const { w: W, h: H } = this._fit(this.el.chroma, g);
    if (!W) return;
    const chroma = f.chroma;
    const n = 12, gap = 4, bw = (W - gap * (n - 1) - 8) / n;
    const c0 = cssVar('--c0'), c1 = cssVar('--c1');
    g.font = '600 8.5px ' + 'JetBrains Mono, monospace';
    g.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const v = chroma[i] || 0;
      const x = 4 + i * (bw + gap);
      const h = Math.max(2, v * (H - 18));
      const y = H - 14 - h;
      const grd = g.createLinearGradient(0, H - 14, 0, y);
      grd.addColorStop(0, c1); grd.addColorStop(1, c0);
      g.fillStyle = grd;
      g.globalAlpha = 0.35 + v * 0.65;
      g.beginPath(); g.roundRect(x, y, bw, h, 3); g.fill();
      g.globalAlpha = i === f.tonic && f.tonicStrength > 0.15 ? 0.95 : 0.35;
      g.fillStyle = cssVar('--fg');
      g.fillText(NOTES[i], x + bw / 2, H - 4);
    }
    g.globalAlpha = 1;
  }

  // ---------- Spotify ----------
  setSpotify({ connected, user, deviceReady }) {
    this.el.spotifyCard.classList.toggle('ok', !!connected);
    this.el.spotifyStatus.textContent = connected ? `Conectado${user ? ` · ${user}` : ''}` : 'No conectado';
    this.el.spotifySub.textContent = connected
      ? 'Reflejando lo que suena en tu cuenta'
      : 'Conecta tu cuenta Premium para reflejar lo que escuchas';
    this.el.logout.hidden = !connected;
    this.el.connect.hidden = !!connected;
    this.el.deviceRow.hidden = !(connected && deviceReady);
  }

  // ---------- ocultado automático ----------
  // Solo se esconde sola en pantalla completa: en ventana, la interfaz se queda donde está
  // (que desapareciera al dejar de mover el ratón resultaba desconcertante).
  _autoHideLoop() {
    const wake = () => {
      document.body.classList.remove('ui-hidden', 'cursor-hidden');
      if (this.manualHidden) document.body.classList.add('ui-hidden');
      clearTimeout(this.hideTimer);
      if (!document.fullscreenElement) return;
      this.hideTimer = setTimeout(() => {
        if (this.autoHide && document.fullscreenElement && this.hasSource
            && !this.drawerOpen && this.el.welcome.hidden && !this.manualHidden) {
          document.body.classList.add('ui-hidden', 'cursor-hidden');
        }
      }, 4200);
    };
    this._wake = wake;
    ['mousemove', 'pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, wake, { passive: true }));
    document.addEventListener('fullscreenchange', wake);
    wake();
  }
  toggleUi() {
    this.manualHidden = !this.manualHidden;
    document.body.classList.toggle('ui-hidden', this.manualHidden);
    if (this.manualHidden) this.closeDrawer();
  }
  showDrop(v) { this.el.dropHint.hidden = !v; }
}

function moodLabel(m) {
  if (!m) return '—';
  if (m.energy > 0.62 && m.bassiness > 0.55) return 'Intenso · grave';
  if (m.energy > 0.62) return 'Enérgico · brillante';
  if (m.energy < 0.3 && m.brightness > 0.5) return 'Íntimo · aéreo';
  if (m.energy < 0.3) return 'Calmo · profundo';
  if (m.brightness > 0.55) return 'Luminoso';
  if (m.roughness > 0.6) return 'Rugoso · texturado';
  return 'Equilibrado';
}
