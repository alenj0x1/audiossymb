// Utilidades para que la portada del álbum participe en la escena, no solo en la paleta.
//
// La idea: cada mota toma su color del píxel de la portada que le corresponde por posición,
// así la composición de la carátula aparece repartida en el espacio (si la portada tiene un
// cielo naranja arriba y agua azul abajo, la nube de partículas también).
import * as THREE from 'three';
import { sampleArtwork } from './palette.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Textura mínima de relleno: un sampler sin textura provoca avisos del driver, así que
// las capas que aceptan portada siempre tienen algo enlazado.
export function blankTexture() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

// Textura de la portada reducida. A 48 px y con filtrado lineal, al estirarse queda como
// una malla de degradados suavísima: los colores del álbum sin que se lea la foto.
export function artworkTexture(art) {
  const t = new THREE.CanvasTexture(art.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Color por partícula tomado de la portada según su posición en el volumen.
export function buildArtColors(art, positions, count, radius, stride = 3) {
  const out = new Float32Array(count * 3);
  const rgb = [0, 0, 0];
  const span = radius * 2;
  for (let i = 0; i < count; i++) {
    const p = i * stride, o = i * 3;
    sampleArtwork(art, clamp01(positions[p] / span + 0.5), clamp01(positions[p + 1] / span + 0.5), rgb);
    // Los píxeles de una portada son de reflexión; aquí se usan como emisión, así que se
    // realza la saturación y se limita el brillo para no lavar la escena.
    const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    for (let k = 0; k < 3; k++) out[o + k] = clamp01(l + (rgb[k] - l) * 1.45) * 0.85;
  }
  return out;
}

// Escribe en `out` la mezcla entre el color de paleta de cada elemento y el de la portada.
export function applyColors(out, colorIdx, palette, artColors, artMix) {
  const n = colorIdx.length, nc = palette.colors.length;
  const mix = artColors ? artMix : 0;
  for (let i = 0; i < n; i++) {
    const c = palette.colors[colorIdx[i] % nc];
    const o = i * 3;
    if (mix > 0) {
      out[o] = c.r + (artColors[o] - c.r) * mix;
      out[o + 1] = c.g + (artColors[o + 1] - c.g) * mix;
      out[o + 2] = c.b + (artColors[o + 2] - c.b) * mix;
    } else {
      out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b;
    }
  }
}
