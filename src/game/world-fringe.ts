import type { LiveContainerAnchor, LiveDistrictId, LiveObstacle, LivePoi, LivePoint, LiveZone } from './live';
import type { LiveNpcSpawn } from './live-maps';
import type { WorldTemplate } from './world-generation';
import { prefabObstacles } from './world-prefabs';

const plans: Array<{ district: LiveDistrictId; templates: string[]; names: string[]; centers: LivePoint[] }> = [
  { district: 'customs', templates: ['checkpoint', 'fuel', 'warehouse', 'office', 'containers', 'warehouse', 'workshop'],
    names: ['Западная проходная', 'Северная придорожная заправка', 'Таможенные резервные склады', 'Контора грузового тракта', 'Западный перевалочный двор', 'Северная грузовая база', 'Мастерские Западной слободы'],
    centers: [{ x: 26, y: 24 }, { x: 86, y: 16 }, { x: 180, y: 16 }, { x: 16, y: 86 }, { x: 16, y: 180 }, { x: 210, y: 92 }, { x: 98, y: 98 }] },
  { district: 'sawmill', templates: ['cabin', 'camp', 'logging', 'hunting', 'creekcamp', 'sawmill', 'cabin'],
    names: ['Дом смотрителя леса', 'Северный лагерь лесорубов', 'Лесосклад на тракте', 'Восточный охотничий кордон', 'Прибрежная лесная стоянка', 'Малая лесопилка', 'Дома лесных рабочих'],
    centers: [{ x: 432, y: 24 }, { x: 362, y: 16 }, { x: 268, y: 16 }, { x: 432, y: 86 }, { x: 432, y: 180 }, { x: 238, y: 92 }, { x: 350, y: 98 }] },
  { district: 'depot', templates: ['depot', 'coal', 'substation', 'wagons', 'workshop', 'substation', 'workshop'],
    names: ['Западный путевой пост', 'Южный угольный терминал', 'Подстанция грузовой ветки', 'Внешний вагонный парк', 'Мастерская путевого хозяйства', 'Южная служебная станция', 'Железнодорожные мастерские'],
    centers: [{ x: 26, y: 424 }, { x: 86, y: 432 }, { x: 180, y: 432 }, { x: 16, y: 362 }, { x: 16, y: 268 }, { x: 210, y: 356 }, { x: 86, y: 350 }] },
  { district: 'village', templates: ['apartments', 'market', 'greenhouse', 'school', 'clinic', 'apartments', 'school'],
    names: ['Дома у Южного въезда', 'Загородный торговый двор', 'Южное тепличное хозяйство', 'Школа Восточной слободы', 'Сельский фельдшерский пункт', 'Жилые дома у сада', 'Школа Южной слободы'],
    centers: [{ x: 432, y: 424 }, { x: 362, y: 432 }, { x: 268, y: 432 }, { x: 432, y: 362 }, { x: 432, y: 268 }, { x: 238, y: 356 }, { x: 350, y: 350 }] },
];

/** The newly opened outer land has inhabited addresses, supplies and patrols. */
export function generatePeripheralSites(templates: readonly WorldTemplate[], world: { width: number; height: number; streetMask: Uint8Array; established: LivePoi[]; extracts: LivePoint[] }): { pois: LivePoi[]; obstacles: LiveObstacle[]; containers: LiveContainerAnchor[]; npcSpawns: LiveNpcSpawn[]; zones: LiveZone[] } {
  const pois: LivePoi[] = [], obstacles: LiveObstacle[] = [], containers: LiveContainerAnchor[] = [], npcSpawns: LiveNpcSpawn[] = [], zones: LiveZone[] = [];
  for (const [quarter, plan] of plans.entries()) for (const [slot, center] of plan.centers.entries()) {
    const template = templates.find(template => template.id === plan.templates[slot])!, width = slot === 0 || slot >= 5 ? 22 : 18, height = slot === 0 || slot >= 5 ? 18 : 16;
    const id = `fringe-${plan.district}-${slot}`, name = plan.names[slot]!;
    let origin: LivePoint | undefined;
    const overlap = (a: LivePoint & { width: number; height: number }, b: LivePoint & { width: number; height: number }, gap: number) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
    for (let radius = 0; !origin && radius <= 90; radius++) for (let dy = -radius; !origin && dy <= radius; dy++) for (let dx = -radius; !origin && dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const rect = { x: center.x - Math.floor(width / 2) + dx, y: center.y - Math.floor(height / 2) + dy, width, height };
      if (rect.x < quarter % 2 * 224 + 3 || rect.y < Math.floor(quarter / 2) * 224 + 3 || rect.x + width > (quarter % 2 + 1) * 224 - 3 || rect.y + height > (Math.floor(quarter / 2) + 1) * 224 - 3
        || [...world.established, ...pois].some(poi => overlap(rect, poi, 5)) || overlap(rect, { x: 366, y: 0, width: 32, height: world.height }, 2)
        || world.extracts.some(at => Math.hypot(Math.max(rect.x - at.x, 0, at.x - rect.x - width + 1), Math.max(rect.y - at.y, 0, at.y - rect.y - height + 1)) < 6)) continue;
      let blocked = false;
      for (let y = rect.y; !blocked && y < rect.y + height; y++) for (let x = rect.x; x < rect.x + width; x++) if (world.streetMask[y * world.width + x]) { blocked = true; break; }
      if (!blocked) origin = { x: rect.x, y: rect.y };
    }
    if (!origin) throw new Error(`No planned peripheral lot ${id}`);
    const placedOrigin = origin;
    const transform = (point: LivePoint): LivePoint => ({ x: placedOrigin.x + Math.round(point.x / 21 * (width - 1)), y: placedOrigin.y + Math.round(point.y / 21 * (height - 1)) });
    const walls = prefabObstacles(template.id).map(wall => { const first = transform(wall), last = transform({ x: wall.x + wall.width - 1, y: wall.y + wall.height - 1 }); return { ...wall, ...first, width: last.x - first.x + 1, height: last.y - first.y + 1 }; });
    const occupied = new Set<string>();
    const clear = (target: LivePoint, unique = false): LivePoint => {
      let best: LivePoint | undefined, score = Infinity;
      for (let y = placedOrigin.y; y < placedOrigin.y + height; y++) for (let x = placedOrigin.x; x < placedOrigin.x + width; x++) {
        if (walls.some(wall => x >= wall.x && y >= wall.y && x < wall.x + wall.width && y < wall.y + wall.height) || unique && occupied.has(`${x}:${y}`)) continue;
        const distance = (x - target.x) ** 2 + (y - target.y) ** 2;
        if (distance < score) { best = { x, y }; score = distance; }
      }
      if (!best) throw new Error(`No clear peripheral address ${id}`);
      if (unique) occupied.add(`${best.x}:${best.y}`);
      return best;
    };
    const entrances = template.entrances.map(point => clear(transform(point))), danger = slot === 0 ? 1 : 2;
    pois.push({ ...placedOrigin, width, height, id, templateId: template.id, name, districtId: plan.district, danger, tags: [...template.tags, 'peripheral', 'expanded-zone', 'quests'], entrances });
    obstacles.push(...walls); zones.push({ ...placedOrigin, width, height, name, danger, terrain: template.theme === 'forest' ? 'forest' : 'concrete' });
    template.containers.forEach((anchor, index) => containers.push({ ...anchor, ...clear(transform(anchor), true), id: `${id}-${anchor.kind}-${index}`, poiId: id }));
    template.npcPoints.slice(0, 2).forEach((point, index) => npcSpawns.push({ point: clear(transform(point), true), faction: quarter % 2 ? 'raiders' : 'scavs', role: index === 0 ? 'guard' : 'patrol', route: template.patrol.map(point => clear(transform(point))) }));
  }
  return { pois, obstacles, containers, npcSpawns, zones };
}
