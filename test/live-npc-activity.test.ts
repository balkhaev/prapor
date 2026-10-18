import { expect, test } from 'bun:test';
import type { LiveEntity } from '../src/game/live';
import { liveObservedContact } from '../src/live-autobattle-ui';
import { liveFactionSiteLabel, liveNpcActivityLabel, liveNpcSquadLabel } from '../src/live-npc-activity';

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

test('visible squad role and expedition activity explain the actor without exposing identifiers or orders', () => {
  const squad = { ...npc, faction: 'scavs' as const, npcSquad: { id: 'squad-sawmill-scavs-2', leader: true } };
  for (const [npcActivity, label] of [
    ['travel', 'Идёт с отрядом'],
    ['assemble', 'Собирается с отрядом'], ['capture', 'Занимает точку'], ['forage', 'Ищет припасы'],
    ['haul', 'Несёт добычу на базу'], ['withdraw', 'Отступает с отрядом'],
    ['defend', 'Защищает базу'], ['reinforce', 'Идёт на помощь'], ['retake', 'Отбивает точку'],
  ] as const) {
    const contact = liveObservedContact({ ...squad, npcActivity }, npc, squad.id);
    expect(contact).toContain('Командир отряда 3');
    expect(contact).toContain(label);
    expect(contact).not.toContain(squad.npcSquad.id);
    expect(contact).not.toContain('members');
    expect(contact).not.toContain('target');
    for (const hidden of [{ ...squad, npcActivity, health: 0 }, { ...squad, npcActivity, kind: 'player' as const },
      { ...squad, npcActivity, bossId: 'lesnik' as const }]) expect(liveNpcActivityLabel(hidden)).toBeNull();
  }
  expect(liveNpcSquadLabel({ ...squad, npcSquad: { ...squad.npcSquad, leader: false } })).toBe('Боец отряда 3');
  for (const entity of [{ ...squad, npcSquad: undefined }, { ...squad, health: 0 },
    { ...squad, kind: 'player' as const }, { ...squad, bossId: 'lesnik' as const }]) expect(liveNpcSquadLabel(entity)).toBeNull();
});

test('observed site text describes ownership and contest without inventing progress or defenders', () => {
  const site = { id: 'visible-poi', x: 10, y: 10, kind: 'base' as const, owner: 'scavs' as const, contested: false };
  expect(liveFactionSiteLabel(site)).toBe('База диких');
  expect(liveFactionSiteLabel({ ...site, owner: 'raiders' })).toBe('База рейдеров');
  expect(liveFactionSiteLabel({ ...site, contested: true })).toBe('База диких · идёт бой за базу');
  expect(liveFactionSiteLabel({ ...site, owner: 'raiders', contested: true })).toBe('База рейдеров · идёт бой за базу');
  expect(liveFactionSiteLabel({ ...site, kind: 'control', owner: null })).toBe('Точка без владельца');
  expect(liveFactionSiteLabel({ ...site, kind: 'control', owner: 'raiders', contested: true })).toBe('Точка рейдеров · идёт бой за точку');
});
