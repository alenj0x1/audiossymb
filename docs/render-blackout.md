# Corrección del apagón intermitente

El usuario reportó que toda la pantalla se ponía negra durante la prueba de música electrónica. Se encontró una vía reproducible de corrupción del procesamiento gráfico: valores NaN o infinitos en el buffer HDR entraban a la compresión de luces; el bloom los propagaba por el cuadro completo.

Cambios:

- El pase previo al bloom convierte componentes NaN/negativos en cero y limita los valores HDR positivos, incluidos infinitos, antes de calcular la compresión. Los infinitos positivos mantienen un brillo acotado en lugar de convertirse en negro.
- Las formas de percusión limitan el producto escalar de sus normales antes de elevar el Fresnel a una potencia fraccionaria. El redondeo por encima de uno podía producir una base negativa y un NaN.
- Los orbes y el entorno calculan cuadrados con multiplicación: `pow` con base negativa tiene resultado indefinido en GLSL, incluso si el exponente representa un entero.
- Las bases de las potencias del ruido de nebulosa quedan acotadas a valores no negativos.

## Regresión en GPU

Con el servidor de desarrollo, abrir `/tests/render-safety.html`. La prueba ejecuta los shaders y el bloom reales en GPU, introduce un único píxel problemático en un cuadro de 128 × 128 y compara la fórmula anterior con la corregida.

| Entrada | Píxeles inválidos antes | Píxeles inválidos después |
| --- | ---: | ---: |
| Normal | 0 | 0 |
| HDR extremo | 0 | 0 |
| Infinito positivo | 16.384 | 0 |
| NaN | 16.384 | 0 |
| Infinito negativo | 16.384 | 0 |

Con NaN e infinito negativo solo se descarta el píxel original; el resto del cuadro conserva su imagen. Con infinito positivo no queda ningún píxel negro. También se probaron los shaders reales de las formas con cuatro exponentes fraccionarios y normales alineadas: cero componentes inválidos.

La prueba reprodujo el mecanismo de apagón, aunque no se capturó el framebuffer exacto del incidente reportado. La escena compilada también se revisó con la vibra guardada y la demo, sin errores de consola observados. Las 18 pruebas de audio/Spotify y la compilación pasan.
