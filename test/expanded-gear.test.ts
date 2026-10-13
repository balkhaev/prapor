import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MAPS } from "../src/game/data";
import {
	GEAR_MODELS, SAVE_VERSION, advance, craftGear, createGame, dispatchRaid, equipGear,
	extractRaid, getGearRecycleYield, getGearRepairCost, getLoadoutStats, getRaidQuote,
	parseSave, recycleGear, repairGear, saveGame, upgradeScavGear, type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;

function supplied() {
	const state = createGame(NOW);
	state.money = 10_000;
	state.supplies.scrap = 500;
	state.blueprints.push("plate_armor", "cargo_pack");
	return state;
}
function craft(state: GameState, modelId: string) {
	expect(craftGear(state, modelId).ok).toBe(true);
	return state.gearItems.at(-1)!;
}

describe("physical armor, helmets and backpacks", () => {
	test("all sixteen models use existing permanent recipes and exact, non-profitable craft costs", () => {
		expect(GEAR_MODELS).toHaveLength(16);
		for (const model of GEAR_MODELS) {
			const state = supplied(), money = state.money, scrap = state.supplies.scrap;
			const item = craft(state, model.id);
			expect(state.money).toBe(money - model.money);
			expect(state.supplies.scrap).toBe(scrap - model.scrap);
			expect(getGearRecycleYield(item)).toBeLessThan(model.scrap);
			expect(equipGear(state, state.scavs[0]!.id, model.slot, item.id).ok).toBe(true);
			expect(parseSave(saveGame(state))).toEqual(state);
			state.blueprints = state.blueprints.filter((id) => id !== model.blueprint);
			const saved = saveGame(state);
			expect(craftGear(state, model.id).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
	});

	test("a helmet equips independently, changes real protection and weight, and never creates a permanent helmet level", () => {
		const state = supplied(), scav = state.scavs[0]!;
		const armor = craft(state, "heavy_armor"), helmet = craft(state, "visor_helmet"), pack = craft(state, "frame_pack");
		expect(equipGear(state, scav.id, "armor", armor.id).ok).toBe(true);
		expect(equipGear(state, scav.id, "backpack", pack.id).ok).toBe(true);
		const before = getLoadoutStats(state, scav), quote = getRaidQuote(state, scav, MAPS[1]!);
		expect(equipGear(state, scav.id, "helmet", helmet.id).ok).toBe(true);
		const after = getLoadoutStats(state, scav), helmetQuote = getRaidQuote(state, scav, MAPS[1]!);
		expect(after.weight - before.weight).toBeCloseTo(3.5);
		expect(after.protection - before.protection).toBeCloseTo(0.07);
		expect(after.capacity).toBe(before.capacity);
		expect(helmetQuote.duration).toBeGreaterThan(quote.duration);
		expect(helmetQuote.chance).toBeGreaterThanOrEqual(quote.chance);
		expect(helmetQuote.chance).toBeLessThanOrEqual(0.97);
		helmet.durability = 0;
		expect(getLoadoutStats(state, scav).protection).toBe(before.protection);
		expect(getLoadoutStats(state, scav).weight).toBe(after.weight);
		expect(equipGear(state, scav.id, "helmet", null).ok).toBe(true);
		expect(scav.loadout.armorItemId).toBe(armor.id);
		expect(scav.loadout.backpackItemId).toBe(pack.id);
		const saved = saveGame(state);
		expect(upgradeScavGear(state, scav.id, "helmet" as never).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expect(Object.keys(scav.gear).sort()).toEqual(["armor", "backpack"]);
	});

	test("a shared helmet transfers its one owner and is locked throughout an active expedition", () => {
		const state = supplied(), first = state.scavs[0]!, second = state.scavs[1]!;
		const helmet = craft(state, "kevlar_helmet"), armor = craft(state, "patrol_armor");
		expect(equipGear(state, first.id, "helmet", helmet.id).ok).toBe(true);
		expect(equipGear(state, second.id, "helmet", helmet.id).ok).toBe(true);
		expect(first.loadout.helmetItemId).toBeNull();
		expect(second.loadout.helmetItemId).toBe(helmet.id);
		const wrong = saveGame(state);
		expect(equipGear(state, first.id, "armor", helmet.id).ok).toBe(false);
		expect(equipGear(state, first.id, "helmet", armor.id).ok).toBe(false);
		expect(saveGame(state)).toBe(wrong);
		expect(dispatchRaid(state, second.id, "courtyard", NOW).ok).toBe(true);
		expect(state.raids[0]!.expedition!.loadout.helmetModelId).toBe("kevlar_helmet");
		expect(state.raids[0]!.expedition!.loadout.helmetCondition).toBe(100);
		const locked = saveGame(state);
		expect(equipGear(state, first.id, "helmet", helmet.id).ok).toBe(false);
		expect(equipGear(state, second.id, "helmet", null).ok).toBe(false);
		expect(repairGear(state, helmet.id).ok).toBe(false);
		expect(recycleGear(state, helmet.id).ok).toBe(false);
		expect(saveGame(state)).toBe(locked);
		expect(parseSave(locked)).toEqual(state);
	});

	test("helmets wear at checkpoints and protect only their covered zone, while repair and recycling consume real inventory", () => {
		const armored = supplied(), scav = armored.scavs[0]!;
		const helmet = craft(armored, "visor_helmet");
		expect(equipGear(armored, scav.id, "helmet", helmet.id).ok).toBe(true);
		expect(dispatchRaid(armored, scav.id, "courtyard", NOW).ok).toBe(true);
		const unarmored = structuredClone(armored), raid = armored.raids[0]!, controlRaid = unarmored.raids[0]!;
		unarmored.scavs[0]!.loadout.helmetItemId = null;
		controlRaid.expedition!.loadout.helmetModelId = null;
		controlRaid.expedition!.loadout.helmetCondition = 0;
		controlRaid.expedition!.medical!.start.helmetProtection = 0;
		raid.chance = controlRaid.chance = 1;
		advance(armored, raid.endsAt); advance(unarmored, controlRaid.endsAt);
		expect(helmet.durability).toBeLessThan(100);
		expect(raid.expedition!.medical!.start.helmetProtection).toBeGreaterThan(0);
		expect(scav.body!.parts.head.hp).toBe(35);
		expect(scav.health).toBe(unarmored.scavs[0]!.health);
		expect(raid.expedition!.loadout.helmetCondition).toBe(100);
		expect(parseSave(saveGame(armored))).not.toBeNull();
		expect(extractRaid(armored, raid.id, armored.lastUpdated).ok).toBe(true);
		const cost = getGearRepairCost(helmet);
		armored.supplies.scrap = cost.scrap - 1;
		const poor = saveGame(armored);
		expect(repairGear(armored, helmet.id).ok).toBe(false);
		expect(saveGame(armored)).toBe(poor);
		armored.supplies.scrap = cost.scrap;
		const money = armored.money;
		expect(repairGear(armored, helmet.id).ok).toBe(true);
		expect(helmet.durability).toBe(100);
		expect(armored.money).toBe(money - cost.money);
		expect(armored.supplies.scrap).toBe(0);
		expect(recycleGear(armored, helmet.id).ok).toBe(true);
		expect(scav.loadout.helmetItemId).toBeNull();
		expect(parseSave(saveGame(armored))).not.toBeNull();
	});

	test("old version-six saves and legacy version-three active raids load without an invented helmet", () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const old = JSON.parse(saveGame(state));
		for (const scav of old.scavs) delete scav.loadout.helmetItemId;
		delete old.raids[0].expedition.loadout.helmetModelId;
		delete old.raids[0].expedition.loadout.helmetCondition;
		const migrated = parseSave(JSON.stringify(old))!;
		expect(migrated).not.toBeNull();
		expect(migrated.schemaVersion).toBe(SAVE_VERSION);
		for (const scav of migrated.scavs) expect(scav.loadout.helmetItemId).toBeNull();
		expect(migrated.raids[0]!.expedition!.loadout.helmetModelId).toBeNull();
		expect(migrated.raids[0]!.expedition!.loadout.helmetCondition).toBe(0);
		expect(migrated.raids[0]!.chance).toBe(state.raids[0]!.chance);
		expect(migrated.rng).toBe(state.rng);
		const v3 = parseSave(readFileSync(new URL("./fixtures/legacy-v3-expedition.json", import.meta.url), "utf8"))!;
		expect(v3).not.toBeNull();
		expect(v3.scavs[0]!.loadout.helmetItemId).toBeNull();
		expect(v3.raids[0]!.expedition!.loadout.helmetModelId).toBeNull();
		expect(parseSave(saveGame(v3))).toEqual(v3);
	});

	test("save imports reject wrong slots, duplicate helmet owners and forged frozen helmet snapshots", () => {
		const state = supplied(), scav = state.scavs[0]!;
		const helmet = craft(state, "steel_helmet"), armor = craft(state, "padded_vest");
		expect(equipGear(state, scav.id, "helmet", helmet.id).ok).toBe(true);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		const mutations: ((value: ReturnType<typeof JSON.parse>) => void)[] = [
			(value) => { value.scavs[0].loadout.helmetItemId = 5; },
			(value) => { value.scavs[0].loadout.helmetItemId = armor.id; },
			(value) => { value.scavs[1].loadout.helmetItemId = helmet.id; },
			(value) => { value.scavs[0].loadout.armorItemId = helmet.id; },
			(value) => { value.raids[0].expedition.loadout.helmetModelId = "kevlar_helmet"; },
			(value) => { value.raids[0].expedition.loadout.helmetModelId = "padded_vest"; },
			(value) => { value.raids[0].expedition.loadout.helmetModelId = null; },
			(value) => { value.raids[0].expedition.loadout.helmetCondition = 101; },
			(value) => { value.raids[0].expedition.loadout.helmetCondition = -1; },
		];
		for (const mutate of mutations) {
			const value = JSON.parse(saveGame(state)); mutate(value);
			expect(parseSave(JSON.stringify(value))).toBeNull();
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a full frame pack with permanent carrying upgrades survives expedition save validation", () => {
		const state = supplied(), scav = state.scavs[0]!;
		const pack = craft(state, "frame_pack");
		expect(equipGear(state, scav.id, "backpack", pack.id).ok).toBe(true);
		for (let level = 0; level < 3; level++) expect(upgradeScavGear(state, scav.id, "backpack").ok).toBe(true);
		expect(getLoadoutStats(state, scav).capacity).toBe(42);
		expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
		expect(state.raids[0]!.expedition!.capacity).toBe(42);
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});
