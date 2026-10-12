export interface ScavAnimationState {
	/** Unwrapped stride cycles; the renderer wraps only when evaluating a pose. */
	stride: number;
	walkBlend: number;
	workBlend: number;
	facing: number;
	idleSeconds: number;
	observedWork: number;
	observedJob: string | null;
	workAgeMs: number;
	workCursor: number;
}
export interface ScavAnimationInput {
	distance: number;
	elapsedMs: number;
	walking: boolean;
	working: boolean;
	facing: -1 | 1;
	role: string;
	/** Work-seconds, normalized from the engine's micro-work units by the caller. */
	workDone: number;
	/** Work-seconds per real second. Zero means production is paused. */
	workRate: number;
	jobId: string | null;
	stage?: "preparation" | "assembly" | "inspection" | "complete" | "idle" | "construction";
	stageProgress?: number;
	reducedMotion?: boolean;
	paused?: boolean;
}
export interface ScavAnimationPose {
	weights: { idle: number; walkA: number; walkB: number; work: number };
	scaleX: number;
	scaleY: number;
	angle: number;
	handAngle: number;
	toolX: number;
	toolY: number;
	toolAngle: number;
}
export const SCAV_STRIDE_DISTANCE = 28;
export const MAX_SCAV_WORK_INTERPOLATION_MS = 1000;
const TAU = Math.PI * 2;
const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const smooth = (from: number, target: number, ms: number, response: number) => target + (from - target) * Math.exp(-ms / response);
const smoothstep = (value: number) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

export function createScavAnimation(seed = 0, facing: -1 | 1 = 1): ScavAnimationState {
	return { stride: finite(seed), walkBlend: 0, workBlend: 0, facing: facing === -1 ? -1 : 1, idleSeconds: finite(seed), observedWork: 0, observedJob: null, workAgeMs: 0, workCursor: 0 };
}

function poseFor(state: ScavAnimationState, input: ScavAnimationInput): ScavAnimationPose {
	const reduced = Boolean(input.reducedMotion), walking = reduced ? 0 : state.walkBlend, working = reduced ? input.working ? 1 : 0 : state.workBlend;
	const stride = (state.stride % 1) * TAU;
	// Most of the stride keeps one crisp atlas silhouette. Only the short
	// contact crossing mixes two co-located poses sharing the same feet anchor.
	const otherFoot = smoothstep((Math.sin(stride) + .18) / .36);
	const movingWeight = walking * (1 - working);
	const weights = { idle: (1 - walking) * (1 - working), walkA: movingWeight * (1 - otherFoot), walkB: movingWeight * otherFoot, work: working };
	const period = input.role === "ammo" ? 1.15 : input.role === "recycler" ? 1.6 : input.role === "medbay" ? 3.2 : input.role === "radio" ? 4.8 : 2.1;
	const stage = input.stage ?? "assembly", careful = stage === "inspection", preparation = stage === "preparation";
	const stageProgress = clamp(finite(input.stageProgress ?? 0), 0, 1);
	const wave = reduced ? 0 : Math.sin((state.workCursor / period % 1) * TAU) * (careful ? .35 : preparation ? .6 : 1);
	const second = reduced ? 0 : Math.cos((state.workCursor / period % 1) * TAU) * (careful ? .35 : preparation ? .6 : 1);
	const workLean = input.role === "recycler" ? 1.2 + wave * 2.3 : input.role === "ammo" ? .5 + wave * 1.1 : input.role === "medbay" ? .8 + wave * .4 : input.role === "radio" ? .3 + wave * .25 : .6 + wave * .9;
	const idle = reduced ? 0 : Math.sin((state.idleSeconds % (TAU / .7)) * .7) * .13 * weights.idle;
	const angle = reduced ? 0 : (1 + Math.sin(stride) * .55) * movingWeight + workLean * working + idle;
	const scaleY = reduced ? 1 : 1 - (1 - Math.cos(stride * 2)) * .0045 * movingWeight - (wave + 1) * .002 * working + Math.sin((state.idleSeconds % (TAU / 1.1)) * 1.1) * .0015 * weights.idle;
	let toolX = 13, toolY = -21, toolAngle = -40;
	if (input.role === "ammo") { toolX += wave * .4; toolY += second * 2.2; toolAngle = -45 + wave * 10; }
	else if (input.role === "recycler") { toolX += wave * 2.4; toolY += second * 1.4; toolAngle = -32 + wave * 25; }
	else if (input.role === "medbay") { toolX += wave * .8; toolY += second * .5; toolAngle = -22 + wave * 5; }
	else if (input.role === "radio") { toolX += wave * .3; toolY += second * .3; toolAngle = -90 + wave * 4; }
	else { toolX += wave * 1.3; toolY += second * .8; toolAngle = -42 + wave * 16; }
	if (preparation) { toolX -= 2.1 * (1 - stageProgress * .35); toolY += 1.5; toolAngle += 13; }
	if (careful) { toolX += 1.1 + stageProgress * .3; toolY -= 1.4 + stageProgress * .4; toolAngle -= 12; }
	return { weights, scaleX: reduced ? input.facing === -1 ? -1 : 1 : state.facing, scaleY, angle, handAngle: input.working ? toolAngle : reduced ? 0 : Math.sin(stride) * 16 * movingWeight, toolX, toolY, toolAngle };
}

/** View-only animation: distance drives gait; no engine, routes or saved resources are changed. */
export function advanceScavAnimation(previous: ScavAnimationState, input: ScavAnimationInput): { state: ScavAnimationState; pose: ScavAnimationPose } {
	const elapsed = Math.max(0, finite(input.elapsedMs)), reduced = Boolean(input.reducedMotion);
	const facing = input.facing === -1 ? -1 : 1;
	const state: ScavAnimationState = { ...previous, stride: finite(previous.stride), walkBlend: clamp(finite(previous.walkBlend), 0, 1), workBlend: clamp(finite(previous.workBlend), 0, 1), facing: clamp(finite(previous.facing, 1), -1, 1), idleSeconds: finite(previous.idleSeconds), observedWork: Math.max(0, finite(previous.observedWork)), workAgeMs: clamp(finite(previous.workAgeMs), 0, MAX_SCAV_WORK_INTERPOLATION_MS), workCursor: Math.max(0, finite(previous.workCursor)) };
	if (!input.paused) {
		if (reduced) { state.walkBlend = 0; state.workBlend = input.working ? 1 : 0; state.facing = facing; }
		else {
			if (input.walking) state.stride = finite(state.stride + Math.max(0, finite(input.distance)) / SCAV_STRIDE_DISTANCE, state.stride);
			state.walkBlend = smooth(state.walkBlend, input.walking && !input.working ? 1 : 0, elapsed, input.walking ? 110 : 140);
			state.workBlend = smooth(state.workBlend, input.working ? 1 : 0, elapsed, 180);
			state.facing = smooth(state.facing, facing, elapsed, 65);
			state.idleSeconds = finite(state.idleSeconds + elapsed / 1000, state.idleSeconds);
		}
		const observed = Math.max(0, finite(input.workDone));
		if (state.observedJob !== input.jobId || observed !== state.observedWork) { state.observedWork = observed; state.observedJob = input.jobId; state.workAgeMs = 0; }
		else if (!reduced && input.working && input.jobId && input.workRate > 0) state.workAgeMs = Math.min(MAX_SCAV_WORK_INTERPOLATION_MS, state.workAgeMs + elapsed);
		if (input.working && input.jobId && input.workRate > 0) state.workCursor = finite(state.observedWork + (reduced ? 0 : state.workAgeMs / 1000 * Math.max(0, finite(input.workRate))), state.observedWork);
	}
	return { state, pose: poseFor(state, input) };
}
