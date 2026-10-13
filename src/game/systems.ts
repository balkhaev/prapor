import { MAPS, type Attachment, type Supplies, type WeaponCategory } from "./data";
import type { ModuleInstance } from "./modules";
import type { GearEquipmentSlot } from "./operations";
import type { AmmoType } from "./ammunition";
export type { AmmoType } from "./ammunition";

export type ExpeditionBranch = "scavenge" | "combat" | "recon";
export type RunPerk = "careful" | "haggler" | "pathfinder" | "fieldMedic" | "gunsmith";
export interface Cargo { money: number; supplies: Supplies; weaponIds: string[]; modules: ModuleInstance[] }
export interface GearItem { id: string; modelId: string; durability: number }
export interface Loadout {
	armorItemId: string | null; backpackItemId: string | null;
	/** Omitted by older saves/callers; absence means no physical helmet. */
	helmetItemId?: string | null;
	ammoType: AmmoType; medkit: boolean;
}
export interface GearModel {
	id: string; slot: GearEquipmentSlot; label: string; description: string;
	money: number; scrap: number; weight: number; protection: number;
	capacity: number; blueprint: string | null;
}

export const GEAR_MODELS: GearModel[] = [
	{ id: "light_vest", slot: "armor", label: "Разгрузка с кевларом", description: "Лёгкая защита: +5% к шансу, слабее тяжёлой брони, почти не замедляет.", money: 145, scrap: 5, weight: 2, protection: 0.05, capacity: 0, blueprint: "light_vest" },
	{ id: "plate_armor", slot: "armor", label: "Плитник «Заслон»", description: "Защита +12% и меньше ранений. Тяжёлый: путь дольше, боеприпасов нужно больше.", money: 440, scrap: 16, weight: 7, protection: 0.12, capacity: 0, blueprint: "plate_armor" },
	{ id: "scout_pack", slot: "backpack", label: "Рюкзак разведчика", description: "18 единиц груза. Лёгкий вариант для коротких выходов.", money: 120, scrap: 4, weight: 1, protection: 0, capacity: 18, blueprint: "scout_pack" },
	{ id: "cargo_pack", slot: "backpack", label: "Грузовая рама", description: "32 единицы груза. Добыча вместится, но скорость и расход ухудшатся.", money: 370, scrap: 12, weight: 5, protection: 0, capacity: 32, blueprint: "cargo_pack" },
	{ id: "padded_vest", slot: "armor", label: "Стёганый жилет", description: "Защита +3%. Дешёвый лёгкий жилет для первых выходов.", money: 85, scrap: 3, weight: 1.5, protection: 0.03, capacity: 0, blueprint: "light_vest" },
	{ id: "patrol_armor", slot: "armor", label: "Патрульная броня", description: "Защита +7%. Закрывает торс и бока, тяжелее разгрузки.", money: 230, scrap: 8, weight: 3.8, protection: 0.07, capacity: 0, blueprint: "light_vest" },
	{ id: "assault_armor", slot: "armor", label: "Штурмовая броня", description: "Защита +10%. Плотный комплект с плечевыми секциями для боевых маршрутов.", money: 360, scrap: 13, weight: 5.7, protection: 0.10, capacity: 0, blueprint: "plate_armor" },
	{ id: "heavy_armor", slot: "armor", label: "Тяжёлая броня «Бастион»", description: "Защита +15%. Максимальная защита торса ценой веса, времени и расхода патронов.", money: 650, scrap: 22, weight: 9.5, protection: 0.15, capacity: 0, blueprint: "plate_armor" },
	{ id: "steel_helmet", slot: "helmet", label: "Стальная каска", description: "Защита +2%. Простая оливковая каска; надевается отдельно от брони.", money: 80, scrap: 3, weight: 1.2, protection: 0.02, capacity: 0, blueprint: "light_vest" },
	{ id: "kevlar_helmet", slot: "helmet", label: "Кевларовый шлем", description: "Защита +4%. Лёгкая закрытая каска с мягкой подвеской.", money: 180, scrap: 6, weight: 1.6, protection: 0.04, capacity: 0, blueprint: "light_vest" },
	{ id: "tactical_helmet", slot: "helmet", label: "Тактический шлем", description: "Защита +5%. Шлем с боковыми направляющими для снаряжения.", money: 295, scrap: 10, weight: 2.1, protection: 0.05, capacity: 0, blueprint: "plate_armor" },
	{ id: "visor_helmet", slot: "helmet", label: "Шлем с забралом", description: "Защита +7%. Защищает голову и лицо; самый тяжёлый шлем.", money: 430, scrap: 15, weight: 3.5, protection: 0.07, capacity: 0, blueprint: "plate_armor" },
	{ id: "canvas_pack", slot: "backpack", label: "Холщовый вещмешок", description: "14 единиц груза. Доступный компактный мешок для первых рейдов.", money: 65, scrap: 2, weight: 0.7, protection: 0, capacity: 14, blueprint: "scout_pack" },
	{ id: "patrol_pack", slot: "backpack", label: "Патрульный рюкзак", description: "22 единицы груза. Средний рюкзак с наружными подсумками.", money: 205, scrap: 7, weight: 2.4, protection: 0, capacity: 22, blueprint: "scout_pack" },
	{ id: "expedition_pack", slot: "backpack", label: "Экспедиционный рюкзак", description: "26 единиц груза. Большой походный рюкзак с верхним клапаном.", money: 280, scrap: 9, weight: 3.6, protection: 0, capacity: 26, blueprint: "cargo_pack" },
	{ id: "frame_pack", slot: "backpack", label: "Рамный рюкзак «Носильщик»", description: "36 единиц груза. Самый вместительный комплект, но заметно замедляет путь.", money: 485, scrap: 16, weight: 6.5, protection: 0, capacity: 36, blueprint: "cargo_pack" },
];
export const GEAR_MODEL_BY_ID: Record<string, GearModel> = Object.fromEntries(GEAR_MODELS.map((item) => [item.id, item]));
export const BLUEPRINTS: Record<string, { label: string; description: string }> = {
	light_vest: { label: "Лёгкая броня", description: "Разгрузки, стёганые жилеты, патрульная броня, стальные и кевларовые шлемы." },
	scout_pack: { label: "Рюкзак разведчика", description: "Вещмешки, лёгкие и патрульные рюкзаки." },
	plate_armor: { label: "Плитник «Заслон»", description: "Тяжёлая броня и боевые шлемы. Найди чертёж на втором этапе боевого маршрута. Сохраняется после потерь." },
	cargo_pack: { label: "Грузовая рама", description: "Грузовые и экспедиционные рюкзаки. Найди чертёж на втором этапе поиска тайников. Сохраняется после потерь." },
	...Object.fromEntries(MAPS.map((map) => [`route:${map.id}`, { label: `Маршруты: ${map.name}`, description: "+2% к шансу будущих выходов в этом секторе. Память отряда сохраняется после потерь." }])),
};
export const EXPEDITION_BRANCHES: Record<ExpeditionBranch, { label: string; description: string; chanceBonus: number; lootBonus: number; ammoMultiplier: number; durationMultiplier: number }> = {
	scavenge: { label: "Тайники", description: "Больше припасов и деталей. На втором этапе можно найти чертёж грузовой рамы.", chanceBonus: 0, lootBonus: 0.25, ammoMultiplier: 0.85, durationMultiplier: 1.1 },
	combat: { label: "Оружейный склад", description: "Больше оружейных модулей и ствольных коробок. На втором этапе — чертёж плитника. Больше патронов и риска.", chanceBonus: -0.08, lootBonus: 0.15, ammoMultiplier: 1.5, durationMultiplier: 1 },
	recon: { label: "Разведка", description: "Меньше добычи, выше шанс пройти. Нужны разведданные; запоминает безопасные тропы.", chanceBonus: 0.07, lootBonus: -0.1, ammoMultiplier: 0.7, durationMultiplier: 0.9 },
};
export const RUN_PERKS: Record<RunPerk, { label: string; description: string }> = {
	careful: { label: "Тихий шаг", description: "+6% к шансу следующих этапов, но −10% к добыче." },
	haggler: { label: "Тайники барыги", description: "+20% к деньгам, но −4% к шансу следующих этапов." },
	pathfinder: { label: "Срезать путь", description: "Следующие этапы на 20% быстрее, но расход патронов +1." },
	fieldMedic: { label: "Полевая перевязка", description: "Ранения на следующих этапах вдвое слабее." },
	gunsmith: { label: "Полевой оружейник", description: "Оружие изнашивается вдвое медленнее; модули в добыче получают +10 к состоянию, шанс пушки +10%." },
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
