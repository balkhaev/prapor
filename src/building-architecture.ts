import type { LiveCityBuilding } from './game/live';
import { pixelSeed } from './pixel-art';

export type BuildingRoofForm = 'flat' | 'gable' | 'hip' | 'half-hip' | 'mansard' | 'cross-gable' | 'sawtooth';
export type ArchitecturePoint = { x: number; y: number; z: number };
export type ArchitectureSurface = { points: ArchitecturePoint[]; material: 'roofLight' | 'roofDark' | 'wallLight' | 'wallDark' | 'trim' | 'glass' };
export type BuildingVolume = { x: number; y: number; width: number; height: number; top: number; floors: number; roof: BuildingRoofForm; axis: 'x' | 'y'; lift: number };
export type BuildingFacade = { side: 'x' | 'y'; u: number; plane: number; length: number; bottom: number; top: number; floors: number };
export type BuildingArchitecture = { roof: BuildingRoofForm; axis: 'x' | 'y'; volumes: BuildingVolume[]; facades: BuildingFacade[]; surfaces: ArchitectureSurface[] };
/** Includes the tallest pitched roof, chimney and aerial, before the renderer's
 * exterior elevation scale. Shared culling can reserve this without a plan. */
export const BUILDING_ARCHITECTURE_HEADROOM = 1.3;

const wallHeight = (building: LiveCityBuilding, floors: number) => (building.kind === 'workshop' ? .28 : .18) + floors * .57;

/** Public presentation only. The occupied ground floor always fills the real
 * collider; older houses, civic halls, workshops and slab blocks have their own
 * roof grammar. Neither a camera position nor hidden room contents select it. */
export function buildingArchitecture(building: LiveCityBuilding): BuildingArchitecture {
  const seed = pixelSeed(building.id), w = building.width, h = building.height;
  const axis = building.roofAxis ?? (w >= h ? 'x' : 'y'), length = axis === 'x' ? w : h;
  const floors = building.floors ?? (building.kind === 'apartment' ? 2 : 1);
  const authored = building.roof ?? (building.kind === 'workshop' ? 'sawtooth' : building.kind === 'apartment' ? 'gable' : 'flat');
  const industrial = building.kind === 'workshop' || building.kind === 'garage';
  let roof: BuildingRoofForm = authored;
  if (authored === 'gable' && !industrial && building.facade !== 'panel') {
    const family = seed % 6;
    roof = length < 7 ? family % 2 ? 'gable' : 'hip'
      : (['gable', 'hip', 'half-hip', 'mansard', 'cross-gable', 'hip'] as const)[family]!;
    // Narrow commercial frontages retain a low, readable shop roof.
    if (building.kind === 'shop' && roof === 'mansard') roof = 'half-hip';
  } else if (authored === 'flat' && building.facade !== 'panel' && !industrial) {
    roof = building.kind === 'service' && seed % 3 === 0 ? 'hip' : 'flat';
  }
  const stepped = floors >= 2 && length >= 11 && Math.min(w, h) >= 6
    && ((building.facade === 'panel' && seed % 4 !== 0) || (building.kind === 'service' && seed % 3 === 1) || (building.kind === 'apartment' && seed % 5 === 2));
  const top = wallHeight(building, floors), split = length * (.66 + (seed >>> 8) % 3 * .045);
  const shortSpan = Math.min(w, h), pitch = .5 + Math.max(0, Math.min(6, shortSpan - 4)) * .055;
  const lift = roof === 'flat' ? 0 : industrial ? 26 / 128 : Math.min(.9, pitch * (roof === 'mansard' || roof === 'cross-gable' ? 1.18 : 1));
  const main: BuildingVolume = { x: 0, y: 0, width: axis === 'x' && stepped ? split : w, height: axis === 'y' && stepped ? split : h, top, floors, roof, axis, lift };
  const volumes = [main], facades: BuildingFacade[] = [];
  if (stepped) {
    const wingFloors = Math.max(1, floors - (building.facade === 'panel' ? 1 : floors - 1));
    volumes.push({ x: axis === 'x' ? split : 0, y: axis === 'y' ? split : 0, width: axis === 'x' ? w - split : w, height: axis === 'y' ? h - split : h,
      top: wallHeight(building, wingFloors), floors: wingFloors, roof: 'flat', axis, lift: 0 });
  }
  for (const volume of volumes) {
    const { x, y, width, height } = volume;
    // A low wing hides the bottom of the adjoining high return wall.
    const internalX = x + width < w, internalY = y + height < h;
    facades.push({ side: 'x', u: y, plane: x + width, length: height, bottom: internalX ? volumes[1]!.top : 0, top: volume.top, floors: volume.floors },
      { side: 'y', u: x, plane: y + height, length: width, bottom: internalY ? volumes[1]!.top : 0, top: volume.top, floors: volume.floors });
  }
  // Low roofs are laid first, then the high return and its roof. This keeps the
  // terrace visually open without changing a single door or floor cell.
  const surfaces = [...volumes].sort((a, b) => a.top - b.top).flatMap(volumeRoofSurfaces);
  return { roof, axis, volumes, facades, surfaces };
}

function volumeRoofSurfaces(v: BuildingVolume): ArchitectureSurface[] {
  const result: ArchitectureSurface[] = [], span = v.axis === 'x' ? v.height : v.width, length = v.axis === 'x' ? v.width : v.height;
  const p = (u: number, s: number, lift = 0): ArchitecturePoint => ({ x: v.x + (v.axis === 'x' ? u : s), y: v.y + (v.axis === 'x' ? s : u), z: v.top + lift });
  const face = (points: ArchitecturePoint[], material: ArchitectureSurface['material']) => result.push({ points, material });
  const a = p(0, 0), b = p(length, 0), c = p(length, span), d = p(0, span);
  const capMaterial = v.axis === 'x' ? 'wallLight' : 'wallDark';
  if (v.roof === 'flat') {
    face([a, b, c, d], 'roofLight');
    face([p(.16, .16, .015), p(length - .16, .16, .015), p(length - .16, span - .16, .015), p(.16, span - .16, .015)], 'roofDark');
    for (const [s, t] of [[a, b], [b, c], [c, d], [d, a]] as const) face([s, t, { ...t, z: t.z + .07 }, { ...s, z: s.z + .07 }], 'trim');
  } else if (v.roof === 'sawtooth') {
    const count = Math.min(6, Math.max(2, Math.round(span / 3))), band = span / count;
    for (let row = 0; row < count; row++) {
      const s = row * band, t = (row + 1) * band;
      face([p(0, s, v.lift), p(length, s, v.lift), p(length, t), p(0, t)], row % 2 ? 'roofDark' : 'roofLight');
      face([p(0, s), p(length, s), p(length, s, v.lift), p(0, s, v.lift)], 'glass');
    }
  } else if (v.roof === 'hip' || v.roof === 'half-hip') {
    const inset = Math.min(length * .24, span * .37), r0 = p(inset, span / 2, v.lift), r1 = p(length - inset, span / 2, v.lift);
    if (v.roof === 'hip') {
      face([a, b, r1, r0], 'roofLight'); face([r0, r1, c, d], 'roofDark');
      face([a, r0, d], 'roofDark'); face([b, c, r1], 'roofLight');
    } else {
      const shoulders = .28 * span, cap = v.lift * .56;
      const f0 = p(0, shoulders, cap), f1 = p(0, span - shoulders, cap), e0 = p(length, shoulders, cap), e1 = p(length, span - shoulders, cap);
      face([a, b, e0, r1, r0, f0], 'roofLight'); face([f1, r0, r1, e1, c, d], 'roofDark');
      face([f0, r0, f1], 'roofDark'); face([e0, e1, r1], 'roofLight');
      face([a, d, f1, f0], v.axis === 'x' ? 'wallDark' : 'wallLight'); face([b, c, e1, e0], capMaterial);
    }
  } else if (v.roof === 'mansard') {
    const iu = Math.min(length * .16, span * .19), is = span * .19, knee = v.lift * .7;
    const aa = p(iu, is, knee), bb = p(length - iu, is, knee), cc = p(length - iu, span - is, knee), dd = p(iu, span - is, knee);
    const r0 = p(Math.min(length * .3, span * .45), span / 2, v.lift), r1 = p(length - Math.min(length * .3, span * .45), span / 2, v.lift);
    face([a, b, bb, aa], 'roofLight'); face([aa, bb, r1, r0], 'roofLight');
    face([d, dd, cc, c], 'roofDark'); face([dd, r0, r1, cc], 'roofDark');
    face([a, aa, dd, d], 'roofDark'); face([aa, r0, dd], 'roofDark');
    face([b, c, cc, bb], 'roofLight'); face([bb, cc, r1], 'roofLight');
  } else {
    const ra = p(0, span / 2, v.lift), rb = p(length, span / 2, v.lift);
    face([a, b, rb, ra], 'roofLight'); face([ra, rb, c, d], 'roofDark');
    face([b, c, rb], capMaterial);
    if (v.roof === 'cross-gable') {
      const left = length * .32, right = length * .68, mid = length / 2, start = span * .46, peak = v.lift + .045;
      const aa = p(left, start, v.lift * .92), bb = p(right, start, v.lift * .92), rr = p(mid, start, peak), end = p(mid, span, peak);
      face([aa, rr, end, p(left, span)], 'roofLight'); face([rr, bb, p(right, span), end], 'roofDark');
      face([p(left, span), end, p(right, span)], v.axis === 'x' ? 'wallDark' : 'wallLight');
    }
  }
  return result;
}

/** Height sampled by attached equipment and steam, in the same model space as
 * the broad polygons used at every viewing distance. */
export function buildingArchitectureHeightAt(plan: BuildingArchitecture, x: number, y: number): number {
  const v = plan.volumes.find(volume => x >= volume.x && x <= volume.x + volume.width && y >= volume.y && y <= volume.y + volume.height) ?? plan.volumes[0]!;
  const u = v.axis === 'x' ? x - v.x : y - v.y, s = v.axis === 'x' ? y - v.y : x - v.x;
  const length = v.axis === 'x' ? v.width : v.height, span = v.axis === 'x' ? v.height : v.width;
  const cross = Math.max(0, 1 - Math.abs(s / span - .5) * 2);
  if (v.roof === 'flat') return v.top + .015;
  if (v.roof === 'sawtooth') return v.top + v.lift * (1 - (s / (span / Math.min(6, Math.max(2, Math.round(span / 3)))) % 1));
  if (v.roof === 'hip' || v.roof === 'half-hip') {
    const inset = Math.min(length * .24, span * .37), end = Math.min(u, length - u) / inset;
    return v.top + v.lift * Math.max(0, Math.min(cross, v.roof === 'hip' ? end : .56 + end * .44));
  }
  if (v.roof === 'mansard') {
    const iu = Math.min(length * .16, span * .19), is = span * .19;
    const edge = Math.max(0, Math.min(u / iu, (length - u) / iu, s / is, (span - s) / is));
    if (edge <= 1) return v.top + v.lift * .7 * edge;
    const ridgeInset = Math.min(length * .3, span * .45), core = Math.max(0, Math.min((u - iu) / (ridgeInset - iu), (length - iu - u) / (ridgeInset - iu), (s - is) / (span / 2 - is), (span - is - s) / (span / 2 - is)));
    return v.top + v.lift * (.7 + .3 * core);
  }
  if (v.roof === 'cross-gable' && s >= span * .46 && u >= length * .32 && u <= length * .68) {
    const crossRise = Math.max(0, 1 - Math.abs(u / length - .5) / .18);
    const edge = v.lift * .92 * Math.max(0, 1 - (s / span - .46) / .54);
    return v.top + Math.max(v.lift * cross, edge + (v.lift + .045 - edge) * crossRise);
  }
  return v.top + v.lift * cross;
}
