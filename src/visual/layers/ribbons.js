// Cintas de onda: la forma de onda cruza el espacio de lado a lado como cintas gruesas de
// luz, con degradado a lo largo del recorrido y una torsión que las hace volumétricas.
import * as THREE from 'three';
import { FatLine } from '../fatline.js';

const POINTS = 192;

export class RibbonLayer {
  constructor(scene, vibe, palette) {
    this.scene = scene;
    this.cfg = vibe.ribbons;
    this.palette = palette;
    this.group = new THREE.Group();
    this.items = [];
    for (let k = 0; k < this.cfg.count; k++) {
      const fl = new FatLine(POINTS, {
        width: this.cfg.thickness * (1 - k * 0.12),
        colors: true,
        opacity: 0.8,
      });
      fl.object.rotation.z = (k / this.cfg.count) * Math.PI;
      this.group.add(fl.object);
      this.items.push({ fl, k, colorA: k % palette.colors.length, colorB: (k + 3) % palette.colors.length });
    }
    scene.add(this.group);
  }
  get root() { return this.group; }
  setCssResolution(w, h) { for (const it of this.items) it.fl.setResolution(w, h); }
  setPalette(p) { this.palette = p; }

  update(f, dt, time, live) {
    const wave = f.wave;
    const w = this.cfg.width;
    const amp = this.cfg.amp * (0.45 + f.energy) * (1 + f.kick * 0.6);
    const speed = live?.speed ?? 1;
    const nCol = this.palette.colors.length;
    const step = wave && wave.length ? wave.length / POINTS : 0;
    for (const it of this.items) {
      const pos = it.fl.points, col = it.fl.colorArray;
      const ca = this.palette.colors[it.colorA % nCol], cb = this.palette.colors[it.colorB % nCol];
      for (let i = 0; i < POINTS; i++) {
        const t = i / (POINTS - 1);
        const s = step ? wave[Math.floor(i * step)] : 0;
        const env = Math.sin(t * Math.PI);          // bordes atenuados
        const o = i * 3;
        pos[o] = (t - 0.5) * w;
        pos[o + 1] = s * amp * env * 2.4 + Math.sin(t * 6 + time * 1.3 + it.k) * 0.7;
        // torsión: la cinta se enrosca sobre su propio eje al avanzar
        pos[o + 2] = Math.cos(t * 4 * this.cfg.twist + time * 0.7 + it.k * 2) * (this.cfg.depth + f.mid * 5) * env;
        const mixT = 0.5 + 0.5 * Math.sin(t * 3.2 + time * 0.8 + it.k * 1.7);
        const boost = Math.min(1.2, (0.35 + Math.abs(s) * 1.5 + f.energy * 0.4)) * env;
        col[o] = (ca.r + (cb.r - ca.r) * mixT) * boost;
        col[o + 1] = (ca.g + (cb.g - ca.g) * mixT) * boost;
        col[o + 2] = (ca.b + (cb.b - ca.b) * mixT) * boost;
      }
      it.fl.commit(true);
      const obj = it.fl.object;
      obj.rotation.z += dt * 0.1 * speed * (it.k % 2 ? -1 : 1);
      obj.rotation.x = Math.sin(time * 0.3 + it.k) * 0.5;
      obj.rotation.y = Math.cos(time * 0.21 + it.k * 0.7) * 0.35;
      it.fl.material.linewidth = this.cfg.thickness * (1 - it.k * 0.12) * Math.min(1.5, 0.55 + f.energy * 0.7 + f.kick * 0.4);
      it.fl.material.opacity = Math.min(0.72, 0.2 + f.energy * 0.45);
    }
    this.group.rotation.y = Math.sin(time * 0.17) * 0.6;
    this.group.position.x = f.pan * 2;
  }
  dispose() { this.scene.remove(this.group); this.items.forEach(it => it.fl.dispose()); }
}
