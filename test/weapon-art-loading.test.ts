import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("cold-start carried builds load the materials of installed donor parts without inventory cards", () => {
	// Isolate the atlas cache and browser IO doubles from native-art goldens.
	const script = `
		const requests = [];
		globalThis.window = {};
		globalThis.fetch = async url => { requests.push(url); return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } }); };
		globalThis.FileReader = class { result = "data:image/png;base64,AQ=="; readAsDataURL() { this.onload(); } };
		globalThis.Image = class { naturalWidth = 4; naturalHeight = 2; async decode() {} };
		globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(32).fill(255) }) }) }) };
		const { modularWeaponArtFamilies, modularWeaponArtRevision, preloadModularWeaponArt } = await import("./src/modular-weapon-art");
		const { FACTORY_KITS, MODULE_BY_ID } = await import("./src/game/modules");
		const { getWeaponBuildIssues } = await import("./src/game/engine");
		const { weaponActorArt } = await import("./src/armory-art");
		const cases = [
			["g36", "barrel-g36-5.56x45-long", "muzzle-5.56x45-suppressor", "m4a1"],
			["sr25", "barrel-ar10-7.62x51-long", "muzzle-7.62x51-suppressor", "scarh"],
			["fiveseven", "barrel-fiveseven-5.7x28-long", "muzzle-5.7x28-suppressor", "p90"],
			["sr1", "barrel-sr1-9x21-long", "muzzle-9x21-suppressor", "sr2"],
			["m4a1", "factory-hk416-barrel", null, "hk416"],
		];
		const results = [];
		for (const [weaponId, barrelId, muzzleId, donor] of cases) {
			const gun = { id: "cold-" + weaponId, weaponId, durability: 100, foundAt: 0, attachments: { optic: 0, stock: 0, magazine: 0 },
				modules: Object.fromEntries(Object.entries(FACTORY_KITS[weaponId]).map(([slot, modelId]) => [slot, { id: "part-" + slot, modelId, durability: 100, foundAt: 0 }])) };
			for (const modelId of [barrelId, muzzleId].filter(Boolean)) {
				const model = MODULE_BY_ID[modelId]; if (!model) throw new Error("Missing fixture " + modelId);
				gun.modules[model.slot] = { id: modelId, modelId, durability: 100, foundAt: 0 };
			}
			if (getWeaponBuildIssues(gun).length) throw new Error("Invalid build " + weaponId);
			const families = modularWeaponArtFamilies(gun), before = JSON.stringify(gun);
			await preloadModularWeaponArt(families);
			const svg = weaponActorArt(gun).svg;
			results.push({ weaponId, donor, families, requested: requests.includes("/art/weapons/modular-" + donor + ".png"),
				painted: svg.includes('data-generated-part="' + donor + '/' + (muzzleId ? "muzzle" : "barrel") + '"'),
				revision: modularWeaponArtRevision(gun), preserved: JSON.stringify(gun) === before });
		}
		console.log(JSON.stringify({ results, requests }));
	`;
	const child = Bun.spawnSync({ cmd: [process.execPath, "-e", script], cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
	expect(child.exitCode, child.stderr.toString()).toBe(0);
	const { results, requests } = JSON.parse(child.stdout.toString()) as {
		results: { weaponId: string; donor: string; families: string[]; requested: boolean; painted: boolean; revision: number; preserved: boolean }[];
		requests: string[];
	};
	expect(results).toHaveLength(5);
	for (const row of results) {
		expect(row.families, row.weaponId).toContain(row.weaponId);
		expect(row.families, row.weaponId).toContain(row.donor);
		expect(new Set(row.families).size).toBe(row.families.length);
		expect(row.requested, row.weaponId).toBe(true);
		expect(row.painted, row.weaponId).toBe(true);
		expect(row.revision, row.weaponId).toBeGreaterThan(0);
		expect(row.preserved, row.weaponId).toBe(true);
	}
	expect(new Set(requests).size).toBe(requests.length);
});
