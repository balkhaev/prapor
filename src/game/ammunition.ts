import type { WeaponInstance } from "./engine";
import { getResolvedModuleMounts, MODULE_BY_ID, RECEIVER_INFO, type ModuleInstance, type ModuleModel } from "./modules";
import type { RaidTactic } from "./operations";
import type { ExpeditionBranch } from "./systems";
import { WEAPON_ENVIRONMENTS } from "./weapon-mechanics";

export type AmmoType = "standard" | "piercing" | "expanding" | "precision" | "subsonic" | "tracer" | "highpressure" | "surplus";
export const AMMO_TYPES: readonly AmmoType[] = ["standard", "piercing", "expanding", "precision", "subsonic", "tracer", "highpressure", "surplus"];
export const AMMO_TYPE_LABELS: Record<AmmoType, string> = {
	standard: "Штатные", piercing: "Бронебойные", expanding: "Экспансивные", precision: "Повышенной точности",
	subsonic: "Дозвуковые", tracer: "Трассирующие", highpressure: "Усиленные", surplus: "Складские",
};
export interface AmmoModel {
	id: string; caliber: string; type: AmmoType; label: string; description: string;
	/** Package artwork and quantity identify a product, not a separate inventory. */
	packCode: string; packRounds: number;
	/** Fictional game indices. Damage is a round's impact, not weapon firepower. */
	damage: number; penetration: number;
	/** Armour disruption during an exchange; helps subsequent hits after a stopped round. */
	armorDamage: number;
	/** Units charged from the shared ammunition supply, never a damage multiplier. */
	ammoMultiplier: number; wearMultiplier: number;
}
export interface EnemyArmorProfile { armorClass: number; armoredShare: number; label: string }
export interface AmmoEffect {
	model: AmmoModel; enemy: EnemyArmorProfile;
	/** Chance for the first hit to penetrate the armoured share of the encounter. */
	penetrationChance: number;
	/** Expected impact across both unarmoured and armoured targets. */
	effectiveDamage: number;
	/** Probability points for the raid quote; not the final survival probability. */
	bonus: number;
	/** Encounter impact changes injury risk even when the survival quote is capped. */
	injuryMultiplier: number;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Deliberately game-scale values. Low-calibre penetrators remain limited against
// heavy plates; powerful rifle rounds keep their identity even on a cheap loadout.
const CALIBER_BALLISTICS: Record<string, { damage: number; penetration: number; piercingGain: number; label: string }> = {
	"9x18": { damage: 28, penetration: 8, piercingGain: 28, label: "9×18 мм" },
	"7.62x25": { damage: 32, penetration: 18, piercingGain: 26, label: "7,62×25 мм" },
	"20g": { damage: 58, penetration: 10, piercingGain: 28, label: "20 калибр" },
	"12g": { damage: 70, penetration: 14, piercingGain: 26, label: "12 калибр" },
	"7.62x39": { damage: 46, penetration: 30, piercingGain: 22, label: "7,62×39 мм" },
	"5.45x39": { damage: 40, penetration: 32, piercingGain: 22, label: "5,45×39 мм" },
	"9x19": { damage: 30, penetration: 13, piercingGain: 28, label: "9×19 мм" },
	"7.62x54": { damage: 62, penetration: 45, piercingGain: 22, label: "7,62×54 мм" },
	"9x39": { damage: 50, penetration: 40, piercingGain: 22, label: "9×39 мм" },
	"5.56x45": { damage: 42, penetration: 34, piercingGain: 22, label: "5,56×45 мм" },
	"5.7x28": { damage: 26, penetration: 26, piercingGain: 26, label: "5,7×28 мм" },
	"4.6x30": { damage: 24, penetration: 28, piercingGain: 24, label: "4,6×30 мм" },
	".45acp": { damage: 39, penetration: 10, piercingGain: 28, label: ".45 ACP" },
	".300blk": { damage: 51, penetration: 29, piercingGain: 24, label: ".300 BLK" },
	"7.62x51": { damage: 64, penetration: 43, piercingGain: 22, label: "7,62×51 мм" },
	".338lapua": { damage: 88, penetration: 48, piercingGain: 22, label: ".338 Lapua" },
};
const AMMO_SPECS: Record<AmmoType, { damage: number; armorDamage: number; ammoMultiplier: number; wearMultiplier: number; description: string }> = {
	standard: { damage: 1, armorDamage: .3, ammoMultiplier: 1, wearMultiplier: 1,
		description: "Самый доступный заряд. Средний урон и пробитие; тяжёлая броня останавливает большую часть попаданий." },
	piercing: { damage: .82, armorDamage: .8, ammoMultiplier: 1.65, wearMultiplier: 1.12,
		description: "Твёрдый сердечник лучше пробивает и ослабляет броню, но наносит меньше урона незащищённым целям. Дороже и сильнее изнашивает оружие." },
	expanding: { damage: 1.4, armorDamage: .1, ammoMultiplier: 1.15, wearMultiplier: 1,
		description: "Высокий урон по незащищённым целям ценой слабого пробития. Против тяжёлой брони преимущество теряется." },
	precision: { damage: .95, armorDamage: .35, ammoMultiplier: 1.2, wearMultiplier: 1.03,
		description: "Стабильный заряд для прицельной стрельбы: немного лучше пробитие, ниже урон. Точность помогает на открытых маршрутах, особенно при осторожной тактике." },
	subsonic: { damage: .82, armorDamage: .25, ammoMultiplier: 1.25, wearMultiplier: .96,
		description: "Ниже урон и пробитие. С исправным глушителем помогает скрытности на тайниках и разведке; без него бонуса нет. У ВАЛ и ВСС используется встроенный глушитель. Износ немного ниже." },
	tracer: { damage: .97, armorDamage: .3, ammoMultiplier: 1.25, wearMultiplier: 1.04,
		description: "Видимый след помогает корректировать огонь на боевом маршруте, но выдаёт позицию на разведке. Немного меньше урона; пробитие штатное. Дороже обычных патронов." },
	highpressure: { damage: 1.12, armorDamage: .4, ammoMultiplier: 1.4, wearMultiplier: 1.22,
		description: "Усиленный заряд повышает урон и немного пробитие. Против тяжёлых плит уступает бронебойному сердечнику. Большой расход припаса и повышенный износ оружия." },
	surplus: { damage: .88, armorDamage: .25, ammoMultiplier: .75, wearMultiplier: 1.18,
		description: "Недорогая партия долгого хранения. Экономит общий припас, но слабее по урону и пробитию. Повышенный износ делает частое обслуживание частью экономии." },
};
const PACK_CODES: Record<AmmoType, string> = {
	standard: "FMJ", piercing: "AP", expanding: "HP", precision: "MATCH", subsonic: "SUB", tracer: "TR", highpressure: "+P", surplus: "STOCK",
};
const penetrationFor = (type: AmmoType, base: { penetration: number; piercingGain: number }): number => {
	if (type === "piercing") return base.penetration + base.piercingGain;
	if (type === "expanding") return Math.max(0, base.penetration - 12);
	if (type === "precision") return base.penetration + 5;
	if (type === "subsonic") return Math.max(0, base.penetration - 6);
	if (type === "highpressure") return base.penetration + 8;
	if (type === "surplus") return Math.max(0, base.penetration - 3);
	return base.penetration;
};

export const AMMO_MODELS: AmmoModel[] = Object.entries(CALIBER_BALLISTICS).flatMap(([caliber, base]) => AMMO_TYPES.map((type) => {
	const spec = AMMO_SPECS[type], shotgun = caliber === "12g" || caliber === "20g";
	const name = shotgun
		? { standard: "Картечь", piercing: "Бронебойный дротик", expanding: "Дробь", precision: "Пуля", subsonic: "Низкоскоростная картечь", tracer: "Трассирующая пуля", highpressure: "Картечь «Магнум»", surplus: "Картечь долгого хранения" }[type]
		: { standard: "Оболочечный", piercing: "Бронебойный", expanding: "Экспансивный", precision: "Матчевый", subsonic: "Дозвуковой", tracer: "Трассирующий", highpressure: "Усиленный", surplus: "Складской" }[type];
	const description = shotgun && type === "expanding"
		? "Плотная дробовая осыпь сильнее действует на незащищённые цели. Броня резко снижает её пользу. Расход припаса немного выше штатного."
		: shotgun && type === "precision"
			? "Одиночная пуля лучше картечи пробивает лёгкую защиту и помогает на дистанции. Прицельный выстрел выгоднее с осторожной тактикой."
			: spec.description;
	return {
		id: `ammo-${caliber}-${type}`, caliber, type, label: `${name} · ${base.label}`, description,
		packCode: PACK_CODES[type], packRounds: shotgun || caliber === ".338lapua" ? 10 : ["9x18", "9x19", "7.62x25", "5.7x28", "4.6x30", ".45acp"].includes(caliber) ? 50 : 20,
		damage: Math.round(base.damage * spec.damage * 10) / 10,
		penetration: penetrationFor(type, base),
		armorDamage: spec.armorDamage, ammoMultiplier: spec.ammoMultiplier, wearMultiplier: spec.wearMultiplier,
	};
}));
export const AMMO_BY_ID: Record<string, AmmoModel> = Object.fromEntries(AMMO_MODELS.map((model) => [model.id, model]));

export function isAmmoType(value: unknown): value is AmmoType {
	return typeof value === "string" && AMMO_TYPES.includes(value as AmmoType);
}
/** Supply cost is shared by calibre and remains available without a weapon instance. */
export function getAmmoSupplyMultiplier(type: AmmoType): number {
	if (!isAmmoType(type)) throw new Error("Неизвестный тип боеприпаса");
	return AMMO_SPECS[type].ammoMultiplier;
}
export function getAmmoModel(weapon: Pick<WeaponInstance, "weaponId">, type: AmmoType): AmmoModel {
	const info = Object.hasOwn(RECEIVER_INFO, weapon.weaponId) ? RECEIVER_INFO[weapon.weaponId] : undefined;
	if (!info || !isAmmoType(type)) throw new Error("Боеприпас не подходит оружию");
	const model = AMMO_BY_ID[`ammo-${info.caliber}-${type}`];
	if (!model) throw new Error("Неизвестный калибр боеприпаса");
	return model;
}

const ENEMY_ARMOR: Record<string, { armorClass: number; armoredShare: number }> = {
	courtyard: { armorClass: 1, armoredShare: .15 }, depot: { armorClass: 2, armoredShare: .35 },
	forest: { armorClass: 2, armoredShare: .25 }, factory: { armorClass: 3, armoredShare: .55 },
	reserve: { armorClass: 4, armoredShare: .7 }, bunker: { armorClass: 5, armoredShare: .85 },
};
export function getEnemyArmorProfile(mapId: string, branch: ExpeditionBranch, stage: number): EnemyArmorProfile {
	const base = Object.hasOwn(ENEMY_ARMOR, mapId) ? ENEMY_ARMOR[mapId] : undefined;
	if (!base) throw new Error("Неизвестные цели сектора");
	if (!["scavenge", "combat", "recon"].includes(branch) || !Number.isFinite(stage)) throw new Error("Неизвестные условия огневого контакта");
	const depth = clamp(Math.floor(stage), 1, 3) - 1;
	const armorClass = base.armorClass + (branch === "combat" ? 1 : 0);
	const armoredShare = clamp(base.armoredShare + (branch === "combat" ? .15 : branch === "recon" ? -.15 : 0) + depth * .05, 0, .95);
	return { armorClass, armoredShare, label: `Броня ${armorClass} класса · ${Math.round(armoredShare * 100)}% целей` };
}

type AmmoWeapon = Pick<WeaponInstance, "weaponId"> & Partial<Pick<WeaponInstance, "modules">>;
const working = (part: ModuleInstance | undefined): number => part && Number.isFinite(part.durability) && part.durability >= 10 ? clamp(part.durability / 100, 0, 1) : 0;
const compatiblePart = (model: ModuleModel | undefined, weaponId: string): boolean => {
	const info = RECEIVER_INFO[weaponId]!;
	return Boolean(model && (model.calibers.includes("*") || model.calibers.includes(info.caliber)) && (model.platforms.includes("*") || model.platforms.includes(info.platform)));
};
/** Only a real, compatible installed suppressor gives the low-speed load a quiet niche. */
function suppressorStrength(weapon: AmmoWeapon): number {
	if (weapon.weaponId === "asval" || weapon.weaponId === "vss") {
		// A calibre-only preview still knows these two platforms have integral suppression.
		if (!weapon.modules) return 1;
		const part = weapon.modules.barrel;
		const model = part && Object.hasOwn(MODULE_BY_ID, part.modelId) ? MODULE_BY_ID[part.modelId] : undefined;
		return model?.slot === "barrel" && compatiblePart(model, weapon.weaponId) ? working(part) : 0;
	}
	const part = weapon.modules?.muzzle;
	const model = part && Object.hasOwn(MODULE_BY_ID, part.modelId) ? MODULE_BY_ID[part.modelId] : undefined;
	if (model?.slot !== "muzzle" || !model.appearance.includes("suppressor") || !compatiblePart(model, weapon.weaponId)) return 0;
	const barrel = weapon.modules?.barrel;
	const barrelModel = barrel && Object.hasOwn(MODULE_BY_ID, barrel.modelId) ? MODULE_BY_ID[barrel.modelId] : undefined;
	if (barrelModel?.slot !== "barrel" || !compatiblePart(barrelModel, weapon.weaponId) || !working(barrel)) return 0;
	if (model.requiresMount && !getResolvedModuleMounts(weapon.modules!, "muzzle").includes(model.requiresMount)) return 0;
	return working(part);
}

export function getAmmoEffect(weapon: AmmoWeapon, type: AmmoType, mapId: string, branch: ExpeditionBranch, stage: number, tactic: RaidTactic): AmmoEffect {
	const model = getAmmoModel(weapon, type), enemy = getEnemyArmorProfile(mapId, branch, stage);
	if (!["cautious", "balanced", "bold"].includes(tactic)) throw new Error("Неизвестная тактика стрельбы");
	const penetrationChance = clamp(.5 + (model.penetration - enemy.armorClass * 10) / 40, .03, .97);
	// Blocked hits retain 15% impact. Repeated fire chips the protection away;
	// the armour-damage index can recover at most half of that blocked impact.
	const blockedReduction = .85 * (1 - model.armorDamage * .5);
	const effectiveDamage = model.damage * (1 - enemy.armoredShare * (1 - penetrationChance) * blockedReduction);
	const referenceDamage = getAmmoModel(weapon, "standard").damage;
	const contactWeight = branch === "combat" ? 1 : branch === "scavenge" ? .65 : .45;
	const distance = WEAPON_ENVIRONMENTS[mapId]!.distance;
	const precisionBonus = type === "precision" ? (distance === "far" ? .015 : distance === "mixed" ? .008 : 0) * (tactic === "cautious" ? 1 : tactic === "balanced" ? .8 : .4) : 0;
	const quietBonus = type === "subsonic" && branch !== "combat"
		? suppressorStrength(weapon) * (branch === "recon" ? .03 : .018) * (tactic === "cautious" ? 1 : tactic === "balanced" ? .8 : .35) : 0;
	const tracerBonus = type === "tracer" ? branch === "combat" ? .012 : branch === "recon" ? -.015 : 0 : 0;
	const bonus = clamp((effectiveDamage / referenceDamage - 1) * .15 * contactWeight + precisionBonus + quietBonus + tracerBonus, -.1, .1);
	return { model, enemy, penetrationChance, effectiveDamage, bonus, injuryMultiplier: clamp(1 - bonus * 2, .8, 1.2) };
}
