import { describe, expect, test } from "bun:test";
import { advance, assignWorker, cancelProduction, createGame, getFieldKitStock, getProductionRecipe, getResourceProductionQuote, getSupplyCapacity, LEGACY_RESOURCE_RECIPES_V24, parseSave, queueModuleProduction, RESOURCE_RECIPE_BY_ID, saveGame, setRoomRecipe, type GameState } from "../src/game/engine";

const NOW = 1_792_000_000_000;
const IDS = ["intel-from-loot", "medicine-from-antibiotics", "maintenance-from-sewing"];
function prepare(recipeId: string) {
	const state = createGame(NOW); state.money = 5000; state.supplies = { ammo: 0, medicine: 0, scrap: 20, intel: 0 };
	const recipe = RESOURCE_RECIPE_BY_ID[recipeId]!, room = state.shelter.rooms.find(room => room.type === recipe.roomType)!;
	for (const value of recipe.lootRequirements ?? []) for (let count = 0; count < value.quantity; count++) (state.lootItems ??= []).push({ id: `loot-${state.nextId++}`, modelId: value.modelId, foundAt: NOW });
	expect(assignWorker(state, state.scavs[0]!.id, room.id, NOW).ok).toBe(true);
	return { state, room, recipe };
}
function paidLegacy(recipeId: string) {
	const value = prepare(recipeId); expect(setRoomRecipe(value.state, value.room.id, recipeId, false, NOW).ok).toBe(true);
	value.room.queue[0]!.output.supplies = structuredClone(LEGACY_RESOURCE_RECIPES_V24[recipeId]!.output);
	value.state.schemaVersion = 24; return value;
}
function valid(state: GameState) { expect(parseSave(saveGame(state))).toEqual(state); }

describe("v25 resource rewards and paid recipe revisions", () => {
	test("the same three catalogue IDs now make nine intel, six medicine, or a kit with usable leftovers", () => {
		expect(RESOURCE_RECIPE_BY_ID[IDS[0]!]!.output.intel).toBe(9); expect(RESOURCE_RECIPE_BY_ID[IDS[1]!]!.output.medicine).toBe(6);
		expect(RESOURCE_RECIPE_BY_ID[IDS[2]!]!.output).toEqual({ ammo: 0, medicine: 1, scrap: 1, intel: 0 });
		for (const id of IDS) {
			const { state, room, recipe } = prepare(id); expect(setRoomRecipe(state, room.id, id, false, NOW).ok).toBe(true);
			expect(room.queue[0]!.recipeVersion).toBeUndefined(); valid(state);
			const output = structuredClone(room.queue[0]!.output); room.queue[0]!.workDone = room.queue[0]!.workRequired;
			const supplies = structuredClone(state.supplies); advance(state, NOW);
			expect(room.queue).toEqual([]); expect(room.cycles).toBe(1);
			for (const key of ["ammo", "medicine", "scrap", "intel"] as const) expect(state.supplies[key] - supplies[key]).toBe(output.supplies[key]);
			if (recipe.outputKit) expect(getFieldKitStock(state)[recipe.outputKit]).toBe(1); valid(state);
		}
	});
	test("v24 paid snapshots gain only the narrow legacy tag and preserve progress, IDs, payment and exact output across reloads", () => {
		for (const id of IDS) {
			const { state, room } = paidLegacy(id); advance(state, NOW + 1000);
			const before = structuredClone(room.queue[0]!); expect(before.recipeVersion).toBeUndefined();
			const restored = parseSave(saveGame(state))!; expect(restored).not.toBeNull();
			const job = restored.shelter.rooms.find(value => value.id === room.id)!.queue[0]!;
			expect(job).toEqual({ ...before, recipeVersion: 24 }); expect(restored.money).toBe(state.money); expect(restored.nextId).toBe(state.nextId); expect(restored.lootItems).toEqual(state.lootItems);
			valid(restored); const reload = parseSave(saveGame(restored))!; expect(reload).toEqual(restored);
			const target = reload.shelter.rooms.find(value => value.id === room.id)!, saved = target.queue[0]!;
			const supplies = structuredClone(reload.supplies), money = reload.money;
			saved.workDone = saved.workRequired; advance(reload, reload.lastUpdated);
			for (const key of ["ammo", "medicine", "scrap", "intel"] as const) expect(reload.supplies[key] - supplies[key]).toBe(before.output.supplies[key]);
			expect(reload.money).toBe(money); expect(target.queue).toEqual([]); expect(target.cycles).toBe(1); valid(reload);
		}
	});
	test("old paid quantities can finish where the larger current recipe cannot fit", () => {
		const { state, room } = paidLegacy("intel-from-loot"); state.supplies.intel = getSupplyCapacity(state).intel - 6;
		room.queue[0]!.workDone = room.queue[0]!.workRequired;
		const restored = parseSave(saveGame(state))!; advance(restored, NOW);
		expect(restored.supplies.intel).toBe(getSupplyCapacity(restored).intel); expect(restored.shelter.rooms.find(value => value.id === room.id)!.queue).toEqual([]); valid(restored);
		const sewing = paidLegacy("maintenance-from-sewing"); sewing.state.supplies.medicine = getSupplyCapacity(sewing.state).medicine;
		sewing.room.queue[0]!.workDone = sewing.room.queue[0]!.workRequired;
		const oldKit = parseSave(saveGame(sewing.state))!; advance(oldKit, NOW); expect(getFieldKitStock(oldKit).maintenance).toBe(1); expect(oldKit.supplies.medicine).toBe(getSupplyCapacity(oldKit).medicine); valid(oldKit);
	});
	test("a new sewing order checks all companion outputs before payment and before its atomic delivery", () => {
		const { state, room } = prepare("maintenance-from-sewing"), items = structuredClone(state.lootItems), money = state.money;
		state.supplies.medicine = getSupplyCapacity(state).medicine;
		expect(getResourceProductionQuote(state, room.id, "maintenance-from-sewing").reason).not.toBeNull(); expect(setRoomRecipe(state, room.id, "maintenance-from-sewing", false, NOW).ok).toBe(true);
		expect(state.lootItems).toEqual(items); expect(state.money).toBe(money); expect(room.queue).toEqual([]);
		state.supplies.medicine--; advance(state, NOW); expect(room.queue).toHaveLength(1); expect(state.lootItems).toEqual([]); expect(state.money).toBe(money - 8);
		room.queue[0]!.workDone = room.queue[0]!.workRequired; state.supplies.medicine++; const scrap = state.supplies.scrap;
		advance(state, NOW); expect(getFieldKitStock(state).maintenance).toBe(0); expect(state.supplies.scrap).toBe(scrap); expect(room.queue).toHaveLength(1);
		state.supplies.medicine--; advance(state, NOW); expect(getFieldKitStock(state).maintenance).toBe(1); expect(state.supplies.scrap).toBe(scrap + 1); expect(room.queue).toEqual([]); valid(state);
	});
	test("legacy cancellation keeps the original refund and consumes no future replacement components", () => {
		const { state, room } = paidLegacy("maintenance-from-sewing"), restored = parseSave(saveGame(state))!, paid = restored.shelter.rooms.find(value => value.id === room.id)!.queue[0]!;
		const money = restored.money; expect(cancelProduction(restored, room.id, paid.id, NOW).ok).toBe(true); expect(restored.money).toBe(money + 8); expect(restored.lootItems).toEqual([]); expect(getFieldKitStock(restored).maintenance).toBe(0); valid(restored);
	});
	test("a migrated repeat honours its paid output first and starts only one current order after enough space opens", () => {
		const { state, room } = paidLegacy("intel-from-loot"); room.repeat = true; room.queue[0]!.workDone = room.queue[0]!.workRequired;
		const nextInput = { id: `loot-${state.nextId++}`, modelId: "patrol-log", foundAt: NOW }; state.lootItems!.push(nextInput);
		const migrated = parseSave(saveGame(state))!, target = migrated.shelter.rooms.find(value => value.id === room.id)!;
		advance(migrated, NOW); expect(migrated.supplies.intel).toBe(6); expect(target.queue).toEqual([]); expect(migrated.lootItems).toEqual([nextInput]);
		migrated.supplies.intel = 3; const money = migrated.money; advance(migrated, NOW);
		expect(target.queue).toHaveLength(1); expect(target.queue[0]!.recipeVersion).toBeUndefined(); expect(target.queue[0]!.output.supplies.intel).toBe(9);
		expect(migrated.money).toBe(money - 10); expect(migrated.lootItems).toEqual([]); const paid = saveGame(migrated); advance(migrated, NOW); expect(saveGame(migrated)).toBe(paid); valid(migrated);
	});
	test("invalid revisions, tags on unaffected recipes, future outputs and changed paid snapshots reject", () => {
		const { state, room } = prepare("intel-from-loot"); expect(setRoomRecipe(state, room.id, "intel-from-loot", false, NOW).ok).toBe(true);
		const raw = JSON.parse(saveGame(state));
		for (const revision of [23, 25, 24.5, "24"]) { const altered = structuredClone(raw); altered.shelter.rooms.find((value: { id: string }) => value.id === room.id).queue[0].recipeVersion = revision; expect(parseSave(JSON.stringify(altered))).toBeNull(); }
		const currentTagged = structuredClone(raw); currentTagged.shelter.rooms.find((value: { id: string }) => value.id === room.id).queue[0].recipeVersion = 24; expect(parseSave(JSON.stringify(currentTagged))).toBeNull();
		const oldNewOutput = structuredClone(raw); oldNewOutput.schemaVersion = 24; expect(parseSave(JSON.stringify(oldNewOutput))).toBeNull();
		const legacy = paidLegacy("intel-from-loot"), saved = parseSave(saveGame(legacy.state))!; saved.shelter.rooms.find(value => value.id === legacy.room.id)!.queue[0]!.paid.money++; expect(parseSave(saveGame(saved))).toBeNull();
		const other = prepare("maintenance-kit"); expect(setRoomRecipe(other.state, other.room.id, "maintenance-kit", false, NOW).ok).toBe(true); other.room.queue[0]!.recipeVersion = 24; expect(parseSave(saveGame(other.state))).toBeNull();
		const module = createGame(NOW); expect(queueModuleProduction(module, "room-workshop", "factory-sks-stock", NOW).ok).toBe(true); module.shelter.rooms[0]!.queue[0]!.recipeVersion = 24; expect(parseSave(saveGame(module))).toBeNull();
		expect(Object.isFrozen(LEGACY_RESOURCE_RECIPES_V24)).toBe(true); expect(Object.isFrozen(getProductionRecipe("intel-from-loot", 24)!.output)).toBe(true);
	});
});
