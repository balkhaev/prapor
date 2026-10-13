import { describe, expect, test } from "bun:test";
import { MODULE_BY_ID, MODULE_MODELS } from "../src/game/modules";
import { moduleCatalogPage, moduleFitsWeaponFamily, moduleModelMatches, moduleMountLabel, type ModuleCatalogFilters } from "../src/module-catalog";

const filters: ModuleCatalogFilters = { slot: "all", rarity: "all", platform: "all", search: "" };

describe("large module catalog", () => {
	test("unknown weapon IDs cannot inherit universal compatibility from object prototypes", () => {
		for (const id of ["constructor", "toString", "__proto__", "unknown"]) expect(moduleFitsWeaponFamily(MODULE_BY_ID["optic-micro"]!, id)).toBe(false);
	});
	test("combines named filters and includes universal parts for a platform", () => {
		expect(moduleModelMatches(MODULE_BY_ID["optic-reflex"]!, { ...filters, slot: "optic", rarity: "uncommon", platform: "ak" })).toBe(true);
		expect(moduleModelMatches(MODULE_BY_ID["factory-pm-barrel"]!, { ...filters, platform: "ak" })).toBe(false);
		expect(moduleModelMatches(MODULE_BY_ID["optic-reflex"]!, { ...filters, slot: "stock" })).toBe(false);
	});
	test("searches caliber, platform, slot, and mounts with multiple words", () => {
		expect(moduleModelMatches(MODULE_BY_ID["factory-ak74-barrel"]!, { ...filters, search: "АК 5.45x39 ствол" })).toBe(true);
		expect(moduleModelMatches(MODULE_BY_ID["handguard-ak-rail"]!, { ...filters, search: "нижняя планка" })).toBe(true);
		expect(moduleModelMatches(MODULE_BY_ID["handguard-ak-light"]!, { ...filters, search: "легкое цевьё" })).toBe(true);
		expect(moduleModelMatches(MODULE_BY_ID["optic-reflex"]!, { ...filters, search: "прицел резьба" })).toBe(false);
	});
	test("weapon family filter rejects wrong calibers and receivers but retains mount upgrades", () => {
		expect(moduleFitsWeaponFamily(MODULE_BY_ID["factory-ak74-barrel"]!, "akm")).toBe(false);
		expect(moduleFitsWeaponFamily(MODULE_BY_ID["receiver-akm"]!, "ak74")).toBe(false);
		expect(moduleFitsWeaponFamily(MODULE_BY_ID["optic-reflex"]!, "ak74")).toBe(true);
		expect(moduleFitsWeaponFamily(MODULE_BY_ID["handguard-ak-rail"]!, "ak74")).toBe(true);
		expect(moduleFitsWeaponFamily(MODULE_BY_ID["optic-reflex"]!, "missing")).toBe(false);
	});
	test("pages all models without omitting, repeating, or mutating them", () => {
		const before = JSON.stringify(MODULE_MODELS);
		const first = moduleCatalogPage(MODULE_MODELS, 0);
		expect(first.items).toHaveLength(40);
		expect(first.start).toBe(1);
		expect(first.end).toBe(40);
		const all = Array.from({ length: first.pageCount }, (_, index) => moduleCatalogPage(MODULE_MODELS, index).items).flat();
		expect(all.map((model) => model.id)).toEqual(MODULE_MODELS.map((model) => model.id));
		expect(JSON.stringify(MODULE_MODELS)).toBe(before);
	});
	test("clamps pages after filtering, including empty results", () => {
		expect(moduleCatalogPage([1, 2], 50)).toMatchObject({ items: [1, 2], index: 0, pageCount: 1, start: 1, end: 2, total: 2 });
		expect(moduleCatalogPage([], -4)).toMatchObject({ items: [], index: 0, pageCount: 1, start: 0, end: 0, total: 0 });
		expect(moduleCatalogPage([1], Number.NaN).index).toBe(0);
	});
	test("mount names communicate attachment points", () => {
		expect(moduleMountLabel("rail-top")).toBe("Верхняя планка");
		expect(moduleMountLabel("thread:5.45x39")).toBe("Резьба 5.45x39");
	});
});
