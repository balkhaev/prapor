import { describe, expect, test } from "bun:test";
import { AMMO_MODELS, type AmmoType } from "../src/game/ammunition";
import { AMMUNITION_ART_CALIBERS, AMMUNITION_ART_TYPES, ammunitionArt, getAmmunitionArtwork } from "../src/ammunition-art";

describe("generated ammunition pack atlas mapping", () => {
	test("every referenced atlas ships a full-size transparent PNG with square cells", async () => {
		for (const caliber of AMMUNITION_ART_CALIBERS) {
			const file = Bun.file(new URL(`../public/art/ammo/ammo-${caliber}.png`, import.meta.url));
			const bytes = new Uint8Array(await file.arrayBuffer()), header = new DataView(bytes.buffer);
			expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
			expect(header.getUint32(16)).toBe(header.getUint32(20) * 2);
			expect(header.getUint32(20)).toBeGreaterThanOrEqual(800);
			expect(bytes[25]).toBe(6); // RGBA; generated transparency must survive copying.
			expect(file.size).toBeGreaterThan(100_000);
		}
	});

	test("all 128 products map to a distinct compatible pack, with stable legacy first-row positions", () => {
		const positions = new Set<string>();
		const codes = ["FMJ", "AP", "HP", "MATCH", "SUB", "TR", "+P", "STOCK"];
		expect(AMMO_MODELS).toHaveLength(128);
		for (const model of AMMO_MODELS) {
			const art = getAmmunitionArtwork(model)!;
			expect(art).not.toBeNull();
			expect(art.url).toBe(`/art/ammo/ammo-${model.caliber}.png`);
			const index = AMMUNITION_ART_TYPES.indexOf(model.type);
			expect(model.packCode).toBe(codes[index]!);
			expect(art.column).toBe(index % 4);
			expect(art.row).toBe(index < 4 ? 0 : 1);
			positions.add(`${art.url}/${art.column}/${art.row}`);
		}
		expect(positions.size).toBe(128);
		expect(new Set(AMMO_MODELS.map((model) => getAmmunitionArtwork(model)!.url)).size).toBe(AMMUNITION_ART_CALIBERS.length);
	});

	test("unknown caliber or type cannot create an arbitrary image URL", () => {
		expect(getAmmunitionArtwork({ caliber: "../../external", type: "standard" })).toBeNull();
		expect(getAmmunitionArtwork({ caliber: "9x18", type: "constructor" as AmmoType })).toBeNull();
	});

	test("selected art has an accessible actual name and count while repeated cards are decorative", () => {
		for (const model of AMMO_MODELS) {
			const selected = ammunitionArt(model), decorative = ammunitionArt(model, true);
			expect(selected).toContain('role="img"');
			expect(selected).toContain(model.label);
			expect(selected).toContain(`${model.packRounds} патронов`);
			expect(decorative).toContain('aria-hidden="true"');
			expect(decorative).not.toContain('role="img"');
		}
	});
});
