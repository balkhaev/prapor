import type { LiveCityBuilding, LiveEntity, LiveEvent, LivePoint, LiveSnapshot, LiveWorld } from './game/live';
import { createCityPreviewSnapshot } from './metropolis-preview';
import { applyLiveIncomingFire, createLiveFirefightState, liveFirefightHitChance, stepLiveFirefight, type LiveFirefightDecision, type LiveFirefightState } from './game/live-firefight';
import { traceLiveBulletImpact } from './game/live-ballistics';
import { createLiveNavigation } from './game/live-navigation';
import { findLiveCombatCover, type LiveCoverPlan } from './game/live-combat-cover';

export const LIVE_COMBAT_PREVIEW_STEP_MS = 125;
export const LIVE_COMBAT_PREVIEW_DURATION_MS = 45000;
export const LIVE_COMBAT_PREVIEW_FOCUS = { x: 11, y: 8 };
const EPOCH = 1_800_000_000_000;
const RANGE = 12;
const same = (a: LivePoint, b: LivePoint): boolean => a.x === b.x && a.y === b.y;
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A finite local encounter: no account, live client, save or command. The tall
 * building stands beside the lane, leaving the two firing positions readable. */
export function createLiveCombatPreviewWorld(): LiveWorld {
  const building: LiveCityBuilding = { id: 'contact-apartment', name: 'Дом у переулка', x: 2, y: 14, width: 4, height: 4,
    kind: 'apartment', floors: 3, facade: 'brick', roof: 'flat', entrances: [{ x: 4, y: 17 }] };
  return {
    id: 'perimeter', name: 'Контакт · перестрелка во дворе', description: 'Локальная перестрелка с наблюдением, укрытиями и потерей контакта',
    theme: 'urban', width: 24, height: 24, version: 'contact-gallery-2', seed: 'contact-gallery', generatorVersion: 1, chunkSize: 16,
    districts: [{ id: 'customs', name: 'Переулок', description: '', x: 0, y: 0, width: 24, height: 24, theme: 'urban', spawns: [] }],
    extracts: [], pois: [], containers: [], zones: [],
    terrainRows: Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => y < 4 ? 'g' : x < 5 || x > 18 ? 'y' : 'c').join('')),
    paths: [{ id: 'contact-lane', name: 'Переулок', kind: 'road', width: 3, points: [{ x: 3, y: 4 }, { x: 20, y: 4 }] }],
    citySites: [{ id: 'contact-yard', poiId: 'contact-address', quarterId: 'contact-quarter', name: 'Двор', kind: 'courtyard', x: 2, y: 5, width: 18, height: 14,
      courtyard: { x: 6, y: 6, width: 11, height: 7 }, buildings: [building], passages: [] }],
    props: [
      { id: 'contact-crate', kind: 'crate', x: 9, y: 9, width: 1, height: 2, orientation: 'y', variant: 1, blocking: true },
      { id: 'contact-car', kind: 'car', x: 13, y: 6, width: 1, height: 2, orientation: 'y', variant: 2, blocking: true },
      { id: 'contact-dumpster', kind: 'dumpster', x: 8, y: 5, width: 1, height: 2, orientation: 'y', variant: 1, blocking: true },
      { id: 'contact-van', kind: 'van', x: 15, y: 10, width: 1, height: 3, orientation: 'y', variant: 0, blocking: true },
      { id: 'contact-lamp', kind: 'lamp', x: 18, y: 4, width: 1, height: 1, orientation: 'x', variant: 0, blocking: false },
      { id: 'contact-tree', kind: 'tree', x: 3, y: 2, width: 2, height: 2, orientation: 'x', variant: 2, blocking: true },
    ],
    obstacles: [
      { x: 9, y: 9, width: 1, height: 2, kind: 'barricade', propId: 'contact-crate' },
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
  entity: LiveEntity; mind: LiveFirefightState; plan: LiveCoverPlan | null; observed: LivePoint;
  seenAt: number; moveReadyAt: number; shots: number; random: number; withdrawing: boolean;
}
interface PreviewFrame { entities: LiveEntity[]; events: LiveEvent[]; ammo: number }
// One fixed-size timeline per live world. A finished/replaced gallery releases
// its entry; seeking huge timestamps cannot allocate an ever-growing history.
const timelines = new WeakMap<LiveWorld, readonly PreviewFrame[]>();
const random = (fighter: Fighter): number => { fighter.random = (Math.imul(fighter.random, 1664525) + 1013904223) >>> 0; return fighter.random / 4294967296; };

function simulate(world: LiveWorld): readonly PreviewFrame[] {
  const navigation = createLiveNavigation(world), frames: PreviewFrame[] = [];
  const fighters: Fighter[] = [
    { entity: { id: 'contact-blue', kind: 'player', name: 'Боец', appearance: 3, health: 100, safeUntil: 0, x: 6, y: 8, action: 'idle', moveIntervalMs: 375,
      visualLoadout: { profile: 'assault', weaponId: 'akm', helmet: true, armor: true, backpack: true } },
      mind: createLiveFirefightState(1967, 0), plan: null, observed: { x: 15, y: 8 }, seenAt: 0, moveReadyAt: 500, shots: 0, random: 1967, withdrawing: false },
    { entity: { id: 'contact-red', kind: 'scav', name: 'Налётчик', appearance: 12, health: 100, safeUntil: 0, x: 15, y: 8, action: 'idle', moveIntervalMs: 500,
      faction: 'raiders', role: 'guard', visualLoadout: { profile: 'assault', weaponId: 'm4a1', helmet: true, armor: true, backpack: false } },
      mind: createLiveFirefightState(7439, 0), plan: null, observed: { x: 6, y: 8 }, seenAt: 0, moveReadyAt: 875, shots: 0, random: 8707, withdrawing: false },
  ];
  // The patrols enter with partly used magazines; their reload clocks then
  // advance only through real shots, using the same decision model as the raid.
  fighters[0]!.mind.roundsSinceReload = 20; fighters[1]!.mind.roundsSinceReload = 22;
  let events: LiveEvent[] = [];
  const pendingMoves = new Map<Fighter, LivePoint>();
  const coverFor = (fighter: Fighter, alternate = false): LiveCoverPlan | null => {
    const entity = fighter.entity, previous = fighter.plan;
    const geometry = { clear: navigation.walkable, hasLineOfSight: navigation.hasLineOfSight,
      permitted: (point: LivePoint) => point.x >= 5 && point.x <= 18 && point.y >= 4 && point.y <= 13 };
    if (!alternate) return findLiveCombatCover(entity, fighter.observed, RANGE, geometry);
    const candidates: LiveCoverPlan[] = [];
    // Rethinking a compromised position searches actual nearby geometry and
    // walks the route. It never swaps a sprite straight to its new firing tile.
    for (const offset of [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -2 }, { x: 0, y: 2 }, { x: 0, y: -4 }, { x: 0, y: 4 }]) {
      const start = { x: entity.x + offset.x, y: entity.y + offset.y };
      if (!navigation.walkable(start) || !geometry.permitted(start)) continue;
      const candidate = findLiveCombatCover(start, fighter.observed, RANGE, geometry);
      if (!candidate || previous && distance(candidate.covered, previous.covered) < 2) continue;
      const route = navigation.findPath(entity, candidate.covered);
      if (route && route.length <= 8 && route.every(geometry.permitted)) candidates.push({ ...candidate, route });
    }
    candidates.sort((a, b) => a.route.length - b.route.length);
    return candidates[0] ?? previous;
  };
  const move = (fighter: Fighter, destination: LivePoint, now: number): void => {
    if (same(fighter.entity, destination) || now < fighter.moveReadyAt) return;
    const other = fighters.find(actor => actor !== fighter)!;
    const route = navigation.findPath(fighter.entity, destination, new Set([navigation.key(other.entity)]));
    const next = route?.[0]; if (!next) return;
    fighter.entity.x = next.x; fighter.entity.y = next.y;
    fighter.moveReadyAt = now + fighter.entity.moveIntervalMs!;
    fighter.entity.action = 'moving';
    fighter.entity.combatStance = fighter.plan && same(fighter.entity, fighter.plan.covered) ? 'covered' : 'seeking-cover';
  };
  for (let now = 0; now <= LIVE_COMBAT_PREVIEW_DURATION_MS; now += LIVE_COMBAT_PREVIEW_STEP_MS) {
    events = events.filter(event => EPOCH + now - event.at < 850);
    pendingMoves.clear();
    // Observation is taken together. A step by one fighter cannot grant the
    // second an earlier reaction just because it appears later in this array.
    const views = fighters.map((fighter, index) => {
      const target = fighters[1 - index]!.entity;
      return target.health > 0 && distance(fighter.entity, target) <= RANGE && navigation.hasLineOfSight(fighter.entity, target);
    });
    const decisions = fighters.map((fighter, index) => {
      const entity = fighter.entity, target = fighters[1 - index]!.entity, visible = views[index]!;
      if (entity.health <= 0) { entity.action = 'downed'; delete entity.combatStance; delete entity.combatBehavior; delete entity.aimTargetId; delete entity.aimUntil; return null; }
      if (visible) { fighter.observed = { x: target.x, y: target.y }; fighter.seenAt = now; }
      if (target.health <= 0) {
        entity.action = 'idle'; delete entity.combatBehavior; delete entity.aimUntil; delete entity.aimTargetId;
        if (fighter.plan && same(entity, fighter.plan.covered)) entity.combatStance = 'covered'; else delete entity.combatStance;
        return null;
      }
      if (index === 1 && (entity.health <= 24 || now >= 38000 || !visible && now - fighter.seenAt > 6000)) fighter.withdrawing = true;
      if (fighter.withdrawing) return { action: 'relocate', behavior: 'relocating', suppression: fighter.mind.suppression } satisfies LiveFirefightDecision;
      if (!visible && now - fighter.seenAt > 6000) {
        delete entity.aimTargetId; delete entity.aimUntil; entity.action = 'idle';
        return { action: 'hold', behavior: 'recovering', suppression: fighter.mind.suppression } satisfies LiveFirefightDecision;
      }
      if (visible && (!fighter.plan || navigation.hasLineOfSight(fighter.plan.covered, fighter.observed))) fighter.plan = coverFor(fighter);
      return stepLiveFirefight(fighter.mind, { now, visible, canFire: visible && now >= fighter.moveReadyAt,
        hasCover: !!fighter.plan, inCover: !!fighter.plan && same(entity, fighter.plan.covered), atPeek: !!fighter.plan && same(entity, fighter.plan.peek),
        moving: now < fighter.moveReadyAt, weaponCategory: 'rifle', attackMs: 900 });
    });
    for (let index = 0; index < fighters.length; index++) {
      const fighter = fighters[index]!, entity = fighter.entity, target = fighters[1 - index]!, decision = decisions[index];
      if (!decision) continue;
      entity.combatBehavior = decision.behavior; entity.suppression = decision.suppression;
      entity.action = now < fighter.moveReadyAt ? 'moving' : 'idle';
      if (fighter.withdrawing) pendingMoves.set(fighter, { x: 18, y: 13 });
      else if (decision.action === 'relocate') { fighter.plan = coverFor(fighter, true); fighter.mind.phase = 'seeking'; if (fighter.plan) pendingMoves.set(fighter, fighter.plan.covered); }
      else if (decision.action === 'cover' && fighter.plan) pendingMoves.set(fighter, fighter.plan.covered);
      else if (decision.action === 'peek' && fighter.plan) pendingMoves.set(fighter, fighter.plan.peek);
      entity.combatStance = fighter.plan && same(entity, fighter.plan.covered) ? 'covered'
        : fighter.plan && same(entity, fighter.plan.peek) && entity.action !== 'moving' ? 'peeking' : 'seeking-cover';
      const aiming = !fighter.withdrawing && (decision.behavior === 'acquiring' || decision.behavior === 'firing') && entity.action !== 'moving';
      if (aiming) { entity.action = 'combat'; if (views[index]) entity.aimTargetId = target.entity.id; else delete entity.aimTargetId; entity.aimUntil = EPOCH + now + 250; }
      else { delete entity.aimTargetId; delete entity.aimUntil; }
      if (decision.action !== 'fire' || entity.health <= 0 || target.entity.health <= 0 || now < fighter.moveReadyAt
        || !navigation.hasLineOfSight(entity, target.entity) || distance(entity, target.entity) > RANGE) continue;
      const chance = liveFirefightHitChance({ distance: distance(entity, target.entity), range: RANGE, suppression: fighter.mind.suppression,
        targetMoving: now < target.moveReadyAt, settledMs: now - fighter.mind.settledSince });
      const hit = random(fighter) < chance, armor = hit && random(fighter) < .25, damage = hit ? armor ? 3 : 13 + Math.floor(random(fighter) * 9) : 0;
      const from = { x: entity.x, y: entity.y }, to = { x: target.entity.x, y: target.entity.y };
      const angle = random(fighter) * Math.PI * 2, miss = traceLiveBulletImpact(world, from, { x: to.x + Math.cos(angle) * 1.7, y: to.y + Math.sin(angle) * 1.7 });
      events.push({ id: `contact-shot-${index}-${fighter.shots++}`, at: EPOCH + now, kind: 'combat', text: hit ? armor ? 'Задета броня' : 'Попадание' : 'Промах',
        actorId: entity.id, targetId: target.entity.id, from, to, damage, impact: hit ? armor ? 'armor' : 'body' : miss.impact,
        impactPoint: hit ? to : miss.impactPoint });
      target.entity.health = Math.max(0, target.entity.health - damage);
      if (target.entity.health <= 0) { target.entity.action = 'downed'; delete target.entity.combatStance; delete target.entity.combatBehavior; }
      else if (hit || distance(miss.impactPoint, target.entity) <= 2.2) applyLiveIncomingFire(target.mind, now, hit ? .46 : .3);
    }
    // Resolve all confirmed shots against the observation taken above before
    // moving either fighter, so iteration order cannot consume a phantom round.
    for (const [fighter, destination] of pendingMoves) if (fighter.entity.health > 0) move(fighter, destination, now);
    frames.push({ entities: fighters.map(({ entity }) => structuredClone(entity)), events: structuredClone(events), ammo: 60 - fighters[0]!.shots });
  }
  return frames;
}

/** Seeking is deterministic and bounded. Playback ends, it does not resurrect
 * an invulnerable pair every eight seconds. Restart explicitly clears effects. */
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
  if (snapshot.entities.some(entity => entity.health <= 0)) return 'Контакт завершён';
  if (snapshot.entities.some(entity => entity.kind === 'scav' && entity.x >= 18 && entity.y >= 13 && entity.action !== 'moving')) return 'Противник отошёл · контакт потерян';
  if (elapsedMs >= LIVE_COMBAT_PREVIEW_DURATION_MS) return snapshot.entities.some(entity => entity.kind === 'scav' && entity.x >= 18 && entity.y >= 13)
    ? 'Противник отошёл · контакт потерян' : 'Наблюдение завершено';
  if (snapshot.entities.some(entity => entity.combatBehavior === 'reloading')) return 'Пауза для перезарядки';
  if (snapshot.entities.some(entity => entity.combatBehavior === 'suppressed')) return 'Огонь заставляет сменить положение';
  if (snapshot.entities.some(entity => entity.combatBehavior === 'relocating')) return elapsedMs >= 38000 ? 'Противник отходит за укрытие' : 'Смена позиции';
  if (elapsedMs < 2000) return 'Сближение · поиск укрытия';
  if (snapshot.events.length) return 'Короткие очереди';
  return 'Наблюдение за переулком';
}

export function liveCombatPreviewComplete(snapshot: LiveSnapshot, elapsedMs: number): boolean {
  return elapsedMs >= LIVE_COMBAT_PREVIEW_DURATION_MS || !snapshot.events.length && snapshot.entities.some(entity => entity.health <= 0
    || entity.kind === 'scav' && entity.x >= 18 && entity.y >= 13 && entity.action !== 'moving');
}
