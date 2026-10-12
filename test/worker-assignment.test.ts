import { describe, expect, test } from "bun:test";
import {
	advance,
	assignWorker,
	buildRoom,
	createGame,
	dispatchRaid,
	getBuildRoomQuote,
	getRoomUpgradeQuote,
	getWorkerAssignmentReason,
	parseSave,
	queueModuleProduction,
	saveGame,
	setAutoRaid,
	upgradeRoom,
	type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;

function funded(): GameState {
	const state = createGame(NOW);
	state.money = 10_000;
	state.supplies = { ammo: 100, medicine: 0, scrap: 100, intel: 10 };
	return state;
}

function room(state: GameState, type: "workshop" | "medbay" | "radio" | "storage") {
	return state.shelter.rooms.find((item) => item.type === type)!;
}

describe("worker assignment previews and commits", () => {
	test("previewing drag targets cannot advance time, run orders, spend money or mutate paid production", () => {
		const state = funded();
		const bench = room(state, "workshop");
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		advance(state, NOW + 5000);
		expect(bench.queue[0]!.workDone).toBeGreaterThan(0);
		// A ready saved order would depart on an advancing call; previewing
		// hundreds of hit targets must leave that order waiting untouched.
		state.scavs[2]!.autoRaid.enabled = true;
		const before = saveGame(state);
		for (let frame = 0; frame < 100; frame++) {
			for (const target of state.shelter.rooms)
				getWorkerAssignmentReason(state, state.scavs[1]!.id, target.id);
			getWorkerAssignmentReason(state, state.scavs[1]!.id, null);
			getWorkerAssignmentReason(state, "scav-missing", bench.id);
		}
		expect(saveGame(state)).toBe(before);
		expect(state.raids).toHaveLength(0);
		expect(parseSave(before)).toEqual(state);
	});

	test("rejecting a full target preserves the worker's original room and every resource", () => {
		const state = funded();
		const [worker, occupant] = state.scavs;
		const original = room(state, "workshop");
		const target = room(state, "medbay");
		expect(assignWorker(state, worker!.id, original.id, NOW).ok).toBe(true);
		expect(assignWorker(state, occupant!.id, target.id, NOW).ok).toBe(true);
		const reason = getWorkerAssignmentReason(state, worker!.id, target.id);
		expect(reason).not.toBeNull();
		const before = saveGame(state);
		const result = assignWorker(state, worker!.id, target.id, NOW);
		expect(result.ok).toBe(false);
		expect(result.message).toBe(reason!);
		expect(worker!.assignment).toBe(original.id);
		expect(original.workerIds).toEqual([worker!.id]);
		expect(target.workerIds).toEqual([occupant!.id]);
		expect(saveGame(state)).toBe(before);
	});

	test("a transfer moves one owner atomically and same-room drops never duplicate an already assigned worker", () => {
		const state = funded();
		const worker = state.scavs[0]!;
		const original = room(state, "workshop");
		const target = room(state, "medbay");
		expect(assignWorker(state, worker.id, original.id, NOW).ok).toBe(true);
		expect(getWorkerAssignmentReason(state, worker.id, target.id)).toBeNull();
		expect(assignWorker(state, worker.id, target.id, NOW).ok).toBe(true);
		expect(original.workerIds).toHaveLength(0);
		expect(target.workerIds).toEqual([worker.id]);
		expect(worker.assignment).toBe(target.id);
		const transferred = saveGame(state);
		for (let drop = 0; drop < 3; drop++) {
			expect(getWorkerAssignmentReason(state, worker.id, target.id)).toBeNull();
			expect(assignWorker(state, worker.id, target.id, NOW).ok).toBe(true);
			expect(target.workerIds).toEqual([worker.id]);
		}
		expect(saveGame(state)).toBe(transferred);
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("the health threshold permits work at 25, blocks lower health, and always permits releasing an injured worker", () => {
		const state = funded();
		const worker = state.scavs[0]!;
		const target = room(state, "workshop");
		worker.health = 24.999;
		worker.status = "wounded";
		expect(getWorkerAssignmentReason(state, worker.id, target.id)).not.toBeNull();
		const wounded = saveGame(state);
		expect(assignWorker(state, worker.id, target.id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(wounded);
		worker.health = 25;
		worker.status = "ready";
		expect(getWorkerAssignmentReason(state, worker.id, target.id)).toBeNull();
		expect(assignWorker(state, worker.id, target.id, NOW).ok).toBe(true);
		worker.health = 24;
		worker.status = "wounded";
		expect(getWorkerAssignmentReason(state, worker.id, null)).toBeNull();
		expect(assignWorker(state, worker.id, null, NOW).ok).toBe(true);
		expect(target.workerIds).toHaveLength(0);
		expect(worker.assignment).toBeNull();
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("active raids, upgrading rooms, non-work rooms and missing IDs reject without moving ownership", () => {
		const state = funded();
		const worker = state.scavs[0]!;
		const target = room(state, "workshop");
		expect(dispatchRaid(state, worker.id, "courtyard", NOW).ok).toBe(true);
		const raiding = saveGame(state);
		expect(getWorkerAssignmentReason(state, worker.id, target.id)).not.toBeNull();
		expect(getWorkerAssignmentReason(state, worker.id, null)).not.toBeNull();
		expect(assignWorker(state, worker.id, target.id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(raiding);
		const idle = state.scavs[1]!;
		expect(upgradeRoom(state, target.id, NOW).ok).toBe(true);
		expect(getWorkerAssignmentReason(state, idle.id, target.id)).not.toBeNull();
		for (const roomId of [room(state, "storage").id, "constructor", "__proto__", "room-missing", ""])
			expect(getWorkerAssignmentReason(state, idle.id, roomId)).not.toBeNull();
		for (const scavId of ["constructor", "__proto__", "scav-missing", ""])
			expect(getWorkerAssignmentReason(state, scavId, null)).not.toBeNull();
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("a valid preview grants no reservation and final validation rejects a target occupied before the drop", () => {
		const state = funded();
		const worker = state.scavs[0]!;
		const competitor = state.scavs[1]!;
		const original = room(state, "workshop");
		const target = room(state, "medbay");
		expect(assignWorker(state, worker.id, original.id, NOW).ok).toBe(true);
		expect(getWorkerAssignmentReason(state, worker.id, target.id)).toBeNull();
		expect(assignWorker(state, competitor.id, target.id, NOW).ok).toBe(true);
		const occupied = saveGame(state);
		expect(assignWorker(state, worker.id, target.id, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(occupied);
		expect(worker.assignment).toBe(original.id);
		expect(target.workerIds).toEqual([competitor.id]);
	});

	test("final validation advances construction before assigning and retains the auto-order boundary suppression", () => {
		const state = funded();
		const worker = state.scavs[0]!;
		const quote = getBuildRoomQuote(state, "ammo", 0, 1);
		expect(buildRoom(state, "ammo", 0, 1, NOW).ok).toBe(true);
		const target = state.shelter.rooms.find((item) => item.column === 0 && item.row === 1)!;
		expect(getWorkerAssignmentReason(state, worker.id, target.id)).not.toBeNull();
		expect(assignWorker(state, worker.id, target.id, NOW + quote.duration * 1000).ok).toBe(true);
		expect(target.status).toBe("ready");
		expect(worker.assignment).toBe(target.id);
		const bench = room(state, "workshop");
		const upgrade = getRoomUpgradeQuote(state, bench.id);
		expect(upgradeRoom(state, bench.id, state.lastUpdated).ok).toBe(true);
		expect(getWorkerAssignmentReason(state, worker.id, bench.id)).not.toBeNull();
		expect(assignWorker(state, worker.id, bench.id, state.lastUpdated + upgrade.duration * 1000).ok).toBe(true);
		expect(bench.level).toBe(2);
		const autoWorker = state.scavs[1]!;
		expect(setAutoRaid(state, autoWorker.id, "courtyard", 25, state.lastUpdated).ok).toBe(true);
		const raid = state.raids.find((item) => item.scavId === autoWorker.id)!;
		raid.chance = 1;
		expect(assignWorker(state, autoWorker.id, bench.id, raid.endsAt).ok).toBe(true);
		expect(autoWorker.autoRaid.enabled).toBe(true);
		expect(autoWorker.assignment).toBe(bench.id);
		expect(state.raids.some((item) => item.scavId === autoWorker.id)).toBe(false);
		expect(parseSave(saveGame(state))).toEqual(state);
	});
});
