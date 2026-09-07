// Paletas: generación aleatoria por esquema armónico, extracción desde una portada y
// utilidades de color. Cada paleta tiene 5 acentos (c0..c4), un fondo (bg) y un fondo
// secundario (bg2) para degradados.
import * as THREE from 'three';

const SCHEMES = [
  'analogous', 'complementary', 'triadic', 'split', 'tetradic', 'neon', 'duotone',
  'sunset', 'ocean', 'ember', 'ice', 'jungle', 'candy', 'mono',
];

export const PALETTE_SIZE = 5;

function hsl(h, s, l) {
  const c = new THREE.Color();
  c.setHSL(((h % 360) + 360) % 360 / 360, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
  return c;
}

// Reparto de luminosidad: un acento muy luminoso, dos medios, uno profundo y uno neutro
// claro. Así la escena tiene jerarquía y no se convierte en una papilla de color.
const LUM_OFFSET = [0.02, -0.05, 0.09, -0.11, -0.03];
const SAT_OFFSET = [0.0, -0.03, -0.1, 0.04, -0.16];

// Los acentos son emisivos y se suman entre capas: si parten de una luminosidad alta,
// dos o tres capas cruzadas ya llegan al blanco. Se mantienen vivos pero contenidos.
const LUM_MIN = 0.34, LUM_MAX = 0.6, SAT_MIN = 0.5;
function accent(h, s, l) { return hsl(h, Math.max(SAT_MIN, s), Math.min(LUM_MAX, Math.max(LUM_MIN, l))); }

export function generatePalette(rng, mood = null) {
  const scheme = rng.pick(SCHEMES);
  const base = rng.range(0, 360);
  // el ánimo de la canción empuja saturación y luminosidad
  const energy = mood?.energy ?? 0.5;
  const bright = mood?.brightness ?? 0.5;
  const sat = 0.66 + rng.range(0, 0.32) * (0.55 + energy * 0.45);
  const lum = 0.47 + (bright - 0.5) * 0.16 + rng.range(-0.04, 0.06);
  let hues;
  switch (scheme) {
    case 'analogous': hues = [base, base + 26, base - 26, base + 52, base - 48]; break;
    case 'complementary': hues = [base, base + 180, base + 18, base + 198, base - 16]; break;
    case 'triadic': hues = [base, base + 120, base + 240, base + 60, base + 180]; break;
    case 'split': hues = [base, base + 150, base + 210, base + 180, base + 20]; break;
    case 'tetradic': hues = [base, base + 90, base + 180, base + 270, base + 45]; break;
    case 'neon': hues = [rng.pick([300, 180, 130, 62]), rng.pick([190, 322, 92]), rng.pick([48, 272, 8]), base, base + 150]; break;
    case 'duotone': hues = [base, base + 178, base + 8, base + 170, base + 190]; break;
    case 'sunset': hues = [rng.range(340, 378), rng.range(18, 46), rng.range(280, 312), rng.range(2, 16), rng.range(46, 62)]; break;
    case 'ocean': hues = [rng.range(182, 214), rng.range(150, 176), rng.range(228, 262), rng.range(196, 208), rng.range(160, 190)]; break;
    case 'ember': hues = [rng.range(6, 24), rng.range(28, 48), rng.range(348, 366), rng.range(16, 34), rng.range(40, 56)]; break;
    case 'ice': hues = [rng.range(186, 208), rng.range(210, 236), rng.range(168, 186), rng.range(240, 262), rng.range(200, 216)]; break;
    case 'jungle': hues = [rng.range(96, 134), rng.range(140, 170), rng.range(62, 88), rng.range(170, 196), rng.range(110, 128)]; break;
    case 'candy': hues = [rng.range(300, 336), rng.range(184, 206), rng.range(52, 68), rng.range(268, 292), rng.range(340, 356)]; break;
    default: { const spread = rng.range(8, 20); hues = [base, base + spread, base - spread, base + spread * 2, base - spread * 2]; }
  }
  const colors = hues.map((h, i) => accent(h, sat + SAT_OFFSET[i], lum + LUM_OFFSET[i]));
  const bgHue = rng.chance(0.62) ? base + rng.range(-30, 30) : base + 180;
  const bgSat = rng.range(0.32, 0.72);
  const bg = hsl(bgHue, bgSat, rng.range(0.018, 0.055));
  const bg2 = hsl(bgHue + rng.range(-70, 70), bgSat * 0.9, rng.range(0.035, 0.085));
  return { scheme, colors, bg, bg2, baseHue: base, source: 'random' };
}

export function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('no se pudo cargar la portada'));
    im.src = url;
  });
}

// Analiza una portada una sola vez y devuelve todo lo que la escena puede necesitar:
// la paleta dominante, y el propio lienzo reducido con sus píxeles, que sirve tanto de
// textura del fondo como de fuente de color por posición para las partículas.
export async function analyzeArtwork(url, size = 48) {
  const image = await loadImage(url);
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size).data; // lanza si la imagen está "tainted"
  return { image, canvas: cv, data, size, palette: paletteFromPixels(data, size) };
}

// Muestrea la portada por coordenada normalizada (0..1). Devuelve [r, g, b] en 0..1.
export function sampleArtwork(art, u, v, out = [0, 0, 0]) {
  const n = art.size;
  const x = Math.min(n - 1, Math.max(0, Math.round(u * (n - 1))));
  const y = Math.min(n - 1, Math.max(0, Math.round((1 - v) * (n - 1))));
  const i = (y * n + x) * 4;
  out[0] = art.data[i] / 255; out[1] = art.data[i + 1] / 255; out[2] = art.data[i + 2] / 255;
  return out;
}

// Extrae hasta 5 colores dominantes y vivos de una imagen (requiere CORS habilitado).
export async function paletteFromImage(url) {
  return (await analyzeArtwork(url)).palette;
}

function paletteFromPixels(data, size) {
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const c = new THREE.Color(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    const h = {}; c.getHSL(h);
    if (h.l < 0.07 || h.l > 0.96) continue;
    const key = `${Math.round(h.h * 14)}-${Math.round(h.s * 3)}-${Math.round(h.l * 4)}`;
    const b = buckets.get(key) || { n: 0, h: 0, s: 0, l: 0 };
    b.n++; b.h += h.h; b.s += h.s; b.l += h.l;
    buckets.set(key, b);
  }
  const list = [...buckets.values()]
    .map(b => ({ n: b.n, h: b.h / b.n, s: b.s / b.n, l: b.l / b.n }))
    .map(b => ({ ...b, score: b.n * (0.35 + b.s) * (1 - Math.abs(b.l - 0.5)) }))
    .sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const c of list) {
    if (chosen.every(o => Math.min(Math.abs(o.h - c.h), 1 - Math.abs(o.h - c.h)) > 0.055 || Math.abs(o.l - c.l) > 0.28)) chosen.push(c);
    if (chosen.length === PALETTE_SIZE) break;
  }
  if (chosen.length < 2) throw new Error('portada sin color suficiente');
  // completamos con variaciones armónicas de los que sí encontramos
  let k = 0;
  while (chosen.length < PALETTE_SIZE) {
    const src = chosen[k % chosen.length];
    chosen.push({ ...src, h: (src.h + (k % 2 ? 0.5 : 0.08) + 1) % 1, l: Math.min(0.8, src.l + 0.08) });
    k++;
  }
  // Portadas pálidas o lavadas darían acentos pastel; se realzan y se acotan igual que
  // los generados, para que la escena no acabe siendo una bruma blanca.
  const colors = chosen.map((c, i) => accent(
    c.h * 360,
    Math.min(1, c.s * 1.45 + 0.22 + SAT_OFFSET[i] * 0.5),
    c.l * 0.85 + LUM_OFFSET[i],
  ));
  const bg = hsl(chosen[0].h * 360, Math.min(0.8, chosen[0].s + 0.2), 0.032);
  const bg2 = hsl(chosen[1].h * 360, Math.min(0.75, chosen[1].s + 0.15), 0.06);
  return { scheme: 'album', colors, bg, bg2, baseHue: chosen[0].h * 360, source: 'album' };
}

// Serialización para guardar la vibra entre visitas: los THREE.Color no sobreviven a JSON.
export function paletteToJSON(p) {
  return {
    scheme: p.scheme, source: p.source, baseHue: p.baseHue,
    colors: p.colors.map(c => '#' + c.getHexString()),
    bg: '#' + p.bg.getHexString(),
    bg2: '#' + (p.bg2 || p.bg).getHexString(),
  };
}

export function paletteFromJSON(j) {
  if (!j?.colors?.length) return null;
  return {
    scheme: j.scheme, source: j.source, baseHue: j.baseHue,
    colors: j.colors.map(h => new THREE.Color(h)),
    bg: new THREE.Color(j.bg),
    bg2: new THREE.Color(j.bg2 || j.bg),
  };
}

export function rotatePalette(p, degrees) {
  if (!degrees) return p;
  const rot = (c) => { const h = {}; c.getHSL(h); return hsl(h.h * 360 + degrees, h.s, h.l); };
  return { ...p, colors: p.colors.map(rot), bg: rot(p.bg), bg2: rot(p.bg2 || p.bg) };
}

export function paletteToCss(p) {
  const root = document.documentElement.style;
  p.colors.forEach((c, i) => root.setProperty(`--c${i}`, '#' + c.getHexString()));
  const bgHex = '#' + p.bg.getHexString();
  root.setProperty('--bg', bgHex);
  root.setProperty('--bg-2', '#' + (p.bg2 || p.bg).getHexString());
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bgHex);
}

// Interpolador de paletas para transiciones suaves
export class PaletteBlender {
  constructor(initial) {
    this.current = clonePalette(initial);
    this.target = clonePalette(initial);
    this.from = clonePalette(initial);
    this.t = 1;
    this.duration = 2.5;
  }
  setTarget(p, duration = 2.5) {
    this.from = clonePalette(this.current);
    this.target = clonePalette(p);
    this.t = 0;
    this.duration = duration;
  }
  update(dt) {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / this.duration);
    const e = this.t < 0.5 ? 2 * this.t * this.t : 1 - Math.pow(-2 * this.t + 2, 2) / 2;
    const n = Math.min(this.current.colors.length, this.target.colors.length);
    for (let i = 0; i < n; i++) this.current.colors[i].copy(this.from.colors[i]).lerp(this.target.colors[i], e);
    this.current.bg.copy(this.from.bg).lerp(this.target.bg, e);
    this.current.bg2.copy(this.from.bg2).lerp(this.target.bg2, e);
    this.current.scheme = this.target.scheme;
    this.current.source = this.target.source;
    return true;
  }
}

export function clonePalette(p) {
  return {
    scheme: p.scheme, source: p.source, baseHue: p.baseHue,
    colors: p.colors.map(c => c.clone()),
    bg: p.bg.clone(),
    bg2: (p.bg2 || p.bg).clone(),
  };
}
