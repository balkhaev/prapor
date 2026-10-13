import { describe, expect, test } from "bun:test";
import { createArmorySurface, surfaceDetail, type ArmorySurfaceOptions } from "../src/armory-surface";

const panel: ArmorySurfaceOptions = {
	prefix: "armory-panel", slot: "handguard", material: "steel",
	outline: "M10 20h120v60H10zM35 35h25v15H35z", bounds: [10, 20, 120, 60],
	seed: "physical-panel",
};

describe("physical weapon finishes", () => {
	test("all paints and microtexture references resolve to local definitions without filters", () => {
		const { paint, defs } = createArmorySurface("weapon/finish");
		expect(paint.prefix).toBe("weapon-finish");
		for (const [material, reference] of Object.entries(paint)) {
			if (material === "prefix") continue;
			expect(reference).toBe(`url(#weapon-finish-${material})`);
			expect(defs).toContain(`id="weapon-finish-${material}"`);
			const svg = surfaceDetail({ ...panel, material: material as ArmorySurfaceOptions["material"], prefix: paint.prefix });
			for (const match of svg.matchAll(/url\(#([^)]*)\)/g)) expect(`${defs}${svg}`).toContain(`id="${match[1]}"`);
		}
		expect(defs).not.toContain("<filter");
		expect(defs).not.toContain("feTurbulence");
		expect(defs).not.toContain("M0 0h4v4H0z");
	});

	test("wear is deterministic for the physical part and grows with actual condition", () => {
		const pristine = surfaceDetail({ ...panel, durability: 100 });
		const worn = surfaceDetail({ ...panel, durability: 20 });
		expect(surfaceDetail({ ...panel, durability: 20 })).toBe(worn);
		expect(pristine).not.toBe(worn);
		expect(pristine).not.toContain('stroke="#988b72"');
		expect(worn).toContain('stroke="#988b72"');
		const scratches = (svg: string) => svg.match(/<path d="(M[^"<]+)"[^>]*stroke="#bdc2b7"/)![1];
		const pristineMarks = scratches(pristine)!;
		expect(scratches(worn)!.startsWith(pristineMarks)).toBe(true);
		// Inventory instances and SVG placement must not change the wear pattern.
		expect(scratches(surfaceDetail({ ...panel, prefix: "other-instance", durability: 20 }))).toBe(scratches(worn));
		expect(scratches(surfaceDetail({ ...panel, seed: "different-physical-panel", durability: 20 }))).not.toBe(scratches(worn));
	});

	test("surface paths preserve cut-outs and keep the existing part group flat", () => {
		const svg = surfaceDetail({ ...panel, durability: 0 });
		const clip = svg.match(/<clipPath id="([^"]+)"/)![1];
		expect(svg).toContain('clip-rule="evenodd"');
		expect(svg).toContain('fill-rule="evenodd"');
		expect(svg).toContain(`d="${panel.outline}"`);
		expect(svg).not.toContain("<g");
		for (const match of svg.matchAll(/<path[^>]+stroke=/g)) expect(match[0]).toContain(`clip-path="url(#${clip})"`);
		expect(svg.length).toBeLessThan(1900);
	});

	test("current and candidate parts sharing a weapon ID retain separate clipping masks", () => {
		const before = surfaceDetail(panel);
		const candidate = surfaceDetail({ ...panel, outline: "M10 20h60v60H10z", bounds: [10, 20, 60, 60] });
		const maskId = (svg: string) => svg.match(/<clipPath id="([^"]+)"/)![1]!;
		expect(maskId(before)).not.toBe(maskId(candidate));
		expect(maskId(surfaceDetail({ ...panel, durability: 40 }))).toBe(maskId(before));
		expect(maskId(surfaceDetail({ ...panel, fillRule: "nonzero" }))).not.toBe(maskId(before));
		for (const svg of [before, candidate]) {
			expect(svg).toContain(`clip-path="url(#${maskId(svg)})"`);
			const ownMask = svg.match(/<clipPath[^>]+><path d="([^"]+)"/)![1];
			expect(ownMask).toBe(svg === before ? panel.outline : "M10 20h60v60H10z");
		}
	});

	test("condition input clamps safely and invalid geometry cannot emit broken SVG", () => {
		expect(surfaceDetail({ ...panel, durability: 140 })).toBe(surfaceDetail({ ...panel, durability: 100 }));
		expect(surfaceDetail({ ...panel, durability: -40 })).toBe(surfaceDetail({ ...panel, durability: 0 }));
		expect(surfaceDetail({ ...panel, durability: Number.NaN })).toBe(surfaceDetail({ ...panel, durability: 0 }));
		expect(surfaceDetail({ ...panel, bounds: [0, 0, Number.NaN, 10] })).toBe("");
		expect(surfaceDetail({ ...panel, bounds: [0, 0, 0, 10] })).toBe("");
		expect(surfaceDetail({ ...panel, outline: "" })).toBe("");
	});
});
