import type { LivePoint } from './game/live';
import { WEAPONS, WEAPON_BY_ID, type WeaponCategory } from './game/data';
import type { WeaponInstance } from './game/engine';
import { FACTORY_KITS, MODULE_BY_ID, MODULE_SLOTS, type ModuleSlot } from './game/modules';
import { weaponBuildGeometry } from './armory-art';
import type { ArmoryMaterial, ArmoryPaint } from './armory-surface';
import { PixelRaster } from './pixel-art';
import { pixelBearing, type PixelFacing } from './pixel-animation';
import { sampleWeaponContours, weaponPathContours } from './pixel-weapon-geometry';
export const PIXEL_WEAPON_IDS = [...WEAPONS.map(weapon => weapon.id), 'unknown'] as readonly string[];
export type PixelWeaponId = string;
export type PixelWeaponInput = PixelWeaponId | Pick<WeaponInstance, 'weaponId' | 'modules' | 'durability'>;
/** Only a known public model selects exact art; absent/private IDs stay neutral. */
export function pixelWeaponId(value: unknown): PixelWeaponId { return typeof value === 'string' && Object.hasOwn(WEAPON_BY_ID, value) ? value : 'unknown'; }
export type PixelWeaponAnchors = {
    muzzle: LivePoint;
    ejection: LivePoint;
    forehand: LivePoint;
};
export type PixelWeaponProfile = {
    length: number;
    forward: number;
    rear: number;
    boreHeight: number;
    support: number;
    twoHanded: boolean;
    scoped: boolean;
    hasMuzzle: boolean;
    hasEjection: boolean;
};
export const PIXEL_WEAPON_PALETTE = {
    outline: '#20322e', black: '#2a3a35', metal: '#50685f', metalLight: '#81958a', edge: '#adb49b',
    wood: '#987047', woodShade: '#614b35', woodLight: '#b89160', grip: '#76513b', glass: '#536e68',
    polymer: '#586452', polymerLight: '#89957a', rubber: '#354139', carbon: '#3c4b43',
} as const;
const C = PIXEL_WEAPON_PALETTE;
const colors: Record<ArmoryMaterial, readonly [
    string,
    string,
    string
]> = {
    steel: [C.metal, C.edge, C.black], dark: [C.black, C.metalLight, C.outline], wood: [C.wood, C.woodLight, C.woodShade],
    polymer: [C.polymer, C.polymerLight, C.black], rubber: [C.rubber, C.metal, C.outline], glass: [C.glass, C.edge, C.black], carbon: [C.carbon, C.metalLight, C.black],
};
const flatPaint = { ...Object.fromEntries(Object.entries(colors).map(([name, palette]) => [name, palette[0]])), prefix: 'pixel-native' } as ArmoryPaint;
const lengths: Record<WeaponCategory, number> = { pistol: 22, smg: 47, shotgun: 70, rifle: 67, sniper: 79 };
const depths: Record<ModuleSlot, number> = { receiver: 6, stock: 6, handguard: 7, barrel: 3, magazine: 5, optic: 7, muzzle: 5, foregrip: 4, mount: 5, flashlight: 6, laser: 5 };
const bucket = (condition: number) => Number.isFinite(condition) ? Math.floor(Math.max(0, Math.min(100, condition)) / 20) * 20 : 0;
const factories = new Map<string, Pick<WeaponInstance, 'weaponId' | 'modules' | 'durability'>>();
function build(input: PixelWeaponInput): Pick<WeaponInstance, 'weaponId' | 'modules' | 'durability'> {
    if (typeof input !== 'string')
        return input;
    const id = pixelWeaponId(input);
    let value = factories.get(id);
    if (!value) {
        value = { weaponId: id, durability: 100, modules: Object.fromEntries(Object.entries(FACTORY_KITS[id] ?? {}).map(([slot, modelId]) => [slot, { id: `pixel-factory-${slot}`, modelId, durability: 100, foundAt: 0 }])) };
        factories.set(id, value);
    }
    return value;
}
/** Physical part identities and visible wear own cache identity, never inventory UUIDs. */
export function pixelWeaponSignature(input: PixelWeaponInput): string {
    const weapon = build(input), id = pixelWeaponId(weapon.weaponId);
    if (id === 'unknown')
        return 'unknown';
    return `${id}:${bucket(weapon.durability)}|${MODULE_SLOTS.map(slot => { const part = weapon.modules[slot]; return `${slot}:${part ? `${part.modelId}:${bucket(part.durability)}` : 'none'}`; }).join('|')}`;
}
type Cell = {
    x: number;
    y: number;
    color: string;
    material: ArmoryMaterial;
    depth: number;
    slot: ModuleSlot;
    condition: number;
};
type Model = {
    signature: string;
    profile: PixelWeaponProfile;
    cells: Map<string, Cell>;
    muzzle: LivePoint;
    forehand: LivePoint;
    ejection: LivePoint;
};
type Run = {
    x: number;
    y: number;
    width: number;
    color: string;
};
type Image = {
    runs: Run[];
    bytes: number;
};
export const PIXEL_WEAPON_MODEL_CACHE_SIZE = 128;
export const PIXEL_WEAPON_IMAGE_CACHE_BYTES = 4 * 1024 * 1024;
const models = new Map<string, Model>(), images = new Map<string, Image>();
let imageBytes = 0;
const key = (x: number, y: number) => `${x},${y}`;
export function clearPixelWeaponCache(): void { models.clear(); images.clear(); imageBytes = 0; }
export function pixelWeaponCacheStats(): {
    models: number;
    images: number;
    imageBytes: number;
} { return { models: models.size, images: images.size, imageBytes }; }
function neutral(signature: string): Model {
    const cells = new Map<string, Cell>();
    for (const [x, y, width, height, slot] of [[-24, -7, 21, 8, 'stock'], [-6, -12, 24, 10, 'receiver'], [18, -10, 24, 3, 'barrel'], [-5, -2, 5, 13, 'stock'], [5, -2, 6, 14, 'magazine']] as const)
        for (let u = x; u < x + width; u++)
            for (let z = y; z < y + height; z++)
                cells.set(key(u, z), { x: u, y: z, color: C.black, material: 'dark', depth: depths[slot], slot, condition: 100 });
    return { signature, cells, profile: { length: 66, forward: 42, rear: 24, boreHeight: 9, support: 22, twoHanded: true, scoped: false, hasMuzzle: true, hasEjection: true }, muzzle: { x: 42, y: -9 }, forehand: { x: 22, y: -4 }, ejection: { x: 8, y: -10 } };
}
function model(input: PixelWeaponInput): Model {
    const signature = pixelWeaponSignature(input), previous = models.get(signature);
    if (previous) {
        models.delete(signature);
        models.set(signature, previous);
        return previous;
    }
    const weapon = build(input), id = pixelWeaponId(weapon.weaponId);
    if (id === 'unknown') {
        const value = neutral(signature);
        while (models.size >= PIXEL_WEAPON_MODEL_CACHE_SIZE)
            models.delete(models.keys().next().value!);
        models.set(signature, value);
        return value;
    }
    const resolved = weaponBuildGeometry(weapon, flatPaint), scale = lengths[resolved.category] / resolved.referenceWidth, cells = new Map<string, Cell>();
    const local = (p: LivePoint): LivePoint => ({ x: (p.x - resolved.grip.x) * scale, y: (p.y - resolved.grip.y) * scale });
    for (const part of resolved.parts) {
        const offset = part.shape.offset ?? { x: 0, y: 0 };
        const paint = (contours: LivePoint[][], color: string, fillRule: 'evenodd' | 'nonzero' = 'nonzero') => {
            const transformed = contours.map(contour => contour.map(p => local({ x: p.x + offset.x, y: p.y + offset.y })));
            sampleWeaponContours(transformed, fillRule, (x, y) => cells.set(key(x, y), { x, y, color, material: part.shape.material, depth: depths[part.slot], slot: part.slot, condition: part.durability }));
        };
        paint(weaponPathContours(part.shape.outline), colors[part.shape.material][0], part.shape.fillRule ?? 'evenodd');
        // Filled native hardware also contributes geometry: sights, grip panels,
        // glass and mounting feet use exactly the details authored for the bench.
        for (const tag of part.shape.detail.matchAll(/<(path|rect|circle)\b([^>]*)\/?\s*>/g)) {
            const attributes = tag[2]!, fill = attributes.match(/\bfill="(#[\da-f]{6})"/i)?.[1];
            if (!fill)
                continue;
            const number = (name: string) => Number(attributes.match(new RegExp(`\\b${name}="([-\\d.]+)"`))?.[1] ?? 0);
            if (tag[1] === 'path') {
                const path = attributes.match(/\bd="([^"]+)"/)?.[1];
                if (path)
                    paint(weaponPathContours(path), fill, attributes.includes('fill-rule="evenodd"') ? 'evenodd' : 'nonzero');
            }
            else if (tag[1] === 'rect') {
                const x = number('x'), y = number('y'), w = number('width'), h = number('height');
                if (w > 0 && h > 0)
                    paint([[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]], fill);
            }
            else {
                const x = number('cx'), y = number('cy'), r = number('r');
                if (r * scale >= .45)
                    paint([Array.from({ length: 12 }, (_, i) => ({ x: x + Math.cos(i / 12 * Math.PI * 2) * r, y: y + Math.sin(i / 12 * Math.PI * 2) * r }))], fill);
            }
        }
    }
    const muzzle = local(resolved.muzzle), ejection = local(resolved.ejection), values = [...cells.values()];
    const foregrip = weapon.modules.foregrip ? MODULE_BY_ID[weapon.modules.foregrip.modelId] : undefined;
    const supportSlots: ModuleSlot[] = foregrip && foregrip.appearance !== 'bipod' ? ['foregrip', 'handguard', 'barrel', 'receiver'] : ['handguard', 'barrel', 'receiver'];
    let support: Cell | undefined;
    for (const slot of supportSlots) {
        const candidates = values.filter(cell => cell.slot === slot && cell.x > 1);
        if (!candidates.length)
            continue;
        const xs = candidates.map(cell => cell.x), desired = slot === 'foregrip' ? (Math.min(...xs) + Math.max(...xs)) / 2 : Math.max(3, Math.min(muzzle.x * .5, (Math.min(...xs) + Math.max(...xs)) / 2));
        candidates.sort((a, b) => Math.abs(a.x - desired) - Math.abs(b.x - desired) || b.y - a.y);
        support = candidates[0];
        break;
    }
    const forehand = resolved.category !== 'pistol' && support ? { x: support.x + .5, y: support.y + .5 } : { x: 0, y: 0 };
    const left = Math.min(0, ...values.map(cell => cell.x)), right = Math.max(0, ...values.map(cell => cell.x + 1));
    const value: Model = { signature, cells, muzzle, ejection, forehand, profile: { length: right - left, forward: muzzle.x, rear: -left, boreHeight: -muzzle.y, support: forehand.x, twoHanded: resolved.category !== 'pistol', scoped: resolved.parts.some(part => part.slot === 'optic'), hasMuzzle: resolved.parts.some(part => part.slot === 'barrel'), hasEjection: resolved.parts.some(part => part.slot === 'receiver') } };
    while (models.size >= PIXEL_WEAPON_MODEL_CACHE_SIZE)
        models.delete(models.keys().next().value!);
    models.set(signature, value);
    return value;
}
export function pixelWeaponProfile(input: PixelWeaponInput): PixelWeaponProfile { return { ...model(input).profile }; }
/** Factory dimensions are lazy; importing a scene never assembles39 profiles. */
export const PIXEL_WEAPON_PROFILES: Readonly<Record<PixelWeaponId, PixelWeaponProfile>> = Object.fromEntries(PIXEL_WEAPON_IDS.map(id => [id, Object.defineProperties({}, { ...Object.fromEntries(['length', 'forward', 'rear', 'boreHeight', 'support', 'twoHanded', 'scoped', 'hasMuzzle', 'hasEjection'].map(field => [field, { enumerable: true, get: () => model(id).profile[field as keyof PixelWeaponProfile] }])) }) as PixelWeaponProfile]));
function geometry(input: PixelWeaponInput, grip: LivePoint, facing: PixelFacing, kick: number) {
    const value = model(input), bearing = pixelBearing(facing), side = { x: -bearing.y * 2, y: bearing.x * .5 }, recoil = Number.isFinite(kick) ? Math.round(Math.max(0, Math.min(4, kick)) * 2) / 2 : 0;
    const project = (u: number, h: number, v = 0): LivePoint => ({ x: Math.round(grip.x) + Math.round(bearing.x * u + side.x * v), y: Math.round(grip.y) + Math.round(bearing.y * u + side.y * v + h - recoil * u / Math.max(1, value.muzzle.x)) });
    return { value, bearing, side, recoil, project };
}
export function pixelWeaponAnchors(input: PixelWeaponInput, grip: LivePoint, facing: PixelFacing, kick = 0): PixelWeaponAnchors {
    const { value, project } = geometry(input, grip, facing, kick);
    return { muzzle: project(value.muzzle.x, value.muzzle.y), ejection: project(value.ejection.x, value.ejection.y, 3), forehand: project(value.forehand.x, value.forehand.y) };
}
function projected(input: PixelWeaponInput, facing: PixelFacing, kick: number): Image {
    const { value, bearing, side, recoil, project } = geometry(input, { x: 128, y: 96 }, facing, kick), imageKey = `${value.signature}/${facing}/${recoil}`, previous = images.get(imageKey);
    if (previous) {
        images.delete(imageKey);
        images.set(imageKey, previous);
        return previous;
    }
    type Face = {
        points: LivePoint[];
        depth: number;
        color: string;
    };
    const faces: Face[] = [];
    const near = bearing.x >= 0 ? 1 : -1, end = bearing.y >= 0 ? 1 : -1;
    for (const cell of value.cells.values()) {
        const { x, y, depth: d, material } = cell, palette = colors[material], wear = cell.condition < 100 && ((Math.imul(x + 137, 73856093) ^ Math.imul(y + 113, 19349663)) >>> 0) % 100 < (100 - cell.condition) * .15;
        const add = (vertices: Array<readonly [
            number,
            number,
            number
        ]>, color: string) => faces.push({ points: vertices.map(([u, h, v]) => project(u, h, v)), color, depth: vertices.reduce((sum, [u, h, v]) => sum + bearing.y * 2 * u + side.y * 2 * v - h * .5, 0) / 4 });
        add([[x, y, near * d / 2], [x + 1, y, near * d / 2], [x + 1, y + 1, near * d / 2], [x, y + 1, near * d / 2]], wear ? C.edge : cell.color);
        const upper = value.cells.get(key(x, y - 1));
        if (!upper || upper.depth < d)
            add([[x, y, -d / 2], [x + 1, y, -d / 2], [x + 1, y, d / 2], [x, y, d / 2]], palette[1]);
        const edge = value.cells.get(key(x + end, y));
        if (!edge || edge.depth < d) {
            const u = end > 0 ? x + 1 : x;
            add([[u, y, -d / 2], [u, y + 1, -d / 2], [u, y + 1, d / 2], [u, y, d / 2]], palette[2]);
        }
    }
    faces.sort((a, b) => a.depth - b.depth);
    const pixels = new Array<string | undefined>(256 * 192), context = { fillStyle: '', setTransform() { }, fillRect(x: number, y: number, w: number, h: number) { for (let row = y; row < y + h; row++)
            pixels.fill(context.fillStyle, row * 256 + x, row * 256 + x + w); } };
    const raster = new PixelRaster(context as unknown as CanvasRenderingContext2D, 256, 192);
    for (const face of faces)
        raster.polygon(face.points, face.color);
    const runs: Run[] = [];
    for (let y = 0; y < 192; y++)
        for (let x = 0; x < 256;) {
            const color = pixels[y * 256 + x];
            if (!color) {
                x++;
                continue;
            }
            const start = x;
            while (x < 256 && pixels[y * 256 + x] === color)
                x++;
            runs.push({ x: start - 128, y: y - 96, width: x - start, color });
        }
    // Conservatively account for a JS run object, its array slot and references.
    const image = { runs, bytes: runs.length * 80 };
    while (imageBytes + image.bytes > PIXEL_WEAPON_IMAGE_CACHE_BYTES && images.size) {
        const first = images.keys().next().value!;
        imageBytes -= images.get(first)!.bytes;
        images.delete(first);
    }
    images.set(imageKey, image);
    imageBytes += image.bytes;
    return image;
}
/** Integer-painted extruded native parts, without asynchronous textures or DOM. */
export function paintPixelWeapon(r: PixelRaster, input: PixelWeaponInput, grip: LivePoint, facing: PixelFacing, kick = 0): PixelWeaponAnchors {
    const image = projected(input, facing, kick), x = Math.round(grip.x), y = Math.round(grip.y);
    for (const run of image.runs)
        r.rect(x + run.x, y + run.y, run.width, 1, run.color);
    const anchors = pixelWeaponAnchors(input, grip, facing, kick);
    if (model(input).profile.hasMuzzle)
        r.pixel(anchors.muzzle.x, anchors.muzzle.y, C.outline);
    return anchors;
}
