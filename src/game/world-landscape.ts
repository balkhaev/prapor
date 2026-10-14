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
  const roads: LiveLandscapePath[] = [{ id: 'city-ring', name: 'Городское кольцо', kind: 'road', width: 5, points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top }] }];
  for (const [index, offset] of [34, 70, 106].entries()) {
    const x = left + offset, y = top + offset, width = index === 1 ? 6 : 4;
    roads.push({ id: `city-street-x-${x}`, name: index === 1 ? 'Проспект Победы' : index === 0 ? 'Вокзальная улица' : 'Заводская улица', kind: 'road', width, points: [{ x, y: top }, { x, y: bottom }] });
    roads.push({ id: `city-street-y-${y}`, name: index === 1 ? 'Центральный проспект' : index === 0 ? 'Северная улица' : 'Садовая улица', kind: 'road', width, points: [{ x: left, y }, { x: right, y }] });
  }
  return roads;
}

/** Ground and transport are independent of streaming sectors and contain no reward rolls. */
export function generateLandscape(world: LandscapeWorld, seed: string): { terrainRows: string[]; paths: LiveLandscapePath[]; water: LiveObstacle[] } {
  const width = world.width, height = world.height, total = width * height, ground = new Array<string>(total), blocked = new Uint8Array(total), footprints = new Uint8Array(total), indoor = new Uint8Array(total);
  const offsetX = world.city ? world.city.x - 56 : (width - 256) / 2, offsetY = world.city ? world.city.y - 56 : (height - 256) / 2;
  const core = (x: number, y: number): LivePoint => ({ x: x + offsetX, y: y + offsetY });
  const expanded = width > 256 || height > 256;
  const phase = hash(seed) / 0xffffffff * Math.PI * 2;
  const inside = (point: LivePoint): boolean => point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
  const key = (point: LivePoint): number => point.y * width + point.x;
  for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) blocked[y * width + x] = 1;
  for (const poi of world.pois) for (let y = poi.y; y < poi.y + poi.height; y++) for (let x = poi.x; x < poi.x + poi.width; x++) footprints[y * width + x] = 1;
  for (const site of world.citySites ?? []) for (const building of site.buildings) for (let y = building.y; y < building.y + building.height; y++) for (let x = building.x; x < building.x + building.width; x++) indoor[y * width + x] = 1;
  const channel = [[255, 44], [239, 54], [220, 72], [212, 92], [210, 118], [215, 148], [207, 182], [213, 212], [207, 255]].map(([x, y]) => core(x!, y!));
  if (expanded) { channel.unshift({ x: width - 1, y: offsetY + 26 }); channel.push({ x: offsetX + 193, y: height - 19 }, { x: offsetX + 193, y: height - 1 }); }
  const paths: LiveLandscapePath[] = [{ id: 'river-east', name: 'Речка Ольховая', kind: 'river', width: 5, points: riverCurve(channel, width, height) }];
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
    const lx = x - offsetX, ly = y - offsetY;
    const wave = Math.sin(lx / 11 + phase) * .11 + Math.cos(ly / 13 - phase) * .13 + Math.sin((lx + ly) / 17 + phase) * .08;
    const forest = (((lx - 181) / 67) ** 2 + ((ly - 20) / 35) ** 2 < 1 + wave
      || ((lx - 32) / 25) ** 2 + ((ly - 144) / 82) ** 2 < .75 + wave
      || ly > 218 + Math.sin(lx / 21 + phase) * 10 && lx > 67 && lx < 220
      || expanded && (((x - (width - 56)) / 84) ** 2 + ((y - 18) / 40) ** 2 < 1 + wave || x > width - 36 + Math.sin(y / 24 + phase) * 5 && y < height / 2))
      && !(expanded && y > height - 36 && x > width / 2 && x < width - 34);
    ground[y * width + x] = forest ? 'f' : 'g';
    let riverDistance = Infinity;
    for (const segment of riverRows[y]!) if (x >= segment.minX && x <= segment.maxX) riverDistance = Math.min(riverDistance, segmentDistance({ x, y }, segment.a, segment.b));
    const lake = ((lx - 210) / 4) ** 2 + ((ly - 157) / 10) ** 2;
    if (riverDistance < river.width / 2 + wave * .6 || lake < .9 + wave * .3) ground[y * width + x] = 'w';
    else if (riverDistance < river.width / 2 + 1.8 || lake < 1.5 + wave * .4) ground[y * width + x] = 's';
    const quarter = world.city?.quarters.find(quarter => contains({ x, y }, quarter));
    if (quarter) {
      // Paving belongs to streets, platforms and working yards. Residential lots
      // retain their lawns; broad green strips soften the boundary of the city.
      ground[y * width + x] = quarter.id === 'residential' ? 'g' : quarter.id === 'old-center' ? 'c' : 'y';
      if (quarter.id === 'old-center' && (lx >= 78 && lx <= 84 && ly >= 62 && ly <= 84 || lx >= 95 && lx <= 115 && ly >= 106 && ly <= 116)) ground[y * width + x] = 'g';
      if (quarter.id === 'station' && lx >= 95 && lx <= 118 && ly >= 172 && ly <= 191) ground[y * width + x] = 'g';
      if (quarter.id === 'industrial' && (lx >= 191 && ly >= 62 && ly <= 121 || ly >= 60 && ly <= 65 && lx >= 131 && lx <= 157)) ground[y * width + x] = 'g';
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
    { x: 15, y: 15, width: 100, height: 36 }, { x: 13, y: 51, width: 30, height: 72 },
    { x: 14, y: 134, width: 34, height: 99 }, { x: 48, y: 207, width: 66, height: 35 },
  ]) fill({ ...rectangle, ...core(rectangle.x, rectangle.y) }, 'y');
  if (expanded) for (const rectangle of [
    { x: 11, y: 7, width: width / 2 - 28, height: 22 }, { x: 7, y: 74, width: 22, height: 72 },
    { x: 7, y: height / 2 + 17, width: 22, height: height / 2 - 45 }, { x: 14, y: height - 29, width: width / 2 - 28, height: 22 },
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
  const route = (start: LivePoint, goal: LivePoint, outsideRooms = false, bounds?: Rect, vehicleRadius = 0): LivePoint[] => {
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
        if (!clear(next) || bounds && !contains(next, bounds) || outsideRooms && indoor[key(next)] && key(next) !== end
          || dx && dy && (!clear({ x: next.x, y: point.y }) || !clear({ x: point.x, y: next.y })
            || outsideRooms && (indoor[point.y * width + next.x] || indoor[next.y * width + point.x]))) continue;
        const nextKey = key(next), material = ground[nextKey], endpoint = distance(next, start) < 6 || distance(next, goal) < 6;
        const cost = costs[cell]! + (dx && dy ? 1.414 : 1) * (material === 'r' || material === 'p' ? 1 : material === 'w' ? 5 : 1.8)
          + (footprints[nextKey] && !endpoint && !bounds ? 12 : 0)
          + (!endpoint && !bridgeCorridors[nextKey] && vehicleRadius ? Math.max(0, vehicleRadius + 1 - clearance[nextKey]!) * 5 : 0);
        if (cost >= costs[nextKey]!) continue;
        costs[nextKey] = cost; parent[nextKey] = cell; push({ cell: nextKey, score: cost + heuristic(next) });
      }
    }
    throw new Error(`No terrain connection between declared ports ${start.x},${start.y} and ${goal.x},${goal.y}`);
  };
  const simplify = (points: LivePoint[]): LivePoint[] => points.filter((point, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const ax = point.x - points[i - 1]!.x, ay = point.y - points[i - 1]!.y, bx = points[i + 1]!.x - point.x, by = points[i + 1]!.y - point.y;
    return ax * by !== ay * bx || ax * bx + ay * by < 0;
  });
  const smooth = (cells: LivePoint[], pathWidth: number): LivePoint[] => {
    const start = cells[0]!, goal = cells.at(-1)!, radius = pathWidth / 2;
    const direct = (a: LivePoint, b: LivePoint): boolean => {
      const steps = Math.max(1, Math.ceil(distance(a, b) * 2)); let previous = a;
      for (let step = 0; step <= steps; step++) {
        const point = { x: Math.round(a.x + (b.x - a.x) * step / steps), y: Math.round(a.y + (b.y - a.y) * step / steps) }, cell = key(point);
        if (!clear(point) || point.x !== previous.x && point.y !== previous.y && (!clear({ x: previous.x, y: point.y }) || !clear({ x: point.x, y: previous.y }))) return false;
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
          if (offset <= pathWidth / 2) ground[cell] = code;
          else if (code === 'r' && offset <= pathWidth / 2 + 1 && !['r', 't', 'p', 'w'].includes(ground[cell]!)) ground[cell] = world.city && contains({ x, y }, world.city) ? 'c' : 'y';
        }
      }
    }
    // Centre cells of a connection remain traversable even at a doorway or bridge.
    for (const point of points) if (ground[key(point)] === 'w' && bridgeCorridors[key(point)]) ground[key(point)] = code;
  };
  const connect = (a: LivePoint, b: LivePoint, id: string, kind: 'road' | 'trail' = 'road', name?: string): LivePoint[] => {
    const pathWidth = kind === 'trail' ? 2 : 3.5, cells = route(a, b, false, undefined, kind === 'road' ? pathWidth / 2 : 0), points = smooth(cells, pathWidth);
    // A yard's metadata rectangle cannot punch holes into a clear carriageway;
    // actual rooms and cover retain their floor and collision independently.
    paint(points, pathWidth, kind === 'trail' ? 'p' : 'r', kind === 'road');
    paths.push({ id, name: name ?? (kind === 'trail' ? 'Пешеходная тропа' : 'Местная дорога'), kind, width: pathWidth, points });
    return cells;
  };
  const nodes = world.pois.map(poi => poi.entrances[0]!).concat(world.extracts), linked = new Set([0]);
  const nearestClear = (point: LivePoint): LivePoint => { for (let radius = 0; radius < 24; radius++) for (let y = point.y - radius; y <= point.y + radius; y++) for (let x = point.x - radius; x <= point.x + radius; x++) if (clear({ x, y }) && !footprints[y * width + x]) return { x, y }; throw new Error('Transport corridor has no clear port'); };
  const approaches: Array<{ deck: LivePoint[]; id: string; name: string }> = [];
  const crossings = [
    { id: 'bridge-mill', name: 'Лесопильная переправа', y: offsetY + 92, kind: 'road' as const },
    { id: 'bridge-stone', name: 'Каменный мост', y: offsetY + 148, kind: 'road' as const },
    { id: 'bridge-meadow', name: 'Луговой настил', y: offsetY + 212, kind: 'trail' as const },
  ];
  if (expanded) crossings.unshift({ id: 'bridge-north', name: 'Северная переправа', y: offsetY + 44, kind: 'road' });
  if (expanded) crossings.push({ id: 'bridge-farmland', name: 'Полевой мост', y: height - 38, kind: 'road' });
  const proposals = crossings.map(crossing => {
    const options: LivePoint[][] = [];
    for (let radius = 0; radius < height; radius++) for (const y of radius ? [crossing.y - radius, crossing.y + radius] : [crossing.y]) {
      if (y < 3 || y > height - 4) continue;
      let deck: LivePoint[] | undefined;
      const riverCenter = river.points.reduce((near, point) => Math.abs(point.y - y) < Math.abs(near.y - y) ? point : near).x;
      for (let x = Math.round(riverCenter) - 10; x <= Math.round(riverCenter) + 10 && !deck; x++) {
        if (!waterMask[y * width + x]) continue;
        const first = x; while (waterMask[y * width + x + 1]) x++;
        if (x - first < 2 || x - first > 18) continue;
        const candidate = Array.from({ length: x - first + 7 }, (_, index) => ({ x: first - 3 + index, y }));
        const bankRemains = (direction: number): boolean => {
          for (let dy = 3; dy <= 8; dy++) for (let nx = first - 2; nx <= x + 2; nx++) {
            const point = { x: nx, y: y + dy * direction };
            if (inside(point) && waterMask[key(point)] && !blocked[key(point)]) return true;
          }
          return false;
        };
        if (candidate.every(baseClear) && candidate[0]!.x >= 1 && candidate.at(-1)!.x < width - 1 && bankRemains(-1) && bankRemains(1)) deck = candidate;
      }
      if (deck) options.push(deck);
    }
    return options;
  });
  // Choose the sites together: one valid early deck must not consume the only
  // clear lower bank left between a greenhouse and the other riverside buildings.
  const chooseDecks = (index: number, chosen: LivePoint[][]): LivePoint[][] | undefined => {
    if (index === crossings.length) return chosen;
    for (const deck of proposals[index]!) {
      if (chosen.some(previous => Math.abs(previous[0]!.y - deck[0]!.y) < 18)) continue;
      const result = chooseDecks(index + 1, [...chosen, deck]);
      if (result) return result;
    }
    return undefined;
  };
  const decks = chooseDecks(0, []);
  if (!decks) throw new Error('No clear banks for authored crossings');
  for (const [index, crossing] of crossings.entries()) {
    const deck = decks[index]!;
    const pathWidth = crossing.kind === 'trail' ? 2 : 4;
    for (let y = deck[0]!.y - pathWidth / 2; y <= deck[0]!.y + pathWidth / 2; y++) for (let x = deck[0]!.x; x <= deck.at(-1)!.x; x++) {
      const point = { x, y }; if (baseClear(point)) bridgeCorridors[key(point)] = 1;
    }
    paint(deck, pathWidth, crossing.kind === 'trail' ? 'p' : 'r');
    paths.push({ id: crossing.id, name: crossing.name, kind: crossing.kind, width: pathWidth, points: [deck[0]!, deck.at(-1)!] });
    approaches.push({ deck, id: crossing.id, name: crossing.name });
  }
  if (world.city) {
    for (const street of cityStreetPlan(world.city)) { paint(street.points, street.width, 'r', true); paths.push(street); }
    for (let y = offsetY + 118; y <= offsetY + 136; y++) for (let x = offsetX + 118; x <= offsetX + 136; x++) if (!blocked[y * width + x]) ground[y * width + x] = 'r';
  }
  for (const crossing of approaches) {
    for (const [index, end] of [crossing.deck[0]!, crossing.deck.at(-1)!].entries()) {
      const bankNodes = nodes.filter(point => index === 0 ? point.x <= end.x : point.x >= end.x);
      const sameBank = (bankNodes.length ? bankNodes : [...nodes]).sort((a, b) => distance(a, end) - distance(b, end))[0]!;
      connect(end, sameBank, `${crossing.id}-approach-${index}`, 'trail', `${crossing.name}: подход`);
    }
  }
  let connection = 0;
  while (linked.size < nodes.length) {
    let first = 0, second = 0, minimum = Infinity;
    for (const a of linked) for (let b = 0; b < nodes.length; b++) if (!linked.has(b) && distance(nodes[a]!, nodes[b]!) < minimum) { first = a; second = b; minimum = distance(nodes[a]!, nodes[b]!); }
    const target = world.pois[second], pedestrian = target?.districtId === 'sawmill' || target?.tags.includes('city');
    connect(nodes[first]!, nodes[second]!, `road-${connection++}`, pedestrian ? 'trail' : 'road'); linked.add(second);
  }
  // The freight roads connect district clusters; extra forest paths create flank approaches.
  for (const [a, b] of [[0, 5], [1, 9], [4, 12], [6, 10], [9, 14], [10, 15], [16, 21], [18, 22], [20, 25], [23, 27], [24, 29], [26, 30]] as const) connect(nodes[a]!, nodes[b]!, `road-${connection++}`);
  for (const poi of world.pois) {
    const access: LivePoint[] = [poi.entrances[0]!];
    for (let index = 1; index < poi.entrances.length; index++) {
      const cells = route(poi.entrances[0]!, poi.entrances[index]!);
      paint(simplify(cells), 2, 'p'); access.push(...cells.slice(1), ...cells.slice(0, -1).reverse());
    }
    const points = simplify(access);
    if (points.length > 1) paths.push({ id: `access-${poi.id}`, name: `${poi.name}: подходы`, kind: 'trail', width: 2, points });
  }
  const highways = [
    { id: 'highway-north', name: 'Северный въезд', points: [{ x: 6, y: 6 }, { x: 24, y: 40 }, { x: 48, y: 52 }, { x: 56, y: 90 }, { x: 90, y: 126 }, { x: 126, y: 126 }] },
    { id: 'highway-forest', name: 'Лесной въезд', points: [{ x: 249, y: 6 }, { x: 228, y: 30 }, { x: 228, y: 92 }, { x: 199, y: 90 }, { x: 162, y: 126 }, { x: 126, y: 126 }] },
    { id: 'highway-cargo', name: 'Грузовой въезд', points: [{ x: 6, y: 249 }, { x: 28, y: 225 }, { x: 48, y: 205 }, { x: 56, y: 162 }, { x: 90, y: 126 }, { x: 126, y: 126 }] },
    { id: 'highway-south', name: 'Южный въезд', points: [{ x: 249, y: 249 }, { x: 231, y: 228 }, { x: 227, y: 212 }, { x: 199, y: 162 }, { x: 162, y: 162 }, { x: 126, y: 126 }] },
    { id: 'trail-meadows', name: 'Обход окраин', points: [{ x: 5, y: 70 }, { x: 6, y: 166 }, { x: 52, y: 207 }, { x: 176, y: 247 }, { x: 228, y: 207 }] },
  ];
  for (const [index, highway] of highways.entries()) {
    highway.points = highway.points.map(point => core(point.x, point.y));
    if (expanded && index < 4) {
      const west = index === 0 || index === 2, north = index < 2;
      highway.points.unshift({ x: west ? 10 : width - 11, y: north ? 42 : height - 42 });
      highway.points.unshift({ x: west ? 10 : width - 11, y: north ? 10 : height - 11 });
    }
  }
  if (expanded) highways.push(
    { id: 'highway-outer-north', name: 'Северный грузовой тракт', points: [{ x: 40, y: 36 }, { x: 122, y: 36 }, { x: 194, y: 36 }, { x: width - 40, y: 36 }] },
    { id: 'highway-outer-west', name: 'Западная объездная', points: [{ x: 36, y: 40 }, { x: 36, y: 122 }, { x: 36, y: 194 }, { x: 36, y: height - 40 }] },
    { id: 'highway-outer-east', name: 'Заречный тракт', points: [{ x: width - 36, y: 40 }, { x: width - 36, y: 122 }, { x: width - 36, y: 194 }, { x: width - 36, y: height - 40 }] },
    { id: 'highway-outer-south', name: 'Южная станционная дорога', points: [{ x: 40, y: height - 36 }, { x: 122, y: height - 36 }, { x: 194, y: height - 36 }, { x: width - 40, y: height - 36 }] },
  );
  for (const highway of highways) {
    const cells: LivePoint[] = [];
    const trail = highway.id.startsWith('trail'), pathWidth = trail ? 2 : 4;
    for (let index = 1; index < highway.points.length; index++) cells.push(...route(nearestClear(highway.points[index - 1]!), nearestClear(highway.points[index]!), false, undefined, trail ? 0 : pathWidth / 2).slice(index === 1 ? 0 : 1));
    const points = smooth(cells, pathWidth);
    paint(points, pathWidth, trail ? 'p' : 'r', !trail); paths.push({ id: highway.id, name: highway.name, kind: trail ? 'trail' : 'road', width: pathWidth, points });
  }
  const railPoints = [[1, 225], [43, 218], [56, 181], [73, 162], [90, 145], [90, 126], [56, 90], [32, 63]].map(([x, y]) => core(x!, y!));
  if (expanded) railPoints.unshift({ x: 1, y: offsetY + 225 });
  const rail: LivePoint[] = [];
  for (let index = 1; index < railPoints.length; index++) rail.push(...route(nearestClear(railPoints[index - 1]!), nearestClear(railPoints[index]!)).slice(index === 1 ? 0 : 1));
  const freight = smooth(rail, 2);
  paint(freight, 2, 't'); paths.push({ id: 'rail-freight', name: 'Грузовая ветка', kind: 'rail', width: 2, points: freight });
  if (expanded) {
    const controls = [{ x: 36, y: height - 40 }, { x: 46, y: height - 31 }, { x: 138, y: height - 31 }], distribution: LivePoint[] = [];
    const first = nearestClear(controls[0]!), junction = rail.reduce((near, point) => distance(point, first) < distance(near, first) ? point : near);
    let start = junction;
    for (const control of controls) { const end = nearestClear(control); distribution.push(...route(start, end).slice(distribution.length ? 1 : 0)); start = end; }
    const points = smooth(distribution, 2);
    paint(points, 6, 'y'); paint(points, 2, 't'); rail.push(...distribution);
    paths.push({ id: 'rail-distribution', name: 'Южный товарный парк', kind: 'rail', width: 2, points });
  }

  // Sidings terminate at the outside loading edge, leaving the authored search
  // rooms and their anchors untouched. They belong to rail facilities only.
  for (const poi of world.pois.filter(poi => !poi.tags.includes('city') && poi.districtId === 'depot' && ['wagons', 'depot', 'coal'].includes(poi.templateId))) {
    const end = nearestClear({ x: poi.x + Math.floor(poi.width / 2), y: poi.y - 2 });
    const start = rail.reduce((near, point) => distance(point, end) < distance(near, end) ? point : near);
    const cells = route(start, end), points = smooth(cells, 1.5);
    paint(points, 5, 'y'); paint(points, 1.5, 't');
    if (cells.length > 1) paths.push({ id: `siding-${poi.id}`, name: `${poi.name}: погрузочная ветка`, kind: 'rail', width: 1.5, points });
  }

  // A pair of compact exterior walks serves every actual doorway in a lot.
  // Repeated branches form one public path per gate, keeping the static wire
  // graph small without drawing shortcut lines through a house or its walls.
  for (const site of world.citySites ?? []) {
    const poi = world.pois.find(poi => poi.id === site.poiId)!;
    for (const [gateIndex, gate] of poi.entrances.entries()) {
      const cells: LivePoint[] = [gate];
      for (const building of site.buildings) {
        const door = building.entrances[gateIndex]!, approach = route(gate, door, true, { x: site.x - 2, y: site.y - 2, width: site.width + 4, height: site.height + 4 });
        paint(approach, 2, site.quarterId === 'old-center' ? 'c' : site.quarterId === 'industrial' ? 'y' : 'p', true);
        cells.push(...approach.slice(1), ...approach.slice(0, -1).reverse());
      }
      const points = simplify(cells);
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
