import { copyWeaponFixture } from "./weapon-fixtures";
import { describe, expect, test } from "bun:test";
import { MAPS } from "../src/game/data";
import {
	GEAR_MODELS,
	MARKET_OFFERS,
	MAX_OFFLINE_MS,
	advance,
	buySupplies,
	craftGear,
	createGame,
	dispatchRaid,
	equipGear,
	equipWeapon,
	extractRaid,
	getGearCraftReason,
	getGearRecycleYield,
	getGearRepairCost,
	getRecoveryAllowance,
	getLoadoutStats,
	getRaidQuote,
	getSupplyCapacity,
	getWeaponRecycleYield,
	modWeapon,
	parseSave,
	recycleGear,
	recycleWeapon,
	repairGear,
	repairWeapon,
	recruitScav,
	getStorageCapacity,
	saveGame,
	setLoadoutOption,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;

describe("a bounded economy and shared equipment", () => {
	test("idle production stops at recovery allowance and supply capacity, so waiting cannot buy the whole progression", () => {
		const state = createGame(NOW);
		state.money = 0;
		state.supplies = { ammo: 0, medicine: 0, scrap: 0, intel: 0 };
		advance(state, NOW + MAX_OFFLINE_MS);
		expect(state.money).toBe(getRecoveryAllowance(state));
		const capacity = getSupplyCapacity(state);
		for (const key of ["ammo", "medicine", "scrap", "intel"] as const) expect(state.supplies[key]).toBeLessThanOrEqual(capacity[key]);
		expect(state.supplies.ammo).toBeGreaterThan(0);
		const balances = { money: state.money, supplies: { ...state.supplies } };
		advance(state, NOW + MAX_OFFLINE_MS * 2);
		expect(state.money).toBe(balances.money);
		expect(state.supplies).toEqual(balances.supplies);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("old balances above the new limits are preserved until spent and production never truncates them", () => {
		const state = createGame(NOW);
		state.money = 20_000;
		const capacity = getSupplyCapacity(state);
		state.supplies = { ammo: capacity.ammo + 61, medicine: capacity.medicine + 17, scrap: capacity.scrap + 43, intel: capacity.intel + 13 };
		const reloaded = parseSave(saveGame(state))!;
		expect(reloaded).not.toBeNull();
		const supplies = { ...state.supplies };
		advance(reloaded, NOW + MAX_OFFLINE_MS);
		expect(reloaded.supplies).toEqual(supplies);
		expect(reloaded.money).toBe(20_000);
		expect(parseSave(saveGame(reloaded))).not.toBeNull();
	});

	test("market batches require both money and room, rejecting without taking a partial payment", () => {
		for (const offer of MARKET_OFFERS) {
			const state = createGame(NOW);
			const capacity = getSupplyCapacity(state)[offer.supply];
			state.money = 10_000;
			state.supplies[offer.supply] = capacity - offer.amount + 1;
			const full = saveGame(state);
			expect(buySupplies(state, offer.id).ok).toBe(false);
			expect(saveGame(state)).toBe(full);
			state.supplies[offer.supply] = 0;
			state.money = offer.money - 1;
			const poor = saveGame(state);
			expect(buySupplies(state, offer.id).ok).toBe(false);
			expect(saveGame(state)).toBe(poor);
			state.money = offer.money;
			expect(buySupplies(state, offer.id).ok).toBe(true);
			expect(state.money).toBe(0);
			expect(state.supplies[offer.supply]).toBe(offer.amount);
			expect(parseSave(saveGame(state))).not.toBeNull();
		}
		const state = createGame(NOW);
		const before = saveGame(state);
		expect(buySupplies(state, "constructor").ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("crafting respects permanent recipes and pays atomically; craft/recycle cannot manufacture money or parts", () => {
		const state = createGame(NOW);
		const locked = GEAR_MODELS.find((model) => model.blueprint && !state.blueprints.includes(model.blueprint))!;
		expect(locked).toBeDefined();
		const initial = saveGame(state);
		expect(getGearCraftReason(state, locked.id)).not.toBeNull();
		expect(craftGear(state, locked.id).ok).toBe(false);
		expect(saveGame(state)).toBe(initial);
		const model = GEAR_MODELS.find((item) => !item.blueprint || state.blueprints.includes(item.blueprint))!;
		state.money = 10_000;
		state.supplies.scrap = model.scrap - 1;
		const missingParts = saveGame(state);
		expect(craftGear(state, model.id).ok).toBe(false);
		expect(saveGame(state)).toBe(missingParts);
		state.supplies.scrap = 30;
		const money = state.money;
		const scrap = state.supplies.scrap;
		expect(craftGear(state, model.id).ok).toBe(true);
		const item = state.gearItems.at(-1)!;
		expect(getGearRecycleYield(item)).toBeLessThan(model.scrap);
		expect(recycleGear(state, item.id).ok).toBe(true);
		expect(state.money).toBeLessThan(money);
		expect(state.supplies.scrap).toBeLessThan(scrap);
		expect(state.gearItems.some((gear) => gear.id === item.id)).toBe(false);
		const after = saveGame(state);
		expect(recycleGear(state, item.id).ok).toBe(false);
		expect(saveGame(state)).toBe(after);
	});

	test("an owned piece fits one slot and one scav, and an active expedition locks every part of its physical loadout", () => {
		const state = createGame(NOW);
		const armor = GEAR_MODELS.find((model) => model.slot === "armor" && (!model.blueprint || state.blueprints.includes(model.blueprint)))!;
		expect(craftGear(state, armor.id).ok).toBe(true);
		const item = state.gearItems.at(-1)!;
		const [first, second] = state.scavs;
		expect(equipGear(state, first!.id, "armor", item.id).ok).toBe(true);
		expect(equipGear(state, second!.id, "armor", item.id).ok).toBe(true);
		expect(first!.loadout.armorItemId).toBeNull();
		expect(second!.loadout.armorItemId).toBe(item.id);
		const wrongSlot = saveGame(state);
		expect(equipGear(state, first!.id, "backpack", item.id).ok).toBe(false);
		expect(saveGame(state)).toBe(wrongSlot);
		expect(dispatchRaid(state, second!.id, "courtyard", NOW).ok).toBe(true);
		const saved = saveGame(state);
		expect(equipGear(state, first!.id, "armor", item.id).ok).toBe(false);
		expect(equipGear(state, second!.id, "armor", null).ok).toBe(false);
		expect(repairGear(state, item.id).ok).toBe(false);
		expect(recycleGear(state, item.id).ok).toBe(false);
		expect(setLoadoutOption(state, second!.id, "ammoType", "piercing").ok).toBe(false);
		expect(setLoadoutOption(state, second!.id, "medkit", true).ok).toBe(false);
		expect(equipWeapon(state, first!.id, second!.weaponInstanceId).ok).toBe(false);
		expect(repairWeapon(state, second!.weaponInstanceId!).ok).toBe(false);
		expect(recycleWeapon(state, second!.weaponInstanceId!).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expect(parseSave(saved)).not.toBeNull();
	});

	test("a real expedition wears armor; repairing requires its whole quote and recycling clears the owner", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		state.money = 2_000;
		state.supplies.scrap = 30;
		expect(craftGear(state, "light_vest").ok).toBe(true);
		const item = state.gearItems.at(-1)!;
		expect(equipGear(state, scav.id, "armor", item.id).ok).toBe(true);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		raid.chance = 1;
		advance(state, raid.endsAt);
		expect(item.durability).toBeLessThan(100);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		const cost = getGearRepairCost(item);
		state.supplies.scrap = cost.scrap - 1;
		const blocked = saveGame(state);
		expect(repairGear(state, item.id).ok).toBe(false);
		expect(saveGame(state)).toBe(blocked);
		state.supplies.scrap = cost.scrap;
		const money = state.money;
		expect(repairGear(state, item.id).ok).toBe(true);
		expect(item.durability).toBe(100);
		expect(state.money).toBe(money - cost.money);
		expect(state.supplies.scrap).toBe(0);
		expect(recycleGear(state, item.id).ok).toBe(true);
		expect(scav.loadout.armorItemId).toBeNull();
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("ammunition and medical choices trade scarce resources for protection, and compatibility prevents universal gun upgrades", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		const map = MAPS[0]!;
		const ordinary = getRaidQuote(state, scav, map);
		expect(setLoadoutOption(state, scav.id, "ammoType", "piercing").ok).toBe(true);
		const piercing = getRaidQuote(state, scav, map);
		expect(piercing.ammo).toBeGreaterThan(ordinary.ammo);
		expect(piercing.chance).toBeGreaterThan(ordinary.chance);
		expect(setLoadoutOption(state, scav.id, "medkit", true).ok).toBe(true);
		const prepared = getRaidQuote(state, scav, map);
		expect(prepared.medicine).toBeGreaterThan(0);
		state.supplies.medicine = prepared.medicine - 1;
		const lackingMedicine = saveGame(state);
		expect(dispatchRaid(state, scav.id, map.id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(lackingMedicine);
		const pistol = state.weapons.find((weapon) => weapon.weaponId === "pm")!;
		const before = saveGame(state);
		expect(modWeapon(state, pistol.id, "optic").ok).toBe(false);
		expect(modWeapon(state, pistol.id, "stock").ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("heavy armor buys protection with slower and more expensive departures, while condition changes its actual protection", () => {
		const state = createGame(NOW);
		const scav = state.scavs[0]!;
		state.money = 2_000;
		state.supplies.scrap = 30;
		state.blueprints.push("plate_armor");
		expect(craftGear(state, "light_vest").ok).toBe(true);
		const light = state.gearItems.at(-1)!;
		expect(craftGear(state, "plate_armor").ok).toBe(true);
		const heavy = state.gearItems.at(-1)!;
		expect(equipGear(state, scav.id, "armor", light.id).ok).toBe(true);
		const ordinary = getRaidQuote(state, scav, MAPS[0]!);
		expect(equipGear(state, scav.id, "armor", heavy.id).ok).toBe(true);
		const armored = getRaidQuote(state, scav, MAPS[0]!);
		expect(armored.chance).toBeGreaterThan(ordinary.chance);
		expect(armored.duration).toBeGreaterThan(ordinary.duration);
		expect(armored.ammo).toBeGreaterThan(ordinary.ammo);
		const protection = getLoadoutStats(state, scav).protection;
		heavy.durability = 0;
		expect(getLoadoutStats(state, scav).protection).toBeLessThan(protection);
		expect(getRaidQuote(state, scav, MAPS[0]!).chance).toBeLessThan(armored.chance);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("weapon recycling preserves a last recovery gun, requires storage room and never leaves dangling equipment", () => {
		const state = createGame(NOW);
		const gun = state.weapons[0]!;
		state.supplies.scrap = getSupplyCapacity(state).scrap;
		const full = saveGame(state);
		expect(recycleWeapon(state, gun.id).ok).toBe(false);
		expect(saveGame(state)).toBe(full);
		state.supplies.scrap = 0;
		const yieldAmount = getWeaponRecycleYield(gun);
		expect(recycleWeapon(state, gun.id).ok).toBe(true);
		expect(state.supplies.scrap).toBe(yieldAmount);
		expect(state.scavs[0]!.weaponInstanceId).toBeNull();
		while (state.weapons.length > 1) expect(recycleWeapon(state, state.weapons[0]!.id).ok).toBe(true);
		const last = saveGame(state);
		expect(recycleWeapon(state, state.weapons[0]!.id).ok).toBe(false);
		expect(saveGame(state)).toBe(last);
		expect(parseSave(last)).not.toBeNull();
	});

	test("save import rejects forged gear ownership, incompatible slots, unknown models and invalid loadout values", () => {
		const state = createGame(NOW);
		expect(craftGear(state, "light_vest").ok).toBe(true);
		const item = state.gearItems.at(-1)!;
		expect(equipGear(state, state.scavs[0]!.id, "armor", item.id).ok).toBe(true);
		const mutations: ((value: ReturnType<typeof JSON.parse>) => void)[] = [
			(value) => { value.gearItems[0].modelId = "constructor"; },
			(value) => { value.gearItems[0].durability = 101; },
			(value) => { value.gearItems.push(value.gearItems[0]); },
			(value) => { value.scavs[1].loadout.armorItemId = item.id; },
			(value) => { value.scavs[0].loadout.armorItemId = "gear-999"; },
			(value) => { value.scavs[0].loadout.armorItemId = null; value.scavs[0].loadout.backpackItemId = item.id; },
			(value) => { value.scavs[0].loadout.ammoType = "constructor"; },
			(value) => { value.scavs[0].loadout.medkit = "yes"; },
			(value) => { value.scavs[0].autoRaid.maxDepth = 4; },
			(value) => { value.blueprints.push("constructor"); },
		];
		for (const mutate of mutations) {
			const value = JSON.parse(saveGame(state));
			mutate(value);
			expect(parseSave(JSON.stringify(value))).toBeNull();
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a wiped roster with only ruined guns can recover immediately, even when the arsenal has no free slot", () => {
		for (const full of [false, true]) {
			const state = createGame(NOW);
			state.scavs = [];
			state.money = 0;
			state.supplies.ammo = 0;
			for (const weapon of state.weapons) { weapon.durability = 0; weapon.modules.receiver!.durability = 0; }
			if (full) while (state.weapons.length < getStorageCapacity(state)) {
				const source = state.weapons[0]!;
				state.weapons.push(copyWeaponFixture(state, source));
			}
			const existing = state.weapons.map((weapon) => weapon.id);
			expect(recruitScav(state).ok).toBe(true);
			expect(state.scavs).toHaveLength(1);
			const scav = state.scavs[0]!;
			expect(getRaidQuote(state, scav, MAPS[0]!).reason).toBeNull();
			for (const id of existing) expect(state.weapons.some((weapon) => weapon.id === id)).toBe(true);
			expect(state.weapons.length).toBeLessThanOrEqual(getStorageCapacity(state));
			expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
			expect(Object.values(state.supplies).every((value) => value >= 0)).toBe(true);
			expect(state.money).toBeGreaterThanOrEqual(0);
			expect(parseSave(saveGame(state))).not.toBeNull();
		}
	});
});
