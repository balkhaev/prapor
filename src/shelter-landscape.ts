import type Phaser from "phaser";
import type { ShelterRect } from "./shelter-camera";
import { getShelterBuildingRect, getShelterCorridorSegments, getShelterOpenGroundPoints, getShelterRoomDoor, getShelterRoomEntranceDirection, getShelterTerritoryCell, getShelterWalkingRoute, type ShelterCorridorSegment, type ShelterLayoutBuilding, type ShelterLayoutSite } from "./shelter-layout";
import { projectShelterPoint, shelterRoomPosition, SHELTER_COLUMN_STRIDE, SHELTER_ROW_STRIDE } from "./shelter-isometric";
import type { ShelterPoint } from "./shelter-motion";

export interface ShelterLandscapeEdge extends ShelterCorridorSegment { side: "north" | "south" | "east" | "west" }
export interface ShelterLandscapeDecoration {
	kind: "tree" | "bush" | "rock" | "camp" | "bench" | "barrels" | "lamp" | "gate";
	point: ShelterPoint;
	seed: number;
	radius: number;
	owned: boolean;
}
export interface ShelterLandscapeApron { points: ShelterPoint[]; seed: number }
export interface ShelterLandscape {
	sites: ShelterLayoutSite[];
	lots: ShelterRect[];
	perimeter: ShelterLandscapeEdge[];
	paths: ShelterCorridorSegment[];
	aprons: ShelterLandscapeApron[];
	decorations: ShelterLandscapeDecoration[];
}
const ENTRANCE = { x: 318, y: 132 };
const C = {
	forest: 0x203e31, forestLight: 0x345140, grass: 0x617454, grassLight: 0x7d8c5d,
	grassDark: 0x4c654b, soil: 0x928467, gravel: 0xb1a18a, pale: 0xdfd2ae,
	ink: 0x223d32, bark: 0x82694a, wood: 0xb79768, steel: 0x748979,
};
const key = (site: ShelterLayoutSite) => `${site.column}:${site.row}`;
const hash = (x: number, y: number, salt = 0): number => ((Math.imul(x + 1357, 73856093) ^ Math.imul(y + 2461, 19349663) ^ Math.imul(salt + 17, 83492791)) >>> 0);
const random = (seed: number) => {
	let state = seed >>> 0;
	return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
};
const distanceToSegment = (point: ShelterPoint, { from, to }: ShelterCorridorSegment): number => {
	const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
	const t = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length)) : 0;
	return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
};
const intersects = (point: ShelterPoint, radius: number, rect: ShelterRect) => point.x + radius > rect.x && point.x - radius < rect.x + rect.width && point.y + radius > rect.y && point.y - radius < rect.y + rect.height;
function ownedAt(point: ShelterPoint, sites: ReadonlySet<string>): boolean {
	const site = getShelterTerritoryCell(point);
	return Boolean(site && sites.has(key(site)));
}
function blob(point: ShelterPoint, rx: number, ry: number, seed: number, count = 18): ShelterPoint[] {
	const r = random(seed);
	return Array.from({ length: count }, (_, i) => {
		const angle = i / count * Math.PI * 2, wobble = .88 + r() * .2;
		return { x: point.x + Math.cos(angle) * rx * wobble, y: point.y + Math.sin(angle) * ry * wobble };
	});
}

/** Only the exterior boundary is fenced; adjoining lots share one continuous yard. */
function perimeterFor(sites: readonly ShelterLayoutSite[], owned: ReadonlySet<string>): ShelterLandscapeEdge[] {
	const edges: ShelterLandscapeEdge[] = [];
	for (const site of sites) {
		const p = shelterRoomPosition(site.column, site.row), x = p.x - 10, y = p.y - 16;
		if (!owned.has(key({ column: site.column - 1, row: site.row }))) edges.push({ from: { x, y }, to: { x, y: y + SHELTER_ROW_STRIDE }, side: "west" });
		if (!owned.has(key({ column: site.column + 1, row: site.row }))) edges.push({ from: { x: x + SHELTER_COLUMN_STRIDE, y }, to: { x: x + SHELTER_COLUMN_STRIDE, y: y + SHELTER_ROW_STRIDE }, side: "east" });
		if (!owned.has(key({ column: site.column, row: site.row - 1 }))) edges.push({ from: { x, y }, to: { x: x + SHELTER_COLUMN_STRIDE, y }, side: "north" });
		if (!owned.has(key({ column: site.column, row: site.row + 1 }))) edges.push({ from: { x, y: y + SHELTER_ROW_STRIDE }, to: { x: x + SHELTER_COLUMN_STRIDE, y: y + SHELTER_ROW_STRIDE }, side: "south" });
	}
	const groups = new Map<string, ShelterLandscapeEdge[]>();
	for (const edge of edges) {
		const vertical = edge.from.x === edge.to.x, id = `${edge.side}:${vertical ? edge.from.x : edge.from.y}`;
		const group = groups.get(id) ?? []; group.push(edge); groups.set(id, group);
	}
	const merged: ShelterLandscapeEdge[] = [];
	for (const group of groups.values()) {
		const vertical = group[0]!.from.x === group[0]!.to.x;
		group.sort((a, b) => vertical ? a.from.y - b.from.y : a.from.x - b.from.x);
		for (const edge of group) {
			const last = merged.at(-1);
			if (last && last.side === edge.side && last.to.x === edge.from.x && last.to.y === edge.from.y) last.to = { ...edge.to };
			else merged.push({ ...edge, from: { ...edge.from }, to: { ...edge.to } });
		}
	}
	return merged.flatMap((edge) => edge.side === "north" && edge.from.y === ENTRANCE.y && edge.from.x < ENTRANCE.x && edge.to.x > ENTRANCE.x
		? [{ ...edge, to: { x: ENTRANCE.x - 30, y: ENTRANCE.y } }, { ...edge, from: { x: ENTRANCE.x + 30, y: ENTRANCE.y } }].filter(({ from, to }) => from.x < to.x) : [edge]);
}

/** Paths follow actual worker routes to doors and two clearings, rather than tracing every lot. */
function pathsFor(sites: readonly ShelterLayoutSite[], buildings: readonly ShelterLayoutBuilding[]): ShelterCorridorSegment[] {
	const destinations = buildings.map(getShelterRoomDoor);
	const free = sites.filter((site) => !buildings.some((building) => intersects(shelterRoomPosition(site.column, site.row), 1, getShelterBuildingRect(building))));
	if (buildings.some((building) => building.position || building.facing !== undefined)) {
		const clearings = getShelterOpenGroundPoints(sites, buildings);
		for (const point of [clearings[0], clearings[Math.floor(clearings.length * .7)]]) if (point) destinations.push(point);
	} else for (const site of [free[0], free[Math.floor(free.length * .7)]]) if (site) {
		const p = shelterRoomPosition(site.column, site.row); destinations.push({ x: p.x + 86, y: p.y + 65 });
	}
	const paths = new Map<string, ShelterCorridorSegment>();
	for (const destination of destinations) {
		let from = ENTRANCE;
		for (const to of getShelterWalkingRoute(ENTRANCE, destination, sites, buildings)) {
			if (from.x !== to.x || from.y !== to.y) {
				const id = [`${from.x}:${from.y}`, `${to.x}:${to.y}`].sort().join("/");
				paths.set(id, { from: { ...from }, to: { ...to } });
			}
			from = to;
		}
	}
	return [...paths.values()];
}

/** A compact gravel threshold sits outside the chosen entrance, never under a neighbour. */
function apronsFor(buildings: readonly ShelterLayoutBuilding[], owned: ReadonlySet<string>): ShelterLandscapeApron[] {
	const result: ShelterLandscapeApron[] = [], rects = buildings.map(getShelterBuildingRect);
	for (const building of buildings) {
		const door = getShelterRoomDoor(building), normal = getShelterRoomEntranceDirection(building), tangent = { x: normal.y, y: -normal.x };
		for (const depth of [18, 8, 4]) {
			const points = [-1, 1].flatMap((side) => [0, depth].map((distance) => ({ x: door.x + tangent.x * side * 11 + normal.x * distance, y: door.y + tangent.y * side * 11 + normal.y * distance })));
			const safe = points.every((point) => ownedAt({ x: point.x + normal.x * .01, y: point.y + normal.y * .01 }, owned)
				&& !rects.some((rect) => point.x > rect.x + .001 && point.x < rect.x + rect.width - .001 && point.y > rect.y + .001 && point.y < rect.y + rect.height - .001));
			if (safe) { result.push({ points: [points[0]!, points[2]!, points[3]!, points[1]!], seed: hash(Math.round(door.x), Math.round(door.y), building.facing ?? 0) }); break; }
		}
	}
	return result;
}

/** Decorative objects are regenerated from coordinates when buildings move or land expands. */
export function getShelterLandscape(inputSites: readonly ShelterLayoutSite[], buildings: readonly ShelterLayoutBuilding[] = [], reservedSites: readonly ShelterLayoutSite[] = []): ShelterLandscape {
	const sites = [...new Map(inputSites.filter((site) => Number.isSafeInteger(site.column) && Number.isSafeInteger(site.row)).map((site) => [key(site), { ...site }])).values()].sort((a, b) => a.row - b.row || a.column - b.column);
	const owned = new Set(sites.map(key)), lots = sites.map((site) => { const p = shelterRoomPosition(site.column, site.row); return { x: p.x - 10, y: p.y - 16, width: SHELTER_COLUMN_STRIDE, height: SHELTER_ROW_STRIDE }; });
	const perimeter = perimeterFor(sites, owned), paths = pathsFor(sites, buildings), aprons = apronsFor(buildings, owned), decorations: ShelterLandscapeDecoration[] = [];
	const rects = buildings.map(getShelterBuildingRect);
	const reserved = reservedSites.map((site) => { const p = shelterRoomPosition(site.column, site.row); return { x: p.x - 10, y: p.y - 16, width: SHELTER_COLUMN_STRIDE, height: SHELTER_ROW_STRIDE }; });
	const freePlacement = buildings.some((building) => building.position || building.facing !== undefined);
	const corridors = freePlacement ? [] : getShelterCorridorSegments(sites, buildings);
	const clearings = freePlacement ? getShelterOpenGroundPoints(sites, buildings) : sites.map((site) => { const p = shelterRoomPosition(site.column, site.row); return { x: p.x + 83, y: p.y + 80 }; });
	const canPlace = (point: ShelterPoint, radius: number, inside: boolean) => {
		if (inside !== ownedAt(point, owned)) return false;
		if ([-radius, radius].some((dx) => [-radius, radius].some((dy) => ownedAt({ x: point.x + dx, y: point.y + dy }, owned) !== inside))) return false;
		if (rects.some((rect) => intersects(point, radius + 12, rect))) return false;
		if (reserved.some((rect) => intersects(point, radius, rect))) return false;
		if ([...corridors, ...paths].some((segment) => distanceToSegment(point, segment) < radius + 12)) return false;
		// The unassigned squad gathers in the centre of free land and enters through its south side.
		if (inside && clearings.some((p) => intersects(point, radius + 7, { x: p.x - 31, y: p.y - 30, width: 62, height: 60 }))) return false;
		return !decorations.some((d) => Math.hypot(d.point.x - point.x, d.point.y - point.y) < d.radius + radius + 8);
	};
	const add = (kind: ShelterLandscapeDecoration["kind"], point: ShelterPoint, radius: number, inside: boolean, seed: number) => {
		if (canPlace(point, radius, inside)) decorations.push({ kind, point, radius, owned: inside, seed });
	};
	if (ownedAt({ x: ENTRANCE.x, y: ENTRANCE.y + 2 }, owned)) decorations.push({ kind: "gate", point: { ...ENTRANCE }, seed: 7, radius: 0, owned: true });
	const streetSites = sites.filter((site) => site.row === 0);
	for (const site of [streetSites[0], streetSites.at(-1)]) if (site) {
		const p = shelterRoomPosition(site.column, site.row);
		add("lamp", { x: p.x + 14, y: 114 }, 2, false, hash(site.column, 0, 2));
	}
	for (const site of sites) {
		const p = shelterRoomPosition(site.column, site.row), seed = hash(site.column, site.row);
		if (decorations.filter((d) => d.owned).length < 56) {
			const kind = seed % 3 === 0 ? "camp" : seed % 3 === 1 ? "bench" : "barrels";
			const limit = kind === "camp" ? 1 : kind === "bench" ? 2 : 3;
			if (decorations.filter((d) => d.kind === kind).length < limit) add(kind, { x: p.x + (kind === "camp" ? 24 : 25 + seed % 4), y: p.y + 29 + seed % 7 }, kind === "camp" ? 20 : 17, true, seed);
			add("bush", { x: p.x + 133 + seed % 17, y: p.y + 21 + seed % 13 }, 13, true, seed + 1);
			add("rock", { x: p.x + 130 + seed % 21, y: p.y + 72 + seed % 13 }, 9, true, seed + 2);
		}
	}
	const frontier = new Map<string, ShelterLayoutSite>();
	for (const site of sites) for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1]]) {
		const candidate = { column: site.column + dx!, row: site.row + dy! }; if (!owned.has(key(candidate))) frontier.set(key(candidate), candidate);
	}
	for (const site of [...frontier.values()].sort((a, b) => a.row - b.row || a.column - b.column)) {
		const p = shelterRoomPosition(site.column, site.row), seed = hash(site.column, site.row, 1);
		if (decorations.filter((d) => !d.owned).length >= 96) break;
		add("tree", { x: p.x + 34 + seed % 31, y: p.y + 27 + seed % 19 }, 19, false, seed);
		add(seed % 2 ? "bush" : "tree", { x: p.x + 123 + seed % 23, y: p.y + 73 }, 17, false, seed + 1);
		add("rock", { x: p.x + 101, y: p.y + 31 }, 9, false, seed + 2);
	}
	return { sites, lots, perimeter, paths, aprons, decorations };
}

class LandscapePainter {
	constructor(readonly g: Phaser.GameObjects.Graphics) {}
	point(point: ShelterPoint, z = 0): ShelterPoint { const p = projectShelterPoint(point); return { x: p.x, y: p.y - z }; }
	face(points: readonly ShelterPoint[], color: number, alpha = 1, z = 0): void { this.g.fillStyle(color, alpha).fillPoints(points.map((point) => this.point(point, z)), true); }
	line(points: readonly ShelterPoint[], color: number, width = 1, alpha = 1, z = 0): void { this.g.lineStyle(width, color, alpha).strokePoints(points.map((point) => this.point(point, z)), false); }
	plane(x: number, y: number, width: number, height: number, color: number, alpha = 1, z = 0): void { this.face([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], color, alpha, z); }
	ellipse(point: ShelterPoint, rx: number, ry: number, color: number, alpha = 1, z = 0): void { this.face(Array.from({ length: 24 }, (_, i) => ({ x: point.x + Math.cos(i / 24 * Math.PI * 2) * rx, y: point.y + Math.sin(i / 24 * Math.PI * 2) * ry })), color, alpha, z); }
	box(x: number, y: number, width: number, depth: number, height: number, top: number, front: number, side: number, z = 0): void {
		const points = [this.point({ x: x + width, y }, z), this.point({ x: x + width, y: y + depth }, z), this.point({ x: x + width, y: y + depth }, z + height), this.point({ x: x + width, y }, z + height)];
		this.g.fillStyle(side).fillPoints(points, true);
		this.g.fillStyle(front).fillPoints([this.point({ x, y: y + depth }, z), this.point({ x: x + width, y: y + depth }, z), this.point({ x: x + width, y: y + depth }, z + height), this.point({ x, y: y + depth }, z + height)], true);
		this.plane(x, y, width, depth, top, 1, z + height);
	}
}

/** The grid is kept in the model only: the ground has no seams, squares or alternating colours. */
export function paintShelterLandscape(g: Phaser.GameObjects.Graphics, landscape: ShelterLandscape, worldBounds: ShelterRect): void {
	const a = new LandscapePainter(g), owned = new Set(landscape.sites.map(key));
	g.fillStyle(C.forest).fillRect(worldBounds.x, worldBounds.y, worldBounds.width, worldBounds.height);
	for (const lot of landscape.lots) a.plane(lot.x, lot.y, lot.width, lot.height, C.grass);
	for (const site of landscape.sites) {
		const p = shelterRoomPosition(site.column, site.row), seed = hash(site.column, site.row, 3), r = random(seed);
		// Broad patches cross old lot boundaries and are clipped against the irregular owned union.
		for (let i = 0; i < 7; i++) {
			const at = { x: p.x + r() * 190 - 10, y: p.y + r() * 130 - 16 }, points = blob(at, 27 + r() * 53, 15 + r() * 33, seed + i);
			if (points.every((point) => ownedAt(point, owned))) a.face(points, i % 3 ? C.grassLight : C.grassDark, i % 3 ? .13 : .22);
		}
		for (let i = 0; i < 31; i++) {
			const at = { x: p.x - 7 + r() * 185, y: p.y - 13 + r() * 126 };
			a.line([at, { x: at.x + 3 + r() * 4, y: at.y - 2 }], i % 3 ? 0x9da174 : 0x46654a, .6, .34);
		}
	}
	// Compressed gravel and exposed earth at entrances make circulation read as use of the yard.
	for (const apron of landscape.aprons) {
		a.face(apron.points, 0x514f40, .35);
		const centre = { x: apron.points.reduce((sum, point) => sum + point.x, 0) / 4, y: apron.points.reduce((sum, point) => sum + point.y, 0) / 4 };
		const inset = apron.points.map((point) => ({ x: centre.x + (point.x - centre.x) * .9, y: centre.y + (point.y - centre.y) * .9 }));
		a.face(inset, 0xa7a18a, .85);
		a.line([inset[0]!, inset[1]!], 0xd0c5a5, .8, .5);
		const r = random(apron.seed);
		for (let i = 0; i < 19; i++) {
			const u = r(), v = r(), p0 = inset[0]!, p1 = inset[1]!, p3 = inset[3]!;
			const point = { x: p0.x + (p1.x - p0.x) * u + (p3.x - p0.x) * v, y: p0.y + (p1.y - p0.y) * u + (p3.y - p0.y) * v }, at = a.point(point);
			g.fillStyle(i % 3 ? 0xd8ccb0 : 0x656752, .55).fillEllipse(at.x, at.y, .9 + r(), .6);
		}
	}
	for (const edge of landscape.perimeter) {
		a.line([edge.from, edge.to], 0x243e31, 8, .38);
		a.line([edge.from, edge.to], 0xc0bc8c, 1.5, .22);
	}
	for (const path of landscape.paths) {
		// An uneven worn shoulder and a warm gravel centre follow the actual walking route.
		a.line([path.from, path.to], 0x384d36, 17, .13);
		a.line([path.from, path.to], C.soil, 12, .4);
		a.line([path.from, path.to], 0xa18f70, 7.5, .75);
		a.line([path.from, path.to], C.gravel, 3.8, .3);
		for (const point of [path.from, path.to]) { const at = a.point(point); g.fillStyle(C.soil, .5).fillCircle(at.x, at.y, 5.5); }
		const seed = hash(Math.round(path.from.x), Math.round(path.from.y), Math.round(path.to.x + path.to.y)), r = random(seed), length = Math.hypot(path.to.x - path.from.x, path.to.y - path.from.y);
		for (let step = 5; step < length; step += 12) {
			const t = step / length, at = a.point({ x: path.from.x + (path.to.x - path.from.x) * t + r() * 5 - 2.5, y: path.from.y + (path.to.y - path.from.y) * t + r() * 5 - 2.5 });
			g.fillStyle(step % 3 ? 0xd1c4a2 : 0x726c53, .32).fillEllipse(at.x, at.y, 1.4, .7);
		}
		// Short broken ruts avoid an artificial, uniformly stroked path.
		const normal = length ? { x: -(path.to.y - path.from.y) / length, y: (path.to.x - path.from.x) / length } : { x: 0, y: 0 };
		for (let step = 13; step < length - 5; step += 29) {
			const start = step / length, end = Math.min(length, step + 7 + r() * 10) / length, side = r() < .5 ? -1 : 1;
			a.line([start, end].map((t) => ({ x: path.from.x + (path.to.x - path.from.x) * t + normal.x * side * 2.2, y: path.from.y + (path.to.y - path.from.y) * t + normal.y * side * 2.2 })), 0x615f47, .8, .27);
		}
	}
	if (landscape.lots.length) {
		const left = Math.min(...landscape.lots.map((lot) => lot.x)) - 12, right = Math.max(...landscape.lots.map((lot) => lot.x + lot.width)) + 12;
		a.plane(left, 43, right - left, 67, 0x414e45);
		a.plane(left, 110, right - left, 22, 0x9a957a);
		for (let x = left + 14; x < right; x += 47) a.line([{ x, y: 76 }, { x: Math.min(x + 21, right), y: 76 }], 0xd5ceaa, 1.5, .55);
		a.line([{ x: ENTRANCE.x, y: 112 }, ENTRANCE], C.soil, 19, .8);
		a.line([{ x: left, y: 110 }, { x: right, y: 110 }], 0x283e32, 1.2, .7);
	}
}

/** Upright silhouettes are separate depth-sorted objects; all positions still use the shared projection. */
export function paintShelterDecoration(g: Phaser.GameObjects.Graphics, decoration: ShelterLandscapeDecoration): void {
	const a = new LandscapePainter(g), p = decoration.point, seed = decoration.seed, r = random(seed), at = a.point(p);
	a.ellipse({ x: p.x + 8, y: p.y + 8 }, decoration.kind === "tree" ? 28 : 19, decoration.kind === "tree" ? 17 : 11, 0x173d2e, .25);
	switch (decoration.kind) {
		case "tree": {
			const height = 35 + seed % 12;
			g.lineStyle(3.6, 0x6a5943).lineBetween(at.x, at.y, at.x - 1, at.y - height + 12);
			g.lineStyle(1, 0xba9e70, .55).lineBetween(at.x - 1, at.y - 3, at.x - 2, at.y - 18);
			g.lineStyle(1.8, 0x6a5943).lineBetween(at.x - 1, at.y - 15, at.x - 10, at.y - 26);
			g.lineStyle(1.5, 0x6a5943).lineBetween(at.x - 1, at.y - 20, at.x + 10, at.y - 30);
			for (const [dx, dy, radius] of [[-10, 23, 13], [10, 27, 12], [0, height - 5, 14], [-3, 26, 15]]) {
				g.fillStyle(0x3c6547).fillCircle(at.x + dx!, at.y - dy!, radius!);
				g.fillStyle(0x5b7b4f).fillCircle(at.x + dx! - 3, at.y - dy! - 3, radius! * .73);
			}
			for (let i = 0; i < 11; i++) g.fillStyle(i % 4 ? 0x80905b : 0xa4a86f, .65).fillCircle(at.x + r() * 29 - 17, at.y - 18 - r() * 25, 1.4 + r() * 2.1);
			break;
		}
		case "bush":
			for (let i = 0; i < 5; i++) {
				const dx = Math.cos(i * 2.7) * 7, dy = Math.sin(i * 2.7) * 3;
				g.fillStyle(0x3a6649).fillEllipse(at.x + dx, at.y - 5 + dy, 15, 12);
				g.fillStyle(0x82925c, .65).fillEllipse(at.x + dx - 2, at.y - 8 + dy, 9, 5);
			}
			for (let i = 0; i < 6; i++) g.fillStyle(seed % 2 ? 0xd7b787 : 0xb6bc89, .85).fillCircle(at.x + r() * 22 - 11, at.y - 4 - r() * 8, .8);
			break;
		case "rock":
			a.face([{ x: p.x - 9, y: p.y + 1 }, { x: p.x - 7, y: p.y - 7 }, { x: p.x + 3, y: p.y - 10 }, { x: p.x + 10, y: p.y - 3 }, { x: p.x + 8, y: p.y + 6 }, { x: p.x - 3, y: p.y + 7 }], 0x768674, 1, 3);
			a.face([{ x: p.x - 7, y: p.y - 7 }, { x: p.x + 3, y: p.y - 10 }, { x: p.x + 5, y: p.y - 2 }, { x: p.x - 3, y: p.y + 2 }], 0xa0a58a, 1, 3);
			a.line([{ x: p.x - 5, y: p.y }, { x: p.x + 5, y: p.y + 3 }], 0x4d6955, 1, .55, 3);
			break;
		case "bench": {
			for (const dx of [-13, 10]) a.box(p.x + dx, p.y - 3, 3, 10, 8, C.steel, 0x4b6654, 0x354f43);
			for (const dy of [-5, 0, 5]) a.box(p.x - 16, p.y + dy, 33, 3.5, 2, C.wood, 0x846945, 0x645638, 8);
			for (const dx of [-12, 10]) a.box(p.x + dx, p.y - 5, 2, 3, 19, C.steel, 0x4b6654, 0x354f43);
			a.box(p.x - 16, p.y - 6, 33, 2, 6, C.wood, 0x927449, 0x645638, 15);
			break;
		}
		case "barrels":
			for (const [dx, dy, color] of [[-8, 0, 0x7a8061], [5, -5, 0x698878]]) {
				const b = a.point({ x: p.x + dx!, y: p.y + dy! });
				g.fillStyle(color!).fillRoundedRect(b.x - 4, b.y - 13, 8, 12, 2);
				g.fillStyle(0xa2a886).fillEllipse(b.x, b.y - 13, 8, 3);
				for (const z of [4, 10]) g.lineStyle(.8, 0x3c5a48).lineBetween(b.x - 4, b.y - z, b.x + 4, b.y - z);
			}
			a.box(p.x - 15, p.y + 5, 18, 9, 7, 0xb99b69, 0x92754e, 0x695f40);
			break;
		case "camp":
			a.ellipse(p, 12, 9, 0x5f6046, .7);
			for (let i = 0; i < 8; i++) {
				const angle = i / 8 * Math.PI * 2, stone = a.point({ x: p.x + Math.cos(angle) * 11, y: p.y + Math.sin(angle) * 8 });
				g.fillStyle(i % 2 ? 0x939780 : 0x72816b).fillEllipse(stone.x, stone.y - 1, 5, 3.4);
			}
			a.line([{ x: p.x - 6, y: p.y - 3 }, { x: p.x + 6, y: p.y + 3 }], 0x765c3e, 3, 1, 2);
			a.line([{ x: p.x - 6, y: p.y + 3 }, { x: p.x + 5, y: p.y - 4 }], 0x9f7c48, 3, 1, 3);
			g.fillStyle(0xe9ab58, .65).fillTriangle(at.x - 3, at.y - 3, at.x, at.y - 11, at.x + 3, at.y - 2);
			g.fillStyle(0xf2d188, .8).fillTriangle(at.x - 1, at.y - 2, at.x + 1, at.y - 8, at.x + 2, at.y - 2);
			a.box(p.x - 20, p.y + 4, 11, 11, 8, C.wood, 0x856d47, 0x5d5c3d);
			break;
		case "lamp":
			g.lineStyle(2.2, C.steel).lineBetween(at.x, at.y, at.x, at.y - 30);
			g.lineStyle(2, C.steel).lineBetween(at.x, at.y - 30, at.x + 7, at.y - 30);
			g.fillStyle(C.pale).fillEllipse(at.x + 7, at.y - 30, 7, 3);
			break;
		case "gate":
			for (const dx of [-30, 30]) {
				const post = a.point({ x: p.x + dx, y: p.y });
				a.box(p.x + dx - 3, p.y - 3, 6, 6, 27, 0xd0c9a4, 0x8c9c79, 0x5e7a61);
				g.fillStyle(C.pale).fillEllipse(post.x, post.y - 28, 5, 3);
			}
			// Open leaves stay against the perimeter, leaving the worker entrance clear.
			a.line([{ x: p.x - 30, y: p.y }, { x: p.x - 44, y: p.y + 8 }], C.wood, 2, .9, 14);
			a.line([{ x: p.x + 30, y: p.y }, { x: p.x + 44, y: p.y + 8 }], C.wood, 2, .9, 14);
			break;
	}
}
