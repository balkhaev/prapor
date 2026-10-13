import { MODULE_BY_ID, type ModuleInstance, type ModuleModel } from "./modules";
import type { WeaponInstance } from "./engine";
import type { RaidTactic } from "./operations";
import type { ExpeditionBranch } from "./systems";

export interface WeaponMechanics {
	label: string;
	closeBonus: number; rangeBonus: number; stealthBonus: number;
	illumination: number; targeting: number; reloadBonus: number; supportBonus: number;
	wearMultiplier: number; features: string[];
}
type NativeProfile = Pick<WeaponMechanics, "label" | "closeBonus" | "rangeBonus" | "stealthBonus" | "supportBonus">;
const profile = (label: string, closeBonus: number, rangeBonus: number, stealthBonus = 0, supportBonus = 0): NativeProfile => ({ label, closeBonus, rangeBonus, stealthBonus, supportBonus });

/** Game affinities are bounded advantages, independent of rarity and raw firepower. */
export const WEAPON_MECHANICAL_PROFILES: Record<string, NativeProfile> = {
	pm: profile("Лёгкое прикрытие", .025, -.03), tt: profile("Мобильный одиночный огонь", .015, -.018),
	toz: profile("Короткая засада", .045, -.05), mp133: profile("Зачистка проходов", .05, -.04),
	pp91: profile("Быстрый ближний бой", .055, -.03), sks: profile("Уверенный средний рубеж", -.012, .033),
	ak74: profile("Манёвренный универсал", .012, .022), saiga: profile("Штурм тесных помещений", .055, -.035),
	vityaz: profile("Контроль ближнего рубежа", .05, -.02), mosin: profile("Дальний одиночный выстрел", -.045, .06),
	akm: profile("Универсал с тяжёлой отдачей", .005, .03), vss: profile("Скрытный дальний дозор", -.012, .045, .04),
	rpk: profile("Поддержка с устойчивой позиции", -.018, .035, 0, .014), svd: profile("Дальний точный огонь", -.028, .055),
	asval: profile("Скрытное сближение", .015, .028, .045), pkp: profile("Тяжёлое удержание рубежа", -.04, .035, 0, .035),
	m4a1: profile("Лёгкий универсальный карабин", .018, .023), hk416: profile("Устойчивый средний рубеж", .006, .034),
	p90: profile("Короткий бой с верхней подачей", .064, -.028), mp7: profile("Манёвренное ближнее прикрытие", .059, -.023),
	ump45: profile("Тяжёлое ближнее прикрытие", .046, -.038), m1911: profile("Одиночный ближний выстрел", .03, -.042),
	mcx: profile("Короткий карабин для сближения", .022, .018), scarh: profile("Тяжёлый открытый рубеж", -.006, .047),
	trg42: profile("Дальний болтовой дозор", -.075, .08),
};
export interface WeaponEnvironment { label: string; distance: "close" | "mixed" | "far"; darkness: number }
export const WEAPON_ENVIRONMENTS: Record<string, WeaponEnvironment> = {
	courtyard: { label: "Дворы · смешанная дистанция", distance: "mixed", darkness: 0 },
	depot: { label: "Депо · смешанная дистанция, полумрак", distance: "mixed", darkness: .35 },
	forest: { label: "Лес · дальняя дистанция", distance: "far", darkness: 0 },
	factory: { label: "Завод · теснота, полумрак", distance: "close", darkness: .65 },
	reserve: { label: "Резерв · дальняя дистанция, полумрак", distance: "far", darkness: .25 },
	bunker: { label: "Бункер · теснота, темнота", distance: "close", darkness: 1 },
};
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const working = (part: ModuleInstance | undefined) => part && part.durability >= 10 ? clamp(part.durability / 100, 0, 1) : 0;
const getModel = (part: ModuleInstance | undefined) => part ? MODULE_BY_ID[part.modelId] : undefined;

/** Effects describe the actual physical part; there are no rarity set bonuses. */
export function getModuleMechanics(model: ModuleModel): Omit<WeaponMechanics, "label" | "features"> {
	const effect = { closeBonus: 0, rangeBonus: 0, stealthBonus: 0, illumination: 0, targeting: 0, reloadBonus: 0, supportBonus: 0, wearMultiplier: 1 };
	const style = model.appearance;
	if (model.slot === "barrel") {
		if (style === "short") { effect.closeBonus = .015; effect.rangeBonus = -.02; }
		if (style === "long") { effect.closeBonus = -.012; effect.rangeBonus = .025; }
		if (style === "heavy") { effect.closeBonus = -.015; effect.rangeBonus = .018; effect.wearMultiplier = .9; }
		if (style === "fluted") { effect.rangeBonus = .014; effect.wearMultiplier = .95; }
	}
	if (model.slot === "optic") {
		if (["reflex", "micro", "holo", "dovetail-reflex"].includes(style)) { effect.closeBonus = style === "micro" ? .02 : .025; effect.rangeBonus = .006; }
		if (["scope", "dovetail", "scout", "prism", "longscope"].includes(style)) {
			effect.rangeBonus = style === "longscope" ? .04 : style === "scout" ? .018 : style === "prism" ? .025 : .03;
			effect.closeBonus = style === "scout" || style === "prism" ? -.006 : style === "longscope" ? -.02 : -.012;
		}
	}
	if (model.slot === "muzzle") {
		if (style.includes("suppressor")) { effect.stealthBonus = style === "compact-suppressor" ? .026 : .04; effect.wearMultiplier = style === "compact-suppressor" ? 1.12 : 1.2; }
		if (["brake", "ported"].includes(style)) effect.stealthBonus = -.008;
		if (style === "flash") effect.stealthBonus = .008;
	}
	if (model.slot === "flashlight") {
		effect.illumination = ({ mini: .022, long: .027, armored: .025, wide: .035, angled: .026, taped: .018, focus: .04, scout: .028 } as Record<string, number>)[style] ?? .025;
	}
	if (model.slot === "laser") effect.targeting = ({ micro: .016, box: .024, tube: .018, dual: .028, range: .032, armored: .022, offset: .018, precision: .03 } as Record<string, number>)[style] ?? .02;
	if (model.slot === "magazine") {
		effect.reloadBonus = ({ quick: .022, window: .01, compact: -.012, extended: .012, drum: .022 } as Record<string, number>)[style] ?? 0;
		if (style === "drum") effect.wearMultiplier = 1.08;
	}
	if (model.slot === "foregrip" && style === "bipod") effect.supportBonus = .035;
	return effect;
}

export function getWeaponMechanics(weapon: WeaponInstance): WeaponMechanics {
	const native = WEAPON_MECHANICAL_PROFILES[weapon.weaponId];
	if (!native) throw new Error("Неизвестный профиль оружия");
	const receiverCondition = working(weapon.modules.receiver);
	const result: WeaponMechanics = { ...native, stealthBonus: native.stealthBonus * working(weapon.modules.barrel),
		illumination: 0, targeting: 0, reloadBonus: 0, wearMultiplier: 1, features: [] };
	// A worn receiver cannot improve an affinity penalty. Positive platform benefits fade.
	result.closeBonus = result.closeBonus > 0 ? result.closeBonus * receiverCondition : result.closeBonus;
	result.rangeBonus = result.rangeBonus > 0 ? result.rangeBonus * receiverCondition : result.rangeBonus;
	result.supportBonus *= receiverCondition;
	for (const part of Object.values(weapon.modules)) {
		const model = getModel(part);
		if (!model) continue;
		const effect = getModuleMechanics(model), condition = working(part);
		for (const key of ["closeBonus", "rangeBonus", "stealthBonus", "illumination", "targeting", "reloadBonus", "supportBonus"] as const) {
			result[key] += effect[key] > 0 ? effect[key] * condition : effect[key];
		}
		// Added back pressure/feed load stays physical; a worn benefit cannot improve it.
		result.wearMultiplier *= effect.wearMultiplier < 1 ? 1 - (1 - effect.wearMultiplier) * condition : effect.wearMultiplier;
	}
	result.wearMultiplier = clamp(result.wearMultiplier, .85, 1.4);
	if (result.stealthBonus > .005) result.features.push("Тише на тайниках и разведке; напористая тактика ослабляет скрытность.");
	if (working(weapon.modules.flashlight)) result.features.push("Фонарь помогает в полумраке и темноте; на разведке свет выдаёт позицию.");
	if (working(weapon.modules.laser)) result.features.push("Лазер помогает ближнему наведению; на дальней дистанции польза мала.");
	if (working(weapon.modules.foregrip) && getModel(weapon.modules.foregrip)?.appearance === "bipod") result.features.push("Сошки помогают у оружейного склада с устойчивой позиции; при напористом движении бонуса нет.");
	if (working(weapon.modules.magazine) && getModel(weapon.modules.magazine)?.appearance === "quick") result.features.push("Быстрый магазин сокращает паузу перезарядки в бою.");
	if (Object.values(weapon.modules).some((part) => part.durability < 10)) result.features.push("Сломанные детали не дают полезных бонусов; требуется ремонт.");
	if (result.wearMultiplier > 1.005) result.features.push("Глушитель и сложная подача повышают износ; обслуживание остаётся важным.");
	if (receiverCondition < 1) result.features.push("Износ снижает надёжность и полезные бонусы; штрафы деталей сохраняются.");
	return result;
}

/** Bonus is in probability points, not damage, jam chance, or the final survival quote. */
export function getWeaponRouteEffect(weapon: WeaponInstance, mapId: string, branch: ExpeditionBranch, tactic: RaidTactic, stats: { recoil: number; ready: boolean }) {
	const environment = WEAPON_ENVIRONMENTS[mapId];
	if (!environment) throw new Error("Неизвестные условия сектора");
	const mechanics = getWeaponMechanics(weapon), contributions: { label: string; bonus: number }[] = [];
	const add = (label: string, bonus: number) => { if (Math.abs(bonus) > .000001) contributions.push({ label, bonus }); };
	if (!stats.ready) return { bonus: 0, contributions, environment };
	const close = environment.distance === "close" ? 1 : environment.distance === "mixed" ? .5 : 0;
	const far = environment.distance === "far" ? 1 : environment.distance === "mixed" ? .5 : 0;
	add("Работа в тесноте", mechanics.closeBonus * close);
	add("Работа на дистанции", mechanics.rangeBonus * far);
	if (branch !== "combat") add("Скрытность", mechanics.stealthBonus * (branch === "recon" ? 1 : .55) * (tactic === "bold" ? .35 : tactic === "cautious" ? 1 : .8));
	add("Освещение", mechanics.illumination * environment.darkness * (branch === "combat" ? .8 : branch === "recon" ? .3 : 1));
	if (branch === "recon") add("Свет выдаёт позицию", -mechanics.illumination * environment.darkness * .45);
	add("Ближнее наведение", mechanics.targeting * (close + far * .15) * (branch === "combat" ? 1 : .6));
	if (branch === "combat") {
		add("Контроль отдачи", (60 - stats.recoil) / 1000);
		add("Перезарядка", mechanics.reloadBonus);
		if (tactic !== "bold") add("Устойчивая позиция", mechanics.supportBonus * (tactic === "cautious" ? 1 : .75));
	}
	return { bonus: clamp(contributions.reduce((sum, item) => sum + item.bonus, 0), -.12, .12), contributions, environment };
}

export interface WeaponRaidSnapshot {
	power: number; reliability: number; firstBonus: number; wearMultiplier: number;
}
