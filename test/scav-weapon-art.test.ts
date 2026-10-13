import { describe, expect, test } from "bun:test";
import { weaponActorArt } from "../src/armory-art";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { WEAPONS } from "../src/game/data";
import { FACTORY_KITS, MODULE_BY_ID, type ModuleInstance, type ModuleSlot } from "../src/game/modules";

function factoryGun(weaponId: string): WeaponInstance {
	return { id: "art-gun", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 },
		modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: `art-part-${slot}`, modelId, durability: 100, foundAt: 0 }])) };
}

function replacePart(weapon: WeaponInstance, modelId: string) {
	const model = MODULE_BY_ID[modelId]!;
	const part: ModuleInstance = { id: `art-part-${model.slot}`, modelId, durability: 100, foundAt: 0 };
	weapon.modules[model.slot] = part;
	expect(getWeaponBuildIssues(weapon)).toEqual([]);
}

describe("modular weapons carried by scav actors", () => {
	test("every shipped gun has a valid SVG viewport containing its grip and muzzle anchors", () => {
		for (const definition of WEAPONS) {
			const weapon = factoryGun(definition.id), before = JSON.stringify(weapon);
			const art = weaponActorArt(weapon);
			expect([art.width, art.height, art.grip.x, art.grip.y, art.muzzle.x, art.muzzle.y].every(Number.isFinite)).toBe(true);
			expect(art.width).toBeGreaterThan(0); expect(art.height).toBeGreaterThan(0);
			for (const anchor of [art.grip, art.muzzle]) {
				expect(anchor.x).toBeGreaterThanOrEqual(0); expect(anchor.x).toBeLessThanOrEqual(art.width);
				expect(anchor.y).toBeGreaterThanOrEqual(0); expect(anchor.y).toBeLessThanOrEqual(art.height);
			}
			expect(art.muzzle.x).toBeGreaterThan(art.grip.x);
			const viewport = art.svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number);
			expect(viewport).toHaveLength(4);
			expect(viewport.every(Number.isFinite)).toBe(true);
			expect(viewport.slice(2)).toEqual([art.width, art.height]);
			expect(art.svg).toContain(`width="${art.width}" height="${art.height}"`);
			expect(art.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
			expect(art.svg.endsWith("</svg>")).toBe(true);
			for (const slot of Object.keys(weapon.modules) as ModuleSlot[]) expect(art.svg).toContain(`data-module-slot="${slot}"`);
			expect(art.svg).not.toContain("weapon-part--missing");
			expect(JSON.stringify(weapon)).toBe(before);
		}
	});

	test("pistols, SMGs, rifles, pump shotguns and bolt rifles carry visibly different assembled silhouettes", () => {
		// Shared IDs keep palette identifiers identical, so these differences come from visible geometry.
		const models = ["pm", "pp91", "sks", "mp133", "mosin", "vss", "pkp"];
		const art = models.map((weaponId) => weaponActorArt(factoryGun(weaponId)));
		expect(new Set(art.map((item) => item.svg)).size).toBe(models.length);
		expect(art[0]!.width).toBeLessThan(art[2]!.width);
		expect(art[1]!.muzzle.x - art[1]!.grip.x).toBeLessThan(art[4]!.muzzle.x - art[4]!.grip.x);
		expect(weaponActorArt(factoryGun("ak74")).svg).not.toBe(weaponActorArt(factoryGun("akm")).svg);
	});

	test("compatible installed optics and suppressors change actor art and move the muzzle without mutating the gun", () => {
		const weapon = factoryGun("sks");
		replacePart(weapon, "handguard-sks-rail");
		const plain = weaponActorArt(weapon);
		expect(plain.svg).not.toContain('data-module-slot="optic"');
		expect(plain.svg).not.toContain('data-module-slot="muzzle"');
		replacePart(weapon, "optic-reflex");
		const withOpticBefore = JSON.stringify(weapon), withOptic = weaponActorArt(weapon);
		expect(withOptic.svg).not.toBe(plain.svg);
		expect(withOptic.svg).toContain('data-module-slot="optic"');
		expect(withOptic.height).toBeGreaterThan(plain.height);
		expect(withOptic.muzzle.x - withOptic.grip.x).toBe(plain.muzzle.x - plain.grip.x);
		expect(JSON.stringify(weapon)).toBe(withOpticBefore);
		replacePart(weapon, "muzzle-7.62x39-suppressor");
		const suppressedBefore = JSON.stringify(weapon), suppressed = weaponActorArt(weapon);
		expect(suppressed.svg).not.toBe(withOptic.svg);
		expect(suppressed.svg).toContain('data-module-slot="muzzle"');
		expect(suppressed.width).toBeGreaterThan(withOptic.width);
		expect(suppressed.muzzle.x - suppressed.grip.x).toBeGreaterThan(withOptic.muzzle.x - withOptic.grip.x + 70);
		expect(suppressed.muzzle.x).toBeLessThan(suppressed.width);
		expect(JSON.stringify(weapon)).toBe(suppressedBefore);
		delete weapon.modules.optic; delete weapon.modules.muzzle;
		expect(weaponActorArt(weapon)).toEqual(plain);
	});
});
