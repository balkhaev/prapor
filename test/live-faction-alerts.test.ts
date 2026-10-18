import { describe, expect, test } from 'bun:test';
import { buildNpcSquadPlans, advanceNpcSquads, createNpcSquadState, restoreNpcSquadState, type NpcSquadActor, type NpcSquadPlan, type NpcSquadState, type NpcTerritoryPlan } from '../server/live-squads';
import { createNpcFactionAlerts, recordNpcBaseContact, recordNpcTerritoryLoss, restoreNpcFactionAlerts,
  NPC_BASE_ALARM_QUIET_MS, NPC_RESPONSE_MUSTER_MS, NPC_RETAKE_DELAY_MS, NPC_RESPONSE_MISSION_MS, NPC_RESPONSE_RETURN_MS, NPC_RETAKE_EXPIRES_MS } from '../server/live-faction-alerts';
import { createLiveNavigation } from '../server/live-navigation';
import { getLiveMap } from '../src/game/live-maps';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';

const NOW = 1_800_000_000_000;
function fixture(count = 3) {
  const plans: NpcSquadPlan[] = Array.from({ length: count }, (_, index) => ({ id: `squad-${index}`, faction: 'scavs', districtId: 'customs',
    baseId: `base-${index}`, base: { x: 10 + index * 40, y: 10 }, memberIds: [`member-${index}-a`, `member-${index}-b`], spawnIndices: [index * 2, index * 2 + 1],
    rallyPoints: [{ x: 10 + index * 40, y: 10 }, { x: 12 + index * 40, y: 10 }],
    targets: [{ territoryId: 'enemy', point: { x: 170, y: 10 }, pathLength: 160 - index * 40, hasSupplies: true },
      { territoryId: 'other', point: { x: 180, y: 10 }, pathLength: 170 - index * 40, hasSupplies: false }], responseTargets: [] }));
  const territories: NpcTerritoryPlan[] = [...plans.map(plan => ({ id: plan.baseId, poiId: plan.baseId, districtId: plan.districtId, point: plan.base, initialOwner: plan.faction })),
    { id: 'enemy', poiId: 'enemy', districtId: 'customs', point: { x: 170, y: 10 }, initialOwner: 'scavs' }];
  for (const plan of plans) plan.responseTargets = territories.filter(site => site.id !== plan.baseId).map(site => ({ territoryId: site.id, point: site.point,
    pathLength: Math.abs(site.point.x - plan.base.x), kind: site.id.startsWith('base-') ? 'base' : 'control' }));
  const actors = new Map<string, NpcSquadActor>(plans.flatMap(plan => plan.memberIds.map((id, index) => [id, { id, ...plan.rallyPoints[index]!, health: 100, lifeCycle: 2, carried: false, canForage: false, inCombat: false }] as const)));
  const states = new Map(plans.map(plan => [plan.id, { ...createNpcSquadState(plan, NOW), restUntil: NOW + 900_000 }]));
  const owners = new Map<string, 'scavs' | 'raiders' | null>(territories.map(site => [site.id, site.id === 'enemy' ? 'raiders' : site.initialOwner]));
  const alerts = createNpcFactionAlerts();
  return { plans, territories, actors, states, owners, alerts,
    step: (now = NOW) => advanceNpcSquads(plans, states, actors, owners, now, alerts) };
}
function beginRoutine(f: ReturnType<typeof fixture>, index: number) {
  const plan = f.plans[index]!, state = f.states.get(plan.id)!;
  Object.assign(state, { phase: 'travel', missionKind: 'capture', targetId: 'other', leaderId: plan.memberIds[0],
    members: plan.memberIds.map(id => ({ id, lifeCycle: f.actors.get(id)!.lifeCycle })), missionUntil: NOW + 240_000, phaseUntil: NOW + 240_000 });
}

describe('finite faction alarms and loss responses', () => {
  test('one local garrison and one physically mustered nearest helper respond without moving any body', () => {
    const f = fixture(), home = f.plans[0]!, helper = f.plans[1]!;
    const before = JSON.stringify([...f.actors]);
    const alarm = recordNpcBaseContact(f.alerts, home.baseId, 'scavs', NOW), first = f.step();
    expect(first[0]!.missionKind).toBe('defend'); expect(first[0]!.phase).toBe('objective'); expect(first[0]!.directives[0]!.activity).toBe('defend');
    expect(first[1]!.phase).toBe('assemble'); expect(first[1]!.targetId).toBe(home.baseId); expect(first[2]!.phase).toBe('rest');
    expect(alarm.homeRecalled).toBe(true); expect(alarm.helperSquadId).toBe(helper.id);
    expect(JSON.stringify([...f.actors])).toBe(before);
    expect(f.step(NOW + NPC_RESPONSE_MUSTER_MS - 1)[1]!.phase).toBe('assemble');
    const departing = f.step(NOW + NPC_RESPONSE_MUSTER_MS)[1]!;
    expect(departing.phase).toBe('travel'); expect(departing.directives[0]!.activity).toBe('reinforce');
    expect(departing.directives[0]!.destination).toEqual(home.base);
    expect(f.states.get(helper.id)!.members.map(member => member.lifeCycle)).toEqual([2, 2]);
  });

  test('active home recall preserves its exact manifest and physical cargo, with no incident reinforcements after casualties', () => {
    const f = fixture(), home = f.plans[0]!; beginRoutine(f, 0);
    for (const id of home.memberIds) { const actor = f.actors.get(id)!; actor.x += 15; actor.carried = true; }
    const manifest = structuredClone(f.states.get(home.id)!.members), before = JSON.stringify([...f.actors]);
    recordNpcBaseContact(f.alerts, home.baseId, 'scavs', NOW);
    expect(f.step()[0]!.missionKind).toBe('defend'); expect(f.states.get(home.id)!.members).toEqual(manifest);
    expect(JSON.stringify([...f.actors])).toBe(before);
    f.actors.get(home.memberIds[0]!)!.lifeCycle++;
    const casualty = f.step(NOW + 500)[0]!;
    expect(casualty.retreating).toBe(true); expect(casualty.memberIds).toEqual([home.memberIds[1]!]);
    expect(f.alerts.alarms[0]!.homeRecalled).toBe(true);
  });

  test('continuous contact and restart keep the spent helper budget; a genuine quiet interval permits a new episode', () => {
    const f = fixture(), home = f.plans[0]!, alarm = recordNpcBaseContact(f.alerts, home.baseId, 'scavs', NOW); f.step();
    const helperId = alarm.helperSquadId;
    for (const id of f.plans[1]!.memberIds) f.actors.get(id)!.health = 0;
    for (let index = 1; index <= 8; index++) {
      const time = NOW + index * 50_000;
      expect(recordNpcBaseContact(f.alerts, home.baseId, 'scavs', time).id).toBe(alarm.id);
      f.step(time);
      expect(f.alerts.alarms[0]!.helperSquadId).toBe(helperId); expect(f.states.get(f.plans[2]!.id)!.responseId).toBeNull();
      const restored = restoreNpcFactionAlerts(f.plans, f.territories, JSON.parse(JSON.stringify(f.alerts)), time);
      expect(restored.alarms[0]!.helperSquadId).toBe(helperId); Object.assign(f.alerts, restored);
    }
    const renewed = recordNpcBaseContact(f.alerts, home.baseId, 'scavs', NOW + 400_000 + NPC_BASE_ALARM_QUIET_MS);
    expect(renewed.id).not.toBe(alarm.id); expect(renewed.helperSquadId).toBeNull();
  });

  test('loaded, wounded, absent and fighting support bodies do not qualify as physical reinforcements', () => {
    const f = fixture(), home = f.plans[0]!;
    f.actors.get(f.plans[1]!.memberIds[0]!)!.carried = true;
    f.actors.get(f.plans[2]!.memberIds[0]!)!.x += 7;
    recordNpcBaseContact(f.alerts, home.baseId, 'scavs', NOW); f.step();
    expect(f.alerts.alarms[0]!.helperSquadId).toBeNull();
    const helper = f.actors.get(f.plans[1]!.memberIds[0]!)!; helper.carried = false; helper.health = 39;
    f.step(NOW + 500); expect(f.alerts.alarms[0]!.helperSquadId).toBeNull();
    helper.health = 100; helper.inCombat = true;
    f.step(NOW + 1000); expect(f.alerts.alarms[0]!.helperSquadId).toBeNull();
    helper.inCombat = false;
    f.step(NOW + 1500); expect(f.alerts.alarms[0]!.helperSquadId).toBe(f.plans[1]!.id);
  });

  test('a disrupted response muster needs another quiet eight seconds physically at home', () => {
    const f = fixture(), helper = f.plans[1]!;
    recordNpcBaseContact(f.alerts, f.plans[0]!.baseId, 'scavs', NOW); f.step();
    const actor = f.actors.get(helper.memberIds[0]!)!; actor.inCombat = true;
    f.step(NOW + 4000); actor.inCombat = false;
    expect(f.step(NOW + 8000)[1]!.phase).toBe('assemble');
    expect(f.step(NOW + 12_000)[1]!.phase).toBe('travel');
    expect(f.states.get(helper.id)!.missionUntil).toBe(NOW + NPC_RESPONSE_MISSION_MS);
  });

  test('a lone local defender can hold home without increasing the two-expedition cap, including after quiet', () => {
    const f = fixture(4), home = f.plans[0]!;
    f.actors.get(home.memberIds[1]!)!.health = 0; beginRoutine(f, 2); beginRoutine(f, 3);
    recordNpcBaseContact(f.alerts, home.baseId, 'scavs', NOW); const active = f.step();
    expect(active[0]!.phase).toBe('objective'); expect(active[0]!.memberIds).toHaveLength(1);
    expect(active[1]!.phase).toBe('rest'); expect(f.alerts.alarms[0]!.helperSquadId).toBeNull();
    expect([...f.states.values()].filter(state => state.phase !== 'rest' && !state.localDefense)).toHaveLength(2);
    f.actors.get(home.memberIds[0]!)!.x += 7;
    const quiet = f.step(NOW + NPC_BASE_ALARM_QUIET_MS);
    expect(quiet[0]!.phase).toBe('return'); expect(f.states.get(home.id)!.localDefense).toBe(true);
    expect([...f.states.values()].filter(state => state.phase !== 'rest' && !state.localDefense)).toHaveLength(2);
  });

  test('an actual ownership loss schedules one delayed physical retake and a failed cycle cannot become generic capture waves', () => {
    const f = fixture(), order = recordNpcTerritoryLoss(f.alerts, 'enemy', 'scavs', 'raiders', NOW)!;
    expect(recordNpcTerritoryLoss(f.alerts, 'enemy', 'scavs', 'raiders', NOW)!.id).toBe(order.id);
    expect(f.step(NOW + NPC_RETAKE_DELAY_MS - 1).every(decision => decision.phase === 'rest')).toBe(true);
    f.step(NOW + NPC_RETAKE_DELAY_MS);
    expect(order.status).toBe('assigned'); expect(order.assignedSquadId).toBe(f.plans[2]!.id);
    const plan = f.plans[2]!, state = f.states.get(plan.id)!;
    expect(state.missionKind).toBe('retake'); expect(state.phase).toBe('assemble');
    f.step(NOW + NPC_RETAKE_DELAY_MS + NPC_RESPONSE_MUSTER_MS);
    expect(state.phase).toBe('travel');
    for (const id of plan.memberIds) f.actors.get(id)!.x = 150 + plan.memberIds.indexOf(id) * 2;
    f.actors.get(plan.memberIds[0]!)!.health = 0;
    f.step(NOW + 30_000); f.step(NOW + 30_500);
    expect(order.status).toBe('spent'); expect(state.phase).toBe('return');
    for (const other of f.plans.slice(0, 2)) f.states.get(other.id)!.restUntil = NOW;
    const routine = f.step(NOW + 31_000);
    expect(routine.every(decision => decision.targetId !== 'enemy' || decision.squadId === plan.id)).toBe(true);
    const restored = restoreNpcFactionAlerts(f.plans, f.territories, JSON.parse(JSON.stringify(f.alerts)), NOW + 32_000);
    expect(restored.losses[0]!.status).toBe('spent');
    f.owners.set('enemy', 'scavs'); f.step(NOW + 33_000); expect(f.alerts.losses).toHaveLength(0);
    const newCycle = recordNpcTerritoryLoss(f.alerts, 'enemy', 'scavs', 'raiders', NOW + 34_000)!;
    expect(newCycle.id).not.toBe(order.id);
  });

  test('stale pending losses retire and response missions/returns retain fixed finite deadlines', () => {
    const f = fixture(), home = f.plans[0]!;
    for (const actor of f.actors.values()) actor.health = 39;
    const loss = recordNpcTerritoryLoss(f.alerts, 'enemy', 'scavs', 'raiders', NOW)!;
    f.step(NOW + NPC_RETAKE_EXPIRES_MS); expect(loss.status).toBe('spent'); expect(loss.assignedSquadId).toBeNull();
    expect(recordNpcTerritoryLoss(f.alerts, 'enemy', null, 'raiders', NOW)).toBeNull();
    for (const actor of f.actors.values()) actor.health = 100;
    const alarm = recordNpcBaseContact(f.alerts, home.baseId, 'scavs', NOW); f.step();
    const helper = f.plans[1]!, state = f.states.get(helper.id)!;
    expect(state.missionUntil).toBe(NOW + NPC_RESPONSE_MISSION_MS);
    f.step(NOW + NPC_RESPONSE_MUSTER_MS);
    for (const id of helper.memberIds) f.actors.get(id)!.x -= 15;
    alarm.lastContactAt = NOW + NPC_RESPONSE_MISSION_MS;
    f.step(NOW + NPC_RESPONSE_MISSION_MS);
    expect(state.phase).toBe('return'); expect(state.returnUntil).toBe(NOW + NPC_RESPONSE_MISSION_MS + NPC_RESPONSE_RETURN_MS);
    const before = JSON.stringify([...f.actors]);
    f.step(state.returnUntil); expect(state.phase).toBe('rest'); expect(JSON.stringify([...f.actors])).toBe(before);
  });

  test('an already travelling generic capture cannot bypass a newly recorded loss cycle', () => {
    const f = fixture(), plan = f.plans[0]!; beginRoutine(f, 0);
    const state = f.states.get(plan.id)!; state.targetId = 'enemy';
    for (const id of plan.memberIds) f.actors.get(id)!.x += 15;
    recordNpcTerritoryLoss(f.alerts, 'enemy', 'scavs', 'raiders', NOW);
    expect(f.step()[0]!.phase).toBe('return'); expect(state.outcome).toBe('unavailable');
    expect(f.alerts.losses[0]!.status).toBe('pending');
  });

  test('restore migrates old squad state and rejects malformed response state without resetting valid incident budgets', () => {
    const f = fixture(), home = f.plans[0]!; recordNpcBaseContact(f.alerts, home.baseId, 'scavs', NOW); f.step();
    const saved = JSON.parse(JSON.stringify(f.states.get(home.id))) as NpcSquadState;
    expect(restoreNpcSquadState(home, saved, NOW + 1000)).toEqual(saved);
    expect(restoreNpcSquadState(home, { ...saved, responseId: null }, NOW + 1000).phase).toBe('rest');
    expect(restoreNpcSquadState(home, { ...saved, departAfter: -1 }, NOW + 1000).phase).toBe('rest');
    const old = createNpcSquadState(home, NOW); delete old.responseId; delete old.departAfter; delete old.localDefense;
    expect(restoreNpcSquadState(home, old, NOW + 1000).responseId).toBeNull();
    const bad = structuredClone(f.alerts); bad.alarms[0]!.helperSquadId = 'nonexistent';
    expect(restoreNpcFactionAlerts(f.plans, f.territories, bad, NOW + 1000).alarms).toHaveLength(0);
    expect(restoreNpcFactionAlerts(f.plans, f.territories, undefined, NOW)).toEqual(createNpcFactionAlerts());
    const lowered = structuredClone(f.alerts); lowered.nextEpoch = 1; lowered.alarms[0]!.id = 'base-40';
    const repaired = restoreNpcFactionAlerts(f.plans, f.territories, lowered, NOW + 1000);
    expect(repaired.nextEpoch).toBe(41);
    expect(recordNpcBaseContact(repaired, f.plans[2]!.baseId, 'scavs', NOW + 1000).id).toBe('base-41');
  });

  test('response-only routes cover all initially capturable lost points without changing recruitment or routine routes', () => {
    const world = getLiveMap('perimeter'), navigation = createLiveNavigation(world), arenas = getLiveBossArenas(world);
    const { squads, territories } = buildNpcSquadPlans(world, navigation, point => arenas.some(({ area }) => point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height));
    expect(squads).toHaveLength(23); expect(new Set(squads.flatMap(plan => plan.memberIds)).size).toBe(50);
    const bases = new Set(squads.map(plan => plan.baseId));
    const capturable = territories.filter(site => !bases.has(site.id) && squads.some(plan => plan.faction !== site.initialOwner && plan.targets.some(target => target.territoryId === site.id)));
    expect(capturable).toHaveLength(31);
    for (const site of capturable) expect(squads.some(plan => plan.faction === site.initialOwner && plan.responseTargets?.some(target => target.territoryId === site.id))).toBe(true);
    expect(squads.filter(plan => plan.responseTargets?.some(target => target.kind === 'base'))).toHaveLength(15);
    for (const plan of squads) {
      expect(plan.targets.every(target => !bases.has(target.territoryId) && target.pathLength <= 104)).toBe(true);
      for (const target of plan.responseTargets ?? []) expect(target.pathLength).toBeLessThanOrEqual(target.kind === 'base' ? 136 : 256);
    }
  });
});
