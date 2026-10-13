import type { LiveMapId, LiveObstacle, LivePoint, LiveWorld, LiveZone } from './live';

export interface LiveNpcSpawn {
  point: LivePoint;
  faction: 'scavs' | 'raiders';
  role: 'patrol' | 'guard' | 'marksman';
  route: LivePoint[];
}
export interface LiveMapDefinition extends LiveWorld {
  npcSpawns: LiveNpcSpawn[];
  lootSpawns: LivePoint[];
}
const point = (x: number, y: number): LivePoint => ({ x, y });
const obstacle = (x: number, y: number, width: number, height: number, kind: LiveObstacle['kind'], label?: string): LiveObstacle => ({ x, y, width, height, kind, ...(label ? { label } : {}) });
const zone = (x: number, y: number, width: number, height: number, name: string, terrain: LiveZone['terrain'], danger: LiveZone['danger']): LiveZone => ({ x, y, width, height, name, terrain, danger });
const squad = (faction: LiveNpcSpawn['faction'], routes: number[][][]): LiveNpcSpawn[] => routes.flatMap((route, index) => {
  const points = route.map(([x, y]) => point(x!, y!));
  return points.slice(0, 3).map((location, member) => ({ point: location, faction, role: member === 0 ? 'guard' : index === 1 && member === 2 ? 'marksman' : 'patrol', route: points }));
});

/** Authored, shared spaces. Coordinates and rewards are never accepted from a browser. */
export const LIVE_MAPS: readonly LiveMapDefinition[] = [
  {
    id: 'customs', name: 'Таможня', theme: 'industrial', width: 48, height: 36,
    description: 'Складской терминал, открытый ангар и контейнерные дворы. Дикие держат склады, рейдеры — грузовой пост.',
    extracts: [point(2, 2), point(45, 33), point(2, 33)],
    zones: [
      zone(0, 0, 48, 36, 'Таможенный периметр', 'yard', 1),
      zone(0, 9, 48, 3, 'Грузовой проспект', 'road', 2),
      zone(19, 0, 3, 36, 'Сервисный проезд', 'road', 2),
      zone(3, 3, 16, 18, 'Старые склады', 'concrete', 2),
      zone(23, 3, 21, 14, 'Контейнерный двор', 'concrete', 3),
      zone(24, 20, 19, 11, 'Открытый ангар', 'concrete', 3),
      zone(4, 23, 14, 8, 'Погрузочная площадка', 'yard', 2),
    ],
    obstacles: [
      obstacle(7, 4, 4, 4, 'building', 'Склад №1'), obstacle(16, 3, 3, 6, 'building', 'Офис'),
      obstacle(23, 6, 5, 3, 'container', 'Грузовой пост'), obstacle(4, 13, 5, 4, 'building', 'Гаражи'),
      obstacle(12, 12, 6, 3, 'building', 'Склад №2'), obstacle(22, 15, 4, 5, 'building', 'КПП'),
      obstacle(31, 4, 7, 2, 'container', 'Контейнеры'), obstacle(34, 8, 7, 2, 'container'),
      obstacle(29, 13, 6, 2, 'container'), obstacle(39, 13, 3, 2, 'barricade'),
      obstacle(24, 22, 1, 9, 'wall', 'Ангар'), obstacle(25, 22, 7, 1, 'wall'),
      obstacle(36, 22, 7, 1, 'wall'), obstacle(42, 23, 1, 8, 'wall'),
      obstacle(25, 30, 7, 1, 'wall'), obstacle(36, 30, 6, 1, 'wall'),
      obstacle(28, 25, 3, 2, 'barricade', 'Ящики'), obstacle(37, 26, 2, 2, 'container'),
      obstacle(6, 25, 4, 2, 'container', 'Погрузка'), obstacle(13, 27, 3, 2, 'barricade'),
      obstacle(11, 18, 3, 1, 'barricade'), obstacle(18, 22, 1, 3, 'wall'),
      obstacle(3, 7, 2, 1, 'barricade'), obstacle(44, 18, 1, 3, 'tree'),
      obstacle(8, 30, 1, 2, 'tree'), obstacle(17, 32, 2, 1, 'barricade'),
    ],
    npcSpawns: [
      ...squad('scavs', [[[11, 9], [14, 9], [15, 16], [19, 11], [10, 19]], [[6, 22], [11, 23], [17, 25], [11, 30]]]),
      ...squad('raiders', [[[29, 6], [32, 11], [40, 11], [24, 11], [40, 17]], [[26, 24], [33, 25], [39, 27], [33, 29]]]),
    ],
    lootSpawns: [point(12, 6), point(10, 16), point(17, 18), point(29, 5), point(33, 7), point(42, 12), point(27, 28), point(34, 24), point(40, 28), point(5, 27), point(12, 28), point(17, 30)],
  },
  {
    id: 'sawmill', name: 'Лесопилка', theme: 'forest', width: 52, height: 40,
    description: 'Лесные тропы, лесопильный цех и лагерь у озера. Дальние прострелы чередуются с густыми укрытиями.',
    extracts: [point(2, 2), point(49, 37), point(2, 37)],
    zones: [
      zone(0, 0, 52, 40, 'Сосновый лес', 'forest', 1),
      zone(0, 18, 52, 3, 'Просека', 'road', 2),
      zone(24, 0, 3, 40, 'Лесная дорога', 'road', 2),
      zone(10, 9, 15, 10, 'Лесопильный цех', 'yard', 3),
      zone(31, 6, 15, 12, 'Лагерь рейдеров', 'yard', 3),
      zone(8, 25, 16, 11, 'Дровяной склад', 'yard', 2),
      zone(32, 25, 15, 10, 'Берег озера', 'water', 2),
    ],
    obstacles: [
      obstacle(10, 9, 1, 9, 'wall', 'Лесопилка'), obstacle(11, 9, 12, 1, 'wall'),
      obstacle(23, 10, 1, 8, 'wall'), obstacle(11, 17, 4, 1, 'wall'), obstacle(19, 17, 4, 1, 'wall'),
      obstacle(13, 12, 3, 2, 'barricade', 'Станки'), obstacle(19, 12, 2, 2, 'barricade'),
      obstacle(34, 8, 4, 3, 'building', 'Барак'), obstacle(41, 12, 3, 3, 'building', 'Пост'),
      obstacle(31, 13, 2, 1, 'barricade'), obstacle(39, 6, 4, 1, 'barricade'),
      obstacle(10, 27, 6, 1, 'barricade', 'Брёвна'), obstacle(12, 31, 6, 1, 'barricade'),
      obstacle(20, 27, 2, 5, 'container', 'Инструменты'),
      obstacle(35, 27, 9, 5, 'building', 'Затон'),
      ...[[6, 6], [8, 12], [4, 16], [15, 4], [20, 6], [29, 4], [47, 5], [48, 12],
        [29, 15], [4, 24], [6, 30], [19, 23], [28, 26], [29, 33], [25, 35], [45, 23],
        [48, 28], [8, 35], [33, 36], [17, 35]].map(([x, y]) => obstacle(x!, y!, 1, 1, 'tree')),
    ],
    npcSpawns: [
      ...squad('scavs', [[[12, 11], [17, 11], [21, 16], [27, 16], [16, 16]], [[9, 26], [17, 28], [18, 33], [9, 33]]]),
      ...squad('raiders', [[[32, 8], [39, 10], [45, 16], [30, 17], [35, 16]], [[32, 26], [45, 26], [45, 29], [32, 33]]]),
    ],
    lootSpawns: [point(12, 15), point(18, 13), point(21, 15), point(32, 10), point(39, 12), point(45, 15), point(9, 29), point(17, 30), point(22, 33), point(32, 29), point(44, 33), point(38, 34)],
  },
  {
    id: 'depot', name: 'Депо', theme: 'urban', width: 44, height: 36,
    description: 'Вагоны, ремонтный зал и тесные служебные проходы. Ближний бой за платформы и открытые мастерские.',
    extracts: [point(2, 2), point(41, 33), point(2, 33)],
    zones: [
      zone(0, 0, 44, 36, 'Железнодорожный район', 'concrete', 1),
      zone(0, 10, 44, 4, 'Главная платформа', 'road', 3),
      zone(19, 0, 4, 36, 'Служебный проезд', 'road', 2),
      zone(4, 4, 14, 7, 'Северные вагоны', 'yard', 2),
      zone(25, 4, 15, 15, 'Ремонтный зал', 'concrete', 3),
      zone(4, 17, 14, 14, 'Сортировочная', 'yard', 3),
      zone(26, 24, 14, 8, 'Мастерские', 'concrete', 2),
    ],
    obstacles: [
      obstacle(5, 5, 11, 2, 'container', 'Вагон №1'), obstacle(7, 9, 9, 1, 'barricade', 'Платформа'),
      obstacle(26, 5, 1, 13, 'wall', 'Ремонтный зал'), obstacle(27, 5, 12, 1, 'wall'),
      obstacle(39, 6, 1, 12, 'wall'), obstacle(27, 17, 4, 1, 'wall'), obstacle(35, 17, 4, 1, 'wall'),
      obstacle(29, 8, 3, 2, 'container', 'Ремонт'), obstacle(35, 12, 2, 2, 'barricade'),
      obstacle(4, 18, 2, 9, 'container', 'Вагон №2'), obstacle(10, 20, 2, 10, 'container', 'Вагон №3'),
      obstacle(15, 17, 2, 8, 'container', 'Вагон №4'), obstacle(6, 29, 2, 1, 'barricade'),
      obstacle(27, 25, 1, 6, 'wall', 'Мастерская'), obstacle(28, 25, 10, 1, 'wall'),
      obstacle(38, 26, 1, 5, 'wall'), obstacle(28, 30, 3, 1, 'wall'), obstacle(35, 30, 3, 1, 'wall'),
      obstacle(30, 27, 2, 1, 'barricade'), obstacle(35, 28, 2, 1, 'barricade'),
      obstacle(17, 28, 1, 3, 'wall'), obstacle(23, 21, 2, 1, 'barricade'),
      obstacle(3, 14, 2, 1, 'barricade'), obstacle(41, 21, 1, 2, 'tree'),
    ],
    npcSpawns: [
      ...squad('scavs', [[[6, 8], [17, 8], [17, 14], [22, 14], [6, 14]], [[7, 19], [13, 26], [13, 31], [7, 31]]]),
      ...squad('raiders', [[[28, 7], [34, 8], [37, 15], [24, 16], [32, 16]], [[29, 26], [33, 28], [37, 23], [33, 31]]]),
    ],
    lootSpawns: [point(5, 8), point(17, 6), point(17, 12), point(28, 10), point(33, 11), point(37, 16), point(7, 23), point(13, 22), point(13, 29), point(29, 29), point(34, 27), point(37, 27)],
  },
];

export const isLiveMapId = (value: unknown): value is LiveMapId => LIVE_MAPS.some(map => map.id === value);
export const getLiveMap = (id: LiveMapId): LiveMapDefinition => LIVE_MAPS.find(map => map.id === id)!;

export function isLiveWalkable(world: LiveWorld, { x, y }: LivePoint): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.width && y < world.height && !world.obstacles.some(wall => x >= wall.x && x < wall.x + wall.width && y >= wall.y && y < wall.y + wall.height);
}

/** Supercover ray: a corner crossed between two cells cannot bypass either wall. */
export function hasLiveLineOfSight(world: LiveWorld, a: LivePoint, b: LivePoint): boolean {
  if (!isLiveWalkable(world, a) || !isLiveWalkable(world, b)) return false;
  let x = a.x, y = a.y;
  const dx = b.x - a.x, dy = b.y - a.y, sx = Math.sign(dx), sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx), deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let maxX = deltaX / 2, maxY = deltaY / 2;
  while (x !== b.x || y !== b.y) {
    if (Math.abs(maxX - maxY) < 1e-10) {
      if (!isLiveWalkable(world, { x: x + sx, y }) || !isLiveWalkable(world, { x, y: y + sy })) return false;
      x += sx; y += sy; maxX += deltaX; maxY += deltaY;
    } else if (maxX < maxY) { x += sx; maxX += deltaX; }
    else { y += sy; maxY += deltaY; }
    if (!isLiveWalkable(world, { x, y })) return false;
  }
  return true;
}
