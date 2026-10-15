import type { LivePoint, LiveTerrain, LiveWorld, LiveWorldProp } from './game/live';
import { legacyHallEnvelopes } from './game/world-building-envelope';
import { pixelRandom, pixelSeed } from './pixel-art';

type Rect = LivePoint & { width: number; height: number };
type GardenWorld = Pick<LiveWorld, 'width' | 'height' | 'city' | 'citySites' | 'props' | 'paths' | 'obstacles' | 'containers' | 'extracts' | 'pois' | 'districts'>;
export type CityGardenGroundDetail = Rect & {
  kind: 'lawn-island' | 'flower-bed' | 'shrub-border';
  /** A coherent planting grammar. Optional for older presentation fixtures. */
  design?: 'meadow' | 'parterre' | 'hedge' | 'allotment' | 'foundation' | 'formal';
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
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return;
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
  // Exact collider envelopes identify actual old halls. A large POI rectangle
  // alone is not a roof, but the open floor inside its six wall pieces is.
  for (const hall of legacyHallEnvelopes(world)) {
    fill(hall, .35);
    for (const door of hall.entrances) protect(door, 1.7);
  }
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
  const add = (rect: Rect, kind: CityGardenGroundDetail['kind'], axis: 'x' | 'y', sourceId: string, seed: number, naturalOnly = false, scope?: Rect,
    design: CityGardenGroundDetail['design'] = kind === 'lawn-island' ? 'meadow' : kind === 'flower-bed' ? 'parterre' : 'hedge'): void => {
    if (++attempts > MAX_ATTEMPTS || result.length >= MAX_DETAILS || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0 || rect.width > 10 || rect.height > 10) return;
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
    result.push({ ...rect, kind, design, axis, sourceId, seed, clip });
  };
  // Existing public furnishings are the strongest anchors. Reserve their
  // companion beds before broader planting so a garden never erases the
  // flower border belonging to an actual bench or little allotment.
  for (const prop of world.props ?? []) {
    if (attempts >= MAX_ATTEMPTS || result.length >= MAX_DETAILS) break;
    if (!['tree', 'shrub', 'garden', 'planter', 'bench', 'playground'].includes(prop.kind) || !inside(prop, city)) continue;
    const seed = pixelSeed(prop.id), axis = prop.orientation, horizontal = axis === 'x';
    if (prop.kind === 'tree' || prop.kind === 'shrub') {
      add({ x: prop.x + prop.width / 2 - 3.6, y: prop.y + prop.height / 2 - 2.7, width: 7.2, height: 5.4 }, 'lawn-island', axis, prop.id, seed);
    } else if (prop.kind === 'garden') {
      const long = Math.min(8.2, Math.max(4.8, (horizontal ? prop.width : prop.height) + 2)), depth = 2.8;
      add({ x: horizontal ? prop.x + prop.width / 2 - long / 2 : prop.x - depth - .45,
        y: horizontal ? prop.y - depth - .45 : prop.y + prop.height / 2 - long / 2,
        width: horizontal ? long : depth, height: horizontal ? depth : long }, 'flower-bed', axis, prop.id, seed, false, undefined, 'allotment');
    } else {
      const long = Math.min(8, Math.max(prop.kind === 'playground' ? 6.4 : 4.8, (horizontal ? prop.width : prop.height) + 2.5)), depth = prop.kind === 'playground' ? 2.3 : 1.8;
      add({ x: horizontal ? prop.x + prop.width / 2 - long / 2 : prop.x - depth - .5,
        y: horizontal ? prop.y - depth - .5 : prop.y + prop.height / 2 - long / 2,
        width: horizontal ? long : depth, height: horizontal ? depth : long }, prop.kind === 'playground' ? 'shrub-border' : 'flower-bed', axis, prop.id, seed, false,
      undefined, prop.kind === 'playground' ? 'hedge' : prop.kind === 'planter' ? 'formal' : 'parterre');
    }
  }
  for (const site of world.citySites ?? []) {
    if (attempts >= MAX_ATTEMPTS || result.length >= MAX_DETAILS) break;
    const { courtyard: court } = site, seed = pixelSeed(site.id);
    if (!court) continue;
    const residential = site.kind === 'courtyard' || site.kind === 'service-yard', formal = site.kind === 'arcade';
    // Broad lawn rooms belong to sheltered corners, with the authored middle
    // way left open. Arcades have two restrained formal beds; working yards
    // retain just one unkempt planted margin, rather than a domestic garden.
    const count = site.kind === 'courtyard' ? 4 : site.kind === 'workyard' ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const corner = (i + seed % 4) % 4, east = corner === 1 || corner === 2, south = corner >= 2, horizontal = court.width >= court.height;
      const hedge = residential && i === 1;
      const long = formal ? 6.8 : 8.8, depth = formal ? 2.2 : hedge ? 2.4 : 5.6;
      const w = Math.min(horizontal ? long : depth, Math.max(1, court.width - 1));
      const h = Math.min(horizontal ? depth : long, Math.max(1, court.height - 1));
      const x = east ? court.x + court.width - w - .45 : court.x + .45;
      const y = south ? court.y + court.height - h - .45 : court.y + .45;
      add({ x, y, width: w, height: h }, formal ? 'flower-bed' : hedge ? 'shrub-border' : 'lawn-island', horizontal ? 'x' : 'y', site.id, seed + i * 17,
        site.kind === 'workyard', site, formal ? 'formal' : hedge ? 'hedge' : 'meadow');
    }
    for (const building of site.buildings) {
      const variant = pixelSeed(building.id);
      if (residential || formal) for (const [doorIndex, door] of building.entrances.entries()) {
        const north = door.y === building.y, south = door.y === building.y + building.height - 1;
        const west = door.x === building.x, east = door.x === building.x + building.width - 1;
        if (!north && !south && !west && !east) continue;
        const horizontal = north || south, span = Math.min(4.8, Math.max(2.8, (horizontal ? building.width : building.height) * .33));
        const plane = horizontal ? north ? building.y - 2.35 : building.y + building.height + .55 : west ? building.x - 2.35 : building.x + building.width + .55;
        const center = horizontal ? door.x + .5 : door.y + .5;
        for (const side of [-1, 1]) {
          const along = side < 0 ? center - 2.25 - span : center + 2.25;
          add({ x: horizontal ? along : plane, y: horizontal ? plane : along, width: horizontal ? span : 1.8, height: horizontal ? 1.8 : span },
            'flower-bed', horizontal ? 'x' : 'y', site.id, variant + doorIndex * 37 + side * 13, false, site, formal ? 'formal' : 'parterre');
        }
      }
      // Foundation strips follow the two house faces looking into the actual
      // yard. Break long runs before they become a continuous green fence.
      const dx = court.x + court.width / 2 - building.x - building.width / 2, dy = court.y + court.height / 2 - building.y - building.height / 2;
      const faces = [dy < 0 ? 0 : 1, dx < 0 ? 2 : 3];
      for (const [faceIndex, side] of faces.entries()) {
        const horizontal = side < 2, available = (horizontal ? building.width : building.height) - 1;
        const pieces = available > 11 ? 2 : 1, long = Math.min(8.6, available / pieces - (pieces > 1 ? .8 : 0));
        if (long < 2.5) continue;
        const depth = site.kind === 'workyard' ? 1.5 : formal ? 1.65 : 2.45;
        for (let piece = 0; piece < pieces; piece++) {
          const along = .5 + piece * (long + 1.6), x = horizontal ? building.x + along : side === 2 ? building.x - depth - .55 : building.x + building.width + .55;
          const y = horizontal ? side === 0 ? building.y - depth - .55 : building.y + building.height + .55 : building.y + along;
          const allotment = site.kind === 'service-yard' && faceIndex === 1 && variant % 3 === 0;
          add({ x, y, width: horizontal ? long : depth, height: horizontal ? depth : long }, allotment ? 'flower-bed' : 'shrub-border', horizontal ? 'x' : 'y', site.id,
            variant + side * 31 + piece * 7, site.kind === 'workyard', site, allotment ? 'allotment' : formal ? 'formal' : site.kind === 'workyard' ? 'hedge' : 'foundation');
        }
      }
    }
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
    if (garden.design === 'parterre' || garden.design === 'formal' || garden.design === 'allotment') continue;
    const site = sites.get(garden.sourceId), count = counts.get(garden.sourceId) ?? 0;
    if (!site || count >= (site.kind === 'courtyard' ? 4 : 2)) continue;
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
      width: .75, height: .75, orientation: 'x', variant: (garden.seed + count) % 2 ? 2 : 0, blocking: false });
    reserve(best.x, best.y, 2.5); counts.set(site.id, count + 1);
  }
  return result;
}

/** Muted lawn masses survive the bounded world cache; their low shrubs and
 * flower heads are completed at display scale, with exactly the same clip. */
export function paintCityGardenGroundDetail(c: CanvasRenderingContext2D, detail: CityGardenGroundDetail, fine = true): void {
  const { x, y, width: w, height: h, kind, seed } = detail;
  const design = detail.design ?? (kind === 'lawn-island' ? 'meadow' : kind === 'flower-bed' ? 'parterre' : 'hedge');
  const random = pixelRandom(seed ^ 0x734b21), warm = seed % 3 === 0;
  const horizontal = detail.axis === 'x';
  const point = (u: number, v: number): LivePoint => ({ x: x + (horizontal ? u : v) * w, y: y + (horizontal ? v : u) * h });
  const polygon = (points: ReadonlyArray<readonly [number, number]>, color: string): void => {
    c.fillStyle = color; c.beginPath();
    for (let i = 0; i < points.length; i++) { const p = point(points[i]![0], points[i]![1]); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
    c.closePath(); c.fill();
  };
  const strip = (a: number, b: number, near: number, far: number, color: string, phase = 0): void => {
    const notch = .018 + (seed + phase * 11) % 7 / 1000, long = b - a;
    polygon([[a, near + notch], [a + long * .17, near], [a + long * .48, near + notch], [b - long * .12, near - notch],
      [b, near + notch * 2], [b - .008, far - notch], [a + long * .6, far], [a + long * .23, far - notch * 2], [a, far - notch]], color);
  };
  const leaf = (u: number, v: number, length: number, depth: number, color: string): void => {
    polygon([[u, v], [u + length * .38, v - depth], [u + length, v - depth * .4], [u + length * .65, v + depth * .55]], color);
  };
  const flowers = (count: number, formal = false): void => {
    const colors = warm ? ['#bca879', '#b88278', '#d1c49d'] : ['#b0b281', '#b18d97', '#c9bfa0'];
    for (let i = 0; i < count; i++) {
      // Unequal clustered drifts share a continuous foliage bed. Individual
      // flowers are a native-scale finish, not large repeated circular bushes.
      const group = i % 3, u = (group === 0 ? .14 : group === 1 ? .48 : .77) + random() * (group === 0 ? .15 : .1);
      const v = formal ? .37 + (i % 2) * .24 + (random() - .5) * .08 : .32 + random() * .36;
      const p = point(u, v), radius = .035 + random() * .018;
      c.fillStyle = colors[(i + seed) % colors.length]!; c.beginPath(); c.ellipse(p.x, p.y, radius, radius * .7, 0, 0, Math.PI * 2); c.fill();
    }
  };
  c.save(); c.beginPath();
  for (const run of detail.clip) c.rect(run.x, run.y, run.width, run.height);
  c.clip();
  if (design === 'meadow') {
    polygon([[.05,.24],[.14,.06],[.62,.04],[.88,.12],[.96,.29],[.93,.73],[.78,.94],[.31,.96],[.08,.8],[.03,.49]], warm ? '#6d7b51' : '#667b51');
    polygon([[.1,.22],[.21,.11],[.62,.1],[.79,.2],[.68,.47],[.31,.56],[.08,.43]], warm ? '#829064' : '#7d8c60');
    polygon([[.32,.59],[.57,.42],[.9,.38],[.87,.72],[.73,.88],[.38,.91]], '#728358');
    strip(.14,.73,.82,.88,'#99a27038',2);
    if (fine) for (let i = 0; i < 18; i++) leaf(.1 + random() * .75, .17 + random() * .65, .018, .014, i % 4 ? '#a1ab756b' : '#526e456b');
  } else if (design === 'hedge' || design === 'foundation') {
    strip(.02,.98,.11,.94, warm ? '#81865a' : '#75845a');
    strip(.07,.92,.17,.35,'#929b6870',1);
    const gap = design === 'foundation' ? .09 : .13, breakAt = .47 + seed % 6 / 100;
    for (const [index, span] of [[.07,breakAt], [breakAt+gap,.95]].entries()) {
      const [a,b] = span;
      strip(a!,b!,.39,.86,'#3f594660',index);
      strip(a!,b!,.27,.75,'#536f48',index+2);
      strip(a!+.012,b!-.015,.26,.49, warm ? '#82945c' : '#7b8f59',index+4);
      strip(a!+.015,b!-.022,.67,.75,'#425f42',index+6);
      if (fine) for (let i = 0; i < 10; i++) leaf(a! + .025 + random() * (b! - a! - .08), .32 + random() * .32, .025, .02, i % 3 ? '#94a1688c' : '#b2ae7370');
    }
  } else if (design === 'allotment') {
    strip(.035,.97,.08,.94,'#847650');
    strip(.07,.94,.12,.89,'#615f42',1);
    const rows = Math.min(w, h) > 2.4 ? 4 : 3;
    for (let row = 0; row < rows; row++) {
      const v = .2 + row * .62 / Math.max(1, rows - 1), end = row % 2 ? .87 : .93;
      strip(.09,end,v-.045,v+.06,'#a28c615e',row);
      strip(.12,end-.015,v-.015,v+.035, row % 2 ? '#6f8150' : '#81905a',row+3);
      if (fine) for (let i = 0; i < 9; i++) leaf(.14 + i * .078, v + (random()-.5)*.035, .035, .025, i % 3 ? '#a1ad7199' : '#405f4399');
    }
  } else if (design === 'formal') {
    polygon([[.05,.12],[.93,.12],[.97,.23],[.97,.82],[.9,.91],[.08,.91],[.035,.79],[.035,.24]],'#b3b196');
    polygon([[.065,.2],[.92,.2],[.93,.79],[.885,.84],[.085,.84],[.07,.77]],'#6b6749');
    strip(.09,.91,.25,.76,'#4e6c48',2);
    strip(.11,.9,.26,.43,'#80945e',3);
    strip(.11,.9,.61,.75,'#718857',5);
    if (fine) { for (let i=0;i<12;i++) leaf(.12+random()*.74,.29+random()*.41,.025,.018,'#a1aa7280'); flowers(15,true); }
  } else {
    // Long domestic flower borders have a soft soil lip and continuous leafy
    // drifts. Their small blooms never become a necklace of giant green peas.
    strip(.025,.98,.13,.9,'#7d7654');
    strip(.05,.95,.12,.2,'#b2aa838c',1);
    strip(.05,.96,.78,.88,'#4f62476b',2);
    strip(.075,.94,.24,.76,'#506d46',3);
    strip(.09,.48,.23,.48,warm?'#8c9560':'#85935d',4);
    strip(.49,.91,.46,.74,warm?'#7e8b57':'#728853',6);
    if (fine) { for (let i=0;i<14;i++) leaf(.1+random()*.76,.3+random()*.38,.026,.022,'#a1ac7390'); flowers(18); }
  }
  c.restore();
}
