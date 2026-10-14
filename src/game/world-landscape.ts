import type { LiveCityRegion, LiveLandscapePath, LiveObstacle, LivePoint, LiveWorld } from './live';

type LandscapeWorld = Pick<LiveWorld, 'width' | 'height' | 'obstacles' | 'pois' | 'extracts' | 'city' | 'citySites'>;
type Rect = LivePoint & { width: number; height: number };
const contains = (point: LivePoint, rectangle: Rect): boolean => point.x >= rectangle.x && point.y >= rectangle.y && point.x < rectangle.x + rectangle.width && point.y < rectangle.y + rectangle.height;
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);
const segmentDistance = (point: LivePoint, a: LivePoint, b: LivePoint): number => {
  const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
};
const hash = (value: string): number => { let result = 2166136261; for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619); return result >>> 0; };
function riverCurve(controls: LivePoint[], width: number, height: number): LivePoint[] {
  const points: LivePoint[] = [];
  for (let index = 0; index < controls.length - 1; index++) {
    const a = controls[Math.max(0, index - 1)]!, b = controls[index]!, c = controls[index + 1]!, d = controls[Math.min(controls.length - 1, index + 2)]!;
    for (let sample = 0; sample < 6; sample++) {
      const t = sample / 6, t2 = t * t, t3 = t2 * t;
      const component = (p0: number, p1: number, p2: number, p3: number, limit: number): number => {
        const value = .5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
        return Math.round(Math.max(0, Math.min(limit - 1, value)) * 1000) / 1000;
      };
      points.push({ x: component(a.x, b.x, c.x, d.x, width), y: component(a.y, b.y, c.y, d.y, height) });
    }
  }
  points.push({ ...controls[controls.length - 1]! });
  return points;
}
/** These streets are reserved before buildings are placed, then rasterized unchanged. */
export function cityStreetPlan(city: LiveCityRegion): LiveLandscapePath[] {
  const left = city.x, top = city.y, right = left + city.width - 1, bottom = top + city.height - 1;
  const large = city.width >= 200;
  const roads: LiveLandscapePath[] = [{ id: 'city-ring', name: 'Городское кольцо', kind: 'road', width: large ? 6 : 5, points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top }] }];
  const offsets = large ? [city.width / 4, city.width / 2, city.width * 3 / 4] : [34, 70, 106];
  for (const [index, offset] of offsets.entries()) {
    const x = left + offset, y = top + offset, width = index === 1 ? large ? 8 : 6 : large ? 6 : 4;
    roads.push({ id: `city-street-x-${x}`, name: index === 1 ? 'Проспект Победы' : index === 0 ? 'Вокзальная улица' : 'Заводская улица', kind: 'road', width, points: [{ x, y: top }, { x, y: bottom }] });
    roads.push({ id: `city-street-y-${y}`, name: index === 1 ? 'Центральный проспект' : index === 0 ? 'Северная улица' : 'Садовая улица', kind: 'road', width, points: [{ x: left, y }, { x: right, y }] });
  }
  return roads;
}

/** Regional corridors are reserved before any parcel is populated. Roads never
 * connect arbitrary pairs of POIs: a gate receives a short branch from a street. */
export function regionalStreetPlan(width: number, height: number, city: LiveCityRegion): LiveLandscapePath[] {
  const left = city.x - 44, right = width - 32, top = city.y - 44, bottom = city.y + city.height + 44;
  const north = city.y + city.height / 4, south = city.y + city.height * 3 / 4;
  const west = city.x + city.width / 4, east = city.x + city.width * 3 / 4;
  const road = (id: string, name: string, points: LivePoint[], width = 6): LiveLandscapePath => ({ id, name, kind: 'road', width, points });
  const loop = (id: string, name: string, x1: number, y1: number, x2: number, y2: number): LiveLandscapePath => road(id, name,
    [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 }], 3.5);
  return [
    road('arterial-west', 'Западный грузовой тракт', [{ x: 10, y: 10 }, { x: left, y: 10 }, { x: left, y: height - 11 }, { x: 10, y: height - 11 }]),
    road('arterial-east', 'Восточный пригородный тракт', [{ x: width - 11, y: 10 }, { x: right, y: 10 }, { x: right, y: height - 11 }, { x: width - 11, y: height - 11 }]),
    road('arterial-north', 'Северная объездная', [{ x: left, y: top }, { x: right, y: top }]),
    road('arterial-south', 'Южная объездная', [{ x: left, y: bottom }, { x: right, y: bottom }]),
    road('collector-customs-west', 'Таможенный въезд', [{ x: left, y: north }, { x: city.x, y: north }]),
    road('collector-sawmill-east', 'Лесозаводской въезд', [{ x: right, y: north }, { x: city.x + city.width - 1, y: north }]),
    road('collector-depot-west', 'Вокзальный въезд', [{ x: left, y: south }, { x: city.x, y: south }]),
    road('collector-village-east', 'Пригородный въезд', [{ x: right, y: south }, { x: city.x + city.width - 1, y: south }]),
    road('collector-customs-north', 'Складская улица', [{ x: west, y: top }, { x: west, y: city.y }]),
    road('collector-sawmill-north', 'Лесопильная улица', [{ x: east, y: top }, { x: east, y: city.y }]),
    road('collector-depot-south', 'Товарная улица', [{ x: west, y: bottom }, { x: west, y: city.y + city.height - 1 }]),
    road('collector-village-south', 'Слободская улица', [{ x: east, y: bottom }, { x: east, y: city.y + city.height - 1 }]),
    ...width >= 500 ? [
      loop('neighbourhood-customs', 'Улицы Северных складов', 28, 28, width / 2 - 40, top + 24),
      loop('neighbourhood-sawmill', 'Лесная слобода', width / 2 + 40, 28, width - 88, top + 24),
      loop('neighbourhood-depot', 'Улицы Путевого посёлка', 28, bottom - 24, width / 2 - 40, height - 28),
      loop('neighbourhood-village', 'Улицы Южной слободы', width / 2 + 40, bottom - 24, width - 88, height - 28),
      road('neighbourhood-customs-service', 'Западная складская улица', [{ x: 28, y: top + 24 }, { x: 28, y: city.y + city.height / 2 - 40 }, { x: left, y: city.y + city.height / 2 - 40 }], 3.5),
      road('neighbourhood-depot-service', 'Улица ремонтных мастерских', [{ x: 28, y: bottom - 24 }, { x: 28, y: city.y + city.height / 2 + 40 }, { x: left, y: city.y + city.height / 2 + 40 }], 3.5),
    ] : [],
  ];
}

/** The railway stays outside the city street grid and crosses the western road
 * once at the freight fan; individual rail facilities receive their own sidings. */
export function regionalRailPlan(width: number, height: number, city: LiveCityRegion): LiveLandscapePath[] {
  const x = city.x - 16, south = city.y + city.height + 56;
  return [
    { id: 'rail-freight', name: 'Западная железнодорожная ветка', kind: 'rail', width: 2, points: [{ x: 1, y: south }, { x, y: south }, { x, y: city.y + city.height / 2 }] },
    { id: 'rail-distribution', name: 'Южный товарный парк', kind: 'rail', width: 2, points: [{ x, y: south }, { x: city.x + 58, y: south }] },
  ].filter(path => path.points.every(point => point.x >= 0 && point.y >= 0 && point.x < width && point.y < height)) as LiveLandscapePath[];
}

/** Ground and transport are independent of streaming sectors and contain no reward rolls. */
export function generateLandscape(world: LandscapeWorld, seed: string): { terrainRows: string[]; paths: LiveLandscapePath[]; water: LiveObstacle[] } {
  const width = world.width, height = world.height, total = width * height, ground = new Array<string>(total), blocked = new Uint8Array(total), footprints = new Uint8Array(total), indoor = new Uint8Array(total);
  const phase = hash(seed) / 0xffffffff * Math.PI * 2;
  const inside = (point: LivePoint): boolean => point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
  const key = (point: LivePoint): number => point.y * width + point.x;
  for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) blocked[y * width + x] = 1;
  for (const poi of world.pois.filter(poi => !poi.tags.includes('city-site'))) for (let y = poi.y; y < poi.y + poi.height; y++) for (let x = poi.x; x < poi.x + poi.width; x++) footprints[y * width + x] = 1;
  for (const site of world.citySites ?? []) for (const building of site.buildings) for (let y = building.y; y < building.y + building.height; y++) for (let x = building.x; x < building.x + building.width; x++) { indoor[y * width + x] = 1; footprints[y * width + x] = 1; }
  const riverX = width - 64;
  const channel = [{ x: riverX + 2, y: 0 }, { x: riverX - 4, y: Math.round(height * .12) }, { x: riverX + 3, y: Math.round(height * .25) },
    { x: riverX - 5, y: Math.round(height * .41) }, { x: riverX + 4, y: Math.round(height * .55) }, { x: riverX - 3, y: Math.round(height * .7) },
    { x: riverX + 4, y: Math.round(height * .86) }, { x: riverX - 2, y: height - 1 }];
  const paths: LiveLandscapePath[] = [{ id: 'river-east', name: 'Речка Ольховая', kind: 'river', width: 7, points: riverCurve(channel, width, height) }];
  const river = paths[0]!;
  // The same bounded curve drives the visible path, bank raster and collision water.
  // Index expanded segment bounds by row before evaluating distances near the bank.
  const bank = river.width / 2 + 1.8;
  const segments = river.points.slice(1).map((b, index) => {
    const a = river.points[index]!;
    return { a, b, minX: Math.min(a.x, b.x) - bank, maxX: Math.max(a.x, b.x) + bank, minY: Math.min(a.y, b.y) - bank, maxY: Math.max(a.y, b.y) + bank };
  });
  const riverRows = Array.from({ length: height }, (_, y) => segments.filter(segment => y >= segment.minY && y <= segment.maxY));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const wave = Math.sin(x / 23 + phase) * .11 + Math.cos(y / 29 - phase) * .13;
    const forest = ((x - width * .76) / 110) ** 2 + ((y - 28) / 88) ** 2 < 1 + wave
      || x > width - 43 + Math.sin(y / 30 + phase) * 7 && y < height / 2
      || x < 18 + Math.sin(y / 35 + phase) * 5 && y > 32 && y < height - 42
      || ((x - width * .53) / 88) ** 2 + ((y - (height - 41)) / 29) ** 2 < .9 + wave;
    ground[y * width + x] = forest ? 'f' : 'g';
    let riverDistance = Infinity;
    for (const segment of riverRows[y]!) if (x >= segment.minX && x <= segment.maxX) riverDistance = Math.min(riverDistance, segmentDistance({ x, y }, segment.a, segment.b));
    if (riverDistance < river.width / 2 + wave * .6) ground[y * width + x] = 'w';
    else if (riverDistance < river.width / 2 + 1.8) ground[y * width + x] = 's';
    const quarter = world.city?.quarters.find(quarter => contains({ x, y }, quarter));
    if (quarter) {
      // Paving belongs to streets, platforms and working yards. Residential lots
      // retain their lawns; broad green strips soften the boundary of the city.
      ground[y * width + x] = quarter.id === 'residential' ? 'g' : quarter.id === 'old-center' ? 'c' : 'y';
      const qx = x - quarter.x, qy = y - quarter.y;
      if (quarter.id === 'old-center' && qx >= 20 && qx <= 44 && qy >= 20 && qy <= 44
        || quarter.id === 'station' && qx >= 65 && qx <= 100 && qy >= 66 && qy <= 100
        || quarter.id === 'industrial' && (qx > quarter.width - 7 || qy < 7)) ground[y * width + x] = 'g';
    }
  }
  const fill = (rectangle: Rect, code: string, replaceWater = false): void => {
    for (let y = Math.max(0, rectangle.y); y < Math.min(height, rectangle.y + rectangle.height); y++) for (let x = Math.max(0, rectangle.x); x < Math.min(width, rectangle.x + rectangle.width); x++) {
      const cell = y * width + x;
      if (replaceWater || ground[cell] !== 'w') ground[cell] = code;
    }
  };
  // Logistics occupies connected service ground around the north terminals and
  // the western freight fan, rather than floating as eight unrelated islands.
  for (const rectangle of [
    { x: 28, y: 28, width: width / 2 - 63, height: 30 }, { x: 28, y: 58, width: 64, height: height / 2 - 47 },
    { x: 26, y: height - 208, width: 64, height: 184 }, { x: 88, y: height - 92, width: 104, height: 41 },
  ]) fill(rectangle, 'y');
  // The outer places use broad clearings or working aprons; city land use is
  // authored by its neighbourhood, never by a generic ellipse around every POI.
  for (const poi of world.pois) {
    if (poi.tags.includes('city-site')) continue;
    const center = { x: poi.x + poi.width / 2, y: poi.y + poi.height / 2 };
    const city = poi.tags.includes('city');
    const outdoor = ['wagons', 'containers', 'market', 'fuel', 'coal', 'logging', 'camp', 'creekcamp', 'hunting', 'greenhouse', 'city-mall'].includes(poi.templateId);
    const code = poi.districtId === 'sawmill' ? ['sawmill', 'logging'].includes(poi.templateId) ? 'y' : 'p'
      : outdoor ? poi.templateId === 'greenhouse' ? 'p' : 'y' : 'c';
    if (city) {
      // Named civic rooms have a paved doorstep. Housing and schools keep
      // planting outside their walls, while freight landmarks meet hardstanding.
      const apron = poi.districtId === 'village' ? 1 : 2;
      fill({ x: poi.x - apron, y: poi.y - apron, width: poi.width + apron * 2, height: poi.height + apron * 2 }, outdoor ? 'y' : 'c');
      continue;
    }
    for (let y = Math.max(0, poi.y - 3); y < Math.min(height, poi.y + poi.height + 3); y++) for (let x = Math.max(0, poi.x - 3); x < Math.min(width, poi.x + poi.width + 3); x++) {
      const cell = y * width + x;
      const apron = ((x - center.x) / (poi.width / 2 + 3)) ** 2 + ((y - center.y) / (poi.height / 2 + 3)) ** 2;
      const ownFootprint = x >= poi.x && y >= poi.y && x < poi.x + poi.width && y < poi.y + poi.height;
      // Aprons have curved edges. A place's bounding rectangle is metadata, never a floor tile.
      if (apron < .93 + Math.sin((x + y) / 5 + phase) * .07 && ground[cell] !== 'w' || blocked[cell] && ownFootprint) ground[cell] = code;
      else if (ownFootprint && ground[cell] === 'w') ground[cell] = 's';
    }
    // Working yards have straight loading edges, with rounded clearings only at
    // the forest margin. Village gardens are deliberately continuous green lots.
    if (poi.districtId === 'customs' || poi.districtId === 'depot') {
      fill({ x: poi.x - 2, y: poi.y + poi.height - 3, width: poi.width + 4, height: 6 }, 'y');
      if (!outdoor) fill({ x: poi.x + 1, y: poi.y + 1, width: poi.width - 2, height: poi.height - 2 }, 'c');
    } else if (poi.districtId === 'village' && !['market', 'checkpoint', 'fuel'].includes(poi.templateId)) {
      for (let y = Math.max(0, poi.y - 3); y < Math.min(height, poi.y + poi.height + 3); y++) for (let x = Math.max(0, poi.x - 3); x < Math.min(width, poi.x + poi.width + 3); x++) {
        const cell = y * width + x;
        if (!blocked[cell] && !contains({ x, y }, poi) && ground[cell] !== 'w' && ground[cell] !== 's') ground[cell] = 'g';
      }
    }
  }
  for (const site of world.citySites ?? []) {
    const courtCode = site.quarterId === 'residential' ? 'g' : site.quarterId === 'old-center' || site.kind === 'arcade' ? 'c' : 'y';
    fill(site.courtyard, courtCode);
    for (const building of site.buildings) fill(building, 'c');
    // Buildings facing industrial courtyards share real loading aprons; station
    // buildings have a narrow platform-like paved approach rather than bare lawn.
    if (site.quarterId === 'industrial' || site.quarterId === 'station') for (const building of site.buildings) for (const door of building.entrances) {
      const horizontalFacade = door.y === building.y || door.y === building.y + building.height - 1;
      fill(site.quarterId === 'industrial' ? { x: door.x - 1, y: door.y - 1, width: 4, height: 4 }
        : horizontalFacade ? { x: building.x - 1, y: door.y - 1, width: building.width + 2, height: 3 }
          : { x: door.x - 1, y: building.y - 1, width: 3, height: building.height + 2 }, 'c');
    }
  }
  for (const exit of world.extracts) for (let y = exit.y - 5; y <= exit.y + 5; y++) for (let x = exit.x - 5; x <= exit.x + 5; x++) if (inside({ x, y }) && distance(exit, { x, y }) <= 5) ground[y * width + x] = 'p';
  const waterMask = Uint8Array.from(ground, code => code === 'w' ? 1 : 0), bridgeCorridors = new Uint8Array(total);
  const baseClear = (point: LivePoint): boolean => inside(point) && !blocked[key(point)];
  const clear = (point: LivePoint): boolean => baseClear(point) && (!waterMask[key(point)] || Boolean(bridgeCorridors[key(point)]));
  // Distance to solid cover discourages a vehicle road from squeezing past a
  // tree or a wall when an equally short open approach exists beside it.
  const clearance = new Uint8Array(total).fill(4), coverQueue = new Int32Array(total); let coverHead = 0, coverTail = 0;
  for (let cell = 0; cell < total; cell++) if (blocked[cell] || waterMask[cell]) { clearance[cell] = 0; coverQueue[coverTail++] = cell; }
  while (coverHead < coverTail) {
    const cell = coverQueue[coverHead++]!, x = cell % width, y = Math.floor(cell / width), nextDistance = clearance[cell]! + 1;
    if (nextDistance >= 4) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const point = { x: x + dx, y: y + dy }; if (!inside(point)) continue;
      const next = key(point); if (nextDistance < clearance[next]!) { clearance[next] = nextDistance; coverQueue[coverTail++] = next; }
    }
  }

  // Transport may cross the channel only inside the authored bridge corridors.
  const route = (start: LivePoint, goal: LivePoint, outsideRooms = false, bounds?: Rect, vehicleRadius = 0, orthogonal = false, avoidLots = false): LivePoint[] => {
    const end = key(goal), costs = new Float64Array(total).fill(Infinity), parent = new Int32Array(total).fill(-1), closed = new Uint8Array(total);
    const heap: Array<{ cell: number; score: number }> = [];
    const push = (node: { cell: number; score: number }): void => { let i = heap.length; heap.push(node); while (i > 0) { const p = (i - 1) >>> 1; if (heap[p]!.score <= node.score) break; heap[i] = heap[p]!; i = p; } heap[i] = node; };
    const pop = (): { cell: number; score: number } => { const first = heap[0]!, last = heap.pop()!; if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { const l = i * 2 + 1, r = l + 1, next = r < heap.length && heap[r]!.score < heap[l]!.score ? r : l; if (last.score <= heap[next]!.score) break; heap[i] = heap[next]!; i = next; } heap[i] = last; } return first; };
    const heuristic = (point: LivePoint): number => distance(point, goal);
    costs[key(start)] = 0; push({ cell: key(start), score: heuristic(start) });
    while (heap.length) {
      const { cell } = pop(); if (closed[cell]) continue; closed[cell] = 1;
      if (cell === end) {
        const result: LivePoint[] = [];
        for (let current = end; current !== -1; current = parent[current]!) result.push({ x: current % width, y: Math.floor(current / width) });
        return result.reverse();
      }
      const point = { x: cell % width, y: Math.floor(cell / width) };
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const next = { x: point.x + dx!, y: point.y + dy! };
        if (orthogonal && dx && dy || !clear(next) || bounds && !contains(next, bounds) || avoidLots && footprints[key(next)]
          || vehicleRadius && !bridgeCorridors[key(next)] && clearance[key(next)]! < Math.ceil(vehicleRadius + .5)
          || avoidLots && [-1, 0, 1].some(oy => [-1, 0, 1].some(ox => footprints[(next.y + oy) * width + next.x + ox]))
          || outsideRooms && indoor[key(next)] && key(next) !== end
          || dx && dy && (!clear({ x: next.x, y: point.y }) || !clear({ x: point.x, y: next.y })
            || outsideRooms && (indoor[point.y * width + next.x] || indoor[next.y * width + point.x]))) continue;
        const nextKey = key(next), material = ground[nextKey], endpoint = distance(next, start) < 6 || distance(next, goal) < 6;
        const previous = parent[cell], turns = orthogonal && previous! >= 0 && (point.x - previous! % width !== dx || point.y - Math.floor(previous! / width) !== dy);
        const cost = costs[cell]! + (dx && dy ? 1.414 : 1) * (material === 'r' || material === 'p' ? 1 : material === 'w' ? 5 : 1.8) + (turns ? 2 : 0)
          + (footprints[nextKey] && !endpoint && !bounds ? 12 : 0)
          + (!endpoint && !bridgeCorridors[nextKey] && vehicleRadius ? Math.max(0, vehicleRadius + 1 - clearance[nextKey]!) * 5 : 0);
        if (cost >= costs[nextKey]!) continue;
        costs[nextKey] = cost; parent[nextKey] = cell; push({ cell: nextKey, score: cost + heuristic(next) });
      }
    }
    throw new Error(`No terrain connection between declared ports ${start.x},${start.y} and ${goal.x},${goal.y}`);
  };
  const simplify = (input: LivePoint[]): LivePoint[] => {
    const points = input.filter((point, index) => index === 0 || point.x !== input[index - 1]!.x || point.y !== input[index - 1]!.y);
    return points.filter((point, i) => {
      if (i === 0 || i === points.length - 1) return true;
      const ax = point.x - points[i - 1]!.x, ay = point.y - points[i - 1]!.y, bx = points[i + 1]!.x - point.x, by = points[i + 1]!.y - point.y;
      return ax * by !== ay * bx || ax * bx + ay * by < 0;
    });
  };
  const smooth = (cells: LivePoint[], pathWidth: number, outsideRooms = false): LivePoint[] => {
    const start = cells[0]!, goal = cells.at(-1)!, radius = pathWidth / 2;
    const direct = (a: LivePoint, b: LivePoint): boolean => {
      const steps = Math.max(1, Math.ceil(distance(a, b) * 2)); let previous = a;
      for (let step = 0; step <= steps; step++) {
        const point = { x: Math.round(a.x + (b.x - a.x) * step / steps), y: Math.round(a.y + (b.y - a.y) * step / steps) }, cell = key(point);
        if (!clear(point) || outsideRooms && indoor[cell] && distance(point, start) > 1 && distance(point, goal) > 1
          || point.x !== previous.x && point.y !== previous.y && (!clear({ x: previous.x, y: point.y }) || !clear({ x: point.x, y: previous.y }))) return false;
        const atPort = distance(point, start) < 6 || distance(point, goal) < 6;
        if (!atPort && (footprints[cell] || !bridgeCorridors[cell] && clearance[cell]! < radius + .5)) return false;
        previous = point;
      }
      return true;
    };
    const result: LivePoint[] = [start];
    for (let at = 0; at < cells.length - 1;) {
      let next = Math.min(cells.length - 1, at + 96);
      while (next > at + 1 && !direct(cells[at]!, cells[next]!)) next = Math.max(at + 1, next - 6);
      result.push(cells[next]!); at = next;
    }
    return simplify(result);
  };
  const paint = (points: LivePoint[], pathWidth: number, code: string, withinLots = false): void => {
    for (const [index, end] of points.entries()) {
      const start = points[Math.max(0, index - 1)]!;
      for (let y = Math.max(0, Math.floor(Math.min(start.y, end.y) - pathWidth)); y <= Math.min(height - 1, Math.ceil(Math.max(start.y, end.y) + pathWidth)); y++) for (let x = Math.max(0, Math.floor(Math.min(start.x, end.x) - pathWidth)); x <= Math.min(width - 1, Math.ceil(Math.max(start.x, end.x) + pathWidth)); x++) {
        const cell = y * width + x;
        if (code !== 'r' && code !== 't' && (ground[cell] === 'r' || ground[cell] === 't')) continue;
        const offset = segmentDistance({ x, y }, start, end);
        if (!blocked[cell] && (!waterMask[cell] || bridgeCorridors[cell]) && (!footprints[cell] || ground[cell] === 'w' || withinLots && !indoor[cell])) {
          // Raster cells cover their square area, while the renderer strokes a
          // continuous carriageway. Half a cell diagonal reserves its corners.
          if (offset <= pathWidth / 2 + (code === 'r' ? Math.SQRT1_2 : 0)) ground[cell] = code;
          else if (code === 'r' && offset <= pathWidth / 2 + 1.5 && !['r', 't', 'p', 'w'].includes(ground[cell]!)) ground[cell] = world.city && contains({ x, y }, world.city) ? 'c' : 'y';
        }
      }
    }
    // Centre cells of a connection remain traversable even at a doorway or bridge.
    for (const point of points) if (ground[key(point)] === 'w' && bridgeCorridors[key(point)]) ground[key(point)] = code;
  };
  const nearestClear = (point: LivePoint): LivePoint => {
    for (let radius = 0; radius < 24; radius++) for (let y = point.y - radius; y <= point.y + radius; y++) for (let x = point.x - radius; x <= point.x + radius; x++) {
      if ([-1, 0, 1].every(dy => [-1, 0, 1].every(dx => clear({ x: x + dx, y: y + dy }) && !footprints[(y + dy) * width + x + dx]))) return { x, y };
    }
    throw new Error(`Transport corridor has no clear port near ${point.x},${point.y}`);
  };
  if (!world.city) throw new Error('An authored city is required for the regional street hierarchy');
  const streets = [...cityStreetPlan(world.city), ...regionalStreetPlan(width, height, world.city)];
  const railways = regionalRailPlan(width, height, world.city);
  const crossings = [
    { id: 'bridge-north', name: 'Северный мост', y: world.city.y - 44, width: 6, kind: 'road' as const },
    { id: 'bridge-mill', name: 'Лесозаводской мост', y: world.city.y + world.city.height / 4, width: 6, kind: 'road' as const },
    { id: 'bridge-stone', name: 'Слободской мост', y: world.city.y + world.city.height * 3 / 4, width: 6, kind: 'road' as const },
    { id: 'bridge-meadow', name: 'Пешеходный мост', y: world.city.y + world.city.height + 8, width: 2, kind: 'trail' as const },
    { id: 'bridge-farmland', name: 'Южный мост', y: world.city.y + world.city.height + 44, width: 6, kind: 'road' as const },
  ];
  // Bridge positions belong to the reserved street plan. They do not wander to
  // the first gap between buildings, and all carriageway cells share the deck.
  for (const crossing of crossings) {
    const wet = Array.from({ length: width }, (_, x) => x).filter(x => waterMask[crossing.y * width + x]);
    if (!wet.length) throw new Error(`Missing river at authored crossing ${crossing.id}`);
    const left = wet[0]! - 3, right = wet.at(-1)! + 3, half = Math.ceil(crossing.width / 2 + Math.SQRT1_2);
    for (let y = crossing.y - half; y <= crossing.y + half; y++) for (let x = left; x <= right; x++) {
      const point = { x, y };
      if (!baseClear(point)) throw new Error(`Cover obstructs reserved bridge ${crossing.id}`);
      bridgeCorridors[key(point)] = 1;
    }
    const points = [{ x: left, y: crossing.y }, { x: right, y: crossing.y }];
    paint(points, crossing.width, crossing.kind === 'road' ? 'r' : 'p');
    paths.push({ id: crossing.id, name: crossing.name, kind: crossing.kind, width: crossing.width, points });
  }
  const centerCells = (points: LivePoint[]): LivePoint[] => {
    const result: LivePoint[] = [];
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!, steps = Math.max(1, Math.ceil(distance(a, b) * 2));
      for (let step = 0; step <= steps; step++) result.push({ x: Math.round(a.x + (b.x - a.x) * step / steps), y: Math.round(a.y + (b.y - a.y) * step / steps) });
    }
    return result;
  };
  for (const street of streets) {
    if (!centerCells(street.points).every(clear)) throw new Error(`Reserved street ${street.id} contains cover or unbridged water`);
    paint(street.points, street.width, 'r'); paths.push(street);
  }
  // The footbridge connects the two bank walks, without adding a fifth asphalt
  // collector or an oblique shortcut across the southern residential plots.
  const meadow = crossings.find(crossing => crossing.id === 'bridge-meadow')!;
  const meadowWalk = [{ x: world.city.x + world.city.width - 1, y: meadow.y }, { x: width - 32, y: meadow.y }];
  const meadowCells = route(meadowWalk[0]!, meadowWalk[1]!, true);
  const meadowPoints = smooth(meadowCells, 2, true);
  paint(meadowPoints, 2, 'p'); paths.push({ id: 'trail-river-meadows', name: 'Береговой проход', kind: 'trail', width: 2, points: meadowPoints });

  const project = (point: LivePoint, a: LivePoint, b: LivePoint): LivePoint => {
    const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
    const t = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
    return { x: Math.round(a.x + dx * t), y: Math.round(a.y + dy * t) };
  };
  const streetPorts = (point: LivePoint): Array<{ point: LivePoint; street: LiveLandscapePath; score: number }> => {
    const candidates = streets.flatMap(street => street.points.slice(1).map((b, index) => {
      const at = project(point, street.points[index]!, b);
      return { point: at, street, score: Math.abs(at.x - point.x) + Math.abs(at.y - point.y) };
    }));
    // A short gate branch stays on its own bank. The named collectors are the
    // only motor roads crossing the channel, preventing incidental bridges.
    return candidates.filter(candidate => (candidate.point.x < riverX - 12) === (point.x < riverX - 12) || candidate.score < 16)
      .sort((a, b) => a.score - b.score || a.street.id.localeCompare(b.street.id));
  };
  const exteriorPort = (poi: LandscapeWorld['pois'][number], door: LivePoint): LivePoint => {
    if (poi.tags.includes('city-site')) return door;
    const sides = [
      { gap: Math.abs(door.y - poi.y), point: { x: door.x, y: poi.y - 3 } },
      { gap: Math.abs(door.y - (poi.y + poi.height - 1)), point: { x: door.x, y: poi.y + poi.height + 2 } },
      { gap: Math.abs(door.x - poi.x), point: { x: poi.x - 3, y: door.y } },
      { gap: Math.abs(door.x - (poi.x + poi.width - 1)), point: { x: poi.x + poi.width + 2, y: door.y } },
    ];
    sides.sort((a, b) => a.gap - b.gap);
    return nearestClear(sides[0]!.point);
  };
  const driveClear = (points: LivePoint[]): boolean => centerCells(points).every(point => {
    if (!clear(point) || footprints[key(point)] || waterMask[key(point)]) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const side = { x: point.x + dx, y: point.y + dy };
      if (!clear(side) || footprints[key(side)]) return false;
    }
    return true;
  });
  for (const poi of world.pois) {
    const options = poi.entrances.map(door => {
      const exterior = exteriorPort(poi, door), nearest = streetPorts(exterior)[0]!;
      return { door, exterior, nearest, score: nearest.score + distance(door, exterior) };
    }).sort((a, b) => a.score - b.score);
    const entry = options[0]!;
    const forest = poi.districtId === 'sawmill' && !['sawmill', 'logging', 'fuel', 'checkpoint'].includes(poi.templateId);
    const pedestrian = forest || poi.tags.includes('city');
    const street = entry.nearest.point;
    if (pedestrian) {
      const cells = route(street, entry.door, true), points = smooth(cells, 2, true);
      paint(points, 2, 'p', true);
      if (points.length > 1) paths.push({ id: `trail-${poi.id}`, name: `${poi.name}: пеший подход`, kind: 'trail', width: 2, points });
    } else {
      const end = entry.exterior;
      const bends = [[street, { x: end.x, y: street.y }, end], [street, { x: street.x, y: end.y }, end]].map(simplify);
      const points = bends.find(driveClear) ?? simplify(route(street, end, true, undefined, 1.25, true, true));
      paint(points, 2.5, 'r');
      if (points.length > 1) paths.push({ id: `driveway-${poi.id}`, name: `${poi.name}: подъезд к воротам`, kind: 'road', width: 2.5, points });
      const doorstep = route(end, entry.door, true), foot = simplify(doorstep);
      paint(foot, 2, 'p', true);
      if (foot.length > 1) paths.push({ id: `trail-${poi.id}`, name: `${poi.name}: вход`, kind: 'trail', width: 2, points: foot });
    }
    // Other entrances are footways, never another equal-priority through road.
    // Return branches are explicit, so simplifying the wire path cannot invent
    // a shortcut between doors on opposite sides of a room.
    if (poi.tags.includes('city-site')) continue;
    const access: LivePoint[] = [entry.door];
    for (const door of poi.entrances.filter(door => door !== entry.door)) {
      const cells = route(entry.door, door, poi.tags.includes('city-site'));
      paint(cells, 2, 'p', true); access.push(...cells.slice(1), ...cells.slice(0, -1).reverse());
    }
    const points = simplify(access);
    if (points.length > 1) paths.push({ id: `access-${poi.id}`, name: `${poi.name}: пешеходные подходы`, kind: 'trail', width: 2, points });
  }
  // Legacy secondary evacuation points retain foot access to the nearest street.
  for (const [index, exit] of world.extracts.entries()) {
    const nearest = streetPorts(exit)[0]!.point;
    if (distance(nearest, exit) < 1) continue;
    const cells = route(nearest, exit, true), points = smooth(cells, 2, true);
    paint(points, 2, 'p'); paths.push({ id: `trail-extract-${index}`, name: 'Тропа к выходу', kind: 'trail', width: 2, points });
  }
  for (const railway of railways) {
    const cells = centerCells(railway.points);
    if (!cells.every(clear)) throw new Error(`Reserved railway ${railway.id} contains cover`);
    paint(railway.points, 5, 'y'); paint(railway.points, railway.width, 't');
    paths.push(railway);
  }
  // Dedicated loading sidings have one turnout and remain on the depot side.
  for (const poi of world.pois.filter(poi => !poi.tags.includes('city') && poi.districtId === 'depot' && ['wagons', 'depot', 'coal'].includes(poi.templateId))) {
    const options = poi.entrances.flatMap(door => {
      const end = exteriorPort(poi, door);
      return railways.flatMap(railway => railway.points.slice(1).map((b, index) => {
        const start = project(end, railway.points[index]!, b);
        const bends = [[start, { x: end.x, y: start.y }, end], [start, { x: start.x, y: end.y }, end]].map(simplify);
        return { start, end, direct: bends.find(driveClear), score: Math.abs(start.x - end.x) + Math.abs(start.y - end.y) };
      }));
    }).sort((a, b) => a.score - b.score);
    const siding = options.find(option => option.direct) ?? options[0]!;
    const points = siding.direct ?? simplify(route(siding.start, siding.end, true, undefined, .75, true, true));
    paint(points, 5, 'y'); paint(points, 1.5, 't');
    if (points.length > 1) paths.push({ id: `siding-${poi.id}`, name: `${poi.name}: погрузочная ветка`, kind: 'rail', width: 1.5, points });
  }
  // All houses share the same exterior alley tree. Walking each edge outward
  // and back retains real geometry while reusing common trunks between doors.
  // A denser frontage therefore needs no public path for every individual house.
  for (const site of world.citySites ?? []) {
    const poi = world.pois.find(poi => poi.id === site.poiId)!;
    for (const [gateIndex, gate] of poi.entrances.entries()) {
      const bounds = { x: site.x - 2, y: site.y - 2, width: site.width + 4, height: site.height + 4 };
      const targets = [...site.buildings.map(building => building.entrances[gateIndex]!), ...poi.entrances.filter(port => port !== gate)];
      const goals = new Set(targets.map(key)), remaining = new Set(goals), parents = new Int32Array(total).fill(-1), queue = new Int32Array(total);
      const root = key(gate); let head = 0, tail = 1; queue[0] = root; parents[root] = root; remaining.delete(root);
      while (head < tail && remaining.size) {
        const cell = queue[head++]!, x = cell % width, y = Math.floor(cell / width);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const point = { x: nx!, y: ny! };
          if (!contains(point, bounds) || !clear(point)) continue;
          const next = key(point);
          if (parents[next] !== -1 || indoor[next] && !goals.has(next)) continue;
          parents[next] = cell; queue[tail++] = next; remaining.delete(next);
        }
      }
      if (remaining.size) throw new Error(`Neighbourhood ${site.id} has an unreachable exterior doorway`);
      const children = new Map<number, Set<number>>();
      for (const target of targets) for (let cell = key(target); cell !== root; cell = parents[cell]!) {
        const parent = parents[cell]!, branch = children.get(parent) ?? new Set<number>();
        branch.add(cell); children.set(parent, branch);
      }
      const cells: LivePoint[] = [gate];
      const walk = (cell: number): void => {
        for (const child of children.get(cell) ?? []) {
          cells.push({ x: child % width, y: Math.floor(child / width) }); walk(child);
          cells.push({ x: cell % width, y: Math.floor(cell / width) });
        }
      };
      walk(root);
      paint(cells, 2, site.quarterId === 'old-center' ? 'c' : site.quarterId === 'industrial' ? 'y' : 'p', true);
      const points = simplify(cells);
      if (points.length > 256) throw new Error(`Neighbourhood ${site.id} exterior walk exceeds the bounded public path`);
      if (points.length > 1) paths.push({ id: `footway-${site.id}-${gateIndex}`, name: `${site.name}: пешеходный проход`, kind: 'trail', width: 1.5, points });
    }
  }

  // Small planted strips belong to the quiet edges of inhabited courts. Their
  // straight borders follow the lots; sidewalks, rails and door aprons stay open.
  for (const site of world.citySites ?? []) if (site.quarterId === 'old-center' || site.quarterId === 'residential' || site.quarterId === 'station' && site.kind === 'courtyard') {
    const doors = site.buildings.flatMap(building => building.entrances);
    for (let y = site.y; y < site.y + site.height; y++) for (let x = site.x; x < site.x + site.width; x++) {
      const cell = y * width + x, point = { x, y };
      const edge = Math.min(x - site.x, site.x + site.width - 1 - x, y - site.y, site.y + site.height - 1 - y);
      if (edge <= 1 && !blocked[cell] && !indoor[cell] && ['c', 'y', 'g'].includes(ground[cell]!) && doors.every(door => distance(door, point) > 3)) ground[cell] = 'g';
    }
  }

  // Fill small shoreline islands that have no door/container; large land regions
  // remain joined by the actual bridge tiles cut by the transport network.
  const reached = new Uint8Array(total), queue = new Int32Array(total), start = key(world.extracts[0]!); let head = 0, tail = 1; queue[0] = start; reached[start] = 1;
  while (head < tail) { const cell = queue[head++]!, x = cell % width, y = Math.floor(cell / width); for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const point = { x: nx!, y: ny! }; if (!clear(point)) continue; const next = key(point); if (!reached[next] && ground[next] !== 'w') { reached[next] = 1; queue[tail++] = next; } } }
  for (let cell = 0; cell < total; cell++) if (!blocked[cell] && !reached[cell]) ground[cell] = 'w';
  const water: LiveObstacle[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ground[y * width + x] === 'w') {
    const start = x; while (x + 1 < width && ground[y * width + x + 1] === 'w') x++;
    const previous = water.find(rect => rect.x === start && rect.width === x - start + 1 && rect.y + rect.height === y);
    if (previous) previous.height++; else water.push({ x: start, y, width: x - start + 1, height: 1, kind: 'water' });
  }
  return { terrainRows: Array.from({ length: height }, (_, y) => ground.slice(y * width, (y + 1) * width).join('')), paths, water };
}
