import type { LiveNpcActivity, LivePoint } from '../src/game/live';
import type { LiveMapDefinition, LiveNpcSpawn } from '../src/game/live-maps';

export const NPC_THINK_MS = 500;
export const NPC_CONTACT_MEMORY_MS = 10_000;
export const NPC_NOISE_MEMORY_MS = 12_000;
export const NPC_NOISE_COOLDOWN_MS = 45_000;
export const NPC_HEARING_RADIUS = 28;
export const NPC_NOISE_RESPONDERS = 2;
export const NPC_NOISE_INCIDENT_MS = 15_000;

/** Private server state. Only phase is projected, and only for a visible actor. */
export interface NpcLifeState {
  phase: LiveNpcActivity;
  destination: LivePoint | null;
  until: number;
  cycle: number;
  nextThinkAt: number;
  targetId: string | null;
  lastSeen: LivePoint | null;
  lastSeenUntil: number;
  investigateUntil: number;
  respondAfter: number;
  noiseId: string | null;
}
export interface NpcLifePlan {
  siteId: string;
  rounds: LivePoint[];
  visits: LivePoint[];
  approaches: LivePoint[];
  leash: number;
}
type Resident = LivePoint & { home: LivePoint; role: LiveNpcSpawn['role']; spawnIndex: number; routeIndex: number; route: LivePoint[] };
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const copy = (point: LivePoint): LivePoint => ({ x: point.x, y: point.y });
const unique = (points: LivePoint[]): LivePoint[] => [...new Map(points.map(point => [`${point.x}:${point.y}`, copy(point)])).values()];
const inside = (point: LivePoint, rect: LivePoint & { width: number; height: number }): boolean => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
const phaseValues: readonly LiveNpcActivity[] = ['patrol', 'travel', 'inspect', 'rest', 'investigate', 'return', 'combat'];
const variation = (index: number, cycle: number): number => ((Math.imul(index + 1, 2654435761) ^ Math.imul(cycle + 1, 1597334677)) >>> 0) / 0x1_0000_0000;

/** Authored geometry is read once. Runtime excursions never mutate spawn protection routes. */
export function createNpcLifePlans(world: LiveMapDefinition, walkable: (point: LivePoint) => boolean, lineOfSight: (a: LivePoint, b: LivePoint) => boolean, excluded: (point: LivePoint) => boolean): NpcLifePlan[] {
  const homes = world.npcSpawns.map(spawn => world.pois.filter(poi => inside(spawn.point, poi)).sort((a, b) => a.width * a.height - b.width * b.height)[0]);
  const factions = new Map<string, Set<LiveNpcSpawn['faction']>>();
  for (const [index, spawn] of world.npcSpawns.entries()) {
    const home = homes[index]; if (!home) continue;
    const owners = factions.get(home.id) ?? new Set(); owners.add(spawn.faction); factions.set(home.id, owners);
  }
  const entries = [...world.extracts, ...world.districts.flatMap(district => district.spawns)];
  const safe = (point: LivePoint): boolean => walkable(point) && !excluded(point) && !entries.some(entry => distance(point, entry) < 12);
  return world.npcSpawns.map((spawn, index) => {
    const home = homes[index], radius = spawn.role === 'guard' ? 6 : 3;
    const local: LivePoint[] = [];
    if (spawn.role !== 'patrol') for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
      const point = { x: spawn.point.x + x, y: spawn.point.y + y };
      if (distance(point, spawn.point) >= 2 && distance(point, spawn.point) <= radius && walkable(point) && lineOfSight(spawn.point, point) && (!home || inside(point, home))) local.push(point);
    }
    local.sort((a, b) => distance(b, spawn.point) - distance(a, spawn.point) || a.y - b.y || a.x - b.x);
    const rounds = unique(spawn.role === 'patrol' ? spawn.route : [...spawn.route.filter(point => distance(point, spawn.point) <= radius), ...local.filter((_, i) => i % Math.max(1, Math.floor(local.length / 4)) === 0).slice(0, 4), spawn.point]);
    const visits = spawn.role !== 'patrol' || !home ? [] : world.pois.filter(poi => poi.id !== home.id && poi.districtId === home.districtId && factions.get(poi.id)?.size === 1 && factions.get(poi.id)?.has(spawn.faction))
      .flatMap(poi => poi.entrances).filter(point => distance(point, spawn.point) >= 16 && distance(point, spawn.point) <= 64 && safe(point))
      .sort((a, b) => distance(a, spawn.point) - distance(b, spawn.point) || a.y - b.y || a.x - b.x).slice(0, 4);
    const approaches = unique([...spawn.route, ...home?.entrances ?? []]).filter(point => distance(point, spawn.point) >= 8 && distance(point, spawn.point) <= 24 && safe(point));
    return { siteId: home?.id ?? `${spawn.point.x}:${spawn.point.y}`, rounds: rounds.length ? rounds : [copy(spawn.point)], visits, approaches,
      leash: spawn.role === 'patrol' ? Math.max(14, ...spawn.route.map(point => distance(spawn.point, point) + 9), ...visits.map(point => distance(spawn.point, point) + 9)) : spawn.role === 'guard' ? 8 : 10 };
  });
}

export function createNpcLife(resident: Resident, time: number, returning = false): NpcLifeState {
  return { phase: returning ? 'return' : 'rest', destination: returning ? copy(resident.home) : null,
    until: time + (returning ? 90_000 : 500 + Math.floor(variation(resident.spawnIndex, 0) * 6_000)), cycle: 0,
    nextThinkAt: time + Math.floor(variation(resident.spawnIndex, 1) * NPC_THINK_MS),
    targetId: null, lastSeen: null, lastSeenUntil: 0, investigateUntil: 0, respondAfter: 0, noiseId: null };
}

export function restoreNpcLife(value: NpcLifeState | undefined, resident: Resident, time: number, walkable: (point: LivePoint) => boolean): NpcLifeState {
  const point = (item: LivePoint | null): boolean => item === null || Boolean(item && walkable(item));
  if (!value || !phaseValues.includes(value.phase) || !point(value.destination) || !point(value.lastSeen)
    || ![value.until, value.cycle, value.nextThinkAt, value.lastSeenUntil, value.investigateUntil, value.respondAfter].every(number => Number.isSafeInteger(number) && number >= 0)
    || value.cycle > 1_000_000 || !(value.targetId === null || typeof value.targetId === 'string') || !(value.noiseId === null || typeof value.noiseId === 'string')) return createNpcLife(resident, time);
  // Runtime target acquisition is cheap and staggered after a reload; all deadlines stay absolute.
  value.nextThinkAt = time + Math.floor(variation(resident.spawnIndex, value.cycle) * NPC_THINK_MS);
  return value;
}

export function rememberNpcContact(state: NpcLifeState, target: LivePoint & { id: string }, time: number): void {
  state.phase = 'combat'; state.targetId = target.id; state.lastSeen = copy(target); state.lastSeenUntil = time + NPC_CONTACT_MEMORY_MS;
  state.destination = copy(target); state.investigateUntil = state.lastSeenUntil;
}

export function investigateNpcNoise(state: NpcLifeState, id: string, point: LivePoint, time: number): void {
  state.phase = 'investigate'; state.destination = copy(point); state.targetId = null; state.lastSeen = null; state.lastSeenUntil = 0;
  state.investigateUntil = time + NPC_NOISE_MEMORY_MS; state.respondAfter = time + NPC_NOISE_COOLDOWN_MS; state.noiseId = id;
}

/** A finite schedule advances one decision at a time, with no offline catch-up or teleport. */
export function advanceNpcRoutine(resident: Resident, state: NpcLifeState, plan: NpcLifePlan, time: number): LivePoint | null {
  const arrived = state.destination !== null && distance(resident, state.destination) < 1.5;
  const returning = (): LivePoint => {
    state.phase = 'return'; state.destination = copy(resident.home); state.until = time + 90_000;
    state.targetId = null; state.lastSeen = null; state.lastSeenUntil = 0; state.investigateUntil = 0;
    return state.destination;
  };
  const rest = (): null => {
    state.phase = 'rest'; state.destination = null;
    state.until = time + (resident.role === 'patrol' ? 3_000 : resident.role === 'guard' ? 8_000 : 12_000) + Math.floor(variation(resident.spawnIndex, state.cycle) * (resident.role === 'patrol' ? 5_000 : 12_000));
    return null;
  };
  if (state.phase === 'combat') {
    state.phase = 'investigate'; state.destination = state.lastSeen && copy(state.lastSeen); state.investigateUntil = state.lastSeenUntil;
  }
  if (state.phase === 'investigate') {
    if (state.investigateUntil <= time || !state.destination) return returning();
    return arrived ? null : state.destination;
  }
  if (state.phase === 'return') {
    if (arrived || state.until <= time) return rest();
    return state.destination;
  }
  if (state.phase === 'patrol' || state.phase === 'travel') {
    if (state.until <= time) return returning();
    if (!arrived) return state.destination;
    state.phase = 'inspect'; state.until = time + 2_000 + Math.floor(variation(resident.spawnIndex, state.cycle) * 4_000);
    return null;
  }
  if (state.until > time) return null;
  if (state.phase === 'inspect' && state.cycle % 3 === 0) return returning();
  if (state.phase === 'inspect') return rest();
  state.cycle = (state.cycle + 1) % 1_000_000;
  const travel = resident.role === 'patrol' && plan.visits.length > 0 && state.cycle % 3 === 0;
  const candidates = travel ? plan.visits : plan.rounds;
  const offset = Math.floor(variation(resident.spawnIndex, 3) * candidates.length);
  resident.routeIndex = ((travel ? Math.floor(state.cycle / 3) : state.cycle) + offset) % candidates.length;
  state.destination = copy(candidates[resident.routeIndex]!);
  state.phase = travel ? 'travel' : 'patrol'; state.until = time + (travel ? 150_000 : 90_000);
  return state.destination;
}
