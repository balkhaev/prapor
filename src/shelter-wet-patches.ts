import { pixelSeed } from './pixel-art';
import { projectShelterPoint, unprojectShelterPoint } from './shelter-isometric';
import { getShelterBuildingRect, type ShelterLayoutBuilding } from './shelter-layout';
import type { ShelterLandscape } from './shelter-landscape';
import type { ShelterRect } from './shelter-camera';
import type { WetSurfacePatch } from './scene-wet-surfaces';

export const SHELTER_WET_PATCH_LIMIT = 64;
const inRect = (x: number, y: number, rect: ShelterRect) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
const overlaps = (a: ShelterRect, b: ShelterRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const validRect = (rect: ShelterRect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;

/** Conservative logical coverage of a projected patch. Testing this envelope
 * also excludes the corner pixels of the painter's axis-aligned clipping box. */
export function shelterWetPatchBounds(patch: WetSurfacePatch): ShelterRect {
  const corners = [-1, 1].flatMap(dx => [-1, 1].map(dy => unprojectShelterPoint({ x: patch.x + dx * patch.width / 2, y: patch.y + dy * patch.height / 2 })));
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  return { x, y, width: Math.max(...corners.map(p => p.x)) - x, height: Math.max(...corners.map(p => p.y)) - y };
}

/** Stable ground decoration only. Buildings, routes, props and saves are never
 * edited. Rebuilding after a move removes every patch under the new footprint. */
export function getShelterWetPatches(landscape: ShelterLandscape, buildings: readonly ShelterLayoutBuilding[], lights: readonly { x: number; y: number }[] = []): WetSurfacePatch[] {
  const lots = landscape.lots.filter(validRect).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!lots.length) return [];
  const obstacles = buildings.map(getShelterBuildingRect).filter(validRect).map(rect => ({ x: rect.x - 5, y: rect.y - 5, width: rect.width + 10, height: rect.height + 10 }));
  const left = Math.min(...lots.map(lot => lot.x)) - 12, right = Math.max(...lots.map(lot => lot.x + lot.width)) + 12;
  const road = { x: left, y: 43, width: right - left, height: 89 };
  const safe = (patch: WetSurfacePatch, street: boolean) => {
    const bounds = shelterWetPatchBounds(patch);
    const corners = [-1, 1].flatMap(dx => [-1, 1].map(dy => ({ x: bounds.x + (dx + 1) * bounds.width / 2, y: bounds.y + (dy + 1) * bounds.height / 2 })));
    if (!corners.every(p => street ? inRect(p.x, p.y, road) : lots.some(lot => inRect(p.x, p.y, lot)))) return false;
    if (obstacles.some(rect => overlaps(bounds, rect))) return false;
    return !landscape.decorations.some(prop => {
      const x = Math.max(bounds.x, Math.min(prop.point.x, bounds.x + bounds.width)), y = Math.max(bounds.y, Math.min(prop.point.y, bounds.y + bounds.height));
      return Math.hypot(prop.point.x - x, prop.point.y - y) <= prop.radius + 3;
    });
  };
  const candidates = new Map<string, WetSurfacePatch>();
  const reflected: WetSurfacePatch[] = [];
  for (const light of [...lights].filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 32)) {
    // A small hollow may catch the real fixture's vertical reflected column.
    // It is still rejected if any of its ground falls under a room or prop.
    for (const offset of [6, 10, 14, 18]) {
      const center = { x: light.x, y: light.y + offset }, logical = unprojectShelterPoint(center), street = inRect(logical.x, logical.y, road);
      const seed = pixelSeed(`shelter-wet-light:${light.x.toFixed(2)}:${light.y.toFixed(2)}:${offset}`);
      const patch: WetSurfacePatch = { ...center, width: 12 + seed % 7, height: 4 + (seed >>> 4) % 3, seed, material: street ? 'hard' : 'soil' };
      if (safe(patch, street)) { reflected.push(patch); break; }
    }
  }
  const add = (x: number, y: number, street: boolean) => {
    const key = `${x}:${y}`, seed = pixelSeed(`shelter-wet:${key}`), point = projectShelterPoint({ x: x + (seed % 5 - 2), y: y + ((seed >>> 3) % 5 - 2) });
    const patch: WetSurfacePatch = { ...point, width: street ? 18 + seed % 15 : 10 + seed % 13, height: street ? 6 + (seed >>> 4) % 7 : 4 + (seed >>> 4) % 5, seed, material: street ? 'hard' : 'soil' };
    if (safe(patch, street)) candidates.set(key, patch);
  };
  // A bounded road share leaves enough wet hollows across the open yard.
  let budget = 0;
  for (let x = Math.ceil(left / 36) * 36 + 18; x < right && budget < 512; x += 36) for (const y of [66, 91, 118]) { add(x, y, true); budget++; }
  const roadPatches = [...candidates.values()].sort((a, b) => a.seed - b.seed).slice(0, 24); candidates.clear();
  budget = 0;
  for (const lot of lots) {
    for (let y = Math.ceil(lot.y / 24) * 24 + 12; y < lot.y + lot.height && budget < 4096; y += 24) {
      for (let x = Math.ceil(lot.x / 24) * 24 + 12; x < lot.x + lot.width && budget < 4096; x += 24) { add(x, y, false); budget++; }
    }
    if (budget >= 4096) break;
  }
  const yard = [...candidates.values()].sort((a, b) => a.seed - b.seed), selected: WetSurfacePatch[] = [];
  for (const patch of [...reflected.slice(0, 16), ...roadPatches, ...yard]) {
    if (selected.length >= SHELTER_WET_PATCH_LIMIT) break;
    if (selected.some(old => Math.abs(old.x - patch.x) < (old.width + patch.width) / 2 + 2 && Math.abs(old.y - patch.y) < (old.height + patch.height) / 2 + 1)) continue;
    selected.push(patch);
  }
  return selected;
}
