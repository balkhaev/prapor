import { describe, expect, test } from "bun:test";
import {
	clampShelterCamera, focusShelterRect, panShelterCamera, projectShelterRect,
	shelterToViewport, shelterViewportForSize, viewportToShelter, zoomShelterCamera,
} from "../src/shelter-camera";
import {
	projectShelterBounds, projectShelterPoint, SHELTER_ROOM_HEIGHT, SHELTER_ROOM_WIDTH,
	SHELTER_BUILDING_MAX_VISUAL_HEIGHT, shelterBuildingDepth, shelterBuildingHitPolygon, shelterRectPolygon, shelterRoomPolygon, shelterRoomPosition, unprojectShelterPoint,
} from "../src/shelter-isometric";
import { getShelterLayoutCell, getShelterWalkingRoute } from "../src/shelter-layout";
import { clientToShelterPoint } from "../src/shelter-motion";

const roomRect = (column: number, row: number) => ({ ...shelterRoomPosition(column, row), width: SHELTER_ROOM_WIDTH, height: SHELTER_ROOM_HEIGHT });
const center = (rect: { x: number; y: number; width: number; height: number }) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const sites = Array.from({ length: 12 }, (_, index) => ({ column: index % 4, row: Math.floor(index / 4) }));
function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
	expect(actual.x).toBeCloseTo(expected.x, 8);
	expect(actual.y).toBeCloseTo(expected.y, 8);
}

describe("isometric shelter presentation", () => {
	test("long building roofs select the visible foreground structure even when origin ordering differs", () => {
		const large = { x: 50, y: 280, width: 556, height: 232 }, compact = { x: 250, y: 148, width: 172, height: 100 };
		expect(projectShelterPoint(large).y).toBeLessThan(projectShelterPoint(compact).y);
		expect(shelterBuildingDepth(large)).toBeGreaterThan(shelterBuildingDepth(compact));
		expect([large, compact].sort((a, b) => shelterBuildingDepth(b) - shelterBuildingDepth(a))[0]).toBe(large);
	});
	test("building hit hull includes actual roof ridges, eaves and chimney caps at free and rotated origins", () => {
		const inside = (polygon: { x: number; y: number }[], point: { x: number; y: number }) => polygon.every((a, index) => {
			const b = polygon[(index + 1) % polygon.length]!;
			return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= -1e-7;
		});
		for (const rect of [roomRect(0, 0), { x: 318.375, y: 286.625, width: 556, height: 232 }, { x: 61.625, y: 208.875, width: 364, height: 364 }]) {
			const hull = shelterBuildingHitPolygon(rect);
			const at = (x: number, y: number, z: number) => { const point = projectShelterPoint({ x: rect.x + x, y: rect.y + y }); return { x: point.x, y: point.y - z }; };
			for (const vertex of [[-4, -5, 33], [rect.width + 4, -5, 33], [-4, 4, 41], [rect.width + 4, 4, 41], [rect.width / 2, 4, 41], [rect.width - 24, 1, 49.1], [rect.width - 18, 6, 49.1], [rect.width * .52, rect.height + 10, -4.6]]) {
				expect(inside(hull, at(vertex[0]!, vertex[1]!, vertex[2]!))).toBe(true);
			}
			expect(inside(hull, at(0, 0, SHELTER_BUILDING_MAX_VISUAL_HEIGHT + 12))).toBe(false);
			expect(inside(hull, at(rect.width + 40, 0, 0))).toBe(false);
		}
	});

	test("free building footprints preserve fractional origins and dimensions in projection", () => {
		const rect = { x: 318.375, y: 286.625, width: 364, height: 232 };
		const projected = shelterRectPolygon(rect);
		const original = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
		projected.forEach((point, index) => expectPoint(unprojectShelterPoint(point), original[index]!));
		expectPoint(center(projectShelterBounds(rect)), projectShelterPoint(center(rect)));
	});

	test("a grabbed building follows an unsnapped pointer under zoom, pan and a scaled canvas", () => {
		const origin = { x: 261.25, y: 198.875 }, grab = { x: origin.x + 93.375, y: origin.y + 41.5 };
		const destination = { x: 397.825, y: 282.35 }, pointer = { x: destination.x + grab.x - origin.x, y: destination.y + grab.y - origin.y };
		for (const size of [{ width: 943, height: 358 }, { width: 360, height: 640 }, { width: 840, height: 520 }]) {
			const viewport = shelterViewportForSize(size.width, size.height), canvas = { left: 71, top: 48, ...size };
			const camera = panShelterCamera(focusShelterRect({ zoom: 1, x: 0, y: 0 }, projectShelterBounds({ ...destination, width: 172, height: 100 }), 2.5, viewport), 9.7, -13.25, viewport);
			const visual = shelterToViewport(projectShelterPoint(pointer), camera, viewport);
			const client = { x: canvas.left + visual.x * canvas.width / viewport.width, y: canvas.top + visual.y * canvas.height / viewport.height };
			const point = clientToShelterPoint(client.x, client.y, canvas, viewport.width, viewport.height)!;
			const ground = unprojectShelterPoint(viewportToShelter(point, camera, viewport));
			expectPoint({ x: ground.x - (grab.x - origin.x), y: ground.y - (grab.y - origin.y) }, destination);
		}
	});

	test("both ground axes share the raid's 2:1 angle and the complete layout fits the existing world", () => {
		const source = { x: 420, y: 300 }, before = { ...source }, floor = projectShelterPoint(source);
		const east = projectShelterPoint({ ...source, x: source.x + 100 }), south = projectShelterPoint({ ...source, y: source.y + 100 });
		expect(east.x).toBeGreaterThan(floor.x);
		expect(south.x).toBeLessThan(floor.x);
		expect(east.x - floor.x).toBeCloseTo((east.y - floor.y) * 2, 8);
		expect(floor.x - south.x).toBeCloseTo((south.y - floor.y) * 2, 8);
		expect(source).toEqual(before);
		const bounds = projectShelterBounds({ x: 0, y: 0, width: 840, height: 520 });
		expect(bounds.x).toBeGreaterThanOrEqual(0);
		expect(bounds.y).toBeGreaterThanOrEqual(0);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(840);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(520);
	});

	test("every room center and worker route point round trips without moving saved geometry", () => {
		for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
			const rect = roomRect(column, row), logical = center(rect), polygon = shelterRoomPolygon(column, row);
			expectPoint(unprojectShelterPoint(projectShelterPoint(logical)), logical);
			expect(getShelterLayoutCell(unprojectShelterPoint(projectShelterPoint(logical)))).toEqual({ column, row });
			const bounds = projectShelterBounds(rect);
			expectPoint(center(bounds), projectShelterPoint(logical));
			expect(bounds.width).toBeCloseTo(bounds.height * 2, 8);
			expect(polygon).toHaveLength(4);
			for (const corner of polygon) {
				expect(corner.x).toBeGreaterThanOrEqual(bounds.x - 1e-7);
				expect(corner.x).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-7);
				expect(corner.y).toBeGreaterThanOrEqual(bounds.y - 1e-7);
				expect(corner.y).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-7);
			}
			const from = { x: 112, y: 129 }, route = getShelterWalkingRoute(from, { x: rect.x + 86, y: rect.y + 80 }, sites), before = structuredClone(route);
			for (const point of [from, ...route]) expectPoint(unprojectShelterPoint(projectShelterPoint(point)), point);
			expect(route).toEqual(before);
		}
	});

	test("diamond bounding boxes do not become false room hits; empty corridors and gaps stay empty", () => {
		for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
			const bounds = projectShelterBounds(roomRect(column, row));
			for (const corner of [
				{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
				{ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
			]) {
				// An overlapping bounding box may cover a neighboring diamond, but never this room's floor.
					expect(getShelterLayoutCell(unprojectShelterPoint(corner))).not.toEqual({ column, row });
			}
		}
		for (const logical of [
			{ x: 0, y: 0 }, { x: 420, y: 300 }, { x: 216, y: 200 }, { x: 440, y: 390 },
			{ x: 612, y: 300 }, { x: 100, y: 253 }, { x: 100, y: 400 }, { x: 805, y: 500 },
		]) expect(getShelterLayoutCell(unprojectShelterPoint(projectShelterPoint(logical)))).toBeNull();
	});

	test("all room targets compose with focus, zoom, pan and scaled client coordinates in every stage aspect", () => {
		for (const size of [{ width: 943, height: 358 }, { width: 360, height: 640 }, { width: 840, height: 520 }]) {
			const viewport = shelterViewportForSize(size.width, size.height), canvas = { left: 137, top: 63, ...size };
			const middleCamera = focusShelterRect({ zoom: 1, x: 0, y: 0 }, { x: 410, y: 250, width: 20, height: 20 }, 2.4, viewport);
			const middleAnchor = { x: viewport.width / 2, y: viewport.height / 2 };
			expectPoint(viewportToShelter(middleAnchor, zoomShelterCamera(middleCamera, 3, middleAnchor, viewport), viewport), { x: 420, y: 260 });
			for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
				const rect = roomRect(column, row), logical = center(rect), ground = projectShelterPoint(logical), bounds = projectShelterBounds(rect);
				const focused = focusShelterRect({ zoom: 1, x: 0, y: 0 }, bounds, 2.4, viewport);
				const anchor = shelterToViewport(ground, focused, viewport), zoomed = zoomShelterCamera(focused, 3, anchor, viewport);
				const panned = panShelterCamera(zoomed, 24, -18, viewport);
				expect(panned).toEqual(clampShelterCamera(panned, viewport));
				for (const camera of [focused, zoomed, panned]) {
					const target = projectShelterRect(bounds, camera, canvas, viewport)!;
					expect(target.visible).toBe(true);
					const pointer = clientToShelterPoint(target.left + target.width / 2, target.top + target.height / 2, canvas, viewport.width, viewport.height);
					expect(pointer).not.toBeNull();
					const restored = unprojectShelterPoint(viewportToShelter(pointer!, camera, viewport));
					expectPoint(restored, logical);
					expect(getShelterLayoutCell(restored)).toEqual({ column, row });
				}
			}
		}
	});
});
