# Pruebas con Spotify conectado

Sesión local del 7 de septiembre de 2026, vista previa en el puerto 5174. Se usó la cuenta que el usuario ya había conectado y su captura activa; no se descargaron canciones ni se extrajeron credenciales.

| Prueba | Observación |
| --- | --- |
| «ty 4 d love» — suei | Fuente Spotify, modo «Reloj de audio · 8 ms», carácter melódico. La estimación de tempo varió aproximadamente de 162 a 153 BPM durante el fragmento observado. |
| Siguiente → «55» — suei | Título, posición y paleta se actualizaron. El valor 153 BPM sobrevivió al cambio; después el panel mostró solo 32 % de confianza. |
| Pausa de «55» en 0:37 | Progreso detenido, carácter «En reposo», espectro del reproductor sin actividad visible y BPM finalmente vacío. |
| Reanudar y siguiente → «como en nuestra casa» — suei | Reproducción y portada se actualizaron; el pasaje inicial activó «Delicado». El tempo anterior reapareció, confirmando la necesidad de reiniciar el contexto por cambio de transporte. |
| Salto hacia atrás en «como en nuestra casa» | El transporte pasó de aproximadamente 1:21 al primer tramo y continuó avanzando; después se observó 0:55. Sin errores de consola observados. |
| Build actualizado en pestaña de prueba | Conectó con la sesión y mostró el tema/posición actuales sin errores de consola observados. Esa pestaña no tenía captura: indicó «Spotify · sin análisis», sin inventar un BPM. |

## Correcciones derivadas

- Nueva función `spotifyDiscontinuity`: distingue cambio de pista, pausa/reanudación y salto de posición respecto al avance esperado. Tolera hasta 2,5 s de diferencia para no reiniciar por cada fluctuación de sondeo.
- `applySpotifyState` reinicia el análisis y la línea temporal cuando hay una discontinuidad; mantiene conectado el stream de captura.
- El tempo se muestra solo con confianza de al menos 45 %. Después de más de 3 s sin ataques, el primer golpe inicia una nueva adquisición.
- Se añadieron seis pruebas de regresión: cambios de pista, sondeos normales, pausa/reanudación, saltos, baja confianza y adquisición de un tempo distinto después del silencio. Resultado: 18 pruebas totales aprobadas y compilación aprobada.

## Límites de esta sesión

Las observaciones con canciones reales se hicieron en la pestaña original, antes de recargar el build corregido. Se conservó esa pestaña para no cortar la captura que había autorizado el usuario. La corrección quedó compilada y comprobada por pruebas automatizadas; su prueba final sobre la captura de Spotify requiere cargar el build nuevo y volver a compartir el sonido si el navegador lo solicita.

No hay anotaciones de beats ni stems de estas canciones como referencia. Los BPM observados son salidas del estimador, no tempos reales verificados. La inspección del navegador demuestra actividad, transiciones y estados de interfaz; no establece un error de sincronización acústica en milisegundos ni una precisión de clasificación de instrumentos. Los tres temas observados son del mismo artista y no cubren jazz, reguetón y música acústica como conjunto de evaluación.

## Segunda sesión: Skrillex, 8 de septiembre

Se verificó en el DOM que la pestaña ya había cargado el build corregido `index-kTJNXkGi.js` y que la captura funcionaba en modo «Reloj de audio · 8 ms». Se observó «Diwali», de Skrillex, Naisha y BEAM, sin cambiar su reproducción.

| Posición | Bombo | Caja | Agudos | Armonía | Sostenido | Punteo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0:30 | 0,726 | 0,644 | 0,039 | 0,276 | 0,292 | 0,112 |
| 1:10 | 0,071 | 0,081 | 0,001 | 0,443 | 0,286 | 0,104 |
| 1:30 | 0,273 | 0,022 | ≈0 | 0,366 | 0,355 | 0,083 |
| 2:04 | 0,390 | 0,540 | 0,192 | 0,333 | 0,339 | 0,220 |
| 2:48 | 0,791 | 0,141 | 0,075 | 0,281 | 0,241 | 0,133 |

Son instantáneas de envolventes normalizadas, no porcentajes de acierto ni recuentos de golpes. La interfaz mostró «Intenso» al principio y «Rítmico» en las muestras posteriores. El tempo permaneció sin confirmar durante la mayor parte de las muestras, apareció como 134 BPM a 2:48 y volvió a estar vacío a 2:54: la adquisición todavía es inestable en este material. No se verificó el tempo real de la canción.

Después la reproducción pasó a «SYRINX», de Skrillex, RHR, Me Jesmay y Lucas Swatch. El usuario reportó un apagón intermitente de toda la pantalla. La investigación y la regresión GPU están documentadas en [render-blackout.md](render-blackout.md).
