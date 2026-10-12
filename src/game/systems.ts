import { MAPS, type Attachment, type Supplies, type WeaponCategory } from "./data";
import type { ModuleInstance } from "./modules";

export type ExpeditionBranch = "scavenge" | "combat" | "recon";
export type RunPerk = "careful" | "haggler" | "pathfinder" | "fieldMedic" | "gunsmith";
export type AmmoType = "standard" | "piercing";
export interface Cargo { money: number; supplies: Supplies; weaponIds: string[]; modules: ModuleInstance[] }
export interface GearItem { id: string; modelId: string; durability: number }
export interface Loadout {
	armorItemId: string | null; backpackItemId: string | null;
	ammoType: AmmoType; medkit: boolean;
}
export interface GearModel {
	id: string; slot: "armor" | "backpack"; label: string; description: string;
	money: number; scrap: number; weight: number; protection: number;
	capacity: number; blueprint: string | null;
}

export const GEAR_MODELS: GearModel[] = [
	{ id: "light_vest", slot: "armor", label: "Разгрузка с кевларом", description: "Лёгкая защита: +5% к шансу, слабее тяжёлой брони, почти не замедляет.", money: 145, scrap: 5, weight: 2, protection: 0.05, capacity: 0, blueprint: "light_vest" },
	{ id: "plate_armor", slot: "armor", label: "Плитник «Заслон»", description: "Защита +12% и меньше ранений. Тяжёлый: путь дольше, боеприпасов нужно больше.", money: 440, scrap: 16, weight: 7, protection: 0.12, capacity: 0, blueprint: "plate_armor" },
	{ id: "scout_pack", slot: "backpack", label: "Рюкзак разведчика", description: "18 единиц груза. Лёгкий вариант для коротких выходов.", money: 120, scrap: 4, weight: 1, protection: 0, capacity: 18, blueprint: "scout_pack" },
	{ id: "cargo_pack", slot: "backpack", label: "Грузовая рама", description: "32 единицы груза. Добыча вместится, но скорость и расход ухудшатся.", money: 370, scrap: 12, weight: 5, protection: 0, capacity: 32, blueprint: "cargo_pack" },
];
export const GEAR_MODEL_BY_ID: Record<string, GearModel> = Object.fromEntries(GEAR_MODELS.map((item) => [item.id, item]));
export const BLUEPRINTS: Record<string, { label: string; description: string }> = {
	light_vest: { label: "Лёгкая броня", description: "Мастерская умеет собирать кевларовые разгрузки." },
	scout_pack: { label: "Рюкзак разведчика", description: "Базовое производство лёгких рюкзаков." },
	plate_armor: { label: "Плитник «Заслон»", description: "Найди чертёж на втором этапе боевого маршрута. Сохраняется после потерь." },
	cargo_pack: { label: "Грузовая рама", description: "Найди чертёж на втором этапе поиска тайников. Сохраняется после потерь." },
	...Object.fromEntries(MAPS.map((map) => [`route:${map.id}`, { label: `Маршруты: ${map.name}`, description: "+2% к шансу будущих выходов в этом секторе. Память отряда сохраняется после потерь." }])),
};
export const EXPEDITION_BRANCHES: Record<ExpeditionBranch, { label: string; description: string; chanceBonus: number; lootBonus: number; ammoMultiplier: number; durationMultiplier: number }> = {
	scavenge: { label: "Тайники", description: "Больше припасов и деталей. На втором этапе можно найти чертёж грузовой рамы.", chanceBonus: 0, lootBonus: 0.25, ammoMultiplier: 0.85, durationMultiplier: 1.1 },
	combat: { label: "Оружейный склад", description: "Выше шанс найти пушку и чертёж плитника. Больше патронов и опасности.", chanceBonus: -0.08, lootBonus: 0.15, ammoMultiplier: 1.5, durationMultiplier: 1 },
	recon: { label: "Разведка", description: "Меньше добычи, выше шанс пройти. Нужны разведданные; запоминает безопасные тропы.", chanceBonus: 0.07, lootBonus: -0.1, ammoMultiplier: 0.7, durationMultiplier: 0.9 },
};
export const RUN_PERKS: Record<RunPerk, { label: string; description: string }> = {
	careful: { label: "Тихий шаг", description: "+6% к шансу следующих этапов, но −10% к добыче." },
	haggler: { label: "Тайники барыги", description: "+20% к деньгам, но −4% к шансу следующих этапов." },
	pathfinder: { label: "Срезать путь", description: "Следующие этапы на 20% быстрее, но расход патронов +1." },
	fieldMedic: { label: "Полевая перевязка", description: "Ранения на следующих этапах вдвое слабее." },
	gunsmith: { label: "Полевой оружейник", description: "Оружие изнашивается вдвое медленнее; шанс трофейной пушки +10%." },
};
export const MARKET_OFFERS: { id: string; label: string; supply: keyof Supplies; amount: number; money: number }[] = [
	{ id: "ammo", label: "Ящик патронов", supply: "ammo", amount: 20, money: 130 },
	{ id: "medicine", label: "Медицинский набор", supply: "medicine", amount: 3, money: 100 },
	{ id: "scrap", label: "Мешок деталей", supply: "scrap", amount: 10, money: 145 },
	{ id: "intel", label: "Свежие разведданные", supply: "intel", amount: 3, money: 140 },
];
export const WEAPON_ROLES: Record<WeaponCategory, { label: string; description: string; ammoMultiplier: number; weight: number; branches: Partial<Record<ExpeditionBranch, number>>; attachments: Attachment[] }> = {
	pistol: { label: "Лёгкий выход", description: "Минимальный вес и расход. Хорош для разведки; слаб против укреплённых целей.", ammoMultiplier: 0.65, weight: 1, branches: { recon: 0.04, combat: -0.04 }, attachments: ["magazine"] },
	shotgun: { label: "Ближний бой", description: "Сильнее у оружейного склада, слабее на разведке. Низкий расход.", ammoMultiplier: 0.8, weight: 4, branches: { combat: 0.05, recon: -0.04 }, attachments: ["magazine", "stock"] },
	smg: { label: "Поиск тайников", description: "Компактный и удобный в тесноте, но расход патронов выше.", ammoMultiplier: 1.15, weight: 3, branches: { scavenge: 0.04 }, attachments: ["optic", "magazine", "stock"] },
	rifle: { label: "Универсальный", description: "Сбалансированный бой. Тяжелее ПП и расходует больше патронов.", ammoMultiplier: 1.3, weight: 5, branches: { combat: 0.02 }, attachments: ["optic", "magazine", "stock"] },
	sniper: { label: "Дальний дозор", description: "Бонус к разведке, низкий расход, большой вес. Неудобен у склада.", ammoMultiplier: 0.75, weight: 6, branches: { recon: 0.06, combat: -0.03 }, attachments: ["optic", "stock"] },
};
