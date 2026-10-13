import { describe, expect, test } from "bun:test";
import { moduleArt, weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, MODULE_MODELS, MODULE_BY_ID, RECEIVER_INFO, type ModuleSlot } from "../src/game/modules";
import { CLASSIC_REFERENCE_GRIPS } from "../src/weapon-reference-classic-anchors";
import { weaponGripAnchor } from "../src/weapon-attachment";

const ids = Object.keys(CLASSIC_REFERENCE_GRIPS);
const factory = (weaponId: string): WeaponInstance => ({ id: "classic-photo-check", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
function part(svg: string, slot: ModuleSlot) {
	const start = svg.indexOf(`<g data-module-slot="${slot}"`), tags = /<g\b[^>]*>|<\/g>/g;
	if (start < 0) throw new Error(`Missing ${slot}`);
	tags.lastIndex = start; let depth = 0;
	for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) { depth += tag[0].startsWith("</") ? -1 : 1; if (!depth) return svg.slice(start, tags.lastIndex); }
	throw new Error(`Unclosed ${slot}`);
}
const outline = (svg: string) => svg.match(/<path d="([^"]+)"/)![1]!;

describe("classic firearms checked against original profile references", () => {
	test("all 14 actions retain different anatomy and factory parts are the same physical parts in every presentation", () => {
		const actions = new Set<string>();
		for (const id of ids) {
			const gun = factory(id), actor = weaponActorArt(gun), bench = weaponBuildArt(gun);
			expect(getWeaponBuildIssues(gun), id).toEqual([]);
			actions.add(outline(part(actor.svg, "receiver")));
			for (const slot of ["receiver", "stock", "handguard", "barrel", "magazine"] as const) {
				const model = MODULE_BY_ID[gun.modules[slot]!.modelId]!;
				expect(outline(part(actor.svg, slot)), `${id}/${slot}`).toBe(outline(part(moduleArt(model), slot)));
				expect(part(actor.svg, slot)).toBe(part(bench, slot));
			}
			const [x, y] = CLASSIC_REFERENCE_GRIPS[id]!.factory;
			expect(weaponGripAnchor(id)).toEqual({ x, y });
		}
		expect(actions.size).toBe(14);
	});

	test("every compatible furniture, feed and barrel upgrade has a physical silhouette instead of a recolored factory substitute", () => {
		let cases = 0;
		for (const id of ids) {
			const base = factory(id), info = RECEIVER_INFO[id]!, native = weaponActorArt(base);
			for (const model of MODULE_MODELS.filter((item) => !item.weaponId && ["stock", "handguard", "barrel", "magazine"].includes(item.slot) && item.platforms.includes(info.platform) && (item.calibers.includes("*") || item.calibers.includes(info.caliber)))) {
				const gun = factory(id); gun.modules[model.slot] = { id: model.slot, modelId: model.id, durability: 100, foundAt: 0 };
				expect(getWeaponBuildIssues(gun), `${id}/${model.id}`).toEqual([]);
				const art = weaponActorArt(gun), actual = outline(part(art.svg, model.slot));
				expect(actual, `${id}/${model.id} native physical identity`).toBe(outline(part(moduleArt(model), model.slot)));
				expect(actual, `${id}/${model.id} visible upgrade`).not.toBe(outline(part(native.svg, model.slot)));
				expect(part(art.svg, model.slot)).toBe(part(weaponBuildArt(gun), model.slot));
				cases++;
			}
		}
		expect(cases).toBeGreaterThan(240);
	});

	test("the observed shotgun, bolt, blowback, sniper and belt-feed families keep their actual external mechanisms", () => {
		for (const id of ["mp133", "m870"]) {
			const actor = weaponActorArt(factory(id));
			expect(part(actor.svg, "magazine")).toContain('data-mechanism="underbarrel-feed-tube"');
			expect(part(actor.svg, "handguard")).toContain('data-mechanism="sliding-pump-fore-end"');
			expect(part(actor.svg, "barrel")).not.toContain('data-mechanism="gas-system"');
		}
		for (const id of ["mosin", "toz", "vityaz"]) expect(part(weaponActorArt(factory(id)).svg, "barrel")).not.toContain('data-mechanism="gas-system"');
		const svd = weaponActorArt(factory("svd")), svdk = weaponActorArt(factory("svdk")), pkp = weaponActorArt(factory("pkp"));
		expect(part(svd.svg, "stock")).toContain('data-mechanism="svd-forward-thumbhole-grip"');
		expect(part(svdk.svg, "stock")).toContain('data-mechanism="svdk-tubular-folding-stock"');
		expect(part(pkp.svg, "stock")).toContain('data-mechanism="pkp-skeleton-butt"');
		expect(part(pkp.svg, "magazine")).toContain('data-mechanism="belt-feed-box"');
		expect(part(pkp.svg, "barrel")).toContain('data-mechanism="pkp-cooling-jacket"');
		expect(part(pkp.svg, "barrel")).toContain('data-mechanism="pkp-carry-handle"');
	});
});
