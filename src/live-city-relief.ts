import type { LiveCityBuilding, LivePoint } from './game/live';
import { distantBuildingSurfaces } from './live-map-art';

/** The far city uses the same public roofs as the street view. These surfaces
 * are painted once into the existing overview bitmap, never into the minimap. */
export function cityReliefPoint(point: LivePoint & { z: number }, worldHeight: number, scale: number): LivePoint {
  return { x: (point.x - point.y + worldHeight) * scale,
    y: (point.x + point.y + 1) * scale / 2 - point.z * scale * 2 };
}

export function paintCityRelief(c: CanvasRenderingContext2D, buildings: readonly LiveCityBuilding[], worldHeight: number, scale: number): void {
  const ordered = [...buildings].sort((a, b) => a.x + a.y + a.width + a.height - b.x - b.y - b.width - b.height || a.id.localeCompare(b.id));
  c.save();
  for (const building of ordered) {
    for (const surface of distantBuildingSurfaces(building)) {
      c.beginPath();
      surface.points.forEach((point, index) => {
        const p = cityReliefPoint(point, worldHeight, scale);
        if (index) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
      });
      c.closePath(); c.fillStyle = surface.color; c.fill();
    }
  }
  c.restore();
}
