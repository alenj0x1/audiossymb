// Compresión de altas luces. Se aplica ANTES del bloom: la escena suma once capas en modo
// aditivo, así que sin esta rodilla los cruces de varias capas superan el blanco, el bloom
// los esparce y la imagen se lava. Con ella, el color sobrevive a cualquier acumulación.
export const KneeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uKnee: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uKnee;
    varying vec2 vUv;
    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      // La compresión se aplica al canal más alto y el resto se escala en proporción:
      // así el matiz y la saturación sobreviven. Comprimir cada canal por separado
      // arrastraría todas las luces hacia el blanco y la imagen saldría lechosa.
      float peak = max(max(t.r, t.g), t.b);
      float scaled = peak / (1.0 + peak * uKnee);
      gl_FragColor = vec4(t.rgb * (scaled / max(peak, 1e-4)), t.a);
    }
  `,
};

// Pase final de imagen. Sustituye al desplazamiento RGB uniforme (el efecto que más
// "envejecía" la escena) por un tratamiento de cámara moderno:
//   · caleidoscopio opcional de N sectores, mezclado con la imagen original
//   · aberración cromática radial (fuerte en los bordes, nula en el centro)
//   · sangrado de color: halo suave tomado de cuatro muestras alrededor
//   · saturación / contraste / viñeta suave
//   · grano fino y difuminado para que los degradados no se escalonen
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: [1, 1] },
    uTime: { value: 0 },
    uAberration: { value: 1 },
    uGrain: { value: 0.4 },
    uVignette: { value: 0.8 },
    uSat: { value: 1.1 },
    uContrast: { value: 1.03 },
    uMirror: { value: 0 },
    uMirrorMix: { value: 0 },
    uMirrorAngle: { value: 0 },
    uBleed: { value: 0.25 },
    uEnergy: { value: 0 },
    uKick: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uAberration, uGrain, uVignette, uSat, uContrast;
    uniform float uMirror, uMirrorMix, uMirrorAngle, uBleed, uEnergy, uKick;
    varying vec2 vUv;

    const float TAU = 6.28318530718;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    // Pliega las coordenadas en N sectores alrededor del centro (caleidoscopio).
    vec2 kaleido(vec2 uv, float sectors, float aspect, float spin) {
      vec2 c = uv - 0.5;
      c.x *= aspect;
      float a = atan(c.y, c.x) + spin;
      float r = length(c);
      float seg = TAU / sectors;
      a = mod(a, seg);
      a = abs(a - seg * 0.5);
      c = vec2(cos(a), sin(a)) * r;
      c.x /= aspect;
      return clamp(c + 0.5, 0.0, 1.0);
    }

    void main() {
      float aspect = uRes.x / max(uRes.y, 1.0);
      vec2 uv = vUv;

      // caleidoscopio: se mezcla con la imagen sin plegar para no perder legibilidad
      if (uMirror > 1.5 && uMirrorMix > 0.01) {
        vec2 folded = kaleido(uv, uMirror, aspect, uMirrorAngle);
        uv = mix(uv, folded, uMirrorMix);
      }

      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // aberración cromática radial + un empujón extra en cada golpe
      float ab = uAberration * (0.0016 + uKick * 0.0018) * (0.35 + r2 * 2.4);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - d * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + d * ab).b;

      // sangrado: cuatro muestras alejadas dan un halo de color muy suave
      if (uBleed > 0.01) {
        vec2 px = 2.5 / uRes;
        vec3 blur = texture2D(tDiffuse, uv + vec2(px.x, 0.0) * 3.0).rgb
                  + texture2D(tDiffuse, uv - vec2(px.x, 0.0) * 3.0).rgb
                  + texture2D(tDiffuse, uv + vec2(0.0, px.y) * 3.0).rgb
                  + texture2D(tDiffuse, uv - vec2(0.0, px.y) * 3.0).rgb;
        col += blur * 0.25 * uBleed * 0.5;
      }

      // saturación y contraste
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;

      // viñeta suave, un poco más abierta cuando sube la energía
      float vig = 1.0 - smoothstep(0.28, 0.95, length(d) * (1.35 - uEnergy * 0.2)) * uVignette;
      col *= vig;

      // grano fino animado + difuminado contra el escalonado
      float n = hash21(vUv * uRes + fract(uTime) * 137.0);
      col += (n - 0.5) * uGrain * 0.026;
      col += (hash21(vUv * uRes * 1.7 + fract(uTime * 0.7) * 53.0) - 0.5) / 255.0;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
