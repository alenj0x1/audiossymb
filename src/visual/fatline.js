// Trazo grueso reutilizable. Las líneas de 1 píxel (THREE.Line) son lo que más "envejece"
// un visualizador: aquí usamos Line2, que dibuja cada segmento como una banda con grosor
// real (en píxeles), con degradado de color y mezcla aditiva.
//
// Line2 guarda las posiciones en un buffer intercalado de segmentos; escribimos
// directamente en él en cada frame para no reasignar memoria 60 veces por segundo.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export class FatLine {
  constructor(count, { width = 3, colors = false, opacity = 1, worldUnits = false, blending = THREE.AdditiveBlending } = {}) {
    this.count = count;
    this.segments = count - 1;
    this.points = new Float32Array(count * 3);
    this.colorArray = colors ? new Float32Array(count * 3) : null;

    this.geometry = new LineGeometry();
    this.geometry.setPositions(this.points);
    if (this.colorArray) this.geometry.setColors(this.colorArray);

    this.material = new LineMaterial({
      color: 0xffffff,
      linewidth: width,
      worldUnits,
      transparent: true,
      opacity,
      depthWrite: false,
      blending,
      vertexColors: !!this.colorArray,
      dashed: false,
    });
    this.line = new Line2(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.computeLineDistances();

    this._posBuffer = this.geometry.attributes.instanceStart.data;
    this._colBuffer = this.colorArray ? this.geometry.attributes.instanceColorStart.data : null;
  }

  get object() { return this.line; }

  // Copia this.points (y los colores) al buffer intercalado de segmentos.
  commit(withColors = false) {
    const a = this._posBuffer.array;
    const p = this.points;
    for (let i = 0; i < this.segments; i++) {
      const o = i * 6, s = i * 3;
      a[o] = p[s]; a[o + 1] = p[s + 1]; a[o + 2] = p[s + 2];
      a[o + 3] = p[s + 3]; a[o + 4] = p[s + 4]; a[o + 5] = p[s + 5];
    }
    this._posBuffer.needsUpdate = true;
    if (withColors && this._colBuffer) {
      const c = this._colBuffer.array, q = this.colorArray;
      for (let i = 0; i < this.segments; i++) {
        const o = i * 6, s = i * 3;
        c[o] = q[s]; c[o + 1] = q[s + 1]; c[o + 2] = q[s + 2];
        c[o + 3] = q[s + 3]; c[o + 4] = q[s + 4]; c[o + 5] = q[s + 5];
      }
      this._colBuffer.needsUpdate = true;
    }
  }

  setResolution(w, h) { this.material.resolution.set(w, h); }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
