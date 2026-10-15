import type { LiveLandscapePath, LiveTerrain } from './game/live';
import type { RaidFieldPlan } from './raid-field';
import { buildSurfaceMasks, paintRoadSurface, paintTerrainTexture, type GroundWorld } from './live-ground-art';
import type { PixelSprite } from './pixel-renderer';

/** The paid raid and the shared world use the same paving, gravel and repairs.
 * Only the presentation is converted; every cell still belongs to its plan. */
export function raidGroundSurface(plan: RaidFieldPlan): { world: GroundWorld; terrain: LiveTerrain[] } {
  const terrain = Array<LiveTerrain>(plan.width * plan.height).fill(plan.mapId === 'forest' ? 'forest' : plan.mapId === 'depot' ? 'yard' : 'grass');
  for (const tile of plan.tiles) terrain[tile.y * plan.width + tile.x] = tile.kind === 'street' ? 'road' : tile.kind === 'sidewalk' ? 'concrete' : terrain[tile.y * plan.width + tile.x]!;
  const paths: LiveLandscapePath[] = [];
  for (const vertical of [false, true]) {
    const outer = vertical ? plan.width : plan.height, inner = vertical ? plan.height : plan.width;
    for (let row = 0; row < outer; row++) {
      let start = -1;
      for (let at = 0; at <= inner; at++) {
        const x = vertical ? row : at, y = vertical ? at : row, street = at < inner && terrain[y * plan.width + x] === 'road';
        if (street && start < 0) start = at;
        if (!street && start >= 0) {
          if (at - start >= 3) paths.push({ id: `raid-road-${vertical ? 'y' : 'x'}-${row}-${start}`, name: 'Улица', kind: 'road', width: 1,
            points: vertical ? [{ x: row, y: start }, { x: row, y: at - 1 }] : [{ x: start, y: row }, { x: at - 1, y: row }] });
          start = -1;
        }
      }
    }
  }
  return { world: { width: plan.width, height: plan.height, seed: String(plan.seed), paths }, terrain };
}

export function raidGroundArt(plan: RaidFieldPlan): PixelSprite {
  const { world, terrain } = raidGroundSurface(plan), resolution = 16;
  const texture = document.createElement('canvas'); texture.width = plan.width * resolution; texture.height = plan.height * resolution;
  const surface = texture.getContext('2d');
  if (surface) {
    paintTerrainTexture(surface, world, terrain, resolution);
    surface.save(); surface.scale(resolution, resolution);
    paintRoadSurface(surface, world, buildSurfaceMasks(world, terrain, Uint8Array.from(plan.walkable, Number), plan.buildings));
    surface.restore();
  }
  const image = document.createElement('canvas'), anchor = { x: plan.height * 32 + 1, y: 1 };
  image.width = (plan.width + plan.height) * 32 + 3; image.height = (plan.width + plan.height) * 16 + 3;
  const context = image.getContext('2d');
  if (context) { context.imageSmoothingEnabled = false; context.transform(32, 16, -32, 16, anchor.x, anchor.y); context.drawImage(texture, 0, 0, texture.width, texture.height, 0, 0, plan.width, plan.height); }
  texture.width = 1; texture.height = 1;
  return { image, anchor };
}
