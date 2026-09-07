// Cliente mínimo de la Web API de Spotify: estado de reproducción y controles.
import { getAccessToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';

async function call(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error('No conectado a Spotify');
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') || 2);
    throw Object.assign(new Error('rate limited'), { retryAfter: wait });
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    throw Object.assign(new Error(msg), { status: res.status });
  }
  // Los endpoints del reproductor (play, pause, next, seek…) responden sin cuerpo, o con
  // uno que no es JSON. Antes eso hacía estallar JSON.parse y el error técnico terminaba
  // en un aviso en pantalla al pulsar reproducir.
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const getPlayback = () => call('/me/player?additional_types=track,episode');
export const play = (deviceId) => call(`/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`, { method: 'PUT' });
export const pause = () => call('/me/player/pause', { method: 'PUT' });
export const next = () => call('/me/player/next', { method: 'POST' });
export const previous = () => call('/me/player/previous', { method: 'POST' });
export const seek = (ms) => call(`/me/player/seek?position_ms=${Math.floor(ms)}`, { method: 'PUT' });
export const transfer = (deviceId, playNow = true) => call('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: playNow } });
export const me = () => call('/me');

// Análisis de audio precalculado por Spotify: tiempos de compás, pulso y "segmentos" con
// sonoridad, 12 clases de altura y 12 coeficientes de timbre. Permite mover los visuales
// sincronizados con la canción sin capturar el sonido.
// Ojo: Spotify retiró estos dos endpoints para las apps creadas después del 27/11/2024;
// en esas devuelve 403 y hay que seguir usando la captura de audio.
export const audioAnalysis = (trackId) => call(`/audio-analysis/${trackId}`);
export const audioFeatures = (trackId) => call(`/audio-features/${trackId}`);

// Sondeo del estado de reproducción con interpolación local del progreso.
export class PlaybackPoller {
  constructor(onState, intervalMs = 1000) {
    this.onState = onState;
    this.interval = intervalMs;
    this.timer = null;
    this.state = null;      // último estado normalizado
    this.stateAt = 0;
    this.backoff = 0;
  }
  start() { if (!this.timer) this.tick(); }
  stop() { clearTimeout(this.timer); this.timer = null; }
  async tick() {
    let delay = this.interval;
    try {
      const raw = await getPlayback();
      this.state = normalize(raw);
      this.stateAt = performance.now();
      this.backoff = 0;
      this.onState(this.state);
    } catch (e) {
      if (e.retryAfter) delay = e.retryAfter * 1000;
      else { this.backoff = Math.min(5, this.backoff + 1); delay = this.interval * (1 + this.backoff); }
      if (e.status === 401 || /caducó/.test(e.message)) { this.onState({ error: e.message }); this.stop(); return; }
    }
    this.timer = setTimeout(() => this.tick(), delay);
  }
  // progreso estimado ahora mismo (ms)
  progress() {
    if (!this.state?.item) return 0;
    if (!this.state.isPlaying) return this.state.progressMs;
    return Math.min(this.state.durationMs, this.state.progressMs + (performance.now() - this.stateAt));
  }
}

export function normalize(raw) {
  if (!raw || !raw.item) return { item: null, isPlaying: false, progressMs: 0, durationMs: 0, device: raw?.device || null };
  const it = raw.item;
  const images = it.album?.images || it.images || it.show?.images || [];
  return {
    item: {
      id: it.id, uri: it.uri, name: it.name,
      artists: (it.artists || [{ name: it.show?.publisher || '' }]).map(a => a.name).join(', '),
      album: it.album?.name || it.show?.name || '',
      image: images[0]?.url || null,
      imageSmall: images[images.length - 1]?.url || images[0]?.url || null,
    },
    isPlaying: !!raw.is_playing,
    progressMs: raw.progress_ms || 0,
    durationMs: it.duration_ms || 0,
    device: raw.device || null,
  };
}
