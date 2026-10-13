import {
	getShelterBuildingPosition, getShelterBuildingRect, getShelterOpenGroundPoints,
	getShelterTerritoryRects, getShelterWalkingRoute, type ShelterLayoutBuilding, type ShelterLayoutSite,
} from "./shelter-layout";
import type { ShelterLandscapeDecoration } from "./shelter-landscape";
import type { ShelterPoint } from "./shelter-motion";

export type ShelterRoutineActivity = "rest" | "warm" | "inspect" | "lookout" | "chat" | "stroll" | "carry" | "sweep" | "maintain";
export type ShelterRoutineCargo = "crate" | "firewood";
export interface ShelterRoutine {
	point: ShelterPoint;
	activity: ShelterRoutineActivity;
	label: string;
	dwellMs: number;
	lookAt?: ShelterPoint;
	cargo?: ShelterRoutineCargo;
}
export interface ShelterRoutineInput {
	scavId: string;
	personality?: string;
	visit: number;
	sites: readonly ShelterLayoutSite[];
	buildings: readonly ShelterLayoutBuilding[];
	decorations: readonly ShelterLandscapeDecoration[];
	from: ShelterPoint;
	reservedTargets?: readonly ShelterPoint[];
}

const MAX_CANDIDATES = 128;
const PERSON_SPACE = 18;
const BUILDING_CLEARANCE = 8;
const PROP_CLEARANCE = 7;
const SOLID_PROPS = new Set<string>(["bench", "barrels", "camp", "logs", "woodpile", "stump", "tree", "rock", "bush", "lamp"]);
const ACTIVITIES: readonly ShelterRoutineActivity[] = ["rest", "warm", "inspect", "lookout", "chat", "stroll", "carry", "sweep", "maintain"];
const LABELS: Record<ShelterRoutineActivity, string> = {
	rest: "Отдыхает", warm: "Греется у костра", inspect: "Проверяет припасы",
	lookout: "Осматривает окрестности", chat: "Общается", stroll: "Прогуливается",
	carry: "Раскладывает припасы", sweep: "Подметает двор", maintain: "Занимается мелким ремонтом",
};
const DWELL: Record<ShelterRoutineActivity, readonly [number, number]> = {
	rest: [18000, 35000], warm: [14000, 29000], inspect: [9000, 17000],
	lookout: [15000, 30000], chat: [18000, 33000], stroll: [4000, 8000],
	carry: [8500, 14500], sweep: [10000, 18500], maintain: [12000, 20500],
};
const finitePoint = (point: ShelterPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (a: ShelterPoint, b: ShelterPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const pointKey = (point: ShelterPoint) => `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
function hash(value: string): number {
	let seed = 2166136261;
	for (let i = 0; i < value.length; i++) seed = Math.imul(seed ^ value.charCodeAt(i), 16777619);
	seed ^= seed >>> 16; seed = Math.imul(seed, 0x85ebca6b); seed ^= seed >>> 13;
	return seed >>> 0;
}
function distanceToSegment(point: ShelterPoint, from: ShelterPoint, to: ShelterPoint): number {
	const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
	const t = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length)) : 0;
	return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}
interface Candidate { point: ShelterPoint; activity: ShelterRoutineActivity; lookAt?: ShelterPoint; anchor: string; cargo?: ShelterRoutineCargo }
interface RoutinePlan { candidates: Candidate[]; seed: number; preferred: ShelterRoutineActivity; reachable: (candidate: Candidate) => boolean }

function prepareRoutine(input: ShelterRoutineInput): RoutinePlan | null {
	if (!finitePoint(input.from) || !input.sites.length) return null;
	const sites = [...new Map(input.sites.filter((site) => Number.isSafeInteger(site.column) && Number.isSafeInteger(site.row))
		.map((site) => [`${site.column}:${site.row}`, { column: site.column, row: site.row }])).values()].sort((a, b) => a.row - b.row || a.column - b.column);
	const lots = getShelterTerritoryRects(sites);
	// Explicit origins select continuous routing for legacy rooms as well as moved buildings.
	const buildings = input.buildings.map((building) => ({ ...building, position: getShelterBuildingPosition(building) }));
	const rects = buildings.map(getShelterBuildingRect);
	const decorations = input.decorations.filter((prop) => finitePoint(prop.point) && Number.isFinite(prop.radius) && prop.radius >= 0);
	const solids = decorations.filter((prop) => SOLID_PROPS.has(prop.kind));
	const reserved = (input.reservedTargets ?? []).filter(finitePoint);
	const owned = (point: ShelterPoint) => lots.some((rect) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
	const safePoint = (point: ShelterPoint) => finitePoint(point)
		&& [[0, 0], [-4, -4], [4, -4], [-4, 4], [4, 4]].every(([dx, dy]) => owned({ x: point.x + dx!, y: point.y + dy! }))
		&& rects.every((rect) => Math.hypot(Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width), Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height)) >= BUILDING_CLEARANCE)
		&& solids.every((prop) => distance(point, prop.point) >= prop.radius + PROP_CLEARANCE)
		&& reserved.every((other) => distance(point, other) >= PERSON_SPACE);
	const candidates: Candidate[] = [];
	const keys = new Set<string>();
	const add = (point: ShelterPoint, activity: ShelterRoutineActivity, anchor: string, lookAt?: ShelterPoint, cargo?: ShelterRoutineCargo) => {
		if (candidates.length >= MAX_CANDIDATES || !safePoint(point)) return;
		const key = `${activity}:${pointKey(point)}`;
		if (keys.has(key)) return;
		keys.add(key); candidates.push({ point, activity, anchor, ...(lookAt ? { lookAt } : {}), ...(cargo ? { cargo } : {}) });
	};
	const visit = Number.isFinite(input.visit) ? Math.max(0, Math.floor(input.visit)) : 0;
	const identity = `${input.scavId}:${input.personality ?? ""}`;
	const seed = hash(`${identity}:${visit}`);
	// Sorting props prevents a polling response's object order from changing the routine.
	const anchors = decorations.filter((prop) => prop.owned && owned(prop.point) && ["camp", "bench", "barrels", "gate", "woodpile", "logs"].includes(prop.kind)
		&& !rects.some((rect) => prop.point.x > rect.x && prop.point.x < rect.x + rect.width && prop.point.y > rect.y && prop.point.y < rect.y + rect.height))
		.sort((a, b) => a.kind.localeCompare(b.kind) || a.point.y - b.point.y || a.point.x - b.point.x).slice(0, 12);
	for (const prop of anchors) {
		const anchor = `${prop.kind}:${pointKey(prop.point)}`, radius = prop.radius + PROP_CLEARANCE + 5;
		if (prop.kind === "gate") {
			// Stand behind the entrance rather than in the street or in the open gate leaves.
			for (const dx of [-16, 16]) add({ x: prop.point.x + dx, y: prop.point.y + 27 }, "lookout", anchor, { x: prop.point.x, y: prop.point.y - 28 });
			continue;
		}
		const activity = prop.kind === "camp" ? "warm" : prop.kind === "bench" ? "rest" : "inspect";
		const partner = reserved.find((point) => distance(point, prop.point) <= prop.radius + 48);
		for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
			const point = { x: prop.point.x + dx! * radius, y: prop.point.y + dy! * radius };
			add(point, activity, anchor, prop.point);
			if (["barrels", "woodpile", "logs"].includes(prop.kind)) add(point, "carry", anchor, prop.point, prop.kind === "barrels" ? "crate" : "firewood");
			if (prop.kind === "bench") add(point, "maintain", anchor, prop.point);
			if (prop.kind === "camp" || prop.kind === "bench") {
				// Sweep beside gathering places, outside both the prop and its walking margin.
				const sweepPoint = { x: prop.point.x + dx! * (radius + 12), y: prop.point.y + dy! * (radius + 12) };
				add(sweepPoint, "sweep", anchor, point);
				if (partner) add(point, "chat", anchor, partner);
			}
		}
	}
	// Someone already waiting at a gathering spot gives a second person a natural partner.
	for (const partner of reserved.slice(0, 6)) {
		if (!anchors.some((prop) => prop.kind !== "gate" && distance(partner, prop.point) <= prop.radius + 48)) continue;
		for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) add({ x: partner.x + dx! * 24, y: partner.y + dy! * 24 }, "chat", `partner:${pointKey(partner)}`, partner);
	}
	const clearings = getShelterOpenGroundPoints(sites, buildings);
	for (const clearing of clearings.slice(0, 20)) {
		const anchor = `ground:${pointKey(clearing)}`;
		// Small offsets keep people apart without manufacturing another visible placement grid.
		const offset = hash(`${identity}:${anchor}`), angle = offset / 4294967296 * Math.PI * 2;
		add({ x: clearing.x + Math.cos(angle) * 9, y: clearing.y + Math.sin(angle) * 9 }, "stroll", anchor);
		add(clearing, "stroll", anchor);
		add({ x: clearing.x + Math.cos(angle) * 9, y: clearing.y + Math.sin(angle) * 9 }, "sweep", anchor, clearing);
		add(clearing, "sweep", anchor, { x: clearing.x + 3, y: clearing.y + 2 });
	}
	if (!candidates.length) return null;
	const reachable = (candidate: Candidate) => {
		const route = getShelterWalkingRoute(input.from, candidate.point, sites, buildings);
		if (distance(input.from, candidate.point) > .01 && (!route.length || distance(route.at(-1)!, candidate.point) > .01)) return false;
		let previous = input.from;
		for (const next of route) {
			if (solids.some((prop) => distanceToSegment(prop.point, previous, next) < prop.radius + 3)) return false;
			previous = next;
		}
		return true;
	};
	// Each person has a stable order of available activities. A visit advances that
	// order instead of randomly choosing the same stop and chore again and again.
	const cycle = ACTIVITIES.filter((activity) => candidates.some((candidate) => candidate.activity === activity))
		.sort((a, b) => hash(`${identity}:cycle:${a}`) - hash(`${identity}:cycle:${b}`) || a.localeCompare(b));
	return { candidates, seed, preferred: cycle[visit % cycle.length]!, reachable };
}

function routineFor(candidate: Candidate, seed: number): ShelterRoutine {
	const [min, max] = DWELL[candidate.activity], dwellSeed = hash(`${seed}:dwell:${candidate.anchor}`);
	return {
		point: { ...candidate.point }, activity: candidate.activity, label: candidate.cargo === "firewood" ? "Складывает дрова" : LABELS[candidate.activity],
		dwellMs: min + dwellSeed % (max - min + 1), ...(candidate.lookAt ? { lookAt: { ...candidate.lookAt } } : {}),
		...(candidate.cargo ? { cargo: candidate.cargo } : {}),
	};
}

/** Idle routines are local visual choices: they never consume the game's RNG or change a save. */
export function getShelterRoutine(input: ShelterRoutineInput): ShelterRoutine | null {
	const plan = prepareRoutine(input);
	if (!plan) return null;
	const { seed, candidates, preferred } = plan;
	const personalityPreference: Record<string, ShelterRoutineActivity> = { veteran: "warm", collector: "inspect", careful: "lookout", runner: "stroll" };
	const favourite = personalityPreference[input.personality ?? ""];
	const score = (candidate: Candidate) => {
		const variation = hash(`${seed}:${candidate.activity}:${candidate.anchor}:${pointKey(candidate.point)}`) / 4294967296;
		const socialPartner = candidate.anchor.startsWith("partner:") ? .7 : 0;
		return (candidate.activity === preferred ? 4 : 0) + (candidate.activity === favourite ? .8 : 0) + socialPartner + variation
			- Math.min(distance(input.from, candidate.point), 700) / 1400;
	};
	candidates.sort((a, b) => score(b) - score(a));
	for (const candidate of candidates) if (plan.reachable(candidate)) return routineFor(candidate, seed);
	return null;
}

/** Restore only a still-valid outdoor activity; presentation text and facing targets are rebuilt. */
export function restoreShelterRoutine(input: ShelterRoutineInput, saved: unknown): ShelterRoutine | null {
	if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
	const value = saved as Record<string, unknown>, rawPoint = value.point;
	if (typeof value.activity !== "string" || !ACTIVITIES.includes(value.activity as ShelterRoutineActivity)
		|| !rawPoint || typeof rawPoint !== "object" || Array.isArray(rawPoint)) return null;
	const point = rawPoint as Record<string, unknown>;
	if (typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
	const plan = prepareRoutine(input);
	if (!plan) return null;
	const candidate = plan.candidates.find((item) => item.activity === value.activity && distance(item.point, { x: point.x as number, y: point.y as number }) < .01);
	return candidate && plan.reachable(candidate) ? routineFor(candidate, plan.seed) : null;
}
