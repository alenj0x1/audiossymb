// El protagonista: una escultura que se deforma con la canción, con material físico real
// (cristal con dispersión, cromo o iridiscencia) iluminada por el entorno HDR de la escena.
//
// Es la capa que rompe con el lenguaje aditivo del resto: aquí no hay glow sumado, hay una
// superficie con rugosidad, índice de refracción y reflejos coherentes. La atmósfera de las
// demás capas pasa por detrás y se ve refractada a través de ella.
//
// La deformación se inyecta parcheando el shader de MeshPhysicalMaterial
// (`onBeforeCompile`), de modo que se conserva toda la iluminación PBR de three.
import * as THREE from 'three';

const NOISE = /* glsl */ `
vec4 heroPermute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 heroTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float heroNoise(vec3 v) {
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
  vec4 p = heroPermute(heroPermute(heroPermute(
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
  vec4 norm = heroTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const DISPLACE = /* glsl */ `
uniform float uTime, uAmp, uFreq, uRipple, uLobes, uMorph;
uniform float uBass, uMid, uTreble, uKick, uEnergy;

// Desplazamiento radial de la esfera base. Combina ruido de dos escalas (la forma "líquida"),
// una ondulación armónica ligada a los medios, púas finas con los agudos y un golpe global
// con el bombo. uMorph va llevando la silueta de esfera a lóbulos.
float heroDisp(vec3 p) {
  float t = uTime * 0.22;
  float n = heroNoise(p * uFreq + vec3(0.0, 0.0, t)) * 0.6;
  n += heroNoise(p * uFreq * 2.3 + vec3(t * 1.4, 0.0, 0.0)) * 0.28;
  float ripple = sin(p.y * uRipple + uTime * 2.6) * cos(p.x * uRipple * 0.7 - uTime * 1.7);
  float spikes = pow(max(heroNoise(p * uFreq * 4.1 + t * 2.0), 0.0), 3.0);
  // lóbulos: armónicos esféricos baratos, dan una silueta escultórica en lugar de una bola
  float lobes = cos(atan(p.z, p.x) * uLobes) * (1.0 - abs(p.y) * 0.6);
  return (n * (0.35 + uBass * 1.0)
        + ripple * 0.14 * (0.25 + uMid * 1.1)
        + spikes * 0.22 * uTreble
        + lobes * uMorph * 0.35
        + uKick * 0.22) * uAmp;
}

vec3 heroSurface(vec3 dir) { return dir * (1.0 + heroDisp(dir)); }
`;

const MODES = {
  glass: (pal) => ({
    color: new THREE.Color(1, 1, 1),
    metalness: 0, roughness: 0.06, transmission: 1, thickness: 1.6, ior: 1.52,
    dispersion: 4.5, clearcoat: 1, clearcoatRoughness: 0.05,
    attenuationColor: pal.colors[0].clone(), attenuationDistance: 1.8,
    iridescence: 0.25, iridescenceIOR: 1.4,
  }),
  chrome: (pal) => ({
    color: pal.colors[2].clone().lerp(new THREE.Color(1, 1, 1), 0.72),
    metalness: 1, roughness: 0.09, clearcoat: 0.6, clearcoatRoughness: 0.1,
  }),
  iridescent: (pal) => ({
    color: pal.colors[3 % pal.colors.length].clone().multiplyScalar(0.35),
    metalness: 0.8, roughness: 0.11,
    iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [120, 780],
    clearcoat: 1, clearcoatRoughness: 0.12,
  }),
  liquid: (pal) => ({
    color: pal.colors[1].clone().lerp(new THREE.Color(1, 1, 1), 0.3),
    metalness: 1, roughness: 0.2,
    iridescence: 0.5, iridescenceIOR: 1.5,
  }),
};

export class HeroLayer {
  constructor(scene, vibe, palette, quality = 1) {
    this.scene = scene;
    const cfg = vibe.hero;
    this.cfg = cfg;

    // La transmisión cuesta un render extra de la escena; en calidad baja se cambia por un
    // material metálico, que da un resultado igual de sólido y mucho más barato.
    let mode = cfg.mode;
    if (mode === 'glass' && quality < 0.6) mode = 'iridescent';
    this.mode = mode;

    const detail = quality >= 1 ? 5 : quality >= 0.7 ? 4 : 3;
    this.geo = new THREE.IcosahedronGeometry(1, detail);

    this.uniforms = {
      uTime: { value: 0 }, uAmp: { value: cfg.amp }, uFreq: { value: cfg.freq },
      uRipple: { value: cfg.ripple }, uLobes: { value: cfg.lobes }, uMorph: { value: cfg.morph },
      uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uKick: { value: 0 }, uEnergy: { value: 0 },
    };

    this.material = new THREE.MeshPhysicalMaterial({
      ...MODES[mode](palette),
      envMapIntensity: cfg.envIntensity,
      side: mode === 'glass' ? THREE.FrontSide : THREE.FrontSide,
    });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      // El orden de los includes de three es: normales primero, posición después. Por eso
      // la superficie y su normal se calculan en beginnormal_vertex, y begin_vertex sólo
      // recoge el resultado; al revés, la normal se usaría antes de existir y el shader
      // ni compila.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${NOISE}\n${DISPLACE}`)
        .replace('#include <beginnormal_vertex>', /* glsl */ `
          vec3 heroDir = normalize(position);
          vec3 heroPos = heroSurface(heroDir);
          // Normal analítica: se desplazan dos vecinos sobre el plano tangente y se toma
          // el producto vectorial. Sin esto la luz seguiría la esfera lisa y el relieve no
          // se vería en el material.
          vec3 heroT = normalize(cross(heroDir, abs(heroDir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
          vec3 heroB = cross(heroDir, heroT);
          float heroE = 0.04;
          vec3 hp1 = heroSurface(normalize(heroDir + heroT * heroE));
          vec3 hp2 = heroSurface(normalize(heroDir + heroB * heroE));
          vec3 heroN = normalize(cross(hp1 - heroPos, hp2 - heroPos));
          if (dot(heroN, heroDir) < 0.0) heroN = -heroN;
          vec3 objectNormal = heroN;
        `)
        .replace('#include <begin_vertex>', 'vec3 transformed = heroPos;');
    };
    // fuerza una clave de programa propia: si no, three reutiliza el shader sin parchear
    this.material.customProgramCacheKey = () => `hero-${mode}`;

    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.renderOrder = 1;
    this.group = new THREE.Group();
    this.group.add(this.mesh);

    // Luz puntual que orbita: da un reflejo especular que se mueve sobre la superficie.
    // Con solo el entorno, el brillo quedaría clavado y la escultura parecería estática.
    this.light = new THREE.PointLight(0xffffff, 40, 120, 2);
    this.group.add(this.light);

    scene.add(this.group);
    this.beat = 0;
    this.smoothEnergy = 0;
  }

  get root() { return this.group; }

  setPalette(p) {
    const m = this.material;
    const preset = MODES[this.mode](p);
    if (preset.color) m.color.copy(preset.color);
    if (preset.attenuationColor) m.attenuationColor.copy(preset.attenuationColor);
    this.light.color.copy(p.colors[2]).lerp(new THREE.Color(1, 1, 1), 0.75);
  }

  setEnvironment(tex) { this.material.envMap = tex; this.material.needsUpdate = true; }

  update(f, dt, time, live) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uBass.value = f.bass; u.uMid.value = f.mid; u.uTreble.value = f.treble;
    u.uKick.value = f.kick; u.uEnergy.value = f.energy;

    this.smoothEnergy += (f.energy - this.smoothEnergy) * Math.min(1, dt * 2);
    if (f.beat) this.beat = 1;
    this.beat *= Math.exp(-dt * 3.5);

    // la escultura respira con la energía y da un pequeño salto en cada pulso
    const s = 1 + this.smoothEnergy * 0.12 + this.beat * 0.05 + f.kick * 0.06;
    this.mesh.scale.setScalar(this.cfg.radius * s);
    this.mesh.rotation.y += dt * (0.12 + f.energy * 0.25) * (live?.speed ?? 1);
    this.mesh.rotation.x = Math.sin(time * 0.17) * 0.25;
    this.group.position.x = f.pan * 1.5;
    this.group.position.y = Math.sin(time * 0.23) * 0.8;

    // rugosidad viva: en los agudos la superficie se vuelve más especular
    this.material.roughness = Math.max(0.03, this.cfg.roughness * (1.25 - f.treble * 0.6));
    if (this.material.transmission > 0) {
      this.material.thickness = this.cfg.thickness * (0.7 + f.bass * 0.9);
    }
    if (this.material.iridescence > 0) {
      this.material.iridescenceIOR = 1.3 + f.centroid * 0.7;
    }

    const a = time * 0.6;
    const lr = this.cfg.radius * 2.2;
    this.light.position.set(Math.cos(a) * lr, Math.sin(a * 0.7) * lr * 0.6, Math.sin(a) * lr);
    this.light.intensity = 120 + f.energy * 220 + f.kick * 180;
  }

  dispose() {
    this.scene.remove(this.group);
    this.geo.dispose();
    this.material.dispose();
    this.light.dispose();
  }
}
