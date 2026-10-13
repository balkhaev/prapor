import { describe, expect, test } from "bun:test";
import { weaponActorArt } from "../src/armory-art";
import { getWeaponBuildIssues, type WeaponInstance } from "../src/game/engine";
import { FACTORY_KITS, MODULE_BY_ID } from "../src/game/modules";
import { weaponVisualSignature } from "../src/scav-loadout";
import { WeaponTextureKeys } from "../src/weapon-texture-keys";

function build(id: string, durability = 100, parts: string[] = []): WeaponInstance {
	const gun: WeaponInstance = { id, weaponId: "m4a1", durability, foundAt: 0, attachments: { optic: 0, magazine: 0, stock: 0 }, modules: Object.fromEntries(Object.entries(FACTORY_KITS.m4a1!).map(([slot, modelId]) => [slot, { id: `${id}-${slot}`, modelId, durability: slot === "receiver" ? durability : 100, foundAt: 0 }])) };
	for (const modelId of parts) { const model = MODULE_BY_ID[modelId]!; gun.modules[model.slot] = { id: `${id}-${model.slot}`, modelId, durability: 100, foundAt: 0 }; }
	return gun;
}
const signature = (gun: WeaponInstance, revision = 0) => `${weaponVisualSignature(gun)}:${revision}`;

describe("exact held-weapon texture identity", () => {
	test("the two valid physical builds that collided in the shortened key keep separate art and muzzle metadata", () => {
		const first = build("gun-1", 100, ["barrel-ar-5.56x45-short", "handguard-ar-rail", "factory-m4a1-stock", "magazine-ar-5.56x45-extended", "optic-reflex", "muzzle-5.56x45-compact-suppressor", "foregrip-light"]);
		const second = build("gun-2", 40, ["factory-m4a1-barrel", "handguard-ar-rail", "stock-ar-precision", "magazine-ar-5.56x45-extended", "muzzle-5.56x45-compact-suppressor", "foregrip-stubby"]);
		expect(getWeaponBuildIssues(first)).toEqual([]); expect(getWeaponBuildIssues(second)).toEqual([]);
		expect(first.modules.receiver!.durability).toBe(first.durability); expect(second.modules.receiver!.durability).toBe(second.durability);
		const legacyKey = (value: string) => { let hash = 2166136261; for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619); return (hash >>> 0).toString(36); };
		expect(legacyKey(signature(first))).toBe(legacyKey(signature(second)));
		const firstArt = weaponActorArt(first), secondArt = weaponActorArt(second);
		expect(firstArt.svg).not.toBe(secondArt.svg); expect(firstArt.muzzle.x - firstArt.grip.x).not.toBe(secondArt.muzzle.x - secondArt.grip.x);
		const keys = new WeaponTextureKeys(), textures = new Map<string, typeof firstArt>();
		const firstKey = keys.keyFor(signature(first), key => textures.has(key)); textures.set(firstKey, firstArt);
		const secondKey = keys.keyFor(signature(second), key => textures.has(key)); textures.set(secondKey, secondArt);
		expect(firstKey).not.toBe(secondKey); expect(textures.size).toBe(2);
		expect(textures.get(keys.keyFor(signature(first), key => textures.has(key)))).toBe(firstArt);
		expect(textures.get(keys.keyFor(signature(second), key => textures.has(key)))).toBe(secondArt);
	});

	test("thirty-two actors share one texture until material revision, visible wear or the installed build changes", () => {
		const keys = new WeaponTextureKeys(), existing = new Set<string>();
		for (let actor = 0; actor < 32; actor++) existing.add(keys.keyFor(signature(build(`gun-${actor}`)), key => existing.has(key)));
		expect(existing.size).toBe(1);
		const gun = build("gun-50"), materialKey = keys.keyFor(signature(gun, 5), key => existing.has(key)); existing.add(materialKey);
		expect(existing.size).toBe(2);
		gun.durability = 79; gun.modules.receiver!.durability = 79;
		const wornKey = keys.keyFor(signature(gun, 5), key => existing.has(key)); existing.add(wornKey);
		expect(existing.size).toBe(3);
		gun.durability = 61; gun.modules.receiver!.durability = 61;
		expect(keys.keyFor(signature(gun, 5), key => existing.has(key))).toBe(wornKey);
		gun.modules.barrel!.modelId = "barrel-ar-5.56x45-long";
		expect(keys.keyFor(signature(gun, 5), key => existing.has(key))).not.toBe(wornKey);
		// A failed rasterization retry or a removed GPU texture still owns its
		// original key; the unchanged signature never creates duplicate art.
		existing.delete(wornKey);
		expect(keys.keyFor(signature(build("gun-51", 79), 5), key => existing.has(key))).toBe(wornKey);
	});

	test("existing TextureManager names are skipped without overwriting other textures", () => {
		const existing = new Set(["scav-weapon-build-1", "scav-weapon-build-3"]), keys = new WeaponTextureKeys();
		const first = keys.keyFor("first", key => existing.has(key)); existing.add(first);
		const second = keys.keyFor("second", key => existing.has(key)); existing.add(second);
		expect(first).toBe("scav-weapon-build-2"); expect(second).toBe("scav-weapon-build-4");
		expect(keys.keyFor("first", key => existing.has(key))).toBe(first);
		expect(new WeaponTextureKeys().keyFor("another owner", key => existing.has(key))).toBe("scav-weapon-build-5");
	});
});
