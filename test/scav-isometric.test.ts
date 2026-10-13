import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	SCAV_DIRECTIONS, SCAV_ORIGIN, SCAV_POSES, SCAV_REFERENCE_HEIGHT,
	scavAppearance, scavAttachment, scavDirection, scavFrame, scavTexture,
} from "../src/scav-isometric";

describe("directional isometric scav presentation", () => {
	test("both projected ground axes select the corresponding front or rear view", () => {
		expect(scavDirection(20, 10)).toBe("se");
		expect(scavDirection(-20, 10)).toBe("sw");
		expect(scavDirection(20, -10)).toBe("ne");
		expect(scavDirection(-20, -10)).toBe("nw");
	});

	test("vertical movement changes depth while retaining the previous left or right side", () => {
		expect(scavDirection(0, -15, "se")).toBe("ne");
		expect(scavDirection(0, -15, "sw")).toBe("nw");
		expect(scavDirection(0, 15, "ne")).toBe("se");
		expect(scavDirection(0, 15, "nw")).toBe("sw");
		expect(scavDirection(15, 0, "nw")).toBe("ne");
		expect(scavDirection(-15, 0, "se")).toBe("sw");
	});

	test("stationary actors and invalid observations preserve their last view", () => {
		for (const direction of SCAV_DIRECTIONS) {
			for (const [dx, dy] of [[0, 0], [NaN, 5], [4, Infinity], [-Infinity, NaN]]) {
				expect(scavDirection(dx!, dy!, direction)).toBe(direction);
			}
		}
		expect(scavDirection(0, 0)).toBe("se");
	});

	test("personality keeps the portrait identity regardless of roster position or raid seed", () => {
		for (const fallback of [-3, 0, 2, 9, NaN]) {
			expect(scavAppearance("veteran", fallback)).toBe(0);
			expect(scavAppearance("collector", fallback)).toBe(1);
			expect(scavAppearance("runner", fallback)).toBe(2);
			expect(scavAppearance("careful", fallback)).toBe(3);
		}
		expect(scavAppearance("toString", -1)).toBe(3);
		expect(scavAppearance(undefined, 6.9)).toBe(2);
		expect(scavAppearance("unknown", Infinity)).toBe(0);
		expect(scavTexture(-5)).toBe("scav-iso-3");
		expect(scavTexture(NaN)).toBe("scav-iso-0");
	});

	test("every pose resolves across all four directions with one shared ground contact", () => {
		const frames = new Set(SCAV_POSES.flatMap((pose) => SCAV_DIRECTIONS.map((direction) => scavFrame(pose, direction))));
		expect(frames.size).toBe(16);
		expect(frames.has("work-nw")).toBe(true);
		expect(SCAV_ORIGIN).toEqual({ x: .5, y: 480 / 512 });
		expect(SCAV_REFERENCE_HEIGHT).toBeGreaterThan(0);
	});

	test("tool and weapon anchors stay at the hands and point into the selected ground quadrant", () => {
		for (const direction of SCAV_DIRECTIONS) for (const working of [false, true]) {
			const attachment = scavAttachment(direction, working);
			expect([attachment.x, attachment.y, attachment.angle].every(Number.isFinite)).toBe(true);
			expect(Math.abs(attachment.x)).toBeLessThanOrEqual(10);
			expect(attachment.y).toBeGreaterThanOrEqual(-27);
			expect(attachment.y).toBeLessThanOrEqual(-23);
			expect(attachment.behind).toBe(direction[0] === "n");
			expect(attachment.flipX).toBe(direction[1] === "w");
			const radians = attachment.angle * Math.PI / 180;
			expect(scavDirection(Math.cos(radians), Math.sin(radians))).toBe(direction);
			expect(Math.sign(attachment.x)).toBe(direction[1] === "e" ? 1 : -1);
		}
	});

	test("all shipped atlases provide valid native crops, complete directional poses and one feet pivot", () => {
		type Rect = { x: number; y: number; w: number; h: number };
		type Atlas = {
			frames: Record<string, { frame: Rect; rotated: boolean; trimmed: boolean; spriteSourceSize: Rect; sourceSize: { w: number; h: number } }>;
			meta: { image: string; size: { w: number; h: number }; characterHeight: number; feet: { x: number; y: number }; directions: string[] };
		};
		const expectedFrames = SCAV_POSES.flatMap((pose) => SCAV_DIRECTIONS.map((direction) => scavFrame(pose, direction))).sort();
		for (let appearance = 0; appearance < 4; appearance++) {
			const basename = `scav-isometric-${appearance}`;
			const atlas = JSON.parse(readFileSync(new URL(`../public/art/${basename}.json`, import.meta.url), "utf8")) as Atlas;
			const png = readFileSync(new URL(`../public/art/${basename}.png`, import.meta.url));
			expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
			expect(png.toString("ascii", 12, 16)).toBe("IHDR");
			const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
			expect(atlas.meta.image).toBe(`${basename}.png`);
			expect(atlas.meta.size).toEqual({ w: width, h: height });
			expect(atlas.meta.directions).toEqual([...SCAV_DIRECTIONS]);
			expect(Object.keys(atlas.frames).sort()).toEqual(expectedFrames);
			for (const frame of Object.values(atlas.frames)) {
				const crop = frame.frame, source = frame.spriteSourceSize;
				expect(frame.sourceSize).toEqual({ w: 512, h: 512 });
				expect(frame.rotated).toBe(false);
				expect(frame.trimmed).toBe(true);
				expect([crop.x, crop.y, crop.w, crop.h, source.x, source.y, source.w, source.h].every(Number.isInteger)).toBe(true);
				expect(crop.x).toBeGreaterThanOrEqual(0); expect(crop.y).toBeGreaterThanOrEqual(0);
				expect(crop.w).toBeGreaterThan(0); expect(crop.h).toBeGreaterThan(0);
				expect(crop.x + crop.w).toBeLessThanOrEqual(width); expect(crop.y + crop.h).toBeLessThanOrEqual(height);
				expect(source.w).toBe(crop.w); expect(source.h).toBe(crop.h);
				expect(source.x).toBeGreaterThanOrEqual(0); expect(source.y).toBeGreaterThanOrEqual(0);
				expect(source.x + source.w).toBeLessThanOrEqual(frame.sourceSize.w);
				expect(source.y + source.h).toBe(atlas.meta.feet.y);
				expect(atlas.meta.feet).toEqual({ x: frame.sourceSize.w * SCAV_ORIGIN.x, y: frame.sourceSize.h * SCAV_ORIGIN.y });
			}
			const idleHeights = SCAV_DIRECTIONS.map((direction) => atlas.frames[scavFrame("idle", direction)]!.frame.h).sort((a, b) => a - b);
			expect(atlas.meta.characterHeight).toBe((idleHeights[1]! + idleHeights[2]!) / 2);
			expect(atlas.meta.characterHeight).toBeGreaterThan(0);
		}
	});
});
