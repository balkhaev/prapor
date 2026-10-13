import type { LiveMapId, LivePoint, LiveWorld } from './live';
import { generateLiveWorld, validateGeneratedWorld } from './world-generation';
export interface LiveNpcSpawn {
  point: LivePoint; faction: 'scavs' | 'raiders'; role: 'patrol' | 'guard' | 'marksman'; route: LivePoint[];
}
export interface LiveMapDefinition extends LiveWorld { npcSpawns: LiveNpcSpawn[]; lootSpawns: LivePoint[] }
const perimeter = generateLiveWorld();
validateGeneratedWorld(perimeter);
export const LIVE_MAPS: readonly LiveMapDefinition[] = [perimeter];
export const isLiveMapId = (value: unknown): value is LiveMapId => value === 'perimeter';
export const getLiveMap = (id: LiveMapId): LiveMapDefinition => LIVE_MAPS.find(map => map.id === id)!;
export function isLiveWalkable(world: LiveWorld, { x, y }: LivePoint): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.width && y < world.height && world.terrainRows?.[y]?.[x] !== 'w' && !world.obstacles.some(wall => x >= wall.x && x < wall.x + wall.width && y >= wall.y && y < wall.y + wall.height);
}

/** Water stops movement but leaves the opposite bank visible. */
const rayClear = (world: LiveWorld, { x, y }: LivePoint): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.width && y < world.height && !world.obstacles.some(wall => wall.kind !== 'water' && x >= wall.x && x < wall.x + wall.width && y >= wall.y && y < wall.y + wall.height);

/** Supercover ray: a corner crossed between two cells cannot bypass either wall. */
export function hasLiveLineOfSight(world: LiveWorld, a: LivePoint, b: LivePoint): boolean {
  if (!isLiveWalkable(world, a) || !isLiveWalkable(world, b)) return false;
  let x = a.x, y = a.y;
  const dx = b.x - a.x, dy = b.y - a.y, sx = Math.sign(dx), sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx), deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let maxX = deltaX / 2, maxY = deltaY / 2;
  while (x !== b.x || y !== b.y) {
    if (Math.abs(maxX - maxY) < 1e-10) {
        if (!rayClear(world, { x: x + sx, y }) || !rayClear(world, { x, y: y + sy })) return false;
      x += sx; y += sy; maxX += deltaX; maxY += deltaY;
    } else if (maxX < maxY) { x += sx; maxX += deltaX; }
    else { y += sy; maxY += deltaY; }
    if (!rayClear(world, { x, y })) return false;
  }
  return true;
}
