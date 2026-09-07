// Metaformas líquidas: un campo de esferas que se fusionan entre sí (unión suave de SDF) y
// se recorre con un raymarch volumétrico. El resultado son masas de luz redondeadas, sin
// bordes duros, que respiran con los graves y ocupan toda la pantalla.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime, uSteps, uBlobs, uRadius, uSmooth, uOrbit, uThickness, uRim, uInner, uSpeed, uSeed;
uniform float uEnergy, uBass, uSub, uMid, uTreble, uKick, uSnare, uPan, uBeat;
uniform float uBandLo, uBandMid, uBandHi;
uniform vec3 uC0, uC1, uC2, uC3, uC4;

vec3 paletteAt(float x) {
  x = fract(x);
  if (x < 0.2) return mix(uC0, uC1, x / 0.2);
  if (x < 0.4) return mix(uC1, uC2, (x - 0.2) / 0.2);
  if (x < 0.6) return mix(uC2, uC3, (x - 0.4) / 0.2);
  if (x < 0.8) return mix(uC3, uC4, (x - 0.6) / 0.2);
  return mix(uC4, uC0, (x - 0.8) / 0.2);
}

// unión suave: el punto donde dos formas se juntan queda redondeado
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float hash11(float p) { return fract(sin(p * 78.233) * 43758.5453); }

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float sdf(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 9; i++) {
    if (float(i) >= uBlobs) break;
    float fi = float(i);
    float h1 = hash11(fi + uSeed), h2 = hash11(fi * 3.7 + uSeed), h3 = hash11(fi * 7.1 + uSeed);
    float sp = uTime * uSpeed * (0.5 + h1);
    // órbitas cruzadas: cada masa recorre su propio bucle de Lissajous
    vec3 c = vec3(
      sin(sp + h1 * 6.28) * (0.7 + h2 * 0.8),
      sin(sp * 1.31 + h2 * 6.28) * (0.5 + h3 * 0.7),
      cos(sp * 0.87 + h3 * 6.28) * (0.7 + h1 * 0.8)
    ) * uOrbit * 1.6;

    // el tamaño lo marca una región del espectro: graves las centrales, agudos las exteriores
    float bandE = fi < 3.0 ? uBandLo : (fi < 6.0 ? uBandMid : uBandHi);
    float r = uRadius * (0.55 + h2 * 0.7) * (0.75 + bandE * 0.85 + uKick * 0.3);
    d = smin(d, length(p - c) - r, uSmooth);
  }
  // una masa central grande anclada al sub-grave
  d = smin(d, length(p) - uRadius * (0.7 + uSub * 0.9 + uKick * 0.35), uSmooth * 1.4);
  return d;
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 uv = (vUv - 0.5) * vec2(aspect, 1.0);

  // cámara virtual propia: gira despacio alrededor del campo
  vec3 ro = vec3(0.0, 0.0, -3.4);
  vec3 rd = normalize(vec3(uv * 1.5, 1.0));
  float spin = uTime * 0.09 + uPan * 0.25;
  ro.xz = rot(spin) * ro.xz; rd.xz = rot(spin) * rd.xz;
  float tilt = sin(uTime * 0.07) * 0.35;
  ro.yz = rot(tilt) * ro.yz; rd.yz = rot(tilt) * rd.yz;

  vec3 col = vec3(0.0);
  float tt = 0.6;
  float acc = 0.0;

  for (int i = 0; i < 64; i++) {
    if (float(i) >= uSteps || tt > 7.0 || acc > 1.0) break;
    vec3 p = ro + rd * tt;
    float d = sdf(p);

    // densidad volumétrica: cuanto más dentro, más luz aporta (sin bordes duros)
    float dens = exp(-max(d, 0.0) * (5.5 / max(uThickness, 0.15)));
    if (dens > 0.002) {
      // el color se toma de la posición: cada zona del campo tiene su matiz
      float hue = 0.5 + 0.5 * sin(p.x * 0.6 + p.y * 0.4 + uTime * 0.15);
      vec3 c = paletteAt(hue + uTime * 0.012);
      float depth = 1.0 - clamp((tt - 0.6) / 6.0, 0.0, 1.0);
      col += c * dens * 0.055 * depth * uInner;
      // borde luminoso justo en la superficie: da volumen sin necesidad de iluminar
      float rim = smoothstep(0.11, 0.0, abs(d)) * (0.35 + uMid * 0.9);
      col += c * rim * 0.05 * uRim * depth;
      acc += dens * 0.05;
    }
    tt += max(d * 0.55, 0.045);
  }

  col *= (0.55 + uEnergy * 0.85);
  col += paletteAt(0.35) * uKick * 0.08 * (1.0 - length(uv));
  col += uC2 * uSnare * acc * 0.09;
  col += uC0 * uBeat * acc * 0.04;
  // rodilla suave: por muchos pasos que acumule el raymarch, nunca se satura a blanco
  col = col / (1.0 + col * 0.75);

  // atenuado en los bordes para que se integre con el fondo
  col *= 1.0 - smoothstep(0.55, 1.3, length(uv)) * 0.6;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export class LiquidLayer {
  constructor(scene, vibe, palette, quality = 1) {
    const l = vibe.liquid;
    this.uniforms = {
      uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uSteps: { value: Math.round(26 + quality * 22) },
      uBlobs: { value: l.blobs }, uRadius: { value: l.radius }, uSmooth: { value: l.smooth },
      uOrbit: { value: l.orbit }, uThickness: { value: l.thickness }, uRim: { value: l.rim },
      uInner: { value: l.inner }, uSpeed: { value: l.speed }, uSeed: { value: vibe.nebula.seed },
      uEnergy: { value: 0 }, uBass: { value: 0 }, uSub: { value: 0 }, uMid: { value: 0 },
      uTreble: { value: 0 }, uKick: { value: 0 }, uSnare: { value: 0 }, uPan: { value: 0 }, uBeat: { value: 0 },
      uBandLo: { value: 0 }, uBandMid: { value: 0 }, uBandHi: { value: 0 },
      uC0: { value: palette.colors[0].clone() }, uC1: { value: palette.colors[1].clone() },
      uC2: { value: palette.colors[2].clone() }, uC3: { value: palette.colors[3].clone() },
      uC4: { value: palette.colors[4].clone() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -50;   // detrás de la geometría, delante de la nebulosa
    scene.add(this.mesh);
    this.scene = scene;
    this.beat = 0;
  }
  get root() { return this.mesh; }
  resize(w, h) { this.uniforms.uRes.value.set(w, h); }
  setPalette(p) {
    const u = this.uniforms;
    u.uC0.value.copy(p.colors[0]); u.uC1.value.copy(p.colors[1]); u.uC2.value.copy(p.colors[2]);
    u.uC3.value.copy(p.colors[3]); u.uC4.value.copy(p.colors[4]);
  }
  update(f, dt, time, live) {
    const u = this.uniforms;
    u.uTime.value = time;
    const b = f.bands, n = b.length;
    let lo = 0, mid = 0, hi = 0;
    const third = Math.floor(n / 3);
    for (let i = 0; i < third; i++) lo += b[i];
    for (let i = third; i < third * 2; i++) mid += b[i];
    for (let i = third * 2; i < n; i++) hi += b[i];
    u.uBandLo.value = lo / third; u.uBandMid.value = mid / third; u.uBandHi.value = hi / (n - third * 2);
    u.uEnergy.value = f.energy; u.uBass.value = f.bass; u.uSub.value = f.sub;
    u.uMid.value = f.mid; u.uTreble.value = f.treble;
    u.uKick.value = f.kick; u.uSnare.value = f.snare; u.uPan.value = f.pan;
    if (f.beat) this.beat = 1;
    this.beat *= Math.exp(-dt * 3);
    u.uBeat.value = this.beat;
    if (live) u.uThickness.value += (live.liquid - u.uThickness.value) * Math.min(1, dt * 1.5);
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
