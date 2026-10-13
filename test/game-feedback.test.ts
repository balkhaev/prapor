import { describe, expect, test } from "bun:test";
import { advance, assignWorker, buildRoom, createGame, dispatchRaid, excavateShelter, saveGame, setRoomRecipe } from "../src/game/engine";
import { getRaidFieldPlan } from "../src/raid-field";
import { createGameFeedbackCursor, observeGameFeedback } from "../src/game-feedback";

const NOW = 1_792_000_000_000;
describe("feedback observes actual game transitions", () => {
	test("existing progress, repeated frames and a replaced save do not replay sounds or change gameplay", () => {
		const state = createGame(NOW); state.shelter.rooms[0]!.cycles = 17;
		const cursor = createGameFeedbackCursor(state, null, NOW), before = saveGame(state), previous = structuredClone(cursor.rooms);
		expect(observeGameFeedback(cursor, state, null, NOW + 1000).events).toEqual([]);
		expect(cursor.rooms).toEqual(previous); expect(saveGame(state)).toBe(before);
		const copy = structuredClone(state); copy.shelter.rooms[0]!.cycles++;
		expect(observeGameFeedback(cursor, copy, null, NOW + 2000).events).toEqual([]);
	});
	test("waiting output stays silent; delivered batches produce a single cue even after several cycles", () => {
		const state = createGame(NOW), room = state.shelter.rooms[0]!;
		const cursor = createGameFeedbackCursor(state, null, NOW);
		room.pending = true;
		expect(observeGameFeedback(cursor, state, null, NOW).events).toEqual([]);
		room.cycles += 4;
		const before = saveGame(state), changed = observeGameFeedback(cursor, state, null, NOW);
		expect(changed.events.map((event) => event.cue)).toEqual(["complete"]);
		expect(observeGameFeedback(changed.cursor, state, null, NOW).events).toEqual([]);
		expect(saveGame(state)).toBe(before);
	});
	test("a paid wall and its later room sound at completion, never on preparation or early ticks", () => {
		const state = createGame(NOW); state.money = 5000;
		expect(excavateShelter(state, -1, 0, NOW).ok).toBe(true);
		let cursor = createGameFeedbackCursor(state, null, NOW);
		advance(state, NOW + 19_000);
		expect(observeGameFeedback(cursor, state, null, NOW + 19_000).events).toEqual([]);
		advance(state, NOW + 20_000);
		const opened = observeGameFeedback(cursor, state, null, NOW + 20_000);
		expect(opened.events.map((event) => event.cue)).toEqual(["build"]);
		cursor = opened.cursor;
		expect(buildRoom(state, "ammo", -1, 0, NOW + 20_000).ok).toBe(true);
		cursor = observeGameFeedback(cursor, state, null, NOW + 20_000).cursor;
		advance(state, NOW + 80_000);
		const built = observeGameFeedback(cursor, state, null, NOW + 80_000);
		expect(built.events.map((event) => event.cue)).toEqual(["build"]);
		expect(observeGameFeedback(built.cursor, state, null, NOW + 80_000).events).toEqual([]);
	});
	test("watch changes prime silently and each observed search or contact cues only once", () => {
		const state = createGame(NOW), initial = createGameFeedbackCursor(state, null, NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!, plan = getRaidFieldPlan(raid);
		const dispatched = observeGameFeedback(initial, state, null, NOW);
		expect(dispatched.events.map((event) => event.cue)).toEqual(["depart"]);
		let cursor = observeGameFeedback(dispatched.cursor, state, raid.id, NOW).cursor;
		let contacts = 0, searches = 0;
		for (const segment of plan.segments) {
			const now = raid.startedAt + (raid.endsAt - raid.startedAt) * (segment.start + segment.end) / 2;
			const observed = observeGameFeedback(cursor, state, raid.id, now);
			contacts += observed.events.filter((event) => event.cue === "danger").length;
			searches += observed.events.filter((event) => event.cue === "search").length;
			expect(observeGameFeedback(observed.cursor, state, raid.id, now).events).toEqual([]);
			cursor = observed.cursor;
		}
		expect(contacts).toBe(plan.segments.filter((segment) => segment.kind === "skirmish").length);
		expect(searches).toBe(plan.segments.filter((segment) => segment.kind === "search").length);
		const firstSearch = plan.segments.find((segment) => segment.kind === "search")!;
		const now = raid.startedAt + (raid.endsAt - raid.startedAt) * (firstSearch.start + firstSearch.end) / 2;
		expect(observeGameFeedback(createGameFeedbackCursor(state, null, now), state, raid.id, now).events).toEqual([]);
	});
	test("inventory pulses show the actual delivered gain and disappear on repeated observations or imported saves", () => {
		const state = createGame(NOW), room = state.shelter.rooms.find((room) => room.type === "medbay")!;
		expect(assignWorker(state, state.scavs[0]!.id, room.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, room.id, "medicine-batch", false, NOW).ok).toBe(true);
		const cursor = createGameFeedbackCursor(state, null, NOW);
		advance(state, NOW + 200_000);
		const before = saveGame(state), delivered = observeGameFeedback(cursor, state, null, NOW + 200_000);
		expect(delivered.events.some((event) => event.cue === "complete")).toBe(true);
		expect(delivered.gains.medicine).toBe(3);
		expect(observeGameFeedback(delivered.cursor, state, null, NOW + 200_000).gains).toEqual({money:0,ammo:0,medicine:0,scrap:0,intel:0});
		const imported = structuredClone(state); imported.supplies.medicine += 3;
		expect(observeGameFeedback(delivered.cursor, imported, null, NOW + 200_000).gains.medicine).toBe(0);
		expect(saveGame(state)).toBe(before);
	});

});
