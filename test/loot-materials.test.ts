import { describe, expect, test } from "bun:test";
import { FIELD_KIT_CAPACITY } from "../src/game/shelter-logistics";
import { advance, assignWorker, buildRoom, cancelProduction, createGame, getBuildRoomQuote, getFieldKitStock, getLootRequirementQuote, getLootUses, getResourceProductionQuote, getSupplyCapacity, moveRoom, parseSave, receiveTradeAsset, RESOURCE_RECIPES, ROOM_DEFINITIONS, saveGame, setProductionReserve, setRoomRecipe, setRoomStockTarget, upgradeRoom, type GameState, type LootRequirement, type ShelterRoomType } from "../src/game/engine";

const NOW = 1_792_000_000_000;
function fresh() { const state = createGame(NOW); state.money = 5000; state.supplies.scrap = 40; state.supplies.ammo = 0; state.supplies.intel = 0; return state; }
function add(state: GameState, requirements: readonly LootRequirement[] = []) {
	return requirements.flatMap(value => Array.from({ length: value.quantity }, () => { const item = { id: `loot-${state.nextId++}`, modelId: value.modelId, foundAt: state.lastUpdated }; (state.lootItems ??= []).push(item); return item; }));
}
function valid(state: GameState) { expect(parseSave(saveGame(state))).toEqual(state); }
function prepareProduction(id: string) {
	const state = fresh(), recipe = RESOURCE_RECIPES.find(value => value.id === id)!;
	let room = state.shelter.rooms.find(value => value.type === recipe.roomType);
	if (!room) {
		add(state, ROOM_DEFINITIONS[recipe.roomType].lootRequirements); expect(buildRoom(state, recipe.roomType, 0, 1, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + ROOM_DEFINITIONS[recipe.roomType].buildSeconds * 1000); room = state.shelter.rooms.find(value => value.type === recipe.roomType)!;
	}
	expect(assignWorker(state, state.scavs[0]!.id, room.id, state.lastUpdated).ok).toBe(true);
	return { state, recipe, room };
}
const newRecipes = RESOURCE_RECIPES.filter(recipe => recipe.lootRequirements);

describe("intact raid loot as shelter materials", () => {
	test("all new construction quotes require exact physical components before spending", () => {
		for (const type of Object.keys(ROOM_DEFINITIONS) as ShelterRoomType[]) {
			const state = fresh(); if (type === "hangar") { state.level = 4; state.xp = 810; }
			const before = saveGame(state), empty = getBuildRoomQuote(state, type, 0, 1);
			expect(empty.lootRequirements.length).toBeGreaterThan(0); expect(empty.reason).toContain("трофеи");
			expect(buildRoom(state, type, 0, 1, state.lastUpdated).ok).toBe(false); expect(saveGame(state)).toBe(before);
			const items = add(state, ROOM_DEFINITIONS[type].lootRequirements), quote = getBuildRoomQuote(state, type, 0, 1);
			expect(quote.reason).toBeNull(); expect(quote.lootItemIds.length).toBe(items.length);
			expect(buildRoom(state, type, 0, 1, state.lastUpdated).ok).toBe(true);
			const built = state.shelter.rooms.at(-1)!; expect(built.construction!.paidLoot).toEqual(items); expect(state.lootItems).toEqual([]); valid(state);
			advance(state, state.lastUpdated + quote.duration * 1000); expect(built.status).toBe("ready"); valid(state);
		}
	});
	test("foundation, upgrades, moving and pre-v21 paid construction need no additional components", () => {
		const state = fresh(), foundation = state.shelter.rooms[0]!;
		expect(state.lootItems).toBeUndefined(); expect(upgradeRoom(state, foundation.id, NOW).ok).toBe(true); advance(state, NOW + 70_000);
		expect(moveRoom(state, foundation.id, 3, 1, state.lastUpdated).ok).toBe(true); expect(state.lootItems).toBeUndefined(); valid(state);
		add(state, ROOM_DEFINITIONS.ammo.lootRequirements); expect(buildRoom(state, "ammo", 0, 1, state.lastUpdated).ok).toBe(true);
		delete state.shelter.rooms.at(-1)!.construction!.paidLoot; state.schemaVersion = 20;
		const migrated = parseSave(saveGame(state))!; expect(migrated).not.toBeNull(); advance(migrated, migrated.lastUpdated + 60_000); expect(migrated.shelter.rooms.at(-1)!.status).toBe("ready"); valid(migrated);
	});
	test("four alternate recipes pay their exact owned objects once and deliver their real outputs", () => {
		expect(newRecipes).toHaveLength(4);
		for (const { id } of newRecipes) {
			const { state, recipe, room } = prepareProduction(id), items = add(state, recipe.lootRequirements), money = state.money;
			const quote = getResourceProductionQuote(state, room.id, id); expect(quote.reason).toBeNull();
			expect(setRoomRecipe(state, room.id, id, false, state.lastUpdated).ok).toBe(true); expect(room.queue[0]!.paidLoot).toEqual(items);
			expect(state.money).toBe(money - recipe.cost.money); expect(state.lootItems).toEqual([]); valid(state);
			advance(state, state.lastUpdated + 1); expect(state.money).toBe(money - recipe.cost.money); expect(room.queue).toHaveLength(1);
			advance(state, state.lastUpdated + recipe.durationSeconds * 2000); expect(room.cycles).toBe(1); expect(room.queue).toEqual([]);
			if (recipe.outputKit) expect(getFieldKitStock(state)[recipe.outputKit]).toBe(1);
			else for (const [key, output] of Object.entries(recipe.output)) if (output) expect(state.supplies[key as keyof GameState["supplies"]]).toBeGreaterThanOrEqual(output);
			valid(state);
		}
	});
	test("worker, cash reserves, capacity and targets block before any trophy is consumed", () => {
		for (const block of ["worker", "reserve", "capacity", "target"] as const) {
			const { state, recipe, room } = prepareProduction("maintenance-from-loot"), items = add(state, recipe.lootRequirements);
			if (block === "worker") expect(assignWorker(state, state.scavs[0]!.id, null, state.lastUpdated).ok).toBe(true);
			if (block === "reserve") expect(setProductionReserve(state, { money: state.money, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 } }, state.lastUpdated).ok).toBe(true);
			if (block === "capacity") state.shelter.logistics = { reserve: { money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 } }, kits: { maintenance: FIELD_KIT_CAPACITY, trauma: 0 } };
			if (block === "target") { room.recipeId = recipe.id; room.repeat = true; expect(setRoomStockTarget(state, room.id, 0, state.lastUpdated).ok).toBe(true); }
			expect(getResourceProductionQuote(state, room.id, recipe.id).reason).not.toBeNull();
			expect(setRoomRecipe(state, room.id, recipe.id, block === "target", state.lastUpdated).ok).toBe(true);
			expect(room.queue).toEqual([]); expect(state.lootItems).toEqual(items); valid(state);
		}
	});
	test("repeat consumes another batch only when explicitly enabled; cancellation never returns physical inputs", () => {
		const { state, recipe, room } = prepareProduction("maintenance-from-loot"), first = add(state, recipe.lootRequirements), second = add(state, recipe.lootRequirements);
		expect(setRoomRecipe(state, room.id, recipe.id, false, state.lastUpdated).ok).toBe(true); const paid = room.queue[0]!, money = state.money;
		expect(cancelProduction(state, room.id, paid.id, state.lastUpdated).message).toContain("не возвращаются");
		expect(state.money).toBe(money + recipe.cost.money); expect(state.lootItems).toEqual(second); expect(first.every(item => !state.lootItems!.some(value => value.id === item.id))).toBe(true);
		expect(setRoomRecipe(state, room.id, recipe.id, true, state.lastUpdated).ok).toBe(true); expect(state.lootItems).toEqual([]); advance(state, state.lastUpdated + 100_000);
		expect(room.cycles).toBe(1); expect(room.queue).toEqual([]); expect(getResourceProductionQuote(state, room.id, recipe.id).reason).toContain("трофеи"); valid(state);
	});
	test("paid material receipts reject reuse, altered bundles and injection into released jobs", () => {
		const { state, recipe, room } = prepareProduction("maintenance-from-loot"); add(state, recipe.lootRequirements);
		expect(setRoomRecipe(state, room.id, recipe.id, false, state.lastUpdated).ok).toBe(true); valid(state);
		for (const mutate of [
			(value: GameState) => { value.shelter.rooms[0]!.queue[0]!.paidLoot![0]!.modelId = "coffee"; },
			(value: GameState) => { delete value.shelter.rooms[0]!.queue[0]!.paidLoot; },
			(value: GameState) => { value.lootItems!.push(structuredClone(value.shelter.rooms[0]!.queue[0]!.paidLoot![0]!)); },
			(value: GameState) => { value.schemaVersion = 20; },
		]) { const altered = structuredClone(state); mutate(altered); expect(parseSave(saveGame(altered))).toBeNull(); }
		const released = prepareProduction("maintenance-kit"); expect(setRoomRecipe(released.state, released.room.id, "maintenance-kit", false, released.state.lastUpdated).ok).toBe(true);
		released.room.queue[0]!.paidLoot = []; expect(parseSave(saveGame(released.state))).toBeNull();
		advance(state, state.lastUpdated - 10_000); expect(room.queue[0]!.paidLoot!.every(item => item.foundAt === NOW)).toBe(true); valid(state);
	});
	test("pending parcels and unavailable objects do not count toward material quotes, and uses distinguish buildings, crafting and barter", () => {
		const state = fresh(), items = add(state, ROOM_DEFINITIONS.ammo.lootRequirements); state.lootItems = [];
		state.pendingLoot = [{ id: `delivery-${state.nextId++}`, raidId: `raid-${state.nextId++}`, at: NOW, items }];
		expect(getLootRequirementQuote(state, ROOM_DEFINITIONS.ammo.lootRequirements).reason).not.toBeNull(); valid(state);
		expect(new Set(getLootUses("pliers").map(use => use.kind))).toEqual(new Set(["barter", "construction", "production"]));
		expect(getLootUses("__proto__")).toEqual([]); expect(getSupplyCapacity(state).ammo).toBeGreaterThanOrEqual(24);
	});
	test("an escrow cancellation cannot restore a consumed identifier while its paid work is pending", () => {
		const { state, recipe, room } = prepareProduction("maintenance-from-loot"); const inputs = add(state, recipe.lootRequirements);
		expect(setRoomRecipe(state, room.id, recipe.id, false, state.lastUpdated).ok).toBe(true);
		const before = saveGame(state); expect(receiveTradeAsset(state, { kind: "loot", item: inputs[0]! }, state.lastUpdated, false).ok).toBe(false); expect(saveGame(state)).toBe(before);
		const building = fresh(), components = add(building, ROOM_DEFINITIONS.ammo.lootRequirements); expect(buildRoom(building, "ammo", 0, 1, building.lastUpdated).ok).toBe(true);
		const funded = saveGame(building); expect(receiveTradeAsset(building, { kind: "loot", item: components[0]! }, building.lastUpdated, false).ok).toBe(false); expect(saveGame(building)).toBe(funded); valid(state); valid(building);
	});
});
