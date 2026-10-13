import type { LivePoint, LiveWorld } from "../src/game/live";

interface Node { cell: number; score: number; cost: number }
/** Immutable collision data and bounded A*. Runtime entities keep the resulting route. */
export function createLiveNavigation(world: LiveWorld) {
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
  let epoch = 0;
  const findPath = (start: LivePoint, target: LivePoint, occupied: ReadonlySet<number> = new Set()): LivePoint[] | null => {
    if (!walkable(start) || !walkable(target) || occupied.has(key(target))) return null;
    const initial = key(start), end = key(target);
    if (initial === end) return [];
    epoch = (epoch + 1) >>> 0;
    if (!epoch) { touched.fill(0); visited.fill(0); epoch = 1; }
    const currentEpoch = epoch;
    const heap: Node[] = [];
    // With equal f scores, finish a deeper candidate before exploring an entire
    // Manhattan plateau. The admissible heuristic and shortest-path costs stay intact.
    const precedes = (a: Node, b: Node): boolean => a.score < b.score || a.score === b.score && a.cost > b.cost;
    const push = (node: Node): void => {
      let index = heap.length; heap.push(node);
      while (index > 0) {
        const parent = (index - 1) >>> 1;
        if (!precedes(node, heap[parent]!)) break;
        heap[index] = heap[parent]!; index = parent;
      }
      heap[index] = node;
    };
    const pop = (): Node | undefined => {
      const first = heap[0], last = heap.pop();
      if (!heap.length || !last) return first;
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        const left = index * 2 + 1, right = left + 1;
        const child = right < heap.length && precedes(heap[right]!, heap[left]!) ? right : left;
        if (!precedes(heap[child]!, last)) break;
        heap[index] = heap[child]!; index = child;
      }
      heap[index] = last;
      return first;
    };
    const estimate = (cell: number): number => Math.abs(cell % world.width - target.x) + Math.abs(Math.floor(cell / world.width) - target.y);
    const offer = (cell: number, from: number, fromCost: number): void => {
      if (walls[cell] || visited[cell] === currentEpoch || occupied.has(cell)) return;
      const cost = fromCost + 1;
      if (touched[cell] === currentEpoch && cost >= costs[cell]!) return;
      touched[cell] = currentEpoch; costs[cell] = cost; parents[cell] = from;
      push({ cell, cost, score: cost + estimate(cell) });
    };
    touched[initial] = currentEpoch; costs[initial] = 0; parents[initial] = -1;
    push({ cell: initial, cost: 0, score: estimate(initial) });
    let expanded = 0;
    while (heap.length && expanded < cells) {
      const node = pop()!;
      if (visited[node.cell] === currentEpoch || node.cost !== costs[node.cell]) continue;
      visited[node.cell] = currentEpoch; expanded++;
      if (node.cell === end) {
        const route: LivePoint[] = [];
        for (let cell = end; cell !== initial; cell = parents[cell]!) route.push({ x: cell % world.width, y: Math.floor(cell / world.width) });
        return route.reverse();
      }
      const x = node.cell % world.width, y = Math.floor(node.cell / world.width);
      if (x > 0) offer(node.cell - 1, node.cell, node.cost);
      if (x + 1 < world.width) offer(node.cell + 1, node.cell, node.cost);
      if (y > 0) offer(node.cell - world.width, node.cell, node.cost);
      if (y + 1 < world.height) offer(node.cell + world.width, node.cell, node.cost);
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
  return { key, walkable, findPath, hasLineOfSight };
}
