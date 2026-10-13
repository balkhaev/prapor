import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, buildRoom, createGame, getBuildRoomQuote, getModuleCapacity,
	getRoomProductionState, queueModuleProduction, saveGame, setRoomRecipe,
	upgradeRoom, MODULE_BY_ID, type GameState, type RoomInstance,
} from "../src/game/engine";
import { RESOURCE_RECIPES } from "../src/game/shelter";
import { advanceShelterStationClock, getShelterProductionPresentation } from "../src/shelter-production";

const NOW = 1_792_000_000_000;
function funded() {
	const state = createGame(NOW);
	state.money = 20_000;
	state.supplies = { ammo: 50, medicine: 5, scrap: 30, intel: 5 };
	return state;
}
function room(state: GameState, type: RoomInstance["type"]) {
	return state.shelter.rooms.find((candidate) => candidate.type === type)!;
}
function workshop() {
	const state = funded(), bench = room(state, "workshop");
	expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
	expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
	return { state, bench };
}
function present(state: GameState, target: RoomInstance) {
	return getShelterProductionPresentation(target, getRoomProductionState(state, target));
}

describe("truthful shelter production presentation", () => {
	test("the paid queue head owns the displayed physical product and work progress, without advancing the game", () => {
		const { state, bench } = workshop();
		expect(queueModuleProduction(state, bench.id, "factory-sks-barrel", NOW).ok).toBe(true);
		const head = bench.queue[0]!, next = bench.queue[1]!, model = MODULE_BY_ID[head.modelId!]!;
		head.workDone = head.workRequired * .5;
		next.workDone = 0;
		const before = saveGame(state);
		for (let i = 0; i < 3; i++) {
			const projection = getShelterProductionPresentation(bench, { ...getRoomProductionState(state, bench), progress: .99 });
			expect(projection.jobId).toBe(head.id);
			expect(projection.modelId).toBe(model.id);
			expect(projection.moduleSlot).toBe(model.slot);
			expect(projection.productName).toBe(model.label);
			expect(projection.productKind).toBe("module");
			expect(projection.quantity).toBe(1);
			expect(projection.progress).toBe(.5);
			expect(projection.stage).toBe("assembly");
			expect(projection.active).toBe(true);
		}
		expect(saveGame(state)).toBe(before);
	});

	test("manufacturing stages change at real head-work boundaries and never restart at complete output", () => {
		const { state, bench } = workshop(), head = bench.queue[0]!;
		for (const [fraction, expected] of [[0, "preparation"], [.219999, "preparation"], [.22, "assembly"],
			[.839999, "assembly"], [.84, "inspection"], [.999999, "inspection"], [1, "complete"]] as const) {
			head.workDone = head.workRequired * fraction;
			const projection = present(state, bench);
			expect(projection.stage).toBe(expected);
			expect(projection.progress).toBeCloseTo(fraction, 8);
			expect(projection.stageProgress).toBeGreaterThanOrEqual(0);
			expect(projection.stageProgress).toBeLessThanOrEqual(1);
			expect(projection.active).toBe(fraction < 1);
			expect(projection.completed).toBe(fraction === 1);
		}
	});

	test("full storage keeps the completed head visible and frozen, then handing off selects the next exact product", () => {
		const { state, bench } = workshop();
		expect(queueModuleProduction(state, bench.id, "factory-sks-barrel", NOW).ok).toBe(true);
		const first = bench.queue[0]!, second = bench.queue[1]!;
		const template = state.modules[0]!;
		while (state.modules.length < getModuleCapacity(state)) state.modules.push({ ...template, id: `occupied-${state.modules.length}` });
		advance(state, NOW + Math.ceil(getRoomProductionState(state, bench).remainingSeconds! * 1000));
		expect(bench.queue[0]?.id).toBe(first.id);
		expect(first.workDone).toBe(first.workRequired);
		expect(assignWorker(state, state.scavs[0]!.id, null, state.lastUpdated).ok).toBe(true);
		const blocked = present(state, bench), snapshot = saveGame(state);
		expect(blocked.jobId).toBe(first.id);
		expect(blocked.productName).toBe(MODULE_BY_ID[first.modelId!]!.label);
		expect(blocked.stage).toBe("complete");
		expect(blocked.completed).toBe(true);
		expect(blocked.active).toBe(false);
		expect(blocked.paused).toBe(true);
		expect(blocked.reason).toBe(getRoomProductionState(state, bench).reason);
		expect(present(state, bench)).toEqual(blocked);
		expect(saveGame(state)).toBe(snapshot);
		state.modules.pop();
		advance(state, state.lastUpdated);
		const next = present(state, bench);
		expect(next.jobId).toBe(second.id);
		expect(next.modelId).toBe(second.modelId);
		expect(next.productName).toBe(MODULE_BY_ID[second.modelId!]!.label);
		expect(next.moduleSlot).toBe("barrel");
		expect(next.stage).toBe("preparation");
		expect(next.progress).toBe(0);
		expect(next.active).toBe(false);
		expect(next.completed).toBe(false);
	});

	test("paused unfinished work retains its real stage and resumes without fabricating a fresh order", () => {
		const { state, bench } = workshop(), job = bench.queue[0]!;
		advance(state, NOW + 10_000);
		expect(assignWorker(state, state.scavs[0]!.id, null, state.lastUpdated).ok).toBe(true);
		const paused = present(state, bench), work = job.workDone;
		expect(paused.active).toBe(false);
		expect(paused.paused).toBe(true);
		expect(paused.jobId).toBe(job.id);
		advance(state, state.lastUpdated + 15_000);
		expect(job.workDone).toBe(work);
		expect(present(state, bench)).toEqual(paused);
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, state.lastUpdated).ok).toBe(true);
		const resumed = present(state, bench);
		expect(resumed.active).toBe(true);
		expect(resumed.jobId).toBe(job.id);
		expect(resumed.progress).toBe(paused.progress);
		expect(resumed.stage).toBe(paused.stage);
	});

	test("an empty room or unreserved recipe never shows a phantom product or manufacturing activity", () => {
		const state = funded(), bench = room(state, "workshop"), medbay = room(state, "medbay");
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
		expect(medbay.queue).toHaveLength(0);
		for (const target of [bench, medbay, room(state, "storage")]) {
			const projection = present(state, target);
			expect(projection.jobId).toBeNull();
			expect(projection.modelId).toBeNull();
			expect(projection.moduleSlot).toBeNull();
			expect(projection.productKind).toBeNull();
			expect(projection.progress).toBe(0);
			expect(projection.stage).toBe("idle");
			expect(projection.active).toBe(false);
			expect(projection.completed).toBe(false);
		}
	});

	test("resource stations display the actual recipe output and quantity rather than an interchangeable module", () => {
		for (const recipe of RESOURCE_RECIPES) {
			const state = funded();
			let target = state.shelter.rooms.find((candidate) => candidate.type === recipe.roomType);
			if (!target) {
				const quote = getBuildRoomQuote(state, recipe.roomType, 0, 1);
				expect(buildRoom(state, recipe.roomType, 0, 1, NOW).ok).toBe(true);
				advance(state, NOW + quote.duration * 1000);
				target = room(state, recipe.roomType);
			}
			target.level = Math.max(target.level, recipe.minLevel ?? 1);
			expect(assignWorker(state, state.scavs[0]!.id, target.id, state.lastUpdated).ok).toBe(true);
			expect(setRoomRecipe(state, target.id, recipe.id, false, state.lastUpdated).ok).toBe(true);
			const projection = present(state, target), output = (["ammo", "scrap", "medicine", "intel"] as const).find((key) => recipe.output[key] > 0)!;
			expect(projection.jobId).toBe(target.queue[0]!.id);
			expect(projection.productName).toBe(recipe.label);
			expect(projection.productKind).toBe(recipe.outputKit ? "field-kit" : output);
			expect(projection.quantity).toBe(recipe.outputKit ? 1 : recipe.output[output]);
			expect(projection.moduleSlot).toBeNull();
			expect(projection.modelId).toBeNull();
			expect(projection.active).toBe(true);
		}
	});

	test("upgrading shows construction progress without presenting its preserved paid job as active manufacture", () => {
		const { state, bench } = workshop(), job = bench.queue[0]!;
		advance(state, NOW + 5000);
		const work = job.workDone;
		expect(upgradeRoom(state, bench.id, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 10_000);
		const projection = present(state, bench), before = saveGame(state);
		expect(projection.stage).toBe("construction");
		expect(projection.progress).toBe(bench.construction!.workDone / bench.construction!.workRequired);
		expect(projection.active).toBe(false);
		expect(projection.jobId).toBeNull();
		expect(projection.modelId).toBeNull();
		expect(projection.moduleSlot).toBeNull();
		expect(projection.productKind).toBeNull();
		expect(job.workDone).toBe(work);
		expect(bench.queue[0]?.id).toBe(job.id);
		expect(saveGame(state)).toBe(before);
	});

	test("visual station time agrees at 30, 60 and 120 Hz and freezes whenever real work cannot run", () => {
		const { state, bench } = workshop(), running = present(state, bench);
		const clocks = [30, 60, 120].map((hz) => {
			let clock = 0;
			for (let i = 0; i < hz * 2; i++) clock = advanceShelterStationClock(clock, 1000 / hz, running);
			return clock;
		});
		for (const clock of clocks) expect(clock).toBeCloseTo(2000, 7);
		const before = saveGame(state);
		for (const inactive of [{ active: false }, { ...running, active: false }]) {
			expect(advanceShelterStationClock(2000, 1000, inactive)).toBe(2000);
		}
		for (const delta of [-20, 0, NaN, Infinity]) expect(advanceShelterStationClock(2000, delta, running)).toBe(2000);
		expect(advanceShelterStationClock(2000, 1000, running, true)).toBe(2000);
		expect(advanceShelterStationClock(2000, 60_000, running) - 2000).toBeLessThanOrEqual(100);
		expect(saveGame(state)).toBe(before);
	});
});
