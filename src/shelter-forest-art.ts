import type Phaser from 'phaser';
import type { ShelterPoint } from './shelter-motion';

export type ShelterForestSpecies = 'spruce' | 'pine' | 'birch' | 'deciduous';
export interface ShelterForestPlant {
  seed: number;
  owned: boolean;
  radius: number;
  species?: ShelterForestSpecies;
  scale?: number;
}

type Vertex = readonly [number, number];
interface FoliageColors { shade: number; body: number; light: number; glint: number }
const colors: Record<ShelterForestSpecies, FoliageColors> = {
  spruce: { shade: 0x30483a, body: 0x4a6148, light: 0x697b50, glint: 0x8c9561 },
  pine: { shade: 0x364c3d, body: 0x56694b, light: 0x7b8757, glint: 0x9b9f6c },
  birch: { shade: 0x455c3e, body: 0x71834f, light: 0x96a162, glint: 0xb2b57b },
  deciduous: { shade: 0x3d5339, body: 0x627548, light: 0x87965c, glint: 0xa3aa6b },
};

const random = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
};

/** Uprights use the same screen-pixel scale as cabins and actors. Their ground
 * anchor never moves: a small wind bend grows towards the canopy. */
class ForestPainter {
  constructor(readonly g: Phaser.GameObjects.Graphics, readonly at: ShelterPoint, readonly height: number, readonly lean: number) {}
  point(x: number, y: number): ShelterPoint {
    return { x: Math.round(this.at.x + x + this.lean * Math.max(0, -y / this.height)), y: Math.round(this.at.y + y) };
  }
  face(vertices: readonly Vertex[], color: number, alpha = 1): void {
    this.g.fillStyle(color, alpha).fillPoints(vertices.map(([x, y]) => this.point(x, y)), true);
  }
  line(vertices: readonly Vertex[], color: number, width = 1, alpha = 1): void {
    this.g.lineStyle(width, color, alpha).strokePoints(vertices.map(([x, y]) => this.point(x, y)), false);
  }
  chip(x: number, y: number, width: number, color: number, alpha = 1): void {
    const p = this.point(x, y);
    this.g.fillStyle(color, alpha).fillRect(p.x, p.y, Math.max(1, Math.round(width)), 1);
  }
}

function paintPlantShadow(g: Phaser.GameObjects.Graphics, at: ShelterPoint, height: number, width: number, seed: number): void {
  const reach = height * (.43 + (seed % 5) * .025), spread = width * .56;
  // One low, directional bough shadow ties the stem into the common forest
  // floor. Its long axis follows the sunlight, rather than outlining a round
  // pedestal beneath each plant.
  const points: readonly Vertex[] = [[-3, -1], [7, -3], [reach * .48, -spread * .15], [reach * .77, -spread * .2], [reach, spread * .17], [reach * .95, spread * .49], [reach * .7, spread * .59], [reach * .45, spread * .3], [5, 4]];
  g.fillStyle(0x293f31, .18).fillPoints(points.map(([x, y]) => ({ x: Math.round(at.x + x), y: Math.round(at.y + y) })), true);
}

function paintRoots(a: ForestPainter, width: number, birch: boolean): void {
  // Buttress roots disappear into uneven litter instead of sitting on a puck.
  a.face([[-width * .7, -2], [-width * 1.55, 3], [-width * .58, 2], [-1, -1], [width * .9, 4], [width * 1.65, 3], [width * .58, -3]], 0x444d36);
  a.face([[-width * .42, -4], [-width * .65, 1], [-width * 1.2, 2], [-width * .54, -1], [-width * .2, -6]], birch ? 0x9c9b7e : 0x8c7854);
  a.line([[width * .4, -2], [width * .9, 1], [width * 1.3, 1]], 0x8a7953, 1, .75);
}

function paintTrunk(a: ForestPainter, height: number, width: number, birch: boolean, fork: number, r: () => number): void {
  const bark = birch ? 0xaeb39b : 0x685e43, lit = birch ? 0xd0cfb2 : 0x96805a;
  a.face([[-width * .65, 0], [-width * .45, -height * .3], [-width * .28, -height * .76], [width * .07, -height * .94], [width * .34, -height * .66], [width * .45, -height * .24], [width * .7, 1]], 0x3f4936);
  a.face([[-width * .44, -1], [-width * .35, -height * .28], [-width * .19, -height * .77], [width * .07, -height * .91], [width * .12, -height * .57], [width * .27, -height * .2], [width * .4, 0]], bark);
  a.face([[-width * .43, -2], [-width * .3, -height * .29], [-width * .2, -height * .73], [-width * .04, -height * .86], [width * .04, -height * .48], [-width * .1, -height * .16]], lit);
  for (const side of [-1, 1]) {
    a.line([[0, -height * fork], [side * width * 1.7, -height * (fork + .15)], [side * width * 3.1, -height * (fork + .24)]], bark, Math.max(1, width * .27));
    a.line([[-width * .1, -height * fork], [side * width * 1.65, -height * (fork + .15)]], lit, 1);
  }
  for (let mark = 0; mark < (birch ? 9 : 5); mark++) {
    const y = -height * (.07 + mark * .066 + r() * .025), x = (r() - .6) * width * .7;
    a.chip(x, y, (birch ? .5 : .22) * width, birch ? 0x596654 : 0x4c503b, .9);
    if (birch && mark % 3 === 0) a.chip(-width * .38, y + 2, width * .25, 0xe1dbc0, .8);
  }
  paintRoots(a, width, birch);
}

function paintSpruce(a: ForestPainter, height: number, halfWidth: number, c: FoliageColors, r: () => number): void {
  // Five unequal boughs form one tall silhouette. Exposed stems between the
  // tiers and drooping outer tips keep it distinct from a stack of triangles.
  for (let tier = 0; tier < 5; tier++) {
    const y = -height * (.28 + tier * .142), spread = halfWidth * (1 - tier * .168), bend = (r() - .5) * 3;
    const tip = y - height * (.18 - tier * .01), x = bend + (tier % 2 ? 1 : -1);
    a.face([[x, tip], [x - spread * .24, y - 13], [x - spread * .39, y - 10], [x - spread * .72, y - 5], [x - spread * .66, y - 2], [x - spread, y + 4], [x - spread * .73, y + 3], [x - spread * .61, y + 7], [x - spread * .29, y + 3], [x - 2, y + 5], [x + spread * .19, y + 3], [x + spread * .51, y + 8], [x + spread * .57, y + 3], [x + spread * .91, y + 5], [x + spread * .81, y], [x + spread * .55, y - 5], [x + spread * .38, y - 6]], c.shade);
    a.face([[x, tip], [x - spread * .23, y - 12], [x - spread * .43, y - 8], [x - spread * .4, y - 5], [x - spread * .78, y + 1], [x - spread * .44, y], [x - spread * .36, y + 3], [x, y - 1], [x + spread * .41, y + 2], [x + spread * .32, y - 4], [x + spread * .17, y - 8]], c.body);
    a.face([[x - 1, tip + 4], [x - spread * .22, y - 10], [x - spread * .56, y - 3], [x - spread * .25, y - 5], [x - spread * .13, y - 1], [x + 1, y - 6]], c.light);
    a.line([[x - spread * .7, y + 1], [x - spread * .24, y - 2], [x, y - 7]], c.light, 1, .8);
    if (tier % 2 === 0) a.chip(x - spread * .36, y - 4, spread * .19, c.glint, .8);
  }
}

// The outline is a connected, asymmetrical branch mass. A few broad planes
// describe its volume; individual leaf dots never carry the tree silhouette.
const BROAD_CROWN: readonly Vertex[] = [[-.12, 0], [-.42, .015], [-.49, .09], [-.76, .12], [-.74, .25], [-.94, .31], [-1, .48], [-.91, .55], [-1.03, .68], [-.83, .76], [-.85, .87], [-.57, .93], [-.48, .88], [-.23, 1], [.02, .94], [.2, 1.02], [.43, .91], [.62, .97], [.75, .83], [.91, .79], [.87, .66], [1, .53], [.85, .43], [.87, .3], [.66, .27], [.58, .12], [.33, .14], [.24, .04]];
const BIRCH_CROWN: readonly Vertex[] = [[-.18, 0], [-.47, .04], [-.5, .15], [-.77, .22], [-.67, .31], [-.96, .4], [-.88, .53], [-1, .62], [-.75, .7], [-.79, .9], [-.52, .85], [-.45, 1.06], [-.17, .96], [0, 1.13], [.15, .96], [.46, 1.02], [.52, .85], [.8, .88], [.73, .7], [.96, .64], [.83, .51], [.93, .39], [.63, .33], [.67, .21], [.39, .16], [.32, .05]];
const PINE_CROWN: readonly Vertex[] = [[-.13, .07], [-.3, 0], [-.5, .1], [-.52, .22], [-.73, .24], [-.79, .37], [-.98, .48], [-.93, .68], [-.72, .77], [-.57, .68], [-.4, .87], [-.22, .79], [-.1, .94], [.09, .82], [.31, .92], [.44, .71], [.62, .8], [.7, .66], [.93, .7], [1, .51], [.8, .36], [.77, .19], [.56, .22], [.49, .08], [.29, .14], [.1, .025]];

function paintBroadCrown(a: ForestPainter, height: number, halfWidth: number, species: Exclude<ShelterForestSpecies, 'spruce'>, c: FoliageColors, r: () => number): void {
  const canopyHeight = height * (species === 'pine' ? .36 : species === 'birch' ? .63 : .57) * (.85 + r() * .25), outline = species === 'pine' ? PINE_CROWN : species === 'birch' ? BIRCH_CROWN : BROAD_CROWN;
  const leftSpread = .83 + r() * .3, rightSpread = .81 + r() * .34, droop = (r() - .5) * .15, offset = (r() - .5) * .17;
  const transform = (vertices: readonly Vertex[]): Vertex[] => vertices.map(([x, y]) => [(x * (x < 0 ? leftSpread : rightSpread) + offset * y) * halfWidth, -height + (y + droop * x * y) * canopyHeight]);
  a.face(transform(outline), c.shade);
  // The lit face occupies the top-left crown; the right and hanging boughs
  // remain one quiet shadow mass, legible against the mottled forest floor.
  a.face(transform([[-.12, .025], [-.4, .05], [-.44, .14], [-.69, .17], [-.65, .28], [-.86, .35], [-.84, .48], [-.95, .62], [-.75, .69], [-.59, .64], [-.46, .79], [-.27, .74], [-.07, .87], [.13, .74], [.35, .8], [.46, .64], [.68, .68], [.63, .5], [.76, .41], [.55, .31], [.51, .18], [.27, .21], [.22, .08]]), c.body);
  a.face(transform([[-.12, .05], [-.37, .08], [-.42, .19], [-.66, .21], [-.61, .32], [-.81, .39], [-.74, .51], [-.56, .46], [-.44, .55], [-.28, .42], [-.13, .48], [.03, .35], [.23, .4], [.36, .28], [.19, .23], [.2, .12]]), c.light);
  a.face(transform([[-.66, .52], [-.84, .6], [-.68, .67], [-.58, .63], [-.42, .7], [-.34, .6], [-.45, .54]]), c.light);
  a.face(transform([[.08, .49], [.25, .45], [.43, .51], [.52, .45], [.6, .53], [.48, .62], [.28, .6], [.2, .7], [.06, .64]]), c.body);
  // A few broken branch gaps keep birch and pine airy without transparent
  // crowns or hundreds of little circular leaf clusters.
  if (species === 'birch') {
    for (const side of [-1, 1]) {
      a.line([[side * halfWidth * .14, -height * .48], [side * halfWidth * .28, -height * .61], [side * halfWidth * .44, -height * .66]], 0xb6b59a, 1.25, .9);
      a.line([[side * halfWidth * .6, -height * .48], [side * halfWidth * .67, -height * .43]], c.body, 1, .9);
    }
  }
  for (let glint = 0; glint < 8; glint++) {
    const x = (-.71 + r() * 1.2) * halfWidth, y = -height + (.15 + r() * .49) * canopyHeight;
    a.chip(x, y, 2 + r() * 3, glint % 3 === 0 ? c.glint : c.light, glint % 3 === 0 ? .75 : .9);
  }
}

/** Authored mixed woodland: tall spruce, open high-stem pine, slender birch and
 * broad deciduous crowns. Seed variation changes proportions, not leaf noise. */
export function paintShelterForestTree(g: Phaser.GameObjects.Graphics, at: ShelterPoint, plant: ShelterForestPlant, wind = 0): void {
  const r = random(plant.seed), species = plant.species ?? (['spruce', 'pine', 'birch', 'deciduous'] as const)[plant.seed % 4]!;
  const scale = Math.max(.45, Math.min(1.3, Number.isFinite(plant.scale) ? plant.scale! : 1));
  const height = Math.min(125, (plant.owned ? 47 + r() * 15 : 92 + r() * 30) * scale);
  const halfWidth = height * (species === 'spruce' ? .255 : species === 'pine' ? .33 : species === 'birch' ? .22 : .35) * (.83 + r() * .3);
  const trunkWidth = Math.max(2.5, height * (species === 'birch' ? .045 : .065));
  const lean = (r() - .5) * height * .09 + Math.max(-1.6, Math.min(1.6, wind)) * (species === 'birch' ? 1.2 : .65);
  const a = new ForestPainter(g, at, height, lean), c = colors[species];
  paintPlantShadow(g, at, height, halfWidth, plant.seed);
  paintTrunk(a, height, trunkWidth, species === 'birch', species === 'pine' ? .54 : .35, r);
  if (species === 'spruce') paintSpruce(a, height, halfWidth, c, r);
  else paintBroadCrown(a, height, halfWidth, species, c, r);
}

/** Low woodland understorey grows from several woody stems. Broad irregular
 * leaves replace the old round, flower-like shrub rosettes. */
export function paintShelterForestShrub(g: Phaser.GameObjects.Graphics, at: ShelterPoint, plant: ShelterForestPlant, wind = 0): void {
  const r = random(plant.seed), scale = Math.max(.55, Math.min(1.2, Number.isFinite(plant.scale) ? plant.scale! : 1));
  const height = (plant.owned ? 10 + r() * 5 : 14 + r() * 9) * scale, halfWidth = (12 + r() * 7) * scale;
  const a = new ForestPainter(g, at, height, Math.max(-1.6, Math.min(1.6, wind)) * .5), c = colors[plant.seed % 3 ? 'deciduous' : 'birch'];
  paintPlantShadow(g, at, height, halfWidth, plant.seed);
  for (const side of [-1, 0, 1]) a.line([[0, 0], [side * halfWidth * .25, -height * .35], [side * halfWidth * .7, -height * .7]], 0x655f42, 1.1);
  const crown = (vertices: readonly Vertex[]) => vertices.map(([x, y]): Vertex => [x * halfWidth, y * height]);
  a.face(crown([[-.05, -.92], [-.32, -1], [-.43, -.81], [-.7, -.85], [-.76, -.59], [-1, -.52], [-.87, -.3], [-.97, -.15], [-.65, -.06], [-.4, -.13], [-.18, .03], [.07, -.04], [.35, .03], [.5, -.11], [.77, -.03], [.9, -.23], [.81, -.38], [1, -.49], [.79, -.69], [.54, -.67], [.43, -.89], [.18, -.81]]), c.shade);
  a.face(crown([[-.09, -.9], [-.28, -.94], [-.4, -.74], [-.64, -.79], [-.7, -.52], [-.89, -.47], [-.7, -.31], [-.78, -.19], [-.43, -.22], [-.2, -.14], [-.03, -.31], [.24, -.18], [.47, -.25], [.7, -.19], [.69, -.39], [.85, -.49], [.56, -.56], [.43, -.75], [.14, -.65]]), c.body);
  a.face(crown([[-.18, -.88], [-.32, -.79], [-.43, -.64], [-.65, -.67], [-.69, -.49], [-.51, -.44], [-.36, -.51], [-.23, -.43], [-.11, -.62], [.12, -.58], [.28, -.69], [.05, -.78]]), c.light);
  for (let leaf = 0; leaf < 4; leaf++) a.chip((- .65 + r()) * halfWidth, -( .35 + r() * .4) * height, 2 + r() * 2, c.light, .8);
  a.line([[-halfWidth * .2, 0], [0, -height * .19], [halfWidth * .32, -height * .04]], 0x7d7850, 1, .7);
}
