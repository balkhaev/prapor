import type { LiveCityBuilding, LiveWorldProp } from './game/live';
import { PIXEL_PALETTE as P, pixelIso, pixelSeed } from './pixel-art';
import { pixelPropHeight } from './pixel-props';
import { pixelBuildingVentAnchor } from './pixel-buildings';

export type EnvironmentPixel = (x: number, y: number, width: number, height: number, color: string, alpha: number) => void;
const phase = (time: number, period: number, offset: number) => ((Math.max(0, Number.isFinite(time) ? time : 0) + offset) % period) / period;

/** Tiny analytical details ride the cached sprite's own depth. No new textures,
 * collision shapes or gameplay events are produced by the passing of time. */
export function paintPropAtmosphere(prop: LiveWorldProp, time: number, plot: EnvironmentPixel, reducedMotion = false): void {
  time = Number.isFinite(time) ? Math.max(0, time) : 0;
  const center = pixelIso(prop.width / 2, prop.height / 2), seed = pixelSeed(prop.id);
  if (prop.kind === 'lamp') {
    const brightness = reducedMotion ? .16 : .15 + Math.sin(time / 2300 + seed % 29) * .025;
    const direction = prop.orientation === 'x' ? 1 : -1;
    for (const side of prop.variant === 1 ? [direction, -direction] : [direction]) {
      const x = center.x + side * 37, y = center.y - 199;
      plot(x - 11, y - 3, 22, 8, P.yellow, brightness);
      plot(x - 7, y - 1, 14, 3, P.cream, .6);
    }
    return;
  }
  if (reducedMotion || !['tree', 'shrub', 'planter', 'garden'].includes(prop.kind)) return;
  // Three rare leaves per canopy, with a quiet interval between each fall.
  const height = pixelPropHeight(prop.kind), canopy = prop.kind === 'tree' ? 46 : 20;
  for (let i = 0; i < 3; i++) {
    const progress = phase(time, 14000, seed % 14000 + i * 4091);
    if (progress > .48) continue;
    const t = progress / .48, wind = Math.sin(t * 7 + i) * 6;
    const x = center.x + ((seed >>> (i * 5)) % canopy - canopy / 2) + t * 24 + wind;
    const y = center.y - height * .64 + t * height * .56;
    plot(Math.round(x), Math.round(y), 3, 2, i % 2 ? P.woodLight : P.leafLight, Math.min(.65, (1 - t) * 1.5));
  }
}

/** The outlet comes from the building painter, so smoke cannot float over an
 * unrelated roof or remain when an exterior is cut away. */
export function paintBuildingAtmosphere(building: LiveCityBuilding, time: number, plot: EnvironmentPixel, reducedMotion = false): void {
  time = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (reducedMotion) return;
  const vent = pixelBuildingVentAnchor(building); if (!vent) return;
  const origin = pixelIso(vent.x, vent.y, vent.z), seed = pixelSeed(building.id);
  for (let i = 0; i < 4; i++) {
    const t = phase(time, 6600, seed % 6600 + i * 1650);
    const x = Math.round(origin.x + t * 26 + Math.sin(t * 5 + seed % 7) * t * 7), y = Math.round(origin.y - t * 58);
    const size = Math.round(4 + t * 9), alpha = (1 - t) * .17;
    plot(x - size / 2, y - size / 2, size, size, P.steelLight, alpha);
    plot(x - size / 2 - 2, y, size + 3, Math.max(2, size / 2), P.panelShade, alpha * .65);
  }
}
