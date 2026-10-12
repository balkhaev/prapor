import { describe, expect, test } from "bun:test";
import {
	advance,
	assignWorker,
	createGame,
	cancelProduction,
	getRoomProductionState,
	parseSave,
	saveGame,
	setRoomRecipe,
	type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;

function funded(): GameState {
	const state = createGame(NOW);
	state.money = 10_000;
	state.supplies = { ammo: 60, medicine: 0, scrap: 30, intel: 10 };
	return state;
}

describe("shelter action and save boundaries", () => {
	for (const recipeId of [null, "medicine-batch"] as const) test(`stopping ${recipeId === null ? "the recipe" : "repeat only"} at the paid batch completion delivers that batch without purchasing another`, () => {
		const state = funded();
		const medbay = state.shelter.rooms.find((room) => room.type === "medbay")!;
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		const money = state.money;
		const scrap = state.supplies.scrap;
		const atCompletion = NOW + Math.ceil(getRoomProductionState(state, medbay).remainingSeconds! * 1000);
		expect(setRoomRecipe(state, medbay.id, recipeId, false, atCompletion).ok).toBe(true);
		expect(state.supplies.medicine).toBe(3);
		expect(medbay.cycles).toBe(1);
		expect(medbay.queue).toHaveLength(0);
		expect(state.money).toBe(money);
		// Passive scrap production may occur while reaching the boundary; the
		// stop must conserve the paid materials against an otherwise identical
		// one-shot batch, rather than compare unrelated factory income.
		const oneShot = funded();
		const oneShotMedbay = oneShot.shelter.rooms.find((room) => room.type === "medbay")!;
		expect(assignWorker(oneShot, oneShot.scavs[1]!.id, oneShotMedbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(oneShot, oneShotMedbay.id, "medicine-batch", false, NOW).ok).toBe(true);
		advance(oneShot, atCompletion);
		expect(state.supplies.scrap).toBe(oneShot.supplies.scrap);
		expect(state.supplies.scrap).toBeGreaterThanOrEqual(scrap);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("canceling the displayed paid job at completion delivers its output and stops repeats without a fresh reservation or refund", () => {
		const state = funded();
		const medbay = state.shelter.rooms.find((room) => room.type === "medbay")!;
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		const jobId = medbay.queue[0]!.id;
		const money = state.money;
		const before = saveGame(state);
		expect(cancelProduction(state, medbay.id, "job-999999", NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		const atCompletion = NOW + Math.ceil(getRoomProductionState(state, medbay).remainingSeconds! * 1000);
		expect(cancelProduction(state, medbay.id, jobId, atCompletion).ok).toBe(true);
		expect(state.supplies.medicine).toBe(3);
		expect(medbay.cycles).toBe(1);
		expect(medbay.repeat).toBe(false);
		expect(medbay.pending).toBe(false);
		expect(medbay.queue).toHaveLength(0);
		expect(state.money).toBe(money);
		const after = saveGame(state);
		expect(cancelProduction(state, medbay.id, jobId, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(after);
		advance(state, state.lastUpdated + 120_000);
		expect(state.supplies.medicine).toBe(3);
		expect(state.money).toBe(money);
		expect(medbay.queue).toHaveLength(0);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a resource room cannot import a second queued paid batch that its public actions can never reserve", () => {
		const state = funded();
		const medbay = state.shelter.rooms.find((room) => room.type === "medbay")!;
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, NOW).ok).toBe(true);
		expect(parseSave(saveGame(state))).toEqual(state);
		const forged = JSON.parse(saveGame(state));
		const forgedRoom = forged.shelter.rooms.find((room: { id: string }) => room.id === medbay.id);
		const duplicate = structuredClone(forgedRoom.queue[0]);
		duplicate.id = `job-${forged.nextId++}`;
		forgedRoom.queue.push(duplicate);
		expect(parseSave(JSON.stringify(forged))).toBeNull();
	});
});
