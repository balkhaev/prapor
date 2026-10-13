import { describe, expect, test } from "bun:test";
import { getShelterActivityPose } from "../src/shelter-activity";
import type { ShelterRoutineActivity } from "../src/shelter-routines";

const activities: ShelterRoutineActivity[] = ["rest", "warm", "inspect", "lookout", "chat", "stroll", "carry", "sweep", "maintain"];

describe("cosmetic outdoor activity poses", () => {
	test("supplies stay in a resident's arms on the approach while work tools are put away", () => {
		const carried = getShelterActivityPose({ activity: "carry", cargo: "firewood", elapsedMs: 1200, walking: true });
		expect(carried.stance).toBe("carry");
		expect(carried.cargoKind).toBe("firewood");
		expect(carried.toolKind).toBe("crate");
		for (const activity of activities.filter((item) => item !== "carry")) {
			const pose = getShelterActivityPose({ activity, elapsedMs: 1200, walking: true });
			expect(pose.stance).toBe("walk");
			expect(pose.toolKind).toBe("none");
			expect(pose.cargoKind).toBe("none");
		}
	});

	test("sweeping and repairs use visibly different tools and bounded repeated motion", () => {
		const sweep = getShelterActivityPose({ activity: "sweep", elapsedMs: 0 });
		const repair = getShelterActivityPose({ activity: "maintain", elapsedMs: 0 });
		expect(sweep.toolKind).toBe("broom");
		expect(repair.toolKind).toBe("hammer");
		expect(sweep.toolAngle).not.toBe(repair.toolAngle);
		expect(sweep).not.toEqual(getShelterActivityPose({ activity: "sweep", elapsedMs: 425 }));
		expect(repair).not.toEqual(getShelterActivityPose({ activity: "maintain", elapsedMs: 287.5 }));
		for (const activity of activities) for (const elapsedMs of [-30, 0, 550, 1150, 50_000, Number.NaN, Number.POSITIVE_INFINITY]) {
			const pose = getShelterActivityPose({ activity, elapsedMs });
			for (const value of [pose.bodyTilt, pose.bodyLift, pose.handX, pose.handY, pose.toolX, pose.toolY, pose.toolAngle, pose.workCycle]) expect(Number.isFinite(value)).toBe(true);
			expect(Math.abs(pose.bodyTilt)).toBeLessThanOrEqual(6);
			expect(Math.abs(pose.toolX)).toBeLessThanOrEqual(8);
			expect(Math.abs(pose.toolY)).toBeLessThanOrEqual(8);
			expect(Math.abs(pose.toolAngle)).toBeLessThanOrEqual(36);
			expect(pose.workCycle).toBeGreaterThanOrEqual(0);
			expect(pose.workCycle).toBeLessThanOrEqual(1);
		}
	});

	test("poses mirror tools and torso together when a resident faces the other way", () => {
		for (const activity of activities) {
			const right = getShelterActivityPose({ activity, elapsedMs: 500, phase: .8, facing: 1 });
			const left = getShelterActivityPose({ activity, elapsedMs: 500, phase: .8, facing: -1 });
			expect(left.bodyTilt).toBe(-right.bodyTilt);
			expect(left.handX).toBe(-right.handX);
			expect(left.toolX).toBe(-right.toolX);
			expect(left.toolAngle).toBe(-right.toolAngle);
			expect(left.toolY).toBe(right.toolY);
			expect(left.cargoKind).toBe(right.cargoKind);
		}
	});

	test("reduced motion keeps useful work silhouettes without continuous animation", () => {
		for (const activity of activities) {
			const input = { activity, reducedMotion: true, phase: .7 };
			expect(getShelterActivityPose({ ...input, elapsedMs: 0 })).toEqual(getShelterActivityPose({ ...input, elapsedMs: 30_000 }));
		}
		expect(getShelterActivityPose({ activity: "sweep", reducedMotion: true, elapsedMs: 0 }).toolKind).toBe("broom");
	});

	test("activity sampling is deterministic, independent between people and leaves inputs untouched", () => {
		const input = { activity: "sweep" as const, elapsedMs: 420, phase: .6, facing: -1 as const }, before = { ...input };
		const first = getShelterActivityPose(input);
		expect(getShelterActivityPose(input)).toEqual(first);
		expect(getShelterActivityPose({ ...input, phase: 2 })).not.toEqual(first);
		expect(input).toEqual(before);
		expect(getShelterActivityPose({ elapsedMs: 1000 }).toolKind).toBe("none");
	});
});
