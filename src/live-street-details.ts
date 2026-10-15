import type { LiveTerrain, LiveWorld } from './game/live';
import { pixelSeed } from './pixel-art';

export type StreetGroundDetail = {
  x: number; y: number; width: number; height: number;
  kind: 'doorstep' | 'tree-bed' | 'lamp-base' | 'vehicle-wear' | 'work-wear' | 'litter';
  axis: 'x' | 'y'; seed: number; paved: boolean;
};
type StreetWorld = Pick<LiveWorld, 'width' | 'height' | 'citySites' | 'props'>;
const hardGround = new Set<LiveTerrain>(['concrete', 'yard', 'road', 'path']);

/** Small signs of use belong to an actual entrance, tree or street furnishing.
 * Built once, indexed with the scenery, and painted above the low-resolution
 * world bitmap: a lamp footing should not become a sixteen-pixel terrain block. */
export function streetGroundDetails(world: StreetWorld, terrain: readonly LiveTerrain[], walkable: Uint8Array, indoor: Uint8Array): StreetGroundDetail[] {
  const result: StreetGroundDetail[] = [];
  const add = (detail: StreetGroundDetail, materials: ReadonlySet<LiveTerrain>, free = false) => {
    if (detail.x < 0 || detail.y < 0 || detail.x + detail.width > world.width || detail.y + detail.height > world.height) return;
    for (let y = Math.floor(detail.y); y < Math.ceil(detail.y + detail.height); y++) for (let x = Math.floor(detail.x); x < Math.ceil(detail.x + detail.width); x++) {
      const cell = y * world.width + x;
      if (indoor[cell] || !materials.has(terrain[cell]!) || free && !walkable[cell]) return;
    }
    result.push(detail);
  };
  for (const site of world.citySites ?? []) for (const building of site.buildings) {
    for (const door of building.entrances) {
      const nx = door.x === building.x ? -1 : door.x === building.x + building.width - 1 ? 1 : 0;
      const ny = door.y === building.y ? -1 : door.y === building.y + building.height - 1 ? 1 : 0;
      if (!nx && !ny) continue;
      const width = nx ? .8 : 1.5, height = nx ? 1.5 : .8;
      add({ x: door.x + .5 + nx - width / 2, y: door.y + .5 + ny - height / 2, width, height,
        kind: 'doorstep', axis: nx ? 'x' : 'y', seed: pixelSeed(building.id), paved: true }, hardGround, true);
    }
  }
  const growthGround = new Set<LiveTerrain>(['concrete', 'yard', 'grass', 'forest']);
  for (const prop of world.props ?? []) {
    const seed = pixelSeed(prop.id), cx = prop.x + prop.width / 2, cy = prop.y + prop.height / 2;
    const center = (kind: StreetGroundDetail['kind'], width: number, height: number): StreetGroundDetail => ({
      x: cx - width / 2, y: cy - height / 2, width, height, kind, axis: prop.orientation, seed,
      paved: terrain[Math.floor(cy) * world.width + Math.floor(cx)] === 'concrete',
    });
    if (prop.kind === 'tree' || prop.kind === 'planter') add(center('tree-bed', Math.min(1.65, prop.width + .3), Math.min(1.65, prop.height + .3)), growthGround);
    else if (prop.kind === 'lamp' || prop.kind === 'power-pole') add(center('lamp-base', .7, .7), hardGround);
    else if (['car', 'van', 'truck', 'bus'].includes(prop.kind)) add(center('vehicle-wear', prop.width + .3, prop.height + .3), hardGround);
    else if (['dumpster', 'workbench', 'pallet', 'market-stall'].includes(prop.kind)) add(center('work-wear', prop.width + .5, prop.height + .5), hardGround);
    // Sparse paper scraps have no container-like silhouette and are never loot.
    if (['bench', 'kiosk', 'market-stall', 'dumpster'].includes(prop.kind) && seed % 3 !== 0) {
      add({ x: prop.x + prop.width + .25, y: cy + .12, width: .65, height: .45,
        kind: 'litter', axis: prop.orientation, seed, paved: true }, hardGround, true);
    }
  }
  return result;
}

/** A handful of flat marks, not an extra prop, obstacle or animated entity. */
export function paintStreetGroundDetail(c: CanvasRenderingContext2D, detail: StreetGroundDetail): void {
  const { x, y, width: w, height: h, seed } = detail;
  const rect = (u: number, v: number, width: number, height: number, color: string) => {
    c.fillStyle = color; c.fillRect(x + u * w, y + v * h, width * w, height * h);
  };
  if (detail.kind === 'doorstep') {
    rect(0, 0, 1, 1, '#414c4240'); rect(.06, .06, .88, .88, '#c1bda08a');
    rect(.1, .1, .8, .8, '#858c7659');
    for (let i = 1; i < 5; i++) {
      if (detail.axis === 'x') rect(.12, i * .16, .76, .035, '#3e51434f');
      else rect(i * .16, .12, .035, .76, '#3e51434f');
    }
    rect(.2, .2, .13, .12, '#d6c9a46b');
  } else if (detail.kind === 'tree-bed') {
    if (detail.paved) {
      rect(.02, .02, .96, .96, '#bcc1a2'); rect(.09, .09, .82, .82, '#344a36');
      rect(.16, .13, .68, .7, '#665f42'); rect(.09, .88, .88, .08, '#5c6951');
    } else {
      rect(.12, .24, .67, .54, '#4f563d42'); rect(.25, .1, .5, .79, '#68714b33');
    }
    for (let i = 0; i < 9; i++) {
      const u = .16 + ((seed >>> i * 3) % 61) / 100, v = .15 + ((seed >>> i * 2) % 63) / 100;
      rect(u, v, .055 + i % 2 * .025, .04, i % 3 === 0 ? '#b9ac70' : '#818858');
    }
  } else if (detail.kind === 'lamp-base') {
    rect(.08, .16, .9, .82, '#273b3b5c'); rect(.03, .03, .8, .8, '#afb6a0');
    rect(.15, .15, .56, .56, '#657969');
    for (const u of [.14, .65]) for (const v of [.14, .65]) rect(u, v, .06, .06, '#d6d4b6');
  } else if (detail.kind === 'vehicle-wear') {
    rect(.15, .1, .68, .76, '#172f3230');
    const horizontal = detail.axis === 'x';
    for (const side of [.06, .88]) {
      if (horizontal) rect(.08, side, .8, .055, '#213a394f');
      else rect(side, .08, .055, .8, '#213a394f');
    }
    rect(.32, .24, .23, .29, '#263d3c36'); rect(.45, .2, .24, .16, '#263d3c36');
  } else if (detail.kind === 'work-wear') {
    rect(.08, .16, .77, .67, '#544e3742'); rect(.21, .05, .54, .89, '#7b704137');
    for (let i = 0; i < 7; i++) rect(.04 + (seed >>> i * 3) % 88 / 100, .06 + (seed >>> i * 2) % 86 / 100, .035, .06, '#c2b68c91');
  } else {
    rect(.02, .21, .32, .27, '#273e3745'); rect(0, .16, .32, .27, '#c4bea1');
    rect(.05, .16, .06, .27, '#e0d8b9'); rect(.06, .26, .18, .035, '#8a907e');
    rect(.66, .65, .2, .17, '#ad9b7c'); rect(.7, .65, .05, .17, '#d7c7a0');
  }
}
