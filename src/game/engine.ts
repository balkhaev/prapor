import {
	CONTRACTS,
	MAP_BY_ID,
	PERSONALITIES,
	PERSONALITY_BY_ID,
	SCAV_NAMES,
	WEAPON_BY_ID,
	type Attachment,
	type BaseRoom,
	type Contract,
	type RaidMap,
	type Supplies,
	type WeaponDefinition,
} from "./data";
import { GEAR_LABELS, MAX_GEAR_LEVEL, TACTICS, type GearSlot, type RaidTactic } from "./operations";
export { GEAR_LABELS, MAX_GEAR_LEVEL, TACTICS, type GearSlot, type RaidTactic } from "./operations";
import { BLUEPRINTS, EXPEDITION_BRANCHES, GEAR_MODEL_BY_ID, MARKET_OFFERS, RUN_PERKS, WEAPON_ROLES, type AmmoType, type Cargo, type ExpeditionBranch, type GearItem, type Loadout, type RunPerk } from "./systems";
export * from "./systems";

export const SAVE_KEY = "prapor.save.v1";
export const SAVE_VERSION = 3;
export const MAX_OFFLINE_MS = 8 * 60 * 60 * 1000;
export const MAX_ROOM_LEVEL = 5;

export interface WeaponInstance {
	id: string;
	weaponId: string;
	durability: number;
	attachments: Record<Attachment, number>;
	foundAt: number;
}
export interface Scav {
	id: string;
	name: string;
	personality: string;
	level: number;
	xp: number;
	health: number;
	combat: number;
	scouting: number;
	weaponInstanceId: string | null;
	status: "ready" | "raiding" | "wounded";
	raids: number;
	tactic: RaidTactic;
	gear: Record<GearSlot, number>;
	loadout: Loadout;
	autoRaid: { mapId: string; enabled: boolean; minHealth: number; runs: number; waitingReason: string | null; maxDepth: number };
}
export interface Expedition {
	stage: number; status: "travel" | "choice"; branch: ExpeditionBranch;
	cargo: Cargo; perks: RunPerk[]; offers: RunPerk[]; discoveries: string[];
	loadout: { armorModelId: string; armorCondition: number; packModelId: string; packCondition: number; ammoType: AmmoType; medkit: boolean };
	autoDepth: number;
	baseChance: number; baseDuration: number; capacity: number; ammoMultiplier: number;
	trail: RaidReport["events"];
}
export interface Raid {
	id: string;
	scavId: string;
	scavName: string;
	mapId: string;
	weaponInstanceId: string;
	startedAt: number;
	endsAt: number;
	chance: number;
	lootBonus: number;
	seed: number;
	isAuto: boolean;
	tactic: RaidTactic;
	armorLevel: number;
	backpackLevel: number;
	/** Null only for a migrated sortie: its original seed and payout settle once. */
	expedition: Expedition | null;
}
export interface RaidReport {
	id: string;
	raidId: string;
	scavName: string;
	mapId: string;
	at: number;
	success: boolean;
	lostScav: boolean;
	lostWeapon: boolean;
	money: number;
	supplies: Supplies;
	weaponId: string | null;
	weaponAutoSold: boolean;
	description: string;
	isAuto: boolean;
	tactic: RaidTactic;
	events: { at: number; label: string; text: string; kind: "neutral" | "loot" | "danger" | "success" }[];
	depth: number;
	discoveries: string[];
	lostCargo: Cargo | null;
}
export interface GameState {
	schemaVersion: number;
	createdAt: number;
	lastUpdated: number;
	money: number;
	supplies: Supplies;
	xp: number;
	level: number;
	base: Record<BaseRoom, number>;
	scavs: Scav[];
	weapons: WeaponInstance[];
	raids: Raid[];
	history: RaidReport[];
	claimedContracts: string[];
	discoveredWeapons: string[];
	gearItems: GearItem[];
	blueprints: string[];
	stats: {
		raidsWon: number;
		raidsCompleted: number;
		weaponsFound: number;
		rareWeaponsFound: number;
		moneyEarned: number;
		mapsVisited: string[];
		lostScavs: number;
		autoRaidsCompleted: number;
		mapWins: Record<string, number>;
	};
	clock: { income: number; ammo: number; scrap: number; intel: number };
	rng: number;
	nextId: number;
}
export interface ActionResult {
	ok: boolean;
	message: string;
	raidId?: string;
}
export interface AdvanceSummary {
	elapsedMs: number;
	capped: boolean;
	money: number;
	completed: RaidReport[];
	completedCount: number;
}
export interface UpgradeCost {
	money: number;
	scrap: number;
}

const emptySupplies = (): Supplies => ({
	ammo: 0,
	medicine: 0,
	scrap: 0,
	intel: 0,
});
const ok = (message: string): ActionResult => ({ ok: true, message });
const fail = (message: string): ActionResult => ({ ok: false, message });
const clamp = (n: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, n));
const id = (state: GameState, prefix: string) => `${prefix}-${state.nextId++}`;
const roomKeys: BaseRoom[] = ["workshop", "medbay", "radio", "storage"];
const attachmentKeys: Attachment[] = ["optic", "magazine", "stock"];
const isTime = (now: number) => Number.isFinite(now) && now >= 0;
const ownValue = <T>(
	values: Readonly<Record<string, T>>,
	key: string
): T | undefined => (Object.hasOwn(values, key) ? values[key] : undefined);

function rebaseClock(state: GameState, now: number) {
	if (state.lastUpdated <= now) return;
	const shift = state.lastUpdated - now;
	state.raids.forEach((raid) => {
		raid.startedAt = Math.max(0, raid.startedAt - shift);
		raid.endsAt = raid.expedition?.status === "choice" ? Math.max(0, raid.endsAt - shift) : raid.endsAt - shift;
		if (raid.expedition) for (const event of raid.expedition.trail) event.at = Math.max(0, event.at - shift);
	});
	state.createdAt = Math.min(state.createdAt, now);
	state.lastUpdated = now;
}
function getPersonality(scav: Scav) {
	const personality = ownValue(PERSONALITY_BY_ID, scav.personality);
	if (!personality) throw new Error("Неизвестный характер дикого");
	return personality;
}

/** Stable PRNG: a raid's persisted seed defines its whole outcome. */
function generator(seed: number) {
	let value = seed >>> 0 || 0x6d2b79f5;
	return () => {
		value ^= value << 13;
		value ^= value >>> 17;
		value ^= value << 5;
		return (value >>> 0) / 4294967296;
	};
}
function initialSeed(now: number): number {
	// New campaigns vary; persisted raids never consult the wall clock for a roll.
	let value = (Math.trunc(now) >>> 0) ^ Math.imul(Math.floor(now / 4294967296) >>> 0, 0x9e3779b1) ^ 0x70a90211;
	value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
	value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
	return (value ^ (value >>> 16)) >>> 0 || 1;
}
function takeSeed(state: GameState): number {
	const next = generator(state.rng)();
	state.rng = Math.floor(next * 4294967296) >>> 0 || 1;
	return state.rng;
}
function addXp(state: GameState, xp: number) {
	state.xp += xp;
	state.level = Math.min(30, 1 + Math.floor(Math.sqrt(state.xp / 90)));
}
function addMoney(state: GameState, amount: number, earned = true) {
	state.money += amount;
	if (earned) state.stats.moneyEarned += amount;
}
function createWeapon(
	state: GameState,
	weaponId: string,
	now: number,
	durability = 100
): WeaponInstance {
	const weapon: WeaponInstance = {
		id: id(state, "gun"),
		weaponId,
		durability,
		attachments: { optic: 0, magazine: 0, stock: 0 },
		foundAt: now,
	};
	state.weapons.push(weapon);
	if (!state.discoveredWeapons.includes(weaponId))
		state.discoveredWeapons.push(weaponId);
	return weapon;
}
function createScav(
	state: GameState,
	name: string,
	personality: string,
	combat: number,
	scouting: number
): Scav {
	const scav: Scav = {
		id: id(state, "scav"),
		name,
		personality,
		combat,
		scouting,
		level: 1,
		xp: 0,
		health: 100,
		weaponInstanceId: null,
		status: "ready",
		raids: 0,
		tactic: "balanced",
		gear: { armor: 0, backpack: 0 },
		loadout: { armorItemId: null, backpackItemId: null, ammoType: "standard", medkit: false },
		autoRaid: { mapId: "courtyard", enabled: false, minHealth: 70, runs: 0, waitingReason: null, maxDepth: 1 },
	};
	state.scavs.push(scav);
	return scav;
}

export function createGame(now = Date.now()): GameState {
	if (!isTime(now)) throw new Error("Некорректное время");
	const state: GameState = {
		schemaVersion: SAVE_VERSION,
		createdAt: now,
		lastUpdated: now,
		money: 640,
		supplies: { ammo: 24, medicine: 6, scrap: 18, intel: 3 },
		xp: 0,
		level: 1,
		base: { workshop: 1, medbay: 1, radio: 1, storage: 1 },
		scavs: [],
		weapons: [],
		raids: [],
		history: [],
		claimedContracts: [],
		discoveredWeapons: [],
		gearItems: [],
		blueprints: ["light_vest", "scout_pack"],
		stats: {
			raidsWon: 0,
			raidsCompleted: 0,
			weaponsFound: 0,
			rareWeaponsFound: 0,
			moneyEarned: 0,
			mapsVisited: [],
			lostScavs: 0,
			autoRaidsCompleted: 0,
			mapWins: {},
		},
		clock: { income: 0, ammo: 0, scrap: 0, intel: 0 },
		rng: initialSeed(now),
		nextId: 1,
	};
	const guns = ["sks", "pp91", "mp133", "pm"].map((weaponId) =>
		createWeapon(state, weaponId, now)
	);
	const scavs = [
		createScav(state, "Борода", "veteran", 36, 31),
		createScav(state, "Рыжий", "collector", 29, 42),
		createScav(state, "Шустрый", "runner", 27, 35),
	];
	scavs.forEach((scav, index) => {
		scav.weaponInstanceId = guns[index]!.id;
	});
	return state;
}

export function getWeaponDefinition(weapon: WeaponInstance): WeaponDefinition {
	const definition = ownValue(WEAPON_BY_ID, weapon.weaponId);
	if (!definition) throw new Error("Неизвестное оружие");
	return definition;
}
export function getWeaponPower(weapon: WeaponInstance): number {
	const definition = getWeaponDefinition(weapon);
	const mods =
		weapon.attachments.optic * 4 +
		weapon.attachments.magazine * 3 +
		weapon.attachments.stock * 3;
	return Math.round(
		(definition.power + mods) * (0.35 + (0.65 * weapon.durability) / 100)
	);
}
export function getStorageCapacity(state: GameState): number {
	return 15 + state.base.storage * 10;
}
export function getScavCapacity(state: GameState): number {
	return 2 + state.base.radio;
}
export function getIncomePerMinute(state: GameState): number {
	return state.base.workshop * 6;
}
/** A small recovery float, not an unlimited idle-money printer. Existing cash is never reduced. */
export function getRecoveryAllowance(state: GameState): number { return 300 + state.base.workshop * 60; }
export function getSupplyCapacity(state: GameState): Supplies {
	return { ammo: 48 + state.base.storage * 24, medicine: 8 + state.base.storage * 4,
		scrap: 24 + state.base.storage * 16, intel: 8 + state.base.radio * 4 };
}
function addSupply(state: GameState, key: keyof Supplies, amount: number): number {
	const accepted = Math.max(0, Math.min(amount, getSupplyCapacity(state)[key] - state.supplies[key]));
	state.supplies[key] += accepted;
	return accepted;
}
export function getGearModel(item: GearItem) {
	const model = ownValue(GEAR_MODEL_BY_ID, item.modelId);
	if (!model) throw new Error("Неизвестное снаряжение");
	return model;
}
export function getWeaponRole(weapon: WeaponInstance) { return WEAPON_ROLES[getWeaponDefinition(weapon).category]; }
export function isAttachmentCompatible(weapon: WeaponInstance, attachment: Attachment): boolean {
	return getWeaponRole(weapon).attachments.includes(attachment);
}
export function getLoadoutStats(state: GameState, scav: Scav) {
	const armor = state.gearItems.find((item) => item.id === scav.loadout.armorItemId);
	const pack = state.gearItems.find((item) => item.id === scav.loadout.backpackItemId);
	const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId);
	const weight = (armor ? getGearModel(armor).weight : 0) + (pack ? getGearModel(pack).weight : 0) + (weapon ? getWeaponRole(weapon).weight : 0) + (scav.loadout.medkit ? 1 : 0);
	return { weight, protection: scav.gear.armor * 0.012 + (armor ? getGearModel(armor).protection * armor.durability / 100 : 0),
		capacity: (pack ? 10 + (getGearModel(pack).capacity - 10) * (0.6 + pack.durability * 0.004) : 10) + scav.gear.backpack * 2,
		speedMultiplier: 1 + weight * 0.017, ammoMultiplier: 1 + Math.max(0, weight - 5) * 0.025 };
}
export function getCargoWeight(cargo: Cargo): number {
	return Math.round((cargo.weaponIds.length * 6 + cargo.supplies.ammo * 0.1 + cargo.supplies.medicine + cargo.supplies.scrap * 0.5 + cargo.supplies.intel * 0.25) * 10) / 10;
}
export function getCargoValue(cargo: Cargo): number {
	return Math.round(cargo.money + cargo.weaponIds.reduce((sum, weaponId) => sum + (ownValue(WEAPON_BY_ID, weaponId)?.value ?? 0) * 0.5, 0)
		+ cargo.supplies.ammo * 6.5 + cargo.supplies.medicine * (100 / 3) + cargo.supplies.scrap * 14.5 + cargo.supplies.intel * (140 / 3));
}
export function getMarketReason(state: GameState, offerId: string): string | null {
	const offer = MARKET_OFFERS.find((item) => item.id === offerId);
	if (!offer) return "Товар не найден.";
	if (state.money < offer.money) return `Нужно ${offer.money} ₽.`;
	if (state.supplies[offer.supply] + offer.amount > getSupplyCapacity(state)[offer.supply]) return "Для всей партии нет места на складе.";
	return null;
}
export function buySupplies(state: GameState, offerId: string): ActionResult {
	const reason = getMarketReason(state, offerId);
	if (reason) return fail(reason);
	const offer = MARKET_OFFERS.find((item) => item.id === offerId)!;
	state.money -= offer.money; state.supplies[offer.supply] += offer.amount;
	return ok(`${offer.label}: +${offer.amount}.`);
}
export function getGearCraftReason(state: GameState, modelId: string): string | null {
	const model = ownValue(GEAR_MODEL_BY_ID, modelId);
	if (!model) return "Модель не найдена.";
	if (model.blueprint && !state.blueprints.includes(model.blueprint)) return "Сначала найди чертёж в глубоком рейде.";
	if (state.gearItems.length >= 28) return "Стойка снаряжения полна (28 предметов).";
	if (state.money < model.money || state.supplies.scrap < model.scrap) return `Нужно ${model.money} ₽ и ${model.scrap} деталей.`;
	return null;
}
export function craftGear(state: GameState, modelId: string): ActionResult {
	const reason = getGearCraftReason(state, modelId);
	if (reason) return fail(reason);
	const model = ownValue(GEAR_MODEL_BY_ID, modelId)!;
	state.money -= model.money; state.supplies.scrap -= model.scrap;
	state.gearItems.push({ id: id(state, "gear"), modelId, durability: 100 });
	return ok(`${model.label} собран. Выдай предмет бойцу.`);
}
export function equipGear(state: GameState, scavId: string, slot: GearSlot, itemId: string | null): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav || !["armor", "backpack"].includes(slot)) return fail("Боец или слот не найден.");
	if (scav.status === "raiding") return fail("Снаряжение нельзя сменить во время рейда.");
	const key = slot === "armor" ? "armorItemId" : "backpackItemId";
	if (itemId === null) { scav.loadout[key] = null; return ok("Предмет возвращён на стойку."); }
	const item = state.gearItems.find((gear) => gear.id === itemId);
	if (!item || getGearModel(item).slot !== slot) return fail("Предмет не подходит этому слоту.");
	const owner = state.scavs.find((other) => other.id !== scavId && other.loadout[key] === itemId);
	if (owner?.status === "raiding") return fail("Предмет сейчас в рейде.");
	if (owner) owner.loadout[key] = null;
	scav.loadout[key] = itemId;
	return ok(`${scav.name}: ${getGearModel(item).label}.`);
}
export function getGearRepairCost(item: GearItem): UpgradeCost {
	const model = getGearModel(item);
	return { money: Math.ceil(model.money * (100 - item.durability) / 180), scrap: Math.ceil((100 - item.durability) / 15) };
}
function gearInRaid(state: GameState, item: GearItem): boolean {
	return state.scavs.some((scav) => scav.status === "raiding" && [scav.loadout.armorItemId, scav.loadout.backpackItemId].includes(item.id));
}
export function repairGear(state: GameState, itemId: string): ActionResult {
	const item = state.gearItems.find((gear) => gear.id === itemId);
	if (!item) return fail("Предмет не найден.");
	if (gearInRaid(state, item)) return fail("Предмет сейчас в рейде.");
	if (item.durability >= 100) return fail("Ремонт не требуется.");
	const cost = getGearRepairCost(item);
	if (state.money < cost.money || state.supplies.scrap < cost.scrap) return fail(`Нужно ${cost.money} ₽ и ${cost.scrap} деталей.`);
	state.money -= cost.money; state.supplies.scrap -= cost.scrap; item.durability = 100;
	return ok("Снаряжение отремонтировано.");
}
export function getGearRecycleYield(item: GearItem): number { return Math.max(1, Math.floor(getGearModel(item).scrap * (0.2 + item.durability / 500))); }
export function recycleGear(state: GameState, itemId: string): ActionResult {
	const item = state.gearItems.find((gear) => gear.id === itemId);
	if (!item) return fail("Предмет не найден.");
	if (gearInRaid(state, item)) return fail("Предмет сейчас в рейде.");
	const amount = getGearRecycleYield(item);
	if (state.supplies.scrap + amount > getSupplyCapacity(state).scrap) return fail("Нет места для деталей.");
	state.gearItems = state.gearItems.filter((gear) => gear.id !== item.id);
	for (const scav of state.scavs) for (const key of ["armorItemId", "backpackItemId"] as const) if (scav.loadout[key] === item.id) scav.loadout[key] = null;
	state.supplies.scrap += amount;
	return ok(`Разобрано: +${amount} деталей.`);
}
export function setLoadoutOption(state: GameState, scavId: string, option: "ammoType" | "medkit", value: string | boolean): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return fail("Боец не найден.");
	if (scav.status === "raiding") return fail("Комплект текущего рейда уже зафиксирован.");
	if (option === "ammoType" && (value === "standard" || value === "piercing")) scav.loadout.ammoType = value;
	else if (option === "medkit" && typeof value === "boolean") scav.loadout.medkit = value;
	else return fail("Неизвестная настройка комплекта.");
	return ok("Комплект обновлён.");
}
export function xpForLevel(level: number): number {
	return 90 * (level - 1) ** 2;
}
export function getRaidDuration(
	state: GameState,
	scav: Scav,
	map: RaidMap
): number {
	const personality = getPersonality(scav);
	return Math.max(
		20,
		Math.round(
			map.duration * TACTICS[scav.tactic].durationMultiplier * getLoadoutStats(state, scav).speedMultiplier *
				(1 - personality.speedBonus - (state.base.radio - 1) * 0.035)
		)
	);
}
export function getRaidChance(
	state: GameState,
	scav: Scav,
	map: RaidMap
): number {
	const weapon = state.weapons.find(
		(item) => item.id === scav.weaponInstanceId
	);
	if (!weapon || weapon.durability < 10 || scav.health < 25) return 0;
	const personality = getPersonality(scav);
	const reliability = getWeaponDefinition(weapon).reliability / 100;
	return clamp(
		0.76 +
			getWeaponPower(weapon) / 360 +
			scav.combat / 800 +
			scav.scouting / 900 +
			(scav.level - 1) * 0.008 +
			personality.survivalBonus +
			state.base.radio * 0.012 +
			TACTICS[scav.tactic].chanceBonus + getLoadoutStats(state, scav).protection +
			(scav.loadout.ammoType === "piercing" ? 0.055 : 0) + (state.blueprints.includes(`route:${map.id}`) ? 0.02 : 0) -
			map.danger * 0.7 -
			(1 - scav.health / 100) * 0.16 -
			(1 - reliability) * 0.1,
		0.22,
		0.97
	);
}
export function getUpgradeCost(state: GameState, room: BaseRoom): UpgradeCost {
	const level = state.base[room];
	return { money: Math.round(180 * level ** 1.7), scrap: 5 + level * 3 };
}
export function getRepairCost(weapon: WeaponInstance): UpgradeCost {
	return {
		money: Math.ceil(
			((100 - weapon.durability) * getWeaponDefinition(weapon).value) / 250
		),
		scrap: Math.ceil((100 - weapon.durability) / 20),
	};
}
export function getModCost(
	weapon: WeaponInstance,
	attachment: Attachment
): UpgradeCost {
	const level = weapon.attachments[attachment];
	return { money: 90 + level * 140, scrap: 4 + level * 4 };
}
export function recruitCost(state: GameState): number {
	return state.scavs.length === 0 ? 0 : 160 + state.scavs.length * 90;
}
export function getContractProgress(
	state: GameState,
	contract: Contract
): number {
	if (contract.metric === "baseLevels")
		return roomKeys.reduce((total, room) => total + state.base[room], 0);
	if (contract.metric === "mapsVisited") return state.stats.mapsVisited.length;
	if (contract.metric === "gearLevels")
		return state.scavs.reduce((total, scav) => total + scav.gear.armor + scav.gear.backpack, 0);
	if (contract.metric === "mapRaidsWon") return state.stats.mapWins[contract.mapId ?? ""] ?? 0;
	return state.stats[contract.metric];
}

export function getContractLockReason(state: GameState, contract: Contract): string | null {
	if (state.level < contract.level) return `Откроется на ${contract.level} уровне.`;
	const previous = (contract.requires ?? []).find((id) => !state.claimedContracts.includes(id));
	if (previous) return `Сначала получи награду «${CONTRACTS.find((item) => item.id === previous)?.name ?? previous}».`;
	return null;
}

export function getRaidAmmoCost(scav: Scav, map: RaidMap, state?: GameState): number {
	const weapon = state?.weapons.find((item) => item.id === scav.weaponInstanceId);
	return Math.max(1, Math.ceil(map.ammoCost * TACTICS[scav.tactic].ammoMultiplier
		* (scav.loadout.ammoType === "piercing" ? 1.65 : 1)
		* (weapon ? getWeaponRole(weapon).ammoMultiplier : 1) * (state ? getLoadoutStats(state, scav).ammoMultiplier : 1)));
}

export function getRaidQuote(state: GameState, scav: Scav, map: RaidMap) {
	const money = 10 + map.level * 5;
	const ammo = getRaidAmmoCost(scav, map, state);
	const medicine = scav.loadout.medkit ? 1 : 0;
	let reason: string | null = null;
	const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId);
	if (scav.status === "raiding") reason = "Боец уже в рейде.";
	else if (state.level < map.level) reason = `Сектор откроется на ${map.level} уровне.`;
	else if (scav.health < 25) reason = "Бойцу нужно восстановиться до 25%.";
	else if (!weapon) reason = "Сначала выдай дикому оружие.";
	else if (weapon.durability < 10) reason = "Оружию нужен ремонт.";
	else if (state.money < money) reason = `Для выхода нужно ${money} ₽.`;
	else if (state.supplies.ammo < ammo) reason = `Нужно ${ammo} патронов.`;
	else if (state.supplies.intel < map.intelCost) reason = `Нужно ${map.intelCost} разведданных.`;
	else if (state.supplies.medicine < medicine) reason = "В комплекте аптечка: нужен 1 медикамент.";
	return { money, ammo, intel: map.intelCost, medicine, chance: getRaidChance(state, scav, map), duration: getRaidDuration(state, scav, map), reason };
}

function raidBlockReason(state: GameState, scav: Scav, map: RaidMap, minHealth = 25): string | null {
	if (scav.health < minHealth) return `Восстановление до ${minHealth}% здоровья.`;
	return getRaidQuote(state, scav, map).reason;
}

export function getGearCost(scav: Scav, slot: GearSlot): UpgradeCost {
	const level = scav.gear[slot];
	return slot === "armor" ? { money: 160 + level * 200, scrap: 6 + level * 5 }
		: { money: 125 + level * 160, scrap: 5 + level * 4 };
}

export function upgradeScavGear(state: GameState, scavId: string, slot: GearSlot): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav || !["armor", "backpack"].includes(slot)) return fail("Боец или снаряжение не найдено.");
	if (scav.status === "raiding") return fail("Снаряжение нельзя улучшить во время рейда.");
	if (scav.gear[slot] >= MAX_GEAR_LEVEL) return fail("Снаряжение уже максимального уровня.");
	const cost = getGearCost(scav, slot);
	if (state.money < cost.money || state.supplies.scrap < cost.scrap)
		return fail(`Нужно ${cost.money} ₽ и ${cost.scrap} деталей.`);
	state.money -= cost.money;
	state.supplies.scrap -= cost.scrap;
	scav.gear[slot]++;
	return ok(`${GEAR_LABELS[slot]}: уровень ${scav.gear[slot]}.`);
}

export function setRaidTactic(state: GameState, scavId: string, tactic: RaidTactic): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav || !Object.hasOwn(TACTICS, tactic)) return fail("Боец или тактика не найдены.");
	scav.tactic = tactic;
	return ok(`Тактика ${scav.status === "raiding" ? "следующего выхода" : "выхода"}: ${TACTICS[tactic].label}.`);
}

export function getAutoRaidStatus(state: GameState, scav: Scav): string {
	const raid = state.raids.find((item) => item.scavId === scav.id);
	if (raid?.expedition?.status === "choice") return "На развилке · ждёт твой приказ";
	if (scav.status === "raiding") return scav.autoRaid.enabled ? `В рейде · авто до этапа ${scav.autoRaid.maxDepth}` : "В рейде · завершит последний выход";
	if (!scav.autoRaid.enabled) return "Ручные рейды";
	const map = ownValue(MAP_BY_ID, scav.autoRaid.mapId);
	return map ? raidBlockReason(state, scav, map, scav.autoRaid.minHealth) ?? "Готов к следующему выходу" : "Сектор не найден.";
}

export function getRaidPhase(raid: Raid, now: number): { label: string; progress: number } {
	if (raid.expedition?.status === "choice") return { label: "Ожидает приказа", progress: 1 };
	const progress = clamp((now - raid.startedAt) / (raid.endsAt - raid.startedAt), 0, 1);
	const label = progress < 0.18 ? "Выход на маршрут" : progress < 0.52 ? "Поиск тайников"
		: progress < 0.8 ? "Опасный участок" : progress < 1 ? "К точке выхода" : "Возвращение";
	return { label: raid.expedition ? `Этап ${raid.expedition.stage} · ${label}` : label, progress };
}

/** Internal dispatch never advances time: automatic repeat uses the simulation cursor. */
function startRaid(state: GameState, scav: Scav, map: RaidMap, now: number, isAuto: boolean): ActionResult {
	if (scav.status === "raiding") return fail("Дикий уже в рейде.");
	const reason = raidBlockReason(state, scav, map, isAuto ? scav.autoRaid.minHealth : 25);
	if (reason) return fail(reason);
	const quote = getRaidQuote(state, scav, map);
	const stats = getLoadoutStats(state, scav);
	const armor = state.gearItems.find((item) => item.id === scav.loadout.armorItemId);
	const pack = state.gearItems.find((item) => item.id === scav.loadout.backpackItemId);
	const raid: Raid = {
		id: id(state, "raid"), scavId: scav.id, scavName: scav.name, mapId: map.id,
		weaponInstanceId: scav.weaponInstanceId!, startedAt: now,
		endsAt: now + getRaidDuration(state, scav, map) * 1000,
		chance: getRaidChance(state, scav, map),
		lootBonus: getPersonality(scav).lootBonus + scav.scouting / 450 + TACTICS[scav.tactic].lootBonus + scav.gear.backpack * 0.12,
		seed: takeSeed(state), isAuto, tactic: scav.tactic,
		armorLevel: scav.gear.armor, backpackLevel: scav.gear.backpack,
		expedition: { stage: 1, status: "travel", branch: "scavenge", cargo: { money: 0, supplies: emptySupplies(), weaponIds: [] },
			perks: [], offers: [], discoveries: [], autoDepth: isAuto ? scav.autoRaid.maxDepth : 1,
			baseChance: quote.chance, baseDuration: quote.duration, capacity: stats.capacity,
			trail: [{ at: now, label: "Выход · этап 1", text: `${scav.name} вышел в «${map.name}». ${TACTICS[scav.tactic].label}: ${quote.money} ₽, ${quote.ammo} патронов${quote.intel ? `, ${quote.intel} разведданных` : ""}${quote.medicine ? ", аптечка" : ""}.`, kind: "neutral" }],
			ammoMultiplier: getWeaponRole(state.weapons.find((item) => item.id === scav.weaponInstanceId)!).ammoMultiplier * stats.ammoMultiplier,
			loadout: { armorModelId: armor?.modelId ?? "none", armorCondition: armor?.durability ?? 0,
				packModelId: pack?.modelId ?? "none", packCondition: pack?.durability ?? 0,
				ammoType: scav.loadout.ammoType, medkit: scav.loadout.medkit } },
	};
	state.money -= quote.money;
	state.supplies.ammo -= quote.ammo;
	state.supplies.intel -= quote.intel;
	state.supplies.medicine -= quote.medicine;
	scav.status = "raiding";
	scav.autoRaid.waitingReason = null;
	state.raids.push(raid);
	if (!state.stats.mapsVisited.includes(map.id)) state.stats.mapsVisited.push(map.id);
	return { ok: true, message: `${scav.name} отправился: ${map.name}.`, raidId: raid.id };
}

export function setAutoRaidDepth(state: GameState, scavId: string, depth: number): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav || !Number.isInteger(depth) || depth < 1 || depth > 3) return fail("Глубина маршрута: от 1 до 3 этапов.");
	scav.autoRaid.maxDepth = depth;
	return ok(`Следующий автоматический выход: эвакуация после этапа ${depth}.`);
}

function attemptAutoRaids(state: GameState, now: number, stoppedAtBoundary: ReadonlySet<string> = new Set()) {
	for (const scav of [...state.scavs].sort((a, b) => a.id.localeCompare(b.id))) {
		if (stoppedAtBoundary.has(scav.id)) continue;
		if (!scav.autoRaid.enabled || scav.status === "raiding") {
			scav.autoRaid.waitingReason = null;
			continue;
		}
		const map = ownValue(MAP_BY_ID, scav.autoRaid.mapId);
		if (!map) { scav.autoRaid.waitingReason = "Сектор не найден."; continue; }
		const result = startRaid(state, scav, map, now, true);
		scav.autoRaid.waitingReason = result.ok ? null : result.message;
	}
}

export function setAutoRaid(state: GameState, scavId: string, mapId: string | null, minHealth = 70, now = Date.now()): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	const map = mapId === null ? null : ownValue(MAP_BY_ID, mapId);
	if (!scav || (mapId !== null && !map)) return fail("Боец или сектор не найден.");
	if (!isTime(now) || !Number.isInteger(minHealth) || minHealth < 25 || minHealth > 100) return fail("Порог здоровья должен быть от 25 до 100.");
	if (map && state.level < map.level) return fail(`Сектор откроется на ${map.level} уровне.`);
	rebaseClock(state, now);
	simulateAdvance(state, now, mapId === null ? new Set([scavId]) : new Set());
	if (!state.scavs.includes(scav)) return fail("Боец не вернулся с последнего рейда.");
	if (!map) {
		scav.autoRaid.enabled = false;
		scav.autoRaid.waitingReason = null;
		scav.autoRaid.minHealth = minHealth;
		return ok("Автоматический маршрут остановлен. Текущий рейд завершится.");
	}
	scav.autoRaid.mapId = map.id;
	scav.autoRaid.minHealth = minHealth;
	scav.autoRaid.enabled = true;
	attemptAutoRaids(state, now);
	return ok(`${scav.name}: постоянный маршрут «${map.name}», здоровье от ${minHealth}%.`);
}

export function stopAllAutoRaids(state: GameState, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время.");
	rebaseClock(state, now);
	simulateAdvance(state, now, new Set(state.scavs.map((scav) => scav.id)));
	for (const scav of state.scavs) { scav.autoRaid.enabled = false; scav.autoRaid.waitingReason = null; }
	return ok("Постоянные маршруты остановлены. Бойцы закончат текущие рейды.");
}

/** Actions mutate the passed state; a rejected purchase never spends resources. */
export function dispatchRaid(
	state: GameState,
	scavId: string,
	mapId: string,
	now = Date.now()
): ActionResult {
	if (!isTime(now)) return fail("Некорректное время рейда.");
	const map = ownValue(MAP_BY_ID, mapId);
	if (!map || !state.scavs.some((scav) => scav.id === scavId)) return fail("Боец или сектор не найден.");
	if (state.level < map.level) return fail(`Сектор откроется на ${map.level} уровне.`);
	rebaseClock(state, now);
	advance(state, now);
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return fail("Боец не вернулся с последнего рейда.");
	return startRaid(state, scav, map, now, false);
}

export function equipWeapon(
	state: GameState,
	scavId: string,
	weaponInstanceId: string | null
): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return fail("Дикий не найден.");
	if (scav.status === "raiding")
		return fail("Снаряжение нельзя сменить во время рейда.");
	if (weaponInstanceId === null) {
		scav.weaponInstanceId = null;
		return ok("Оружие возвращено в арсенал.");
	}
	const weapon = state.weapons.find((item) => item.id === weaponInstanceId);
	if (!weapon) return fail("Оружие не найдено.");
	const owner = state.scavs.find(
		(item) => item.weaponInstanceId === weaponInstanceId && item.id !== scavId
	);
	if (owner?.status === "raiding") return fail("Это оружие сейчас в рейде.");
	if (owner) owner.weaponInstanceId = null;
	scav.weaponInstanceId = weaponInstanceId;
	return ok(`${scav.name} получил ${getWeaponDefinition(weapon).name}.`);
}

export function recruitScav(state: GameState): ActionResult {
	if (state.scavs.length >= getScavCapacity(state))
		return fail("Отряд полон. Улучши радиорубку для нового места.");
	const cost = recruitCost(state);
	if (state.money < cost) return fail(`Для найма нужно ${cost} ₽.`);
	state.money -= cost;
	const random = generator(takeSeed(state));
	const unusedNames = SCAV_NAMES.filter(
		(name) => !state.scavs.some((scav) => scav.name === name)
	);
	const names = unusedNames.length ? unusedNames : SCAV_NAMES;
	const scav = createScav(
		state,
		names[Math.floor(random() * names.length)]!,
		PERSONALITIES[Math.floor(random() * PERSONALITIES.length)]!.id,
		22 + Math.floor(random() * 19),
		23 + Math.floor(random() * 21)
	);
	const available = state.weapons.find(
		(weapon) => weapon.durability >= 10 && !state.scavs.some((item) => item.weaponInstanceId === weapon.id)
	);
	if (available) scav.weaponInstanceId = available.id;
	else if (cost === 0) {
		if (state.weapons.length < getStorageCapacity(state)) scav.weaponInstanceId = createWeapon(state, "pm", state.lastUpdated, 80).id;
		else {
			// A full ruined arsenal must not block the recovery kit or discard owned guns.
			const emergency = [...state.weapons].sort((a, b) => getWeaponDefinition(a).value - getWeaponDefinition(b).value || a.id.localeCompare(b.id))[0]!;
			emergency.durability = 70; scav.weaponInstanceId = emergency.id;
		}
	}
	if (cost === 0) {
		// A wiped roster can begin one recovery run immediately; this never stacks.
		state.money = Math.max(state.money, 15);
		state.supplies.ammo = Math.max(state.supplies.ammo, 3);
	}
	return ok(
		`${scav.name} присоединился к отряду${cost === 0 ? " бесплатно" : ""}.`
	);
}

export function upgradeBase(state: GameState, room: BaseRoom): ActionResult {
	if (!roomKeys.includes(room)) return fail("Помещение не найдено.");
	if (state.base[room] >= MAX_ROOM_LEVEL)
		return fail("Помещение уже на максимальном уровне.");
	const cost = getUpgradeCost(state, room);
	if (state.money < cost.money || state.supplies.scrap < cost.scrap)
		return fail(`Нужно ${cost.money} ₽ и ${cost.scrap} деталей.`);
	state.money -= cost.money;
	state.supplies.scrap -= cost.scrap;
	state.base[room]++;
	addXp(state, 12 * state.base[room]);
	return ok("Помещение улучшено. База стала сильнее.");
}

export function repairWeapon(
	state: GameState,
	weaponInstanceId: string
): ActionResult {
	const weapon = state.weapons.find((item) => item.id === weaponInstanceId);
	if (!weapon) return fail("Оружие не найдено.");
	if (state.raids.some((raid) => raid.weaponInstanceId === weapon.id))
		return fail("Оружие сейчас в рейде.");
	if (weapon.durability >= 100) return fail("Оружие уже в отличном состоянии.");
	const cost = getRepairCost(weapon);
	if (state.money < cost.money || state.supplies.scrap < cost.scrap)
		return fail(`Для ремонта нужно ${cost.money} ₽ и ${cost.scrap} деталей.`);
	state.money -= cost.money;
	state.supplies.scrap -= cost.scrap;
	weapon.durability = 100;
	return ok("Оружие отремонтировано до 100%.");
}

export function modWeapon(
	state: GameState,
	weaponInstanceId: string,
	attachment: Attachment
): ActionResult {
	const weapon = state.weapons.find((item) => item.id === weaponInstanceId);
	if (!weapon || !attachmentKeys.includes(attachment))
		return fail("Оружие или модуль не найден.");
	if (state.raids.some((raid) => raid.weaponInstanceId === weapon.id))
		return fail("Оружие сейчас в рейде.");
	if (weapon.attachments[attachment] >= 3)
		return fail("Этот модуль уже максимального уровня.");
	if (!isAttachmentCompatible(weapon, attachment)) return fail("Этот тип оружия не поддерживает модуль.");
	const cost = getModCost(weapon, attachment);
	if (state.money < cost.money || state.supplies.scrap < cost.scrap)
		return fail(`Для модуля нужно ${cost.money} ₽ и ${cost.scrap} деталей.`);
	state.money -= cost.money;
	state.supplies.scrap -= cost.scrap;
	weapon.attachments[attachment]++;
	return ok("Модуль установлен. Мощность оружия выросла.");
}

export function sellWeapon(
	state: GameState,
	weaponInstanceId: string
): ActionResult {
	const weapon = state.weapons.find((item) => item.id === weaponInstanceId);
	if (!weapon) return fail("Оружие не найдено.");
	if (state.raids.some((raid) => raid.weaponInstanceId === weapon.id))
		return fail("Оружие сейчас в рейде.");
	if (state.weapons.length <= 1)
		return fail("Последнюю пушку нужно оставить для отряда.");
	const value = getWeaponSaleValue(weapon);
	state.weapons = state.weapons.filter((item) => item.id !== weapon.id);
	state.scavs.forEach((scav) => {
		if (scav.weaponInstanceId === weapon.id) scav.weaponInstanceId = null;
	});
	addMoney(state, value);
	return ok(`Оружие продано за ${value} ₽.`);
}
export function getWeaponSaleValue(weapon: WeaponInstance): number {
	return Math.max(10, Math.round(getWeaponDefinition(weapon).value * (0.2 + weapon.durability * 0.003)));
}
export function getWeaponRecycleYield(weapon: WeaponInstance): number {
	return Math.max(1, Math.floor(getWeaponDefinition(weapon).value / 90 * (0.5 + weapon.durability / 200)));
}
export function recycleWeapon(state: GameState, weaponInstanceId: string): ActionResult {
	const weapon = state.weapons.find((item) => item.id === weaponInstanceId);
	if (!weapon) return fail("Оружие не найдено.");
	if (state.raids.some((raid) => raid.weaponInstanceId === weapon.id)) return fail("Оружие сейчас в рейде.");
	if (state.weapons.length <= 1) return fail("Последнюю пушку нужно оставить для отряда.");
	const amount = getWeaponRecycleYield(weapon);
	if (state.supplies.scrap + amount > getSupplyCapacity(state).scrap) return fail("Нет места для деталей.");
	state.weapons = state.weapons.filter((item) => item.id !== weapon.id);
	for (const scav of state.scavs) if (scav.weaponInstanceId === weapon.id) scav.weaponInstanceId = null;
	state.supplies.scrap += amount;
	return ok(`Разобрано: +${amount} деталей.`);
}

export function healScav(state: GameState, scavId: string): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return fail("Дикий не найден.");
	if (scav.status === "raiding") return fail("Боец сейчас в рейде.");
	if (scav.health >= 100) return fail("Боец уже здоров.");
	const medicine = Math.ceil(
		(100 - scav.health) / (25 + state.base.medbay * 5)
	);
	if (state.supplies.medicine < medicine)
		return fail(
			`Нужно ${medicine} медикаментов. Медблок лечит бесплатно со временем.`
		);
	state.supplies.medicine -= medicine;
	scav.health = 100;
	scav.status = "ready";
	return ok(`${scav.name} полностью восстановился.`);
}

export function claimContract(
	state: GameState,
	contractId: string
): ActionResult {
	const contract = CONTRACTS.find((item) => item.id === contractId);
	if (!contract) return fail("Задание не найдено.");
	if (state.claimedContracts.includes(contractId))
		return fail("Награда уже получена.");
	if (
		getContractLockReason(state, contract) !== null ||
		getContractProgress(state, contract) < contract.target
	)
		return fail("Условия задания ещё не выполнены.");
	state.claimedContracts.push(contractId);
	addMoney(state, contract.reward.money, false);
	addXp(state, contract.reward.xp);
	for (const key of Object.keys(
		contract.reward.supplies
	) as (keyof Supplies)[]) {
		addSupply(state, key, contract.reward.supplies[key] ?? 0);
	}
	return ok(`«${contract.name}»: награда получена.`);
}

export function getExpeditionChoices(state: GameState, raid: Raid, selectedPerk?: RunPerk) {
	const expedition = raid.expedition;
	if (!expedition || expedition.stage >= 3) return [];
	const map = ownValue(MAP_BY_ID, raid.mapId)!;
	const scav = state.scavs.find((item) => item.id === raid.scavId);
	const weapon = state.weapons.find((item) => item.id === raid.weaponInstanceId);
	const perks = [...expedition.perks];
	if (selectedPerk && expedition.offers.includes(selectedPerk)) perks.push(selectedPerk);
	return (Object.keys(EXPEDITION_BRANCHES) as ExpeditionBranch[]).map((branch) => {
		const definition = EXPEDITION_BRANCHES[branch];
		const stage = expedition.stage + 1;
		const money = 10 + map.level * 5 + (stage - 1) * 8;
		const ammo = Math.max(1, Math.ceil(map.ammoCost * TACTICS[raid.tactic].ammoMultiplier * definition.ammoMultiplier
			* expedition.ammoMultiplier * (expedition.loadout.ammoType === "piercing" ? 1.65 : 1)) + (perks.includes("pathfinder") ? 1 : 0));
		const intel = map.intelCost + (branch === "recon" ? 1 : 0);
		const chance = clamp(expedition.baseChance - (stage - 1) * 0.09 + definition.chanceBonus
			+ (weapon ? getWeaponRole(weapon).branches[branch] ?? 0 : 0)
			+ (perks.includes("careful") ? 0.06 : 0) - (perks.includes("haggler") ? 0.04 : 0), 0.15, 0.97);
		const duration = Math.max(20, Math.round(expedition.baseDuration * (1 + (stage - 1) * 0.16)
			* definition.durationMultiplier * (perks.includes("pathfinder") ? 0.8 : 1)));
		let reason: string | null = null;
		if (expedition.status !== "choice") reason = "Дождись контрольной точки.";
		else if (!scav || !weapon || weapon.durability < 10) reason = "Оружию нужен ремонт: пора эвакуироваться.";
		else if (scav.health < 25) reason = "Боец слишком тяжело ранен: пора эвакуироваться.";
		else if (state.money < money) reason = `Нужно ${money} ₽ на следующий этап.`;
		else if (state.supplies.ammo < ammo) reason = `Нужно ${ammo} патронов.`;
		else if (state.supplies.intel < intel) reason = `Нужно ${intel} разведданных.`;
		return { branch, label: definition.label, description: definition.description, money, ammo, intel, chance, duration, reason };
	});
}

function continueAtCheckpoint(state: GameState, raid: Raid, branch: ExpeditionBranch, perk: RunPerk, now: number): ActionResult {
	const expedition = raid.expedition;
	if (!expedition || expedition.status !== "choice") return fail("Боец ещё не дошёл до контрольной точки.");
	if (!expedition.offers.includes(perk)) return fail("Выбери один из найденных приёмов для этого выхода.");
	const quote = getExpeditionChoices(state, raid, perk).find((item) => item.branch === branch);
	if (!quote) return fail("Маршрут завершён: осталось эвакуироваться.");
	if (quote.reason) return fail(quote.reason);
	state.money -= quote.money; state.supplies.ammo -= quote.ammo; state.supplies.intel -= quote.intel;
	expedition.trail.push({ at: now, label: `Выбор · этап ${expedition.stage + 1}`, text: `${quote.label}. Приём: ${RUN_PERKS[perk].label}. Шанс ${Math.round(quote.chance * 100)}%; расход ${quote.money} ₽, ${quote.ammo} патронов${quote.intel ? `, ${quote.intel} разведданных` : ""}. Под риском весь груз: ${expedition.cargo.money} ₽ и трофеи.`, kind: "neutral" });
	expedition.perks.push(perk); expedition.offers = [];
	expedition.stage++; expedition.status = "travel"; expedition.branch = branch;
	raid.chance = quote.chance; raid.startedAt = now; raid.endsAt = now + quote.duration * 1000;
	return ok(`${raid.scavName}: этап ${expedition.stage}, ${quote.label.toLowerCase()}. Груз остаётся под риском.`);
}
export function continueExpedition(state: GameState, raidId: string, branch: ExpeditionBranch, perk: RunPerk, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время.");
	if (!Object.hasOwn(EXPEDITION_BRANCHES, branch) || !Object.hasOwn(RUN_PERKS, perk)) return fail("Неизвестный маршрут или приём.");
	advance(state, now);
	const raid = state.raids.find((item) => item.id === raidId);
	if (!raid) return fail("Этот выход уже завершён.");
	return continueAtCheckpoint(state, raid, branch, perk, now);
}
export function extractRaid(state: GameState, raidId: string, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время.");
	advance(state, now);
	const raid = state.raids.find((item) => item.id === raidId);
	if (!raid?.expedition || raid.expedition.status !== "choice") return fail("Эвакуация доступна на контрольной точке.");
	state.raids = state.raids.filter((item) => item.id !== raidId);
	const report = finishExpedition(state, raid, true, now);
	return ok(`${raid.scavName} эвакуирован: ${report.money} ₽ и доставленный груз.`);
}

function discoverBlueprint(state: GameState, expedition: Expedition, blueprint: string) {
	if (state.blueprints.includes(blueprint)) return;
	state.blueprints.push(blueprint); expedition.discoveries.push(blueprint);
}
function fitCargo(cargo: Cargo, capacity: number) {
	// Currency weighs nothing. Preserve previous cargo and favour real guns over bulk supplies.
	for (const key of ["ammo", "scrap", "medicine", "intel"] as (keyof Supplies)[]) {
		const weight = key === "ammo" ? 0.1 : key === "scrap" ? 0.5 : key === "medicine" ? 1 : 0.25;
		const overflow = getCargoWeight(cargo) - capacity;
		if (overflow <= 0) break;
		cargo.supplies[key] = Math.max(0, cargo.supplies[key] - Math.ceil((overflow - 0.00001) / weight));
	}
	while (getCargoWeight(cargo) > capacity && cargo.weaponIds.length > 0) cargo.weaponIds.pop();
}
function wearEquippedGear(state: GameState, scav: Scav, stage: number, failed: boolean) {
	for (const key of ["armorItemId", "backpackItemId"] as const) {
		const item = state.gearItems.find((gear) => gear.id === scav.loadout[key]);
		if (item) item.durability = Math.max(0, item.durability - (key === "armorItemId" ? 4 + stage * 2 + (failed ? 8 : 0) : 3 + stage));
	}
}
/** Resolve a checkpoint exactly once. A successful manual checkpoint remains an active raid. */
function reachCheckpoint(state: GameState, raid: Raid, now: number): RaidReport | null {
	const expedition = raid.expedition!;
	const map = ownValue(MAP_BY_ID, raid.mapId)!;
	const scav = state.scavs.find((item) => item.id === raid.scavId)!;
	const weapon = state.weapons.find((item) => item.id === raid.weaponInstanceId)!;
	const random = generator((raid.seed ^ Math.imul(expedition.stage, 0x45d9f3b)) >>> 0);
	const success = random() < raid.chance;
	const discoveriesBefore = expedition.discoveries.length;
	// Discoveries are radioed home on arrival, before the fight or attempted escape.
	discoverBlueprint(state, expedition, `route:${map.id}`);
	if (expedition.stage >= 2 && expedition.branch !== "recon") {
		discoverBlueprint(state, expedition, expedition.branch === "combat" ? "plate_armor" : "cargo_pack");
	}
	const discoveriesText = expedition.discoveries.slice(discoveriesBefore).map((blueprint) => BLUEPRINTS[blueprint]!.label).join(", ");
	const armor = ownValue(GEAR_MODEL_BY_ID, expedition.loadout.armorModelId);
	const protection = (armor?.protection ?? 0) * expedition.loadout.armorCondition / 100;
	const injury = TACTICS[raid.tactic].injuryMultiplier * (1 - raid.armorLevel * 0.1) * (1 - protection * 2)
		* (expedition.perks.includes("fieldMedic") ? 0.5 : 1) * (expedition.loadout.medkit ? 0.75 : 1);
	weapon.durability = Math.max(0, weapon.durability - Math.ceil((5 + random() * (7 + map.danger * 8) + expedition.stage * 2)
		* (expedition.perks.includes("gunsmith") ? 0.5 : 1)));
	wearEquippedGear(state, scav, expedition.stage, !success);
	if (!success) {
		expedition.trail.push({ at: now, label: `Засада · этап ${expedition.stage}`, text: `Маршрут «${EXPEDITION_BRANCHES[expedition.branch].label}» сорван. Невынесенный груз потерян.${discoveriesText ? ` По рации передано: ${discoveriesText}.` : ""}`, kind: "danger" });
		scav.health = Math.max(0, scav.health - Math.ceil((32 + random() * 35 + expedition.stage * 4) * injury));
		state.raids = state.raids.filter((item) => item.id !== raid.id);
		return finishExpedition(state, raid, false, now);
	}
	scav.health = Math.max(25, scav.health - Math.ceil((3 + random() * (8 + map.danger * 10) + expedition.stage * 2) * injury));
	const branch = EXPEDITION_BRANCHES[expedition.branch];
	const lootMultiplier = Math.max(0.3, (0.5 + expedition.stage * 0.25) * (1 + raid.lootBonus + branch.lootBonus)
		* (expedition.perks.includes("careful") ? 0.9 : 1));
	expedition.cargo.money += Math.round((map.reward[0] + random() * (map.reward[1] - map.reward[0])) * lootMultiplier
		* (expedition.perks.includes("haggler") ? 1.2 : 1));
	expedition.cargo.supplies.ammo += 2 + Math.floor(random() * (4 + map.level));
	expedition.cargo.supplies.medicine += random() < 0.45 ? 1 : 0;
	expedition.cargo.supplies.scrap += 2 + Math.floor(random() * (expedition.branch === "scavenge" ? 7 + map.level : 4 + map.level));
	expedition.cargo.supplies.intel += expedition.branch === "recon" ? 2 + Math.floor(random() * 2) : random() < 0.4 ? 1 : 0;
	const weaponChance = map.weaponChance * (expedition.branch === "combat" ? 1.15 : 0.7) + (expedition.perks.includes("gunsmith") ? 0.1 : 0);
	if (random() < weaponChance) {
		const weaponId = map.weapons[Math.min(map.weapons.length - 1, Math.floor(random() ** (1.5 - expedition.stage * 0.16) * map.weapons.length))]!;
		if (!state.discoveredWeapons.includes(weaponId)) state.discoveredWeapons.push(weaponId);
		expedition.cargo.weaponIds.push(weaponId);
	}
	fitCargo(expedition.cargo, expedition.capacity);
	expedition.trail.push({ at: now, label: `Контрольная точка ${expedition.stage}`, text: `Маршрут «${EXPEDITION_BRANCHES[expedition.branch].label}» пройден. В рюкзаке ${expedition.cargo.money} ₽, ${getCargoWeight(expedition.cargo)} ед. груза и ${expedition.cargo.weaponIds.length} ед. оружия.${discoveriesText ? ` Передано: ${discoveriesText}.` : ""}`, kind: "loot" });
	expedition.status = "choice";
	const candidates = (Object.keys(RUN_PERKS) as RunPerk[]).filter((perk) => !expedition.perks.includes(perk));
	expedition.offers = [];
	while (expedition.stage < 3 && expedition.offers.length < 2 && candidates.length) expedition.offers.push(candidates.splice(Math.floor(random() * candidates.length), 1)[0]!);
	if (!raid.isAuto) return null;
	if (expedition.stage < expedition.autoDepth) {
		const branch: ExpeditionBranch = raid.tactic === "cautious" ? "recon" : raid.tactic === "bold" ? "combat" : "scavenge";
		const result = continueAtCheckpoint(state, raid, branch, expedition.offers[0]!, now);
		if (result.ok) return null;
	}
	state.raids = state.raids.filter((item) => item.id !== raid.id);
	return finishExpedition(state, raid, true, now);
}

function finishExpedition(state: GameState, raid: Raid, success: boolean, now: number): RaidReport {
	const expedition = raid.expedition!;
	const map = ownValue(MAP_BY_ID, raid.mapId)!;
	const scav = state.scavs.find((item) => item.id === raid.scavId)!;
	const random = generator((raid.seed ^ Math.imul(expedition.stage, 0x6c078965)) >>> 0);
	const report: RaidReport = { id: id(state, "report"), raidId: raid.id, scavName: raid.scavName, mapId: raid.mapId,
		at: now, success, lostScav: false, lostWeapon: false, money: 0, supplies: emptySupplies(), weaponId: null,
		weaponAutoSold: false, description: "", isAuto: raid.isAuto, tactic: raid.tactic, events: [], depth: expedition.stage,
		discoveries: [...expedition.discoveries], lostCargo: success ? null : structuredClone(expedition.cargo) };
	state.stats.raidsCompleted++; scav.raids++;
	if (raid.isAuto) { state.stats.autoRaidsCompleted++; scav.autoRaid.runs++; }
	const oldLevel = scav.level;
	const xp = Math.round(map.xp * (success ? 0.8 : 0.25) * expedition.stage);
	addXp(state, xp); scav.xp += xp;
	if (success) {
		state.stats.raidsWon++; state.stats.mapWins[map.id] = (state.stats.mapWins[map.id] ?? 0) + 1;
		report.money = expedition.cargo.money;
		for (const key of Object.keys(report.supplies) as (keyof Supplies)[]) report.supplies[key] = addSupply(state, key, expedition.cargo.supplies[key]);
		for (const weaponId of expedition.cargo.weaponIds) {
			const definition = ownValue(WEAPON_BY_ID, weaponId)!;
			state.stats.weaponsFound++;
			if (["rare", "epic", "legendary"].includes(definition.rarity)) state.stats.rareWeaponsFound++;
			report.weaponId = weaponId;
			if (state.weapons.length < getStorageCapacity(state)) createWeapon(state, weaponId, now, 50 + Math.floor(random() * 46));
			else { report.weaponAutoSold = true; report.money += Math.round(definition.value * 0.35); }
		}
		addMoney(state, report.money);
		report.description = `Эвакуация после этапа ${expedition.stage}. Груз доставлен${report.weaponAutoSold ? "; лишний трофей продан" : ""}.`;
		const discarded = getCargoWeight({ money: 0, supplies: {
			ammo: expedition.cargo.supplies.ammo - report.supplies.ammo, medicine: expedition.cargo.supplies.medicine - report.supplies.medicine,
			scrap: expedition.cargo.supplies.scrap - report.supplies.scrap, intel: expedition.cargo.supplies.intel - report.supplies.intel }, weaponIds: [] });
		if (discarded > 0) report.description += " Часть припасов оставлена: склад полон.";
	} else {
		report.lostWeapon = random() < 0.2 + map.danger * 0.22 + (expedition.stage - 1) * 0.08;
		report.lostScav = random() < (map.danger * 0.08 + (expedition.stage - 1) * 0.018) * TACTICS[raid.tactic].fatalityMultiplier;
		if (report.lostWeapon || report.lostScav) {
			report.lostWeapon = true; state.weapons = state.weapons.filter((item) => item.id !== raid.weaponInstanceId); scav.weaponInstanceId = null;
		}
		if (report.lostScav) {
			state.scavs = state.scavs.filter((item) => item.id !== scav.id); state.stats.lostScavs++;
			state.gearItems = state.gearItems.filter((item) => ![scav.loadout.armorItemId, scav.loadout.backpackItemId].includes(item.id));
		}
		report.description = `Выход сорван на этапе ${expedition.stage}. Невынесенный груз потерян. ${report.lostScav ? "Боец пропал." : report.lostWeapon ? "Боец вернулся без оружия." : "Боец вернулся раненым."}`;
	}
	if (report.discoveries.length) report.description += " Переданные чертежи сохранены.";
	if (!report.lostScav) {
		scav.level = Math.min(15, 1 + Math.floor(Math.sqrt(scav.xp / 60)));
		scav.combat = Math.min(100, scav.combat + (scav.level - oldLevel) * 4);
		scav.scouting = Math.min(100, scav.scouting + (scav.level - oldLevel) * 3);
		scav.status = scav.health >= 25 ? "ready" : "wounded";
	}
	if (state.weapons.length === 0 && state.scavs.length > 0) {
		const survivor = state.scavs.find((item) => item.status !== "raiding");
		if (survivor) survivor.weaponInstanceId = createWeapon(state, "pm", now, 70).id;
	}
	report.events = [...expedition.trail, { at: now, label: success ? "Эвакуация" : report.lostScav ? "Связь потеряна" : "Отход", text: report.description + (success ? ` Доставлено ${report.money} ₽.` : ""), kind: success ? "success" : "danger" }];
	state.history.unshift(report); state.history.length = Math.min(state.history.length, 40);
	return report;
}

function finishRaid(state: GameState, raid: Raid): RaidReport {
	const map = ownValue(MAP_BY_ID, raid.mapId);
	if (!map) throw new Error("Неизвестный сектор");
	const scav = state.scavs.find((item) => item.id === raid.scavId)!;
	const weapon = state.weapons.find(
		(item) => item.id === raid.weaponInstanceId
	)!;
	const random = generator(raid.seed);
	const success = random() < raid.chance;
	const report: RaidReport = {
		id: id(state, "report"),
		raidId: raid.id,
		scavName: raid.scavName,
		mapId: map.id,
		at: raid.endsAt,
		success,
		lostScav: false,
		lostWeapon: false,
		money: 0,
		supplies: emptySupplies(),
		weaponId: null,
		weaponAutoSold: false,
		description: "",
		isAuto: raid.isAuto,
		tactic: raid.tactic,
		events: [],
		depth: 1,
		discoveries: [],
		lostCargo: null,
	};
	state.stats.raidsCompleted++;
	if (raid.isAuto) { state.stats.autoRaidsCompleted++; scav.autoRaid.runs++; }
	scav.raids++;
	const tactic = TACTICS[raid.tactic];
	const injuryMultiplier = tactic.injuryMultiplier * (1 - raid.armorLevel * 0.16);
	weapon.durability = Math.max(
		0,
		weapon.durability - 8 - Math.floor(random() * (7 + map.danger * 9))
	);
	if (success) {
		state.stats.raidsWon++;
		state.stats.mapWins[map.id] = (state.stats.mapWins[map.id] ?? 0) + 1;
		report.money = Math.round(
			(map.reward[0] + random() * (map.reward[1] - map.reward[0])) *
				(1 + raid.lootBonus)
		);
		report.supplies = {
			ammo: 3 + Math.floor(random() * (5 + map.level)),
			medicine: random() < 0.6 ? 1 + Math.floor(random() * 2) : 0,
			scrap: 2 + Math.floor(random() * (4 + map.level)),
			intel:
				random() < 0.45 + map.danger * 0.3 ? 1 + Math.floor(map.level / 5) : 0,
		};
		// The saved loot bonus already includes the tactic and backpack snapshot.
		const suppliesMultiplier = 1 + TACTICS[raid.tactic].lootBonus + raid.backpackLevel * 0.12;
		(Object.keys(report.supplies) as (keyof Supplies)[]).forEach((key) => {
			report.supplies[key] = Math.round(report.supplies[key] * suppliesMultiplier);
		});
		addMoney(state, report.money);
		(Object.keys(report.supplies) as (keyof Supplies)[]).forEach((key) => {
			state.supplies[key] += report.supplies[key];
		});
		addXp(state, map.xp);
		scav.xp += map.xp;
		scav.health = Math.max(
			25,
			scav.health - Math.ceil((3 + Math.floor(random() * (9 + map.danger * 12))) * injuryMultiplier)
		);
		if (random() < map.weaponChance) {
			const roll = random();
			const index = Math.min(
				map.weapons.length - 1,
				Math.floor(
					roll ** (1.45 - Math.min(0.4, raid.lootBonus)) * map.weapons.length
				)
			);
			report.weaponId = map.weapons[index]!;
			const foundDefinition = ownValue(WEAPON_BY_ID, report.weaponId);
			if (!foundDefinition) throw new Error("Неизвестное оружие в добыче");
			state.stats.weaponsFound++;
			if (["rare", "epic", "legendary"].includes(foundDefinition.rarity))
				state.stats.rareWeaponsFound++;
			if (!state.discoveredWeapons.includes(report.weaponId))
				state.discoveredWeapons.push(report.weaponId);
			if (state.weapons.length < getStorageCapacity(state))
				createWeapon(
					state,
					report.weaponId,
					raid.endsAt,
					55 + Math.floor(random() * 46)
				);
			else {
				report.weaponAutoSold = true;
				const value = Math.round(foundDefinition.value * 0.65);
				report.money += value;
				addMoney(state, value);
			}
		}
		report.description = report.weaponId
			? `Нашёл ${ownValue(WEAPON_BY_ID, report.weaponId)!.name}${report.weaponAutoSold ? " — арсенал полон, трофей продан" : ""}.`
			: "Вернулся с припасами. Оружейные ящики оказались пустыми.";
	} else {
		addXp(state, Math.floor(map.xp * 0.3));
		scav.xp += Math.floor(map.xp * 0.45);
		scav.health = Math.max(0, scav.health - Math.ceil((38 + Math.floor(random() * 40)) * injuryMultiplier));
		report.lostWeapon = random() < 0.33 + map.danger * 0.2;
		report.lostScav = random() < map.danger * 0.12 * tactic.fatalityMultiplier * (1 - raid.armorLevel * 0.18);
		if (report.lostWeapon || report.lostScav) {
			report.lostWeapon = true;
			state.weapons = state.weapons.filter((item) => item.id !== weapon.id);
			scav.weaponInstanceId = null;
		}
		if (report.lostScav) {
			state.scavs = state.scavs.filter((item) => item.id !== scav.id);
			state.stats.lostScavs++;
			report.description =
				"Связь оборвалась. Боец пропал, снаряжение потеряно.";
		} else
			report.description = report.lostWeapon
				? "Попал в засаду. Выбрался раненым, но потерял оружие."
				: "Засада сорвала вылазку. Боец вернулся раненым.";
	}
	if (!report.lostScav) {
		const oldLevel = scav.level;
		scav.level = Math.min(15, 1 + Math.floor(Math.sqrt(scav.xp / 60)));
		const growth = scav.level - oldLevel;
		scav.combat = Math.min(100, scav.combat + growth * 4);
		scav.scouting = Math.min(100, scav.scouting + growth * 3);
		scav.status = scav.health >= 25 ? "ready" : "wounded";
	}
	// If all equipment is lost, the last survivor gets a basic emergency pistol.
	if (state.weapons.length === 0 && state.scavs.length > 0) {
		const survivor = state.scavs.find((item) => item.status !== "raiding");
		if (survivor)
			survivor.weaponInstanceId = createWeapon(state, "pm", raid.endsAt, 70).id;
	}
	report.events = createRaidEvents(raid, report, map);
	state.history.unshift(report);
	state.history.length = Math.min(state.history.length, 40);
	return report;
}

function createRaidEvents(raid: Raid, report: RaidReport, map: RaidMap): RaidReport["events"] {
	const random = generator(raid.seed ^ 0x52c731ab);
	const search = ["Обследовал старый тайник.", "Проверил ящики у обходной тропы.", "Нашёл следы недавнего прохода."];
	return [
		{ at: raid.startedAt, label: "Отправление", text: `${raid.scavName} вышел в сектор «${map.name}». Тактика: ${TACTICS[raid.tactic].label}.`, kind: "neutral" },
		{ at: raid.startedAt + Math.round((raid.endsAt - raid.startedAt) * 0.32), label: "Поиск", text: search[Math.floor(random() * search.length)]!, kind: "neutral" },
		{ at: raid.startedAt + Math.round((raid.endsAt - raid.startedAt) * 0.65), label: "Контакт", text: report.success ? "Обошёл опасный участок и удержал маршрут." : "Попал в засаду. Пришлось бросить поиск и отходить.", kind: report.success ? "neutral" : "danger" },
		{ at: raid.endsAt, label: report.lostScav ? "Связь потеряна" : "Возвращение", text: report.description + (report.success ? ` Доставлено ${report.money} ₽ и припасы.` : ""), kind: report.success ? "success" : "danger" },
	];
}

function progressBase(state: GameState, elapsedMs: number) {
	state.clock.income += elapsedMs;
	state.clock.ammo += elapsedMs;
	state.clock.scrap += elapsedMs;
	state.clock.intel += elapsedMs;
	const incomeTicks = Math.floor(state.clock.income / 10_000);
	addMoney(state, Math.max(0, Math.min(incomeTicks * state.base.workshop, getRecoveryAllowance(state) - state.money)), false);
	state.clock.income %= 10_000;
	const ammoTicks = Math.floor(state.clock.ammo / 30_000);
	addSupply(state, "ammo", ammoTicks * state.base.workshop);
	state.clock.ammo %= 30_000;
	const scrapTicks = Math.floor(state.clock.scrap / 60_000);
	addSupply(state, "scrap", scrapTicks * state.base.workshop);
	state.clock.scrap %= 60_000;
	const intelTicks = Math.floor(state.clock.intel / 180_000);
	addSupply(state, "intel", intelTicks * state.base.radio);
	state.clock.intel %= 180_000;
	// Integer micro-health avoids drift across differently sized browser ticks.
	const recovery = elapsedMs * (40 + state.base.medbay * 25);
	state.scavs.forEach((scav) => {
		if (scav.status !== "raiding") {
			scav.health = Math.min(100_000_000, Math.round(scav.health * 1_000_000) + recovery) / 1_000_000;
			scav.status = scav.health >= 25 ? "ready" : "wounded";
		}
	});
}

/** Advances in event order, so one long offline tick equals many short ticks. */
export function advance(state: GameState, now = Date.now()): AdvanceSummary {
	if (isTime(now)) rebaseClock(state, now);
	return simulateAdvance(state, now);
}

function simulateAdvance(state: GameState, now: number, stoppedAtBoundary: ReadonlySet<string> = new Set()): AdvanceSummary {
	const summary: AdvanceSummary = {
		elapsedMs: 0,
		capped: false,
		money: 0,
		completed: [],
		completedCount: 0,
	};
	if (!isTime(now) || now < state.lastUpdated) return summary;
	if (now === state.lastUpdated) { attemptAutoRaids(state, now, stoppedAtBoundary); return summary; }
	const elapsed = now - state.lastUpdated;
	summary.elapsedMs = Math.min(elapsed, MAX_OFFLINE_MS);
	summary.capped = elapsed > MAX_OFFLINE_MS;
	const beforeMoney = state.money;
	const end = state.lastUpdated + summary.elapsedMs;
	let cursor = state.lastUpdated;
	while (true) {
		// Production and recovery for this timestamp precede settlements; all
		// simultaneous settlements precede resource competition for new exits.
		const due = state.raids.filter((raid) => raid.endsAt <= cursor && raid.expedition?.status !== "choice")
			.sort((a, b) => a.endsAt - b.endsAt || a.id.localeCompare(b.id));
		for (const raid of due) {
			let report: RaidReport | null;
			if (raid.expedition) report = reachCheckpoint(state, raid, cursor);
			else { state.raids = state.raids.filter((item) => item.id !== raid.id); report = finishRaid(state, raid); }
			if (report) {
				summary.completed.push(report); summary.completedCount++;
				if (summary.completed.length > 40) summary.completed.shift();
			}
		}
		attemptAutoRaids(state, cursor, cursor === end ? stoppedAtBoundary : new Set());
		if (cursor >= end) break;
		let next = end;
		for (const raid of state.raids) if (raid.expedition?.status !== "choice") next = Math.min(next, raid.endsAt);
		for (const scav of state.scavs) {
			if (!scav.autoRaid.enabled || scav.status === "raiding") continue;
			const map = ownValue(MAP_BY_ID, scav.autoRaid.mapId);
			const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId);
			if (!map || state.level < map.level || !weapon || weapon.durability < 10) continue;
			if (scav.health < scav.autoRaid.minHealth) {
				const wait = Math.ceil((scav.autoRaid.minHealth * 1_000_000 - Math.round(scav.health * 1_000_000)) / (40 + state.base.medbay * 25));
				next = Math.min(next, cursor + Math.max(1, wait));
			} else if (state.money < getRaidQuote(state, scav, map).money && state.money < getRecoveryAllowance(state))
				next = Math.min(next, cursor + 10_000 - state.clock.income);
			else if (state.supplies.ammo < getRaidAmmoCost(scav, map, state))
				next = Math.min(next, cursor + 30_000 - state.clock.ammo);
			else if (state.supplies.intel < map.intelCost)
				next = Math.min(next, cursor + 180_000 - state.clock.intel);
		}
		progressBase(state, next - cursor);
		cursor = next;
	}
	// Discarded offline time yields no income, healing or runs. Preserve the
	// remaining duration of a raid launched near the simulated eight-hour edge.
	const discarded = elapsed - summary.elapsedMs;
	if (discarded > 0) state.raids.forEach((raid) => {
		raid.startedAt += discarded;
		raid.endsAt += discarded;
	});
	state.lastUpdated = now;
	summary.money = state.money - beforeMoney;
	return summary;
}

export function saveGame(state: GameState): string {
	return JSON.stringify(state);
}

// Saves are reconstructed from an explicit schema; unknown fields never reach gameplay.
type ObjectValue = Record<string, unknown>;
function record(value: unknown): ObjectValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("object");
	return value as ObjectValue;
}
function fields(source: ObjectValue, allowed: string[]) {
	if (Object.keys(source).some((key) => !allowed.includes(key))) throw new Error("field");
}
function number(value: unknown, max = 1e15, min = 0, integer = false): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integer && !Number.isInteger(value))
	)
		throw new Error("number");
	return value;
}
function string(value: unknown, max = 80): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max)
		throw new Error("string");
	return value;
}
function bool(value: unknown): boolean {
	if (typeof value !== "boolean") throw new Error("boolean");
	return value;
}
function array<T>(
	value: unknown,
	max: number,
	parse: (value: unknown) => T
): T[] {
	if (!Array.isArray(value) || value.length > max) throw new Error("array");
	return value.map(parse);
}
function known(
	value: unknown,
	definitions: Readonly<Record<string, unknown>>
): string {
	const key = string(value);
	if (!Object.hasOwn(definitions, key)) throw new Error("unknown");
	return key;
}
function unique(values: string[]) {
	if (new Set(values).size !== values.length) throw new Error("duplicate");
}
function parseSupplies(value: unknown): Supplies {
	const source = record(value);
	fields(source, ["ammo", "medicine", "scrap", "intel"]);
	return {
		ammo: number(source.ammo),
		medicine: number(source.medicine),
		scrap: number(source.scrap),
		intel: number(source.intel),
	};
}
function parseWeapon(value: unknown): WeaponInstance {
	const source = record(value);
	fields(source, ["id", "weaponId", "durability", "foundAt", "attachments"]);
	const attachments = record(source.attachments);
	fields(attachments, attachmentKeys);
	return {
		id: string(source.id),
		weaponId: known(source.weaponId, WEAPON_BY_ID),
		durability: number(source.durability, 100),
		foundAt: number(source.foundAt),
		attachments: {
			optic: number(attachments.optic, 3, 0, true),
			magazine: number(attachments.magazine, 3, 0, true),
			stock: number(attachments.stock, 3, 0, true),
		},
	};
}
function parseGear(value: unknown): GearItem {
	const source = record(value);
	fields(source, ["id", "modelId", "durability"]);
	return { id: string(source.id), modelId: known(source.modelId, GEAR_MODEL_BY_ID), durability: number(source.durability, 100) };
}
function parseLoadout(value: unknown): Loadout {
	const source = record(value);
	fields(source, ["armorItemId", "backpackItemId", "ammoType", "medkit"]);
	if (source.ammoType !== "standard" && source.ammoType !== "piercing") throw new Error("ammo-type");
	return { armorItemId: source.armorItemId === null ? null : string(source.armorItemId),
		backpackItemId: source.backpackItemId === null ? null : string(source.backpackItemId),
		ammoType: source.ammoType, medkit: bool(source.medkit) };
}
function parseCargo(value: unknown): Cargo {
	const source = record(value);
	fields(source, ["money", "supplies", "weaponIds"]);
	return { money: number(source.money, 1e8), supplies: parseSupplies(source.supplies), weaponIds: array(source.weaponIds, 3, (value) => known(value, WEAPON_BY_ID)) };
}
function parseEvents(value: unknown, max: number): RaidReport["events"] {
	return array(value, max, (value) => {
		const event = record(value);
		fields(event, ["at", "label", "text", "kind"]);
		if (!["neutral", "loot", "danger", "success"].includes(event.kind as string)) throw new Error("event-kind");
		return { at: number(event.at), label: string(event.label, 50), text: string(event.text, 400), kind: event.kind as RaidReport["events"][number]["kind"] };
	});
}
function parseExpedition(value: unknown): Expedition | null {
	if (value === null) return null;
	const source = record(value);
	fields(source, ["stage", "status", "branch", "cargo", "perks", "offers", "discoveries", "loadout", "autoDepth", "baseChance", "baseDuration", "capacity", "ammoMultiplier", "trail"]);
	const loadout = record(source.loadout);
	fields(loadout, ["armorModelId", "armorCondition", "packModelId", "packCondition", "ammoType", "medkit"]);
	if (source.status !== "travel" && source.status !== "choice") throw new Error("checkpoint-status");
	if (loadout.ammoType !== "standard" && loadout.ammoType !== "piercing") throw new Error("ammo-type");
	const armorModelId = loadout.armorModelId === "none" ? "none" : known(loadout.armorModelId, GEAR_MODEL_BY_ID);
	const packModelId = loadout.packModelId === "none" ? "none" : known(loadout.packModelId, GEAR_MODEL_BY_ID);
	if (armorModelId !== "none" && ownValue(GEAR_MODEL_BY_ID, armorModelId)?.slot !== "armor") throw new Error("armor-slot");
	if (packModelId !== "none" && ownValue(GEAR_MODEL_BY_ID, packModelId)?.slot !== "backpack") throw new Error("pack-slot");
	const expedition: Expedition = { stage: number(source.stage, 3, 1, true), status: source.status,
		branch: known(source.branch, EXPEDITION_BRANCHES) as ExpeditionBranch, cargo: parseCargo(source.cargo),
		perks: array(source.perks, 2, (value) => known(value, RUN_PERKS) as RunPerk),
		offers: array(source.offers, 2, (value) => known(value, RUN_PERKS) as RunPerk),
		discoveries: array(source.discoveries, Object.keys(BLUEPRINTS).length, (value) => known(value, BLUEPRINTS)),
		loadout: { armorModelId, armorCondition: number(loadout.armorCondition, 100), packModelId, packCondition: number(loadout.packCondition, 100), ammoType: loadout.ammoType, medkit: bool(loadout.medkit) },
		autoDepth: number(source.autoDepth, 3, 1, true), baseChance: number(source.baseChance, 1), baseDuration: number(source.baseDuration, 600, 20),
		capacity: number(source.capacity, 40, 10), ammoMultiplier: number(source.ammoMultiplier, 4, 0.2), trail: parseEvents(source.trail, 9) };
	unique(expedition.perks); unique(expedition.offers); unique(expedition.discoveries);
	if (expedition.perks.length !== expedition.stage - 1 || expedition.offers.some((perk) => expedition.perks.includes(perk))
		|| (expedition.status === "choice" && expedition.stage < 3 ? expedition.offers.length !== 2 : expedition.offers.length !== 0)
		|| getCargoWeight(expedition.cargo) > expedition.capacity + 0.1 || expedition.trail.length === 0) throw new Error("checkpoint-state");
	return expedition;
}
function parseScav(value: unknown, version: number): Scav {
	const source = record(value);
	fields(source, ["id", "name", "personality", "level", "xp", "health", "combat", "scouting", "weaponInstanceId", "status", "raids", ...(version >= 2 ? ["tactic", "gear", "autoRaid"] : []), ...(version === 3 ? ["loadout"] : [])]);
	if (!["ready", "raiding", "wounded"].includes(source.status as string))
		throw new Error("status");
	let gear: Scav["gear"] = { armor: 0, backpack: 0 };
	let autoRaid: Scav["autoRaid"] = { mapId: "courtyard", enabled: false, minHealth: 70, runs: 0, waitingReason: null, maxDepth: 1 };
	if (version >= 2) {
		const gearSource = record(source.gear);
		const autoSource = record(source.autoRaid);
		fields(gearSource, ["armor", "backpack"]);
		fields(autoSource, ["mapId", "enabled", "minHealth", "runs", "waitingReason", ...(version === 3 ? ["maxDepth"] : [])]);
		gear = { armor: number(gearSource.armor, 3, 0, true), backpack: number(gearSource.backpack, 3, 0, true) };
		autoRaid = {
			mapId: known(autoSource.mapId, MAP_BY_ID), enabled: bool(autoSource.enabled),
			minHealth: number(autoSource.minHealth, 100, 25, true), runs: number(autoSource.runs, 1e9, 0, true),
			waitingReason: autoSource.waitingReason === null ? null : string(autoSource.waitingReason, 200),
			maxDepth: version === 3 ? number(autoSource.maxDepth, 3, 1, true) : 1,
		};
	}
	return {
		id: string(source.id),
		name: string(source.name, 30),
		personality: known(source.personality, PERSONALITY_BY_ID),
		level: number(source.level, 15, 1, true),
		xp: number(source.xp),
		health: number(source.health, 100),
		combat: number(source.combat, 100),
		scouting: number(source.scouting, 100),
		weaponInstanceId:
			source.weaponInstanceId === null ? null : string(source.weaponInstanceId),
		status: source.status as Scav["status"],
		raids: number(source.raids, 1e9, 0, true),
		tactic: version === 1 ? "balanced" : known(source.tactic, TACTICS) as RaidTactic,
		gear,
		loadout: version === 3 ? parseLoadout(source.loadout) : { armorItemId: null, backpackItemId: null, ammoType: "standard", medkit: false },
		autoRaid,
	};
}
function parseRaid(value: unknown, version: number): Raid {
	const source = record(value);
	fields(source, ["id", "scavId", "scavName", "mapId", "weaponInstanceId", "startedAt", "endsAt", "chance", "lootBonus", "seed", ...(version >= 2 ? ["isAuto", "tactic", "armorLevel", "backpackLevel"] : []), ...(version === 3 ? ["expedition"] : [])]);
	const startedAt = number(source.startedAt);
	const endsAt = number(source.endsAt);
	const expedition = version === 3 ? parseExpedition(source.expedition) : null;
	if ((expedition?.status === "choice" ? endsAt < startedAt : endsAt <= startedAt) || endsAt - startedAt > 600_000)
		throw new Error("duration");
	return {
		id: string(source.id),
		scavId: string(source.scavId),
		scavName: string(source.scavName, 30),
		mapId: known(source.mapId, MAP_BY_ID),
		weaponInstanceId: string(source.weaponInstanceId),
		startedAt,
		endsAt,
		chance: number(source.chance, 1),
		lootBonus: number(source.lootBonus, 2, -0.15),
		seed: number(source.seed, 4294967295, 1, true),
		isAuto: version === 1 ? false : bool(source.isAuto),
		tactic: version === 1 ? "balanced" : known(source.tactic, TACTICS) as RaidTactic,
		armorLevel: version === 1 ? 0 : number(source.armorLevel, 3, 0, true),
		backpackLevel: version === 1 ? 0 : number(source.backpackLevel, 3, 0, true),
		expedition,
	};
}
function parseReport(value: unknown, version: number): RaidReport {
	const source = record(value);
	fields(source, ["id", "raidId", "scavName", "mapId", "at", "success", "lostScav", "lostWeapon", "money", "supplies", "weaponId", "weaponAutoSold", "description", ...(version >= 2 ? ["isAuto", "tactic", "events"] : []), ...(version === 3 ? ["depth", "discoveries", "lostCargo"] : [])]);
	return {
		id: string(source.id),
		raidId: string(source.raidId),
		scavName: string(source.scavName, 30),
		mapId: known(source.mapId, MAP_BY_ID),
		at: number(source.at),
		success: bool(source.success),
		lostScav: bool(source.lostScav),
		lostWeapon: bool(source.lostWeapon),
		money: number(source.money),
		supplies: parseSupplies(source.supplies),
		weaponId:
			source.weaponId === null ? null : known(source.weaponId, WEAPON_BY_ID),
		weaponAutoSold: bool(source.weaponAutoSold),
		description: string(source.description, 300),
		depth: version === 3 ? number(source.depth, 3, 1, true) : 1,
		discoveries: version === 3 ? array(source.discoveries, Object.keys(BLUEPRINTS).length, (value) => known(value, BLUEPRINTS)) : [],
		lostCargo: version === 3 && source.lostCargo !== null ? parseCargo(source.lostCargo) : null,
		isAuto: version === 1 ? false : bool(source.isAuto),
		tactic: version === 1 ? "balanced" : known(source.tactic, TACTICS) as RaidTactic,
		events: version === 1 ? [] : parseEvents(source.events, version === 3 ? 10 : 4),
	};
}

/** Returns null for invalid/unsupported saves; no user-controlled object reaches gameplay. */
export function parseSave(raw: string): GameState | null {
	try {
		if (typeof raw !== "string" || raw.length > 200_000) return null;
		const source = record(JSON.parse(raw));
		if (source.schemaVersion !== 1 && source.schemaVersion !== 2 && source.schemaVersion !== SAVE_VERSION) return null;
		const version = source.schemaVersion;
		fields(source, ["schemaVersion", "createdAt", "lastUpdated", "money", "supplies", "xp", "level", "base", "scavs", "weapons", "raids", "history", "claimedContracts", "discoveredWeapons", "stats", "clock", "rng", "nextId", ...(version === 3 ? ["gearItems", "blueprints"] : [])]);
		const base = record(source.base);
		const stats = record(source.stats);
		const clock = record(source.clock);
		fields(base, roomKeys);
		fields(stats, ["raidsWon", "raidsCompleted", "weaponsFound", "rareWeaponsFound", "moneyEarned", "mapsVisited", "lostScavs", ...(version >= 2 ? ["autoRaidsCompleted", "mapWins"] : [])]);
		fields(clock, ["income", "ammo", "scrap", "intel"]);
		const mapWins: Record<string, number> = {};
		if (version >= 2) {
			const sourceWins = record(stats.mapWins);
			for (const [key, value] of Object.entries(sourceWins)) {
				known(key, MAP_BY_ID);
				mapWins[key] = number(value, 1e9, 0, true);
			}
		}
		const state: GameState = {
			schemaVersion: SAVE_VERSION,
			createdAt: number(source.createdAt),
			lastUpdated: number(source.lastUpdated),
			money: number(source.money),
			supplies: parseSupplies(source.supplies),
			xp: number(source.xp),
			level: number(source.level, 30, 1, true),
			base: {
				workshop: number(base.workshop, 5, 1, true),
				medbay: number(base.medbay, 5, 1, true),
				radio: number(base.radio, 5, 1, true),
				storage: number(base.storage, 5, 1, true),
			},
			scavs: array(source.scavs, 7, (value) => parseScav(value, version)),
			weapons: array(source.weapons, 65, parseWeapon),
			raids: array(source.raids, 7, (value) => parseRaid(value, version)),
			history: array(source.history, 40, (value) => parseReport(value, version)),
			claimedContracts: array(
				source.claimedContracts,
				CONTRACTS.length,
				(value) => {
					const contractId = string(value);
					if (!CONTRACTS.some((contract) => contract.id === contractId))
						throw new Error("contract");
					return contractId;
				}
			),
			discoveredWeapons: array(
				source.discoveredWeapons,
				Object.keys(WEAPON_BY_ID).length,
				(value) => known(value, WEAPON_BY_ID)
			),
			gearItems: version === 3 ? array(source.gearItems, 28, parseGear) : [],
			blueprints: version === 3 ? array(source.blueprints, Object.keys(BLUEPRINTS).length, (value) => known(value, BLUEPRINTS)) : ["light_vest", "scout_pack"],
			stats: {
				raidsWon: number(stats.raidsWon, 1e9, 0, true),
				raidsCompleted: number(stats.raidsCompleted, 1e9, 0, true),
				weaponsFound: number(stats.weaponsFound, 1e9, 0, true),
				rareWeaponsFound: number(stats.rareWeaponsFound, 1e9, 0, true),
				moneyEarned: number(stats.moneyEarned),
				mapsVisited: array(stats.mapsVisited, 6, (value) =>
					known(value, MAP_BY_ID)
				),
				lostScavs: number(stats.lostScavs, 1e9, 0, true),
				autoRaidsCompleted: version === 1 ? 0 : number(stats.autoRaidsCompleted, 1e9, 0, true),
				mapWins,
			},
			clock: {
				income: number(clock.income, 9999),
				ammo: number(clock.ammo, 29999),
				scrap: number(clock.scrap, 59999),
				intel: number(clock.intel, 179999),
			},
			rng: number(source.rng, 4294967295, 1, true),
			nextId: number(source.nextId, 1e12, 1, true),
		};
		// Only retained evidence can seed per-sector counters from an old save.
		if (version === 1) for (const report of state.history) if (report.success)
			state.stats.mapWins[report.mapId] = (state.stats.mapWins[report.mapId] ?? 0) + 1;
		const allIds = [
			...state.scavs.map((item) => item.id),
			...state.weapons.map((item) => item.id),
			...state.raids.map((item) => item.id),
			...state.history.map((item) => item.id),
			...state.gearItems.map((item) => item.id),
		];
		unique(allIds);
		unique(state.claimedContracts);
		unique(state.discoveredWeapons);
		unique(state.blueprints);
		unique(state.stats.mapsVisited);
		unique(state.history.map((report) => report.raidId));
		unique(
			state.scavs.flatMap((scav) =>
				scav.weaponInstanceId ? [scav.weaponInstanceId] : []
			)
		);
		unique(state.scavs.flatMap((scav) => [scav.loadout.armorItemId, scav.loadout.backpackItemId].filter((value): value is string => value !== null)));
		if (
			state.lastUpdated < state.createdAt ||
			state.weapons.length > getStorageCapacity(state) ||
			state.scavs.length > getScavCapacity(state)
		)
			throw new Error("capacity");
		if (state.level !== Math.min(30, 1 + Math.floor(Math.sqrt(state.xp / 90))))
			throw new Error("level");
		if (
			state.stats.raidsWon > state.stats.raidsCompleted ||
			state.stats.rareWeaponsFound > state.stats.weaponsFound ||
			state.stats.autoRaidsCompleted > state.stats.raidsCompleted ||
			Object.values(state.stats.mapWins).reduce((sum, wins) => sum + wins, 0) > state.stats.raidsWon ||
			state.history.length > state.stats.raidsCompleted ||
			state.scavs.reduce((sum, scav) => sum + scav.autoRaid.runs, 0) > state.stats.autoRaidsCompleted
		)
			throw new Error("stats");
		for (const scav of state.scavs) {
			if (!scav.id.startsWith("scav-") || scav.autoRaid.runs > scav.raids) throw new Error("scav-id");
			if (
				scav.weaponInstanceId &&
				!state.weapons.some((weapon) => weapon.id === scav.weaponInstanceId)
			)
				throw new Error("weapon");
			if (scav.level !== Math.min(15, 1 + Math.floor(Math.sqrt(scav.xp / 60))))
				throw new Error("scav-level");
			const raids = state.raids.filter((raid) => raid.scavId === scav.id);
			if ((scav.status === "raiding" ? 1 : 0) !== raids.length)
				throw new Error("raid-status");
			if (scav.status === "wounded" && scav.health >= 25)
				throw new Error("health-status");
			if (scav.status === "ready" && scav.health < 25)
				throw new Error("health-status");
			for (const [key, slot] of [["armorItemId", "armor"], ["backpackItemId", "backpack"]] as const) {
				const gearId = scav.loadout[key];
				if (gearId !== null && !state.gearItems.some((item) => item.id === gearId && getGearModel(item).slot === slot)) throw new Error("gear-owner");
			}
		}
		for (const raid of state.raids) {
			if (!raid.id.startsWith("raid-")) throw new Error("raid-id");
			if (
				!state.scavs.some(
					(scav) =>
						scav.id === raid.scavId &&
						scav.weaponInstanceId === raid.weaponInstanceId &&
						scav.gear.armor === raid.armorLevel && scav.gear.backpack === raid.backpackLevel
				)
			)
				throw new Error("raid-owner");
			if (!state.weapons.some((weapon) => weapon.id === raid.weaponInstanceId))
				throw new Error("raid-weapon");
			if (
				state.history.some((report) => report.raidId === raid.id) ||
				raid.startedAt > state.lastUpdated ||
				(raid.expedition?.status === "choice" ? raid.endsAt > state.lastUpdated : raid.endsAt <= state.lastUpdated)
			)
				throw new Error("raid-time");
			if (raid.expedition) {
				const scav = state.scavs.find((item) => item.id === raid.scavId)!;
				const armor = state.gearItems.find((item) => item.id === scav.loadout.armorItemId);
				const pack = state.gearItems.find((item) => item.id === scav.loadout.backpackItemId);
				const loadout = raid.expedition.loadout;
				if (loadout.armorModelId !== (armor?.modelId ?? "none") || loadout.packModelId !== (pack?.modelId ?? "none")
					|| loadout.ammoType !== scav.loadout.ammoType || loadout.medkit !== scav.loadout.medkit
					|| raid.expedition.discoveries.some((blueprint) => !state.blueprints.includes(blueprint))
					|| (raid.isAuto && raid.expedition.status === "choice")) throw new Error("raid-loadout");
				if (raid.expedition.trail.some((event, index) => event.at > state.lastUpdated || (index > 0 && event.at < raid.expedition!.trail[index - 1]!.at))) throw new Error("raid-trail-time");
			}
		}
		for (const weapon of state.weapons) if (!weapon.id.startsWith("gun-")) throw new Error("gun-id");
		for (const gear of state.gearItems) if (!gear.id.startsWith("gear-")) throw new Error("gear-id");
		for (const report of state.history) {
			if (!report.id.startsWith("report-") || !/^raid-[1-9]\d*$/.test(report.raidId) || Number(report.raidId.slice(5)) >= state.nextId) throw new Error("report-id");
			if ((report.lostScav && !report.lostWeapon) || (report.success && (report.lostScav || report.lostWeapon))) throw new Error("report-outcome");
			if (version < 3 && report.events.length !== 0 && report.events.length !== 4) throw new Error("story");
			if (report.events.some((event, index) => event.at > report.at || (index > 0 && event.at < report.events[index - 1]!.at))) throw new Error("story-time");
			unique(report.discoveries);
			if (report.discoveries.some((blueprint) => !state.blueprints.includes(blueprint)) || (report.success && report.lostCargo !== null)) throw new Error("report-discovery");
		}
		if (
			allIds.some(
				(value) =>
					!/^(gun|scav|raid|report|gear)-[1-9]\d*$/.test(value) ||
					Number(value.split("-")[1]) >= state.nextId
			)
		)
			throw new Error("id-sequence");
		return state;
	} catch {
		return null;
	}
}

export function loadGame(
	raw: string | null,
	now = Date.now()
): GameState | null {
	return loadGameWithSummary(raw, now)?.state ?? null;
}

export function loadGameWithSummary(raw: string | null, now = Date.now()): { state: GameState; summary: AdvanceSummary } | null {
	if (!raw || !isTime(now)) return null;
	const state = parseSave(raw);
	if (!state) return null;
	// A local clock moving backwards must not leave raids stalled indefinitely.
	rebaseClock(state, now);
	const summary = advance(state, now);
	return { state, summary };
}
