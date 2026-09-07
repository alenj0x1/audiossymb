// Web Playback SDK: convierte esta pestaña en un dispositivo de Spotify (requiere Premium).
// Cuando la reproducción ocurre aquí, la captura de audio "de esta pestaña" es directa.
import { getAccessToken } from './auth.js';
import { normalize } from './api.js';

let sdkPromise = null;
function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.Spotify) return resolve(window.Spotify);
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => reject(new Error('No se pudo cargar el SDK de Spotify'));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export class WebPlayer {
  constructor({ onReady, onState, onError }) {
    this.deviceId = null;
    this.player = null;
    this.onReady = onReady; this.onState = onState; this.onError = onError;
  }
  async connect() {
    const Spotify = await loadSdk();
    this.player = new Spotify.Player({
      name: 'audiossymb · visualizador',
      getOAuthToken: (cb) => getAccessToken().then(t => t && cb(t)).catch(() => {}),
      volume: 0.9,
    });
    this.player.addListener('ready', ({ device_id }) => { this.deviceId = device_id; this.onReady?.(device_id); });
    this.player.addListener('not_ready', () => { this.deviceId = null; });
    this.player.addListener('player_state_changed', (st) => { if (st) this.onState?.(fromSdkState(st)); });
    for (const ev of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
      this.player.addListener(ev, ({ message }) => this.onError?.(ev, message));
    }
    const ok = await this.player.connect();
    if (!ok) throw new Error('El reproductor web no pudo conectarse');
    return this;
  }
  // el SDK necesita un gesto del usuario para desbloquear el audio
  activate() { return this.player?.activateElement?.(); }
  togglePlay() { return this.player?.togglePlay(); }
  next() { return this.player?.nextTrack(); }
  previous() { return this.player?.previousTrack(); }
  seek(ms) { return this.player?.seek(ms); }
  disconnect() { this.player?.disconnect(); this.player = null; this.deviceId = null; }
}

function fromSdkState(st) {
  const t = st.track_window?.current_track;
  const raw = t ? {
    item: { id: t.id, uri: t.uri, name: t.name, artists: t.artists, album: { name: t.album?.name, images: t.album?.images }, duration_ms: st.duration },
    is_playing: !st.paused, progress_ms: st.position,
    device: { name: 'Esta pestaña', is_active: true },
  } : null;
  const n = normalize(raw);
  n.fromSdk = true;
  return n;
}
