import type { LiveCityBuilding, LiveCitySite, LiveContainerAnchor, LiveDistrictId, LiveLandscapePath, LiveObstacle, LivePoi, LivePoint, LiveZone } from './live';
import type { LiveNpcSpawn } from './live-maps';
import { METROPOLIS_QUARTERS, metropolisHash, type MetropolisQuarter, type MetropolisUse } from './world-metropolis-plan';

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
  walls.push({ x: rect.x + 1, y: rect.y + 1, width: 1, height: 1, kind: 'barricade', label: kind === 'shop' ? 'Товарный прилавок' : kind === 'workshop' ? 'Рабочий верстак' : 'Хозяйственный шкаф' });
  return { building: { ...rect, id, name, kind, entrances }, walls, floor };
}
function parcel(quarter: MetropolisQuarter, slot: number): Rect {
  if (quarter.band === 'north' || quarter.band === 'south') {
    const column = slot % 4, row = Math.floor(slot / 4), waterfront = quarter.x === 704 && column === 0;
    return { x: quarter.x + column * 48 + (waterfront ? 12 : 6), y: (quarter.band === 'north' ? 136 : 784) + row * 60, width: waterfront ? 30 : 36, height: 44 };
  }
  return { x: (quarter.band === 'west' ? 136 : 784) + slot % 2 * 60, y: quarter.y + Math.floor(slot / 2) * 36 + 4, width: 44, height: 28 };
}

/** New parcels are genuinely roomed addresses, rather than scaled-up scenery.
 * Opposite doors open onto a shared lane, with small service alleys between houses. */
export function generateMetropolisSites(seed: string): {
  sites: LiveCitySite[]; pois: LivePoi[]; obstacles: LiveObstacle[]; containers: LiveContainerAnchor[]; npcSpawns: LiveNpcSpawn[]; zones: LiveZone[]; paths: LiveLandscapePath[];
} {
  const sites: LiveCitySite[] = [], pois: LivePoi[] = [], obstacles: LiveObstacle[] = [], containers: LiveContainerAnchor[] = [], npcSpawns: LiveNpcSpawn[] = [], zones: LiveZone[] = [], paths: LiveLandscapePath[] = [];
  for (const quarter of METROPOLIS_QUARTERS) for (let slot = 0; slot < 8; slot++) {
    const rect = parcel(quarter, slot), vertical = rect.height >= rect.width, id = `${quarter.id}-block-${slot}`;
    const street = streetNames[quarter.use][Math.floor(slot / 4)]!, name = `${street} · квартал ${slot + 1}`;
    const centre = point(rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2));
    const ports = vertical ? [point(centre.x, rect.y), point(centre.x, rect.y + rect.height - 1)] : [point(rect.x, centre.y), point(rect.x + rect.width - 1, centre.y)];
    const court: Rect = vertical ? { x: centre.x - 4, y: rect.y + 2, width: 8, height: rect.height - 4 } : { x: rect.x + 2, y: centre.y - 4, width: rect.width - 4, height: 8 };
    const buildings: LiveCityBuilding[] = [], floors: LivePoint[] = [], rows = Math.ceil(quarter.buildings / 2), span = vertical ? rect.height : rect.width;
    const along = Math.floor((span - 6 - (rows - 1) * 2) / rows), across = Math.floor(((vertical ? rect.width : rect.height) - 14) / 2);
    for (let address = 0; address < quarter.buildings; address++) {
      const row = Math.floor(address / 2), side = address % 2;
      const house = vertical
        ? { x: side ? centre.x + 4 : rect.x + 3, y: rect.y + 3 + row * (along + 2), width: across, height: along }
        : { x: rect.x + 3 + row * (along + 2), y: side ? centre.y + 4 : rect.y + 3, width: along, height: across };
      const kind = kindFor(quarter.use, address + slot), variant = metropolisHash(`${seed}:${id}:${address}`);
      // Keep the street/court setback, but vary the actual built frontage inside
      // its address slot. Workshops, row houses and service blocks read differently.
      const trimAlong = Math.min((variant >>> 4) % 3, (vertical ? house.height : house.width) - 8);
      const trimAcross = Math.min((variant >>> 7) % 3, (vertical ? house.width : house.height) - 6);
      if (vertical) { house.y += variant % 2 ? trimAlong : 0; house.height -= trimAlong; house.width -= trimAcross; if (!side) house.x += trimAcross; }
      else { house.x += variant % 2 ? trimAlong : 0; house.width -= trimAlong; house.height -= trimAcross; if (!side) house.y += trimAcross; }
      const buildingName = `${street}, ${1 + slot * 20 + address}`;
      const built = openBuilding(house, `${id}-building-${address}`, buildingName, kind, vertical);
      Object.assign(built.building, architecture(quarter.use, kind, variant, house.height >= house.width));
      buildings.push(built.building); floors.push(built.floor); obstacles.push(...built.walls);
      const kinds = kind === 'shop' ? ['cabinet', 'crate', 'duffel'] as const : kind === 'workshop' || kind === 'garage' ? ['toolbox', 'crate', 'duffel'] as const : ['jacket', 'cabinet', 'duffel'] as const;
      const lootTable = kind === 'service' ? 'intel' : kind === 'workshop' || kind === 'garage' ? 'tools' : kind === 'shop' ? 'provisions' : 'mixed';
      containers.push({ ...built.floor, id: `${id}-address-${address}-search`, poiId: id, kind: kinds[address % 3]!, lootTable, searchMs: 3000 + address % 3 * 500 });
    }
    const toInterior = (floor: LivePoint): LivePoint[] => vertical
      ? [ports[0]!, point(centre.x, floor.y), floor, point(centre.x, floor.y), ports[1]!]
      : [ports[0]!, point(floor.x, centre.y), floor, point(floor.x, centre.y), ports[1]!];
    const passages = [[ports[0]!, ports[1]!], toInterior(floors[0]!), toInterior(floors.at(-1)!)];
    const use = quarter.use, industrial = use === 'works' || use === 'port' || use === 'station';
    const kind: LiveCitySite['kind'] = industrial ? 'workyard' : use === 'market' ? 'arcade' : use === 'civic' || use === 'campus' ? 'service-yard' : 'courtyard';
    const danger: 2 | 3 = industrial && slot % 4 === 1 || use === 'market' && slot % 4 === 2 ? 3 : 2;
    pois.push({ ...rect, id, name, templateId: `city-${kind}`, districtId: districtOf(centre), danger, entrances: ports,
      tags: ['city', 'city-site', 'metropolis', `metro-use:${use}`, kind, 'search', 'visit', 'quests', ...(danger === 3 ? ['contested'] : ['urban'])] });
    sites.push({ ...rect, id, poiId: id, quarterId: quarter.id, name, kind, courtyard: court, buildings, passages });
    zones.push({ ...rect, name, terrain: industrial ? 'yard' : use === 'garden' || use === 'park' ? 'grass' : 'concrete', danger });
    containers.push({ ...centre, id: `${id}-courtyard-search`, poiId: id, kind: 'duffel', lootTable: 'mixed', searchMs: 3000 });
    const home = vertical ? point(centre.x + 1, centre.y) : point(centre.x, centre.y + 1);
    npcSpawns.push({ point: home, faction: industrial ? 'raiders' : 'scavs', role: slot % 3 ? 'patrol' : 'guard', route: [home, ports[0]!, ports[1]!, home] });
    const access = vertical
      ? [point(ports[0]!.x, rect.y - 8), ports[0]!, ports[1]!, point(ports[1]!.x, rect.y + rect.height + 8)]
      : [point(rect.x - 8, ports[0]!.y), ports[0]!, ports[1]!, point(rect.x + rect.width + 8, ports[1]!.y)];
    paths.push({ id: `metro-frontage-${id}`, name: `${street}: проход двора`, kind: 'trail', width: 2, points: access });
  }
  return { sites, pois, obstacles, containers, npcSpawns, zones, paths };
}
