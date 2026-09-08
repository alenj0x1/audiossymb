// Una "vibra" es la personalidad visual de una canción: qué capas existen, qué formas
// tienen, cómo se mueve la cámara y cómo se procesa la imagen. Se genera con un RNG
// sembrado por la canción y se ajusta con el ánimo detectado en el audio.
import { makeRng } from './seed.js';
import { generatePalette } from './palette.js';

const ADJ = [
  'Eléctrica', 'Líquida', 'Solar', 'Nocturna', 'Cristalina', 'Volcánica', 'Etérea', 'Magnética',
  'Salvaje', 'Boreal', 'Ácida', 'Cósmica', 'Hipnótica', 'Neón', 'Profunda', 'Radiante',
  'Sedosa', 'Ingrávida', 'Abisal', 'Iridiscente', 'Nebular', 'Fósil', 'Onírica', 'Vertiginosa',
  'Suspendida', 'Termal', 'Polar', 'Silente', 'Fluorescente', 'Migratoria',
];
const NOUN = [
  'marea', 'tormenta', 'nebulosa', 'aurora', 'corriente', 'galaxia', 'medusa', 'órbita',
  'colmena', 'cascada', 'espiral', 'fractura', 'prisma', 'constelación', 'pulsar', 'jungla',
  'deriva', 'bruma', 'seda', 'caverna', 'duna', 'laguna', 'membrana', 'cúpula',
  'garganta', 'archipiélago', 'resaca', 'catedral', 'enjambre', 'penumbra',
];

export const SHAPE_TYPES = ['ico', 'octa', 'tetra', 'torus', 'knot', 'ring', 'box', 'dodeca', 'sphere', 'capsule'];

// Todas las capas disponibles. La nebulosa es el lienzo de fondo y siempre está.
export const LAYER_KEYS = ['hero', 'nebula', 'aurora', 'liquid', 'flow', 'particles', 'rings', 'ribbons', 'tunnel', 'terrain', 'orbs', 'shapes', 'resonance'];

// Capas "de pantalla completa": son las más caras, así que nunca se activan todas juntas.
const HEAVY = ['aurora', 'liquid'];

export function generateVibe(seedKey, mood = null, variant = 0) {
  const rng = makeRng(`${seedKey}::${variant}`);
  const energy = mood?.energy ?? 0.5;
  const bassiness = mood?.bassiness ?? 0.5;
  const brightness = mood?.brightness ?? 0.5;
  const roughness = mood?.roughness ?? 0.4;

  // ---- selección de capas ----
  const layers = {};
  LAYER_KEYS.forEach(k => (layers[k] = false));
  layers.nebula = true;
  layers.resonance = true;

  // El protagonista manda: cuando está, el resto pasa a ser atmósfera y se recorta el
  // reparto. Once capas simultáneas competían entre sí; con jerarquía la escena respira.
  layers.hero = rng.chance(0.8);

  // como máximo una capa pesada, y no siempre
  const heavy = rng.chance(layers.hero ? 0.5 : 0.72) ? rng.pick(HEAVY) : null;
  if (heavy) layers[heavy] = true;

  // el resto se reparte por peso: las capas volumétricas llenan más pantalla
  const pool = [
    ['flow', 3.2], ['particles', 3.0], ['rings', 2.4], ['ribbons', 2.2],
    ['tunnel', 1.8], ['terrain', 2.2], ['orbs', 2.6], ['shapes', 2.0],
  ];
  const howMany = layers.hero ? rng.int(2, 4) : rng.int(4, 6);
  const picked = new Set();
  let guard = 0;
  while (picked.size < howMany && guard++ < 60) picked.add(rng.weighted(pool));
  picked.forEach(k => (layers[k] = true));

  // garantías estéticas: siempre algo de "polvo" y, con mucha energía, algo que golpee
  if (!layers.flow && !layers.particles) layers[rng.chance(0.6) ? 'flow' : 'particles'] = true;
  if (energy > 0.6 && rng.chance(0.7)) layers.shapes = true;
  if (energy < 0.32 && rng.chance(0.6)) { layers.orbs = true; layers.tunnel = false; }

  const palette = generatePalette(rng, mood);
  const symmetry = rng.weighted([[0, 5], [2, 2], [3, 2], [4, 3], [6, 2], [8, 1]]);

  const vibe = {
    seedKey,
    variant,
    name: `${rng.pick(ADJ)} ${rng.pick(NOUN)}`,
    palette,
    layers,
    speed: rng.range(0.7, 1.4) * (0.75 + energy * 0.5),
    paletteDrift: rng.range(0.5, 3.6) * rng.sign(),   // grados por segundo
    chromaColor: rng.chance(0.55),                    // la armonía de la canción mueve el matiz
    scale: rng.range(0.85, 1.25),                     // "zoom" general del mundo

    hero: {
      mode: rng.weighted([['glass', 4], ['iridescent', 3], ['chrome', 2], ['liquid', 2]]),
      radius: rng.range(4, 6.5),
      amp: rng.range(0.1, 0.3),          // relieve, como fracción del radio
      freq: rng.range(0.5, 1.4),         // escala del ruido: bajo = lóbulos grandes
      ripple: rng.range(2, 7),
      lobes: rng.pick([2, 3, 4, 5, 6, 8]),
      morph: rng.range(0, 0.6),          // 0 = esfera, 1 = silueta con lóbulos
      roughness: rng.range(0.03, 0.15),
      thickness: rng.range(1.1, 2.4),
      envIntensity: rng.range(1.5, 2.8),
    },
    nebula: {
      artMix: rng.range(0.3, 0.62),      // cuánto tiñe la portada el fondo
      scale: rng.range(0.28, 0.85),
      warp: rng.range(0.3, 1.05),
      rays: rng.range(0.25, 1.2) * (0.6 + brightness * 0.8),
      seed: rng.range(0, 100),
      intensity: rng.range(0.8, 1.15),
      layers: rng.int(3, 5),                          // octavas del FBM
      grain: rng.range(0.2, 0.7),
      horizon: rng.range(-0.35, 0.35),                // desplazamiento del degradado
      swirl: rng.range(0.2, 1.6) * rng.sign(),
      caustics: rng.chance(0.4) ? rng.range(0.15, 0.5) : 0,                    // vetas tipo agua
      style: rng.weighted([['flow', 4], ['veil', 3], ['cell', 2], ['smoke', 3]]),
    },
    aurora: {
      bands: rng.int(3, 6),
      height: rng.range(0.5, 1.5),
      softness: rng.range(0.25, 0.8),
      speed: rng.range(0.25, 0.9),
      tilt: rng.range(-0.6, 0.6),
      intensity: rng.range(0.32, 0.75) * (0.7 + brightness * 0.5),
      curtain: rng.range(0.3, 1.0),
    },
    liquid: {
      blobs: rng.int(5, 9),
      radius: rng.range(0.28, 0.5),
      smooth: rng.range(0.18, 0.42),                  // fusión suave entre formas
      orbit: rng.range(0.35, 0.85),
      thickness: rng.range(0.5, 1.4),
      rim: rng.range(0.35, 0.9),
      inner: rng.range(0.18, 0.55),
      speed: rng.range(0.25, 0.8),
    },
    flow: {
      count: rng.int(9000, 22000),
      scale: rng.range(0.09, 0.3),
      force: rng.range(1.6, 5.2),
      swirl: rng.range(0.6, 2.2) * rng.sign(),
      life: rng.range(3.5, 9),
      size: rng.range(0.7, 1.9),
      volume: rng.range(16, 34),                      // radio del volumen que ocupan
      trail: rng.range(0.2, 0.8),
    },
    particles: {
      count: rng.int(4000, 11000),
      shape: rng.weighted([[0, 5], [1, 3], [2, 1], [3, 3]]),
      distribution: rng.pick(['sphere', 'disc', 'cube', 'spiral', 'shell', 'ring', 'helix']),
      radius: rng.range(11, 22),
      spread: rng.range(4, 13) * (0.7 + bassiness * 0.6),
      swirl: rng.range(0.05, 0.5) * rng.sign(),
      size: rng.range(0.9, 2.3),
      gravity: rng.range(-0.4, 0.4),
    },
    rings: {
      count: rng.int(2, 5),
      symmetry: rng.pick([1, 2, 3, 4, 5, 6, 8, 12, 16]),
      tilt: rng.range(0, Math.PI * 0.5),
      baseRadius: rng.range(7, 13),
      amp: rng.range(4.5, 10),
      spin: rng.range(0.04, 0.42),
      width: rng.range(1.8, 5.5),                     // grosor del trazo, en píxeles
      mirror: rng.chance(0.5),                        // pareja reflejada en Z
      glow: rng.range(0.6, 1.3),
    },
    ribbons: {
      count: rng.int(2, 4),
      amp: rng.range(3, 9),
      width: rng.range(26, 46),
      thickness: rng.range(2.5, 8),
      twist: rng.range(0.2, 1.4),
      depth: rng.range(1.5, 6),
    },
    tunnel: {
      count: rng.int(30, 52),
      spacing: rng.range(2.4, 4.2),
      radius: rng.range(11, 20),
      sides: rng.pick([3, 4, 5, 6, 8, 12, 64]),
      twist: rng.range(-0.2, 0.2),
      width: rng.range(1.2, 3.6),
      squash: rng.range(0.6, 1.4),
    },
    terrain: {
      size: rng.range(46, 88),
      segments: rng.pick([96, 128, 160]),
      amp: rng.range(2.4, 6.5),
      height: rng.range(7, 15),                       // separación desde el centro
      mirror: rng.chance(0.72),                       // superficie reflejada arriba
      ripple: rng.range(0.4, 1.6),
      wire: rng.chance(0.55),
    },
    orbs: {
      count: rng.int(12, 28),
      size: rng.range(2.4, 7),
      spread: rng.range(16, 34),
      softness: rng.range(0.55, 0.95),
      drift: rng.range(0.05, 0.3),
      depthFade: rng.range(0.3, 0.9),
    },
    shapes: {
      type: rng.pick(SHAPE_TYPES),
      altType: rng.pick(SHAPE_TYPES),
      maxScale: rng.range(5, 13),
      life: rng.range(0.5, 1.4),
      spread: rng.range(5, 16),
      wire: rng.chance(0.7),
      shell: rng.chance(0.55),                        // capa de halo alrededor
    },
    camera: {
      mode: rng.weighted([['orbit', 4], ['drift', 3], ['dolly', 2], ['spiral', 2]]),
      distance: rng.range(24, 40),
      orbitSpeed: rng.range(0.02, 0.13) * rng.sign(),
      elevation: rng.range(0.05, 0.55),
      shake: rng.range(0.12, 0.6),
      fovPunch: rng.range(3, 12),
      roll: rng.chance(0.4) ? rng.range(0.02, 0.09) : 0,
      sway: rng.range(0.5, 3),                        // desplazamiento lateral con el estéreo
      breathe: rng.range(0.5, 2.5),
    },
    post: {
      bloomStrength: rng.range(0.35, 0.78),
      bloomRadius: rng.range(0.25, 0.6),
      bloomThreshold: rng.range(0.62, 0.88),
      trails: rng.chance(0.4) ? rng.range(0.35, 0.6) : 0,
      aberration: rng.range(0.6, 2.6),                // aberración cromática radial
      grain: rng.range(0.25, 0.8) * (0.6 + roughness * 0.7),
      vignette: rng.range(0.5, 1.05),
      saturation: rng.range(1.0, 1.3),
      contrast: rng.range(0.98, 1.12),
      mirror: symmetry,                               // 0 = sin caleidoscopio
      mirrorMix: symmetry ? rng.range(0.5, 1) : 0,
      mirrorSpin: rng.range(-0.09, 0.09),
      bleed: rng.range(0.03, 0.14),                    // halo de color en los bordes
      exposure: rng.range(1.5, 1.9),
    },
  };
  return vibe;
}

// Ajusta parámetros en vivo según el ánimo detectado (se llama periódicamente).
export function adaptVibeToMood(vibe, mood) {
  const e = mood.energy, b = mood.bassiness, br = mood.brightness ?? 0.5;
  vibe.live = {
    speed: vibe.speed * (0.7 + e * 0.8),
    bloom: vibe.post.bloomStrength * (0.72 + e * 0.65),
    trails: vibe.post.trails * (e < 0.35 ? 1.08 : 1),
    spread: vibe.particles.spread * (0.6 + b * 0.85),
    shake: vibe.camera.shake * (0.5 + b),
    grain: vibe.post.grain * (1.15 - e * 0.35),
    saturation: vibe.post.saturation * (0.94 + e * 0.14),
    aurora: vibe.aurora.intensity * (0.65 + br * 0.6),
    liquid: vibe.liquid.thickness * (0.75 + b * 0.5),
  };
  return vibe.live;
}
