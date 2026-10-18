import { describe, expect, test } from 'bun:test';
import { advanceNpcCampaign, buildNpcCampaignGeometry, chooseNpcRefuge, createNpcCampaignState, getNpcOperationalBase,
  npcCampaignPlans, occupyNpcBase, restoreNpcCampaignState, NPC_CAMPAIGN_REGROUP_MS, NPC_CAMPAIGN_RETREAT_MS,
  type NpcCampaignGeometry } from '../server/live-npc-campaign';
import { advanceNpcSquads, buildNpcSquadPlans, completeObjective, createNpcSquadState, npcSquadCountsExpedition, restoreNpcSquadState, type NpcSquadActor, type NpcSquadFaction, type NpcSquadPlan } from '../server/live-squads';
import { createNpcFactionAlerts, recordNpcTerritoryLoss } from '../server/live-faction-alerts';
import { getLiveMap } from '../src/game/live-maps';
import { getLiveBossArenas } from '../src/game/live-boss-arenas';
import { createLiveNavigation } from '../server/live-navigation';

const NOW = 1_800_000_000_000;
function authored(id: string, x: number, faction: NpcSquadFaction = 'scavs', districtId: NpcSquadPlan['districtId'] = 'customs'): NpcSquadPlan {
  return { id, faction, districtId, baseId: `base-${id}`, base: { x, y: 10 }, memberIds: [`${id}-a`, `${id}-b`], spawnIndices: [x, x + 1],
    rallyPoints: [{ x, y: 10 }, { x: x + 2, y: 10 }], targets: [] };
}
function fixture() {
  const plans = [authored('lost', 10), authored('refuge', 110, 'scavs', 'depot'), authored('enemy', 210, 'raiders')];
  const geometry: NpcCampaignGeometry = { bases: plans.map(plan => ({ id: plan.baseId, point: { ...plan.base }, districtId: plan.districtId,
    rallyPoints: Array.from({ length: 12 }, (_, index) => ({ x: plan.base.x + index % 4, y: plan.base.y + Math.floor(index / 4) })),
    escapePoints: [{ x: plan.base.x + 14, y: plan.base.y }], targets: [],
    responseTargets: plans.map(other => ({ territoryId: other.baseId, point: { ...other.base }, pathLength: Math.abs(other.base.x - plan.base.x), kind: 'base' })),
    assaultTargets: plans.map(other => ({ territoryId: other.baseId, point: { ...other.base }, pathLength: Math.abs(other.base.x - plan.base.x), kind: 'base' })) })),
    routes: plans.flatMap(plan => plans.map(other => ({ fromId: plan.baseId, toId: other.baseId, pathLength: Math.abs(other.base.x - plan.base.x) }))) };
  const campaign = createNpcCampaignState(plans), alerts = createNpcFactionAlerts();
  const states = new Map(plans.map(plan => [plan.id, { ...createNpcSquadState(plan, NOW), restUntil: NOW + 999_999 }]));
  const actors = new Map<string, NpcSquadActor>(plans.flatMap(plan => plan.memberIds.map((id, index) => [id,
    { id, ...plan.rallyPoints[index]!, health: 73, lifeCycle: 4, inCombat: false, carried: false, canForage: false }] as const)));
  const owners = new Map<string, NpcSquadFaction | null>(plans.map(plan => [plan.baseId, plan.faction]));
  const project = (now = NOW) => advanceNpcCampaign(geometry, campaign, plans, states, actors, owners, alerts, now);
  const step = (now = NOW) => advanceNpcSquads(project(now), states, actors, owners, now, alerts);
  const lose = (now = NOW) => { recordNpcTerritoryLoss(alerts, 'base-lost', 'scavs', 'raiders', now, 'base'); owners.set('base-lost', 'raiders'); };
  return { plans, geometry, campaign, alerts, states, actors, owners, project, step, lose };
}

describe('physical base campaigns', () => {
  test('real geometry has bounded hostile assaults and cross-district refuge routes without changing authored homes', () => {
    const world = getLiveMap('perimeter'), navigation = createLiveNavigation(world), arenas = getLiveBossArenas(world);
    const excluded = (point: { x: number; y: number }) => arenas.some(({ area }) => point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height);
    const squads = buildNpcSquadPlans(world, navigation, excluded), original = JSON.stringify(squads), geometry = buildNpcCampaignGeometry(world, squads, navigation, excluded);
    const owners = new Map(squads.squads.map(plan => [plan.baseId, plan.faction]));
    expect(geometry.bases).toHaveLength(23);
    expect(geometry.bases.filter(base => base.assaultTargets.some(target => owners.get(target.territoryId) !== owners.get(base.id)))).toHaveLength(22);
    let crossDistrict = 0, longest = 0;
    for (const plan of squads.squads) {
      expect(geometry.bases.find(base => base.id === plan.baseId)!.rallyPoints.every(point => navigation.hasLineOfSight(point, plan.base))).toBe(true);
      const refuge = chooseNpcRefuge(geometry, plan.baseId, plan.faction, owners);
      expect(refuge).not.toBeNull();
      const route = geometry.routes.find(route => route.fromId === plan.baseId && route.toId === refuge)!;
      expect(route.pathLength).toBeLessThanOrEqual(512); longest = Math.max(longest, route.pathLength);
      if (geometry.bases.find(base => base.id === refuge)!.districtId !== plan.districtId) crossDistrict++;
    }
    expect(crossDistrict).toBe(6); expect(longest).toBe(468); expect(JSON.stringify(squads)).toBe(original);
  });

  test('a real loss orders physical evacuation with exact living generations, health and cargo intact', () => {
    const f = fixture(), first = f.actors.get('lost-a')!; first.health = 31; first.carried = true;
    const bodies = JSON.stringify([...f.actors]), homes = JSON.stringify(f.plans); f.lose();
    const decision = f.step().find(decision => decision.squadId === 'lost')!, camp = f.campaign.squads[0]!;
    expect(camp.baseId).toBe('base-refuge'); expect(camp.lossId).toBe(f.alerts.losses[0]!.id);
    expect(camp.lossRoster).toEqual([{ id: 'lost-a', lifeCycle: 4 }, { id: 'lost-b', lifeCycle: 4 }]);
    expect(camp.relocateUntil).toBe(NOW + NPC_CAMPAIGN_RETREAT_MS);
    expect(f.states.get('lost')!.evacuating).toBe(true); expect(decision.phase).toBe('return');
    expect(decision.directives.every(directive => directive.activity === 'withdraw')).toBe(true);
    expect(JSON.stringify([...f.actors])).toBe(bodies); expect(JSON.stringify(f.plans)).toBe(homes);
    f.step(NOW + 500); expect(camp.relocateUntil).toBe(NOW + NPC_CAMPAIGN_RETREAT_MS);
  });

  test('counterattack needs actual refuge arrival, thirty seconds regroup and eight seconds quiet muster', () => {
    const f = fixture(); f.lose(); f.step();
    f.step(NOW + 40_000); expect(f.alerts.losses[0]!.status).toBe('pending');
    Object.assign(f.actors.get('lost-a')!, { x: 110, y: 10 }); Object.assign(f.actors.get('lost-b')!, { x: 112, y: 10 });
    let decision = f.step(NOW + 41_000).find(decision => decision.squadId === 'lost')!;
    expect(decision.phase).toBe('rest'); expect(decision.directives.every(directive => directive.activity === 'regroup')).toBe(true);
    expect(f.campaign.squads[0]!.regroupUntil).toBe(NOW + 41_000 + NPC_CAMPAIGN_REGROUP_MS);
    decision = f.step(NOW + 70_999).find(decision => decision.squadId === 'lost')!; expect(decision.phase).toBe('rest');
    decision = f.step(NOW + 71_000).find(decision => decision.squadId === 'lost')!;
    expect(decision.phase).toBe('assemble'); expect(decision.missionKind).toBe('retake'); expect(decision.targetId).toBe('base-lost');
    expect(f.alerts.losses[0]!.assignedSquadId).toBe('lost');
    expect(f.states.get('lost')!.missionUntil).toBe(NOW + 671_000);
    expect(f.step(NOW + 78_999).find(decision => decision.squadId === 'lost')!.phase).toBe('assemble');
    expect(f.step(NOW + 79_000).find(decision => decision.squadId === 'lost')!.phase).toBe('travel');
  });

  test('a respawned generation and another resident squad cannot supplement the loss roster', () => {
    const f = fixture(); f.lose(); f.step();
    Object.assign(f.actors.get('lost-a')!, { x: 110, y: 10 }); Object.assign(f.actors.get('lost-b')!, { x: 112, y: 10, lifeCycle: 5 });
    f.step(NOW + 1_000); f.step(NOW + 31_000);
    expect(f.alerts.losses[0]!.status).toBe('pending'); expect(f.alerts.losses[0]!.assignedSquadId).toBeNull();
    expect(f.campaign.squads[0]!.lossRoster[1]!.lifeCycle).toBe(4);
    expect([...f.states.values()].some(state => state.missionKind === 'retake')).toBe(false);
  });

  test('proximity through a wall cannot start regroup or a physical muster', () => {
    const f = fixture(); f.lose(); f.step();
    Object.assign(f.actors.get('lost-a')!, { x: 110, y: 10 }); Object.assign(f.actors.get('lost-b')!, { x: 112, y: 10 });
    const hidden = (from: { x: number }) => from.x !== 112;
    let effective = advanceNpcCampaign(f.geometry, f.campaign, f.plans, f.states, f.actors, f.owners, f.alerts, NOW + 1_000, hidden);
    expect(f.campaign.squads[0]!.regroupUntil).toBe(0); expect(f.states.get('lost')!.evacuating).toBe(true);
    f.step(NOW + 2_000);
    effective = f.project(NOW + 32_000);
    expect(advanceNpcSquads(effective, f.states, f.actors, f.owners, NOW + 32_000, f.alerts, hidden).find(decision => decision.squadId === 'lost')!.phase).toBe('rest');
    expect(f.alerts.losses[0]!.assignedSquadId).toBeNull();
  });

  test('restart preserves an in-flight evacuation, loss roster and absolute regroup deadline', () => {
    const f = fixture(); f.states.get('lost')!.missionKind = 'defend'; f.states.get('lost')!.responseId = 'base-9';
    f.lose(); const effective = f.project();
    const saved = structuredClone(f.campaign), restored = restoreNpcCampaignState(f.plans, f.geometry, saved, NOW + 10_000);
    expect(restored).toEqual(f.campaign); expect(npcCampaignPlans(f.geometry, restored, f.plans)).toEqual(effective);
    expect(restoreNpcSquadState(effective[0]!, structuredClone(f.states.get('lost')!), NOW + 10_000)).toEqual(f.states.get('lost')!);
    saved.squads[0]!.lossRoster[0]!.lifeCycle = -1;
    expect(restoreNpcCampaignState(f.plans, f.geometry, saved, NOW).squads[0]!.baseId).toBe('base-lost');
    expect(restoreNpcCampaignState(f.plans, f.geometry, undefined, NOW)).toEqual(createNpcCampaignState(f.plans));
  });

  test('cohosted squads get distinct rally slots and the captor establishes only its own operational base', () => {
    const f = fixture(), homes = JSON.stringify(f.plans); f.lose();
    const effective = f.project(), cohosted = effective.filter(plan => plan.baseId === 'base-refuge');
    expect(cohosted).toHaveLength(2);
    const points = cohosted.flatMap(plan => plan.rallyPoints.map(point => `${point.x},${point.y}`));
    expect(new Set(points).size).toBe(points.length); expect(effective[0]!.districtId).toBe('depot');
    occupyNpcBase(f.campaign, 'enemy', 'base-lost', NOW);
    expect(getNpcOperationalBase(f.campaign, 'enemy')).toBe('base-lost'); expect(getNpcOperationalBase(f.campaign, 'lost')).toBe('base-refuge');
    expect(JSON.stringify(f.plans)).toBe(homes);
  });

  test('losing the last base produces finite withdrawal and stranded hold without invented bases or missions', () => {
    const f = fixture(); f.owners.set('base-refuge', 'raiders'); f.lose();
    let decision = f.step().find(decision => decision.squadId === 'lost')!;
    expect(getNpcOperationalBase(f.campaign, 'lost')).toBeNull(); expect(decision.baseId).toBeNull();
    expect(decision.directives[0]!.destination).toEqual({ x: 24, y: 10 });
    decision = f.step(NOW + 60_000).find(decision => decision.squadId === 'lost')!;
    expect(decision.directives.every(directive => directive.destination === null && directive.activity === 'rest')).toBe(true);
    expect(f.alerts.losses[0]!.assignedSquadId).toBeNull();
    f.owners.set('base-refuge', 'scavs'); decision = f.step(NOW + 80_000).find(decision => decision.squadId === 'lost')!;
    expect(decision.baseId).toBe('base-refuge'); expect(decision.phase).toBe('return'); expect(f.states.get('lost')!.evacuating).toBe(true);
  });

  test('a blocked evacuation expires without granting a remote counterattack', () => {
    const f = fixture(); f.lose(); f.step(); f.step(NOW + NPC_CAMPAIGN_RETREAT_MS);
    expect(f.alerts.losses[0]!.status).toBe('spent'); expect(f.states.get('lost')!.evacuating).toBe(false);
    expect(f.states.get('lost')!.phase).toBe('rest'); expect(f.actors.get('lost-a')!.x).toBe(10);
    expect(f.campaign.squads[0]!.lossRoster).toHaveLength(2);
  });

  test('missing escape geometry holds survivors in place instead of routing into a captured base', () => {
    const f = fixture(); f.geometry.bases[0]!.escapePoints = []; f.owners.set('base-refuge', 'raiders'); f.lose();
    const decision = f.step().find(decision => decision.squadId === 'lost')!;
    expect(decision.baseId).toBeNull(); expect(f.campaign.squads[0]!.holdPoint).toBeNull();
    expect(decision.directives.every(directive => directive.destination === null)).toBe(true);
  });

  test('ordinary assaults use bounded enemy base targets and respect an already spent loss cycle', () => {
    const f = fixture(), enemy = f.states.get('enemy')!; enemy.restUntil = NOW;
    let decision = f.step().find(decision => decision.squadId === 'enemy')!;
    expect(decision.missionKind).toBe('assault'); expect(decision.phase).toBe('travel'); expect(enemy.missionUntil).toBe(NOW + 360_000);
    const target = decision.targetId!; recordNpcTerritoryLoss(f.alerts, target, 'raiders', 'scavs', NOW, 'base');
    f.alerts.losses[0]!.status = 'spent';
    f.actors.get('enemy-a')!.x = 180; f.actors.get('enemy-b')!.x = 182;
    decision = f.step(NOW + 500).find(decision => decision.squadId === 'enemy')!;
    expect(decision.phase).toBe('return'); expect(enemy.outcome).toBe('unavailable');
  });

  test('an objective actor behind a nearby wall keeps approaching instead of holding forever', () => {
    const f = fixture(), state = f.states.get('enemy')!; state.restUntil = NOW;
    const initial = f.step().find(decision => decision.squadId === 'enemy')!, target = f.geometry.bases.find(base => base.id === initial.targetId)!;
    Object.assign(f.actors.get('enemy-a')!, { x: target.point.x - 3, y: target.point.y });
    Object.assign(f.actors.get('enemy-b')!, { x: target.point.x - 4, y: target.point.y });
    const result = advanceNpcSquads(f.project(NOW + 500), f.states, f.actors, f.owners, NOW + 500, f.alerts, () => false).find(decision => decision.squadId === 'enemy')!;
    expect(result.phase).toBe('objective'); expect(result.atObjective).toBe(false);
    expect(result.directives.every(directive => JSON.stringify(directive.destination) === JSON.stringify(target.point))).toBe(true);
  });

  test('a captor consolidating at its new base does not add a third expedition while awaiting a straggler', () => {
    const f = fixture(), plan = f.plans[2]!, state = f.states.get('enemy')!;
    plan.memberIds.push('enemy-c'); plan.rallyPoints.push({ x: 210, y: 12 }); plan.spawnIndices.push(212);
    f.actors.set('enemy-c', { ...f.actors.get('enemy-a')!, id: 'enemy-c' });
    state.members = plan.memberIds.map(id => ({ id, lifeCycle: 4 })); state.leaderId = 'enemy-a';
    Object.assign(state, { phase: 'objective', missionKind: 'assault', targetId: 'base-lost', missionUntil: NOW + 360_000 });
    Object.assign(f.actors.get('enemy-a')!, { x: 10, y: 10 }); Object.assign(f.actors.get('enemy-b')!, { x: 12, y: 10 });
    completeObjective(state, NOW); expect(npcSquadCountsExpedition(plan, state)).toBe(true);
    occupyNpcBase(f.campaign, plan.id, 'base-lost', NOW); f.owners.set('base-lost', 'raiders');
    const effective = npcCampaignPlans(f.geometry, f.campaign, f.plans);
    const decision = advanceNpcSquads(effective, f.states, f.actors, f.owners, NOW, f.alerts).find(decision => decision.squadId === plan.id)!;
    expect(decision.phase).toBe('return'); expect(npcSquadCountsExpedition(effective[2]!, state)).toBe(false);
    expect(f.actors.get('enemy-c')!.x).toBe(210); expect(state.members).toHaveLength(3);
  });
});
