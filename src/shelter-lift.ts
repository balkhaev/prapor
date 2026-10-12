import { SHELTER_FLOOR_Y } from "./shelter-motion";

export interface LiftRequest { id: string; from: number; to: number }
export type LiftPhase = "idle" | "pickup" | "boarding" | "travel" | "alighting";
export interface ShelterLiftState {
	y: number;
	phase: LiftPhase;
	passengerId: string | null;
	doorOpen: boolean;
	trip: LiftRequest | null;
	queue: LiftRequest[];
	remainingMs: number;
	targetY: number;
	cancelledTrip: boolean;
	completed: LiftRequest[];
}
export interface ShelterLiftAdvance {
	state: ShelterLiftState;
	boarded: string[];
	dropped: { id: string; to: number; cancelled: boolean }[];
	cancelled: string[];
}

export const SHELTER_LIFT_SPEED = 78;
export const SHELTER_LIFT_BOARD_MS = 300;
export const SHELTER_LIFT_ALIGHT_MS = 250;
const EPSILON = 1e-7;
const copyRequest = (request: LiftRequest): LiftRequest => ({ ...request });
const sameRequest = (a: LiftRequest, b: LiftRequest) => a.id === b.id && a.from === b.from && a.to === b.to;
function nearestFloor(y: number): number {
	return SHELTER_FLOOR_Y.reduce<number>((nearest, floor) => Math.abs(floor - y) < Math.abs(nearest - y) ? floor : nearest, 228);
}
function canonicalFloor(y: number): number | null {
	return Number.isFinite(y) ? SHELTER_FLOOR_Y.find((floor) => Math.abs(floor - y) < EPSILON) ?? null : null;
}

export function createShelterLift(y = 228): ShelterLiftState {
	const floor = nearestFloor(Number.isFinite(y) ? y : 228);
	return { y: floor, phase: "idle", passengerId: null, doorOpen: false, trip: null,
		queue: [], remainingMs: 0, targetY: floor, cancelledTrip: false, completed: [] };
}

/** One shared time budget drives the cabin; a rider exists only after boarding at a floor. */
export function advanceShelterLift(previous: ShelterLiftState, requests: readonly LiftRequest[], elapsedMs: number): ShelterLiftAdvance {
	const state: ShelterLiftState = { ...previous, trip: previous.trip ? copyRequest(previous.trip) : null,
		queue: previous.queue.map(copyRequest), completed: previous.completed.map(copyRequest) };
	const result: ShelterLiftAdvance = { state, boarded: [], dropped: [], cancelled: [] };
	const current = new Map<string, LiftRequest>();
	for (const request of requests) {
		if (typeof request.id !== "string" || !request.id || current.has(request.id)) continue;
		const to = canonicalFloor(request.to);
		// A boarded actor is already attached to the car, so a changed destination
		// never replaces its physical position with a new caller's pickup value.
		const from = state.passengerId === request.id && state.trip ? state.trip.from : canonicalFloor(request.from);
		if (from === null || to === null || from === to && state.passengerId !== request.id) continue;
		current.set(request.id, { id: request.id, from, to });
	}
	state.completed = state.completed.filter((done) => {
		const live = current.get(done.id); return Boolean(live && sameRequest(live, done));
	});

	if (state.trip && state.phase !== "alighting" && !state.cancelledTrip) {
		const live = current.get(state.trip.id);
		if (!live || state.passengerId === null && live.from !== state.trip.from) {
			result.cancelled.push(state.trip.id);
			state.targetY = nearestFloor(state.y);
			if (state.passengerId) {
				state.cancelledTrip = true;
				state.trip.to = state.targetY;
				state.phase = "travel";
			} else {
				state.trip = null;
				state.cancelledTrip = false;
				state.phase = "pickup";
			}
			state.doorOpen = false;
			state.remainingMs = Math.abs(state.targetY - state.y) / SHELTER_LIFT_SPEED * 1000;
		} else if (live) {
			state.trip.to = live.to;
			if (state.passengerId) state.targetY = live.to;
		}
	}

	function syncQueue() {
		state.queue = state.queue.filter((waiting) => {
			const live = current.get(waiting.id);
			return Boolean(live && sameRequest(live, waiting) && state.trip?.id !== waiting.id
				&& !state.completed.some((done) => sameRequest(done, waiting)));
		});
		for (const live of current.values()) {
			if (state.trip?.id === live.id || state.queue.some((waiting) => waiting.id === live.id)
				|| state.completed.some((done) => sameRequest(done, live))) continue;
			state.queue.push(copyRequest(live));
		}
	}
	syncQueue();
	let budget = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
	while (true) {
		if (state.phase === "idle") {
			syncQueue();
			const next = state.queue.shift();
			if (!next) break;
			state.trip = next;
			state.cancelledTrip = false;
			state.targetY = next.from;
			state.phase = "pickup";
			state.doorOpen = false;
		}
		if (state.phase === "pickup" || state.phase === "travel") {
			const duration = Math.abs(state.targetY - state.y) / SHELTER_LIFT_SPEED * 1000;
			state.remainingMs = duration;
			if (budget + EPSILON < duration) {
				state.y += Math.sign(state.targetY - state.y) * SHELTER_LIFT_SPEED * budget / 1000;
				state.remainingMs = duration - budget;
				break;
			}
			state.y = state.targetY;
			budget = Math.max(0, budget - duration);
			state.remainingMs = 0;
			if (state.phase === "pickup") {
				if (!state.trip) { state.phase = "idle"; continue; }
				state.phase = "boarding";
				state.remainingMs = SHELTER_LIFT_BOARD_MS;
				state.doorOpen = true;
			} else {
				if (state.trip && state.passengerId) {
					result.dropped.push({ id: state.passengerId, to: state.y, cancelled: state.cancelledTrip });
					state.completed.push(copyRequest(state.trip));
				}
				state.passengerId = null;
				state.phase = "alighting";
				state.remainingMs = SHELTER_LIFT_ALIGHT_MS;
				state.doorOpen = true;
			}
		}
		if (state.phase === "boarding" || state.phase === "alighting") {
			if (budget + EPSILON < state.remainingMs) { state.remainingMs -= budget; break; }
			budget = Math.max(0, budget - state.remainingMs);
			state.remainingMs = 0;
			state.doorOpen = false;
			if (state.phase === "boarding" && state.trip) {
				state.passengerId = state.trip.id;
				result.boarded.push(state.passengerId);
				state.targetY = state.trip.to;
				state.phase = "travel";
			} else {
				state.trip = null;
				state.cancelledTrip = false;
				state.phase = "idle";
			}
		}
	}
	return result;
}
