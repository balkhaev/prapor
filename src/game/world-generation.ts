import type { LiveContainerAnchor, LiveContainerKind, LiveDistrict, LiveDistrictId, LiveObstacle, LivePoi, LivePoint, LiveWorld, LiveZone } from './live';
import type { LiveMapDefinition, LiveNpcSpawn } from './live-maps';

export const LIVE_GENERATOR_VERSION = 1;
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
const hall = (): LiveObstacle[] => [
  cover(2, 2, 7, 1, 'wall'), cover(13, 2, 7, 1, 'wall'),
  cover(2, 19, 7, 1, 'wall'), cover(13, 19, 7, 1, 'wall'),
  cover(2, 3, 1, 6, 'wall'), cover(2, 13, 1, 6, 'wall'),
  cover(19, 3, 1, 6, 'wall'), cover(19, 13, 1, 6, 'wall'),
];
const room = (id: string, name: string, theme: LiveDistrict['theme'], kind: 'warehouse' | 'clinic' | 'office' | 'workshop'): WorldTemplate => ({
  id, name, theme, size: 22,
  obstacles: [...hall(), cover(9, 9, 4, 2, 'barricade', kind === 'clinic' ? 'Приёмная' : kind === 'office' ? 'Картотека' : 'Рабочий зал'), cover(5, 14, 2, 2, 'container'), cover(14, 4, 2, 1, 'barricade')],
  containers: [container(4, 6, 'jacket', 'valuables', 2500), container(8, 15, 'duffel', 'mixed', 3000),
    container(16, 15, kind === 'clinic' ? 'medbag' : 'toolbox', kind === 'clinic' ? 'medical' : 'tools', 3500),
    container(16, 8, kind === 'office' ? 'cabinet' : 'crate', kind === 'office' ? 'intel' : 'provisions', 4500)],
  npcPoints: [p(7, 12), p(15, 13), p(16, 12)], patrol: [p(7, 12), p(15, 13), p(16, 5), p(11, 1), p(1, 11)],
  entrances: [p(11, 2), p(11, 19), p(2, 11), p(19, 11)], tags: ['search', 'visit', kind === 'clinic' ? 'medicine' : kind === 'office' ? 'documents' : 'supplies'],
});
const yard = (id: string, name: string, theme: LiveDistrict['theme'], forest = false): WorldTemplate => ({
  id, name, theme, size: 22,
  obstacles: forest ? [cover(5, 5, 3, 2, 'building', 'Пост'), cover(10, 10, 6, 1, 'barricade', 'Брёвна'), cover(4, 15, 5, 1, 'barricade'), cover(17, 4, 1, 1, 'tree'), cover(4, 10, 1, 1, 'tree')]
    : [cover(4, 4, 10, 2, 'container', 'Грузовой состав'), cover(8, 9, 2, 7, 'container'), cover(14, 14, 5, 1, 'barricade'), cover(4, 17, 3, 1, 'barricade')],
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
function placedObstacle(obstacle: LiveObstacle, rotation: number, size: number, origin: LivePoint): LiveObstacle {
  const corners = [p(obstacle.x, obstacle.y), p(obstacle.x + obstacle.width - 1, obstacle.y), p(obstacle.x, obstacle.y + obstacle.height - 1), p(obstacle.x + obstacle.width - 1, obstacle.y + obstacle.height - 1)].map(point => rotated(point, rotation, size));
  const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
  return { ...obstacle, x: origin.x + x, y: origin.y + y, width: Math.max(...corners.map(point => point.x)) - x + 1, height: Math.max(...corners.map(point => point.y)) - y + 1 };
}

/** Geometry only. Private server RNG and durable container cycles determine actual loot. */
export function generateLiveWorld(seed = LIVE_WORLD_SEED): LiveMapDefinition {
  if (typeof seed !== 'string' || !seed.length || seed.length > 80) throw new Error('World seed must be 1–80 characters');
  const random = geometryRandom(`${LIVE_GENERATOR_VERSION}:${seed}`), obstacles: LiveObstacle[] = [], zones: LiveZone[] = [], pois: LivePoi[] = [], containers: LiveContainerAnchor[] = [], npcSpawns: LiveNpcSpawn[] = [];
  const districts = structuredClone([...LIVE_DISTRICTS]);
  for (const district of districts) zones.push({ ...p(district.x, district.y), width: district.width, height: district.height, name: district.name, terrain: district.theme === 'forest' ? 'forest' : 'yard', danger: 1 });
  for (const axis of [6, 30, 62, 94, 118]) {
    zones.push({ x: axis, y: 0, width: 4, height: 128, name: axis === 62 ? 'Северный тракт' : 'Кольцевой проезд', terrain: 'road', danger: axis === 62 ? 3 : 2 });
    zones.push({ x: 0, y: axis, width: 128, height: 4, name: axis === 62 ? 'Грузовой проспект' : 'Сервисный проезд', terrain: 'road', danger: axis === 62 ? 3 : 2 });
  }
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    const district = districts.find(district => cx * 32 >= district.x && cx * 32 < district.x + district.width && cy * 32 >= district.y && cy * 32 < district.y + district.height)!;
    const allowed = WORLD_TEMPLATES.filter(template => district.id === 'customs' ? template.theme === 'industrial' : district.id === 'sawmill' ? template.theme === 'forest' : district.id === 'depot' ? ['wagons', 'depot', 'workshop'].includes(template.id) : ['clinic', 'archive', 'apartments', 'market'].includes(template.id));
    const template = allowed[Math.floor(random() * allowed.length)]!, rotation = Math.floor(random() * 4), origin = p(cx * 32 + 5, cy * 32 + 5), id = `poi-${cx}-${cy}`;
    const place = (point: LivePoint): LivePoint => { const r = rotated(point, rotation, template.size); return p(origin.x + r.x, origin.y + r.y); };
    const central = (cx === 1 || cx === 2) && (cy === 1 || cy === 2), danger: 1 | 2 | 3 = central ? 3 : 2;
    const name = `${template.name} ${cy * 4 + cx + 1}`;
    obstacles.push(...template.obstacles.map(obstacle => placedObstacle(obstacle, rotation, template.size, origin)));
    pois.push({ id, templateId: template.id, name, districtId: district.id, ...origin, width: 22, height: 22, danger, tags: [...template.tags, central ? 'contested' : 'peripheral', 'quests'], entrances: template.entrances.map(place) });
    zones.push({ ...origin, width: 22, height: 22, name, terrain: template.theme === 'forest' && template.id !== 'sawmill' ? 'forest' : 'concrete', danger });
    template.containers.forEach((anchor, index) => containers.push({ ...anchor, ...place(anchor), id: `${id}-${anchor.kind}-${index}`, poiId: id }));
    const faction = (cx + cy) % 2 === 0 ? 'scavs' : 'raiders';
    template.npcPoints.forEach((point, index) => {
      const route = template.patrol.map(place);
      if (central && index === 1) route.push(p(cx < 2 ? 60 : 67, cy * 32 + 27), p(cx < 2 ? 60 : 67, cy < 2 ? 60 : 67));
      npcSpawns.push({ point: place(point), faction, role: index === 0 ? 'guard' : index === 1 ? 'patrol' : 'marksman', route });
    });
    if (district.theme === 'forest') for (const tree of [p(3, 14), p(28, 4), p(28, 21)]) obstacles.push(cover(cx * 32 + tree.x, cy * 32 + tree.y, 1, 1, 'tree'));
  }
  const layout = { seed, generatorVersion: LIVE_GENERATOR_VERSION, chunkSize: LIVE_CHUNK_SIZE, width: LIVE_WORLD_SIZE, height: LIVE_WORLD_SIZE, districts, obstacles, zones, pois, containers };
  const version = `perimeter-g${LIVE_GENERATOR_VERSION}-${hash32(JSON.stringify({ ...layout, npcSpawns })).toString(16).padStart(8, '0')}`;
  return { id: 'perimeter', name: 'Большой Периметр', description: 'Один общий мир: Таможня, Лесопилка, Депо и Посёлок. Выбери район появления и свободно исследуй всю карту.', theme: 'mixed', version, ...layout, extracts: districts.flatMap(district => district.spawns.map(point => ({ ...point }))), npcSpawns, lootSpawns: containers.map(({ x, y }) => ({ x, y })) };
}

export function worldChunks(world: LiveWorld): LiveWorldChunk[] {
  const chunks: LiveWorldChunk[] = [];
  for (let y = 0; y < world.height; y += world.chunkSize) for (let x = 0; x < world.width; x += world.chunkSize) {
    const width = Math.min(world.chunkSize, world.width - x), height = Math.min(world.chunkSize, world.height - y);
    const inside = (point: LivePoint) => point.x >= x && point.y >= y && point.x < x + width && point.y < y + height;
    chunks.push({ x: x / world.chunkSize, y: y / world.chunkSize, width, height,
      obstacleIndices: world.obstacles.flatMap((obstacle, index) => obstacle.x < x + width && obstacle.y < y + height && obstacle.x + obstacle.width > x && obstacle.y + obstacle.height > y ? [index] : []),
      poiIds: world.pois.filter(inside).map(poi => poi.id), containerIds: world.containers.filter(inside).map(container => container.id) });
  }
  return chunks;
}

/** Validation is part of generation tooling: an invalid layout never becomes a live revision. */
export function validateGeneratedWorld(world: LiveMapDefinition): { walkableTiles: number; chunks: number; containers: number; pois: number } {
  if (!Number.isInteger(world.width) || !Number.isInteger(world.height) || world.width < 32 || world.height < 32 || world.width > 256 || world.height > 256 || world.chunkSize !== LIVE_CHUNK_SIZE) throw new Error('Invalid world dimensions or chunk size');
  const total = world.width * world.height, blocked = new Uint8Array(total);
  const inside = ({ x, y }: LivePoint) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.width && y < world.height;
  for (const wall of world.obstacles) {
    if (!inside(wall) || !Number.isInteger(wall.width) || !Number.isInteger(wall.height) || wall.width < 1 || wall.height < 1 || wall.x + wall.width > world.width || wall.y + wall.height > world.height) throw new Error('Cover outside the world');
    for (let y = wall.y; y < wall.y + wall.height; y++) for (let x = wall.x; x < wall.x + wall.width; x++) blocked[y * world.width + x] = 1;
  }
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
