import type { LiveCityBuilding, LiveCityRegion, LiveCitySite, LiveContainerAnchor, LiveDistrictId, LiveObstacle, LivePoi, LivePoint, LiveZone } from './live';
import type { LiveNpcSpawn } from './live-maps';

type Rect = LivePoint & { width: number; height: number };
const point = (x: number, y: number): LivePoint => ({ x, y });
const inside = (p: LivePoint, r: Rect): boolean => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
const intersects = (a: Rect, b: Rect, margin = 0): boolean => a.x < b.x + b.width + margin && a.y < b.y + b.height + margin && a.x + a.width + margin > b.x && a.y + a.height + margin > b.y;
const wall = (x: number, y: number, width: number, height: number, label?: string): LiveObstacle => ({ x, y, width, height, kind: 'wall', ...(label ? { label } : {}) });
const blocks = (origin: number, quarterSize: number): Array<[number, number]> => Array.from({ length: 4 }, (_, index) => {
  const left = origin + Math.floor(index / 2) * quarterSize + (index % 2 ? quarterSize / 2 + 6 : 8);
  return [left, origin + Math.floor(index / 2) * quarterSize + (index % 2 ? quarterSize - 8 : quarterSize / 2 - 6)];
});

/** A shipped landmark keeps its identity, but leaves shared frontage for the surrounding neighbourhood. */
export function cityLandmarkOrigin(column: number, row: number, width: number, height: number, worldWidth: number, streetMask: Uint8Array, city: LiveCityRegion): LivePoint {
  const [left, right] = blocks(city.x, city.width / 2)[column]!, [top, bottom] = blocks(city.y, city.height / 2)[row]!;
  const target = point(column % 2 ? right - width + 1 : left, row % 2 ? bottom - height + 1 : top);
  let best: LivePoint | undefined, distance = Infinity;
  for (let y = top; y + height - 1 <= bottom; y++) for (let x = left; x + width - 1 <= right; x++) {
    let blocked = false;
    for (let ny = y; !blocked && ny < y + height; ny++) for (let nx = x; nx < x + width; nx++) if (streetMask[ny * worldWidth + nx]) { blocked = true; break; }
    const score = (x - target.x) ** 2 + (y - target.y) ** 2;
    if (!blocked && score < distance) { best = point(x, y); distance = score; }
  }
  if (!best) throw new Error(`No reserved city landmark lot ${column}:${row}`);
  return best;
}

const NAMES = [
  ['Двор часовщика', 'Подворье у Северной', 'Аркада «Фонари»', 'Двор сапожника', 'Пекарный проезд', 'Пассаж «Старый город»'],
  ['Двор токаря', 'Гаражи на Заводской', 'Ремонтный проезд', 'Литейный двор', 'Служебный двор «Ольха»', 'Мастерские «Искра»'],
  ['Двор проводников', 'Почтовый проезд', 'Вокзальная аркада', 'Двор багажа', 'Гаражи у платформы', 'Пассаж «Путевой»'],
  ['Двор на Садовой', 'Двор коммунальщиков', 'Дом у Южных лавок', 'Двор столяра', 'Садовые мастерские', 'Проезд «Три дома»'],
] as const;
type LootProfile = 'home' | 'tools' | 'shops' | 'bakery' | 'postal' | 'aid' | 'baggage';
const STYLES: ReadonlyArray<ReadonlyArray<readonly [LiveCitySite['kind'], LiveCityBuilding['kind'], LootProfile]>> = [
  [['workyard', 'workshop', 'tools'], ['courtyard', 'apartment', 'home'], ['arcade', 'shop', 'shops'], ['workyard', 'workshop', 'tools'], ['arcade', 'shop', 'bakery'], ['arcade', 'shop', 'shops']],
  [['workyard', 'workshop', 'tools'], ['workyard', 'garage', 'tools'], ['workyard', 'workshop', 'tools'], ['workyard', 'workshop', 'tools'], ['service-yard', 'service', 'aid'], ['workyard', 'workshop', 'tools']],
  [['courtyard', 'apartment', 'home'], ['service-yard', 'service', 'postal'], ['arcade', 'shop', 'shops'], ['service-yard', 'service', 'baggage'], ['workyard', 'garage', 'tools'], ['arcade', 'shop', 'shops']],
  [['courtyard', 'apartment', 'home'], ['service-yard', 'service', 'tools'], ['courtyard', 'apartment', 'shops'], ['workyard', 'workshop', 'tools'], ['courtyard', 'workshop', 'tools'], ['courtyard', 'apartment', 'home']],
];
const LOOT_PROFILES: Record<LootProfile, { kinds: readonly LiveContainerAnchor['kind'][]; tables: readonly LiveContainerAnchor['lootTable'][] }> = {
  home: { kinds: ['jacket', 'cabinet', 'duffel'], tables: ['valuables', 'intel', 'mixed'] },
  tools: { kinds: ['toolbox', 'crate', 'jacket'], tables: ['tools', 'provisions', 'valuables'] },
  shops: { kinds: ['jacket', 'cabinet', 'duffel'], tables: ['valuables', 'intel', 'mixed'] },
  bakery: { kinds: ['duffel', 'crate', 'jacket'], tables: ['provisions', 'provisions', 'valuables'] },
  postal: { kinds: ['cabinet', 'toolbox', 'duffel'], tables: ['intel', 'tools', 'mixed'] },
  aid: { kinds: ['medbag', 'cabinet', 'duffel'], tables: ['medical', 'intel', 'mixed'] },
  baggage: { kinds: ['duffel', 'jacket', 'crate'], tables: ['mixed', 'valuables', 'provisions'] },
};

function openBuilding(rect: Rect, id: string, name: string, kind: LiveCityBuilding['kind'], sideDoors: boolean): { building: LiveCityBuilding; walls: LiveObstacle[]; floor: LivePoint } {
  // Opposing two-cell doors connect a real, at least three-cell-wide indoor lane.
  const door = sideDoors ? rect.y + Math.floor((rect.height - 2) / 2) : rect.x + Math.floor((rect.width - 2) / 2);
  const before = door - (sideDoors ? rect.y : rect.x), after = (sideDoors ? rect.height : rect.width) - before - 2;
  const walls = sideDoors
    ? [wall(rect.x, rect.y, 1, before, name), wall(rect.x, door + 2, 1, after), wall(rect.x + rect.width - 1, rect.y, 1, before), wall(rect.x + rect.width - 1, door + 2, 1, after),
      wall(rect.x + 1, rect.y, rect.width - 2, 1), wall(rect.x + 1, rect.y + rect.height - 1, rect.width - 2, 1)]
    : [wall(rect.x, rect.y, before, 1, name), wall(door + 2, rect.y, after, 1), wall(rect.x, rect.y + rect.height - 1, before, 1), wall(door + 2, rect.y + rect.height - 1, after, 1),
      wall(rect.x, rect.y + 1, 1, rect.height - 2), wall(rect.x + rect.width - 1, rect.y + 1, 1, rect.height - 2)];
  const entrances = sideDoors ? [point(rect.x, door), point(rect.x + rect.width - 1, door)] : [point(door, rect.y), point(door, rect.y + rect.height - 1)];
  return { building: { ...rect, id, name, kind, entrances }, walls, floor: sideDoors ? point(rect.x + Math.floor(rect.width / 2), door) : point(door, rect.y + Math.floor(rect.height / 2)) };
}

/** A frontage has a main address, a proper setback and at most one detached service annex. */
function authoredBuildings(lot: Rect, quarter: number, kind: LiveCityBuilding['kind'], facingVertical: boolean): Array<{ rect: Rect; annex: boolean }> {
  const inset = 3, usableWidth = lot.width - inset * 2, usableHeight = lot.height - inset * 2;
  if (usableWidth < 8 || usableHeight < 6) return [];
  let preferred: [number, number] = kind === 'shop' ? [18, 9] : kind === 'garage' ? [18, 10] : kind === 'service' ? [16, 11]
    : kind === 'workshop' ? quarter === 1 ? [26, 14] : [18, 11] : quarter === 0 ? [14, 11] : [14, 9];
  if (kind === 'apartment' && usableWidth >= 22 && usableHeight >= 12) preferred = [26, 12];
  if (usableHeight > usableWidth * 1.25) preferred = [preferred[1], preferred[0]];
  const width = Math.min(preferred[0], usableWidth), height = Math.min(preferred[1], usableHeight);
  const rect = { x: lot.x + inset, y: lot.y + inset, width, height }, result = [{ rect, annex: false }];
  // Utility yards and gardens have a small, one-storey garage rather than an
  // equal grid of narrow towers. A four-cell service alley separates the doors.
  if (quarter !== 0 && lot.width * lot.height >= 460) {
    if (!facingVertical && usableWidth - width >= 12) result.push({ rect: { x: rect.x + width + 4, y: rect.y, width: Math.min(12, usableWidth - width - 4), height: Math.min(8, usableHeight) }, annex: true });
    else if (usableHeight - height >= 10) result.push({ rect: { x: rect.x, y: rect.y + height + 4, width: Math.min(12, usableWidth), height: Math.min(8, usableHeight - height - 4) }, annex: true });
  }
  return result;
}

function architecture(quarter: number, kind: LiveCityBuilding['kind'], address: number, rect: Rect): Pick<LiveCityBuilding, 'floors' | 'roof' | 'roofAxis' | 'facade'> {
  const roofAxis = rect.width >= rect.height ? 'x' : 'y', area = rect.width * rect.height;
  if (quarter === 0) return { roofAxis, floors: kind === 'apartment' && area >= 120 || kind === 'shop' && area >= 140 ? 2 : 1, roof: 'gable', facade: address % 3 ? 'plaster' : 'brick' };
  if (quarter === 1) return { roofAxis, floors: kind === 'service' && area >= 160 ? 2 : 1, roof: kind === 'workshop' && area >= 180 ? 'sawtooth' : 'flat', facade: kind === 'garage' ? 'metal' : 'brick' };
  if (quarter === 2) return { roofAxis, floors: kind === 'apartment' && area >= 180 ? 2 : 1, roof: kind === 'shop' || kind === 'apartment' ? 'gable' : 'flat', facade: kind === 'garage' ? 'metal' : 'brick' };
  const apartmentBlock = kind === 'apartment' && area >= 200 && Math.max(rect.width, rect.height) >= 22;
  return { roofAxis, floors: kind === 'apartment' ? apartmentBlock ? 3 : area >= 160 ? 2 : 1 : 1, roof: apartmentBlock ? 'flat' : 'gable', facade: apartmentBlock ? 'panel' : 'plaster' };
}

const ADDRESS_NAMES: Record<LiveCityBuilding['kind'], readonly string[]> = {
  apartment: ['Жилой дом', 'Доходный дом', 'Дом со двором', 'Служебный дом'],
  shop: ['Угловая лавка', 'Продуктовая лавка', 'Магазин тканей', 'Мелочная лавка'],
  workshop: ['Ремонтная мастерская', 'Столярная мастерская', 'Слесарный цех', 'Мастерская при дворе'],
  garage: ['Гаражный бокс', 'Автомастерская', 'Служебный гараж', 'Гараж снабжения'],
  service: ['Контора', 'Служебный корпус', 'Диспетчерская', 'Хозяйственный корпус'],
};
const FURNISHINGS: Record<LiveCityBuilding['kind'], string> = { apartment: 'Комод', shop: 'Торговый прилавок', workshop: 'Верстак', garage: 'Стеллаж с инструментами', service: 'Письменный стол' };

function localRoute(site: Rect, from: LivePoint, to: LivePoint, obstacles: LiveObstacle[]): LivePoint[] {
  const total = site.width * site.height, blocked = new Uint8Array(total), parents = new Int32Array(total).fill(-1), queue = new Int32Array(total);
  const key = (p: LivePoint): number => (p.y - site.y) * site.width + p.x - site.x;
  for (const obstacle of obstacles) for (let y = Math.max(site.y, obstacle.y); y < Math.min(site.y + site.height, obstacle.y + obstacle.height); y++) for (let x = Math.max(site.x, obstacle.x); x < Math.min(site.x + site.width, obstacle.x + obstacle.width); x++) blocked[key(point(x, y))] = 1;
  const start = key(from), end = key(to);
  if (!inside(from, site) || !inside(to, site) || blocked[start] || blocked[end]) throw new Error('City passage endpoint inside cover');
  let head = 0, tail = 1; queue[0] = start; parents[start] = start;
  while (head < tail && parents[end] === -1) {
    const cell = queue[head++]!, x = cell % site.width, y = Math.floor(cell / site.width);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx! < 0 || ny! < 0 || nx! >= site.width || ny! >= site.height) continue;
      const next = ny! * site.width + nx!;
      if (!blocked[next] && parents[next] === -1) { parents[next] = cell; queue[tail++] = next; }
    }
  }
  if (parents[end] === -1) throw new Error('City room has no real passage');
  const result: LivePoint[] = [];
  for (let at = end;; at = parents[at]!) { result.push(point(site.x + at % site.width, site.y + Math.floor(at / site.width))); if (at === start) break; }
  result.reverse();
  return result.filter((p, i) => i === 0 || i === result.length - 1 || p.x - result[i - 1]!.x !== result[i + 1]!.x - p.x || p.y - result[i - 1]!.y !== result[i + 1]!.y - p.y);
}

/** Authored neighbourhoods follow real street frontage; chunks and seed RNG do not place the houses. */
export function generateCitySites(city: LiveCityRegion, worldWidth: number, streetMask: Uint8Array, established: LivePoi[]): {
  sites: LiveCitySite[]; pois: LivePoi[]; obstacles: LiveObstacle[]; containers: LiveContainerAnchor[]; npcSpawns: LiveNpcSpawn[]; zones: LiveZone[];
} {
  const sites: LiveCitySite[] = [], pois: LivePoi[] = [], obstacles: LiveObstacle[] = [], containers: LiveContainerAnchor[] = [], npcSpawns: LiveNpcSpawn[] = [], zones: LiveZone[] = [];
  for (const [quarterIndex, quarter] of city.quarters.entries()) {
    const col = quarterIndex % 2 * 2, row = Math.floor(quarterIndex / 2) * 2;
    const horizontalBlocks = blocks(city.x, quarter.width), verticalBlocks = blocks(city.y, quarter.height);
    const left = horizontalBlocks[col]![0], right = horizontalBlocks[col + 1]![1], top = verticalBlocks[row]![0], bottom = verticalBlocks[row + 1]![1];
    const axisX = quarter.x + quarter.width / 2, axisY = quarter.y + quarter.height / 2;
    const landmarks = established.filter(poi => inside(poi, quarter));
    const west = landmarks.filter(poi => poi.x + poi.width / 2 < axisX), east = landmarks.filter(poi => poi.x + poi.width / 2 > axisX);
    const north = landmarks.filter(poi => poi.y + poi.height / 2 < axisY), south = landmarks.filter(poi => poi.y + poi.height / 2 > axisY);
    if ([west, east, north, south].some(items => items.length !== 2)) throw new Error(`City quarter landmark ownership invalid: ${quarter.id}`);
    const bandLeft = Math.max(...west.map(poi => poi.x + poi.width)), bandRight = Math.min(...east.map(poi => poi.x));
    const bandTop = Math.max(...north.map(poi => poi.y + poi.height)), bandBottom = Math.min(...south.map(poi => poi.y));
    const rectangles: Rect[] = [
      { x: bandLeft, y: top, width: bandRight - bandLeft, height: bandTop - top },
      { x: bandLeft, y: bandBottom, width: bandRight - bandLeft, height: bottom - bandBottom + 1 },
      { x: left, y: bandTop, width: bandLeft - left, height: axisY - bandTop + 1 },
      { x: left, y: axisY + 2, width: bandLeft - left, height: bandBottom - axisY - 2 },
      { x: bandRight, y: bandTop, width: right - bandRight + 1, height: bandBottom - bandTop },
      { x: bandLeft, y: bandTop, width: bandRight - bandLeft, height: bandBottom - bandTop },
    ];
    for (const [slot, rect] of rectangles.entries()) {
      if (rect.width < 7 || rect.height < 7 || established.some(poi => intersects(rect, poi))) throw new Error(`No usable city frontage ${quarter.id}:${slot}`);
      const id = `city-${quarter.id}-${slot}`, name = NAMES[quarterIndex]![slot]!, [kind, buildingKind, lootProfile] = STYLES[quarterIndex]![slot]!;
      const districtId = ['customs', 'sawmill', 'depot', 'village'][quarterIndex] as LiveDistrictId;
      const vertical = axisX >= rect.x && axisX < rect.x + rect.width;
      const laneY = Math.max(rect.y, Math.min(rect.y + rect.height - 1, axisY));
      const ports = vertical ? [point(axisX, rect.y), point(axisX, rect.y + rect.height - 1)] : [point(rect.x, laneY), point(rect.x + rect.width - 1, laneY)];
      const court: Rect = vertical
        ? { x: Math.max(rect.x, axisX - 3), y: rect.y + 1, width: Math.min(rect.x + rect.width, axisX + 4) - Math.max(rect.x, axisX - 3), height: rect.height - 2 }
        : { x: rect.x + 1, y: Math.max(rect.y, axisY - 3), width: rect.width - 2, height: Math.min(rect.y + rect.height, axisY + 4) - Math.max(rect.y, axisY - 3) };
      const cuts = (start: number, end: number, axis: number): number[] => [...new Set([start, Math.max(start, Math.min(end, axis - 3)), Math.max(start, Math.min(end, axis + 4)), end])].sort((a, b) => a - b);
      const xs = cuts(rect.x, rect.x + rect.width, axisX), ys = cuts(rect.y, rect.y + rect.height, axisY);
      const buildings: LiveCityBuilding[] = [], siteWalls: LiveObstacle[] = [], indoor: LivePoint[] = [];
      for (let yi = 1; yi < ys.length; yi++) for (let xi = 1; xi < xs.length; xi++) {
        const lot: Rect = { x: xs[xi - 1]!, y: ys[yi - 1]!, width: xs[xi]! - xs[xi - 1]!, height: ys[yi]! - ys[yi - 1]! };
        if (lot.width < 8 || lot.height < 6) continue;
        // Historic shops face the shared courtyard; factory and station yards use
        // deeper halls, while southern houses have compact plots and outbuildings.
        for (const candidate of authoredBuildings(lot, quarterIndex, buildingKind, vertical)) {
          const buildingRect = candidate.rect;
          let street = false;
          for (let ny = buildingRect.y; !street && ny < buildingRect.y + buildingRect.height; ny++) for (let nx = buildingRect.x; nx < buildingRect.x + buildingRect.width; nx++) if (streetMask[ny * worldWidth + nx]) { street = true; break; }
          if (street) continue;
          const address = buildings.length;
          const localKind: LiveCityBuilding['kind'] = candidate.annex ? 'garage' : address === 0 ? buildingKind
            : quarterIndex === 0 ? (kind === 'arcade' && address % 3 ? 'shop' : address % 2 ? 'apartment' : 'workshop')
              : quarterIndex === 1 ? (address % 3 === 2 ? 'service' : slot === 1 || address % 3 === 1 ? 'garage' : 'workshop')
                : quarterIndex === 2 ? (kind === 'arcade' ? 'shop' : address % 3 === 1 ? 'service' : address % 3 === 2 ? 'garage' : buildingKind)
                  : (address % 3 === 2 ? 'garage' : kind === 'courtyard' ? 'apartment' : address % 3 === 1 ? 'service' : buildingKind);
          const localName = `${name}: ${ADDRESS_NAMES[localKind][address % ADDRESS_NAMES[localKind].length]} ${address + 1}`;
          const built = openBuilding(buildingRect, `${id}-building-${address}`, localName, localKind, vertical);
          Object.assign(built.building, architecture(quarterIndex, localKind, address, buildingRect));
          buildings.push(built.building); siteWalls.push(...built.walls); indoor.push(built.floor);
          // A counter, dresser or workbench stays against the side wall, outside
          // the straight door lane. Even the smallest room has a walkable interior.
          if (vertical ? buildingRect.height >= 7 : buildingRect.width >= 7) siteWalls.push({ x: buildingRect.x + 1, y: buildingRect.y + 1, width: 1, height: 1, kind: 'barricade', label: FURNISHINGS[localKind] });
          if (buildingRect.width >= 7 && buildingRect.height >= 7) siteWalls.push({ x: buildingRect.x + buildingRect.width - 2, y: buildingRect.y + buildingRect.height - 2,
            width: 1, height: 1, kind: 'barricade', label: localKind === 'apartment' ? 'Кухонный шкаф' : localKind === 'shop' ? 'Товарный стеллаж' : 'Хозяйственный стеллаж' });
        }
      }
      if (!buildings.length) throw new Error(`City frontage lacks a usable room: ${id}`);
      // Closed residential/service wings are real solid cover, paired with the open
      // frontage rather than scattered at random. They never obstruct a doorway apron.
      let wings = 0;
      for (const [width, height] of [[10, 7], [8, 6]] as const) {
        for (let y = rect.y + 1; y + height < rect.y + rect.height && wings < 1; y++) for (let x = rect.x + 1; x + width < rect.x + rect.width && wings < 1; x++) {
          const wing = { x, y, width, height };
          if (intersects(wing, court) || buildings.some(building => intersects(wing, building))
            || buildings.some(building => building.entrances.some(door => door.x >= x - 2 && door.y >= y - 2 && door.x < x + width + 2 && door.y < y + height + 2))
            || siteWalls.some(obstacle => intersects(wing, obstacle, 2))) continue;
          let street = false;
          for (let ny = y; !street && ny < y + height; ny++) for (let nx = x; nx < x + width; nx++) if (streetMask[ny * worldWidth + nx]) { street = true; break; }
          if (street) continue;
          const address = buildings.length, annexKind = kind === 'workyard' ? 'service' : 'garage';
          const built = openBuilding(wing, `${id}-building-${address}`, `${name}: ${annexKind === 'service' ? 'хозяйственный корпус' : 'дворовый гараж'}`, annexKind, vertical);
          Object.assign(built.building, architecture(quarterIndex, annexKind, address, wing));
          buildings.push(built.building); siteWalls.push(...built.walls); indoor.push(built.floor); wings++;
        }
      }
      const courtyardPoint = point(vertical ? axisX : Math.floor(court.x + court.width / 2), vertical ? Math.floor(court.y + court.height / 2) : laneY);
      const passages = [localRoute(rect, ports[0]!, indoor[0]!, siteWalls), localRoute(rect, indoor[0]!, ports[1]!, siteWalls)];
      if (buildings.length > 1) passages.push(localRoute(rect, ports[0]!, indoor.at(-1)!, siteWalls), localRoute(rect, indoor.at(-1)!, ports[1]!, siteWalls));
      if (passages.some(path => path.length > 16)) throw new Error(`City passage has too many turns: ${id}`);
      const danger: 2 | 3 = Math.hypot(rect.x + rect.width / 2 - city.x - city.width / 2, rect.y + rect.height / 2 - city.y - city.height / 2) < city.width / 3 ? 3 : 2;
      pois.push({ ...rect, id, templateId: `city-${kind}`, name, districtId, danger, tags: ['city', 'city-site', kind, 'search', 'visit', 'quests', ...(danger === 3 ? ['contested'] : ['urban'])], entrances: ports });
      sites.push({ ...rect, id, poiId: id, quarterId: quarter.id, name, kind, courtyard: court, buildings, passages });
      zones.push({ ...rect, name, terrain: 'concrete', danger });
      obstacles.push(...siteWalls);
      // Existing three slot identities stay fixed; the two indoor searches use
      // separate addresses across the yard instead of crowding one frontage.
      const first = indoor[0]!, second = indoor.length > 1 ? indoor.at(-1)! : point(first.x + 1, first.y);
      const { kinds: anchorKinds, tables } = LOOT_PROFILES[lootProfile];
      [first, second, courtyardPoint].forEach((at, index) => containers.push({ ...at, id: `${id}-slot-${index}`, poiId: id, kind: anchorKinds[index]!, lootTable: tables[index]!, searchMs: index === 1 ? 4000 : 3000 }));
      const home = vertical ? point(axisX + 1, courtyardPoint.y) : point(courtyardPoint.x, laneY + (laneY + 1 < rect.y + rect.height ? 1 : -1));
      npcSpawns.push({ point: home, faction: (quarterIndex + slot) % 2 ? 'raiders' : 'scavs', role: 'patrol', route: [home, ports[0]!, first, ports[1]!, courtyardPoint] });
    }
  }
  return { sites, pois, obstacles, containers, npcSpawns, zones };
}
