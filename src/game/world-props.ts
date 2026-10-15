import type { LiveCitySite, LiveContainerAnchor, LiveDistrict, LiveObstacle, LivePoi, LivePoint, LiveWorld, LiveWorldProp } from './live';
import { legacyHallEnvelopes } from './world-building-envelope';

type Rect = LivePoint & { width: number; height: number };
type PropKind = LiveWorldProp['kind'];
type SceneryWorld = Pick<LiveWorld, 'width' | 'height' | 'terrainRows' | 'paths' | 'obstacles' | 'extracts' | 'city'> & {
  districts: LiveDistrict[]; pois: LivePoi[]; citySites: LiveCitySite[]; containers: LiveContainerAnchor[];
  npcSpawns: Array<{ point: LivePoint; route: LivePoint[] }>;
};
const hash = (value: string): number => { let result = 2166136261; for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619); return result >>> 0; };
const inside = (p: LivePoint, r: Rect) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
const solidKinds = new Set<PropKind>(['car', 'van', 'truck', 'bus', 'dumpster', 'pallet', 'crate', 'shed', 'railcar', 'transformer', 'kiosk']);
const sizes: Partial<Record<PropKind, [number, number]>> = {
  car: [3, 1], van: [3, 2], truck: [4, 2], bus: [5, 2], railcar: [6, 2], shed: [3, 3], kiosk: [2, 2],
  dumpster: [2, 1], pallet: [1, 1], crate: [1, 1], transformer: [2, 2], tree: [1.8, 1.8], shrub: [1, 1],
  bench: [1.5, .6], lamp: [.35, .35], 'power-pole': [.4, .4], bollard: [.3, .3], hydrant: [.35, .35], sign: [.5, .5],
  garden: [2.5, 1.5], playground: [2, 2], 'market-stall': [2, 1.5], logs: [2, 1], fence: [2, .2],
  planter: [1, 1], workbench: [1.5, .6], barrel: [.7, .7],
};
const labels: Partial<Record<PropKind, string>> = { car: 'Припаркованная машина', van: 'Фургон', truck: 'Грузовик', bus: 'Автобус', dumpster: 'Мусорный контейнер', pallet: 'Паллеты', crate: 'Транспортная тара', shed: 'Хозяйственная постройка', railcar: 'Грузовой вагон', transformer: 'Трансформатор', kiosk: 'Киоск' };

/** Authored use of space drives decoration. Physical cover always leaves a clear detour. */
export function generateWorldProps(world: SceneryWorld, seed: string, options: { exclude?: Rect; budget?: number; idPrefix?: string; organicGreenery?: boolean } = {}): { props: LiveWorldProp[]; obstacles: LiveObstacle[] } {
  const { width, height } = world, total = width * height;
  const budget = Math.max(0, Math.min(16384, Math.floor(options.budget ?? 6000)));
  const physical = new Uint8Array(total), occupied = new Uint8Array(total), reserved = new Uint8Array(total), interiors = new Uint8Array(total);
  const props: LiveWorldProp[] = [], obstacles: LiveObstacle[] = [];
  const cells = (rect: Rect, visit: (index: number) => void, margin = 0): void => {
    for (let y = Math.max(0, Math.floor(rect.y - margin)); y < Math.min(height, Math.ceil(rect.y + rect.height + margin)); y++)
      for (let x = Math.max(0, Math.floor(rect.x - margin)); x < Math.min(width, Math.ceil(rect.x + rect.width + margin)); x++) visit(y * width + x);
  };
  world.obstacles.forEach(rect => cells(rect, index => { physical[index] = 1; }));
  world.citySites.flatMap(site => site.buildings).forEach(rect => cells(rect, index => { interiors[index] = 1; }));
  const legacyHalls = legacyHallEnvelopes(world);
  legacyHalls.forEach(rect => cells(rect, index => { interiors[index] = 1; }));
  const protect = (point: LivePoint, radius: number): void => cells({ x: point.x - radius, y: point.y - radius, width: radius * 2 + 1, height: radius * 2 + 1 }, index => { reserved[index] = 1; });
  world.extracts.forEach(point => protect(point, 4));
  world.districts.flatMap(district => district.spawns).forEach(point => protect(point, 4));
  world.containers.forEach(point => protect(point, 1));
  world.pois.flatMap(poi => poi.entrances).forEach(point => protect(point, 1));
  world.citySites.flatMap(site => site.buildings.flatMap(building => building.entrances)).forEach(point => protect(point, 1));
  legacyHalls.flatMap(hall => hall.entrances).forEach(point => protect(point, 1));
  const protectLine = (a: LivePoint, b: LivePoint, radius: number): void => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let step = 0; step <= steps; step++) protect({ x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps }, radius);
  };
  for (const site of world.citySites) for (const passage of site.passages) for (let i = 1; i < passage.length; i++) protectLine(passage[i - 1]!, passage[i]!, 1);
  // Some paved access lanes intentionally retain concrete/yard colour. Their
  // declared centre lines remain routes even when they are not rasterised 'p'.
  for (const path of world.paths ?? []) if (path.kind !== 'river') for (let i = 1; i < path.points.length; i++) protectLine(path.points[i - 1]!, path.points[i]!, 0);
  for (const spawn of world.npcSpawns) { protect(spawn.point, 1); spawn.route.forEach(point => protect(point, 1)); }
  const material = (x: number, y: number): string => world.terrainRows?.[Math.floor(y)]?.[Math.floor(x)] ?? 'g';
  const transport = (code: string) => code === 'r' || code === 't' || code === 'p' || code === 'w';
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (transport(material(x, y))) reserved[y * width + x] = 1;
  const fixtureSpacing: Partial<Record<PropKind, number>> = { lamp: 7, 'power-pole': 18, sign: 12, bench: 6, hydrant: 15, playground: 24, transformer: 12 };
  const fixtures = new Map<PropKind, LivePoint[]>();

  const add = (kind: PropKind, x: number, y: number, orientation: 'x' | 'y', source: string, indoor = false): boolean => {
    const [long, short] = sizes[kind] ?? [1, 1], w = orientation === 'x' ? long : short, h = orientation === 'x' ? short : long;
    const blocking = solidKinds.has(kind) && !indoor;
    const rect = { x: blocking ? Math.round(x) : Math.round(x * 4) / 4, y: blocking ? Math.round(y) : Math.round(y * 4) / 4, width: w, height: h };
    if (rect.x < 2 || rect.y < 2 || rect.x + w >= width - 2 || rect.y + h >= height - 2 || props.length >= budget
      || options.exclude && rect.x < options.exclude.x + options.exclude.width && rect.y < options.exclude.y + options.exclude.height && rect.x + w > options.exclude.x && rect.y + h > options.exclude.y) return false;
    const spacing = indoor ? 0 : fixtureSpacing[kind] ?? 0;
    if (spacing && fixtures.get(kind)?.some(point => Math.hypot(point.x - rect.x, point.y - rect.y) < spacing)) return false;
    let suitable = true;
    cells(rect, index => { if (physical[index] || occupied[index] || reserved[index] || !indoor && interiors[index]) suitable = false; });
    // A full one-cell free ring proves that a new solid rectangle cannot seal any walkable component.
    if (blocking) cells(rect, index => { if (physical[index] || interiors[index]) suitable = false; }, 1);
    if (!suitable) return false;
    const id = `${options.idPrefix ?? 'prop'}-${source}-${props.length}`, variant = hash(`${seed}:${source}:${x}:${y}`) % 4;
    props.push({ ...rect, id, kind, orientation, variant, blocking });
    if (spacing) { const placed = fixtures.get(kind) ?? []; placed.push(rect); fixtures.set(kind, placed); }
    cells(rect, index => { occupied[index] = 1; if (blocking) physical[index] = 1; });
    if (blocking) obstacles.push({ ...rect, kind: kind === 'shed' || kind === 'kiosk' ? 'building' : 'container', label: labels[kind], propId: id });
    return true;
  };
  const quarterOf = (rect: Rect) => world.city?.quarters.find(quarter => inside(rect, quarter))?.id;
  const useOf = (poi: LivePoi): 'center' | 'industry' | 'station' | 'homes' | 'forest' => {
    const use = poi.tags.find(tag => tag.startsWith('metro-use:'))?.slice(10);
    if (use === 'works' || use === 'port') return 'industry';
    if (use === 'station') return 'station';
    if (use === 'market' || use === 'civic' || use === 'campus') return 'center';
    const quarter = quarterOf(poi);
    if (quarter) return quarter === 'old-center' ? 'center' : quarter === 'industrial' ? 'industry' : quarter === 'station' ? 'station' : 'homes';
    return poi.districtId === 'customs' ? 'industry' : poi.districtId === 'sawmill' ? 'forest' : poi.districtId === 'depot' ? 'station' : 'homes';
  };
  const profiles: Record<ReturnType<typeof useOf>, PropKind[]> = {
    center: ['bench', 'planter', 'car', 'kiosk', 'sign', 'dumpster', 'market-stall', 'lamp', 'hydrant', 'bollard'],
    industry: ['truck', 'van', 'pallet', 'crate', 'barrel', 'transformer', 'dumpster', 'workbench'],
    station: ['van', 'bus', 'pallet', 'sign', 'bench', 'lamp', 'dumpster'],
    homes: ['car', 'garden', 'planter', 'playground', 'bench', 'shed', 'shrub', 'fence'],
    forest: ['logs', 'truck', 'barrel', 'shed', 'workbench', 'power-pole', 'shrub', 'fence'],
  };
  // Park freight on parallel dead-end tracks. The declared through siding remains
  // clear, and wagons take their places before smaller loading-yard fixtures.
  for (const siding of world.paths ?? []) {
    if (siding.kind !== 'rail' || !siding.id.startsWith('siding-')) continue;
    let parked = 0;
    for (let segment = 1; segment < siding.points.length && parked < 2; segment++) {
      const a = siding.points[segment - 1]!, b = siding.points[segment]!, dx = b.x - a.x, dy = b.y - a.y;
      if (Math.hypot(dx, dy) < 4) continue;
      const orientation = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      for (const along of [.15, .35, .5, .65, .85]) for (const offset of [4, -4, 6, -6, 8, -8, 10, -10]) {
        if (parked >= 2) break;
        const center = { x: a.x + dx * along + (orientation === 'y' ? offset : 0), y: a.y + dy * along + (orientation === 'x' ? offset : 0) };
        if (!add('railcar', center.x - (orientation === 'x' ? 3 : 1), center.y - (orientation === 'x' ? 1 : 3), orientation, siding.id)) continue;
        parked++;
        const wagon = props[props.length - 1]!;
        // Ballast and rails continue past each coupler without replacing a road,
        // footway, water or an existing building surface.
        const spur = { x: wagon.x - (orientation === 'x' ? 2 : 0), y: wagon.y - (orientation === 'y' ? 2 : 0), width: wagon.width + (orientation === 'x' ? 4 : 0), height: wagon.height + (orientation === 'y' ? 4 : 0) };
        cells(spur, index => {
          const x = index % width, y = Math.floor(index / width), row = world.terrainRows?.[y];
          if (!row || interiors[index] || reserved[index] || physical[index] && !inside({ x, y }, wagon)) return;
          world.terrainRows![y] = row.slice(0, x) + 't' + row.slice(x + 1);
          reserved[index] = 1;
        });
      }
    }
  }
  // Loading yards, station aprons and inhabited courtyards use different object vocabularies.
  for (const poi of world.pois) {
    const profile = profiles[useOf(poi)];
    const limits: Partial<Record<PropKind, number>> = { playground: 1, garden: 2, shed: 1, kiosk: 1, transformer: 1, 'power-pole': 1, fence: 3, 'market-stall': 2, dumpster: 1, car: 3, truck: 2, bus: 1 };
    const localCounts = new Map<PropKind, number>();
    let placed = 0;
    for (let y = poi.y + 1; y < poi.y + poi.height - 1; y += 2) for (let x = poi.x + 1; x < poi.x + poi.width - 1; x += 2) {
      const roll = hash(`${seed}:${poi.id}:${x}:${y}`), kind = profile[roll % profile.length]!;
      if (placed >= (poi.tags.includes('city-site') ? 18 : 24) || interiors[y * width + x]) continue;
      if ((localCounts.get(kind) ?? 0) >= (limits[kind] ?? 6)) continue;
      const vehicle = ['car', 'van', 'truck', 'bus', 'railcar'].includes(kind);
      const edge = Math.min(x - poi.x, y - poi.y, poi.x + poi.width - x, poi.y + poi.height - y);
      if (vehicle && edge > 4) continue;
      if (vehicle && !['c', 'y'].includes(material(x, y))) continue;
      // Parking and freight rows align with their long frontage; fixtures follow the same service apron.
      if (add(kind, x, y, poi.width >= poi.height ? 'x' : 'y', poi.id)) { placed++; localCounts.set(kind, (localCounts.get(kind) ?? 0) + 1); }
    }
  }
  // Furniture sits beside interior circulation, so a room no longer reads as an empty shell.
  for (const site of world.citySites) for (const building of site.buildings) {
    const kinds: PropKind[] = building.kind === 'workshop' || building.kind === 'garage' ? ['workbench', 'pallet', 'barrel'] : building.kind === 'shop' ? ['market-stall', 'crate', 'planter'] : ['bench', 'planter', 'crate'];
    let placed = 0;
    for (let y = building.y + 1; y < building.y + building.height - 1 && placed < 3; y++) for (let x = building.x + 1; x < building.x + building.width - 1 && placed < 3; x++)
      if (add(kinds[placed % kinds.length]!, x, y, 'x', building.id, true)) placed++;
  }
  // Urban lamps stand along pavements. Rural power lines use one verge and much
  // longer spans; roads do not acquire random parked cars or benches in fields.
  for (const path of world.paths ?? []) {
    if (path.kind !== 'road') continue;
    let length = 0, next = 4;
    for (let segment = 1; segment < path.points.length; segment++) {
      const a = path.points[segment - 1]!, b = path.points[segment]!, dx = b.x - a.x, dy = b.y - a.y, span = Math.hypot(dx, dy);
      if (!span) continue;
      while (next <= length + span) {
        const ratio = (next - length) / span, center = { x: a.x + dx * ratio, y: a.y + dy * ratio };
        const urban = !!world.city && inside(center, world.city), verge = path.width / 2 + 1.5;
        const sides = urban ? [-1, 1] : [1];
        for (const side of sides) {
          const x = center.x - dy / span * verge * side, y = center.y + dx / span * verge * side;
          if (urban && !['c', 'y'].includes(material(x, y))) continue;
          add(urban ? 'lamp' : 'power-pole', x, y, Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y', `frontage-${path.id}`);
        }
        next += urban ? 9 : 22;
      }
      length += span;
    }
  }
  // Dense, coherent groves follow the forest raster; urban greenery fills free garden ground.
  let greeneryWeight = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const code = material(x, y);
    if (code === 'f') greeneryWeight += 6 / 7;
    else if (code === 'g') greeneryWeight += world.city && inside({ x, y }, world.city) ? 1 / 3 : 1 / 6;
  }
  // Budget the complete landscape before visiting any region. A bigger forest
  // cannot consume the wire cap and leave the last district without its trees.
  const greeneryStep = Math.max(3, Math.ceil(Math.sqrt(greeneryWeight / Math.max(500, budget - 500 - props.length))));
  for (let y = 3; y < height - 3; y += greeneryStep) for (let x = 3; x < width - 3; x += greeneryStep) {
    const roll = hash(`${seed}:greenery:${x}:${y}`);
    // Stratified candidates retain the same bounded budget, but each patch has
    // its own position and broad density. Forest edges no longer form rows.
    const px = options.organicGreenery ? x + (((roll >>> 8) % 101) / 100 - .5) * greeneryStep * .85 : x;
    const py = options.organicGreenery ? y + (((roll >>> 16) % 101) / 100 - .5) * greeneryStep * .85 : y;
    const code = material(px, py), urban = !!world.city && inside({ x: px, y: py }, world.city);
    const cluster = !options.organicGreenery || Math.sin(px / 17) + Math.cos(py / 23) + Math.sin((px - py) / 31) > -1.2;
    if (!cluster) continue;
    if (code === 'f' && roll % 7 !== 0) add(roll % 5 === 0 ? 'shrub' : 'tree', px + (roll % 5 - 2) / 4, py + (Math.floor(roll / 5) % 5 - 2) / 4, 'x', 'grove');
    else if (code === 'g' && (urban ? roll % 3 === 0 : roll % 6 === 0)) add(roll % 4 === 0 ? 'tree' : 'shrub', px, py, 'x', urban ? 'garden' : 'hedge');
  }
  return { props, obstacles };
}
