import type { LiveObstacle, LivePoint, LiveWorld, LiveWorldProp } from './live';
import { LIVE_WORLD_LIMITS } from './live-world-limits';

type Rect = LivePoint & { width: number; height: number };
type StreetWorld = Pick<LiveWorld, 'width' | 'height' | 'terrainRows' | 'paths' | 'obstacles' | 'props' | 'extracts' | 'city' | 'citySites' | 'districts' | 'pois' | 'containers'> & {
  npcSpawns: Array<{ point: LivePoint; route: LivePoint[] }>;
};
const hash = (text: string): number => { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; };
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const inRect = (p: LivePoint, r: Rect): boolean => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
const distanceToRect = (point: LivePoint, rect: Rect): number => Math.hypot(Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width), Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height));

/** A separate final pass keeps every older scenery identity and seeded draw intact.
 * Parking pockets sit beyond the continuous pavement, never on the carriageway.
 * Every new solid has a free one-cell ring, so it cannot split a walkable area. */
export function generateStreetFurniture(world: StreetWorld, seed: string, exclude: Rect): { props: LiveWorldProp[]; obstacles: LiveObstacle[]; terrainRows: string[] } {
  const { width, height } = world, total = width * height;
  const props: LiveWorldProp[] = [], obstacles: LiveObstacle[] = [], terrainRows = [...world.terrainRows ?? []];
  const budget = Math.min(176, Math.max(0, LIVE_WORLD_LIMITS.props - (world.props?.length ?? 0)), Math.max(0, LIVE_WORLD_LIMITS.obstacles - world.obstacles.length));
  if (!world.city || !budget || terrainRows.length !== height) return { props, obstacles, terrainRows };
  const physical = new Uint8Array(total), occupied = new Uint8Array(total), reserved = new Uint8Array(total);
  const cells = (rect: Rect, visit: (index: number) => void, margin = 0): void => {
    for (let y = Math.max(0, Math.floor(rect.y - margin)); y < Math.min(height, Math.ceil(rect.y + rect.height + margin)); y++)
      for (let x = Math.max(0, Math.floor(rect.x - margin)); x < Math.min(width, Math.ceil(rect.x + rect.width + margin)); x++) visit(y * width + x);
  };
  for (const obstacle of world.obstacles) cells(obstacle, index => { physical[index] = 1; });
  for (const building of world.citySites?.flatMap(site => site.buildings) ?? []) cells(building, index => { physical[index] = 1; });
  for (const prop of world.props ?? []) cells(prop, index => { occupied[index] = 1; });
  const protect = (point: LivePoint, radius: number): void => cells({ x: point.x - radius, y: point.y - radius, width: radius * 2 + 1, height: radius * 2 + 1 }, index => { reserved[index] = 1; });
  const protectLine = (a: LivePoint, b: LivePoint, radius: number): void => {
    const dx = b.x - a.x, dy = b.y - a.y, span2 = dx * dx + dy * dy;
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 1)), maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + radius + 1));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 1)), maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + radius + 1));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const t = span2 ? Math.max(0, Math.min(1, ((x + .5 - a.x) * dx + (y + .5 - a.y) * dy) / span2)) : 0;
      if (Math.hypot(x + .5 - a.x - dx * t, y + .5 - a.y - dy * t) < radius + .71) reserved[y * width + x] = 1;
    }
  };
  world.extracts.forEach(point => protect(point, 5));
  world.districts.flatMap(district => district.spawns).forEach(point => protect(point, 5));
  world.containers.forEach(point => protect(point, 2));
  world.pois.flatMap(poi => poi.entrances).forEach(point => protect(point, 2));
  for (const site of world.citySites ?? []) {
    site.buildings.flatMap(building => building.entrances).forEach(point => protect(point, 2));
    for (const passage of site.passages) for (let i = 1; i < passage.length; i++) protectLine(passage[i - 1]!, passage[i]!, 1.5);
  }
  for (const spawn of world.npcSpawns) {
    protect(spawn.point, 2);
    for (const point of spawn.route) protect(point, 2);
  }
  for (const path of world.paths ?? []) {
    for (let i = 1; i < path.points.length; i++) protectLine(path.points[i - 1]!, path.points[i]!, path.width / 2 + (path.kind === 'road' ? 1.5 : 1));
    // Access roads meet collectors at declared vertices. Keep junction corners
    // and pedestrian approaches open, including joins in a longer polyline.
    if (path.kind === 'road') path.points.forEach(point => protect(point, Math.max(5, path.width)));
  }
  const buildings = world.citySites?.flatMap(site => site.buildings) ?? [];
  const stops: LivePoint[] = [], quarterCounts = new Map<string, number>();
  const add = (kind: 'car' | 'van' | 'bus-stop', center: LivePoint, streetCenter: LivePoint, orientation: 'x' | 'y', id: string): boolean => {
    if (props.length >= budget) return false;
    const long = kind === 'bus-stop' ? 4 : 3, short = kind === 'car' ? 1 : 2;
    const rect = { x: Math.round(center.x - (orientation === 'x' ? long : short) / 2), y: Math.round(center.y - (orientation === 'x' ? short : long) / 2), width: orientation === 'x' ? long : short, height: orientation === 'x' ? short : long };
    const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    if (rect.x < 3 || rect.y < 3 || rect.x + rect.width > width - 3 || rect.y + rect.height > height - 3 || intersects(rect, exclude) || !inRect(middle, world.city!)) return false;
    const quarter = world.city!.quarters.find(quarter => inRect(middle, quarter));
    if (!quarter || (quarterCounts.get(quarter.id) ?? 0) >= 18 || !buildings.some(building => distanceToRect(middle, building) < 23)) return false;
    if (kind === 'bus-stop' && stops.some(stop => Math.hypot(stop.x - middle.x, stop.y - middle.y) < 50)) return false;
    let suitable = true;
    cells(rect, index => {
      const code = terrainRows[Math.floor(index / width)]![index % width];
      if (physical[index] || occupied[index] || reserved[index] || !code || !'cygs'.includes(code)) suitable = false;
    });
    cells(rect, index => { if (physical[index]) suitable = false; }, 1);
    if (!suitable) return false;
    const prop: LiveWorldProp = { ...rect, id, kind, orientation, variant: hash(`${seed}:${id}`) % 4, blocking: true };
    props.push(prop);
    obstacles.push({ ...rect, kind: 'container', label: kind === 'bus-stop' ? 'Остановочный павильон' : kind === 'van' ? 'Припаркованный фургон' : 'Припаркованная машина', propId: id });
    cells(rect, index => { physical[index] = 1; occupied[index] = 1; });
    // Carry the small apron to the existing pavement. Parking has a real paved
    // approach rather than an isolated slab in the verge. Never replace asphalt,
    // paths, trees, old furniture, interiors or a cell of the preserved core.
    const pave = (index: number): void => {
      const y = Math.floor(index / width), x = index % width, row = terrainRows[y]!;
      if (inRect({ x, y }, exclude) || !'cygs'.includes(row[x] ?? '') || physical[index] && !inRect({ x, y }, rect) || occupied[index] && !inRect({ x, y }, rect)) return;
      terrainRows[y] = row.slice(0, x) + 'c' + row.slice(x + 1);
    };
    const approach = orientation === 'x'
      ? { x: rect.x, y: Math.floor(Math.min(rect.y, streetCenter.y)), width: rect.width, height: Math.ceil(Math.max(rect.y + rect.height, streetCenter.y)) - Math.floor(Math.min(rect.y, streetCenter.y)) }
      : { x: Math.floor(Math.min(rect.x, streetCenter.x)), y: rect.y, width: Math.ceil(Math.max(rect.x + rect.width, streetCenter.x)) - Math.floor(Math.min(rect.x, streetCenter.x)), height: rect.height };
    cells(approach, pave);
    cells(rect, pave, 1);
    quarterCounts.set(quarter.id, (quarterCounts.get(quarter.id) ?? 0) + 1);
    if (kind === 'bus-stop') stops.push(middle);
    return true;
  };
  const streets = (world.paths ?? []).filter(path => path.kind === 'road' && path.width >= 3 && path.id.startsWith('metro-'));
  // Shelters get their sparse, serviced positions before parked vehicles.
  for (const path of streets) {
    if (path.width < 4 || stops.length >= 16) continue;
    let placed = 0;
    for (let i = 1; i < path.points.length && stops.length < 16 && placed < 4; i++) {
      const a = path.points[i - 1]!, b = path.points[i]!, dx = b.x - a.x, dy = b.y - a.y, span = Math.hypot(dx, dy);
      for (let at = 18; at < span - 14 && stops.length < 16 && placed < 4; at += 19) {
        const orientation = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y', side = hash(`${seed}:stop:${path.id}:${i}:${at}`) % 2 ? 1 : -1;
        for (const offsetSide of [side, -side]) {
          const offset = path.width / 2 + 5;
          const streetCenter = { x: a.x + dx * at / span, y: a.y + dy * at / span };
          if (add('bus-stop', { x: streetCenter.x - dy / span * offset * offsetSide, y: streetCenter.y + dx / span * offset * offsetSide }, streetCenter, orientation, `street-stop:${path.id}:${i}:${at}`)) { placed++; break; }
        }
      }
    }
  }
  let vehicles = 0;
  for (const path of streets) {
    let placed = 0;
    for (let i = 1; i < path.points.length && vehicles < 160 && placed < 32; i++) {
      const a = path.points[i - 1]!, b = path.points[i]!, dx = b.x - a.x, dy = b.y - a.y, span = Math.hypot(dx, dy);
      const phase = hash(`${seed}:${path.id}:${i}`) % 6;
      for (let at = 11 + phase; at < span - 9 && vehicles < 160 && placed < 32; at += 13) for (const side of [-1, 1]) {
        if (vehicles >= 160 || placed >= 32) break;
        const id = `street-park:${path.id}:${i}:${at}:${side}`, roll = hash(`${seed}:${id}`), kind = roll % 5 === 0 ? 'van' : 'car';
        const orientation = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y', offset = path.width / 2 + (kind === 'car' ? 4.3 : 5);
        const streetCenter = { x: a.x + dx * at / span, y: a.y + dy * at / span };
        if (add(kind, { x: streetCenter.x - dy / span * offset * side, y: streetCenter.y + dx / span * offset * side }, streetCenter, orientation, id)) { vehicles++; placed++; }
      }
    }
  }
  return { props, obstacles, terrainRows };
}
