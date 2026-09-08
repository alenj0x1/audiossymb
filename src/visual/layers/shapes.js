// Formas de golpe: en cada bombo nace una figura que se expande y se desvanece. En lugar de
// mallas planas usamos un sombreado de borde (Fresnel): la figura brilla en su silueta y se
// vuelve transparente de frente, así que parece una burbuja de luz y no un sólido pegado.
import * as THREE from 'three';
import { makeRng } from '../seed.js';

const POOL = 30;

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity, uRim, uCore, uPower;
varying vec3 vN;
varying vec3 vV;
void main() {
  // Normalized dot products can round above one. A negative base with fractional
  // uPower produces NaN, poisoning the additive scene and then the bloom chain.
  float facing = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  float f = pow(1.0 - facing, uPower);
  float a = (f * uRim + uCore) * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * (0.6 + f * 1.5), a);
}
`;

function makeGeometry(type) {
  switch (type) {
    case 'ico': return new THREE.IcosahedronGeometry(1, 1);
    case 'octa': return new THREE.OctahedronGeometry(1, 1);
    case 'tetra': return new THREE.TetrahedronGeometry(1, 1);
    case 'torus': return new THREE.TorusGeometry(1, 0.3, 16, 48);
    case 'knot': return new THREE.TorusKnotGeometry(0.8, 0.24, 96, 12);
    case 'ring': return new THREE.TorusGeometry(1, 0.06, 8, 64);
    case 'box': return new THREE.BoxGeometry(1.4, 1.4, 1.4, 3, 3, 3);
    case 'dodeca': return new THREE.DodecahedronGeometry(1, 1);
    case 'sphere': return new THREE.SphereGeometry(1, 32, 20);
    case 'capsule': return new THREE.CapsuleGeometry(0.7, 1.1, 8, 20);
    default: return new THREE.IcosahedronGeometry(1, 1);
  }
}

export class ShapeLayer {
  constructor(scene, vibe, palette) {
    this.scene = scene;
    this.cfg = vibe.shapes;
    this.rng = makeRng(`${vibe.seedKey}-shapes-${vibe.variant}`);
    this.geoA = makeGeometry(this.cfg.type);
    this.geoB = makeGeometry(this.cfg.altType);
    this.palette = palette;
    this.items = [];
    this.group = new THREE.Group();
    for (let i = 0; i < POOL; i++) {
      const uniforms = {
        uColor: { value: palette.colors[i % palette.colors.length].clone() },
        uOpacity: { value: 0 }, uRim: { value: 1 }, uCore: { value: 0.08 }, uPower: { value: 2.4 },
      };
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(i % 3 === 2 ? this.geoB : this.geoA, mat);
      mesh.visible = false;
      this.group.add(mesh);

      // halo exterior: una copia mayor y mucho más tenue que envuelve la figura
      let shell = null, su = null;
      if (this.cfg.shell) {
        su = {
          uColor: { value: uniforms.uColor.value },
          uOpacity: { value: 0 }, uRim: { value: 1 }, uCore: { value: 0 }, uPower: { value: 1.3 },
        };
        const smat = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: FRAG, uniforms: su,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
        });
        shell = new THREE.Mesh(mesh.geometry, smat);
        shell.visible = false;
        this.group.add(shell);
      }
      this.items.push({ mesh, shell, su, uniforms, life: 1, t: 0, grow: 1, spin: new THREE.Vector3(), colorIdx: i % palette.colors.length });
    }
    scene.add(this.group);
  }
  get root() { return this.group; }
  setPalette(p) {
    this.palette = p;
    this.items.forEach(it => it.uniforms.uColor.value.copy(p.colors[it.colorIdx % p.colors.length]));
  }
  spawn(strength, small = false) {
    const it = this.items.find(i => !i.mesh.visible)
      || this.items.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    const r = this.rng;
    const s = this.cfg.spread * (small ? 0.6 : 1);
    it.mesh.visible = true;
    if (it.shell) it.shell.visible = true;
    it.mesh.position.set(r.range(-s, s), r.range(-s * 0.65, s * 0.65), r.range(-s, s * 0.4));
    if (!small && r.chance(0.28)) it.mesh.position.set(0, 0, 0); // a veces, en el centro
    it.mesh.rotation.set(r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28));
    it.mesh.scale.setScalar(0.2);
    it.spin.set(r.range(-2, 2), r.range(-2, 2), r.range(-2, 2));
    it.life = this.cfg.life * (small ? 0.6 : 1) * r.range(0.8, 1.3);
    it.t = 0;
    it.grow = this.cfg.maxScale * (small ? 0.45 : 1) * (0.5 + strength);
    it.colorIdx = r.int(0, this.palette.colors.length - 1);
    it.uniforms.uColor.value.copy(this.palette.colors[it.colorIdx]);
    it.uniforms.uPower.value = small ? r.range(1.6, 2.6) : r.range(2.0, 3.6);
    it.uniforms.uCore.value = this.cfg.wire ? 0.02 : 0.1;
    it.mesh.material.wireframe = small ? !this.cfg.wire : this.cfg.wire;
    if (it.shell) {
      it.shell.position.copy(it.mesh.position);
      it.shell.rotation.copy(it.mesh.rotation);
      it.su.uColor.value = it.uniforms.uColor.value;
    }
  }
  update(f, dt, time, live) {
    if (f.onset) this.spawn(0.5 + f.kick * 0.8);
    if (f.snareOnset && f.energy > 0.25) this.spawn(0.4 + f.snare * 0.5, true);
    const speed = live?.speed ?? 1;
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt * speed;
      const k = Math.min(1, it.t / it.life);
      const ease = 1 - Math.pow(1 - k, 3);
      const scale = 0.2 + ease * it.grow;
      it.mesh.scale.setScalar(scale);
      it.uniforms.uOpacity.value = Math.pow(1 - k, 1.7) * (it.mesh.material.wireframe ? 0.75 : 0.5);
      it.mesh.rotation.x += it.spin.x * dt; it.mesh.rotation.y += it.spin.y * dt; it.mesh.rotation.z += it.spin.z * dt;
      if (it.shell) {
        it.shell.scale.setScalar(scale * (1.25 + f.kick * 0.15));
        it.shell.rotation.copy(it.mesh.rotation);
        it.shell.position.copy(it.mesh.position);
        it.su.uOpacity.value = Math.pow(1 - k, 2.2) * 0.3;
      }
      if (k >= 1) { it.mesh.visible = false; if (it.shell) it.shell.visible = false; }
    }
    this.group.rotation.y = time * 0.05;
    this.group.position.x = f.pan * 1.2;
  }
  dispose() {
    this.scene.remove(this.group);
    this.items.forEach(it => { it.mesh.material.dispose(); it.shell?.material.dispose(); });
    this.geoA.dispose(); this.geoB.dispose();
  }
}
