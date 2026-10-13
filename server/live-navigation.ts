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
  const findPath = (start: LivePoint, target: LivePoint, occupied: ReadonlySet<number> = new Set()): LivePoint[] | null => {
    if (!walkable(start) || !walkable(target) || occupied.has(key(target))) return null;
    const initial = key(start), end = key(target);
    if (initial === end) return [];
    const costs = new Int32Array(cells).fill(0x7fffffff), parents = new Int32Array(cells).fill(-1), visited = new Uint8Array(cells);
    const heap: Node[] = [];
    const push = (node: Node): void => {
      let index = heap.length; heap.push(node);
      while (index > 0) {
        const parent = (index - 1) >>> 1;
        if (heap[parent]!.score <= node.score) break;
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
        const child = right < heap.length && heap[right]!.score < heap[left]!.score ? right : left;
        if (last.score <= heap[child]!.score) break;
        heap[index] = heap[child]!; index = child;
      }
      heap[index] = last;
      return first;
    };
    const estimate = (cell: number): number => Math.abs(cell % world.width - target.x) + Math.abs(Math.floor(cell / world.width) - target.y);
    costs[initial] = 0; push({ cell: initial, cost: 0, score: estimate(initial) });
    let expanded = 0;
    while (heap.length && expanded < cells) {
      const node = pop()!;
      if (visited[node.cell] || node.cost !== costs[node.cell]) continue;
      visited[node.cell] = 1; expanded++;
      if (node.cell === end) {
        const route: LivePoint[] = [];
        for (let cell = end; cell !== initial; cell = parents[cell]!) route.push({ x: cell % world.width, y: Math.floor(cell / world.width) });
        return route.reverse();
      }
      const x = node.cell % world.width, y = Math.floor(node.cell / world.width);
      for (const cell of [x > 0 ? node.cell - 1 : -1, x + 1 < world.width ? node.cell + 1 : -1, y > 0 ? node.cell - world.width : -1, y + 1 < world.height ? node.cell + world.width : -1]) {
        if (cell < 0 || walls[cell] || visited[cell] || occupied.has(cell)) continue;
        const cost = node.cost + 1;
        if (cost >= costs[cell]!) continue;
        costs[cell] = cost; parents[cell] = node.cell;
        push({ cell, cost, score: cost + estimate(cell) });
      }
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
