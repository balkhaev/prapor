import { describe, expect, test } from "bun:test";
import {
	clampShelterCamera, focusShelterRect, getMinShelterZoom, panShelterCamera,
	projectShelterRect, resizeShelterCamera, shelterOverviewCamera, shelterToViewport,
	shelterViewportForSize, viewportToShelter, zoomShelterCamera, type ShelterRect,
} from "../src/shelter-camera";
import { clientToShelterPoint } from "../src/shelter-motion";

const VIEW = { width: 840, height: 520 };
const BOUNDS: ShelterRect = { x: -1000, y: -800, width: 3000, height: 2400 };
const center = (rect: ShelterRect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
	expect(actual.x).toBeCloseTo(expected.x, 8);
	expect(actual.y).toBeCloseTo(expected.y, 8);
}

describe("camera follows an expanding shelter footprint", () => {
	test("overview contains every signed corner and centers the full footprint in all aspect ratios", () => {
		const footprints = [BOUNDS, { x: -420, y: -260, width: 1680, height: 1040 }];
		for (const bounds of footprints) for (const size of [VIEW, { width: 360, height: 640 }, { width: 1440, height: 600 }]) {
			const viewport = shelterViewportForSize(size.width, size.height);
			const camera = shelterOverviewCamera(viewport, bounds);
			expect(camera.zoom).toBe(getMinShelterZoom(viewport, bounds));
			expect(camera.zoom).toBe(Math.min(1, viewport.width / bounds.width, viewport.height / bounds.height));
			expectPoint(shelterToViewport(center(bounds), camera, viewport, bounds), { x: viewport.width / 2, y: viewport.height / 2 });
			for (const x of [bounds.x, bounds.x + bounds.width]) for (const y of [bounds.y, bounds.y + bounds.height]) {
				const point = shelterToViewport({ x, y }, camera, viewport, bounds);
				expect(point.x).toBeGreaterThanOrEqual(-1e-8);
				expect(point.y).toBeGreaterThanOrEqual(-1e-8);
				expect(point.x).toBeLessThanOrEqual(viewport.width + 1e-8);
				expect(point.y).toBeLessThanOrEqual(viewport.height + 1e-8);
				expectPoint(viewportToShelter(point, camera, viewport, bounds), { x, y });
			}
		}
		expect(shelterOverviewCamera()).toEqual({ zoom: 1, x: 0, y: 0 });
		expect(getMinShelterZoom()).toBe(1);
	});

	test("pan limits use the expanded origin and dimensions, with gutters centered at the minimum zoom", () => {
		for (const zoom of [getMinShelterZoom(VIEW, BOUNDS), .5, 2, 4]) {
			const camera = clampShelterCamera({ zoom, x: 0, y: 0 }, VIEW, BOUNDS);
			const low = panShelterCamera(camera, -100_000, -100_000, VIEW, BOUNDS);
			const high = panShelterCamera(camera, 100_000, 100_000, VIEW, BOUNDS);
			for (const axis of ["x", "y"] as const) {
				const size = axis === "x" ? "width" : "height";
				const visible = VIEW[size] / zoom;
				if (visible >= BOUNDS[size]) {
					expect(low[axis]).toBeCloseTo(BOUNDS[axis] + (BOUNDS[size] - visible) / 2, 8);
					expect(high[axis]).toBeCloseTo(low[axis], 8);
				} else {
					expect(low[axis]).toBe(BOUNDS[axis]);
					expect(high[axis]).toBeCloseTo(BOUNDS[axis] + BOUNDS[size] - visible, 8);
				}
			}
		}
		expect(clampShelterCamera({ zoom: -10, x: 0, y: 0 }, VIEW, BOUNDS).zoom).toBe(getMinShelterZoom(VIEW, BOUNDS));
		expect(clampShelterCamera({ zoom: 100, x: 0, y: 0 }, VIEW, BOUNDS).zoom).toBe(4);
	});

	test("negative-coordinate rooms retain focus, pointer zoom and client inverse after resize", () => {
		const room = { x: -600, y: -450, width: 172, height: 100 }, worldCenter = center(room);
		const focused = focusShelterRect(shelterOverviewCamera(VIEW, BOUNDS), room, 2, VIEW, BOUNDS);
		expectPoint(viewportToShelter({ x: 420, y: 260 }, focused, VIEW, BOUNDS), worldCenter);
		const anchor = { x: 350, y: 190 }, worldAnchor = viewportToShelter(anchor, focused, VIEW, BOUNDS);
		const zoomed = zoomShelterCamera(focused, 3, anchor, VIEW, BOUNDS);
		expectPoint(viewportToShelter(anchor, zoomed, VIEW, BOUNDS), worldAnchor);
		const nextView = { width: 1100, height: 700 };
		const viewedCenter = viewportToShelter({ x: 420, y: 260 }, zoomed, VIEW, BOUNDS);
		const resized = resizeShelterCamera(zoomed, VIEW, nextView, BOUNDS);
		expectPoint(viewportToShelter({ x: 550, y: 350 }, resized, nextView, BOUNDS), viewedCenter);
		const canvas = { left: 137, top: 63, width: 550, height: 350 };
		const projected = projectShelterRect(room, resized, canvas, nextView, BOUNDS)!;
		expect(projected.visible).toBe(true);
		expect(projected.width).toBeCloseTo(room.width * 3 / 2, 8);
		const clientCenter = { x: projected.left + projected.width / 2, y: projected.top + projected.height / 2 };
		const pointer = clientToShelterPoint(clientCenter.x, clientCenter.y, canvas, nextView.width, nextView.height)!;
		expectPoint(viewportToShelter(pointer, resized, nextView, BOUNDS), worldCenter);
		expectPoint(shelterToViewport(worldCenter, resized, nextView, BOUNDS), pointer);
	});

	test("resize adjusts an overview zoom to its new minimum while retaining the world center", () => {
		const previous = { width: 400, height: 300 }, next = { width: 1200, height: 900 };
		const resized = resizeShelterCamera(shelterOverviewCamera(previous, BOUNDS), previous, next, BOUNDS);
		expect(resized.zoom).toBe(getMinShelterZoom(next, BOUNDS));
		expectPoint(viewportToShelter({ x: next.width / 2, y: next.height / 2 }, resized, next, BOUNDS), center(BOUNDS));
	});
});
