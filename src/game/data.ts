export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type WeaponCategory = "pistol" | "shotgun" | "smg" | "rifle" | "sniper";
export type Attachment = "optic" | "magazine" | "stock";
export type BaseRoom = "workshop" | "medbay" | "radio" | "storage";
export type Supplies = {
	ammo: number;
	medicine: number;
	scrap: number;
	intel: number;
};

export interface WeaponDefinition {
	id: string;
	name: string;
	category: WeaponCategory;
	rarity: Rarity;
	power: number;
	reliability: number;
	value: number;
	description: string;
}

export interface RaidMap {
	id: string;
	name: string;
	subtitle: string;
	description: string;
	level: number;
	duration: number;
	danger: number;
	ammoCost: number;
	intelCost: number;
	reward: [number, number];
	xp: number;
	weaponChance: number;
	weapons: string[];
	accent: string;
	position: { x: number; y: number };
}

export interface ScavPersonality {
	id: string;
	name: string;
	description: string;
	survivalBonus: number;
	lootBonus: number;
	speedBonus: number;
}

export type ContractMetric =
	| "raidsWon"
	| "weaponsFound"
	| "moneyEarned"
	| "mapsVisited"
	| "raidsCompleted"
	| "baseLevels"
	| "rareWeaponsFound"
	| "gearLevels"
	| "autoRaidsCompleted"
	| "mapRaidsWon"
	| "productionCycles";
export interface Contract {
	id: string;
	name: string;
	description: string;
	metric: ContractMetric;
	requires?: string[];
	mapId?: string;
	target: number;
	level: number;
	reward: { money: number; xp: number; supplies: Partial<Supplies> };
}

export const RARITY_LABELS: Record<Rarity, string> = {
	common: "Обычное",
	uncommon: "Необычное",
	rare: "Редкое",
	epic: "Эпическое",
	legendary: "Легендарное",
};
export const RARITY_COLORS: Record<Rarity, string> = {
	common: "#b7bca9",
	uncommon: "#87b478",
	rare: "#82aedd",
	epic: "#b29ae8",
	legendary: "#e8c066",
};
export const CATEGORY_LABELS: Record<WeaponCategory, string> = {
	pistol: "Пистолет",
	shotgun: "Дробовик",
	smg: "ПП",
	rifle: "Автомат",
	sniper: "Винтовка",
};
export const ATTACHMENT_LABELS: Record<Attachment, string> = {
	optic: "Прицел",
	magazine: "Магазин",
	stock: "Приклад",
};
export const BASE_ROOM_LABELS: Record<BaseRoom, string> = {
	workshop: "Мастерская",
	medbay: "Медблок",
	radio: "Радиорубка",
	storage: "Склад",
};

export const WEAPONS: WeaponDefinition[] = [
	{
		id: "pm",
		name: "ПМ «Старик»",
		category: "pistol",
		rarity: "common",
		power: 15,
		reliability: 82,
		value: 70,
		description: "Потёртый, но честный. Последний довод любого дикого.",
	},
	{
		id: "tt",
		name: "ТТ «Тульский»",
		category: "pistol",
		rarity: "common",
		power: 20,
		reliability: 73,
		value: 90,
		description: "Складской ТТ с характером и тугой пружиной.",
	},
	{
		id: "toz",
		name: "ТОЗ-106 «Кулак»",
		category: "shotgun",
		rarity: "common",
		power: 24,
		reliability: 68,
		value: 110,
		description: "Короткий ствол для коротких разговоров.",
	},
	{
		id: "mp133",
		name: "МР-133 «Заслон»",
		category: "shotgun",
		rarity: "uncommon",
		power: 32,
		reliability: 80,
		value: 185,
		description: "Помповый дробовик. Его звук знают в каждом дворе.",
	},
	{
		id: "pp91",
		name: "Кедр «Шершень»",
		category: "smg",
		rarity: "uncommon",
		power: 34,
		reliability: 78,
		value: 210,
		description: "Компактный ПП для тех, кто ходит налегке.",
	},
	{
		id: "sks",
		name: "СКС «Лесник»",
		category: "rifle",
		rarity: "uncommon",
		power: 38,
		reliability: 87,
		value: 245,
		description: "Дерево, сталь и десяток причин держаться подальше.",
	},
	{
		id: "ak74",
		name: "АК-74 «Рабочий»",
		category: "rifle",
		rarity: "rare",
		power: 47,
		reliability: 89,
		value: 390,
		description: "Универсальный автомат. Основа хорошего отряда.",
	},
	{
		id: "saiga",
		name: "Сайга-12 «Молот»",
		category: "shotgun",
		rarity: "rare",
		power: 49,
		reliability: 77,
		value: 420,
		description: "Каждый патрон звучит как закрытая дверь.",
	},
	{
		id: "vityaz",
		name: "Витязь «Пульс»",
		category: "smg",
		rarity: "rare",
		power: 44,
		reliability: 90,
		value: 360,
		description: "Собран, сбалансирован и готов к тесным коридорам.",
	},
	{
		id: "mosin",
		name: "Мосинка «Дед»",
		category: "sniper",
		rarity: "rare",
		power: 52,
		reliability: 84,
		value: 460,
		description: "Возраст — всего лишь цифра. Особенно на дистанции.",
	},
	{
		id: "akm",
		name: "АКМ «Гром»",
		category: "rifle",
		rarity: "epic",
		power: 61,
		reliability: 86,
		value: 690,
		description: "Тяжёлый калибр, уверенный голос.",
	},
	{
		id: "vss",
		name: "ВСС «Тень»",
		category: "sniper",
		rarity: "epic",
		power: 66,
		reliability: 82,
		value: 850,
		description: "Тихая работа для опытного дикого.",
	},
	{
		id: "rpk",
		name: "РПК «Сторож»",
		category: "rifle",
		rarity: "epic",
		power: 69,
		reliability: 88,
		value: 930,
		description: "Когда нужно удержать целую улицу.",
	},
	{
		id: "svd",
		name: "СВД «Горизонт»",
		category: "sniper",
		rarity: "epic",
		power: 72,
		reliability: 91,
		value: 1060,
		description: "Качественная оптика и длинная история.",
	},
	{
		id: "asval",
		name: "АС ВАЛ «Призрак»",
		category: "rifle",
		rarity: "legendary",
		power: 83,
		reliability: 92,
		value: 1700,
		description: "Из закрытого ящика с нетронутой пломбой.",
	},
	{
		id: "pkp",
		name: "ПКП «Печенег»",
		category: "rifle",
		rarity: "legendary",
		power: 92,
		reliability: 94,
		value: 2200,
		description: "Главный аргумент арсенала. Редкая удача для базы.",
	},
	{
		id: "m4a1", name: "M4A1 «Карабин»", category: "rifle", rarity: "rare",
		power: 49, reliability: 85, value: 510,
		description: "Лёгкая платформа AR под 5,56: верхняя планка и сменные узлы. Удобная сборка требует обслуживания.",
	},
	{
		id: "hk416", name: "HK416 «Оплот»", category: "rifle", rarity: "epic",
		power: 57, reliability: 91, value: 880,
		description: "Прочная 5,56-мм коробка семейства AR. Надёжнее лёгкого карабина, но тяжелее и дороже.",
	},
	{
		id: "p90", name: "P90 «Улей»", category: "smg", rarity: "epic",
		power: 43, reliability: 86, value: 760,
		description: "Компактная 5,7-мм платформа с горизонтальным магазином над корпусом. Для тесных проходов, а не дальнего дозора.",
	},
	{
		id: "mp7", name: "MP7 «Игла»", category: "smg", rarity: "rare",
		power: 40, reliability: 88, value: 610,
		description: "Малый ПП под 4,6 с магазином в рукояти и выдвижной опорой. Лёгкий выход с частыми перезарядками.",
	},
	{
		id: "ump45", name: "UMP-45 «Порог»", category: "smg", rarity: "uncommon",
		power: 37, reliability: 84, value: 310,
		description: "Простой ПП под .45 с прямым коробчатым магазином. Ближнее прикрытие ценой слабой работы на дистанции.",
	},
	{
		id: "m1911", name: "M1911 «Наследник»", category: "pistol", rarity: "uncommon",
		power: 25, reliability: 79, value: 175,
		description: "Тяжёлый пистолет под .45: затвор, короткий ствол и магазин в рукояти. Планка требует отдельного мостового крепления.",
	},
	{
		id: "mcx", name: "MCX «Сумрак»", category: "rifle", rarity: "epic",
		power: 58, reliability: 84, value: 960,
		description: "Короткий карабин под .300 с отдельной модульной платформой. Дозвуковые патроны раскрываются с установленным глушителем.",
	},
	{
		id: "scarh", name: "SCAR-H «Рубеж»", category: "rifle", rarity: "epic",
		power: 73, reliability: 87, value: 1350,
		description: "Тяжёлая 7,62×51-мм платформа для открытого рубежа. Хорошая опора оплачивается весом и запасом патронов.",
	},
	{
		id: "trg42", name: "TRG-42 «Дозор»", category: "sniper", rarity: "legendary",
		power: 88, reliability: 89, value: 2100,
		description: "Болтовая винтовка под .338: дальний выстрел, тяжёлая сборка и дорогой запас. В тесноте уступает компактному ПП.",
	},
	{
		id: "g36", name: "G36 «Вектор»", category: "rifle", rarity: "rare",
		power: 51, reliability: 88, value: 580,
		description: "Полимерный 5,56-мм автомат с высокой линией прицела. Лёгкое цевьё, прозрачный магазин и складная задняя опора меняются отдельно.",
	},
	{
		id: "aug", name: "AUG «Баланс»", category: "rifle", rarity: "epic",
		power: 54, reliability: 87, value: 820,
		description: "5,56-мм буллпап: длинный ствол в компактном корпусе. Магазин позади рукояти; задняя опора — затыльник, а не складной приклад.",
	},
	{
		id: "fal", name: "FAL «Рубежник»", category: "rifle", rarity: "rare",
		power: 65, reliability: 83, value: 720,
		description: "Тяжёлая классическая платформа под 7,62×51. Уверенный средний рубеж ценой отдачи и веса; оптика требует кронштейна коробки.",
	},
	{
		id: "sr25", name: "SR-25 «Наблюдатель»", category: "sniper", rarity: "epic",
		power: 76, reliability: 87, value: 1540,
		description: "Самозарядная винтовка семейства AR-10 под 7,62×51. Собственная крупная коробка: модули лёгкой AR под 5,56 не подходят.",
	},
	{
		id: "vector", name: "Vector «Импульс»", category: "smg", rarity: "epic",
		power: 46, reliability: 80, value: 910,
		description: "Компактный ПП под .45 с низким корпусом и магазином перед спусковой рукоятью. Хорош в тесноте, но быстро тратит запас.",
	},
	{
		id: "fiveseven", name: "Five-seveN «Искра»", category: "pistol", rarity: "rare",
		power: 29, reliability: 86, value: 430,
		description: "Лёгкий пистолет под 5,7×28 с прямым магазином в рукояти. Отдельная мостовая планка нужна для верхнего прицела.",
	},
	{
		id: "sr2", name: "СР-2 «Вереск»", category: "smg", rarity: "rare",
		power: 45, reliability: 85, value: 650,
		description: "Компактный 9×21-мм ПП с магазином в рукояти. Быстрое ближнее прикрытие; дорогой боеприпас требует продуманного запаса.",
	},
	{
		id: "sr1", name: "СР-1 «Гюрза»", category: "pistol", rarity: "rare",
		power: 33, reliability: 83, value: 370,
		description: "Тяжёлый пистолет под 9×21. Узкая самостоятельная платформа с магазином в рукояти и отдельным мостом для прицела.",
	},
	{
		id: "glock20", name: "Glock 20 «Напор»", category: "pistol", rarity: "uncommon",
		power: 31, reliability: 88, value: 290,
		description: "Крупный полимерный пистолет под 10 мм. Лёгкая рамка, заметная отдача и сменные модули только своего калибра.",
	},
	{
		id: "ash12", name: "АШ-12 «Разлом»", category: "rifle", rarity: "legendary",
		power: 86, reliability: 79, value: 1920,
		description: "Тяжёлый буллпап под 12,7×55 для ближнего рубежа. Магазин за рукоятью; короткая сборка оплачивается весом, отдачей и боезапасом.",
	},
	{
		id: "vpo209", name: "ВПО-209 «Промысел»", category: "rifle", rarity: "uncommon",
		power: 43, reliability: 81, value: 340,
		description: "Самозарядный карабин под .366 ТКМ с классической компоновкой. Внешнее сходство с АК не делает ствол и магазин взаимозаменяемыми.",
	},
	{
		id: "svdk", name: "СВДК «Высота»", category: "sniper", rarity: "epic",
		power: 82, reliability: 86, value: 1720,
		description: "Тяжёлая самозарядная винтовка под 9,3×64. Отдельная коробка и магазин; дальняя опора ценой веса и дорогого выстрела.",
	},
	{
		id: "awm", name: "AWM «Магнум»", category: "sniper", rarity: "legendary",
		power: 90, reliability: 88, value: 2290,
		description: "Болтовая винтовка под .300 Win Mag с длинной коробкой и регулируемой опорой. Дальний дозор требует тяжёлого запаса и устойчивой позиции.",
	},
	{
		id: "m870", name: "M870 «Привратник»", category: "shotgun", rarity: "uncommon",
		power: 35, reliability: 88, value: 260,
		description: "Помповый дробовик 12-го калибра с подствольной трубкой. Сменные трубки подачи и подвижные цевья сохраняют помповую компоновку.",
	},
];

export const MAPS: RaidMap[] = [
	{
		id: "courtyard",
		name: "Дворы",
		subtitle: "Знакомая территория",
		description: "Гаражи, подъезды и тайники местных. Лучший первый выход.",
		level: 1,
		duration: 35,
		danger: 0.19,
		ammoCost: 2,
		intelCost: 0,
		reward: [70, 125],
		xp: 32,
		weaponChance: 0.76,
		weapons: ["pm", "tt", "toz", "mp133", "pp91", "sks"],
		accent: "#a8b782",
		position: { x: 0.22, y: 0.67 },
	},
	{
		id: "depot",
		name: "Депо",
		subtitle: "Ржавые пути",
		description: "В заброшенных вагонах встречаются патроны и армейские ящики.",
		level: 2,
		duration: 65,
		danger: 0.3,
		ammoCost: 3,
		intelCost: 0,
		reward: [125, 205],
		xp: 48,
		weaponChance: 0.81,
		weapons: ["mp133", "pp91", "sks", "ak74", "vityaz", "ump45", "m1911", "glock20", "m870"],
		accent: "#d3ac72",
		position: { x: 0.44, y: 0.76 },
	},
	{
		id: "forest",
		name: "Лесополоса",
		subtitle: "Чужие следы",
		description: "Тихие тропы, брошенные лагеря и редкие винтовки.",
		level: 3,
		duration: 95,
		danger: 0.4,
		ammoCost: 4,
		intelCost: 1,
		reward: [185, 310],
		xp: 67,
		weaponChance: 0.84,
		weapons: ["sks", "mp133", "mosin", "ak74", "vss", "m4a1", "g36", "vpo209", "fal"],
		accent: "#91b187",
		position: { x: 0.18, y: 0.32 },
	},
	{
		id: "factory",
		name: "Завод",
		subtitle: "Шумный сектор",
		description:
			"Узкие проходы. За тяжёлыми дверями прячется серьёзный арсенал.",
		level: 5,
		duration: 130,
		danger: 0.52,
		ammoCost: 5,
		intelCost: 1,
		reward: [270, 460],
		xp: 92,
		weaponChance: 0.88,
		weapons: ["saiga", "vityaz", "ak74", "akm", "rpk", "mp7", "p90", "m4a1", "aug", "vector", "fiveseven", "sr2", "sr1", "m870"],
		accent: "#c5957b",
		position: { x: 0.61, y: 0.47 },
	},
	{
		id: "reserve",
		name: "Резерв",
		subtitle: "Военный склад",
		description: "Гарнизон ушёл, охрана осталась. Требуется слаженный боец.",
		level: 7,
		duration: 175,
		danger: 0.66,
		ammoCost: 7,
		intelCost: 2,
		reward: [390, 680],
		xp: 127,
		weaponChance: 0.91,
		weapons: ["akm", "rpk", "svd", "vss", "asval", "hk416", "mcx", "scarh", "trg42", "g36", "aug", "fal", "sr25", "sr2", "ash12", "svdk", "awm"],
		accent: "#9aa0cf",
		position: { x: 0.73, y: 0.23 },
	},
	{
		id: "bunker",
		name: "Бункер-7",
		subtitle: "Закрытая зона",
		description:
			"Старые координаты ведут под землю. Только лучшие возвращаются с трофеями.",
		level: 9,
		duration: 220,
		danger: 0.77,
		ammoCost: 9,
		intelCost: 3,
		reward: [610, 1000],
		xp: 165,
		weaponChance: 1,
		weapons: ["rpk", "svd", "vss", "asval", "pkp", "p90", "mp7", "hk416", "mcx", "scarh", "trg42", "vector", "sr1", "fiveseven", "sr25", "ash12", "svdk", "awm"],
		accent: "#d1bc7c",
		position: { x: 0.87, y: 0.63 },
	},
];

export const PERSONALITIES: ScavPersonality[] = [
	{
		id: "careful",
		name: "Осторожный",
		description: "Возвращается чаще, но не забирает каждый ящик.",
		survivalBonus: 0.06,
		lootBonus: -0.03,
		speedBonus: 0,
	},
	{
		id: "collector",
		name: "Барахольщик",
		description: "Помнит каждый тайник и приносит больше добра.",
		survivalBonus: -0.02,
		lootBonus: 0.16,
		speedBonus: 0,
	},
	{
		id: "runner",
		name: "Скороход",
		description: "Выбирает короткие маршруты и не задерживается.",
		survivalBonus: 0.01,
		lootBonus: 0,
		speedBonus: 0.15,
	},
	{
		id: "veteran",
		name: "Бывалый",
		description: "Сохраняет хладнокровие в сложном секторе.",
		survivalBonus: 0.04,
		lootBonus: 0.04,
		speedBonus: 0.04,
	},
];

export const SCAV_NAMES = [
	"Борода",
	"Рыжий",
	"Шустрый",
	"Седой",
	"Гвоздь",
	"Филин",
	"Крот",
	"Кедр",
	"Барс",
	"Сапёр",
	"Жук",
	"Туман",
	"Немой",
	"Леший",
	"Клык",
	"Шило",
];

export const CONTRACTS: Contract[] = [
	{
		id: "first-return",
		name: "Первый выход",
		description: "Верни одного дикого с успешного рейда.",
		metric: "raidsWon",
		target: 1,
		level: 1,
		reward: {
			money: 220,
			xp: 45,
			supplies: { ammo: 8, medicine: 2, intel: 1 },
		},
	},
	{
		id: "working-shelter",
		name: "Убежище в деле",
		description: "Назначь работника и доставь на склад первую партию припасов или оружейный модуль. Оплаченный заказ должен завершиться.",
		metric: "productionCycles",
		target: 1,
		level: 1,
		requires: ["first-return"],
		reward: { money: 90, xp: 35, supplies: { scrap: 2 } },
	},
	{
		id: "arms-dealer",
		requires: ["first-return"],
		name: "Поставщик",
		description: "Долгосрочная коллекция: эвакуируй 5 трофейных пушек. Отдельные оружейные модули не считаются.",
		metric: "weaponsFound",
		target: 5,
		level: 1,
		reward: { money: 460, xp: 85, supplies: { scrap: 12, intel: 2 } },
	},
	{
		id: "steady-returns",
		requires: ["first-return"],
		name: "Свои люди",
		description: "Успешно заверши 8 рейдов.",
		metric: "raidsWon",
		target: 8,
		level: 2,
		reward: { money: 650, xp: 120, supplies: { ammo: 18, medicine: 5 } },
	},
	{
		id: "builder",
		requires: ["gear-ready"],
		name: "Хозяйский подход",
		description: "Подними общий уровень помещений до 8.",
		metric: "baseLevels",
		target: 8,
		level: 2,
		reward: { money: 520, xp: 95, supplies: { scrap: 20, intel: 3 } },
	},
	{
		id: "cartographer",
		requires: ["depot-route"],
		name: "Тропы и тайники",
		description: "Посети 4 разных сектора.",
		metric: "mapsVisited",
		target: 4,
		level: 3,
		reward: { money: 900, xp: 180, supplies: { intel: 7, ammo: 24 } },
	},
	{
		id: "rare-cargo",
		requires: ["arms-dealer"],
		name: "Ценный груз",
		description: "Найди 6 редких или лучших пушек.",
		metric: "rareWeaponsFound",
		target: 6,
		level: 4,
		reward: { money: 1400, xp: 240, supplies: { scrap: 28, medicine: 8 } },
	},
	{
		id: "business",
		requires: ["builder"],
		name: "Дело Прапора",
		description: "Заработай 6000 рублей в рейдах и мастерской.",
		metric: "moneyEarned",
		target: 6000,
		level: 4,
		reward: { money: 1250, xp: 210, supplies: { ammo: 35, intel: 6 } },
	},
	{
		id: "veteran-command",
		requires: ["steady-returns"],
		name: "Твёрдая рука",
		description: "Заверши 40 рейдов, даже если не все были удачными.",
		metric: "raidsCompleted",
		target: 40,
		level: 6,
		reward: { money: 2200, xp: 420, supplies: { medicine: 12, scrap: 35 } },
	},
	{
		id: "gear-ready", name: "Подготовка отряда",
		description: "Выдай бойцам 2 предмета брони или рюкзака либо повысь личную подготовку на 2 уровня. Можно сочетать оба способа.",
		metric: "gearLevels", target: 2, level: 1, requires: ["first-return"],
		reward: { money: 240, xp: 50, supplies: { scrap: 6, medicine: 2 } },
	},
	{
		id: "auto-route", name: "Постоянный маршрут",
		description: "Заверши 5 рейдов по автоматическому приказу.",
		metric: "autoRaidsCompleted", target: 5, level: 2, requires: ["gear-ready"],
		reward: { money: 480, xp: 90, supplies: { ammo: 16, scrap: 10 } },
	},
	{
		id: "depot-route", name: "Снабжение через депо",
		description: "Успешно вернись из Депо 3 раза.",
		metric: "mapRaidsWon", mapId: "depot", target: 3, level: 2, requires: ["first-return"],
		reward: { money: 420, xp: 80, supplies: { intel: 3, ammo: 12 } },
	},
	{
		id: "forest-line", name: "Тихая линия",
		description: "Успешно вернись из Лесополосы 4 раза.",
		metric: "mapRaidsWon", mapId: "forest", target: 4, level: 3,
		requires: ["depot-route"],
		reward: { money: 850, xp: 150, supplies: { intel: 5, medicine: 5 } },
	},
	{
		id: "factory-route", name: "Заводская линия",
		description: "Успешно вернись с Завода 3 раза. Подготовь отряд к более опасному сектору и наладь снабжение.",
		metric: "mapRaidsWon", mapId: "factory", target: 3, level: 5,
		requires: ["forest-line"],
		reward: { money: 700, xp: 120, supplies: { ammo: 16, intel: 3 } },
	},
	{
		id: "reserve-route", name: "Военный резерв",
		description: "Успешно вернись из Резерва 3 раза. Сохраняй ценные сборки и эвакуируй груз вовремя.",
		metric: "mapRaidsWon", mapId: "reserve", target: 3, level: 7,
		requires: ["factory-route"],
		reward: { money: 1000, xp: 180, supplies: { scrap: 12, medicine: 4 } },
	},
	{
		id: "bunker-route", name: "Связь с Бункером-7",
		description: "Успешно вернись из Бункера-7. Даже один вынесенный груз завершает линию освоения секторов.",
		metric: "mapRaidsWon", mapId: "bunker", target: 1, level: 9,
		requires: ["reserve-route"],
		reward: { money: 1400, xp: 250, supplies: { intel: 4, medicine: 6 } },
	},
];

export const WEAPON_BY_ID: Readonly<Record<string, WeaponDefinition>> =
	Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, weapon]));
export const MAP_BY_ID: Readonly<Record<string, RaidMap>> = Object.fromEntries(
	MAPS.map((map) => [map.id, map])
);
export const PERSONALITY_BY_ID: Readonly<Record<string, ScavPersonality>> =
	Object.fromEntries(
		PERSONALITIES.map((personality) => [personality.id, personality])
	);
