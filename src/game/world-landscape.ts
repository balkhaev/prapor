import type { LiveLandscapePath, LiveObstacle, LivePoint, LiveWorld } from './live';

type LandscapeWorld = Pick<LiveWorld, 'width' | 'height' | 'obstacles' | 'pois' | 'extracts'>;
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

/** Ground and transport are independent of streaming sectors and contain no reward rolls. */
export function generateLandscape(world: LandscapeWorld, seed: string): { terrainRows: string[]; paths: LiveLandscapePath[]; water: LiveObstacle[] } {
  const width = world.width, height = world.height, total = width * height, ground = new Array<string>(total), blocked = new Uint8Array(total), footprints = new Uint8Array(total);
  const phase = hash(seed) / 0xffffffff * Math.PI * 2;
  const inside = (point: LivePoint): boolean => point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
  const key = (point: LivePoint): number => point.y * width + point.x;
  for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) blocked[y * width + x] = 1;
  for (const poi of world.pois) for (let y = poi.y; y < poi.y + poi.height; y++) for (let x = poi.x; x < poi.x + poi.width; x++) footprints[y * width + x] = 1;
  const paths: LiveLandscapePath[] = [{ id: 'river-east', name: 'Речка Ольховая', kind: 'river', width: 4.5,
    points: riverCurve([{ x: 127, y: 42 }, { x: 117, y: 52 }, { x: 105, y: 60 }, { x: 96, y: 73 }, { x: 91, y: 89 }, { x: 96, y: 104 }, { x: 89, y: 127 }], width, height) }];
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
    const wave = Math.sin(x / 11 + phase) * .11 + Math.cos(y / 13 - phase) * .13 + Math.sin((x + y) / 17 + phase) * .08;
    const forest = ((x - 101) / 46) ** 2 + ((y - 31) / 50) ** 2 < 1 + wave || x < 10 + Math.sin(y / 12 + phase) * 6 && y > 19;
    ground[y * width + x] = forest ? 'f' : 'g';
    let riverDistance = Infinity;
    for (const segment of riverRows[y]!) if (x >= segment.minX && x <= segment.maxX) riverDistance = Math.min(riverDistance, segmentDistance({ x, y }, segment.a, segment.b));
    const lake = ((x - 114) / 10) ** 2 + ((y - 61) / 7) ** 2;
    if (riverDistance < river.width / 2 + wave * .6 || lake < .9 + wave * .3) ground[y * width + x] = 'w';
    else if (riverDistance < river.width / 2 + 1.8 || lake < 1.5 + wave * .4) ground[y * width + x] = 's';
  }
  // Each place has an irregular apron rather than a district-wide rectangular background.
  for (const poi of world.pois) {
    const center = { x: poi.x + poi.width / 2, y: poi.y + poi.height / 2 };
    const code = poi.districtId === 'sawmill' ? poi.templateId === 'sawmill' ? 'y' : 'p' : ['wagons', 'containers', 'market'].includes(poi.templateId) ? 'y' : 'c';
    for (let y = Math.max(0, poi.y - 3); y < Math.min(height, poi.y + poi.height + 3); y++) for (let x = Math.max(0, poi.x - 3); x < Math.min(width, poi.x + poi.width + 3); x++) {
      const cell = y * width + x;
      const apron = ((x - center.x) / (poi.width / 2 + 3)) ** 2 + ((y - center.y) / (poi.height / 2 + 3)) ** 2;
      const ownFootprint = x >= poi.x && y >= poi.y && x < poi.x + poi.width && y < poi.y + poi.height;
      // Aprons have curved edges. A place's bounding rectangle is metadata, never a floor tile.
      if (apron < .93 + Math.sin((x + y) / 5 + phase) * .07 && ground[cell] !== 'w' || blocked[cell] && ownFootprint) ground[cell] = code;
      else if (ownFootprint && ground[cell] === 'w') ground[cell] = 's';
    }
  }
  for (const exit of world.extracts) for (let y = exit.y - 5; y <= exit.y + 5; y++) for (let x = exit.x - 5; x <= exit.x + 5; x++) if (inside({ x, y }) && distance(exit, { x, y }) <= 5) ground[y * width + x] = 'p';
  const clear = (point: LivePoint): boolean => inside(point) && !blocked[key(point)];

  // A small binary heap keeps terrain routing bounded even when a connection crosses water.
  const route = (start: LivePoint, goal: LivePoint): LivePoint[] => {
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
        if (!clear(next) || dx && dy && (!clear({ x: next.x, y: point.y }) || !clear({ x: point.x, y: next.y }))) continue;
        const nextKey = key(next), material = ground[nextKey], endpoint = distance(next, start) < 6 || distance(next, goal) < 6;
        const cost = costs[cell]! + (dx && dy ? 1.414 : 1) * (material === 'r' || material === 'p' ? 1 : material === 'w' ? 5 : 1.8)
          + (footprints[nextKey] && !endpoint ? 12 : 0);
        if (cost >= costs[nextKey]!) continue;
        costs[nextKey] = cost; parent[nextKey] = cell; push({ cell: nextKey, score: cost + heuristic(next) });
      }
    }
    throw new Error('No terrain connection between declared ports');
  };
  const simplify = (points: LivePoint[]): LivePoint[] => points.filter((point, i) => i === 0 || i === points.length - 1 || (point.x - points[i - 1]!.x) * (points[i + 1]!.y - point.y) !== (point.y - points[i - 1]!.y) * (points[i + 1]!.x - point.x));
  const paint = (points: LivePoint[], pathWidth: number, code: string): void => {
    for (const [index, end] of points.entries()) {
      const start = points[Math.max(0, index - 1)]!;
      for (let y = Math.max(0, Math.floor(Math.min(start.y, end.y) - pathWidth)); y <= Math.min(height - 1, Math.ceil(Math.max(start.y, end.y) + pathWidth)); y++) for (let x = Math.max(0, Math.floor(Math.min(start.x, end.x) - pathWidth)); x <= Math.min(width - 1, Math.ceil(Math.max(start.x, end.x) + pathWidth)); x++) {
        const cell = y * width + x;
        if (!blocked[cell] && segmentDistance({ x, y }, start, end) <= pathWidth / 2 && (!footprints[cell] || ground[cell] === 'w')) ground[cell] = code;
      }
    }
    // Centre cells of a connection remain traversable even at a doorway or bridge.
    for (const point of points) if (ground[key(point)] === 'w') ground[key(point)] = code;
  };
  const connect = (a: LivePoint, b: LivePoint, id: string, kind: 'road' | 'trail' = 'road'): LivePoint[] => {
    const cells = route(a, b), points = simplify(cells), pathWidth = kind === 'trail' ? 2 : 3.5;
    paint(cells, pathWidth, kind === 'trail' ? 'p' : 'r');
    paths.push({ id, name: kind === 'trail' ? 'Пешеходная тропа' : 'Местная дорога', kind, width: pathWidth, points });
    return cells;
  };
  const nodes = world.pois.map(poi => poi.entrances[0]!).concat(world.extracts), linked = new Set([0]);
  let connection = 0;
  while (linked.size < nodes.length) {
    let first = 0, second = 0, minimum = Infinity;
    for (const a of linked) for (let b = 0; b < nodes.length; b++) if (!linked.has(b) && distance(nodes[a]!, nodes[b]!) < minimum) { first = a; second = b; minimum = distance(nodes[a]!, nodes[b]!); }
    connect(nodes[first]!, nodes[second]!, `road-${connection++}`, world.pois[second]?.districtId === 'sawmill' ? 'trail' : 'road'); linked.add(second);
  }
  // Additional connections form loops rather than forcing everyone through a single junction.
  for (const [a, b] of [[0, 5], [1, 9], [4, 12], [6, 10], [9, 14], [10, 15]] as const) connect(nodes[a]!, nodes[b]!, `road-${connection++}`);
  for (const poi of world.pois) for (let index = 1; index < poi.entrances.length; index++) connect(poi.entrances[0]!, poi.entrances[index]!, `access-${poi.id}-${index}`, 'trail');
  const railPoints = [{ x: 1, y: 115 }, { x: 21, y: 105 }, { x: 35, y: 92 }, { x: 43, y: 73 }, { x: 60, y: 61 }, { x: 82, y: 51 }, { x: 104, y: 39 }, { x: 126, y: 24 }];
  const rail: LivePoint[] = [];
  const nearestClear = (point: LivePoint): LivePoint => { for (let radius = 0; radius < 16; radius++) for (let y = point.y - radius; y <= point.y + radius; y++) for (let x = point.x - radius; x <= point.x + radius; x++) if (clear({ x, y })) return { x, y }; throw new Error('Rail corridor has no clear port'); };
  for (let index = 1; index < railPoints.length; index++) rail.push(...route(nearestClear(railPoints[index - 1]!), nearestClear(railPoints[index]!)).slice(index === 1 ? 0 : 1));
  paint(rail, 2, 't'); paths.push({ id: 'rail-freight', name: 'Грузовая ветка', kind: 'rail', width: 2, points: simplify(rail) });

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
