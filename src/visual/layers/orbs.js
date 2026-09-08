// Orbes: esferas de luz muy difusas, tipo bokeh, que flotan por todo el volumen. Son
// cuadriláteros orientados siempre a la cámara con un degradado radial suavísimo: aportan
// profundidad y llenan el aire sin bordes ni siluetas.
import * as THREE from 'three';
import { NUM_BANDS } from '../../audio/features.js';
import { makeRng } from '../seed.js';
import { applyColors, buildArtColors } from '../artwork.js';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute float iSeed;
attribute float iSize;
attribute float iBand;
attribute vec3 iColor;
uniform float uTime, uDrift, uEnergy, uKick, uBass, uPan, uSpread;
uniform float uBands[${NUM_BANDS}];
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  int b = int(iBand + 0.5);
  float e = uBands[b];
  vec3 c = iPos;
  // deriva lenta y desacoplada: cada orbe sigue su propio bucle
  float t = uTime * uDrift;
  c.x += sin(t * (0.5 + iSeed) + iSeed * 12.0) * uSpread * 0.18 + uPan * 2.0;
  c.y += cos(t * (0.4 + iSeed * 0.8) + iSeed * 24.0) * uSpread * 0.14;
  c.z += sin(t * (0.3 + iSeed * 0.6) + iSeed * 7.0) * uSpread * 0.16;
  c += normalize(c + 0.0001) * (uKick * 2.2 * iSeed + e * 2.0);

  float size = iSize * (0.7 + e * 1.4 + uKick * 0.5 + uBass * 0.3);
  vec4 mv = modelViewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  vColor = iColor * (0.5 + e * 0.9);
  // los orbes lejanos se desvanecen: sensación de niebla luminosa
  float depth = clamp(1.0 - (-mv.z - 8.0) / 70.0, 0.0, 1.0);
  vAlpha = (0.018 + e * 0.11 + uKick * 0.05) * (0.35 + uEnergy * 0.6) * depth;
}
`;

const FRAG = /* glsl */ `
precision mediump float;
uniform float uSoftness;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  // degradado radial: núcleo tenue, caída larguísima y un aro sutil en el borde
  float core = exp(-r * r * mix(11.0, 3.4, uSoftness));
  float halo = pow(max(1.0 - r, 0.0), 3.0) * 0.28;
  float rimDistance = (r - 0.82) * 8.0;
  float rim = exp(-rimDistance * rimDistance) * 0.14;
  float a = (core + halo + rim) * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

export class OrbLayer {
  constructor(scene, vibe, palette, quality = 1) {
    this.scene = scene;
    const cfg = vibe.orbs;
    const count = Math.max(6, Math.round(cfg.count * Math.min(1.2, 0.6 + quality * 0.5)));
    const rng = makeRng(`${vibe.seedKey}-orbs-${vibe.variant}`);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;

    const iPos = new Float32Array(count * 3);
    const iSeed = new Float32Array(count);
    const iSize = new Float32Array(count);
    const iBand = new Float32Array(count);
    this.iColor = new Float32Array(count * 3);
    this.colorIdx = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const u = rng.next(), v = rng.next(), w = Math.cbrt(rng.next());
      const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), r = cfg.spread * w;
      iPos[i * 3] = r * Math.sin(ph) * Math.cos(th) * 1.3;
      iPos[i * 3 + 1] = r * Math.cos(ph) * 0.9;
      iPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      iSeed[i] = rng.next();
      iSize[i] = cfg.size * rng.range(0.35, 1.5);
      iBand[i] = rng.int(0, Math.floor(NUM_BANDS * 0.7));
      this.colorIdx[i] = rng.int(0, palette.colors.length - 1);
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 1));
    geo.setAttribute('iBand', new THREE.InstancedBufferAttribute(iBand, 1));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.iColor, 3));

    this.uniforms = {
      uTime: { value: 0 }, uDrift: { value: cfg.drift }, uSoftness: { value: cfg.softness },
      uSpread: { value: cfg.spread }, uEnergy: { value: 0 }, uKick: { value: 0 },
      uBass: { value: 0 }, uPan: { value: 0 },
      uBands: { value: new Float32Array(NUM_BANDS) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.baseGeo = base;
    this.artRadius = cfg.spread;
    this.artColors = null;
    scene.add(this.mesh);
    this.setPalette(palette);
  }
  get root() { return this.mesh; }
  setPalette(p) {
    this._pal = p;
    applyColors(this.iColor, this.colorIdx, p, this.artColors, 0.8);
    this.mesh.geometry.attributes.iColor.needsUpdate = true;
  }
  setArtwork(tex, art) {
    const pos = this.mesh.geometry.attributes.iPos.array;
    this.artColors = art ? buildArtColors(art, pos, this.colorIdx.length, this.artRadius) : null;
    if (this._pal) this.setPalette(this._pal);
  }
  update(f, dt, time) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uEnergy.value = f.energy; u.uKick.value = f.kick; u.uBass.value = f.bass; u.uPan.value = f.pan;
    u.uBands.value.set(f.bands);
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.baseGeo.dispose();
  }
}
