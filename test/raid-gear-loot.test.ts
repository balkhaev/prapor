import { describe, expect, test } from "bun:test";
import { advance, claimLootDelivery, continueExpedition, createGame, dispatchRaid, equipGear, extractRaid, getCargoValue, getCargoWeight, getLoadoutStats, getLootCapacity, getRaidGearLootPool, getRaidGearValue, parseSave, recycleGear, rollRaidGearLoot, saveGame, sellLootItem, setLoadoutOption, type GameState } from "../src/game/engine";
import { GEAR_MODELS } from "../src/game/systems";
import { MAPS } from "../src/game/data";

const NOW = 1_792_000_000_000;
function start(seed = 9, catalog = 23) {
	const state = createGame(NOW); state.money = 5000; state.supplies.ammo = 72;
	expect(setLoadoutOption(state, state.scavs[0]!.id, "medkit", true).ok).toBe(true);
	expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
	const raid = state.raids[0]!; raid.seed = seed; raid.chance = 1; raid.expedition!.capacity = 50; raid.expedition!.lootCatalogVersion = catalog;
	return { state, raid };
}
function found() {
	for (let seed = 1; seed < 100; seed++) { const result = start(seed); advance(result.state, result.raid.endsAt); if (result.raid.expedition!.cargo.gearItems!.length) return result; }
	throw new Error("No gear drop in deterministic fixture range");
}
function valid(state: GameState) { expect(parseSave(saveGame(state))).toEqual(state); }

describe("physical equipment as ordinary raid cargo", () => {
	test("all sixteen existing gear models are reachable with sector, branch and depth differences", () => {
		const reachable = new Set(MAPS.flatMap(map => getRaidGearLootPool(map.id, "scavenge", 3).map(entry => entry.model.id)));
		expect(reachable).toEqual(new Set(GEAR_MODELS.map(model => model.id)));
		expect(getRaidGearLootPool("courtyard", "combat", 1).some(entry => entry.model.id === "heavy_armor")).toBe(false);
		expect(getRaidGearLootPool("bunker", "combat", 2).some(entry => entry.model.id === "heavy_armor")).toBe(false);
		expect(getRaidGearLootPool("bunker", "combat", 3).some(entry => entry.model.id === "heavy_armor")).toBe(true);
		expect(getRaidGearLootPool("bunker", "combat", 3, 22)).toEqual([]); expect(getRaidGearLootPool("__proto__", "combat", 3)).toEqual([]);
		const weight = (branch: "scavenge" | "combat") => getRaidGearLootPool("courtyard", branch, 1).find(entry => entry.model.id === "steel_helmet")!.weight;
		expect(weight("combat")).toBeGreaterThan(weight("scavenge"));
		const draws = [.1, .5, 1 - Number.EPSILON]; expect(rollRaidGearLoot("courtyard", "scavenge", 1, () => draws.shift()!)[0]!.durability).toBe(100);
	});
	test("new equipment has actual weight and condition-adjusted value; it remains unavailable until extraction", () => {
		const { state, raid } = found(), carried = structuredClone(raid.expedition!.cargo.gearItems!), gear = carried[0]!;
		expect(state.gearItems).toEqual([]); expect(equipGear(state, state.scavs[0]!.id, GEAR_MODELS.find(model => model.id === gear.modelId)!.slot, gear.id).ok).toBe(false);
		const cargo = { money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 }, weaponIds: [], modules: [], gearItems: [gear] };
		expect(getCargoWeight(cargo)).toBe(GEAR_MODELS.find(model => model.id === gear.modelId)!.weight); expect(getCargoValue(cargo)).toBe(getRaidGearValue(gear));
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true); expect(state.gearItems).toEqual(carried); expect(state.history[0]!.gearItems).toEqual(carried);
		const slot = GEAR_MODELS.find(model => model.id === gear.modelId)!.slot; expect(equipGear(state, state.scavs[0]!.id, slot, gear.id).ok).toBe(true);
		expect(getLoadoutStats(state, state.scavs[0]!).weight).toBeGreaterThan(0);
		state.gearItems[0]!.durability = 1; expect(state.history[0]!.gearItems![0]!.durability).toBe(gear.durability); valid(state);
	});
	test("full racks preserve exact gear in one combined parcel and neither inventory can be partially claimed", () => {
		const { state, raid } = found(), gear = structuredClone(raid.expedition!.cargo.gearItems!), item = { id: `loot-${state.nextId++}`, modelId: "duct-tape", foundAt: state.lastUpdated };
		raid.expedition!.cargo.lootItems = [item];
		state.lootItems = Array.from({ length: getLootCapacity(state) }, () => ({ id: `loot-${state.nextId++}`, modelId: "duct-tape", foundAt: state.lastUpdated }));
		state.gearItems = Array.from({ length: 28 }, () => ({ id: `gear-${state.nextId++}`, modelId: "canvas_pack", durability: 100 }));
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.pendingLoot).toHaveLength(1); const parcel = state.pendingLoot![0]!; expect(parcel.items).toEqual([item]); expect(parcel.gearItems).toEqual(gear);
		expect(state.history[0]!.gearItems).toEqual([]); expect(state.history[0]!.gearPending).toEqual(gear); valid(state);
		const full = saveGame(state); expect(claimLootDelivery(state, parcel.id).ok).toBe(false); expect(saveGame(state)).toBe(full);
		expect(sellLootItem(state, state.lootItems![0]!.id).ok).toBe(true); const rackFull = saveGame(state); expect(claimLootDelivery(state, parcel.id).ok).toBe(false); expect(saveGame(state)).toBe(rackFull);
		state.supplies.scrap = 0; expect(recycleGear(state, state.gearItems[0]!.id).ok).toBe(true);
		expect(claimLootDelivery(state, parcel.id).ok).toBe(true); expect(state.gearItems.at(-1)).toEqual(gear[0]!); expect(state.lootItems!.at(-1)).toEqual(item);
		expect(claimLootDelivery(state, parcel.id).ok).toBe(false); valid(state);
	});
	test("lost equipment stays in lost cargo with its original identifiers and never becomes owned", () => {
		const { state, raid } = found(), gear = structuredClone(raid.expedition!.cargo.gearItems!);
		expect(continueExpedition(state, raid.id, "scavenge", raid.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true); raid.chance = 0; advance(state, raid.endsAt);
		expect(state.gearItems).toEqual([]); expect(state.history[0]!.lostCargo!.gearItems).toEqual(gear); expect(state.history[0]!.gearItems).toEqual([]); expect(state.pendingLoot ?? []).toEqual([]); valid(state);
	});
	test("old paid catalogues retain their exact fields and new gear RNG never changes combat, cash or perk draws", () => {
		for (let seed = 1; seed <= 20; seed++) {
			const modern = start(seed), old = start(seed, 22); old.state.schemaVersion = 22;
			expect(parseSave(saveGame(old.state))).not.toBeNull(); advance(modern.state, modern.raid.endsAt); advance(old.state, old.raid.endsAt);
			expect(old.raid.expedition!.cargo.gearItems).toBeUndefined(); expect(modern.state.rng).toBe(old.state.rng);
			expect(modern.state.scavs[0]!.health).toBe(old.state.scavs[0]!.health); expect(modern.state.weapons[0]!.durability).toBe(old.state.weapons[0]!.durability);
			expect(modern.raid.expedition!.cargo.money).toBe(old.raid.expedition!.cargo.money); expect(modern.raid.expedition!.offers).toEqual(old.raid.expedition!.offers);
			expect(modern.raid.expedition!.cargo.modules).toEqual(old.raid.expedition!.cargo.modules);
			if (old.raid.expedition!.status === "choice") { expect(extractRaid(old.state, old.raid.id, old.state.lastUpdated).ok).toBe(true); expect(old.state.history[0]!.gearItems).toBeUndefined(); expect(old.state.history[0]!.gearPending).toBeUndefined(); }
		}
	});
	test("strict new cargo and parcel parsing rejects duplication, unreleased shapes, impossible depth and altered receipts", () => {
		const { state, raid } = found(); valid(state);
		for (const mutate of [
			(value: GameState) => { value.raids[0]!.expedition!.cargo.gearItems!.push(structuredClone(value.raids[0]!.expedition!.cargo.gearItems![0]!)); },
			(value: GameState) => { value.raids[0]!.expedition!.cargo.gearItems![0]!.modelId = "heavy_armor"; },
			(value: GameState) => { value.raids[0]!.expedition!.cargo.gearItems![0]!.durability = 49; },
			(value: GameState) => { value.raids[0]!.expedition!.lootCatalogVersion = 22; },
			(value: GameState) => { value.schemaVersion = 22; },
		]) { const altered = structuredClone(state); mutate(altered); expect(parseSave(saveGame(altered))).toBeNull(); }
		state.gearItems = Array.from({ length: 28 }, () => ({ id: `gear-${state.nextId++}`, modelId: "canvas_pack", durability: 100 })); expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		const parcel = state.pendingLoot![0]!; expect(parcel.items).toEqual([]); valid(state);
		const duplicate = structuredClone(state); duplicate.gearItems[0] = { ...parcel.gearItems![0]! }; expect(parseSave(saveGame(duplicate))).toBeNull();
		const changed = structuredClone(state); changed.pendingLoot![0]!.gearItems![0]!.durability--; expect(parseSave(saveGame(changed))).toBeNull();
		const historical = structuredClone(state); historical.schemaVersion = 22; expect(parseSave(saveGame(historical))).toBeNull();
	});
	test("gear draws follow the private outcome stream while public street seeds remain cosmetic", () => {
		const first = start(1), second = start(2); first.raid.outcomeSeed = second.raid.outcomeSeed = 58319;
		advance(first.state, first.raid.endsAt); advance(second.state, second.raid.endsAt);
		expect(first.raid.expedition!.cargo.gearItems).toEqual(second.raid.expedition!.cargo.gearItems);
	});
	test("a cramped bag drops bulky gear ahead of smaller valuables using real value per weight", () => {
		const { state, raid } = start(3), bulky = { id: `gear-${state.nextId++}`, modelId: "padded_vest", durability: 50 };
		raid.expedition!.capacity = 8; raid.expedition!.cargo.gearItems = [bulky];
		raid.expedition!.cargo.lootItems = Array.from({ length: 4 }, () => ({ id: `loot-${state.nextId++}`, modelId: "battery", foundAt: state.lastUpdated }));
		advance(state, raid.endsAt); expect(getCargoWeight(raid.expedition!.cargo)).toBeLessThanOrEqual(8);
		// The worn vest is worth less per space than the four intact batteries.
		expect(raid.expedition!.cargo.gearItems!.some(item => item.id === bulky.id)).toBe(false); valid(state);
	});
});
