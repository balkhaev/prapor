import type { LivePoint } from './game/live';
import type { RaidFieldFrame, RaidFieldPlan } from './raid-field';

export type MinimapRect = { x: number; y: number; width: number; height: number };
export type MinimapLayout = MinimapRect & { scale: number };

/** A single world unit has the same size on both map axes. */
export function fitMinimap(world: { width: number; height: number }, area: MinimapRect): MinimapLayout {
  const scale = Math.min(area.width / world.width, area.height / world.height);
  const width = world.width * scale, height = world.height * scale;
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height, scale };
}
export const minimapPoint = (layout: MinimapLayout, point: LivePoint): LivePoint => ({ x: layout.x + point.x * layout.scale, y: layout.y + point.y * layout.scale });

/** Clip the true camera polygon before painting it; an off-map camera never
 * produces a false rectangular view at the nearest map edge. */
export function minimapViewport(world: { width: number; height: number }, corners: readonly LivePoint[], layout: MinimapLayout): LivePoint[] {
  let polygon = corners.map(point => ({ ...point }));
  for (const [axis, edge, greater] of [['x', 0, true], ['x', world.width, false], ['y', 0, true], ['y', world.height, false]] as const) {
    const output: LivePoint[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      const aInside = greater ? a[axis] >= edge : a[axis] <= edge, bInside = greater ? b[axis] >= edge : b[axis] <= edge;
      if (aInside) output.push(a);
      if (aInside !== bInside) {
        const fraction = (edge - a[axis]) / (b[axis] - a[axis]);
        output.push({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
      }
    }
    polygon = output;
  }
  return polygon.map(point => minimapPoint(layout, point));
}

/** Only completed geometry and the travelled part of the current paid segment
 * are revealed. Unequal edge lengths and corners retain their real distance. */
export function raidMinimapTrail(plan: RaidFieldPlan, frame: Pick<RaidFieldFrame, 'segmentIndex' | 'segmentProgress' | 'position'>): LivePoint[] {
  const result: LivePoint[] = [];
  const append = (point: LivePoint) => { const previous = result.at(-1); if (!previous || previous.x !== point.x || previous.y !== point.y) result.push({ x: point.x, y: point.y }); };
  for (const segment of plan.segments.slice(0, frame.segmentIndex)) for (const point of segment.path) append(point);
  const path = plan.segments[frame.segmentIndex]?.path ?? [];
  if (path[0]) append(path[0]);
  const lengths = path.slice(1).map((point, i) => Math.hypot(point.x - path[i]!.x, point.y - path[i]!.y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * Math.max(0, Math.min(1, frame.segmentProgress));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining < lengths[i]!) break;
    append(path[i + 1]!); remaining -= lengths[i]!;
  }
  append(frame.position);
  return result;
}
