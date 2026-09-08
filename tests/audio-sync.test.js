import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncDSP } from '../src/audio/sync-dsp.js';
import { AudioSync, PulseClock } from '../src/audio/sync.js';
import { FeatureExtractor } from '../src/audio/features.js';
import { directMusic } from '../src/visual/director.js';

function render(rate, seconds, signal, block = 128) {
  const dsp = new SyncDSP(rate), packets = [];
  for (let frame = 0; frame < seconds * rate; frame += block) {
    const data = Float32Array.from({ length: Math.min(block, seconds * rate - frame) }, (_, i) => signal((frame + i) / rate));
    dsp.process([data], frame, p => packets.push(p));
  }
  return packets;
}
const kick = t => {
  if (t < 0.5) return 0;
  const x = (t - 0.5) % 0.5;
  return x < 0.16 ? Math.sin(2 * Math.PI * 70 * x) * Math.exp(-x * 30) * 0.8 : 0;
};
const active = () => ({ ...FeatureExtractor.idle(), active: true });

for (const rate of [44100, 48000]) test(`kick recall and timing at ${rate} Hz`, () => {
  const events = render(rate, 6, kick).flatMap(p => p.events).filter(e => e.type === 'kick');
  assert.equal(events.length, 11);
  for (let i = 0; i < events.length; i++) {
    const delay = events[i].time - (0.5 + i * 0.5);
    assert.ok(delay >= 0 && delay < 0.025, `delay ${delay}`);
  }
});
test('silence and sustained tones do not invent repetitive drums', () => {
  assert.equal(render(48000, 2, () => 0).flatMap(p => p.events).length, 0);
  const events = render(48000, 3, t => t < 0.3 ? 0 : Math.sin(2 * Math.PI * 440 * t) * 0.2).flatMap(p => p.events);
  assert.equal(events.filter(e => e.time > 0.5).length, 0);
});
test('detection is invariant to processing block size', () => {
  const a = render(48000, 3, kick, 128).flatMap(p => p.events);
  const b = render(48000, 3, kick, 512).flatMap(p => p.events);
  assert.deepEqual(a, b);
});
test('tempo locks at 120 and expires after silence', () => {
  const c = new PulseClock();
  for (let i = 0; i < 20; i++) c.add(i * 0.5);
  assert.ok(Math.abs(c.sample(10).bpm - 120) < 0.1);
  assert.ok(c.sample(10).confidence > 0.9);
  assert.equal(c.sample(20).bpm, 0);
});
test('queue waits for output time, coalesces stereo, discards stale attacks and resets epochs', () => {
  const s = new AudioSync();
  const packet = { epoch: s.epoch, time: 1, rms: 0.2, events: [{ type: 'kick', time: 1, strength: 1 }] };
  s.ingest(packet); s.ingest(packet);
  assert.equal(s.enrich(active(), 0.016, 0.98, true).sync.events.length, 0);
  assert.equal(s.enrich(active(), 0.016, 1.01, true).sync.events.length, 1);
  assert.equal(s.enrich(active(), 0.016, 1.02, true).sync.events.length, 0);
  s.reset(); s.ingest(packet);
  assert.equal(s.queue.length, 0);
  s.ingest({ ...packet, epoch: s.epoch });
  assert.equal(s.enrich(FeatureExtractor.idle(), 0.016, 2, true).sync.events.length, 0);
});

test('right-channel silence cannot overwrite left-channel signal', () => {
  const s = new AudioSync();
  s.ingest({ epoch: s.epoch, time: 1, rms: 0.2, events: [] });
  s.ingest({ epoch: s.epoch, time: 1, rms: 0, events: [] });
  assert.equal(s.enrich(active(), 0.016, 1.01, true).sync.audible, true);
});

test('paused input does not emit impacts', () => {
  const s = new AudioSync();
  s.ingest({ epoch: s.epoch, time: 1, rms: 0.2, events: [{ type: 'kick', time: 1, strength: 1 }] });
  const f = s.enrich(FeatureExtractor.idle(), 0.016, 1.01, true);
  assert.equal(f.sync.events.length, 0); assert.equal(f.onset, false);
});

test('isolated high frequency bursts are hats, not kicks', () => {
  const packets = render(48000, 3, t => {
    if (t < 0.5) return 0;
    const x = (t - 0.5) % 0.25;
    return Math.sin(2 * Math.PI * 9000 * x) * Math.exp(-x * 120) * 0.5;
  });
  const events = packets.flatMap(p => p.events);
  assert.equal(events.filter(e => e.type === 'kick').length, 0);
  assert.equal(events.filter(e => e.type === 'hat').length, 10);
});

test('mid frequency attacks produce snare signatures', () => {
  const events = render(48000, 3, t => {
    if (t < 0.5) return 0;
    const x = (t - 0.5) % 0.5;
    return Math.sin(2 * Math.PI * 1600 * x) * Math.exp(-x * 70) * 0.5;
  }).flatMap(p => p.events);
  assert.equal(events.filter(e => e.type === 'snare').length, 5);
  assert.equal(events.filter(e => e.type === 'kick').length, 0);
});

test('low sample rate band edges stay inside FFT buffers', () => {
  const edges = FeatureExtractor.logEdges(28, 17000, 64, 16000, 4096);
  assert.ok(edges.at(-1) < 2048);
  for (let i = 1; i < edges.length; i++) assert.ok(edges[i] > edges[i - 1]);
});

test('musical direction preserves measured impacts while softening the atmosphere', () => {
  const s = new AudioSync();
  const f = s.enrich({ ...active(), energy: 0.8, kick: 1, onset: true }, 0.016, 1);
  const roles = directMusic(f);
  assert.equal(f.kick, 1);
  assert.ok(roles.atmosphere.kick < roles.detail.kick);
  assert.ok(roles.atmosphere.energy < f.energy);
  assert.equal(roles.harmony.chroma, f.chroma);
});
