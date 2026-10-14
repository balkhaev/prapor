import type { LiveObstacle, LivePoint, LiveWorld } from './live';
import { cityStreetPlan, regionalStreetPlan } from './world-landscape';

type InfillWorld = Pick<LiveWorld, 'width' | 'height' | 'city' | 'obstacles' | 'pois' | 'extracts' | 'districts' | 'containers'> & {
  streetMask: Uint8Array; npcSpawns: Array<{ point: LivePoint; route: LivePoint[] }>;
};
type Rect = LivePoint & { width: number; height: number };
const hash = (text: string): number => { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; };

/** Small frontage groups extend existing settlements, leaving their original
 * searchable rooms and identities intact. These closed houses are solid cover. */
export function generateDistrictInfill(world: InfillWorld, seed: string): LiveObstacle[] {
  if (!world.city) return [];
  const { width, height } = world, reserved = new Uint8Array(width * height), result: LiveObstacle[] = [];
  const fill = (rect: Rect, margin = 0): void => {
    for (let y = Math.max(0, Math.floor(rect.y - margin)); y < Math.min(height, Math.ceil(rect.y + rect.height + margin)); y++)
      for (let x = Math.max(0, Math.floor(rect.x - margin)); x < Math.min(width, Math.ceil(rect.x + rect.width + margin)); x++) reserved[y * width + x] = 1;
  };
  world.obstacles.forEach(rect => fill(rect, 3)); world.pois.forEach(rect => fill(rect, 2)); fill(world.city, 3);
  fill({ x: width - 82, y: 0, width: 36, height });
  for (let cell = 0; cell < reserved.length; cell++) if (world.streetMask[cell]) reserved[cell] = 1;
  const protect = (point: LivePoint, margin: number) => fill({ ...point, width: 1, height: 1 }, margin);
  [...world.extracts, ...world.districts.flatMap(district => district.spawns)].forEach(point => protect(point, 6));
  world.containers.forEach(point => protect(point, 2));
  world.npcSpawns.flatMap(spawn => [spawn.point, ...spawn.route]).forEach(point => protect(point, 2));
  const streets = [...cityStreetPlan(world.city), ...regionalStreetPlan(width, height, world.city)];
  const nearestStreet = (point: LivePoint) => {
    const candidates = streets.flatMap(street => street.points.slice(1).map((b, index) => {
      const a = street.points[index]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), denominator = length * length;
      const along = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
      const at = { x: a.x + dx * along, y: a.y + dy * along };
      return { at, dx: dx / length, dy: dy / length, width: street.width, distance: Math.hypot(point.x - at.x, point.y - at.y) };
    }));
    return candidates.sort((a, b) => a.distance - b.distance)[0]!;
  };
  const suitable = (rect: Rect, district: InfillWorld['districts'][number]): boolean => {
    if (rect.x < district.x + 3 || rect.y < district.y + 3 || rect.x + rect.width > district.x + district.width - 3 || rect.y + rect.height > district.y + district.height - 3) return false;
    // A free three-cell apron keeps every new rectangle bypassable and its
    // frontage separate from buildings, entrances, extraction and transport.
    for (let y = rect.y - 3; y < rect.y + rect.height + 3; y++) for (let x = rect.x - 3; x < rect.x + rect.width + 3; x++) if (reserved[y * width + x]) return false;
    return true;
  };
  for (const district of world.districts) {
    let placed = 0;
    const candidates = world.pois.filter(poi => poi.districtId === district.id && !poi.tags.includes('city')
      && !['camp', 'logging', 'hunting', 'creekcamp', 'coal', 'containers', 'fuel', 'wagons'].includes(poi.templateId))
      .map(poi => ({ poi, street: nearestStreet({ x: poi.x + poi.width / 2, y: poi.y + poi.height / 2 }) }))
      .sort((a, b) => a.street.distance - b.street.distance || a.poi.id.localeCompare(b.poi.id));
    // Four addresses per existing place make a recognizable small street group.
    // Each district receives the same budget, rather than the first one taking it.
    for (const { poi, street } of candidates) {
      if (placed >= 16) break;
      let local = 0;
      const center = { x: poi.x + poi.width / 2, y: poi.y + poi.height / 2 };
      const firstSide = (center.x - street.at.x) * -street.dy + (center.y - street.at.y) * street.dx >= 0 ? 1 : -1;
      for (const offset of [-18, 18, -34, 34, -50, 50, -66, 66]) for (const side of [firstSide, -firstSide]) for (const setback of [street.width / 2 + 11, street.width / 2 + 25]) {
        if (placed >= 16 || local >= 4) break;
        const industrial = district.id === 'customs', workshop = industrial || district.id === 'depot' && local % 3 === 0;
        const variant = hash(`${seed}:${poi.id}:${local}`), long = workshop ? 12 + variant % 3 : 10 + variant % 3, short = workshop ? 9 : 8 + variant % 2;
        const rect = { x: 0, y: 0, width: Math.abs(street.dx) >= Math.abs(street.dy) ? long : short, height: Math.abs(street.dx) >= Math.abs(street.dy) ? short : long };
        rect.x = Math.round(street.at.x + street.dx * offset - street.dy * setback * side - rect.width / 2);
        rect.y = Math.round(street.at.y + street.dy * offset + street.dx * setback * side - rect.height / 2);
        const address = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        if (Math.hypot(address.x - center.x, address.y - center.y) > 72 || nearestStreet(address).distance > 29 || !suitable(rect, district)) continue;
        const label = workshop ? local % 2 ? 'Служебная мастерская' : 'Ремонтный бокс' : local === 3 ? 'Угловая лавка' : district.id === 'sawmill' ? 'Дом лесных рабочих' : 'Жилой дом';
        result.push({ ...rect, kind: 'building', label: `${label} · ${poi.name}`.slice(0, 80) }); fill(rect, 3); local++; placed++;
      }
    }
  }
  return result;
}
