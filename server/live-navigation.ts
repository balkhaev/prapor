import type { LivePoint, LiveWorld } from "../src/game/live";
import { LIVE_WORLD_LIMITS } from "../src/game/live-world-limits";

/** Immutable collision data and bounded A*. Runtime entities keep the resulting route. */
export function createLiveNavigation(world: LiveWorld) {
  if (![world.width, world.height].every(side => Number.isInteger(side) && side >= 2 && side <= LIVE_WORLD_LIMITS.side)) throw new Error('live_navigation_bounds');
  const cells = world.width * world.height, walls = new Uint8Array(cells), sightWalls = new Uint8Array(cells);
  for (const obstacle of world.obstacles) for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) {
    walls[y * world.width + x] = 1;
    if (obstacle.kind !== 'water') sightWalls[y * world.width + x] = 1;
  }
  if (world.terrainRows) for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) if (world.terrainRows[y]?.[x] === 'w') walls[y * world.width + x] = 1;
  const key = (point: LivePoint): number => point.y * world.width + point.x;
  const walkable = (point: LivePoint): boolean => Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.y >= 0 && point.x < world.width && point.y < world.height && walls[key(point)] === 0;
  const rayClear = (point: LivePoint): boolean => Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.y >= 0 && point.x < world.width && point.y < world.height && sightWalls[key(point)] === 0;
  // Searches are synchronous. Epochs reuse storage without clearing the entire world
  // for every NPC or player order; only entries stamped by this search are readable.
  const costs = new Int32Array(cells), parents = new Int32Array(cells), touched = new Uint32Array(cells), visited = new Uint32Array(cells);
  const components = new Uint32Array(cells), heap = new Int32Array(cells), positions = new Int32Array(cells);
  // Label static regions once. An unreachable destination must not make each
  // idle NPC exhaust a million cells on every retry. Reuse the heap as BFS storage.
  let component = 0;
  for (let initial = 0; initial < cells; initial++) {
    if (walls[initial] || components[initial]) continue;
    component++;
    let count = 1; heap[0] = initial; components[initial] = component;
    const enqueue = (cell: number): void => {
      if (!walls[cell] && !components[cell]) { components[cell] = component; heap[count++] = cell; }
    };
    for (let cursor = 0; cursor < count; cursor++) {
      const cell = heap[cursor]!, x = cell % world.width;
      if (x > 0) enqueue(cell - 1);
      if (x + 1 < world.width) enqueue(cell + 1);
      if (cell >= world.width) enqueue(cell - world.width);
      if (cell + world.width < cells) enqueue(cell + world.width);
    }
  }
  const storageBytes = [walls, sightWalls, costs, parents, touched, visited, components, heap, positions].reduce((total, array) => total + array.byteLength, 0);
  let epoch = 0;
  const nextEpoch = (): number => {
    epoch = (epoch + 1) >>> 0;
    if (!epoch) { touched.fill(0); visited.fill(0); epoch = 1; }
    return epoch;
  };
  const routeTo = (initial: number, end: number): LivePoint[] => {
    const route: LivePoint[] = [];
    for (let cell = end; cell !== initial; cell = parents[cell]!) route.push({ x: cell % world.width, y: Math.floor(cell / world.width) });
    return route.reverse();
  };
  const findPath = (start: LivePoint, target: LivePoint, occupied: ReadonlySet<number> = new Set()): LivePoint[] | null => {
    if (!walkable(start) || !walkable(target) || occupied.has(key(target))) return null;
    const initial = key(start), end = key(target);
    if (initial === end) return [];
    if (components[initial] !== components[end]) return null;
    const currentEpoch = nextEpoch();
    const breadthFirst = (): LivePoint[] | null => {
      // Long detours behind occupied doorways make a Manhattan heuristic weak.
      // Restart as exact unit-cost BFS instead of spending a tick maintaining a
      // million-entry heap. The same bounded buffer becomes a queue.
      const searchEpoch = nextEpoch();
      let count = 1; heap[0] = initial; touched[initial] = searchEpoch; parents[initial] = -1;
      const enqueue = (cell: number, from: number): void => {
        if (walls[cell] || touched[cell] === searchEpoch || occupied.has(cell)) return;
        touched[cell] = searchEpoch; parents[cell] = from; heap[count++] = cell;
      };
      for (let cursor = 0; cursor < count; cursor++) {
        const cell = heap[cursor]!;
        if (cell === end) return routeTo(initial, end);
        const x = cell % world.width;
        if (x > 0) enqueue(cell - 1, cell);
        if (x + 1 < world.width) enqueue(cell + 1, cell);
        if (cell >= world.width) enqueue(cell - world.width, cell);
        if (cell + world.width < cells) enqueue(cell + world.width, cell);
      }
      return null;
    };
    let heapLength = 0;
    const estimate = (cell: number): number => Math.abs(cell % world.width - target.x) + Math.abs(Math.floor(cell / world.width) - target.y);
    // With equal f scores, finish a deeper candidate before exploring an entire
    // Manhattan plateau. The admissible heuristic and shortest-path costs stay intact.
    const precedes = (a: number, b: number): boolean => {
      const scoreA = costs[a]! + estimate(a), scoreB = costs[b]! + estimate(b);
      return scoreA < scoreB || scoreA === scoreB && costs[a]! > costs[b]!;
    };
    // An indexed heap holds each open cell once. Improving a route decreases its
    // key in place, without allocating Node objects or leaving duplicate entries.
    const push = (cell: number, existing: boolean): void => {
      let index = existing ? positions[cell]! : heapLength++;
      while (index > 0) {
        const parent = (index - 1) >>> 1;
        if (!precedes(cell, heap[parent]!)) break;
        heap[index] = heap[parent]!; positions[heap[index]!] = index; index = parent;
      }
      heap[index] = cell; positions[cell] = index;
    };
    const pop = (): number => {
      const first = heap[0]!, last = heap[--heapLength]!;
      positions[first] = -1;
      if (!heapLength) return first;
      let index = 0;
      while (index * 2 + 1 < heapLength) {
        const left = index * 2 + 1, right = left + 1;
        const child = right < heapLength && precedes(heap[right]!, heap[left]!) ? right : left;
        if (!precedes(heap[child]!, last)) break;
        heap[index] = heap[child]!; positions[heap[index]!] = index; index = child;
      }
      heap[index] = last; positions[last] = index;
      return first;
    };
    const offer = (cell: number, from: number, fromCost: number): void => {
      if (walls[cell] || visited[cell] === currentEpoch || occupied.has(cell)) return;
      const cost = fromCost + 1;
      const existing = touched[cell] === currentEpoch;
      if (existing && cost >= costs[cell]!) return;
      touched[cell] = currentEpoch; costs[cell] = cost; parents[cell] = from;
      push(cell, existing);
    };
    touched[initial] = currentEpoch; costs[initial] = 0; parents[initial] = -1;
    push(initial, false);
    let expanded = 0;
    while (heapLength && expanded < cells) {
      if (expanded >= 16384) return breadthFirst();
      const node = pop()!;
      visited[node] = currentEpoch; expanded++;
      if (node === end) return routeTo(initial, end);
      const x = node % world.width, y = Math.floor(node / world.width), cost = costs[node]!;
      if (x > 0) offer(node - 1, node, cost);
      if (x + 1 < world.width) offer(node + 1, node, cost);
      if (y > 0) offer(node - world.width, node, cost);
      if (y + 1 < world.height) offer(node + world.width, node, cost);
    }
    return null;
  };
  const hasLineOfSight = (a: LivePoint, b: LivePoint): boolean => {
    if (!walkable(a) || !walkable(b)) return false;
    let x = a.x, y = a.y;
    const dx = b.x - a.x, dy = b.y - a.y, sx = Math.sign(dx), sy = Math.sign(dy);
    const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx), deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
    let maxX = deltaX / 2, maxY = deltaY / 2;
    while (x !== b.x || y !== b.y) {
      if (Math.abs(maxX - maxY) < 1e-10) {
        if (!rayClear({ x: x + sx, y }) || !rayClear({ x, y: y + sy })) return false;
        x += sx; y += sy; maxX += deltaX; maxY += deltaY;
      } else if (maxX < maxY) { x += sx; maxX += deltaX; }
      else { y += sy; maxY += deltaY; }
      if (!rayClear({ x, y })) return false;
    }
    return true;
  };
  const blocksSight = (point: LivePoint): boolean => Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.y >= 0 && point.x < world.width && point.y < world.height && sightWalls[key(point)] === 1;
  return { key, walkable, findPath, hasLineOfSight, blocksSight, storageBytes };
}
