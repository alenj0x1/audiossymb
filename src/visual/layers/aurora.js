// Auroras: cortinas de luz suaves que atraviesan toda la pantalla por encima de la escena.
// Cada cortina escucha una región del espectro, así que la forma del sonido se ve en el aire.
// Se dibuja en modo aditivo: sólo suma luz, nunca tapa lo que hay debajo.
import * as THREE from 'three';

const SPEC = 16;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime, uBands, uHeight, uSoftness, uSpeed, uTilt, uIntensity, uCurtain, uSeed;
uniform float uEnergy, uBass, uTreble, uKick, uPan;
uniform float uSpec[${SPEC}];
uniform vec3 uC0, uC1, uC2, uC3, uC4;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * snoise(p); p *= 2.02; a *= 0.5; }
  return v;
}
float hash21(vec2 p) { return fract(sin(dot(p, vec2(27.61, 57.83))) * 43758.5453); }

vec3 paletteAt(float x) {
  x = fract(x);
  if (x < 0.2) return mix(uC0, uC1, x / 0.2);
  if (x < 0.4) return mix(uC1, uC2, (x - 0.2) / 0.2);
  if (x < 0.6) return mix(uC2, uC3, (x - 0.4) / 0.2);
  if (x < 0.8) return mix(uC3, uC4, (x - 0.6) / 0.2);
  return mix(uC4, uC0, (x - 0.8) / 0.2);
}

// energía interpolada del espectro (0..1 → grave..agudo)
float spec(float x) {
  x = clamp(x, 0.0, 0.999) * float(${SPEC} - 1);
  int i = int(x);
  float fr = x - float(i);
  float a = uSpec[i];
  float b = uSpec[min(i + 1, ${SPEC} - 1)];
  return mix(a, b, fr);
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 uv = (vUv - 0.5) * vec2(aspect, 1.0);
  uv.x += uPan * 0.08;
  // inclinación: las cortinas no son verticales perfectas
  uv.y += uv.x * uTilt;

  float t = uTime * uSpeed;
  vec3 col = vec3(0.0);
  float total = 0.0;

  for (int k = 0; k < 6; k++) {
    if (float(k) >= uBands) break;
    float fk = float(k);
    float lane = fk / max(uBands - 1.0, 1.0);

    // deriva horizontal y ondulación propia de cada cortina
    float x = uv.x + sin(t * (0.3 + lane * 0.5) + fk * 2.1 + uSeed) * 0.35;
    float wob = fbm(vec2(x * 1.6 + uSeed * 0.1, t * 0.6 + fk * 3.0)) * 0.5;

    // altura del pie de la cortina: la manda el espectro de su región
    float e = spec(lane * 0.9 + 0.05);
    float top = -0.42 + lane * 0.22 + wob * 0.4 + e * uHeight * 0.55 + uKick * 0.06;

    // caída suave hacia arriba y desvanecido por los bordes
    float d = uv.y - top;
    float soft = uSoftness * (0.35 + e * 0.8);
    float body = exp(-max(d, 0.0) / max(soft, 0.02)) * smoothstep(-0.35, 0.0, d + 0.35);

    // estrías verticales (el "tejido" de la aurora)
    float weave = 0.6 + 0.4 * (snoise(vec2(x * (8.0 + fk * 3.0), t * 1.4 + fk)) * 0.5 + 0.5);
    body *= mix(1.0, weave, uCurtain);

    // atenuación en los laterales para que no se corte de golpe
    body *= smoothstep(0.75 * aspect, 0.15 * aspect, abs(uv.x));

    vec3 c = paletteAt(lane * 0.8 + uSeed * 0.01 + uTime * 0.01);
    col += c * body * (0.35 + e * 1.1);
    total += body;
  }

  // se reparte entre las cortinas: seis cortinas no deben brillar seis veces más que una
  col /= max(uBands * 0.5, 1.0);
  col *= uIntensity * (0.45 + uEnergy * 0.85);
  // un velo general muy tenue une las cortinas entre sí
  col += paletteAt(0.5) * total * 0.015 * (0.4 + uBass);
  // brillo extra en los agudos: la aurora "chispea"
  col += uC2 * total * uTreble * 0.05;
  col = col / (1.0 + col * 0.85);

  float dither = (hash21(vUv * uRes.xy + fract(uTime) * 53.3) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col + dither, 0.0), 1.0);
}
`;

export class AuroraLayer {
  constructor(scene, vibe, palette) {
    const a = vibe.aurora;
    this.spec = new Float32Array(SPEC);
    this.uniforms = {
      uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uBands: { value: a.bands }, uHeight: { value: a.height }, uSoftness: { value: a.softness },
      uSpeed: { value: a.speed }, uTilt: { value: a.tilt }, uIntensity: { value: a.intensity },
      uCurtain: { value: a.curtain }, uSeed: { value: vibe.nebula.seed },
      uEnergy: { value: 0 }, uBass: { value: 0 }, uTreble: { value: 0 }, uKick: { value: 0 }, uPan: { value: 0 },
      uSpec: { value: this.spec },
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
    this.mesh.renderOrder = 900;   // se dibuja al final: sólo suma luz sobre la escena
    scene.add(this.mesh);
    this.scene = scene;
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
    const bands = f.bands, n = bands.length;
    // reducimos las 64 bandas a 16 promediando grupos contiguos
    const per = n / SPEC;
    for (let i = 0; i < SPEC; i++) {
      let s = 0;
      const a = Math.floor(i * per), b = Math.floor((i + 1) * per);
      for (let j = a; j < b; j++) s += bands[j];
      this.spec[i] = s / Math.max(1, b - a);
    }
    u.uEnergy.value = f.energy; u.uBass.value = f.bass; u.uTreble.value = f.treble;
    u.uKick.value = f.kick; u.uPan.value = f.pan;
    if (live) u.uIntensity.value += (live.aurora - u.uIntensity.value) * Math.min(1, dt * 1.5);
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
