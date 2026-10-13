import type { ShelterRect } from "./shelter-camera";
import {
	projectShelterBounds, shelterRoomPosition, SHELTER_COLUMN_STRIDE, SHELTER_ROOM_HEIGHT,
	SHELTER_ROOM_WIDTH, SHELTER_ROW_STRIDE, shelterRoomRect,
} from "./shelter-isometric";
import type { ShelterPoint } from "./shelter-motion";

/** Structural cells also accept room instances and the model's unopened frontier cells. */
export interface ShelterLayoutSite { column: number; row: number }
export interface ShelterLayoutBuilding extends ShelterLayoutSite { width: number; height: number }
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

function insideBuilding(point: ShelterPoint, building: ShelterLayoutBuilding): boolean {
	const rect = shelterRoomRect(building.column, building.row, building.width, building.height);
	return point.x > rect.x - EPSILON && point.x < rect.x + rect.width + EPSILON && point.y > rect.y - EPSILON && point.y < rect.y + rect.height + EPSILON;
}

export function getShelterRoomDoor(site: ShelterLayoutSite & Partial<Pick<ShelterLayoutBuilding, "width" | "height">>): ShelterPoint {
	const rect = shelterRoomRect(site.column, site.row, site.width, site.height);
	return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

export function getShelterCorridorPoint(site: ShelterLayoutSite & Partial<Pick<ShelterLayoutBuilding, "width" | "height">>): ShelterPoint {
	const door = getShelterRoomDoor(site);
	return { x: door.x, y: door.y + (SHELTER_ROW_STRIDE - SHELTER_ROOM_HEIGHT) / 2 };
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

/** BFS follows actual corridor edges and south doors, never the old lift or room-to-room diagonals. */
export function getShelterWalkingRoute(from: ShelterPoint, to: ShelterPoint, sites: readonly ShelterLayoutSite[], buildings: readonly ShelterLayoutBuilding[] = []): ShelterPoint[] {
	if (!finitePoint(from) || !finitePoint(to) || samePoint(from, to)) return [];
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
