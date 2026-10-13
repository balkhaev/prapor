import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SCAV_APPEARANCES } from "../src/game/scav-appearances";
import { SCAV_DIRECTIONS, SCAV_POSES } from "../src/scav-isometric";
import { projectShelterPoint, shelterBuildingDepth } from "../src/shelter-isometric";
import { getTerritoryPersonPlacement, getTerritoryPersonPose, getTerritoryPersonSprite, type TerritoryPersonAtlas } from "../src/territory-life";

describe("people in the live isometric plan", () => {
	test("feet share the world's continuous projection, including fractional positions", () => {
		const bounds = { x: -53.25, y: 20.5, width: 911.75, height: 508.25 };
		const point = { x: 318.375, y: 286.625 }, before = { ...point }, projected = projectShelterPoint(point);
		const placement = getTerritoryPersonPlacement(point, bounds, [])!;
		expect(bounds.x + placement.left / 100 * bounds.width).toBeCloseTo(projected.x, 10);
		expect(bounds.y + placement.top / 100 * bounds.height).toBeCloseTo(projected.y, 10);
		expect(placement.depth).toBeCloseTo(projected.y, 10);
		expect(point).toEqual(before);
	});

	test("people pass behind and in front of actual building depth, including turned hangars", () => {
		const rooms = [{ x: 50, y: 280, width: 556, height: 232 }, { x: 318.375, y: 148, width: 232, height: 556 }, { x: 250, y: 148, width: 172, height: 100 }];
		const depths = rooms.map(shelterBuildingDepth).sort((a, b) => a - b);
		const bounds = { x: -100, y: -100, width: 1600, height: 900 };
		for (let index = 0; index < depths.length; index++) {
			const depth = depths[index]!;
			// x = 0 gives a simple exact inverse for a desired depth without rounding to lots.
			for (const offset of [-.01, .01]) {
				const point = { x: 0, y: 100 + (depth + offset - 57) / .325 };
				const actor = getTerritoryPersonPlacement(point, bounds, depths)!;
				const buildingZ = 20 + index * 10;
				if (offset < 0) expect(actor.zIndex).toBeLessThan(buildingZ);
				else expect(actor.zIndex).toBeGreaterThan(buildingZ);
			}
		}
	});

	test("invalid coordinates or a hidden zero-size map cannot produce an invalid actor position", () => {
		const bounds = { x: 0, y: 0, width: 800, height: 400 };
		for (const point of [{ x: NaN, y: 30 }, { x: 30, y: Infinity }]) expect(getTerritoryPersonPlacement(point, bounds, [])).toBeNull();
		for (const patch of [{ width: 0 }, { height: -1 }, { x: NaN }]) expect(getTerritoryPersonPlacement({ x: 20, y: 30 }, { ...bounds, ...patch }, [])).toBeNull();
	});

	test("every real character pose retains its trimmed feet anchor in the plan", () => {
		for (const appearance of SCAV_APPEARANCES) {
			const atlas = JSON.parse(readFileSync(new URL(`../public/art/scav-isometric-${appearance.id}.json`, import.meta.url), "utf8")) as TerritoryPersonAtlas;
			const feet = atlas.meta.feet!, scale = 48 * .78 / atlas.meta.characterHeight!;
			for (const pose of SCAV_POSES) for (const direction of SCAV_DIRECTIONS) {
				const crop = getTerritoryPersonSprite(atlas, pose, direction)!;
				const source = atlas.frames[`${pose}-${direction}`]!.spriteSourceSize;
				expect(crop.x + (feet.x - source.x) * scale).toBeCloseTo(0, 10);
				expect(crop.y + (feet.y - source.y) * scale).toBeCloseTo(0, 10);
				expect(crop.width).toBeGreaterThan(0); expect(crop.height).toBeGreaterThan(0);
				expect(-crop.cropX + crop.width).toBeLessThanOrEqual(crop.sheetWidth + 1e-8);
				expect(-crop.cropY + crop.height).toBeLessThanOrEqual(crop.sheetHeight + 1e-8);
			}
		}
	});

	test("bad atlas data falls back to a visible body instead of emitting invalid styles", () => {
		const atlas = JSON.parse(readFileSync(new URL("../public/art/scav-isometric-0.json", import.meta.url), "utf8")) as TerritoryPersonAtlas;
		expect(getTerritoryPersonSprite(atlas, "idle", "se", NaN)).toBeNull();
		expect(getTerritoryPersonSprite({ ...atlas, frames: {} }, "idle", "se")).toBeNull();
		const invalid = structuredClone(atlas); invalid.frames["idle-se"]!.frame.w = invalid.meta.size.w + 1;
		expect(getTerritoryPersonSprite(invalid, "idle", "se")).toBeNull();
		invalid.frames["idle-se"]!.frame.w = 100; invalid.meta.characterHeight = 0;
		expect(getTerritoryPersonSprite(invalid, "idle", "se")).toBeNull();
	});

	test("walk poses follow the observed stride while work and reduced motion use meaningful still poses", () => {
		expect(getTerritoryPersonPose({ walking: true, working: false, walkPhase: .25 })).toBe("walk-b");
		expect(getTerritoryPersonPose({ walking: true, working: false, walkPhase: .75 })).toBe("walk-a");
		expect(getTerritoryPersonPose({ walking: false, working: true, walkPhase: .25 })).toBe("work");
		expect(getTerritoryPersonPose({ walking: true, working: false, walkPhase: .75 }, true)).toBe("idle");
		for (const activity of ["carry", "sweep", "maintain"]) expect(getTerritoryPersonPose({ walking: false, working: false, walkPhase: .25, activity }, true)).toBe("work");
		expect(getTerritoryPersonPose({ walking: false, working: false, walkPhase: NaN, activity: "chat" })).toBe("idle");
	});
});
