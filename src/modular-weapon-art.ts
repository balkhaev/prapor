import { MODULE_BY_ID, type ModuleModel, type ModuleSlot } from "./game/modules";
import type { WeaponInstance } from "./game/engine";

/** Generated decorative surface patches follow the native module slot order. */
export const MODULAR_WEAPON_ART_IDS = ["m4a1", "hk416", "p90", "mp7", "ump45", "m1911", "mcx", "scarh", "trg42"] as const;
export type ModularWeaponArtId = typeof MODULAR_WEAPON_ART_IDS[number];
export const MODULAR_WEAPON_ART_SLOTS = ["receiver", "barrel", "handguard", "stock", "magazine", "optic", "muzzle", "foregrip"] as const;
const familyArt: Readonly<Record<string, ModularWeaponArtId>> = { ar: "m4a1", p90: "p90", mp7: "mp7", ump: "ump45", "1911": "m1911", mcx: "mcx", scar: "scarh", trg: "trg42" };
const caliberArt: Readonly<Record<string, ModularWeaponArtId>> = { "5.56x45": "m4a1", "5.7x28": "p90", "4.6x30": "mp7", ".45acp": "ump45", ".300blk": "mcx", "7.62x51": "scarh", ".338lapua": "trg42" };
export const modularWeaponArtUrl = (id: ModularWeaponArtId): string => `/art/weapons/modular-${id}.png`;
type SourceBounds = readonly [number, number, number, number];
type Atlas = { data: string; width: number; height: number; cells: SourceBounds[] };
const atlases = new Map<ModularWeaponArtId, Atlas>();
const atlasRevisions = new Map<ModularWeaponArtId, number>();
let revision = 0;
const loading = new Map<ModularWeaponArtId, Promise<void>>();
const attempts = new Map<ModularWeaponArtId, number>(), retryAt = new Map<ModularWeaponArtId, number>();
export function modularWeaponArtRevision(weapon?: string | Pick<WeaponInstance, "weaponId" | "modules">): number {
	if (!weapon) return revision;
	const ids = typeof weapon === "string" ? [weapon] : Object.values(weapon.modules).flatMap((instance) => {
		const model = instance ? MODULE_BY_ID[instance.modelId] : undefined, id = model ? modularWeaponArtFamily(model) : undefined;
		return id ? [id] : [];
	});
	return [...new Set(ids)].reduce((sum, id) => sum + (atlasRevisions.get(id as ModularWeaponArtId) ?? 0), 0);
}

export function modularWeaponArtFamily(model: ModuleModel): ModularWeaponArtId | undefined {
	if (model.weaponId && MODULAR_WEAPON_ART_IDS.includes(model.weaponId as ModularWeaponArtId)) return model.weaponId as ModularWeaponArtId;
	return model.platforms.map((platform) => familyArt[platform]).find(Boolean)
		?? (model.slot === "muzzle" ? model.calibers.map((caliber) => caliberArt[caliber]).find(Boolean) : undefined);
}

/** Read alpha bounds without modifying generated pixels or exporting cropped art. */
export function modularAtlasCellBounds(alpha: Uint8ClampedArray, width: number, height: number, index: number): SourceBounds {
	const cellWidth = width / 4, cellHeight = height / 2;
	const left = Math.floor(index % 4 * cellWidth), top = Math.floor(Math.floor(index / 4) * cellHeight);
	const right = Math.floor((index % 4 + 1) * cellWidth), bottom = Math.floor((Math.floor(index / 4) + 1) * cellHeight);
	let x0 = right, y0 = bottom, x1 = left, y1 = top;
	for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
		if ((alpha[(y * width + x) * 4 + 3] ?? 0) < 40) continue;
		x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
	}
	return x0 <= x1 && y0 <= y1 ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : [left, top, cellWidth, cellHeight];
}

async function loadAtlas(id: ModularWeaponArtId): Promise<void> {
	const response = await fetch(modularWeaponArtUrl(id), { signal: AbortSignal.timeout(6000) });
	if (!response.ok) return;
	const blob = await response.blob();
	if (!blob.type.startsWith("image/")) return;
	const data = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
	});
	const image = new Image(); image.src = data; await image.decode();
	const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) return;
	context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
	atlases.set(id, { data, width: canvas.width, height: canvas.height, cells: MODULAR_WEAPON_ART_SLOTS.map((_, index) => modularAtlasCellBounds(pixels, canvas.width, canvas.height, index)) });
	atlasRevisions.set(id, ++revision);
}

/** Data URLs keep the carried SVG self contained when Phaser rasterizes it. */
export function preloadModularWeaponArt(weaponIds: readonly string[] = MODULAR_WEAPON_ART_IDS): Promise<void> {
	if (typeof window === "undefined") return Promise.resolve();
	const requested = new Set(weaponIds.filter((id): id is ModularWeaponArtId => MODULAR_WEAPON_ART_IDS.includes(id as ModularWeaponArtId)));
	// Shared AR upgrade parts have a physical M4 profile even when fitted to an HK.
	if (requested.has("hk416")) requested.add("m4a1");
	if (requested.has("m1911")) requested.add("ump45");
	return Promise.allSettled([...requested].map((id) => {
		if (atlases.has(id)) return Promise.resolve();
		const pending = loading.get(id); if (pending) return pending;
		if ((attempts.get(id) ?? 0) >= 3 || Date.now() < (retryAt.get(id) ?? 0)) return Promise.resolve();
		attempts.set(id, (attempts.get(id) ?? 0) + 1);
		const work = loadAtlas(id).finally(() => { loading.delete(id); if (!atlases.has(id)) retryAt.set(id, Date.now() + 30_000); });
		loading.set(id, work); return work;
	})).then(() => undefined);
}

const atlasId = (prefix: string, id: ModularWeaponArtId) => `${prefix}-atlas-${id}`;
export function modularWeaponRasterDefs(prefix: string, modelIds: readonly (string | undefined)[], embedded = true): string {
	const ids = new Set(modelIds.flatMap((modelId) => {
		const model = modelId ? MODULE_BY_ID[modelId] : undefined, id = model ? modularWeaponArtFamily(model) : undefined;
		return id && atlases.has(id) ? [id] : [];
	}));
	return [...ids].map((id) => {
		const atlas = atlases.get(id)!;
		// DOM workbenches/cards share the browser's PNG cache; carried SVGs need
		// embedded data because their outer SVG is itself loaded from a data URL.
		return `<defs><image id="${atlasId(prefix, id)}" width="${atlas.width}" height="${atlas.height}" href="${embedded ? atlas.data : modularWeaponArtUrl(id)}"/></defs>`;
	}).join("");
}

export function modularWeaponRasterPart(prefix: string, modelId: string | undefined, slot: ModuleSlot, outline: string, bounds: SourceBounds, fillRule: string): string {
	const model = modelId ? MODULE_BY_ID[modelId] : undefined, id = model ? modularWeaponArtFamily(model) : undefined;
	const index = MODULAR_WEAPON_ART_SLOTS.indexOf(slot as typeof MODULAR_WEAPON_ART_SLOTS[number]);
	const atlas = id ? atlases.get(id) : undefined;
	if (!model || !id || !atlas || index < 0) return "";
	const source = atlas.cells[index]!, clip = `${prefix}-raster-${slot}`;
	// Exact module geometry remains authoritative: barrel length, magazine feed,
	// stock holes and attachment contacts cannot be changed by a generated image.
	return `<defs><clipPath id="${clip}"><path d="${outline}" fill-rule="${fillRule}" clip-rule="${fillRule}"/></clipPath></defs><g data-generated-part="${id}/${slot}" clip-path="url(#${clip})" opacity=".82"><svg x="${bounds[0]}" y="${bounds[1]}" width="${bounds[2]}" height="${bounds[3]}" viewBox="${source.join(" ")}" preserveAspectRatio="none"><use href="#${atlasId(prefix, id)}"/></svg></g>`;
}
