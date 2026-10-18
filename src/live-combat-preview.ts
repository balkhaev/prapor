import type { LiveCityBuilding, LiveEntity, LiveEvent, LiveSnapshot, LiveWorld } from './game/live';
import { createCityPreviewSnapshot } from './metropolis-preview';

export const LIVE_COMBAT_PREVIEW_STEP_MS = 125;
export const LIVE_COMBAT_PREVIEW_DURATION_MS = 8000;
export const LIVE_COMBAT_PREVIEW_FOCUS = { x: 11, y: 9 };
const EPOCH = 1_800_000_000_000;

/** Local geometry and actors only: no account, live client, save or command. */
export function createLiveCombatPreviewWorld(): LiveWorld {
  const building: LiveCityBuilding = { id: 'contact-apartment', name: 'Дом у переулка', x: 9, y: 11, width: 6, height: 4,
    kind: 'apartment', floors: 4, facade: 'brick', roof: 'flat', entrances: [{ x: 11, y: 14 }] };
  return {
    id: 'perimeter', name: 'Контакт · стрельба и укрытия', description: 'Повторяемая демонстрационная перестрелка во дворе',
    theme: 'urban', width: 24, height: 24, version: 'contact-gallery-1', seed: 'contact-gallery', generatorVersion: 1, chunkSize: 16,
    districts: [{ id: 'customs', name: 'Переулок', description: '', x: 0, y: 0, width: 24, height: 24, theme: 'urban', spawns: [] }],
    extracts: [], pois: [], containers: [], zones: [],
    terrainRows: Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => y < 6 ? 'g' : x < 5 || x > 18 ? 'y' : 'c').join('')),
    paths: [{ id: 'contact-lane', name: 'Переулок', kind: 'road', width: 3, points: [{ x: 4, y: 6 }, { x: 20, y: 6 }] }],
    citySites: [{ id: 'contact-yard', poiId: 'contact-address', quarterId: 'contact-quarter', name: 'Двор', kind: 'courtyard', x: 5, y: 6, width: 14, height: 12,
      courtyard: { x: 6, y: 7, width: 11, height: 4 }, buildings: [building], passages: [] }],
    props: [
      { id: 'contact-crate', kind: 'crate', x: 9, y: 9, width: 1, height: 2, orientation: 'y', variant: 1, blocking: true },
      { id: 'contact-car', kind: 'car', x: 13, y: 6, width: 1, height: 2, orientation: 'y', variant: 2, blocking: true },
      { id: 'contact-lamp', kind: 'lamp', x: 17, y: 10, width: 1, height: 1, orientation: 'x', variant: 0, blocking: false },
      { id: 'contact-tree', kind: 'tree', x: 5, y: 4, width: 2, height: 2, orientation: 'x', variant: 2, blocking: true },
    ],
    obstacles: [
      { x: 9, y: 9, width: 1, height: 2, kind: 'barricade', propId: 'contact-crate' },
      { x: 13, y: 6, width: 1, height: 2, kind: 'barricade', propId: 'contact-car' },
      { x: 5, y: 4, width: 2, height: 2, kind: 'tree', propId: 'contact-tree' },
      { x: 9, y: 11, width: 6, height: 1, kind: 'building' }, { x: 9, y: 12, width: 1, height: 2, kind: 'building' },
      { x: 14, y: 12, width: 1, height: 2, kind: 'building' }, { x: 9, y: 14, width: 2, height: 1, kind: 'building' },
      { x: 12, y: 14, width: 3, height: 1, kind: 'building' },
    ],
  };
}

function previewActors(elapsed: number): LiveEntity[] {
  const phase = elapsed % LIVE_COMBAT_PREVIEW_DURATION_MS, seeking = phase < 1500 || phase >= 7000;
  const bluePeek = phase >= 2000 && phase < 2750 || phase >= 4000 && phase < 4750 || phase >= 6000 && phase < 6750;
  const redPeek = phase >= 3000 && phase < 3750 || phase >= 5000 && phase < 5750;
  const exposed = bluePeek || redPeek;
  const step = Math.min(2, Math.floor(phase / 500)), returning = phase >= 7000 ? Math.min(2, Math.floor((phase - 7000) / 500) + 1) : 0;
  const blue: LiveEntity = { id: 'contact-blue', kind: 'player', name: 'Прикрытие', appearance: 3, health: 100, safeUntil: 0,
    x: 6 + (returning ? 2 - returning : step), y: exposed ? 8 : 9, action: seeking ? 'moving' : 'combat', moveIntervalMs: 500,
    combatStance: seeking ? 'seeking-cover' : exposed ? 'peeking' : 'covered', aimTargetId: 'contact-red', aimUntil: EPOCH + elapsed + 500,
    visualLoadout: { profile: 'assault', weaponId: 'akm', helmet: true, armor: true, backpack: true } };
  const red: LiveEntity = { id: 'contact-red', kind: 'scav', name: 'Налётчик', appearance: 12, health: 100, safeUntil: 0,
    x: 16 - (returning ? 2 - returning : step), y: exposed ? 8 : 7, action: seeking ? 'moving' : 'combat', moveIntervalMs: 500,
    faction: 'raiders', role: 'guard', combatStance: seeking ? 'seeking-cover' : exposed ? 'peeking' : 'covered', aimTargetId: 'contact-blue', aimUntil: EPOCH + elapsed + 500,
    visualLoadout: { profile: 'assault', weaponId: 'm4a1', helmet: true, armor: true, backpack: false } };
  return [blue, red];
}

const SHOTS = [2125, 2375, 2625, 3125, 3375, 3625, 4125, 4375, 4625, 5125, 5375, 5625, 6125, 6375, 6625];

/** Seeking the same timestamp produces the same snapshots and confirmed event
 * IDs. Loop IDs remain distinct so the real renderer never replays an old shot. */
export function createLiveCombatPreviewSnapshot(world: LiveWorld, elapsedMs = 0): LiveSnapshot {
  const elapsed = Math.max(0, Math.floor(Number.isFinite(elapsedMs) ? elapsedMs : 0)), now = EPOCH + elapsed;
  const snapshot = createCityPreviewSnapshot(world, now), events: LiveEvent[] = [];
  const cycle = Math.floor(elapsed / LIVE_COMBAT_PREVIEW_DURATION_MS);
  for (const lap of [cycle - 1, cycle]) if (lap >= 0) for (const [index, phase] of SHOTS.entries()) {
    const at = lap * LIVE_COMBAT_PREVIEW_DURATION_MS + phase;
    if (at > elapsed || elapsed - at >= 850) continue;
    const actors = previewActors(at), shooter = Math.floor(phase / 1000) % 2 ? 1 : 0;
    const source = actors[shooter]!, target = actors[1 - shooter]!, armor = index % 3 !== 1;
    events.push({ id: `contact-shot-${lap}-${phase}`, at: EPOCH + at, kind: 'combat', text: armor ? 'Попадание в броню' : 'Попадание',
      actorId: source.id, targetId: target.id, from: { x: source.x, y: source.y }, to: { x: target.x, y: target.y }, damage: armor ? 0 : 8, impact: armor ? 'armor' : 'body' });
  }
  snapshot.selfId = 'contact-blue'; snapshot.self.id = snapshot.selfId;
  snapshot.self.ammo = 60; snapshot.self.targetId = 'contact-red';
  snapshot.entities = previewActors(elapsed); snapshot.events = events;
  return snapshot;
}
