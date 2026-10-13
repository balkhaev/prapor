import {
	CONTRACTS,
	MAP_BY_ID,
	PERSONALITY_BY_ID,
	WEAPON_BY_ID,
	type Attachment,
	type BaseRoom,
	type Contract,
	type RaidMap,
	type Supplies,
	type WeaponDefinition,
} from "./data";
import { GEAR_LABELS, MAX_GEAR_LEVEL, TACTICS, type GearSlot, type GearEquipmentSlot, type RaidTactic } from "./operations";
export { GEAR_LABELS, GEAR_EQUIPMENT_LABELS, MAX_GEAR_LEVEL, TACTICS, type GearSlot, type GearEquipmentSlot, type RaidTactic } from "./operations";
import { BLUEPRINTS, EXPEDITION_BRANCHES, GEAR_MODEL_BY_ID, MARKET_OFFERS, RUN_PERKS, WEAPON_ROLES, type AmmoType, type Cargo, type ExpeditionBranch, type GearItem, type Loadout, type RunPerk } from "./systems";
export * from "./systems";
import { FACTORY_KITS, getResolvedModuleMounts, MODULE_BY_ID, MODULE_MODELS, MODULE_SLOTS, MODULE_SLOT_LABELS, modulePlatformLabel, RECEIVER_INFO, type ModuleInstance, type ModuleSlot } from "./modules";
export * from "./modules";
import { initialShelter, ROOM_DEFINITIONS, RESOURCE_RECIPE_BY_ID, getShelterSites, getShelterFrontier, isShelterSiteCoordinate, MAX_SHELTER_SITES, SHELTER_COORDINATE_LIMIT, SHELTER_EXCAVATION, type ProductionJob, type RoomInstance, type ShelterCost, type ShelterRoomType, type ShelterSite, type ShelterExpansion, type ShelterState } from "./shelter";
export * from "./shelter";
import { getRaidFieldFrame, getRaidFieldOutcome, getRaidFieldPlan, type RaidFieldPlan } from "../raid-field";
import { buildRecruitmentBoard, chooseRecruitCandidateAppearance, createRecruitmentState, getEarnedRecruitmentTier, getRecruitmentBoard, getScavProfileEffects, getScavTalentOffers, isRecruitDrawbackForRole, isRecruitTraitForRole, neutralScavProfile, RECOVERY_RECRUIT_ID, RECRUIT_BACKGROUNDS, RECRUIT_DRAWBACKS, RECRUIT_ROLES, RECRUIT_TRAITS, SCAV_TALENTS, stepRecruitmentSeed, type RecruitCandidate, type RecruitmentState, type RecruitRole, type RecruitTier, type ScavProfile } from "./recruitment";
export * from "./recruitment";
import { chooseScavAppearance, defaultScavAppearance, isScavAppearance } from "./scav-appearances";
import { createScavStory, getScavStoryEffects, noteScavProduction, noteScavRaid, rememberLostScav, validateScavStory, SCAV_STORY_EVENTS, MAX_SCAV_MEMORIES, MAX_SCAV_MEMORIALS, type ScavStory, type ScavMemory, type ScavMemorial, type ScavEventId } from "./scav-stories";
export * from "./scav-stories";
import { createSquadSocialState, ensureSquadPairs, removeSquadMember, getRoomSocialEffects, getRaidSocialSupport, creditSquadWork, getSocialProductionWorkers, noteSquadProduction, discardSquadWork, noteSquadDispatch, noteSquadRaid, parseSquadSocialState, validateSquadSocialState, rebaseSquadSocialClock, resolveSocialEvent as resolveSquadSocialEvent, getSquadSocialEvents, type SquadSocialState } from "./squad-bonds";
export * from "./squad-bonds";
import { getSquadRaidQuote, getRaidGroup, createSquadRaidSnapshot, planSquadRaidActions, squadInjuryMultiplier, parseSquadRaidSnapshot, validateSquadRaids, type SquadRaidSnapshot, type SquadRaidReport } from "./squad-raids";
export * from "./squad-raids";
import { createAchievementState, parseAchievementState, validateAchievementState, rebaseAchievementClock, noteAchievementBuild, noteAchievementTransfer, noteAchievementInstalled, noteAchievementDispatch, noteAchievementCheckpoint, noteAchievementContinue, noteAchievementExtract, noteAchievementRaidFinished, noteAchievementLoot, noteAchievementSupply, prepareAchievementPayment, noteAchievementPaid, prepareAchievementCraft, noteAchievementCrafted, prepareAchievementRecycle, noteAchievementRecycled, creditAchievementWork, noteAchievementUpgrade, noteAchievementUpgradeDone, noteAchievementAssignment, noteAchievementSocialDecision, noteAchievementJobDone, noteAchievementCancelled, pruneAchievementPeople, pruneAchievementInventory, type AchievementState } from "./achievements";
export * from "./achievements";
import { getWeaponMechanics, getWeaponRouteEffect, type WeaponRaidSnapshot } from "./weapon-mechanics";
export * from "./weapon-mechanics";
import { AMMO_BY_ID, getAmmoModel, getAmmoEffect, getAmmoSupplyMultiplier, isAmmoType } from "./ammunition";
import { ARSENAL_SAVE_VERSION, moduleAvailableInSave, weaponAvailableInSave } from "./catalog-releases";
export * from "./ammunition";
import { RAID_OBJECTIVES, RAID_PREPARATIONS, getRaidStrategy, getRaidStrategyEffects, parseRaidPlan, parseRaidStrategy, parseSectorIntel, parseSectorIntelRecord, settleSectorIntel, type RaidObjective, type RaidPreparation, type RaidPlan, type RaidStrategy, type SectorIntel } from "./raid-strategy";
export * from "./raid-strategy";
import { FIELD_KITS, FIELD_KIT_CAPACITY, getProductionReserve, getFieldKitStock, ensureShelterLogistics, getFieldKitEffects, type FieldKit, type FieldKitSelection } from "./shelter-logistics";
export * from "./shelter-logistics";
import { getLootModel, getLootTraderPrice, parseLootItem, rollRaidLoot, type LootItem } from "./loot";
export * from "./loot";
export * from "./trade";
import { getBarterQuote } from "./barter";
export * from "./barter";

export const SAVE_KEY = "prapor.save.v1";
export const SAVE_VERSION = 18;
export const MAX_PENDING_LOOT_DELIVERIES = 128;
export const PENDING_LOOT_RAID_LIMIT = 96;
export const MAX_OFFLINE_MS = 8 * 60 * 60 * 1000;
export const MAX_ROOM_LEVEL = 5;

export interface WeaponInstance {
	id: string;
	weaponId: string;
	durability: number;
	attachments: Record<Attachment, number>;
	foundAt: number;
	modules: Partial<Record<ModuleSlot, ModuleInstance>>;
}
export interface Scav {
	id: string;
	name: string;
	personality: string;
	/** Persistent visual identity; older callers may omit it. */
	appearance?: number;
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
	assignment: string | null;
	profile: ScavProfile;
	story: ScavStory;
	autoRaid: { mapId: string; enabled: boolean; minHealth: number; runs: number; waitingReason: string | null; maxDepth: number };
	/** A future order; changes never alter an already paid sortie. */
	raidPlan?: RaidPlan;
	fieldKit?: FieldKitSelection;
}
export interface Expedition {
	stage: number; status: "travel" | "choice"; branch: ExpeditionBranch;
	cargo: Cargo; perks: RunPerk[]; offers: RunPerk[]; discoveries: string[];
	loadout: { armorModelId: string; armorCondition: number; helmetModelId?: string | null; helmetCondition?: number; packModelId: string; packCondition: number; ammoType: AmmoType; medkit: boolean };
	autoDepth: number;
	baseChance: number; baseDuration: number; capacity: number; ammoMultiplier: number;
	trail: RaidReport["events"];
	legacyLoot: boolean;
	gunCombatBonus: number;
	/** Absent on pre-mechanics expeditions, which retain their original rules. */
	weaponMechanics?: WeaponRaidSnapshot;
	/** Paid ammunition choice and its costs remain fixed throughout a sortie. */
	ammunition?: { modelId: string; firstBonus: number; wearMultiplier: number; ammoMultiplier: number };
	/** A recon stage is credited only if the sortie later extracts successfully. */
	reconCompleted?: boolean;
	/** Paid sorties retain the loot catalogue that existed when they departed. */
	lootCatalogVersion?: number;
}
export interface Raid {
	id: string;
	scavId: string;
	scavName: string;
	scavAppearance?: number;
	mapId: string;
	weaponInstanceId: string;
	startedAt: number;
	endsAt: number;
	chance: number;
	lootBonus: number;
	seed: number;
	/** Private server outcome seed; visual routes continue to use seed. Never sent to browsers. */
	outcomeSeed?: number;
	isAuto: boolean;
	tactic: RaidTactic;
	armorLevel: number;
	backpackLevel: number;
	/** Null only for a migrated sortie: its original seed and payout settle once. */
	expedition: Expedition | null;
	/** Each physical sortie stays independent; this links its coordinated party. */
	squad?: SquadRaidSnapshot;
	strategy?: RaidStrategy;
	fieldKit?: FieldKit;
	/** New finds use a private independent stream; migrated sorties retain their paid loot rules. */
	lootVersion?: 1;
}
export interface RaidReport {
	id: string;
	raidId: string;
	scavName: string;
	scavAppearance?: number;
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
	moduleIds: string[];
	squad?: SquadRaidReport;
	strategy?: RaidStrategy;
	sectorOutcome?: SectorIntel;
	reconCompleted?: boolean;
	fieldKit?: FieldKit;
	lootItems?: LootItem[];
	lootAutoSold?: { item: LootItem; money: number }[];
	/** Intact named trophies awaiting space; historical automatic sales remain historical. */
	lootPending?: LootItem[];
}
export interface LootDelivery { id: string; raidId: string; at: number; items: LootItem[] }
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
	modules: ModuleInstance[];
	shelter: ShelterState;
	recruitment: RecruitmentState;
	memorials: ScavMemorial[];
	social: SquadSocialState;
	achievements: AchievementState;
	sectorIntel?: Record<string, SectorIntel>;
	lootItems?: LootItem[];
	pendingLoot?: LootDelivery[];
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
	for (const person of [...state.scavs, ...state.memorials]) {
		person.story.joinedAt = Math.max(0, person.story.joinedAt - shift);
		for (const memory of person.story.memories) memory.at = Math.max(0, memory.at - shift);
		if (person.story.pending) person.story.pending.at = Math.max(0, person.story.pending.at - shift);
	}
	for (const memorial of state.memorials) memorial.at = Math.max(0, memorial.at - shift);
	rebaseSquadSocialClock(state, shift);
	rebaseAchievementClock(state, shift);
	for (const report of state.history) {
		report.at = Math.max(0, report.at - shift);
		for (const event of report.events) event.at = Math.max(0, event.at - shift);
	}
	for (const delivery of state.pendingLoot ?? []) delivery.at = Math.max(0, delivery.at - shift);
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
const outcomeSeedSources = new WeakMap<GameState, () => number>();
/** Server-only runtime policy, deliberately absent from saved and public state. */
export function setGameOutcomeSeedSource(state: GameState, source: () => number): void { outcomeSeedSources.set(state, source); }
function renewRaidOutcomeSeed(state: GameState, raid: Raid): void {
	const source = outcomeSeedSources.get(state); if (!source) return;
	const seed = source(); if (!Number.isInteger(seed) || seed < 1 || seed > 4294967295) throw new Error("Invalid private outcome seed");
	raid.outcomeSeed = seed;
}
function addXp(state: GameState, xp: number) {
	state.xp += xp;
	state.level = Math.min(30, 1 + Math.floor(Math.sqrt(state.xp / 90)));
}
function addMoney(state: GameState, amount: number, earned = true) {
	state.money += amount;
	if (earned) state.stats.moneyEarned += amount;
}
/** Only verified market settlement calls this credit; rejects invalid or overflowing amounts. */
export function creditMarketMoney(state: GameState, amount: number): ActionResult {
	if (!Number.isSafeInteger(amount) || amount < 0 || state.money + amount > 1e15 || state.stats.moneyEarned + amount > 1e15) return fail("Некорректная сумма выплаты.");
	addMoney(state, amount); return ok(`Получено ${amount} ₽.`);
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
		modules: {},
	};
	fillFactoryKit(state, weapon);
	state.weapons.push(weapon);
	if (!state.discoveredWeapons.includes(weaponId))
		state.discoveredWeapons.push(weaponId);
	return weapon;
}
function createModule(state: GameState, modelId: string, now: number, durability = 100): ModuleInstance {
	return { id: id(state, "module"), modelId, durability, foundAt: now };
}
function fillFactoryKit(state: GameState, weapon: WeaponInstance) {
	for (const [slot, modelId] of Object.entries(FACTORY_KITS[weapon.weaponId]!)) weapon.modules[slot as ModuleSlot] = createModule(state, modelId, weapon.foundAt, slot === "receiver" ? weapon.durability : 100);
	if (attachmentKeys.some((key) => weapon.attachments[key] > 0)) weapon.modules.receiver!.legacyAttachments = { ...weapon.attachments };
}
function createScav(
	state: GameState,
	name: string,
	personality: string,
	combat: number,
	scouting: number,
	appearance?: number
): Scav {
	const scavId = id(state, "scav");
	const scav: Scav = {
		id: scavId,
		name,
		personality,
		appearance: appearance ?? chooseScavAppearance(personality, `${scavId}:${name}`, state.scavs.map((item) => item.appearance ?? defaultScavAppearance(item.personality))),
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
		loadout: { armorItemId: null, helmetItemId: null, backpackItemId: null, ammoType: "standard", medkit: false },
		assignment: null,
		profile: neutralScavProfile(),
		story: createScavStory(`scav-${state.nextId - 1}`, state.lastUpdated, true),
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
		modules: [],
		shelter: initialShelter({ workshop: 1, medbay: 1, radio: 1, storage: 1 }),
		recruitment: { rng: 1, generation: 1, tier: 0, boardTier: 0, boardSeed: 1, board: [], hiredCandidateIds: [] },
		memorials: [],
		social: { pairs: [], losses: [] },
		achievements: createAchievementState(),
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
		createScav(state, "Борода", "veteran", 36, 31, 0),
		createScav(state, "Рыжий", "collector", 29, 42, 1),
		createScav(state, "Шустрый", "runner", 27, 35, 2),
	];
	scavs.forEach((scav, index) => {
		scav.weaponInstanceId = guns[index]!.id;
	});
	for (const modelId of ["handguard-sks-rail", "optic-reflex", "stock-sks-folding", "magazine-sks-7.62x39-quick"]) state.modules.push(createModule(state, modelId, now));
	state.recruitment = createRecruitmentState(state);
	ensureSquadPairs(state);
	return state;
}

export function getWeaponDefinition(weapon: WeaponInstance): WeaponDefinition {
	const definition = ownValue(WEAPON_BY_ID, weapon.weaponId);
	if (!definition) throw new Error("Неизвестное оружие");
	return definition;
}
export function getWeaponPower(weapon: WeaponInstance): number {
	return getWeaponStats(weapon).power;
}
export function getModuleDefinition(item: ModuleInstance) {
	const model = ownValue(MODULE_BY_ID, item.modelId);
	if (!model) throw new Error("Неизвестная оружейная деталь");
	return model;
}
export function getModuleEffectiveStats(item: ModuleInstance) {
	const stats = getModuleDefinition(item).stats, condition = item.durability < 10 ? 0 : clamp(item.durability, 0, 100) / 100;
	// Wear removes a part's benefits, never its physical drawbacks. Lower recoil is a benefit.
	const effect = (value: number, lowerIsBetter = false) => (lowerIsBetter ? value < 0 : value > 0) ? condition ? value * condition : 0 : value;
	return { damage: effect(stats.damage), ergonomics: effect(stats.ergonomics), recoil: effect(stats.recoil, true),
		reliability: effect(stats.reliability), weight: stats.weight, ammoMultiplier: stats.ammoMultiplier };
}
function moduleFitReason(weapon: WeaponInstance, item: ModuleInstance): string | null {
	const model = getModuleDefinition(item), info = RECEIVER_INFO[weapon.weaponId]!;
	if (model.slot === "receiver" && model.weaponId !== weapon.weaponId) return "Эта ствольная коробка относится к другой пушке. Собери её отдельно.";
	if (!model.platforms.includes("*") && !model.platforms.includes(info.platform)) return `Нужна платформа ${model.platforms.map(modulePlatformLabel).join(" / ")}; у пушки ${modulePlatformLabel(info.platform)}.`;
	if (!model.calibers.includes("*") && !model.calibers.includes(info.caliber)) return `Калибр ${model.calibers.join(" / ")} не подходит к ${info.caliber}.`;
	if (model.requiresMount && !getResolvedModuleMounts(weapon.modules, model.slot).includes(model.requiresMount)) {
		const label = model.requiresMount === "rail-top" ? "верхней планки" : model.requiresMount === "rail-bottom" ? "нижней планки цевья"
			: model.requiresMount === "rail-side" ? "боковой планки" : model.requiresMount === "barrel-clamp" ? "открытого ствола для хомута"
				: model.requiresMount === "barrel-clamp-wide" ? "места для широкого хомута ствола"
				: model.requiresMount === "dovetail" ? "ласточкиного хвоста" : model.requiresMount === "pistol-rail" ? "аксессуарного паза рамки пистолета" : `резьбы ${info.caliber}`;
		return `Нет крепления ${label}.`;
	}
	return null;
}
export function getWeaponBuildIssues(weapon: WeaponInstance): string[] {
	const issues: string[] = [];
	for (const slot of RECEIVER_INFO[weapon.weaponId]!.requiredSlots) {
		const part = weapon.modules[slot];
		if (!part) issues.push(`Нет детали: ${MODULE_SLOT_LABELS[slot].toLowerCase()}.`);
		else if (part.durability < 10) issues.push(`Нужен ремонт: ${MODULE_SLOT_LABELS[slot].toLowerCase()}.`);
	}
	for (const [slot, part] of Object.entries(weapon.modules)) {
		if (getModuleDefinition(part).slot !== slot) issues.push("Деталь установлена в неправильный слот.");
		const reason = moduleFitReason(weapon, part);
		if (reason) issues.push(reason);
	}
	return issues;
}
export function getWeaponStats(weapon: WeaponInstance) {
	const definition = getWeaponDefinition(weapon);
	const baseRecoil = { pistol: 38, shotgun: 72, smg: 45, rifle: 60, sniper: 65 }[definition.category];
	const baseErgo = { pistol: 70, shotgun: 45, smg: 60, rifle: 50, sniper: 40 }[definition.category];
	const legacy = weapon.modules.receiver?.legacyAttachments ?? { optic: 0, magazine: 0, stock: 0 };
	let damage = definition.power + legacy.optic * 4 + legacy.magazine * 3 + legacy.stock * 3;
	let ergonomics = baseErgo, recoil = baseRecoil, reliability = definition.reliability - (100 - clamp(weapon.durability, 0, 100)) * 0.2, weight = 0, ammoMultiplier = 1;
	for (const part of Object.values(weapon.modules)) {
		const model = getModuleDefinition(part), effective = getModuleEffectiveStats(part);
		damage += effective.damage; ergonomics += effective.ergonomics;
		recoil += effective.recoil; reliability += effective.reliability;
		weight += effective.weight; ammoMultiplier *= effective.ammoMultiplier;
		if (model.slot !== "receiver" && RECEIVER_INFO[weapon.weaponId]!.requiredSlots.includes(model.slot)) reliability -= (100 - part.durability) * 0.025;
	}
	const issues = getWeaponBuildIssues(weapon), ready = issues.length === 0 && weapon.durability >= 10;
	return { damage: Math.max(1, Math.round(damage)), power: ready ? Math.round(Math.max(1, damage) * (0.35 + weapon.durability * 0.0065)) : 0,
		ergonomics: Math.round(clamp(ergonomics, 0, 100)), recoil: Math.round(clamp(recoil, 0, 100)), reliability: Math.round(clamp(reliability, 10, 100)),
		weight: Math.round(weight * 100) / 100, ammoMultiplier, ready, issues };
}
export function getModuleCapacity(state: GameState): number { return 40 + state.base.storage * 20 + extraStorageLevels(state) * 12; }
export function getModuleInstallReason(state: GameState, gunId: string, moduleId: string): string | null {
	const weapon = state.weapons.find((gun) => gun.id === gunId), item = state.modules.find((part) => part.id === moduleId);
	if (!weapon || !item) return "Пушка или свободная деталь не найдена.";
	if (state.raids.some((raid) => raid.weaponInstanceId === gunId)) return "Сборка зафиксирована: пушка сейчас в рейде.";
	const slot = getModuleDefinition(item).slot;
	const preview = { ...weapon, modules: { ...weapon.modules, [slot]: item } };
	const reason = moduleFitReason(preview, item);
	if (reason) return reason;
	for (const installed of Object.values(preview.modules)) {
		const dependency = moduleFitReason(preview, installed);
		if (dependency) return `Сначала сними «${getModuleDefinition(installed).label}»: ${dependency}`;
	}
	if (getWeaponStats(weapon).ready && !getWeaponStats(preview).ready && !state.weapons.some((other) => other.id !== gunId && getWeaponStats(other).ready)) return "Нельзя вывести из строя последнюю готовую пушку отряда.";
	return null;
}
export function installModule(state: GameState, gunId: string, moduleId: string): ActionResult {
	const reason = getModuleInstallReason(state, gunId, moduleId); if (reason) return fail(reason);
	const weapon = state.weapons.find((gun) => gun.id === gunId)!, item = state.modules.find((part) => part.id === moduleId)!;
	const before = structuredClone(weapon);
	noteAchievementBuild(state, weapon);
	const slot = getModuleDefinition(item).slot, old = weapon.modules[slot];
	if (old) noteAchievementTransfer(state, weapon, [old]);
	state.modules = state.modules.filter((part) => part.id !== moduleId);
	if (old) state.modules.push(old);
	weapon.modules[slot] = item;
	if (slot === "receiver") { weapon.durability = item.durability; weapon.attachments = { ...(item.legacyAttachments ?? { optic: 0, magazine: 0, stock: 0 }) }; }
	noteAchievementInstalled(state, before, weapon, item);
	return ok(`${getModuleDefinition(item).label} установлен. ${old ? "Снятая деталь возвращена на стойку." : ""}`);
}
export function getModuleRemoveReason(state: GameState, gunId: string, slot: ModuleSlot): string | null {
	const weapon = state.weapons.find((gun) => gun.id === gunId);
	if (!weapon || !MODULE_SLOTS.includes(slot) || !weapon.modules[slot]) return "Установленная деталь не найдена.";
	if (slot === "receiver") return "Коробка — основа пушки. Используй полный разбор сборки.";
	if (state.raids.some((raid) => raid.weaponInstanceId === gunId)) return "Пушка сейчас в рейде.";
	if (state.modules.length >= getModuleCapacity(state)) return "Стойка деталей полна.";
	const preview = { ...weapon, modules: { ...weapon.modules } }; delete preview.modules[slot];
	for (const part of Object.values(preview.modules)) { const reason = moduleFitReason(preview, part); if (reason) return `Сначала сними «${getModuleDefinition(part).label}»: ${reason}`; }
	if (getWeaponStats(weapon).ready && !getWeaponStats(preview).ready && !state.weapons.some((other) => other.id !== gunId && getWeaponStats(other).ready)) return "Это последняя готовая пушка отряда. Сначала собери ещё одну.";
	return null;
}
export function removeModule(state: GameState, gunId: string, slot: ModuleSlot): ActionResult {
	const reason = getModuleRemoveReason(state, gunId, slot); if (reason) return fail(reason);
	const weapon = state.weapons.find((gun) => gun.id === gunId)!;
	noteAchievementBuild(state, weapon); noteAchievementTransfer(state, weapon, [weapon.modules[slot]!]);
	state.modules.push(weapon.modules[slot]!); delete weapon.modules[slot];
	return ok("Деталь снята и возвращена на стойку.");
}
export function assembleWeapon(state: GameState, receiverId: string): ActionResult {
	const receiver = state.modules.find((part) => part.id === receiverId);
	if (!receiver || getModuleDefinition(receiver).slot !== "receiver") return fail("Нужна свободная ствольная коробка.");
	if (state.weapons.length >= getStorageCapacity(state)) return fail("Арсенал полон.");
	const weaponId = getModuleDefinition(receiver).weaponId!;
	state.modules = state.modules.filter((part) => part.id !== receiverId);
	state.weapons.push({ id: id(state, "gun"), weaponId, durability: receiver.durability, foundAt: receiver.foundAt,
		attachments: { ...(receiver.legacyAttachments ?? { optic: 0, magazine: 0, stock: 0 }) }, modules: { receiver } });
	if (!state.discoveredWeapons.includes(weaponId)) state.discoveredWeapons.push(weaponId);
	return ok("Коробка заняла место в арсенале. Установи обязательные детали.");
}
export function getWeaponDisassembleReason(state: GameState, gunId: string): string | null {
	const weapon = state.weapons.find((gun) => gun.id === gunId);
	if (!weapon) return "Пушка не найдена.";
	if (state.raids.some((raid) => raid.weaponInstanceId === gunId)) return "Пушка сейчас в рейде.";
	if (getWeaponStats(weapon).ready && !state.weapons.some((gun) => gun.id !== gunId && getWeaponStats(gun).ready)) return "Последнюю готовую пушку нужно оставить отряду.";
	if (state.modules.length + Object.keys(weapon.modules).length > getModuleCapacity(state)) return "Недостаточно места для всех деталей сборки.";
	return null;
}
export function disassembleWeapon(state: GameState, gunId: string): ActionResult {
	const reason = getWeaponDisassembleReason(state, gunId); if (reason) return fail(reason);
	const weapon = state.weapons.find((gun) => gun.id === gunId)!;
	noteAchievementTransfer(state, weapon, Object.values(weapon.modules));
	state.modules.push(...Object.values(weapon.modules)); state.weapons = state.weapons.filter((gun) => gun.id !== gunId);
	for (const scav of state.scavs) if (scav.weaponInstanceId === gunId) scav.weaponInstanceId = null;
	pruneAchievementInventory(state);
	return ok("Сборка разобрана. Все её детали на стойке.");
}
export function getModuleCraftReason(state: GameState, modelId: string): string | null {
	const model = ownValue(MODULE_BY_ID, modelId); if (!model) return "Модель не найдена.";
	if (model.slot === "receiver" && !state.discoveredWeapons.includes(model.weaponId!)) return "Сначала найди эту оружейную платформу в рейде.";
	if (state.base.workshop < model.workshopLevel) return `Нужна мастерская уровня ${model.workshopLevel}.`;
	if (state.modules.length >= getModuleCapacity(state)) return "Стойка деталей полна.";
	if (state.money < model.craftCost.money || state.supplies.scrap < model.craftCost.scrap) return `Нужно ${model.craftCost.money} ₽ и ${model.craftCost.scrap} деталей.`;
	return null;
}
export function craftModule(state: GameState, modelId: string): ActionResult {
	const reason = getModuleCraftReason(state, modelId); if (reason) return fail(reason);
	const model = ownValue(MODULE_BY_ID, modelId)!;
	const blocked = prepareAchievementCraft(state, model.craftCost.scrap);
	state.money -= model.craftCost.money; state.supplies.scrap -= model.craftCost.scrap;
	const crafted = createModule(state, modelId, state.lastUpdated); state.modules.push(crafted);
	noteAchievementCrafted(state, "module", modelId, null, crafted.id, null, blocked);
	return ok(`${model.label} изготовлен.`);
}
export function getModuleSaleValue(item: ModuleInstance): number { return Math.max(2, Math.floor(getModuleDefinition(item).value * (0.2 + item.durability * 0.003))); }
export function getModuleRecycleYield(item: ModuleInstance): number { return Math.max(1, Math.floor(getModuleDefinition(item).value / 100 * (0.2 + item.durability * 0.004))); }
export function getModuleRepairCost(item: ModuleInstance): UpgradeCost { return { money: Math.ceil(getModuleDefinition(item).value * (100 - item.durability) / 180), scrap: Math.ceil((100 - item.durability) / 25) }; }
export function sellModule(state: GameState, moduleId: string): ActionResult {
	const item = state.modules.find((part) => part.id === moduleId); if (!item) return fail("Свободная деталь не найдена.");
	state.modules = state.modules.filter((part) => part.id !== moduleId); const value = getModuleSaleValue(item); addMoney(state, value);
	pruneAchievementInventory(state);
	return ok(`Деталь продана за ${value} ₽.`);
}
export function recycleModule(state: GameState, moduleId: string): ActionResult {
	const item = state.modules.find((part) => part.id === moduleId); if (!item) return fail("Свободная деталь не найдена.");
	const amount = getModuleRecycleYield(item); if (state.supplies.scrap + amount > getSupplyCapacity(state).scrap) return fail("Нет места для деталей.");
	const candidates = prepareAchievementRecycle(state, moduleId, amount);
	state.modules = state.modules.filter((part) => part.id !== moduleId); state.supplies.scrap += amount;
	noteAchievementSupply(state, "scrap", amount); noteAchievementRecycled(state, candidates);
	pruneAchievementInventory(state);
	return ok(`Разобрано: +${amount} деталей.`);
}
export function repairModule(state: GameState, moduleId: string): ActionResult {
	const item = state.modules.find((part) => part.id === moduleId); if (!item) return fail("Свободная деталь не найдена. Сначала сними установленную деталь.");
	if (item.durability >= 100) return fail("Ремонт не требуется.");
	const cost = getModuleRepairCost(item); if (state.money < cost.money || state.supplies.scrap < cost.scrap) return fail(`Нужно ${cost.money} ₽ и ${cost.scrap} деталей.`);
	state.money -= cost.money; state.supplies.scrap -= cost.scrap; item.durability = 100; return ok("Деталь отремонтирована.");
}

export function getRoomWorkerCapacity(room: RoomInstance): number {
	return ROOM_DEFINITIONS[room.type].production ? 1 + Math.floor(room.level / 2) : 0;
}
export function getWorkerAffinity(scav: Scav, type: ShelterRoomType): number {
	const skill = ROOM_DEFINITIONS[type].workerSkill;
	return Math.round(clamp(skill === "combat" ? scav.combat : skill === "scouting" ? scav.scouting : (scav.combat + scav.scouting) / 2, 0, 100));
}
function roomWorkRate(state: GameState, room: RoomInstance): number {
	if (room.status !== "ready") return 0;
	const social = getRoomSocialEffects(state, room.id);
	const work = room.workerIds.reduce((sum, workerId) => {
		const scav = state.scavs.find((item) => item.id === workerId);
		return sum + (scav && scav.status !== "raiding" && scav.health >= 25 ? (700 + getWorkerAffinity(scav, room.type) * 10) * getScavProfileEffects(scav).work * getScavStoryEffects(scav).work * (social.workers.find((worker) => worker.scavId === workerId)?.multiplier ?? 1) : 0);
	}, 0);
	return Math.floor(work * (9 + room.level) / 10);
}
function roomById(state: GameState, roomId: string): RoomInstance | undefined { return state.shelter.rooms.find((room) => room.id === roomId); }
function roomOutputReason(state: GameState, job: ProductionJob): string | null {
	if (job.output.fieldKit && getFieldKitStock(state)[job.output.fieldKit] >= FIELD_KIT_CAPACITY) return "Полка комплектов полна. Готовый комплект сохранён в очереди.";
	if (job.output.moduleModelId && state.modules.length >= getModuleCapacity(state)) return "Стойка деталей полна. Готовая деталь сохранена в очереди.";
	const capacity = getSupplyCapacity(state);
	for (const key of Object.keys(job.output.supplies) as (keyof Supplies)[]) if (job.output.supplies[key] > 0 && state.supplies[key] + job.output.supplies[key] > capacity[key]) return "Склад полон. Вся готовая партия сохранена в очереди.";
	return null;
}
function productionCostReason(state: GameState, cost: ShelterCost): string | null {
	if (state.money < cost.money) return `Нужно ${cost.money} ₽.`;
	for (const key of Object.keys(cost.supplies) as (keyof Supplies)[]) if (state.supplies[key] < cost.supplies[key]) return "Для партии не хватает припасов.";
	const reserve = getProductionReserve(state);
	if (state.money - cost.money < reserve.money) return `Заказ затронет резерв ${reserve.money} ₽ для рейдов.`;
	for (const key of Object.keys(cost.supplies) as (keyof Supplies)[]) if (cost.supplies[key] > 0 && state.supplies[key] - cost.supplies[key] < reserve.supplies[key]) return "Заказ затронет резерв припасов для рейдов.";
	return null;
}
/** Only unpaid production checks the target. An already reserved batch is always honoured. */
function productionTargetReason(state: GameState, room: RoomInstance, recipe: typeof RESOURCE_RECIPE_BY_ID[string]): string | null {
	if (!room.repeat || room.recipeId !== recipe.id || room.stockTarget === undefined) return null;
	if (recipe.outputKit) return getFieldKitStock(state)[recipe.outputKit] + 1 > room.stockTarget ? "Цель запаса достигнута. Следующая партия начнётся после расхода комплектов." : null;
	for (const key of Object.keys(recipe.output) as (keyof Supplies)[]) if (recipe.output[key] > 0 && state.supplies[key] + recipe.output[key] > room.stockTarget) return "Цель запаса достигнута: новая партия целиком не помещается. Производство возобновится после расхода припасов.";
	return null;
}
export function setProductionReserve(state: GameState, cost: ShelterCost, now = Date.now()): ActionResult {
	let reserve: ShelterCost;
	try { reserve = parseProductionReserve(cost); } catch { return fail("Некорректный резерв производства."); }
	if (!isTime(now)) return fail("Некорректный резерв производства.");
	rebaseClock(state, now); simulateAdvance(state, now, new Set(), new Set(state.shelter.rooms.map(room => room.id)));
	ensureShelterLogistics(state).reserve = reserve;
	settleShelter(state, now);
	return ok("Резерв для выходов установлен. Уже оплаченные партии продолжают работу.");
}
export function setRoomStockTarget(state: GameState, roomId: string, target: number | null, now = Date.now()): ActionResult {
	const current = roomById(state, roomId), recipe = current?.recipeId ? ownValue(RESOURCE_RECIPE_BY_ID, current.recipeId) : null;
	if (!isTime(now) || !current || !recipe || (target !== null && (!Number.isInteger(target) || target < 0 || target > (recipe.outputKit ? FIELD_KIT_CAPACITY : 1e6)))) return fail("Некорректная цель запаса или не выбран рецепт.");
	rebaseClock(state, now); simulateAdvance(state, now, new Set(), new Set([roomId]));
	if (target === null) delete current.stockTarget; else current.stockTarget = target;
	settleShelter(state, now);
	return ok(target === null ? "Производство без цели запаса." : `Повторение поддерживает запас до ${target}. Уже оплаченная партия будет доставлена.`);
}
function reserveProduction(state: GameState, cost: ShelterCost) {
	state.money -= cost.money;
	for (const key of Object.keys(cost.supplies) as (keyof Supplies)[]) state.supplies[key] -= cost.supplies[key];
}
export function getRoomProductionState(state: GameState, room: RoomInstance) {
	if (room.construction) return { progress: room.construction.workDone / room.construction.workRequired,
		remainingSeconds: (room.construction.workRequired - room.construction.workDone) / 1_000_000, rate: 1,
		status: room.status === "building" ? "Строительство" : "Улучшение", reason: null, job: null };
	const job = room.queue[0] ?? null, rate = roomWorkRate(state, room);
	if (!job) {
		const quote = room.recipeId ? getResourceProductionQuote(state, room.id, room.recipeId) : null;
		return { progress: 0, remainingSeconds: null, rate: rate / 1000,
			status: !ROOM_DEFINITIONS[room.type].production ? "Работает без персонала" : (room.repeat || room.pending) && room.recipeId ? "Ожидание партии" : "Нет заказа",
			reason: quote?.reason ?? null, job: null };
	}
	const blocked = job.workDone >= job.workRequired ? roomOutputReason(state, job) : null;
	const reason = blocked ?? (rate === 0 ? "Назначь здорового рабочего: очередь на паузе." : null);
	return { progress: Math.min(1, job.workDone / job.workRequired), remainingSeconds: reason ? null : Math.max(0, (job.workRequired - job.workDone) / rate / 1000),
		rate: rate / 1000, status: blocked ? "Партия готова · склад полон" : rate === 0 ? "Ожидает рабочего" : "Производство", reason, job };
}
export function getBuildRoomQuote(state: GameState, type: ShelterRoomType, column: number, row: number) {
	const definition = ownValue(ROOM_DEFINITIONS, type);
	let reason: string | null = null;
	if (!definition) reason = "Помещение не найдено.";
	else if (!isShelterSiteCoordinate(column, row)) reason = row < 0 ? "Со стороны улицы расширять базу нельзя." : "Участок вне убежища.";
	else if (!getShelterSites(state.shelter).some((site) => site.column === column && site.row === row)) reason = "Сначала разбери внешнюю стену и подготовь площадку.";
	else if (state.shelter.rooms.some((room) => room.column === column && room.row === row)) reason = "Этот участок уже занят.";
	else if (state.money < definition.cost.money || state.supplies.scrap < definition.cost.scrap) reason = `Нужно ${definition.cost.money} ₽ и ${definition.cost.scrap} деталей.`;
	return { money: definition?.cost.money ?? 0, scrap: definition?.cost.scrap ?? 0, duration: definition?.buildSeconds ?? 0, reason };
}
export function getExcavationQuote(state: GameState, column: number, row: number) {
	let reason: string | null = null;
	if (!isShelterSiteCoordinate(column, row)) reason = row < 0 ? "Со стороны улицы расширять базу нельзя." : "Участок вне доступной территории.";
	else if (getShelterSites(state.shelter).some((site) => site.column === column && site.row === row)) reason = "Этот участок уже открыт.";
	else if (state.shelter.expansions.some((site) => site.column === column && site.row === row)) reason = "На этом участке уже идут работы.";
	else if (state.shelter.sites.length + state.shelter.expansions.length >= MAX_SHELTER_SITES) reason = "Достигнут предел площадок базы.";
	else if (!getShelterFrontier(state.shelter).some((site) => site.column === column && site.row === row)) reason = "Разбирать можно только внешнюю стену рядом с открытой площадкой.";
	else if (state.money < SHELTER_EXCAVATION.money || state.supplies.scrap < SHELTER_EXCAVATION.scrap) reason = `Нужно ${SHELTER_EXCAVATION.money} ₽ и ${SHELTER_EXCAVATION.scrap} деталей.`;
	return { ...SHELTER_EXCAVATION, reason };
}
export function excavateShelter(state: GameState, column: number, row: number, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время.");
	advance(state, now);
	const quote = getExcavationQuote(state, column, row); if (quote.reason) return fail(quote.reason);
	state.money -= quote.money; state.supplies.scrap -= quote.scrap;
	state.shelter.expansions.push({ column, row, workDone: 0, workRequired: quote.duration * 1_000_000, cost: { money: quote.money, scrap: quote.scrap } });
	return ok("Разбор внешней стены начался: новая площадка будет готова через 20 секунд.");
}
export function buildRoom(state: GameState, type: ShelterRoomType, column: number, row: number, now = Date.now()): ActionResult {
	if (!isTime(now) || !Object.hasOwn(ROOM_DEFINITIONS, type)) return fail("Некорректное помещение или время.");
	advance(state, now);
	const quote = getBuildRoomQuote(state, type, column, row); if (quote.reason) return fail(quote.reason);
	state.money -= quote.money; state.supplies.scrap -= quote.scrap;
	state.shelter.rooms.push({ id: `room-${column}-${row}`, type, column, row, level: 0, status: "building",
		construction: { workDone: 0, workRequired: quote.duration * 1_000_000, targetLevel: 1, cost: { money: quote.money, scrap: quote.scrap } },
		workerIds: [], queue: [], recipeId: null, repeat: false, pending: false, cycles: 0 });
	return ok(`${ROOM_DEFINITIONS[type].label}: строительство началось.`);
}
export function getRoomUpgradeQuote(state: GameState, roomId: string) {
	const room = roomById(state, roomId);
	const level = room?.level ?? 1;
	const money = Math.round(180 * level ** 1.7), scrap = 5 + level * 3, duration = 45 + level * 25;
	const reason = !room ? "Помещение не найдено." : room.status !== "ready" ? "Дождись завершения строительства."
		: level >= 5 ? "Максимальный уровень помещения." : state.money < money || state.supplies.scrap < scrap ? `Нужно ${money} ₽ и ${scrap} деталей.` : null;
	return { money, scrap, duration, reason };
}
export function upgradeRoom(state: GameState, roomId: string, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время."); advance(state, now);
	const quote = getRoomUpgradeQuote(state, roomId); if (quote.reason) return fail(quote.reason);
	const room = roomById(state, roomId)!;
	noteAchievementUpgrade(state, room);
	state.money -= quote.money; state.supplies.scrap -= quote.scrap;
	room.status = "upgrading"; room.construction = { workDone: 0, workRequired: quote.duration * 1_000_000, targetLevel: room.level + 1, cost: { money: quote.money, scrap: quote.scrap } };
	return ok("Улучшение началось. Производственная очередь ждёт завершения работ.");
}
/** Pure preview for room highlights; committing an assignment validates again after advancing time. */
export function getWorkerAssignmentReason(state: GameState, scavId: string, roomId: string | null): string | null {
	const scav = state.scavs.find((item) => item.id === scavId), room = roomId === null ? null : roomById(state, roomId);
	if (!scav || (roomId !== null && !room)) return "Боец или помещение не найдены.";
	if (scav.status === "raiding") return "Боец сейчас в рейде.";
	if (room) {
		if (room.status !== "ready") return "Помещение ещё не готово.";
		if (scav.health < 25) return "Бойцу нужно восстановиться до 25% здоровья.";
		if (!ROOM_DEFINITIONS[room.type].production) return "В этом помещении рабочие не требуются.";
		if (!room.workerIds.includes(scavId) && room.workerIds.length >= getRoomWorkerCapacity(room)) return "Все рабочие места заняты.";
	}
	return null;
}
export function assignWorker(state: GameState, scavId: string, roomId: string | null, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время.");
	rebaseClock(state, now); simulateAdvance(state, now, roomId !== null ? new Set([scavId]) : new Set());
	const reason = getWorkerAssignmentReason(state, scavId, roomId); if (reason) return fail(reason);
	const scav = state.scavs.find((item) => item.id === scavId)!, room = roomId === null ? null : roomById(state, roomId)!;
	for (const current of state.shelter.rooms) current.workerIds = current.workerIds.filter((workerId) => workerId !== scavId);
	scav.assignment = room?.id ?? null;
	if (room) room.workerIds.push(scavId);
	noteAchievementAssignment(state, scavId, roomId);
	settleShelter(state, now);
	return ok(room ? `${scav.name}: ${ROOM_DEFINITIONS[room.type].label}. Для рейда сначала освободи бойца.` : `${scav.name} освобождён от работы.`);
}
export function getModuleProductionQuote(state: GameState, roomId: string, modelId: string) {
	const room = roomById(state, roomId), model = ownValue(MODULE_BY_ID, modelId);
	const duration = model ? Math.max(25, Math.round(35 + model.value * 0.25)) : 0;
	let reason: string | null = null;
	if (!room || room.type !== "workshop") reason = "Нужна мастерская.";
	else if (room.status !== "ready") reason = "Мастерская ещё не готова.";
	else if (!model) reason = "Модель не найдена.";
	else if (model.slot === "receiver" && !state.discoveredWeapons.includes(model.weaponId!)) reason = "Сначала найди эту оружейную платформу в рейде.";
	else if (room.level < model.workshopLevel) reason = `Нужна эта мастерская уровня ${model.workshopLevel}.`;
	else if (room.queue.length >= 5) reason = "В очереди уже пять заказов.";
	else reason = productionCostReason(state, { money: model.craftCost.money, supplies: { ...emptySupplies(), scrap: model.craftCost.scrap } });
	return { money: model?.craftCost.money ?? 0, scrap: model?.craftCost.scrap ?? 0, duration, reason };
}
export function queueModuleProduction(state: GameState, roomId: string, modelId: string, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время."); advance(state, now);
	const quote = getModuleProductionQuote(state, roomId, modelId); if (quote.reason) return fail(quote.reason);
	const paid = { money: quote.money, supplies: { ...emptySupplies(), scrap: quote.scrap } };
	const candidates = prepareAchievementPayment(state, paid), blocked = prepareAchievementCraft(state, quote.scrap);
	reserveProduction(state, paid);
	const room = roomById(state, roomId)!;
	const job: ProductionJob = { id: id(state, "job"), kind: "module", recipeId: `module:${modelId}`, modelId,
		workDone: 0, workRequired: quote.duration * 1_000_000, paid, output: { supplies: emptySupplies(), moduleModelId: modelId }, createdAt: now };
	room.queue.push(job); noteAchievementPaid(state, room, job, candidates); noteAchievementCrafted(state, "job", modelId, roomId, null, job.id, blocked);
	return ok("Заказ поставлен в очередь. Материалы зарезервированы один раз.");
}
export function getResourceProductionQuote(state: GameState, roomId: string, recipeId: string) {
	const room = roomById(state, roomId), recipe = ownValue(RESOURCE_RECIPE_BY_ID, recipeId);
	let reason: string | null = null;
	if (!room || !recipe || recipe.roomType !== room.type) reason = "Рецепт не подходит этому помещению.";
	else if (room.status !== "ready") reason = "Помещение ещё не готово.";
	else if (room.level < (recipe.minLevel ?? 1)) reason = `Нужно это помещение уровня ${recipe.minLevel}.`;
	else if (productionTargetReason(state, room, recipe)) reason = productionTargetReason(state, room, recipe);
	else if (roomWorkRate(state, room) === 0) reason = "Назначь здорового рабочего.";
	else {
		reason = productionTargetReason(state, room, recipe) ?? productionCostReason(state, recipe.cost);
		if (!reason && roomOutputReason(state, { output: { supplies: recipe.output, moduleModelId: null, ...(recipe.outputKit ? { fieldKit: recipe.outputKit } : {}) } } as ProductionJob)) {
			reason = "На складе нет места для новой партии. Материалы ещё не списаны.";
		}
	}
	const rate = room ? roomWorkRate(state, room) : 0;
	const block: "target" | "reserve" | "capacity" | "worker" | "level" | "resources" | null = !reason ? null : reason.startsWith("Цель запаса") ? "target" : reason.includes("резерв") ? "reserve" : reason.startsWith("На складе") ? "capacity" : reason.startsWith("Назначь") ? "worker" : reason.startsWith("Нужно это помещение") ? "level" : "resources";
	return { money: recipe?.cost.money ?? 0, supplies: { ...(recipe?.cost.supplies ?? emptySupplies()) }, duration: recipe?.durationSeconds ?? 0, actualDuration: recipe && rate > 0 ? recipe.durationSeconds * 1000 / rate : null, outputKit: recipe?.outputKit, block, reason };
}
export function setRoomRecipe(state: GameState, roomId: string, recipeId: string | null, repeat: boolean, now = Date.now()): ActionResult {
	if (!isTime(now) || typeof repeat !== "boolean") return fail("Некорректное время или режим.");
	const wasRepeating = roomById(state, roomId)?.repeat ?? false;
	rebaseClock(state, now); simulateAdvance(state, now, new Set(), recipeId === null || !repeat ? new Set([roomId]) : new Set());
	const room = roomById(state, roomId), recipe = recipeId === null ? null : ownValue(RESOURCE_RECIPE_BY_ID, recipeId);
	if (!room || room.status !== "ready" || (recipeId !== null && (!recipe || recipe.roomType !== room.type))) return fail("Помещение или рецепт не готовы.");
	if (recipe && room.level < (recipe.minLevel ?? 1)) return fail(`Нужно это помещение уровня ${recipe.minLevel}.`);
	const changedRecipe = room.recipeId !== recipeId;
	if (changedRecipe) delete room.stockTarget;
	room.recipeId = recipeId; room.repeat = recipeId !== null && repeat;
	room.pending = recipeId !== null && (changedRecipe || (room.queue.length === 0 && (!wasRepeating || repeat)));
	if (recipe && room.queue.length === 0 && (room.repeat || room.pending)) tryStartResourceJob(state, room, now);
	return ok(recipe ? "Рецепт выбран. Партия начнётся при наличии персонала, припасов и места." : "Повторение отключено. Оплаченная партия остаётся в очереди.");
}
export function getFieldKitProductionQuote(state: GameState, roomId: string, kit: FieldKit) {
	const room = roomById(state, roomId), recipe = Object.hasOwn(FIELD_KITS, kit) ? RESOURCE_RECIPE_BY_ID[FIELD_KITS[kit].recipeId] : null;
	let reason: string | null = null;
	if (!room || !recipe || room.type !== recipe.roomType) reason = "Комплект не подходит этому помещению.";
	else if (room.status !== "ready") reason = "Помещение ещё не готово.";
	else if (room.queue.length >= (room.type === "workshop" ? 5 : 1)) reason = "Производственная очередь заполнена.";
	else if (getFieldKitStock(state)[kit] >= FIELD_KIT_CAPACITY) reason = "Полка комплектов полна.";
	else reason = productionCostReason(state, recipe.cost);
	const rate = room ? roomWorkRate(state, room) : 0;
	return { money: recipe?.cost.money ?? 0, supplies: { ...(recipe?.cost.supplies ?? emptySupplies()) }, duration: recipe?.durationSeconds ?? 0, actualDuration: recipe && rate > 0 ? recipe.durationSeconds * 1000 / rate : null, outputKit: recipe?.outputKit, reason };
}
export function queueFieldKitProduction(state: GameState, roomId: string, kit: FieldKit, now = Date.now()): ActionResult {
	if (!isTime(now) || !Object.hasOwn(FIELD_KITS, kit)) return fail("Некорректный комплект или время.");
	advance(state, now);
	const quote = getFieldKitProductionQuote(state, roomId, kit); if (quote.reason) return fail(quote.reason);
	const room = roomById(state, roomId)!, recipe = RESOURCE_RECIPE_BY_ID[FIELD_KITS[kit].recipeId]!;
	const paid = structuredClone(recipe.cost), candidates = prepareAchievementPayment(state, paid);
	reserveProduction(state, paid);
	const job: ProductionJob = { id: id(state, "job"), kind: "resource", recipeId: recipe.id, modelId: null, workDone: 0, workRequired: recipe.durationSeconds * 1_000_000, paid,
		output: { supplies: { ...recipe.output }, moduleModelId: null, fieldKit: kit }, createdAt: now };
	room.queue.push(job); noteAchievementPaid(state, room, job, candidates);
	return ok(`${FIELD_KITS[kit].label}: один комплект заказан. Материалы зарезервированы один раз.`);
}
export function cancelProduction(state: GameState, roomId: string, jobId: string, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время.");
	const initiallyPresent = roomById(state, roomId)?.queue.some((job) => job.id === jobId) ?? false;
	rebaseClock(state, now); simulateAdvance(state, now, new Set(), initiallyPresent ? new Set([roomId]) : new Set());
	const room = roomById(state, roomId), job = room?.queue.find((item) => item.id === jobId);
	if (!room || !job) {
		if (room && initiallyPresent) { room.repeat = false; room.pending = false; return ok("Партия успела завершиться и доставлена. Повторение выключено."); }
		return fail("Заказ уже завершён или не найден.");
	}
	room.queue = room.queue.filter((item) => item.id !== jobId);
	noteAchievementCancelled(state, jobId);
	discardSquadWork(state, jobId);
	if (job.workDone === 0) {
		addMoney(state, job.paid.money, false);
		for (const key of Object.keys(job.paid.supplies) as (keyof Supplies)[]) { state.supplies[key] += job.paid.supplies[key]; noteAchievementSupply(state, key, job.paid.supplies[key]); }
	}
	room.repeat = false;
	room.pending = false;
	return ok(job.workDone === 0 ? "Не начатый заказ отменён: все материалы возвращены. Повторение выключено." : "Начатый заказ отменён без возврата материалов. Повторение выключено.");
}
function tryStartResourceJob(state: GameState, room: RoomInstance, now: number): boolean {
	if (!room.recipeId || room.queue.length || getResourceProductionQuote(state, room.id, room.recipeId).reason) return false;
	const recipe = ownValue(RESOURCE_RECIPE_BY_ID, room.recipeId)!;
	const candidates = prepareAchievementPayment(state, recipe.cost);
	reserveProduction(state, recipe.cost);
	room.pending = false;
	room.queue.push({ id: id(state, "job"), kind: "resource", recipeId: recipe.id, modelId: null, workDone: 0,
		workRequired: recipe.durationSeconds * 1_000_000, paid: structuredClone(recipe.cost), output: { supplies: { ...recipe.output }, moduleModelId: null, ...(recipe.outputKit ? { fieldKit: recipe.outputKit } : {}) }, createdAt: now });
	noteAchievementPaid(state, room, room.queue[0]!, candidates);
	return true;
}
function settleShelter(state: GameState, now: number, stoppedAtBoundary: ReadonlySet<string> = new Set()) {
	const completed = state.shelter.expansions.filter((site) => site.workDone >= site.workRequired);
	if (completed.length) {
		state.shelter.sites.push(...completed.map(({ column, row }) => ({ column, row })).sort((a, b) => a.row - b.row || a.column - b.column));
		state.shelter.expansions = state.shelter.expansions.filter((site) => site.workDone < site.workRequired);
	}
	for (let pass = 0; pass < 24; pass++) {
	let changed = false;
	for (const room of [...state.shelter.rooms].sort((a, b) => a.id.localeCompare(b.id))) {
		if (room.construction && room.construction.workDone >= room.construction.workRequired) {
			room.level = room.construction.targetLevel; room.construction = null; room.status = "ready";
			noteAchievementUpgradeDone(state, room);
			if (roomKeys.includes(room.type as BaseRoom)) state.base[room.type as BaseRoom] = Math.max(state.base[room.type as BaseRoom], room.level);
			state.recruitment.tier = Math.max(state.recruitment.tier, getEarnedRecruitmentTier(state)) as RecruitTier;
			addXp(state, 12 * room.level);
			changed = true;
		}
		if (room.status !== "ready") continue;
		const job = room.queue[0];
		if (job && job.workDone >= job.workRequired && !roomOutputReason(state, job)) {
			const item = job.output.moduleModelId ? createModule(state, job.output.moduleModelId, now) : null;
			if (item) state.modules.push(item);
			if (job.output.fieldKit) ensureShelterLogistics(state).kits[job.output.fieldKit]++;
			for (const key of Object.keys(job.output.supplies) as (keyof Supplies)[]) { state.supplies[key] += job.output.supplies[key]; noteAchievementSupply(state, key, job.output.supplies[key]); }
			room.queue.shift(); room.cycles++;
			changed = true;
			noteAchievementJobDone(state, room, job, item?.id ?? null, now);
			const creditedWorkers = getSocialProductionWorkers(state, room, job);
			for (const workerId of creditedWorkers) {
				const scav = state.scavs.find((item) => item.id === workerId); if (!scav) continue;
				const previous = scav.level; scav.xp += job.kind === "module" ? 3 : 1;
				noteScavProduction(scav, job.kind === "module", job.id, now);
				scav.level = Math.min(15, 1 + Math.floor(Math.sqrt(scav.xp / 60)));
				scav.combat = Math.min(100, scav.combat + (scav.level - previous) * 4); scav.scouting = Math.min(100, scav.scouting + (scav.level - previous) * 3);
			}
			noteSquadProduction(state, room, job, creditedWorkers, now);
		}
		if (!stoppedAtBoundary.has(room.id) && (room.repeat || room.pending) && room.queue.length === 0 && tryStartResourceJob(state, room, now)) changed = true;
	}
	if (!changed) break;
	}
}
function progressShelter(state: GameState, elapsedMs: number) {
	for (const site of state.shelter.expansions) site.workDone = Math.min(site.workRequired, site.workDone + elapsedMs * 1000);
	for (const room of state.shelter.rooms) {
		if (room.construction) room.construction.workDone = Math.min(room.construction.workRequired, room.construction.workDone + elapsedMs * 1000);
		else if (room.queue[0]) {
			const job = room.queue[0], before = job.workDone;
			job.workDone = Math.min(job.workRequired, job.workDone + elapsedMs * roomWorkRate(state, room));
			creditSquadWork(state, room, job, job.workDone - before);
			creditAchievementWork(state, room, job, job.workDone - before);
		}
	}
}
function nextShelterEvent(state: GameState, cursor: number, end: number): number {
	let next = end;
	for (const site of state.shelter.expansions) next = Math.min(next, cursor + Math.max(1, Math.ceil((site.workRequired - site.workDone) / 1000)));
	for (const room of state.shelter.rooms) {
		if (room.construction) next = Math.min(next, cursor + Math.max(1, Math.ceil((room.construction.workRequired - room.construction.workDone) / 1000)));
		else if (room.queue[0] && room.queue[0].workDone < room.queue[0].workRequired) {
			const rate = roomWorkRate(state, room); if (rate > 0) next = Math.min(next, cursor + Math.max(1, Math.ceil((room.queue[0].workRequired - room.queue[0].workDone) / rate)));
		}
		if (room.status === "ready" && (room.repeat || room.pending || room.queue.length > 0)) {
			for (const workerId of room.workerIds) {
				const scav = state.scavs.find((item) => item.id === workerId);
				if (scav && scav.health < 25) next = Math.min(next, cursor + Math.max(1, Math.ceil((25_000_000 - Math.round(scav.health * 1_000_000)) / (40 + state.base.medbay * 25))));
			}
			if ((room.repeat || room.pending) && room.queue.length === 0 && roomWorkRate(state, room) > 0) next = Math.min(next,
				cursor + 10_000 - state.clock.income, cursor + 30_000 - state.clock.ammo, cursor + 60_000 - state.clock.scrap, cursor + 180_000 - state.clock.intel);
		}
	}
	return next;
}
function extraStorageLevels(state: GameState): number {
	const levels = state.shelter.rooms.filter((room) => room.type === "storage" && room.level > 0).map((room) => room.level);
	return levels.reduce((sum, level) => sum + level, 0) - Math.max(0, ...levels);
}
export function getStorageCapacity(state: GameState): number {
	return 15 + state.base.storage * 10 + extraStorageLevels(state) * 6;
}
export function getLootCapacity(state: GameState): number { return Math.min(512, 32 + state.base.storage * 16 + extraStorageLevels(state) * 12); }
/** Only owned shelf items can be exchanged. The submitted identifiers choose the exact objects. */
export function barterGear(state: GameState, offerId: string, itemIds: readonly string[]): ActionResult & { gearItemId?: string } {
	const quote = getBarterQuote(state, offerId);
	if (quote.reason || !quote.offer) return fail(quote.reason ?? "Обмен не найден.");
	const expected = quote.offer.requirements.reduce((sum, value) => sum + value.quantity, 0);
	if (!Array.isArray(itemIds) || itemIds.length !== expected || new Set(itemIds).size !== itemIds.length || itemIds.some(value => typeof value !== "string" || !/^loot-[1-9]\d*$/.test(value))) return fail("Выбери точный набор целых трофеев для обмена.");
	const selected = itemIds.map(itemId => state.lootItems?.find(item => item.id === itemId));
	if (selected.some(item => !item)) return fail("Один из трофеев уже отсутствует на складе. Обнови обмен.");
	if (quote.offer.requirements.some(value => selected.filter(item => item!.modelId === value.modelId).length !== value.quantity)) return fail("Выбранные трофеи не соответствуют условиям обмена.");
	if (state.nextId >= 1e12 - 1) return fail("Лимит идентификаторов исчерпан.");
	const gear = { id: id(state, "gear"), modelId: quote.offer.gearModelId, durability: 100 };
	const ids = new Set(itemIds); state.lootItems = state.lootItems!.filter(item => !ids.has(item.id));
	state.gearItems.push(gear);
	pruneAchievementInventory(state);
	return { ...ok(`${quote.offer.label} получен за трофеи. Выдай снаряжение своему дикому.`), gearItemId: gear.id };
}
/** Waiting trophies are never sold or partly claimed to make a parcel fit. */
export function claimLootDelivery(state: GameState, deliveryId: string): ActionResult {
	const delivery = state.pendingLoot?.find(value => value.id === deliveryId);
	if (!delivery) return fail("Посылка с трофеями не найдена или уже получена.");
	if ((state.lootItems?.length ?? 0) + delivery.items.length > getLootCapacity(state)) return fail(`Для всей посылки нужно ${delivery.items.length} свободных мест на складе трофеев.`);
	(state.lootItems ??= []).push(...delivery.items);
	state.pendingLoot = state.pendingLoot!.filter(value => value.id !== delivery.id);
	return ok(`Посылка получена: ${delivery.items.length} целых трофеев. Их можно оставить, обменять или продать по своему выбору.`);
}
export function sellLootItem(state: GameState, itemId: string): ActionResult {
	const item = state.lootItems?.find(item => item.id === itemId); if (!item) return fail("Трофей не найден.");
	const value = getLootTraderPrice(item); state.lootItems = state.lootItems!.filter(item => item.id !== itemId); addMoney(state, value);
	return ok(`${getLootModel(item).label}: продано торговцу за ${value} ₽.`);
}
export function recycleLootItem(state: GameState, itemId: string): ActionResult {
	const item = state.lootItems?.find(item => item.id === itemId); if (!item) return fail("Трофей не найден.");
	const model = getLootModel(item), capacity = getSupplyCapacity(state);
	if ((Object.keys(model.salvage) as (keyof Supplies)[]).some(key => state.supplies[key] + model.salvage[key] > capacity[key])) return fail("Для всех материалов нет места на складе.");
	state.lootItems = state.lootItems!.filter(item => item.id !== itemId);
	for (const key of Object.keys(model.salvage) as (keyof Supplies)[]) addSupply(state, key, model.salvage[key]);
	return ok(`${model.label} разобран. Материалы поступили в убежище.`);
}
export function getScavCapacity(state: GameState): number {
	return Math.min(15, 2 + state.base.radio + state.shelter.rooms.filter((room) => room.type === "dormitory" && room.level > 0).reduce((sum, room) => sum + room.level + 1, 0));
}
export function getIncomePerMinute(state: GameState): number {
	return state.base.workshop * 6;
}
/** A small recovery float, not an unlimited idle-money printer. Existing cash is never reduced. */
export function getRecoveryAllowance(state: GameState): number { return 300 + state.base.workshop * 60; }
export function getSupplyCapacity(state: GameState): Supplies {
	const extra = extraStorageLevels(state);
	return { ammo: 48 + state.base.storage * 24 + extra * 16, medicine: 8 + state.base.storage * 4 + extra * 3,
		scrap: 24 + state.base.storage * 16 + extra * 12, intel: 8 + state.base.radio * 4 + extra * 3 };
}
function addSupply(state: GameState, key: keyof Supplies, amount: number): number {
	const accepted = Math.max(0, Math.min(amount, getSupplyCapacity(state)[key] - state.supplies[key]));
	state.supplies[key] += accepted;
	noteAchievementSupply(state, key, accepted);
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
	const helmet = state.gearItems.find((item) => item.id === scav.loadout.helmetItemId);
	const pack = state.gearItems.find((item) => item.id === scav.loadout.backpackItemId);
	const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId);
	const weight = (armor ? getGearModel(armor).weight : 0) + (helmet ? getGearModel(helmet).weight : 0) + (pack ? getGearModel(pack).weight : 0) + (weapon ? getWeaponStats(weapon).weight : 0) + (scav.loadout.medkit ? 1 : 0);
	const profile = getScavProfileEffects(scav);
	return { weight, protection: scav.gear.armor * 0.012 + (armor ? getGearModel(armor).protection * armor.durability / 100 : 0) + (helmet ? getGearModel(helmet).protection * helmet.durability / 100 : 0),
		capacity: (pack ? 10 + (getGearModel(pack).capacity - 10) * (0.6 + pack.durability * 0.004) : 10) + scav.gear.backpack * 2 + profile.capacity,
		speedMultiplier: 1 + weight * 0.017, ammoMultiplier: (1 + Math.max(0, weight - 5) * 0.025) * profile.ammo };
}
export function getCargoWeight(cargo: Cargo): number {
	return Math.round((cargo.weaponIds.length * 6 + cargo.modules.reduce((sum, part) => sum + getModuleDefinition(part).stats.weight, 0) + (cargo.lootItems ?? []).reduce((sum, item) => sum + getLootModel(item).weight, 0) + cargo.supplies.ammo * 0.1 + cargo.supplies.medicine + cargo.supplies.scrap * 0.5 + cargo.supplies.intel * 0.25) * 10) / 10;
}
export function getCargoValue(cargo: Cargo): number {
	return Math.round(cargo.money + cargo.weaponIds.reduce((sum, weaponId) => sum + (ownValue(WEAPON_BY_ID, weaponId)?.value ?? 0) * 0.5, 0)
		+ cargo.modules.reduce((sum, item) => sum + getModuleSaleValue(item), 0)
		+ (cargo.lootItems ?? []).reduce((sum, item) => sum + getLootModel(item).guidePrice, 0)
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
	noteAchievementSupply(state, offer.supply, offer.amount);
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
	const blocked = prepareAchievementCraft(state, model.scrap);
	state.money -= model.money; state.supplies.scrap -= model.scrap;
	const crafted = { id: id(state, "gear"), modelId, durability: 100 }; state.gearItems.push(crafted);
	noteAchievementCrafted(state, "gear", modelId, null, crafted.id, null, blocked);
	return ok(`${model.label} собран. Выдай предмет бойцу.`);
}
export function equipGear(state: GameState, scavId: string, slot: GearEquipmentSlot, itemId: string | null): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav || !["armor", "helmet", "backpack"].includes(slot)) return fail("Боец или слот не найден.");
	if (scav.status === "raiding") return fail("Снаряжение нельзя сменить во время рейда.");
	const key = slot === "armor" ? "armorItemId" : slot === "helmet" ? "helmetItemId" : "backpackItemId";
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
	return state.scavs.some((scav) => scav.status === "raiding" && [scav.loadout.armorItemId, scav.loadout.helmetItemId, scav.loadout.backpackItemId].includes(item.id));
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
	for (const scav of state.scavs) for (const key of ["armorItemId", "helmetItemId", "backpackItemId"] as const) if (scav.loadout[key] === item.id) scav.loadout[key] = null;
	state.supplies.scrap += amount;
	noteAchievementSupply(state, "scrap", amount);
	pruneAchievementInventory(state);
	return ok(`Разобрано: +${amount} деталей.`);
}
export function setLoadoutOption(state: GameState, scavId: string, option: "ammoType" | "medkit", value: string | boolean): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return fail("Боец не найден.");
	if (scav.status === "raiding") return fail("Комплект текущего рейда уже зафиксирован.");
	if (option === "ammoType" && isAmmoType(value)) scav.loadout.ammoType = value;
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
	const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId);
	const baseErgo = weapon ? { pistol: 70, shotgun: 45, smg: 60, rifle: 50, sniper: 40 }[getWeaponDefinition(weapon).category] : 50;
	const ergoSpeed = weapon ? 1 - (getWeaponStats(weapon).ergonomics - baseErgo) / 400 : 1;
	return Math.max(
		20,
		Math.round(
			map.duration * TACTICS[scav.tactic].durationMultiplier * getLoadoutStats(state, scav).speedMultiplier * ergoSpeed *
				(1 - personality.speedBonus - (state.base.radio - 1) * 0.035) * getScavProfileEffects(scav).duration
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
	if (!weapon || !getWeaponStats(weapon).ready || scav.health < 25) return 0;
	const personality = getPersonality(scav);
	const weaponStats = getWeaponStats(weapon);
	const reliability = weaponStats.reliability / 100;
	return clamp(
		0.76 +
			getWeaponPower(weapon) / 360 +
			getWeaponRouteEffect(weapon, map.id, "scavenge", scav.tactic, weaponStats).bonus +
			scav.combat / 800 +
			scav.scouting / 900 +
			(scav.level - 1) * 0.008 +
			personality.survivalBonus +
			getScavProfileEffects(scav).chance +
			getScavStoryEffects(scav).chance +
			getRaidSocialSupport(state, scav, map.id).chance +
			state.base.radio * 0.012 +
			TACTICS[scav.tactic].chanceBonus + getLoadoutStats(state, scav).protection +
			getAmmoEffect(weapon, scav.loadout.ammoType, map.id, "scavenge", 1, scav.tactic).bonus + (state.blueprints.includes(`route:${map.id}`) ? 0.02 : 0) -
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
	const cost = {
		money: Math.ceil(
			((100 - weapon.durability) * getWeaponDefinition(weapon).value) / 250
		),
		scrap: Math.ceil((100 - weapon.durability) / 20),
	};
	let componentWear = 0;
	for (const [slot, part] of Object.entries(weapon.modules)) if (slot !== "receiver" && part.durability < 100) {
		const partCost = getModuleRepairCost(part); cost.money += partCost.money;
		componentWear += 100 - part.durability;
	}
	// Bench servicing uses one batch of materials instead of a minimum per part.
	cost.scrap += Math.ceil(componentWear / 25);
	return cost;
}
export function getModCost(
	weapon: WeaponInstance,
	attachment: Attachment
): UpgradeCost {
	const level = weapon.attachments[attachment];
	return { money: 90 + level * 140, scrap: 4 + level * 4 };
}
export function recruitCost(state: GameState): number {
	const candidate = [...getRecruitmentBoard(state)].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];
	return candidate ? getRecruitCandidateQuote(state, candidate.id).money : 0;
}
export function getContractProgress(
	state: GameState,
	contract: Contract
): number {
	if (contract.metric === "baseLevels")
		return roomKeys.reduce((total, room) => total + state.base[room], 0);
	if (contract.metric === "mapsVisited") return state.stats.mapsVisited.length;
	if (contract.metric === "gearLevels") {
		const equipped = new Set<string>();
		for (const scav of state.scavs) {
			for (const [itemId, slot] of [[scav.loadout.armorItemId, "armor"], [scav.loadout.backpackItemId, "backpack"]] as const) {
				const item = state.gearItems.find((gear) => gear.id === itemId);
				if (item && ownValue(GEAR_MODEL_BY_ID, item.modelId)?.slot === slot) equipped.add(item.id);
			}
		}
		return equipped.size + state.scavs.reduce((total, scav) => total + scav.gear.armor + scav.gear.backpack, 0);
	}
	if (contract.metric === "productionCycles") return state.shelter.rooms.reduce((total, room) => total + room.cycles, 0);
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
		* (weapon ? getAmmoModel(weapon, scav.loadout.ammoType).ammoMultiplier : getAmmoSupplyMultiplier(scav.loadout.ammoType))
		* (weapon ? getWeaponRole(weapon).ammoMultiplier * getWeaponStats(weapon).ammoMultiplier : 1) * (state ? getLoadoutStats(state, scav).ammoMultiplier : 1)));
}

export function getRaidQuote(state: GameState, scav: Scav, map: RaidMap) {
	const strategy = getRaidStrategy(state, scav, map.id), effects = getRaidStrategyEffects(strategy);
	const preparation = RAID_PREPARATIONS[strategy.preparation];
	const money = 10 + map.level * 5 + preparation.money;
	const ammo = getRaidAmmoCost(scav, map, state);
	const intel = map.intelCost + preparation.intel;
	const medicine = scav.loadout.medkit ? 1 : 0;
	const fieldKit = scav.fieldKit && scav.fieldKit !== "none" ? scav.fieldKit : null;
	let reason: string | null = null;
	const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId);
	if (scav.status === "raiding") reason = "Боец уже в рейде.";
	else if ((state.pendingLoot?.length ?? 0) >= PENDING_LOOT_RAID_LIMIT) reason = "Сначала забери посылки с трофеями: место для новых возвращений заканчивается.";
	else if (scav.assignment) reason = "Боец работает в убежище. Сначала освободи его от работы.";
	else if (state.level < map.level) reason = `Сектор откроется на ${map.level} уровне.`;
	else if (scav.health < 25) reason = "Бойцу нужно восстановиться до 25%.";
	else if (!weapon) reason = "Сначала выдай дикому оружие.";
	else if (weapon.durability < 10) reason = "Оружию нужен ремонт.";
	else if (!getWeaponStats(weapon).ready) reason = getWeaponBuildIssues(weapon)[0] ?? "Пушка не готова к выходу.";
	else if (state.money < money) reason = `Для выхода нужно ${money} ₽.`;
	else if (state.supplies.ammo < ammo) reason = `Нужно ${ammo} патронов.`;
	else if (state.supplies.intel < intel) reason = `Нужно ${intel} разведданных${preparation.intel ? " с учётом подготовки" : ""}.`;
	else if (state.supplies.medicine < medicine) reason = "В комплекте аптечка: нужен 1 медикамент.";
	else if (fieldKit && getFieldKitStock(state)[fieldKit] < 1) reason = `Нужен ${FIELD_KITS[fieldKit].label.toLowerCase()}: изготовь его в убежище или выбери выход без комплекта.`;
	const baseChance = getRaidChance(state, scav, map);
	return { money, ammo, intel, medicine, chance: baseChance === 0 ? 0 : clamp(baseChance + effects.chanceBonus, .22, .97),
		duration: Math.max(20, Math.min(600, Math.round(getRaidDuration(state, scav, map) * effects.durationMultiplier))), reason,
		strategy, fieldKit, preparationMoney: preparation.money, preparationIntel: preparation.intel,
		ammunition: weapon ? getAmmoEffect(weapon, scav.loadout.ammoType, map.id, "scavenge", 1, scav.tactic) : null };
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

export function setRaidPlan(state: GameState, scavId: string, objective: RaidObjective, preparation: RaidPreparation): ActionResult {
	const scav = state.scavs.find(item => item.id === scavId);
	if (!scav || !Object.hasOwn(RAID_OBJECTIVES, objective) || !Object.hasOwn(RAID_PREPARATIONS, preparation)) return fail("Боец или план выхода не найдены.");
	scav.raidPlan = { objective, preparation };
	return ok(`План ${scav.status === "raiding" ? "следующего выхода" : "выхода"}: ${RAID_OBJECTIVES[objective].label}. ${RAID_PREPARATIONS[preparation].label}.`);
}
export function setFieldKit(state: GameState, scavId: string, kit: FieldKitSelection): ActionResult {
	const scav = state.scavs.find(person => person.id === scavId);
	if (!scav || (kit !== "none" && !Object.hasOwn(FIELD_KITS, kit))) return fail("Боец или комплект не найдены.");
	if (kit === "none") delete scav.fieldKit; else scav.fieldKit = kit;
	return ok(`${scav.name}: ${kit === "none" ? "выход без комплекта поддержки" : FIELD_KITS[kit].label.toLowerCase()}${scav.status === "raiding" ? " для следующего выхода" : ""}.`);
}

export function getAutoRaidStatus(state: GameState, scav: Scav): string {
	const raid = state.raids.find((item) => item.scavId === scav.id);
	if (raid?.expedition?.status === "choice") return "На развилке · ждёт твой приказ";
	if (scav.status === "raiding") return scav.autoRaid.enabled ? `В рейде · авто до этапа ${scav.autoRaid.maxDepth}` : "В рейде · завершит последний выход";
	if (!scav.autoRaid.enabled) return "Ручные рейды";
	const map = ownValue(MAP_BY_ID, scav.autoRaid.mapId);
	return map ? raidBlockReason(state, scav, map, scav.autoRaid.minHealth) ?? "Готов к следующему выходу" : "Сектор не найден.";
}

const raidPhasePlans = new WeakMap<Raid, { signature: string; plan: RaidFieldPlan }>();
export function getRaidPhase(raid: Raid, now: number): { label: string; progress: number } {
	if (raid.expedition?.status === "choice") return { label: "Ожидает приказа", progress: 1 };
	if (raid.expedition && !raid.expedition.legacyLoot) {
		const signature = `${raid.mapId}:${raid.seed}:${raid.expedition.stage}:${raid.expedition.branch}:${raid.tactic}`;
		let cached = raidPhasePlans.get(raid);
		if (cached?.signature !== signature) { cached = { signature, plan: getRaidFieldPlan(raid) }; raidPhasePlans.set(raid, cached); }
		const frame = getRaidFieldFrame(raid, now, cached.plan);
		return { label: `Этап ${raid.expedition.stage} · ${frame.label}`, progress: frame.progress };
	}
	const progress = clamp((now - raid.startedAt) / (raid.endsAt - raid.startedAt), 0, 1);
	const label = progress < 0.18 ? "Выход на маршрут" : progress < 0.52 ? "Поиск тайников"
		: progress < 0.8 ? "Опасный участок" : progress < 1 ? "К точке выхода" : "Возвращение";
	return { label: raid.expedition ? `Этап ${raid.expedition.stage} · ${label}` : label, progress };
}

/** Internal dispatch never advances time: automatic repeat uses the simulation cursor. */
function startRaid(state: GameState, scav: Scav, map: RaidMap, now: number, isAuto: boolean, frozenQuote?: ReturnType<typeof getRaidQuote>): ActionResult {
	if (scav.status === "raiding") return fail("Дикий уже в рейде.");
	const reason = raidBlockReason(state, scav, map, isAuto ? scav.autoRaid.minHealth : 25);
	if (reason) return fail(reason);
	const quote = frozenQuote ?? getRaidQuote(state, scav, map);
	const stats = getLoadoutStats(state, scav);
	const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
	const weaponStats = getWeaponStats(weapon);
	const weaponEffect = getWeaponRouteEffect(weapon, map.id, "scavenge", scav.tactic, weaponStats);
	const ammunition = getAmmoEffect(weapon, scav.loadout.ammoType, map.id, "scavenge", 1, scav.tactic);
	const armor = state.gearItems.find((item) => item.id === scav.loadout.armorItemId);
	const helmet = state.gearItems.find((item) => item.id === scav.loadout.helmetItemId);
	const pack = state.gearItems.find((item) => item.id === scav.loadout.backpackItemId);
	const raid: Raid = {
		id: id(state, "raid"), scavId: scav.id, scavName: scav.name, mapId: map.id,
		scavAppearance: scav.appearance ?? defaultScavAppearance(scav.personality),
		weaponInstanceId: scav.weaponInstanceId!, startedAt: now,
		endsAt: now + quote.duration * 1000,
		chance: quote.chance,
		lootBonus: getPersonality(scav).lootBonus + scav.scouting / 450 + TACTICS[scav.tactic].lootBonus + scav.gear.backpack * 0.12 + getScavProfileEffects(scav).loot,
		seed: takeSeed(state), isAuto, tactic: scav.tactic,
		armorLevel: scav.gear.armor, backpackLevel: scav.gear.backpack,
		strategy: { ...quote.strategy },
		lootVersion: 1,
		...(quote.fieldKit ? { fieldKit: quote.fieldKit } : {}),
		expedition: { stage: 1, status: "travel", branch: "scavenge", cargo: { money: 0, supplies: emptySupplies(), weaponIds: [], modules: [] },
			legacyLoot: false, gunCombatBonus: (60 - weaponStats.recoil) / 1000,
			weaponMechanics: { power: weaponStats.power, reliability: weaponStats.reliability, firstBonus: weaponEffect.bonus, wearMultiplier: getWeaponMechanics(weapon).wearMultiplier },
			ammunition: { modelId: ammunition.model.id, firstBonus: ammunition.bonus, wearMultiplier: ammunition.model.wearMultiplier, ammoMultiplier: ammunition.model.ammoMultiplier },
			lootCatalogVersion: SAVE_VERSION,
			perks: [], offers: [], discoveries: [], autoDepth: isAuto ? scav.autoRaid.maxDepth : 1,
			baseChance: quote.chance, baseDuration: quote.duration, capacity: stats.capacity,
			trail: [{ at: now, label: "Выход · этап 1", text: `${scav.name} вышел в «${map.name}». ${TACTICS[scav.tactic].label}: ${quote.money} ₽, ${quote.ammo} патронов${quote.intel ? `, ${quote.intel} разведданных` : ""}${quote.medicine ? ", аптечка" : ""}.${quote.strategy.objective !== "general" || quote.strategy.preparation !== "none" ? ` Цель: ${RAID_OBJECTIVES[quote.strategy.objective].label}. ${RAID_PREPARATIONS[quote.strategy.preparation].label}.` : ""} Патрон: ${ammunition.model.label}; ${ammunition.enemy.label.toLowerCase()}.`.slice(0, 400), kind: "neutral" }],
			ammoMultiplier: getWeaponRole(weapon).ammoMultiplier * weaponStats.ammoMultiplier * stats.ammoMultiplier,
			loadout: { armorModelId: armor?.modelId ?? "none", armorCondition: armor?.durability ?? 0,
				helmetModelId: helmet?.modelId ?? null, helmetCondition: helmet?.durability ?? 0,
				packModelId: pack?.modelId ?? "none", packCondition: pack?.durability ?? 0,
				ammoType: scav.loadout.ammoType, medkit: scav.loadout.medkit } },
	};
	const beforeAmmo = state.supplies.ammo;
	state.money -= quote.money;
	state.supplies.ammo -= quote.ammo;
	state.supplies.intel -= quote.intel;
	state.supplies.medicine -= quote.medicine;
	if (quote.fieldKit) ensureShelterLogistics(state).kits[quote.fieldKit]--;
	scav.status = "raiding";
	scav.autoRaid.waitingReason = null;
	renewRaidOutcomeSeed(state, raid);
	state.raids.push(raid);
	noteAchievementDispatch(state, scav, raid, beforeAmmo, now);
	noteSquadDispatch(state, raid);
	if (!state.stats.mapsVisited.includes(map.id)) state.stats.mapsVisited.push(map.id);
	state.recruitment.tier = Math.max(state.recruitment.tier, getEarnedRecruitmentTier(state)) as RecruitTier;
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

/** Commit the whole party only after every person and every combined cost is valid. */
export function dispatchSquadRaid(state: GameState, scavIds: readonly string[], mapId: string, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время рейда.");
	const before = getSquadRaidQuote(state, scavIds, mapId);
	if (before.reason) return fail(before.reason);
	rebaseClock(state, now);
	// A ready person's repeat order must not seize them in the same click that launches a party.
	const policies = state.scavs.filter((scav) => scavIds.includes(scav.id)).map((scav) => ({ scav, enabled: scav.autoRaid.enabled }));
	for (const { scav } of policies) scav.autoRaid.enabled = false;
	try { simulateAdvance(state, now, new Set(scavIds)); }
	finally { for (const { scav, enabled } of policies) scav.autoRaid.enabled = enabled; }
	const quote = getSquadRaidQuote(state, scavIds, mapId);
	if (quote.reason) return fail(quote.reason);
	const map = ownValue(MAP_BY_ID, mapId)!;
	// Freeze every personal quote before the first dispatch changes the sector's radio support.
	const prepared = scavIds.map((scavId) => { const scav = state.scavs.find((person) => person.id === scavId)!; return { scav, quote: getRaidQuote(state, scav, map) }; });
	const raids: Raid[] = [];
	for (const [index, item] of prepared.entries()) {
		const result = startRaid(state, item.scav, map, now, false, { ...item.quote, chance: quote.members[index]!.chance });
		if (!result.ok) throw new Error("Prevalidated squad dispatch failed");
		const raid = state.raids.find((other) => other.id === result.raidId)!;
		raid.endsAt = now + quote.duration * 1000;
		raids.push(raid);
	}
	const squad = createSquadRaidSnapshot(state, raids, raids[0]!.seed);
	for (const raid of raids) raid.squad = structuredClone(squad);
	squad.actions = planSquadRaidActions(raids[0]!);
	for (const raid of raids) raid.squad = structuredClone(squad);
	return { ok: true, raidId: raids[0]!.id, message: `Отряд ${prepared.map((item) => item.scav.name).join(" / ")} вышел вместе: ${map.name}.` };
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

export function getRecruitCandidateQuote(state: GameState, candidateId: string) {
	const candidates = getRecruitmentBoard(state), candidate = candidates.find((item) => item.id === candidateId);
	const recovery = state.scavs.length === 0 ? [...candidates].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0]?.id : null;
	const money = candidate ? candidate.id === recovery ? 0 : candidate.cost : 0;
	const weaponId = state.weapons.find((weapon) => getWeaponStats(weapon).ready && !state.scavs.some((item) => item.weaponInstanceId === weapon.id))?.id ?? null;
	let reason: string | null = null;
	if (!candidate) reason = "Этот кандидат уже ушёл. Выбери оставшееся предложение.";
	else if (state.scavs.length >= getScavCapacity(state)) reason = "Отряд полон. Освободи место или построй жилую комнату.";
	else if (!Number.isFinite(money) || money < 0 || !Number.isFinite(state.money)) reason = "Некорректная стоимость найма.";
	else if (state.money < money) reason = `Для найма нужно ${money} ₽.`;
	return { money, reason, weaponId };
}
export function getRecruitmentRefreshQuote(state: GameState) {
	const tier = Math.max(state.recruitment.tier, getEarnedRecruitmentTier(state)) as RecruitTier;
	const money = 80 + tier * 30, intel = 1 + tier;
	let reason: string | null = null;
	if (state.recruitment.generation >= 1e9) reason = "Достигнут предел запросов к связным.";
	else if (state.scavs.length === 0) reason = "Сначала прими бесплатного бойца для восстановления отряда.";
	else if (state.scavs.length >= getScavCapacity(state)) reason = "Сначала освободи место в отряде или построй жилую комнату.";
	else if (!Number.isFinite(state.money) || !Number.isFinite(state.supplies.intel)) reason = "Некорректные ресурсы для запроса.";
	else if (state.money < money || state.supplies.intel < intel) reason = `Новый поиск: ${money} ₽ и ${intel} разведданных.`;
	return { money, intel, tier, reason };
}
export function refreshRecruitment(state: GameState): ActionResult {
	const quote = getRecruitmentRefreshQuote(state); if (quote.reason) return fail(quote.reason);
	const generation = state.recruitment.generation + 1, boardSeed = state.recruitment.rng;
	const board = buildRecruitmentBoard(boardSeed, generation, quote.tier, state.scavs.map((scav) => scav.appearance ?? defaultScavAppearance(scav.personality)));
	state.money -= quote.money; state.supplies.intel -= quote.intel;
	state.recruitment = { generation, tier: quote.tier, boardTier: quote.tier, boardSeed, rng: stepRecruitmentSeed(boardSeed), board, hiredCandidateIds: [] };
	return ok(`Связные нашли трёх кандидатов за ${quote.money} ₽ и ${quote.intel} разведданных. Предложения закреплены до следующего поиска.`);
}
export function hireRecruitCandidate(state: GameState, candidateId: string): ActionResult {
	const quote = getRecruitCandidateQuote(state, candidateId); if (quote.reason) return fail(quote.reason);
	const candidate = getRecruitmentBoard(state).find((item) => item.id === candidateId)!;
	const personality: Record<RecruitRole, string> = { assault: "veteran", scout: "runner", technician: "collector" };
	state.money -= quote.money;
	const scav = createScav(state, candidate.name, personality[candidate.role], candidate.combat, candidate.scouting, candidate.appearance);
	scav.story = createScavStory(candidate.id === RECOVERY_RECRUIT_ID ? `recovery:${scav.id}` : candidate.id, state.lastUpdated, true);
	// Recovery grants the old neutral recruit; no elite traits can be farmed by a wipe.
	scav.profile = quote.money === 0 ? neutralScavProfile() : { backgroundId: candidate.backgroundId, traitId: candidate.traitId, drawbackId: candidate.drawbackId, talents: [], candidateId: candidate.id };
	if (candidate.id !== RECOVERY_RECRUIT_ID) {
		state.recruitment.board = state.recruitment.board.filter((item) => item.id !== candidate.id);
		state.recruitment.hiredCandidateIds.push(candidate.id);
	}
	state.recruitment.tier = Math.max(state.recruitment.tier, getEarnedRecruitmentTier(state)) as RecruitTier;
	if (quote.weaponId) scav.weaponInstanceId = quote.weaponId;
	else if (quote.money === 0) {
		if (state.weapons.length < getStorageCapacity(state)) scav.weaponInstanceId = createWeapon(state, "pm", state.lastUpdated, 80).id;
		else {
			// A full ruined arsenal must not block the recovery kit or discard owned guns.
			const emergency = [...state.weapons].sort((a, b) => getWeaponDefinition(a).value - getWeaponDefinition(b).value || a.id.localeCompare(b.id))[0]!;
			emergency.durability = 70;
			if (emergency.modules.receiver) emergency.modules.receiver.durability = 70;
			for (const slot of RECEIVER_INFO[emergency.weaponId]!.requiredSlots) {
				if (!emergency.modules[slot]) emergency.modules[slot] = createModule(state, FACTORY_KITS[emergency.weaponId]![slot]!, state.lastUpdated, 70);
				else emergency.modules[slot]!.durability = Math.max(70, emergency.modules[slot]!.durability);
			}
			scav.weaponInstanceId = emergency.id;
		}
	}
	if (quote.money === 0) {
		// A wiped roster can begin one recovery run immediately; this never stacks.
		const firstRun = getRaidQuote(state, scav, MAP_BY_ID.courtyard!);
		state.money = Math.max(state.money, firstRun.money);
		state.supplies.ammo = Math.max(state.supplies.ammo, 3, firstRun.ammo);
	}
	ensureSquadPairs(state);
	return ok(`${scav.name} присоединился к отряду${quote.money === 0 ? " бесплатно: комплект восстановления" : ` за ${quote.money} ₽`}.`);
}
/** Compatibility entry point; explicit UI always hires a concrete persisted offer. */
export function recruitScav(state: GameState): ActionResult {
	const candidate = [...getRecruitmentBoard(state)].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0];
	return candidate ? hireRecruitCandidate(state, candidate.id) : fail("Связные ждут нового запроса. Все предложения этой подборки использованы.");
}
export function getDismissScavReason(state: GameState, scavId: string): string | null {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return "Боец не найден.";
	if (scav.status === "raiding" || state.raids.some((raid) => raid.scavId === scav.id)) return "Боец сейчас в рейде. Дождись возвращения.";
	if (scav.assignment !== null) return "Сначала освободи бойца от работы в комнате.";
	if (scav.autoRaid.enabled) return "Сначала отключи автоматические рейды бойца.";
	if (state.scavs.length <= 1) return "Последнего бойца отпускать нельзя: убежищу нужен отряд.";
	return null;
}
export function dismissScav(state: GameState, scavId: string): ActionResult {
	const reason = getDismissScavReason(state, scavId); if (reason) return fail(reason);
	const scav = state.scavs.find((item) => item.id === scavId)!;
	state.scavs = state.scavs.filter((item) => item.id !== scav.id);
	removeSquadMember(state, scav.id);
	pruneAchievementPeople(state);
	return ok(`${scav.name} покинул отряд. Всё оружие и снаряжение осталось на складе.`);
}
export function chooseScavTalent(state: GameState, scavId: string, talentId: string): ActionResult {
	const scav = state.scavs.find((item) => item.id === scavId); if (!scav) return fail("Боец не найден.");
	if (scav.status === "raiding" || state.raids.some((raid) => raid.scavId === scav.id)) return fail("Выбери развитие после возвращения из рейда.");
	const offers = getScavTalentOffers(scav), talent = offers?.offers.find((offer) => offer.id === talentId);
	if (!offers || !talent) return fail("Этот навык сейчас не предлагается.");
	scav.profile.talents.push(talent.id);
	return ok(`${scav.name}: ${talent.label}. Выбор для уровня ${offers.level} закреплён.`);
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
	state.recruitment.tier = Math.max(state.recruitment.tier, getEarnedRecruitmentTier(state)) as RecruitTier;
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
	if (weapon.durability >= 100 && Object.values(weapon.modules).every((part) => part.durability >= 100)) return fail("Оружие уже в отличном состоянии.");
	const cost = getRepairCost(weapon);
	if (state.money < cost.money || state.supplies.scrap < cost.scrap)
		return fail(`Для ремонта нужно ${cost.money} ₽ и ${cost.scrap} деталей.`);
	state.money -= cost.money;
	state.supplies.scrap -= cost.scrap;
	weapon.durability = 100;
	for (const part of Object.values(weapon.modules)) part.durability = 100;
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
	weapon.modules.receiver!.legacyAttachments = { ...weapon.attachments };
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
	if (getWeaponStats(weapon).ready && !state.weapons.some((other) => other.id !== weapon.id && getWeaponStats(other).ready)) return fail("Последнюю готовую пушку нужно оставить отряду.");
	const value = getWeaponSaleValue(weapon);
	state.weapons = state.weapons.filter((item) => item.id !== weapon.id);
	state.scavs.forEach((scav) => {
		if (scav.weaponInstanceId === weapon.id) scav.weaponInstanceId = null;
	});
	addMoney(state, value);
	pruneAchievementInventory(state);
	return ok(`Оружие продано за ${value} ₽.`);
}
export function getWeaponSaleValue(weapon: WeaponInstance): number {
	return Math.max(2, Object.values(weapon.modules).reduce((sum, part) => sum + getModuleSaleValue(part), 0));
}
export function getWeaponRecycleYield(weapon: WeaponInstance): number {
	return Math.max(1, Object.values(weapon.modules).reduce((sum, part) => sum + getModuleRecycleYield(part), 0));
}
export function recycleWeapon(state: GameState, weaponInstanceId: string): ActionResult {
	const weapon = state.weapons.find((item) => item.id === weaponInstanceId);
	if (!weapon) return fail("Оружие не найдено.");
	if (state.raids.some((raid) => raid.weaponInstanceId === weapon.id)) return fail("Оружие сейчас в рейде.");
	if (state.weapons.length <= 1) return fail("Последнюю пушку нужно оставить для отряда.");
	if (getWeaponStats(weapon).ready && !state.weapons.some((other) => other.id !== weapon.id && getWeaponStats(other).ready)) return fail("Последнюю готовую пушку нужно оставить отряду.");
	const amount = getWeaponRecycleYield(weapon);
	if (state.supplies.scrap + amount > getSupplyCapacity(state).scrap) return fail("Нет места для деталей.");
	const candidates = prepareAchievementRecycle(state, weapon.modules.receiver!.id, amount);
	state.weapons = state.weapons.filter((item) => item.id !== weapon.id);
	for (const scav of state.scavs) if (scav.weaponInstanceId === weapon.id) scav.weaponInstanceId = null;
	state.supplies.scrap += amount;
	noteAchievementSupply(state, "scrap", amount); noteAchievementRecycled(state, candidates);
	pruneAchievementInventory(state);
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

function getIndividualExpeditionChoices(state: GameState, raid: Raid, selectedPerk?: RunPerk) {
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
			* expedition.ammoMultiplier * (expedition.ammunition?.ammoMultiplier ?? (expedition.loadout.ammoType === "piercing" ? 1.65 : 1))) + (perks.includes("pathfinder") ? 1 : 0));
		const intel = map.intelCost + (branch === "recon" ? 1 : 0);
		const currentStats = weapon ? getWeaponStats(weapon) : null;
		const snapshot = expedition.weaponMechanics;
		const mechanicalBonus = snapshot && weapon && currentStats
			? (currentStats.power - snapshot.power) / 360 + (currentStats.reliability - snapshot.reliability) / 1000
				+ getWeaponRouteEffect(weapon, map.id, branch, raid.tactic, currentStats).bonus - snapshot.firstBonus
			: branch === "combat" ? expedition.gunCombatBonus : 0;
		const ammunition = expedition.ammunition && weapon ? getAmmoEffect(weapon, expedition.loadout.ammoType, map.id, branch, stage, raid.tactic) : null;
		const chance = clamp(expedition.baseChance - (stage - 1) * 0.09 + definition.chanceBonus
			+ mechanicalBonus
			+ (ammunition ? ammunition.bonus - expedition.ammunition!.firstBonus : 0)
			+ (weapon ? getWeaponRole(weapon).branches[branch] ?? 0 : 0)
			+ (perks.includes("careful") ? 0.06 : 0) - (perks.includes("haggler") ? 0.04 : 0), 0.15, 0.97);
		const unboundedDuration = Math.max(20, Math.round(expedition.baseDuration * (1 + (stage - 1) * 0.16)
			* definition.durationMultiplier * (perks.includes("pathfinder") ? 0.8 : 1)));
		const duration = raid.strategy ? Math.min(600, unboundedDuration) : unboundedDuration;
		let reason: string | null = null;
		if (expedition.status !== "choice") reason = "Дождись контрольной точки.";
		else if (!scav || !weapon || !getWeaponStats(weapon).ready) reason = "Оружию нужен ремонт: пора эвакуироваться.";
		else if (scav.health < 25) reason = "Боец слишком тяжело ранен: пора эвакуироваться.";
		else if (state.money < money) reason = `Нужно ${money} ₽ на следующий этап.`;
		else if (state.supplies.ammo < ammo) reason = `Нужно ${ammo} патронов.`;
		else if (state.supplies.intel < intel) reason = `Нужно ${intel} разведданных.`;
		return { branch, label: definition.label, description: definition.description, money, ammo, intel, chance, duration, reason, ammunition };
	});
}

export function getExpeditionChoices(state: GameState, raid: Raid, selectedPerk?: RunPerk) {
	if (!raid.squad) return getIndividualExpeditionChoices(state, raid, selectedPerk);
	const group = getRaidGroup(state, raid);
	const funded = { ...state, money: Number.MAX_SAFE_INTEGER, supplies: { ...state.supplies, ammo: Number.MAX_SAFE_INTEGER, intel: Number.MAX_SAFE_INTEGER } };
	const members = group.map((member) => getIndividualExpeditionChoices(funded, member, selectedPerk));
	return (members[0] ?? []).map((first, index) => {
		const rows = members.map((choices) => choices[index]!);
		const money = rows.reduce((sum, row) => sum + row.money, 0), ammo = rows.reduce((sum, row) => sum + row.ammo, 0), intel = rows.reduce((sum, row) => sum + row.intel, 0);
		let reason = rows.find((row) => row.reason)?.reason ?? null;
		if (!reason && group.length !== raid.squad!.members.length) reason = "Отряд неполный: нужен отход.";
		if (!reason && state.money < money) reason = `Для отряда нужно ${money} ₽ на следующий этап.`;
		if (!reason && state.supplies.ammo < ammo) reason = `Для отряда нужно ${ammo} патронов.`;
		if (!reason && state.supplies.intel < intel) reason = `Для отряда нужно ${intel} разведданных.`;
		return { ...first, money, ammo, intel, chance: rows.reduce((product, row) => product * row.chance, 1), duration: Math.max(...rows.map((row) => row.duration)), reason, ammunition: null };
	});
}

function continueAtCheckpoint(state: GameState, raid: Raid, branch: ExpeditionBranch, perk: RunPerk, now: number): ActionResult {
	const expedition = raid.expedition;
	if (!expedition || expedition.status !== "choice") return fail("Боец ещё не дошёл до контрольной точки.");
	if (!expedition.offers.includes(perk)) return fail("Выбери один из найденных приёмов для этого выхода.");
	const quote = getIndividualExpeditionChoices(state, raid, perk).find((item) => item.branch === branch);
	if (!quote) return fail("Маршрут завершён: осталось эвакуироваться.");
	if (quote.reason) return fail(quote.reason);
	noteAchievementContinue(state, raid);
	state.money -= quote.money; state.supplies.ammo -= quote.ammo; state.supplies.intel -= quote.intel;
	expedition.trail.push({ at: now, label: `Выбор · этап ${expedition.stage + 1}`, text: `${quote.label}. Приём: ${RUN_PERKS[perk].label}. Шанс ${Math.round(quote.chance * 100)}%; расход ${quote.money} ₽, ${quote.ammo} патронов${quote.intel ? `, ${quote.intel} разведданных` : ""}. Под риском весь груз: ${expedition.cargo.money} ₽ и трофеи.`, kind: "neutral" });
	expedition.perks.push(perk); expedition.offers = [];
	renewRaidOutcomeSeed(state, raid);
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
	if (raid.squad) {
		const group = getRaidGroup(state, raid);
		if (group.length !== raid.squad.members.length || group.some((member) => member.expedition?.status !== "choice" || !member.expedition.offers.includes(perk))) return fail("Весь отряд должен дойти до общей контрольной точки.");
		const quote = getExpeditionChoices(state, raid, perk).find((choice) => choice.branch === branch);
		if (!quote) return fail("Маршрут завершён: осталось эвакуироваться.");
		if (quote.reason) return fail(quote.reason);
		for (const member of group) { const result = continueAtCheckpoint(state, member, branch, perk, now); if (!result.ok) throw new Error("Prevalidated squad continuation failed"); member.endsAt = now + quote.duration * 1000; }
		const squad = structuredClone(raid.squad);
		squad.stage = raid.expedition!.stage; squad.branch = branch; squad.actions = [];
		for (const member of squad.members) { const peer = group.find((other) => other.id === member.raidId)!; member.chance = peer.chance; member.health = state.scavs.find((person) => person.id === member.scavId)!.health; if (peer.outcomeSeed !== undefined) member.outcomeSeed = peer.outcomeSeed; }
		for (const member of group) member.squad = structuredClone(squad);
		squad.actions = planSquadRaidActions(group[0]!);
		for (const member of group) member.squad = structuredClone(squad);
		return ok(`Весь отряд продолжает вместе: этап ${squad.stage}, ${quote.label.toLowerCase()}.`);
	}
	return continueAtCheckpoint(state, raid, branch, perk, now);
}
export function extractRaid(state: GameState, raidId: string, now = Date.now()): ActionResult {
	if (!isTime(now)) return fail("Некорректное время.");
	advance(state, now);
	const raid = state.raids.find((item) => item.id === raidId);
	if (!raid?.expedition || raid.expedition.status !== "choice") return fail("Эвакуация доступна на контрольной точке.");
	if (raid.squad) {
		const group = getRaidGroup(state, raid);
		if (group.length !== raid.squad.members.length || group.some((member) => member.expedition?.status !== "choice")) return fail("Весь отряд должен дойти до общей контрольной точки.");
		for (const member of group) noteAchievementExtract(state, member, now);
		state.raids = state.raids.filter((other) => !group.includes(other));
		const reports = group.map((member) => finishExpedition(state, member, true, now));
		attachSquadReports(state, raid.squad, reports);
		return ok(`Отряд эвакуирован вместе: ${reports.reduce((sum, report) => sum + report.money, 0)} ₽ и доставленный груз.`);
	}
	noteAchievementExtract(state, raid, now);
	state.raids = state.raids.filter((item) => item.id !== raidId);
	const report = finishExpedition(state, raid, true, now);
	return ok(`${raid.scavName} эвакуирован: ${report.money} ₽ и доставленный груз.`);
}

function discoverBlueprint(state: GameState, expedition: Expedition, blueprint: string) {
	if (state.blueprints.includes(blueprint)) return;
	state.blueprints.push(blueprint); expedition.discoveries.push(blueprint);
}
function fitCargo(cargo: Cargo, capacity: number, objective: RaidObjective = "general", valuedLoot = false) {
	if (valuedLoot) {
		const target = RAID_OBJECTIVES[objective].supply;
		const weights: Supplies = { ammo: .1, medicine: 1, scrap: .5, intel: .25 };
		const values: Supplies = { ammo: 6.5, medicine: 100 / 3, scrap: 14.5, intel: 140 / 3 };
		// Orders protect the requested resource; otherwise discard the least value per unit of bag space.
		while (getCargoWeight(cargo) > capacity) {
			const candidates: { density: number; discard: () => void }[] = [];
			for (const key of Object.keys(weights) as (keyof Supplies)[]) if (key !== target && cargo.supplies[key] > 0) candidates.push({ density: values[key] / weights[key], discard: () => { cargo.supplies[key]--; } });
			cargo.weaponIds.forEach((weaponId, index) => candidates.push({ density: ownValue(WEAPON_BY_ID, weaponId)!.value * .5 / 6, discard: () => { cargo.weaponIds.splice(index, 1); } }));
			cargo.modules.forEach((part, index) => candidates.push({ density: getModuleDefinition(part).value * (.4 + part.durability * .006) / Math.max(.05, getModuleDefinition(part).stats.weight), discard: () => { cargo.modules.splice(index, 1); } }));
			(cargo.lootItems ?? []).forEach((item, index) => candidates.push({ density: getLootModel(item).guidePrice / getLootModel(item).weight, discard: () => { cargo.lootItems!.splice(index, 1); } }));
			if (!candidates.length) { if (target && cargo.supplies[target] > 0) cargo.supplies[target]--; else break; }
			else candidates.sort((a, b) => a.density - b.density)[0]!.discard();
		}
		return;
	}
	// Currency weighs nothing. Preserve previous cargo and favour real guns over bulk supplies.
	const target = RAID_OBJECTIVES[objective].supply;
	const discardSupply = (key: keyof Supplies) => {
		const weight = key === "ammo" ? 0.1 : key === "scrap" ? 0.5 : key === "medicine" ? 1 : 0.25;
		const overflow = getCargoWeight(cargo) - capacity;
		if (overflow <= 0) return;
		cargo.supplies[key] = Math.max(0, cargo.supplies[key] - Math.ceil((overflow - 0.00001) / weight));
	};
	// A supply order keeps its promised resource ahead of other supplies and trophies.
	for (const key of ["ammo", "scrap", "medicine", "intel"] as (keyof Supplies)[]) if (key !== target) discardSupply(key);
	while (getCargoWeight(cargo) > capacity && cargo.weaponIds.length > 0) cargo.weaponIds.pop();
	while (getCargoWeight(cargo) > capacity && cargo.modules.length > 0) cargo.modules.pop();
	if (target) discardSupply(target);
}
function wearEquippedGear(state: GameState, scav: Scav, stage: number, failed: boolean) {
	for (const key of ["armorItemId", "helmetItemId", "backpackItemId"] as const) {
		const item = state.gearItems.find((gear) => gear.id === scav.loadout[key]);
		if (item) item.durability = Math.max(0, item.durability - (key === "backpackItemId" ? 3 + stage : 4 + stage * 2 + (failed ? 8 : 0)));
	}
}
/** Resolve a checkpoint exactly once. A successful manual checkpoint remains an active raid. */
function reachCheckpoint(state: GameState, raid: Raid, now: number, party?: { injuryMultiplier: number; rescuedBy: string | null }): RaidReport | null {
	const expedition = raid.expedition!;
	const objective = RAID_OBJECTIVES[raid.strategy?.objective ?? "general"];
	const map = ownValue(MAP_BY_ID, raid.mapId)!;
	const scav = state.scavs.find((item) => item.id === raid.scavId)!;
	const weapon = state.weapons.find((item) => item.id === raid.weaponInstanceId)!;
	// Street observations change bounded rewards only here; previews never roll,
	// credit loot, touch damage, or consume the existing settlement RNG streams.
	const field = expedition.legacyLoot ? null : getRaidFieldOutcome(raid);
	const streetText = field ? ` ${field.narrative}` : "";
	const random = generator(((raid.outcomeSeed ?? raid.seed) ^ Math.imul(expedition.stage, 0x45d9f3b)) >>> 0);
	const success = random() < raid.chance;
	const discoveriesBefore = expedition.discoveries.length;
	// Discoveries are radioed home on arrival, before the fight or attempted escape.
	discoverBlueprint(state, expedition, `route:${map.id}`);
	if (expedition.stage >= 2 && expedition.branch !== "recon") {
		discoverBlueprint(state, expedition, expedition.branch === "combat" ? "plate_armor" : "cargo_pack");
	}
	noteAchievementCheckpoint(state, raid, now);
	const discoveriesText = expedition.discoveries.slice(discoveriesBefore).map((blueprint) => BLUEPRINTS[blueprint]!.label).join(", ");
	const armor = ownValue(GEAR_MODEL_BY_ID, expedition.loadout.armorModelId);
	const helmet = expedition.loadout.helmetModelId ? ownValue(GEAR_MODEL_BY_ID, expedition.loadout.helmetModelId) : undefined;
	const protection = (armor?.protection ?? 0) * expedition.loadout.armorCondition / 100 + (helmet?.protection ?? 0) * (expedition.loadout.helmetCondition ?? 0) / 100;
	const ammunition = expedition.ammunition ? getAmmoEffect(weapon, expedition.loadout.ammoType, map.id, expedition.branch, expedition.stage, raid.tactic) : null;
	const injury = TACTICS[raid.tactic].injuryMultiplier * (1 - raid.armorLevel * 0.1) * (1 - protection * 2)
		* (expedition.perks.includes("fieldMedic") ? 0.5 : 1) * (expedition.loadout.medkit ? 0.75 : 1) * (party?.injuryMultiplier ?? 1) * (ammunition?.injuryMultiplier ?? 1) * getFieldKitEffects(raid.fieldKit).injuryMultiplier;
	if (raid.squad) {
		const actions = raid.squad.actions.filter((action) => action.actorId === scav.id || action.targetId === scav.id);
		expedition.trail.push({ at: now, label: `Отряд · этап ${expedition.stage}`, text: actions.map((action) => action.text).join(" ").slice(0, 400), kind: actions.some((action) => action.kind === "hesitation") ? "danger" : "neutral" });
	}
	weapon.durability = Math.max(0, weapon.durability - Math.ceil((5 + random() * (7 + map.danger * 8) + expedition.stage * 2)
		* (expedition.perks.includes("gunsmith") ? 0.5 : 1) * (expedition.weaponMechanics?.wearMultiplier ?? 1) * (expedition.ammunition?.wearMultiplier ?? 1) * getFieldKitEffects(raid.fieldKit).wearMultiplier));
	if (weapon.modules.receiver) weapon.modules.receiver.durability = weapon.durability;
	if (!expedition.legacyLoot) for (const [slot, part] of Object.entries(weapon.modules)) if (slot !== "receiver") part.durability = Math.max(0, part.durability - (expedition.perks.includes("gunsmith") ? 1 : 2 + expedition.stage) * getFieldKitEffects(raid.fieldKit).wearMultiplier);
	wearEquippedGear(state, scav, expedition.stage, !success);
	if (!success) {
		expedition.trail.push({ at: now, label: `Засада · этап ${expedition.stage}`, text: (`Маршрут «${EXPEDITION_BRANCHES[expedition.branch].label}» сорван. Невынесенный груз потерян.${discoveriesText ? ` По рации передано: ${discoveriesText}.` : ""}${streetText}`).slice(0, 400), kind: "danger" });
		scav.health = Math.max(0, scav.health - Math.ceil((32 + random() * 35 + expedition.stage * 4) * injury));
		state.raids = state.raids.filter((item) => item.id !== raid.id);
		return finishExpedition(state, raid, false, now, party?.rescuedBy ?? null);
	}
	scav.health = Math.max(25, scav.health - Math.ceil((3 + random() * (8 + map.danger * 10) + expedition.stage * 2) * injury));
	if (raid.strategy && expedition.branch === "recon") expedition.reconCompleted = true;
	const branch = EXPEDITION_BRANCHES[expedition.branch];
	const lootMultiplier = Math.max(0.3, (0.5 + expedition.stage * 0.25) * (1 + raid.lootBonus + branch.lootBonus)
		* (expedition.perks.includes("careful") ? 0.9 : 1));
	expedition.cargo.money += Math.round((map.reward[0] + random() * (map.reward[1] - map.reward[0])) * lootMultiplier
		* (expedition.perks.includes("haggler") ? 1.2 : 1) * (field?.moneyMultiplier ?? 1) * objective.moneyMultiplier);
	expedition.cargo.supplies.ammo += 2 + Math.floor(random() * (4 + map.level));
	expedition.cargo.supplies.medicine += random() < 0.45 ? 1 : 0;
	expedition.cargo.supplies.scrap += 2 + Math.floor(random() * (expedition.branch === "scavenge" ? 7 + map.level : 4 + map.level));
	expedition.cargo.supplies.intel += expedition.branch === "recon" ? 2 + Math.floor(random() * 2) : random() < 0.4 ? 1 : 0;
	if (field) for (const key of Object.keys(field.resourceBonus) as (keyof Supplies)[]) expedition.cargo.supplies[key] += field.resourceBonus[key];
	if (objective.supply) expedition.cargo.supplies[objective.supply] += objective.resourceBonus;
	const weaponChance = map.weaponChance * (expedition.branch === "combat" ? 1.15 : 0.7) * (expedition.legacyLoot ? 1 : 0.24) + (expedition.perks.includes("gunsmith") ? 0.1 : 0);
	const lootVersion = expedition.lootCatalogVersion ?? 15;
	const lootWeapons = map.weapons.filter((weaponId) => weaponAvailableInSave(weaponId, lootVersion));
	if (random() < weaponChance) {
		const weaponId = lootWeapons[Math.min(lootWeapons.length - 1, Math.floor(random() ** (1.5 - expedition.stage * 0.16) * lootWeapons.length))]!;
		if (!state.discoveredWeapons.includes(weaponId)) state.discoveredWeapons.push(weaponId);
		expedition.cargo.weaponIds.push(weaponId);
	}
	if (!expedition.legacyLoot) {
		const partsRandom = generator(((raid.outcomeSeed ?? raid.seed) ^ Math.imul(expedition.stage, 0x2c1b3c6d)) >>> 0);
		const strategyPartsRandom = generator(((raid.outcomeSeed ?? raid.seed) ^ Math.imul(expedition.stage, 0x72e51b09)) >>> 0);
		const count = expedition.branch === "combat" ? 2 + Math.floor(partsRandom() * 2) : 1 + (partsRandom() < 0.35 ? 1 : 0);
		for (let i = 0; i < count; i++) {
			const receiverRoll = partsRandom() < (expedition.branch === "combat" ? 0.32 : 0.12);
			const weaponId = lootWeapons[Math.floor(partsRandom() * lootWeapons.length)]!;
			const info = RECEIVER_INFO[weaponId]!;
			const pool = MODULE_MODELS.filter((model) => moduleAvailableInSave(model.id, lootVersion) && (receiverRoll ? model.id === `receiver-${weaponId}`
				: model.slot !== "receiver" && model.lootTier <= expedition.stage + (expedition.perks.includes("gunsmith") ? 1 : 0)
					&& (model.platforms.includes("*") || model.platforms.includes(info.platform)) && (model.calibers.includes("*") || model.calibers.includes(info.caliber))));
			const weightedPool = !receiverRoll && field?.preferredSlots.length ? pool.flatMap((model) => field.preferredSlots.includes(model.slot) ? [model, model] : [model]) : pool;
			const model = weightedPool[Math.floor(partsRandom() * weightedPool.length)]!;
			const durability = Math.min(100, 45 + Math.floor(partsRandom() * 46) + (expedition.perks.includes("gunsmith") ? 10 : 0));
			if (objective.moduleMultiplier < 1 && strategyPartsRandom() >= objective.moduleMultiplier) continue;
			expedition.cargo.modules.push(createModule(state, model.id, now, durability));
			if (model.slot === "receiver" && !state.discoveredWeapons.includes(model.weaponId!)) state.discoveredWeapons.push(model.weaponId!);
		}
	}
	if (raid.lootVersion === 1) {
		const lootRandom = generator(((raid.outcomeSeed ?? raid.seed) ^ Math.imul(expedition.stage, 0x4e731ac5)) >>> 0);
		const finds = rollRaidLoot(map.id, expedition.branch, expedition.stage, lootRandom);
		expedition.cargo.lootItems ??= [];
		for (const model of finds) expedition.cargo.lootItems.push({ id: id(state, "loot"), modelId: model.id, foundAt: now });
	}
	fitCargo(expedition.cargo, expedition.capacity, raid.strategy?.objective, raid.lootVersion === 1);
	expedition.trail.push({ at: now, label: `Контрольная точка ${expedition.stage}`, text: (`Маршрут «${EXPEDITION_BRANCHES[expedition.branch].label}» пройден. В рюкзаке ${expedition.cargo.money} ₽, ${getCargoWeight(expedition.cargo)} ед. груза и ${expedition.cargo.weaponIds.length} ед. оружия.${discoveriesText ? ` Передано: ${discoveriesText}.` : ""}${streetText}`).slice(0, 400), kind: "loot" });
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

function attachSquadReports(state: GameState, snapshot: SquadRaidSnapshot, reports: RaidReport[]) {
	const squad: SquadRaidReport = { ...structuredClone(snapshot), usedMedkits: snapshot.actions.filter((action) => action.kind === "rescue").map((action) => action.actorId), outcomes: snapshot.members.map((member) => {
		const report = reports.find((result) => result.raidId === member.raidId)!;
		return { scavId: member.scavId, raidId: member.raidId, success: report.success, lostScav: report.lostScav, lostWeapon: report.lostWeapon, health: state.scavs.find((scav) => scav.id === member.scavId)?.health ?? 0, rescuedBy: snapshot.actions.find((action) => action.kind === "rescue" && action.targetId === member.scavId)?.actorId ?? null };
	}) };
	for (const report of reports) report.squad = structuredClone(squad);
	completeStrategySortie(state, reports);
}

function completeStrategySortie(state: GameState, reports: RaidReport[]) {
	const planned = reports.filter(report => report.strategy);
	if (!planned.length) return;
	const mapId = planned[0]!.mapId;
	const learned = planned.some(report => report.success && (report.strategy!.objective === "intel" || report.reconCompleted));
	const outcome = settleSectorIntel(state, mapId, learned, planned.some(report => report.depth >= 2));
	for (const report of planned) {
		report.sectorOutcome = { ...outcome };
		const last = report.events.at(-1);
		if (last) last.text = `${last.text} Сектор: изученность ${outcome.knowledge}/5, патрули ${outcome.pressure}/6.`.slice(0, 400);
	}
}
function reachSquadCheckpoint(state: GameState, raid: Raid, now: number): RaidReport[] {
	const squad = raid.squad!, group = getRaidGroup(state, raid), reports: RaidReport[] = [];
	for (const member of group) {
		const report = reachCheckpoint(state, member, now, { injuryMultiplier: squadInjuryMultiplier(squad, member.scavId), rescuedBy: squad.actions.find((action) => action.kind === "rescue" && action.targetId === member.scavId)?.actorId ?? null });
		if (report) reports.push(report);
	}
	if (reports.length) {
		// A disrupted formation retreats together. Those who passed retain only their own real cargo.
		for (const member of group) if (state.raids.includes(member)) {
			state.raids = state.raids.filter((other) => other.id !== member.id);
			const last = member.expedition!.trail.at(-1)!;
			last.text = `${last.text} Один из бойцов попал в засаду. Остальные прекращают продвижение и возвращаются вместе с отрядом.`.slice(0, 400);
			reports.push(finishExpedition(state, member, true, now));
		}
		attachSquadReports(state, squad, reports);
	} else {
		const offers = group[0]!.expedition!.offers;
		for (const member of group) member.expedition!.offers = [...offers];
	}
	return reports;
}

function finishExpedition(state: GameState, raid: Raid, success: boolean, now: number, rescuedBy: string | null = null): RaidReport {
	const expedition = raid.expedition!;
	const map = ownValue(MAP_BY_ID, raid.mapId)!;
	const scav = state.scavs.find((item) => item.id === raid.scavId)!;
	const random = generator(((raid.outcomeSeed ?? raid.seed) ^ Math.imul(expedition.stage, 0x6c078965)) >>> 0);
	const report: RaidReport = { id: id(state, "report"), raidId: raid.id, scavName: raid.scavName, mapId: raid.mapId,
		scavAppearance: raid.scavAppearance ?? scav.appearance ?? defaultScavAppearance(scav.personality),
		at: now, success, lostScav: false, lostWeapon: false, money: 0, supplies: emptySupplies(), weaponId: null,
		weaponAutoSold: false, description: "", isAuto: raid.isAuto, tactic: raid.tactic, events: [], depth: expedition.stage,
		discoveries: [...expedition.discoveries], lostCargo: success ? null : structuredClone(expedition.cargo), moduleIds: [],
		...(raid.strategy ? { strategy: { ...raid.strategy } } : {}), ...(expedition.reconCompleted ? { reconCompleted: true } : {}), ...(raid.fieldKit ? { fieldKit: raid.fieldKit } : {}),
		...(raid.lootVersion === 1 ? { lootItems: [], lootPending: [] } : {}) };
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
			if (state.weapons.length < getStorageCapacity(state)) {
				const found = createWeapon(state, weaponId, now, 50 + Math.floor(random() * 46));
				if (!expedition.legacyLoot) {
					const stripped = generator(((raid.outcomeSeed ?? raid.seed) ^ Math.imul(expedition.stage, 0x297a2d39) ^ found.weaponId.length) >>> 0)() < 0.3;
					if (stripped) delete found.modules[getWeaponDefinition(found).category === "pistol" ? "magazine" : "stock"];
				}
				noteAchievementLoot(state, raid.id, [found.id, ...Object.values(found.modules).map((part) => part.id)]);
			}
			else { report.weaponAutoSold = true; report.money += Math.round(definition.value * 0.35); }
		}
		for (const part of expedition.cargo.modules) {
			report.moduleIds.push(part.modelId);
			const model = getModuleDefinition(part);
			if (model.slot === "receiver") { state.stats.weaponsFound++; if (["rare", "epic", "legendary"].includes(ownValue(WEAPON_BY_ID, model.weaponId!)!.rarity)) state.stats.rareWeaponsFound++; }
			if (state.modules.length < getModuleCapacity(state)) { state.modules.push(part); noteAchievementLoot(state, raid.id, [part.id]); } else report.money += getModuleSaleValue(part);
		}
		for (const item of expedition.cargo.lootItems ?? []) {
			state.lootItems ??= [];
			if (state.lootItems.length < getLootCapacity(state)) { state.lootItems.push(item); report.lootItems!.push(structuredClone(item)); }
			else report.lootPending!.push(structuredClone(item));
		}
		if (report.lootPending?.length) (state.pendingLoot ??= []).push({ id: id(state, "delivery"), raidId: raid.id, at: now, items: structuredClone(report.lootPending) });
		addMoney(state, report.money);
		report.description = `Эвакуация после этапа ${expedition.stage}. Груз доставлен${report.weaponAutoSold ? "; лишний трофей продан" : ""}.`;
		if (report.lootPending?.length) report.description += ` Склад трофеев полон: ${report.lootPending.length} предметов ждут в посылке. Освободи место и забери их целыми.`;
		const discarded = getCargoWeight({ money: 0, supplies: {
			ammo: expedition.cargo.supplies.ammo - report.supplies.ammo, medicine: expedition.cargo.supplies.medicine - report.supplies.medicine,
			scrap: expedition.cargo.supplies.scrap - report.supplies.scrap, intel: expedition.cargo.supplies.intel - report.supplies.intel }, weaponIds: [], modules: [] });
		if (discarded > 0) report.description += " Часть припасов оставлена: склад полон.";
	} else {
		report.lostWeapon = random() < 0.2 + map.danger * 0.22 + (expedition.stage - 1) * 0.08;
		report.lostScav = random() < (map.danger * 0.08 + (expedition.stage - 1) * 0.018) * TACTICS[raid.tactic].fatalityMultiplier;
		if (rescuedBy) { report.lostScav = false; report.lostWeapon = false; scav.health = clamp(scav.health, 5, 24); }
		if (report.lostWeapon || report.lostScav) {
			report.lostWeapon = true; state.weapons = state.weapons.filter((item) => item.id !== raid.weaponInstanceId); scav.weaponInstanceId = null;
		}
		if (report.lostScav) {
			state.scavs = state.scavs.filter((item) => item.id !== scav.id); state.stats.lostScavs++;
			state.gearItems = state.gearItems.filter((item) => ![scav.loadout.armorItemId, scav.loadout.helmetItemId, scav.loadout.backpackItemId].includes(item.id));
		}
		report.description = `Выход сорван на этапе ${expedition.stage}. Невынесенный груз потерян. ${rescuedBy ? `Товарищ ${raid.squad?.members.find((member) => member.scavId === rescuedBy)?.scavName ?? "из отряда"} спас бойца и его оружие личной аптечкой.` : report.lostScav ? "Боец пропал." : report.lostWeapon ? "Боец вернулся без оружия." : "Боец вернулся раненым."}`;
	}
	if (report.discoveries.length) report.description += " Переданные чертежи сохранены.";
	noteAchievementRaidFinished(state, raid, report);
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
	if (!raid.squad) completeStrategySortie(state, [report]);
	noteScavRaid(scav, report);
	if (report.lostScav) rememberLostScav(state, scav, report);
	noteSquadRaid(state, scav, report);
	pruneAchievementPeople(state);
	state.history.unshift(report); state.history.length = Math.min(state.history.length, 40);
	state.recruitment.tier = Math.max(state.recruitment.tier, getEarnedRecruitmentTier(state)) as RecruitTier;
	return report;
}

function finishRaid(state: GameState, raid: Raid): RaidReport {
	const map = ownValue(MAP_BY_ID, raid.mapId);
	if (!map) throw new Error("Неизвестный сектор");
	const scav = state.scavs.find((item) => item.id === raid.scavId)!;
	const weapon = state.weapons.find(
		(item) => item.id === raid.weaponInstanceId
	)!;
	const random = generator(raid.outcomeSeed ?? raid.seed);
	const success = random() < raid.chance;
	const report: RaidReport = {
		id: id(state, "report"),
		raidId: raid.id,
		scavName: raid.scavName,
		scavAppearance: raid.scavAppearance ?? scav.appearance ?? defaultScavAppearance(scav.personality),
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
		moduleIds: [],
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
	if (weapon.modules.receiver) weapon.modules.receiver.durability = weapon.durability;
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
			noteAchievementSupply(state, key, report.supplies[key]);
		});
		addXp(state, map.xp);
		scav.xp += map.xp;
		scav.health = Math.max(
			25,
			scav.health - Math.ceil((3 + Math.floor(random() * (9 + map.danger * 12))) * injuryMultiplier)
		);
		if (random() < map.weaponChance) {
			const roll = random();
			const lootWeapons = map.weapons.filter((weaponId) => weaponAvailableInSave(weaponId, 15));
			const index = Math.min(
				lootWeapons.length - 1,
				Math.floor(
					roll ** (1.45 - Math.min(0.4, raid.lootBonus)) * lootWeapons.length
				)
			);
			report.weaponId = lootWeapons[index]!;
			const foundDefinition = ownValue(WEAPON_BY_ID, report.weaponId);
			if (!foundDefinition) throw new Error("Неизвестное оружие в добыче");
			state.stats.weaponsFound++;
			if (["rare", "epic", "legendary"].includes(foundDefinition.rarity))
				state.stats.rareWeaponsFound++;
			if (!state.discoveredWeapons.includes(report.weaponId))
				state.discoveredWeapons.push(report.weaponId);
			if (state.weapons.length < getStorageCapacity(state)) {
				const found = createWeapon(
					state,
					report.weaponId,
					raid.endsAt,
					55 + Math.floor(random() * 46)
				);
				noteAchievementLoot(state, raid.id, [found.id, ...Object.values(found.modules).map((part) => part.id)]);
			}
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
	noteAchievementRaidFinished(state, raid, report);
	noteScavRaid(scav, report);
	if (report.lostScav) rememberLostScav(state, scav, report);
	noteSquadRaid(state, scav, report);
	pruneAchievementPeople(state);
	state.history.unshift(report);
	state.history.length = Math.min(state.history.length, 40);
	state.recruitment.tier = Math.max(state.recruitment.tier, getEarnedRecruitmentTier(state)) as RecruitTier;
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

function simulateAdvance(state: GameState, now: number, stoppedAtBoundary: ReadonlySet<string> = new Set(), stoppedProductionAtBoundary: ReadonlySet<string> = new Set()): AdvanceSummary {
	const summary: AdvanceSummary = {
		elapsedMs: 0,
		capped: false,
		money: 0,
		completed: [],
		completedCount: 0,
	};
	if (!isTime(now) || now < state.lastUpdated) return summary;
	if (now === state.lastUpdated) { settleShelter(state, now, stoppedProductionAtBoundary); attemptAutoRaids(state, now, stoppedAtBoundary); settleShelter(state, now, stoppedProductionAtBoundary); return summary; }
	const elapsed = now - state.lastUpdated;
	summary.elapsedMs = Math.min(elapsed, MAX_OFFLINE_MS);
	summary.capped = elapsed > MAX_OFFLINE_MS;
	const beforeMoney = state.money;
	const end = state.lastUpdated + summary.elapsedMs;
	let cursor = state.lastUpdated;
	while (true) {
		settleShelter(state, cursor, cursor === end ? stoppedProductionAtBoundary : new Set());
		// Production and recovery for this timestamp precede settlements; all
		// simultaneous settlements precede resource competition for new exits.
		const due = state.raids.filter((raid) => raid.endsAt <= cursor && raid.expedition?.status !== "choice")
			.sort((a, b) => a.endsAt - b.endsAt || a.id.localeCompare(b.id));
		for (const raid of due) {
			if (!state.raids.includes(raid) || raid.expedition?.status === "choice") continue;
			if (raid.squad) {
				const reports = reachSquadCheckpoint(state, raid, cursor);
				for (const report of reports) { summary.completed.push(report); summary.completedCount++; if (summary.completed.length > 40) summary.completed.shift(); }
				continue;
			}
			let report: RaidReport | null;
			if (raid.expedition) report = reachCheckpoint(state, raid, cursor);
			else { state.raids = state.raids.filter((item) => item.id !== raid.id); report = finishRaid(state, raid); }
			if (report) {
				summary.completed.push(report); summary.completedCount++;
				if (summary.completed.length > 40) summary.completed.shift();
			}
		}
		attemptAutoRaids(state, cursor, cursor === end ? stoppedAtBoundary : new Set());
		settleShelter(state, cursor, cursor === end ? stoppedProductionAtBoundary : new Set());
		if (cursor >= end) break;
		let next = nextShelterEvent(state, cursor, end);
		for (const raid of state.raids) if (raid.expedition?.status !== "choice") next = Math.min(next, raid.endsAt);
		for (const scav of state.scavs) {
			if (!scav.autoRaid.enabled || scav.status === "raiding" || scav.assignment) continue;
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
		progressShelter(state, next - cursor);
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

export function resolveSocialEvent(state: GameState, eventId: string, choiceId: string): ActionResult {
	const event = getSquadSocialEvents(state).find((item) => item.id === eventId);
	const result = resolveSquadSocialEvent(state, eventId, choiceId);
	if (result.ok && event?.eventId === "friction" && event.pairId) noteAchievementSocialDecision(state, event.pairId, choiceId);
	return result;
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
function parseAppearance(value: unknown): number {
	if (!isScavAppearance(value)) throw new Error("appearance");
	return value;
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
function versionedWeaponId(value: unknown, version: number): string {
	const id = known(value, WEAPON_BY_ID);
	if (!weaponAvailableInSave(id, version)) throw new Error("future-weapon");
	return id;
}
function versionedModuleId(value: unknown, version: number): string {
	const id = known(value, MODULE_BY_ID);
	if (!moduleAvailableInSave(id, version)) throw new Error("future-module");
	return id;
}
function parseModule(value: unknown, version: number): ModuleInstance {
	const source = record(value); fields(source, ["id", "modelId", "durability", "foundAt", "legacyAttachments"]);
	const item: ModuleInstance = { id: string(source.id), modelId: versionedModuleId(source.modelId, version), durability: number(source.durability, 100), foundAt: number(source.foundAt) };
	if (source.legacyAttachments !== undefined) {
		if (getModuleDefinition(item).slot !== "receiver") throw new Error("legacy-module");
		const legacy = record(source.legacyAttachments); fields(legacy, attachmentKeys);
		item.legacyAttachments = { optic: number(legacy.optic, 3, 0, true), magazine: number(legacy.magazine, 3, 0, true), stock: number(legacy.stock, 3, 0, true) };
	}
	return item;
}
function parseWeapon(value: unknown, version: number): WeaponInstance {
	const source = record(value);
	fields(source, ["id", "weaponId", "durability", "foundAt", "attachments", ...(version >= 4 ? ["modules"] : [])]);
	const attachments = record(source.attachments);
	fields(attachments, attachmentKeys);
	const modules: WeaponInstance["modules"] = {};
	if (version >= 4) { const parts = record(source.modules); fields(parts, MODULE_SLOTS); for (const [slot, value] of Object.entries(parts)) modules[slot as ModuleSlot] = parseModule(value, version); }
	return {
		id: string(source.id),
		weaponId: versionedWeaponId(source.weaponId, version),
		durability: number(source.durability, 100),
		foundAt: number(source.foundAt),
		modules,
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
const isTradeItemId = (value: string, prefix: string) => new RegExp(`^${prefix}-[1-9]\\d*$`).test(value) && Number(value.split("-")[1]) < 1e12;
/** Strict physical escrow parsers use the same save rules, including gun/module compatibility. */
export function parseTradeWeapon(value: unknown): WeaponInstance | null {
	try {
		const gun = parseWeapon(value, SAVE_VERSION), parts = Object.values(gun.modules);
		if (!isTradeItemId(gun.id, "gun") || !gun.modules.receiver || gun.modules.receiver.durability !== gun.durability || attachmentKeys.some(key => gun.attachments[key] !== (gun.modules.receiver!.legacyAttachments?.[key] ?? 0))) return null;
		unique([gun.id, ...parts.map(part => part.id)]);
		for (const [slot, part] of Object.entries(gun.modules)) if (!isTradeItemId(part.id, "module") || getModuleDefinition(part).slot !== slot || moduleFitReason(gun, part)) return null;
		return gun;
	} catch { return null; }
}
export function parseTradeModule(value: unknown): ModuleInstance | null { try { const item = parseModule(value, SAVE_VERSION); return isTradeItemId(item.id, "module") ? item : null; } catch { return null; } }
export function parseTradeGear(value: unknown): GearItem | null { try { const item = parseGear(value); return isTradeItemId(item.id, "gear") ? item : null; } catch { return null; } }
function parseAmmoType(value: unknown, version: number): AmmoType {
	if (!isAmmoType(value) || (version < 15 && !["standard", "piercing", "expanding", "precision"].includes(value)) || (version < 13 && value !== "standard" && value !== "piercing")) throw new Error("ammo-type");
	return value;
}
function parseLoadout(value: unknown, version: number): Loadout {
	const source = record(value);
	fields(source, ["armorItemId", "helmetItemId", "backpackItemId", "ammoType", "medkit"]);
	return { armorItemId: source.armorItemId === null ? null : string(source.armorItemId),
		helmetItemId: source.helmetItemId === undefined || source.helmetItemId === null ? null : string(source.helmetItemId),
		backpackItemId: source.backpackItemId === null ? null : string(source.backpackItemId),
		ammoType: parseAmmoType(source.ammoType, version), medkit: bool(source.medkit) };
}
function parseCargo(value: unknown, version: number): Cargo {
	const source = record(value);
	fields(source, ["money", "supplies", "weaponIds", ...(version >= 4 ? ["modules"] : []), ...(version >= 16 ? ["lootItems"] : [])]);
	return { money: number(source.money, 1e8), supplies: parseSupplies(source.supplies), weaponIds: array(source.weaponIds, 3, (value) => versionedWeaponId(value, version)), modules: version >= 4 ? array(source.modules, 12, (value) => parseModule(value, version)) : [], ...(version >= 16 && Object.hasOwn(source, "lootItems") ? { lootItems: array(source.lootItems, 6, parseLootItem) } : {}) };
}
function parseEvents(value: unknown, max: number): RaidReport["events"] {
	return array(value, max, (value) => {
		const event = record(value);
		fields(event, ["at", "label", "text", "kind"]);
		if (!["neutral", "loot", "danger", "success"].includes(event.kind as string)) throw new Error("event-kind");
		return { at: number(event.at), label: string(event.label, 50), text: string(event.text, 400), kind: event.kind as RaidReport["events"][number]["kind"] };
	});
}
function parseExpedition(value: unknown, version: number): Expedition | null {
	if (value === null) return null;
	const source = record(value);
	fields(source, ["stage", "status", "branch", "cargo", "perks", "offers", "discoveries", "loadout", "autoDepth", "baseChance", "baseDuration", "capacity", "ammoMultiplier", "trail", ...(version >= 4 ? ["legacyLoot", "gunCombatBonus"] : []), ...(version >= 11 ? ["weaponMechanics"] : []), ...(version >= 12 ? ["reconCompleted"] : []), ...(version >= 13 ? ["ammunition"] : []), ...(version >= ARSENAL_SAVE_VERSION ? ["lootCatalogVersion"] : [])]);
	const loadout = record(source.loadout);
	fields(loadout, ["armorModelId", "armorCondition", "helmetModelId", "helmetCondition", "packModelId", "packCondition", "ammoType", "medkit"]);
	if (source.status !== "travel" && source.status !== "choice") throw new Error("checkpoint-status");
	const armorModelId = loadout.armorModelId === "none" ? "none" : known(loadout.armorModelId, GEAR_MODEL_BY_ID);
	const helmetModelId = loadout.helmetModelId === undefined || loadout.helmetModelId === null ? null : known(loadout.helmetModelId, GEAR_MODEL_BY_ID);
	const helmetCondition = loadout.helmetCondition === undefined ? 0 : number(loadout.helmetCondition, 100);
	const packModelId = loadout.packModelId === "none" ? "none" : known(loadout.packModelId, GEAR_MODEL_BY_ID);
	if (armorModelId !== "none" && ownValue(GEAR_MODEL_BY_ID, armorModelId)?.slot !== "armor") throw new Error("armor-slot");
	if (helmetModelId !== null && ownValue(GEAR_MODEL_BY_ID, helmetModelId)?.slot !== "helmet") throw new Error("helmet-slot");
	if (helmetModelId === null && helmetCondition !== 0) throw new Error("helmet-condition");
	if (packModelId !== "none" && ownValue(GEAR_MODEL_BY_ID, packModelId)?.slot !== "backpack") throw new Error("pack-slot");
	const expedition: Expedition = { stage: number(source.stage, 3, 1, true), status: source.status,
		branch: known(source.branch, EXPEDITION_BRANCHES) as ExpeditionBranch, cargo: parseCargo(source.cargo, version),
		legacyLoot: version >= 4 ? bool(source.legacyLoot) : true, gunCombatBonus: version >= 4 ? number(source.gunCombatBonus, 0.1, -0.1) : 0,
		perks: array(source.perks, 2, (value) => known(value, RUN_PERKS) as RunPerk),
		offers: array(source.offers, 2, (value) => known(value, RUN_PERKS) as RunPerk),
		discoveries: array(source.discoveries, Object.keys(BLUEPRINTS).length, (value) => known(value, BLUEPRINTS)),
		loadout: { armorModelId, armorCondition: number(loadout.armorCondition, 100), helmetModelId, helmetCondition, packModelId, packCondition: number(loadout.packCondition, 100), ammoType: parseAmmoType(loadout.ammoType, version), medkit: bool(loadout.medkit) },
		autoDepth: number(source.autoDepth, 3, 1, true), baseChance: number(source.baseChance, 1), baseDuration: number(source.baseDuration, 600, 20),
		capacity: number(source.capacity, version >= 6 ? 50 : 42, version >= 6 ? 8 : 10), ammoMultiplier: number(source.ammoMultiplier, 4, 0.2), trail: parseEvents(source.trail, 9) };
	if (version >= 11 && Object.hasOwn(source, "weaponMechanics")) {
		const snapshot = record(source.weaponMechanics);
		fields(snapshot, ["power", "reliability", "firstBonus", "wearMultiplier"]);
		expedition.weaponMechanics = { power: number(snapshot.power, 250, 0, true), reliability: number(snapshot.reliability, 100, 10, true), firstBonus: number(snapshot.firstBonus, .12, -.12), wearMultiplier: number(snapshot.wearMultiplier, 1.4, .85) };
	}
	if (version >= 13 && Object.hasOwn(source, "ammunition")) {
		const ammo = record(source.ammunition);
		fields(ammo, ["modelId", "firstBonus", "wearMultiplier", "ammoMultiplier"]);
		expedition.ammunition = { modelId: known(ammo.modelId, AMMO_BY_ID), firstBonus: number(ammo.firstBonus, .1, -.1), wearMultiplier: number(ammo.wearMultiplier, 1.4, .8), ammoMultiplier: number(ammo.ammoMultiplier, 2.2, .7) };
	}
	if (!expedition.ammunition && expedition.loadout.ammoType !== "standard" && expedition.loadout.ammoType !== "piercing") throw new Error("missing-ammunition");
	if (version >= 12 && Object.hasOwn(source, "reconCompleted")) expedition.reconCompleted = bool(source.reconCompleted);
	if (version >= ARSENAL_SAVE_VERSION && Object.hasOwn(source, "lootCatalogVersion")) expedition.lootCatalogVersion = number(source.lootCatalogVersion, version, ARSENAL_SAVE_VERSION, true);
	unique(expedition.perks); unique(expedition.offers); unique(expedition.discoveries);
	if (expedition.perks.length !== expedition.stage - 1 || expedition.offers.some((perk) => expedition.perks.includes(perk))
		|| (expedition.status === "choice" && expedition.stage < 3 ? expedition.offers.length !== 2 : expedition.offers.length !== 0)
		|| getCargoWeight(expedition.cargo) > expedition.capacity + 0.1 || expedition.trail.length === 0) throw new Error("checkpoint-state");
	return expedition;
}
function sameSupplies(a: Supplies, b: Supplies): boolean { return (Object.keys(a) as (keyof Supplies)[]).every((key) => a[key] === b[key]); }
function parseFieldKit(value: unknown): FieldKit { return known(value, FIELD_KITS) as FieldKit; }
function parseProductionReserve(value: unknown): ShelterCost {
	const reserve = record(value), supplies = record(reserve.supplies);
	fields(reserve, ["money", "supplies"]); fields(supplies, ["ammo", "medicine", "scrap", "intel"]);
	return { money: number(reserve.money, 1e9, 0, true), supplies: { ammo: number(supplies.ammo, 1e6, 0, true), medicine: number(supplies.medicine, 1e6, 0, true), scrap: number(supplies.scrap, 1e6, 0, true), intel: number(supplies.intel, 1e6, 0, true) } };
}
function parseProductionJob(value: unknown, roomType: ShelterRoomType, version: number): ProductionJob {
	const source = record(value);
	fields(source, ["id", "kind", "recipeId", "modelId", "workDone", "workRequired", "paid", "output", "createdAt"]);
	if (source.kind !== "module" && source.kind !== "resource") throw new Error("production-kind");
	const paid = record(source.paid), output = record(source.output);
	fields(paid, ["money", "supplies"]); fields(output, ["supplies", "moduleModelId", ...(version >= 14 ? ["fieldKit"] : [])]);
	const job: ProductionJob = { id: string(source.id), kind: source.kind, recipeId: string(source.recipeId),
		modelId: source.modelId === null ? null : versionedModuleId(source.modelId, version), workDone: number(source.workDone, 1e12, 0, true),
		workRequired: number(source.workRequired, 1e12, 1, true), paid: { money: number(paid.money), supplies: parseSupplies(paid.supplies) },
		output: { supplies: parseSupplies(output.supplies), moduleModelId: output.moduleModelId === null ? null : versionedModuleId(output.moduleModelId, version), ...(version >= 14 && Object.hasOwn(output, "fieldKit") ? { fieldKit: parseFieldKit(output.fieldKit) } : {}) }, createdAt: number(source.createdAt) };
	if (job.workDone > job.workRequired) throw new Error("production-work");
	if (job.kind === "module") {
		const model = job.modelId ? ownValue(MODULE_BY_ID, job.modelId) : null;
		if (!model || roomType !== "workshop" || job.recipeId !== `module:${model.id}` || job.output.moduleModelId !== model.id || job.output.fieldKit
			|| !sameSupplies(job.output.supplies, emptySupplies()) || job.paid.money !== model.craftCost.money
			|| !sameSupplies(job.paid.supplies, { ...emptySupplies(), scrap: model.craftCost.scrap })
			|| job.workRequired !== Math.max(25, Math.round(35 + model.value * 0.25)) * 1_000_000) throw new Error("module-order");
	} else {
		const recipe = ownValue(RESOURCE_RECIPE_BY_ID, job.recipeId);
		if (!recipe || recipe.roomType !== roomType || job.modelId !== null || job.output.moduleModelId !== null || job.output.fieldKit !== recipe.outputKit
			|| (version < 14 && (recipe.minLevel || recipe.outputKit))
			|| job.workRequired !== recipe.durationSeconds * 1_000_000 || job.paid.money !== recipe.cost.money
			|| !sameSupplies(job.paid.supplies, recipe.cost.supplies) || !sameSupplies(job.output.supplies, recipe.output)) throw new Error("resource-order");
	}
	return job;
}
function parseShelter(value: unknown, version: number): GameState["shelter"] {
	const source = record(value); fields(source, ["rooms", "sites", "expansions", ...(version >= 14 ? ["logistics"] : [])]);
	const parseSite = (value: unknown): ShelterSite => {
		const site = record(value); fields(site, ["column", "row"]);
		return { column: number(site.column, SHELTER_COORDINATE_LIMIT, -SHELTER_COORDINATE_LIMIT, true), row: number(site.row, SHELTER_COORDINATE_LIMIT, 0, true) };
	};
	const foundation = getShelterSites({});
	const sites = source.sites === undefined ? foundation.map((site) => ({ ...site })) : array(source.sites, MAX_SHELTER_SITES, parseSite);
	const expansions = source.expansions === undefined ? [] : array(source.expansions, MAX_SHELTER_SITES, (value): ShelterExpansion => {
		const site = record(value); fields(site, ["column", "row", "workDone", "workRequired", "cost"]);
		const coordinates = parseSite({ column: site.column, row: site.row }), cost = record(site.cost); fields(cost, ["money", "scrap"]);
		const expansion = { ...coordinates, workDone: number(site.workDone, SHELTER_EXCAVATION.duration * 1_000_000, 0, true),
			workRequired: number(site.workRequired, 1e12, 1, true), cost: { money: number(cost.money), scrap: number(cost.scrap) } };
		if (expansion.workRequired !== SHELTER_EXCAVATION.duration * 1_000_000 || expansion.cost.money !== SHELTER_EXCAVATION.money || expansion.cost.scrap !== SHELTER_EXCAVATION.scrap) throw new Error("excavation-payment");
		return expansion;
	});
	if (sites.length + expansions.length > MAX_SHELTER_SITES) throw new Error("shelter-size");
	const siteKeys = new Set(sites.map((site) => `${site.column}:${site.row}`));
	unique([...sites, ...expansions].map((site) => `${site.column}:${site.row}`));
	if (foundation.some((site) => !siteKeys.has(`${site.column}:${site.row}`))) throw new Error("foundation-site");
	const reached = new Set<string>(), queue: ShelterSite[] = [foundation[0]!];
	while (queue.length) {
		const site = queue.shift()!, key = `${site.column}:${site.row}`;
		if (reached.has(key) || !siteKeys.has(key)) continue;
		reached.add(key);
		queue.push({ column: site.column - 1, row: site.row }, { column: site.column + 1, row: site.row }, { column: site.column, row: site.row - 1 }, { column: site.column, row: site.row + 1 });
	}
	if (reached.size !== sites.length) throw new Error("disconnected-site");
	const frontier = new Set(getShelterFrontier({ sites }).map((site) => `${site.column}:${site.row}`));
	if (expansions.some((site) => !frontier.has(`${site.column}:${site.row}`))) throw new Error("disconnected-expansion");
	const rooms = array(source.rooms, MAX_SHELTER_SITES, (value): RoomInstance => {
		const roomSource = record(value);
		fields(roomSource, ["id", "type", "column", "row", "level", "status", "construction", "workerIds", "queue", "recipeId", "repeat", "pending", "cycles", ...(version >= 14 ? ["stockTarget"] : [])]);
		const type = known(roomSource.type, ROOM_DEFINITIONS) as ShelterRoomType;
		if (!["ready", "building", "upgrading"].includes(roomSource.status as string)) throw new Error("room-status");
		const room: RoomInstance = { id: string(roomSource.id), type, column: number(roomSource.column, SHELTER_COORDINATE_LIMIT, -SHELTER_COORDINATE_LIMIT, true), row: number(roomSource.row, SHELTER_COORDINATE_LIMIT, 0, true),
			level: number(roomSource.level, 5, 0, true), status: roomSource.status as RoomInstance["status"], construction: null,
			workerIds: array(roomSource.workerIds, 3, (value) => string(value)), queue: array(roomSource.queue, 5, (value) => parseProductionJob(value, type, version)),
			recipeId: roomSource.recipeId === null ? null : known(roomSource.recipeId, RESOURCE_RECIPE_BY_ID), repeat: bool(roomSource.repeat), pending: bool(roomSource.pending), cycles: number(roomSource.cycles, 1e9, 0, true),
			...(version >= 14 && Object.hasOwn(roomSource, "stockTarget") ? { stockTarget: number(roomSource.stockTarget, 1e6, 0, true) } : {}) };
		if (room.id !== `room-${room.column}-${room.row}` && room.id !== `room-${room.type}`) throw new Error("room-id");
		if (!siteKeys.has(`${room.column}:${room.row}`)) throw new Error("room-on-rock");
		if (room.workerIds.length > getRoomWorkerCapacity(room) || room.queue.some((job, index) => index > 0 && job.workDone !== 0)
			|| (room.type !== "workshop" && room.queue.length > 1)
			|| (room.recipeId !== null && ownValue(RESOURCE_RECIPE_BY_ID, room.recipeId)!.roomType !== room.type)
			|| (room.recipeId === null && (room.repeat || room.pending))) throw new Error("room-production");
		if (room.queue.some((job) => job.kind === "module" && ownValue(MODULE_BY_ID, job.modelId!)!.workshopLevel > room.level)) throw new Error("room-recipe-level");
		const recipe = room.recipeId ? ownValue(RESOURCE_RECIPE_BY_ID, room.recipeId)! : null;
		if ((recipe && (room.level < (recipe.minLevel ?? 1) || (version < 14 && (recipe.minLevel || recipe.outputKit))))
			|| room.queue.some(job => job.kind === "resource" && room.level < (ownValue(RESOURCE_RECIPE_BY_ID, job.recipeId)!.minLevel ?? 1))
			|| (room.stockTarget !== undefined && (!recipe || (recipe.outputKit && room.stockTarget > FIELD_KIT_CAPACITY)))) throw new Error("room-recipe-level");
		if (roomSource.construction !== null) {
			const building = record(roomSource.construction), cost = record(building.cost);
			fields(building, ["workDone", "workRequired", "targetLevel", "cost"]); fields(cost, ["money", "scrap"]);
			room.construction = { workDone: number(building.workDone, 1e12, 0, true), workRequired: number(building.workRequired, 1e12, 1, true),
				targetLevel: number(building.targetLevel, 5, 1, true), cost: { money: number(cost.money), scrap: number(cost.scrap) } };
			const expected = room.status === "building" ? ROOM_DEFINITIONS[type].cost : { money: Math.round(180 * room.level ** 1.7), scrap: 5 + room.level * 3 };
			const seconds = room.status === "building" ? ROOM_DEFINITIONS[type].buildSeconds : 45 + room.level * 25;
			if (room.status === "ready" || room.construction.targetLevel !== room.level + 1 || room.construction.workDone > room.construction.workRequired
				|| room.construction.workRequired !== seconds * 1_000_000 || room.construction.cost.money !== expected.money || room.construction.cost.scrap !== expected.scrap) throw new Error("construction");
		} else if (room.status !== "ready") throw new Error("construction-missing");
		if (room.status === "building" ? room.level !== 0 || room.workerIds.length > 0 || room.queue.length > 0 || room.recipeId !== null : room.level < 1) throw new Error("room-level");
		return room;
	});
	if (roomKeys.some((key) => !rooms.some((room) => room.id === `room-${key}` && room.type === key && room.level >= 1))) throw new Error("foundation-room");
	let logistics: ShelterState["logistics"];
	if (version >= 14 && Object.hasOwn(source, "logistics")) {
		const policy = record(source.logistics), kits = record(policy.kits); fields(policy, ["reserve", "kits"]); fields(kits, ["maintenance", "trauma"]);
		logistics = { reserve: parseProductionReserve(policy.reserve), kits: { maintenance: number(kits.maintenance, FIELD_KIT_CAPACITY, 0, true), trauma: number(kits.trauma, FIELD_KIT_CAPACITY, 0, true) } };
	}
	return { rooms, sites, expansions, ...(logistics ? { logistics } : {}) };
}
function parseScavProfile(value: unknown): ScavProfile {
	const source = record(value); fields(source, ["backgroundId", "traitId", "drawbackId", "talents", "candidateId"]);
	const profile: ScavProfile = {
		backgroundId: source.backgroundId === null ? null : known(source.backgroundId, RECRUIT_BACKGROUNDS),
		traitId: source.traitId === null ? null : known(source.traitId, RECRUIT_TRAITS),
		drawbackId: source.drawbackId === null ? null : known(source.drawbackId, RECRUIT_DRAWBACKS),
		talents: array(source.talents, 3, (talent) => known(talent, SCAV_TALENTS)),
		candidateId: source.candidateId === null ? null : string(source.candidateId),
	};
	unique(profile.talents);
	if (profile.backgroundId === null) {
		if (profile.traitId !== null || profile.drawbackId !== null || profile.candidateId !== null) throw new Error("neutral-profile");
	} else {
		const role = RECRUIT_BACKGROUNDS[profile.backgroundId]!.role;
		if (profile.traitId === null || profile.drawbackId === null || profile.candidateId === null
			|| !isRecruitTraitForRole(profile.traitId, role) || !isRecruitDrawbackForRole(profile.drawbackId, role)) throw new Error("recruit-profile");
	}
	return profile;
}
function parseStoryEvent(value: unknown): ScavEventId {
	if (!SCAV_STORY_EVENTS.includes(value as ScavEventId)) throw new Error("story-event");
	return value as ScavEventId;
}
function parseScavStory(value: unknown): ScavStory {
	const source = record(value); fields(source, ["identityKey", "joinedAt", "bond", "stress", "counters", "memories", "pending", "completedEvents"]);
	const counters = record(source.counters); fields(counters, ["wins", "injuries", "deepReturns", "modules", "batches"]);
	const parseSource = (item: ObjectValue) => ({ sourceId: item.sourceId === null ? null : string(item.sourceId), mapId: item.mapId === null ? null : known(item.mapId, MAP_BY_ID) });
	const story: ScavStory = { identityKey: string(source.identityKey), joinedAt: number(source.joinedAt), bond: number(source.bond, 100, 0, true), stress: number(source.stress, 100, 0, true),
		counters: { wins: number(counters.wins, 1e9, 0, true), injuries: number(counters.injuries, 1e9, 0, true), deepReturns: number(counters.deepReturns, 1e9, 0, true), modules: number(counters.modules, 1e9, 0, true), batches: number(counters.batches, 1e9, 0, true) },
		memories: array(source.memories, MAX_SCAV_MEMORIES, (item): ScavMemory => {
			const memory = record(item); fields(memory, ["kind", "at", "sourceId", "mapId", "eventId", "choiceId"]);
			if (!["joined", "return", "injury", "deep_return", "module", "event", "lost"].includes(memory.kind as string)) throw new Error("story-memory-kind");
			return { kind: memory.kind as ScavMemory["kind"], at: number(memory.at), ...parseSource(memory), eventId: memory.eventId === null ? null : parseStoryEvent(memory.eventId), choiceId: memory.choiceId === null ? null : string(memory.choiceId) };
		}), pending: source.pending === null ? null : (() => {
			const pending = record(source.pending); fields(pending, ["eventId", "at", "sourceId", "mapId"]);
			return { eventId: parseStoryEvent(pending.eventId), at: number(pending.at), ...parseSource(pending) };
		})(), completedEvents: array(source.completedEvents, SCAV_STORY_EVENTS.length, parseStoryEvent) };
	unique(story.completedEvents);
	return story;
}
function parseScavMemorial(value: unknown): ScavMemorial {
	const source = record(value); fields(source, ["id", "name", "personality", "appearance", "profile", "story", "at", "mapId", "raidId", "level", "xp", "raids"]);
	return { id: string(source.id), name: string(source.name, 30), personality: known(source.personality, PERSONALITY_BY_ID), appearance: parseAppearance(source.appearance), profile: parseScavProfile(source.profile), story: parseScavStory(source.story),
		at: number(source.at), mapId: known(source.mapId, MAP_BY_ID), raidId: string(source.raidId), level: number(source.level, 15, 1, true), xp: number(source.xp), raids: number(source.raids, 1e9, 1, true) };
}
function parseRecruitCandidate(value: unknown, version: number): RecruitCandidate {
	const source = record(value); fields(source, ["id", "name", "role", "backgroundId", "traitId", "drawbackId", "combat", "scouting", "cost", "appearance"]);
	return { id: string(source.id), name: string(source.name, 30), role: known(source.role, RECRUIT_ROLES) as RecruitRole,
		backgroundId: known(source.backgroundId, RECRUIT_BACKGROUNDS), traitId: known(source.traitId, RECRUIT_TRAITS), drawbackId: known(source.drawbackId, RECRUIT_DRAWBACKS),
		combat: number(source.combat, 100, 1, true), scouting: number(source.scouting, 100, 1, true), cost: number(source.cost, 10000, 1, true), appearance: version >= 7 || Object.hasOwn(source, "appearance") ? parseAppearance(source.appearance) : -1 };
}
function parseRecruitment(value: unknown, version: number): RecruitmentState {
	const source = record(value); fields(source, ["rng", "generation", "tier", "boardSeed", "boardTier", "board", "hiredCandidateIds"]);
	const recruitment: RecruitmentState = { rng: number(source.rng, 4294967295, 1, true), boardSeed: number(source.boardSeed, 4294967295, 1, true),
		generation: number(source.generation, 1e9, 1, true), tier: number(source.tier, 2, 0, true) as RecruitTier, boardTier: number(source.boardTier, 2, 0, true) as RecruitTier,
		board: array(source.board, 3, (candidate) => parseRecruitCandidate(candidate, version)), hiredCandidateIds: array(source.hiredCandidateIds, 3, (candidateId) => string(candidateId)) };
	if (recruitment.boardTier > recruitment.tier || recruitment.rng !== stepRecruitmentSeed(recruitment.boardSeed)) throw new Error("recruit-generation");
	const generated = buildRecruitmentBoard(recruitment.boardSeed, recruitment.generation, recruitment.boardTier);
	const consumed = [...recruitment.board.map((candidate) => candidate.id), ...recruitment.hiredCandidateIds];
	unique(consumed);
	if (consumed.length !== generated.length || consumed.some((candidateId) => !generated.some((candidate) => candidate.id === candidateId))) throw new Error("recruit-ledger");
	for (const candidate of recruitment.board) {
		const expected = generated.find((offer) => offer.id === candidate.id)!;
		if (Object.keys(expected).some((key) => key !== "appearance" && candidate[key as keyof RecruitCandidate] !== expected[key as keyof RecruitCandidate])) throw new Error("recruit-offer");
	}
	unique(recruitment.board.filter((candidate) => candidate.appearance >= 0).map((candidate) => String(candidate.appearance)));
	return recruitment;
}
function validateScavRecruitment(state: GameState, scav: Pick<Scav, "profile" | "level">) {
	const profile = scav.profile;
	for (let index = 0; index < profile.talents.length; index++) {
		const previous = { ...scav, profile: { ...profile, talents: profile.talents.slice(0, index) } };
		if (!getScavTalentOffers(previous)?.offers.some((offer) => offer.id === profile.talents[index])) throw new Error("scav-talent-offer");
	}
	if (profile.candidateId === null) return;
	const match = /^recruit-([1-9]\d*)-([012])-([1-9]\d*)$/.exec(profile.candidateId);
	if (!match) throw new Error("scav-recruit-id");
	const generation = Number(match[1]), slot = Number(match[2]), seed = Number(match[3]);
	if (generation > state.recruitment.generation || seed > 4294967295 || generation > 1e9) throw new Error("scav-recruit-generation");
	if (generation === state.recruitment.generation && (seed !== state.recruitment.boardSeed || !state.recruitment.hiredCandidateIds.includes(profile.candidateId))) throw new Error("scav-recruit-owner");
	const provenance = [0, 1, 2].filter((tier) => tier <= state.recruitment.tier)
		.some((tier) => { const offer = buildRecruitmentBoard(seed, generation, tier as RecruitTier)[slot]!;
			return offer.backgroundId === profile.backgroundId && offer.traitId === profile.traitId && offer.drawbackId === profile.drawbackId; });
	if (!provenance) throw new Error("scav-recruit-provenance");
}
function validateStoryRecruitment(state: GameState, scav: Pick<Scav, "name" | "personality" | "story" | "profile">) {
	const match = /^recruit-([1-9]\d*)-([012])-([1-9]\d*)$/.exec(scav.story.identityKey);
	if (!match) return;
	const generation = Number(match[1]), slot = Number(match[2]), seed = Number(match[3]);
	if (generation > state.recruitment.generation || (generation === state.recruitment.generation && (seed !== state.recruitment.boardSeed || !state.recruitment.hiredCandidateIds.includes(scav.story.identityKey)))) throw new Error("story-recruit-owner");
	const candidate = buildRecruitmentBoard(seed, generation, 0)[slot]!;
	const personality = { assault: "veteran", scout: "runner", technician: "collector" }[candidate.role];
	if (scav.profile.candidateId === null && scav.personality !== personality) throw new Error("story-free-recruit-role");
}
function validateStorySources(state: GameState, scav: Pick<Scav, "name" | "story">, lostRaidId: string | null) {
	for (const memory of scav.story.memories) {
		if (memory.kind === "lost" && memory.sourceId !== lostRaidId) throw new Error("story-alive-loss");
		if (memory.kind === "event" || memory.kind === "joined") continue;
		if (state.raids.some((raid) => raid.id === memory.sourceId) || state.shelter.rooms.some((room) => room.queue.some((job) => job.id === memory.sourceId))) throw new Error("story-unfinished-source");
		const report = state.history.find((item) => item.raidId === memory.sourceId);
		if (!report) continue;
		if (report.scavName !== scav.name || report.mapId !== memory.mapId || report.at !== memory.at || (memory.kind === "lost" ? !report.lostScav : report.lostScav)
			|| (memory.kind === "return" && !report.success) || (memory.kind === "deep_return" && (!report.success || report.depth < 2))) throw new Error("story-report-source");
	}
}
function parseScav(value: unknown, version: number): Scav {
	const source = record(value);
	fields(source, ["id", "name", "personality", "appearance", "level", "xp", "health", "combat", "scouting", "weaponInstanceId", "status", "raids", ...(version >= 2 ? ["tactic", "gear", "autoRaid"] : []), ...(version >= 3 ? ["loadout"] : []), ...(version >= 5 ? ["assignment"] : []), ...(version >= 6 ? ["profile"] : []), ...(version >= 7 ? ["story"] : []), ...(version >= 12 ? ["raidPlan"] : []), ...(version >= 14 ? ["fieldKit"] : [])]);
	if (!["ready", "raiding", "wounded"].includes(source.status as string))
		throw new Error("status");
	let gear: Scav["gear"] = { armor: 0, backpack: 0 };
	let autoRaid: Scav["autoRaid"] = { mapId: "courtyard", enabled: false, minHealth: 70, runs: 0, waitingReason: null, maxDepth: 1 };
	if (version >= 2) {
		const gearSource = record(source.gear);
		const autoSource = record(source.autoRaid);
		fields(gearSource, ["armor", "backpack"]);
		fields(autoSource, ["mapId", "enabled", "minHealth", "runs", "waitingReason", ...(version >= 3 ? ["maxDepth"] : [])]);
		gear = { armor: number(gearSource.armor, 3, 0, true), backpack: number(gearSource.backpack, 3, 0, true) };
		autoRaid = {
			mapId: known(autoSource.mapId, MAP_BY_ID), enabled: bool(autoSource.enabled),
			minHealth: number(autoSource.minHealth, 100, 25, true), runs: number(autoSource.runs, 1e9, 0, true),
			waitingReason: autoSource.waitingReason === null ? null : string(autoSource.waitingReason, 200),
			maxDepth: version >= 3 ? number(autoSource.maxDepth, 3, 1, true) : 1,
		};
	}
	return {
		id: string(source.id),
		name: string(source.name, 30),
		personality: known(source.personality, PERSONALITY_BY_ID),
		appearance: Object.hasOwn(source, "appearance") ? parseAppearance(source.appearance) : defaultScavAppearance(source.personality as string),
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
		loadout: version >= 3 ? parseLoadout(source.loadout, version) : { armorItemId: null, helmetItemId: null, backpackItemId: null, ammoType: "standard", medkit: false },
		assignment: version >= 5 && source.assignment !== null ? string(source.assignment) : null,
		profile: version >= 6 ? parseScavProfile(source.profile) : neutralScavProfile(),
		story: version >= 7 ? parseScavStory(source.story) : createScavStory(string(source.id), 0, false),
		autoRaid,
		...(version >= 12 && Object.hasOwn(source, "raidPlan") ? { raidPlan: parseRaidPlan(source.raidPlan) } : {}),
		...(version >= 14 && Object.hasOwn(source, "fieldKit") ? { fieldKit: source.fieldKit === "none" ? "none" as const : parseFieldKit(source.fieldKit) } : {}),
	};
}
function parseRaid(value: unknown, version: number): Raid {
	const source = record(value);
	fields(source, ["id", "scavId", "scavName", "scavAppearance", "mapId", "weaponInstanceId", "startedAt", "endsAt", "chance", "lootBonus", "seed", "outcomeSeed", ...(version >= 2 ? ["isAuto", "tactic", "armorLevel", "backpackLevel"] : []), ...(version >= 3 ? ["expedition"] : []), ...(version >= 10 ? ["squad"] : []), ...(version >= 12 ? ["strategy"] : []), ...(version >= 14 ? ["fieldKit"] : []), ...(version >= 16 ? ["lootVersion"] : [])]);
	const startedAt = number(source.startedAt);
	const endsAt = number(source.endsAt);
	const expedition = version >= 3 ? parseExpedition(source.expedition, version) : null;
	if (version >= 14 && Object.hasOwn(source, "fieldKit") && (!expedition || expedition.legacyLoot || !Object.hasOwn(source, "strategy"))) throw new Error("field-kit-sortie");
	if (version >= 16 && Object.hasOwn(source, "lootVersion") && (source.lootVersion !== 1 || !expedition || expedition.legacyLoot || !Object.hasOwn(source, "strategy"))) throw new Error("loot-version");
	if (expedition?.cargo.lootItems && !Object.hasOwn(source, "lootVersion")) throw new Error("loot-sortie-source");
	if ((expedition?.status === "choice" ? endsAt < startedAt : endsAt <= startedAt) || endsAt - startedAt > 600_000)
		throw new Error("duration");
	return {
		id: string(source.id),
		scavId: string(source.scavId),
		scavName: string(source.scavName, 30),
		...(Object.hasOwn(source, "scavAppearance") ? { scavAppearance: parseAppearance(source.scavAppearance) } : {}),
		mapId: known(source.mapId, MAP_BY_ID),
		weaponInstanceId: string(source.weaponInstanceId),
		startedAt,
		endsAt,
		chance: number(source.chance, 1),
		lootBonus: number(source.lootBonus, 2, -0.15),
		seed: number(source.seed, 4294967295, 1, true),
		...(Object.hasOwn(source, "outcomeSeed") ? { outcomeSeed: number(source.outcomeSeed, 4294967295, 1, true) } : {}),
		isAuto: version === 1 ? false : bool(source.isAuto),
		tactic: version === 1 ? "balanced" : known(source.tactic, TACTICS) as RaidTactic,
		armorLevel: version === 1 ? 0 : number(source.armorLevel, 3, 0, true),
		backpackLevel: version === 1 ? 0 : number(source.backpackLevel, 3, 0, true),
		expedition,
		...(version >= 10 && Object.hasOwn(source, "squad") ? { squad: parseSquadRaidSnapshot(source.squad, false, version) as SquadRaidSnapshot } : {}),
		...(version >= 12 && Object.hasOwn(source, "strategy") ? { strategy: parseRaidStrategy(source.strategy) } : {}),
		...(version >= 14 && Object.hasOwn(source, "fieldKit") ? { fieldKit: parseFieldKit(source.fieldKit) } : {}),
		...(version >= 16 && Object.hasOwn(source, "lootVersion") ? { lootVersion: 1 as const } : {}),
	};
}
function parseReport(value: unknown, version: number): RaidReport {
	const source = record(value);
	fields(source, ["id", "raidId", "scavName", "scavAppearance", "mapId", "at", "success", "lostScav", "lostWeapon", "money", "supplies", "weaponId", "weaponAutoSold", "description", ...(version >= 2 ? ["isAuto", "tactic", "events"] : []), ...(version >= 3 ? ["depth", "discoveries", "lostCargo"] : []), ...(version >= 4 ? ["moduleIds"] : []), ...(version >= 10 ? ["squad"] : []), ...(version >= 12 ? ["strategy", "sectorOutcome", "reconCompleted"] : []), ...(version >= 14 ? ["fieldKit"] : []), ...(version >= 16 ? ["lootItems", "lootAutoSold"] : []), ...(version >= 18 ? ["lootPending"] : [])]);
	if (version >= 14 && Object.hasOwn(source, "fieldKit") && !Object.hasOwn(source, "strategy")) throw new Error("field-kit-report");
	return {
		id: string(source.id),
		raidId: string(source.raidId),
		scavName: string(source.scavName, 30),
		...(Object.hasOwn(source, "scavAppearance") ? { scavAppearance: parseAppearance(source.scavAppearance) } : {}),
		mapId: known(source.mapId, MAP_BY_ID),
		at: number(source.at),
		success: bool(source.success),
		lostScav: bool(source.lostScav),
		lostWeapon: bool(source.lostWeapon),
		money: number(source.money),
		supplies: parseSupplies(source.supplies),
		weaponId:
			source.weaponId === null ? null : versionedWeaponId(source.weaponId, version),
		weaponAutoSold: bool(source.weaponAutoSold),
		description: string(source.description, 300),
		depth: version >= 3 ? number(source.depth, 3, 1, true) : 1,
		discoveries: version >= 3 ? array(source.discoveries, Object.keys(BLUEPRINTS).length, (value) => known(value, BLUEPRINTS)) : [],
		lostCargo: version >= 3 && source.lostCargo !== null ? parseCargo(source.lostCargo, version) : null,
		moduleIds: version >= 4 ? array(source.moduleIds, 12, (value) => versionedModuleId(value, version)) : [],
		isAuto: version === 1 ? false : bool(source.isAuto),
		tactic: version === 1 ? "balanced" : known(source.tactic, TACTICS) as RaidTactic,
		events: version === 1 ? [] : parseEvents(source.events, version >= 3 ? 10 : 4),
		...(version >= 10 && Object.hasOwn(source, "squad") ? { squad: parseSquadRaidSnapshot(source.squad, true, version) as SquadRaidReport } : {}),
		...(version >= 12 && Object.hasOwn(source, "strategy") ? { strategy: parseRaidStrategy(source.strategy) } : {}),
		...(version >= 12 && Object.hasOwn(source, "sectorOutcome") ? { sectorOutcome: parseSectorIntel(source.sectorOutcome) } : {}),
		...(version >= 12 && Object.hasOwn(source, "reconCompleted") ? { reconCompleted: bool(source.reconCompleted) } : {}),
		...(version >= 14 && Object.hasOwn(source, "fieldKit") ? { fieldKit: parseFieldKit(source.fieldKit) } : {}),
		...(version >= 16 && Object.hasOwn(source, "lootItems") ? { lootItems: array(source.lootItems, 6, parseLootItem) } : {}),
		...(version >= 18 && Object.hasOwn(source, "lootPending") ? { lootPending: array(source.lootPending, 6, parseLootItem) } : {}),
		...(version >= 16 && Object.hasOwn(source, "lootAutoSold") ? { lootAutoSold: array(source.lootAutoSold, 6, value => {
			const sale = record(value); fields(sale, ["item", "money"]); const item = parseLootItem(sale.item), money = number(sale.money, 10000, 1, true);
			if (money !== getLootTraderPrice(item)) throw new Error("loot-sale-price"); return { item, money };
		}) } : {}),
	};
}

/** Returns null for invalid/unsupported saves; no user-controlled object reaches gameplay. */
export function parseSave(raw: string, options: { publicSnapshot?: boolean } = {}): GameState | null {
	try {
		if (typeof raw !== "string" || raw.length > 1_000_000) return null;
		const source = record(JSON.parse(raw));
		if (typeof source.schemaVersion !== "number" || !Number.isInteger(source.schemaVersion) || source.schemaVersion < 1 || source.schemaVersion > SAVE_VERSION) return null;
		const version = source.schemaVersion;
		fields(source, ["schemaVersion", "createdAt", "lastUpdated", "money", "supplies", "xp", "level", "base", "scavs", "weapons", "raids", "history", "claimedContracts", "discoveredWeapons", "stats", "clock", "rng", "nextId", ...(version >= 3 ? ["gearItems", "blueprints"] : []), ...(version >= 4 ? ["modules"] : []), ...(version >= 5 ? ["shelter"] : []), ...(version >= 6 ? ["recruitment"] : []), ...(version >= 7 ? ["memorials"] : []), ...(version >= 8 ? ["social"] : []), ...(version >= 9 ? ["achievements"] : []), ...(version >= 12 ? ["sectorIntel"] : []), ...(version >= 16 ? ["lootItems"] : []), ...(version >= 18 ? ["pendingLoot"] : [])]);
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
			scavs: array(source.scavs, version >= 5 ? 15 : 7, (value) => parseScav(value, version)),
			weapons: array(source.weapons, version >= 5 ? 350 : 65, (value) => parseWeapon(value, version)),
			raids: array(source.raids, version >= 5 ? 15 : 7, (value) => parseRaid(value, version)),
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
				(value) => versionedWeaponId(value, version)
			),
			gearItems: version >= 3 ? array(source.gearItems, 28, parseGear) : [],
			blueprints: version >= 3 ? array(source.blueprints, Object.keys(BLUEPRINTS).length, (value) => known(value, BLUEPRINTS)) : ["light_vest", "scout_pack"],
			modules: version >= 4 ? array(source.modules, 1000, (value) => parseModule(value, version)) : [],
			shelter: version >= 5 ? parseShelter(source.shelter, version) : initialShelter(base as Record<string, number>),
			recruitment: version >= 6 ? parseRecruitment(source.recruitment, version) : { rng: 1, generation: 1, tier: 0, boardTier: 0, boardSeed: 1, board: [], hiredCandidateIds: [] },
			memorials: version >= 7 ? array(source.memorials, MAX_SCAV_MEMORIALS, parseScavMemorial) : [],
			social: version >= 8 ? parseSquadSocialState(source.social) : { pairs: [], losses: [] },
			achievements: version >= 9 ? parseAchievementState(source.achievements, (value) => parseWeapon(value, version)) : createAchievementState(),
			...(version >= 12 && Object.hasOwn(source, "sectorIntel") ? { sectorIntel: parseSectorIntelRecord(source.sectorIntel) } : {}),
			...(version >= 16 && Object.hasOwn(source, "lootItems") ? { lootItems: array(source.lootItems, 512, parseLootItem) } : {}),
			...(version >= 18 && Object.hasOwn(source, "pendingLoot") ? { pendingLoot: array(source.pendingLoot, MAX_PENDING_LOOT_DELIVERIES, value => {
				const delivery = record(value); fields(delivery, ["id", "raidId", "at", "items"]);
				return { id: string(delivery.id), raidId: string(delivery.raidId), at: number(delivery.at), items: array(delivery.items, 6, parseLootItem) };
			}) } : {}),
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
		if (version < 6) state.recruitment = createRecruitmentState(state);
		if (version < 7) for (const scav of state.scavs) scav.story = createScavStory(scav.profile.candidateId ?? scav.id, state.createdAt, false);
		if (version < 8) state.social = createSquadSocialState(state);
		if (version < 7) {
			const used = [...state.scavs.map((scav) => scav.appearance ?? defaultScavAppearance(scav.personality)), ...state.recruitment.board.filter((candidate) => candidate.appearance >= 0).map((candidate) => candidate.appearance)];
			for (const candidate of state.recruitment.board) if (candidate.appearance < 0) { candidate.appearance = chooseRecruitCandidateAppearance(candidate.role, candidate.id, used); used.push(candidate.appearance); }
		}
		if (state.recruitment.tier > getEarnedRecruitmentTier(state)) throw new Error("recruit-network-evidence");
		// Only retained evidence can seed per-sector counters from an old save.
		if (version < 4) for (const weapon of state.weapons) {
			fillFactoryKit(state, weapon);
			if (!state.discoveredWeapons.includes(weapon.weaponId)) state.discoveredWeapons.push(weapon.weaponId);
		}
		if (version === 1) for (const report of state.history) if (report.success)
			state.stats.mapWins[report.mapId] = (state.stats.mapWins[report.mapId] ?? 0) + 1;
		const allIds = [
			...state.scavs.map((item) => item.id),
			...state.weapons.map((item) => item.id),
			...state.raids.map((item) => item.id),
			...state.history.map((item) => item.id),
			...state.gearItems.map((item) => item.id),
			...state.modules.map((item) => item.id),
			...state.weapons.flatMap((weapon) => Object.values(weapon.modules).map((item) => item.id)),
			...state.raids.flatMap((raid) => raid.expedition?.cargo.modules.map((item) => item.id) ?? []),
			...(state.lootItems ?? []).map(item => item.id),
			...(state.pendingLoot ?? []).flatMap(delivery => [delivery.id, ...delivery.items.map(item => item.id)]),
			...state.raids.flatMap(raid => raid.expedition?.cargo.lootItems?.map(item => item.id) ?? []),
			...state.shelter.rooms.flatMap((room) => room.queue.map((job) => job.id)),
		];
		unique(allIds);
		if ((state.lootItems?.length ?? 0) > getLootCapacity(state)) throw new Error("loot-inventory");
		if ((state.pendingLoot?.length ?? 0) + state.raids.filter(raid => raid.lootVersion === 1).length > MAX_PENDING_LOOT_DELIVERIES) throw new Error("loot-delivery-reserve");
		unique((state.pendingLoot ?? []).map(delivery => delivery.raidId));
		for (const delivery of state.pendingLoot ?? []) {
			if (!/^delivery-[1-9]\d*$/.test(delivery.id) || !/^raid-[1-9]\d*$/.test(delivery.raidId)
				|| Number(delivery.raidId.slice(5)) >= state.nextId || delivery.at > state.lastUpdated || !delivery.items.length
				|| state.raids.some(raid => raid.id === delivery.raidId)) throw new Error("loot-delivery");
			const report = state.history.find(report => report.raidId === delivery.raidId);
			if (report && (!report.success || report.at !== delivery.at || JSON.stringify(report.lootPending ?? []) !== JSON.stringify(delivery.items))) throw new Error("loot-delivery-receipt");
		}
		for (const part of [...state.modules, ...state.weapons.flatMap((weapon) => Object.values(weapon.modules)), ...state.raids.flatMap((raid) => raid.expedition?.cargo.modules ?? [])]) if (!part.id.startsWith("module-")) throw new Error("module-id");
		unique(state.claimedContracts);
		unique(state.discoveredWeapons);
		unique(state.blueprints);
		unique(state.shelter.rooms.map((room) => room.id));
		unique(state.shelter.rooms.map((room) => `${room.column}:${room.row}`));
		unique(state.shelter.rooms.flatMap((room) => room.workerIds));
		unique(state.stats.mapsVisited);
		unique(state.history.map((report) => report.raidId));
		unique(
			state.scavs.flatMap((scav) =>
				scav.weaponInstanceId ? [scav.weaponInstanceId] : []
			)
		);
		unique(state.scavs.flatMap((scav) => [scav.loadout.armorItemId, scav.loadout.helmetItemId, scav.loadout.backpackItemId].filter((value): value is string => typeof value === "string")));
		unique(state.scavs.flatMap((scav) => scav.profile.candidateId ? [scav.profile.candidateId] : []));
		if (state.recruitment.board.some((candidate) => state.scavs.some((scav) => scav.profile.candidateId === candidate.id))) throw new Error("recruit-already-hired");
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
			validateScavRecruitment(state, scav);
			validateScavStory(scav.story, scav, state.lastUpdated, state.nextId);
			validateStoryRecruitment(state, scav);
			validateStorySources(state, scav, null);
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
			const workplaces = state.shelter.rooms.filter((room) => room.workerIds.includes(scav.id));
			if (scav.assignment === null ? workplaces.length !== 0 : workplaces.length !== 1 || workplaces[0]!.id !== scav.assignment || scav.status === "raiding") throw new Error("worker-owner");
			for (const [key, slot] of [["armorItemId", "armor"], ["helmetItemId", "helmet"], ["backpackItemId", "backpack"]] as const) {
				const gearId = scav.loadout[key];
				if (gearId != null && !state.gearItems.some((item) => item.id === gearId && getGearModel(item).slot === slot)) throw new Error("gear-owner");
			}
		}
		unique([...state.scavs.map((scav) => scav.id), ...state.memorials.map((memorial) => memorial.id)]);
		unique(state.memorials.map((memorial) => memorial.raidId));
		if (state.memorials.length > state.stats.lostScavs) throw new Error("memorial-count");
		for (const memorial of state.memorials) {
			if (!/^scav-[1-9]\d*$/.test(memorial.id) || Number(memorial.id.slice(5)) >= state.nextId || !/^raid-[1-9]\d*$/.test(memorial.raidId) || Number(memorial.raidId.slice(5)) >= state.nextId
				|| memorial.at > state.lastUpdated || memorial.story.joinedAt > memorial.at || memorial.raids > state.stats.raidsCompleted
				|| memorial.level !== Math.min(15, 1 + Math.floor(Math.sqrt(memorial.xp / 60)))) throw new Error("memorial-career");
			validateScavStory(memorial.story, memorial, state.lastUpdated, state.nextId);
			validateScavRecruitment(state, memorial);
			validateStoryRecruitment(state, memorial);
			validateStorySources(state, memorial, memorial.raidId);
			const loss = state.history.find((report) => report.raidId === memorial.raidId);
			if (memorial.story.pending !== null || (loss && (!loss.lostScav || loss.scavName !== memorial.name || loss.mapId !== memorial.mapId || loss.at !== memorial.at || (loss.scavAppearance !== undefined && loss.scavAppearance !== memorial.appearance)))) throw new Error("memorial-report");
			if (!memorial.story.memories.some((memory) => memory.kind === "lost" && memory.sourceId === memorial.raidId && memory.mapId === memorial.mapId && memory.at === memorial.at)) throw new Error("memorial-last-moment");
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
				const helmet = state.gearItems.find((item) => item.id === scav.loadout.helmetItemId);
				const pack = state.gearItems.find((item) => item.id === scav.loadout.backpackItemId);
				const loadout = raid.expedition.loadout;
				if ((raid.expedition.cargo.lootItems ?? []).some(item => getLootModel(item).minDepth > raid.expedition!.stage || getLootModel(item).minSectorLevel > MAP_BY_ID[raid.mapId]!.level)) throw new Error("loot-depth");
				if (raid.expedition.ammunition) {
					const model = ownValue(AMMO_BY_ID, raid.expedition.ammunition.modelId)!;
					const weapon = state.weapons.find((item) => item.id === raid.weaponInstanceId)!;
					if (model.type !== loadout.ammoType || model.caliber !== RECEIVER_INFO[weapon.weaponId]!.caliber) throw new Error("raid-ammunition");
				}
				if (loadout.armorModelId !== (armor?.modelId ?? "none") || loadout.packModelId !== (pack?.modelId ?? "none")
					|| (loadout.helmetModelId ?? null) !== (helmet?.modelId ?? null)
					|| loadout.ammoType !== scav.loadout.ammoType || loadout.medkit !== scav.loadout.medkit
					|| raid.expedition.discoveries.some((blueprint) => !state.blueprints.includes(blueprint))
					|| (raid.isAuto && raid.expedition.status === "choice")) throw new Error("raid-loadout");
				if (raid.expedition.trail.some((event, index) => event.at > state.lastUpdated || (index > 0 && event.at < raid.expedition!.trail[index - 1]!.at))) throw new Error("raid-trail-time");
				if (raid.strategy && raid.expedition.legacyLoot || raid.expedition.reconCompleted && (!raid.strategy || raid.expedition.stage < 2
					|| raid.expedition.stage === 2 && (raid.expedition.status !== "choice" || raid.expedition.branch !== "recon"))) throw new Error("strategy-recon-source");
			}
			if (raid.strategy && (!raid.expedition || raid.strategy.knowledge > (state.sectorIntel?.[raid.mapId]?.knowledge ?? 0))) throw new Error("strategy-sector-source");
			if (raid.squad) {
				for (const member of getRaidGroup(state, raid)) if (Boolean(member.strategy) !== Boolean(raid.strategy)
					|| member.strategy && raid.strategy && (member.strategy.knowledge !== raid.strategy.knowledge || member.strategy.pressure !== raid.strategy.pressure)) throw new Error("strategy-squad-source");
			}
		}
		for (const weapon of state.weapons) {
			if (!weapon.id.startsWith("gun-") || !weapon.modules.receiver || weapon.modules.receiver.durability !== weapon.durability) throw new Error("gun-id");
			if (attachmentKeys.some((key) => weapon.attachments[key] !== (weapon.modules.receiver!.legacyAttachments?.[key] ?? 0))) throw new Error("legacy-bonus");
			for (const [slot, part] of Object.entries(weapon.modules)) if (getModuleDefinition(part).slot !== slot || moduleFitReason(weapon, part)) throw new Error("module-fit");
		}
		for (const gear of state.gearItems) if (!gear.id.startsWith("gear-")) throw new Error("gear-id");
		for (const room of state.shelter.rooms) {
			if (room.workerIds.some((workerId) => !state.scavs.some((scav) => scav.id === workerId))) throw new Error("worker-ref");
			for (const job of room.queue) {
				if (!job.id.startsWith("job-")) throw new Error("job-id");
				const model = job.modelId ? ownValue(MODULE_BY_ID, job.modelId) : null;
				if (model?.slot === "receiver" && !state.discoveredWeapons.includes(model.weaponId!)) throw new Error("room-recipe-discovery");
			}
		}
		for (const report of state.history) {
			if (!report.id.startsWith("report-") || !/^raid-[1-9]\d*$/.test(report.raidId) || Number(report.raidId.slice(5)) >= state.nextId) throw new Error("report-id");
			if ((report.lostScav && !report.lostWeapon) || (report.success && (report.lostScav || report.lostWeapon))) throw new Error("report-outcome");
			const receipt = [...(report.lootItems ?? []), ...(report.lootPending ?? []), ...(report.lootAutoSold ?? []).map(sale => sale.item), ...(report.lostCargo?.lootItems ?? [])];
			unique(receipt.map(item => item.id));
			if (receipt.length > 6 || (Object.hasOwn(report, "lootItems") || Object.hasOwn(report, "lootAutoSold") || Object.hasOwn(report, "lootPending") || receipt.length > 0) && !report.strategy
				|| receipt.some(item => Number(item.id.split("-")[1]) >= state.nextId || getLootModel(item).minDepth > report.depth || getLootModel(item).minSectorLevel > MAP_BY_ID[report.mapId]!.level) || (!report.success && ((report.lootItems?.length ?? 0) > 0 || (report.lootPending?.length ?? 0) > 0 || (report.lootAutoSold?.length ?? 0) > 0))
				|| (report.lootAutoSold ?? []).reduce((sum, sale) => sum + sale.money, 0) > report.money) throw new Error("loot-receipt");
			if (version < 3 && report.events.length !== 0 && report.events.length !== 4) throw new Error("story");
			if (report.events.some((event, index) => event.at > report.at || (index > 0 && event.at < report.events[index - 1]!.at))) throw new Error("story-time");
			unique(report.discoveries);
			if (report.discoveries.some((blueprint) => !state.blueprints.includes(blueprint)) || (report.success && report.lostCargo !== null)) throw new Error("report-discovery");
			if (Boolean(report.strategy) !== Boolean(report.sectorOutcome) || report.reconCompleted && (!report.strategy || report.depth < 2)) throw new Error("strategy-report-source");
			if (report.strategy && report.sectorOutcome && (report.strategy.knowledge > report.sectorOutcome.knowledge
				|| report.sectorOutcome.knowledge > (state.sectorIntel?.[report.mapId]?.knowledge ?? 0))) throw new Error("strategy-report-sector");
			if (report.squad) for (const member of report.squad.members) {
				const peer = state.history.find(other => other.raidId === member.raidId);
				if (peer && (Boolean(peer.strategy) !== Boolean(report.strategy) || JSON.stringify(peer.sectorOutcome) !== JSON.stringify(report.sectorOutcome))) throw new Error("strategy-report-party");
			}
		}
		if (
			allIds.some(
				(value) =>
					!/^(gun|scav|raid|report|gear|module|job|loot|delivery)-[1-9]\d*$/.test(value) ||
					Number(value.split("-")[1]) >= state.nextId
			)
		)
			throw new Error("id-sequence");
		validateSquadSocialState(state);
		validateSquadRaids(state, options.publicSnapshot ?? false);
		validateAchievementState(state);
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
