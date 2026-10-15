import type { LiveCitySite, LivePoint, LiveTerrain, LiveWorld, LiveWorldProp } from './game/live';
import { legacyHallEnvelopes } from './game/world-building-envelope';
import type { CityGardenGroundDetail } from './live-city-gardens';
import { pixelSeed } from './pixel-art';

type Rect = LivePoint & { width: number; height: number };
type CourtyardWorld = Pick<LiveWorld, 'width' | 'height' | 'city' | 'citySites' | 'props' | 'obstacles' | 'containers' | 'extracts' | 'districts' | 'pois' | 'paths'>;
type YardUse = LiveCitySite['kind'];
export type CourtyardGroundDetail = Rect & {
  kind: 'desire-line' | 'entry-pad' | 'fixture-wear' | 'service-corner' | 'paving-remnant';
  seed: number; sourceId: string; context: YardUse;
  material: 'paved' | 'earth'; finish: 'brick' | 'slab' | 'soil' | 'gravel' | 'worn';
  center: LivePoint; along: LivePoint; across: LivePoint; length: number; breadth: number;
  contour: LivePoint[];
  /** Exact free outdoor runs, shared by the bitmap and native fine pass. */
  clip: Rect[];
};
export const COURTYARD_ART_LIMITS = { details: 2048, candidates: 16384, runs: 65536, maxSide: 14, perSite: 14 } as const;
const HARD = 1, INTERACTION = 2, DOOR = 4, ROUTE = 8, CLAIMED = 16;
const ground = new Set<LiveTerrain>(['concrete', 'yard', 'grass', 'path', 'sand']);
const fixtureKinds = new Set<LiveWorldProp['kind']>(['bench', 'playground', 'garden', 'dumpster', 'kiosk', 'market-stall', 'workbench']);
const inside = (point: LivePoint, rect: Rect): boolean => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
const validRect = (rect: Rect): boolean => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
const distanceToLine = (point: LivePoint, a: LivePoint, b: LivePoint): { point: LivePoint; distance: number } => {
  const dx = b.x - a.x, dy = b.y - a.y, size = dx * dx + dy * dy;
  const t = size ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / size)) : 0;
  const closest = { x: a.x + dx * t, y: a.y + dy * t };
  return { point: closest, distance: Math.hypot(closest.x - point.x, closest.y - point.y) };
};

/** Existing doorways, passages and fixtures explain every mark. No generated
 * ground changes a material, a height, collision, cover or navigation data. */
export function buildCourtyardGround(world: CourtyardWorld, terrain: readonly LiveTerrain[], walkable: Uint8Array, indoor: Uint8Array,
  gardens: readonly CityGardenGroundDetail[] = []): CourtyardGroundDetail[] {
  const { width, height, city } = world, total = width * height;
  if (!city || !validRect(city) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1024 || height > 1024
    || terrain.length < total || walkable.length < total || indoor.length < total) return [];
  const flags = new Uint8Array(total), result: CourtyardGroundDetail[] = [];
  let attempts = 0, runs = 0;
  const reserve = (rect: Rect, flag: number, margin = 0): void => {
    if (!validRect(rect)) return;
    for (let y = Math.max(0, Math.floor(rect.y - margin)); y < Math.min(height, Math.ceil(rect.y + rect.height + margin)); y++)
      for (let x = Math.max(0, Math.floor(rect.x - margin)); x < Math.min(width, Math.ceil(rect.x + rect.width + margin)); x++) flags[y * width + x]! |= flag;
  };
  const protect = (point: LivePoint, radius: number, flag: number): void => reserve({ x: point.x + .5 - radius, y: point.y + .5 - radius, width: radius * 2, height: radius * 2 }, flag);
  const reserveLine = (a: LivePoint, b: LivePoint, radius: number): void => {
    const distance = Math.hypot(b.x - a.x, b.y - a.y), count = Math.min(4096, Math.ceil(distance * 2));
    if (!Number.isFinite(distance)) return;
    for (let step = 0; step <= count; step++) protect({ x: a.x + (b.x - a.x) * step / Math.max(1, count), y: a.y + (b.y - a.y) * step / Math.max(1, count) }, radius, ROUTE);
  };
  for (const obstacle of world.obstacles) reserve(obstacle, HARD);
  for (const prop of world.props ?? []) reserve(prop, HARD, .1);
  for (const garden of gardens) for (const clip of garden.clip) reserve(clip, HARD);
  for (const anchor of world.containers) protect(anchor, 1.5, INTERACTION);
  for (const extract of world.extracts) protect(extract, 3.5, INTERACTION);
  for (const district of world.districts) for (const spawn of district.spawns) protect(spawn, 3, INTERACTION);
  for (const poi of world.pois) for (const entrance of poi.entrances) protect(entrance, 1.3, DOOR);
  for (const site of world.citySites ?? []) {
    for (const building of site.buildings) {
      reserve(building, HARD);
      for (const door of building.entrances) protect(door, 1.4, DOOR);
    }
    for (const passage of site.passages) for (let i = 1; i < passage.length; i++) reserveLine(passage[i - 1]!, passage[i]!, .8);
  }
  const halls = legacyHallEnvelopes(world);
  const buildings = [...world.citySites?.flatMap(site => site.buildings) ?? [], ...halls];
  for (const hall of halls) { reserve(hall, HARD); for (const entrance of hall.entrances) protect(entrance, 1.4, DOOR); }
  for (const path of world.paths ?? []) if (path.kind === 'trail') for (let i = 1; i < path.points.length; i++) reserveLine(path.points[i - 1]!, path.points[i]!, path.width / 2 + .15);
  const full = (): boolean => result.length >= COURTYARD_ART_LIMITS.details || attempts >= COURTYARD_ART_LIMITS.candidates || runs >= COURTYARD_ART_LIMITS.runs;
  const free = (x: number, y: number, kind: CourtyardGroundDetail['kind']): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height || !inside({ x, y }, city)) return false;
    const cell = y * width + x, excluded = HARD | INTERACTION | CLAIMED | (kind === 'entry-pad' ? 0 : DOOR)
      | (kind === 'paving-remnant' || kind === 'service-corner' ? ROUTE : 0);
    return !(flags[cell]! & excluded) && !indoor[cell] && !!walkable[cell] && ground.has(terrain[cell]!);
  };
  const add = (kind: CourtyardGroundDetail['kind'], center: LivePoint, along: LivePoint, length: number, breadth: number, sourceId: string, context: YardUse, seed: number, scope?: Rect): boolean => {
    if (full()) return false;
    attempts++;
    if (![center.x, center.y, along.x, along.y, length, breadth].every(Number.isFinite) || length < .1 || breadth < .1) return false;
    const cx = Math.floor(center.x), cy = Math.floor(center.y);
    if (!free(cx, cy, kind)) return false;
    const material = terrain[cy * width + cx] === 'concrete' ? 'paved' : 'earth';
    if (kind === 'paving-remnant' && terrain[cy * width + cx] !== 'concrete' && terrain[cy * width + cx] !== 'yard') return false;
    const across = { x: -along.y, y: along.x }, halfX = Math.abs(along.x) * length / 2 + Math.abs(across.x) * breadth / 2 + .12;
    const halfY = Math.abs(along.y) * length / 2 + Math.abs(across.y) * breadth / 2 + .12;
    const left = Math.max(0, Math.floor(center.x - halfX)), top = Math.max(0, Math.floor(center.y - halfY));
    const right = Math.min(width, Math.ceil(center.x + halfX)), bottom = Math.min(height, Math.ceil(center.y + halfY));
    if (right - left > COURTYARD_ART_LIMITS.maxSide || bottom - top > COURTYARD_ART_LIMITS.maxSide) return false;
    const clip: Rect[] = []; let area = 0;
    for (let y = top; y < bottom; y++) {
      let start = -1;
      for (let x = left; x <= right; x++) {
        const cell = y * width + x, accept = x < right && free(x, y, kind) && (!scope || inside({ x, y }, scope))
          && (material === 'paved' ? terrain[cell] === 'concrete' : terrain[cell] !== 'concrete')
          && (kind !== 'paving-remnant' || terrain[cell] === 'concrete' || terrain[cell] === 'yard');
        if (accept && start < 0) start = x;
        else if (!accept && start >= 0) { clip.push({ x: start, y, width: x - start, height: 1 }); area += x - start; start = -1; }
      }
    }
    if (area < 2 || area < (right - left) * (bottom - top) * .3 || runs + clip.length > COURTYARD_ART_LIMITS.runs) return false;
    const local = (u: number, v: number): LivePoint => ({ x: center.x + along.x * u + across.x * v, y: center.y + along.y * u + across.y * v });
    const thin = kind === 'desire-line', edge = breadth / 2;
    const contour = thin ? [local(-length / 2, -edge * .35), local(-length * .3, -edge * .9), local(length * .32, -edge), local(length / 2, -edge * .25),
      local(length / 2, edge * .3), local(length * .22, edge * .85), local(-length * .28, edge), local(-length / 2, edge * .3)]
      : [local(-length / 2, -edge * .8), local(length * .4, -edge), local(length / 2, -edge * .7), local(length * .47, edge * .75), local(-length * .38, edge), local(-length / 2, edge * .65)];
    const worn = kind === 'desire-line' || kind === 'fixture-wear' || kind === 'service-corner';
    const finish = worn ? context === 'workyard' ? 'gravel' : material === 'paved' ? 'worn' : 'soil'
      : material === 'earth' && kind !== 'paving-remnant' ? context === 'workyard' ? 'gravel' : 'soil'
      : context === 'arcade' || context === 'courtyard' && seed % 3 === 0 ? 'brick' : context === 'workyard' ? 'gravel' : 'slab';
    result.push({ x: left, y: top, width: right - left, height: bottom - top, kind, seed, sourceId, context, material, finish, center, along, across, length, breadth, contour, clip });
    runs += clip.length;
    for (const run of clip) for (let x = run.x; x < run.x + run.width; x++) flags[run.y * width + x]! |= CLAIMED;
    return true;
  };
  const outward = (door: LivePoint, building: Rect): LivePoint | null => door.x === building.x ? { x: -1, y: 0 } : door.x === building.x + building.width - 1 ? { x: 1, y: 0 }
    : door.y === building.y ? { x: 0, y: -1 } : door.y === building.y + building.height - 1 ? { x: 0, y: 1 } : null;
  const exterior = (door: LivePoint, normal: LivePoint): LivePoint => ({ x: door.x + .5 + normal.x * 1.5, y: door.y + .5 + normal.y * 1.5 });
  const nearestPassage = (point: LivePoint, site: LiveCitySite): ReturnType<typeof distanceToLine> | undefined => {
    let best: ReturnType<typeof distanceToLine> | undefined;
    for (const passage of site.passages) for (let i = 1; i < passage.length; i++) {
      const a = { x: passage[i - 1]!.x + .5, y: passage[i - 1]!.y + .5 }, b = { x: passage[i]!.x + .5, y: passage[i]!.y + .5 }, candidate = distanceToLine(point, a, b);
      if (!best || candidate.distance < best.distance) best = candidate;
    }
    return best;
  };
  const linked = new Set<string>(), handledFixtures = new Set<string>();
  const fixtureUse = (prop: LiveWorldProp, context: YardUse, scope?: Rect): boolean => {
    const anchor = { x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 };
    if (indoor[Math.floor(anchor.y) * width + Math.floor(anchor.x)] || buildings.some(building => inside(anchor, building))) return false;
    const horizontal = prop.orientation === 'x', along = horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const normal = horizontal ? { x: 0, y: 1 } : { x: -1, y: 0 }, offset = (horizontal ? prop.height : prop.width) / 2 + 1.25;
    const center = { x: prop.x + prop.width / 2 + normal.x * offset, y: prop.y + prop.height / 2 + normal.y * offset };
    const service = prop.kind === 'dumpster' || prop.kind === 'workbench', seed = pixelSeed(prop.id);
    const success = add(service ? 'service-corner' : 'fixture-wear', center, along, prop.kind === 'playground' ? 3.6 : Math.max(2.3, horizontal ? prop.width + .5 : prop.height + .5), service ? 1.65 : 1.35, prop.id, context, seed, scope);
    if (success) handledFixtures.add(prop.id);
    return success;
  };
  for (const site of world.citySites ?? []) {
    if (full()) break;
    const start = result.length, seed = pixelSeed(site.id), quota = (): boolean => full() || result.length - start >= COURTYARD_ART_LIMITS.perSite;
    // One courtyard-facing pad per actual building leaves enough of the global
    // budget for paths and used places in every later district.
    for (const building of site.buildings) {
      if (quota()) break;
      const doors = building.entrances.map(door => ({ door, normal: outward(door, building) })).filter(item => item.normal)
        .sort((a, b) => (nearestPassage(exterior(a.door, a.normal!), site)?.distance ?? Infinity) - (nearestPassage(exterior(b.door, b.normal!), site)?.distance ?? Infinity));
      for (const { door, normal } of doors) if (normal && add('entry-pad', exterior(door, normal), { x: -normal.y, y: normal.x }, 2.4, 1.65, building.id, site.kind, pixelSeed(building.id), site)) break;
    }
    const fixtures = (world.props ?? []).filter(prop => fixtureKinds.has(prop.kind) && inside({ x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 }, site))
      .sort((a, b) => Number(b.kind === 'playground' || b.kind === 'dumpster') - Number(a.kind === 'playground' || a.kind === 'dumpster') || pixelSeed(a.id) - pixelSeed(b.id));
    let used = 0;
    for (const prop of fixtures) { if (quota() || used >= 2) break; if (fixtureUse(prop, site.kind, site)) used++; }
    for (let attempt = 0; attempt < Math.min(4, site.buildings.length) && !quota(); attempt++) {
      const building = site.buildings[(attempt + seed % site.buildings.length) % site.buildings.length]!, east = (seed + attempt) % 2 === 0;
      const center = { x: east ? building.x + building.width + 1.4 : building.x - 1.4, y: building.y + building.height * (.25 + attempt % 2 * .5) };
      if (add('paving-remnant', center, { x: 0, y: 1 }, 2.8, 1.55, site.id, site.kind, seed + attempt * 19, site)) break;
    }
    let paths = 0;
    for (const passage of site.passages) for (let i = 1; i < passage.length && !quota() && paths < 4; i++) {
      const a = passage[i - 1]!, b = passage[i]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length < 2) continue;
      const along = { x: dx / length, y: dy / length };
      for (let distance = 0; distance < length && !quota() && paths < 4; distance += 7.5) {
        const end = Math.min(length, distance + 7.5), center = { x: a.x + .5 + along.x * (distance + end) / 2, y: a.y + .5 + along.y * (distance + end) / 2 };
        const key = `${Math.floor(center.x / 3)}:${Math.floor(center.y / 3)}`;
        if (linked.has(key)) continue;
        if (add('desire-line', center, along, end - distance, site.kind === 'workyard' ? 1.25 : .95, site.id, site.kind, seed + i * 17, site)) { linked.add(key); paths++; }
      }
    }
  }
  // Six-wall legacy halls have real doors too. Their roof envelope remains hard
  // protection even if an old terrain raster is concrete inside the hall.
  for (const hall of halls) {
    if (full()) break;
    const door = hall.entrances[pixelSeed(hall.id) % hall.entrances.length], normal = door && outward(door, hall);
    if (door && normal) add('entry-pad', exterior(door, normal), { x: -normal.y, y: normal.x }, 2.6, 1.65, hall.id, 'service-yard', pixelSeed(hall.id));
  }
  for (const prop of world.props ?? []) {
    if (full()) break;
    if (!fixtureKinds.has(prop.kind) || handledFixtures.has(prop.id) || !inside(prop, city)) continue;
    const site = world.citySites?.find(site => inside({ x: prop.x + prop.width / 2, y: prop.y + prop.height / 2 }, site));
    if (!site) fixtureUse(prop, prop.kind === 'dumpster' || prop.kind === 'workbench' ? 'workyard' : prop.kind === 'kiosk' || prop.kind === 'market-stall' ? 'arcade' : 'courtyard');
  }
  return result;
}

/** Flat pigments stay quiet under fighters. Foundation is cached once; native
 * rendering passes foundation=false to add only thin wear, joints and traces. */
export function paintCourtyardGroundDetail(c: CanvasRenderingContext2D, detail: CourtyardGroundDetail, fine = true, foundation = true): void {
  if (!foundation && !fine || !detail.clip.length) return;
  const { center, along, across, length, breadth, seed } = detail;
  const at = (u: number, v: number): LivePoint => ({ x: center.x + along.x * u + across.x * v, y: center.y + along.y * u + across.y * v });
  const line = (a: LivePoint, b: LivePoint, color: string, width: number): void => { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = color; c.lineWidth = width; c.stroke(); };
  const polygon = (points: readonly LivePoint[], color: string): void => { c.beginPath(); points.forEach((point, i) => i ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y)); c.closePath(); c.fillStyle = color; c.fill(); };
  c.save(); c.beginPath();
  for (const run of detail.clip) c.rect(run.x, run.y, run.width, run.height);
  c.clip(); c.lineCap = 'round'; c.lineJoin = 'round';
  if (foundation) {
    const worn = detail.kind === 'desire-line' || detail.kind === 'fixture-wear' || detail.kind === 'service-corner';
    const stone = detail.finish === 'brick' || detail.context === 'arcade' ? '#b1a08a' : detail.context === 'workyard' ? '#99917b' : detail.context === 'service-yard' ? '#a5ada4' : '#afa993';
    const color = detail.material === 'earth' ? detail.context === 'workyard' ? '#a298784d' : '#b0a07a5e'
      : worn ? detail.context === 'arcade' ? '#8e82754d' : detail.context === 'workyard' ? '#817b6a50' : detail.context === 'service-yard' ? '#818b8550' : '#777d7545' : stone;
    polygon(detail.contour, color);
    if (detail.kind === 'desire-line') line(at(-length * .35, -.08), at(length * .36, .03), detail.material === 'earth' ? '#b8aa8640' : '#b3b09d29', breadth * .36);
  }
  if (fine) {
    if (detail.finish === 'brick' || detail.finish === 'slab') {
      const step = detail.finish === 'brick' ? .65 : 1.15;
      // A few partial courses describe one old pad, not a city-wide tile grid.
      for (let u = -length * .35 + seed % 13 / 100; u < length * .35; u += step) {
        line(at(u, -breadth * .28), at(u + .015, breadth * .25), '#69766b69', .026);
      }
      line(at(-length * .34, -.03), at(length * .32, -.03), '#d3c8ad5e', .022);
    } else {
      const count = detail.kind === 'desire-line' ? 5 : 3;
      for (let i = 0; i < count; i++) {
        const u = length * (-.33 + i / Math.max(1, count - 1) * .65), v = ((seed >>> i * 3) % 11 / 10 - .5) * breadth * .4;
        line(at(u, v), at(u + .14, v + .035), detail.finish === 'gravel' ? '#6d756a65' : detail.material === 'paved' ? '#72796e55' : '#7b795e60', .045);
      }
    }
    if (detail.kind === 'service-corner') for (const side of [-1, 1]) line(at(-length * .3, side * breadth * .2), at(length * .26, side * breadth * .2), '#626e6254', .065);
    else if (detail.kind === 'fixture-wear') for (const side of [-1, 1]) line(at(side * length * .23, -.15), at(side * length * .23 + .15, .08), '#6e77665b', .045);
    else if (detail.kind === 'entry-pad') line(at(-length * .27, breadth * .31), at(length * .25, breadth * .31), '#787c6a55', .04);
  }
  c.restore();
}
