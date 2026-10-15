import type { LivePoint, LiveTerrain, LiveWorld } from './game/live';
import { pixelRandom, pixelSeed } from './pixel-art';

type Rect = LivePoint & { width: number; height: number };
type TerrainWorld = Pick<LiveWorld, 'width' | 'height' | 'city' | 'paths' | 'citySites' | 'obstacles' | 'props' | 'pois' | 'containers' | 'extracts' | 'districts'>;
export type StreetTerrainDetail = Rect & {
  kind: 'puddle' | 'pothole' | 'repair' | 'ruts' | 'mound';
  material: 'paved' | 'earth';
  sourceId: string; seed: number;
  center: LivePoint; along: LivePoint; across: LivePoint;
  length: number; breadth: number;
  /** Small immutable contours and cell runs, shared by both rendering scales. */
  contour: LivePoint[]; clip: Rect[];
};
export const STREET_TERRAIN_LIMITS = { details: 2048, candidates: 16384, maxSide: 10 } as const;
const paved = new Set<LiveTerrain>(['road', 'concrete']);
const earth = new Set<LiveTerrain>(['yard', 'path', 'sand', 'grass']);
const inside = (x: number, y: number, r: Rect): boolean => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
const finiteRect = (r: Rect): boolean => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0;

/** Sparse wear follows actual road shoulders and courtyard access. The plan
 * adds no height, collision, water terrain or navigation permission. Temporary
 * reservation bytes are discarded; the retained plan is only local polygons. */
export function buildStreetTerrainDetails(world: TerrainWorld, terrain: readonly LiveTerrain[], walkable: Uint8Array, indoor: Uint8Array): StreetTerrainDetail[] {
  const { width, height, city } = world, cells = width * height;
  if (!city || !finiteRect(city) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || cells > 16_777_216
    || terrain.length < cells || walkable.length < cells || indoor.length < cells) return [];
  const reserved = new Uint8Array(cells), used = new Set<string>(), details: StreetTerrainDetail[] = [];
  const reserve = (r: Rect, margin = 0): void => {
    if (!finiteRect(r)) return;
    for (let y = Math.max(0, Math.floor(r.y - margin)); y < Math.min(height, Math.ceil(r.y + r.height + margin)); y++)
      for (let x = Math.max(0, Math.floor(r.x - margin)); x < Math.min(width, Math.ceil(r.x + r.width + margin)); x++) reserved[y * width + x] = 1;
  };
  const approach = (p: LivePoint, radius: number): void => reserve({ x: p.x + .5 - radius, y: p.y + .5 - radius, width: radius * 2, height: radius * 2 });
  for (const obstacle of world.obstacles) reserve(obstacle, .2);
  for (const prop of world.props ?? []) reserve(prop, .2);
  for (const anchor of world.containers) approach(anchor, 1.4);
  for (const extract of world.extracts) approach(extract, 3);
  for (const district of world.districts) for (const spawn of district.spawns) approach(spawn, 2);
  for (const poi of world.pois) for (const entrance of poi.entrances) approach(entrance, 1.6);
  for (const site of world.citySites ?? []) for (const building of site.buildings) {
    reserve(building, .25);
    for (const entrance of building.entrances) approach(entrance, 1.8);
  }
  let candidates = 0;
  const full = (): boolean => details.length >= STREET_TERRAIN_LIMITS.details || candidates >= STREET_TERRAIN_LIMITS.candidates;
  const add = (kind: StreetTerrainDetail['kind'], material: StreetTerrainDetail['material'], center: LivePoint, along: LivePoint, length: number, breadth: number,
    sourceId: string, seed: number, scope?: Rect): void => {
    if (full()) return;
    candidates++;
    if (![center.x, center.y, along.x, along.y, length, breadth].every(Number.isFinite) || length <= 0 || breadth <= 0) return;
    // Do not repeat a scar where independently authored paths share a street.
    const key = `${kind}:${Math.floor(center.x / 3)}:${Math.floor(center.y / 3)}`;
    if (used.has(key)) return;
    const across = { x: -along.y, y: along.x }, random = pixelRandom(seed);
    const local = (u: number, v: number): LivePoint => ({ x: center.x + along.x * u + across.x * v, y: center.y + along.y * u + across.y * v });
    const contour = Array.from({ length: 10 }, (_, i) => {
      const angle = i * Math.PI / 5, radius = .8 + random() * .2;
      return local(Math.cos(angle) * length * .5 * radius, Math.sin(angle) * breadth * .5 * radius);
    });
    // A small envelope includes the shaded lip and the sunlit raised edge.
    const halfX = Math.abs(along.x) * length / 2 + Math.abs(across.x) * breadth / 2 + .16;
    const halfY = Math.abs(along.y) * length / 2 + Math.abs(across.y) * breadth / 2 + .16;
    const left = Math.max(0, Math.floor(center.x - halfX)), right = Math.min(width, Math.ceil(center.x + halfX));
    const top = Math.max(0, Math.floor(center.y - halfY)), bottom = Math.min(height, Math.ceil(center.y + halfY));
    if (right <= left || bottom <= top || right - left > STREET_TERRAIN_LIMITS.maxSide || bottom - top > STREET_TERRAIN_LIMITS.maxSide) return;
    const clip: Rect[] = [], materials = material === 'paved' ? paved : earth;
    let area = 0;
    for (let y = top; y < bottom; y++) {
      let start = -1;
      for (let x = left; x <= right; x++) {
        const cell = y * width + x;
        const accept = x < right && inside(x, y, city) && (!scope || inside(x, y, scope)) && !reserved[cell] && !indoor[cell] && !!walkable[cell] && materials.has(terrain[cell]!);
        if (accept && start < 0) start = x;
        else if (!accept && start >= 0) { clip.push({ x: start, y, width: x - start, height: 1 }); area += x - start; start = -1; }
      }
    }
    const centerX = Math.floor(center.x), centerY = Math.floor(center.y), centerCell = centerY * width + centerX;
    // Reject severed fragments, rather than putting a crescent of water beside
    // an entrance or a dry pothole on a different neighbouring surface.
    if (centerX < 0 || centerY < 0 || centerX >= width || centerY >= height || reserved[centerCell] || indoor[centerCell]
      || !walkable[centerCell] || !materials.has(terrain[centerCell]!) || area < Math.max(1, (right - left) * (bottom - top) * .48)) return;
    used.add(key);
    details.push({ x: left, y: top, width: right - left, height: bottom - top, kind, material, center, along, across, length, breadth, sourceId, seed, contour, clip });
  };
  // Reserve a fair share for yards so a long first avenue cannot exhaust the
  // plan before later residential quarters receive any ground detail.
  const roadBudget = STREET_TERRAIN_LIMITS.details - Math.min(120, world.citySites?.length ?? 0) * 4;
  const roadFull = (): boolean => full() || details.length >= roadBudget;
  for (const path of world.paths ?? []) {
    if (roadFull()) break;
    if (path.kind !== 'road' || path.width < 2 || path.width > 20) continue;
    const seed = pixelSeed(path.id);
    for (let segment = 1; segment < path.points.length && !roadFull(); segment++) {
      const a = path.points[segment - 1]!, b = path.points[segment]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length < 8) continue;
      const along = { x: dx / length, y: dy / length }, across = { x: -along.y, y: along.x };
      const at = (d: number, side: number): LivePoint => ({ x: a.x + .5 + along.x * d + across.x * side, y: a.y + .5 + along.y * d + across.y * side });
      let group = 0;
      for (let d = 5 + seed % 7; d < length - 4 && !roadFull(); d += 17 + seed % 5, group++) {
        const localSeed = seed + segment * 97 + group * 31, side = (group + seed) % 2 ? -1 : 1;
        // Low, elongated pools sit against the gutter, not in a striped lane.
        add('puddle', 'paved', at(d, side * (path.width / 2 - .35)), along, 2.1 + localSeed % 18 / 10, .65 + localSeed % 4 / 10, path.id, localSeed);
        add(group % 3 === 1 ? 'pothole' : 'repair', 'paved', at(Math.min(length - 3, d + 4.5), -side * Math.min(1, path.width * .22)), along,
          group % 3 === 1 ? 1.3 : 2.7, group % 3 === 1 ? .85 : 1.55, path.id, localSeed + 7);
        if (group % 2 === 0) add('mound', 'earth', at(d + 1.7, side * (path.width / 2 + 2.6)), along, 2.8, 1.5, path.id, localSeed + 13);
      }
    }
  }
  for (const site of world.citySites ?? []) {
    if (full()) break;
    const seed = pixelSeed(site.id), start = details.length;
    const siteFull = (): boolean => full() || details.length - start >= 4;
    for (let order = 0; order < site.passages.length && !siteFull(); order++) {
      const passageIndex = (order + seed % site.passages.length) % site.passages.length, passage = site.passages[passageIndex]!;
      for (let segment = 1; segment < passage.length && !siteFull(); segment++) {
        const a = passage[segment - 1]!, b = passage[segment]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 6) continue;
        const along = { x: dx / length, y: dy / length }, across = { x: -along.y, y: along.x };
        const at = (d: number, side: number): LivePoint => ({ x: a.x + .5 + along.x * d + across.x * side, y: a.y + .5 + along.y * d + across.y * side });
        let group = 0;
        for (let d = 3.5 + seed % 3; d < length - 2 && !siteFull(); d += 14, group++) {
          const localSeed = seed + passageIndex * 73 + segment * 19 + group * 7;
          add('ruts', 'earth', at(d, 0), along, Math.min(5.6, length - d + 1), 1.7, site.id, localSeed, site);
          if (!siteFull()) add('puddle', 'earth', at(d + 1.1, localSeed % 2 ? .55 : -.55), along, 1.4 + localSeed % 7 / 10, .6, site.id, localSeed + 1, site);
          if (!siteFull() && (site.kind === 'workyard' || group % 3 === 0)) add('repair', 'paved', at(d, .75), along, 2.2, 1.35, site.id, localSeed + 2, site);
        }
      }
    }
  }
  return details;
}

/** Pigment, highlights and shallow shadow lips stay on the ground. The coarse
 * pass preserves broad value groups; the fine pass resolves grit and water
 * reflections without introducing another retained world texture. */
export function paintStreetTerrainDetail(c: CanvasRenderingContext2D, detail: StreetTerrainDetail, fine = true): void {
  const { center, along, across, length, breadth, seed, kind } = detail;
  const local = (u: number, v: number): LivePoint => ({ x: center.x + along.x * u + across.x * v, y: center.y + along.y * u + across.y * v });
  const polygon = (points: readonly LivePoint[], color: string, scale = 1, dx = 0, dy = 0): void => {
    c.fillStyle = color; c.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!, x = center.x + (p.x - center.x) * scale + dx, y = center.y + (p.y - center.y) * scale + dy;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath(); c.fill();
  };
  const line = (a: LivePoint, b: LivePoint, color: string, width: number): void => {
    c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  };
  c.save(); c.beginPath();
  for (const run of detail.clip) c.rect(run.x, run.y, run.width, run.height);
  c.clip(); c.lineCap = 'round'; c.lineJoin = 'round';
  if (kind === 'puddle') {
    polygon(detail.contour, detail.material === 'paved' ? '#394f4e8a' : '#5a5740a3', 1, .04, .06);
    polygon(detail.contour, detail.material === 'paved' ? '#718d8bad' : '#7d8b799c', .88);
    if (fine) {
      // Short broken sky reflections never outline the whole pool in white.
      for (let i = 0; i < 3; i++) {
        const start = -.28 * length + i * length * .16;
        line(local(start, -.1 * breadth + i % 2 * .13), local(start + length * .17, -.1 * breadth + i % 2 * .13), '#c3d1b780', .035);
      }
      line(local(-length * .31, breadth * .18), local(length * .13, breadth * .25), '#455f5c91', .04);
    }
  } else if (kind === 'pothole') {
    polygon(detail.contour, '#949c93', 1, -.04, -.04);
    polygon(detail.contour, '#33454b', .88, .025, .03);
    polygon(detail.contour, '#667478', .63, .045, .07);
    if (fine) for (let i = 0; i < 5; i++) {
      const p = detail.contour[(i * 2 + seed % 2) % detail.contour.length]!;
      line(p, { x: p.x + .07, y: p.y - .025 }, i % 2 ? '#c0b898' : '#263f3e', .045);
    }
  } else if (kind === 'repair') {
    polygon(detail.contour, '#858c854d', 1, -.035, -.035);
    polygon(detail.contour, seed % 2 ? '#495458' : '#5c6465', .94);
    if (fine) {
      for (let i = 0; i < detail.contour.length; i += 2) {
        const p = detail.contour[i]!, q = detail.contour[(i + 1) % detail.contour.length]!;
        line(p, q, '#263f3c73', .035);
      }
      for (let i = 0; i < 6; i++) {
        const u = ((seed >>> i * 3) % 59 / 100 - .29) * length, v = ((seed >>> i * 2) % 57 / 100 - .28) * breadth;
        line(local(u, v), local(u + .035, v), '#9caa8a6b', .025);
      }
    }
  } else if (kind === 'ruts') {
    // Two softened tracks with a retained grassy middle, rather than a new
    // opaque road painted across the whole courtyard entrance.
    for (const side of [-1, 1]) {
      const v = side * breadth * .3;
      line(local(-length * .47, v), local(length * .44, v + .08), '#82745470', .34);
      line(local(-length * .43, v + .04), local(length * .42, v + .09), '#5d614a75', .15);
      if (fine) {
        line(local(-length * .37, v - .12), local(length * .23, v - .065), '#b3a1798c', .035);
        for (let i = 0; i < 7; i++) {
          const u = -length * .35 + i * length * .1;
          line(local(u, v - .085), local(u + .07, v + .075), '#484f3c50', .035);
        }
      }
    }
  } else {
    polygon(detail.contour, '#4c593b55', 1, .07, .1);
    polygon(detail.contour, '#7c7a4b83', .93);
    polygon(detail.contour, '#a8a1687a', .63, -.08, -.1);
    if (fine) {
      for (let i = 0; i < 5; i++) {
        const u = -.26 * length + i * length * .12, v = .08 * breadth + (seed >>> i * 3) % 7 / 100;
        line(local(u, v), local(u + .06, v + .035), i % 2 ? '#b7ae79' : '#657344', .04);
      }
    }
  }
  c.restore();
}
