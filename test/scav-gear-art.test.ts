import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GEAR_MODELS } from "../src/game/systems";
import { SCAV_EQUIPMENT_ATLASES, scavGearHeight, scavGearIllustration, scavGearTexture } from "../src/scav-gear-art";
import { SCAV_DIRECTIONS, SCAV_POSES, scavHeadAnchor } from "../src/scav-isometric";
import { SCAV_GEAR_CROPS } from "../src/scav-gear-crops";

describe("physical equipment art", () => {
	test("every physical model has exactly one atlas and an actual inventory picture", () => {
		expect(GEAR_MODELS).toHaveLength(16);
		const illustratedModels: string[] = SCAV_EQUIPMENT_ATLASES.flatMap((atlas) => [...atlas.models]);
		expect(illustratedModels.sort()).toEqual(GEAR_MODELS.map((model) => model.id).sort());
		for (const model of GEAR_MODELS) {
			expect(scavGearTexture(model.id)).toBeDefined();
			expect(scavGearIllustration(model.id, model.label)).toContain(SCAV_GEAR_CROPS[model.id]!.image);
			for (const direction of SCAV_DIRECTIONS) expect(scavGearHeight(model.id, direction)).toBeGreaterThan(0);
		}
		expect(scavGearTexture("unknown")).toBeUndefined();
		expect(scavGearIllustration("unknown", "anything")).toBe("");
		expect(scavGearHeight("toString", "se")).toBe(18);
		expect(scavGearIllustration("steel_helmet", '<script>"&')).toContain("&lt;script&gt;&quot;&amp;");
	});
	test("all 64 native gear frames are complete, isolated and centered at the equipment pivot", () => {
		let count = 0;
		for (const atlasInfo of SCAV_EQUIPMENT_ATLASES) {
			const atlas = JSON.parse(readFileSync(new URL(`../public/art/${atlasInfo.basename}.json`, import.meta.url), "utf8"));
			const png = readFileSync(new URL(`../public/art/${atlasInfo.basename}.png`, import.meta.url));
			expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
			expect(atlas.meta.size).toEqual({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
			expect(Object.keys(atlas.frames).sort()).toEqual(atlasInfo.models.flatMap((model) => SCAV_DIRECTIONS.map((direction) => `${model}-${direction}`)).sort());
			for (const model of atlasInfo.models) {
				expect(atlas.meta.equipmentHeightByModel[model]).toBeGreaterThan(0);
				const picture = atlas.frames[`${model}-${model.endsWith("pack") ? "ne" : "se"}`].frame;
				expect(SCAV_GEAR_CROPS[model]).toMatchObject(picture);
			}
			for (const item of Object.values(atlas.frames) as any[]) {
				const frame = item.frame, source = item.spriteSourceSize;
				expect(frame.x).toBeGreaterThanOrEqual(0); expect(frame.y).toBeGreaterThanOrEqual(0);
				expect(frame.w).toBeGreaterThan(0); expect(frame.h).toBeGreaterThan(0);
				expect(frame.x + frame.w).toBeLessThanOrEqual(atlas.meta.size.w);
				expect(frame.y + frame.h).toBeLessThanOrEqual(atlas.meta.size.h);
				expect(item.sourceSize).toEqual({ w: 512, h: 512 });
				expect(Math.abs(source.x + source.w / 2 - 256)).toBeLessThanOrEqual(.5);
				expect(Math.abs(source.y + source.h / 2 - 256)).toBeLessThanOrEqual(.5);
				count++;
			}
		}
		expect(count).toBe(64);
	});
	test("each of 512 body poses supplies its own finite head anchor above the shoulders", () => {
		for (let id = 0; id < 32; id++) {
			const atlas = JSON.parse(readFileSync(new URL(`../public/art/scav-isometric-${id}.json`, import.meta.url), "utf8"));
			for (const pose of SCAV_POSES) for (const direction of SCAV_DIRECTIONS) {
				const { head, torso } = atlas.frames[`${pose}-${direction}`].custom;
				expect([head.x, head.y].every(Number.isFinite)).toBe(true);
				expect(Math.abs(head.x)).toBeLessThan(10);
				expect(head.y).toBeLessThan(torso.y - 7);
			}
		}
		expect(scavHeadAnchor([{ weight: .25, head: { x: -2, y: -44 } }, { weight: .75, head: { x: 2, y: -40 } }])).toEqual({ x: 1, y: -41 });
		expect(scavHeadAnchor([{ weight: 0, head: { x: 2, y: -40 } }, { weight: 1, head: { x: NaN, y: 0 } }])).toBeUndefined();
	});
});
