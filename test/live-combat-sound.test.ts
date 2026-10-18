import { expect, test } from 'bun:test';
import { LiveCombatSound } from '../src/live-combat-sound';
import type { GameSoundCue, GameSoundPosition } from '../src/game-sound';
import type { LiveSnapshot } from '../src/game/live';

const packet = (now = 1000) => ({ worldVersion: 'demo-1', now, entities: [{ id: 'a', visualLoadout: { weaponId: 'ak74' } }], events: [{ id: 'shot-1', kind: 'combat', at: 1000, actorId: 'a', targetId: 'b', from: { x: 3, y: 2 }, to: { x: 6, y: 2 }, damage: 0, impact: 'ground', text: 'Выстрел' }] } as LiveSnapshot);
const recorder = () => {
  const played: Array<{ cue: GameSoundCue; position?: GameSoundPosition }> = [];
  return { played, enabled: true, setEnabled: async () => true, destroy() {}, play(cue: GameSoundCue, position?: GameSoundPosition) { played.push({ cue, position }); } };
};

test('polling, muted history, hidden scenes and stale snapshots never replay shots', () => {
  const audio = new LiveCombatSound(), sound = recorder(), listener = { x: 2, y: 2 };
  audio.update(packet(), sound, listener, true); audio.update(packet(1100), sound, listener, true);
  expect(sound.played).toHaveLength(1);
  audio.clear(); sound.enabled = false; audio.update(packet(), sound, listener, true);
  sound.enabled = true; audio.update(packet(1100), sound, listener, true); expect(sound.played).toHaveLength(1);
  audio.clear(); audio.update(packet(), sound, listener, false); audio.update(packet(1100), sound, listener, true); expect(sound.played).toHaveLength(1);
  audio.clear(); audio.update(packet(2000), sound, listener, true); expect(sound.played).toHaveLength(1);
});

test('confirmed misses still sound, suppressors change timbre, distance and screen direction attenuate', () => {
  const audio = new LiveCombatSound(), sound = recorder(), snapshot = packet();
  audio.update(snapshot, sound, { x: 2, y: 2 }, true);
  expect(sound.played[0]!.cue).toBe('gunshot'); expect(sound.played[0]!.position!.pan).toBeGreaterThan(0);
  snapshot.events[0]!.id = 'shot-2'; snapshot.entities[0]!.visualLoadout!.weaponId = 'vss';
  audio.update(snapshot, sound, { x: 10, y: 2 }, true);
  expect(sound.played[1]!.cue).toBe('gunshot-muted');
  expect(sound.played[1]!.position!.pan).toBeLessThan(0);
  expect(sound.played[1]!.position!.gain).toBeLessThan(sound.played[0]!.position!.gain!);
  snapshot.events[0]!.id = 'shot-3'; audio.update(snapshot, sound, { x: 100, y: 2 }, true);
  expect(sound.played).toHaveLength(2);
});
