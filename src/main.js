// Punto de entrada: conecta audio, visual, interfaz y Spotify.
import { AudioEngine } from './audio/engine.js';
import { FeatureExtractor } from './audio/features.js';
import { SpotifyTimeline } from './audio/timeline.js';
import { Visualizer } from './visual/renderer.js';
import { generateVibe } from './visual/vibe.js';
import { analyzeArtwork, generatePalette, paletteToJSON, paletteFromJSON } from './visual/palette.js';
import { makeRng } from './visual/seed.js';
import { Hud, toast } from './ui/hud.js';
import * as auth from './spotify/auth.js';
import * as api from './spotify/api.js';
import { PlaybackPoller } from './spotify/api.js';
import { WebPlayer } from './spotify/player.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'sinestesia.settings';
// almacenamiento corrupto o bloqueado no debe impedir que la app arranque
const readJson = (key) => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };

const settings = Object.assign(
  {
    quality: 'medium', sensitivity: 1, intensity: 1, trails: 1, grain: 1,
    symmetry: true, chromaColor: true, albumPalette: true, artworkFx: true, autoHide: true,
    vibeCards: true, vibePerTrack: false, autoReroll: false, volume: 0.9,
    loopbackDeviceId: null,      // entrada "salida del sistema" recordada entre visitas
  },
  readJson(SETTINGS_KEY),
);
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

const hud = new Hud();
const audio = new AudioEngine();
audio.volume = settings.volume;
const state = {
  seedKey: 'audiossymb',
  variant: 0,
  paletteVariant: 0,
  vibe: null,
  mood: null,
  metaSource: 'none',            // de dónde salen título/portada: none | file | live | demo | spotify
  artwork: null,                 // portada analizada (paleta + píxeles) de la canción actual
  spotify: {
    connected: false, poller: null, player: null, deviceId: null, current: null, stateAt: 0,
    lastTrackId: null, user: null,
    timeline: null,              // análisis de Spotify convertido en características
    analysisUnavailable: false,  // la app no tiene acceso al endpoint (403)
    analysisAnnounced: false,
  },
};

// ---------- Vibra guardada ----------
// La última vibra elegida o retocada se conserva entre visitas.
//
// Se guarda la vibra COMPLETA, no su semilla. Reproducirla desde la semilla parecía más
// elegante, pero generateVibe consume el RNG en distinto orden según el ánimo (hay ramas
// del tipo `energy > 0.6 && rng.chance(...)`), así que la misma semilla no devuelve la
// misma vibra si el ánimo cambió: al recargar salía otra escena. Serializar los parámetros
// elimina el problema de raíz.
const VIBE_KEY = 'sinestesia.vibe';

function saveVibe() {
  const v = state.vibe;
  if (!v) return;
  try {
    const { live, ...rest } = v;   // `live` lo recalcula el renderer en cada frame
    localStorage.setItem(VIBE_KEY, JSON.stringify({ ...rest, palette: paletteToJSON(v.palette) }));
  } catch { /* almacenamiento lleno o bloqueado: no es crítico */ }
}

function loadVibe() {
  const j = readJson(VIBE_KEY);
  if (!j?.seedKey || !j.palette) return null;
  const palette = paletteFromJSON(j.palette);
  if (!palette) return null;
  // Se parte de una vibra recién generada para tener la forma actual: si el guardado viene
  // de una versión con menos parámetros, los que falten quedan con un valor válido.
  const base = generateVibe(j.seedKey, null, j.variant || 0);
  const vibe = { ...base };
  for (const k of Object.keys(base)) {
    if (!(k in j) || k === 'palette') continue;
    const a = base[k], b = j[k];
    vibe[k] = (a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object')
      ? { ...a, ...b }
      : b;
  }
  vibe.palette = palette;
  return { vibe, seedKey: j.seedKey, variant: j.variant || 0 };
}

// ---------- Visual ----------
const saved = loadVibe();
state.seedKey = saved?.seedKey ?? `inicio-${Math.random().toString(36).slice(2)}`;
state.variant = saved?.variant ?? 0;
state.vibe = saved?.vibe ?? generateVibe(state.seedKey);
const viz = new Visualizer($('stage'), state.vibe, settings.quality);
viz.setIntensity(settings.intensity);
viz.setVisualOptions({
  trails: settings.trails, grain: settings.grain,
  symmetry: settings.symmetry, chromaColor: settings.chromaColor,
});
hud.autoHide = settings.autoHide;
hud.vibeCards = settings.vibeCards;
hud.setVibe(state.vibe, { announce: false });
hud.onLayerToggle = (name, on) => { viz.setLayerEnabled(name, on); saveVibe(); };
hud.onQuality = (q) => { settings.quality = q; saveSettings(); viz.setQuality(q); };

function newVibe(seedKey, { keepVariant = false, immediate = false, announce = true } = {}) {
  if (!keepVariant) { state.variant = 0; state.paletteVariant = 0; }
  state.seedKey = seedKey;
  state.vibe = generateVibe(seedKey, state.mood, state.variant);
  viz.setVibe(state.vibe, immediate);
  hud.setVibe(state.vibe, { announce });
  saveVibe();
}
function reroll() {
  state.variant++;
  newVibe(state.seedKey, { keepVariant: true });
}

// Cambio de canción o de fuente. Por defecto la escena se conserva: cambiar de tema no
// debería tirar el universo que estabas mirando. Se recuerda la semilla igualmente, así una
// "nueva vibra" posterior sale sembrada por la canción que suena.
function onTrackChange(seedKey) {
  if (settings.vibePerTrack) { newVibe(seedKey); return; }
  state.seedKey = seedKey;
  state.variant = 0;
  state.paletteVariant = 0;
}

// El visualizador arranca con la vibra recuperada, así que la escena ya es la guardada; sólo
// hay que asegurar que la interfaz y la paleta salen sincronizadas con ella.
if (saved) viz.setPalette(saved.vibe.palette, 0.01);
function rerollPalette() {
  state.paletteVariant++;
  const rng = makeRng(`${state.seedKey}::palette::${state.variant}::${state.paletteVariant}`);
  const p = generatePalette(rng, state.mood);
  viz.setPalette(p, 1.8);
  state.vibe.palette = p;
  hud.setVibe(state.vibe, { announce: false });
  saveVibe();
  toast('Nueva paleta', { ms: 1400 });
}

// ---------- Bucle principal ----------
let last = performance.now();
let ambientT = 0;
const AMBIENT_BPM = 96;        // tempo del pulso cuando no hay audio analizable
let srcTick = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let f = audio.update(dt, settings.sensitivity);
  const realAudio = f.active;
  if (!realAudio) {
    // Sin captura, si Spotify nos dio el análisis de la canción los visuales van
    // sincronizados con ella de verdad; si no, queda el pulso ambiental.
    const sp = state.spotify;
    if (state.metaSource === 'spotify' && sp.timeline && sp.current?.isPlaying) {
      f = sp.timeline.sample(spotifyProgressMs() / 1000, dt, settings.sensitivity, true);
    } else {
      f = ambientFeatures(f, dt);
    }
  }
  state.mood = f.mood;
  // cambio de sección: si el usuario lo pide, la escena se reinventa sola
  if (f.sectionChange && settings.autoReroll && hud.hasSource) reroll();
  viz.update(f, dt);
  hud.update(f, dt);
  updateTransportUi();
  if ((srcTick++ & 15) === 0) updateSourceUi(realAudio);
}
// Sin audio analizable (por ejemplo Spotify sin captura) la escena respira sola: se
// sintetiza un juego completo de características (bandas, picos, onda, cromagrama y pulso)
// para que ninguna capa se quede plana esperando datos que no van a llegar.
function ambientFeatures(base, dt) {
  ambientT += dt;
  const sp = state.spotify;
  const playing = state.metaSource === 'spotify' && sp.current?.isPlaying;
  const amp = playing ? 0.55 : 0.25;
  const t = ambientT;
  // El pulso ambiental tiene un tempo concreto y se declara como tal: es el ritmo al que
  // late realmente la escena, así que el BPM de la interfaz deja de estar en blanco.
  const beatPos = t * (AMBIENT_BPM / 60);
  const phase = beatPos % 1;
  const beatIndex = Math.floor(beatPos);
  const pulse = Math.pow(Math.max(0, Math.cos(phase * Math.PI * 2)), 10);
  const f = FeatureExtractor.idle();
  f.energy = amp * (0.5 + 0.5 * Math.sin(t * 0.6)) + pulse * 0.2;
  f.bass = amp * 0.6 + pulse * 0.5;
  f.sub = amp * 0.5 + pulse * 0.4;
  f.lowMid = amp * 0.45 * (0.5 + 0.5 * Math.sin(t * 0.9));
  f.mid = amp * 0.5 * (0.5 + 0.5 * Math.sin(t * 1.3 + 1));
  f.high = amp * 0.4 * (0.5 + 0.5 * Math.sin(t * 2.1 + 2));
  f.treble = amp * 0.35 * (0.5 + 0.5 * Math.sin(t * 2.7));
  f.kick = pulse * amp;
  f.snare = Math.pow(Math.max(0, Math.cos((phase - 0.5) * Math.PI * 2)), 14) * amp * 0.7;
  f.beat = playing && beatIndex !== state._ambientBeat;
  state._ambientBeat = beatIndex;
  f.onset = f.beat;
  f.beatPhase = phase;
  f.beatIndex = beatIndex;
  f.barPhase = ((beatIndex % 4) + phase) / 4;
  f.bpm = AMBIENT_BPM;
  f.tempoConfidence = 0.45;
  // espectro: cada banda oscila a su propio ritmo, con más peso en los graves
  const n = f.bands.length;
  for (let i = 0; i < n; i++) {
    const tilt = 1 - (i / n) * 0.55;
    const v = amp * tilt * (0.35 + 0.4 * Math.sin(t * (0.6 + i * 0.11) + i * 0.7)
              + 0.25 * Math.sin(t * (1.7 + i * 0.05) + i));
    f.bands[i] = Math.max(0, v);
    f.bandsPeak[i] = Math.max(0, v * 1.15 + pulse * 0.25 * tilt);
    f.bandsSlow[i] = Math.max(0, v * 0.85);
  }
  // onda: dos senoides desafinadas con envolvente de pulso (las cintas necesitan forma)
  for (let i = 0; i < f.wave.length; i++) {
    const x = i / f.wave.length;
    f.wave[i] = (Math.sin(x * 7 + t * 2.6) * 0.6 + Math.sin(x * 13 - t * 1.7) * 0.3
                 + Math.sin(x * 23 + t * 4.1) * 0.1) * amp * (0.4 + pulse * 0.5);
  }
  f.waveRaw = f.wave;
  // cromagrama: un acorde lento que va rotando
  const root = Math.floor(t * 0.12) % 12;
  for (let i = 0; i < 12; i++) {
    const inChord = i === root || i === (root + 4) % 12 || i === (root + 7) % 12;
    f.chroma[i] = inChord ? 0.6 + 0.4 * Math.sin(t * 0.8 + i) : 0.12;
  }
  f.tonic = root;
  f.tonicStrength = 0.5;
  f.centroid = 0.35 + 0.15 * Math.sin(t * 0.3);
  f.pan = Math.sin(t * 0.23) * 0.5;
  f.mood = base.mood;
  return f;
}
requestAnimationFrame(loop);

// ---------- Transporte / interfaz ----------
// Progreso estimado ahora mismo: el sondeo llega cada segundo, así que se interpola.
function spotifyProgressMs() {
  const sp = state.spotify, cur = sp.current;
  if (!cur?.item) return 0;
  return cur.isPlaying
    ? Math.min(cur.durationMs, cur.progressMs + (performance.now() - sp.stateAt))
    : cur.progressMs;
}
function updateTransportUi() {
  if (state.metaSource === 'spotify') {
    const sp = state.spotify;
    const cur = sp.current;
    if (!cur?.item) return;
    hud.setProgress(spotifyProgressMs() / 1000, cur.durationMs / 1000, true);
    hud.setPlaying(cur.isPlaying);
  } else if (audio.kind === 'file') {
    hud.setProgress(audio.currentTime, audio.duration, true);
    hud.setPlaying(audio.isPlaying);
  } else {
    hud.setPlaying(audio.isPlaying);
  }
}
function updateSourceUi(realAudio) {
  const spotifyMeta = state.metaSource === 'spotify';
  const capturing = audio.kind === 'capture' || audio.kind === 'mic' || audio.kind === 'loopback';
  const synced = !!state.spotify.timeline;
  let kind;
  if (spotifyMeta) kind = capturing ? 'spotify' : (synced ? 'analysis' : 'ambient');
  else if (audio.kind === 'loopback') kind = 'loopback';
  else kind = audio.kind === 'none' ? 'none' : audio.kind;
  hud.setSource(kind);
  // Con el análisis sincronizado ya no hace falta capturar nada: el aviso desaparece.
  hud.setCaptureCta(spotifyMeta && !capturing && !synced);
  void realAudio;
}

// ---------- Fuentes ----------
async function useFile(file) {
  if (!file) return;
  try {
    await audio.loadFile(file);
  } catch (e) {
    toast(`No se pudo reproducir el archivo: ${e.message}`, { error: true });
    return;
  }
  state.metaSource = 'file';
  const base = file.name.replace(/\.[^.]+$/, '');
  const m = base.match(/^\s*(.+?)\s+[-–—]\s+(.+)$/);
  hud.setTrack({ title: m ? m[2] : base, artist: m ? m[1] : 'Archivo local', image: null });
  hud.setTransport({ canSkip: false, volume: true });
  hud.setHasSource(true);
  hud.closeDrawer();
  hud.setProgress(0, 0);
  onTrackChange(`${file.name}:${file.size}`);
}

async function useMic() {
  try { await audio.useMicrophone(); } catch (e) { toast(`Micrófono no disponible: ${e.message}`, { error: true }); return; }
  afterLiveSource('Micrófono', 'Escuchando el entorno');
}
// Intenta enchufar la salida del sistema como entrada de audio. Con el permiso ya
// concedido no aparece ningún diálogo, así que sirve para reengancharse solo al recargar.
async function tryLoopback({ askPermission = false, announce = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  const saved = settings.loopbackDeviceId;
  if (saved) {
    try {
      const label = await audio.useAudioInput(saved);
      afterLiveSource('Salida del sistema', label || 'Escuchando lo que suena en tu equipo', { announce });
      return true;
    } catch { settings.loopbackDeviceId = null; saveSettings(); }
  }
  let dev = null;
  try { dev = await audio.findLoopbackDevice({ askPermission }); }
  catch { return false; }
  if (!dev) return false;
  try {
    const label = await audio.useAudioInput(dev.deviceId);
    settings.loopbackDeviceId = dev.deviceId;
    saveSettings();
    afterLiveSource('Salida del sistema', label || dev.label, { announce });
    return true;
  } catch (e) {
    toast(`No se pudo abrir "${dev.label}": ${e.message}`, { error: true });
    return false;
  }
}

// "Audio del sistema": si existe una entrada de mezcla se usa esa (sin diálogo y se
// recuerda); si no, se recurre a compartir pantalla con audio.
async function useSystemAudio() {
  if (await tryLoopback({ askPermission: true, announce: true })) return;
  const preferTab = !!state.spotify.deviceId && state.spotify.current?.device?.name === 'Esta pestaña';
  try { await audio.useDisplayCapture({ preferCurrentTab: preferTab }); }
  catch (e) { if (e.name !== 'NotAllowedError') toast(e.message, { error: true }); return; }
  afterLiveSource('Audio del sistema', 'Capturando lo que suena en tu equipo');
}
async function useCapture() {
  const preferTab = !!state.spotify.deviceId && state.spotify.current?.device?.name === 'Esta pestaña';
  try { await audio.useDisplayCapture({ preferCurrentTab: preferTab }); }
  catch (e) { if (e.name !== 'NotAllowedError') toast(e.message, { error: true }); return; }
  afterLiveSource('Audio del sistema', 'Capturando lo que suena en tu equipo');
}
function afterLiveSource(title, subtitle, { announce = true } = {}) {
  audio.onEnded = (why) => { if (why === 'stream') toast('La captura de audio terminó.'); };
  hud.setHasSource(true);
  hud.closeDrawer();
  if (state.metaSource === 'spotify') {
    if (announce) toast('Spotify + sonido real: los visuales ahora siguen la música de verdad.', { ms: 3200 });
    return; // conservamos título, portada y vibra de Spotify
  }
  state.metaSource = 'live';
  hud.setTrack({ title, artist: subtitle, image: null });
  hud.setTransport({ canSkip: false, canPlay: false, volume: false });
  hud.setProgress(0, 0, false);
  onTrackChange(`live-${Date.now()}`);
}
function useDemo() {
  const seed = Date.now();
  audio.startDemo(seed);
  state.metaSource = 'demo';
  hud.setTrack({ title: 'Pista generada', artist: `audiossymb · ${audio.demo.bpm} BPM`, image: null });
  hud.setTransport({ canSkip: false, volume: true });
  hud.setProgress(0, 0, false);
  hud.setHasSource(true);
  hud.closeDrawer();
  onTrackChange(`demo-${seed}`);
}

// ---------- Spotify ----------
async function connectSpotify() {
  if (!auth.getClientId()) {
    hud.openDrawer('spotify');
    toast('Primero pega tu Client ID de Spotify.', { ms: 4500 });
    $('client-id').focus();
    return;
  }
  try { await auth.login(); } catch (e) { toast(e.message, { error: true }); }
}

async function startSpotifyMode() {
  const sp = state.spotify;
  sp.connected = true;
  state.metaSource = 'spotify';
  hud.setHasSource(true);
  hud.setTransport({ canSkip: true, volume: false });
  hud.setTrack({ title: 'Conectando con Spotify…', artist: '', image: null });
  try { sp.user = (await api.me()).display_name; } catch {}
  hud.setSpotify({ connected: true, user: sp.user, deviceReady: !!sp.deviceId });

  sp.poller?.stop();
  sp.poller = new PlaybackPoller(applySpotifyState, 1000);
  sp.poller.start();

  if (!sp.player) {
    sp.player = new WebPlayer({
      onReady: (id) => { sp.deviceId = id; hud.setSpotify({ connected: true, user: sp.user, deviceReady: true }); },
      onState: (st) => applySpotifyState(st),
      onError: (ev, msg) => {
        if (ev === 'account_error') toast('El reproductor web necesita Spotify Premium. Puedes seguir usando la app de escritorio + captura de audio.', { error: true, ms: 6000 });
        else if (ev !== 'playback_error') console.warn('Spotify SDK:', ev, msg);
      },
    });
    sp.player.connect().catch(e => console.warn(e));
  }
}

function applySpotifyState(st) {
  const sp = state.spotify;
  if (st?.error) { toast(st.error, { error: true }); disconnectSpotify(); return; }
  if (!st.fromSdk && sp.current?.fromSdk && performance.now() - sp.stateAt < 1500) return;
  sp.current = st;
  sp.stateAt = performance.now();
  if (state.metaSource !== 'spotify') return;
  if (!st.item) {
    hud.setTrack({ title: 'Nada sonando en Spotify', artist: 'Reproduce algo en cualquier dispositivo', image: null });
    sp.lastTrackId = null;
    return;
  }
  if (st.item.id !== sp.lastTrackId) {
    sp.lastTrackId = st.item.id;
    hud.setTrack({
      title: st.item.name, artist: st.item.artists, album: st.item.album,
      image: st.item.imageSmall, imageLarge: st.item.image,
    });
    onTrackChange(`spotify:${st.item.id}`);
    loadAnalysis(st.item.id);
    loadArtwork(st.item.id, st.item.image);
  }
}

// La portada se analiza una sola vez y sirve para dos cosas: la paleta de la escena y,
// si los efectos están activos, como textura del fondo, color de las partículas y mundo
// reflejado por la escultura.
async function loadArtwork(trackId, url) {
  if (!url) { viz.setArtwork(null); return; }
  let art;
  try {
    art = await analyzeArtwork(url);
  } catch {
    viz.setArtwork(null);   // sin CORS o portada monocroma: se queda la paleta generada
    return;
  }
  if (state.spotify.lastTrackId !== trackId) return;
  if (settings.albumPalette) {
    viz.setPalette(art.palette, 3);
    state.vibe.palette = art.palette;
    hud.setVibe(state.vibe, { announce: false });
    saveVibe();
    document.documentElement.style.setProperty('--art-color', '#' + art.palette.colors[0].getHexString());
  }
  state.artwork = art;
  viz.setArtwork(settings.artworkFx ? art : null);
}

// Descarga el análisis precalculado de la canción: beats, compases, secciones y segmentos
// con sonoridad, alturas y timbre. Es lo que permite prescindir de la captura de audio.
async function loadAnalysis(trackId) {
  const sp = state.spotify;
  sp.timeline = null;
  if (sp.analysisUnavailable) return;
  try {
    const a = await api.audioAnalysis(trackId);
    if (sp.lastTrackId !== trackId) return;           // ya cambió de canción
    if (!a?.segments?.length) throw new Error('análisis vacío');
    sp.timeline = new SpotifyTimeline(a);
    if (!sp.analysisAnnounced) {
      sp.analysisAnnounced = true;
      toast('Análisis de Spotify activo: los visuales van sincronizados con la canción sin capturar audio.', { ms: 5600 });
    }
  } catch (e) {
    if (e.status === 403 || e.status === 404) {
      // Endpoint retirado para las apps creadas después de noviembre de 2024. Se deja de
      // pedir y se sigue en silencio: la explicación vive en Ajustes → Spotify, y un aviso
      // en cada carga sólo estorba.
      sp.analysisUnavailable = true;
    } else if (e.status !== 401) {
      console.warn('audio-analysis:', e);
    }
  }
}

function disconnectSpotify() {
  const sp = state.spotify;
  sp.poller?.stop(); sp.poller = null;
  sp.player?.disconnect(); sp.player = null;
  sp.connected = false; sp.deviceId = null; sp.current = null; sp.lastTrackId = null; sp.timeline = null;
  state.artwork = null; viz.setArtwork(null);
  auth.logout();
  hud.setSpotify({ connected: false });
  if (state.metaSource === 'spotify') {
    state.metaSource = audio.kind === 'none' ? 'none' : 'live';
    if (state.metaSource === 'none') { hud.setHasSource(false); hud.showWelcome(true); }
    else hud.setTrack({ title: 'Audio en vivo', artist: '', image: null });
  }
}

async function spotifyControl(action) {
  const sp = state.spotify;
  try {
    const viaSdk = sp.player?.deviceId && sp.current?.device?.name === 'Esta pestaña';
    if (action === 'toggle') {
      if (viaSdk) await sp.player.togglePlay();
      else if (sp.current?.isPlaying) await api.pause();
      else await api.play();
    } else if (action === 'next') viaSdk ? await sp.player.next() : await api.next();
    else if (action === 'prev') viaSdk ? await sp.player.previous() : await api.previous();
    setTimeout(() => sp.poller?.tick?.(), 350);
  } catch (e) {
    let msg;
    if (e.status === 404) msg = 'No hay un dispositivo activo en Spotify. Reproduce algo o transfiere la reproducción aquí.';
    else if (e.status === 403) msg = 'Spotify no permitió el control remoto: hace falta una cuenta Premium activa.';
    // nunca se muestran errores de parseo u otros mensajes técnicos
    else msg = e.message && !/JSON|fetch|network/i.test(e.message) ? e.message : 'No se pudo controlar la reproducción de Spotify.';
    toast(msg, { error: true });
  }
}

// ---------- Eventos de interfaz ----------
$('btn-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', (e) => useFile(e.target.files[0]));
$('btn-spotify').addEventListener('click', () => (state.spotify.connected ? (hud.showWelcome(false), hud.openDrawer('spotify')) : connectSpotify()));
$('btn-spotify-connect').addEventListener('click', connectSpotify);
$('btn-capture').addEventListener('click', useSystemAudio);
$('btn-capture-2').addEventListener('click', useCapture);   // compartir pantalla explícito
$('btn-capture-cta').addEventListener('click', useSystemAudio);
$('btn-loopback').addEventListener('click', async () => {
  const ok = await tryLoopback({ askPermission: true, announce: true });
  $('loopback-state').textContent = ok
    ? 'Conectado. En las próximas visitas se enganchará solo, sin diálogos.'
    : 'No se encontró ninguna entrada de mezcla. En Windows: Panel de sonido → Grabación → clic derecho → Mostrar dispositivos deshabilitados → habilitar "Mezcla estéreo".';
});
$('btn-mic').addEventListener('click', useMic);
$('btn-demo').addEventListener('click', useDemo);
$('btn-welcome-settings').addEventListener('click', () => hud.openDrawer(auth.isConnected() ? 'visual' : 'spotify'));

$('btn-play').addEventListener('click', () => {
  audio.ensureContext();
  if (state.metaSource === 'spotify') spotifyControl('toggle');
  else audio.togglePlay();
});
$('btn-next').addEventListener('click', () => spotifyControl('next'));
$('btn-prev').addEventListener('click', () => spotifyControl('prev'));
$('progress').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const frac = (e.clientX - r.left) / r.width;
  if (state.metaSource === 'spotify' && state.spotify.current?.durationMs) {
    const ms = frac * state.spotify.current.durationMs;
    const sp = state.spotify;
    (sp.player?.deviceId && sp.current?.device?.name === 'Esta pestaña' ? sp.player.seek(ms) : api.seek(ms)).catch(() => {});
    sp.current.progressMs = ms; sp.stateAt = performance.now();
  } else audio.seek(frac);
});
$('volume').value = settings.volume;
$('volume').addEventListener('input', (e) => { settings.volume = Number(e.target.value); audio.setVolume(settings.volume); saveSettings(); });
$('btn-reroll').addEventListener('click', reroll);
$('btn-reroll-2').addEventListener('click', reroll);
$('btn-new-palette').addEventListener('click', rerollPalette);
$('btn-vibe').addEventListener('click', () => hud.toggleDrawer('vibe'));
$('btn-source').addEventListener('click', () => hud.showWelcome(true));
$('btn-settings').addEventListener('click', () => hud.toggleDrawer(auth.isConnected() ? 'visual' : 'spotify'));
$('btn-drawer-close').addEventListener('click', () => hud.closeDrawer());
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
$('welcome').addEventListener('click', (e) => { if (e.target === e.currentTarget && hud.hasSource) hud.showWelcome(false); });

// ajustes
$('redirect-uri').textContent = auth.redirectUri();
$('client-id').value = auth.getClientId();
$('btn-copy-redirect').addEventListener('click', () => navigator.clipboard.writeText(auth.redirectUri()).then(() => toast('Redirect URI copiada', { ms: 1600 })));
$('btn-save-client').addEventListener('click', () => { auth.setClientId($('client-id').value); toast('Client ID guardado. Ahora pulsa "Conectar Spotify".'); });
$('btn-spotify-logout').addEventListener('click', () => { disconnectSpotify(); toast('Spotify desconectado'); });
$('btn-transfer').addEventListener('click', async () => {
  const sp = state.spotify;
  if (!sp.deviceId) return;
  try {
    await sp.player.activate?.();
    await api.transfer(sp.deviceId, true);
    toast('Reproduciendo en esta pestaña. Pulsa "Capturar el sonido" y comparte esta pestaña con audio.', { ms: 6000 });
  } catch (e) { toast(e.message, { error: true }); }
});
hud.setQuality(settings.quality);
hud.setSensitivity(settings.sensitivity);
hud.setIntensity(settings.intensity);
hud.setTrails(settings.trails);
hud.setGrain(settings.grain);
$('sensitivity').addEventListener('input', (e) => { settings.sensitivity = Number(e.target.value); hud.setSensitivity(settings.sensitivity); saveSettings(); });
$('intensity').addEventListener('input', (e) => {
  settings.intensity = Number(e.target.value);
  hud.setIntensity(settings.intensity);
  viz.setIntensity(settings.intensity);
  saveSettings();
});
$('trails').addEventListener('input', (e) => {
  settings.trails = Number(e.target.value);
  hud.setTrails(settings.trails);
  viz.setVisualOptions({ trails: settings.trails });
  saveSettings();
});
$('grain').addEventListener('input', (e) => {
  settings.grain = Number(e.target.value);
  hud.setGrain(settings.grain);
  viz.setVisualOptions({ grain: settings.grain });
  saveSettings();
});

// interruptores
const bindSwitch = (id, key, onChange) => {
  const el = $(id);
  el.checked = settings[key];
  el.addEventListener('change', (e) => { settings[key] = e.target.checked; onChange?.(settings[key]); saveSettings(); });
};
bindSwitch('symmetry', 'symmetry', (v) => viz.setVisualOptions({ symmetry: v }));
bindSwitch('chroma-color', 'chromaColor', (v) => viz.setVisualOptions({ chromaColor: v }));
bindSwitch('album-palette', 'albumPalette');
bindSwitch('artwork-fx', 'artworkFx', (v) => viz.setArtwork(v ? state.artwork : null));
bindSwitch('auto-hide', 'autoHide', (v) => { hud.autoHide = v; });
bindSwitch('vibe-cards', 'vibeCards', (v) => { hud.vibeCards = v; });
bindSwitch('vibe-per-track', 'vibePerTrack');
bindSwitch('auto-reroll', 'autoReroll');

// teclado
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  switch (e.key) {
    case ' ': e.preventDefault(); $('btn-play').click(); break;
    case 'r': case 'R': if (hud.hasSource) reroll(); break;
    case 'p': case 'P': if (hud.hasSource) rerollPalette(); break;
    case 'v': case 'V': if (hud.hasSource) hud.toggleDrawer('vibe'); break;
    case 'g': case 'G': hud.toggleDrawer('visual'); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'h': case 'H': hud.toggleUi(); break;
    case 'Escape':
      if (hud.artOpen) { hud.closeArt(); break; }
      hud.closeDrawer();
      if (hud.hasSource) hud.showWelcome(false);
      break;
  }
});
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// arrastrar y soltar
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; hud.showDrop(true); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; hud.showDrop(false); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; hud.showDrop(false);
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|opus|webm)$/i.test(f.name));
  if (file) useFile(file); else toast('Ese archivo no parece de audio.', { error: true });
});

// ---------- Arranque ----------
(async () => {
  try {
    const cameBack = await auth.handleCallback();
    if (cameBack) toast('¡Spotify conectado!');
  } catch (e) { toast(e.message, { error: true, ms: 7000 }); }
  if (auth.isConnected()) startSpotifyMode();
  else hud.setSpotify({ connected: false });
  // Si en una visita anterior se autorizó la entrada de mezcla, se recupera sin molestar.
  if (settings.loopbackDeviceId) tryLoopback({ askPermission: false, announce: false });
})();
