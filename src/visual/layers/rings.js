// Anillos espectrales: el espectro se dibuja radialmente con simetría N, en trazo grueso y
// con degradado de color. Cada anillo escucha una región de frecuencias, gira a su propio
// ritmo y puede tener un gemelo reflejado que le da profundidad.
import * as THREE from 'three';
import { NUM_BANDS } from '../../audio/features.js';
import { FatLine } from '../fatline.js';

const POINTS = 257; // el último punto repite el primero: el aro queda cerrado

export class RingLayer {
  constructor(scene, vibe, palette) {
    this.scene = scene;
    this.cfg = vibe.rings;
    this.group = new THREE.Group();
    this.group.rotation.x = this.cfg.tilt;
    this.rings = [];
    const total = this.cfg.count;
    for (let k = 0; k < total; k++) {
      const region = [
        Math.floor((k / total) * NUM_BANDS * 0.55),
        Math.floor(NUM_BANDS * (0.35 + (k + 1) / total * 0.65)),
      ];
      const mk = (mirror) => {
        const fl = new FatLine(POINTS, {
          width: this.cfg.width * (mirror ? 0.65 : 1) * (1 + k * 0.12),
          colors: true,
          opacity: mirror ? 0.5 : 0.9,
        });
        this.group.add(fl.object);
        return fl;
      };
      const item = {
        main: mk(false),
        mirror: this.cfg.mirror ? mk(true) : null,
        region, k,
        dir: k % 2 ? -1 : 1,
        colorA: k % palette.colors.length,
        colorB: (k + 2) % palette.colors.length,
        spin: 0,
      };
      this.rings.push(item);
    }
    this.palette = palette;
    scene.add(this.group);
  }
  get root() { return this.group; }
  setCssResolution(w, h) {
    for (const r of this.rings) { r.main.setResolution(w, h); r.mirror?.setResolution(w, h); }
  }
  setPalette(p) { this.palette = p; }

  update(f, dt, time, live) {
    const { symmetry, baseRadius, amp, glow } = this.cfg;
    const speed = live?.speed ?? 1;
    const pal = this.palette;
    const nCol = pal.colors.length;
    for (const r of this.rings) {
      const [b0, b1] = r.region;
      const span = Math.max(2, b1 - b0);
      const radius = baseRadius + r.k * 2.4 + f.bass * 2.8 + f.kick * 1.6;
      const ca = pal.colors[r.colorA % nCol], cb = pal.colors[r.colorB % nCol];
      const pos = r.main.points, col = r.main.colorArray;
      for (let i = 0; i < POINTS; i++) {
        const t = (i % (POINTS - 1)) / (POINTS - 1);
        // simetría: plegamos el espectro en espejo dentro de cada segmento
        let seg = (t * symmetry) % 1;
        const idx = Math.floor(t * symmetry);
        if (idx % 2 === 1) seg = 1 - seg;
        const bandF = b0 + seg * (span - 1);
        const bi = Math.floor(bandF), frac = bandF - bi;
        const i0 = Math.min(b1 - 1, bi), i1 = Math.min(b1 - 1, bi + 1);
        const v = f.bands[i0] * (1 - frac) + f.bands[i1] * frac;
        const pk = f.bandsPeak[i0] * (1 - frac) + f.bandsPeak[i1] * frac;
        const rad = radius + (v * amp + pk * amp * 0.45) * (1 + r.k * 0.28);
        const ang = t * Math.PI * 2;
        const o = i * 3;
        pos[o] = Math.cos(ang) * rad;
        pos[o + 1] = Math.sin(ang) * rad;
        pos[o + 2] = Math.sin(ang * symmetry + time) * (v * 1.8 + pk);
        // degradado: el color viaja alrededor del aro y se aclara en los picos
        const mixT = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + time * 0.6 + r.k);
        const boost = Math.min(1.15, 0.5 + v * 0.55 + pk * 0.5);
        col[o] = (ca.r + (cb.r - ca.r) * mixT) * boost;
        col[o + 1] = (ca.g + (cb.g - ca.g) * mixT) * boost;
        col[o + 2] = (ca.b + (cb.b - ca.b) * mixT) * boost;
      }
      r.main.commit(true);
      r.main.object.rotation.z += dt * this.cfg.spin * speed * r.dir * (1 + f.energy);
      r.main.material.opacity = Math.min(0.8, (0.22 + f.energy * 0.4 + f.kick * 0.16) * glow);

      if (r.mirror) {
        // el gemelo copia la forma pero se desplaza en Z y gira al contrario
        r.mirror.points.set(pos);
        const mp = r.mirror.points;
        for (let i = 0; i < POINTS; i++) mp[i * 3 + 2] = -pos[i * 3 + 2] - 3.5 - f.bass * 2;
        r.mirror.colorArray.set(col);
        r.mirror.commit(true);
        r.mirror.object.rotation.z -= dt * this.cfg.spin * speed * r.dir * 0.7;
        r.mirror.material.opacity = Math.min(0.4, (0.1 + f.energy * 0.22) * glow);
      }
    }
    this.group.rotation.y = Math.sin(time * 0.1) * 0.35;
    this.group.rotation.x = this.cfg.tilt + Math.sin(time * 0.07) * 0.12;
  }
  dispose() {
    this.scene.remove(this.group);
    this.rings.forEach(r => { r.main.dispose(); r.mirror?.dispose(); });
  }
}
