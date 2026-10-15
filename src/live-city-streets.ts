import type { LivePoint, LiveTerrain, LiveWorld } from './game/live';
import { pixelSeed } from './pixel-art';

type Rect = LivePoint & { width: number; height: number };
type StreetWorld = Pick<LiveWorld, 'width' | 'height' | 'paths' | 'city' | 'citySites' | 'props'>;
export type CityStreetGroundDetail = Rect & {
  kind: 'pavement' | 'passage' | 'play-chalk' | 'bench-leaves' | 'shop-apron' | 'bench-pad';
  a: LivePoint; b: LivePoint; normal: LivePoint; offset: number; seed: number;
  /** Exact outdoor paving runs, shared by the cached and display-scale passes. */
  clip: Rect[];
};
const DETAIL_LIMIT = 4096, CHUNK_LENGTH = 6;
const inside = (point: LivePoint, rect: Rect) => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;

/** One immutable street plan. Sidewalks belong to real paved road shoulders;
 * passages belong to public courtyard geometry. No district rectangle, extra
 * furniture or new traversable surface is introduced by the presentation. */
export function buildCityStreetGround(world: StreetWorld, terrain: readonly LiveTerrain[], walkable: Uint8Array, indoor: Uint8Array): CityStreetGroundDetail[] {
  if (!world.city) return [];
  const details: CityStreetGroundDetail[] = [];
  let candidates = 0;
  const add = (kind: CityStreetGroundDetail['kind'], a: LivePoint, b: LivePoint, normal: LivePoint, offset: number, seed: number, padding: number): void => {
    if (details.length >= DETAIL_LIMIT || ++candidates > 32768) return;
    const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - padding)), top = Math.max(0, Math.floor(Math.min(a.y, b.y) - padding));
    const right = Math.min(world.width, Math.ceil(Math.max(a.x, b.x) + padding)), bottom = Math.min(world.height, Math.ceil(Math.max(a.y, b.y) + padding));
    if (right <= world.city!.x || bottom <= world.city!.y || left >= world.city!.x + world.city!.width || top >= world.city!.y + world.city!.height) return;
    const clip: Rect[] = [];
    for (let y = top; y < bottom; y++) {
      let start = -1;
      for (let x = left; x <= right; x++) {
        const cell = y * world.width + x;
        const accept = x < right && terrain[cell] === 'concrete' && !!walkable[cell] && !indoor[cell] && inside({ x, y }, world.city!);
        if (accept && start < 0) start = x;
        else if (!accept && start >= 0) { clip.push({ x: start, y, width: x - start, height: 1 }); start = -1; }
      }
    }
    if (clip.length) details.push({ x: left, y: top, width: right - left, height: bottom - top, kind, a, b, normal, offset, seed, clip });
  };
  // Six-metre pieces let the scene cull a long avenue without drawing its far
  // end. Joints use cumulative distance so bends and chunk edges never restart.
  const strip = (kind: 'pavement' | 'passage', points: readonly LivePoint[], side: number, distance: number, seed: number): void => {
    let offset = 0;
    for (let i = 1; i < points.length && details.length < DETAIL_LIMIT && candidates < 32768; i++) {
      const a = points[i - 1]!, b = points[i]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (length < .05 || !Number.isFinite(length)) continue;
      const ux = dx / length, uy = dy / length, normal = { x: -uy * side, y: ux * side };
      for (let along = 0; along < length && details.length < DETAIL_LIMIT && candidates < 32768; along += CHUNK_LENGTH) {
        const end = Math.min(length, along + CHUNK_LENGTH);
        const point = (d: number) => ({ x: a.x + .5 + ux * d + normal.x * distance, y: a.y + .5 + uy * d + normal.y * distance });
        const pa = point(along), pb = point(end);
        // The bounding rectangle is only a culling envelope; clips above still
        // decide which actual cells can receive a single pigment mark.
        add(kind, pa, pb, normal, offset + along, seed, .77);
      }
      offset += length;
    }
  };
  for (const path of world.paths ?? []) {
    if (path.kind !== 'road' || path.width < 3) continue;
    const seed = pixelSeed(path.id);
    for (const side of [-1, 1]) strip('pavement', path.points, side, path.width / 2 + .85, seed);
  }
  for (const site of world.citySites ?? []) {
    const seed = pixelSeed(site.id);
    for (const passage of site.passages) strip('passage', passage, 1, 0, seed);
  }
  // Small public places use their actual fixtures as anchors. Interior shop
  // furnishings cannot lend an imaginary serving zone to the exterior wall.
  for (const prop of world.props ?? []) {
    if (!['playground', 'bench', 'kiosk', 'market-stall'].includes(prop.kind)) continue;
    if (indoor[Math.floor(prop.y + prop.height / 2) * world.width + Math.floor(prop.x + prop.width / 2)]) continue;
    const seed = pixelSeed(prop.id);
    const horizontal = prop.orientation === 'x';
    const normal = { x: horizontal ? 0 : -1, y: horizontal ? 1 : 0 };
    const storefront = prop.kind === 'kiosk' || prop.kind === 'market-stall';
    if (storefront || prop.kind === 'bench') {
      // The serving side of an existing stall and the front of an existing
      // bench get a small, coherent apron. It is only pigment on free paving;
      // a clipped interior or a road can never acquire imaginary furniture.
      const a = { x: prop.x + (horizontal ? .05 : prop.width + .36), y: prop.y + (horizontal ? prop.height + .36 : .05) };
      const b = { x: a.x + (horizontal ? prop.width - .1 : 0), y: a.y + (horizontal ? 0 : prop.height - .1) };
      add(storefront ? 'shop-apron' : 'bench-pad', a, b, normal, 0, seed, .62);
    }
    if (storefront || prop.kind === 'bench' && seed % 4) continue;
    const a = { x: prop.x + (horizontal ? .2 : prop.width + .28), y: prop.y + (horizontal ? prop.height + .28 : .2) };
    const b = { x: a.x + (horizontal ? 2.1 : 0), y: a.y + (horizontal ? 0 : 2.1) };
    add(prop.kind === 'playground' ? 'play-chalk' : 'bench-leaves', a, b, normal, 0, seed, .7);
  }
  return details;
}

/** Ground-cell canvas coordinates match road surface painting. Broad paving
 * goes into the bounded terrain cache; fine joints are drawn at display scale. */
export function paintCityStreetGroundDetail(c: CanvasRenderingContext2D, detail: CityStreetGroundDetail, fine = true): void {
  if (!fine && (detail.kind === 'play-chalk' || detail.kind === 'bench-leaves')) return;
  const { a, b, normal: n, seed } = detail, length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < .05) return;
  const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const point = (along: number, across = 0): LivePoint => ({ x: a.x + u.x * along + n.x * across, y: a.y + u.y * along + n.y * across });
  const line = (p: LivePoint, q: LivePoint, color: string, width: number): void => {
    c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
  };
  c.save(); c.beginPath();
  for (const run of detail.clip) c.rect(run.x, run.y, run.width, run.height);
  c.clip(); c.lineCap = 'butt';
  if (detail.kind === 'pavement') {
    line(a, b, seed % 3 === 0 ? '#aaad98' : '#b0b09b', 1.25);
    // Shadow at the road edge and a warm coping edge read as a curb, rather
    // than another luminous traffic stripe across the entire town.
    line(point(0, -.57), point(length, -.57), '#6b7b70', .15);
    line(point(0, -.43), point(length, -.43), '#d1cbb0', .12);
    line(point(0, .52), point(length, .52), '#929c85', .12);
    if (fine) {
      for (let along = (1.2 - detail.offset % 1.2) % 1.2; along < length; along += 1.2) {
        line(point(along, -.33), point(along, .45), '#808d7a91', .025);
      }
      // A few worn slab corners and gutter deposits, never every tile.
      if (seed % 5 === Math.floor(detail.offset / CHUNK_LENGTH) % 5) {
        line(point(length * .37, .48), point(length * .37 + .38, .48), '#6b7c536b', .09);
        line(point(length * .64, -.36), point(length * .64 + .65, -.36), '#89958061', .06);
      }
      // Drain grates are part of the actual road-side curb, spaced every
      // fourth run. Their transverse slots read as civic hardware, not litter.
      if (length >= .8 && (Math.floor(detail.offset / CHUNK_LENGTH) + seed % 4) % 4 === 0) {
        const start = Math.min(length * .38, Math.max(0, length - .6));
        line(point(start, -.48), point(start + .6, -.48), '#405a53', .17);
        line(point(start, -.37), point(start + .6, -.37), '#c2bda0', .025);
        for (let slot = 0; slot < 6; slot++) {
          line(point(start + .055 + slot * .09, -.545), point(start + .055 + slot * .09, -.425), '#8b9b83', .025);
        }
      }
    }
  } else if (detail.kind === 'passage') {
    // Use follows the actual authored way through a yard, with soft, quiet
    // value grouping that leaves fighters' silhouettes in front of it.
    line(a, b, '#c0b59629', .96);
    if (fine && seed % 3 === 0) for (let along = (2 - detail.offset % 2) % 2; along < length; along += 2) {
      line(point(along, -.32), point(along + .24, -.21), '#8a927849', .035);
    }
  } else if (detail.kind === 'shop-apron' || detail.kind === 'bench-pad') {
    const shop = detail.kind === 'shop-apron';
    line(a, b, shop ? '#b0aa8c' : '#a3aa91', .88);
    line(point(0, -.42), point(length, -.42), shop ? '#777e68' : '#7b8c74', .07);
    line(point(0, .42), point(length, .42), '#c6bea1', .08);
    if (fine) {
      for (let along = .35; along < length; along += .65) line(point(along, -.34), point(along, .34), '#7b8a735c', .025);
      if (shop) {
        // A faded entrance strip and two queue scuffs make the kiosk/stall a
        // used place without placing another cover silhouette in its path.
        line(point(length * .22, -.23), point(length * .76, -.23), seed % 2 ? '#577a704d' : '#9c715b4d', .19);
        for (const along of [.32, .65]) line(point(length * along, .17), point(length * along + .12, .17), '#586e6159', .055);
      } else {
        line(point(length * .13, -.15), point(length * .85, -.15), '#63796738', .2);
      }
    }
  } else if (detail.kind === 'play-chalk') {
    for (let row = 0; row < 4; row++) {
      const start = row * .48, end = start + .44, split = row === 1 || row === 3;
      line(point(start, -.45), point(start, .45), '#d5c7a557', .045);
      line(point(end, -.45), point(end, .45), '#d5c7a557', .045);
      line(point(start, -.45), point(end, -.45), '#d5c7a557', .045);
      line(point(start, .45), point(end, .45), '#d5c7a557', .045);
      if (split) line(point(start), point(end), '#d5c7a557', .04);
    }
  } else {
    for (let i = 0; i < 7; i++) {
      const along = .2 + (seed >>> i * 3) % 160 / 100, across = -.4 + (seed >>> i * 2) % 80 / 100;
      line(point(along, across), point(along + .07, across + .035), i % 3 ? '#9e95675e' : '#c0a97677', .055);
    }
  }
  c.restore();
}
