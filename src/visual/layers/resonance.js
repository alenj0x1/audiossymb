import * as THREE from 'three';
import { FatLine } from '../fatline.js';
const REST = { melody: 0, sustain: 0, pluck: 0 };

// A small fixed pool: each measured attack has its own lifetime, independent of scene speed.
export class ResonanceLayer {
  constructor(scene, vibe, palette) {
    this.root = new THREE.Group(); scene.add(this.root);
    this.palette = palette; this.radius = vibe.hero?.radius || 5;
    this.cursor = 0; this.serial = 0;
    this.impacts = Array.from({ length: 18 }, () => {
      const line = new FatLine(65, { width: 2, opacity: 0 });
      this.root.add(line.object);
      return { line, age: 10, life: 1, type: 'kick', strength: 0, angle: 0 };
    });
    this.voices = Array.from({ length: 12 }, (_, pitch) => {
      const line = new FatLine(97, { width: 1.4, opacity: 0, colors: true });
      this.root.add(line.object);
      return { line, pitch, level: 0 };
    });
  }
  setPalette(palette) { this.palette = palette; }
  setCssResolution(w, h) { for (const item of [...this.impacts, ...this.voices]) item.line.setResolution(w, h); }
  update(f, dt, time, live, camera) {
    const sync = f.sync;
    const c = sync?.context || REST;
    if (sync && this.epoch !== sync.epoch) {
      this.epoch = sync.epoch;
      for (const p of this.impacts) { p.age = 10; p.started = -100; }
    }
    // Camera-facing accents surround the sculpture without obscuring its material.
    this.root.quaternion.copy(camera.quaternion);
    for (const e of sync?.events || []) {
      const p = this.impacts[this.cursor++ % this.impacts.length];
      p.age = 0; p.started = e.time; p.type = e.type; p.strength = e.strength;
      p.life = e.type === 'kick' ? 0.85 : e.type === 'snare' ? 0.42 : 0.23;
      p.angle = (++this.serial * 2.39996) + f.pan * 0.7;
      p.line.material.color.copy(this.palette.colors[e.type === 'kick' ? 0 : e.type === 'snare' ? 1 : 2]);
    }
    for (const p of this.impacts) {
      p.age = sync && p.started !== undefined ? Math.max(0, sync.time - p.started) : p.age + dt;
      const u = p.age / p.life;
      p.line.object.visible = u < 1;
      if (u >= 1) continue;
      const kick = p.type === 'kick';
      const radius = this.radius * (1.25 + u * (kick ? 3.5 : 2)) + p.strength;
      const arc = kick ? Math.PI * 2 : p.type === 'snare' ? 1.3 : 0.16;
      for (let i = 0; i < 65; i++) {
        const x = i / 64;
        const a = p.angle + x * arc;
        const r = radius + (kick ? 0 : Math.sin(x * Math.PI * 6) * 0.22 * (1 - u));
        p.line.points[i * 3] = Math.cos(a) * r;
        p.line.points[i * 3 + 1] = Math.sin(a) * r;
        p.line.points[i * 3 + 2] = -1 - u * 3;
      }
      p.line.material.opacity = (0.24 + p.strength * 0.35) * (1 - u) ** 2;
      p.line.material.linewidth = kick ? 1.5 + (1 - u) * 2 : 1.8;
      p.line.commit();
    }
    for (const v of this.voices) {
      const target = sync?.audible ? (f.chroma[v.pitch] || 0) * (c.melody * 0.65 + c.sustain * 0.35) : 0;
      v.level += (target - v.level) * (1 - Math.exp(-dt * 4));
      v.line.object.visible = v.level > 0.015;
      if (!v.line.object.visible) continue;
      const ca = this.palette.colors[v.pitch % this.palette.colors.length];
      const cb = this.palette.colors[(v.pitch + 1) % this.palette.colors.length];
      for (let i = 0; i < 97; i++) {
        const x = i / 96, a = x * Math.PI * 2;
        const radius = this.radius * (1.4 + v.pitch * 0.105) + Math.sin(a * 3 + time * 0.4 + v.pitch) * v.level * 1.8;
        const phase = a + v.pitch * 0.22;
        const wave = f.wave[Math.floor(x * (f.wave.length - 1))] || 0;
        const offset = i * 3;
        v.line.points[offset] = Math.cos(phase) * radius;
        v.line.points[offset + 1] = Math.sin(phase) * radius * (0.64 + c.sustain * 0.22) + wave * c.pluck * 2;
        v.line.points[offset + 2] = -3 + Math.sin(a * 2 + v.pitch * 0.5 + time * 0.2) * 2;
        const fade = Math.sin(x * Math.PI) ** 0.7;
        v.line.colorArray[offset] = (ca.r * (1 - x) + cb.r * x) * fade;
        v.line.colorArray[offset + 1] = (ca.g * (1 - x) + cb.g * x) * fade;
        v.line.colorArray[offset + 2] = (ca.b * (1 - x) + cb.b * x) * fade;
      }
      v.line.material.opacity = Math.min(0.38, v.level * 0.42);
      v.line.commit(true);
    }
  }
  dispose() {
    for (const item of [...this.impacts, ...this.voices]) item.line.dispose();
    this.root.removeFromParent();
  }
}
