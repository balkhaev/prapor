import { MAP_BY_ID, type Rarity, type Supplies } from "./data";
import type { ExpeditionBranch } from "./systems";
import { BOSS_SAVE_VERSION, type BossId } from './bosses';

export type LootCategory = "tools" | "electronics" | "medicine" | "provisions" | "valuables" | "intel" | "junk";
export interface LootItem { id: string; modelId: string; foundAt: number }
export interface LootModel {
	id: string; label: string; description: string; category: LootCategory; rarity: Rarity;
	weight: number; guidePrice: number; salvage: Supplies; minDepth: number; minSectorLevel: number;
	/** Only these low-value objects are sold automatically on confirmed delivery. */
	autoSell?: true;
	releasedIn?: number;
	/** Only awarded after defeating this boss; never part of ordinary random pools. */
	bossId?: BossId;
}
export const LOOT_CATEGORY_LABELS: Record<LootCategory, string> = {
	tools: "Инструменты", electronics: "Электроника", medicine: "Медицина", provisions: "Провизия", valuables: "Ценности", intel: "Документы", junk: "Мусор",
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
	{ ...item("empty-can", "Пустая консервная банка", "Мусор · автопродажа при доставке. Погнутая пустая тара без полезных вложений.", "junk", "common", .15, 3, {}), autoSell: true, releasedIn: 21 },
	{ ...item("torn-cloth", "Рваная ткань", "Мусор · автопродажа при доставке. Грязный обрывок, непригодный для медицинских и защитных комплектов.", "junk", "common", .1, 4, {}), autoSell: true, releasedIn: 21 },
	{ ...item("broken-phone", "Разбитый телефон", "Мусор · автопродажа при доставке. Электроника выгорела, корпус и экран расколоты.", "junk", "common", .25, 18, {}), autoSell: true, releasedIn: 21 },
	{ ...item("bottle-cap", "Крышка от бутылки", "Мусор · автопродажа при доставке. Дешёвая металлическая крышка.", "junk", "common", .05, 2, {}), autoSell: true, releasedIn: 21 },
	{ ...item("spent-casing", "Стреляная гильза", "Мусор · автопродажа при доставке. Пустая повреждённая гильза, непригодная для снаряжения патронов.", "junk", "common", .05, 2, {}), autoSell: true, releasedIn: 21 },
	{ ...item("cracked-lens", "Треснувшая линза", "Мусор · автопродажа при доставке. Оптика разбита и не подходит для приборов или бартера.", "junk", "common", .12, 10, {}), autoSell: true, releasedIn: 21 },
	{ ...item("military-cpu", "Военный вычислительный модуль", "Легендарный процессор из защищённого комплекса. Целый трофей для бартера на снаряжение; разбор даёт детали и разведданные.", "electronics", "legendary", .2, 1050, { scrap: 18, intel: 8 }, 3, 7), releasedIn: 21 },
	{ ...item("prototype-optics", "Прототип военной оптики", "Легендарный опытный прибор из закрытого бункера. Целый трофей для бартера на снаряжение; разбор даёт детали и разведданные.", "electronics", "legendary", .25, 800, { scrap: 16, intel: 5 }, 3, 9), releasedIn: 21 },
	{ ...item("luxury-watch", "Коллекционные часы", "Рабочие часы с механическим калибром. Компактная роскошь для обмена или продажи по своей цене.", "valuables", "rare", .2, 300, { scrap: 4 }, 2, 3), releasedIn: 24 },
	{ ...item("perfume", "Флакон духов", "Запечатанный флакон из заброшенного магазина. Ценный целый товар для обмена.", "valuables", "uncommon", .5, 140, { medicine: 1, scrap: 1 }, 2, 3), releasedIn: 24 },
	{ ...item("gemstone", "Огранённый камень", "Небольшой ювелирный камень. Высокая ценность при почти незаметном весе.", "valuables", "rare", .05, 400, { scrap: 3 }, 2, 3), releasedIn: 24 },
	{ ...item("bronze-statuette", "Бронзовая статуэтка", "Уцелевшая коллекционная фигурка. Хороший товар, но занимает больше места в рюкзаке.", "valuables", "uncommon", .8, 180, { scrap: 5 }, 2, 3), releasedIn: 24 },
	{ ...item("suture-kit", "Набор для наложения швов", "Стерильные иглы и нити. Целый медицинский трофей для обмена или запаса медблока.", "medicine", "uncommon", .25, 80, { medicine: 2 }, 1, 2), releasedIn: 24 },
	{ ...item("antibiotics", "Упаковка антибиотиков", "Неповреждённая аптечная упаковка. Сохрани целой для обмена или извлеки медикаменты.", "medicine", "uncommon", .15, 120, { medicine: 3 }, 1, 2), releasedIn: 24 },
	{ ...item("hemostatic", "Кровоостанавливающий препарат", "Запечатанный полевой препарат. Ценное содержимое для медицинских комплектов.", "medicine", "uncommon", .2, 90, { medicine: 2 }), releasedIn: 24 },
	{ ...item("painkillers", "Блистер обезболивающего", "Целая упаковка таблеток. Медицинский трофей для обмена и переработки в медикамент.", "medicine", "common", .1, 40, { medicine: 1 }), releasedIn: 24 },
	{ ...item("screws", "Коробка крепежа", "Винты и гайки в заводской коробке. Целый расходник для сборки; разбор даёт детали.", "tools", "common", .2, 25, { scrap: 1 }), releasedIn: 24 },
	{ ...item("sewing-kit", "Швейный набор", "Прочные нити, иглы и инструменты. Сохрани целым для производства экипировки.", "tools", "uncommon", .4, 80, { scrap: 2, medicine: 1 }), releasedIn: 24 },
	{ ...item("gunpowder", "Банка оружейного пороха", "Запечатанная банка для снаряжения патронов. Нужна целиком патронному цеху.", "tools", "common", .3, 50, { ammo: 4 }, 1, 2), releasedIn: 24 },
	{ ...item("primer", "Коробка капсюлей", "Рабочие капсюли в сухой упаковке. Целый компонент для производства боеприпасов.", "tools", "common", .1, 30, { ammo: 2 }), releasedIn: 24 },
	{ ...item("faded-receipt", "Выцветший чек", "Мусор · автопродажа при доставке. Бумага без читаемых сведений.", "junk", "common", .03, 2, {}), autoSell: true, releasedIn: 24 },
	{ ...item("crushed-bottle", "Смятая бутылка", "Мусор · автопродажа при доставке. Пустая повреждённая пластиковая тара.", "junk", "common", .08, 4, {}), autoSell: true, releasedIn: 24 },
	{ ...item("rusty-nail", "Ржавый гвоздь", "Мусор · автопродажа при доставке. Погнутый крепёж, непригодный для сборки.", "junk", "common", .04, 6, {}), autoSell: true, releasedIn: 24 },
	{ ...item("plastic-shard", "Обломок пластика", "Мусор · автопродажа при доставке. Треснувший кусок корпуса без полезных деталей.", "junk", "common", .06, 8, {}), autoSell: true, releasedIn: 24 },
	{ ...item("dead-battery", "Потёкшая батарейка", "Мусор · автопродажа при доставке. Повреждённый элемент питания, непригодный для оборудования.", "junk", "common", .1, 12, {}), autoSell: true, releasedIn: 24 },
	{ ...item("broken-circuit", "Обгоревшая плата", "Мусор · автопродажа при доставке. Дорожки и компоненты уничтожены, целым материалом не считается.", "junk", "common", .15, 18, {}), autoSell: true, releasedIn: 24 },
	{ ...item('boss-bugor-sign', 'Знак Бугра', 'Именной знак главаря Посёлка. Трофей за победу; можно обменять на патрульную броню или продать по своей цене.', 'valuables', 'rare', .15, 360, { scrap: 5, intel: 2 }, 2, 2), releasedIn: BOSS_SAVE_VERSION, bossId: 'bugor' },
	{ ...item('boss-lesnik-compass', 'Компас Лесника', 'Компас хозяина лесных дворов. Трофей за победу; целый предмет даёт экспедиционный рюкзак через бартер.', 'intel', 'rare', .2, 430, { scrap: 2, intel: 5 }, 2, 3), releasedIn: BOSS_SAVE_VERSION, bossId: 'lesnik' },
	{ ...item('boss-liteyshchik-key', 'Ключ Литейщика', 'Ключ от защищённой промышленной секции. Трофей за победу; обмен на плитник сохраняет деньги и детали базы.', 'intel', 'epic', .12, 690, { scrap: 4, intel: 8 }, 3, 5), releasedIn: BOSS_SAVE_VERSION, bossId: 'liteyshchik' },
	{ ...item('boss-komendant-seal', 'Печать Коменданта', 'Печать командира тяжёлых складов. Легендарный трофей за победу; бартер выдаёт исправную тяжёлую броню.', 'intel', 'legendary', .15, 1020, { scrap: 10, intel: 10 }, 3, 7), releasedIn: BOSS_SAVE_VERSION, bossId: 'komendant' },
];
export const LOOT_MODEL_BY_ID: Record<string, LootModel> = Object.fromEntries(LOOT_MODELS.map(model => [model.id, model]));
export const JUNK_MODELS: readonly LootModel[] = LOOT_MODELS.filter(model => model.autoSell === true);
export const USEFUL_LOOT_MODELS: readonly LootModel[] = LOOT_MODELS.filter(model => !model.autoSell);
export function lootAvailableInCatalog(modelId: string, catalogVersion: number): boolean {
	return Object.hasOwn(LOOT_MODEL_BY_ID, modelId) && Number.isInteger(catalogVersion)
		&& (LOOT_MODEL_BY_ID[modelId]!.releasedIn ?? 16) <= catalogVersion;
}
export function isAutoSellLoot(item: Pick<LootItem, "modelId">): boolean { return Object.hasOwn(LOOT_MODEL_BY_ID, item.modelId) && LOOT_MODEL_BY_ID[item.modelId]!.autoSell === true; }
const sectorCategories: Record<string, LootCategory[]> = {
	courtyard: ["tools", "provisions", "valuables"], depot: ["tools", "provisions", "intel"], forest: ["provisions", "medicine", "intel"],
	factory: ["tools", "electronics"], reserve: ["medicine", "intel", "electronics"], bunker: ["electronics", "intel", "valuables"],
};
const branchCategories: Record<ExpeditionBranch, LootCategory[]> = { scavenge: ["tools", "provisions", "valuables"], combat: ["electronics", "medicine"], recon: ["intel", "electronics"] };
export const LOOT_BALANCE_VERSION = 25;
export const LOOT_RARITY_BUDGETS: Readonly<Record<number, Readonly<Record<Rarity, number>>>> = {
	1: { common: .76, uncommon: .24, rare: 0, epic: 0, legendary: 0 },
	2: { common: .50, uncommon: .34, rare: .16, epic: 0, legendary: 0 },
	3: { common: .30, uncommon: .34, rare: .25, epic: .09, legendary: .02 },
};
/** Rarity has its own budget: adding common models cannot dilute the rare tier. */
export function balanceLootPool(pool: readonly { model: LootModel; weight: number }[], depth: number, junkShare = depth === 1 ? .10 : depth === 2 ? .08 : .06, branch: ExpeditionBranch = 'scavenge'): { model: LootModel; weight: number }[] {
	const base = LOOT_RARITY_BUDGETS[depth];
	if (!base || !Object.hasOwn(branchCategories, branch) || !Number.isFinite(junkShare) || junkShare < 0 || junkShare > 1) return [];
	const boost = branch === 'combat' ? 1.35 : branch === 'recon' ? 1.20 : 1;
	const budget = { ...base, rare: base.rare * boost, epic: base.epic * boost, legendary: base.legendary * boost };
	const valid = pool.filter(entry => Number.isFinite(entry.weight) && entry.weight > 0);
	const totals = Object.fromEntries(Object.keys(budget).map(rarity => [rarity, valid.filter(entry => !entry.model.autoSell && entry.model.rarity === rarity).reduce((sum, entry) => sum + entry.weight, 0)])) as Record<Rarity, number>;
	const junkTotal = valid.filter(entry => entry.model.autoSell).reduce((sum, entry) => sum + entry.weight, 0);
	const availableBudget = (Object.keys(budget) as Rarity[]).reduce((sum, rarity) => sum + (totals[rarity] > 0 ? budget[rarity] : 0), 0);
	if (!availableBudget) return junkTotal ? valid.filter(entry => entry.model.autoSell).map(entry => ({ model: entry.model, weight: entry.weight / junkTotal })) : [];
	const usefulShare = junkTotal ? 1 - junkShare : 1;
	return valid.map(entry => ({ model: entry.model, weight: entry.model.autoSell ? entry.weight / junkTotal * junkShare
		: entry.weight / totals[entry.model.rarity] * budget[entry.model.rarity] / availableBudget * usefulShare })).filter(entry => entry.weight > 0);
}
export function getRaidLootPool(mapId: string, branch: ExpeditionBranch, depth: number, catalogVersion = BOSS_SAVE_VERSION): { model: LootModel; weight: number }[] {
	if (!Object.hasOwn(MAP_BY_ID, mapId) || !Object.hasOwn(branchCategories, branch) || !Number.isInteger(depth) || depth < 1 || depth > 3) return [];
	const level = MAP_BY_ID[mapId]!.level;
	const pool = LOOT_MODELS.filter(model => !model.bossId && lootAvailableInCatalog(model.id, catalogVersion) && model.minDepth <= depth && model.minSectorLevel <= level).map(model => ({ model,
		weight: ({ common: 7, uncommon: 4, rare: 1.5, epic: .45, legendary: .15 }[model.rarity])
			* (sectorCategories[mapId]!.includes(model.category) ? 3 : .6) * (branchCategories[branch].includes(model.category) ? 1.8 : 1)
			* (model.rarity === "rare" || model.rarity === "epic" ? 1 + (depth - 1) * .25 + (level - 1) * .08 : 1),
	}));
	return catalogVersion < LOOT_BALANCE_VERSION ? pool : balanceLootPool(pool, depth, undefined, branch);
}
export function rollRaidLoot(mapId: string, branch: ExpeditionBranch, depth: number, random: () => number, catalogVersion = BOSS_SAVE_VERSION): LootModel[] {
	const pool = getRaidLootPool(mapId, branch, depth, catalogVersion); if (!pool.length) return [];
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
export function parseLootItemForVersion(value: unknown, catalogVersion: number): LootItem {
	const parsed = parseLootItem(value);
	if (!lootAvailableInCatalog(parsed.modelId, catalogVersion)) throw new Error("loot-catalog-version");
	return parsed;
}
