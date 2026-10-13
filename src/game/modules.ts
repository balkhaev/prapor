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

// Append new models so the IDs and relative order of the original catalogue stay stable.
// The integral VAL/VSS barrels do not expose a second suppressor mounting point.
for (const platform of familyIds) {
	const definitions = WEAPONS.filter((weapon) => RECEIVER_INFO[weapon.id]!.platform === platform);
	const weapon = definitions[0]!;
	const calibers = [...new Set(definitions.map((definition) => RECEIVER_INFO[definition.id]!.caliber))];
	const label = modulePlatformLabel(platform);
	const factoryWeight = (slot: ModuleSlot) => MODULE_MODELS.find((item) => item.id === FACTORY_KITS[weapon.id]![slot])?.stats.weight ?? 0.3;
	const family = { platforms: [platform], calibers };
	for (const caliber of calibers) {
		const providesMounts = platform === "val" ? [] : [`thread:${caliber}`];
		model(`barrel-${platform}-${caliber}-heavy`, `Утолщённый ствол «Опора» · ${label}`, "barrel", `+5 урона, −10 отдачи, +6 надёжности. Вес ×1,4 и −13 удобства.${platform === "val" ? " Встроенное дульное устройство; внешние насадки не устанавливаются." : " Резьба только своего калибра."}`, {
			...family, calibers: [caliber], appearance: "heavy", value: 190, rarity: "rare", workshopLevel: 3, lootTier: 3, providesMounts,
			stats: stats({ weight: factoryWeight("barrel") * 1.4, damage: 5, ergonomics: -13, recoil: -10, reliability: 6 }),
		});
		model(`barrel-${platform}-${caliber}-fluted`, `Ствол с долами «Грань» · ${label}`, "barrel", `+6 урона, −6 отдачи, +3 надёжности. Вес ×1,1 и −4 удобства; дорогая обработка.${platform === "val" ? " Встроенное дульное устройство; внешние насадки не устанавливаются." : " Резьба только своего калибра."}`, {
			...family, calibers: [caliber], appearance: "fluted", value: 285, rarity: "epic", workshopLevel: 4, lootTier: 4, providesMounts,
			stats: stats({ weight: factoryWeight("barrel") * 1.1, damage: 6, ergonomics: -4, recoil: -6, reliability: 3 }),
		});
	}
	if (weapon.category !== "pistol") {
		model(`handguard-${platform}-wood`, `Деревянное цевьё «Классика» · ${label}`, "handguard", "+4 удобства, +3 надёжности; немного тяжелее штатного. Планок для прицела и рукояти нет.", {
			...family, appearance: "wood", value: 60, rarity: "common", workshopLevel: 1, lootTier: 1,
			stats: stats({ weight: factoryWeight("handguard") + 0.1, ergonomics: 4, reliability: 3 }),
		});
		model(`handguard-${platform}-vented`, `Перфорированное цевьё «Обдув» · ${label}`, "handguard", "+3 удобства, +2 надёжности. Нижняя планка позволяет поставить рукоять; верхней планки нет.", {
			...family, appearance: "vented", value: 125, rarity: "uncommon", workshopLevel: 2, lootTier: 2, providesMounts: ["rail-bottom"],
			stats: stats({ weight: factoryWeight("handguard") + 0.08, ergonomics: 3, reliability: 2 }),
		});
		model(`handguard-${platform}-carbon`, `Карбоновое цевьё «Нить» · ${label}`, "handguard", "+7 удобства, меньше веса и две планки для прицела и рукояти. Надёжность −4.", {
			...family, appearance: "carbon", value: 235, rarity: "rare", workshopLevel: 3, lootTier: 3, providesMounts: ["rail-top", "rail-bottom"],
			stats: stats({ weight: Math.max(0.08, factoryWeight("handguard") - 0.1), ergonomics: 7, reliability: -4 }),
		});
		model(`stock-${platform}-skeleton`, `Скелетный приклад «Рама» · ${label}`, "stock", "+14 удобства, почти вдвое легче. Отдача +13, надёжность −3.", {
			...family, appearance: "skeleton", value: 115, rarity: "uncommon", workshopLevel: 2, lootTier: 2,
			stats: stats({ weight: factoryWeight("stock") * 0.55, ergonomics: 14, recoil: 13, reliability: -3 }),
		});
		model(`stock-${platform}-precision`, `Регулируемый приклад «Точность» · ${label}`, "stock", "Отдача −17 и надёжность +4. Регулируемая щека и массивная опора: +0,45 кг, −12 удобства.", {
			...family, appearance: "precision", value: 275, rarity: "epic", workshopLevel: 4, lootTier: 4,
			stats: stats({ weight: factoryWeight("stock") + 0.45, ergonomics: -12, recoil: -17, reliability: 4 }),
		});
		model(`stock-${platform}-padded`, `Приклад с затыльником «Мягкий» · ${label}`, "stock", "Отдача −7, надёжность +4. Резиновый затыльник добавляет 0,12 кг; удобство −2.", {
			...family, appearance: "padded", value: 75, rarity: "common", workshopLevel: 1, lootTier: 1,
			stats: stats({ weight: factoryWeight("stock") + 0.12, ergonomics: -2, recoil: -7, reliability: 4 }),
		});
	}
	for (const caliber of calibers) {
		const fixedFeed = ["mosin", "mp133", "pkp"].includes(platform);
		const windowLabel = platform === "mp133" ? "Трубчатый магазин с индикатором" : platform === "mosin" ? "Магазин с отметками подачи" : platform === "pkp" ? "Коробка с окном контроля ленты" : "Магазин с окном";
		const compactLabel = platform === "mp133" ? "Короткий трубчатый магазин" : platform === "mosin" ? "Облегчённая магазинная коробка" : platform === "pkp" ? "Компактная коробка для ленты" : "Компактный магазин";
		model(`magazine-${platform}-${caliber}-window`, `${windowLabel} «Контроль» · ${label}`, "magazine", `+5 удобства, но +0,08 кг и −1 надёжности. Расход патронов штатный.${fixedFeed ? " Сохраняет штатную систему подачи этой платформы." : " Окно и отметки отличают его от закрытого магазина."}`, {
			...family, calibers: [caliber], appearance: "window", value: 110, rarity: "uncommon", workshopLevel: 2, lootTier: 2,
			stats: stats({ weight: factoryWeight("magazine") + 0.08, ergonomics: 5, reliability: -1 }),
		});
		model(`magazine-${platform}-${caliber}-compact`, `${compactLabel} «Короткий» · ${label}`, "magazine", "+12 удобства, вес ×0,65, расход патронов ×0,8. Меньший запас снижает огневую мощь на 5.", {
			...family, calibers: [caliber], appearance: "compact", value: 55, rarity: "common", workshopLevel: 1, lootTier: 1,
			stats: stats({ weight: factoryWeight("magazine") * 0.65, damage: -5, ergonomics: 12, ammoMultiplier: 0.8 }),
		});
		if (["ak", "rpk", "saiga", "vityaz", "kedr", "val"].includes(platform)) {
			model(`magazine-${platform}-${caliber}-drum`, `Барабанный магазин «Бубен» · ${label}`, "magazine", "+6 огневой мощи, −5 отдачи. +0,8 кг, −17 удобства и −5 надёжности; расход патронов ×1,35.", {
				...family, calibers: [caliber], appearance: "drum", value: 210, rarity: "rare", workshopLevel: 3, lootTier: 3,
				stats: stats({ weight: factoryWeight("magazine") + 0.8, damage: 6, ergonomics: -17, recoil: -5, reliability: -5, ammoMultiplier: 1.35 }),
			});
		}
	}
}

model("optic-micro", "Микроколлиматор «Искра»", "optic", "+2 урона, +8 удобства, вес 0,14 кг. Надёжность −1; нужна верхняя планка.", {
	appearance: "micro", value: 155, rarity: "uncommon", workshopLevel: 2, lootTier: 2, requiresMount: "rail-top", stats: stats({ damage: 2, ergonomics: 8, reliability: -1, weight: 0.14 }),
});
model("optic-holo", "Голографический прицел «Рамка»", "optic", "+6 урона без потери удобства. Вес 0,38 кг, надёжность −2; нужна верхняя планка.", {
	appearance: "holo", value: 260, rarity: "rare", workshopLevel: 3, lootTier: 3, requiresMount: "rail-top", stats: stats({ damage: 6, reliability: -2, weight: 0.38 }),
});
model("optic-prism", "Призматический прицел 3× «Клин»", "optic", "+8 урона, +3 надёжности. Вес 0,42 кг и −5 удобства; нужна верхняя планка.", {
	appearance: "prism", value: 295, rarity: "rare", workshopLevel: 3, lootTier: 3, requiresMount: "rail-top", stats: stats({ damage: 8, ergonomics: -5, reliability: 3, weight: 0.42 }),
});
model("optic-scout", "Короткая оптика 2× «След»", "optic", "+5 урона, +1 надёжности. Вес 0,35 кг и −2 удобства; нужна верхняя планка.", {
	appearance: "scout", value: 185, rarity: "uncommon", workshopLevel: 2, lootTier: 2, requiresMount: "rail-top", stats: stats({ damage: 5, ergonomics: -2, reliability: 1, weight: 0.35 }),
});
model("optic-longscope", "Длинная оптика 8× «Горизонт»", "optic", "+14 урона. Вес 0,95 кг, −18 удобства и −2 надёжности; нужна верхняя планка.", {
	appearance: "longscope", value: 430, rarity: "epic", workshopLevel: 4, lootTier: 4, requiresMount: "rail-top", stats: stats({ damage: 14, ergonomics: -18, reliability: -2, weight: 0.95 }),
});
model("optic-dovetail-reflex", "Боковой коллиматор «Сверчок»", "optic", "+4 урона, +3 удобства и +1 надёжности. Вес 0,31 кг; нужен штатный боковой кронштейн.", {
	appearance: "dovetail-reflex", value: 195, rarity: "uncommon", workshopLevel: 2, lootTier: 2, requiresMount: "dovetail", stats: stats({ damage: 4, ergonomics: 3, reliability: 1, weight: 0.31 }),
});

for (const caliber of [...new Set(Object.values(RECEIVER_INFO).map((info) => info.caliber))]) {
	const mount = { calibers: [caliber], requiresMount: `thread:${caliber}` };
	model(`muzzle-${caliber}-flash`, `Пламегаситель «Лепесток» · ${caliber}`, "muzzle", "Отдача −3, надёжность +2. Вес 0,13 кг и −1 удобства; нужна резьба своего калибра.", {
		...mount, appearance: "flash", value: 65, rarity: "common", workshopLevel: 1, lootTier: 1, stats: stats({ recoil: -3, ergonomics: -1, reliability: 2, weight: 0.13 }),
	});
	model(`muzzle-${caliber}-ported`, `Компенсатор с портами «Соты» · ${caliber}`, "muzzle", "+1 урона, −9 отдачи. Вес 0,19 кг и −3 удобства; нужна резьба своего калибра.", {
		...mount, appearance: "ported", value: 140, rarity: "uncommon", workshopLevel: 2, lootTier: 2, stats: stats({ damage: 1, recoil: -9, ergonomics: -3, weight: 0.19 }),
	});
	if (!["12g", "20g"].includes(caliber)) {
		model(`muzzle-${caliber}-compact-suppressor`, `Короткий глушитель «Тень» · ${caliber}`, "muzzle", "+2 урона и −4 отдачи. Вес 0,34 кг, −5 удобства и −3 надёжности; нужна резьба своего калибра.", {
			...mount, appearance: "compact-suppressor", value: 285, rarity: "rare", workshopLevel: 3, lootTier: 3, stats: stats({ damage: 2, recoil: -4, ergonomics: -5, reliability: -3, weight: 0.34 }),
		});
	}
}

model("foregrip-stubby", "Короткая рукоять «Пень»", "foregrip", "Отдача −7, удобство +1. Вес 0,2 кг; нужна нижняя планка.", {
	appearance: "stubby", value: 75, rarity: "common", workshopLevel: 1, lootTier: 1, requiresMount: "rail-bottom", stats: stats({ recoil: -7, ergonomics: 1, weight: 0.2 }),
});
model("foregrip-angled", "Наклонный упор «Ладонь»", "foregrip", "Отдача −5, удобство +6. Вес 0,18 кг; нужна нижняя планка.", {
	appearance: "angled", value: 110, rarity: "uncommon", workshopLevel: 2, lootTier: 2, requiresMount: "rail-bottom", stats: stats({ recoil: -5, ergonomics: 6, weight: 0.18 }),
});
model("foregrip-bipod", "Сошки «Опора»", "foregrip", "Отдача −18, надёжность +3. Массивная опора весит 0,7 кг и снижает удобство на 13; нужна нижняя планка.", {
	appearance: "bipod", value: 265, rarity: "epic", workshopLevel: 4, lootTier: 4, requiresMount: "rail-bottom", stats: stats({ recoil: -18, ergonomics: -13, reliability: 3, weight: 0.7 }),
});
model("foregrip-folding", "Складная рукоять «Шарнир»", "foregrip", "Отдача −10 без потери удобства. Вес 0,26 кг, надёжность −2; нужна нижняя планка.", {
	appearance: "folding", value: 165, rarity: "rare", workshopLevel: 3, lootTier: 3, requiresMount: "rail-bottom", stats: stats({ recoil: -10, reliability: -2, weight: 0.26 }),
});
export const MODULE_BY_ID: Record<string, ModuleModel> = Object.fromEntries(MODULE_MODELS.map((item) => [item.id, item]));
