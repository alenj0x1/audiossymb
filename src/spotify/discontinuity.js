// Poll and SDK updates share a transport timeline. Reset analysis only when that
// timeline changes, not on every poll (which would prevent tempo acquisition).
export function spotifyDiscontinuity(previous, next, elapsedMs = 0) {
  const before = previous?.item?.id, after = next?.item?.id;
  if (before !== after) return 'track';
  if (!after) return null;
  if (previous.isPlaying !== next.isPlaying) return 'playback';
  const expected = (previous.progressMs || 0) + (previous.isPlaying ? Math.max(0, elapsedMs) : 0);
  // Network/poller jitter is normal. Large jumps indicate seeking or restarting.
  if (Math.abs((next.progressMs || 0) - expected) > 2500) return 'seek';
  return null;
}
