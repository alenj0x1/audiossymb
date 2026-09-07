// Orquestador visual: escena Three.js, cámara con varias personalidades, once capas según
// la vibra y post-procesado (estelas → bloom → pase de imagen → salida).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { HeroLayer } from './layers/hero.js';
import { NebulaLayer } from './layers/nebula.js';
import { AuroraLayer } from './layers/aurora.js';
import { LiquidLayer } from './layers/liquid.js';
import { FlowLayer } from './layers/flow.js';
import { ParticleLayer } from './layers/particles.js';
import { RingLayer } from './layers/rings.js';
import { RibbonLayer } from './layers/ribbons.js';
import { TunnelLayer } from './layers/tunnel.js';
import { TerrainLayer } from './layers/terrain.js';
import { OrbLayer } from './layers/orbs.js';
import { ShapeLayer } from './layers/shapes.js';
import { GradeShader, KneeShader } from './grade.js';
import { Environment } from './environment.js';
import { artworkTexture } from './artwork.js';
import { PaletteBlender, paletteToCss, rotatePalette } from './palette.js';
import { adaptVibeToMood } from './vibe.js';

const QUALITY = {
  low: { pixelRatio: 0.7, particles: 0.4, bloomScale: 0.35, liquid: 0.4, terrain: 0.5, hero: 0.5, samples: 0 },
  medium: { pixelRatio: 1.2, particles: 0.8, bloomScale: 0.5, liquid: 0.75, terrain: 0.85, hero: 0.8, samples: 4 },
  high: { pixelRatio: 2, particles: 1.25, bloomScale: 0.75, liquid: 1.1, terrain: 1.2, hero: 1, samples: 4 },
};

export class Visualizer {
  constructor(canvas, vibe, quality = 'medium') {
    this.canvas = canvas;
    this.qualityName = quality;
    this.quality = QUALITY[quality] || QUALITY.medium;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    // AgX es la respuesta de curva que usa hoy el cine digital: mantiene el matiz en las
    // luces altas en lugar de arrastrarlo al blanco como hace ACES en una escena aditiva.
    this.renderer.toneMapping = THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.6;
    this.scene = new THREE.Scene();
    // entorno HDR procedimental: lo que hace posible el material físico del protagonista
    this.env = new Environment(this.renderer);
    this.lastEnvBuild = 0;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    this.time = 0;
    this.shake = new THREE.Vector3();
    this.shakeAmt = 0;
    this.smoothKick = 0;
    this.smoothPan = 0;
    this.beatPulse = 0;
    this.layers = [];
    this.layerMap = {};
    this.vibe = null;
    this.blender = new PaletteBlender(vibe.palette);
    this.paletteAngle = 0;
    this.tonicAngle = 0;
    this.lastCssPalette = 0;
    this.intensity = 1;
    // preferencias del usuario que modulan la vibra sin reemplazarla
    this.opts = { trails: 1, grain: 1, symmetry: true, chromaColor: true };
    this.target = new THREE.Vector3();

    // post-procesado. El target lleva MSAA: sin él, la escultura y los trazos gruesos
    // salen con el borde escalonado, porque el antialias del canvas no aplica cuando se
    // dibuja a un render target.
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.quality.samples,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.knee = new ShaderPass(KneeShader);
    this.afterimage = new AfterimagePass(0);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.2, 0.6, 0.15);
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.uRes.value = new THREE.Vector2(1, 1);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.knee);
    this.composer.addPass(this.afterimage);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.setVibe(vibe, true);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(name) {
    this.qualityName = name;
    this.quality = QUALITY[name] || QUALITY.medium;
    this.resize();
    if (this.vibe) this.setVibe(this.vibe, true);
  }

  // Multiplicador global de "cuánto pasa en pantalla" (control de la interfaz)
  setIntensity(v) { this.intensity = v; }

  // Ajustes del panel Visual: multiplicadores e interruptores sobre lo que propone la vibra
  setVisualOptions(partial) {
    Object.assign(this.opts, partial);
    if (this.vibe) this.afterimage.enabled = this.vibe.post.trails * this.opts.trails > 0.02;
    if (!this.opts.symmetry) this.grade.uniforms.uMirrorMix.value = 0;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(Math.floor(w * this.quality.bloomScale), Math.floor(h * this.quality.bloomScale));
    this.grade.uniforms.uRes.value.set(w * pr, h * pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const l of this.layers) {
      l.resize?.(w * pr, h * pr);          // shaders: píxeles reales del búfer
      l.setCssResolution?.(w, h);          // trazos: grosor en píxeles CSS
      l.setPixelRatio?.(pr);
    }
  }

  // Cambia la personalidad completa (nueva canción o "nueva vibra")
  setVibe(vibe, immediate = false) {
    for (const l of this.layers) l.dispose();
    this.layers = [];
    this.layerMap = {};
    this.vibe = vibe;
    this.live = adaptVibeToMood(vibe, { energy: 0.5, bassiness: 0.5, brightness: 0.5 });
    const p = this.blender.current;
    const q = this.quality;
    // Se crean todas las capas (para poder activarlas desde el panel); las que la vibra
    // no incluye quedan ocultas y no se actualizan.
    const add = (name, layer) => { this.layerMap[name] = layer; this.layers.push(layer); layer.root.visible = !!vibe.layers[name]; };
    add('nebula', new NebulaLayer(this.scene, vibe, p));
    add('hero', new HeroLayer(this.scene, vibe, p, q.hero));
    add('liquid', new LiquidLayer(this.scene, vibe, p, q.liquid));
    add('tunnel', new TunnelLayer(this.scene, vibe, p));
    add('terrain', new TerrainLayer(this.scene, vibe, p, q.terrain));
    add('flow', new FlowLayer(this.scene, vibe, p, q.particles));
    add('particles', new ParticleLayer(this.scene, vibe, p, q.particles));
    add('rings', new RingLayer(this.scene, vibe, p));
    add('ribbons', new RibbonLayer(this.scene, vibe, p));
    add('orbs', new OrbLayer(this.scene, vibe, p, q.particles));
    add('shapes', new ShapeLayer(this.scene, vibe, p));
    add('aurora', new AuroraLayer(this.scene, vibe, p));

    this.blender.setTarget(vibe.palette, immediate ? 0.01 : 2.5);
    this.paletteAngle = 0;
    this._buildEnvironment(p);
    for (const l of this.layers) l.setArtwork?.(this.artTex, this.artwork);

    const post = vibe.post;
    this.afterimage.uniforms.damp.value = post.trails * this.opts.trails;
    this.afterimage.enabled = post.trails * this.opts.trails > 0.02;
    this.bloom.radius = post.bloomRadius;
    this.bloom.threshold = post.bloomThreshold;
    const g = this.grade.uniforms;
    g.uAberration.value = post.aberration;
    g.uGrain.value = post.grain;
    g.uVignette.value = post.vignette;
    g.uSat.value = post.saturation;
    g.uContrast.value = post.contrast;
    g.uMirror.value = post.mirror;
    g.uMirrorMix.value = post.mirrorMix;
    g.uBleed.value = post.bleed;
    this.resize();
  }

  // Sustituye solo la paleta (por ejemplo, derivada de la portada del álbum)
  setPalette(palette, duration = 2.5) {
    this.vibe.palette = palette;
    this.paletteAngle = 0;
    this.blender.setTarget(palette, duration);
  }

  // La portada del álbum entra en la escena: tiñe el fondo, colorea las partículas por
  // posición y se convierte en el mundo que refleja y refracta la escultura.
  setArtwork(art) {
    this.artwork = art || null;
    this.artTex?.dispose();
    this.artTex = art ? artworkTexture(art) : null;
    this.env.setArtwork(this.artTex, 0.16);
    for (const l of this.layers) l.setArtwork?.(this.artTex, this.artwork);
    this._buildEnvironment(this.blender.current);
  }

  _buildEnvironment(palette) {
    const tex = this.env.build(palette, this.live?.bloom ?? 0.5);
    this.scene.environment = tex;
    for (const l of this.layers) l.setEnvironment?.(tex);
    this.lastEnvBuild = performance.now();
  }

  // Activa o desactiva una capa en vivo (panel de vibra)
  setLayerEnabled(name, enabled) {
    const l = this.layerMap[name];
    if (!l) return;
    l.root.visible = enabled;
    this.vibe.layers[name] = enabled;
  }

  // Paleta actual mezclada (para la interfaz)
  get currentPalette() { return rotatePalette(this.blender.current, this.paletteAngle + this.tonicAngle); }

  _updateCamera(f, dt, t) {
    const c = this.vibe.camera;
    this.smoothKick += (f.kick - this.smoothKick) * Math.min(1, dt * 12);
    this.smoothPan += (f.pan - this.smoothPan) * Math.min(1, dt * 2);
    if (f.onset) this.shakeAmt = Math.min(1.5, this.shakeAmt + this.live.shake * (0.5 + f.kick) * this.intensity);
    this.shakeAmt *= Math.exp(-dt * 6);
    this.shake.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(this.shakeAmt);

    const breathe = Math.sin(t * 0.11) * c.breathe;
    const zoom = -f.bass * 4 - this.smoothKick * 2 - this.beatPulse * 1.2;
    let dist = (c.distance + breathe + zoom) * this.vibe.scale;
    if (this.vibe.layers.hero) dist = Math.max(dist, this.vibe.hero.radius * 4.8);
    const el = Math.sin(t * 0.13) * c.elevation;
    const ang = t * c.orbitSpeed;
    const pos = this.camera.position;

    switch (c.mode) {
      case 'drift': {
        // deriva libre: la cámara vaga y mira a un punto que también se mueve
        pos.set(
          Math.sin(t * 0.17) * dist * 0.55 + this.smoothPan * c.sway * 2,
          Math.sin(t * 0.11) * dist * 0.22 + el * 6,
          dist * (0.75 + Math.sin(t * 0.07) * 0.2),
        );
        this.target.set(Math.sin(t * 0.23) * 3, Math.cos(t * 0.19) * 2, 0);
        break;
      }
      case 'dolly': {
        // avance frontal: entra y sale del centro con la música
        pos.set(
          Math.sin(t * 0.09) * 5 + this.smoothPan * c.sway * 2.5,
          Math.sin(t * 0.13) * 4,
          dist * (0.55 + 0.35 * Math.sin(t * 0.05)) - f.energy * 6,
        );
        this.target.set(0, Math.sin(t * 0.17) * 1.5, -8);
        break;
      }
      case 'spiral': {
        // espiral: gira mientras sube y baja, con el radio pulsando
        const rad = dist * (0.7 + 0.3 * Math.sin(t * 0.23));
        pos.set(
          Math.sin(ang * 2.2) * rad * Math.cos(el) + this.smoothPan * c.sway,
          Math.sin(t * 0.31) * dist * 0.35,
          Math.cos(ang * 2.2) * rad * Math.cos(el),
        );
        this.target.set(0, 0, 0);
        break;
      }
      default: {
        // órbita clásica alrededor del centro
        pos.set(
          Math.sin(ang) * dist * Math.cos(el) + this.smoothPan * c.sway,
          Math.sin(el) * dist + Math.sin(t * 0.21) * 2,
          Math.cos(ang) * dist * Math.cos(el),
        );
        this.target.set(0, 0, 0);
      }
    }
    pos.add(this.shake);
    this.camera.lookAt(this.target);
    if (c.roll) this.camera.rotation.z += Math.sin(t * 0.27) * c.roll * 4;
    const fov = 60 + f.bass * c.fovPunch * this.intensity + this.smoothKick * 3;
    if (Math.abs(fov - this.camera.fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  update(f, dt) {
    const vibe = this.vibe;
    const live = this.live;
    // ánimo → parámetros vivos (suavizado)
    if (f.active) {
      const target = adaptVibeToMood({ ...vibe }, f.mood);
      for (const k in target) live[k] += (target[k] - live[k]) * Math.min(1, dt * 0.5);
    }
    this.time += dt * live.speed;
    const t = this.time;
    if (f.beat) this.beatPulse = 1;
    this.beatPulse *= Math.exp(-dt * 4);

    // paleta: deriva lenta, salto en cada cambio de sección y matiz ligado a la armonía
    if (f.active) this.paletteAngle += vibe.paletteDrift * dt * (0.4 + f.energy);
    if (f.sectionChange) this.paletteAngle += 40 + Math.random() * 80;
    if (vibe.chromaColor && this.opts.chromaColor && f.active) {
      // la tónica detectada empuja el matiz: canciones en tonalidades distintas, colores distintos
      const wanted = f.tonic * 12 * f.tonicStrength;
      this.tonicAngle += (wanted - this.tonicAngle) * Math.min(1, dt * 0.6);
    } else {
      this.tonicAngle *= 1 - Math.min(1, dt * 0.5);
    }
    const changed = this.blender.update(dt);
    const now = performance.now();
    if (changed || now - this.lastCssPalette > 320) {
      const pal = rotatePalette(this.blender.current, this.paletteAngle + this.tonicAngle);
      for (const l of this.layers) l.setPalette(pal);
      paletteToCss(pal);
      this.lastCssPalette = now;
      // el entorno se rehace despacio: la paleta deriva de forma continua, pero un PMREM
      // por frame sería absurdo (y la irradiancia cambia demasiado lento para notarlo)
      if (now - this.lastEnvBuild > 3500) this._buildEnvironment(pal);
    }

    // capas
    for (const l of this.layers) if (l.root.visible) l.update(f, dt, t, live, this.camera);

    this._updateCamera(f, dt, t);

    // post
    const post = vibe.post;
    this.bloom.strength = live.bloom * (0.85 + f.energy * 0.5) * this.intensity + f.kick * 0.35;
    if (this.afterimage.enabled) {
      this.afterimage.uniforms.damp.value = Math.min(0.75, (live.trails + f.energy * 0.04) * this.opts.trails);
    }
    const g = this.grade.uniforms;
    g.uTime.value = t;
    g.uEnergy.value = f.energy;
    g.uKick.value = f.kick + f.snare * 0.4;
    g.uGrain.value = live.grain * this.opts.grain;
    g.uSat.value = live.saturation;
    g.uAberration.value = post.aberration * (0.7 + f.treble * 0.9) * this.intensity;
    g.uMirrorAngle.value = t * post.mirrorSpin;
    if (post.mirror > 1.5 && this.opts.symmetry) {
      // el caleidoscopio se abre con la energía: en pasajes suaves casi no se nota
      g.uMirrorMix.value = post.mirrorMix * (0.45 + f.energy * 0.55);
    } else {
      g.uMirrorMix.value = 0;
    }
    this.renderer.toneMappingExposure = post.exposure * (1.0 + f.energy * 0.22);

    this.composer.render();
  }
}
