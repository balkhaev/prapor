import type { LiveCityBuilding, LivePoint, LiveTerrain } from './game/live';
import { BUILDING_EXTERIOR_HEIGHT_SCALE, buildingWallHeight } from './live-map-art';

/** Fixed contact light agrees with the large lit facade planes. A whole house
 * casts one continuous shape instead of six disconnected collision-wall bars. */
export function cityBuildingGroundShadow(building: LiveCityBuilding): LivePoint[] {
  const height = buildingWallHeight(building) * BUILDING_EXTERIOR_HEIGHT_SCALE;
  const dx = -height * .64, dy = height * .9;
  const { x, y, width: w, height: h } = building;
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h },
    { x: x + w + dx, y: y + h + dy }, { x: x + dx, y: y + h + dy }, { x: x + dx, y: y + dy }];
}

export type CityBuildingGroundShadow = LivePoint & { width: number; height: number; points: LivePoint[];
  clip: Array<LivePoint & { width: number; height: number }> };

/** Exact outdoor clips are prepared once, not resampled by animated frames. */
export function buildCityBuildingGroundShadows(world: { width: number; height: number },
  buildings: readonly LiveCityBuilding[], terrain: readonly LiveTerrain[], indoor: Uint8Array): CityBuildingGroundShadow[] {
  const result: CityBuildingGroundShadow[] = [];
  for (const building of buildings) {
    const shape = cityBuildingGroundShadow(building), clip: CityBuildingGroundShadow['clip'] = [];
    const left = Math.max(0, Math.floor(Math.min(...shape.map(p => p.x))));
    const top = Math.max(0, Math.floor(Math.min(...shape.map(p => p.y))));
    const right = Math.min(world.width, Math.ceil(Math.max(...shape.map(p => p.x))));
    const bottom = Math.min(world.height, Math.ceil(Math.max(...shape.map(p => p.y))));
    for (let y = top; y < bottom; y++) {
      let start = -1;
      for (let x = left; x <= right; x++) {
        const index = y * world.width + x;
        const accept = x < right && !indoor[index] && terrain[index] !== 'water';
        if (accept && start < 0) start = x;
        else if (!accept && start >= 0) { clip.push({ x: start, y, width: x - start, height: 1 }); start = -1; }
      }
    }
    if (clip.length) result.push({ x: left, y: top, width: right - left, height: bottom - top, points: shape, clip });
  }
  return result;
}

/** Display-scale edges stay crisp beside the native planting and paving pass.
 * One fill keeps overlapping neighbouring houses from darkening seams twice. */
export function paintCityBuildingGroundShadows(c: CanvasRenderingContext2D, shadows: readonly CityBuildingGroundShadow[]): void {
  if (!shadows.length) return;
  c.save(); c.beginPath();
  for (const shadow of shadows) for (const run of shadow.clip) c.rect(run.x, run.y, run.width, run.height);
  c.clip(); c.beginPath();
  for (const shadow of shadows) {
    shadow.points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
  }
  c.fillStyle = '#263e3c2c'; c.fill(); c.restore();
}
