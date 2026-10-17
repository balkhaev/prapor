import { expect, test } from 'bun:test';
import type { LiveEntity } from '../src/game/live';
import { liveObservedContact } from '../src/live-autobattle-ui';
import { liveNpcActivityLabel } from '../src/live-npc-activity';

const npc: LiveEntity = { id: 'scav-1', kind: 'scav', name: '<Косой>', x: 5, y: 5,
  appearance: 0, health: 80, action: 'moving', safeUntil: 0, role: 'patrol', npcActivity: 'travel' };

test('observed contact explains its activity without interpreting its name as markup', () => {
  const contact = liveObservedContact(npc, { x: 2, y: 5 }, npc.id);
  expect(contact).toContain('Идёт к соседнему посту');
  expect(contact).toContain('&lt;Косой&gt;');
  expect(contact).toContain('3.0 кл.');
  expect(contact).not.toContain('<Косой>');
});

test('old packets, downed NPCs, players and bosses get no invented activity', () => {
  for (const entity of [{ ...npc, npcActivity: undefined }, { ...npc, health: 0 },
    { ...npc, kind: 'player' as const }, { ...npc, bossId: 'lesnik' as const }]) {
    expect(liveNpcActivityLabel(entity)).toBeNull();
    expect(liveObservedContact(entity, npc, null)).not.toContain('Идёт к соседнему посту');
  }
});
