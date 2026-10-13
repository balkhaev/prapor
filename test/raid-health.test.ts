import { describe, expect, test } from "bun:test";
import { createHealth, createMedicalInventory, isAlive, parseHealth, parseMedicalInventory, TREATMENT_TYPES } from "../src/game/health";
import { raidMedicalInventory, resolveMedicalEncounter, type RaidMedicalStart } from "../src/game/raid-health";

const NOW = 1_792_000_000_000;
const medicalStart = (kit = true): RaidMedicalStart => ({ body: createHealth(), inventory: raidMedicalInventory(kit), injuryMultiplier: 1, armorProtection: .8, helmetProtection: 0 });
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

describe("deterministic raid medical encounters", () => {
	test("a helmet protects against a deep aimed ambush while ordinary successful fire avoids headshots", () => {
		const unprotected = medicalStart(false), helmet = { ...structuredClone(unprotected), helmetProtection: .8 };
		let aimedSeed: number | null = null;
		for (let seed = 1; seed <= 4_096; seed++) {
			const nakedResult = resolveMedicalEncounter(unprotected, seed, 2, .6, false, NOW);
			if (!nakedResult.events[0]?.startsWith("Голова:") || !nakedResult.dead) continue;
			const helmetResult = resolveMedicalEncounter(helmet, seed, 2, .6, false, NOW);
			if (helmetResult.dead) continue;
			aimedSeed = seed;
			expect(nakedResult.body.parts.head.hp).toBe(0);
			expect(helmetResult.body.parts.head.hp).toBeGreaterThan(0);
			expect(helmetResult.events[0]).toContain("броня остановила");
			break;
		}
		expect(aimedSeed).not.toBeNull();
		const ordinary = resolveMedicalEncounter(unprotected, aimedSeed!, 2, .6, true, NOW);
		expect(ordinary.body.parts.head.hp).toBe(35);
		expect(ordinary.events.some((event) => event.startsWith("Голова:"))).toBe(false);
		expect(ordinary.dead).toBe(false);
	});

	test("encounters preserve immutable starting inputs and never invent or overspend medical stock", () => {
		for (const kit of [false, true]) {
			const start = freeze(medicalStart(kit)), before = structuredClone(start);
			for (let seed = 1; seed <= 128; seed++) {
				const result = resolveMedicalEncounter(start, seed, seed % 3 + 1, .75, seed % 2 === 0, NOW);
				expect(() => parseHealth(result.body)).not.toThrow();
				expect(() => parseMedicalInventory(result.inventory)).not.toThrow();
				for (const type of TREATMENT_TYPES) {
					expect(result.inventory[type]).toBeGreaterThanOrEqual(0);
					expect(result.inventory[type]).toBeLessThanOrEqual(start.inventory[type]);
				}
			}
			expect(start).toEqual(before);
		}
	});

	test("an untreated broken arm slows the same healing work without changing its delivered HP or cost", () => {
		const healthyArms = medicalStart(false);
		healthyArms.body.parts.chest.hp = 65;
		healthyArms.inventory = createMedicalInventory({ medkit: 40 });
		healthyArms.injuryMultiplier = 0;
		const fractured = structuredClone(healthyArms);
		fractured.body.parts.leftArm.fracture = true;
		const baseline = resolveMedicalEncounter(healthyArms, 1, 1, 0, true, NOW);
		const impaired = resolveMedicalEncounter(fractured, 1, 1, 0, true, NOW);
		expect(baseline.body.parts.chest.hp).toBe(85);
		expect(impaired.body.parts.chest.hp).toBe(85);
		expect(impaired.inventory).toEqual(baseline.inventory);
		expect(impaired.medicalMs).toBeGreaterThan(baseline.medicalMs);
		expect(impaired.body.parts.leftArm.fracture).toBe(true);
	});

	test("a fatal forecast replays exactly and fresh supplies or a rescue cannot resurrect an already dead body", () => {
		const start = freeze(medicalStart(false));
		let fatalSeed: number | null = null;
		for (let seed = 1; seed <= 4_096; seed++) if (resolveMedicalEncounter(start, seed, 3, .8, false, NOW).dead) { fatalSeed = seed; break; }
		expect(fatalSeed).not.toBeNull();
		const forecast = resolveMedicalEncounter(start, fatalSeed!, 3, .8, false, NOW);
		expect(resolveMedicalEncounter(structuredClone(start), fatalSeed!, 3, .8, false, NOW)).toEqual(forecast);
		expect(isAlive(forecast.body)).toBe(false);
		for (const vital of ["head", "chest"] as const) for (const rescued of [false, true]) {
			const dead = medicalStart();
			dead.body.parts[vital].hp = 0;
			const inventoryBefore = structuredClone(dead.inventory);
			const result = resolveMedicalEncounter(dead, fatalSeed!, 3, .8, false, NOW, rescued);
			expect(result.dead).toBe(true);
			expect(result.body.parts[vital].hp).toBe(0);
			expect(result.inventory).toEqual(inventoryBefore);
		}
	});
});
