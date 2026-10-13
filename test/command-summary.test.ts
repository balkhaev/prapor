import { describe, expect, test } from "bun:test";
import { getCommandSummary } from "../src/command-summary";
import {
	advance, assignWorker, buildRoom, createGame, craftModule, dispatchRaid, getModuleCapacity,
	getBuildRoomQuote, getResourceProductionQuote, getRoomProductionState,
	getRoomUpgradeQuote, getSupplyCapacity, queueModuleProduction,
	saveGame, sellModule, setRoomRecipe, setRoomStockTarget, setProductionReserve, ensureShelterLogistics, upgradeRoom, type GameState, type RoomInstance,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;

function funded(): GameState {
	const state = createGame(NOW);
	state.money = 20_000;
	state.supplies = { ammo: 40, medicine: 0, scrap: 80, intel: 0 };
	return state;
}
function room(state: GameState, type: RoomInstance["type"]) {
	return state.shelter.rooms.find((item) => item.type === type)!;
}
function status(state: GameState, target: RoomInstance) {
	const result = getCommandSummary(state).rooms.find((item) => item.roomId === target.id);
	expect(result).toBeDefined();
	return result!;
}
function build(state: GameState, type: RoomInstance["type"], column: number, row: number) {
	const quote = getBuildRoomQuote(state, type, column, row);
	expect(quote.reason).toBeNull();
	expect(buildRoom(state, type, column, row, state.lastUpdated).ok).toBe(true);
	advance(state, state.lastUpdated + quote.duration * 1000);
	return state.shelter.rooms.find((item) => item.column === column && item.row === row)!;
}

describe("command next-step projection", () => {
	test("a completed stocking plan remains quiet after its worker leaves for a raid", () => {
		const state = funded(), medbay = room(state, "medbay"), worker = state.scavs[1]!;
		state.supplies.medicine = getSupplyCapacity(state).medicine;
		expect(assignWorker(state, worker.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		expect(setRoomStockTarget(state, medbay.id, state.supplies.medicine, NOW).ok).toBe(true);
		expect(assignWorker(state, worker.id, null, NOW).ok).toBe(true);
		const saved = saveGame(state), summary = getCommandSummary(state);
		expect(status(state, medbay)).toMatchObject({ kind: "ready", title: "Запас по плану", cta: null });
		expect(summary.attention.some(item => item.roomId === medbay.id)).toBe(false);
		expect(saveGame(state)).toBe(saved);
	});

	test("a protected reserve and a full kit shelf describe the actual reason for waiting", () => {
		const state = funded(), workshop = room(state, "workshop");
		expect(assignWorker(state, state.scavs[0]!.id, workshop.id, NOW).ok).toBe(true);
		expect(setProductionReserve(state, { money: state.money, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 } }, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, workshop.id, "maintenance-kit", true, NOW).ok).toBe(true);
		expect(status(state, workshop)).toMatchObject({ kind: "ready", title: "Резерв сохранён" });
		expect(workshop.queue).toHaveLength(0);
		expect(setProductionReserve(state, { money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 } }, NOW).ok).toBe(true);
		expect(workshop.queue).toHaveLength(1);
		ensureShelterLogistics(state).kits.maintenance = 8;
		advance(state, NOW + 120_000);
		expect(status(state, workshop)).toMatchObject({ kind: "capacity", title: "Готовая партия ждёт места" });
		expect(workshop.queue[0]!.workDone).toBe(workshop.queue[0]!.workRequired);
	});

	test("repeated projections do not advance orders, reorder ownership or change paid work", () => {
		const state = funded(), workshop = room(state, "workshop");
		expect(queueModuleProduction(state, workshop.id, "optic-reflex", NOW).ok).toBe(true);
		state.scavs[0]!.autoRaid.enabled = true;
		state.shelter.rooms.reverse();
		const saved = saveGame(state), expected = getCommandSummary(state);
		for (let frame = 0; frame < 60; frame++) expect(getCommandSummary(state)).toEqual(expected);
		expect(saveGame(state)).toBe(saved);
		expect(state.raids).toHaveLength(0);
		expect(workshop.queue).toHaveLength(1);
		expect(expected.queuedJobs).toBe(1);
		expect(expected.attention[0]?.roomId).toBe(workshop.id);
		expect(expected.attention[0]?.kind).toBe("workers");
		expect(expected.attention[0]?.tab).toBe("staff");
	});

	test("completed paid output outranks staffing and optional rooms while retaining the exact producing room", () => {
		const state = funded(), medbay = room(state, "medbay"), worker = state.scavs[1]!;
		expect(assignWorker(state, worker.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, NOW).ok).toBe(true);
		const job = medbay.queue[0]!;
		state.supplies.medicine = getSupplyCapacity(state).medicine;
		advance(state, NOW + 1000);
		expect(status(state, medbay).kind).toBe("running");
		const finishesAt = state.lastUpdated + Math.ceil(getRoomProductionState(state, medbay).remainingSeconds! * 1000);
		advance(state, finishesAt);
		expect(job.workDone).toBe(job.workRequired);
		expect(assignWorker(state, worker.id, null, finishesAt).ok).toBe(true);
		const saved = saveGame(state), summary = getCommandSummary(state);
		const first = summary.attention[0]!;
		expect(first.roomId).toBe(medbay.id);
		expect(first.kind).toBe("capacity");
		expect(first.tab).toBe("production");
		expect(first.detail).toBe(getRoomProductionState(state, medbay).reason!);
		expect(first.progress).toBe(1);
		expect(medbay.workerIds).toHaveLength(0);
		expect(medbay.queue[0]).toBe(job);
		expect(summary.queuedJobs).toBe(1);
		expect(saveGame(state)).toBe(saved);
	});

	test("missing or injured staff routes paid queues to people without calling them empty orders", () => {
		const state = funded(), workshop = room(state, "workshop"), worker = state.scavs[0]!;
		expect(assignWorker(state, worker.id, workshop.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, workshop.id, "optic-reflex", NOW).ok).toBe(true);
		advance(state, NOW + 1000);
		const paid = structuredClone(workshop.queue[0]);
		worker.health = 24;
		worker.status = "wounded";
		const injured = status(state, workshop);
		expect(injured.kind).toBe("workers");
		expect(injured.tab).toBe("staff");
		expect(injured.detail).toBe(getRoomProductionState(state, workshop).reason!);
		expect(workshop.queue[0]).toEqual(paid);
		worker.health = 25;
		worker.status = "ready";
		expect(status(state, workshop).kind).toBe("running");
		expect(workshop.queue[0]).toEqual(paid);
	});

	test("physical module output becomes ready after a real stock sale without demanding a worker or minting the part in preview", () => {
		const state = funded(), workshop = room(state, "workshop"), worker = state.scavs[0]!;
		state.supplies.scrap = 10_000;
		expect(assignWorker(state, worker.id, workshop.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, workshop.id, "optic-reflex", NOW).ok).toBe(true);
		while (state.modules.length < getModuleCapacity(state)) expect(craftModule(state, "optic-reflex").ok).toBe(true);
		const finishesAt = NOW + Math.ceil(getRoomProductionState(state, workshop).remainingSeconds! * 1000);
		advance(state, finishesAt);
		const job = workshop.queue[0]!;
		expect(job.workDone).toBe(job.workRequired);
		expect(assignWorker(state, worker.id, null, finishesAt).ok).toBe(true);
		expect(status(state, workshop)).toMatchObject({ kind: "capacity", tab: "production" });
		expect(sellModule(state, state.modules[0]!.id).ok).toBe(true);
		const saved = saveGame(state), available = state.modules.length;
		const ready = status(state, workshop);
		expect(ready.kind).toBe("ready");
		expect(ready.cta).toBeNull();
		expect(ready.progress).toBe(1);
		expect(workshop.workerIds).toHaveLength(0);
		expect(workshop.queue[0]).toBe(job);
		expect(state.modules).toHaveLength(available);
		expect(saveGame(state)).toBe(saved);
		advance(state, finishesAt);
		expect(workshop.queue).toHaveLength(0);
		expect(state.modules).toHaveLength(available + 1);
	});

	test("an enabled recipe short on actual inputs reports the real quote rather than asking for another order", () => {
		const state = funded(), medbay = room(state, "medbay");
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		state.money = 0;
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		expect(medbay.queue).toHaveLength(0);
		const moneyShort = status(state, medbay);
		expect(moneyShort.kind).toBe("resources");
		expect(moneyShort.tab).toBe("production");
		expect(moneyShort.detail).toBe(getResourceProductionQuote(state, medbay.id, "medicine-batch").reason!);
		state.money = 20_000;
		state.supplies.scrap = 0;
		const materialsShort = status(state, medbay);
		expect(materialsShort.kind).toBe("resources");
		expect(materialsShort.detail).toBe(getResourceProductionQuote(state, medbay.id, "medicine-batch").reason!);
	});

	test("a completed one-shot recipe is an order choice even when its saved quote becomes unaffordable", () => {
		const state = funded(), medbay = room(state, "medbay");
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, NOW).ok).toBe(true);
		const finishesAt = NOW + Math.ceil(getRoomProductionState(state, medbay).remainingSeconds! * 1000);
		advance(state, finishesAt);
		expect(medbay.queue).toHaveLength(0);
		expect(medbay.recipeId).toBe("medicine-batch");
		expect(medbay.pending).toBe(false);
		expect(medbay.repeat).toBe(false);
		state.money = 0;
		state.supplies.scrap = 0;
		expect(getResourceProductionQuote(state, medbay.id, "medicine-batch").reason).not.toBeNull();
		expect(status(state, medbay)).toMatchObject({ kind: "order", tab: "production" });
		expect(status(state, medbay).cta).not.toBeNull();
	});

	test("full capacity before reservation is distinguished from missing inputs without reserving anything", () => {
		const state = funded(), medbay = room(state, "medbay");
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		state.supplies.medicine = getSupplyCapacity(state).medicine;
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		expect(medbay.queue).toHaveLength(0);
		const saved = saveGame(state), projection = status(state, medbay);
		expect(projection.kind).toBe("capacity");
		expect(projection.tab).toBe("production");
		expect(projection.detail).toBe(getResourceProductionQuote(state, medbay.id, "medicine-batch").reason!);
		expect(projection.detail).toContain("Материалы ещё не списаны");
		expect(projection.progress).toBe(0);
		expect(saveGame(state)).toBe(saved);
	});

	test("duplicate room types keep their own action targets and physical ordering is stable", () => {
		const state = funded(), first = room(state, "workshop");
		const second = build(state, "workshop", 0, 1);
		expect(queueModuleProduction(state, second.id, "optic-reflex", state.lastUpdated).ok).toBe(true);
		const expected = getCommandSummary(state);
		expect(expected.attention[0]?.roomId).toBe(second.id);
		expect(expected.attention[0]?.tab).toBe("staff");
		expect(expected.rooms.filter((item) => item.roomId === first.id || item.roomId === second.id)).toHaveLength(2);
		state.shelter.rooms.reverse();
		const saved = saveGame(state);
		expect(getCommandSummary(state)).toEqual(expected);
		expect(saveGame(state)).toBe(saved);
		const optionalRooms = expected.attention.filter((item) => item.roomId !== second.id);
		expect(optionalRooms.map((item) => item.roomId)).toEqual([first.id, room(state, "medbay").id, room(state, "radio").id]);
	});

	test("construction takes precedence while keeping every paid queued job and its progress", () => {
		const state = funded(), workshop = room(state, "workshop");
		expect(assignWorker(state, state.scavs[0]!.id, workshop.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, workshop.id, "optic-reflex", NOW).ok).toBe(true);
		advance(state, NOW + 1000);
		const paid = structuredClone(workshop.queue[0]), quote = getRoomUpgradeQuote(state, workshop.id);
		expect(upgradeRoom(state, workshop.id, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + quote.duration * 500);
		const saved = saveGame(state), summary = getCommandSummary(state), projected = status(state, workshop);
		expect(projected.kind).toBe("building");
		expect(projected.tab).toBe("upgrade");
		expect(projected.progress).toBeGreaterThan(0);
		expect(projected.progress).toBeLessThan(1);
		expect(projected.remainingSeconds).toBeGreaterThan(0);
		expect(summary.attention.some((item) => item.roomId === workshop.id)).toBe(false);
		expect(summary.counts.building).toBe(1);
		expect(summary.queuedJobs).toBe(1);
		expect(workshop.queue[0]).toEqual(paid);
		expect(saveGame(state)).toBe(saved);
	});

	test("passive rooms never ask for employees and free workforce follows real assignment, health and raid availability", () => {
		const state = funded(), storage = room(state, "storage"), medbay = room(state, "medbay");
		const initial = getCommandSummary(state);
		expect(status(state, storage)).toMatchObject({ kind: "passive", cta: null });
		expect(initial.attention.some((item) => item.roomId === storage.id)).toBe(false);
		expect(initial.freeWorkers).toBe(3);
		expect(Object.values(initial.counts).reduce((sum, amount) => sum + amount, 0)).toBe(state.shelter.rooms.length);
		expect(assignWorker(state, state.scavs[0]!.id, medbay.id, NOW).ok).toBe(true);
		state.scavs[1]!.health = 24;
		state.scavs[1]!.status = "wounded";
		expect(dispatchRaid(state, state.scavs[2]!.id, "courtyard", NOW).ok).toBe(true);
		expect(getCommandSummary(state).freeWorkers).toBe(0);
		state.scavs[1]!.health = 25;
		state.scavs[1]!.status = "ready";
		expect(getCommandSummary(state).freeWorkers).toBe(1);
	});
});
