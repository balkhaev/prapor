import { describe, expect, test } from 'bun:test';
import { advanceNpcSquads, buildNpcSquadPlans, completeObjective, createNpcSquadState, restoreNpcSquadState,
  NPC_SQUAD_MISSION_MS, NPC_SQUAD_RETURN_MS, NPC_SQUAD_WAIT_MS,
  type NpcSquadActor, type NpcSquadFaction, type NpcSquadPlan, type NpcSquadState } from '../server/live-squads';
import { createLiveNavigation } from '../server/live-navigation';
import { getLiveMap } from '../src/game/live-maps';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';

const NOW = 1_800_000_000_000;
function plan(id = 'squad-customs-scavs-0', districtId: NpcSquadPlan['districtId'] = 'customs'): NpcSquadPlan {
  return { id, faction: 'scavs', districtId, baseId: `${id}-base`, base: { x: 10, y: 10 },
    memberIds: [`${id}-a`, `${id}-b`], spawnIndices: [0, 1], rallyPoints: [{ x: 10, y: 10 }, { x: 12, y: 10 }],
    targets: [{ territoryId: 'enemy', point: { x: 30, y: 10 }, pathLength: 20, hasSupplies: true },
      { territoryId: 'friendly', point: { x: 10, y: 30 }, pathLength: 20, hasSupplies: true }] };
}
function fixture(plans = [plan()]) {
  const actors = new Map<string, NpcSquadActor>(plans.flatMap(plan => plan.memberIds.map((id, index) => [id,
    { id, ...plan.rallyPoints[index]!, health: 100, lifeCycle: 1, inCombat: false, carried: false, canForage: false }] as const)));
  const states = new Map(plans.map(plan => [plan.id, { ...createNpcSquadState(plan, NOW), restUntil: NOW }]));
  const owners = new Map<string, NpcSquadFaction | null>([['enemy', 'raiders'], ['friendly', 'scavs']]);
  return { plans, actors, states, owners, step: (time = NOW) => advanceNpcSquads(plans, states, actors, owners, time) };
}

describe('bounded persistent NPC squad director', () => {
  test('real geometry recruits existing nearby patrols and gives every district both factions reachable objectives', () => {
    const world = getLiveMap('perimeter'), before = JSON.stringify(world.npcSpawns), navigation = createLiveNavigation(world);
    const arenas = getLiveBossArenas(world), excluded = (point: { x: number; y: number }) => arenas.some(({ area }) =>
      point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height);
    const { squads, territories } = buildNpcSquadPlans(world, navigation, excluded), byId = new Map(territories.map(site => [site.id, site]));
    const bases = new Set(squads.map(squad => squad.baseId));
    expect(squads).toHaveLength(23); expect(bases.size).toBe(23);
    expect(new Set(squads.flatMap(squad => squad.memberIds)).size).toBe(50);
    expect(new Set(territories.map(site => site.id)).size).toBe(territories.length);
    for (const squad of squads) {
      expect(squad.memberIds.length).toBeGreaterThanOrEqual(2); expect(squad.memberIds.length).toBeLessThanOrEqual(3);
      expect(byId.get(squad.baseId)?.point).toEqual(squad.base); expect(byId.get(squad.baseId)?.initialOwner).toBe(squad.faction);
      for (const index of squad.spawnIndices) {
        const authored = world.npcSpawns[index]!;
        expect(authored.role).toBe('patrol'); expect(authored.faction).toBe(squad.faction);
        expect(navigation.findPath(authored.point, squad.base)!.length).toBeLessThanOrEqual(72);
      }
      for (const target of squad.targets) {
        expect(bases.has(target.territoryId)).toBe(false); expect(excluded(target.point)).toBe(false);
        expect(target.point).toEqual(byId.get(target.territoryId)!.point); expect(target.pathLength).toBeLessThanOrEqual(104);
      }
    }
    for (const district of world.districts) for (const faction of ['scavs', 'raiders'] as const) {
      const local = squads.filter(squad => squad.districtId === district.id && squad.faction === faction);
      expect(local.length).toBeGreaterThan(0); expect(local.length).toBeLessThanOrEqual(3);
      expect(local.some(squad => squad.targets.some(target => byId.get(target.territoryId)!.initialOwner !== faction))).toBe(true);
    }
    expect(JSON.stringify(world.npcSpawns)).toBe(before);
  });

  test('requires two healthy physically assembled residents and never mutates bodies', () => {
    const f = fixture(), squad = f.plans[0]!, second = f.actors.get(squad.memberIds[1]!)!;
    second.x = 40;
    const before = JSON.stringify([...f.actors]);
    const decision = f.step()[0]!;
    expect(decision.phase).toBe('rest'); expect(decision.directives[1]!.activity).toBe('assemble');
    expect(decision.directives[1]!.destination).toEqual(squad.rallyPoints[1]!);
    expect(JSON.stringify([...f.actors])).toBe(before);
    second.x = 12; second.health = 39;
    expect(f.step()[0]!.phase).toBe('rest');
    second.health = 100; second.inCombat = true;
    expect(f.step()[0]!.phase).toBe('rest');
    second.inCombat = false;
    expect(f.step()[0]!.phase).toBe('travel');
  });

  test('limits concurrent missions per district and reserves a target only against the same faction', () => {
    const plans = [plan('a'), plan('b'), plan('c'), plan('d', 'sawmill')];
    for (const squad of plans) squad.targets = [0, 1, 2].map(index => ({ territoryId: `${squad.districtId}-${index}`, point: { x: 30 + index, y: 10 }, pathLength: 20 + index, hasSupplies: false }));
    const f = fixture(plans), decisions = f.step();
    expect(decisions.filter(decision => decision.phase === 'travel')).toHaveLength(3);
    expect(decisions[2]!.phase).toBe('rest');
    expect(decisions[0]!.targetId).not.toBe(decisions[1]!.targetId);
    const g = fixture([plan('a'), plan('b')]);
    expect(g.step().map(decision => decision.phase)).toEqual(['travel', 'rest']);
    g.plans[1]!.faction = 'raiders';
    g.owners.set('enemy', null);
    expect(g.step()[1]!.phase).toBe('travel');
  });

  test('alternates supply missions on owned sites and capture, including on the first cycle', () => {
    const f = fixture(), squad = f.plans[0]!, state = f.states.get(squad.id)!;
    for (const actor of f.actors.values()) actor.canForage = true;
    const kinds: string[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      state.phase = 'rest'; state.restUntil = NOW;
      const decision = f.step()[0]!; kinds.push(decision.missionKind);
      expect(decision.targetId).toBe(decision.missionKind === 'forage' ? 'friendly' : 'enemy');
    }
    expect(kinds[0]).not.toBe(kinds[1]); expect(kinds[0]).toBe(kinds[2]);
    f.owners.set('friendly', 'raiders'); state.phase = 'rest'; state.restUntil = NOW;
    expect(f.step()[0]!.missionKind).toBe('capture');
  });

  test('objectives and deliveries require actual arrival; completing an objective only starts physical return', () => {
    const f = fixture(), squad = f.plans[0]!, state = f.states.get(squad.id)!;
    f.step();
    const first = f.actors.get(squad.memberIds[0]!)!, second = f.actors.get(squad.memberIds[1]!)!;
    first.x = 30;
    expect(f.step(NOW + 500)[0]!.atObjective).toBe(false);
    second.x = 28;
    const arrived = f.step(NOW + 1000)[0]!;
    expect(arrived.atObjective).toBe(true); expect(arrived.directives[0]!.activity).toBe('capture');
    first.carried = true;
    completeObjective(state, NOW + 1000);
    const before = JSON.stringify([...f.actors]), returning = f.step(NOW + 1500)[0]!;
    expect(returning.phase).toBe('return'); expect(returning.atBase).toBe(false); expect(returning.directives[0]!.activity).toBe('haul');
    expect(JSON.stringify([...f.actors])).toBe(before);
    first.x = 10; second.x = 12;
    const home = f.step(NOW + 2000)[0]!;
    expect(home.phase).toBe('rest'); expect(home.atBase).toBe(true); expect(home.memberIds).toHaveLength(2);
    expect(first.carried).toBe(true); expect(state.outcome).toBe('completed');
  });

  test('death and respawn generations cannot replace mission casualties; survivors withdraw under a new leader', () => {
    const f = fixture(), squad = f.plans[0]!, first = f.actors.get(squad.memberIds[0]!)!, second = f.actors.get(squad.memberIds[1]!)!;
    f.step(); first.x = 20; second.x = 22;
    first.lifeCycle++;
    const decision = f.step(NOW + 500)[0]!;
    expect(decision.phase).toBe('return'); expect(decision.retreating).toBe(true); expect(decision.memberIds).toEqual([second.id]);
    expect(decision.leaderId).toBe(second.id); expect(decision.directives.find(order => order.actorId === second.id)!.activity).toBe('withdraw');
    expect(f.states.get(squad.id)!.outcome).toBe('casualty');
    expect(f.states.get(squad.id)!.members[0]!.lifeCycle).toBe(1);
  });

  test('wounds, mission deadlines and return deadlines are finite without teleporting or abandoning carried goods', () => {
    const f = fixture(), squad = f.plans[0]!, state = f.states.get(squad.id)!;
    f.step(); for (const actor of f.actors.values()) { actor.x += 10; actor.carried = true; }
    f.actors.get(squad.memberIds[1]!)!.health = 39;
    expect(f.step(NOW + 500)[0]!.retreating).toBe(true); expect(state.outcome).toBe('wounded');
    const before = JSON.stringify([...f.actors]);
    const expired = f.step(NOW + 500 + NPC_SQUAD_RETURN_MS)[0]!;
    expect(expired.phase).toBe('rest'); expect(expired.atBase).toBe(false); expect(expired.directives.every(order => order.activity === 'haul')).toBe(true);
    expect(JSON.stringify([...f.actors])).toBe(before);
    const g = fixture(); g.step(); for (const actor of g.actors.values()) actor.x += 10;
    expect(g.step(NOW + NPC_SQUAD_MISSION_MS)[0]!.phase).toBe('return');
    expect(g.states.get(g.plans[0]!.id)!.outcome).toBe('timeout');
  });

  test('followers use bounded actual leader breadcrumbs and straggler waiting expires', () => {
    const f = fixture(), squad = f.plans[0]!, first = f.actors.get(squad.memberIds[0]!)!, second = f.actors.get(squad.memberIds[1]!)!, state = f.states.get(squad.id)!;
    squad.targets[0]!.point.x = 90;
    f.step();
    for (let step = 1; step <= 40; step++) { first.x = 10 + step; second.x = first.x - 2; f.step(NOW + step * 500); }
    expect(state.trail).toHaveLength(32); expect(state.trail.at(-1)).toEqual({ x: first.x, y: first.y });
    second.x = 20;
    const waiting = f.step(NOW + 21_000)[0]!;
    expect(waiting.directives[0]!.destination).toBeNull();
    expect(waiting.directives[1]!.destination!.x).toBeLessThan(first.x);
    expect(waiting.directives[1]!.destination).not.toEqual(squad.targets[0]!.point);
    const expired = f.step(NOW + 21_000 + NPC_SQUAD_WAIT_MS)[0]!;
    expect(expired.phase).toBe('return'); expect(expired.retreating).toBe(true); expect(state.outcome).toBe('blocked');
  });

  test('a replacement leader with cargo must reach the cache instead of stopping at its rally slot', () => {
    const f = fixture(), squad = f.plans[0]!, state = f.states.get(squad.id)!;
    squad.rallyPoints[1] = { x: 15, y: 10 };
    const first = f.actors.get(squad.memberIds[0]!)!, carrier = f.actors.get(squad.memberIds[1]!)!;
    f.step(); first.health = 0; carrier.x = 24; carrier.carried = true;
    expect(f.step(NOW + 500)[0]!.leaderId).toBe(carrier.id);
    carrier.x = 15;
    const arrived = f.step(NOW + 1000)[0]!;
    expect(arrived.phase).toBe('rest'); expect(arrived.atBase).toBe(true);
    expect(arrived.directives[0]).toEqual({ actorId: carrier.id, destination: squad.base, activity: 'haul' });
    state.phase = 'return'; state.members = [{ id: carrier.id, lifeCycle: carrier.lifeCycle }]; state.leaderId = carrier.id;
    state.returnUntil = NOW + 1500; carrier.x = 40;
    const expired = f.step(NOW + 1500)[0]!;
    expect(expired.phase).toBe('rest'); expect(expired.directives[0]!.destination).toEqual(squad.base);
    expect(expired.directives[0]!.activity).toBe('haul');
    carrier.x = 11;
    expect(f.step(NOW + 2000)[0]!.directives[0]!.destination).toEqual(squad.base);
    carrier.carried = false;
    expect(f.step(NOW + 2500)[0]!.directives[0]!.activity).toBe('rest');
  });

  test('restart preserves membership generations and deadlines, while invalid private state resets safely', () => {
    const f = fixture(), squad = f.plans[0]!; f.step();
    const saved = JSON.parse(JSON.stringify(f.states.get(squad.id))) as NpcSquadState;
    expect(restoreNpcSquadState(squad, saved, NOW + 60_000)).toEqual(saved);
    expect(restoreNpcSquadState(squad, { ...saved, members: [null] } as unknown as NpcSquadState, NOW + 60_000).phase).toBe('rest');
    expect(restoreNpcSquadState(squad, { ...saved, members: [{ id: 'fake', lifeCycle: 1 }] }, NOW + 60_000).phase).toBe('rest');
    expect(restoreNpcSquadState(squad, { ...saved, targetId: 'missing' }, NOW + 60_000).phase).toBe('rest');
    const restarted = new Map([[squad.id, saved]]);
    for (const actor of f.actors.values()) actor.x += 10;
    const decisions = advanceNpcSquads(f.plans, restarted, f.actors, f.owners, saved.missionUntil);
    expect(decisions[0]!.retreating).toBe(true); expect(saved.outcome).toBe('timeout');
  });
});
