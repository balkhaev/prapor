import { LIVE_TERRAIN_CODES, type LiveContainerAnchor, type LiveContainerKind, type LiveDistrict, type LiveDistrictId, type LiveObstacle, type LivePoi, type LivePoint, type LiveWorld, type LiveZone } from './live';
import type { LiveMapDefinition, LiveNpcSpawn } from './live-maps';
import { generateLandscape } from './world-landscape';
import { prefabObstacles } from './world-prefabs';

export const LIVE_GENERATOR_VERSION = 2;
export const LIVE_WORLD_SEED = 'perimeter-alpha-01';
export const LIVE_CHUNK_SIZE = 32;
export const LIVE_WORLD_SIZE = 128;
export interface WorldTemplate {
  id: string; name: string; theme: LiveDistrict['theme']; size: number;
  obstacles: LiveObstacle[];
  containers: Array<Omit<LiveContainerAnchor, 'id' | 'poiId'>>;
  npcPoints: LivePoint[]; patrol: LivePoint[]; entrances: LivePoint[]; tags: string[];
}
export interface LiveWorldChunk {
  x: number; y: number; width: number; height: number;
  obstacleIndices: number[]; poiIds: string[]; containerIds: string[];
}
const p = (x: number, y: number): LivePoint => ({ x, y });
const cover = (x: number, y: number, width: number, height: number, kind: LiveObstacle['kind'], label?: string): LiveObstacle => ({ x, y, width, height, kind, ...(label ? { label } : {}) });
const container = (x: number, y: number, kind: LiveContainerKind, lootTable: LiveContainerAnchor['lootTable'], searchMs: number): Omit<LiveContainerAnchor, 'id' | 'poiId'> => ({ x, y, kind, lootTable, searchMs });
const room = (id: string, name: string, theme: LiveDistrict['theme'], kind: 'warehouse' | 'clinic' | 'office' | 'workshop'): WorldTemplate => ({
  id, name, theme, size: 22,
  obstacles: prefabObstacles(id),
  containers: [container(4, 6, 'jacket', 'valuables', 2500), container(8, 15, 'duffel', 'mixed', 3000),
    container(16, 15, kind === 'clinic' ? 'medbag' : 'toolbox', kind === 'clinic' ? 'medical' : 'tools', 3500),
    container(16, 8, kind === 'office' ? 'cabinet' : 'crate', kind === 'office' ? 'intel' : 'provisions', 4500)],
  npcPoints: [p(7, 12), p(15, 13), p(16, 12)], patrol: [p(7, 12), p(15, 13), p(16, 5), p(11, 1), p(1, 11)],
  entrances: [p(11, 2), p(11, 19), p(2, 11), p(19, 11)], tags: ['search', 'visit', kind === 'clinic' ? 'medicine' : kind === 'office' ? 'documents' : 'supplies'],
});
const yard = (id: string, name: string, theme: LiveDistrict['theme'], forest = false): WorldTemplate => ({
  id, name, theme, size: 22,
  obstacles: prefabObstacles(id),
  containers: [container(7, 8, 'duffel', 'mixed', 3000), container(18, 16, 'toolbox', 'tools', 3500), container(16, 8, 'crate', 'provisions', 4000), container(11, 18, 'medbag', 'medical', 3000)],
  npcPoints: [p(6, 12), p(16, 12), p(18, 12)], patrol: [p(6, 12), p(16, 12), p(18, 6), p(11, 1), p(1, 11)],
  entrances: [p(11, 0), p(11, 21), p(0, 11), p(21, 11)], tags: ['search', 'visit', forest ? 'camp' : 'supplies'],
});

/** Content modules have real doorways, named search anchors and navigation ports. */
export const WORLD_TEMPLATES: readonly WorldTemplate[] = [
  room('warehouse', 'Складской терминал', 'industrial', 'warehouse'), room('office', 'Таможенный архив', 'industrial', 'office'),
  yard('containers', 'Контейнерный двор', 'industrial'), room('workshop', 'Ремонтный ангар', 'industrial', 'workshop'),
  room('sawmill', 'Лесопильный цех', 'forest', 'workshop'), yard('camp', 'Лесной лагерь', 'forest', true),
  room('cabin', 'Дом лесника', 'forest', 'office'), yard('logging', 'Дровяной склад', 'forest', true),
  yard('wagons', 'Сортировочная', 'urban'), room('depot', 'Ремонтное депо', 'urban', 'workshop'),
  room('clinic', 'Медпункт', 'urban', 'clinic'), room('archive', 'Районная администрация', 'urban', 'office'),
  room('apartments', 'Жилой квартал', 'urban', 'warehouse'), yard('market', 'Торговый двор', 'urban'),
];

export const LIVE_DISTRICTS: readonly LiveDistrict[] = [
  { id: 'customs', name: 'Таможня', description: 'Склады, архивы и промышленные дворы на северо-западе.', x: 0, y: 0, width: 64, height: 64, theme: 'industrial', spawns: [p(6, 6)] },
  { id: 'sawmill', name: 'Лесопилка', description: 'Лесные лагеря и просеки на северо-востоке.', x: 64, y: 0, width: 64, height: 64, theme: 'forest', spawns: [p(121, 6)] },
  { id: 'depot', name: 'Депо', description: 'Железнодорожный узел и мастерские на юго-западе.', x: 0, y: 64, width: 64, height: 64, theme: 'urban', spawns: [p(6, 121)] },
  { id: 'village', name: 'Посёлок', description: 'Дома, медпункт и администрация на юго-востоке.', x: 64, y: 64, width: 64, height: 64, theme: 'urban', spawns: [p(121, 121)] },
];
export const isLiveDistrictId = (value: unknown): value is LiveDistrictId => LIVE_DISTRICTS.some(district => district.id === value);

function hash32(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
  return value >>> 0;
}
function geometryRandom(seed: string): () => number {
  let value = hash32(seed) || 1;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
function rotated(point: LivePoint, rotation: number, size: number): LivePoint {
  if (rotation === 1) return p(size - 1 - point.y, point.x);
  if (rotation === 2) return p(size - 1 - point.x, size - 1 - point.y);
  if (rotation === 3) return p(point.y, size - 1 - point.x);
  return { ...point };
}
const FOOTPRINTS: Record<string, [number, number]> = {
  warehouse: [29, 21], office: [18, 15], containers: [29, 18], workshop: [25, 17],
  sawmill: [28, 20], camp: [18, 16], cabin: [14, 13], logging: [27, 17],
  wagons: [31, 16], depot: [30, 19], clinic: [18, 14], archive: [22, 17], apartments: [26, 19], market: [24, 18],
};
const PLACE_CENTERS: Record<LiveDistrictId, LivePoint[]> = {
  customs: [p(29, 19), p(12, 41), p(35, 54), p(53, 40)],
  sawmill: [p(83, 17), p(111, 20), p(98, 46), p(77, 52)],
  depot: [p(18, 79), p(49, 78), p(18, 106), p(49, 109)],
  village: [p(81, 81), p(111, 79), p(85, 110), p(112, 108)],
};
const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, margin = 0): boolean =>
  a.x < b.x + b.width + margin && a.y < b.y + b.height + margin && a.x + a.width + margin > b.x && a.y + a.height + margin > b.y;

/** Geometry only. Private server RNG and durable container cycles determine actual loot. */
export function generateLiveWorld(seed = LIVE_WORLD_SEED): LiveMapDefinition {
  if (typeof seed !== 'string' || !seed.length || seed.length > 80) throw new Error('World seed must be 1–80 characters');
  // Legacy content choices keep anchor identities stable; V2 has its own geometry stream.
  const legacyRandom = geometryRandom(`1:${seed}`), random = geometryRandom(`${LIVE_GENERATOR_VERSION}:${seed}`), obstacles: LiveObstacle[] = [], zones: LiveZone[] = [], pois: LivePoi[] = [], containers: LiveContainerAnchor[] = [], npcSpawns: LiveNpcSpawn[] = [];
  const districts = structuredClone([...LIVE_DISTRICTS]);
  const extracts = districts.flatMap(district => district.spawns.map(point => ({ ...point })));
  const choices: Array<{ cx: number; cy: number; district: LiveDistrict; template: WorldTemplate; rotation: number; width: number; height: number; center: LivePoint; origin?: LivePoint }> = [];
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    const district = districts.find(district => cx * 32 >= district.x && cx * 32 < district.x + district.width && cy * 32 >= district.y && cy * 32 < district.y + district.height)!;
    const allowed = WORLD_TEMPLATES.filter(template => district.id === 'customs' ? template.theme === 'industrial' : district.id === 'sawmill' ? template.theme === 'forest' : district.id === 'depot' ? ['wagons', 'depot', 'workshop'].includes(template.id) : ['clinic', 'archive', 'apartments', 'market'].includes(template.id));
    const template = allowed[Math.floor(legacyRandom() * allowed.length)]!, rotation = Math.floor(legacyRandom() * 4), slot = (cy % 2) * 2 + cx % 2;
    const [baseWidth, baseHeight] = FOOTPRINTS[template.id]!, center = PLACE_CENTERS[district.id][slot]!;
    choices.push({ cx, cy, district, template, rotation, width: baseWidth + slot % 2, height: baseHeight + (slot + 1) % 3,
      center: p(center.x + Math.floor(random() * 7) - 3, center.y + Math.floor(random() * 7) - 3) });
  }
  const packed: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const choice of [...choices].sort((a, b) => b.width * b.height - a.width * a.height)) {
    let best: LivePoint | undefined, score = Infinity;
    for (let shrink = 0; !best && shrink < 10; shrink++) {
      for (let y = Math.max(3, choice.district.y - 4); y <= Math.min(125 - choice.height, choice.district.y + choice.district.height + 4 - choice.height); y++) {
        for (let x = Math.max(3, choice.district.x - 4); x <= Math.min(125 - choice.width, choice.district.x + choice.district.width + 4 - choice.width); x++) {
          const rectangle = { x, y, width: choice.width, height: choice.height };
          if (packed.some(other => intersects(rectangle, other, 2)) || extracts.some(exit => Math.hypot(Math.max(x - exit.x, 0, exit.x - (x + choice.width - 1)), Math.max(y - exit.y, 0, exit.y - (y + choice.height - 1))) < 9)) continue;
          const candidateScore = (x + choice.width / 2 - choice.center.x) ** 2 + (y + choice.height / 2 - choice.center.y) ** 2;
          if (candidateScore < score) { best = p(x, y); score = candidateScore; }
        }
      }
      if (!best) { choice.width = Math.max(14, choice.width - 2); choice.height = Math.max(12, choice.height - 1); }
    }
    if (!best) throw new Error(`No space for content module ${choice.template.id}`);
    choice.origin = best; packed.push({ ...best, width: choice.width, height: choice.height });
  }
  for (const choice of choices) {
    const { cx, cy, district, template, rotation, width, height } = choice, origin = choice.origin!, id = `poi-${cx}-${cy}`;
    const local = (point: LivePoint): LivePoint => { const r = rotated(point, rotation, template.size); return p(Math.round(r.x / (template.size - 1) * (width - 1)), Math.round(r.y / (template.size - 1) * (height - 1))); };
    const place = (point: LivePoint): LivePoint => { const r = local(point); return p(origin.x + r.x, origin.y + r.y); };
    const moduleObstacles = prefabObstacles(template.id).map(obstacle => {
      const corners = [p(obstacle.x, obstacle.y), p(obstacle.x + obstacle.width - 1, obstacle.y), p(obstacle.x, obstacle.y + obstacle.height - 1), p(obstacle.x + obstacle.width - 1, obstacle.y + obstacle.height - 1)].map(local);
      const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
      return { ...obstacle, x: origin.x + x, y: origin.y + y, width: Math.max(...corners.map(point => point.x)) - x + 1, height: Math.max(...corners.map(point => point.y)) - y + 1 };
    });
    const reserved = new Set<string>();
    const nearestClear = (target: LivePoint, unique = false): LivePoint => {
      let best: LivePoint | undefined, minimum = Infinity;
      for (let y = origin.y; y < origin.y + height; y++) for (let x = origin.x; x < origin.x + width; x++) {
        if (moduleObstacles.some(wall => x >= wall.x && y >= wall.y && x < wall.x + wall.width && y < wall.y + wall.height) || unique && reserved.has(`${x}:${y}`)) continue;
        const distance = (x - target.x) ** 2 + (y - target.y) ** 2;
        if (distance < minimum) { best = p(x, y); minimum = distance; }
      }
      if (!best) throw new Error(`No clear content anchor in ${id}`);
      if (unique) reserved.add(`${best.x}:${best.y}`);
      return best;
    };
    const central = (cx === 1 || cx === 2) && (cy === 1 || cy === 2), danger: 1 | 2 | 3 = central ? 3 : 2;
    const name = `${template.name} ${cy * 4 + cx + 1}`;
    obstacles.push(...moduleObstacles);
    const entrances = template.entrances.map(point => nearestClear(place(point)));
    pois.push({ id, templateId: template.id, name, districtId: district.id, ...origin, width, height, danger, tags: [...template.tags, central ? 'contested' : 'peripheral', 'quests'], entrances });
    zones.push({ ...origin, width, height, name, terrain: template.theme === 'forest' && template.id !== 'sawmill' ? 'forest' : 'concrete', danger });
    template.containers.forEach((anchor, index) => containers.push({ ...anchor, ...nearestClear(place(anchor), true), id: `${id}-${anchor.kind}-${index}`, poiId: id }));
    const faction = (cx + cy) % 2 === 0 ? 'scavs' : 'raiders';
    template.npcPoints.forEach((point, index) => {
      const route = template.patrol.map(point => nearestClear(place(point)));
      if (central && index === 1) route.push(entrances[0]!);
      npcSpawns.push({ point: nearestClear(place(point), true), faction, role: index === 0 ? 'guard' : index === 1 ? 'patrol' : 'marksman', route });
    });
  }
  // Contested patrols visit a neighbouring rival post along the shared road network.
  for (const [index, spawn] of npcSpawns.entries()) if (spawn.role === 'patrol' && pois[Math.floor(index / 3)]!.danger === 3) {
    const rival = pois.filter((_, poiIndex) => npcSpawns[poiIndex * 3]!.faction !== spawn.faction)
      .map(poi => poi.entrances[0]!).filter(point => Math.hypot(point.x - spawn.point.x, point.y - spawn.point.y) <= 48)
      .sort((a, b) => Math.hypot(a.x - spawn.point.x, a.y - spawn.point.y) - Math.hypot(b.x - spawn.point.x, b.y - spawn.point.y))[0];
    if (rival) spawn.route.push({ ...rival });
  }
  // Trees form groves across administrative boundaries. A clear ring prevents sealed cells.
  const groves = [p(70, 15), p(92, 8), p(110, 35), p(71, 40), p(72, 69), p(9, 66), p(7, 94), p(102, 99)];
  for (const grove of groves) for (let index = 0; index < 38; index++) {
    const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 16, point = p(Math.round(grove.x + Math.cos(angle) * radius), Math.round(grove.y + Math.sin(angle) * radius));
    if (point.x < 2 || point.y < 10 || point.x > 125 || point.y > 125 || pois.some(poi => intersects({ ...point, width: 1, height: 1 }, poi, 2)) || extracts.some(exit => Math.hypot(exit.x - point.x, exit.y - point.y) < 8) || obstacles.some(wall => intersects({ ...point, width: 1, height: 1 }, wall, 1))) continue;
    obstacles.push(cover(point.x, point.y, 1, 1, 'tree'));
  }
  const landscape = generateLandscape({ width: LIVE_WORLD_SIZE, height: LIVE_WORLD_SIZE, obstacles, pois, extracts }, seed);
  obstacles.push(...landscape.water);
  const layout = { seed, generatorVersion: LIVE_GENERATOR_VERSION, chunkSize: LIVE_CHUNK_SIZE, width: LIVE_WORLD_SIZE, height: LIVE_WORLD_SIZE, districts, obstacles, zones, pois, containers, terrainRows: landscape.terrainRows, paths: landscape.paths };
  const version = `perimeter-g${LIVE_GENERATOR_VERSION}-${hash32(JSON.stringify({ ...layout, npcSpawns })).toString(16).padStart(8, '0')}`;
  return { id: 'perimeter', name: 'Большой Периметр', description: 'Общий мир дорог, промышленных дворов, лесных троп и речных переправ. Выбери точку входа и свободно исследуй весь Периметр.', theme: 'mixed', version, ...layout, extracts, npcSpawns, lootSpawns: containers.map(({ x, y }) => ({ x, y })) };
}

export function worldChunks(world: LiveWorld): LiveWorldChunk[] {
  const chunks: LiveWorldChunk[] = [];
  for (let y = 0; y < world.height; y += world.chunkSize) for (let x = 0; x < world.width; x += world.chunkSize) {
    const width = Math.min(world.chunkSize, world.width - x), height = Math.min(world.chunkSize, world.height - y);
    const inside = (point: LivePoint) => point.x >= x && point.y >= y && point.x < x + width && point.y < y + height;
    chunks.push({ x: x / world.chunkSize, y: y / world.chunkSize, width, height,
      obstacleIndices: world.obstacles.flatMap((obstacle, index) => obstacle.x < x + width && obstacle.y < y + height && obstacle.x + obstacle.width > x && obstacle.y + obstacle.height > y ? [index] : []),
      poiIds: world.pois.filter(poi => intersects(poi, { x, y, width, height })).map(poi => poi.id), containerIds: world.containers.filter(inside).map(container => container.id) });
  }
  return chunks;
}

/** Validation is part of generation tooling: an invalid layout never becomes a live revision. */
export function validateGeneratedWorld(world: LiveMapDefinition): { walkableTiles: number; chunks: number; containers: number; pois: number } {
  if (!Number.isInteger(world.width) || !Number.isInteger(world.height) || world.width < 32 || world.height < 32 || world.width > 256 || world.height > 256 || world.chunkSize !== LIVE_CHUNK_SIZE) throw new Error('Invalid world dimensions or chunk size');
  if (!world.terrainRows || world.terrainRows.length !== world.height || world.terrainRows.some(row => typeof row !== 'string' || row.length !== world.width || [...row].some(code => !(code in LIVE_TERRAIN_CODES)))) throw new Error('Invalid terrain raster');
  if (!world.paths || new Set(world.paths.map(path => path.id)).size !== world.paths.length || world.paths.some(path => !path.id || !['road', 'trail', 'rail', 'river'].includes(path.kind) || !Number.isFinite(path.width) || path.width < .5 || path.width > 16 || path.points.length < 2 || path.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= world.width || point.y >= world.height))) throw new Error('Invalid landscape path');
  if (world.obstacles.length > 4096) throw new Error('World has too much cover');
  const total = world.width * world.height, blocked = new Uint8Array(total), water = new Uint8Array(total);
  const inside = ({ x, y }: LivePoint) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.width && y < world.height;
  for (const wall of world.obstacles) {
    if (!inside(wall) || !Number.isInteger(wall.width) || !Number.isInteger(wall.height) || wall.width < 1 || wall.height < 1 || wall.x + wall.width > world.width || wall.y + wall.height > world.height) throw new Error('Cover outside the world');
    for (let y = wall.y; y < wall.y + wall.height; y++) for (let x = wall.x; x < wall.x + wall.width; x++) { blocked[y * world.width + x] = 1; if (wall.kind === 'water') water[y * world.width + x] = 1; }
  }
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) if ((world.terrainRows[y]![x] === 'w') !== Boolean(water[y * world.width + x])) throw new Error('Water raster and physical bank disagree');
  const clear = (point: LivePoint) => inside(point) && !blocked[point.y * world.width + point.x];
  const required = [...world.extracts, ...world.districts.flatMap(district => district.spawns), ...world.pois.flatMap(poi => poi.entrances), ...world.containers, ...world.npcSpawns.flatMap(spawn => [spawn.point, ...spawn.route])];
  if (!required.every(clear)) throw new Error('Door, spawn, container or route inside cover');
  if (world.npcSpawns.some(spawn => world.extracts.some(exit => Math.hypot(spawn.point.x - exit.x, spawn.point.y - exit.y) < 8))) throw new Error('NPC post too close to an entry');
  if (new Set(world.containers.map(anchor => anchor.id)).size !== world.containers.length || new Set(world.containers.map(anchor => `${anchor.x}:${anchor.y}`)).size !== world.containers.length) throw new Error('Container identity or position duplicated');
  const seen = new Uint8Array(total), queue = new Int32Array(total); let head = 0, tail = 1;
  const start = world.extracts[0]!; queue[0] = start.y * world.width + start.x; seen[queue[0]!] = 1;
  while (head < tail) {
    const index = queue[head++]!, x = index % world.width, y = Math.floor(index / world.width);
    for (const next of [p(x + 1, y), p(x - 1, y), p(x, y + 1), p(x, y - 1)]) {
      if (!clear(next)) continue; const key = next.y * world.width + next.x;
      if (!seen[key]) { seen[key] = 1; queue[tail++] = key; }
    }
  }
  const walkableTiles = total - blocked.reduce((sum, value) => sum + value, 0);
  if (tail !== walkableTiles || required.some(point => !seen[point.y * world.width + point.x])) throw new Error('World contains a disconnected walkable area');
  return { walkableTiles, chunks: worldChunks(world).length, containers: world.containers.length, pois: world.pois.length };
}
