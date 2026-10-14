import type { LiveContainerAnchor, LiveDistrictId, LiveObstacle, LivePoi, LivePoint, LiveZone } from './live';
import type { LiveNpcSpawn } from './live-maps';
import type { WorldTemplate } from './world-generation';
import { prefabObstacles } from './world-prefabs';

const plans: Array<{ district: LiveDistrictId; templates: string[]; names: string[]; centers: LivePoint[] }> = [
  { district: 'customs', templates: ['checkpoint', 'fuel', 'warehouse', 'office', 'containers'],
    names: ['Западная проходная', 'Северная придорожная заправка', 'Таможенные резервные склады', 'Контора грузового тракта', 'Западный перевалочный двор'],
    centers: [{ x: 26, y: 24 }, { x: 72, y: 16 }, { x: 125, y: 16 }, { x: 16, y: 84 }, { x: 16, y: 134 }] },
  { district: 'sawmill', templates: ['cabin', 'camp', 'logging', 'hunting', 'creekcamp'],
    names: ['Дом смотрителя леса', 'Северный лагерь лесорубов', 'Лесосклад на тракте', 'Восточный охотничий кордон', 'Прибрежная лесная стоянка'],
    centers: [{ x: 294, y: 24 }, { x: 246, y: 16 }, { x: 190, y: 16 }, { x: 304, y: 84 }, { x: 304, y: 134 }] },
  { district: 'depot', templates: ['depot', 'coal', 'substation', 'wagons', 'workshop'],
    names: ['Западный путевой пост', 'Южный угольный терминал', 'Подстанция грузовой ветки', 'Внешний вагонный парк', 'Мастерская путевого хозяйства'],
    centers: [{ x: 26, y: 294 }, { x: 72, y: 304 }, { x: 125, y: 304 }, { x: 16, y: 246 }, { x: 16, y: 190 }] },
  { district: 'village', templates: ['apartments', 'market', 'greenhouse', 'school', 'clinic'],
    names: ['Дома у Южного въезда', 'Загородный торговый двор', 'Южное тепличное хозяйство', 'Школа Восточной слободы', 'Сельский фельдшерский пункт'],
    centers: [{ x: 294, y: 294 }, { x: 246, y: 304 }, { x: 190, y: 304 }, { x: 304, y: 246 }, { x: 304, y: 190 }] },
];

/** The newly opened outer land has inhabited addresses, supplies and patrols. */
export function generatePeripheralSites(templates: readonly WorldTemplate[]): { pois: LivePoi[]; obstacles: LiveObstacle[]; containers: LiveContainerAnchor[]; npcSpawns: LiveNpcSpawn[]; zones: LiveZone[] } {
  const pois: LivePoi[] = [], obstacles: LiveObstacle[] = [], containers: LiveContainerAnchor[] = [], npcSpawns: LiveNpcSpawn[] = [], zones: LiveZone[] = [];
  for (const [quarter, plan] of plans.entries()) for (const [slot, center] of plan.centers.entries()) {
    const template = templates.find(template => template.id === plan.templates[slot])!, width = slot === 0 ? 22 : 18, height = slot === 0 ? 18 : 16;
    const id = `fringe-${plan.district}-${slot}`, name = plan.names[slot]!, origin = { x: center.x - Math.floor(width / 2), y: center.y - Math.floor(height / 2) };
    const transform = (point: LivePoint): LivePoint => ({ x: origin.x + Math.round(point.x / 21 * (width - 1)), y: origin.y + Math.round(point.y / 21 * (height - 1)) });
    const walls = prefabObstacles(template.id).map(wall => { const first = transform(wall), last = transform({ x: wall.x + wall.width - 1, y: wall.y + wall.height - 1 }); return { ...wall, ...first, width: last.x - first.x + 1, height: last.y - first.y + 1 }; });
    const occupied = new Set<string>();
    const clear = (target: LivePoint, unique = false): LivePoint => {
      let best: LivePoint | undefined, score = Infinity;
      for (let y = origin.y; y < origin.y + height; y++) for (let x = origin.x; x < origin.x + width; x++) {
        if (walls.some(wall => x >= wall.x && y >= wall.y && x < wall.x + wall.width && y < wall.y + wall.height) || unique && occupied.has(`${x}:${y}`)) continue;
        const distance = (x - target.x) ** 2 + (y - target.y) ** 2;
        if (distance < score) { best = { x, y }; score = distance; }
      }
      if (!best) throw new Error(`No clear peripheral address ${id}`);
      if (unique) occupied.add(`${best.x}:${best.y}`);
      return best;
    };
    const entrances = template.entrances.map(point => clear(transform(point))), danger = slot === 0 ? 1 : 2;
    pois.push({ ...origin, width, height, id, templateId: template.id, name, districtId: plan.district, danger, tags: [...template.tags, 'peripheral', 'expanded-zone', 'quests'], entrances });
    obstacles.push(...walls); zones.push({ ...origin, width, height, name, danger, terrain: template.theme === 'forest' ? 'forest' : 'concrete' });
    template.containers.forEach((anchor, index) => containers.push({ ...anchor, ...clear(transform(anchor), true), id: `${id}-${anchor.kind}-${index}`, poiId: id }));
    template.npcPoints.slice(0, 2).forEach((point, index) => npcSpawns.push({ point: clear(transform(point), true), faction: quarter % 2 ? 'raiders' : 'scavs', role: index === 0 ? 'guard' : 'patrol', route: template.patrol.map(point => clear(transform(point))) }));
  }
  return { pois, obstacles, containers, npcSpawns, zones };
}
