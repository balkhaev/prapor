import { describe, expect, test } from "bun:test";
import {
	clampShelterCamera, focusShelterRect, panShelterCamera, projectShelterRect,
	resizeShelterCamera, shelterToViewport, shelterViewportForSize, viewportToShelter,
	zoomShelterCamera, type ShelterCamera, type ShelterViewport,
} from "../src/shelter-camera";
import { clientToShelterPoint, getShelterCell } from "../src/shelter-motion";

const DEFAULT: ShelterViewport = { width: 840, height: 520 };
const WIDE: ShelterViewport = { width: 1370, height: 520 };
const PORTRAIT: ShelterViewport = { width: 840, height: 1493 + 1 / 3 };
const CENTER = { x: 420, y: 260 };
function center(viewport: ShelterViewport) {
	return { x: viewport.width / 2, y: viewport.height / 2 };
}
function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
	expect(actual.x).toBeCloseTo(expected.x, 7);
	expect(actual.y).toBeCloseTo(expected.y, 7);
}

describe("camera fills the actual shelter viewport", () => {
	test("wide and portrait sizes keep the whole world at fit scale without stretching logical coordinates", () => {
		for (const size of [{ width: 943, height: 358 }, { width: 360, height: 640 }, { width: 840, height: 520 }]) {
			const viewport = shelterViewportForSize(size.width, size.height);
			expect(viewport.width).toBeGreaterThanOrEqual(840);
			expect(viewport.height).toBeGreaterThanOrEqual(520);
			expect(viewport.width / viewport.height).toBeCloseTo(size.width / size.height, 8);
			expect(viewport.width === 840 || viewport.height === 520).toBe(true);
			const camera = clampShelterCamera({ zoom: 1, x: 999, y: -999 }, viewport);
			expectPoint(shelterToViewport(CENTER, camera, viewport), center(viewport));
			const first = shelterToViewport({ x: 0, y: 0 }, camera, viewport);
			const last = shelterToViewport({ x: 840, y: 520 }, camera, viewport);
			expect(first.x).toBeGreaterThanOrEqual(0);
			expect(first.y).toBeGreaterThanOrEqual(0);
			expect(last.x).toBeLessThanOrEqual(viewport.width);
			expect(last.y).toBeLessThanOrEqual(viewport.height);
		}
	});

	test("fit centers the extra axis; zoomed panning stops where the visible world ends", () => {
		for (const viewport of [DEFAULT, WIDE, PORTRAIT]) for (const zoom of [1, 2, 4]) {
			const source = { zoom, x: 100, y: 80 };
			const low = panShelterCamera(source, -100_000, -100_000, viewport);
			const high = panShelterCamera(source, 100_000, 100_000, viewport);
			for (const axis of ["x", "y"] as const) {
				const world = axis === "x" ? 840 : 520;
				const visible = (axis === "x" ? viewport.width : viewport.height) / zoom;
				if (visible >= world) {
					expect(low[axis]).toBeCloseTo((world - visible) / 2, 8);
					expect(high[axis]).toBeCloseTo(low[axis], 8);
				} else {
					expect(low[axis]).toBe(0);
					expect(high[axis]).toBeCloseTo(world - visible, 8);
				}
			}
			expect(source).toEqual({ zoom, x: 100, y: 80 });
		}
	});

	test("pointer anchored zoom and inverse coordinates remain attached in every aspect ratio", () => {
		for (const viewport of [DEFAULT, WIDE, PORTRAIT]) {
			const camera = clampShelterCamera({ zoom: 3, x: 100, y: 20 }, viewport);
			const anchor = center(viewport);
			const world = viewportToShelter(anchor, camera, viewport);
			const zoomed = zoomShelterCamera(camera, 4, anchor, viewport);
			expectPoint(viewportToShelter(anchor, zoomed, viewport), world);
			expectPoint(shelterToViewport(world, zoomed, viewport), anchor);
			const returned = zoomShelterCamera(zoomed, 3, anchor, viewport);
			expectPoint(returned, camera);
			for (const point of [{ x: 0, y: 0 }, anchor, { x: viewport.width - .1, y: viewport.height - .1 }]) {
				expectPoint(shelterToViewport(viewportToShelter(point, camera, viewport), camera, viewport), point);
			}
		}
	});

	test("centered overview gutters stay outside the world instead of becoming a room drop target", () => {
		const wide = clampShelterCamera({ zoom: 1, x: 0, y: 0 }, WIDE);
		const portrait = clampShelterCamera({ zoom: 1, x: 0, y: 0 }, PORTRAIT);
		for (const pointer of [{ x: 1, y: 200 }, { x: WIDE.width - 1, y: 200 }]) {
			const world = viewportToShelter(pointer, wide, WIDE);
			expect(world.x < 0 || world.x > 840).toBe(true);
			expect(getShelterCell(world)).toBeNull();
			expectPoint(shelterToViewport(world, wide, WIDE), pointer);
		}
		for (const pointer of [{ x: 120, y: 1 }, { x: 120, y: PORTRAIT.height - 1 }]) {
			const world = viewportToShelter(pointer, portrait, PORTRAIT);
			expect(world.y < 0 || world.y > 520).toBe(true);
			expect(getShelterCell(world)).toBeNull();
			expectPoint(shelterToViewport(world, portrait, PORTRAIT), pointer);
		}
	});

	test("all room targets project to the same client pixels as worker drops after wide or portrait focus", () => {
		for (const size of [{ width: 943, height: 358 }, { width: 360, height: 640 }, { width: 840, height: 520 }]) {
			const viewport = shelterViewportForSize(size.width, size.height);
			const canvas = { left: 137, top: 63, ...size };
			for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
				const room = { x: [40, 220, 448, 628][column]!, y: 148 + row * 111, width: 172, height: 100 };
				const camera = focusShelterRect({ zoom: 1, x: 0, y: 0 }, room, 2.4, viewport);
				const projected = projectShelterRect(room, camera, canvas, viewport)!;
				expect(projected.visible).toBe(true);
				expect(projected.left).toBeGreaterThanOrEqual(canvas.left - 1e-7);
				expect(projected.top).toBeGreaterThanOrEqual(canvas.top - 1e-7);
				expect(projected.left + projected.width).toBeLessThanOrEqual(canvas.left + canvas.width + 1e-7);
				expect(projected.top + projected.height).toBeLessThanOrEqual(canvas.top + canvas.height + 1e-7);
				expect(projected.width / room.width).toBeCloseTo(projected.height / room.height, 8);
				const pointer = clientToShelterPoint(projected.left + projected.width / 2, projected.top + projected.height / 2,
					canvas, viewport.width, viewport.height)!;
				expect(getShelterCell(viewportToShelter(pointer, camera, viewport))).toEqual({ row, column });
			}
			for (const point of [{ x: 136, y: 100 }, { x: 138, y: 62 }, { x: 137 + size.width, y: 100 }, { x: 138, y: 63 + size.height }]) {
				expect(clientToShelterPoint(point.x, point.y, canvas, viewport.width, viewport.height)).toBeNull();
			}
		}
	});

	test("rotation preserves the viewed world center when possible and bounds edge views without moving the world", () => {
		const source = { zoom: 4, x: 250, y: 205 }, before = structuredClone(source);
		const viewed = viewportToShelter(center(WIDE), source, WIDE);
		const rotated = resizeShelterCamera(source, WIDE, PORTRAIT);
		expectPoint(viewportToShelter(center(PORTRAIT), rotated, PORTRAIT), viewed);
		expectPoint(resizeShelterCamera(rotated, PORTRAIT, WIDE), source);
		expect(source).toEqual(before);
		for (const viewport of [DEFAULT, WIDE, PORTRAIT]) {
			const fit = resizeShelterCamera({ zoom: 1, x: 0, y: 0 }, DEFAULT, viewport);
			expectPoint(viewportToShelter(center(viewport), fit, viewport), CENTER);
			const edge = resizeShelterCamera({ zoom: 4, x: 630, y: 390 }, DEFAULT, viewport);
			expect(edge).toEqual(clampShelterCamera(edge, viewport));
			expect(Object.values(edge).every(Number.isFinite)).toBe(true);
		}
	});

	test("omitting viewport preserves existing coordinate, pan, zoom, focus and projection behavior", () => {
		const camera: ShelterCamera = { zoom: 2, x: 120, y: 80 }, point = { x: 400, y: 230 };
		const room = { x: 448, y: 259, width: 172, height: 100 }, canvas = { left: 30, top: 40, width: 420, height: 260 };
		expect(clampShelterCamera(camera)).toEqual(clampShelterCamera(camera, DEFAULT));
		expect(viewportToShelter(point, camera)).toEqual(viewportToShelter(point, camera, DEFAULT));
		expect(shelterToViewport(point, camera)).toEqual(shelterToViewport(point, camera, DEFAULT));
		expect(panShelterCamera(camera, 23, -12)).toEqual(panShelterCamera(camera, 23, -12, DEFAULT));
		expect(zoomShelterCamera(camera, 3, point)).toEqual(zoomShelterCamera(camera, 3, point, DEFAULT));
		expect(focusShelterRect(camera, room)).toEqual(focusShelterRect(camera, room, 2.4, DEFAULT));
		expect(projectShelterRect(room, camera, canvas)).toEqual(projectShelterRect(room, camera, canvas, DEFAULT));
	});
});
