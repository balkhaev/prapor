import { expect,test } from "bun:test";
import { createWeaponShowcaseBuild,weaponShowcasePairArt } from "../src/weapon-showcase";
import { WEAPONS } from "../src/game/data";
import { getWeaponBuildIssues,getWeaponStats } from "../src/game/engine";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_SLOTS } from "../src/game/modules";

test("all 39 field presets use real compatible modules and retain the factory identity",() => {
	expect(WEAPONS).toHaveLength(39);
	for (const definition of WEAPONS) {
		const factory = createWeaponShowcaseBuild(definition.id), before = JSON.stringify(factory), field = createWeaponShowcaseBuild(definition.id,"field");
		expect(Object.fromEntries(Object.entries(factory.modules).map(([slot,part]) => [slot,part.modelId]))).toEqual(FACTORY_KITS[definition.id]!);
		expect(getWeaponBuildIssues(field),definition.id).toEqual([]); expect(getWeaponStats(field).ready).toBe(true);
		expect(field.modules.receiver!.modelId).toBe(factory.modules.receiver!.modelId);
		expect(Object.keys(field.modules).length).toBeGreaterThan(Object.keys(factory.modules).length);
		expect(new Set(Object.values(field.modules).map(part => part.id)).size).toBe(Object.keys(field.modules).length);
		for (const [slot,part] of Object.entries(field.modules)) expect(String(MODULE_BY_ID[part.modelId]!.slot)).toBe(slot);
		expect(field.modules.flashlight && field.modules.laser).toBeFalsy();
		if (["pistol","smg","shotgun"].includes(definition.category)) expect(field.modules.optic && MODULE_BY_ID[field.modules.optic.modelId]!.appearance).not.toBe("longscope");
		expect(JSON.stringify(factory)).toBe(before); expect(createWeaponShowcaseBuild(definition.id,"field")).toEqual(field);
	}
	expect(() => createWeaponShowcaseBuild("__proto__")).toThrow();
});

test("factory and field views keep identical cameras without sharing masks or moving the receiver",() => {
	for (const definition of WEAPONS) {
		const pair = weaponShowcasePairArt(definition.id), box = (svg:string) => svg.match(/\bviewBox="([^"]+)"/)![1]!;
		expect(box(pair.factory),definition.id).toBe(box(pair.field));
		const dimensions = box(pair.factory).split(" ").map(Number); expect(dimensions.every(Number.isFinite)).toBe(true);
		expect(dimensions[2]).toBeGreaterThan(0); expect(dimensions[3]).toBeGreaterThan(0);
		const ids = (svg:string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
		expect(ids(pair.factory).filter(id => ids(pair.field).includes(id))).toEqual([]);
		for (const svg of Object.values(pair)) {
			for (const slot of MODULE_SLOTS.filter(slot => FACTORY_KITS[definition.id]![slot])) expect(svg).toContain(`data-module-slot="${slot}"`);
			expect(svg).not.toMatch(/NaN|undefined|Infinity/);
		}
	}
});
