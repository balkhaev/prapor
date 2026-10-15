import type { LivePoint, LiveTerrain } from './game/live';
import type { WorldSunlight } from './world-ambience';
import { groundShadowWorldVector } from './live-ground-shadows';

type Sun = Pick<WorldSunlight, 'direction' | 'intensity'>;
type Actor = LivePoint & { health: number };
type Ground = { width: number; height: number; terrain: readonly LiveTerrain[]; indoor: Uint8Array };

/** A small standing body and head project onto the same sun plane as the city.
 * Coordinates follow the ground raster, with the actor at its cell's centre. */
export function actorGroundShadowOutline(actor: Actor, sun: Sun): LivePoint[] {
  if (actor.health <= 0 || !Number.isFinite(actor.x + actor.y) || !Number.isFinite(sun.intensity) || sun.intensity <= .001) return [];
  const direction = groundShadowWorldVector(sun), vector = { x: direction.x * .82, y: direction.y * .82 }, length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length < .01) return [];
  const nx = -vector.y / length, ny = vector.x / length;
  return [[0, .2], [.68, .22], [.96, .14], [1.11, 0], [.96, -.14], [.68, -.22], [0, -.2], [-.025, 0]].map(([along, across]) => ({
    x: actor.x + .5 + vector.x * along! + nx * across!, y: actor.y + .5 + vector.y * along! + ny * across!,
  }));
}

/** Only already-visible actors are supplied. Local receiver cells are sampled
 * for at most 128 bodies; the million-cell map is never scanned in a frame. */
export function paintActorGroundShadows(c: CanvasRenderingContext2D, actors: readonly Actor[], sun: Sun, ground: Ground): void {
  if (sun.intensity <= .001) return;
  const shapes: LivePoint[][] = [], receivers = new Set<number>();
  for (const actor of actors.slice(0, 128)) {
    const cx = Math.floor(actor.x + .5), cy = Math.floor(actor.y + .5), cell = cy * ground.width + cx;
    if (cx < 0 || cy < 0 || cx >= ground.width || cy >= ground.height || ground.indoor[cell] || ground.terrain[cell] === 'water') continue;
    const points = actorGroundShadowOutline(actor, sun);
    if (!points.length) continue;
    shapes.push(points);
    const left = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)))), right = Math.min(ground.width, Math.ceil(Math.max(...points.map(p => p.x))));
    const top = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)))), bottom = Math.min(ground.height, Math.ceil(Math.max(...points.map(p => p.y))));
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const at = y * ground.width + x;
      if (!ground.indoor[at] && ground.terrain[at] && ground.terrain[at] !== 'water') receivers.add(at);
    }
  }
  if (!shapes.length || !receivers.size) return;
  c.save(); c.beginPath();
  for (const cell of receivers) c.rect(cell % ground.width, Math.floor(cell / ground.width), 1, 1);
  c.clip(); c.beginPath();
  for (const points of shapes) { points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); }
  c.fillStyle = '#1d3634'; c.globalAlpha = Math.min(1, Math.max(0, sun.intensity)) * .19; c.fill(); c.restore();
}
