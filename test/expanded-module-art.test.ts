import { describe, expect, test } from "bun:test";
import { moduleArt, weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { WEAPONS } from "../src/game/data";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleModel, type ModuleSlot } from "../src/game/modules";

const newStyles = new Set(["heavy", "fluted", "wood", "vented", "carbon", "skeleton", "precision", "padded", "window", "compact", "drum", "micro", "holo", "prism", "scout", "longscope", "dovetail-reflex", "flash", "compact-suppressor", "ported", "stubby", "angled", "bipod", "folding"]);
// The original 174-part expansion retains its own historical contract.
const newModels = MODULE_MODELS.slice(0, 411).filter((model) => !["mount", "flashlight", "laser"].includes(model.slot) && newStyles.has(model.appearance) && !/^stock-.+-folding$/.test(model.id));
const factoryGun = (weaponId: string): WeaponInstance => ({ id: "geometry-test", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: `geometry-${slot}`, modelId, durability: 100, foundAt: 0 }])) });
const install = (weapon: WeaponInstance, model: ModuleModel) => { weapon.modules[model.slot] = { id: `geometry-${model.slot}`, modelId: model.id, durability: 100, foundAt: 0 }; };
const part = (svg: string, slot: ModuleSlot) => svg.match(new RegExp(`<g data-module-slot="${slot}"[^>]*>([\\s\\S]*?)</g>`))?.[1];
const outline = (svg: string | undefined) => svg?.match(/<path d="([^"]+)"/)?.[1];
const viewport = (svg: string) => svg.match(/viewBox="([^"]+)"/)![1]!.split(" ").map(Number);

function gunFor(model: ModuleModel, weaponId?: string): WeaponInstance {
	const definition = weaponId ? WEAPONS.find((weapon) => weapon.id === weaponId)! : WEAPONS.find((weapon) => {
		const info = RECEIVER_INFO[weapon.id]!;
		return (model.platforms.includes(info.platform) || model.platforms.includes("*")) && (model.calibers.includes(info.caliber) || model.calibers.includes("*")) && (!model.requiresMount?.startsWith("rail-") || weapon.category !== "pistol") && (model.requiresMount !== "dovetail" || MODULE_BY_ID[FACTORY_KITS[weapon.id]!.receiver!]!.providesMounts.includes("dovetail"));
	})!;
	const weapon = factoryGun(definition.id), info = RECEIVER_INFO[weapon.weaponId]!;
	if (model.requiresMount?.startsWith("rail-")) install(weapon, MODULE_BY_ID[`handguard-${info.platform}-carbon`]!);
	if (model.requiresMount?.startsWith("thread:") && !MODULE_BY_ID[weapon.modules.barrel!.modelId]!.providesMounts.includes(model.requiresMount)) {
		install(weapon, MODULE_BY_ID[`barrel-${info.platform}-${info.caliber}-long`]!);
	}
	install(weapon, model);
	expect(getWeaponBuildIssues(weapon)).toEqual([]);
	return weapon;
}

describe("expanded physical weapon module geometry", () => {
	test("all 174 new modules draw the same physical part loose, mounted and carried", () => {
		expect(newModels).toHaveLength(174);
		for (const model of newModels) {
			const weapon = gunFor(model), before = JSON.stringify(weapon);
			const loose = moduleArt(model), actor = weaponActorArt(weapon), bench = weaponBuildArt(weapon);
			expect(part(actor.svg, model.slot)).toBeDefined();
			expect(part(actor.svg, model.slot)).toBe(part(bench, model.slot));
			// Muzzle cards center the same part independently of where the current
			// barrel ends. Its outline after the initial anchor is entirely relative.
			const physicalOutline = (svg: string) => model.slot === "muzzle" ? outline(part(svg, model.slot))?.replace(/^M-?\d+(?:\.\d+)? /, "M0 ") : outline(part(svg, model.slot));
			expect(physicalOutline(actor.svg)).toBe(physicalOutline(loose));
			expect([actor.width, actor.height, actor.referenceWidth, actor.grip.x, actor.grip.y, actor.muzzle.x, actor.muzzle.y].every(Number.isFinite)).toBe(true);
			for (const anchor of [actor.grip, actor.muzzle]) {
				expect(anchor.x).toBeGreaterThanOrEqual(0); expect(anchor.x).toBeLessThanOrEqual(actor.width);
				expect(anchor.y).toBeGreaterThanOrEqual(0); expect(anchor.y).toBeLessThanOrEqual(actor.height);
			}
			expect(loose).not.toContain("undefined"); expect(actor.svg).not.toContain("NaN");
			expect(actor.referenceWidth).toBe(weaponActorArt(factoryGun(weapon.weaponId)).referenceWidth);
			expect(JSON.stringify(weapon)).toBe(before);
			delete weapon.modules[model.slot];
			expect(weaponActorArt(weapon).svg).not.toContain(`data-module-slot="${model.slot}"`);
		}
	});

	test("every new part changes the outline instead of merely recoloring its factory substitute", () => {
		for (const model of newModels) {
			const weapon = gunFor(model), factory = factoryGun(weapon.weaponId);
			const installedOutline = outline(part(weaponActorArt(weapon).svg, model.slot));
			const comparison = factory.modules[model.slot] ? factory : gunFor(MODULE_BY_ID[model.slot === "optic" ? "optic-reflex" : model.slot === "muzzle" ? `muzzle-${RECEIVER_INFO[weapon.weaponId]!.caliber}-brake` : "foregrip-vertical"]!, weapon.weaponId);
			expect(installedOutline).toBeDefined();
			expect(installedOutline).not.toBe(outline(part(weaponActorArt(comparison).svg, model.slot)));
		}
	});

	test("each stock, sight, grip, muzzle, handguard and magazine style has distinct visible geometry", () => {
		const groups: Record<string, string[]> = {
			stock: ["factory-ak74-stock", "stock-ak-folding", "stock-ak-tactical", "stock-ak-skeleton", "stock-ak-precision", "stock-ak-padded"],
			handguard: ["factory-ak74-handguard", "handguard-ak-rail", "handguard-ak-light", "handguard-ak-wood", "handguard-ak-vented", "handguard-ak-carbon"],
			magazine: ["factory-ak74-magazine", "magazine-ak-5.45x39-extended", "magazine-ak-5.45x39-quick", "magazine-ak-5.45x39-window", "magazine-ak-5.45x39-compact", "magazine-ak-5.45x39-drum"],
			optic: ["optic-reflex", "optic-scope", "optic-dovetail", "optic-micro", "optic-holo", "optic-prism", "optic-scout", "optic-longscope", "optic-dovetail-reflex"],
			muzzle: ["muzzle-5.45x39-brake", "muzzle-5.45x39-suppressor", "muzzle-5.45x39-flash", "muzzle-5.45x39-compact-suppressor", "muzzle-5.45x39-ported"],
			foregrip: ["foregrip-light", "foregrip-vertical", "foregrip-stubby", "foregrip-angled", "foregrip-bipod", "foregrip-folding"],
		};
		for (const ids of Object.values(groups)) {
			// Identical gun IDs keep every paint and wear definition identical. The
			// differences come from drawn parts, including rails, rings and pull tabs.
			const shapes = ids.map((id) => { const model = MODULE_BY_ID[id]!; return part(weaponActorArt(gunFor(model, "ak74")).svg, model.slot); });
			expect(new Set(shapes).size).toBe(ids.length);
		}
	});

	test("long barrels, scopes, precision stocks, drums and deployed bipods fit both canvases", () => {
		const weapon = factoryGun("rpk");
		for (const id of ["barrel-rpk-7.62x39-long", "handguard-rpk-carbon", "stock-rpk-precision", "magazine-rpk-7.62x39-drum", "optic-longscope", "muzzle-7.62x39-suppressor", "foregrip-bipod"]) install(weapon, MODULE_BY_ID[id]!);
		expect(getWeaponBuildIssues(weapon)).toEqual([]);
		const actor = weaponActorArt(weapon), bench = weaponBuildArt(weapon), [benchLeft = 0, benchTop = 0, benchWidth = 0, benchHeight = 0] = viewport(bench);
		const factoryBench = viewport(weaponBuildArt(factoryGun("rpk")));
		expect(benchWidth!).toBeGreaterThan(factoryBench[2]!); expect(benchHeight!).toBeGreaterThan(factoryBench[3]!);
		const [left, top] = viewport(actor.svg);
		const factoryActor = weaponActorArt(factoryGun("rpk"));
		expect(left!).toBeLessThan(viewport(factoryActor.svg)[0]!); expect(top!).toBeLessThan(viewport(factoryActor.svg)[1]!);
		expect(actor.width).toBeGreaterThan(actor.referenceWidth); expect(actor.height).toBeGreaterThan(factoryActor.height);
		expect(actor.muzzle.x + left!).toBeGreaterThan(benchLeft); expect(actor.muzzle.x + left!).toBeLessThan(benchLeft + benchWidth);
		expect(actor.muzzle.y + top!).toBeGreaterThan(benchTop); expect(actor.muzzle.y + top!).toBeLessThan(benchTop + benchHeight);
		for (const slot of Object.keys(weapon.modules) as ModuleSlot[]) expect(part(actor.svg, slot)).toBe(part(bench, slot));
	});

	test("heavy and fluted barrels alter the actual barrel and move every fitted muzzle once", () => {
		for (const weaponId of ["pm", "ak74", "mosin", "mp133", "vss"]) {
			const info = RECEIVER_INFO[weaponId]!, base = weaponActorArt(factoryGun(weaponId));
			const heavy = gunFor(MODULE_BY_ID[`barrel-${info.platform}-${info.caliber}-heavy`]!, weaponId);
			const fluted = gunFor(MODULE_BY_ID[`barrel-${info.platform}-${info.caliber}-fluted`]!, weaponId);
			const heavyArt = weaponActorArt(heavy), flutedArt = weaponActorArt(fluted);
			const distance = (art: ReturnType<typeof weaponActorArt>) => art.muzzle.x - art.grip.x;
			expect(distance(heavyArt) - distance(base)).toBe(20); expect(distance(flutedArt) - distance(base)).toBe(30);
			expect(outline(part(heavyArt.svg, "barrel"))).not.toBe(outline(part(flutedArt.svg, "barrel")));
			if (weaponId !== "vss") {
				install(heavy, MODULE_BY_ID[`muzzle-${info.caliber}-ported`]!); install(fluted, MODULE_BY_ID[`muzzle-${info.caliber}-ported`]!);
				expect(distance(weaponActorArt(fluted)) - distance(weaponActorArt(heavy))).toBe(10);
			}
		}
	});

	test("compatible physical factory parts keep their own silhouette when transferred between VSS and VAL", () => {
		const val = factoryGun("asval"), valStock = outline(part(weaponActorArt(val).svg, "stock"));
		install(val, MODULE_BY_ID["factory-vss-stock"]!);
		expect(getWeaponBuildIssues(val)).toEqual([]);
		const transferred = weaponActorArt(val), stock = outline(part(transferred.svg, "stock"));
		expect(stock).not.toBe(valStock);
		expect(stock).toBe(outline(part(moduleArt(MODULE_BY_ID["factory-vss-stock"]!), "stock")));
		expect(part(transferred.svg, "stock")).toBe(part(weaponBuildArt(val), "stock"));
		const vss = factoryGun("vss"); install(vss, MODULE_BY_ID["factory-asval-stock"]!);
		expect(getWeaponBuildIssues(vss)).toEqual([]);
		expect(outline(part(weaponActorArt(vss).svg, "stock"))).toBe(valStock);
	});
});
