import type { LivePoint, LiveWorld } from './live';

type Rect = LivePoint & { width: number; height: number };
export interface WorldBuildingEnvelope extends Rect {
  id: string; poiId: string; templateId: string; name: string;
  entrances: LivePoint[]; roofAxis: 'x' | 'y';
}

/** Exact six-piece perimeter walls and opposing door gaps identify a real roofed hall.
 * Coordinate rounding may overlap corner pieces by up to two cells after shrinking.
 * Metadata rectangles or partial courtyard fences alone never identify an interior. */
export function legacyHallEnvelopes(world: Pick<LiveWorld, 'pois' | 'obstacles'>): WorldBuildingEnvelope[] {
  const result: WorldBuildingEnvelope[] = [];
  for (const poi of world.pois) {
    if (!['workshop', 'sawmill', 'depot', 'greenhouse', 'city-hospital', 'city-police', 'city-mall', 'city-tram'].includes(poi.templateId)) continue;
    const walls = world.obstacles.filter(wall => wall.kind === 'wall' && wall.x >= poi.x && wall.y >= poi.y && wall.x + wall.width <= poi.x + poi.width && wall.y + wall.height <= poi.y + poi.height);
    const candidates: Rect[] = [];
    for (const a of walls) for (const b of walls) {
      if (a === b) continue;
      if (a.width === 1 && b.width === 1 && a.height >= 3 && a.y === b.y && a.height === b.height && b.x - a.x >= 3) {
        const caps = walls.filter(wall => wall.height === 1 && wall.x >= a.x && wall.x + wall.width <= b.x + 1);
        const tops = [...new Set(caps.filter(wall => wall.y <= a.y && wall.y >= a.y - 2).map(wall => wall.y))], bottoms = [...new Set(caps.filter(wall => wall.y >= a.y + a.height - 1 && wall.y <= a.y + a.height + 1).map(wall => wall.y))];
        for (const y of tops) for (const bottom of bottoms) candidates.push({ x: a.x, y, width: b.x - a.x + 1, height: bottom - y + 1 });
      }
      if (a.height === 1 && b.height === 1 && a.width >= 3 && a.x === b.x && a.width === b.width && b.y - a.y >= 3) {
        const caps = walls.filter(wall => wall.width === 1 && wall.y >= a.y && wall.y + wall.height <= b.y + 1);
        const lefts = [...new Set(caps.filter(wall => wall.x <= a.x && wall.x >= a.x - 2).map(wall => wall.x))], rights = [...new Set(caps.filter(wall => wall.x >= a.x + a.width - 1 && wall.x <= a.x + a.width + 1).map(wall => wall.x))];
        for (const x of lefts) for (const right of rights) candidates.push({ x, y: a.y, width: right - x + 1, height: b.y - a.y + 1 });
      }
    }
    const accepted = new Set<string>();
    for (const rect of candidates) {
      if (rect.x < poi.x || rect.y < poi.y || rect.x + rect.width > poi.x + poi.width || rect.y + rect.height > poi.y + poi.height) continue;
      const horizontal = [rect.y, rect.y + rect.height - 1].map(y => walls.filter(wall => wall.height === 1 && wall.y === y && wall.x >= rect.x && wall.x + wall.width <= rect.x + rect.width).sort((a, b) => a.x - b.x));
      const vertical = [rect.x, rect.x + rect.width - 1].map(x => walls.filter(wall => wall.width === 1 && wall.x === x && wall.y >= rect.y && wall.y + wall.height <= rect.y + rect.height).sort((a, b) => a.y - b.y));
      const sideVertical = vertical.map(parts => parts.filter(wall => wall.height >= 3)), sideHorizontal = horizontal.map(parts => parts.filter(wall => wall.width >= 3));
      const horizontalHall = horizontal.every(parts => parts.length === 2 && parts[0]!.x === rect.x && parts[1]!.x + parts[1]!.width === rect.x + rect.width && parts[0]!.x + parts[0]!.width < parts[1]!.x)
        && sideVertical.every(parts => parts.length === 1 && parts[0]!.y <= rect.y + 2 && parts[0]!.y + parts[0]!.height >= rect.y + rect.height - 2);
      const verticalHall = vertical.every(parts => parts.length === 2 && parts[0]!.y === rect.y && parts[1]!.y + parts[1]!.height === rect.y + rect.height && parts[0]!.y + parts[0]!.height < parts[1]!.y)
        && sideHorizontal.every(parts => parts.length === 1 && parts[0]!.x <= rect.x + 2 && parts[0]!.x + parts[0]!.width >= rect.x + rect.width - 2);
      if (!horizontalHall && !verticalHall) continue;
      const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`; if (accepted.has(key)) continue;
      accepted.add(key);
      const entrances = horizontalHall ? horizontal.map(parts => ({ x: (parts[0]!.x + parts[0]!.width + parts[1]!.x - 1) / 2 - .5, y: parts[0]!.y }))
        : vertical.map(parts => ({ x: parts[0]!.x, y: (parts[0]!.y + parts[0]!.height + parts[1]!.y - 1) / 2 - .5 }));
      result.push({ ...rect, id: `hall-${poi.id}-${accepted.size}-${poi.templateId}`, name: walls.find(wall => wall.label && wall.x >= rect.x && wall.y >= rect.y && wall.x < rect.x + rect.width && wall.y < rect.y + rect.height)?.label ?? poi.name,
        poiId: poi.id, templateId: poi.templateId, roofAxis: rect.width >= rect.height ? 'x' : 'y', entrances });
    }
  }
  return result;
}
