import { describe, expect, test } from "bun:test";
import { weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { FACTORY_KITS, type ModuleSlot } from "../src/game/modules";
import type { WeaponInstance } from "../src/game/engine";
import { COMPACT_REFERENCE_GRIPS } from "../src/weapon-reference-compact-anchors";
import { compactReferenceGeometry, compactReferenceLayout } from "../src/weapon-reference-compact";
import type { ReferencePaint, ReferenceProfile, ReferenceTools } from "../src/weapon-reference-types";

const factory = (weaponId: string): WeaponInstance => ({ id: "compact-reference", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
function part(svg: string, slot: ModuleSlot) {
	const start = svg.indexOf(`<g data-module-slot="${slot}"`), tags = /<g\b[^>]*>|<\/g>/g;
	expect(start).toBeGreaterThanOrEqual(0);
	tags.lastIndex = start; let depth = 0;
	for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) {
		depth += tag[0].startsWith("</") ? -1 : 1;
		if (!depth) return svg.slice(start, tags.lastIndex);
	}
	throw new Error(`Unclosed ${slot}`);
}

describe("compact exterior reference anatomy", () => {
	test("all six pistol frames retain full-height grip proportions in the carried silhouette", () => {
		for (const id of ["pm", "tt", "m1911", "fiveseven", "sr1", "glock20"]) {
			const weapon = factory(id), art = weaponActorArt(weapon), receiver = part(art.svg, "receiver");
			expect(art.height / art.width, id).toBeGreaterThan(.5);
			expect(art.height / art.width, id).toBeLessThan(.82);
			expect(receiver).toContain('data-mechanism="trigger-guard"');
			expect(receiver).toContain('data-mechanism="trigger"');
			expect(receiver).toBe(part(weaponBuildArt(weapon), "receiver"));
			const [left = 0, top = 0] = art.svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number), anchor = COMPACT_REFERENCE_GRIPS[id]!.factory;
			expect([art.grip.x + left, art.grip.y + top]).toEqual([...anchor]);
		}
	});

	test("MP7 and SR2 feed through the grip, while Kedr and Vector feed in front of it", () => {
		for (const id of ["mp7", "sr2", "pp91", "vector"]) {
			const art = weaponActorArt(factory(id)), magazine = part(art.svg, "magazine");
			const neck = magazine.match(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)/)!;
			const left = Number(neck[1]), right = left + Number(neck[3]), [gripX] = COMPACT_REFERENCE_GRIPS[id]!.factory;
			if (id === "mp7" || id === "sr2") { expect(gripX).toBeGreaterThan(left); expect(gripX).toBeLessThan(right); }
			else expect(left - gripX, id).toBeGreaterThan(60);
		}
	});

	test("the compact dispatcher preserves foreign weapons and shared accessory geometry", () => {
		const foreign: ReferenceProfile = { id: "vss", category: "rifle", wood: true, bolt: false, integral: true, pump: false, compact: false, barrelEnd: 738 };
		const paint = {} as ReferencePaint, tools = {} as ReferenceTools;
		for (const slot of ["receiver", "stock", "barrel", "magazine", "handguard"] as const) expect(compactReferenceGeometry(slot, "factory", foreign, paint, tools)).toBeUndefined();
		expect(compactReferenceLayout(foreign)).toBeUndefined();
		for (const id of Object.keys(COMPACT_REFERENCE_GRIPS)) for (const slot of ["optic", "muzzle", "mount", "foregrip", "flashlight", "laser"] as const) expect(compactReferenceGeometry(slot, "factory", { ...foreign, id }, paint, tools)).toBeUndefined();
	});
});
