import { describe, expect, test } from "bun:test";
import {
	advanceShelterLift, createShelterLift, restoreShelterLift, SHELTER_LIFT_BOARD_MS, SHELTER_LIFT_SPEED,
	type LiftRequest, type ShelterLiftState,
} from "../src/shelter-lift";
import { SHELTER_FLOOR_Y } from "../src/shelter-motion";

const A: LiftRequest = { id: "scav-a", from: 228, to: 450 };
function step(lift: ShelterLiftState, requests: readonly LiftRequest[], elapsed: number) {
	return advanceShelterLift(lift, requests, elapsed);
}
function partition(lift: ShelterLiftState, requests: readonly LiftRequest[], elapsed: number) {
	const boarded: string[] = [], dropped: { id: string; to: number; cancelled: boolean }[] = [], cancelled: string[] = [];
	const pattern = [16, 33, 97, 7, 501, 129, 2, 81];
	let remaining = elapsed, tick = 0;
	while (remaining > 0) {
		const delta = Math.min(remaining, pattern[tick++ % pattern.length]!);
		const result = step(lift, requests, delta);
		lift = result.state;
		boarded.push(...result.boarded); dropped.push(...result.dropped); cancelled.push(...result.cancelled);
		remaining -= delta;
	}
	return { state: lift, boarded, dropped, cancelled };
}
function samePhysicalState(a: ShelterLiftState, b: ShelterLiftState) {
	expect(a.y).toBeCloseTo(b.y, 7);
	expect(a.remainingMs).toBeCloseTo(b.remainingMs, 7);
	expect({ ...a, y: 0, remainingMs: 0 }).toEqual({ ...b, y: 0, remainingMs: 0 });
}

describe("one physical shelter lift", () => {
	test("open doors wait for actual entry instead of boarding a caller still outside", () => {
		const walking = { ...A, ready: false };
		let result = step(createShelterLift(), [walking], 5000);
		expect(result.state.y).toBe(A.from);
		expect(result.state.phase).toBe("boarding");
		expect(result.state.doorOpen).toBe(true);
		expect(result.state.passengerId).toBeNull();
		expect(result.boarded).toEqual([]);
		expect(result.state.remainingMs).toBe(SHELTER_LIFT_BOARD_MS);
		result = step(result.state, [{ ...walking, ready: true }], SHELTER_LIFT_BOARD_MS - 1);
		expect(result.boarded).toEqual([]);
		result = step(result.state, [{ ...walking, ready: true }], 1);
		expect(result.boarded).toEqual([A.id]);
		expect(result.state.y).toBe(A.from);
		expect(result.state.passengerId).toBe(A.id);
	});

	test("a caller that leaves the open doorway is cancelled before boarding and the next caller continues", () => {
		const next = { id: "next", from: 339, to: 450 };
		const waiting = step(createShelterLift(), [{ ...A, ready: false }, next], 1000).state;
		const result = step(waiting, [next], 10_000);
		expect(result.cancelled).toEqual([A.id]);
		expect(result.boarded).toEqual([next.id]);
		expect(result.dropped).toEqual([{ id: next.id, to: 450, cancelled: false }]);
	});

	test("serialized moving cabin resumes from the same physical point and timer", () => {
		for (const elapsed of [0, 125, 300, 1000, 4000]) {
			const state = step(createShelterLift(), [A], elapsed).state;
			const restored = restoreShelterLift(JSON.parse(JSON.stringify(state)));
			expect(restored).not.toBeNull();
			samePhysicalState(restored!, state);
			const uninterrupted = step(state, [A], 2000), resumed = step(restored!, [A], 2000);
			samePhysicalState(resumed.state, uninterrupted.state);
			expect(resumed.boarded).toEqual(uninterrupted.boarded);
			expect(resumed.dropped).toEqual(uninterrupted.dropped);
		}
	});

	test("restore rejects impossible cabin states without snapping to a valid floor", () => {
		const valid = createShelterLift();
		for (const value of [null, {}, { ...valid, y: NaN }, { ...valid, y: 300 }, { ...valid, y: 600 }, { ...valid, targetY: 300 }, { ...valid, remainingMs: Infinity }, { ...valid, phase: "travel" }, { ...valid, queue: [{ id: "bad", from: 300, to: 450 }] }]) expect(restoreShelterLift(value)).toBeNull();
	});
	test("pickup never moves the waiting passenger, boarding takes time, and travel starts from the actual pickup floor", () => {
		const request = { id: "upstairs", from: 129, to: 450 };
		let result = step(createShelterLift(), [request], 500);
		expect(result.state.phase).toBe("pickup");
		expect(result.state.y).toBeCloseTo(228 - SHELTER_LIFT_SPEED * .5);
		expect(result.state.passengerId).toBeNull();
		expect(result.boarded).toEqual([]);
		result = step(result.state, [request], result.state.remainingMs);
		expect(result.state.y).toBe(129);
		expect(result.state.phase).toBe("boarding");
		expect(result.state.doorOpen).toBe(true);
		result = step(result.state, [request], SHELTER_LIFT_BOARD_MS - 1);
		expect(result.state.passengerId).toBeNull();
		result = step(result.state, [request], 1);
		expect(result.boarded).toEqual([request.id]);
		expect(result.state.passengerId).toBe(request.id);
		expect(result.state.y).toBe(129);
		expect(result.state.phase).toBe("travel");
		expect(result.state.doorOpen).toBe(false);
		result = step(result.state, [request], 100);
		expect(result.state.y).toBeCloseTo(129 + SHELTER_LIFT_SPEED * .1);
		expect(result.state.passengerId).toBe(request.id);
	});

	test("one elapsed budget cannot be spent once per waiting actor or skip the boarding and alighting pauses", () => {
		const requests = [A, { id: "scav-b", from: 228, to: 129 }, { id: "scav-c", from: 339, to: 450 }];
		const result = step(createShelterLift(), requests, 3000);
		expect(result.boarded).toEqual([A.id]);
		expect(result.dropped).toEqual([]);
		expect(result.state.passengerId).toBe(A.id);
		expect(result.state.y).toBeCloseTo(228 + SHELTER_LIFT_SPEED * (3000 - SHELTER_LIFT_BOARD_MS) / 1000);
		expect(result.state.queue.map((item) => item.id)).toEqual(["scav-b", "scav-c"]);
		const arrival = step(result.state, requests, result.state.remainingMs);
		expect(arrival.dropped).toEqual([{ id: A.id, to: 450, cancelled: false }]);
		expect(arrival.state.phase).toBe("alighting");
		expect(arrival.state.doorOpen).toBe(true);
		expect(arrival.state.passengerId).toBeNull();
		expect(arrival.boarded).toEqual([]);
	});

	test("old queued callers keep FIFO order when the roster is reordered and new callers arrive", () => {
		const a = { id: "a", from: 450, to: 129 }, b = { id: "b", from: 228, to: 339 };
		const c = { id: "c", from: 129, to: 450 }, d = { id: "d", from: 339, to: 228 };
		const waiting = step(createShelterLift(), [a, b, c], 100).state;
		const reordered = step(waiting, [c, d, b, a], 0).state;
		expect(reordered.trip?.id).toBe(a.id);
		expect(reordered.queue.map((item) => item.id)).toEqual([b.id, c.id, d.id]);
		const completed = step(reordered, [c, d, b, a], 50_000);
		expect(completed.boarded).toEqual([a.id, b.id, c.id, d.id]);
		expect(completed.dropped.map((item) => item.id)).toEqual(completed.boarded);
		expect(completed.state.phase).toBe("idle");
		expect(completed.state.y).toBe(d.to);
		const heldSignals = step(completed.state, [c, d, b, a], 50_000);
		expect(heldSignals.boarded).toEqual([]);
		expect(heldSignals.dropped).toEqual([]);
		expect(heldSignals.state.y).toBe(d.to);
	});

	test("large frames and irregular frame partitions have identical passenger events and physical state", () => {
		const requests = [A, { id: "b", from: 129, to: 339 }, { id: "c", from: 450, to: 228 }];
		for (const elapsed of [0, 299, 300, 3000, 12345, 50_000]) {
			const initial = createShelterLift();
			const whole = step(initial, requests, elapsed);
			const split = elapsed ? partition(initial, requests, elapsed) : step(initial, requests, 0);
			expect(split.boarded).toEqual(whole.boarded);
			expect(split.dropped).toEqual(whole.dropped);
			expect(split.cancelled).toEqual(whole.cancelled);
			samePhysicalState(split.state, whole.state);
		}
	});

	test("a waiting caller that dies or leaves cannot reserve the car or be boarded later", () => {
		const removed = { id: "gone", from: 129, to: 450 }, live = { id: "live", from: 339, to: 228 };
		const initial = step(createShelterLift(), [A, removed, live], 1000).state;
		const result = step(initial, [A, live], 30_000);
		expect(result.boarded).toEqual([live.id]);
		expect(result.dropped.map((item) => item.id)).toEqual([A.id, live.id]);
		expect(result.state.queue).toEqual([]);
		expect(result.state.passengerId).toBeNull();
		expect(result.state.phase).toBe("idle");
	});

	test("cancelling pickup parks a moving empty car at a floor without jumping or stranding the next caller", () => {
		const gone = { id: "gone", from: 129, to: 450 }, live = { id: "live", from: 450, to: 339 };
		const pickup = step(createShelterLift(), [gone, live], 500).state;
		const cancelled = step(pickup, [live], 0);
		expect(cancelled.cancelled).toEqual([gone.id]);
		expect(cancelled.state.y).toBe(pickup.y);
		expect(cancelled.state.passengerId).toBeNull();
		const small = partition(cancelled.state, [live], 10_000), large = step(cancelled.state, [live], 10_000);
		expect(large.boarded).toEqual([live.id]);
		expect(large.dropped).toEqual([{ id: live.id, to: live.to, cancelled: false }]);
		expect(small.boarded).toEqual(large.boarded);
		expect(small.dropped).toEqual(large.dropped);
		samePhysicalState(small.state, large.state);
	});

	test("a removed rider stays physically attached until nearest-floor cancellation drops it exactly once", () => {
		const riding = step(createShelterLift(), [A], SHELTER_LIFT_BOARD_MS + 900).state;
		expect(riding.y).toBeGreaterThan(228);
		expect(riding.y).toBeLessThan(339);
		const cancelled = step(riding, [], 0);
		expect(cancelled.cancelled).toEqual([A.id]);
		expect(cancelled.state.y).toBe(riding.y);
		expect(cancelled.state.passengerId).toBe(A.id);
		expect(cancelled.dropped).toEqual([]);
		const short = step(cancelled.state, [], 100);
		expect(Math.abs(short.state.y - cancelled.state.y)).toBeLessThanOrEqual(SHELTER_LIFT_SPEED * .1 + 1e-7);
		expect(short.cancelled).toEqual([]);
		const arrived = step(short.state, [], 5000);
		expect(arrived.dropped).toEqual([{ id: A.id, to: 339, cancelled: true }]);
		expect(SHELTER_FLOOR_Y.some((floor) => floor === arrived.state.y)).toBe(true);
		expect(arrived.state.passengerId).toBeNull();
		expect(arrived.state.phase).toBe("idle");
		expect(step(arrived.state, [], 5000).dropped).toEqual([]);
	});

	test("an onboard reassignment changes destination smoothly even if caller pickup is now midshaft", () => {
		const riding = step(createShelterLift(), [A], SHELTER_LIFT_BOARD_MS + 900).state;
		const revised = { ...A, from: riding.y, to: 129 };
		const retargeted = step(riding, [revised], 0);
		expect(retargeted.state.y).toBe(riding.y);
		expect(retargeted.state.passengerId).toBe(A.id);
		expect(retargeted.boarded).toEqual([]);
		expect(retargeted.cancelled).toEqual([]);
		const moving = step(retargeted.state, [revised], 100);
		expect(moving.state.y).toBeCloseTo(riding.y - SHELTER_LIFT_SPEED * .1);
		const completed = step(moving.state, [revised], 10_000);
		expect(completed.dropped).toEqual([{ id: A.id, to: 129, cancelled: false }]);
		expect(completed.boarded).toEqual([]);
		expect(completed.state.y).toBe(129);
	});

	test("malformed calls and elapsed time cannot move the cabin to invalid space or mutate caller inputs", () => {
		const requests: LiftRequest[] = [A, { ...A }, { id: "midair", from: 301, to: 450 }, { id: "nan", from: NaN, to: 228 }, { id: "bad-floor", from: 228, to: 999 }, { id: "same", from: 228, to: 228 }];
		const initial = createShelterLift(), before = structuredClone({ initial, requests });
		const riding = step(initial, requests, 1000).state;
		expect({ initial, requests }).toEqual(before);
		expect(riding.trip?.id).toBe(A.id);
		expect(riding.queue).toEqual([]);
		for (const elapsed of [-1, NaN, Infinity]) {
			const stopped = step(riding, [A], elapsed);
			expect(stopped.state.y).toBe(riding.y);
			expect(stopped.boarded).toEqual([]);
			expect(stopped.dropped).toEqual([]);
		}
		for (const origin of [-1000, 1000, NaN, Infinity]) expect(SHELTER_FLOOR_Y.some((floor) => floor === createShelterLift(origin).y)).toBe(true);
	});
});
