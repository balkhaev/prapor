import { MAP_BY_ID, type Rarity, type Supplies } from "./data";
import type { ExpeditionBranch } from "./systems";

export type LootCategory = "tools" | "electronics" | "medicine" | "provisions" | "valuables" | "intel";
export interface LootItem { id: string; modelId: string; foundAt: number }
export interface LootModel {
	id: string; label: string; description: string; category: LootCategory; rarity: Rarity;
	weight: number; guidePrice: number; salvage: Supplies; minDepth: number; minSectorLevel: number;
}
export const LOOT_CATEGORY_LABELS: Record<LootCategory, string> = {
	tools: "Инструменты", electronics: "Электроника", medicine: "Медицина", provisions: "Провизия", valuables: "Ценности", intel: "Документы",
};
const supplies = (value: Partial<Supplies>): Supplies => ({ ammo: 0, medicine: 0, scrap: 0, intel: 0, ...value });
const item = (id: string, label: string, description: string, category: LootCategory, rarity: Rarity, weight: number, guidePrice: number, salvage: Partial<Supplies>, minDepth = 1, minSectorLevel = 1): LootModel =>
	({ id, label, description, category, rarity, weight, guidePrice, salvage: supplies(salvage), minDepth, minSectorLevel });
/** Prices are a transparent guide for player listings; a buyer sets the actual market value. */
export const LOOT_MODELS: LootModel[] = [
	item("duct-tape", "Армированный скотч", "Целый рулон из гаражного тайника. Можно разобрать в детали для мастерской.", "tools", "common", .3, 25, { scrap: 1 }),
	item("pliers", "Пассатижи", "Рабочий ручной инструмент. Компактный товар или материал для производства.", "tools", "common", .7, 45, { scrap: 2 }),
	item("tool-case", "Набор слесаря", "Тяжёлый кейс с ключами: хорошая цена, но занимает место ценной добычи.", "tools", "uncommon", 3, 140, { scrap: 6 }, 1, 2),
	item("precision-tools", "Прецизионные инструменты", "Набор для тонкой сборки. Находится в глубине промышленных секторов.", "tools", "rare", 1.5, 360, { scrap: 12 }, 2, 5),
	item("copper-wire", "Медный кабель", "Смотанный провод из распределительного щита. Торговцу нужен металл, мастерской — детали.", "electronics", "common", .8, 40, { scrap: 2 }),
	item("battery", "Полевой аккумулятор", "Заряженный блок питания. Относительно дорогой и тяжёлый для короткого выхода.", "electronics", "uncommon", 2, 100, { scrap: 4 }),
	item("circuit-board", "Плата управления", "Уцелевшая плата заводской автоматики. Разбор даёт детали и технические сведения.", "electronics", "rare", .5, 260, { scrap: 5, intel: 1 }, 2, 2),
	item("thermal-sensor", "Тепловизионный модуль", "Редкий датчик из закрытого оборудования. Лёгкий трофей с высокой ценой.", "electronics", "epic", .9, 780, { scrap: 12, intel: 3 }, 3, 5),
	item("bandage-roll", "Стерильный бинт", "Запечатанная упаковка. Можно немедленно превратить в медикамент для отряда.", "medicine", "common", .2, 35, { medicine: 1 }),
	item("antiseptic", "Флакон антисептика", "Невскрытый медицинский раствор. Продажа даёт деньги, переработка — два медикамента.", "medicine", "uncommon", .6, 75, { medicine: 2 }),
	item("surgical-kit", "Хирургический набор", "Полевые инструменты и стерильные расходники. Полезен и рынку, и медблоку.", "medicine", "rare", 1.2, 220, { medicine: 5 }, 2, 2),
	item("lab-reagents", "Лабораторные реагенты", "Холодный контейнер из закрытого медпункта. Дорогая находка для глубокого выхода.", "medicine", "epic", 2, 520, { medicine: 10, intel: 1 }, 3, 5),
	item("ration", "Сухой паёк", "Целая армейская упаковка. Разбор полезных вложений даёт медикамент.", "provisions", "common", .7, 30, { medicine: 1 }),
	item("coffee", "Банка кофе", "Запечатанная банка. Ходовой товар; тара и упаковка идут в детали.", "provisions", "common", .4, 55, { scrap: 1 }),
	item("water-filter", "Походный фильтр", "Запасной фильтр из лагерного ящика. Содержит материалы для медицины и мастерской.", "provisions", "uncommon", 1.1, 120, { medicine: 2, scrap: 2 }, 1, 3),
	item("officer-rations", "Офицерский рацион", "Редкий комплект с медицинскими вложениями. Лучше обычного пайка, но тяжелее.", "provisions", "rare", 2.4, 240, { medicine: 4, scrap: 3 }, 2, 7),
	item("old-watch", "Наручные часы", "Рабочие часы из квартирного тайника. Продать целиком выгоднее разборки.", "valuables", "uncommon", .2, 85, { scrap: 2 }),
	item("silver-chain", "Серебряная цепочка", "Небольшая ценность без лишнего веса. Разбор даёт только крепления и металл.", "valuables", "uncommon", .1, 160, { scrap: 3 }, 2),
	item("gold-ring", "Золотое кольцо", "Сохранённое украшение. Удачный трофей для барахолки, слабый источник материалов.", "valuables", "rare", .1, 430, { scrap: 4 }, 2, 3),
	item("secure-drive", "Защищённый накопитель", "Целый накопитель из закрытого архива. Самый дорогой документальный трофей.", "valuables", "epic", .3, 900, { intel: 8, scrap: 2 }, 3, 7),
	item("local-map", "Карта тайников", "Рукописные отметки местных. Обменять на деньги или извлечь разведданное.", "intel", "common", .1, 45, { intel: 1 }),
	item("patrol-log", "Журнал патрулей", "Записи обходов и постов. Полезен для разведподготовки следующего выхода.", "intel", "uncommon", .3, 115, { intel: 3 }, 1, 2),
	item("depot-manifest", "Складские накладные", "Маршруты снабжения и номера ящиков. Несколько разведданных вместо ожидания покупателя.", "intel", "rare", .5, 250, { intel: 5 }, 2, 2),
	item("cipher-book", "Книга шифров", "Архив военной связи. Лёгкий дорогой трофей или большой запас разведданных.", "intel", "epic", .4, 650, { intel: 10 }, 3, 7),
];
export const LOOT_MODEL_BY_ID: Record<string, LootModel> = Object.fromEntries(LOOT_MODELS.map(model => [model.id, model]));
const sectorCategories: Record<string, LootCategory[]> = {
	courtyard: ["tools", "provisions", "valuables"], depot: ["tools", "provisions", "intel"], forest: ["provisions", "medicine", "intel"],
	factory: ["tools", "electronics"], reserve: ["medicine", "intel", "electronics"], bunker: ["electronics", "intel", "valuables"],
};
const branchCategories: Record<ExpeditionBranch, LootCategory[]> = { scavenge: ["tools", "provisions", "valuables"], combat: ["electronics", "medicine"], recon: ["intel", "electronics"] };
export function getRaidLootPool(mapId: string, branch: ExpeditionBranch, depth: number): { model: LootModel; weight: number }[] {
	if (!Object.hasOwn(MAP_BY_ID, mapId) || !Object.hasOwn(branchCategories, branch) || !Number.isInteger(depth) || depth < 1 || depth > 3) return [];
	const level = MAP_BY_ID[mapId]!.level;
	return LOOT_MODELS.filter(model => model.minDepth <= depth && model.minSectorLevel <= level).map(model => ({ model,
		weight: ({ common: 7, uncommon: 4, rare: 1.5, epic: .45, legendary: .15 }[model.rarity])
			* (sectorCategories[mapId]!.includes(model.category) ? 3 : .6) * (branchCategories[branch].includes(model.category) ? 1.8 : 1)
			* (model.rarity === "rare" || model.rarity === "epic" ? 1 + (depth - 1) * .25 + (level - 1) * .08 : 1),
	}));
}
export function rollRaidLoot(mapId: string, branch: ExpeditionBranch, depth: number, random: () => number): LootModel[] {
	const pool = getRaidLootPool(mapId, branch, depth); if (!pool.length) return [];
	const count = 1 + (random() < (branch === "scavenge" ? .3 : .15) + (depth - 1) * .12 ? 1 : 0);
	const result: LootModel[] = [], total = pool.reduce((sum, entry) => sum + entry.weight, 0);
	for (let index = 0; index < count; index++) {
		let roll = random() * total;
		result.push((pool.find(entry => (roll -= entry.weight) < 0) ?? pool.at(-1)!).model);
	}
	return result;
}
export function getLootModel(item: LootItem): LootModel {
	if (!Object.hasOwn(LOOT_MODEL_BY_ID, item.modelId)) throw new Error("Неизвестный трофей");
	return LOOT_MODEL_BY_ID[item.modelId]!;
}
export function getLootTraderPrice(item: LootItem): number { return Math.max(1, Math.floor(getLootModel(item).guidePrice * .55)); }
export function parseLootItem(value: unknown): LootItem {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("loot-object");
	const source = value as Record<string, unknown>;
	if (Object.keys(source).some(key => !["id", "modelId", "foundAt"].includes(key)) || typeof source.id !== "string" || !/^loot-[1-9]\d*$/.test(source.id)
		|| typeof source.modelId !== "string" || !Object.hasOwn(LOOT_MODEL_BY_ID, source.modelId) || typeof source.foundAt !== "number" || !Number.isFinite(source.foundAt) || source.foundAt < 0 || source.foundAt > 1e15) throw new Error("loot-item");
	return { id: source.id, modelId: source.modelId, foundAt: source.foundAt };
}
