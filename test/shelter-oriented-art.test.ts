import { describe, expect, test } from "bun:test";
import type Phaser from "phaser";
import { ROOM_DEFINITIONS, getRoomBounds, getRoomEntrance, getRoomLocalPoint, type RoomFacing, type RoomInstance } from "../src/game/shelter";
import { paintIsometricProduction, paintIsometricRoom } from "../src/shelter-isometric-art";
import { projectShelterPoint, shelterRectPolygon } from "../src/shelter-isometric";
import type { ProductionPresentation } from "../src/shelter-production";

type Point = { x: number; y: number };
function graphics() {
	const points: Point[] = [], faces: { color: number; points: Point[] }[] = [];
	let color = 0;
	const g = {
		fillStyle(value: number) { color = value; return g; }, lineStyle() { return g; },
		fillPoints(values: Point[]) { faces.push({ color, points: structuredClone(values) }); points.push(...values); return g; },
		strokePoints(values: Point[]) { points.push(...values); return g; },
		lineBetween(x: number, y: number, x2: number, y2: number) { points.push({ x, y }, { x: x2, y: y2 }); return g; },
		fillCircle(x: number, y: number) { points.push({ x, y }); return g; },
		fillEllipse(x: number, y: number) { points.push({ x, y }); return g; },
		strokeEllipse(x: number, y: number) { points.push({ x, y }); return g; },
	};
	return { g: g as unknown as Phaser.GameObjects.Graphics, points, faces };
}
function room(type: RoomInstance["type"], facing: RoomFacing): RoomInstance {
	return { id: "test-room", type, facing, column: 1, row: 1, position: { x: 318.375, y: 286.625 }, level: 1, status: "ready", construction: null,
		workerIds: [], queue: [], recipeId: null, repeat: false, pending: false, cycles: 0 };
}
const production: ProductionPresentation = { jobId: "order", modelId: null, moduleSlot: "barrel", productName: "Work", productKind: "module", quantity: 3,
	progress: .6, stage: "assembly", stageLabel: "Work", stageProgress: .6, active: true, paused: false, completed: false, reason: null };
const mean = (points: Point[]) => ({ x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length });
const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

describe("oriented cutaway building artwork", () => {
	test("the visible porch agrees with the walking entrance in every direction at fractional positions", () => {
		for (const facing of [0, 1, 2, 3] as const) {
			const building = room("workshop", facing), drawing = graphics();
			paintIsometricRoom(drawing.g, 99, 99, building);
			const entrance = projectShelterPoint(getRoomEntrance(building, 7));
			// The outer step is 2.6 px below the ground plane; it remains centered on the route.
			expect(drawing.faces.some((face) => face.color === 0x9a9987 && near(mean(face.points), { x: entrance.x, y: entrance.y + 2.6 }))).toBe(true);
		}
	});

	test("all room types and construction frames remain inside their rotated visual envelope", () => {
		for (const type of Object.keys(ROOM_DEFINITIONS) as RoomInstance["type"][]) for (const facing of [0, 1, 2, 3] as const) {
			const building = room(type, facing), bounds = getRoomBounds(building);
			const ground = shelterRectPolygon({ x: bounds.x - 12, y: bounds.y - 12, width: bounds.width + 24, height: bounds.height + 24 });
			const roof = ground.map((point) => ({ x: point.x, y: point.y - 52 }));
			for (const point of ground) point.y += 6;
			const hull = [roof[0]!, roof[1]!, ground[1]!, ground[2]!, ground[3]!, roof[3]!];
			for (const status of ["ready", "building", "upgrading"] as const) {
				building.status = status;
				const drawing = graphics(); paintIsometricRoom(drawing.g, building.column, building.row, building);
				expect(drawing.points.length).toBeGreaterThan(100);
				expect(drawing.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), `${type}/${facing}/${status}`).toBe(true);
				const outside = drawing.points.filter((point) => !hull.every((a, index) => {
						const b = hull[(index + 1) % hull.length]!;
						return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= -1e-7;
					}));
				expect(outside, `${type}/${facing}/${status}`).toEqual([]);
			}
		}
	});

	test("active products and station indicators turn with the actual machinery", () => {
		for (const facing of [0, 1, 2, 3] as const) {
			const building = room("workshop", facing), drawing = graphics();
			paintIsometricProduction(drawing.g, 99, 99, building, production, 1_337, false);
			const indicator = projectShelterPoint(getRoomLocalPoint(building, 155, 57));
			expect(drawing.points.some((point) => near(point, { x: indicator.x, y: indicator.y - 17 }))).toBe(true);
		}
	});
});
