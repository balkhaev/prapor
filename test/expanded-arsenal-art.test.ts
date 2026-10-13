import { describe, expect, test } from "bun:test";
import { moduleArt, weaponActorArt, weaponBuildArt } from "../src/armory-art";
import { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO, type ModuleSlot } from "../src/game/modules";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { MODULAR_WEAPON_ART_IDS, MODULAR_WEAPON_ART_SLOTS, modularAtlasCellBounds, modularWeaponArtFamily, modularWeaponArtUrl, preloadModularWeaponArt } from "../src/modular-weapon-art";

const factory = (weaponId: string): WeaponInstance => ({ id: "expanded-profile", weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]!).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
const install = (gun: WeaponInstance, id: string) => { const model = MODULE_BY_ID[id]!; gun.modules[model.slot] = { id: id, modelId: id, durability: 100, foundAt: 0 }; };
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
const outline = (svg: string): string => svg.match(/<path d="([^"]+)"/)![1]!;

describe("expanded modular weapon profiles", () => {
	test("every new receiver has a distinct mechanical silhouette and shares geometry with actor and loose part", () => {
		const outlines = new Set<string>();
		for (const id of MODULAR_WEAPON_ART_IDS) {
			const gun = factory(id), actor = weaponActorArt(gun), bench = weaponBuildArt(gun);
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			for (const slot of RECEIVER_INFO[id]!.requiredSlots) {
				const model = MODULE_BY_ID[gun.modules[slot]!.modelId]!;
				expect(part(actor.svg, slot)).toBe(part(bench, slot));
				expect(outline(part(actor.svg, slot))).toBe(outline(part(moduleArt(model), slot)));
			}
			outlines.add(outline(part(actor.svg, "receiver")));
			expect([actor.width, actor.height, actor.referenceWidth, actor.grip.x, actor.grip.y, actor.muzzle.x, actor.muzzle.y].every((value) => Number.isFinite(value) && value > 0)).toBe(true);
			expect(actor.svg).not.toMatch(/undefined|NaN|Infinity/);
		}
		expect(outlines.size).toBe(MODULAR_WEAPON_ART_IDS.length);
	});

	test("P90 horizontal feed and MP7 grip feed stay physically distinct across magazine and stock variants", () => {
		const p90 = factory("p90"), mp7 = factory("mp7");
		for (const appearance of ["factory", "extended", "quick", "window", "compact"]) {
			for (const gun of [p90, mp7]) {
				const info = RECEIVER_INFO[gun.weaponId]!, id = appearance === "factory" ? FACTORY_KITS[gun.weaponId]!.magazine! : `magazine-${info.platform}-${info.caliber}-${appearance}`;
				install(gun, id);
				const art = weaponActorArt(gun), magazine = part(art.svg, "magazine");
				expect(magazine).toBe(part(weaponBuildArt(gun), "magazine"));
				if (gun.weaponId === "p90") {
					expect(magazine).toContain('data-mechanism="p90-horizontal-feed"');
					expect(outline(magazine)).toMatch(/^M\d+ 109h/);
				} else expect(outline(magazine)).toMatch(/^M335 194h38/);
			}
		}
		for (const appearance of ["tactical", "skeleton", "precision", "padded"]) {
			install(p90, `stock-p90-${appearance}`);
			const stock = part(weaponActorArt(p90).svg, "stock");
			expect(outline(stock)).toMatch(/^M\d+ 128h\d+l14 12v63l-14 15/);
		}
		expect(part(weaponActorArt(mp7).svg, "receiver")).toContain('data-mechanism="grip-feed-well"');
	});

	test("cross-fitting AR factory barrels retains the physical barrel length and receiver scale", () => {
		for (const [recipient, donor] of [["m4a1", "hk416"], ["hk416", "m4a1"]]) {
			const gun = factory(recipient!), reference = weaponActorArt(gun).referenceWidth;
			install(gun, FACTORY_KITS[donor!]!.barrel!);
			const actor = weaponActorArt(gun), source = moduleArt(MODULE_BY_ID[FACTORY_KITS[donor!]!.barrel!]!);
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			expect(outline(part(actor.svg, "barrel"))).toBe(outline(part(source, "barrel")));
			expect(actor.referenceWidth).toBe(reference);
		}
	});

	test("1911 bridges carry real rails and TRG preserves bolt operation through barrel replacements", () => {
		const pistol = factory("m1911"); install(pistol, "mount-1911-bridge"); install(pistol, "optic-reflex"); install(pistol, "flashlight-mini"); install(pistol, "laser-micro");
		expect(getWeaponBuildIssues(pistol)).toEqual([]);
		const pistolArt = weaponActorArt(pistol);
		expect(pistolArt.svg).toContain('data-hardware="pistol-bridge-frame-shoe"');
		expect(pistolArt.svg).toContain('data-mechanism="1911-bushing"');
		for (const slot of ["mount", "optic", "flashlight", "laser"] as const) expect(part(pistolArt.svg, slot)).toBe(part(weaponBuildArt(pistol), slot));
		const trg = factory("trg42"), first = weaponActorArt(trg);
		install(trg, "barrel-trg-.338lapua-long"); const longer = weaponActorArt(trg);
		expect(longer.svg).toContain('data-mechanism="trg-bolt-handle"');
		expect(longer.svg).not.toContain('data-mechanism="gas-system"');
		expect(longer.muzzle.x).toBeGreaterThan(first.muzzle.x);
		expect(longer.referenceWidth).toBe(first.referenceWidth);
	});

	test("native receiver rails support long optics after swapping to an unrailed handguard", () => {
		for (const id of MODULAR_WEAPON_ART_IDS.slice(0, 9).filter((id) => id !== "m1911")) {
			const gun = factory(id), info = RECEIVER_INFO[id]!;
			install(gun, `handguard-${info.platform}-light`); install(gun, "optic-longscope");
			expect(getWeaponBuildIssues(gun)).toEqual([]);
			const art = weaponActorArt(gun), receiver = part(art.svg, "receiver");
			const rails = [...receiver.matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v6H[-\d.]+z"/g)].map((match) => [Number(match[1]), Number(match[2]), Number(match[1]) + Number(match[3])]);
			const dx = id === "p90" ? 130 : 0;
			for (const x of [369, 479]) expect(rails.some(([left = 0, top = 0, right = 0]) => left <= x + dx && right >= x + dx + 13 && top === 108), `${id} receiver supports optical ring`).toBe(true);
		}
		const p90 = factory("p90"); install(p90, "handguard-p90-carbon"); install(p90, "foregrip-bipod");
		expect(getWeaponBuildIssues(p90)).toEqual([]);
		const grip = part(weaponActorArt(p90).svg, "foregrip"); expect(grip).toContain('transform="translate(0 36)"');
		expect(part(weaponActorArt(p90).svg, "handguard")).toContain('d="M501 212h108v6H501z"');
	});

	test("every new family upgrade has distinct structural geometry beyond material and wear paint", () => {
		const structuralGeometry = (svg: string) => {
			const detail = svg.split("<defs>")[0]!;
			return [...detail.matchAll(/<(?:path|circle|rect)\b[^>]*>/g)].map((tag) => [...tag[0].matchAll(/\b(?:d|x|y|width|height|cx|cy|r)="[^"]*"/g)].map((attribute) => attribute[0]).join(" ")).join("|");
		};
		const audited = new Set<string>();
		for (const id of MODULAR_WEAPON_ART_IDS) {
			const gun = factory(id), info = RECEIVER_INFO[id]!;
			for (const slot of ["barrel", "handguard", "stock", "magazine"] as const) {
				if (!gun.modules[slot]) continue;
				const models = MODULE_MODELS.filter((model) => model.slot === slot && (model.id === FACTORY_KITS[id]![slot] || (!model.weaponId && model.platforms.includes(info.platform) && model.calibers.includes(info.caliber))));
				const geometries = models.map((model) => {
					install(gun, model.id); audited.add(model.id);
					return structuralGeometry(part(weaponActorArt(gun).svg, slot));
				});
				expect(new Set(geometries).size, `${id}/${slot} distinct physical variants`).toBe(models.length);
			}
		}
		expect(audited.size).toBeGreaterThan(160);
	});
});

describe("generated modular materials", () => {
	test("atlas source cells have fixed slot order and actual physical family identity", () => {
		expect(MODULAR_WEAPON_ART_SLOTS).toEqual(["receiver", "barrel", "handguard", "stock", "magazine", "optic", "muzzle", "foregrip"]);
		expect(modularWeaponArtFamily(MODULE_BY_ID["factory-hk416-barrel"]!)).toBe("hk416");
		expect(modularWeaponArtFamily(MODULE_BY_ID["barrel-ar-5.56x45-long"]!)).toBe("m4a1");
		expect(modularWeaponArtFamily(MODULE_BY_ID["muzzle-7.62x51-suppressor"]!)).toBe("scarh");
		expect(modularWeaponArtFamily(MODULE_BY_ID["receiver-ak74"]!)).toBeUndefined();
		for (const id of MODULAR_WEAPON_ART_IDS) expect(modularWeaponArtUrl(id)).toBe(`/art/weapons/modular-${id}.png`);
	});

	test("alpha bounds cannot cross atlas cells and empty cells retain their own rectangle", () => {
		const width = 40, height = 20, alpha = new Uint8ClampedArray(width * height * 4);
		for (let y = 12; y < 18; y++) for (let x = 22; x < 28; x++) alpha[(y * width + x) * 4 + 3] = 255;
		alpha[(3 * width + 4) * 4 + 3] = 20; // faint shadow is ignored
		expect(modularAtlasCellBounds(alpha, width, height, 6)).toEqual([22, 12, 6, 6]);
		expect(modularAtlasCellBounds(alpha, width, height, 0)).toEqual([0, 0, 10, 10]);
		expect(modularAtlasCellBounds(alpha, width, height, 5)).toEqual([10, 10, 10, 10]);
	});

	test("server-side art needs no browser DOM or external image URLs", async () => {
		await preloadModularWeaponArt(["m4a1"]);
		for (const id of MODULAR_WEAPON_ART_IDS) {
			const art = weaponActorArt(factory(id));
			expect(art.svg).not.toMatch(/href="(?:https?:|\/art\/)/);
		}
	});

	test("all saved material atlases are real transparent PNGs", async () => {
		for (const id of MODULAR_WEAPON_ART_IDS) {
			const bytes = Buffer.from(await Bun.file(new URL(`../public/art/weapons/modular-${id}.png`, import.meta.url)).arrayBuffer());
			expect([...bytes.subarray(0, 8)], id).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
			const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
			expect(width, id).toBeGreaterThanOrEqual(1024); expect(height, id).toBeGreaterThanOrEqual(512);
			expect(bytes[25], id).toBe(6); // The generator's RGBA pixels remain intact.
		}
		expect(moduleArt(MODULE_BY_ID["receiver-m4a1"]!)).toContain('data-model-id="receiver-m4a1"');
		expect(weaponBuildArt(factory("m4a1"))).toContain('data-weapon-model="m4a1"');
	});
});
