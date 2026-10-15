import type { LiveContainerAnchor, LiveDistrict, LiveLandscapePath, LiveObstacle, LivePoint, LivePoi, LiveWorldRoute } from './live';
import type { LiveMapDefinition } from './live-maps';
import { generateWorldProps } from './world-props';
import { LIVE_WORLD_LIMITS } from './live-world-limits';
import { generateMetropolisSites } from './world-metropolis-sites';
import { METROPOLIS_CITY, METROPOLIS_CORE, METROPOLIS_CORE_SHIFT, METROPOLIS_QUARTERS, METROPOLIS_SIZE, inMetropolisCore, metropolisHash, metropolisStreetPlan } from './world-metropolis-plan';

/** Translate the live core itself, never a stored snapshot or a second generator.
 * Shared point objects are visited once so a passage/door alias cannot shift twice. */
function translatedCore(core: LiveMapDefinition): LiveMapDefinition {
  const result = structuredClone(core), seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.x === 'number' && typeof record.y === 'number') { record.x += METROPOLIS_CORE_SHIFT; record.y += METROPOLIS_CORE_SHIFT; }
    Object.values(record).forEach(visit);
  };
  visit(result); return result;
}

function expandedDistricts(core: readonly LiveDistrict[]): LiveDistrict[] {
  return core.map((district, index) => ({ ...district, x: index % 2 * 512, y: Math.floor(index / 2) * 512, width: 512, height: 512,
    spawns: [...district.spawns, { x: index % 2 ? 1005 : 18, y: index < 2 ? 188 : 836 }, { x: index % 2 ? 836 : 188, y: index < 2 ? 18 : 1005 }] }));
}
function riverExtensions(core: LiveMapDefinition): LiveLandscapePath[] {
  return (core.paths ?? []).filter(path => path.kind === 'river').flatMap(path => {
    const first = path.points[0]!, last = path.points.at(-1)!;
    return [
      { id: `metro-${path.id}-north`, name: 'Северная река и портовая набережная', kind: 'river' as const, width: path.width,
        points: [{ x: first.x + 18, y: 0 }, { x: first.x - 9, y: 58 }, { x: first.x, y: 128 }, { x: first.x, y: 255 }] },
      { id: `metro-${path.id}-south`, name: 'Южная река и садовая набережная', kind: 'river' as const, width: path.width,
        points: [{ x: last.x, y: 768 }, { x: last.x, y: 896 }, { x: last.x + 14, y: 950 }, { x: last.x - 8, y: 1023 }] },
    ];
  });
}
const parks = [
  { id: 'metro-linden-park', name: 'Липовый парк', x: 136, y: 268, width: 104, height: 88, districtId: 'customs' as const },
  { id: 'metro-riverside-park', name: 'Парк у набережной', x: 784, y: 268, width: 104, height: 88, districtId: 'sawmill' as const },
  { id: 'metro-south-gardens', name: 'Южные общественные сады', x: 784, y: 668, width: 104, height: 88, districtId: 'village' as const },
];

function landscape(core: LiveMapDefinition, additions: ReturnType<typeof generateMetropolisSites>, seed: string): { terrainRows: string[]; paths: LiveLandscapePath[]; water: LiveObstacle[] } {
  const width = METROPOLIS_SIZE, ground = new Uint8Array(width * width), code = (value: string) => value.charCodeAt(0);
  const phase = metropolisHash(seed) / 0xffffffff * Math.PI * 2;
  // A broad forest/meadow structure surrounds the built city rather than a
  // repeated empty grass border. Finer trees are supplied by bounded scenery.
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const grove = Math.sin(x / 61 + phase) + Math.cos(y / 83) + Math.sin((x + y) / 127 + phase);
    ground[y * width + x] = code(grove > -.65 ? 'f' : 'g');
  }
  const fill = (rect: { x: number; y: number; width: number; height: number }, material: string): void => {
    for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(width, Math.ceil(rect.y + rect.height)); y++) for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(width, Math.ceil(rect.x + rect.width)); x++) {
      if (!inMetropolisCore(x, y)) ground[y * width + x] = code(material);
    }
  };
  for (const quarter of METROPOLIS_QUARTERS) fill(quarter, ['works', 'port', 'station'].includes(quarter.use) ? 'y' : ['civic', 'campus', 'market'].includes(quarter.use) ? 'c' : 'g');
  const line = (a: LivePoint, b: LivePoint, radius: number, material: string): void => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let step = 0; step <= steps; step++) {
      const cx = a.x + (b.x - a.x) * step / steps, cy = a.y + (b.y - a.y) * step / steps;
      for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(width - 1, Math.ceil(cy + radius)); y++) for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, Math.ceil(cx + radius)); x++) {
        if (!inMetropolisCore(x, y) && Math.hypot(x - cx, y - cy) <= radius) ground[y * width + x] = code(material);
      }
    }
  };
  const drawPath = (path: LiveLandscapePath, material: string, shoulder = 0): void => {
    for (let index = 1; index < path.points.length; index++) line(path.points[index - 1]!, path.points[index]!, path.width / 2 + shoulder, material);
  };
  const rivers = riverExtensions(core), streets = metropolisStreetPlan();
  for (const river of rivers) { drawPath(river, 's', 3); drawPath(river, 'w'); }
  for (const street of streets) { drawPath(street, 'c', 1.5); drawPath(street, 'r'); }
  for (const site of additions.sites) {
    const quarter = METROPOLIS_QUARTERS.find(quarter => quarter.id === site.quarterId)!;
    const hard = ['works', 'port', 'station', 'market', 'civic'].includes(quarter.use);
    fill(site, hard ? 'y' : 'g');
    fill(site.courtyard, hard ? 'c' : 'p');
    for (const building of site.buildings) { fill({ x: building.x - 1, y: building.y - 1, width: building.width + 2, height: building.height + 2 }, 'c'); fill(building, 'c'); }
  }
  for (const frontage of additions.paths) drawPath(frontage, 'p');
  const parkPaths: LiveLandscapePath[] = [];
  for (const park of parks) {
    fill(park, 'g');
    const centre = { x: park.x + park.width / 2, y: park.y + park.height / 2 };
    parkPaths.push({ id: `${park.id}-walk`, name: `${park.name}: аллеи`, kind: 'trail', width: 2,
      points: [{ x: park.x - 8, y: centre.y }, { x: park.x + 18, y: centre.y }, { x: centre.x, y: park.y + 24 }, { x: park.x + park.width - 18, y: centre.y }, { x: park.x + park.width + 8, y: centre.y }] });
  }
  for (const path of parkPaths) drawPath(path, 'p');
  // The old through rail enters from the western core edge. New sidings are
  // outside it and do not consume an older container, entrance or reserved lane.
  const railEnd = core.paths?.find(path => path.id === 'rail-freight')?.points[0] ?? { x: 257, y: 712 };
  const rails: LiveLandscapePath[] = [
    { id: 'metro-rail-west', name: 'Западная грузовая магистраль', kind: 'rail', width: 2, points: [{ x: 1, y: railEnd.y }, { x: 255, y: railEnd.y }] },
    { id: 'metro-rail-station', name: 'Новая сортировочная ветка', kind: 'rail', width: 2, points: [{ x: 116, y: railEnd.y }, { x: 116, y: 518 }] },
    ...[0, 1, 2].map(index => ({ id: `siding-metro-freight-${index}`, name: 'Грузовая ветка нового товарного двора', kind: 'rail' as const, width: 2,
      points: [{ x: 116, y: 680 + index * 12 }, { x: 232, y: 680 + index * 12 }] })),
  ];
  fill({ x: 132, y: 664, width: 108, height: 92 }, 'y');
  for (const path of rails) drawPath(path, 't');
  // River walks make the canal frontage readable. Road crossings remain bridges.
  const riverWalks: LiveLandscapePath[] = rivers.flatMap((river, index) => {
    const x = river.points[index ? 0 : river.points.length - 1]!.x;
    return [-8, 8].map(side => ({ id: `${river.id}-walk-${side}`, name: 'Речная набережная', kind: 'trail' as const, width: 1.5,
      points: [{ x: x + side, y: index ? 784 : 136 }, { x: x + side, y: index ? 888 : 240 }] }));
  });
  for (const path of riverWalks) drawPath(path, 'p');
  // Preserve every native core terrain cell exactly, including bridges and banks.
  for (let y = 0; y < 512; y++) {
    const row = core.terrainRows![y]!;
    for (let x = 0; x < 512; x++) ground[(y + 256) * width + x + 256] = row.charCodeAt(x);
  }
  const water: LiveObstacle[] = [], terrainRows: string[] = [], decoder = new TextDecoder();
  for (let y = 0; y < width; y++) {
    terrainRows.push(decoder.decode(ground.subarray(y * width, (y + 1) * width)));
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const wet = x < width && !inMetropolisCore(x, y) && ground[y * width + x] === code('w');
      if (wet && start < 0) start = x;
      if (!wet && start >= 0) { water.push({ x: start, y, width: x - start, height: 1, kind: 'water', label: 'Река' }); start = -1; }
    }
  }
  return { terrainRows, water, paths: [...streets, ...additions.paths, ...parkPaths, ...rails, ...rivers, ...riverWalks] };
}

function metropolisRoutes(core: readonly LiveWorldRoute[], pois: readonly LivePoi[]): LiveWorldRoute[] {
  const metro = pois.filter(poi => poi.tags.includes('metropolis'));
  const centre = (poi: LivePoi): LivePoint => ({ x: poi.x + poi.width / 2, y: poi.y + poi.height / 2 });
  return core.map(route => {
    const local = metro.filter(poi => poi.districtId === route.districtId);
    const preferred = local.filter(poi => route.purpose === 'pvp' ? poi.danger === 3 : route.purpose === 'pve' ? poi.tags.some(tag => tag === 'metro-use:works' || tag === 'metro-use:port' || tag === 'metro-use:station')
      : route.purpose === 'loot' ? poi.tags.some(tag => tag === 'metro-use:market' || tag === 'metro-use:civic' || tag === 'metro-use:housing' || tag === 'metro-use:campus' || tag === 'metro-use:waterfront') : true);
    const candidates = preferred.length >= 2 ? preferred : local;
    const chosen: LivePoi[] = [];
    for (const poi of candidates) if (!chosen.some(previous => previous.tags.find(tag => tag.startsWith('metro-use:')) === poi.tags.find(tag => tag.startsWith('metro-use:')))) chosen.push(poi);
    if (chosen.length < 2) chosen.push(...candidates.filter(poi => !chosen.includes(poi)).sort((a, b) => Math.hypot(centre(b).x - centre(candidates[0]!).x, centre(b).y - centre(candidates[0]!).y) - Math.hypot(centre(a).x - centre(candidates[0]!).x, centre(a).y - centre(candidates[0]!).y)).slice(0, 2 - chosen.length));
    const ids = [...route.poiIds.slice(0, 1), ...chosen.slice(0, 2).map(poi => poi.id), ...route.poiIds.slice(-1)];
    return { ...route, name: route.name.replace('Окраина и город', 'Торговые улицы большого города'),
      description: `${route.description} Новые направления проходят через районы большого Ольховска.`.slice(0, 240), poiIds: [...new Set(ids)].slice(0, 5) };
  });
}

/** The preserved authored core is embedded at +256; all new solid ground belongs
 * to the surrounding metropolis. Durable public identities are carried verbatim. */
export function generateMetropolis(core: LiveMapDefinition): LiveMapDefinition {
  if (core.width !== 512 || core.height !== 512 || !core.terrainRows || core.terrainRows.length !== 512) throw new Error('Metropolis requires the complete 512-cell perimeter core');
  const shifted = translatedCore(core), additions = generateMetropolisSites(core.seed), districts = expandedDistricts(shifted.districts);
  const extractions = districts.flatMap(district => district.spawns.slice(2));
  const extracts = [...shifted.extracts, ...extractions];
  const parkPois: LivePoi[] = parks.map(park => ({ ...park, templateId: 'city-park', danger: 2, tags: ['city', 'metropolis-park', 'visit', 'quests'],
    entrances: [{ x: park.x, y: park.y + park.height / 2 }, { x: park.x + park.width - 1, y: park.y + park.height / 2 }] }));
  const pois = [...shifted.pois, ...additions.pois, ...parkPois], containers: LiveContainerAnchor[] = [...shifted.containers, ...additions.containers];
  const land = landscape({ ...shifted, terrainRows: core.terrainRows }, additions, core.seed);
  const obstacles = [...shifted.obstacles, ...additions.obstacles, ...land.water], city = structuredClone(METROPOLIS_CITY);
  const citySites = [...shifted.citySites ?? [], ...additions.sites], npcSpawns = [...shifted.npcSpawns, ...additions.npcSpawns];
  const paths = [...shifted.paths ?? [], ...land.paths];
  const scenery = generateWorldProps({ width: METROPOLIS_SIZE, height: METROPOLIS_SIZE, obstacles, pois, extracts, city, districts, citySites, containers, npcSpawns, paths, terrainRows: land.terrainRows }, `10:${core.seed}`,
    { exclude: METROPOLIS_CORE, budget: Math.min(9800, LIVE_WORLD_LIMITS.props - (shifted.props?.length ?? 0)), idPrefix: 'metro-prop' });
  obstacles.push(...scenery.obstacles);
  const props = [...shifted.props ?? [], ...scenery.props], zones = [...shifted.zones, ...additions.zones, ...parkPois.map(({ x, y, width, height, name, danger }) => ({ x, y, width, height, name, danger, terrain: 'grass' as const }))];
  const routes = metropolisRoutes(shifted.routes ?? [], pois);
  const layout = { seed: core.seed, generatorVersion: 10, chunkSize: core.chunkSize, width: METROPOLIS_SIZE, height: METROPOLIS_SIZE, districts, obstacles, zones, pois, containers,
    terrainRows: land.terrainRows, paths, routes, city, citySites, props };
  const version = `perimeter-g10-${metropolisHash(JSON.stringify({ ...layout, extracts, npcSpawns })).toString(16).padStart(8, '0')}`;
  return { id: 'perimeter', name: 'Большой Периметр', description: 'Огромный Ольховск: жилые районы, торговые улицы, кампус, промзоны и набережные вокруг сохранённого старого города.', theme: 'mixed', version,
    ...layout, extracts, npcSpawns, lootSpawns: containers.map(({ x, y }) => ({ x, y })) };
}
