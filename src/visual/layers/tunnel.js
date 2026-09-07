// Túnel: aros gruesos que avanzan hacia la cámara desde el fondo. Cada uno late con una
// banda del espectro y la velocidad la marca la energía. Los aros son estáticos en
// geometría (sólo cambian escala, color y grosor), así que salen prácticamente gratis.
import * as THREE from 'three';
import { NUM_BANDS } from '../../audio/features.js';
import { FatLine } from '../fatline.js';

export class TunnelLayer {
  constructor(scene, vibe, palette) {
    this.scene = scene;
    this.cfg = vibe.tunnel;
    this.palette = palette;
    this.group = new THREE.Group();
    this.group.position.z = -6;
    this.items = [];
    const sides = this.cfg.sides;
    const n = sides + 1;
    for (let i = 0; i < this.cfg.count; i++) {
      const fl = new FatLine(n, { width: this.cfg.width, opacity: 0.6 });
      const p = fl.points;
      for (let j = 0; j < n; j++) {
        const a = (j / sides) * Math.PI * 2 + (sides < 8 ? Math.PI / sides : 0);
        p[j * 3] = Math.cos(a);
        p[j * 3 + 1] = Math.sin(a) * this.cfg.squash;
        p[j * 3 + 2] = 0;
      }
      fl.commit();
      const obj = fl.object;
      obj.position.z = -i * this.cfg.spacing;
      obj.rotation.z = i * this.cfg.twist;
      obj.scale.setScalar(this.cfg.radius);
      this.group.add(obj);
      this.items.push({ fl, band: Math.floor((i / this.cfg.count) * NUM_BANDS), colorIdx: i % palette.colors.length });
    }
    this.depth = this.cfg.count * this.cfg.spacing;
    scene.add(this.group);
  }
  get root() { return this.group; }
  setCssResolution(w, h) { for (const it of this.items) it.fl.setResolution(w, h); }
  setPalette(p) { this.palette = p; }

  update(f, dt, time, live, camera) {
    // el túnel siempre se aleja de la cámara: su eje +z apunta hacia ella
    if (camera) this.group.lookAt(camera.position);
    const speed = (3 + f.energy * 28 + f.kick * 12) * (live?.speed ?? 1);
    const nCol = this.palette.colors.length;
    for (const it of this.items) {
      const obj = it.fl.object;
      obj.position.z += speed * dt;
      if (obj.position.z > 4) obj.position.z -= this.depth;
      const v = f.bands[it.band];
      const pk = f.bandsPeak[it.band];
      const depthFade = 1 - Math.min(1, -obj.position.z / this.depth);
      obj.scale.setScalar(this.cfg.radius * (1 + v * 0.5 + pk * 0.25 + f.kick * 0.15));
      it.fl.material.opacity = Math.min(0.75, 0.08 + v * 0.5 + pk * 0.24 + f.kick * 0.14) * depthFade;
      it.fl.material.linewidth = this.cfg.width * (0.6 + v * 1.4 + pk * 1.2);
      it.fl.material.color.copy(this.palette.colors[it.colorIdx % nCol]);
      obj.rotation.z += dt * (0.1 + f.treble * 0.7) * (it.band % 2 ? 1 : -1);
    }
    this.group.position.x = Math.sin(time * 0.23) * 2 + f.pan * 2.5;
    this.group.position.y = Math.cos(time * 0.19) * 1.5;
    this.group.rotateZ(Math.sin(time * 0.15) * 0.4);
  }
  dispose() { this.scene.remove(this.group); this.items.forEach(it => it.fl.dispose()); }
}
