import type { ShelterRect } from "./shelter-camera";
import {
	projectShelterBounds, shelterRoomPosition, SHELTER_COLUMN_STRIDE, SHELTER_ROOM_HEIGHT,
	SHELTER_ROOM_WIDTH, SHELTER_ROW_STRIDE, shelterRoomRect,
} from "./shelter-isometric";
import type { ShelterPoint } from "./shelter-motion";

/** Structural cells also accept room instances and the model's unopened frontier cells. */
export interface ShelterLayoutSite { column: number; row: number }
export interface ShelterLayoutBuilding extends ShelterLayoutSite { width: number; height: number; position?: ShelterPoint; facing?: 0 | 1 | 2 | 3 }
export interface ShelterCorridorSegment { from: ShelterPoint; to: ShelterPoint }
export const SHELTER_STREET_CORRIDOR_Y = 132;
const EPSILON = .001;
const finitePoint = (point: ShelterPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const samePoint = (a: ShelterPoint, b: ShelterPoint) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const pointKey = (point: ShelterPoint) => `${point.x.toFixed(5)},${point.y.toFixed(5)}`;
const validSites = (sites: readonly ShelterLayoutSite[]) => sites.filter((site) => Number.isSafeInteger(site.column) && Number.isSafeInteger(site.row));

/** Half-open floor diamonds are hit through their logical grid; corridor gaps stay empty. */
export function getShelterLayoutCell(point: ShelterPoint): ShelterLayoutSite | null {
	if (!finitePoint(point)) return null;
	const column = Math.floor((point.x - 40) / SHELTER_COLUMN_STRIDE);
	const row = Math.floor((point.y - 148) / SHELTER_ROW_STRIDE);
	const origin = shelterRoomPosition(column, row);
	return point.x >= origin.x && point.x < origin.x + SHELTER_ROOM_WIDTH
		&& point.y >= origin.y && point.y < origin.y + SHELTER_ROOM_HEIGHT ? { column, row } : null;
}

/** Land selection includes the paths between buildings, so each lot has one owner. */
export function getShelterTerritoryCell(point: ShelterPoint): ShelterLayoutSite | null {
	if (!finitePoint(point)) return null;
	return { column: Math.floor((point.x - 30) / SHELTER_COLUMN_STRIDE), row: Math.floor((point.y - 132) / SHELTER_ROW_STRIDE) };
}

type ShelterBuildingShape = ShelterLayoutSite & Partial<Pick<ShelterLayoutBuilding, "width" | "height" | "position" | "facing">>;

/** Ground origins are continuous; legacy lot coordinates are only a save-compatible fallback. */
export function getShelterBuildingPosition(building: ShelterBuildingShape): ShelterPoint {
	return building.position && finitePoint(building.position) ? { ...building.position } : shelterRoomPosition(building.column, building.row);
}

export function getShelterBuildingRect(building: ShelterBuildingShape): ShelterRect {
	const rect = shelterRoomRect(building.column, building.row, building.width, building.height);
	return { ...rect, ...getShelterBuildingPosition(building), ...(building.facing === 1 || building.facing === 3 ? { width: rect.height, height: rect.width } : {}) };
}

export function getShelterTerritoryRects(sites: readonly ShelterLayoutSite[]): ShelterRect[] {
	return validSites(sites).map((site) => { const p = shelterRoomPosition(site.column, site.row); return { x: p.x - 10, y: p.y - 16, width: SHELTER_COLUMN_STRIDE, height: SHELTER_ROW_STRIDE }; });
}

const inRect = (point: ShelterPoint, rect: ShelterRect) => point.x >= rect.x - EPSILON && point.x <= rect.x + rect.width + EPSILON && point.y >= rect.y - EPSILON && point.y <= rect.y + rect.height + EPSILON;
const inRectInterior = (point: ShelterPoint, rect: ShelterRect) => point.x > rect.x + EPSILON && point.x < rect.x + rect.width - EPSILON && point.y > rect.y + EPSILON && point.y < rect.y + rect.height - EPSILON;

export function isShelterPointInTerritory(point: ShelterPoint, sites: readonly ShelterLayoutSite[]): boolean {
	return finitePoint(point) && getShelterTerritoryRects(sites).some((rect) => inRect(point, rect));
}

/** Gathering points adapt to moved buildings and remain on actual open ground. */
export function getShelterOpenGroundPoints(sites: readonly ShelterLayoutSite[], buildings: readonly ShelterLayoutBuilding[] = []): ShelterPoint[] {
	const rects = buildings.map(getShelterBuildingRect), points: ShelterPoint[] = [];
	for (const lot of getShelterTerritoryRects(sites)) {
		for (const [dx, dy] of [[96, 82], [48, 44], [144, 44], [48, 98], [144, 98]]) {
			const point = { x: lot.x + dx!, y: lot.y + dy! };
			if (!rects.some((rect) => inRect(point, { x: rect.x - 10, y: rect.y - 10, width: rect.width + 20, height: rect.height + 20 }))) { points.push(point); break; }
		}
	}
	return points;
}

function insideBuilding(point: ShelterPoint, building: ShelterLayoutBuilding): boolean {
	const rect = getShelterBuildingRect(building);
	return point.x > rect.x - EPSILON && point.x < rect.x + rect.width + EPSILON && point.y > rect.y - EPSILON && point.y < rect.y + rect.height + EPSILON;
}

export function getShelterRoomDoor(site: ShelterBuildingShape): ShelterPoint {
	const rect = getShelterBuildingRect(site);
	switch (site.facing ?? 0) {
		case 1: return { x: rect.x, y: rect.y + rect.height / 2 };
		case 2: return { x: rect.x + rect.width / 2, y: rect.y };
		case 3: return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
		default: return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
	}
}

/** A quarter turn rotates the doorway as well as the physical ground footprint. */
export function getShelterRoomEntranceDirection(site: ShelterBuildingShape): ShelterPoint {
	return [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }][site.facing ?? 0]!;
}

export function getShelterCorridorPoint(site: ShelterBuildingShape): ShelterPoint {
	const door = getShelterRoomDoor(site), normal = getShelterRoomEntranceDirection(site), clearance = (SHELTER_ROW_STRIDE - SHELTER_ROOM_HEIGHT) / 2;
	return { x: door.x + normal.x * clearance, y: door.y + normal.y * clearance };
}

function entranceLead(point: ShelterPoint, building: ShelterBuildingShape): ShelterPoint[] {
	const door = getShelterRoomDoor(building), normal = getShelterRoomEntranceDirection(building);
	return [normal.x ? { x: point.x, y: door.y } : { x: door.x, y: point.y }, door];
}

/** Only carved cells contribute corridors; frontier rock never adds a walkable edge. */
export function getShelterCorridorSegments(sites: readonly ShelterLayoutSite[], buildings: readonly ShelterLayoutBuilding[] = []): ShelterCorridorSegment[] {
	const segments = new Map<string, ShelterCorridorSegment>();
	for (const site of validSites(sites)) {
		const origin = shelterRoomPosition(site.column, site.row);
		const west = origin.x - (SHELTER_COLUMN_STRIDE - SHELTER_ROOM_WIDTH) / 2;
		const north = origin.y - (SHELTER_ROW_STRIDE - SHELTER_ROOM_HEIGHT) / 2;
		const corners = [
			{ x: west, y: north }, { x: west + SHELTER_COLUMN_STRIDE, y: north },
			{ x: west + SHELTER_COLUMN_STRIDE, y: north + SHELTER_ROW_STRIDE }, { x: west, y: north + SHELTER_ROW_STRIDE },
		];
		for (let i = 0; i < corners.length; i++) {
			const from = corners[i]!, to = corners[(i + 1) % corners.length]!;
			const keys = [pointKey(from), pointKey(to)].sort();
			segments.set(keys.join("/"), { from: { ...from }, to: { ...to } });
		}
	}
	return [...segments.values()].filter(({ from, to }) => !buildings.some((building) => insideBuilding({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, building)));
}

function pointOnSegment(point: ShelterPoint, segment: ShelterCorridorSegment): boolean {
	const { from, to } = segment;
	if (Math.abs(from.x - to.x) < EPSILON) return Math.abs(point.x - from.x) < EPSILON && point.y >= Math.min(from.y, to.y) - EPSILON && point.y <= Math.max(from.y, to.y) + EPSILON;
	return Math.abs(point.y - from.y) < EPSILON && point.x >= Math.min(from.x, to.x) - EPSILON && point.x <= Math.max(from.x, to.x) + EPSILON;
}

interface CorridorAccess { anchor: ShelterPoint; lead: ShelterPoint[] }
function corridorAccess(point: ShelterPoint, sites: readonly ShelterLayoutSite[], segments: readonly ShelterCorridorSegment[], buildings: readonly ShelterLayoutBuilding[] = []): CorridorAccess | null {
	const building = buildings.find((candidate) => insideBuilding(point, candidate));
	if (building) {
		const door = getShelterRoomDoor(building), anchor = getShelterCorridorPoint(building);
		return { anchor, lead: [{ x: door.x, y: point.y }, door, anchor] };
	}
	const cell = getShelterLayoutCell(point);
	if (cell && sites.some((site) => site.column === cell.column && site.row === cell.row)) {
		const door = getShelterRoomDoor(cell), anchor = getShelterCorridorPoint(cell);
		return { anchor, lead: [{ x: door.x, y: point.y }, door, anchor] };
	}
	for (const site of [...sites, ...buildings]) {
		const door = getShelterRoomDoor(site), anchor = getShelterCorridorPoint(site);
		if (Math.abs(point.x - door.x) < EPSILON && point.y >= door.y - EPSILON && point.y <= anchor.y + EPSILON) return { anchor, lead: [anchor] };
	}
	if (segments.some((segment) => pointOnSegment(point, segment))) return { anchor: { ...point }, lead: [] };
	// The open street connects to the north edge of the surface rooms. Walking
	// sideways happens on the street before passing through the building entry.
	if (point.y <= SHELTER_STREET_CORRIDOR_Y) {
		const northEdges = segments.filter(({ from, to }) => Math.abs(from.y - SHELTER_STREET_CORRIDOR_Y) < EPSILON && Math.abs(to.y - SHELTER_STREET_CORRIDOR_Y) < EPSILON);
		let nearest: ShelterPoint | null = null, bestDistance = Number.POSITIVE_INFINITY;
		for (const edge of northEdges) {
			const entryX = buildings.length ? 318 : point.x;
			const anchor = { x: Math.max(Math.min(edge.from.x, edge.to.x), Math.min(Math.max(edge.from.x, edge.to.x), entryX)), y: SHELTER_STREET_CORRIDOR_Y };
			const distance = Math.abs(entryX - anchor.x);
			if (distance < bestDistance) { nearest = anchor; bestDistance = distance; }
		}
		if (nearest) return { anchor: nearest, lead: [{ x: nearest.x, y: point.y }, nearest] };
	}
	return null;
}

/** Legacy corridors remain stable; explicit placements and facing use actual ground and entrances. */
export function getShelterWalkingRoute(from: ShelterPoint, to: ShelterPoint, sites: readonly ShelterLayoutSite[], buildings: readonly ShelterLayoutBuilding[] = []): ShelterPoint[] {
	if (!finitePoint(from) || !finitePoint(to) || samePoint(from, to)) return [];
	if (buildings.some((building) => building.position && finitePoint(building.position) || building.facing !== undefined)) return freeWalkingRoute(from, to, sites, buildings);
	const cells = validSites(sites), fromCell = getShelterLayoutCell(from), toCell = getShelterLayoutCell(to);
	const fromBuilding = buildings.find((candidate) => insideBuilding(from, candidate));
	const toBuilding = buildings.find((candidate) => insideBuilding(to, candidate));
	if (fromBuilding && fromBuilding === toBuilding || !fromBuilding && !toBuilding && fromCell && toCell && fromCell.column === toCell.column && fromCell.row === toCell.row
		&& cells.some((site) => site.column === fromCell.column && site.row === fromCell.row)) {
		const corner = { x: to.x, y: from.y };
		return [corner, to].filter((point, index) => !samePoint(point, index ? corner : from)).map((point) => ({ ...point }));
	}
	const segments = getShelterCorridorSegments(cells, buildings);
	const start = corridorAccess(from, cells, segments, buildings), finish = corridorAccess(to, cells, segments, buildings);
	if (!start || !finish) return [];
	const points = new Map<string, ShelterPoint>(), graph = new Map<string, Set<string>>();
	const connect = (a: ShelterPoint, b: ShelterPoint) => {
		const aKey = pointKey(a), bKey = pointKey(b);
		points.set(aKey, { ...a }); points.set(bKey, { ...b });
		if (!graph.has(aKey)) graph.set(aKey, new Set());
		if (!graph.has(bKey)) graph.set(bKey, new Set());
		if (aKey !== bKey) { graph.get(aKey)!.add(bKey); graph.get(bKey)!.add(aKey); }
	};
	for (const segment of segments) {
		const split = [segment.from, segment.to, ...[start.anchor, finish.anchor].filter((point) => pointOnSegment(point, segment))]
			.sort((a, b) => a.x - b.x || a.y - b.y);
		for (let i = 1; i < split.length; i++) connect(split[i - 1]!, split[i]!);
	}
	const startKey = pointKey(start.anchor), finishKey = pointKey(finish.anchor);
	if (!graph.has(startKey) || !graph.has(finishKey)) return [];
	const previous = new Map<string, string | null>([[startKey, null]]), queue = [startKey];
	for (let i = 0; i < queue.length && !previous.has(finishKey); i++) {
		const current = queue[i]!;
		for (const neighbour of graph.get(current) ?? []) if (!previous.has(neighbour)) {
			previous.set(neighbour, current); queue.push(neighbour);
		}
	}
	if (!previous.has(finishKey)) return [];
	const keys: string[] = [];
	for (let key: string | null = finishKey; key !== null; key = previous.get(key) ?? null) keys.push(key);
	const corridor = keys.reverse().map((key) => points.get(key)!);
	const candidates = [...start.lead, ...corridor, ...finish.lead.slice(0, -1).reverse(), to];
	const result: ShelterPoint[] = [];
	for (const candidate of candidates) if (!samePoint(result.at(-1) ?? from, candidate)) result.push({ ...candidate });
	return result;
}

/** Exact segment intervals keep shortcuts inside an irregular union, including narrow gaps. */
function segmentInRect(from: ShelterPoint, to: ShelterPoint, rect: ShelterRect): [number, number] | null {
	let enter = 0, leave = 1;
	for (const [start, delta, min, max] of [
		[from.x, to.x - from.x, rect.x, rect.x + rect.width],
		[from.y, to.y - from.y, rect.y, rect.y + rect.height],
	]) {
		if (Math.abs(delta!) < 1e-9) { if (start! < min! - 1e-9 || start! > max! + 1e-9) return null; }
		else {
			const a = (min! - start!) / delta!, b = (max! - start!) / delta!;
			enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
			if (leave < enter - 1e-9) return null;
		}
	}
	return [enter, leave];
}

function visibleOnGround(from: ShelterPoint, to: ShelterPoint, lots: readonly ShelterRect[], obstacles: readonly ShelterRect[]): boolean {
	for (const rect of obstacles) {
		// Tangency at a wall or corner is allowed; the open building interior is blocked.
		const interval = segmentInRect(from, to, { x: rect.x + EPSILON, y: rect.y + EPSILON, width: rect.width - EPSILON * 2, height: rect.height - EPSILON * 2 });
		if (interval && interval[1] - interval[0] > 1e-8) return false;
	}
	const intervals = lots.map((rect) => segmentInRect(from, to, rect)).filter((interval): interval is [number, number] => interval !== null).sort((a, b) => a[0] - b[0]);
	let covered = 0;
	for (const [start, end] of intervals) {
		if (start > covered + 1e-8) return false;
		covered = Math.max(covered, end);
		if (covered >= 1 - 1e-8) return true;
	}
	return false;
}

/** Free placements use actual doors and rectangle corners, with no placement grid involved. */
function freeWalkingRoute(from: ShelterPoint, to: ShelterPoint, sites: readonly ShelterLayoutSite[], buildings: readonly ShelterLayoutBuilding[]): ShelterPoint[] {
	const lots = getShelterTerritoryRects(sites), obstacles = buildings.map(getShelterBuildingRect);
	const fromBuilding = buildings.find((building) => insideBuilding(from, building));
	const toBuilding = buildings.find((building) => insideBuilding(to, building));
	if (fromBuilding && fromBuilding === toBuilding) {
		const corner = { x: to.x, y: from.y };
		return [corner, to].filter((point, index) => !samePoint(point, index ? corner : from)).map((point) => ({ ...point }));
	}
	const inGround = (point: ShelterPoint) => lots.some((rect) => inRect(point, rect));
	const walkable = (point: ShelterPoint) => inGround(point) && !obstacles.some((rect) => inRectInterior(point, rect));
	const gate = { x: 318, y: SHELTER_STREET_CORRIDOR_Y };
	const access = (point: ShelterPoint, building: ShelterLayoutBuilding | undefined): CorridorAccess | null => {
		if (building) {
			const door = getShelterRoomDoor(building), outside = getShelterCorridorPoint(building);
			if (!walkable(door)) return null;
			const anchor = walkable(outside) && visibleOnGround(door, outside, lots, obstacles) ? outside : door;
			return { anchor, lead: [...entranceLead(point, building), anchor] };
		}
		if (walkable(point)) return { anchor: { ...point }, lead: [] };
		if (point.y <= SHELTER_STREET_CORRIDOR_Y && walkable(gate)) return { anchor: gate, lead: [{ x: gate.x, y: point.y }, gate] };
		return null;
	};
	const start = access(from, fromBuilding), finish = access(to, toBuilding);
	if (!start || !finish) return [];
	const nodes = new Map<string, ShelterPoint>();
	const add = (point: ShelterPoint) => { if (walkable(point)) nodes.set(pointKey(point), { ...point }); };
	add(start.anchor); add(finish.anchor);
	for (const rect of lots) for (const x of [rect.x, rect.x + rect.width]) for (const y of [rect.y, rect.y + rect.height]) add({ x, y });
	for (const rect of obstacles) {
		for (const inset of [0, 3]) for (const x of [rect.x - inset, rect.x + rect.width + inset]) for (const y of [rect.y - inset, rect.y + rect.height + inset]) add({ x, y });
	}
	for (const building of buildings) add(getShelterRoomDoor(building));
	const points = [...nodes.values()], startIndex = points.findIndex((point) => samePoint(point, start.anchor)), finishIndex = points.findIndex((point) => samePoint(point, finish.anchor));
	if (startIndex < 0 || finishIndex < 0) return [];
	const graph: { to: number; distance: number }[][] = points.map(() => []);
	for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
		if (!visibleOnGround(points[a]!, points[b]!, lots, obstacles)) continue;
		const distance = Math.hypot(points[a]!.x - points[b]!.x, points[a]!.y - points[b]!.y);
		graph[a]!.push({ to: b, distance }); graph[b]!.push({ to: a, distance });
	}
	const distances = points.map(() => Number.POSITIVE_INFINITY), previous = points.map(() => -1), visited = new Set<number>();
	distances[startIndex] = 0;
	for (let step = 0; step < points.length; step++) {
		let current = -1;
		for (let i = 0; i < points.length; i++) if (!visited.has(i) && (current < 0 || distances[i]! < distances[current]!)) current = i;
		if (current < 0 || !Number.isFinite(distances[current]!)) break;
		if (current === finishIndex) break;
		visited.add(current);
		for (const edge of graph[current]!) {
			const distance = distances[current]! + edge.distance;
			if (distance < distances[edge.to]!) { distances[edge.to] = distance; previous[edge.to] = current; }
		}
	}
	if (!Number.isFinite(distances[finishIndex]!)) return [];
	const ground: ShelterPoint[] = [];
	for (let at = finishIndex; at >= 0; at = previous[at]!) ground.push(points[at]!);
	const candidates = [...start.lead, ...ground.reverse(), ...finish.lead.slice(0, -1).reverse(), to];
	const result: ShelterPoint[] = [];
	for (const point of candidates) if (!samePoint(result.at(-1) ?? from, point)) result.push({ ...point });
	return result;
}

/** Camera bounds include the street, unopened border walls, wall height and floor slab. */
export function getShelterWorldBounds(sites: readonly ShelterLayoutSite[], frontier: readonly ShelterLayoutSite[] = []): ShelterRect {
	const cells = validSites([...sites, ...frontier]);
	if (!cells.length) cells.push({ column: 0, row: 0 });
	const origins = cells.map((site) => shelterRoomPosition(site.column, site.row));
	const left = Math.min(...origins.map((point) => point.x)) - 28;
	const right = Math.max(...origins.map((point) => point.x + SHELTER_ROOM_WIDTH)) + 28;
	const top = Math.min(-36, ...origins.map((point) => point.y - 24));
	const bottom = Math.max(...origins.map((point) => point.y + SHELTER_ROOM_HEIGHT)) + 28;
	const projected = projectShelterBounds({ x: left, y: top, width: right - left, height: bottom - top });
	return { x: Math.floor(projected.x - 20), y: Math.floor(projected.y - 70), width: Math.ceil(projected.width + 40), height: Math.ceil(projected.height + 98) };
}
