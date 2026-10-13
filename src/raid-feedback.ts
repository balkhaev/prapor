import type { RaidFieldAction, RaidFieldFrame, RaidFieldPlan, RaidFieldPoint } from "./raid-field";
import type { ShelterCamera, ShelterViewport } from "./shelter-camera";

export interface RaidActionAlert { label: string; action: RaidFieldAction; remainingMs: number }
export interface RaidFeedbackState {
	raidId: string; planId: string; segment: number; action: RaidFieldAction;
	alert: RaidActionAlert | null; burstElapsedMs: number;
}
export interface RaidShotCue { hostile: boolean; strength: number }
export const RAID_ALERT_DURATION_MS = 2200;
export const RAID_BURST_DURATION_MS = 900;
const ACTION_LABELS: Record<RaidFieldAction, string> = {
	move: "ПЕРЕХОД", cover: "УКРЫТИЕ", search: "ОСМОТР", skirmish: "ОГНЕВОЙ КОНТАКТ", extract: "К ТОЧКЕ СВЯЗИ", checkpoint: "НА СВЯЗИ",
};
export const getRaidActionLabel = (action: RaidFieldAction) => ACTION_LABELS[action];
const elapsed = (value: number) => Number.isFinite(value) && value > 0 ? value : 0;

/** Initial observation primes the cursor; returning to a raid never replays old contacts. */
export function advanceRaidFeedback(previous: RaidFeedbackState | null, input: {
	raidId: string; planId: string; frame: Pick<RaidFieldFrame, "segmentIndex" | "action" | "paused" | "label">;
	deltaMs: number; reducedMotion: boolean; settled?: boolean;
}): { state: RaidFeedbackState; transition: RaidActionAlert | null; shot: RaidShotCue | null } {
	const { frame } = input, delta = elapsed(input.deltaMs);
	const sameRaid = previous?.raidId === input.raidId;
	const changed = Boolean(sameRaid && (previous!.planId !== input.planId || previous!.segment !== frame.segmentIndex || previous!.action !== frame.action));
	let alert = sameRaid && previous!.alert && previous!.alert.remainingMs > delta ? { ...previous!.alert, remainingMs: previous!.alert.remainingMs - delta } : null;
	const transition = changed && !input.settled ? { label: frame.label, action: frame.action, remainingMs: RAID_ALERT_DURATION_MS } : null;
	if (transition) alert = { ...transition };
	if (input.settled) alert = null;
	let burstElapsedMs = !sameRaid || changed ? RAID_BURST_DURATION_MS : Math.min(RAID_BURST_DURATION_MS, previous!.burstElapsedMs + delta);
	if (transition && frame.action === "skirmish" && !frame.paused && !input.reducedMotion) burstElapsedMs = 0;
	if (frame.action !== "skirmish" || frame.paused || input.settled || input.reducedMotion) burstElapsedMs = RAID_BURST_DURATION_MS;
	let shot: RaidShotCue | null = null;
	for (const [start, hostile] of [[0, false], [330, true], [700, false]] as const) {
		if (burstElapsedMs >= start && burstElapsedMs < start + 75) shot = { hostile, strength: 1 - (burstElapsedMs - start) / 75 };
	}
	return { state: { raidId: input.raidId, planId: input.planId, segment: frame.segmentIndex, action: frame.action, alert, burstElapsedMs }, transition, shot };
}

/** A short preview ends on this live segment, with no unrevealed target or future branch. */
export function getRaidRoutePreview(plan: RaidFieldPlan, frame: RaidFieldFrame, maxDistance = 4): RaidFieldPoint[] {
	if (!frame.walking || frame.paused || !Number.isFinite(maxDistance) || maxDistance <= 0) return [];
	const path = plan.segments[frame.segmentIndex]?.path;
	if (!path || path.length < 2) return [];
	const distances = path.slice(1).map((point, index) => Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y));
	const travelled = distances.reduce((sum, distance) => sum + distance, 0) * Math.max(0, Math.min(1, frame.segmentProgress));
	let distanceBefore = 0, edge = 0;
	while (edge < distances.length - 1 && distanceBefore + distances[edge]! <= travelled) { distanceBefore += distances[edge]!; edge++; }
	const result: RaidFieldPoint[] = [{ ...frame.position }];
	let budget = maxDistance;
	for (const point of path.slice(edge + 1)) {
		const before = result.at(-1)!, distance = Math.hypot(point.x - before.x, point.y - before.y);
		if (distance < .0001) continue;
		if (distance > budget) {
			result.push({ x: before.x + (point.x - before.x) * budget / distance, y: before.y + (point.y - before.y) * budget / distance });
			break;
		}
		result.push({ ...point }); budget -= distance;
		if (budget <= .0001) break;
	}
	return result.length > 1 ? result : [];
}

/** Pixel deadzones remove sub-pixel pawn jitter while explicit framing still snaps once. */
export function followRaidCamera(camera: ShelterCamera, pawn: { x: number; y: number }, viewport: ShelterViewport, deltaMs: number, snap = false, reducedMotion = false): ShelterCamera {
	if (![camera.zoom, camera.x, camera.y, pawn.x, pawn.y, viewport.width, viewport.height].every(Number.isFinite) || camera.zoom <= 0 || viewport.width <= 0 || viewport.height <= 0) return { ...camera };
	const target = { x: pawn.x - viewport.width / camera.zoom * .46, y: pawn.y - viewport.height / camera.zoom * .58 };
	if (snap) return { zoom: camera.zoom, ...target };
	const amount = reducedMotion ? 1 : 1 - Math.exp(-Math.min(elapsed(deltaMs), 100) / 190);
	const adjust = (position: number, goal: number, pixels: number) => {
		const error = goal - position, deadzone = pixels / camera.zoom;
		return Math.abs(error) <= deadzone ? position : position + (error - Math.sign(error) * deadzone) * amount;
	};
	return { zoom: camera.zoom, x: adjust(camera.x, target.x, 9), y: adjust(camera.y, target.y, 7) };
}
