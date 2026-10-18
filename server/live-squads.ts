import type { LiveDistrictId, LivePoint } from '../src/game/live';
import type { LiveMapDefinition } from '../src/game/live-maps';
import { NPC_RESPONSE_DISPATCH_MS, NPC_RESPONSE_MISSION_MS, NPC_RESPONSE_MUSTER_MS, NPC_RESPONSE_RETURN_MS,
  reconcileNpcFactionAlerts, type NpcFactionAlerts } from './live-faction-alerts';

export type NpcSquadFaction = 'scavs' | 'raiders';
export type NpcSquadPhase = 'rest' | 'assemble' | 'travel' | 'objective' | 'return';
export type NpcSquadActivity = 'assemble' | 'travel' | 'capture' | 'forage' | 'haul' | 'withdraw' | 'rest' | 'defend' | 'reinforce' | 'retake' | 'assault' | 'regroup';
export type NpcSquadMission = 'capture' | 'forage' | 'defend' | 'retake' | 'assault';
export const NPC_SQUAD_MISSION_MS = 240_000;
export const NPC_SQUAD_RETURN_MS = 180_000;
export const NPC_SQUAD_REGROUP_MS = 90_000;
export const NPC_SQUAD_WAIT_MS = 10_000;
export const NPC_SQUAD_ACTIVE_PER_DISTRICT = 2;
export const NPC_SQUAD_ASSAULT_MS = 360_000;
export const NPC_SQUAD_BASE_RETAKE_MS = 600_000;
export interface NpcTerritoryPlan {
  id: string; poiId: string; districtId: LiveDistrictId; point: LivePoint; initialOwner: NpcSquadFaction | null;
}
export interface NpcSquadPlan {
  id: string; faction: NpcSquadFaction; districtId: LiveDistrictId; baseId: string; base: LivePoint;
  memberIds: string[]; spawnIndices: number[]; rallyPoints: LivePoint[];
  targets: Array<{ territoryId: string; point: LivePoint; pathLength: number; hasSupplies: boolean }>;
  responseTargets?: Array<{ territoryId: string; point: LivePoint; pathLength: number; kind: 'base' | 'control' }>;
  assaultTargets?: Array<{ territoryId: string; point: LivePoint; pathLength: number; kind: 'base' | 'control' }>;
  operational?: boolean; strandedUntil?: number;
  recoveryLossId?: string | null; recoveryRoster?: Array<{ id: string; lifeCycle: number }>;
  recoveryReadyAt?: number; recoveryPending?: boolean;
}
export interface NpcSquadActor extends LivePoint {
  id: string; health: number; lifeCycle: number; inCombat: boolean; carried: boolean; canForage: boolean;
}
export interface NpcSquadState {
  id: string; phase: NpcSquadPhase; missionKind: NpcSquadMission; targetId: string | null; leaderId: string | null;
  responseId?: string | null; departAfter?: number; localDefense?: boolean; evacuating?: boolean;
  members: Array<{ id: string; lifeCycle: number }>;
  startedAt: number; phaseUntil: number; missionUntil: number; restUntil: number; returnUntil: number;
  trail: LivePoint[]; waitSince: number | null; retreating: boolean;
  outcome: 'pending' | 'completed' | 'casualty' | 'wounded' | 'timeout' | 'blocked' | 'unavailable';
  cycle: number;
}
export interface NpcSquadDirective { actorId: string; destination: LivePoint | null; activity: NpcSquadActivity }
export interface NpcSquadDecision {
  squadId: string; phase: NpcSquadPhase; missionKind: NpcSquadMission; targetId: string | null; baseId: string | null;
  leaderId: string | null; memberIds: string[]; atBase: boolean; atObjective: boolean; retreating: boolean;
  directives: NpcSquadDirective[];
}
type Navigation = { walkable(point: LivePoint): boolean; findPath(from: LivePoint, to: LivePoint): LivePoint[] | null };
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const copy = ({ x, y }: LivePoint): LivePoint => ({ x, y });
const inside = (point: LivePoint, rect: LivePoint & { width: number; height: number }): boolean => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
const hash = (text: string): number => { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; };

/** Build once for immutable geometry. Recruitment never changes homes or creates bodies. */
export function buildNpcSquadPlans(world: LiveMapDefinition, navigation: Navigation, excluded: (point: LivePoint) => boolean = () => false): { squads: NpcSquadPlan[]; territories: NpcTerritoryPlan[] } {
  const residents = world.npcSpawns.map((spawn, index) => ({ ...spawn, index,
    poi: world.pois.filter(poi => inside(spawn.point, poi)).sort((a, b) => a.width * a.height - b.width * b.height)[0] }));
  const ownership = new Map<string, Set<NpcSquadFaction>>();
  for (const resident of residents) if (resident.poi) {
    const factions = ownership.get(resident.poi.id) ?? new Set(); factions.add(resident.faction); ownership.set(resident.poi.id, factions);
  }
  const entries = [...world.extracts, ...world.districts.flatMap(district => district.spawns)];
  const safe = (point: LivePoint): boolean => navigation.walkable(point) && !excluded(point) && !entries.some(entry => distance(entry, point) < 12);
  const pathLengths = new Map<string, number>();
  const pathLength = (from: LivePoint, to: LivePoint): number => {
    const key = `${from.x},${from.y}:${to.x},${to.y}`;
    let length = pathLengths.get(key);
    if (length === undefined) { length = navigation.findPath(from, to)?.length ?? Infinity; pathLengths.set(key, length); }
    return length;
  };
  const squads: NpcSquadPlan[] = [], assigned = new Set<number>(), baseIds = new Set<string>();
  for (const district of world.districts) for (const faction of ['scavs', 'raiders'] as const) {
    const patrols = residents.filter(resident => resident.role === 'patrol' && resident.faction === faction && resident.poi?.districtId === district.id && safe(resident.point));
    let ordinal = 0;
    for (const leader of patrols) {
      if (ordinal >= 3 || assigned.has(leader.index) || baseIds.has(leader.poi!.id)) continue;
      const nearby = patrols.filter(other => other.index !== leader.index && !assigned.has(other.index) && distance(leader.point, other.point) <= 48)
        .map(other => ({ other, length: pathLength(other.point, leader.point) })).filter(candidate => candidate.length <= 72)
        .sort((a, b) => a.length - b.length || a.other.index - b.other.index).slice(0, 2);
      if (!nearby.length) continue;
      const members = [leader, ...nearby.map(candidate => candidate.other)], rally = [copy(leader.point)];
      for (let radius = 2; radius <= 5 && rally.length < members.length; radius++) for (let y = -radius; y <= radius && rally.length < members.length; y++) for (let x = -radius; x <= radius && rally.length < members.length; x++) {
        const point = { x: leader.point.x + x, y: leader.point.y + y };
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius || !safe(point) || residents.some(resident => resident.index !== leader.index && resident.point.x === point.x && resident.point.y === point.y)
          || rally.some(other => distance(point, other) < 2) || pathLength(leader.point, point) > 10) continue;
        rally.push(point);
      }
      if (rally.length !== members.length) continue;
      members.forEach(member => assigned.add(member.index));
      baseIds.add(leader.poi!.id);
      squads.push({ id: `squad-${district.id}-${faction}-${ordinal++}`, faction, districtId: district.id, baseId: leader.poi!.id, base: copy(leader.point),
        memberIds: members.map(member => `scav-${world.id}-${member.index}`), spawnIndices: members.map(member => member.index), rallyPoints: rally, targets: [] });
    }
  }
  const bases = new Set(squads.map(squad => squad.baseId));
  const territories: NpcTerritoryPlan[] = world.pois.flatMap(poi => {
    if (bases.has(poi.id)) return [];
    const point = poi.entrances.find(safe); if (!point) return [];
    const factions = ownership.get(poi.id);
    return [{ id: poi.id, poiId: poi.id, districtId: poi.districtId, point: copy(point), initialOwner: factions?.size === 1 ? [...factions][0]! : null }];
  });
  for (const squad of squads) squad.targets = territories.filter(territory => territory.districtId === squad.districtId && distance(squad.base, territory.point) >= 12 && distance(squad.base, territory.point) <= 72)
    .map(territory => ({ territoryId: territory.id, point: copy(territory.point), pathLength: pathLength(squad.base, territory.point), hasSupplies: world.containers.some(container => container.poiId === territory.poiId) }))
    .filter(target => target.pathLength <= 104).sort((a, b) => a.pathLength - b.pathLength || a.territoryId.localeCompare(b.territoryId)).slice(0, 12);
  const publicTerritories = [...territories.filter(territory => squads.some(squad => squad.targets.some(target => target.territoryId === territory.id))),
    ...squads.map(squad => ({ id: squad.baseId, poiId: squad.baseId, districtId: squad.districtId, point: copy(squad.base), initialOwner: squad.faction }))];
  for (const squad of squads) squad.responseTargets = publicTerritories.filter(site => site.districtId === squad.districtId && site.id !== squad.baseId
    && (!bases.has(site.id) || site.initialOwner === squad.faction) && distance(squad.base, site.point) <= (bases.has(site.id) ? 96 : 192))
    .map(site => ({ territoryId: site.id, point: copy(site.point), pathLength: pathLength(squad.base, site.point), kind: bases.has(site.id) ? 'base' as const : 'control' as const }))
    .filter(target => target.pathLength <= (target.kind === 'base' ? 136 : 256)).sort((a, b) => a.pathLength - b.pathLength || a.territoryId.localeCompare(b.territoryId));
  return { squads, territories: publicTerritories };
}

export function createNpcSquadState(plan: NpcSquadPlan, now: number): NpcSquadState {
  return { id: plan.id, phase: 'rest', missionKind: 'capture', targetId: null, leaderId: null, members: [], startedAt: 0,
    phaseUntil: 0, missionUntil: 0, restUntil: now + 12_000 + hash(plan.id) % 30_000, returnUntil: 0,
    trail: [], waitSince: null, retreating: false, outcome: 'pending', cycle: 0, responseId: null, departAfter: 0, localDefense: false, evacuating: false };
}
const squadTarget = (plan: NpcSquadPlan, state: NpcSquadState) => ['defend', 'retake', 'assault'].includes(state.missionKind) && state.targetId === plan.baseId
  ? { territoryId: plan.baseId, point: plan.base, pathLength: 0 }
  : state.missionKind === 'defend' || state.missionKind === 'retake'
    ? plan.responseTargets?.find(target => target.territoryId === state.targetId && (state.missionKind === 'retake' || target.kind === 'base'))
    : state.missionKind === 'assault' ? plan.assaultTargets?.find(target => target.territoryId === state.targetId) : plan.targets.find(target => target.territoryId === state.targetId);
export function restoreNpcSquadState(plan: NpcSquadPlan, value: NpcSquadState | undefined, now: number): NpcSquadState {
  if (!value || value.id !== plan.id || !['rest', 'assemble', 'travel', 'objective', 'return'].includes(value.phase)
    || !['capture', 'forage', 'defend', 'retake', 'assault'].includes(value.missionKind) || !['pending', 'completed', 'casualty', 'wounded', 'timeout', 'blocked', 'unavailable'].includes(value.outcome)
    || !(value.responseId === undefined || value.responseId === null || typeof value.responseId === 'string' && value.responseId.length > 0 && value.responseId.length <= 200)
    || !(value.departAfter === undefined || Number.isSafeInteger(value.departAfter) && value.departAfter >= 0)
    || !(value.localDefense === undefined || typeof value.localDefense === 'boolean')
    || !(value.evacuating === undefined || typeof value.evacuating === 'boolean')
    || value.evacuating && !(value.phase === 'return' && value.retreating)
    || value.localDefense && !(value.missionKind === 'defend' && value.targetId === plan.baseId)
    || ['defend', 'retake'].includes(value.missionKind) && value.phase !== 'rest' && !value.responseId
    || ![value.startedAt, value.phaseUntil, value.missionUntil, value.restUntil, value.returnUntil, value.cycle].every(number => Number.isSafeInteger(number) && number >= 0)
    || value.cycle > 1_000_000 || typeof value.retreating !== 'boolean' || !(value.waitSince === null || Number.isSafeInteger(value.waitSince) && value.waitSince >= 0)
    || !Array.isArray(value.members) || value.members.length > 3 || value.members.some(member => !member || !plan.memberIds.includes(member.id) || !Number.isSafeInteger(member.lifeCycle) || member.lifeCycle < 0)
    || new Set(value.members.map(member => member.id)).size !== value.members.length
    || !(value.leaderId === null || value.members.some(member => member.id === value.leaderId))
    || !(value.targetId === null || squadTarget(plan, value))
    || !Array.isArray(value.trail) || value.trail.length > 32 || value.trail.some(point => !point || ![point.x, point.y].every(number => Number.isInteger(number) && number >= 0 && number < 1024))) return createNpcSquadState(plan, now);
  value.responseId ??= null; value.departAfter ??= 0; value.localDefense ??= false; value.evacuating ??= false; return value;
}

function startReturn(state: NpcSquadState, now: number, outcome: NpcSquadState['outcome'], retreating: boolean): void {
  state.phase = 'return'; state.phaseUntil = now + (state.responseId ? NPC_RESPONSE_RETURN_MS : NPC_SQUAD_RETURN_MS); state.returnUntil = state.phaseUntil;
  state.waitSince = null; state.retreating = retreating; state.outcome = outcome; state.trail = []; state.evacuating = false;
}
/** Called only after real capture/forage succeeds; never awards anything itself. */
export function completeObjective(state: NpcSquadState, now: number): void {
  if (state.phase === 'objective') startReturn(state, now, 'completed', false);
}

/** Rejoining a newly occupied home is local consolidation, not another sortie. */
export function npcSquadCountsExpedition(plan: NpcSquadPlan, state: NpcSquadState): boolean {
  return state.phase !== 'rest' && !state.localDefense && !state.evacuating
    && !(state.phase === 'return' && state.outcome === 'completed' && state.targetId === plan.baseId && ['assault', 'retake'].includes(state.missionKind));
}

/** At most one bounded decision per squad per caller tick (normally 500ms). */
export function advanceNpcSquads(plans: readonly NpcSquadPlan[], states: Map<string, NpcSquadState>, actors: ReadonlyMap<string, NpcSquadActor>, owners: ReadonlyMap<string, NpcSquadFaction | null>, now: number, alerts?: NpcFactionAlerts, canSee: (from: LivePoint, to: LivePoint) => boolean = () => true): NpcSquadDecision[] {
  for (const plan of plans) if (!states.has(plan.id)) states.set(plan.id, createNpcSquadState(plan, now));
  const residentsOf = (plan: NpcSquadPlan): NpcSquadActor[] => plan.memberIds.flatMap(id => { const actor = actors.get(id); return actor && actor.health > 0 ? [actor] : []; });
  const membersOf = (state: NpcSquadState): NpcSquadActor[] => state.members.flatMap(member => { const actor = actors.get(member.id); return actor && actor.health > 0 && actor.lifeCycle === member.lifeCycle ? [actor] : []; });
  const operational = (plan: NpcSquadPlan): boolean => plan.operational !== false && (!owners.has(plan.baseId) || owners.get(plan.baseId) === plan.faction);
  const atBasePoint = (actor: NpcSquadActor, plan: NpcSquadPlan): boolean => distance(actor, plan.base) <= 6 && canSee(actor, plan.base);
  const readyOf = (plan: NpcSquadPlan): NpcSquadActor[] => residentsOf(plan).filter(actor => actor.health >= 40 && !actor.inCombat && !actor.carried && atBasePoint(actor, plan));
  const activeCount = (district: LiveDistrictId): number => plans.filter(plan => plan.districtId === district && npcSquadCountsExpedition(plan, states.get(plan.id)!)).length;
  const launchResponse = (plan: NpcSquadPlan, kind: 'defend' | 'retake', targetId: string, responseId: string, members: NpcSquadActor[], muster: boolean, deadline: number): void => {
    const state = states.get(plan.id)!, local = kind === 'defend' && targetId === plan.baseId && members.every(actor => atBasePoint(actor, plan));
    state.phase = local ? 'objective' : muster ? 'assemble' : 'travel'; state.missionKind = kind; state.targetId = targetId; state.responseId = responseId; state.localDefense = local;
    state.members = members.map(actor => ({ id: actor.id, lifeCycle: actor.lifeCycle })); state.leaderId = members.find(actor => actor.id === state.leaderId)?.id ?? members[0]!.id;
    state.startedAt = now; state.departAfter = now + (muster ? NPC_RESPONSE_MUSTER_MS : 0); state.phaseUntil = muster ? now + NPC_SQUAD_REGROUP_MS : deadline;
    state.missionUntil = deadline; state.returnUntil = 0; state.waitSince = null; state.retreating = false; state.evacuating = false; state.outcome = 'pending'; state.cycle = (state.cycle + 1) % 1_000_000;
    state.trail = [copy(members.find(actor => actor.id === state.leaderId)!)];
  };
  if (alerts) {
    reconcileNpcFactionAlerts(alerts, owners, now);
    for (const order of alerts.losses) if (order.status === 'assigned') {
      const state = order.assignedSquadId ? states.get(order.assignedSquadId) : undefined;
      if (!state || state.responseId !== order.id || state.phase === 'rest' || state.phase === 'return') order.status = 'spent';
    }
    const ownAlarm = (plan: NpcSquadPlan) => operational(plan) ? alerts.alarms.find(alarm => alarm.baseId === plan.baseId && alarm.faction === plan.faction) : undefined;
    // The home group's existing expedition is recalled without replacing its
    // generations. A garrison already at home does not consume an expedition slot.
    for (const plan of plans) {
      const alarm = ownAlarm(plan), state = states.get(plan.id)!;
      if (!alarm || alarm.homeRecalled || now >= alarm.openedAt + NPC_RESPONSE_DISPATCH_MS || state.retreating && state.phase !== 'rest') continue;
      const members = state.phase === 'rest' ? residentsOf(plan).filter(actor => actor.health >= 40 && atBasePoint(actor, plan)) : membersOf(state);
      if (!members.length || members.some(actor => actor.health < 40) || state.phase !== 'rest' && members.length !== state.members.length) continue;
      launchResponse(plan, 'defend', plan.baseId, alarm.id, members, false, alarm.openedAt + NPC_RESPONSE_MISSION_MS); alarm.homeRecalled = true;
    }
    const dispatchable = (plan: NpcSquadPlan): boolean => operational(plan) && !plan.recoveryPending && now >= (plan.recoveryReadyAt ?? 0) && states.get(plan.id)!.phase === 'rest' && !ownAlarm(plan) && readyOf(plan).length >= 2 && activeCount(plan.districtId) < NPC_SQUAD_ACTIVE_PER_DISTRICT;
    for (const alarm of alerts.alarms) {
      if (alarm.helperSquadId || now >= alarm.openedAt + NPC_RESPONSE_DISPATCH_MS) continue;
      const candidate = plans.filter(plan => plan.faction === alarm.faction && plan.baseId !== alarm.baseId && dispatchable(plan))
        .map(plan => ({ plan, target: plan.responseTargets?.find(target => target.kind === 'base' && target.territoryId === alarm.baseId && target.pathLength <= 136 && distance(plan.base, target.point) <= 96) }))
        .filter(candidate => candidate.target).sort((a, b) => a.target!.pathLength - b.target!.pathLength || a.plan.id.localeCompare(b.plan.id))[0];
      if (!candidate) continue;
      launchResponse(candidate.plan, 'defend', alarm.baseId, alarm.id, readyOf(candidate.plan), true, alarm.openedAt + NPC_RESPONSE_MISSION_MS); alarm.helperSquadId = candidate.plan.id;
    }
    for (const order of alerts.losses) {
      if (order.status !== 'pending' || now < order.readyAt || now >= order.expiresAt) continue;
      const baseLoss = order.kind === 'base';
      const candidate = plans.filter(plan => plan.faction === order.faction && dispatchable(plan)
        && (!baseLoss || plan.recoveryLossId === order.id))
        .map(plan => ({ plan, target: plan.responseTargets?.find(target => target.kind === (baseLoss ? 'base' : 'control') && target.territoryId === order.siteId && target.pathLength <= (baseLoss ? 512 : 256)),
          members: readyOf(plan).filter(actor => !baseLoss || plan.recoveryRoster?.some(member => member.id === actor.id && member.lifeCycle === actor.lifeCycle)) }))
        .filter(candidate => candidate.target && candidate.members.length >= 2).sort((a, b) => a.target!.pathLength - b.target!.pathLength || a.plan.id.localeCompare(b.plan.id))[0];
      if (!candidate) continue;
      launchResponse(candidate.plan, 'retake', order.siteId, order.id, candidate.members, true, Math.min(now + (baseLoss ? NPC_SQUAD_BASE_RETAKE_MS : NPC_RESPONSE_MISSION_MS), order.expiresAt));
      order.assignedSquadId = candidate.plan.id; order.status = 'assigned';
    }
  }
  const reserved = new Set<string>();
  for (const plan of plans) { const state = states.get(plan.id); if (state && state.phase !== 'rest' && state.phase !== 'return' && state.targetId) reserved.add(`${plan.faction}:${state.targetId}`); }
  const decisions: NpcSquadDecision[] = [];
  for (const plan of plans) {
    const state = states.get(plan.id) ?? createNpcSquadState(plan, now); states.set(plan.id, state);
    const residents = residentsOf(plan);
    const present = (): NpcSquadActor[] => membersOf(state);
    const atBase = (members: readonly NpcSquadActor[]) => members.length > 0 && members.every(actor => atBasePoint(actor, plan));
    const rest = (): void => {
      state.phase = 'rest'; state.restUntil = now + 45_000 + hash(`${plan.id}:${state.cycle}`) % 30_000;
      state.phaseUntil = state.restUntil; state.waitSince = null; state.trail = []; state.targetId = null; state.leaderId = null; state.members = [];
      state.responseId = null; state.departAfter = 0; state.localDefense = false; state.evacuating = false;
    };
    if (state.phase !== 'rest' && state.phase !== 'return') {
      const members = present();
      if (members.length < state.members.length) startReturn(state, now, 'casualty', true);
      else if (members.some(actor => actor.health < 40)) startReturn(state, now, 'wounded', true);
      else if (now >= state.missionUntil) startReturn(state, now, 'timeout', true);
      else if (['capture', 'assault'].includes(state.missionKind) && alerts?.losses.some(order => order.faction === plan.faction && order.siteId === state.targetId)) startReturn(state, now, 'unavailable', false);
      else if (state.responseId && (state.missionKind === 'defend' ? !alerts?.alarms.some(alarm => alarm.id === state.responseId)
        : owners.get(state.targetId!) === plan.faction || !alerts?.losses.some(order => order.id === state.responseId && order.assignedSquadId === plan.id && order.status === 'assigned'))) startReturn(state, now, 'completed', false);
    }
    if (state.phase === 'return' && (!present().length || atBase(present()) || now >= state.returnUntil)) rest();
    if (state.phase === 'rest' && operational(plan) && !plan.recoveryPending && now >= (plan.recoveryReadyAt ?? 0) && now >= state.restUntil && activeCount(plan.districtId) < NPC_SQUAD_ACTIVE_PER_DISTRICT
      && !alerts?.alarms.some(alarm => alarm.baseId === plan.baseId && alarm.faction === plan.faction)) {
      const ready = readyOf(plan);
      if (ready.length >= 2) {
        const available = plan.targets.filter(target => !reserved.has(`${plan.faction}:${target.territoryId}`)
          && !alerts?.losses.some(order => order.siteId === target.territoryId && order.faction === plan.faction));
        const hostile = available.filter(target => owners.get(target.territoryId) !== plan.faction), forage = available.filter(target => target.hasSupplies && owners.get(target.territoryId) === plan.faction);
        const assaults = (plan.assaultTargets ?? []).filter(target => target.territoryId !== plan.baseId && owners.get(target.territoryId) !== plan.faction
          && !reserved.has(`${plan.faction}:${target.territoryId}`) && !alerts?.losses.some(order => order.siteId === target.territoryId && order.faction === plan.faction));
        const wantsForage = ready.some(actor => actor.canForage) && forage.length > 0 && ((state.cycle + hash(plan.id)) % 2 === 0 || !hostile.length && !assaults.length);
        const wantsAssault = !wantsForage && assaults.length > 0 && ((Math.floor(state.cycle / 2) + hash(plan.id)) % 2 === 0 || !hostile.length);
        const choices = wantsForage ? forage : wantsAssault ? assaults : hostile;
        if (choices.length) {
          const target = choices[state.cycle % choices.length]!;
          state.phase = 'assemble'; state.missionKind = wantsForage ? 'forage' : wantsAssault ? 'assault' : 'capture'; state.targetId = target.territoryId;
          state.members = ready.map(actor => ({ id: actor.id, lifeCycle: actor.lifeCycle })); state.leaderId = ready[0]!.id;
          state.startedAt = now; state.phaseUntil = now + NPC_SQUAD_REGROUP_MS; state.missionUntil = now + (wantsAssault ? NPC_SQUAD_ASSAULT_MS : NPC_SQUAD_MISSION_MS);
          state.returnUntil = 0; state.waitSince = null; state.retreating = false; state.outcome = 'pending'; state.cycle = (state.cycle + 1) % 1_000_000; state.trail = [copy(ready[0]!)];
          state.responseId = null; state.departAfter = 0; state.localDefense = false; state.evacuating = false;
          reserved.add(`${plan.faction}:${target.territoryId}`);
        }
      }
    }
    let members = present();
    const target = state.targetId ? squadTarget(plan, state) : undefined;
    if (state.phase !== 'rest' && state.phase !== 'return' && !target) startReturn(state, now, 'unavailable', true);
    if (state.phase === 'assemble') {
      if (state.responseId && (!atBase(members) || members.some(actor => actor.inCombat))) state.departAfter = now + NPC_RESPONSE_MUSTER_MS;
      if (members.length >= 2 && atBase(members) && members.every(actor => !actor.inCombat) && now >= (state.departAfter ?? 0)) {
        state.phase = 'travel'; state.phaseUntil = state.missionUntil;
      } else if (now >= state.phaseUntil) startReturn(state, now, 'blocked', true);
    }
    const leader = members.find(actor => actor.id === state.leaderId) ?? members[0];
    if (leader && state.leaderId !== leader.id) { state.leaderId = leader.id; state.trail = [copy(leader)]; state.waitSince = null; }
    if (leader && ['travel', 'return'].includes(state.phase)) {
      const last = state.trail.at(-1);
      if (!last || last.x !== leader.x || last.y !== leader.y) { state.trail.push(copy(leader)); if (state.trail.length > 32) state.trail.shift(); }
    }
    if (state.phase === 'travel' && target && members.length >= 2 && members.every(actor => distance(actor, target.point) <= 6)) {
      state.phase = 'objective'; state.phaseUntil = state.missionUntil; state.waitSince = null;
      if (state.missionKind === 'defend' && state.targetId === plan.baseId) state.localDefense = true;
    }
    let waiting = false;
    if (leader && ['travel', 'return'].includes(state.phase) && members.some(actor => distance(actor, leader) > 6)) {
      state.waitSince ??= now;
      if (now - state.waitSince < NPC_SQUAD_WAIT_MS) waiting = true;
      else if (state.phase === 'travel') startReturn(state, now, 'blocked', true);
    } else state.waitSince = null;
    members = present();
    const directives: NpcSquadDirective[] = [];
    for (const actor of residents) {
      const memberIndex = members.findIndex(member => member.id === actor.id), rally = plan.rallyPoints[plan.memberIds.indexOf(actor.id)] ?? plan.base;
      if (plan.operational === false) {
        directives.push({ actorId: actor.id, destination: now < (plan.strandedUntil ?? 0) && distance(actor, plan.base) > 2 ? copy(plan.base) : null,
          activity: now < (plan.strandedUntil ?? 0) ? 'withdraw' : 'rest' }); continue;
      }
      if (state.phase === 'rest' || memberIndex < 0) {
        // Carrying ends only at an actual deposit. A rally slot may be outside
        // the cache's interaction range, and distance alone cannot imply LOS.
        directives.push({ actorId: actor.id, destination: actor.carried || distance(actor, plan.base) <= 6 && !canSee(actor, plan.base) ? copy(plan.base) : distance(actor, rally) <= 1.5 ? null : copy(rally),
          activity: actor.carried ? 'haul' : !atBasePoint(actor, plan) ? state.retreating ? 'withdraw' : 'assemble' : plan.recoveryPending ? 'regroup' : 'rest' });
        continue;
      }
      if (state.phase === 'assemble') { directives.push({ actorId: actor.id, destination: distance(actor, plan.base) <= 6 && !canSee(actor, plan.base) ? copy(plan.base) : distance(actor, rally) <= 1.5 ? null : copy(rally), activity: 'assemble' }); continue; }
      if (state.phase === 'objective' && target) {
        directives.push({ actorId: actor.id, destination: actor.carried && state.missionKind === 'defend' && state.targetId === plan.baseId ? copy(plan.base) : distance(actor, target.point) <= 4 && canSee(actor, target.point) ? null : copy(target.point), activity: state.missionKind }); continue;
      }
      const returning = state.phase === 'return', destination = returning ? plan.base : target?.point;
      let goal: LivePoint | null = destination ? copy(destination) : null;
      if (leader && actor.id === leader.id && waiting) goal = null;
      else if (leader && actor.id !== leader.id) {
        const offset = Math.max(2, memberIndex * 2), breadcrumb = state.trail[Math.max(0, state.trail.length - 1 - offset)];
        goal = breadcrumb ? copy(breadcrumb) : copy(leader);
        if (distance(actor, goal) <= 1.5 && distance(actor, leader) <= 3) goal = null;
        if (returning && (distance(actor, plan.base) <= 6 && !canSee(actor, plan.base) || state.waitSince !== null && now - state.waitSince >= NPC_SQUAD_WAIT_MS)) goal = copy(plan.base);
      }
      directives.push({ actorId: actor.id, destination: goal, activity: returning ? state.retreating ? 'withdraw' : actor.carried ? 'haul' : 'travel' : state.missionKind === 'defend' ? state.targetId === plan.baseId ? 'defend' : 'reinforce' : state.missionKind === 'retake' ? 'retake' : state.missionKind === 'assault' ? 'assault' : 'travel' });
    }
    decisions.push({ squadId: plan.id, phase: state.phase, missionKind: state.missionKind, targetId: state.targetId, baseId: plan.operational === false ? null : plan.baseId, leaderId: state.leaderId,
      memberIds: (state.phase === 'rest' ? residents : members).map(member => member.id), atBase: atBase(state.phase === 'rest' ? residents : members), atObjective: state.phase === 'objective' && Boolean(target) && members.length >= 2 && members.every(actor => distance(actor, target!.point) <= 6 && canSee(actor, target!.point)),
      retreating: state.retreating && state.phase === 'return', directives });
  }
  return decisions;
}
