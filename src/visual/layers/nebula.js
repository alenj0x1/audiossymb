// Fondo: lienzo volumétrico a pantalla completa. Ruido simplex con deformación de dominio,
// cuatro estilos (flujo, velo, celular, humo), vetas de cáustica, rayos radiales, polvo
// estelar y difuminado final para que no aparezcan bandas de color.
import * as THREE from 'three';
import { blankTexture } from '../artwork.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime, uSeed, uScale, uWarp, uRays, uIntensity, uGrain, uHorizon, uSwirl, uCaustics, uStyle, uOctaves;
uniform vec2 uRes;
uniform vec3 uC0, uC1, uC2, uC3, uBg, uBg2;
uniform sampler2D uArt;
uniform float uArtMix;
uniform float uBass, uMid, uTreble, uEnergy, uKick, uSnare, uFlux, uBeat, uPan;

// ---- ruido simplex 2D (Ashima / Gustavson) ----
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
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

float fbm(vec2 p, float octaves) {
  float v = 0.0, a = 0.5, tot = 0.0;
  mat2 m = mat2(1.62, 1.18, -1.18, 1.62);
  for (int i = 0; i < 6; i++) {
    if (float(i) >= octaves) break;
    v += a * snoise(p);
    tot += a;
    p = m * p;
    a *= 0.52;
  }
  return v / max(tot, 0.001);
}

float hash21(vec2 p) { return fract(sin(dot(p, vec2(27.61, 57.83))) * 43758.5453); }

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 uv = (vUv - 0.5) * vec2(aspect, 1.0);
  float rad = length(uv);
  float ang = atan(uv.y, uv.x);
  float t = uTime * 0.05;

  // el estéreo desplaza suavemente todo el lienzo: la escena "respira" de lado a lado
  uv.x += uPan * 0.06;

  // rotación lenta del dominio (giro global del fondo)
  float ca = cos(t * uSwirl * 0.6), sa = sin(t * uSwirl * 0.6);
  vec2 rp = mat2(ca, -sa, sa, ca) * uv;

  vec2 p = rp * uScale + uSeed;

  // deformación de dominio en dos pasos: da esa sensación de fluido con volumen
  // Las deformaciones usan pocas octavas a propósito: con muchas, el detalle fino se
  // traslada al muestreo final y el fondo acaba pareciendo mármol en vez de niebla.
  vec2 q = vec2(fbm(p + t, 2.0), fbm(p + vec2(4.7, 1.9) - t * 0.8, 2.0));
  vec2 r = vec2(
    fbm(p + uWarp * q + vec2(1.7, 9.2) + 0.14 * t + uBass * 0.5, 3.0),
    fbm(p + uWarp * q + vec2(8.3, 2.8) - 0.11 * t + uMid * 0.35, 3.0)
  );
  // El campo final se muestrea a menos frecuencia y con menos octavas que la deformación:
  // la deformación aporta el movimiento orgánico, y este muestreo, formas grandes y suaves.
  float f = fbm((p + uWarp * (1.0 + uBass * 0.7) * r) * 0.7, min(uOctaves, 3.0));

  // ---- estilos: cada uno produce un campo escalar suave de 0 a 1 ----
  float v;
  if (uStyle < 0.5) {
    // flujo: masas de niebla anchas y redondeadas
    v = smoothstep(-0.6, 0.7, f) * (0.6 + length(q) * 0.5);
  } else if (uStyle < 1.5) {
    // velo: cortinas amplias que ondulan
    float veil = sin((rp.y * 1.4 + f * 2.2 + t * 1.6) * 1.3);
    v = smoothstep(-0.3, 1.0, veil * 0.5 + 0.5 + f * 0.35);
  } else if (uStyle < 2.5) {
    // celular: burbujas de contorno muy difuso
    v = smoothstep(0.95, 0.1, abs(f));
  } else {
    // humo: columnas alargadas que ascienden
    float smoke = fbm(p * vec2(0.4, 1.1) + r * 1.1 + vec2(0.0, -t * 2.2), 3.0);
    v = smoothstep(-0.5, 0.7, smoke);
  }
  v = clamp(v, 0.0, 1.0);

  // ---- color ----
  // Se construye por MEZCLA, no por suma: así el matiz de la paleta se conserva y la
  // imagen nunca se lava a blanco por acumular tres colores a la vez.
  vec3 col = mix(uBg, uBg2, smoothstep(-0.85, 0.95, rp.y + uHorizon));

  vec3 ramp = mix(uC0, uC1, smoothstep(0.1, 0.8, v + (length(q) - 0.45) * 0.35));
  ramp = mix(ramp, uC2, smoothstep(0.55, 1.0, v) * (0.25 + uTreble * 0.55));
  ramp = mix(ramp, uC3, smoothstep(0.1, 0.6, abs(r.y)) * (0.15 + uMid * 0.35));

  // La portada del álbum, muestreada con la misma deformación que el ruido: sus colores
  // fluyen como si fueran parte del fluido, sin que se reconozca la foto.
  if (uArtMix > 0.01) {
    vec2 auv = 0.5 + (rp * 0.5 + q * 0.28 + r * 0.14);
    auv = abs(fract(auv * 0.5) * 2.0 - 1.0);      // espejo continuo: nunca hay costura
    vec3 art = texture2D(uArt, auv).rgb;
    float al = dot(art, vec3(0.299, 0.587, 0.114));
    art = mix(vec3(al), art, 1.4);                // realce de saturación
    ramp = mix(ramp, art, uArtMix);
  }
  // El fondo se mantiene deliberadamente por debajo de las capas: es el lienzo, no el tema.
  float density = pow(v, 1.4) * (0.26 + uEnergy * 0.3) * uIntensity;
  // el centro se mantiene más oscuro: ahí viven las capas de geometría y deben leerse
  density *= 0.42 + 0.58 * smoothstep(0.1, 0.8, rad);
  col = mix(col, ramp * (0.11 + uEnergy * 0.26 + uBass * 0.1), clamp(density, 0.0, 0.6));

  // ---- realces puntuales (los únicos términos aditivos, deliberadamente pequeños) ----
  if (uCaustics > 0.01) {
    // vetas de luz como reflejos en el agua: pocas, anchas y tenues (si son finas y
    // abundantes el fondo parece mármol, no luz)
    float caus = pow(1.0 - abs(fbm(p * 0.8 + r * 1.1 + t * 1.2, 2.0)), 6.0);
    col += uC2 * caus * uCaustics * (0.05 + uTreble * 0.18) * smoothstep(0.15, 0.7, rad);
  }
  float rays = snoise(vec2(ang * 3.0 + uSeed, t * 3.0)) * 0.5 + 0.5;
  rays *= snoise(vec2(ang * 6.0 - t * 2.0 + uSeed, uSeed * 0.5)) * 0.5 + 0.5;
  col += uC2 * pow(rays, 2.6) * uRays * (0.04 + uTreble * 0.35) * smoothstep(0.05, 0.6, rad);

  // aro que se expande con cada golpe de caja
  col += uC1 * smoothstep(0.05, 0.0, abs(rad - (0.22 + uSnare * 0.6))) * uSnare * 0.22;
  // destellos de bombo y de pulso
  col += uC1 * uKick * 0.3 * exp(-rad * 3.4);
  col += uC0 * uKick * 0.06;
  col += uC3 * uBeat * 0.05 * exp(-rad * 1.6);

  // polvo estelar: un punto redondo y difuso en algunas celdas de la retícula
  vec2 cell = vUv * uRes.xy / 5.0;
  vec2 gid = floor(cell);
  vec2 gpos = fract(cell) - 0.5;
  float h = hash21(gid + floor(uSeed));
  float star = step(0.976, h) * exp(-dot(gpos, gpos) * 13.0) * (0.4 + hash21(gid * 1.7) * 0.6);
  col += mix(vec3(1.0), uC1, 0.35) * star * (0.25 + uTreble * 0.9) * 0.55;

  // viñeta suave
  col *= 1.0 - smoothstep(0.38, 1.3, rad) * 0.85;

  // difuminado: rompe las bandas de color en degradados oscuros
  float dither = (hash21(vUv * uRes.xy + fract(uTime) * 91.7) - 0.5) / 255.0;
  col += dither * (1.0 + uGrain * 2.0);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const STYLE_ID = { flow: 0, veil: 1, cell: 2, smoke: 3 };

export class NebulaLayer {
  constructor(scene, vibe, palette) {
    const n = vibe.nebula;
    this.uniforms = {
      uTime: { value: 0 }, uSeed: { value: n.seed }, uScale: { value: n.scale },
      uWarp: { value: n.warp }, uRays: { value: n.rays }, uIntensity: { value: n.intensity },
      uGrain: { value: n.grain }, uHorizon: { value: n.horizon }, uSwirl: { value: n.swirl },
      uCaustics: { value: n.caustics }, uStyle: { value: STYLE_ID[n.style] ?? 0 },
      uArt: { value: blankTexture() }, uArtMix: { value: 0 },
      uOctaves: { value: n.layers },
      uRes: { value: new THREE.Vector2(1, 1) },
      uC0: { value: palette.colors[0].clone() }, uC1: { value: palette.colors[1].clone() },
      uC2: { value: palette.colors[2].clone() }, uC3: { value: palette.colors[3].clone() },
      uBg: { value: palette.bg.clone() }, uBg2: { value: palette.bg2.clone() },
      uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 }, uEnergy: { value: 0 },
      uKick: { value: 0 }, uSnare: { value: 0 }, uFlux: { value: 0 }, uBeat: { value: 0 }, uPan: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    scene.add(this.mesh);
    this.scene = scene;
    this.beat = 0;
    this.artMix = n.artMix;
  }
  get root() { return this.mesh; }
  resize(w, h) { this.uniforms.uRes.value.set(w, h); }
  setArtwork(tex) {
    this.uniforms.uArt.value = tex || this._blank || (this._blank = blankTexture());
    this.uniforms.uArtMix.value = tex ? this.artMix : 0;
  }
  setPalette(p) {
    const u = this.uniforms;
    u.uC0.value.copy(p.colors[0]); u.uC1.value.copy(p.colors[1]);
    u.uC2.value.copy(p.colors[2]); u.uC3.value.copy(p.colors[3]);
    u.uBg.value.copy(p.bg); u.uBg2.value.copy(p.bg2);
  }
  update(f, dt, time) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uBass.value = f.bass; u.uMid.value = f.mid; u.uTreble.value = f.treble;
    u.uEnergy.value = f.energy; u.uKick.value = f.kick; u.uSnare.value = f.snare;
    u.uFlux.value = f.flux; u.uPan.value = f.pan;
    if (f.beat) this.beat = 1;
    this.beat *= Math.exp(-dt * 3.2);
    u.uBeat.value = this.beat;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
