import { RARITY_LABELS } from "./game/data";
import { MODULE_SLOTS, MODULE_SLOT_LABELS, RECEIVER_INFO, modulePlatformLabel, type ModuleModel, type ModuleSlot } from "./game/modules";

export interface ModuleCatalogFilters {
	slot: ModuleSlot | "all";
	rarity: ModuleModel["rarity"] | "all";
	platform: string;
	search: string;
}

const mountLabels: Record<string, string> = {
	"rail-top": "Верхняя планка", "rail-bottom": "Нижняя планка цевья", "rail-side": "Боковая планка",
	"barrel-clamp": "Хомут ствола", "barrel-clamp-wide": "Место для широкого хомута ствола", dovetail: "Боковой кронштейн",
};

export function moduleMountLabel(mount: string) {
	return Object.hasOwn(mountLabels, mount) ? mountLabels[mount]! : mount.startsWith("thread:") ? `Резьба ${mount.slice(7)}` : mount;
}

/** Save order stays stable; on the workbench a mounting bracket precedes its attachments. */
export const MODULE_DISPLAY_SLOTS: readonly ModuleSlot[] = (() => {
	const slots = [...MODULE_SLOTS];
	const index = slots.indexOf("mount");
	if (index !== -1) {
		slots.splice(index, 1);
		const optic = slots.indexOf("optic");
		slots.splice(optic === -1 ? slots.length : optic, 0, "mount");
	}
	return slots;
})();

export function moduleSlotHint(slot: ModuleSlot) {
	if (slot === "mount") return "Кронштейн открывает новые планки. Сначала установи подходящий ствол, цевьё или ствольную коробку. Перед снятием крепления нужно снять зависимые детали.";
	if (slot === "flashlight") return "Фонарь ставится на боковую планку цевья или кронштейна. Его корпус виден на собранном оружии и в руках дикого.";
	if (slot === "laser") return "Лазер ставится на боковую планку цевья или кронштейна. Лазер и фонарь можно установить одновременно; каждый занимает свой слот.";
	return "Можно оставить слот свободным или настроить оружие.";
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
