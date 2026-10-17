import type { LiveDistrictId, LivePoint } from '../src/game/live';
import type { LiveMapDefinition } from '../src/game/live-maps';

export type NpcSquadFaction = 'scavs' | 'raiders';
export type NpcSquadPhase = 'rest' | 'assemble' | 'travel' | 'objective' | 'return';
export type NpcSquadActivity = 'assemble' | 'travel' | 'capture' | 'forage' | 'haul' | 'withdraw' | 'rest';
export const NPC_SQUAD_MISSION_MS = 240_000;
export const NPC_SQUAD_RETURN_MS = 180_000;
export const NPC_SQUAD_REGROUP_MS = 90_000;
export const NPC_SQUAD_WAIT_MS = 10_000;
export const NPC_SQUAD_ACTIVE_PER_DISTRICT = 2;
export interface NpcTerritoryPlan {
  id: string; poiId: string; districtId: LiveDistrictId; point: LivePoint; initialOwner: NpcSquadFaction | null;
}
export interface NpcSquadPlan {
  id: string; faction: NpcSquadFaction; districtId: LiveDistrictId; baseId: string; base: LivePoint;
  memberIds: string[]; spawnIndices: number[]; rallyPoints: LivePoint[];
  targets: Array<{ territoryId: string; point: LivePoint; pathLength: number; hasSupplies: boolean }>;
}
export interface NpcSquadActor extends LivePoint {
  id: string; health: number; lifeCycle: number; inCombat: boolean; carried: boolean; canForage: boolean;
}
export interface NpcSquadState {
  id: string; phase: NpcSquadPhase; missionKind: 'capture' | 'forage'; targetId: string | null; leaderId: string | null;
  members: Array<{ id: string; lifeCycle: number }>;
  startedAt: number; phaseUntil: number; missionUntil: number; restUntil: number; returnUntil: number;
  trail: LivePoint[]; waitSince: number | null; retreating: boolean;
  outcome: 'pending' | 'completed' | 'casualty' | 'wounded' | 'timeout' | 'blocked' | 'unavailable';
  cycle: number;
}
export interface NpcSquadDirective { actorId: string; destination: LivePoint | null; activity: NpcSquadActivity }
export interface NpcSquadDecision {
  squadId: string; phase: NpcSquadPhase; missionKind: 'capture' | 'forage'; targetId: string | null; baseId: string;
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
  return { squads, territories: [...territories.filter(territory => squads.some(squad => squad.targets.some(target => target.territoryId === territory.id))),
    ...squads.map(squad => ({ id: squad.baseId, poiId: squad.baseId, districtId: squad.districtId, point: copy(squad.base), initialOwner: squad.faction }))] };
}

export function createNpcSquadState(plan: NpcSquadPlan, now: number): NpcSquadState {
  return { id: plan.id, phase: 'rest', missionKind: 'capture', targetId: null, leaderId: null, members: [], startedAt: 0,
    phaseUntil: 0, missionUntil: 0, restUntil: now + 12_000 + hash(plan.id) % 30_000, returnUntil: 0,
    trail: [], waitSince: null, retreating: false, outcome: 'pending', cycle: 0 };
}
export function restoreNpcSquadState(plan: NpcSquadPlan, value: NpcSquadState | undefined, now: number): NpcSquadState {
  if (!value || value.id !== plan.id || !['rest', 'assemble', 'travel', 'objective', 'return'].includes(value.phase)
    || !['capture', 'forage'].includes(value.missionKind) || !['pending', 'completed', 'casualty', 'wounded', 'timeout', 'blocked', 'unavailable'].includes(value.outcome)
    || ![value.startedAt, value.phaseUntil, value.missionUntil, value.restUntil, value.returnUntil, value.cycle].every(number => Number.isSafeInteger(number) && number >= 0)
    || value.cycle > 1_000_000 || typeof value.retreating !== 'boolean' || !(value.waitSince === null || Number.isSafeInteger(value.waitSince) && value.waitSince >= 0)
    || !Array.isArray(value.members) || value.members.length > 3 || value.members.some(member => !member || !plan.memberIds.includes(member.id) || !Number.isSafeInteger(member.lifeCycle) || member.lifeCycle < 0)
    || new Set(value.members.map(member => member.id)).size !== value.members.length
    || !(value.leaderId === null || value.members.some(member => member.id === value.leaderId))
    || !(value.targetId === null || plan.targets.some(target => target.territoryId === value.targetId))
    || !Array.isArray(value.trail) || value.trail.length > 32 || value.trail.some(point => !point || ![point.x, point.y].every(number => Number.isInteger(number) && number >= 0 && number < 1024))) return createNpcSquadState(plan, now);
  return value;
}

function startReturn(state: NpcSquadState, now: number, outcome: NpcSquadState['outcome'], retreating: boolean): void {
  state.phase = 'return'; state.phaseUntil = now + NPC_SQUAD_RETURN_MS; state.returnUntil = state.phaseUntil;
  state.waitSince = null; state.retreating = retreating; state.outcome = outcome; state.trail = [];
}
/** Called only after real capture/forage succeeds; never awards anything itself. */
export function completeObjective(state: NpcSquadState, now: number): void {
  if (state.phase === 'objective') startReturn(state, now, 'completed', false);
}

/** At most one bounded decision per squad per caller tick (normally 500ms). */
export function advanceNpcSquads(plans: readonly NpcSquadPlan[], states: Map<string, NpcSquadState>, actors: ReadonlyMap<string, NpcSquadActor>, owners: ReadonlyMap<string, NpcSquadFaction | null>, now: number): NpcSquadDecision[] {
  const active = new Map<LiveDistrictId, number>();
  const reserved = new Set<string>();
  for (const plan of plans) { const state = states.get(plan.id); if (state && state.phase !== 'rest' && state.phase !== 'return' && state.targetId) reserved.add(`${plan.faction}:${state.targetId}`); }
  for (const plan of plans) if (states.get(plan.id)?.phase && states.get(plan.id)!.phase !== 'rest') active.set(plan.districtId, (active.get(plan.districtId) ?? 0) + 1);
  const decisions: NpcSquadDecision[] = [];
  for (const plan of plans) {
    const state = states.get(plan.id) ?? createNpcSquadState(plan, now); states.set(plan.id, state);
    const residents = plan.memberIds.flatMap(id => { const actor = actors.get(id); return actor && actor.health > 0 ? [actor] : []; });
    const present = (): NpcSquadActor[] => state.members.flatMap(member => { const actor = actors.get(member.id); return actor && actor.health > 0 && actor.lifeCycle === member.lifeCycle ? [actor] : []; });
    const atBase = (members: readonly NpcSquadActor[]) => members.length > 0 && members.every(actor => distance(actor, plan.base) <= 6);
    const rest = (): void => {
      state.phase = 'rest'; state.restUntil = now + 45_000 + hash(`${plan.id}:${state.cycle}`) % 30_000;
      state.phaseUntil = state.restUntil; state.waitSince = null; state.trail = []; state.targetId = null; state.leaderId = null; state.members = [];
      active.set(plan.districtId, Math.max(0, (active.get(plan.districtId) ?? 1) - 1));
    };
    if (state.phase !== 'rest' && state.phase !== 'return') {
      const members = present();
      if (members.length < state.members.length) startReturn(state, now, 'casualty', true);
      else if (members.some(actor => actor.health < 40)) startReturn(state, now, 'wounded', true);
      else if (now >= state.missionUntil) startReturn(state, now, 'timeout', true);
    }
    if (state.phase === 'return' && (!present().length || atBase(present()) || now >= state.returnUntil)) rest();
    if (state.phase === 'rest' && now >= state.restUntil && (active.get(plan.districtId) ?? 0) < NPC_SQUAD_ACTIVE_PER_DISTRICT) {
      const ready = residents.filter(actor => actor.health >= 40 && !actor.inCombat && distance(actor, plan.base) <= 6 && !actor.carried);
      if (ready.length >= 2) {
        const available = plan.targets.filter(target => !reserved.has(`${plan.faction}:${target.territoryId}`));
        const hostile = available.filter(target => owners.get(target.territoryId) !== plan.faction), forage = available.filter(target => target.hasSupplies && owners.get(target.territoryId) === plan.faction);
        const wantsForage = ready.some(actor => actor.canForage) && forage.length > 0 && ((state.cycle + hash(plan.id)) % 2 === 0 || !hostile.length);
        const choices = wantsForage ? forage : hostile;
        if (choices.length) {
          const target = choices[state.cycle % choices.length]!;
          state.phase = 'assemble'; state.missionKind = wantsForage ? 'forage' : 'capture'; state.targetId = target.territoryId;
          state.members = ready.map(actor => ({ id: actor.id, lifeCycle: actor.lifeCycle })); state.leaderId = ready[0]!.id;
          state.startedAt = now; state.phaseUntil = now + NPC_SQUAD_REGROUP_MS; state.missionUntil = now + NPC_SQUAD_MISSION_MS;
          state.returnUntil = 0; state.waitSince = null; state.retreating = false; state.outcome = 'pending'; state.cycle = (state.cycle + 1) % 1_000_000; state.trail = [copy(ready[0]!)];
          active.set(plan.districtId, (active.get(plan.districtId) ?? 0) + 1);
          reserved.add(`${plan.faction}:${target.territoryId}`);
        }
      }
    }
    let members = present();
    const target = state.targetId ? plan.targets.find(target => target.territoryId === state.targetId) : undefined;
    if (state.phase !== 'rest' && state.phase !== 'return' && !target) startReturn(state, now, 'unavailable', true);
    if (state.phase === 'assemble') {
      if (members.length >= 2 && atBase(members) && members.every(actor => !actor.inCombat)) {
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
      if (state.phase === 'rest' || memberIndex < 0) {
        // Carrying ends only at an actual deposit. A rally slot may be outside
        // the cache's interaction range, and distance alone cannot imply LOS.
        directives.push({ actorId: actor.id, destination: actor.carried ? copy(plan.base) : distance(actor, rally) <= 1.5 ? null : copy(rally),
          activity: actor.carried ? 'haul' : distance(actor, plan.base) > 6 ? state.retreating ? 'withdraw' : 'assemble' : 'rest' });
        continue;
      }
      if (state.phase === 'assemble') { directives.push({ actorId: actor.id, destination: distance(actor, rally) <= 1.5 ? null : copy(rally), activity: 'assemble' }); continue; }
      if (state.phase === 'objective' && target) {
        directives.push({ actorId: actor.id, destination: distance(actor, target.point) <= 4 ? null : copy(target.point), activity: state.missionKind === 'capture' ? 'capture' : 'forage' }); continue;
      }
      const returning = state.phase === 'return', destination = returning ? plan.base : target?.point;
      let goal: LivePoint | null = destination ? copy(destination) : null;
      if (leader && actor.id === leader.id && waiting) goal = null;
      else if (leader && actor.id !== leader.id) {
        const offset = Math.max(2, memberIndex * 2), breadcrumb = state.trail[Math.max(0, state.trail.length - 1 - offset)];
        goal = breadcrumb ? copy(breadcrumb) : copy(leader);
        if (distance(actor, goal) <= 1.5 && distance(actor, leader) <= 3) goal = null;
        if (returning && state.waitSince !== null && now - state.waitSince >= NPC_SQUAD_WAIT_MS) goal = copy(rally);
      }
      directives.push({ actorId: actor.id, destination: goal, activity: returning ? state.retreating ? 'withdraw' : actor.carried ? 'haul' : 'travel' : 'travel' });
    }
    decisions.push({ squadId: plan.id, phase: state.phase, missionKind: state.missionKind, targetId: state.targetId, baseId: plan.baseId, leaderId: state.leaderId,
      memberIds: (state.phase === 'rest' ? residents : members).map(member => member.id), atBase: atBase(state.phase === 'rest' ? residents : members), atObjective: state.phase === 'objective' && Boolean(target) && members.length >= 2 && members.every(actor => distance(actor, target!.point) <= 6),
      retreating: state.retreating && state.phase === 'return', directives });
  }
  return decisions;
}
