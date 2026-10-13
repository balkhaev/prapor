import { describe, expect, test } from "bun:test";
import {
	advance, assembleWeapon, buySupplies, continueExpedition, craftGear, craftModule,
	createGame, disassembleWeapon, dispatchRaid, equipGear, equipWeapon, extractRaid,
	getCargoWeight, getExpeditionChoices, getModuleCraftReason, getModuleRecycleYield,
	getRaidQuote, getSupplyCapacity, getWeaponStats, installModule, parseSave, recycleModule, recycleWeapon,
	removeModule, saveGame, setRaidTactic, SAVE_VERSION,
	type GameState, type Raid, type WeaponInstance,
} from "../src/game/engine";
import { MAP_BY_ID } from "../src/game/data";
import { FACTORY_KITS, MODULE_BY_ID, RECEIVER_INFO, type ModuleInstance } from "../src/game/modules";

const NOW = 1_792_000_000_000;

function campaign(): GameState {
	const state = createGame(NOW);
	state.money = 50_000;
	state.supplies = { ammo: 500, medicine: 50, scrap: 500, intel: 50 };
	state.base.workshop = 5;
	return state;
}

function clone(state: GameState): GameState {
	const loaded = parseSave(saveGame(state));
	expect(loaded).not.toBeNull();
	return loaded!;
}

function part(state: GameState, modelId: string): ModuleInstance {
	expect(craftModule(state, modelId).ok).toBe(true);
	const crafted = state.modules.at(-1)!;
	expect(crafted.modelId).toBe(modelId);
	return crafted;
}

function primaryGun(state: GameState): WeaponInstance {
	return state.weapons.find((gun) => gun.id === state.scavs[0]!.weaponInstanceId)!;
}

function mount(state: GameState, gun: WeaponInstance, modelId: string): ModuleInstance {
	const crafted = part(state, modelId);
	expect(installModule(state, gun.id, crafted.id).ok).toBe(true);
	return crafted;
}

function receiver(state: GameState, weaponId: string): WeaponInstance {
	// Discovery and workshop access are scenario setup; assembly still pays the
	// full real costs and consumes actual, independently identified inventory.
	if (!state.discoveredWeapons.includes(weaponId)) state.discoveredWeapons.push(weaponId);
	const base = part(state, `receiver-${weaponId}`);
	expect(assembleWeapon(state, base.id).ok).toBe(true);
	return state.weapons.at(-1)!;
}

function factoryGun(state: GameState, weaponId: string): WeaponInstance {
	const gun = receiver(state, weaponId);
	for (const slot of RECEIVER_INFO[weaponId]!.requiredSlots) {
		if (slot !== "receiver") mount(state, gun, FACTORY_KITS[weaponId]![slot]!);
	}
	expect(getWeaponStats(gun).ready).toBe(true);
	return gun;
}

function firstCheckpoint(state: GameState, seed?: number): Raid {
	expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
	const raid = state.raids[0]!;
	// As in the existing settlement tests, isolate decisions from survival RNG.
	// Cargo, costs, offers, wear and achievement events are all engine outputs.
	if (seed !== undefined) raid.seed = seed;
	raid.chance = 1;
	advance(state, raid.endsAt);
	expect(raid.expedition!.status).toBe("choice");
	return raid;
}

function nextCheckpoint(state: GameState, raid: Raid, branch: "combat" | "scavenge" | "recon", success = true): void {
	const perk = raid.expedition!.offers[0]!;
	expect(continueExpedition(state, raid.id, branch, perk, state.lastUpdated).ok).toBe(true);
	raid.chance = success ? 1 : 0;
	advance(state, raid.endsAt);
	if (success) expect(raid.expedition!.status).toBe("choice");
}

function scarcity(): GameState {
	const state = campaign();
	state.xp = 90;
	state.level = 2;
	mount(state, primaryGun(state), "magazine-sks-7.62x39-extended");
	state.supplies.ammo = 4;
	const quote = getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.depot!);
	expect(quote.ammo).toBe(5);
	expect(quote.reason).toContain("патронов");
	return state;
}

function donate(state: GameState): { handguard: ModuleInstance; stock: ModuleInstance; donorId: string } {
	const gun = factoryGun(state, "akm");
	// Factory AKM components have a single caliber. Family models really fit
	// both 7.62 and 5.45, so the transfer does not bypass compatibility rules.
	const handguard = mount(state, gun, "handguard-ak-light");
	const stock = mount(state, gun, "stock-ak-folding");
	expect(disassembleWeapon(state, gun.id).ok).toBe(true);
	return { handguard, stock, donorId: gun.id };
}

function recipient(state: GameState, weaponId: string, handguard: ModuleInstance, stock: ModuleInstance): WeaponInstance {
	const gun = receiver(state, weaponId);
	mount(state, gun, FACTORY_KITS[weaponId]!.barrel!);
	mount(state, gun, FACTORY_KITS[weaponId]!.magazine!);
	expect(installModule(state, gun.id, handguard.id).ok).toBe(true);
	expect(installModule(state, gun.id, stock.id).ok).toBe(true);
	expect(getWeaponStats(gun).ready).toBe(true);
	expect(equipWeapon(state, state.scavs[0]!.id, gun.id).ok).toBe(true);
	return gun;
}

describe("achievement decisions use real sortie and inventory events", () => {
	test("a new campaign and an unchanged tick grant no achievements", () => {
		const state = createGame(NOW);
		expect(state.achievements.unlocked).toEqual({});
		advance(state, NOW);
		expect(state.achievements.unlocked).toEqual({});
		expect(clone(state)).toEqual(state);
	});

	test("enough requires voluntary stage-two extraction with a full enough pack and an available next route", () => {
		let state = campaign();
		let raid = firstCheckpoint(state, 1);
		nextCheckpoint(state, raid, "combat");
		expect(raid.expedition!.stage).toBe(2);
		expect(getCargoWeight(raid.expedition!.cargo)).toBeGreaterThanOrEqual(raid.expedition!.capacity * .8);
		expect(getExpeditionChoices(state, raid, raid.expedition!.offers[0]!).some((choice) => choice.reason === null)).toBe(true);
		expect(state.achievements.unlocked.enough).toBeUndefined();
		state = clone(state);
		raid = state.raids[0]!;
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.enough).toBeDefined();
		const awarded = structuredClone(state.achievements.unlocked.enough);
		const saved = saveGame(state);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		state = clone(state);
		advance(state, state.lastUpdated + 1_000);
		expect(state.achievements.unlocked.enough).toEqual(awarded);
	});

	test("stage-one extraction is not a deliberate deep-route stop", () => {
		const state = campaign(), raid = firstCheckpoint(state);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.enough).toBeUndefined();
	});

	test("a large but sparsely filled backpack does not satisfy enough", () => {
		const state = campaign();
		expect(craftGear(state, "scout_pack").ok).toBe(true);
		expect(equipGear(state, state.scavs[0]!.id, "backpack", state.gearItems.at(-1)!.id).ok).toBe(true);
		const raid = firstCheckpoint(state);
		nextCheckpoint(state, raid, "combat");
		expect(getCargoWeight(raid.expedition!.cargo)).toBeLessThan(raid.expedition!.capacity * .8);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.enough).toBeUndefined();
	});

	test("being forced home by resource shortage does not satisfy enough", () => {
		const state = campaign(), raid = firstCheckpoint(state, 1);
		nextCheckpoint(state, raid, "combat");
		expect(getCargoWeight(raid.expedition!.cargo)).toBeGreaterThanOrEqual(raid.expedition!.capacity * .8);
		state.supplies.ammo = 0;
		expect(getExpeditionChoices(state, raid, raid.expedition!.offers[0]!).every((choice) => choice.reason !== null)).toBe(true);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.enough).toBeUndefined();
	});

	test("dual-radio records combat two then scavenge three even when blueprints were already known and the third escape fails", () => {
		let state = campaign();
		state.blueprints.push("plate_armor", "cargo_pack");
		let raid = firstCheckpoint(state);
		nextCheckpoint(state, raid, "combat");
		expect(state.achievements.unlocked["dual-radio"]).toBeUndefined();
		state = clone(state);
		raid = state.raids[0]!;
		nextCheckpoint(state, raid, "scavenge", false);
		expect(state.history[0]!.success).toBe(false);
		expect(state.achievements.unlocked["dual-radio"]).toBeDefined();
		const awarded = structuredClone(state.achievements.unlocked["dual-radio"]);
		state = clone(state);
		advance(state, state.lastUpdated + 60_000);
		expect(state.achievements.unlocked["dual-radio"]).toEqual(awarded);
	});

	test("the same two branches in reverse order do not satisfy dual-radio", () => {
		const state = campaign(), raid = firstCheckpoint(state);
		nextCheckpoint(state, raid, "scavenge");
		nextCheckpoint(state, raid, "combat");
		expect(state.blueprints).toContain("cargo_pack");
		expect(state.blueprints).toContain("plate_armor");
		expect(state.achievements.unlocked["dual-radio"]).toBeUndefined();
	});

	test("lighten uses a less powerful ready build that really shortens the same sortie by five percent", () => {
		let state = campaign(), gun = primaryGun(state);
		mount(state, gun, "barrel-sks-7.62x39-long");
		mount(state, gun, "handguard-sks-rail");
		mount(state, gun, "optic-scope");
		mount(state, gun, "foregrip-vertical");
		const heavyPower = getWeaponStats(gun).power;
		const heavyDuration = getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.courtyard!).duration;
		state = clone(state);
		gun = primaryGun(state);
		expect(removeModule(state, gun.id, "optic").ok).toBe(true);
		// Persist midway through the dependent-mount change, not merely after
		// the final award, to prove that its real physical baseline survives.
		state = clone(state);
		gun = primaryGun(state);
		expect(removeModule(state, gun.id, "foregrip").ok).toBe(true);
		mount(state, gun, "handguard-sks-light");
		mount(state, gun, "barrel-sks-7.62x39-short");
		expect(getWeaponStats(gun).ready).toBe(true);
		expect(getWeaponStats(gun).power).toBeLessThan(heavyPower);
		expect(getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.courtyard!).duration).toBeLessThanOrEqual(heavyDuration * .95);
		expect(state.achievements.unlocked.lighten).toBeUndefined();
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.lighten).toBeDefined();
		expect(clone(state).achievements.unlocked.lighten).toEqual(state.achievements.unlocked.lighten);
	});

	test("unrelated radio progress cannot masquerade as the speed benefit of lighter parts", () => {
		const state = campaign(), gun = factoryGun(state, "ak74");
		expect(equipWeapon(state, state.scavs[0]!.id, gun.id).ok).toBe(true);
		mount(state, gun, "handguard-ak-rail");
		mount(state, gun, "barrel-ak-5.45x39-fluted");
		mount(state, gun, "optic-scope");
		mount(state, gun, "foregrip-vertical");
		const historicalDuration = getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.courtyard!).duration;
		const oldPower = getWeaponStats(gun).power;
		// Scenario progression changes the current radio context, not any
		// achievement progress. The swapped build must be compared within it.
		state.base.radio = 5;
		const sameContextDuration = getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.courtyard!).duration;
		mount(state, gun, "optic-dovetail");
		mount(state, gun, "barrel-ak-5.45x39-heavy");
		const currentDuration = getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.courtyard!).duration;
		expect(getWeaponStats(gun).power).toBeLessThan(oldPower);
		expect(currentDuration).toBeLessThanOrEqual(historicalDuration * .95);
		expect(currentDuration).toBeGreaterThan(sameContextDuration * .95);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.lighten).toBeUndefined();
	});

	test("changing tactics cannot turn a slower lower-power rebuild into lighten", () => {
		const state = campaign(), gun = primaryGun(state);
		mount(state, gun, "handguard-sks-rail");
		mount(state, gun, "barrel-sks-7.62x39-fluted");
		mount(state, gun, "optic-reflex");
		const historicalDuration = getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.courtyard!).duration;
		const oldPower = getWeaponStats(gun).power;
		expect(setRaidTactic(state, state.scavs[0]!.id, "bold").ok).toBe(true);
		const sameContextDuration = getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.courtyard!).duration;
		expect(removeModule(state, gun.id, "optic").ok).toBe(true);
		mount(state, gun, "barrel-sks-7.62x39-heavy");
		const currentDuration = getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.courtyard!).duration;
		expect(getWeaponStats(gun).power).toBeLessThan(oldPower);
		expect(currentDuration).toBeLessThanOrEqual(historicalDuration * .95);
		expect(currentDuration).toBeGreaterThan(sameContextDuration * .95);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.lighten).toBeUndefined();
	});

	test("replacing the receiver cannot reuse the previous physical build's lighten chain", () => {
		const state = campaign(), gun = primaryGun(state);
		mount(state, gun, "barrel-sks-7.62x39-long");
		mount(state, gun, "handguard-sks-rail");
		mount(state, gun, "optic-scope");
		mount(state, gun, "foregrip-vertical");
		const originalReceiver = gun.modules.receiver!.id;
		expect(removeModule(state, gun.id, "optic").ok).toBe(true);
		expect(removeModule(state, gun.id, "foregrip").ok).toBe(true);
		mount(state, gun, "handguard-sks-light");
		mount(state, gun, "barrel-sks-7.62x39-short");
		mount(state, gun, "receiver-sks");
		expect(gun.modules.receiver!.id).not.toBe(originalReceiver);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.lighten).toBeUndefined();
	});

	test("magazine unlocks only when a real swap alone makes the previously unaffordable sortie possible", () => {
		let state = scarcity();
		const scavId = state.scavs[0]!.id, gunId = primaryGun(state).id;
		const quick = part(state, "magazine-sks-7.62x39-quick");
		expect(installModule(state, gunId, quick.id).ok).toBe(true);
		expect(getRaidQuote(state, state.scavs[0]!, MAP_BY_ID.depot!).ammo).toBe(4);
		expect(state.achievements.unlocked.magazine).toBeUndefined();
		state = clone(state);
		expect(dispatchRaid(state, scavId, "depot", state.lastUpdated).ok).toBe(true);
		expect(state.supplies.ammo).toBe(0);
		expect(state.achievements.unlocked.magazine).toBeDefined();
		expect(clone(state).achievements.unlocked.magazine).toEqual(state.achievements.unlocked.magazine);
	});

	test("passive ammo after the economical swap invalidates the magazine chain", () => {
		const state = scarcity(), gun = primaryGun(state);
		mount(state, gun, "magazine-sks-7.62x39-quick");
		advance(state, NOW + 30_000);
		expect(state.supplies.ammo).toBeGreaterThan(4);
		expect(dispatchRaid(state, state.scavs[0]!.id, "depot", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.magazine).toBeUndefined();
	});

	test("offline batching and irregular ticks invalidate the same magazine plan without changing the campaign", () => {
		const offline = scarcity(), gun = primaryGun(offline);
		mount(offline, gun, "magazine-sks-7.62x39-quick");
		const rendered = clone(offline);
		advance(offline, NOW + 90_000);
		for (const elapsed of [9_999, 18_001, 35_017, 52_443, 78_001, 90_000]) advance(rendered, NOW + elapsed);
		expect(rendered).toEqual(offline);
		expect(dispatchRaid(offline, offline.scavs[0]!.id, "depot", offline.lastUpdated).ok).toBe(true);
		expect(dispatchRaid(rendered, rendered.scavs[0]!.id, "depot", rendered.lastUpdated).ok).toBe(true);
		expect(offline.achievements.unlocked.magazine).toBeUndefined();
		expect(rendered.achievements.unlocked.magazine).toBeUndefined();
		expect(rendered).toEqual(offline);
	});

	test("buying ammo after the economical swap invalidates the magazine chain", () => {
		const state = scarcity(), gun = primaryGun(state);
		mount(state, gun, "magazine-sks-7.62x39-quick");
		expect(buySupplies(state, "ammo").ok).toBe(true);
		expect(dispatchRaid(state, state.scavs[0]!.id, "depot", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.magazine).toBeUndefined();
	});

	test("a different map cannot reuse a magazine plan made for the unaffordable depot sortie", () => {
		const state = scarcity(), gun = primaryGun(state);
		mount(state, gun, "magazine-sks-7.62x39-quick");
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.magazine).toBeUndefined();
	});

	test("handing the economical gun to another scav cannot reuse the original scav's magazine plan", () => {
		const state = scarcity(), gun = primaryGun(state);
		mount(state, gun, "magazine-sks-7.62x39-quick");
		expect(equipWeapon(state, state.scavs[1]!.id, gun.id).ok).toBe(true);
		expect(dispatchRaid(state, state.scavs[1]!.id, "depot", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.magazine).toBeUndefined();
	});

	test("inheritance follows physical donor parts across caliber changes and survives reload before dispatch", () => {
		let state = campaign();
		const donated = donate(state), gun = recipient(state, "ak74", donated.handguard, donated.stock);
		expect(gun.modules.handguard!.id).toBe(donated.handguard.id);
		expect(gun.modules.stock!.id).toBe(donated.stock.id);
		expect(gun.modules.barrel!.modelId).toBe("factory-ak74-barrel");
		expect(gun.modules.magazine!.modelId).toBe("factory-ak74-magazine");
		expect(state.achievements.unlocked.inheritance).toBeUndefined();
		state = clone(state);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.inheritance).toBeDefined();
		expect(clone(state).achievements.unlocked.inheritance).toEqual(state.achievements.unlocked.inheritance);
	});

	test("fresh lookalike components do not stand in for two physical donor parts", () => {
		const state = campaign(), donated = donate(state);
		const freshStock = part(state, donated.stock.modelId);
		expect(freshStock.id).not.toBe(donated.stock.id);
		recipient(state, "ak74", donated.handguard, freshStock);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.inheritance).toBeUndefined();
	});

	test("moving two real donor parts to the same caliber is not inheritance", () => {
		const state = campaign(), donated = donate(state);
		recipient(state, "akm", donated.handguard, donated.stock);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked.inheritance).toBeUndefined();
	});

	test("a real raid scrap receipt does not lose early catalog recipes when many alternatives are eligible", () => {
		let state = campaign();
		const raid = firstCheckpoint(state), source = raid.expedition!.cargo.modules[0]!;
		expect(getModuleRecycleYield(source)).toBe(1);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		state.supplies.scrap = MODULE_BY_ID["factory-sks-stock"]!.craftCost.scrap - 1;
		expect(getModuleCraftReason(state, "factory-sks-stock")).not.toBeNull();
		expect(recycleModule(state, source.id).ok).toBe(true);
		expect(getModuleCraftReason(state, "factory-sks-stock")).toBeNull();
		state = clone(state);
		const gun = primaryGun(state), crafted = mount(state, gun, "factory-sks-stock");
		expect(gun.modules.stock!.id).toBe(crafted.id);
		expect(state.achievements.unlocked["recycle-chain"]).toBeUndefined();
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked["recycle-chain"]).toBeDefined();
		expect(clone(state).achievements.unlocked["recycle-chain"]).toEqual(state.achievements.unlocked["recycle-chain"]);
	});

	test("a gun assembled from a genuinely extracted receiver retains that receiver's raid provenance when recycled", () => {
		let state = campaign();
		const raid = firstCheckpoint(state, 1);
		const source = raid.expedition!.cargo.modules.find((item) => MODULE_BY_ID[item.modelId]!.slot === "receiver")!;
		expect(source).toBeDefined();
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(assembleWeapon(state, source.id).ok).toBe(true);
		const gun = state.weapons.at(-1)!;
		expect(gun.modules.receiver!.id).toBe(source.id);
		for (const slot of RECEIVER_INFO[gun.weaponId]!.requiredSlots) if (slot !== "receiver") mount(state, gun, FACTORY_KITS[gun.weaponId]![slot]!);
		expect(getWeaponStats(gun).ready).toBe(true);
		state.supplies.scrap = MODULE_BY_ID["factory-sks-stock"]!.craftCost.scrap - 1;
		expect(recycleWeapon(state, gun.id).ok).toBe(true);
		state = clone(state);
		mount(state, primaryGun(state), "factory-sks-stock");
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked["recycle-chain"]).toBeDefined();
	});

	test("an old looted gun wrapper does not give provenance to an entirely fresh crafted build", () => {
		const state = campaign(), oldGunIds = new Set(state.weapons.map((gun) => gun.id));
		const raid = firstCheckpoint(state, 5);
		expect(raid.expedition!.cargo.weaponIds).toEqual(["tt"]);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		const gun = state.weapons.find((item) => !oldGunIds.has(item.id))!;
		const oldPartIds = new Set(Object.values(gun.modules).map((item) => item.id));
		for (const slot of RECEIVER_INFO[gun.weaponId]!.requiredSlots) mount(state, gun, FACTORY_KITS[gun.weaponId]![slot]!);
		expect(Object.values(gun.modules).every((item) => !oldPartIds.has(item.id))).toBe(true);
		expect(getWeaponStats(gun).ready).toBe(true);
		state.supplies.scrap = 1;
		expect(recycleWeapon(state, gun.id).ok).toBe(true);
		expect(craftGear(state, "padded_vest").ok).toBe(true);
		expect(equipGear(state, state.scavs[0]!.id, "armor", state.gearItems.at(-1)!.id).ok).toBe(true);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.achievements.unlocked["recycle-chain"]).toBeUndefined();
		expect(clone(state)).toEqual(state);
	});

	test("an otherwise valid high-cash campaign remains reloadable after recycling real raid loot", () => {
		const state = campaign();
		state.money = 100_000_001;
		expect(clone(state)).toEqual(state);
		const raid = firstCheckpoint(state), source = raid.expedition!.cargo.modules[0]!;
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		state.supplies.scrap = 1;
		expect(state.money).toBeGreaterThan(100_000_000);
		expect(clone(state)).toEqual(state);
		expect(recycleModule(state, source.id).ok).toBe(true);
		expect(clone(state)).toEqual(state);
	});

	test("accepted fractional ammo remains reloadable when passive production fills the last half unit", () => {
		const state = createGame(NOW), capacity = getSupplyCapacity(state).ammo;
		state.supplies.ammo = capacity - .5;
		expect(clone(state)).toEqual(state);
		advance(state, NOW + 30_000);
		expect(state.supplies.ammo).toBe(capacity);
		expect(state.achievements.ammoVersion).toBe(.5);
		expect(clone(state)).toEqual(state);
	});

	test("accepted fractional cash and scrap remain reloadable after an actual raid-loot recycle receipt", () => {
		const state = campaign();
		state.money += .5;
		expect(clone(state)).toEqual(state);
		const raid = firstCheckpoint(state), source = raid.expedition!.cargo.modules[0]!;
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		state.supplies.scrap = 1.5;
		expect(state.money % 1).toBe(.5);
		expect(clone(state)).toEqual(state);
		expect(recycleModule(state, source.id).ok).toBe(true);
		expect(state.supplies.scrap).toBe(2.5);
		expect(clone(state)).toEqual(state);
	});

	test("v8 migration starts event tracking without inventing awards from old statistics", () => {
		const oldState = campaign(), raid = firstCheckpoint(oldState, 1);
		nextCheckpoint(oldState, raid, "combat");
		expect(extractRaid(oldState, raid.id, oldState.lastUpdated).ok).toBe(true);
		const oldSave = JSON.parse(saveGame(oldState));
		oldSave.schemaVersion = 8;
		delete oldSave.achievements;
		const migrated = parseSave(JSON.stringify(oldSave));
		expect(migrated).not.toBeNull();
		expect(migrated!.schemaVersion).toBe(SAVE_VERSION);
		expect(migrated!.achievements.unlocked).toEqual({});
		expect(migrated!.stats).toEqual(oldState.stats);
		expect(migrated!.history).toEqual(oldState.history);
		expect(migrated!.weapons).toEqual(oldState.weapons);
		expect(migrated!.social).toEqual(oldState.social);
		expect(clone(migrated!)).toEqual(migrated!);
	});

	test("saved awards reject unknown IDs and timestamps from the future", () => {
		const state = campaign(), raid = firstCheckpoint(state, 1);
		nextCheckpoint(state, raid, "combat");
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		const unknown = JSON.parse(saveGame(state));
		unknown.achievements.unlocked["first-kill"] = unknown.achievements.unlocked.enough;
		expect(parseSave(JSON.stringify(unknown))).toBeNull();
		const future = JSON.parse(saveGame(state));
		future.achievements.unlocked.enough.at = state.lastUpdated + 1;
		expect(parseSave(JSON.stringify(future))).toBeNull();
	});
});
