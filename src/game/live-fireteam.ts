import type { LivePoint } from './live';

export const LIVE_FIRETEAM_SUPPORT_MS = 2200;
export const LIVE_FIRETEAM_CONTACT_MS = 4500;
export const LIVE_FIRETEAM_SEARCH_STEPS = 6;
export interface LiveFireteamContact { targetId: string; point: LivePoint; seenAt: number; visible: boolean }
export interface LiveFireteamActor {
  id: string; point: LivePoint; health: number; suppression: number; range: number;
  /** Ammunition and physical ability to fire, not the individual attack timer. */
  ready: boolean; moving?: boolean; contact?: LiveFireteamContact;
  /** Receipt of a validated projectile, including a miss. An aim is not support. */
  lastShot?: { at: number; targetId: string }; cover?: LivePoint;
}
export interface LiveFireteamGeometry {
  clear(point: LivePoint, actorId: string): boolean;
  hasLineOfSight(from: LivePoint, to: LivePoint): boolean;
  permitted?(point: LivePoint, actorId: string): boolean;
}
export interface LiveFireteamOrder {
  role: 'covering' | 'flanking' | 'withdrawing' | 'regrouping';
  /** One adjacent walking step. No destination means hold, except covering,
   * which retains the caller's ordinary cover/peek/fire cadence. */
  destination?: LivePoint; targetId?: string; supporterId?: string;
  /** Completed flank: acquire from the achieved angle before finding another
   * cover point. This changes location intent, never the firing cadence. */
  holdPosition?: boolean;
}
interface Bound {
  moverId: string; supporterId: string; targetId: string; threat: LivePoint; goal: LivePoint;
  createdAt: number; lastSupportedAt: number; side: number;
}
interface Withdrawal {
  origin: LivePoint; threat: LivePoint; targetId: string; until: number; goal?: LivePoint; startedHidden: boolean;
}
interface Station { point: LivePoint; targetId: string; arrivedAt: number; until: number }
export interface LiveFireteamState {
  bound?: Bound; withdrawals: Map<string, Withdrawal>; cooldownUntil: number; previousMover?: string; side: number;
  stations: Map<string, Station>;
}
export function createLiveFireteamState(): LiveFireteamState {
  return { withdrawals: new Map(), stations: new Map(), cooldownUntil: 0, side: 1 };
}
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: LivePoint, b: LivePoint): boolean => distance(a, b) < .1;
const copy = (p: LivePoint): LivePoint => ({ x: p.x, y: p.y });
const adjacent = (p: LivePoint): LivePoint[] => [
  { x: p.x - 1, y: p.y }, { x: p.x + 1, y: p.y }, { x: p.x, y: p.y - 1 }, { x: p.x, y: p.y + 1 },
];
const fresh = (actor: LiveFireteamActor, now: number): actor is LiveFireteamActor & { contact: LiveFireteamContact } =>
  !!actor.contact && now >= actor.contact.seenAt && now - actor.contact.seenAt <= LIVE_FIRETEAM_CONTACT_MS;
const pressured = (actor: LiveFireteamActor): boolean => actor.suppression >= .72 || actor.suppression >= .52 && actor.health <= 58;
const active = (actor: LiveFireteamActor): boolean => actor.health > 0;
interface Node { point: LivePoint; parent: number; steps: number; exposed: number }

/** Cardinal BFS is deliberately local: at most 85 cells, no map-wide paths or
 * access to an opponent's current position. Occupancy belongs to the caller. */
function search(actor: LiveFireteamActor, threat: LivePoint, geometry: LiveFireteamGeometry,
  allowed: (point: LivePoint, from: LivePoint) => boolean = () => true): Node[] {
  const nodes: Node[] = [{ point: copy(actor.point), parent: -1, steps: 0, exposed: 0 }];
  const visited = new Set([`${actor.point.x},${actor.point.y}`]);
  for (let cursor = 0; cursor < nodes.length; cursor++) {
    const node = nodes[cursor]!;
    if (node.steps >= LIVE_FIRETEAM_SEARCH_STEPS) continue;
    for (const point of adjacent(node.point)) {
      const key = `${point.x},${point.y}`;
      if (visited.has(key)) continue;
      if (!geometry.clear(point, actor.id) || !(geometry.permitted?.(point, actor.id) ?? true) || !allowed(point, node.point)) continue;
      visited.add(key);
      nodes.push({ point, parent: cursor, steps: node.steps + 1,
        exposed: node.exposed + Number(geometry.hasLineOfSight(point, threat)) });
    }
  }
  return nodes;
}
function firstStep(nodes: readonly Node[], index: number): LivePoint | undefined {
  if (index <= 0) return undefined;
  while (nodes[index]!.parent > 0) index = nodes[index]!.parent;
  return copy(nodes[index]!.point);
}
function betweenFireLane(point: LivePoint, supporter: LivePoint, threat: LivePoint): boolean {
  const dx = threat.x - supporter.x, dy = threat.y - supporter.y, length2 = dx * dx + dy * dy;
  if (!length2) return false;
  const t = ((point.x - supporter.x) * dx + (point.y - supporter.y) * dy) / length2;
  return t > 0 && t < 1 && distance(point, { x: supporter.x + t * dx, y: supporter.y + t * dy }) < .8;
}
function supported(actor: LiveFireteamActor, targetId: string, threat: LivePoint, now: number, geometry: LiveFireteamGeometry): boolean {
  // A successfully suppressed opponent often ducks immediately. The actual
  // burst briefly covers the last witnessed lane even then; it never grants a
  // fresh shot or follows the hidden opponent around the obstacle.
  return actor.ready && !actor.moving && actor.suppression < .52 && fresh(actor, now)
    && now - actor.contact.seenAt <= LIVE_FIRETEAM_SUPPORT_MS
    && actor.contact.targetId === targetId && distance(actor.contact.point, threat) <= 3
    && distance(actor.point, threat) <= actor.range
    && geometry.hasLineOfSight(actor.point, threat)
    && actor.lastShot?.targetId === targetId && now >= actor.lastShot.at && now - actor.lastShot.at <= LIVE_FIRETEAM_SUPPORT_MS;
}
function flank(mover: LiveFireteamActor, supporter: LiveFireteamActor, threat: LivePoint, side: number,
  actors: readonly LiveFireteamActor[], geometry: LiveFireteamGeometry): LivePoint | undefined {
  const dx = threat.x - mover.point.x, dy = threat.y - mover.point.y, length = Math.hypot(dx, dy);
  if (length < 4 || length > mover.range + 4) return undefined;
  const nodes = search(mover, threat, geometry, point => distance(point, threat) >= 3
    && !betweenFireLane(point, supporter.point, threat)
    && !actors.some(actor => actor.id !== mover.id && distance(actor.point, point) < .9));
  let best: { point: LivePoint; score: number } | undefined;
  for (const node of nodes) {
    const px = node.point.x - mover.point.x, py = node.point.y - mover.point.y;
    const lateral = (dx * py - dy * px) / length, advance = (dx * px + dy * py) / length;
    if (lateral * side < 2.5 || advance > 2 || distance(node.point, supporter.point) < 3
      || distance(node.point, threat) > mover.range || !geometry.hasLineOfSight(node.point, threat)) continue;
    const shelter = adjacent(node.point).some(point => geometry.clear(point, mover.id)
      && (geometry.permitted?.(point, mover.id) ?? true) && !geometry.hasLineOfSight(point, threat));
    const score = node.steps + node.exposed * .18 + Math.abs(advance) * .4 - Math.abs(lateral) * .35 - Number(shelter) * 2;
    if (!best || score < best.score) best = { point: node.point, score };
  }
  return best && copy(best.point);
}
function nextTo(actor: LiveFireteamActor, goal: LivePoint, threat: LivePoint, geometry: LiveFireteamGeometry,
  allowed?: (point: LivePoint) => boolean): LivePoint | undefined {
  const nodes = search(actor, threat, geometry, allowed), index = nodes.findIndex(node => same(node.point, goal));
  return firstStep(nodes, index);
}
function retreat(actor: LiveFireteamActor, memory: Withdrawal, actors: readonly LiveFireteamActor[], geometry: LiveFireteamGeometry,
  reserved: readonly LivePoint[]): LivePoint | undefined {
  const initialDistance = distance(memory.origin, memory.threat), currentDistance = distance(actor.point, memory.threat);
  const allowed = (point: LivePoint, from: LivePoint): boolean => distance(point, memory.origin) <= 10
    && distance(point, memory.threat) >= distance(from, memory.threat) - (memory.startedHidden ? 0 : .35)
    && (!memory.startedHidden || !geometry.hasLineOfSight(point, memory.threat))
    && !reserved.some(other => same(other, point))
    && !actors.some(other => other.id !== actor.id && distance(other.point, point) < .9);
  const nodes = search(actor, memory.threat, geometry, allowed);
  if (memory.goal && !same(actor.point, memory.goal)) {
    const index = nodes.findIndex(node => same(node.point, memory.goal!));
    if (index > 0) return firstStep(nodes, index);
    memory.goal = undefined;
  }
  // Once sheltered or at a useful separation, recover there instead of running
  // indefinitely farther away while the pressure meter decays.
  if (!geometry.hasLineOfSight(actor.point, memory.threat) && (!memory.startedHidden || distance(actor.point, memory.origin) >= 2)
    || currentDistance >= initialDistance + 3) return undefined;
  let best: { index: number; score: number } | undefined;
  nodes.forEach((node, index) => {
    if (!index) return;
    const separation = distance(node.point, memory.threat) - currentDistance;
    const hidden = !geometry.hasLineOfSight(node.point, memory.threat);
    // When already ducked behind a pressured corner, a small fallback is useful
    // only if the entire route stays hidden. Never step out just to show retreat.
    if (memory.startedHidden && distance(node.point, memory.origin) < 2) return;
    if (!hidden && separation < 2) return;
    const reserved = [...actors].some(other => other.id !== actor.id && distance(node.point, other.point) < 1.5);
    if (reserved) return;
    const score = node.steps + node.exposed * .3 - Number(hidden) * 5 - Math.min(3, separation) * .7;
    if (!best || score < best.score) best = { index, score };
  });
  if (!best) return undefined;
  memory.goal = copy(nodes[best.index]!.point);
  return firstStep(nodes, best.index);
}

/** Call once per simulation tick for one real nearby squad, with simultaneous
 * personal observations. The helper chooses movement only: it never fires,
 * grants ammunition, changes accuracy or tells anyone about an unseen enemy. */
export function stepLiveFireteam(state: LiveFireteamState, input: readonly LiveFireteamActor[], now: number,
  geometry: LiveFireteamGeometry): Map<string, LiveFireteamOrder> {
  const actors = input.filter(active).slice(0, 12).sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(actors.map(actor => [actor.id, actor]));
  const orders = new Map<string, LiveFireteamOrder>();
  const retreatSteps: LivePoint[] = [];
  for (const id of state.withdrawals.keys()) if (!byId.has(id)) state.withdrawals.delete(id);
  for (const [id, station] of state.stations) {
    const actor = byId.get(id);
    if (!actor || !actor.ready || actor.suppression >= .52 || !same(actor.point, station.point)
      || !fresh(actor, now) || !actor.contact.visible && now - actor.contact.seenAt > LIVE_FIRETEAM_SUPPORT_MS
      || !geometry.hasLineOfSight(actor.point, actor.contact.point)) { state.stations.delete(id); continue; }
    if (actor.contact.visible) station.targetId = actor.contact.targetId;
    else if (actor.contact.targetId !== station.targetId) { state.stations.delete(id); continue; }
    if (actor.lastShot?.targetId === station.targetId && actor.lastShot.at >= station.arrivedAt && actor.lastShot.at <= now)
      station.until = Math.min(station.until, actor.lastShot.at + LIVE_FIRETEAM_SUPPORT_MS);
    if (now >= station.until) state.stations.delete(id);
  }
  if (state.bound && (!byId.has(state.bound.moverId) || !byId.has(state.bound.supporterId))) {
    state.bound = undefined; state.cooldownUntil = now + 1800;
  }
  for (const actor of actors) {
    let memory = state.withdrawals.get(actor.id);
    if (!memory && actors.length >= 2 && fresh(actor, now) && (pressured(actor) || actor.health <= 32)) {
      memory = { origin: copy(actor.point), threat: copy(actor.contact.point), targetId: actor.contact.targetId, until: now + 3500,
        startedHidden: !geometry.hasLineOfSight(actor.point, actor.contact.point) };
      state.withdrawals.set(actor.id, memory);
    }
    if (!memory) continue;
    state.stations.delete(actor.id);
    if (pressured(actor)) memory.until = Math.max(memory.until, now + 1500);
    // New coordinates are accepted only from this fighter's current eyesight.
    if (fresh(actor, now) && actor.contact.visible && actor.contact.targetId === memory.targetId
      && distance(actor.contact.point, memory.threat) > 1.5) {
      memory.threat = copy(actor.contact.point); memory.goal = undefined;
      if (geometry.hasLineOfSight(actor.point, memory.threat)) memory.startedHidden = false;
    }
    if (now >= memory.until && actor.suppression < .3) {
      state.withdrawals.delete(actor.id); state.cooldownUntil = Math.max(state.cooldownUntil, now + 1800);
      continue;
    }
    const reserved = [...retreatSteps, ...[...state.withdrawals.entries()]
      .filter(([id, other]) => id !== actor.id && other.goal).map(([, other]) => other.goal!)];
    const destination = retreat(actor, memory, actors, geometry, reserved);
    if (destination) retreatSteps.push(destination);
    orders.set(actor.id, { role: destination ? 'withdrawing' : 'regrouping', destination, targetId: memory.targetId });
  }
  if (state.bound && (state.withdrawals.has(state.bound.moverId) || state.withdrawals.has(state.bound.supporterId))) state.bound = undefined;
  if (orders.size) {
    // The least pressed teammate holds the lane while the other falls back.
    for (const actor of actors) if (!orders.has(actor.id) && fresh(actor, now)) orders.set(actor.id, {
      role: 'covering', targetId: actor.contact.targetId, ...(state.stations.has(actor.id) ? { holdPosition: true } : {}),
    });
    return orders;
  }
  if (state.stations.size) {
    for (const [id, station] of state.stations) orders.set(id, { role: 'covering', targetId: station.targetId, holdPosition: true });
    return orders;
  }
  if (actors.length < 2) return orders;
  let bound = state.bound;
  if (bound) {
    const mover = byId.get(bound.moverId)!, supporter = byId.get(bound.supporterId)!;
    if (same(mover.point, bound.goal)) {
      state.previousMover = mover.id; state.side = -bound.side; state.bound = undefined; state.cooldownUntil = now + 1800;
      if (mover.ready && mover.suppression < .52 && fresh(mover, now) && (mover.contact.visible || now - mover.contact.seenAt <= LIVE_FIRETEAM_SUPPORT_MS)
        && mover.contact.targetId === bound.targetId) {
        state.stations.set(mover.id, { point: copy(mover.point), targetId: bound.targetId, arrivedAt: now, until: now + 6500 });
        orders.set(mover.id, { role: 'covering', targetId: bound.targetId, holdPosition: true });
      }
      return orders;
    }
    if (now - bound.createdAt > 18_000 || !fresh(mover, now) || mover.contact.targetId !== bound.targetId
      || !fresh(supporter, now) || supporter.contact.targetId !== bound.targetId
      || distance(supporter.contact.point, bound.threat) > 3 || mover.suppression >= .52 || mover.health <= 40) {
      state.bound = undefined; state.cooldownUntil = now + 1800; bound = undefined;
    }
  }
  if (!bound && now >= state.cooldownUntil) {
    // After a completed bound the advanced fighter becomes the next supporter.
    const supporters = actors.filter(actor => actor.ready && !actor.moving && actor.suppression < .52 && fresh(actor, now) && actor.contact.visible)
      .sort((a, b) => Number(b.id === state.previousMover) - Number(a.id === state.previousMover)
        || Number(!!b.lastShot && now - b.lastShot.at <= LIVE_FIRETEAM_SUPPORT_MS) - Number(!!a.lastShot && now - a.lastShot.at <= LIVE_FIRETEAM_SUPPORT_MS)
        || a.suppression - b.suppression || a.id.localeCompare(b.id));
    for (const supporter of supporters) {
      for (const mover of actors) {
        if (mover.id === supporter.id || mover.health <= 40 || mover.suppression >= .52 || !fresh(mover, now)
          || !fresh(supporter, now) || mover.contact.targetId !== supporter.contact.targetId
          || distance(mover.contact.point, supporter.contact.point) > 3 || distance(mover.point, supporter.point) > 12) continue;
        const goal = flank(mover, supporter, mover.contact.point, state.side, actors, geometry)
          ?? flank(mover, supporter, mover.contact.point, -state.side, actors, geometry);
        if (!goal) continue;
        const dx = mover.contact.point.x - mover.point.x, dy = mover.contact.point.y - mover.point.y;
        bound = { moverId: mover.id, supporterId: supporter.id, targetId: mover.contact.targetId, threat: copy(mover.contact.point),
          goal, createdAt: now, lastSupportedAt: now, side: Math.sign(dx * (goal.y - mover.point.y) - dy * (goal.x - mover.point.x)) || 1 };
        state.bound = bound; break;
      }
      if (bound) break;
    }
    // Avoid scanning the same blocked corners on every 50 ms tick.
    if (!bound) state.cooldownUntil = now + 750;
  }
  if (!bound) return orders;
  const mover = byId.get(bound.moverId)!, supporter = byId.get(bound.supporterId)!;
  orders.set(supporter.id, { role: 'covering', targetId: bound.targetId });
  if (supported(supporter, bound.targetId, bound.threat, now, geometry)) {
    const destination = nextTo(mover, bound.goal, bound.threat, geometry, point => distance(point, bound!.threat) >= 3
      && !betweenFireLane(point, supporter.point, bound!.threat)
      && !actors.some(actor => actor.id !== mover.id && distance(actor.point, point) < .9));
    if (destination) {
      bound.lastSupportedAt = now;
      orders.set(mover.id, { role: 'flanking', destination, targetId: bound.targetId, supporterId: supporter.id });
      return orders;
    }
  }
  // A reload, obstructed lane or silent supporter cannot continue to authorise
  // a flank. The mover ducks into its own known shelter or waits for the burst.
  const fallback = mover.cover && !geometry.hasLineOfSight(mover.cover, bound.threat)
    ? nextTo(mover, mover.cover, bound.threat, geometry) : undefined;
  orders.set(mover.id, { role: 'regrouping', destination: fallback, targetId: bound.targetId, supporterId: supporter.id });
  if (now - bound.lastSupportedAt > 6500) { state.bound = undefined; state.cooldownUntil = now + 1800; }
  return orders;
}
