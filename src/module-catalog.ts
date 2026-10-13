import { RARITY_LABELS } from "./game/data";
import { MODULE_SLOT_LABELS, RECEIVER_INFO, modulePlatformLabel, type ModuleModel, type ModuleSlot } from "./game/modules";

export interface ModuleCatalogFilters {
	slot: ModuleSlot | "all";
	rarity: ModuleModel["rarity"] | "all";
	platform: string;
	search: string;
}

export function moduleMountLabel(mount: string) {
	return mount === "rail-top" ? "Верхняя планка" : mount === "rail-bottom" ? "Нижняя планка цевья" : mount === "dovetail" ? "Боковой кронштейн" : mount.startsWith("thread:") ? `Резьба ${mount.slice(7)}` : mount;
}

const normalize = (text: string) => text.toLocaleLowerCase("ru").replaceAll("ё", "е");

/** The recipe catalog includes future mount upgrades, while excluding other weapon families. */
export function moduleFitsWeaponFamily(model: ModuleModel, weaponId: string) {
	if (!Object.hasOwn(RECEIVER_INFO, weaponId)) return false;
	const info = RECEIVER_INFO[weaponId];
	return Boolean(info && (model.platforms.includes("*") || model.platforms.includes(info.platform)) && (model.calibers.includes("*") || model.calibers.includes(info.caliber)) && (model.slot !== "receiver" || model.weaponId === weaponId));
}

export function moduleModelMatches(model: ModuleModel, filters: ModuleCatalogFilters) {
	if (filters.slot !== "all" && model.slot !== filters.slot || filters.rarity !== "all" && model.rarity !== filters.rarity || filters.platform !== "all" && !model.platforms.includes("*") && !model.platforms.includes(filters.platform)) return false;
	const haystack = normalize([model.label, model.description, MODULE_SLOT_LABELS[model.slot], RARITY_LABELS[model.rarity], ...model.platforms.map(modulePlatformLabel), ...model.calibers, ...(model.requiresMount ? [moduleMountLabel(model.requiresMount)] : []), ...model.providesMounts.map(moduleMountLabel)].join(" "));
	return normalize(filters.search).trim().split(/\s+/).every((word) => haystack.includes(word));
}

export function moduleCatalogPage<T>(items: readonly T[], requestedPage: number, pageSize = 40) {
	const size = Math.max(1, Math.floor(Number.isFinite(pageSize) ? pageSize : 40));
	const pageCount = Math.max(1, Math.ceil(items.length / size));
	const index = Math.max(0, Math.min(pageCount - 1, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 0)));
	const start = index * size;
	return { items: items.slice(start, start + size), index, pageCount, start: items.length ? start + 1 : 0, end: Math.min(items.length, start + size), total: items.length };
}
