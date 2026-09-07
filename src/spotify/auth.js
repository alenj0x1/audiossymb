// Autenticación con Spotify mediante Authorization Code + PKCE (100 % en el navegador,
// sin secreto de cliente ni servidor propio).
const STORE = 'sinestesia.spotify';
const SCOPES = [
  'user-read-currently-playing', 'user-read-playback-state', 'user-modify-playback-state',
  'streaming', 'user-read-email', 'user-read-private',
];

export const redirectUri = () => `${location.origin}/callback`;

const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } };
const save = (obj) => localStorage.setItem(STORE, JSON.stringify(obj));

export function getClientId() { return load().clientId || ''; }
export function setClientId(id) { save({ ...load(), clientId: id.trim() }); }
export function isConnected() { return !!load().refresh_token; }
export function logout() { const { clientId } = load(); save({ clientId }); }

function randomString(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(arr, b => chars[b % chars.length]).join('');
}
async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Falta el Client ID de Spotify (Ajustes).');
  const verifier = randomString(64);
  sessionStorage.setItem(`${STORE}.verifier`, verifier);
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(),
    scope: SCOPES.join(' '), code_challenge_method: 'S256', code_challenge: await challengeFor(verifier),
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

// Llamar al cargar la página: si venimos de Spotify con ?code=, canjea el código.
export async function handleCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;
  history.replaceState({}, '', '/');
  if (error) throw new Error(`Spotify rechazó el acceso: ${error}`);
  const verifier = sessionStorage.getItem(`${STORE}.verifier`);
  if (!verifier) throw new Error('Sesión de autenticación perdida; vuelve a conectar.');
  const body = new URLSearchParams({
    client_id: getClientId(), grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || 'No se pudo obtener el token');
  storeTokens(json);
  sessionStorage.removeItem(`${STORE}.verifier`);
  return true;
}

function storeTokens(json) {
  const cur = load();
  save({
    ...cur,
    access_token: json.access_token,
    refresh_token: json.refresh_token || cur.refresh_token,
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
  });
}

let refreshing = null;
export async function getAccessToken() {
  const s = load();
  if (!s.refresh_token) return null;
  if (s.access_token && Date.now() < s.expires_at) return s.access_token;
  if (!refreshing) {
    refreshing = (async () => {
      const body = new URLSearchParams({ client_id: s.clientId, grant_type: 'refresh_token', refresh_token: s.refresh_token });
      const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const json = await res.json();
      if (!res.ok) { logout(); throw new Error('La sesión de Spotify caducó; vuelve a conectar.'); }
      storeTokens(json);
      return json.access_token;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}
