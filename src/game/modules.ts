import { WEAPONS, type Attachment, type Rarity } from "./data";
import { WEAPON_ROLES } from "./systems";

export type ModuleSlot = "receiver" | "barrel" | "handguard" | "stock" | "magazine" | "optic" | "muzzle" | "foregrip";
export interface ModuleInstance { id: string; modelId: string; durability: number; foundAt: number; legacyAttachments?: Record<Attachment, number> }
export interface ModuleModel {
	id: string; label: string; description: string; slot: ModuleSlot;
	platforms: string[]; calibers: string[]; requiresMount: string | null; providesMounts: string[];
	weaponId?: string; value: number; rarity: Rarity; appearance: string;
	stats: { damage: number; ergonomics: number; recoil: number; reliability: number; weight: number; ammoMultiplier: number };
	craftCost: { money: number; scrap: number }; workshopLevel: number; lootTier: number;
}
export const MODULE_SLOTS: ModuleSlot[] = ["receiver", "barrel", "handguard", "stock", "magazine", "optic", "muzzle", "foregrip"];
export const MODULE_PLATFORM_LABELS: Record<string, string> = {
	pm: "ПМ", tt: "ТТ", toz: "ТОЗ-106", mp133: "МР-133", kedr: "Кедр", sks: "СКС",
	ak: "АК", saiga: "Сайга", vityaz: "Витязь", mosin: "Мосинка", val: "ВАЛ / ВСС", rpk: "РПК", svd: "СВД", pkp: "ПКП",
};
export const modulePlatformLabel = (platform: string) => Object.hasOwn(MODULE_PLATFORM_LABELS, platform) ? MODULE_PLATFORM_LABELS[platform]! : platform.toUpperCase();
export const MODULE_SLOT_LABELS: Record<ModuleSlot, string> = { receiver: "Ствольная коробка", barrel: "Ствол", handguard: "Цевьё", stock: "Приклад", magazine: "Магазин", optic: "Прицел", muzzle: "Дульное устройство", foregrip: "Рукоять" };
const platforms: Record<string, [string, string]> = {
	pm: ["pm", "9x18"], tt: ["tt", "7.62x25"], toz: ["toz", "20g"], mp133: ["mp133", "12g"],
	pp91: ["kedr", "9x18"], sks: ["sks", "7.62x39"], ak74: ["ak", "5.45x39"], saiga: ["saiga", "12g"],
	vityaz: ["vityaz", "9x19"], mosin: ["mosin", "7.62x54"], akm: ["ak", "7.62x39"], vss: ["val", "9x39"],
	rpk: ["rpk", "7.62x39"], svd: ["svd", "7.62x54"], asval: ["val", "9x39"], pkp: ["pkp", "7.62x54"],
};
export const RECEIVER_INFO: Record<string, { platform: string; caliber: string; requiredSlots: ModuleSlot[] }> = Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, {
	platform: platforms[weapon.id]![0], caliber: platforms[weapon.id]![1],
	requiredSlots: weapon.category === "pistol" ? ["receiver", "barrel", "magazine"] : ["receiver", "barrel", "handguard", "stock", "magazine"],
}]));
export const MODULE_MODELS: ModuleModel[] = [];
function model(id: string, label: string, slot: ModuleSlot, description: string, opts: Partial<ModuleModel> = {}): ModuleModel {
	const value = opts.value ?? 70;
	const result: ModuleModel = { id, label, slot, description, platforms: ["*"], calibers: ["*"], requiresMount: null, providesMounts: [],
		value, rarity: "common", appearance: "factory", stats: { damage: 0, ergonomics: 0, recoil: 0, reliability: 0, weight: 0.2, ammoMultiplier: 1 },
		craftCost: { money: Math.ceil(value * 1.4) + 15, scrap: Math.ceil(value / 100) + 1 }, workshopLevel: 1, lootTier: 1, ...opts };
	MODULE_MODELS.push(result); return result;
}
const stats = (changes: Partial<ModuleModel["stats"]>) => ({ damage: 0, ergonomics: 0, recoil: 0, reliability: 0, weight: 0.2, ammoMultiplier: 1, ...changes });
export const FACTORY_KITS: Record<string, Partial<Record<ModuleSlot, string>>> = {};
for (const weapon of WEAPONS) {
	const info = RECEIVER_INFO[weapon.id]!;
	const pistol = weapon.category === "pistol";
	const weight = WEAPON_ROLES[weapon.category].weight;
	const shares: Partial<Record<ModuleSlot, number>> = pistol ? { receiver: 0.42, barrel: 0.38, magazine: 0.2 } : { receiver: 0.28, barrel: 0.28, handguard: 0.1, stock: 0.17, magazine: 0.17 };
	const values: Partial<Record<ModuleSlot, number>> = pistol ? { receiver: 0.45, barrel: 0.35, magazine: 0.2 } : { receiver: 0.4, barrel: 0.25, handguard: 0.1, stock: 0.15, magazine: 0.1 };
	const kit: Partial<Record<ModuleSlot, string>> = {};
	for (const slot of info.requiredSlots) {
		const moduleId = slot === "receiver" ? `receiver-${weapon.id}` : `factory-${weapon.id}-${slot}`;
		model(moduleId, `${MODULE_SLOT_LABELS[slot]} · ${weapon.name.split(" «")[0]}`, slot, `Штатная деталь ${weapon.name}. Калибр ${info.caliber}, платформа ${modulePlatformLabel(info.platform)}.`, {
			platforms: [info.platform], calibers: [info.caliber], weaponId: weapon.id,
			value: Math.max(8, Math.round(weapon.value * values[slot]!)), rarity: weapon.rarity,
			stats: stats({ weight: weight * shares[slot]! }),
			workshopLevel: slot === "receiver" ? { common: 1, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[weapon.rarity] : 1,
			providesMounts: slot === "receiver" && ["ak", "val", "svd", "rpk", "vityaz"].includes(info.platform) ? ["dovetail"]
				: slot === "barrel" && !["toz", "mp133"].includes(info.platform) ? [`thread:${info.caliber}`] : [],
		});
		kit[slot] = moduleId;
	}
	FACTORY_KITS[weapon.id] = kit;
}
const familyIds = [...new Set(Object.values(RECEIVER_INFO).map((info) => info.platform))];
for (const platform of familyIds) {
	const definitions = WEAPONS.filter((weapon) => RECEIVER_INFO[weapon.id]!.platform === platform);
	const weapon = definitions[0]!;
	const calibers = [...new Set(definitions.map((definition) => RECEIVER_INFO[definition.id]!.caliber))];
	const factoryWeight = (slot: ModuleSlot) => MODULE_MODELS.find((item) => item.id === FACTORY_KITS[weapon.id]![slot])?.stats.weight ?? 0.3;
	const family = { platforms: [platform], calibers, rarity: "uncommon" as Rarity, workshopLevel: 2, lootTier: 2 };
	for (const caliber of calibers) {
		model(`barrel-${platform}-${caliber}-short`, `Короткий ствол · ${modulePlatformLabel(platform)}`, "barrel", "Легче и удобнее, но −6 урона, +9 отдачи. Не совместим с другим калибром.", { ...family, calibers: [caliber], appearance: "short", value: 95,
			stats: stats({ weight: factoryWeight("barrel") * 0.7, damage: -6, ergonomics: 12, recoil: 9, reliability: -2 }), providesMounts: [`thread:${caliber}`] });
		model(`barrel-${platform}-${caliber}-long`, `Длинный ствол · ${modulePlatformLabel(platform)}`, "barrel", "+7 урона и −8 отдачи, но тяжелее и −9 удобства.", { ...family, calibers: [caliber], appearance: "long", value: 135,
			stats: stats({ weight: factoryWeight("barrel") * 1.3, damage: 7, ergonomics: -9, recoil: -8, reliability: 2 }), providesMounts: [`thread:${caliber}`] });
	}
	if (weapon.category !== "pistol") {
		model(`handguard-${platform}-rail`, `Цевьё с планками · ${modulePlatformLabel(platform)}`, "handguard", "Открывает крепления для прицела и рукояти. Вес выше; удобство −3.", { ...family, appearance: "rail", value: 85, workshopLevel: 1,
			stats: stats({ weight: factoryWeight("handguard") + 0.2, ergonomics: -3 }), providesMounts: ["rail-top", "rail-bottom"] });
		model(`handguard-${platform}-light`, `Лёгкое цевьё · ${modulePlatformLabel(platform)}`, "handguard", "+9 удобства и меньше веса; креплений для прицела и рукояти нет.", { ...family, appearance: "light", value: 100,
			stats: stats({ weight: Math.max(0.1, factoryWeight("handguard") - 0.15), ergonomics: 9, reliability: -2 }) });
		model(`stock-${platform}-folding`, `Складной приклад · ${modulePlatformLabel(platform)}`, "stock", "+10 удобства, меньше веса. Отдача +9, надёжность −2.", { ...family, appearance: "folding", value: 95,
			stats: stats({ weight: factoryWeight("stock") * 0.65, ergonomics: 10, recoil: 9, reliability: -2 }) });
		model(`stock-${platform}-tactical`, `Опорный приклад · ${modulePlatformLabel(platform)}`, "stock", "Отдача −12, надёжность +3. Тяжелее и −7 удобства.", { ...family, appearance: "tactical", value: 145,
			stats: stats({ weight: factoryWeight("stock") + 0.25, ergonomics: -7, recoil: -12, reliability: 3 }) });
	}
	for (const caliber of calibers) {
		model(`magazine-${platform}-${caliber}-extended`, `Ёмкий магазин · ${modulePlatformLabel(platform)}`, "magazine", "+3 огневой мощи, отдача −3. Больше веса и расход патронов ×1.15; −8 удобства.", { ...family, calibers: [caliber], appearance: "extended", value: 95,
			stats: stats({ weight: factoryWeight("magazine") + 0.3, damage: 3, ergonomics: -8, recoil: -3, ammoMultiplier: 1.15 }) });
		model(`magazine-${platform}-${caliber}-quick`, `Быстрый магазин · ${modulePlatformLabel(platform)}`, "magazine", "+8 удобства, но −3 огневой мощи. Легче и расход патронов ×0.9.", { ...family, calibers: [caliber], appearance: "quick", value: 70, workshopLevel: 1,
			stats: stats({ weight: factoryWeight("magazine") * 0.8, damage: -3, ergonomics: 8, ammoMultiplier: 0.9 }) });
	}
}
model("optic-reflex", "Коллиматор «Точка»", "optic", "+3 урона, +5 удобства. Нужна верхняя планка; вес 0,25 кг.", { value: 100, rarity: "uncommon", appearance: "reflex", requiresMount: "rail-top", stats: stats({ damage: 3, ergonomics: 5, weight: 0.25 }) });
model("optic-scope", "Оптика 4× «Дозор»", "optic", "+10 урона. Вес 0,65 кг и −11 удобства; нужна верхняя планка.", { value: 240, rarity: "rare", appearance: "scope", workshopLevel: 2, lootTier: 3, requiresMount: "rail-top", stats: stats({ damage: 10, ergonomics: -11, weight: 0.65 }) });
model("optic-dovetail", "Прицел «Боковой»", "optic", "+7 урона. −7 удобства; ставится на штатный боковой кронштейн.", { value: 170, rarity: "rare", appearance: "dovetail", workshopLevel: 2, lootTier: 2, requiresMount: "dovetail", stats: stats({ damage: 7, ergonomics: -7, weight: 0.5 }) });
model("foregrip-light", "Рукоять «Угол»", "foregrip", "Отдача −6, удобство +3. Нужна нижняя планка цевья.", { value: 65, rarity: "uncommon", appearance: "light", requiresMount: "rail-bottom", stats: stats({ recoil: -6, ergonomics: 3, weight: 0.15 }) });
model("foregrip-vertical", "Рукоять «Стойка»", "foregrip", "Отдача −13. Вес 0,35 кг, удобство −4; нужна нижняя планка.", { value: 115, rarity: "rare", appearance: "vertical", workshopLevel: 2, lootTier: 2, requiresMount: "rail-bottom", stats: stats({ recoil: -13, ergonomics: -4, weight: 0.35 }) });
for (const caliber of [...new Set(Object.values(RECEIVER_INFO).map((info) => info.caliber))]) {
	model(`muzzle-${caliber}-brake`, `ДТК · ${caliber}`, "muzzle", "Отдача −12, надёжность +2. Вес 0,25 кг; удобство −4. Нужна резьба нужного калибра.", { value: 95, rarity: "uncommon", calibers: [caliber], appearance: "brake", requiresMount: `thread:${caliber}`, stats: stats({ recoil: -12, ergonomics: -4, reliability: 2, weight: 0.25 }) });
	model(`muzzle-${caliber}-suppressor`, `Глушитель · ${caliber}`, "muzzle", "+4 урона, отдача −7. Вес 0,6 кг, удобство −10, надёжность −5; требует резьбы.", { value: 230, rarity: "rare", calibers: [caliber], appearance: "suppressor", workshopLevel: 3, lootTier: 3, requiresMount: `thread:${caliber}`, stats: stats({ damage: 4, recoil: -7, ergonomics: -10, reliability: -5, weight: 0.6 }) });
}
export const MODULE_BY_ID: Record<string, ModuleModel> = Object.fromEntries(MODULE_MODELS.map((item) => [item.id, item]));
