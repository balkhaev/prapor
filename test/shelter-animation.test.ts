import { describe, expect, test } from "bun:test";
import {
	advanceScavAnimation, createScavAnimation, pixelScavWalkDistance, MAX_SCAV_WORK_INTERPOLATION_MS,
	SCAV_STRIDE_DISTANCE, type ScavAnimationInput, type ScavAnimationPose, type ScavAnimationState,
} from "../src/shelter-animation";
import { advance, assignWorker, createGame, getRoomProductionState, queueModuleProduction, saveGame } from "../src/game/engine";
import { projectShelterPoint } from "../src/shelter-isometric";
import { scavDirection, scavPixelFrame } from "../src/scav-isometric";
import { pixelActorRig } from "../src/pixel-actor-rig";
import { PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_LIMP_CYCLE_SCALE } from "../src/pixel-actor-config";

const IDLE: ScavAnimationInput = { distance: 0, elapsedMs: 0, walking: false, working: false, facing: 1,
	role: "workshop", workDone: 0, workRate: 0, jobId: null };
function numericPose(pose: ScavAnimationPose) {
	return [pose.scaleX, pose.scaleY, pose.angle, pose.handAngle, pose.toolX, pose.toolY, pose.toolAngle, ...Object.values(pose.weights)];
}
function closePose(a: ScavAnimationPose, b: ScavAnimationPose) {
	numericPose(a).forEach((value, index) => expect(value).toBeCloseTo(numericPose(b)[index]!, 7));
}
function frames(state: ScavAnimationState, input: ScavAnimationInput, hz: number, milliseconds: number, speed = 0) {
	let result = advanceScavAnimation(state, { ...input, elapsedMs: 0, distance: 0 });
	let remaining = milliseconds;
	while (remaining > 1e-8) {
		const elapsedMs = Math.min(remaining, 1000 / hz);
		result = advanceScavAnimation(result.state, { ...input, elapsedMs, distance: speed * elapsedMs / 1000 });
		remaining -= elapsedMs;
	}
	return result;
}

describe("continuous distance driven scav animation", () => {
	test("pixel support feet stay planted along both unequal shelter axes at the displayed actor scale", () => {
		const start = { x: 200, y: 200 }, origin = projectShelterPoint(start);
		for (const axis of ["x", "y"] as const) for (const actorScale of [.78, 1]) {
			const unit = projectShelterPoint({ ...start, [axis]: start[axis] + 1 });
			const direction = scavDirection(unit.x - origin.x, unit.y - origin.y);
			const projectedUnit = Math.hypot(unit.x - origin.x, 2 * (unit.y - origin.y));
			const cycleDistance = 28 * actorScale / projectedUnit, feet = [];
			for (let frame = 0; frame / PIXEL_ACTOR_FRAMES.walk <= .4; frame++) {
				const position = projectShelterPoint({ ...start, [axis]: start[axis] + cycleDistance * (frame + .001) / PIXEL_ACTOR_FRAMES.walk });
				const animation = advanceScavAnimation(createScavAnimation(), { ...IDLE, walking: true,
					distance: pixelScavWalkDistance(origin, position, actorScale) });
				const pose = scavPixelFrame(direction, animation.state.stride, 0, true);
				expect(pose.frame).toBe(frame);
				const rig = pixelActorRig(pose), scale = 48 / 160 * actorScale;
				feet.push({ x: position.x + (rig.leftHeel.x - rig.anchor.x) * scale, y: position.y + (rig.leftHeel.y - rig.anchor.y) * scale });
			}
			expect(Math.max(...feet.map(point => point.x)) - Math.min(...feet.map(point => point.x))).toBeLessThan(.4);
			expect(Math.max(...feet.map(point => point.y)) - Math.min(...feet.map(point => point.y))).toBeLessThan(.4);
		}
	});

	test("injured pixel strides shorten without changing the route or accumulating idle steps", () => {
		const from = { x: 12, y: 20 }, to = { x: 24, y: 26 }, original = structuredClone({ from, to });
		const normal = pixelScavWalkDistance(from, to, .78), injured = pixelScavWalkDistance(from, to, .78, true);
		expect(injured * PIXEL_ACTOR_LIMP_CYCLE_SCALE).toBeCloseTo(normal, 8);
		expect(pixelScavWalkDistance(from, from, .78, true)).toBe(0);
		expect(pixelScavWalkDistance(from, { x: NaN, y: 0 })).toBe(0);
		expect({ from, to }).toEqual(original);
	});

	test("30, 60 and 120 Hz produce the same gait and stopping pose for the same actual path and time", () => {
		const initial = createScavAnimation(.23), walk = { ...IDLE, walking: true, facing: -1 as const };
		const walking = [30, 60, 120].map((hz) => frames(initial, walk, hz, 2400, 58));
		for (const result of walking) {
			expect(result.state.stride - initial.stride).toBeCloseTo(58 * 2.4 / SCAV_STRIDE_DISTANCE, 7);
			expect(result.state.walkBlend).toBeCloseTo(walking[0]!.state.walkBlend, 7);
			expect(result.state.facing).toBeCloseTo(walking[0]!.state.facing, 7);
			closePose(result.pose, walking[0]!.pose);
		}
		const stopped = walking.map((result, index) => frames(result.state, { ...IDLE, facing: -1 }, [30, 60, 120][index]!, 600));
		for (const result of stopped) {
			expect(result.state.stride).toBeCloseTo(walking[0]!.state.stride, 7);
			expect(result.pose.weights.walkA + result.pose.weights.walkB).toBeLessThan(.02);
			closePose(result.pose, stopped[0]!.pose);
		}
		expect(initial).toEqual(createScavAnimation(.23));
	});

	test("steps follow horizontal distance, so a slower worker and a stationary lift rider do not invent a different path", () => {
		const walk = { ...IDLE, walking: true }, initial = createScavAnimation(.2);
		const fast = frames(initial, walk, 60, 2000, 58), slow = frames(initial, walk, 30, 4000, 29);
		expect(fast.state.stride).toBeCloseTo(slow.state.stride, 7);
		const riding = frames(fast.state, IDLE, 120, 3000);
		expect(riding.state.stride).toBe(fast.state.stride);
		const stationary = frames(fast.state, walk, 60, 1000, 0);
		expect(stationary.state.stride).toBe(fast.state.stride);
		const cancelledDistance = advanceScavAnimation(initial, { ...IDLE, distance: 500, elapsedMs: 100 });
		expect(cancelledDistance.state.stride).toBe(initial.stride);
	});

	test("crossing the stride wrap keeps the same feet contact and continuous silhouette weights", () => {
		const walk = { ...IDLE, walking: true };
		const before = frames(createScavAnimation(.99999), walk, 60, 1000, 0);
		const after = advanceScavAnimation(before.state, { ...walk, elapsedMs: 0, distance: .00002 * SCAV_STRIDE_DISTANCE });
		expect(before.state.stride).toBeLessThan(1);
		expect(after.state.stride).toBeGreaterThan(1);
		for (const key of ["walkA", "walkB"] as const) expect(Math.abs(after.pose.weights[key] - before.pose.weights[key])).toBeLessThan(.001);
		expect(Math.abs(after.pose.angle - before.pose.angle)).toBeLessThan(.001);
		expect(Math.abs(after.pose.handAngle - before.pose.handAngle)).toBeLessThan(.01);
	});

	test("starting, turning and stopping blend gradually while all transforms and pose weights stay finite and bounded", () => {
		let state = createScavAnimation(), firstWalk = 0;
		for (let i = 0; i < 90; i++) {
			const walking = i < 45;
			const result = advanceScavAnimation(state, { ...IDLE, walking, facing: i < 20 ? 1 : -1,
				elapsedMs: 1000 / 60, distance: walking ? 58 / 60 : 0 });
			if (i === 0) firstWalk = result.pose.weights.walkA + result.pose.weights.walkB;
			expect(numericPose(result.pose).every(Number.isFinite)).toBe(true);
			expect(Object.values(result.pose.weights).every((value) => value >= 0 && value <= 1)).toBe(true);
			expect(Object.values(result.pose.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
			expect(Math.abs(result.pose.scaleX)).toBeLessThanOrEqual(1);
			expect(result.pose.scaleY).toBeGreaterThan(.95);
			expect(result.pose.scaleY).toBeLessThan(1.05);
			expect(Math.abs(result.pose.angle)).toBeLessThan(5);
			expect(Math.abs(result.state.facing - state.facing)).toBeLessThan(.5);
			state = result.state;
		}
		expect(firstWalk).toBeGreaterThan(0);
		expect(firstWalk).toBeLessThan(.3);
		expect(state.walkBlend).toBeLessThan(.01);
		for (const bad of [NaN, Infinity, -10]) {
			const result = advanceScavAnimation(state, { ...IDLE, walking: true, distance: bad, elapsedMs: bad, workDone: bad, workRate: bad });
			expect(numericPose(result.pose).every(Number.isFinite)).toBe(true);
			expect(result.state.stride).toBe(state.stride);
		}
	});

	test("a suspended view preserves animation state, and reduced motion supplies static poses without walking or work oscillation", () => {
		const work = { ...IDLE, working: true, jobId: "job-a", workDone: 4, workRate: 1.2, role: "recycler" };
		const warm = frames(createScavAnimation(.4), work, 60, 500), original = structuredClone(warm.state);
		const paused = advanceScavAnimation(warm.state, { ...work, elapsedMs: 5000, distance: 400, walking: true, paused: true });
		expect(paused.state).toEqual(original);
		expect(warm.state).toEqual(original);
		for (const working of [false, true]) {
			const input = { ...work, working, walking: true, facing: -1 as const, reducedMotion: true };
			const start = advanceScavAnimation(warm.state, { ...input, elapsedMs: 100, distance: 20 });
			const later = advanceScavAnimation(start.state, { ...input, elapsedMs: 5000, distance: 1000 });
			expect(later.state.stride).toBe(warm.state.stride);
			expect(later.pose).toEqual(start.pose);
			expect(later.pose.scaleX).toBe(-1);
			expect(later.pose.scaleY).toBe(1);
			expect(later.pose.angle).toBe(0);
			expect(later.pose.weights.walkA + later.pose.weights.walkB).toBe(0);
			expect(later.pose.weights.work).toBe(working ? 1 : 0);
		}
	});

	test("production interpolation is bounded by real work rate, freezes while blocked and resets for a different paid job", () => {
		const now = 1_792_000_000_000, state = createGame(now), bench = state.shelter.rooms.find((room) => room.type === "workshop")!;
		state.money = 2000; state.supplies.scrap = 30;
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, now).ok).toBe(true);
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", now).ok).toBe(true);
		advance(state, now + 5000);
		const head = bench.queue[0]!, production = getRoomProductionState(state, bench), before = saveGame(state);
		const work = { ...IDLE, working: true, jobId: head.id, workDone: head.workDone / 1_000_000, workRate: production.rate };
		const observed = advanceScavAnimation(createScavAnimation(), work);
		const moving = frames(observed.state, work, 60, 400), saturated = frames(moving.state, work, 120, 5000);
		expect(moving.state.workCursor).toBeCloseTo(work.workDone + work.workRate * .4, 7);
		expect(saturated.state.workAgeMs).toBeLessThanOrEqual(MAX_SCAV_WORK_INTERPOLATION_MS);
		expect(saturated.state.workCursor).toBeLessThanOrEqual(work.workDone + work.workRate);
		const stopped = frames(saturated.state, { ...work, working: false, workRate: 0 }, 30, 4000);
		expect(stopped.state.workCursor).toBe(saturated.state.workCursor);
		const held = frames(stopped.state, { ...work, working: false, workRate: 0 }, 120, 4000);
		expect(held.state.workCursor).toBe(stopped.state.workCursor);
		expect(held.pose.toolX).toBe(stopped.pose.toolX);
		expect(held.pose.toolY).toBe(stopped.pose.toolY);
		expect(held.pose.toolAngle).toBe(stopped.pose.toolAngle);
		const next = advanceScavAnimation(held.state, { ...work, jobId: "different-order", workDone: .2, elapsedMs: 0 });
		expect(next.state.observedJob).toBe("different-order");
		expect(next.state.workCursor).toBe(.2);
		expect(next.state.workAgeMs).toBe(0);
		expect(saveGame(state)).toBe(before);
	});
});
