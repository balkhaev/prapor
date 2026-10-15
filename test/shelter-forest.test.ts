import { describe, expect, test } from "bun:test";
import { getShelterForestDecorations, getShelterForestNearBounds, isShelterForestClear, isShelterForestPointInBounds, sampleShelterForest } from "../src/shelter-forest";
import { getShelterLandscape } from "../src/shelter-landscape";
import { SHELTER_ACCESS_ROAD } from "../src/shelter-road";

const sites = Array.from({ length: 3 }, (_, row) => Array.from({ length: 4 }, (_, column) => ({ column, row }))).flat();
const identity = (item: { seed: number; point: { x: number; y: number } }) => `${item.seed}:${item.point.x}:${item.point.y}`;

describe("a continuous woodland around the shelter clearing", () => {
	test("near and far queries meet without moving, repeating or dropping a grove at their seam", () => {
		const left = { x: -520, y: -580, width: 760, height: 1300 }, right = { ...left, x: 240, width: 740 };
		const whole = getShelterForestDecorations({ ...left, width: 1500 }, [], [], 768);
		const joined = [...getShelterForestDecorations(left, [], [], 768), ...getShelterForestDecorations(right, [], [], 768)];
		expect(joined.length).toBeGreaterThan(100);
		expect(new Set(joined.map(identity)).size).toBe(joined.length);
		expect(joined.sort((a, b) => a.seed - b.seed)).toEqual(whole);
		for (const item of whole) expect(isShelterForestPointInBounds(item.point, left) !== isShelterForestPointInBounds(item.point, right)).toBe(true);
	});

	test("panning preserves every common candidate, including undergrowth whose parent crosses the coverage edge", () => {
		const first = { x: -790, y: -640, width: 1130, height: 1230 }, second = { ...first, x: -570, y: -471 };
		const a = getShelterForestDecorations(first, [], [], 4096), b = getShelterForestDecorations(second, [], [], 4096);
		expect(a.length).toBeLessThan(4096); expect(b.length).toBeLessThan(4096);
		const commonA = a.filter(item => isShelterForestPointInBounds(item.point, second));
		const commonB = b.filter(item => isShelterForestPointInBounds(item.point, first));
		expect(commonA.length).toBeGreaterThan(70);
		expect(commonA).toEqual(commonB);
	});

	test("trees leave a broad road verge clear even where their raised crowns project north over the ground", () => {
		const woods = getShelterForestDecorations({ x: -800, y: -700, width: 2200, height: 1900 }, [], [], 768);
		const trees = woods.filter(item => item.kind === "tree");
		expect(trees.some(item => item.point.y < SHELTER_ACCESS_ROAD.top)).toBe(true);
		expect(trees.some(item => item.point.y > SHELTER_ACCESS_ROAD.bottom)).toBe(true);
		for (const tree of trees) {
			const northernCrownEdge = tree.point.y - tree.radius - 128 * tree.scale! / .65;
			const southernCrownEdge = tree.point.y + tree.radius;
			expect(southernCrownEdge < SHELTER_ACCESS_ROAD.top - 66 || northernCrownEdge > SHELTER_ACCESS_ROAD.bottom + 66).toBe(true);
		}
		const southVerge = { x: -400, y: SHELTER_ACCESS_ROAD.bottom + 160 };
		expect(isShelterForestClear(southVerge, 25)).toBe(true);
		expect(isShelterForestClear(southVerge, 25, [], [], 110)).toBe(false);
	});

	test("the wood contains connected mature groves, low undergrowth and broad sunlit openings", () => {
		const woods = getShelterForestDecorations({ x: -800, y: -700, width: 2200, height: 1900 }, [], [], 768), trees = woods.filter(item => item.kind === "tree");
		expect(trees.length).toBeGreaterThan(180);
		expect(new Set(trees.map(item => item.species)).size).toBe(4);
		expect(woods.some(item => item.kind === "fern")).toBe(true);
		expect(woods.some(item => item.kind === "bush")).toBe(true);
		const withNeighbour = trees.filter(tree => trees.some(other => other !== tree && Math.hypot(other.point.x - tree.point.x, other.point.y - tree.point.y) < 125));
		expect(withNeighbour.length / trees.length).toBeGreaterThan(.85);
		const samples = Array.from({ length: 15 }, (_, i) => sampleShelterForest({ x: i * 127 - 700, y: -500 }));
		expect(samples.some(sample => sample.density > .9)).toBe(true);
		expect(samples.some(sample => sample.density < .12)).toBe(true);
		for (let x = -600; x < 900; x += 53) {
			const sample = sampleShelterForest({ x, y: -500 });
			expect(Math.abs(sample.density - sampleShelterForest({ x: x + 1, y: -500 }).density)).toBeLessThan(.03);
		}
	});

	test("ownership and active construction remove only the affected wood and retain a single inhabited clearing", () => {
		const plan = getShelterLandscape(sites), before = structuredClone(plan.lots), near = getShelterForestNearBounds(plan.lots);
		const woods = getShelterForestDecorations(near, plan.lots, [], 768), tree = woods.find(item => item.kind === "tree")!;
		const reserved = { x: tree.point.x - 35, y: tree.point.y - 35, width: 70, height: 70 };
		const cleared = getShelterForestDecorations(near, plan.lots, [reserved], 768);
		expect(cleared.some(item => identity(item) === identity(tree))).toBe(false);
		for (const lot of plan.lots) {
			expect(sampleShelterForest({ x: lot.x + lot.width / 2, y: lot.y + lot.height / 2 }, plan.lots).density).toBe(0);
			for (const item of woods) expect(item.point.x + item.radius > lot.x && item.point.x - item.radius < lot.x + lot.width && item.point.y + item.radius > lot.y && item.point.y - item.radius < lot.y + lot.height).toBe(false);
		}
		const unaffected = woods.filter(item => Math.hypot(item.point.x - tree.point.x, item.point.y - tree.point.y) > 350);
		const afterIds = new Set(cleared.map(identity));
		expect(unaffected.length).toBeGreaterThan(10);
		for (const item of unaffected) expect(afterIds.has(identity(item))).toBe(true);
		expect(plan.lots).toEqual(before);
		expect(getShelterForestNearBounds([...plan.lots].reverse())).toEqual(near);
	});

	test("cosmetic queries are deterministic and bounded for extreme camera input", () => {
		const query = { x: -1200, y: -900, width: 3000, height: 2400 };
		expect(getShelterForestDecorations(query)).toEqual(getShelterForestDecorations(query));
		expect(getShelterForestDecorations(query, [], [], 37)).toHaveLength(37);
		expect(getShelterForestDecorations({ x: -1e12, y: -1e12, width: 2e12, height: 2e12 })).toEqual([]);
		expect(getShelterForestDecorations({ ...query, width: NaN })).toEqual([]);
		expect(sampleShelterForest({ x: NaN, y: 0 }).density).toBe(0);
	});
});
