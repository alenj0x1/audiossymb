// Entorno HDR procedimental: un "estudio" construido a partir de la paleta (y, si está
// activo, de la portada del álbum) que se convierte en mapa de irradiancia con PMREM.
//
// Es la pieza que cambia el lenguaje visual. Hasta ahora todo era luz emisiva sumada; con
// un entorno, los materiales físicos tienen algo que reflejar y refractar: el cristal, el
// cromo y la iridiscencia empiezan a leerse como objetos iluminados y no como brillos.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uTop, uBottom, uKey, uFill, uRim;
uniform sampler2D uArt;
uniform float uArtMix;

float wrapAngle(float a) { return atan(sin(a), cos(a)); }

// Rectángulo de borde suave en coordenadas (azimut, elevación): un softbox de estudio.
// Los reflejos necesitan bordes definidos; con degradados puros el material queda como una
// mancha lisa y no se lee ni como cromo ni como cristal.
float softbox(float az, float el, float cx, float cy, float w, float h, float soft) {
  float bx = 1.0 - smoothstep(w - soft, w + soft, abs(wrapAngle(az - cx)));
  float by = 1.0 - smoothstep(h - soft, h + soft, abs(el - cy));
  return bx * by;
}

void main() {
  vec3 d = normalize(vDir);
  float az = atan(d.z, d.x);
  float el = asin(clamp(d.y, -1.0, 1.0));

  // degradado de fondo del estudio: claro arriba, profundo abajo
  vec3 col = mix(uBottom, uTop, smoothstep(-0.35, 0.7, d.y));

  // línea de horizonte: la raya nítida que delata una superficie especular
  float horizonDistance = el / 0.055;
  col += uTop * 0.7 * exp(-horizonDistance * horizonDistance);

  // softbox principal, arriba a la izquierda: dibuja el reflejo grande y reconocible
  col += uKey * softbox(az, el, 0.7, 0.78, 0.6, 0.34, 0.07) * 3.6;
  // relleno lateral alto y estrecho, al otro lado
  col += uFill * softbox(az, el, -2.0, 0.15, 0.24, 0.55, 0.09) * 1.9;
  // tira baja de contraluz: separa la silueta del fondo
  col += uRim * softbox(az, el, 3.0, -0.32, 1.0, 0.13, 0.11) * 2.1;

  // la portada, proyectada como panorama, se convierte en el mundo que refleja la escultura
  if (uArtMix > 0.01) {
    vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, d.y * 0.5 + 0.5);
    vec3 art = texture2D(uArt, uv).rgb;
    float l = dot(art, vec3(0.299, 0.587, 0.114));
    art = mix(vec3(l), art, 1.3) * 1.5;
    col = mix(col, art, uArtMix);
  }

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export class Environment {
  constructor(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.uniforms = {
      uTop: { value: new THREE.Color(0.5, 0.55, 0.7) },
      uBottom: { value: new THREE.Color(0.02, 0.02, 0.04) },
      uKey: { value: new THREE.Color(1, 1, 1) },
      uFill: { value: new THREE.Color(0.2, 0.3, 0.6) },
      uRim: { value: new THREE.Color(0.8, 0.2, 0.5) },
      uArt: { value: null },
      uArtMix: { value: 0 },
    };
    this.scene = new THREE.Scene();
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(8, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.BackSide,
      }),
    );
    this.scene.add(this.mesh);
    this.target = null;
    this.artMix = 0;
  }

  setArtwork(tex, mix = 0.35) {
    this.uniforms.uArt.value = tex;
    this.artMix = tex ? mix : 0;
  }

  // Reconstruye el mapa de irradiancia desde la paleta actual. Cuesta unos pocos ms, así
  // que el renderer lo llama con throttle, no en cada frame.
  build(palette, energy = 0.5) {
    const u = this.uniforms;
    // el cielo del estudio toma el acento más luminoso, muy desaturado y oscurecido
    u.uTop.value.copy(palette.colors[2]).lerp(new THREE.Color(0.55, 0.6, 0.72), 0.55).multiplyScalar(0.5 + energy * 0.35);
    u.uBottom.value.copy(palette.bg).multiplyScalar(2.5);
    u.uKey.value.copy(palette.colors[0]).lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(1.4 + energy * 0.8);
    u.uFill.value.copy(palette.colors[1]).multiplyScalar(0.85);
    u.uRim.value.copy(palette.colors[3 % palette.colors.length]).multiplyScalar(1.15);
    u.uArtMix.value = this.artMix;

    const prev = this.target;
    this.target = this.pmrem.fromScene(this.scene, 0.02);
    prev?.dispose();
    return this.target.texture;
  }

  dispose() {
    this.target?.dispose();
    this.pmrem.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
