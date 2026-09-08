// Musical roles keep sustained textures from punching on every drum hit.
export function directMusic(f) {
  if (!f.sync) return { atmosphere: f, detail: f, harmony: f };
  const c = f.sync.context;
  return {
    atmosphere: { ...f, energy: f.energy * (0.4 + c.sustain * 0.35), bass: f.bass * 0.5,
      kick: f.kick * 0.18, snare: f.snare * 0.12, beat: false },
    detail: { ...f, energy: f.energy * (0.3 + c.drive * 0.3 + c.percussion * 0.4),
      bass: f.bass * 0.55, kick: f.kick * 0.55 },
    harmony: { ...f, energy: f.energy * (0.35 + c.melody * 0.4 + c.sustain * 0.25),
      kick: f.kick * 0.2, snare: f.snare * 0.2 },
  };
}
export const MUSICAL_ROLES = {
  nebula: 'atmosphere', aurora: 'atmosphere', liquid: 'atmosphere',
  particles: 'detail', flow: 'detail', orbs: 'detail', ribbons: 'harmony', terrain: 'harmony',
};
