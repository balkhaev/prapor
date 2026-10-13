import type { LiveDistrictId, LivePoint, LivePurpose, LiveWorld } from './live';

export interface WorldPlanReport {
  districts: Array<{ id: LiveDistrictId; places: number; containers: number; nearestLootSteps: number | null; nearestContestedSteps: number | null }>;
  routes: Array<{ id: string; name: string; districtId: LiveDistrictId; purpose: LivePurpose; stops: string[]; firstStopSteps: number; walkSteps: number; returnSteps: number }>;
  city?: { name: string; places: number; containers: number; buildings: number; buildingTiles: number; areaTiles: number;
    quarters: Array<{ id: string; name: string; buildings: number; buildingTiles: number; areaTiles: number }>;
    approaches: Array<{ districtId: LiveDistrictId; firstCityStopSteps: number | null }> };
}

/** Authoring measurements use the same four-direction movement as the server, without actors. */
export function analyseWorldPlan(world: LiveWorld): WorldPlanReport {
  if (!Number.isInteger(world.width) || !Number.isInteger(world.height) || world.width < 1 || world.height < 1 || world.width > 256 || world.height > 256) throw new Error('Invalid planning dimensions');
  const cells = world.width * world.height, blocked = new Uint8Array(cells);
  const key = (point: LivePoint): number => point.y * world.width + point.x;
  const inside = (point: LivePoint): boolean => Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.y >= 0 && point.x < world.width && point.y < world.height;
  for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) {
    if (inside({ x, y })) blocked[y * world.width + x] = 1;
  }
  if (world.terrainRows) for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) if (world.terrainRows[y]?.[x] === 'w') blocked[y * world.width + x] = 1;
  const distances = (sources: LivePoint[]): Int32Array => {
    const steps = new Int32Array(cells).fill(-1), queue = new Int32Array(cells);
    let length = 0;
    for (const source of sources) {
      if (!inside(source) || blocked[key(source)]) throw new Error('Unreachable planning origin');
      if (steps[key(source)] === 0) continue;
      steps[key(source)] = 0; queue[length++] = key(source);
    }
    for (let index = 0; index < length; index++) {
      const cell = queue[index]!, x = cell % world.width, y = Math.floor(cell / world.width);
      for (const next of [x > 0 ? cell - 1 : -1, x + 1 < world.width ? cell + 1 : -1, y > 0 ? cell - world.width : -1, y + 1 < world.height ? cell + world.width : -1]) {
        if (next < 0 || blocked[next] || steps[next]! >= 0) continue;
        steps[next] = steps[cell]! + 1; queue[length++] = next;
      }
    }
    return steps;
  };
  const closest = (steps: Int32Array, candidates: LivePoint[]): { point: LivePoint; steps: number } | null => {
    let best: { point: LivePoint; steps: number } | null = null;
    for (const point of candidates) {
      if (!inside(point)) continue;
      const count = steps[key(point)]!;
      if (count >= 0 && (!best || count < best.steps)) best = { point, steps: count };
    }
    return best;
  };
  const districtFields = new Map(world.districts.map(district => [district.id, distances(district.spawns)]));
  const districts = world.districts.map(district => {
    const places = world.pois.filter(poi => poi.districtId === district.id), ids = new Set(places.map(poi => poi.id));
    const containers = world.containers.filter(anchor => ids.has(anchor.poiId)), steps = districtFields.get(district.id)!;
    return { id: district.id, places: places.length, containers: containers.length, nearestLootSteps: closest(steps, containers)?.steps ?? null,
      nearestContestedSteps: closest(steps, places.filter(poi => poi.danger === 3).flatMap(poi => poi.entrances))?.steps ?? null };
  });
  const routes = (world.routes ?? []).map(route => {
    let field = districtFields.get(route.districtId);
    if (!field || !route.poiIds.length) throw new Error('Invalid planning route');
    let walkSteps = 0, firstStopSteps = 0;
    const stops: string[] = [];
    for (const [index, id] of route.poiIds.entries()) {
      const poi = world.pois.find(poi => poi.id === id), goal = poi ? closest(field, poi.entrances) : null;
      if (!poi || !goal) throw new Error(`Unreachable route stop ${id}`);
      if (index === 0) firstStopSteps = goal.steps;
      walkSteps += goal.steps; stops.push(poi.name); field = distances([goal.point]);
    }
    const exit = closest(field, world.extracts);
    if (!exit) throw new Error(`Unreachable route extraction ${route.id}`);
    return { id: route.id, name: route.name, districtId: route.districtId, purpose: route.purpose, stops, firstStopSteps, walkSteps, returnSteps: exit.steps };
  });
  if (!world.city) return { districts, routes };
  const city = world.city;
  const inArea = (point: LivePoint, area: { x: number; y: number; width: number; height: number }): boolean => point.x >= area.x && point.y >= area.y && point.x < area.x + area.width && point.y < area.y + area.height;
  const buildings = world.obstacles.filter(obstacle => obstacle.kind === 'building'), buildingMask = new Uint8Array(cells);
  for (const building of buildings) for (let y = building.y; y < building.y + building.height; y++) for (let x = building.x; x < building.x + building.width; x++) if (inside({ x, y })) buildingMask[y * world.width + x] = 1;
  const measure = (area: { x: number; y: number; width: number; height: number }) => {
    let buildingTiles = 0;
    for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) if (inside({ x, y }) && buildingMask[y * world.width + x]) buildingTiles++;
    return { buildings: buildings.filter(building => building.x < area.x + area.width && building.y < area.y + area.height && building.x + building.width > area.x && building.y + building.height > area.y).length, buildingTiles, areaTiles: area.width * area.height };
  };
  const places = world.pois.filter(poi => inArea(poi, city) && inArea({ x: poi.x + poi.width - 1, y: poi.y + poi.height - 1 }, city)), ids = new Set(places.map(poi => poi.id));
  return { districts, routes, city: { name: city.name, places: places.length, containers: world.containers.filter(anchor => ids.has(anchor.poiId)).length, ...measure(city),
    quarters: city.quarters.map(quarter => ({ id: quarter.id, name: quarter.name, ...measure(quarter) })),
    approaches: world.districts.map(district => ({ districtId: district.id, firstCityStopSteps: closest(districtFields.get(district.id)!, places.flatMap(poi => poi.entrances))?.steps ?? null })) } };
}
