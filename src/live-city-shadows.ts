import type { LiveCityBuilding, LivePoint, LiveTerrain } from './game/live';
import { buildingGroundShadowParts, buildWorldGroundShadowCasters, DEFAULT_GROUND_SHADOW_LIGHT,
  paintWorldGroundShadows, projectGroundShadowPart, type GroundShadowCaster, type GroundShadowLight } from './live-ground-shadows';

/** Compatibility entry points share the same world-space light and receiver
 * plan as props. The live scene uses the combined plan to union all casters. */
export function cityBuildingGroundShadow(building: LiveCityBuilding, light: GroundShadowLight = DEFAULT_GROUND_SHADOW_LIGHT): LivePoint[] {
  return buildingGroundShadowParts(building).flatMap(part => projectGroundShadowPart(part, light));
}

export type CityBuildingGroundShadow = GroundShadowCaster;

export function buildCityBuildingGroundShadows(world: { width: number; height: number }, buildings: readonly LiveCityBuilding[],
  terrain: readonly LiveTerrain[], indoor: Uint8Array): CityBuildingGroundShadow[] {
  return buildWorldGroundShadowCasters(world, buildings, terrain, indoor, []);
}

export function paintCityBuildingGroundShadows(c: CanvasRenderingContext2D, shadows: readonly CityBuildingGroundShadow[],
  light: GroundShadowLight = DEFAULT_GROUND_SHADOW_LIGHT): void {
  paintWorldGroundShadows(c, shadows, light);
}
