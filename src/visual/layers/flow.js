// Campo de flujo: decenas de miles de motas arrastradas por un campo de ruido 3D con
// remolino. Toda la deriva se calcula en el vértice (sin estado en la CPU), así que puede
// haber muchísimas partículas llenando el volumen entero de la escena.
import * as THREE from 'three';
import { NUM_BANDS } from '../../audio/features.js';
import { makeRng } from '../seed.js';
import { applyColors, buildArtColors } from '../artwork.js';

const VERT = /* glsl */ `
attribute float aSeed;
attribute float aBand;
attribute float aSize;
attribute vec3 aColor;
uniform float uTime, uScale, uForce, uSwirl, uLife, uBaseSize, uPixelRatio;
uniform float uEnergy, uKick, uBass, uTreble, uPan;
uniform float uBands[${NUM_BANDS}];
varying vec3 vColor;
varying float vAlpha;

vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 field(vec3 p, float t) {
  vec3 q = p * uScale;
  return vec3(
    snoise3(q + vec3(0.0, 0.0, t)),
    snoise3(q + vec3(5.2, 1.3, t)),
    snoise3(q + vec3(9.1, 7.7, t))
  );
}

void main() {
  int b = int(aBand + 0.5);
  float e = uBands[b];
  float t = uTime * 0.12;

  // vida cíclica: cada mota nace, viaja y se apaga; el desfase la reparte en el tiempo
  float life = fract(aSeed * 7.13 + uTime / uLife);
  float travel = life * uForce * (0.6 + aSeed * 0.8) * (0.55 + uEnergy * 0.9);

  vec3 p = position;
  // dos pasos de arrastre por el campo: filamentos que se enroscan
  vec3 v1 = field(p, t);
  p += v1 * travel * 0.6;
  vec3 v2 = field(p, t + 1.7);
  p += v2 * travel * 0.4;

  // remolino alrededor del eje vertical: el conjunto gira como una galaxia
  float ang = uSwirl * travel * 0.25 + aSeed * 6.2831;
  float c = cos(ang), s = sin(ang);
  p.xz = mat2(c, -s, s, c) * p.xz;

  // el golpe empuja todo hacia afuera y las bandas hinchan su región
  vec3 dir = normalize(p + 0.0001);
  p += dir * (uKick * 3.0 * (0.4 + aSeed) + e * 2.2);
  p.x += uPan * 2.5;
  p.y += sin(uTime * (0.3 + aSeed * 0.6) + aSeed * 30.0) * (0.5 + uBass * 1.5);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sz = aSize * uBaseSize * (0.6 + e * 2.0 + uKick * 0.7);
  gl_PointSize = clamp(sz * (170.0 / -mv.z) * uPixelRatio, 1.0, 42.0 * uPixelRatio);
  gl_Position = projectionMatrix * mv;

  // envolvente de vida: entra y sale con suavidad (nada aparece de golpe)
  float env = sin(life * 3.14159);
  env *= env;
  vColor = aColor * (0.55 + e * 0.9 + uTreble * 0.3);
  vAlpha = env * (0.03 + e * 0.24 + uKick * 0.09) * (0.4 + uEnergy * 0.65);
}
`;

const FRAG = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  // mota redonda con caída suave: nada de bordes duros
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  float a = exp(-r * 2.6) * (1.0 - smoothstep(0.75, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

export class FlowLayer {
  constructor(scene, vibe, palette, quality = 1) {
    this.scene = scene;
    const cfg = vibe.flow;
    const count = Math.max(1200, Math.floor(cfg.count * quality));
    const rng = makeRng(`${vibe.seedKey}-flow-${vibe.variant}`);
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const bands = new Float32Array(count);
    const sizes = new Float32Array(count);
    this.colors = new Float32Array(count * 3);
    this.colorIdx = new Uint8Array(count);
    const R = cfg.volume;
    for (let i = 0; i < count; i++) {
      // distribución en un volumen esférico achatado: cubre la pantalla de lado a lado
      const u = rng.next(), v = rng.next(), w = Math.cbrt(rng.next());
      const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
      const r = R * w;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th) * 1.25;
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.8;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) * 1.1;
      seeds[i] = rng.next();
      bands[i] = rng.int(0, NUM_BANDS - 1);
      sizes[i] = 0.35 + Math.pow(rng.next(), 2.6) * 2.4;
      this.colorIdx[i] = rng.weighted([[0, 3], [1, 3], [2, 2], [3, 2], [4, 1]]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aBand', new THREE.BufferAttribute(bands, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    this.uniforms = {
      uTime: { value: 0 }, uScale: { value: cfg.scale }, uForce: { value: cfg.force },
      uSwirl: { value: cfg.swirl }, uLife: { value: cfg.life }, uBaseSize: { value: cfg.size },
      uPixelRatio: { value: 1 },
      uEnergy: { value: 0 }, uKick: { value: 0 }, uBass: { value: 0 }, uTreble: { value: 0 }, uPan: { value: 0 },
      uBands: { value: new Float32Array(NUM_BANDS) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
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
    applyColors(this.colors, this.colorIdx, p, this.artColors, 0.7);
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
    u.uEnergy.value = f.energy; u.uKick.value = f.kick;
    u.uBass.value = f.bass; u.uTreble.value = f.treble; u.uPan.value = f.pan;
    u.uBands.value.set(f.bands);
    this.points.rotation.y = time * 0.015 * (live?.speed ?? 1);
    this.points.rotation.x = Math.sin(time * 0.04) * 0.12;
  }
  dispose() { this.scene.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); }
}
