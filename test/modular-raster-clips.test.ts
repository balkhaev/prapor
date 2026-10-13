import { expect, test } from "bun:test";
import { resolve } from "node:path";

// Atlas loading mutates a module-level cache. Keep the synthetic browser and
// atlas in a child runtime so unrelated art tests retain their normal fallback.
test("same-instance replacement previews keep separate generated-paint clipping masks", () => {
	const script = `
		globalThis.window = {};
		globalThis.fetch = async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
		globalThis.FileReader = class {
			result = "data:image/png;base64,AQ==";
			readAsDataURL() { this.onload(); }
		};
		globalThis.Image = class { naturalWidth = 4; naturalHeight = 2; async decode() {} };
		globalThis.document = { createElement: () => ({
			getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(32).fill(255) }) })
		}) };
		const { preloadModularWeaponArt } = await import("./src/modular-weapon-art");
		const { weaponBuildArt, moduleArt } = await import("./src/armory-art");
		const { FACTORY_KITS, MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO } = await import("./src/game/modules");
		const { getWeaponBuildIssues } = await import("./src/game/engine");
		await preloadModularWeaponArt();
		const factory = (id) => ({ id: "same-owned-weapon", weaponId: id, durability: 100, foundAt: 0,
			attachments: { optic: 0, stock: 0, magazine: 0 }, modules: Object.fromEntries(
				Object.entries(FACTORY_KITS[id]).map(([slot, modelId]) => [slot, { id: slot, modelId, durability: 100, foundAt: 0 }])) });
		const clip = (svg, slot) => {
			const part = svg.match(new RegExp('<g data-generated-part="[^"/]+/' + slot + '" clip-path="url\\\\(#([^)]*)\\\\)"'));
			if (!part) throw new Error("No loaded generated paint for " + slot);
			const id = part[1], definition = svg.includes('<clipPath id="' + id + '">');
			if (!definition) throw new Error("Missing local clip definition " + id);
			return id;
		};
		const results = [];
		for (const weaponId of ["m4a1", "hk416", "p90", "mp7", "aug", "ash12", "awm", "m870"]) {
			const gun = factory(weaponId), original = weaponBuildArt(gun), info = RECEIVER_INFO[weaponId];
			for (const slot of ["barrel", "stock", "magazine"]) {
				const candidate = MODULE_MODELS.find(model => model.slot === slot && model.appearance !== "factory"
					&& (model.platforms.includes("*") || model.platforms.includes(info.platform))
					&& (model.calibers.includes("*") || model.calibers.includes(info.caliber)));
				if (!candidate) throw new Error("Missing replacement " + weaponId + "/" + slot);
				const preview = structuredClone(gun);
				preview.modules[slot] = { id: "candidate-instance", modelId: candidate.id, durability: 100, foundAt: 0 };
				if (getWeaponBuildIssues(preview).length) throw new Error("Incompatible candidate " + candidate.id);
				const currentClip = clip(original, slot), candidateClip = clip(weaponBuildArt(preview), slot);
				const loose = moduleArt(candidate), repeated = moduleArt(candidate);
				results.push({ weaponId, slot, changed: currentClip !== candidateClip,
					stable: candidateClip === clip(weaponBuildArt(preview), slot), looseStable: clip(loose, slot) === clip(repeated, slot) });
			}
		}
		console.log(JSON.stringify(results));
	`;
	const result = Bun.spawnSync({ cmd: [process.execPath, "-e", script], cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	const cases = JSON.parse(result.stdout.toString()) as { weaponId: string; slot: string; changed: boolean; stable: boolean; looseStable: boolean }[];
	expect(cases).toHaveLength(24);
	for (const row of cases) {
		expect(row.changed, `${row.weaponId}/${row.slot}: current and replacement masks must differ`).toBe(true);
		expect(row.stable, `${row.weaponId}/${row.slot}: preview mask must remain deterministic`).toBe(true);
		expect(row.looseStable, `${row.weaponId}/${row.slot}: loose-part mask must remain deterministic`).toBe(true);
	}
});
