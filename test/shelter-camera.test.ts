import { describe, expect, test } from "bun:test";
import {
	clampShelterCamera, focusShelterRect, panShelterCamera, projectShelterRect,
	shelterToViewport, viewportToShelter, zoomShelterCamera,
	MAX_SHELTER_ZOOM, MIN_SHELTER_ZOOM, type ShelterCamera,
} from "../src/shelter-camera";
import { clientToShelterPoint, getShelterCell } from "../src/shelter-motion";

describe("shelter camera coordinates", () => {
	test("pointer coordinates round trip through zoom and pan without mutating camera state", () => {
		for (const camera of [{ zoom: 1, x: 0, y: 0 }, { zoom: 2, x: 120, y: 90 }, { zoom: 3, x: 500, y: 300 }, { zoom: 4, x: 600, y: 370 }]) {
			const before = { ...camera };
			for (const point of [{ x: 0, y: 0 }, { x: 420, y: 260 }, { x: 839, y: 519 }]) {
				const roundtrip = shelterToViewport(viewportToShelter(point, camera), camera);
				expect(roundtrip.x).toBeCloseTo(point.x, 8);
				expect(roundtrip.y).toBeCloseTo(point.y, 8);
			}
			expect(camera).toEqual(before);
		}
	});

	test("zoom retains the world point under the pointer unless a world edge prevents it", () => {
		const camera = { zoom: 2, x: 100, y: 80 }, anchor = { x: 400, y: 260 };
		const world = viewportToShelter(anchor, camera), zoomed = zoomShelterCamera(camera, 3, anchor);
		expect(viewportToShelter(anchor, zoomed).x).toBeCloseTo(world.x, 8);
		expect(viewportToShelter(anchor, zoomed).y).toBeCloseTo(world.y, 8);
		const returned = zoomShelterCamera(zoomed, 2, anchor);
		expect(returned.x).toBeCloseTo(camera.x, 8);
		expect(returned.y).toBeCloseTo(camera.y, 8);
		expect(zoomShelterCamera({ zoom: 3, x: 500, y: 300 }, 1, { x: 10, y: 10 })).toEqual({ zoom: 1, x: 0, y: 0 });
	});

	test("pan distance is expressed in viewport pixels, is frame-partition stable and stops at world edges", () => {
		const camera = { zoom: 2, x: 100, y: 80 };
		const whole = panShelterCamera(camera, 120, 80);
		let split = camera;
		for (let i = 0; i < 10; i++) split = panShelterCamera(split, 12, 8);
		expect(split).toEqual(whole);
		expect(whole.x - camera.x).toBe(60);
		expect(whole.y - camera.y).toBe(40);
		const minimum = panShelterCamera(camera, -10_000, -10_000), maximum = panShelterCamera(camera, 10_000, 10_000);
		expect(minimum).toEqual({ zoom: 2, x: 0, y: 0 });
		expect(viewportToShelter({ x: 840, y: 520 }, maximum)).toEqual({ x: 840, y: 520 });
	});

	test("room overlays use the same scaled world/client mapping as worker drops for every floor and column", () => {
		const canvas = { left: 137, top: 63, width: 420, height: 260 };
		for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
			const rect = { x: [40, 220, 448, 628][column]!, y: 148 + row * 111, width: 172, height: 100 };
			const camera = focusShelterRect({ zoom: 1, x: 0, y: 0 }, rect, 2.4);
			const projected = projectShelterRect(rect, camera, canvas)!;
			expect(projected.visible).toBe(true);
			expect(projected.width).toBeCloseTo(rect.width * 2.4 * .5, 8);
			expect(projected.height).toBeCloseTo(rect.height * 2.4 * .5, 8);
			expect(projected.left).toBeGreaterThanOrEqual(canvas.left - 1e-7);
			expect(projected.top).toBeGreaterThanOrEqual(canvas.top - 1e-7);
			expect(projected.left + projected.width).toBeLessThanOrEqual(canvas.left + canvas.width + 1e-7);
			expect(projected.top + projected.height).toBeLessThanOrEqual(canvas.top + canvas.height + 1e-7);
			const viewport = clientToShelterPoint(projected.left + projected.width / 2, projected.top + projected.height / 2, canvas)!;
			expect(getShelterCell(viewportToShelter(viewport, camera))).toEqual({ row, column });
		}
	});

	test("offscreen rooms keep full projection for keyboard reveal while offcanvas pointer drops are rejected", () => {
		const canvas = { left: 50, top: 100, width: 420, height: 260 }, camera = { zoom: 3, x: 500, y: 300 };
		const rect = { x: 40, y: 148, width: 172, height: 100 };
		const offscreen = projectShelterRect(rect, camera, canvas)!;
		expect(offscreen.visible).toBe(false);
		expect(offscreen.width).toBeGreaterThan(0);
		expect(offscreen.left + offscreen.width).toBeLessThan(canvas.left);
		expect(projectShelterRect(rect, focusShelterRect(camera, rect), canvas)?.visible).toBe(true);
		for (const point of [{ x: 49, y: 200 }, { x: 200, y: 99 }, { x: 470, y: 200 }, { x: 200, y: 360 }]) expect(clientToShelterPoint(point.x, point.y, canvas)).toBeNull();
	});

	test("invalid geometry is rejected and nonfinite camera inputs still clamp to a finite usable viewport", () => {
		const canvas = { left: 0, top: 0, width: 420, height: 260 }, rect = { x: 40, y: 148, width: 172, height: 100 };
		for (const invalid of [{ ...canvas, width: 0 }, { ...canvas, height: NaN }, { ...canvas, left: Infinity }]) expect(projectShelterRect(rect, { zoom: 1, x: 0, y: 0 }, invalid)).toBeNull();
		expect(projectShelterRect({ ...rect, width: -1 }, { zoom: 1, x: 0, y: 0 }, canvas)).toBeNull();
		for (const camera of [{ zoom: Infinity, x: NaN, y: -Infinity }, { zoom: -10, x: -100, y: 9999 }, { zoom: 9999, x: 9999, y: 9999 }]) {
			const bounded: ShelterCamera = clampShelterCamera(camera);
			expect(bounded.zoom).toBeGreaterThanOrEqual(MIN_SHELTER_ZOOM);
			expect(bounded.zoom).toBeLessThanOrEqual(MAX_SHELTER_ZOOM);
			expect(Object.values(bounded).every(Number.isFinite)).toBe(true);
			expect(bounded.x).toBeGreaterThanOrEqual(0);
			expect(bounded.y).toBeGreaterThanOrEqual(0);
			expect(viewportToShelter({ x: 840, y: 520 }, bounded).x).toBeLessThanOrEqual(840);
			expect(viewportToShelter({ x: 840, y: 520 }, bounded).y).toBeLessThanOrEqual(520);
		}
	});
});
