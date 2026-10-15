import type Phaser from "phaser";
import type { ShelterRect } from "./shelter-camera";
import { getShelterBuildingRect, getShelterCorridorSegments, getShelterOpenGroundPoints, getShelterRoomDoor, getShelterRoomEntranceDirection, getShelterTerritoryCell, getShelterWalkingRoute, type ShelterCorridorSegment, type ShelterLayoutBuilding, type ShelterLayoutSite } from "./shelter-layout";
import { projectShelterPoint, shelterRoomPosition, SHELTER_COLUMN_STRIDE, SHELTER_ROW_STRIDE } from "./shelter-isometric";
import type { ShelterPoint } from "./shelter-motion";
import { PIXEL_PALETTE as P } from "./pixel-art";
import { paintShelterAccessRoad } from "./shelter-road";

export interface ShelterLandscapeEdge extends ShelterCorridorSegment { side: "north" | "south" | "east" | "west" }
export interface ShelterLandscapeDecoration {
	kind: "tree" | "bush" | "fern" | "rock" | "stump" | "logs" | "woodpile" | "puddle" | "camp" | "bench" | "barrels" | "lamp" | "gate";
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
const pigment = (hex: string): number => Number.parseInt(hex.slice(1), 16);
const C = {
	forest: pigment(P.ink), forestLight: pigment(P.leafShade), grass: pigment(P.grass), grassLight: pigment(P.leafLight),
	grassDark: pigment(P.shadow), soil: pigment(P.soil), gravel: pigment(P.sand), pale: pigment(P.cream),
	damp: pigment(P.concreteShade), litter: pigment(P.wood), water: pigment(P.glass),
	ink: pigment(P.ink), bark: pigment(P.woodShade), wood: pigment(P.woodLight), steel: pigment(P.steel),
	leaf: pigment(P.leaf), leafLight: pigment(P.leafLight),
};

/** Flat clusters keep leaves readable at the same pixel scale as the actors. */
function foliage(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, color: number, alpha = 1): void {
	const left = Math.round(x - width / 2), top = Math.round(y - height / 2), w = Math.max(2, Math.round(width)), h = Math.max(2, Math.round(height));
	g.fillStyle(color, alpha).fillRect(left + 2, top, Math.max(1, w - 4), h);
	g.fillRect(left, top + Math.max(1, Math.round(h / 4)), w, Math.max(1, Math.round(h / 2)));
}
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
export interface ShelterPathDetail extends ShelterPoint { kind: "stone" | "grass" | "rut"; size: number; side: -1 | 1 }
/** Surface decoration is seeded by the existing route, bounded independently
 * of its length, and never participates in navigation or prop collision. */
export function getShelterPathDetails(path: ShelterCorridorSegment): ShelterPathDetail[] {
	const dx = path.to.x - path.from.x, dy = path.to.y - path.from.y, length = Math.hypot(dx, dy);
	if (!Number.isFinite(length) || length < 4) return [];
	const count = Math.min(48, Math.max(1, Math.floor(length / 12))), r = random(hash(Math.round(path.from.x), Math.round(path.from.y), Math.round(path.to.x + path.to.y))), details: ShelterPathDetail[] = [];
	const nx = -dy / length, ny = dx / length;
	for (let i = 0; i < count; i++) {
		const t = (i + .35 + r() * .3) / count, side = i % 2 ? 1 : -1;
		const at = (offset: number) => ({ x: path.from.x + dx * t + nx * offset, y: path.from.y + dy * t + ny * offset });
		details.push({ ...at(side * (5.8 + r() * 1.8)), kind: i % 3 ? "grass" : "stone", size: 1 + r() * 2, side });
		details.push({ ...at(side * (2 + r() * .7)), kind: "rut", size: 3 + r() * 5, side });
		if (i % 2 === 0) details.push({ ...at((r() - .5) * 4), kind: "stone", size: 1, side });
	}
	return details;
}
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
			if (decorations.filter((d) => d.kind === "woodpile").length < 1) add("woodpile", { x: p.x + 150, y: p.y + 25 }, 17, true, seed + 3);
			if (decorations.filter((d) => d.kind === "stump" && d.owned).length < 2) add("stump", { x: p.x + 35 + seed % 18, y: p.y + 24 }, 8, true, seed + 4);
			// Low wet hollows stay out of the entrances and the walked gravel, just like upright props.
			if (decorations.filter((d) => d.kind === "puddle" && d.owned).length < 3) add("puddle", { x: p.x + 157 + seed % 8, y: p.y + 99 }, 12 + seed % 6, true, seed + 5);
			add("fern", { x: p.x + 19 + seed % 10, y: p.y + 97 }, 8, true, seed + 6);
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
		add("fern", { x: p.x + 19, y: p.y + 90 + seed % 11 }, 8, false, seed + 3);
		add("bush", { x: p.x + 87, y: p.y + 103 }, 12, false, seed + 4);
		if (seed % 3 === 0) add("logs", { x: p.x + 146, y: p.y + 30 }, 15, false, seed + 5);
		else add("stump", { x: p.x + 149, y: p.y + 27 }, 8, false, seed + 5);
		if (seed % 4 === 0) add("puddle", { x: p.x + 89, y: p.y + 77 }, 18, false, seed + 6);
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
export function paintShelterLandscape(g: Phaser.GameObjects.Graphics, landscape: ShelterLandscape, worldBounds: ShelterRect, paintForestFloor = true): void {
	const a = new LandscapePainter(g), owned = new Set(landscape.sites.map(key));
	if (paintForestFloor) g.fillStyle(C.forest).fillRect(worldBounds.x, worldBounds.y, worldBounds.width, worldBounds.height);
	for (const lot of landscape.lots) a.plane(lot.x, lot.y, lot.width, lot.height, C.grass);
	for (const site of landscape.sites) {
		const p = shelterRoomPosition(site.column, site.row), seed = hash(site.column, site.row, 3), r = random(seed);
		// Broad patches cross old lot boundaries and are clipped against the irregular owned union.
		for (let i = 0; i < 7; i++) {
			const at = { x: p.x + r() * 190 - 10, y: p.y + r() * 130 - 16 }, points = blob(at, 27 + r() * 53, 15 + r() * 33, seed + i);
			if (points.every((point) => ownedAt(point, owned))) a.face(points, i % 3 ? C.grassLight : C.grassDark, i % 3 ? .13 : .22);
		}
		// Grass thins to soft earth in uneven hollows; the small patches never trace a lot edge.
		for (let i = 0; i < 4; i++) {
			const centre = { x: p.x + 8 + r() * 155, y: p.y + 8 + r() * 94 }, radius = 14 + r() * 24;
			const points = blob(centre, radius, radius * .58, seed + 41 + i, 15);
			if (points.every((point) => ownedAt(point, owned))) {
				a.face(points, i % 2 ? C.soil : C.damp, i % 2 ? .2 : .14);
				for (let pebble = 0; pebble < 9; pebble++) {
					const angle = r() * Math.PI * 2, distance = Math.sqrt(r()) * radius * .68;
					const at = a.point({ x: centre.x + Math.cos(angle) * distance, y: centre.y + Math.sin(angle) * distance * .58 });
					g.fillStyle(pebble % 3 ? 0xbab293 : 0x6c7158, .24).fillEllipse(at.x, at.y, 1.3 + r(), .65);
				}
			}
		}
		for (let i = 0; i < 31; i++) {
			const at = { x: p.x - 7 + r() * 185, y: p.y - 13 + r() * 126 };
			const screen = a.point(at), blade = 2 + r() * 3;
			g.lineStyle(.65, i % 3 ? 0x9da174 : 0x46654a, .42);
			g.lineBetween(screen.x, screen.y, screen.x - 1.5, screen.y - blade);
			if (i % 3 === 0) {
				g.lineBetween(screen.x, screen.y, screen.x + 2, screen.y - blade * .8);
				g.lineBetween(screen.x, screen.y, screen.x, screen.y - blade * 1.15);
			}
		}
	}
	// Forest floor and fall leaves collect beneath plants, rather than tinting every square equally.
	for (const decoration of landscape.decorations) if (["tree", "bush", "stump", "logs"].includes(decoration.kind)) {
		const r = random(decoration.seed + 73), points = blob(decoration.point, decoration.radius + 11, decoration.radius + 7, decoration.seed + 74, 16);
		if (points.every((point) => ownedAt(point, owned) === decoration.owned)) a.face(points, decoration.owned ? C.soil : 0x364b34, decoration.owned ? .17 : .5);
		for (let i = 0; i < 13; i++) {
			const point = { x: decoration.point.x + (r() - .5) * decoration.radius * 2.2, y: decoration.point.y + (r() - .5) * decoration.radius * 1.7 };
			if (ownedAt(point, owned) !== decoration.owned) continue;
			const at = a.point(point);
			g.fillStyle(i % 4 ? C.litter : 0x748255, .32).fillEllipse(at.x, at.y, 2.6 + r() * 1.5, .8 + r());
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
		const tangent = length ? { x: (path.to.x - path.from.x) / length, y: (path.to.y - path.from.y) / length } : { x: 0, y: 0 };
		for (const detail of getShelterPathDetails(path)) {
			const at = a.point(detail);
			if (detail.kind === "grass") {
				g.lineStyle(1, detail.side > 0 ? C.grassDark : C.grassLight, .85);
				g.lineBetween(Math.round(at.x), Math.round(at.y), Math.round(at.x - 1), Math.round(at.y - detail.size - 1));
				g.lineBetween(Math.round(at.x), Math.round(at.y), Math.round(at.x + 2), Math.round(at.y - detail.size));
			} else if (detail.kind === "stone") {
				const size = Math.round(detail.size);
				g.fillStyle(C.soil, .65).fillRect(Math.round(at.x), Math.round(at.y), size + 1, 1);
				g.fillStyle(C.pale, .65).fillRect(Math.round(at.x), Math.round(at.y - 1), size, 1);
			} else {
				a.line([detail, { x: detail.x + tangent.x * detail.size, y: detail.y + tangent.y * detail.size }], C.soil, 1, .58);
			}
		}
	}
	if (landscape.lots.length) {
		const left = Math.min(...landscape.lots.map((lot) => lot.x)) - 12, right = Math.max(...landscape.lots.map((lot) => lot.x + lot.width)) + 12;
		paintShelterAccessRoad(g, left, right);
		a.line([{ x: ENTRANCE.x, y: 112 }, ENTRANCE], C.soil, 19, .8);
		for (let x = Math.ceil(left / 113) * 113 + 27; x < right - 20; x += 113) {
			// Drain slats belong to the maintained frontage beside the gate.
			a.plane(x + 11, 104, 15, 4, C.ink);
			for (let slot = 13; slot < 25; slot += 3) a.line([{ x: x + slot, y: 104.5 }, { x: x + slot, y: 107.5 }], C.steel, 1, .7);
		}
	}
}

/** Upright silhouettes are separate depth-sorted objects; all positions still use the shared projection. */
export function paintShelterDecoration(g: Phaser.GameObjects.Graphics, decoration: ShelterLandscapeDecoration, wind = 0): void {
	const a = new LandscapePainter(g), p = decoration.point, seed = decoration.seed, r = random(seed), at = a.point(p), sway = Math.max(-1.6, Math.min(1.6, wind));
	if (decoration.kind !== "puddle" && decoration.kind !== "camp") {
		const tree = decoration.kind === "tree", upright = tree || decoration.kind === "lamp" || decoration.kind === "gate";
		a.ellipse({ x: p.x + (upright ? 13 : 5), y: p.y + (upright ? 16 : 6) }, tree ? 26 : decoration.radius * .95 + 2, tree ? 16 : decoration.radius * .5 + 1, 0x173d2e, tree ? .24 : .18);
	}
	switch (decoration.kind) {
		case "tree": {
			const height = 43 + seed % 12, birch = seed % 3 === 1, pine = seed % 3 === 0;
			for (const [dx, dy] of [[-10, 2], [8, 4], [-2, 10], [4, -7]]) {
				a.face([p, { x: p.x + dx! * .55 - 1, y: p.y + dy! * .55 }, { x: p.x + dx!, y: p.y + dy! }, { x: p.x + dx! * .55 + 2, y: p.y + dy! * .55 }], C.bark, .9, .7);
				a.line([{ x: p.x + dx! * .15, y: p.y + dy! * .15 }, { x: p.x + dx! * .75, y: p.y + dy! * .75 }], C.wood, 1, .7, 1.2);
			}
			for (let i = 0; i < 7; i++) {
				const angle = i * 2.4, leaf = a.point({ x: p.x + Math.cos(angle) * (7 + i % 3), y: p.y + Math.sin(angle) * (6 + i % 3) });
				g.fillStyle(i % 2 ? C.litter : C.grassDark, .8).fillRect(Math.round(leaf.x), Math.round(leaf.y), 2, 1);
			}
			for (const [dx, dy] of [[-7, 2], [6, 2], [1, 7]]) a.line([p, { x: p.x + dx!, y: p.y + dy! }], birch ? 0xada689 : 0x5d5b40, 1.4, .75);
			g.lineStyle(birch ? 3 : 4, birch ? 0xc1c1a3 : 0x6a5943).lineBetween(at.x, at.y, at.x - 1, at.y - height + 10);
			g.lineStyle(1, birch ? 0xe0dcca : 0xa58a60, .65).lineBetween(at.x - 1, at.y - 3, at.x - 2, at.y - 26);
			if (birch) for (let z = 5; z < height - 10; z += 7) g.lineStyle(1.1, 0x5a6151, .8).lineBetween(at.x - 1.5, at.y - z, at.x + .8, at.y - z + .7);
			g.lineStyle(1.8, birch ? 0x999c7e : 0x6a5943).lineBetween(at.x - 1, at.y - 17, at.x - 11 + sway * .4, at.y - 30);
			g.lineStyle(1.5, birch ? 0xaaa88d : 0x6a5943).lineBetween(at.x - 1, at.y - 22, at.x + 11 + sway * .4, at.y - 35);
			for (let z = 6; z < 30; z += 7) {
				g.lineStyle(1, birch ? C.ink : C.wood, .75).lineBetween(Math.round(at.x - 1), Math.round(at.y - z), Math.round(at.x + 1), Math.round(at.y - z - 2));
			}
			if (pine) {
				// Long tiered boughs make a ragged spruce silhouette, with clear sky between the tiers.
				for (const [z, width] of [[20, 19], [31, 16], [41, 12]]) {
					const tip = at.y - Math.min(height, z! + 15), base = at.y - z! + 7, cx = at.x + sway * z! / height;
					const points = [{ x: cx, y: tip }, { x: cx - width! * .45, y: base - 7 }, { x: cx - width!, y: base }, { x: cx - width! * .7, y: base + 1 }, { x: cx - 4, y: base - 1 }, { x: cx + 4, y: base + 2 }, { x: cx + width! * .85, y: base + 1 }, { x: cx + width!, y: base - 1 }, { x: cx + width! * .45, y: base - 9 }];
					g.fillStyle(C.forestLight).fillPoints(points.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })), true);
					g.fillStyle(C.grassDark).fillPoints([points[0]!, points[1]!, { x: cx - width! * .7, y: base - 1 }, { x: cx - 1, y: base - 5 }], true);
					g.lineStyle(1, C.grass, .8).lineBetween(Math.round(cx - 3), Math.round(base - 8), Math.round(cx - width! * .55), Math.round(base - 3));
					for (const tip of [-.65, -.3, .18, .52]) {
						const lx = Math.round(cx + width! * tip), ly = Math.round(base - (1 - Math.abs(tip)) * 7);
						g.fillStyle(tip < 0 ? C.grassLight : C.grass).fillRect(lx, ly, 3, 1);
						g.fillStyle(C.forestLight).fillRect(lx + 1, ly + 2, 2, 1);
					}
				}
			} else {
				const centre = { x: at.x + sway, y: at.y - height + 20 }, width = birch ? 16 : 22, depth = birch ? 19 : 17;
				// Overlapping lobes have stepped edges and solid lit/shaded planes,
				// instead of a translucent smooth vector crown.
				for (let i = 0; i < 9; i++) {
					const angle = i / 9 * Math.PI * 2, cx = centre.x + Math.cos(angle) * width * .58, cy = centre.y + Math.sin(angle) * depth * .57;
					foliage(g, cx, cy, width * .95, depth * .85, C.forestLight);
				}
				for (const [dx, dy, spread] of [[-.4, -.55, .75], [.15, -.65, .66], [-.55, -.05, .7], [.1, -.1, .78], [.55, .16, .5], [-.2, .48, .55]]) {
					const cx = centre.x + width * dx!, cy = centre.y + depth * dy!;
					foliage(g, cx, cy, width * spread!, depth * spread! * .8, C.leaf);
					foliage(g, cx - 2, cy - 2, width * spread! * .55, depth * spread! * .32, C.leafLight);
				}
				for (let i = 0; i < 9; i++) {
					const x = Math.round(centre.x - width * .6 + r() * width * 1.1), y = Math.round(centre.y - depth * .6 + r() * depth);
					g.fillStyle(C.leafLight, .85).fillRect(x, y, 2 + i % 2, 1);
					g.fillStyle(C.forestLight, .9).fillRect(x + 2, y + 2, 2, 1);
				}
			}
			break;
		}
		case "bush":
			for (const dx of [-7, 0, 6]) {
				g.lineStyle(1, C.bark).lineBetween(Math.round(at.x), Math.round(at.y), Math.round(at.x + dx), Math.round(at.y - 9));
			}
			for (let i = 0; i < 5; i++) {
				const dx = Math.cos(i * 2.7) * 7, dy = Math.sin(i * 2.7) * 3;
				foliage(g, at.x + dx + sway * .35, at.y - 5 + dy, 15, 12, C.forestLight);
				foliage(g, at.x + dx - 2 + sway * .55, at.y - 8 + dy, 9, 5, C.grass);
			}
			for (let i = 0; i < 4; i++) g.fillStyle(seed % 2 ? C.litter : C.pale).fillRect(Math.round(at.x + r() * 22 - 11 + sway * .55), Math.round(at.y - 4 - r() * 8), 1, 1);
			break;
		case "fern": {
			for (let i = 0; i < 7; i++) {
				const spread = (i - 3) * 2.6, tip = { x: at.x + spread + sway * .65, y: at.y - 7 - Math.sin(i / 6 * Math.PI) * 6 };
				g.lineStyle(.7, 0x71894f, .95).lineBetween(at.x, at.y, tip.x, tip.y);
				for (let leaf = 1; leaf <= 4; leaf++) {
					const t = leaf / 5, cx = at.x + (tip.x - at.x) * t, cy = at.y + (tip.y - at.y) * t, width = (1 - t) * 3.4;
					g.lineStyle(1, leaf % 2 ? 0x628051 : 0x91a366, .85);
					g.lineBetween(cx, cy, cx - width, cy - .8);
					g.lineBetween(cx, cy, cx + width, cy - 1.2);
				}
			}
			break;
		}
		case "rock":
			a.face([{ x: p.x - 9, y: p.y + 1 }, { x: p.x - 7, y: p.y - 7 }, { x: p.x + 3, y: p.y - 10 }, { x: p.x + 10, y: p.y - 3 }, { x: p.x + 8, y: p.y + 6 }, { x: p.x - 3, y: p.y + 7 }], 0x768674, 1, 3);
			a.face([{ x: p.x - 7, y: p.y - 7 }, { x: p.x + 3, y: p.y - 10 }, { x: p.x + 5, y: p.y - 2 }, { x: p.x - 3, y: p.y + 2 }], 0xa0a58a, 1, 3);
			a.line([{ x: p.x - 5, y: p.y }, { x: p.x + 5, y: p.y + 3 }], 0x4d6955, 1, .55, 3);
			break;
		case "puddle": {
			const rx = decoration.radius, ry = decoration.radius * .58, edge = blob(p, rx, ry, seed, 17), water = blob({ x: p.x - 1, y: p.y - 1 }, rx * .82, ry * .78, seed + 1, 17);
			a.face(edge, 0x3e5546, .42);
			a.face(water, C.water, .57);
			a.line([{ x: p.x - rx * .5, y: p.y - ry * .22 }, { x: p.x + rx * .25, y: p.y - ry * .22 }], 0xc3cdb6, .8, .55);
			a.line([{ x: p.x - rx * .16, y: p.y + ry * .18 }, { x: p.x + rx * .38, y: p.y + ry * .18 }], 0xb1bfaa, .6, .3);
			break;
		}
		case "stump": {
			a.box(p.x - 5, p.y - 5, 10, 10, 7, 0xa88f63, 0x6b6243, 0x4f5840);
			a.ellipse(p, 6.5, 6, 0xbb9e6c, 1, 7);
			a.ellipse(p, 3.7, 3.5, 0x887348, .65, 7.1);
			a.ellipse(p, 2.5, 2.2, 0xc1a873, 1, 7.2);
			a.line([{ x: p.x - 5, y: p.y + 1 }, { x: p.x - 1, y: p.y + 1 }], 0x695b3e, .8, .7, 7.3);
			for (const [dx, dy] of [[-9, 2], [7, 5], [0, -8]]) a.line([p, { x: p.x + dx!, y: p.y + dy! }], 0x6d6343, 2, .8);
			break;
		}
		case "logs":
		case "woodpile": {
			const stacked = decoration.kind === "woodpile";
			if (stacked) {
				for (const dx of [-12, 8]) a.box(p.x + dx, p.y - 10, 3, 20, 2, C.wood, 0x756a45, 0x5e5b3f);
			}
			const logs = stacked ? [[-10, -7, 2], [-10, 0, 2], [-10, 7, 2], [-9, -3, 7], [-9, 4, 7], [-8, 1, 12]] : [[-12, -5, 0], [-7, 4, 0], [-8, -1, 5]];
			for (const [dx, dy, z] of logs) {
				const length = stacked ? 23 : 19 + seed % 5;
				a.box(p.x + dx!, p.y + dy!, length, 5, 4.5, 0x93805a, 0x665b3e, 0x534f38, z!);
				a.line([{ x: p.x + dx! + 1, y: p.y + dy! + 2 }, { x: p.x + dx! + length - 1, y: p.y + dy! + 2 }], 0xb29a6b, .65, .55, z! + 4.6);
				const end = a.point({ x: p.x + dx! + length, y: p.y + dy! + 2.5 }, z! + 2.6);
				g.fillStyle(0xc5ab78).fillEllipse(end.x, end.y, 3.8, 4.2);
				g.lineStyle(.6, 0x826d46, .8).strokeEllipse(end.x, end.y, 2, 2.4);
			}
			break;
		}
		case "bench": {
			for (const dx of [-13, 10]) a.box(p.x + dx, p.y - 3, 3, 10, 8, C.steel, 0x4b6654, 0x354f43);
			for (const dy of [-5, 0, 5]) a.box(p.x - 16, p.y + dy, 33, 3.5, 2, C.wood, 0x846945, 0x645638, 8);
			for (const dx of [-12, 10]) a.box(p.x + dx, p.y - 5, 2, 3, 19, C.steel, 0x4b6654, 0x354f43);
			a.box(p.x - 16, p.y - 6, 33, 2, 6, C.wood, 0x927449, 0x645638, 15);
			a.line([{ x: p.x - 8, y: p.y }, { x: p.x - 2, y: p.y }], 0xd6bf88, .7, .55, 10.2);
			a.line([{ x: p.x + 6, y: p.y + 5 }, { x: p.x + 13, y: p.y + 5 }], 0x68573b, .6, .65, 10.2);
			for (const x of [-12, 12]) for (const y of [-4, 6]) {
				const bolt = a.point({ x: p.x + x, y: p.y + y }, 10.4); g.fillStyle(C.ink).fillRect(Math.round(bolt.x), Math.round(bolt.y), 1, 1);
			}
			a.line([{ x: p.x - 13, y: p.y - 5 }, { x: p.x + 7, y: p.y - 5 }], C.pale, 1, .45, 19.2);
			break;
		}
		case "barrels":
			for (const [dx, dy, color] of [[-8, 0, 0x7a8061], [5, -5, 0x698878]]) {
				const b = a.point({ x: p.x + dx!, y: p.y + dy! });
				g.fillStyle(color!).fillRoundedRect(b.x - 4, b.y - 13, 8, 12, 2);
				g.fillStyle(0xa2a886).fillEllipse(b.x, b.y - 13, 8, 3);
				for (const z of [4, 10]) g.lineStyle(.8, 0x3c5a48).lineBetween(b.x - 4, b.y - z, b.x + 4, b.y - z);
				g.fillStyle(0x956c46, .65).fillEllipse(b.x + 1, b.y - 7, 2.4, 3.5);
				g.fillStyle(0x3f5547, .7).fillCircle(b.x + 1, b.y - 13, .65);
				g.fillStyle(C.pale, .75).fillRect(Math.round(b.x - 3), Math.round(b.y - 9), 3, 2);
				g.fillStyle(C.ink).fillRect(Math.round(b.x - 2), Math.round(b.y - 9), 1, 1);
				g.lineStyle(1, C.pale, .5).lineBetween(Math.round(b.x - 3), Math.round(b.y - 11), Math.round(b.x - 3), Math.round(b.y - 5));
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
			g.fillStyle(0xb66e36, .8).fillEllipse(at.x, at.y - 3, 7, 2.5);
			g.fillStyle(0xe6af5e, .8).fillEllipse(at.x - 1, at.y - 3.5, 2.8, 1.2);
			a.box(p.x - 20, p.y + 4, 11, 11, 8, C.wood, 0x856d47, 0x5d5c3d);
			break;
		case "lamp":
			g.lineStyle(2.2, C.steel).lineBetween(at.x, at.y, at.x, at.y - 30);
			g.lineStyle(2, C.steel).lineBetween(at.x, at.y - 30, at.x + 7, at.y - 30);
			g.fillStyle(C.pale).fillEllipse(at.x + 7, at.y - 30, 7, 3);
			g.fillStyle(C.ink).fillRect(Math.round(at.x + 3), Math.round(at.y - 33), 8, 2);
			g.lineStyle(1, C.ink).lineBetween(Math.round(at.x + 1), Math.round(at.y - 1), Math.round(at.x + 1), Math.round(at.y - 27));
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
