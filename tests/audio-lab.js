import { AudioEngine } from '../src/audio/engine.js';
import { Visualizer } from '../src/visual/renderer.js';
import { generateVibe } from '../src/visual/vibe.js';

const engine = new AudioEngine();
const vibe = generateVibe('sync-laboratory');
// Isolate the musical accents for visual QA without changing the user's saved scene.
for (const k in vibe.layers) vibe.layers[k] = ['hero', 'nebula', 'resonance', 'particles'].includes(k);
const viz = new Visualizer(document.querySelector('canvas'), vibe, 'medium');
let kind = '', count = { kick: 0, snare: 0, hat: 0 }, delays = [], last = 0, elapsed = 0, frames = 0;

function fixture(type) {
  const rate = 48000, duration = 12, channels = type === 'stereo' ? 2 : 1;
  const buffer = new ArrayBuffer(44 + rate * duration * channels * 2), view = new DataView(buffer);
  const str = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, buffer.byteLength - 44, true);
  let seed = 12345;
  for (let i = 0; i < duration * rate; i++) {
    const t = i / rate, x = (t - 0.5) % 0.5;
    let y = 0;
    if (t >= 0.5 && t < 10) {
      if (type === 'melody') {
        const fade = Math.min(1, (t - 0.5) * 2, (10 - t) * 2);
        y = (Math.sin(t * 440 * 2 * Math.PI) + Math.sin(t * 554.365 * 2 * Math.PI) * 0.5 + Math.sin(t * 659.255 * 2 * Math.PI) * 0.4) * 0.12 * fade;
      } else {
        y = x < 0.16 ? Math.sin(2 * Math.PI * 70 * x) * Math.exp(-x * 30) * 0.65 : 0;
        if (type === 'rhythm') {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const h = (t - 0.5) % 0.25;
          y += (seed / 4294967296 * 2 - 1) * Math.exp(-h * 120) * 0.10;
        }
      }
    }
    for (let c = 0; c < channels; c++) view.setInt16(44 + (i * channels + c) * 2, Math.max(-1, Math.min(1, y * (c ? -1 : 1))) * 32767, true);
  }
  return new File([buffer], `${type}.wav`, { type: 'audio/wav' });
}
for (const type of ['rhythm', 'melody', 'stereo']) document.getElementById(type).onclick = async () => {
  kind = type; count = { kick: 0, snare: 0, hat: 0 }; delays = []; elapsed = 0; frames = 0;
  try { await engine.loadFile(fixture(type)); } catch (e) { document.getElementById('report').textContent = e.message; }
};
document.getElementById('pause').onclick = () => engine.togglePlay();
function loop(now) {
  requestAnimationFrame(loop);
  if (now - last < 1000 / Number(document.getElementById('fps').value)) return;
  const dt = Math.min(0.2, (now - last) / 1000); last = now; elapsed += dt; frames++;
  const f = engine.update(dt); viz.update(f, dt);
  for (const e of f.sync?.events || []) {
    count[e.type]++;
    if (e.type === 'kick' && kind !== 'melody') {
      // Event timestamp compared to media time using the contemporaneous graph clock.
      const mediaEventTime = engine.currentTime - (engine.ctx.currentTime - e.time);
      const nearest = Math.round((mediaEventTime - 0.5) / 0.5) * 0.5 + 0.5;
      delays.push(Math.abs(mediaEventTime - nearest) * 1000);
    }
  }
  const mean = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;
  document.getElementById('report').textContent = JSON.stringify({
    source: kind, mode: f.sync?.mode, playing: engine.isPlaying, time: +engine.currentTime.toFixed(2),
    bpm: f.bpm, confidence: +f.tempoConfidence.toFixed(2), events: count,
    approximateTimingErrorMs: +mean.toFixed(1), fps: +(frames / elapsed).toFixed(1),
    character: f.sync?.character, harmonicity: +(f.harmonicity || 0).toFixed(2),
    context: Object.fromEntries(Object.entries(f.sync?.context || {}).map(([k, v]) => [k, +v.toFixed(2)])),
  }, null, 2);
}
requestAnimationFrame(loop);
