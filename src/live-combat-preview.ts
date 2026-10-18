import type { LiveCityBuilding, LiveEntity, LiveEvent, LivePoint, LiveSnapshot, LiveWorld } from './game/live';
import { createCityPreviewSnapshot } from './metropolis-preview';
import { applyLiveIncomingFire, createLiveFirefightState, liveFirefightHitChance, stepLiveFirefight, type LiveFirefightDecision, type LiveFirefightState } from './game/live-firefight';
import { traceLiveBulletImpact } from './game/live-ballistics';
import { createLiveNavigation } from './game/live-navigation';
import { findLiveCombatCover, type LiveCoverPlan } from './game/live-combat-cover';
import { createLiveFireteamState, stepLiveFireteam, type LiveFireteamOrder } from './game/live-fireteam';

export const LIVE_COMBAT_PREVIEW_STEP_MS = 125;
export const LIVE_COMBAT_PREVIEW_DURATION_MS = 60000;
export const LIVE_COMBAT_PREVIEW_FOCUS = { x: 11, y: 8 };
const EPOCH = 1_800_000_000_000;
const RANGE = 12;
const same = (a: LivePoint, b: LivePoint): boolean => a.x === b.x && a.y === b.y;
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A finite local encounter: no account, live client, save or command. The tall
 * building stands beside the lane, leaving both small teams readable. */
export function createLiveCombatPreviewWorld(): LiveWorld {
  const building: LiveCityBuilding = { id: 'contact-apartment', name: 'Дом у переулка', x: 2, y: 14, width: 4, height: 4,
    kind: 'apartment', floors: 3, facade: 'brick', roof: 'flat', entrances: [{ x: 4, y: 17 }] };
  return {
    id: 'perimeter', name: 'Контакт · перестрелка во дворе', description: 'Две группы прикрывают перемещение друг друга и отходят под огнём',
    theme: 'urban', width: 24, height: 24, version: 'contact-gallery-3', seed: 'contact-gallery', generatorVersion: 1, chunkSize: 16,
    districts: [{ id: 'customs', name: 'Переулок', description: '', x: 0, y: 0, width: 24, height: 24, theme: 'urban', spawns: [] }],
    extracts: [], pois: [], containers: [], zones: [],
    terrainRows: Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => y < 4 ? 'g' : x < 5 || x > 18 ? 'y' : 'c').join('')),
    paths: [{ id: 'contact-lane', name: 'Переулок', kind: 'road', width: 3, points: [{ x: 3, y: 4 }, { x: 20, y: 4 }] }],
    citySites: [{ id: 'contact-yard', poiId: 'contact-address', quarterId: 'contact-quarter', name: 'Двор', kind: 'courtyard', x: 2, y: 5, width: 18, height: 14,
      courtyard: { x: 6, y: 6, width: 11, height: 7 }, buildings: [building], passages: [] }],
    props: [
      { id: 'contact-crate', kind: 'crate', x: 9, y: 10, width: 1, height: 2, orientation: 'y', variant: 1, blocking: true },
      { id: 'contact-car', kind: 'car', x: 13, y: 6, width: 1, height: 2, orientation: 'y', variant: 2, blocking: true },
      { id: 'contact-dumpster', kind: 'dumpster', x: 8, y: 5, width: 1, height: 2, orientation: 'y', variant: 1, blocking: true },
      { id: 'contact-van', kind: 'van', x: 15, y: 10, width: 1, height: 3, orientation: 'y', variant: 0, blocking: true },
      { id: 'contact-lamp', kind: 'lamp', x: 18, y: 4, width: 1, height: 1, orientation: 'x', variant: 0, blocking: false },
      { id: 'contact-tree', kind: 'tree', x: 3, y: 2, width: 2, height: 2, orientation: 'x', variant: 2, blocking: true },
    ],
    obstacles: [
      { x: 9, y: 10, width: 1, height: 2, kind: 'barricade', propId: 'contact-crate' },
      { x: 13, y: 6, width: 1, height: 2, kind: 'barricade', propId: 'contact-car' },
      { x: 8, y: 5, width: 1, height: 2, kind: 'barricade', propId: 'contact-dumpster' },
      { x: 15, y: 10, width: 1, height: 3, kind: 'barricade', propId: 'contact-van' },
      { x: 3, y: 2, width: 2, height: 2, kind: 'tree', propId: 'contact-tree' },
      { x: 2, y: 14, width: 4, height: 1, kind: 'building' }, { x: 2, y: 15, width: 1, height: 2, kind: 'building' },
      { x: 5, y: 15, width: 1, height: 2, kind: 'building' }, { x: 2, y: 17, width: 2, height: 1, kind: 'building' },
      { x: 5, y: 17, width: 1, height: 1, kind: 'building' },
    ],
  };
}

interface Fighter {
  entity: LiveEntity; team: 'blue' | 'red'; mind: LiveFirefightState; plan: LiveCoverPlan | null;
  observed: LivePoint; targetId: string; seenAt: number; moveReadyAt: number;
  shots: number; random: number; lastShot?: { at: number; targetId: string };
}
interface PreviewFrame { entities: LiveEntity[]; events: LiveEvent[]; ammo: number }
// One bounded timeline per world. Seeking cannot allocate an unbounded history.
const timelines = new WeakMap<LiveWorld, readonly PreviewFrame[]>();
const random = (fighter: Fighter): number => { fighter.random = (Math.imul(fighter.random, 1664525) + 1013904223) >>> 0; return fighter.random / 4294967296; };

function simulate(world: LiveWorld): readonly PreviewFrame[] {
  const navigation = createLiveNavigation(world), frames: PreviewFrame[] = [];
  const actor = (id: string, name: string, team: Fighter['team'], point: LivePoint, seed: number, leader: boolean): Fighter => ({
    entity: { id, name, kind: team === 'blue' ? 'player' : 'scav', ...point, appearance: team === 'blue' ? leader ? 3 : 7 : leader ? 12 : 14,
      health: 100, safeUntil: 0, action: 'idle', moveIntervalMs: team === 'blue' ? 375 : 500,
      ...(team === 'red' ? { faction: 'raiders', role: 'guard', npcSquad: { id: 'squad-customs-raiders-0', leader } } as const : {}),
      visualLoadout: { profile: 'assault', weaponId: team === 'blue' ? 'akm' : 'm4a1', helmet: true, armor: true, backpack: team === 'blue' } },
    team, mind: createLiveFirefightState(seed, 0), plan: null,
    observed: team === 'blue' ? { x: 16, y: 8 } : { x: 6, y: 8 }, targetId: team === 'blue' ? 'contact-red' : 'contact-blue',
    seenAt: -Infinity, moveReadyAt: leader ? 500 : 750, shots: 0, random: seed,
  });
  const fighters: Fighter[] = [
    actor('contact-blue', 'Сокол', 'blue', { x: 6, y: 8 }, 1967, true),
    actor('contact-blue-two', 'Кедр', 'blue', { x: 6, y: 9 }, 3677, false),
    actor('contact-red', 'Грач', 'red', { x: 15, y: 8 }, 7439, true),
    actor('contact-red-two', 'Шершень', 'red', { x: 16, y: 9 }, 8707, false),
  ];
  // Partly used magazines make the buddy's reload a real coordination problem.
  fighters[0]!.mind.roundsSinceReload = 20; fighters[1]!.mind.roundsSinceReload = 18;
  fighters[2]!.mind.roundsSinceReload = 22; fighters[3]!.mind.roundsSinceReload = 18;
  const teams = { blue: createLiveFireteamState(), red: createLiveFireteamState() };
  let events: LiveEvent[] = [];
  const pendingMoves = new Map<Fighter, LivePoint>();
  const permitted = (point: LivePoint): boolean => point.x >= 4 && point.x <= 20 && point.y >= 3 && point.y <= 13;
  const clear = (point: LivePoint, id: string): boolean => navigation.walkable(point)
    && !fighters.some(other => other.entity.id !== id && other.entity.health > 0 && same(other.entity, point));
  const coverFor = (fighter: Fighter, alternate = false): LiveCoverPlan | null => {
    const previous = fighter.plan;
    const geometry = { clear: (point: LivePoint) => clear(point, fighter.entity.id), hasLineOfSight: navigation.hasLineOfSight,
      solid: navigation.blocksSight, permitted,
      avoid: [...fighters.filter(other => other !== fighter && other.team === fighter.team && other.plan).map(other => other.plan!.covered),
        ...(alternate && previous ? [previous.covered] : [])] };
    return findLiveCombatCover(fighter.entity, fighter.observed, RANGE, geometry) ?? (alternate ? previous : null);
  };
  const clearAllyLane = (fighter: Fighter, target: Fighter): boolean => {
    const from = fighter.entity, to = target.entity, dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
    return !fighters.some(ally => {
      if (ally === fighter || ally.team !== fighter.team || ally.entity.health <= 0) return false;
      const t = ((ally.entity.x - from.x) * dx + (ally.entity.y - from.y) * dy) / Math.max(1, length);
      return t > 0 && t < 1 && distance(ally.entity, { x: from.x + t * dx, y: from.y + t * dy }) < .55;
    });
  };
  const move = (fighter: Fighter, destination: LivePoint, now: number): void => {
    if (same(fighter.entity, destination) || now < fighter.moveReadyAt) return;
    const occupied = new Set(fighters.filter(other => other !== fighter && other.entity.health > 0).map(other => navigation.key(other.entity)));
    const route = navigation.findPath(fighter.entity, destination, occupied);
    const next = route?.[0]; if (!next || !permitted(next) || !clear(next, fighter.entity.id)) return;
    fighter.entity.x = next.x; fighter.entity.y = next.y; fighter.moveReadyAt = now + fighter.entity.moveIntervalMs!;
    fighter.entity.action = 'moving'; fighter.mind.settledSince = 0; fighter.mind.roundsLeft = 0;
    if (fighter.mind.phase === 'firing') fighter.mind.phase = 'seeking';
    fighter.entity.combatStance = fighter.plan && same(fighter.entity, fighter.plan.covered) ? 'covered' : 'seeking-cover';
    delete fighter.entity.aimUntil; delete fighter.entity.aimTargetId;
  };
  for (let now = 0; now <= LIVE_COMBAT_PREVIEW_DURATION_MS; now += LIVE_COMBAT_PREVIEW_STEP_MS) {
    events = events.filter(event => EPOCH + now - event.at < 850); pendingMoves.clear();
    // All actors observe the same frame. Hidden enemies never update a contact.
    const views = new Map<Fighter, Fighter | undefined>();
    for (const fighter of fighters) {
      const visible = fighters.filter(enemy => enemy.team !== fighter.team && enemy.entity.health > 0 && distance(fighter.entity, enemy.entity) <= RANGE
        && navigation.hasLineOfSight(fighter.entity, enemy.entity));
      const bound = teams[fighter.team].bound;
      const holdingContact = bound && (bound.moverId === fighter.entity.id || bound.supporterId === fighter.entity.id)
        && now - fighter.seenAt <= 4500;
      const target = visible.find(enemy => enemy.entity.id === (holdingContact ? bound.targetId : fighter.targetId))
        ?? (holdingContact ? undefined : visible.sort((a, b) => distance(fighter.entity, a.entity) - distance(fighter.entity, b.entity))[0]);
      views.set(fighter, target);
      if (target) {
        if (fighter.targetId !== target.entity.id) {
          fighter.plan = null; fighter.mind.settledSince = 0; fighter.mind.roundsLeft = 0;
          if (fighter.mind.phase !== 'suppressed' && fighter.mind.phase !== 'reloading') fighter.mind.phase = 'seeking';
        }
        fighter.observed = { x: target.entity.x, y: target.entity.y }; fighter.seenAt = now; fighter.targetId = target.entity.id;
      }
      if (fighter.entity.health > 0 && target && !teams[fighter.team].stations.has(fighter.entity.id)
        && (!fighter.plan || navigation.hasLineOfSight(fighter.plan.covered, fighter.observed))) fighter.plan = coverFor(fighter);
    }
    const orders = new Map<string, LiveFireteamOrder>();
    for (const team of ['blue', 'red'] as const) {
      const inputs = fighters.filter(fighter => fighter.team === team).map(fighter => ({ id: fighter.entity.id,
        point: { x: fighter.entity.x, y: fighter.entity.y }, health: fighter.entity.health, suppression: fighter.mind.suppression, range: RANGE,
        ready: fighter.entity.health > 0 && fighter.shots < 60 && fighter.mind.phase !== 'reloading' && fighter.mind.phase !== 'suppressed'
          && fighter.mind.roundsSinceReload < 24, moving: now < fighter.moveReadyAt,
        contact: Number.isFinite(fighter.seenAt) ? { targetId: fighter.targetId, point: fighter.observed, seenAt: fighter.seenAt, visible: !!views.get(fighter) } : undefined,
        lastShot: fighter.lastShot, cover: fighter.plan?.covered }));
      for (const [id, order] of stepLiveFireteam(teams[team], inputs, now, { clear, hasLineOfSight: navigation.hasLineOfSight, permitted })) orders.set(id, order);
    }
    const decisions = new Map<Fighter, LiveFirefightDecision>();
    for (const fighter of fighters) {
      const entity = fighter.entity, target = views.get(fighter), order = orders.get(entity.id);
      if (entity.health <= 0) {
        entity.action = 'downed'; delete entity.combatStance; delete entity.combatBehavior; delete entity.combatRole; delete entity.aimTargetId; delete entity.aimUntil; continue;
      }
      entity.combatRole = order?.role;
      if (order?.holdPosition) fighter.plan = null;
      const coordinatedMove = !!order && order.role !== 'covering';
      if (!target && !coordinatedMove && now - fighter.seenAt > 4500) {
        stepLiveFirefight(fighter.mind, { now, visible: false, canFire: false, hasCover: !!fighter.plan,
          inCover: !!fighter.plan && same(entity, fighter.plan.covered), atPeek: false, injured: true });
        entity.action = 'idle'; delete entity.combatBehavior; delete entity.combatRole; delete entity.aimUntil; delete entity.aimTargetId;
        entity.suppression = fighter.mind.suppression;
        if (fighter.plan && same(entity, fighter.plan.covered)) entity.combatStance = 'covered'; else delete entity.combatStance;
        continue;
      }
      const decision = stepLiveFirefight(fighter.mind, { now, visible: !!target && !coordinatedMove,
        canFire: !!target && !coordinatedMove && now >= fighter.moveReadyAt && fighter.shots < 60 && clearAllyLane(fighter, target),
        hasCover: !!fighter.plan, inCover: !!fighter.plan && same(entity, fighter.plan.covered), atPeek: !!order?.holdPosition || !!fighter.plan && same(entity, fighter.plan.peek),
        moving: now < fighter.moveReadyAt || coordinatedMove, covering: order?.role === 'covering', weaponCategory: 'rifle', attackMs: 900 });
      decisions.set(fighter, coordinatedMove ? { ...decision, action: 'hold', behavior: fighter.mind.phase === 'suppressed' ? 'suppressed' : 'relocating' } : decision);
      if (coordinatedMove && order?.destination) pendingMoves.set(fighter, order.destination);
    }
    for (const fighter of fighters) {
      const entity = fighter.entity, target = views.get(fighter), decision = decisions.get(fighter), order = orders.get(entity.id);
      if (!decision) continue;
      const coordinatedMove = !!order && order.role !== 'covering';
      entity.combatBehavior = decision.behavior; entity.suppression = decision.suppression;
      entity.action = now < fighter.moveReadyAt ? 'moving' : 'idle';
      if (!coordinatedMove) {
        if (decision.action === 'relocate') { fighter.plan = coverFor(fighter, true); fighter.mind.phase = 'seeking'; if (fighter.plan) pendingMoves.set(fighter, fighter.plan.covered); }
        else if (decision.action === 'cover' && fighter.plan) pendingMoves.set(fighter, fighter.plan.covered);
        else if (decision.action === 'peek' && fighter.plan) pendingMoves.set(fighter, fighter.plan.peek);
      }
      entity.combatStance = order?.holdPosition && entity.action !== 'moving' ? 'peeking' : fighter.plan && same(entity, fighter.plan.covered) ? 'covered'
        : fighter.plan && same(entity, fighter.plan.peek) && entity.action !== 'moving' ? 'peeking' : 'seeking-cover';
      if (!coordinatedMove && (decision.behavior === 'acquiring' || decision.behavior === 'firing') && entity.action !== 'moving') {
        entity.action = 'combat'; entity.aimUntil = EPOCH + now + 250;
        if (target) entity.aimTargetId = target.entity.id; else delete entity.aimTargetId;
      } else { delete entity.aimTargetId; delete entity.aimUntil; }
      if (decision.action !== 'fire' || entity.health <= 0 || !target || target.entity.health <= 0 || now < fighter.moveReadyAt
        || !navigation.hasLineOfSight(entity, target.entity) || distance(entity, target.entity) > RANGE) continue;
      const chance = liveFirefightHitChance({ distance: distance(entity, target.entity), range: RANGE, suppression: fighter.mind.suppression,
        targetMoving: now < target.moveReadyAt, settledMs: now - fighter.mind.settledSince });
      const hit = random(fighter) < chance, armor = hit && random(fighter) < .25, damage = hit ? armor ? 3 : 11 + Math.floor(random(fighter) * 8) : 0;
      const from = { x: entity.x, y: entity.y }, to = { x: target.entity.x, y: target.entity.y };
      const angle = random(fighter) * Math.PI * 2, miss = traceLiveBulletImpact(world, from, { x: to.x + Math.cos(angle) * 1.7, y: to.y + Math.sin(angle) * 1.7 });
      events.push({ id: 'contact-shot-' + entity.id + '-' + fighter.shots++, at: EPOCH + now, kind: 'combat', text: hit ? armor ? 'Задета броня' : 'Попадание' : 'Промах',
        actorId: entity.id, targetId: target.entity.id, from, to, damage, impact: hit ? armor ? 'armor' : 'body' : miss.impact,
        impactPoint: hit ? to : miss.impactPoint });
      fighter.lastShot = { at: now, targetId: target.entity.id };
      target.entity.health = Math.max(0, target.entity.health - damage);
      if (target.entity.health <= 0) {
        target.entity.action = 'downed'; delete target.entity.combatStance; delete target.entity.combatBehavior; delete target.entity.combatRole;
        delete target.entity.aimUntil; delete target.entity.aimTargetId;
      } else if (hit || distance(miss.impactPoint, target.entity) <= 2.2) applyLiveIncomingFire(target.mind, now, hit ? .46 : .3);
    }
    // Shots resolve against that common observation before any movement.
    for (const [fighter, destination] of pendingMoves) if (fighter.entity.health > 0) move(fighter, destination, now);
    frames.push({ entities: fighters.map(({ entity }) => structuredClone(entity)), events: structuredClone(events), ammo: 60 - fighters[0]!.shots });
  }
  return frames;
}

/** Seeking is deterministic and bounded; restarting explicitly clears effects. */
export function createLiveCombatPreviewSnapshot(world: LiveWorld, elapsedMs = 0): LiveSnapshot {
  const elapsed = Math.min(LIVE_COMBAT_PREVIEW_DURATION_MS, Math.max(0, Math.floor(Number.isFinite(elapsedMs) ? elapsedMs : 0)));
  let timeline = timelines.get(world); if (!timeline) { timeline = simulate(world); timelines.set(world, timeline); }
  const frame = timeline[Math.floor(elapsed / LIVE_COMBAT_PREVIEW_STEP_MS)]!;
  const snapshot = createCityPreviewSnapshot(world, EPOCH + elapsed);
  snapshot.selfId = 'contact-blue'; snapshot.self.id = snapshot.selfId;
  snapshot.self.ammo = frame.ammo; snapshot.self.targetId = 'contact-red';
  snapshot.entities = structuredClone(frame.entities); snapshot.events = structuredClone(frame.events);
  return snapshot;
}

export function liveCombatPreviewCaption(snapshot: LiveSnapshot, elapsedMs: number): string {
  if (['player', 'scav'].some(team => snapshot.entities.filter(entity => entity.kind === team).every(entity => entity.health <= 0))) return 'Контакт завершён';
  if (elapsedMs >= LIVE_COMBAT_PREVIEW_DURATION_MS) return 'Наблюдение завершено';
  if (elapsedMs > 4500 && !snapshot.events.length && snapshot.entities.every(entity => entity.action === 'idle' && !entity.combatBehavior)) return 'Группы укрылись · контакт потерян';
  const withdrawing = snapshot.entities.find(entity => entity.combatRole === 'withdrawing');
  if (withdrawing) return snapshot.events.some(event => snapshot.entities.some(ally => ally.id === event.actorId && ally.kind === withdrawing.kind && ally.id !== withdrawing.id))
    ? 'Под сильным огнём · отход под прикрытием' : 'Под сильным огнём · отход к укрытию';
  if (snapshot.entities.some(entity => entity.combatRole === 'flanking' && entity.action === 'moving')) return 'Напарник прикрывает · обход с фланга';
  if (snapshot.entities.some(entity => entity.combatRole === 'regrouping')) return 'Смена позиций · группа собирается';
  if (snapshot.entities.some(entity => entity.combatBehavior === 'reloading')) return 'Пауза для перезарядки';
  if (snapshot.entities.some(entity => entity.combatBehavior === 'suppressed')) return 'Бойцы пригибаются под огнём';
  if (elapsedMs < 2000) return 'Две группы · поиск укрытия';
  if (snapshot.events.length) return 'Короткие очереди';
  return 'Наблюдение за переулком';
}

export function liveCombatPreviewComplete(snapshot: LiveSnapshot, elapsedMs: number): boolean {
  return elapsedMs >= LIVE_COMBAT_PREVIEW_DURATION_MS || !snapshot.events.length
    && (['player', 'scav'].some(team => snapshot.entities.filter(entity => entity.kind === team).every(entity => entity.health <= 0))
      || elapsedMs > 4500 && snapshot.entities.every(entity => entity.action === 'idle' && !entity.combatBehavior));
}
