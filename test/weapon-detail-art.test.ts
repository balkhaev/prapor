import { describe, expect, test } from "bun:test";
import { moduleArt, weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { WEAPONS } from "../src/game/data";
import type { WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, MODULE_BY_ID, type ModuleSlot } from "../src/game/modules";

const factory = (weaponId: string): WeaponInstance => ({ id: "mechanical-detail", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: `detail-${slot}`, modelId, durability: 100, foundAt: 0 }])) });
const part = (svg: string, slot: ModuleSlot) => svg.match(new RegExp(`<g data-module-slot="${slot}"[^>]*>([\\s\\S]*?)</g>`))?.[1];
const outline = (svg: string) => svg.match(/<path d="([^"]+)"/)![1]!;

describe("mechanical weapon illustration", () => {
	test("all sixteen factory actions have individual physical cores, shared loose and installed", () => {
		const silhouettes = new Set<string>();
		for (const definition of WEAPONS) {
			const gun = factory(definition.id), model = MODULE_BY_ID[gun.modules.receiver!.modelId]!, actor = part(weaponActorArt(gun).svg, "receiver")!;
			silhouettes.add(outline(actor));
			expect(outline(actor), definition.id).toBe(outline(part(moduleArt(model), "receiver")!));
			expect(actor, definition.id).toContain('data-mechanism="ejection-port"');
			expect(actor, definition.id).toContain('data-mechanism="trigger-guard"');
		}
		expect(silhouettes.size).toBe(WEAPONS.length);
	});

	test("action details reflect gas, blowback, pump and manual mechanisms", () => {
		for (const id of ["sks", "ak74", "akm", "saiga", "rpk", "svd", "pkp"]) expect(part(weaponActorArt(factory(id)).svg, "barrel"), id).toContain('data-mechanism="gas-system"');
		for (const id of ["pm", "tt", "pp91", "vityaz", "mosin", "toz", "mp133"]) expect(part(weaponActorArt(factory(id)).svg, "barrel"), id).not.toContain('data-mechanism="gas-system"');
		for (const id of ["mosin", "toz"]) expect(part(weaponActorArt(factory(id)).svg, "receiver"), id).toContain('data-mechanism="bolt-handle"');
		expect(part(weaponActorArt(factory("pkp")).svg, "receiver")).toContain('data-mechanism="feed-tray"');
		expect(part(weaponActorArt(factory("mp133")).svg, "receiver")).toContain('data-mechanism="action-release"');
		const gun = factory("ak74"); delete gun.modules.barrel;
		expect(weaponActorArt(gun).svg).not.toContain('data-mechanism="gas-system"');
	});

	test("native factory stocks and magazines retain their identity within shared families", () => {
		const val = factory("asval"), vss = factory("vss"), receiver = outline(part(weaponActorArt(val).svg, "receiver")!);
		expect(outline(part(weaponActorArt(val).svg, "stock")!)).not.toBe(outline(part(weaponActorArt(vss).svg, "stock")!));
		val.modules.stock = { ...vss.modules.stock!, id: "borrowed-vss-stock" };
		expect(outline(part(weaponActorArt(val).svg, "stock")!)).toBe(outline(part(weaponActorArt(vss).svg, "stock")!));
		expect(outline(part(weaponActorArt(val).svg, "receiver")!)).toBe(receiver);
		const magazineOutlines = ["toz", "saiga", "svd", "vss", "vityaz", "pp91", "ak74"].map((id) => outline(part(weaponActorArt(factory(id)).svg, "magazine")!));
		expect(new Set(magazineOutlines).size).toBe(magazineOutlines.length);
		const saved = JSON.stringify(val), selected = weaponBuildArt(val, "stock");
		expect(selected).toContain('weapon-part--selected');
		expect(selected).not.toContain("feDropShadow");
		expect(JSON.stringify(val)).toBe(saved);
	});
});
