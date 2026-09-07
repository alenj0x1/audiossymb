// Campo de partículas: cada una está ligada a una banda de frecuencia y se expande con ella.
// Los picos de banda (ataque instantáneo) las hacen destellar, los bombos las empujan hacia
// afuera y el remolino las hace orbitar.
import * as THREE from 'three';
import { NUM_BANDS } from '../../audio/features.js';
import { makeRng } from '../seed.js';
import { applyColors, buildArtColors } from '../artwork.js';

const VERT = /* glsl */ `
attribute float aSeed;
attribute float aBand;
attribute float aSize;
attribute vec3 aColor;
uniform float uTime, uKick, uEnergy, uSpread, uSwirl, uPixelRatio, uBaseSize, uGravity, uPan;
uniform float uBands[${NUM_BANDS}];
uniform float uPeaks[${NUM_BANDS}];
varying vec3 vColor;
varying float vAlpha;
varying float vSpark;
void main() {
  int b = int(aBand + 0.5);
  float e = uBands[b];
  float pk = uPeaks[b];
  vec3 p = position;
  float r = length(p);
  vec3 dir = p / max(r, 0.001);

  // órbita propia: el ángulo depende de la semilla, así que nada se mueve en bloque
  float ang = uTime * uSwirl * (0.25 + aSeed * 0.95) + aSeed * 6.2831;
  float c = cos(ang), s = sin(ang);
  p.xz = mat2(c, -s, s, c) * p.xz;
  dir.xz = mat2(c, -s, s, c) * dir.xz;

  // expansión por banda + empuje del bombo + chispazo del pico
  p += dir * (e * uSpread * (0.35 + aSeed) + uKick * 3.2 * aSeed + pk * uSpread * 0.35);
  p.y += sin(uTime * (0.35 + aSeed * 0.7) + aSeed * 20.0) * (0.4 + uEnergy);
  p.y += uGravity * sin(uTime * 0.2 + aSeed * 12.0) * 4.0;
  p.x += uPan * 1.8;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sz = aSize * uBaseSize * (1.0 + e * 1.5 + pk * 1.2 + uKick * 0.5);
  gl_PointSize = clamp(sz * (150.0 / -mv.z) * uPixelRatio, 1.0, 60.0 * uPixelRatio);
  gl_Position = projectionMatrix * mv;

  vColor = aColor * (0.55 + e * 0.7 + pk * 0.5);
  vAlpha = 0.04 + e * 0.28 + pk * 0.2 + uKick * 0.08;
  vSpark = pk;
}
`;

const FRAG = /* glsl */ `
precision mediump float;
uniform float uShape;
varying vec3 vColor;
varying float vAlpha;
varying float vSpark;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a;
  if (uShape < 0.5) {
    // mota redonda con caída gaussiana
    a = exp(-r2 * 2.4);
  } else if (uShape < 1.5) {
    // chispa: núcleo suave con destellos difusos en cruz
    float core = exp(-r2 * 4.5);
    float streak = exp(-abs(d.x) * 26.0) * exp(-abs(d.y) * 5.0)
                 + exp(-abs(d.y) * 26.0) * exp(-abs(d.x) * 5.0);
    a = core + streak * (0.25 + vSpark * 0.6);
  } else if (uShape < 2.5) {
    // bokeh hexagonal: gaussiana con la silueta ligeramente facetada, como un diafragma
    float r = sqrt(r2);
    float hex = r * (1.0 + 0.14 * cos(6.0 * atan(d.y, d.x)));
    a = exp(-hex * hex * 2.6);
  } else {
    // aro fino: anillos de luz en lugar de puntos
    float r = sqrt(r2);
    a = exp(-pow(abs(r - 0.62) * 6.5, 2.0)) * 0.95;
  }
  a *= 1.0 - smoothstep(0.8, 1.0, r2);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

export class ParticleLayer {
  constructor(scene, vibe, palette, quality = 1) {
    this.scene = scene;
    const cfg = vibe.particles;
    const count = Math.max(600, Math.floor(cfg.count * quality));
    const rng = makeRng(`${vibe.seedKey}-particles-${vibe.variant}`);
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const bands = new Float32Array(count);
    const sizes = new Float32Array(count);
    this.colors = new Float32Array(count * 3);
    this.colorIdx = new Uint8Array(count);
    const R = cfg.radius;
    for (let i = 0; i < count; i++) {
      let x, y, z;
      const u = rng.next(), v = rng.next(), w = rng.next();
      switch (cfg.distribution) {
        case 'disc': { const a = u * Math.PI * 2, r = Math.sqrt(v) * R; x = Math.cos(a) * r; y = (w - 0.5) * 1.8; z = Math.sin(a) * r; break; }
        case 'cube': { x = (u - 0.5) * 2 * R; y = (v - 0.5) * 2 * R; z = (w - 0.5) * 2 * R; break; }
        case 'spiral': { const a = u * Math.PI * 8, r = 2 + u * R; x = Math.cos(a) * r; y = (v - 0.5) * 6 + Math.sin(a * 0.5) * 2; z = Math.sin(a) * r; break; }
        case 'shell': { const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), r = R * (0.85 + w * 0.3); x = r * Math.sin(ph) * Math.cos(th); y = r * Math.cos(ph); z = r * Math.sin(ph) * Math.sin(th); break; }
        case 'ring': { const a = u * Math.PI * 2, r = R * (0.72 + v * 0.34); x = Math.cos(a) * r; y = (w - 0.5) * R * 0.22; z = Math.sin(a) * r; break; }
        case 'helix': { const a = u * Math.PI * 10, r = R * (0.5 + v * 0.5); x = Math.cos(a) * r; y = (u - 0.5) * R * 1.8; z = Math.sin(a) * r; break; }
        default: { const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), r = R * Math.cbrt(w); x = r * Math.sin(ph) * Math.cos(th); y = r * Math.cos(ph); z = r * Math.sin(ph) * Math.sin(th); }
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      seeds[i] = rng.next();
      // las partículas cercanas al centro escuchan graves; las lejanas, agudos
      const dist = Math.min(1, Math.sqrt(x * x + y * y + z * z) / (R * 1.1));
      bands[i] = Math.min(NUM_BANDS - 1, Math.floor((dist * 0.75 + rng.next() * 0.25) * NUM_BANDS));
      sizes[i] = 0.45 + Math.pow(rng.next(), 3) * 3.2;
      this.colorIdx[i] = rng.weighted([[0, 3], [1, 3], [2, 2], [3, 2], [4, 2]]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aBand', new THREE.BufferAttribute(bands, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.uniforms = {
      uTime: { value: 0 }, uKick: { value: 0 }, uEnergy: { value: 0 },
      uSpread: { value: cfg.spread }, uSwirl: { value: cfg.swirl }, uPixelRatio: { value: 1 },
      uBaseSize: { value: cfg.size }, uShape: { value: cfg.shape },
      uGravity: { value: cfg.gravity }, uPan: { value: 0 },
      uBands: { value: new Float32Array(NUM_BANDS) },
      uPeaks: { value: new Float32Array(NUM_BANDS) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.artRadius = R;
    this.artColors = null;
    scene.add(this.points);
    this.setPalette(palette);
  }
  get root() { return this.points; }
  setPixelRatio(pr) { this.uniforms.uPixelRatio.value = pr; }
  setPalette(p) {
    this._pal = p;
    applyColors(this.colors, this.colorIdx, p, this.artColors, 0.75);
    this.points.geometry.attributes.aColor.needsUpdate = true;
  }
  setArtwork(tex, art) {
    const pos = this.points.geometry.attributes.position.array;
    this.artColors = art ? buildArtColors(art, pos, this.colorIdx.length, this.artRadius) : null;
    if (this._pal) this.setPalette(this._pal);
  }
  update(f, dt, time, live) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uKick.value = f.kick;
    u.uEnergy.value = f.energy;
    u.uPan.value = f.pan;
    u.uBands.value.set(f.bands);
    u.uPeaks.value.set(f.bandsPeak);
    if (live) u.uSpread.value += (live.spread - u.uSpread.value) * 0.02;
    this.points.rotation.y = time * 0.02;
    this.points.rotation.x = Math.sin(time * 0.05) * 0.15;
  }
  dispose() { this.scene.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); }
}
