// Superficie espectral: una malla enorme, arriba y abajo de la escena, deformada por ondas
// que salen del centro con el espectro. Rejilla procedimental con brillo suave (no líneas
// de un píxel) y desvanecido radial para que se funda con el fondo.
import * as THREE from 'three';
import { NUM_BANDS } from '../../audio/features.js';

const VERT = /* glsl */ `
uniform float uTime, uAmp, uRipple, uSize, uEnergy, uKick, uBass, uFlip;
uniform float uBands[${NUM_BANDS}];
varying vec2 vUv;
varying float vH;
varying float vDist;
varying float vFacing;

float band(float x) {
  x = clamp(x, 0.0, 0.999) * float(${NUM_BANDS} - 1);
  int i = int(x);
  float f = x - float(i);
  return mix(uBands[i], uBands[min(i + 1, ${NUM_BANDS} - 1)], f);
}

void main() {
  vUv = uv;
  vec3 p = position;
  float d = length(p.xy) / (uSize * 0.5);   // el plano llega girado: xy es el suelo
  vDist = d;

  // onda que viaja desde el centro hacia fuera, con el espectro como perfil
  float travel = fract(d * 1.4 - uTime * 0.18 * uRipple);
  float e = band(clamp(d * 0.85, 0.0, 1.0));
  float h = e * uAmp * (0.5 + uEnergy * 0.9);
  h += sin(d * 8.0 * uRipple - uTime * 2.2) * uAmp * 0.18 * (0.3 + uBass);
  h += sin(p.x * 0.22 + uTime * 0.7) * cos(p.y * 0.19 - uTime * 0.5) * uAmp * 0.25;
  h *= smoothstep(1.15, 0.15, d);           // se aplana en los bordes
  h += uKick * uAmp * 0.5 * exp(-d * 2.2);
  h *= (1.0 - travel * 0.25);

  p.z += h * uFlip;
  vH = h;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // cuánto se ve de frente: de canto, la malla cubriría media pantalla de bruma
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uC0, uC1, uC2;
uniform float uGrid, uOpacity, uWire, uEnergy, uTreble, uAmp;
varying vec2 vUv;
varying float vH;
varying float vDist;
varying float vFacing;

void main() {
  // rejilla procedimental con antialias por derivadas: nítida y con halo, nunca dura
  vec2 g = fract(vUv * uGrid) - 0.5;
  vec2 w = fwidth(vUv * uGrid);
  vec2 lines = smoothstep(w * 1.6, vec2(0.0), abs(g));
  float grid = max(lines.x, lines.y);
  float glow = max(exp(-abs(g.x) * 9.0), exp(-abs(g.y) * 9.0)) * 0.35;

  float hn = clamp(abs(vH) / max(uAmp, 0.001), 0.0, 1.5);
  vec3 col = mix(uC0, uC1, clamp(hn, 0.0, 1.0));
  col = mix(col, uC2, clamp(hn - 0.6, 0.0, 1.0) * 1.4);
  col *= 0.45 + hn * 0.85 + uTreble * 0.25;
  col = col / (1.0 + col * 0.5);

  float fade = smoothstep(1.1, 0.25, vDist);
  float fill = mix(0.085, 0.02, uWire);
  float a = (grid * 0.7 + glow * 0.42) * mix(0.5, 0.95, uWire) + fill;
  a *= fade * uOpacity * (0.25 + uEnergy * 0.7 + hn * 0.4) * mix(0.18, 1.0, vFacing);
  a = min(a, 0.55);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

export class TerrainLayer {
  constructor(scene, vibe, palette, quality = 1) {
    this.scene = scene;
    const cfg = vibe.terrain;
    this.cfg = cfg;
    this.group = new THREE.Group();
    const seg = Math.max(48, Math.round(cfg.segments * Math.min(1, 0.6 + quality * 0.45)));
    this.geo = new THREE.PlaneGeometry(cfg.size, cfg.size, seg, seg);
    this.sheets = [];
    const make = (flip) => {
      const uniforms = {
        uTime: { value: 0 }, uAmp: { value: cfg.amp }, uRipple: { value: cfg.ripple },
        uSize: { value: cfg.size }, uEnergy: { value: 0 }, uKick: { value: 0 }, uBass: { value: 0 },
        uFlip: { value: flip },
        uBands: { value: new Float32Array(NUM_BANDS) },
        uC0: { value: palette.colors[0].clone() }, uC1: { value: palette.colors[1].clone() },
        uC2: { value: palette.colors[2].clone() },
        uGrid: { value: Math.round(seg / 3) }, uOpacity: { value: flip > 0 ? 1 : 0.7 },
        uWire: { value: cfg.wire ? 1 : 0 }, uTreble: { value: 0 },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = flip > 0 ? -cfg.height : cfg.height;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.sheets.push({ mesh, uniforms });
    };
    make(1);
    if (cfg.mirror) make(-1);
    scene.add(this.group);
  }
  get root() { return this.group; }
  setPalette(p) {
    for (const s of this.sheets) {
      s.uniforms.uC0.value.copy(p.colors[0]);
      s.uniforms.uC1.value.copy(p.colors[1]);
      s.uniforms.uC2.value.copy(p.colors[3 % p.colors.length]);
    }
  }
  update(f, dt, time) {
    for (const s of this.sheets) {
      const u = s.uniforms;
      u.uTime.value = time;
      u.uEnergy.value = f.energy; u.uKick.value = f.kick;
      u.uBass.value = f.bass; u.uTreble.value = f.treble;
      u.uBands.value.set(f.bandsSlow);
    }
    this.group.rotation.y = time * 0.012;
    this.group.position.x = f.pan * 1.5;
  }
  dispose() {
    this.scene.remove(this.group);
    this.geo.dispose();
    this.sheets.forEach(s => s.mesh.material.dispose());
  }
}
