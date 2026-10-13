import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { moduleArt, weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { WEAPONS } from "../src/game/data";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleSlot } from "../src/game/modules";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { MODULAR_WEAPON_ART_IDS, modularWeaponArtFamily } from "../src/modular-weapon-art";

const waveIds = ["g36", "aug", "fal", "sr25", "vector", "fiveseven", "sr2", "sr1", "glock20", "ash12", "vpo209", "svdk", "awm", "m870"] as const;
const factory = (weaponId: string): WeaponInstance => ({ id: "released-visual", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
const install = (gun: WeaponInstance, modelId: string) => { const model = MODULE_BY_ID[modelId]!; gun.modules[model.slot] = { id: modelId, modelId, durability: 100, foundAt: 0 }; };
function part(svg: string, slot: ModuleSlot): string {
	const start = svg.indexOf(`<g data-module-slot="${slot}"`); expect(start).toBeGreaterThanOrEqual(0);
	const tags = /<g\b[^>]*>|<\/g>/g; tags.lastIndex = start;
	let depth = 0;
	for (let tag = tags.exec(svg); tag; tag = tags.exec(svg)) {
		depth += tag[0].startsWith("</") ? -1 : 1;
		if (depth === 0) return svg.slice(start, tags.lastIndex);
	}
	throw new Error(`Unclosed ${slot}`);
}
const outline = (svg: string) => svg.match(/<path d="([^"]+)"/)![1]!;
const structural = (svg: string) => [...svg.split("<defs>")[0]!.matchAll(/<(?:path|circle|rect)\b[^>]*>/g)].map((tag) => [...tag[0].matchAll(/\b(?:d|x|y|width|height|cx|cy|r)="[^"]*"/g)].map((attribute) => attribute[0]).join(" ")).join("|");
const hash = (values: string[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");

describe("wave two physical weapon profiles", () => {
	test("all polished loose profiles and factory actor assemblies retain their reviewed visual snapshots", () => {
		// Intentional visual polish across the original and expanded catalog.
		// Physical consistency, mounting and clipping are audited independently below.
		expect(hash(MODULE_MODELS.map(moduleArt))).toBe("6516c88c498f9b04f7848cab0604793fdae6bd00598db9fc8fbb0cba1ca0c27f");
		expect(hash(WEAPONS.map(({ id }) => JSON.stringify(weaponActorArt(factory(id)))))).toBe("0d5ccd39b9cc268a359896439d8a9fe9bdf0860b7fd59c0e0be4a5cd2d752b75");
	});

	test("14 distinct receiver silhouettes and all factory parts use identical bench, actor and loose geometry", () => {
		const silhouettes = new Set<string>();
		for (const id of waveIds) {
			const gun = factory(id), actor = weaponActorArt(gun), bench = weaponBuildArt(gun);
			expect(getWeaponBuildIssues(gun), id).toEqual([]);
			for (const slot of RECEIVER_INFO[id]!.requiredSlots) {
				const model = MODULE_BY_ID[gun.modules[slot]!.modelId]!;
				expect(part(actor.svg, slot), `${id}/${slot}`).toBe(part(bench, slot));
				expect(outline(part(actor.svg, slot))).toBe(outline(part(moduleArt(model), slot)));
				expect(modularWeaponArtFamily(model)).toBe(id);
			}
			silhouettes.add(outline(part(actor.svg, "receiver")));
			expect([actor.width, actor.height, actor.referenceWidth, actor.grip.x, actor.grip.y, actor.muzzle.x, actor.muzzle.y].every((number) => Number.isFinite(number) && number > 0)).toBe(true);
			expect(actor.svg).not.toMatch(/undefined|NaN|Infinity/);
		}
		expect(silhouettes.size).toBe(14);
		expect(MODULAR_WEAPON_ART_IDS.slice(9)).toEqual([...waveIds]);
	});

	test("each physical upgrade remains structurally distinct and retains the actor scale", () => {
		const audited = new Set<string>();
		for (const id of waveIds) {
			const gun = factory(id), info = RECEIVER_INFO[id]!, reference = weaponActorArt(gun).referenceWidth;
			for (const slot of ["barrel", "handguard", "stock", "magazine"] as const) {
				if (!gun.modules[slot]) continue;
				const models = MODULE_MODELS.filter((model) => model.slot === slot && (model.id === FACTORY_KITS[id]![slot] || (!model.weaponId && model.platforms.includes(info.platform) && model.calibers.includes(info.caliber))));
				const shapes = models.map((model) => {
					install(gun, model.id); audited.add(model.id);
					const actor = weaponActorArt(gun), shape = part(actor.svg, slot);
					expect(getWeaponBuildIssues(gun), model.id).toEqual([]);
					expect(actor.referenceWidth, model.id).toBe(reference);
					expect(shape, model.id).toBe(part(weaponBuildArt(gun), slot));
					expect(outline(shape), model.id).toBe(outline(part(moduleArt(model), slot)));
					return structural(shape);
				});
				expect(new Set(shapes).size, `${id}/${slot}`).toBe(models.length);
			}
		}
		expect(audited.size).toBeGreaterThan(250);
	});

	test("bullpup feed lies behind the trigger while Vector feed lies ahead of its grip", () => {
		for (const id of ["aug", "ash12"] as const) {
			const actor = weaponActorArt(factory(id));
			expect(part(actor.svg, "receiver")).toContain('data-mechanism="bullpup-rear-box-feed"');
			expect(outline(part(actor.svg, "magazine"))).toMatch(/^M309 173h/);
			expect(outline(part(actor.svg, "stock"))).toMatch(/^M\d+ 123h\d+l13 8v61l-13 11/);
			expect(part(actor.svg, "stock")).toContain('data-mechanism="bullpup-buttpad"');
			const gun = factory(id), info = RECEIVER_INFO[id]!;
			for (const appearance of ["extended", "quick", "window", "compact"]) {
				install(gun, `magazine-${info.platform}-${info.caliber}-${appearance}`);
				expect(outline(part(weaponActorArt(gun).svg, "magazine"))).toMatch(/^M309 173h/);
			}
		}
		const vector = weaponActorArt(factory("vector"));
		expect(part(vector.svg, "receiver")).toContain('data-mechanism="vector-offset-lower-housing"');
		expect(outline(part(vector.svg, "magazine"))).toMatch(/^M430 226h42/);
		for (const id of ["sr2", "sr1", "glock20", "fiveseven"] as const) expect(outline(part(weaponActorArt(factory(id)).svg, "magazine"))).toMatch(/^M(?:337|341) 198h/);
	});

	test("the ASH carry bridge supports the optical foot at its own height", () => {
		const gun = factory("ash12"); install(gun, "optic-longscope");
		const actor = weaponActorArt(gun), sight = part(actor.svg, "optic"), receiver = part(actor.svg, "receiver");
		expect(getWeaponBuildIssues(gun)).toEqual([]);
		expect(sight).toContain('transform="translate(0 -25)"');
		expect(receiver).toContain('d="M351 83h149v6H351z"');
		expect(sight).toBe(part(weaponBuildArt(gun), "optic"));
	});

	test("pump tubes stay under the bore; bolt chassis never acquires a gas action", () => {
		const pump = factory("m870");
		for (const appearance of ["factory", "extended", "quick", "window", "compact"]) {
			install(pump, appearance === "factory" ? FACTORY_KITS.m870!.magazine! : `magazine-m870-12g-${appearance}`);
			const svg = weaponActorArt(pump).svg;
			expect(outline(part(svg, "magazine"))).toMatch(/^M475 154h\d+v13/);
			expect(svg).toContain('data-mechanism="m870-tube-feed"');
			expect(svg).toContain('data-mechanism="m870-pump-fore-end"');
			expect(svg).not.toContain('data-mechanism="gas-block"');
		}
		const bolt = factory("awm"), before = weaponActorArt(bolt);
		install(bolt, "barrel-awm-.300winmag-long"); const after = weaponActorArt(bolt);
		expect(after.svg).toContain('data-mechanism="awm-bolt-handle"');
		expect(after.svg).not.toMatch(/data-mechanism="gas-(?:block|system)"/);
		expect(after.muzzle.x).toBeGreaterThan(before.muzzle.x);
		expect(after.referenceWidth).toBe(before.referenceWidth);
	});

	test("receiver adapters and railed front ends visibly support optics and carried attachments", () => {
		for (const id of ["fiveseven", "sr1", "glock20"] as const) {
			const gun = factory(id), info = RECEIVER_INFO[id]!;
			install(gun, `mount-${info.platform}-bridge`); install(gun, "optic-reflex"); install(gun, "flashlight-mini"); install(gun, "laser-micro");
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			const actor = weaponActorArt(gun), bench = weaponBuildArt(gun);
			expect(actor.svg).toContain('data-hardware="pistol-bridge-frame-shoe"');
			for (const slot of ["mount", "optic", "flashlight", "laser"] as const) expect(part(actor.svg, slot)).toBe(part(bench, slot));
		}
		const fal = factory("fal"); install(fal, "mount-fal-bridge"); install(fal, "optic-longscope");
		expect(getWeaponBuildIssues(fal)).toEqual([]);
		expect(part(weaponActorArt(fal).svg, "mount")).toContain('data-mechanism="fal-receiver-optic-bridge"');
		for (const id of waveIds.filter((id) => !["fiveseven", "sr1", "glock20"].includes(id))) {
			const gun = factory(id), info = RECEIVER_INFO[id]!;
			install(gun, `handguard-${info.platform}-rail`); install(gun, "optic-longscope"); install(gun, "foregrip-vertical");
			expect(getWeaponBuildIssues(gun), id).toEqual([]);
			expect(part(weaponActorArt(gun).svg, "handguard")).toContain('data-mechanism="handguard-optic-bridge"');
		}
	});
});
