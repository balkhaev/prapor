import type { LiveLandscapePath, LiveTerrain } from './game/live';
import type { RaidFieldPlan } from './raid-field';
import { buildSurfaceMasks, paintRoadSurface, paintTerrainTexture, type GroundWorld } from './live-ground-art';
import type { PixelSprite } from './pixel-renderer';

/** The paid raid and the shared world use the same paving, gravel and repairs.
 * Only the presentation is converted; every cell still belongs to its plan. */
export function raidGroundSurface(plan: RaidFieldPlan): { world: GroundWorld; terrain: LiveTerrain[] } {
  const forest = plan.mapId === 'forest';
  const terrain = Array<LiveTerrain>(plan.width * plan.height).fill(forest ? 'forest' : plan.mapId === 'depot' ? 'yard' : 'grass');
  const streets = new Set<number>();
  for (const tile of plan.tiles) {
    const index = tile.y * plan.width + tile.x;
    if (tile.kind === 'street') streets.add(index);
    terrain[index] = tile.kind === 'street' ? forest ? 'path' : 'road' : tile.kind === 'sidewalk' ? forest ? 'yard' : 'concrete' : terrain[index]!;
  }
  const paths: LiveLandscapePath[] = [];
  for (const vertical of [false, true]) {
    const outer = vertical ? plan.width : plan.height, inner = vertical ? plan.height : plan.width;
    for (let row = 0; row < outer; row++) {
      let start = -1;
      for (let at = 0; at <= inner; at++) {
        const x = vertical ? row : at, y = vertical ? at : row, street = at < inner && streets.has(y * plan.width + x);
        if (street && start < 0) start = at;
        if (!street && start >= 0) {
          if (at - start >= 3) paths.push({ id: `raid-road-${vertical ? 'y' : 'x'}-${row}-${start}`, name: forest ? 'Просека' : 'Улица', kind: forest ? 'trail' : 'road', width: 1,
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
    if (plan.mapId === 'forest') {
      const masks = buildSurfaceMasks(world, terrain.map(material => material === 'path' ? 'road' : material), Uint8Array.from(plan.walkable, Number), plan.buildings);
      surface.save(); surface.beginPath(); for (const run of masks.roadRuns) surface.rect(run.x, run.y, run.width, 1); surface.clip();
      surface.lineWidth = .085; surface.strokeStyle = '#69573f'; surface.lineCap = 'butt';
      for (const trail of world.paths ?? []) {
        const a = trail.points[0]!, b = trail.points[1]!, vertical = a.x === b.x;
        for (const side of [-.22, .22]) {
          surface.beginPath(); surface.moveTo(a.x + .5 + (vertical ? side : 0), a.y + .5 + (vertical ? 0 : side));
          surface.lineTo(b.x + .5 + (vertical ? side : 0), b.y + .5 + (vertical ? 0 : side)); surface.stroke();
        }
      }
      surface.restore();
    }
    surface.restore();
  }
  const image = document.createElement('canvas'), anchor = { x: plan.height * 32 + 1, y: 1 };
  image.width = (plan.width + plan.height) * 32 + 3; image.height = (plan.width + plan.height) * 16 + 3;
  const context = image.getContext('2d');
  if (context) { context.imageSmoothingEnabled = false; context.transform(32, 16, -32, 16, anchor.x, anchor.y); context.drawImage(texture, 0, 0, texture.width, texture.height, 0, 0, plan.width, plan.height); }
  texture.width = 1; texture.height = 1;
  return { image, anchor };
}
