import type { LivePoint, LiveTerrain, LiveWorld, LiveWorldProp } from './game/live';
import { pixelRandom, pixelSeed } from './pixel-art';

type Rect = LivePoint & { width: number; height: number };
type GardenWorld = Pick<LiveWorld, 'width' | 'height' | 'city' | 'citySites' | 'props' | 'paths' | 'obstacles' | 'containers' | 'extracts' | 'pois' | 'districts'>;
export type CityGardenGroundDetail = Rect & {
  kind: 'lawn-island' | 'flower-bed' | 'shrub-border';
  axis: 'x' | 'y'; seed: number; sourceId: string;
  /** Outdoor, unoccupied cell runs shared by both levels of ground painting. */
  clip: Rect[];
};
const MAX_DETAILS = 4096, MAX_ATTEMPTS = 32768;
const greenGround = new Set<LiveTerrain>(['grass', 'forest', 'concrete', 'yard']);
const inside = (p: LivePoint, r: Rect): boolean => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;

/** Planting follows the edges and furnishings of real courtyards. These are
 * flat, low beds, never extra trees, cover or a client-side navigation change.
 * All access lines and interactive anchors remain visually open. */
export function buildCityGardenGround(world: GardenWorld, terrain: readonly LiveTerrain[], walkable: Uint8Array, indoor: Uint8Array): CityGardenGroundDetail[] {
  const { width, height, city } = world;
  if (!city || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16_777_216) return [];
  const reserved = new Uint8Array(width * height), planted = new Uint8Array(width * height);
  const fill = (rect: Rect, margin = 0): void => {
    for (let y = Math.max(0, Math.floor(rect.y - margin)); y < Math.min(height, Math.ceil(rect.y + rect.height + margin)); y++)
      for (let x = Math.max(0, Math.floor(rect.x - margin)); x < Math.min(width, Math.ceil(rect.x + rect.width + margin)); x++) reserved[y * width + x] = 1;
  };
  const protect = (p: LivePoint, radius: number): void => fill({ x: p.x + .5 - radius, y: p.y + .5 - radius, width: radius * 2, height: radius * 2 });
  const line = (a: LivePoint, b: LivePoint, radius: number): void => {
    const length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.min(8192, Math.max(1, Math.ceil(length * 2)));
    if (!Number.isFinite(length)) return;
    for (let i = 0; i <= steps; i++) protect({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, radius);
  };
  for (const obstacle of world.obstacles) fill(obstacle, .25);
  for (const prop of world.props ?? []) fill(prop, .15);
  for (const container of world.containers) protect(container, 1.5);
  for (const extract of world.extracts) protect(extract, 4);
  for (const district of world.districts) for (const spawn of district.spawns) protect(spawn, 3);
  for (const poi of world.pois) for (const door of poi.entrances) protect(door, 1.5);
  for (const site of world.citySites ?? []) {
    for (const building of site.buildings) {
      fill(building, .35);
      for (const door of building.entrances) protect(door, 1.7);
    }
    for (const passage of site.passages) for (let i = 1; i < passage.length; i++) line(passage[i - 1]!, passage[i]!, 1.3);
  }
  for (const path of world.paths ?? []) {
    if (path.kind === 'river') continue;
    for (let i = 1; i < path.points.length; i++) line(path.points[i - 1]!, path.points[i]!, path.width / 2 + .6);
  }
  const result: CityGardenGroundDetail[] = [];
  let attempts = 0;
  const add = (rect: Rect, kind: CityGardenGroundDetail['kind'], axis: 'x' | 'y', sourceId: string, seed: number, naturalOnly = false, scope?: Rect): void => {
    if (++attempts > MAX_ATTEMPTS || result.length >= MAX_DETAILS || rect.width > 10 || rect.height > 10) return;
    const left = Math.max(0, Math.floor(rect.x)), top = Math.max(0, Math.floor(rect.y));
    const right = Math.min(width, Math.ceil(rect.x + rect.width)), bottom = Math.min(height, Math.ceil(rect.y + rect.height));
    const clip: Rect[] = [];
    let area = 0;
    for (let y = top; y < bottom; y++) {
      let start = -1;
      for (let x = left; x <= right; x++) {
        const cell = y * width + x;
        const material = terrain[cell];
        const accept = x < right && inside({ x, y }, city) && (!scope || inside({ x, y }, scope)) && !reserved[cell] && !planted[cell] && !indoor[cell] && !!walkable[cell]
          && (naturalOnly ? material === 'grass' || material === 'forest' : greenGround.has(material!));
        if (accept && start < 0) start = x;
        else if (!accept && start >= 0) { clip.push({ x: start, y, width: x - start, height: 1 }); area += x - start; start = -1; }
      }
    }
    // A stray free cell beside a parked car should not acquire a garden.
    if (area < 3 || area < rect.width * rect.height * .28) return;
    for (const run of clip) for (let x = run.x; x < run.x + run.width; x++) planted[run.y * width + x] = 1;
    result.push({ ...rect, kind, axis, sourceId, seed, clip });
  };
  for (const site of world.citySites ?? []) {
    if (attempts >= MAX_ATTEMPTS || result.length >= MAX_DETAILS) break;
    const { courtyard: court } = site, seed = pixelSeed(site.id);
    if (!court) continue;
    // Sheltered corners and broken border runs leave the authored middle way
    // open. Work yards have one modest bed; homes have a sequence of gardens.
    const count = site.kind === 'workyard' ? 1 : site.kind === 'courtyard' ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const side = (i + seed % 4) % 4, horizontal = side < 2;
      const long = 4.2 + (seed >>> i * 3) % 30 / 10, depth = 2.4 + (seed >>> i * 2) % 12 / 10;
      const along = .16 + Math.floor(i / 4) * .46 + (seed >>> i * 2) % 15 / 100;
      const w = Math.min(horizontal ? long : depth, Math.max(1, court.width - 1));
      const h = Math.min(horizontal ? depth : long, Math.max(1, court.height - 1));
      const x = horizontal ? court.x + (court.width - w) * along : side === 2 ? court.x + .3 : court.x + court.width - w - .3;
      const y = horizontal ? side === 0 ? court.y + .3 : court.y + court.height - h - .3 : court.y + (court.height - h) * along;
      add({ x, y, width: w, height: h }, i % 3 === 0 ? 'lawn-island' : i % 3 === 1 ? 'shrub-border' : 'flower-bed', horizontal ? 'x' : 'y', site.id, seed + i * 17);
    }
    // The courtyard metadata describes its narrow circulation apron. Garden
    // ground also exists behind the houses and around the outside corners;
    // use those real grass cells instead of leaving the whole address bare.
    const residential = site.kind === 'courtyard' || site.kind === 'service-yard';
    if (!residential) continue;
    for (let side = 0; side < 4; side++) for (let part = 0; part < 2; part++) {
      const horizontal = side < 2, length = horizontal ? site.width : site.height;
      const long = Math.min(8.8, Math.max(4.5, length * .22)), depth = 3.8;
      const along = length * (part ? .59 : .16) - long / 2;
      const x = horizontal ? site.x + along : side === 2 ? site.x + .5 : site.x + site.width - depth - .5;
      const y = horizontal ? side === 0 ? site.y + .5 : site.y + site.height - depth - .5 : site.y + along;
      add({ x, y, width: horizontal ? long : depth, height: horizontal ? depth : long }, 'shrub-border', horizontal ? 'x' : 'y', site.id, seed + 197 + side * 31 + part * 7, true, site);
    }
    for (const [index, building] of site.buildings.entries()) {
      const variant = pixelSeed(building.id), offset = variant % 4;
      for (let i = 0; i < 2; i++) {
        const corner = (offset + i * 2) % 4, east = corner === 1 || corner === 2, south = corner >= 2;
        const x = east ? building.x + building.width - .7 : building.x - 4.9;
        const y = south ? building.y + building.height - .7 : building.y - 4.1;
        add({ x, y, width: 5.6, height: 4.8 }, (index + i) % 3 ? 'shrub-border' : 'flower-bed', building.width >= building.height ? 'x' : 'y', site.id,
          variant + i * 53, true, site);
      }
    }
  }
  for (const prop of world.props ?? []) {
    if (attempts >= MAX_ATTEMPTS || result.length >= MAX_DETAILS) break;
    if (!['tree', 'shrub', 'garden', 'planter', 'bench', 'playground'].includes(prop.kind) || !inside(prop, city)) continue;
    const seed = pixelSeed(prop.id), axis = prop.orientation, horizontal = axis === 'x';
    const woody = prop.kind === 'tree' || prop.kind === 'shrub';
    const kind = woody ? 'lawn-island' : prop.kind === 'bench' || prop.kind === 'planter' ? 'flower-bed' : 'shrub-border';
    const w = woody ? 5.6 : horizontal ? Math.max(4.2, prop.width + 1.5) : 2.8;
    const h = woody ? 4.4 : horizontal ? 2.8 : Math.max(4.2, prop.height + 1.5);
    // A companion border sits behind its bench, rather than beneath its seat.
    const cx = prop.x + prop.width / 2 - (horizontal || woody ? 0 : prop.width / 2 + w / 2 + .25);
    const cy = prop.y + prop.height / 2 - (!horizontal || woody ? 0 : prop.height / 2 + h / 2 + .25);
    add({ x: cx - w / 2, y: cy - h / 2, width: w, height: h }, kind, axis, prop.id, seed);
  }
  return result;
}

/** Open-stem garden trees are decorative planting, not solid tactical cover.
 * Their tiny trunks stand in the already reserved low beds, outside circulation.
 * Nothing is inserted into authoritative props, collision or save data. */
export function cityGardenTrees(world: Pick<LiveWorld, 'citySites' | 'props'>, gardens: readonly CityGardenGroundDetail[]): LiveWorldProp[] {
  const sites = new Map((world.citySites ?? []).filter(site => site.kind === 'courtyard' || site.kind === 'service-yard').map(site => [site.id, site]));
  const occupied = new Set<string>(), counts = new Map<string, number>(), result: LiveWorldProp[] = [];
  const reserve = (x: number, y: number, radius: number): void => {
    for (let cy = Math.floor((y - radius) / 3); cy <= Math.floor((y + radius) / 3); cy++)
      for (let cx = Math.floor((x - radius) / 3); cx <= Math.floor((x + radius) / 3); cx++) occupied.add(`${cx}:${cy}`);
  };
  for (const prop of world.props ?? []) if (prop.kind === 'tree') reserve(prop.x + prop.width / 2, prop.y + prop.height / 2, 2.5);
  for (const garden of gardens) {
    if (result.length >= 256) break;
    const site = sites.get(garden.sourceId), count = counts.get(garden.sourceId) ?? 0;
    if (!site || count >= (site.kind === 'courtyard' ? 2 : 1)) continue;
    let best: LivePoint | undefined, distance = Infinity;
    const center = { x: garden.x + garden.width / 2, y: garden.y + garden.height / 2 };
    for (const run of garden.clip) for (let x = run.x; x < run.x + run.width; x++) {
      const point = { x: x + .5, y: run.y + .5 };
      if (occupied.has(`${Math.floor(point.x / 3)}:${Math.floor(point.y / 3)}`)) continue;
      const d = (point.x - center.x) ** 2 + (point.y - center.y) ** 2;
      if (d < distance) { best = point; distance = d; }
    }
    if (!best) continue;
    result.push({ id: `garden-tree:${site.id}:${count}`, kind: 'tree', x: best.x - .375, y: best.y - .375,
      width: .75, height: .75, orientation: 'x', variant: (garden.seed + count) % 3, blocking: false });
    reserve(best.x, best.y, 2.5); counts.set(site.id, count + 1);
  }
  return result;
}

/** Muted lawn masses survive the bounded world cache; their low shrubs and
 * flower heads are completed at display scale, with exactly the same clip. */
export function paintCityGardenGroundDetail(c: CanvasRenderingContext2D, detail: CityGardenGroundDetail, fine = true): void {
  const { x, y, width: w, height: h, kind, seed } = detail, random = pixelRandom(seed);
  const horizontal = detail.axis === 'x';
  const ellipse = (u: number, v: number, rx: number, ry: number, color: string): void => {
    c.fillStyle = color; c.beginPath(); c.ellipse(x + u * w, y + v * h, rx * w, ry * h, 0, 0, Math.PI * 2); c.fill();
  };
  c.save(); c.beginPath();
  for (const run of detail.clip) c.rect(run.x, run.y, run.width, run.height);
  c.clip();
  // Overlapping, unequal masses give a planted island a coherent irregular
  // contour rather than colouring every courtyard cell a different green.
  ellipse(.5, .54, .49, .43, '#66764e');
  ellipse(.36, .43, .33, .38, '#7e8960');
  ellipse(.71, .59, .27, .29, '#6f8054');
  if (kind !== 'lawn-island') {
    ellipse(.5, .52, .39, .28, '#655e43');
    const count = kind === 'shrub-border' ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const along = .16 + i * .68 / (count - 1), across = .48 + (random() - .5) * .18;
      const u = horizontal ? along : across, v = horizontal ? across : along;
      ellipse(u + .025, v + .04, horizontal ? .105 : .13, horizontal ? .18 : .085, '#3f5941');
      ellipse(u, v, horizontal ? .105 : .13, horizontal ? .16 : .085, kind === 'shrub-border' ? '#617b4e' : '#6c8050');
      if (fine) {
        ellipse(u - .025, v - .035, .055, .065, '#8a9b5f');
        if (kind === 'flower-bed') {
          const colors = ['#c2af72', '#aa796c', '#d0c499'];
          for (let flower = 0; flower < 4; flower++) ellipse(u + (random() - .5) * .1, v + (random() - .5) * .12, .012, .015, colors[(seed + i + flower) % colors.length]!);
        }
      }
    }
  }
  if (fine) for (let i = 0; i < 14; i++) {
    const u = .12 + random() * .74, v = .16 + random() * .69;
    c.fillStyle = i % 4 ? '#a0a46f6e' : '#bdba805c';
    c.fillRect(x + u * w, y + v * h, .06, .035);
  }
  c.restore();
}
