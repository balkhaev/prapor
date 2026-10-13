import { describe, expect, test } from "bun:test";
import {
	clampShelterCamera, focusShelterRect, panShelterCamera, projectShelterRect,
	shelterToViewport, shelterViewportForSize, viewportToShelter, zoomShelterCamera,
} from "../src/shelter-camera";
import {
	projectShelterBounds, projectShelterPoint, SHELTER_ROOM_HEIGHT, SHELTER_ROOM_WIDTH,
	shelterRoomPolygon, shelterRoomPosition, unprojectShelterPoint,
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
