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
  const paths: LiveLandscapePath[] = [{ id: 'river-east', name: 'Речка Ольховая', kind: 'river', width: 5,
    points: riverCurve([{ x: 191, y: 54 }, { x: 174, y: 69 }, { x: 153, y: 87 }, { x: 137, y: 111 }, { x: 132, y: 130 }, { x: 141, y: 149 }, { x: 129, y: 171 }, { x: 135, y: 191 }], width, height) }];
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
    const forest = ((x - 149) / 57) ** 2 + ((y - 36) / 57) ** 2 < 1 + wave
      || ((x - 106) / 23) ** 2 + ((y - 106) / 74) ** 2 < .75 + wave
      || x < 12 + Math.sin(y / 17 + phase) * 7 && y > 30;
    ground[y * width + x] = forest ? 'f' : 'g';
    let riverDistance = Infinity;
    for (const segment of riverRows[y]!) if (x >= segment.minX && x <= segment.maxX) riverDistance = Math.min(riverDistance, segmentDistance({ x, y }, segment.a, segment.b));
    const lake = ((x - 172) / 13) ** 2 + ((y - 91) / 10) ** 2;
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
  const waterMask = Uint8Array.from(ground, code => code === 'w' ? 1 : 0), bridgeCorridors = new Uint8Array(total);
  const baseClear = (point: LivePoint): boolean => inside(point) && !blocked[key(point)];
  const clear = (point: LivePoint): boolean => baseClear(point) && (!waterMask[key(point)] || Boolean(bridgeCorridors[key(point)]));

  // Transport may cross the fixed channel only inside the three authored bridge corridors.
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
        if (!blocked[cell] && (!waterMask[cell] || bridgeCorridors[cell]) && segmentDistance({ x, y }, start, end) <= pathWidth / 2 && (!footprints[cell] || ground[cell] === 'w')) ground[cell] = code;
      }
    }
    // Centre cells of a connection remain traversable even at a doorway or bridge.
    for (const point of points) if (ground[key(point)] === 'w' && bridgeCorridors[key(point)]) ground[key(point)] = code;
  };
  const connect = (a: LivePoint, b: LivePoint, id: string, kind: 'road' | 'trail' = 'road', name?: string): LivePoint[] => {
    const cells = route(a, b), points = simplify(cells), pathWidth = kind === 'trail' ? 2 : 3.5;
    paint(cells, pathWidth, kind === 'trail' ? 'p' : 'r');
    paths.push({ id, name: name ?? (kind === 'trail' ? 'Пешеходная тропа' : 'Местная дорога'), kind, width: pathWidth, points });
    return cells;
  };
  const nodes = world.pois.map(poi => poi.entrances[0]!).concat(world.extracts), linked = new Set([0]);
  const nearestClear = (point: LivePoint): LivePoint => { for (let radius = 0; radius < 24; radius++) for (let y = point.y - radius; y <= point.y + radius; y++) for (let x = point.x - radius; x <= point.x + radius; x++) if (clear({ x, y }) && !footprints[y * width + x]) return { x, y }; throw new Error('Transport corridor has no clear port'); };
  const approaches: Array<{ deck: LivePoint[]; id: string; name: string }> = [];
  const crossings = [
    { id: 'bridge-mill', name: 'Лесопильная переправа', x: 150, y: 98, kind: 'road' as const },
    { id: 'bridge-stone', name: 'Каменный мост', x: 134, y: 134, kind: 'road' as const },
    { id: 'bridge-meadow', name: 'Луговой настил', x: 132, y: 173, kind: 'trail' as const },
  ];
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
  // Choose the three sites together: one valid early deck must not consume the only
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
  if (!decks) throw new Error('No three clear banks for authored crossings');
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
    connect(nodes[first]!, nodes[second]!, `road-${connection++}`, world.pois[second]?.districtId === 'sawmill' ? 'trail' : 'road'); linked.add(second);
  }
  // The freight roads connect district clusters; extra forest paths create flank approaches.
  for (const [a, b] of [[0, 5], [1, 9], [4, 12], [6, 10], [9, 14], [10, 15], [16, 21], [18, 22], [20, 25], [23, 27], [24, 29], [26, 30]] as const) connect(nodes[a]!, nodes[b]!, `road-${connection++}`);
  for (const poi of world.pois) for (let index = 1; index < poi.entrances.length; index++) connect(poi.entrances[0]!, poi.entrances[index]!, `access-${poi.id}-${index}`, 'trail');
  const highways = [
    { id: 'highway-north', name: 'Северный грузовой тракт', points: [{ x: 8, y: 25 }, { x: 55, y: 33 }, { x: 95, y: 48 }, { x: 125, y: 64 }, { x: 166, y: 48 }, { x: 184, y: 10 }] },
    { id: 'highway-cargo', name: 'Грузовой проспект', points: [{ x: 10, y: 174 }, { x: 49, y: 145 }, { x: 70, y: 110 }, { x: 103, y: 87 }, { x: 137, y: 71 }] },
    { id: 'trail-meadows', name: 'Обход через луга', points: [{ x: 47, y: 185 }, { x: 96, y: 166 }, { x: 116, y: 173 }, { x: 148, y: 175 }, { x: 180, y: 182 }] },
  ];
  for (const highway of highways) {
    const cells: LivePoint[] = [];
    for (let index = 1; index < highway.points.length; index++) cells.push(...route(nearestClear(highway.points[index - 1]!), nearestClear(highway.points[index]!)).slice(index === 1 ? 0 : 1));
    const trail = highway.id.startsWith('trail'), pathWidth = trail ? 2 : 4;
    paint(cells, pathWidth, trail ? 'p' : 'r'); paths.push({ id: highway.id, name: highway.name, kind: trail ? 'trail' : 'road', width: pathWidth, points: simplify(cells) });
  }
  const railPoints = [{ x: 1, y: 176 }, { x: 29, y: 159 }, { x: 59, y: 136 }, { x: 79, y: 108 }, { x: 98, y: 84 }, { x: 125, y: 67 }, { x: 155, y: 55 }, { x: 190, y: 32 }];
  const rail: LivePoint[] = [];
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
