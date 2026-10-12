export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type WeaponCategory = 'pistol' | 'shotgun' | 'smg' | 'rifle' | 'sniper';
export type Attachment = 'optic' | 'magazine' | 'stock';
export type BaseRoom = 'workshop' | 'medbay' | 'radio' | 'storage';
export type Supplies = { ammo: number; medicine: number; scrap: number; intel: number };

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

export type ContractMetric = 'raidsWon' | 'weaponsFound' | 'moneyEarned' | 'mapsVisited' | 'raidsCompleted' | 'baseLevels' | 'rareWeaponsFound';
export interface Contract {
  id: string;
  name: string;
  description: string;
  metric: ContractMetric;
  target: number;
  level: number;
  reward: { money: number; xp: number; supplies: Partial<Supplies> };
}

export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Обычное', uncommon: 'Необычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное',
};
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#b7bca9', uncommon: '#87b478', rare: '#82aedd', epic: '#b29ae8', legendary: '#e8c066',
};
export const CATEGORY_LABELS: Record<WeaponCategory, string> = {
  pistol: 'Пистолет', shotgun: 'Дробовик', smg: 'ПП', rifle: 'Автомат', sniper: 'Винтовка',
};
export const ATTACHMENT_LABELS: Record<Attachment, string> = {
  optic: 'Прицел', magazine: 'Магазин', stock: 'Приклад',
};
export const BASE_ROOM_LABELS: Record<BaseRoom, string> = {
  workshop: 'Мастерская', medbay: 'Медблок', radio: 'Радиорубка', storage: 'Арсенал',
};

export const WEAPONS: WeaponDefinition[] = [
  { id: 'pm', name: 'ПМ «Старик»', category: 'pistol', rarity: 'common', power: 15, reliability: 82, value: 70, description: 'Потёртый, но честный. Последний довод любого дикого.' },
  { id: 'tt', name: 'ТТ «Тульский»', category: 'pistol', rarity: 'common', power: 20, reliability: 73, value: 90, description: 'Складской ТТ с характером и тугой пружиной.' },
  { id: 'toz', name: 'ТОЗ-106 «Кулак»', category: 'shotgun', rarity: 'common', power: 24, reliability: 68, value: 110, description: 'Короткий ствол для коротких разговоров.' },
  { id: 'mp133', name: 'МР-133 «Заслон»', category: 'shotgun', rarity: 'uncommon', power: 32, reliability: 80, value: 185, description: 'Помповый дробовик. Его звук знают в каждом дворе.' },
  { id: 'pp91', name: 'Кедр «Шершень»', category: 'smg', rarity: 'uncommon', power: 34, reliability: 78, value: 210, description: 'Компактный ПП для тех, кто ходит налегке.' },
  { id: 'sks', name: 'СКС «Лесник»', category: 'rifle', rarity: 'uncommon', power: 38, reliability: 87, value: 245, description: 'Дерево, сталь и десяток причин держаться подальше.' },
  { id: 'ak74', name: 'АК-74 «Рабочий»', category: 'rifle', rarity: 'rare', power: 47, reliability: 89, value: 390, description: 'Универсальный автомат. Основа хорошего отряда.' },
  { id: 'saiga', name: 'Сайга-12 «Молот»', category: 'shotgun', rarity: 'rare', power: 49, reliability: 77, value: 420, description: 'Каждый патрон звучит как закрытая дверь.' },
  { id: 'vityaz', name: 'Витязь «Пульс»', category: 'smg', rarity: 'rare', power: 44, reliability: 90, value: 360, description: 'Собран, сбалансирован и готов к тесным коридорам.' },
  { id: 'mosin', name: 'Мосинка «Дед»', category: 'sniper', rarity: 'rare', power: 52, reliability: 84, value: 460, description: 'Возраст — всего лишь цифра. Особенно на дистанции.' },
  { id: 'akm', name: 'АКМ «Гром»', category: 'rifle', rarity: 'epic', power: 61, reliability: 86, value: 690, description: 'Тяжёлый калибр, уверенный голос.' },
  { id: 'vss', name: 'ВСС «Тень»', category: 'sniper', rarity: 'epic', power: 66, reliability: 82, value: 850, description: 'Тихая работа для опытного дикого.' },
  { id: 'rpk', name: 'РПК «Сторож»', category: 'rifle', rarity: 'epic', power: 69, reliability: 88, value: 930, description: 'Когда нужно удержать целую улицу.' },
  { id: 'svd', name: 'СВД «Горизонт»', category: 'sniper', rarity: 'epic', power: 72, reliability: 91, value: 1060, description: 'Качественная оптика и длинная история.' },
  { id: 'asval', name: 'АС ВАЛ «Призрак»', category: 'rifle', rarity: 'legendary', power: 83, reliability: 92, value: 1700, description: 'Из закрытого ящика с нетронутой пломбой.' },
  { id: 'pkp', name: 'ПКП «Печенег»', category: 'rifle', rarity: 'legendary', power: 92, reliability: 94, value: 2200, description: 'Главный аргумент арсенала. Редкая удача для базы.' },
];

export const MAPS: RaidMap[] = [
  { id: 'courtyard', name: 'Дворы', subtitle: 'Знакомая территория', description: 'Гаражи, подъезды и тайники местных. Лучший первый выход.', level: 1, duration: 35, danger: 0.19, ammoCost: 2, intelCost: 0, reward: [70, 125], xp: 32, weaponChance: 0.76, weapons: ['pm', 'tt', 'toz', 'mp133', 'pp91', 'sks'], accent: '#a8b782', position: { x: 0.22, y: 0.67 } },
  { id: 'depot', name: 'Депо', subtitle: 'Ржавые пути', description: 'В заброшенных вагонах встречаются патроны и армейские ящики.', level: 2, duration: 65, danger: 0.30, ammoCost: 3, intelCost: 0, reward: [125, 205], xp: 48, weaponChance: 0.81, weapons: ['mp133', 'pp91', 'sks', 'ak74', 'vityaz'], accent: '#d3ac72', position: { x: 0.44, y: 0.76 } },
  { id: 'forest', name: 'Лесополоса', subtitle: 'Чужие следы', description: 'Тихие тропы, брошенные лагеря и редкие винтовки.', level: 3, duration: 95, danger: 0.40, ammoCost: 4, intelCost: 1, reward: [185, 310], xp: 67, weaponChance: 0.84, weapons: ['sks', 'mp133', 'mosin', 'ak74', 'vss'], accent: '#91b187', position: { x: 0.18, y: 0.32 } },
  { id: 'factory', name: 'Завод', subtitle: 'Шумный сектор', description: 'Узкие проходы. За тяжёлыми дверями прячется серьёзный арсенал.', level: 5, duration: 130, danger: 0.52, ammoCost: 5, intelCost: 1, reward: [270, 460], xp: 92, weaponChance: 0.88, weapons: ['saiga', 'vityaz', 'ak74', 'akm', 'rpk'], accent: '#c5957b', position: { x: 0.61, y: 0.47 } },
  { id: 'reserve', name: 'Резерв', subtitle: 'Военный склад', description: 'Гарнизон ушёл, охрана осталась. Требуется слаженный боец.', level: 7, duration: 175, danger: 0.66, ammoCost: 7, intelCost: 2, reward: [390, 680], xp: 127, weaponChance: 0.91, weapons: ['akm', 'rpk', 'svd', 'vss', 'asval'], accent: '#9aa0cf', position: { x: 0.73, y: 0.23 } },
  { id: 'bunker', name: 'Бункер-7', subtitle: 'Закрытая зона', description: 'Старые координаты ведут под землю. Только лучшие возвращаются с трофеями.', level: 9, duration: 220, danger: 0.77, ammoCost: 9, intelCost: 3, reward: [610, 1000], xp: 165, weaponChance: 1, weapons: ['rpk', 'svd', 'vss', 'asval', 'pkp'], accent: '#d1bc7c', position: { x: 0.87, y: 0.63 } },
];

export const PERSONALITIES: ScavPersonality[] = [
  { id: 'careful', name: 'Осторожный', description: 'Возвращается чаще, но не забирает каждый ящик.', survivalBonus: 0.06, lootBonus: -0.03, speedBonus: 0 },
  { id: 'collector', name: 'Барахольщик', description: 'Помнит каждый тайник и приносит больше добра.', survivalBonus: -0.02, lootBonus: 0.16, speedBonus: 0 },
  { id: 'runner', name: 'Скороход', description: 'Выбирает короткие маршруты и не задерживается.', survivalBonus: 0.01, lootBonus: 0, speedBonus: 0.15 },
  { id: 'veteran', name: 'Бывалый', description: 'Сохраняет хладнокровие в сложном секторе.', survivalBonus: 0.04, lootBonus: 0.04, speedBonus: 0.04 },
];

export const SCAV_NAMES = ['Борода', 'Рыжий', 'Шустрый', 'Седой', 'Гвоздь', 'Филин', 'Крот', 'Кедр', 'Барс', 'Сапёр', 'Жук', 'Туман', 'Немой', 'Леший', 'Клык', 'Шило'];

export const CONTRACTS: Contract[] = [
  { id: 'first-return', name: 'Первый выход', description: 'Верни одного дикого с успешного рейда.', metric: 'raidsWon', target: 1, level: 1, reward: { money: 220, xp: 45, supplies: { ammo: 8, medicine: 2, intel: 1 } } },
  { id: 'arms-dealer', name: 'Поставщик', description: 'Найди в рейдах 5 единиц оружия.', metric: 'weaponsFound', target: 5, level: 1, reward: { money: 460, xp: 85, supplies: { scrap: 12, intel: 2 } } },
  { id: 'steady-returns', name: 'Свои люди', description: 'Успешно заверши 8 рейдов.', metric: 'raidsWon', target: 8, level: 2, reward: { money: 650, xp: 120, supplies: { ammo: 18, medicine: 5 } } },
  { id: 'builder', name: 'Хозяйский подход', description: 'Подними общий уровень помещений до 8.', metric: 'baseLevels', target: 8, level: 2, reward: { money: 520, xp: 95, supplies: { scrap: 20, intel: 3 } } },
  { id: 'cartographer', name: 'Тропы и тайники', description: 'Посети 4 разных сектора.', metric: 'mapsVisited', target: 4, level: 3, reward: { money: 900, xp: 180, supplies: { intel: 7, ammo: 24 } } },
  { id: 'rare-cargo', name: 'Ценный груз', description: 'Найди 6 редких или лучших пушек.', metric: 'rareWeaponsFound', target: 6, level: 4, reward: { money: 1400, xp: 240, supplies: { scrap: 28, medicine: 8 } } },
  { id: 'business', name: 'Дело Прапора', description: 'Заработай 6000 рублей в рейдах и мастерской.', metric: 'moneyEarned', target: 6000, level: 4, reward: { money: 1250, xp: 210, supplies: { ammo: 35, intel: 6 } } },
  { id: 'veteran-command', name: 'Твёрдая рука', description: 'Заверши 40 рейдов, даже если не все были удачными.', metric: 'raidsCompleted', target: 40, level: 6, reward: { money: 2200, xp: 420, supplies: { medicine: 12, scrap: 35 } } },
];

export const WEAPON_BY_ID: Readonly<Record<string, WeaponDefinition>> = Object.fromEntries(WEAPONS.map((weapon) => [weapon.id, weapon]));
export const MAP_BY_ID: Readonly<Record<string, RaidMap>> = Object.fromEntries(MAPS.map((map) => [map.id, map]));
export const PERSONALITY_BY_ID: Readonly<Record<string, ScavPersonality>> = Object.fromEntries(PERSONALITIES.map((personality) => [personality.id, personality]));
