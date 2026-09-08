import test from 'node:test';
import assert from 'node:assert/strict';
import { spotifyDiscontinuity } from '../src/spotify/discontinuity.js';
import { PulseClock } from '../src/audio/sync.js';

const state = (id = 'a', position = 10000, playing = true) => ({ item: { id }, progressMs: position, isPlaying: playing });

test('Spotify track changes invalidate the previous song analysis', () => {
  assert.equal(spotifyDiscontinuity(state(), state('b', 0), 1000), 'track');
  assert.equal(spotifyDiscontinuity(null, state()), 'track');
  assert.equal(spotifyDiscontinuity(state(), { item: null }), 'track');
});
test('normal polling and modest network jitter preserve tempo acquisition', () => {
  assert.equal(spotifyDiscontinuity(state(), state('a', 11000), 1000), null);
  assert.equal(spotifyDiscontinuity(state(), state('a', 10700), 1000), null);
  assert.equal(spotifyDiscontinuity(state('a', 10000, false), state('a', 10000, false), 10000), null);
});
test('pause and resume invalidate queued impacts', () => {
  assert.equal(spotifyDiscontinuity(state(), state('a', 11000, false), 1000), 'playback');
  assert.equal(spotifyDiscontinuity(state('a', 10000, false), state()), 'playback');
});
test('seeking forward or backward starts a new musical context', () => {
  assert.equal(spotifyDiscontinuity(state(), state('a', 60000), 1000), 'seek');
  assert.equal(spotifyDiscontinuity(state(), state('a', 0), 1000), 'seek');
});
test('tempo is withheld when its confidence is insufficient', () => {
  const clock = new PulseClock();
  for (let i = 0; i < 20; i++) clock.add(i * 0.5);
  assert.equal(clock.sample(10).bpm, 120);
  clock.confidence = 0.32;
  assert.equal(clock.sample(10).bpm, 0);
});
test('a new passage after silence cannot inherit the previous tempo', () => {
  const clock = new PulseClock();
  for (let i = 0; i < 20; i++) clock.add(i * 0.5);
  clock.add(20);
  assert.equal(clock.sample(20).bpm, 0);
  for (let i = 1; i < 12; i++) clock.add(20 + i * 0.6);
  assert.ok(Math.abs(clock.sample(26.6).bpm - 100) < 0.1);
});
