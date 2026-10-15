import type { LiveCityBuilding, LiveCitySite, LiveContainerAnchor, LiveDistrictId, LiveLandscapePath, LiveObstacle, LivePoi, LivePoint, LiveZone } from './live';
import type { LiveNpcSpawn } from './live-maps';
import { METROPOLIS_QUARTERS, metropolisHash, metropolisParcelPlan, type MetropolisParcelPlan, type MetropolisUse } from './world-metropolis-plan';

type Rect = LivePoint & { width: number; height: number };
const point = (x: number, y: number): LivePoint => ({ x, y });
const districtOf = ({ x, y }: LivePoint): LiveDistrictId => y < 512 ? x < 512 ? 'customs' : 'sawmill' : x < 512 ? 'depot' : 'village';
const streetNames: Record<MetropolisUse, readonly string[]> = {
  works: ['Промышленная улица', 'Литейная улица'], civic: ['Улица Совета', 'Почтовая улица'], campus: ['Университетская улица', 'Библиотечная улица'],
  port: ['Портовая набережная', 'Грузовая улица'], park: ['Парковая улица', 'Липовая аллея'], station: ['Товарная улица', 'Улица железнодорожников'],
  waterfront: ['Речная набережная', 'Тихая улица'], market: ['Торговая улица', 'Рыночная улица'], housing: ['Улица Строителей', 'Школьная улица'], garden: ['Садовая улица', 'Яблоневая улица'],
};
function kindFor(use: MetropolisUse, address: number): LiveCityBuilding['kind'] {
  if (use === 'works' || use === 'port') return address % 3 === 0 ? 'workshop' : address % 3 === 1 ? 'garage' : 'service';
  if (use === 'station') return address % 3 === 0 ? 'workshop' : address % 3 === 1 ? 'garage' : 'shop';
  if (use === 'market') return address % 3 ? 'shop' : 'service';
  if (use === 'civic' || use === 'campus') return address % 3 === 0 ? 'service' : address % 3 === 1 ? 'apartment' : 'shop';
  return address % 4 === 0 ? 'shop' : address % 4 === 3 ? 'service' : 'apartment';
}
function architecture(use: MetropolisUse, kind: LiveCityBuilding['kind'], variant: number, vertical: boolean): Pick<LiveCityBuilding, 'floors' | 'roof' | 'roofAxis' | 'facade'> {
  const industrial = kind === 'garage' || kind === 'workshop';
  return { floors: industrial ? 1 : kind === 'apartment' && use === 'housing' ? (variant % 2 ? 3 : 4) : kind === 'service' ? 2 : variant % 3 ? 2 : 1,
    roof: kind === 'workshop' ? variant % 2 ? 'sawtooth' : 'gable' : industrial || use === 'housing' ? 'flat' : 'gable',
    roofAxis: vertical ? 'y' : 'x', facade: industrial ? variant % 2 ? 'metal' : 'brick' : use === 'housing' ? 'panel' : variant % 3 ? 'plaster' : 'brick' };
}
function openBuilding(rect: Rect, id: string, name: string, kind: LiveCityBuilding['kind'], verticalSite: boolean): { building: LiveCityBuilding; walls: LiveObstacle[]; floor: LivePoint } {
  const sideDoors = verticalSite, door = sideDoors ? rect.y + Math.floor((rect.height - 2) / 2) : rect.x + Math.floor((rect.width - 2) / 2);
  const walls: LiveObstacle[] = [];
  const wall = (x: number, y: number, width: number, height: number, label?: string): void => { if (width > 0 && height > 0) walls.push({ x, y, width, height, kind: 'wall', ...(label ? { label } : {}) }); };
  if (sideDoors) {
    for (const x of [rect.x, rect.x + rect.width - 1]) { wall(x, rect.y, 1, door - rect.y, name); wall(x, door + 2, 1, rect.y + rect.height - door - 2); }
    wall(rect.x + 1, rect.y, rect.width - 2, 1); wall(rect.x + 1, rect.y + rect.height - 1, rect.width - 2, 1);
  } else {
    for (const y of [rect.y, rect.y + rect.height - 1]) { wall(rect.x, y, door - rect.x, 1, name); wall(door + 2, y, rect.x + rect.width - door - 2, 1); }
    wall(rect.x, rect.y + 1, 1, rect.height - 2); wall(rect.x + rect.width - 1, rect.y + 1, 1, rect.height - 2);
  }
  const entrances = sideDoors ? [point(rect.x, door), point(rect.x + rect.width - 1, door)] : [point(door, rect.y), point(door, rect.y + rect.height - 1)];
  const floor = sideDoors ? point(rect.x + Math.floor(rect.width / 2), door) : point(door, rect.y + Math.floor(rect.height / 2));
  walls.push({ x: rect.x + rect.width - 2, y: rect.y + rect.height - 2, width: 1, height: 1, kind: 'barricade', label: kind === 'shop' ? 'Товарный прилавок' : kind === 'workshop' ? 'Рабочий верстак' : 'Хозяйственный шкаф' });
  return { building: { ...rect, id, name, kind, entrances }, walls, floor };
}
const compact = (points: LivePoint[]): LivePoint[] => points.filter((point, index) => !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
function circulation(plan: MetropolisParcelPlan): { main: LivePoint[]; court: Rect } {
  const { rect, axis, layout, access } = plan, along = axis === 'y' ? 'y' : 'x', cross = axis === 'y' ? 'x' : 'y';
  const length = axis === 'y' ? rect.height : rect.width, middle = rect[along] + Math.floor(length / 2);
  const at = (c: number, a: number): LivePoint => axis === 'y' ? point(c, a) : point(a, c);
  const main = compact([access[0], at(access[0][cross], middle), at(access[1][cross], middle), access[1]]);
  const crossStart = Math.min(access[0][cross], access[1][cross]) - 3, crossLength = Math.abs(access[0][cross] - access[1][cross]) + 6;
  const courtLength = layout === 'lane' ? length - 4 : layout === 'yard' ? Math.floor(length * .7) : layout === 'garden' ? Math.max(10, Math.floor(length * .4)) : Math.min(16, length - 4);
  const nearHigh = access[0][along] > access[1][along];
  const courtStart = layout === 'yard' ? nearHigh ? rect[along] + length - 2 - courtLength : rect[along] + 2
    : layout === 'garden' ? nearHigh ? rect[along] + 2 : rect[along] + length - 2 - courtLength : rect[along] + Math.floor((length - courtLength) / 2);
  const court = axis === 'y' ? { x: crossStart, y: courtStart, width: crossLength, height: courtLength } : { x: courtStart, y: crossStart, width: courtLength, height: crossLength };
  return { main, court };
}
function passageToFloor(main: LivePoint[], floor: LivePoint, vertical: boolean): LivePoint[] {
  const along = vertical ? 'y' : 'x';
  for (let index = 1; index < main.length; index++) {
    const a = main[index - 1]!, b = main[index]!;
    if (a[along] === b[along] || floor[along] < Math.min(a[along], b[along]) || floor[along] > Math.max(a[along], b[along])) continue;
    const branch = vertical ? point(a.x, floor.y) : point(floor.x, a.y);
    return compact([...main.slice(0, index), branch, floor, branch, ...main.slice(index)]);
  }
  throw new Error('Address floor has no courtyard access');
}
function houseSlots(plan: MetropolisParcelPlan, count: number, seed: string): Rect[] {
  const { rect, axis, layout, access } = plan, vertical = axis === 'y', along = vertical ? rect.height : rect.width;
  const cross0 = vertical ? rect.x : rect.y, crossLength = vertical ? rect.width : rect.height;
  const nearCross = vertical ? access[0].x : access[0].y, farCross = vertical ? access[1].x : access[1].y;
  const laneLo = Math.min(nearCross, farCross) - 3, laneHi = Math.max(nearCross, farCross) + 3;
  const maxSide = Math.floor((along - 3) / 6);
  const desired = layout === 'yard' ? count - 2 : Math.ceil(count / 2) + (layout === 'court' ? plan.slot % 2 ? 1 : -1 : layout === 'garden' ? 1 : 0);
  const leftCount = Math.max(count - maxSide, Math.min(maxSide, Math.max(1, Math.min(count - 1, desired))));
  const result: Rect[] = [];
  for (const [side, quantity] of [leftCount, count - leftCount].entries()) {
    const gap = along - 4 >= quantity * 5 + (quantity - 1) * 2 ? 2 : 1;
    const available = along - 4 - gap * (quantity - 1), extra = available - quantity * 5;
    const weights = Array.from({ length: quantity }, (_, index) => 1 + metropolisHash(seed + ':' + plan.id + ':' + side + ':' + index) % 5);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0), spans = weights.map(weight => 5 + Math.floor(extra * weight / totalWeight));
    for (let remaining = available - spans.reduce((sum, value) => sum + value, 0), index = 0; remaining > 0; remaining--, index++) spans[index % quantity]!++;
    let cursor = (vertical ? rect.y : rect.x) + 2;
    for (const span of spans) {
      const lo = side ? laneHi : cross0 + 2, hi = side ? cross0 + crossLength - 2 : laneLo;
      result.push(vertical ? { x: lo, y: cursor, width: hi - lo, height: span } : { x: cursor, y: lo, width: span, height: hi - lo });
      cursor += span + gap;
    }
  }
  return result;
}

/** New parcels are genuinely roomed addresses, rather than scaled-up scenery.
 * Opposite doors open onto a shared lane, with small service alleys between houses. */
export function generateMetropolisSites(seed: string): {
  sites: LiveCitySite[]; pois: LivePoi[]; obstacles: LiveObstacle[]; containers: LiveContainerAnchor[]; npcSpawns: LiveNpcSpawn[]; zones: LiveZone[]; paths: LiveLandscapePath[];
} {
  const sites: LiveCitySite[] = [], pois: LivePoi[] = [], obstacles: LiveObstacle[] = [], containers: LiveContainerAnchor[] = [], npcSpawns: LiveNpcSpawn[] = [], zones: LiveZone[] = [], paths: LiveLandscapePath[] = [];
  for (const plan of metropolisParcelPlan()) {
    const quarter = METROPOLIS_QUARTERS.find(quarter => quarter.id === plan.quarterId)!, { slot, rect, id } = plan, vertical = plan.axis === 'y';
    const street = streetNames[quarter.use][Math.floor(slot / 4)]!, name = `${street} · квартал ${slot + 1}`;
    const { main, court } = circulation(plan), ports = plan.access;
    const centre = point(court.x + Math.floor(court.width / 2), court.y + Math.floor(court.height / 2));
    const buildings: LiveCityBuilding[] = [], floors: LivePoint[] = [], houses = houseSlots(plan, quarter.buildings, seed);
    for (let address = 0; address < quarter.buildings; address++) {
      const house = houses[address]!, side = vertical ? house.x > court.x : house.y > court.y;
      const kind = kindFor(plan.use, address + slot), variant = metropolisHash(`${seed}:${id}:${address}`);
      // Keep the street/court setback, but vary the actual built frontage inside
      // its address slot. Workshops, row houses and service blocks read differently.
      const trimAlong = Math.min((variant >>> 4) % 2, (vertical ? house.height : house.width) - 5);
      const trimAcross = Math.min((variant >>> 7) % 3, (vertical ? house.width : house.height) - 5);
      if (vertical) { house.y += variant % 2 ? trimAlong : 0; house.height -= trimAlong; house.width -= trimAcross; if (!side) house.x += trimAcross; }
      else { house.x += variant % 2 ? trimAlong : 0; house.width -= trimAlong; house.height -= trimAcross; if (!side) house.y += trimAcross; }
      const buildingName = `${street}, ${1 + slot * 20 + address}`;
      const built = openBuilding(house, `${id}-building-${address}`, buildingName, kind, vertical);
      Object.assign(built.building, architecture(plan.use, kind, variant, house.height >= house.width));
      buildings.push(built.building); floors.push(built.floor); obstacles.push(...built.walls);
      const kinds = kind === 'shop' ? ['cabinet', 'crate', 'duffel'] as const : kind === 'workshop' || kind === 'garage' ? ['toolbox', 'crate', 'duffel'] as const : ['jacket', 'cabinet', 'duffel'] as const;
      const lootTable = kind === 'service' ? 'intel' : kind === 'workshop' || kind === 'garage' ? 'tools' : kind === 'shop' ? 'provisions' : 'mixed';
      containers.push({ ...built.floor, id: `${id}-address-${address}-search`, poiId: id, kind: kinds[address % 3]!, lootTable, searchMs: 3000 + address % 3 * 500 });
    }
    const passages = [main, passageToFloor(main, floors[0]!, vertical), passageToFloor(main, floors.at(-1)!, vertical)];
    const use = plan.use, industrial = use === 'works' || use === 'port' || use === 'station';
    const kind: LiveCitySite['kind'] = industrial ? 'workyard' : use === 'market' ? 'arcade' : use === 'civic' || use === 'campus' ? 'service-yard' : 'courtyard';
    const danger: 2 | 3 = industrial && slot % 4 === 1 || use === 'market' && slot % 4 === 2 ? 3 : 2;
    pois.push({ ...rect, id, name, templateId: `city-${kind}`, districtId: districtOf(centre), danger, entrances: ports,
      tags: ['city', 'city-site', 'metropolis', `metro-use:${use}`, kind, 'search', 'visit', 'quests', ...(danger === 3 ? ['contested'] : ['urban'])] });
    sites.push({ ...rect, id, poiId: id, quarterId: quarter.id, name, kind, courtyard: court, buildings, passages });
    zones.push({ ...rect, name, terrain: industrial ? 'yard' : use === 'garden' || use === 'park' ? 'grass' : 'concrete', danger });
    containers.push({ ...centre, id: `${id}-courtyard-search`, poiId: id, kind: 'duffel', lootTable: 'mixed', searchMs: 3000 });
    const home = vertical ? point(centre.x + 1, centre.y) : point(centre.x, centre.y + 1);
    npcSpawns.push({ point: home, faction: industrial ? 'raiders' : 'scavs', role: slot % 3 ? 'patrol' : 'guard', route: [home, ports[0]!, ports[1]!, home] });
    paths.push({ id: `metro-frontage-${id}`, name: `${street}: проход двора`, kind: 'trail', width: 2, points: main });
  }
  return { sites, pois, obstacles, containers, npcSpawns, zones, paths };
}
