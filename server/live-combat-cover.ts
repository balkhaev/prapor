import type { LivePoint } from '../src/game/live';

export const LIVE_COVER_SEARCH_STEPS = 6;
export const LIVE_COVER_CONTACT_MS = 6000;
export interface LiveCoverPlan { covered: LivePoint; peek: LivePoint; route: LivePoint[] }
interface CoverGeometry {
  clear(point: LivePoint): boolean;
  hasLineOfSight(from: LivePoint, to: LivePoint): boolean;
  permitted?(point: LivePoint): boolean;
  /** A compromised firing corner must be replaced, not selected again at zero cost. */
  avoid?: readonly LivePoint[];
  solid?(point: LivePoint): boolean;
}
const adjacent = (point: LivePoint): LivePoint[] => [
  { x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y },
  { x: point.x, y: point.y - 1 }, { x: point.x, y: point.y + 1 },
];
const distance = (a: LivePoint, b: LivePoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** A small physical detour, not a cover percentage. Water cannot hide a fighter:
 * the authoritative sight ray must be blocked, and an adjacent firing tile must
 * have a clear ray. Breadth first search bounds both work and the walking route. */
export function findLiveCombatCover(start: LivePoint, observedThreat: LivePoint, range: number, geometry: CoverGeometry): LiveCoverPlan | null {
  if (distance(start, observedThreat) <= 2) return null;
  const key = (point: LivePoint): string => `${point.x},${point.y}`;
  const nodes = [{ point: { x: start.x, y: start.y }, parent: -1, steps: 0, exposure: 0 }];
  const visited = new Set([key(start)]);
  let best: { node: number; peek: LivePoint; score: number } | null = null;
  for (let cursor = 0; cursor < nodes.length; cursor++) {
    const node = nodes[cursor]!, hidden = !geometry.hasLineOfSight(node.point, observedThreat);
    if (hidden && !geometry.avoid?.some(point => distance(point, node.point) < 1.5)) {
      const peek = adjacent(node.point).filter(point => geometry.clear(point) && (geometry.permitted?.(point) ?? true)
        && distance(point, observedThreat) > 2 && distance(point, observedThreat) <= range
        && geometry.hasLineOfSight(point, observedThreat))
        .sort((a, b) => distance(b, observedThreat) - distance(a, observedThreat))[0];
      if (peek) {
        // Get against the protecting object instead of crouching several cells
        // out in its geometric shadow. This changes preference, never collision.
        const againstCover = adjacent(node.point).some(point => geometry.solid?.(point) ?? !geometry.clear(point));
        const score = node.steps + node.exposure * .35 + (againstCover ? 0 : 10)
          + Math.max(0, range * .65 - distance(peek, observedThreat)) * 2;
        if (!best || score < best.score) best = { node: cursor, peek, score };
      }
    }
    if (node.steps >= LIVE_COVER_SEARCH_STEPS) continue;
    for (const point of adjacent(node.point)) {
      const pointKey = key(point);
      if (visited.has(pointKey) || !geometry.clear(point) || !(geometry.permitted?.(point) ?? true)) continue;
      visited.add(pointKey);
      nodes.push({ point, parent: cursor, steps: node.steps + 1, exposure: node.exposure + Number(!hidden) });
    }
  }
  if (!best) return null;
  const route: LivePoint[] = [];
  for (let index = best.node; nodes[index]!.parent !== -1; index = nodes[index]!.parent) route.push(nodes[index]!.point);
  return { covered: nodes[best.node]!.point, peek: best.peek, route: route.reverse() };
}
