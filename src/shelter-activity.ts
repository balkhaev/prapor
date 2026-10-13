import type { ShelterRoutineActivity, ShelterRoutineCargo } from "./shelter-routines";

export type ShelterActivityTool = "none" | "cup" | "crate" | "broom" | "hammer";
export interface ShelterActivityPoseInput {
	activity?: ShelterRoutineActivity | null;
	elapsedMs: number;
	phase?: number;
	walking?: boolean;
	facing?: -1 | 1;
	cargo?: ShelterRoutineCargo;
	reducedMotion?: boolean;
}
export interface ShelterActivityPose {
	/** Screen-space offsets; angles are degrees. The actor's ground position never changes. */
	bodyTilt: number;
	bodyLift: number;
	handX: number;
	handY: number;
	toolX: number;
	toolY: number;
	toolAngle: number;
	toolKind: ShelterActivityTool;
	cargoKind: "none" | ShelterRoutineCargo;
	workCycle: number;
	stance: "relaxed" | "carry" | "work" | "walk";
}

/** Ambient chores use their own bounded poses and never advance production or gameplay state. */
export function getShelterActivityPose(input: ShelterActivityPoseInput): ShelterActivityPose {
	const time = Number.isFinite(input.elapsedMs) ? Math.max(0, input.elapsedMs) : 0;
	const phase = Number.isFinite(input.phase) ? input.phase! : 0;
	const facing = input.facing === -1 ? -1 : 1;
	const cycle = (period: number) => input.reducedMotion ? .5 : (Math.sin(time / period * Math.PI * 2 + phase) + 1) / 2;
	const pose: ShelterActivityPose = {
		bodyTilt: 0, bodyLift: 0, handX: 0, handY: 0, toolX: 0, toolY: 0, toolAngle: 0,
		toolKind: "none", cargoKind: "none", workCycle: 0, stance: input.walking ? "walk" : "relaxed",
	};
	// People put chore tools away on the approach. Supplies are carried to their destination.
	if (input.walking && input.activity !== "carry") return pose;
	switch (input.activity) {
		case "carry": {
			const work = input.walking ? .3 : cycle(2300);
			pose.stance = "carry"; pose.toolKind = "crate"; pose.cargoKind = input.cargo === "firewood" ? "firewood" : "crate";
			pose.workCycle = work; pose.bodyTilt = input.walking ? 2 : 2 + work * 4;
			pose.handX = 4 + work * 2; pose.handY = -2 + work * 3;
			pose.toolX = 4 + work * 2; pose.toolY = -2 + work * 5;
			pose.toolAngle = input.walking ? 0 : (work - .5) * 6;
			break;
		}
		case "sweep": {
			const work = cycle(1700);
			pose.stance = "work"; pose.toolKind = "broom"; pose.workCycle = work;
			pose.bodyTilt = 1 + work * 3.5; pose.handX = 2 + work * 3; pose.handY = work * 2;
			pose.toolX = 3 + work * 4; pose.toolY = 2 + work * 2; pose.toolAngle = -22 + work * 40;
			break;
		}
		case "maintain": {
			const work = cycle(1150);
			pose.stance = "work"; pose.toolKind = "hammer"; pose.workCycle = work;
			pose.bodyTilt = 2 + work * 3; pose.handX = 2 + work * 2; pose.handY = -5 + work * 5;
			pose.toolX = 2 + work * 3; pose.toolY = -6 + work * 5; pose.toolAngle = -36 + work * 59;
			break;
		}
		case "warm":
		case "rest":
		case "chat": {
			const breath = cycle(4300) - .5;
			pose.toolKind = "cup";
			pose.bodyTilt = input.activity === "warm" ? 1.2 : input.activity === "chat" ? breath * 1.1 : -.7;
			pose.handY = input.activity === "chat" ? breath * 1.5 : -.8;
			pose.toolY = pose.handY;
			pose.toolAngle = input.activity === "chat" ? breath * 8 : -4;
			break;
		}
		case "inspect": {
			const work = cycle(2900);
			pose.workCycle = work; pose.bodyTilt = 1.5 + work * 1.5; pose.handX = 1 + work; pose.handY = -1;
			break;
		}
	}
	pose.bodyTilt *= facing; pose.handX *= facing; pose.toolX *= facing; pose.toolAngle *= facing;
	return pose;
}
