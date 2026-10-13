import { describe, expect, test } from "bun:test";
import { BODY_PARTS, BODY_PART_MAX_HP, TREATMENT_DURATION_MS, advanceBleeding, applyHit, canDeploy, canTreat, completeTreatment, createHealth, createMedicalInventory, getRecoveryWaitMs, healthPercent, injuryEffects, isAlive, isStable, parseHealth, parseMedicalInventory, recoverAtBase, selectTreatment } from "../src/game/health";

describe("body health and field medicine", () => {
	test("seven zones total 440 HP; legacy zero remains a living shelter casualty", () => {
		const health = createHealth();
		expect(BODY_PARTS.reduce((sum, part) => sum + health.parts[part].hp, 0)).toBe(440);
		expect(healthPercent(health)).toBe(100);
		expect(canDeploy(health)).toBe(true);
		expect(isAlive(createHealth(0))).toBe(true);
		expect(canDeploy(createHealth(0))).toBe(false);
	});

	test("zero in either vital zone is fatal even at high total health", () => {
		for (const part of ["head", "chest"] as const) {
			const health = createHealth();
			expect(applyHit(health, part, BODY_PART_MAX_HP[part]).dead).toBe(true);
			expect(isAlive(health)).toBe(false);
			expect(healthPercent(health)).toBeGreaterThan(70);
			const body = structuredClone(health);
			recoverAtBase(health, 9_000_000, 10);
			expect(health).toEqual(body);
		}
	});

	test("armour reduction is local and penetration preserves ammunition impact", () => {
		const armored = createHealth(), penetrating = createHealth(), leg = createHealth();
		expect(applyHit(armored, "chest", 40, { protection: .7, penetration: .1 }).absorbed).toBe(24);
		expect(armored.parts.chest.hp).toBe(69);
		applyHit(penetrating, "chest", 40, { protection: .7, penetration: .7 });
		expect(penetrating.parts.chest.hp).toBe(45);
		applyHit(leg, "leftLeg", 40);
		expect(leg.parts.leftLeg.hp).toBe(25);
		expect(leg.parts.chest.hp).toBe(85);
	});

	test("destroyed limb overflow and later hits spread once without new injury rolls", () => {
		const health = createHealth();
		const first = applyHit(health, "leftArm", 72, { bleeding: "heavy", fracture: true });
		expect(first.destroyed).toEqual(["leftArm"]);
		expect(health.parts.head.hp).toBe(33);
		expect(health.parts.rightLeg.hp).toBe(63);
		expect(health.parts.leftArm.bleeding).toBe("heavy");
		applyHit(health, "leftArm", 12, { bleeding: "heavy", fracture: true });
		expect(health.parts.head.hp).toBe(31);
		for (const part of BODY_PARTS.filter((part) => part !== "leftArm")) {
			expect(health.parts[part].bleeding).toBe("none");
			expect(health.parts[part].fracture).toBe(false);
		}
	});

	test("heavy bleeding replaces light and its long tick equals arbitrary splits", () => {
		const initial = createHealth();
		applyHit(initial, "leftLeg", 6, { bleeding: "light" });
		applyHit(initial, "leftLeg", 2, { bleeding: "heavy" });
		applyHit(initial, "leftLeg", 1, { bleeding: "light" });
		expect(initial.parts.leftLeg.bleeding).toBe("heavy");
		expect(isStable(initial)).toBe(false);
		const long = structuredClone(initial), split = structuredClone(initial);
		advanceBleeding(long, 250_000);
		for (const duration of [17, 1_982, 52_001, 55_000, 91_000, 50_000]) advanceBleeding(split, duration);
		expect(split).toEqual(long);
		expect(isAlive(long)).toBe(false);
		expect(long.parts.chest.hp).toBe(50);
	});

	test("cancelled or invalid treatment changes neither health nor medicine", () => {
		const health = createHealth(), medicine = createMedicalInventory();
		applyHit(health, "leftLeg", 20, { bleeding: "heavy" });
		const body = structuredClone(health), supplies = structuredClone(medicine);
		expect(canTreat(health, medicine, "tourniquet", "leftLeg").ok).toBe(true);
		// A cancelled action never calls completeTreatment.
		expect(health).toEqual(body);
		expect(medicine).toEqual(supplies);
		expect(completeTreatment(health, medicine, "bandage", "leftLeg").ok).toBe(false);
		expect(completeTreatment(health, medicine, "medkit", "leftLeg").ok).toBe(false);
		expect(health).toEqual(body);
		expect(medicine).toEqual(supplies);
	});

	test("medkit heals one living zone up to 40 HP and uses only delivered HP", () => {
		const health = createHealth(), medicine = createMedicalInventory({ medkit: 45 });
		applyHit(health, "chest", 50);
		expect(completeTreatment(health, medicine, "medkit", "chest").healed).toBe(40);
		expect(health.parts.chest.hp).toBe(75);
		expect(medicine.medkit).toBe(5);
		expect(completeTreatment(health, medicine, "medkit", "chest").healed).toBe(5);
		expect(health.parts.chest.hp).toBe(80);
		expect(medicine.medkit).toBe(0);
	});

	test("surgery requires blood stopped, leaves a scar and never compounds it", () => {
		const health = createHealth(), medicine = createMedicalInventory({ medkit: 160, tourniquet: 1, surgery: 2 });
		applyHit(health, "leftLeg", 65, { bleeding: "heavy", fracture: true });
		expect(completeTreatment(health, medicine, "surgery", "leftLeg").ok).toBe(false);
		expect(medicine.surgery).toBe(2);
		expect(selectTreatment(health, medicine)).toEqual({ type: "tourniquet", part: "leftLeg" });
		completeTreatment(health, medicine, "tourniquet", "leftLeg");
		completeTreatment(health, medicine, "surgery", "leftLeg");
		expect(health.parts.leftLeg).toEqual({ hp: 1, maxHp: 42.25, bleeding: "none", fracture: true });
		completeTreatment(health, medicine, "medkit", "leftLeg");
		applyHit(health, "leftLeg", 41);
		completeTreatment(health, medicine, "surgery", "leftLeg");
		expect(health.parts.leftLeg.maxHp).toBe(42.25);
		expect(healthPercent(health)).toBeLessThan(100);
		expect(completeTreatment(health, medicine, "surgery", "head").ok).toBe(false);
	});

	test("fractures and destroyed limbs use the strongest impairment; painkillers are temporary", () => {
		const health = createHealth(), medicine = createMedicalInventory();
		applyHit(health, "leftLeg", 10, { fracture: true });
		expect(injuryEffects(health, 1_000).movement).toBe(.55);
		expect(injuryEffects(health, 1_000).sprint).toBe(false);
		completeTreatment(health, medicine, "painkiller", "head", 1_000);
		expect(injuryEffects(health, 1_001).pain).toBe(false);
		expect(injuryEffects(health, 1_001).movement).toBe(.8);
		expect(health.parts.leftLeg.fracture).toBe(true);
		expect(injuryEffects(health, 91_000).pain).toBe(true);
		applyHit(health, "leftLeg", 55);
		expect(injuryEffects(health, 91_000).movement).toBe(.35);
		completeTreatment(health, medicine, "splint", "leftLeg", 91_000);
		expect(injuryEffects(health, 91_000).movement).toBe(.35);
	});

	test("shelter care is split-tick invariant and restores scars and fractures", () => {
		const initial = createHealth();
		applyHit(initial, "leftLeg", 65, { bleeding: "light", fracture: true });
		initial.parts.leftLeg.maxHp = 42.25;
		const long = structuredClone(initial), split = structuredClone(initial);
		recoverAtBase(long, 450_000, 1);
		for (const duration of [1, 999, 1_000, 10_000, 438_000]) recoverAtBase(split, duration, 1);
		expect(split).toEqual(long);
		expect(isStable(long)).toBe(true);
		expect(long.parts.leftLeg.maxHp).toBeGreaterThan(42.25);
		expect(canDeploy(long)).toBe(false);
		recoverAtBase(long, 4_000_000, 1);
		expect(long).toEqual(createHealth());
		expect(canDeploy(long)).toBe(true);
	});

	test("medical timings and strict parsers reject malformed save state", () => {
		expect(TREATMENT_DURATION_MS).toEqual({ bandage: 2_000, tourniquet: 4_000, medkit: 5_000, splint: 4_000, painkiller: 3_000, surgery: 15_000 });
		expect(parseHealth(createHealth())).toEqual(createHealth());
		expect(parseMedicalInventory(createMedicalInventory())).toEqual(createMedicalInventory());
		const malformed = createHealth();
		malformed.parts.head.hp = 36;
		expect(() => parseHealth(malformed)).toThrow();
		malformed.parts.head.hp = 35;
		malformed.parts.head.fracture = true;
		expect(() => parseHealth(malformed)).toThrow();
		expect(() => parseHealth({ ...createHealth(), extra: 1 })).toThrow();
		expect(() => parseMedicalInventory({ ...createMedicalInventory(), medkit: NaN })).toThrow();
		expect(() => parseMedicalInventory({ ...createMedicalInventory(), splint: .5 })).toThrow();
		expect(() => advanceBleeding(createHealth(), -1)).toThrow();
		expect(() => applyHit(createHealth(), "chest", -1)).toThrow();
	});

	test("the scheduler wakes on the exact restoration boundary, including impaired limbs", () => {
		for (const minPercent of [25, 70, 100]) {
			const health = createHealth(20);
			health.parts.leftLeg.fracture = true;
			const wait = getRecoveryWaitMs(health, minPercent, 2);
			const justBefore = structuredClone(health), ready = structuredClone(health);
			recoverAtBase(justBefore, wait - 1, 2);
			recoverAtBase(ready, wait, 2);
			expect(canDeploy(justBefore, minPercent)).toBe(false);
			expect(canDeploy(ready, minPercent)).toBe(true);
		}
		const dead = createHealth();
		dead.parts.head.hp = 0;
		expect(getRecoveryWaitMs(dead)).toBe(Infinity);
	});

	test("even a minor fracture persists until the limb fully recovers through elapsed care", () => {
		const health = createHealth();
		applyHit(health, "leftLeg", 1, { fracture: true });
		recoverAtBase(health, 0, 1);
		expect(health.parts.leftLeg.fracture).toBe(true);
		expect(canDeploy(health)).toBe(false);
		recoverAtBase(health, 1_000, 1);
		expect(health.parts.leftLeg.fracture).toBe(true);
		const remaining = getRecoveryWaitMs(health, 25, 1);
		expect(remaining).toBeGreaterThan(20_000);
		recoverAtBase(health, remaining - 1, 1);
		expect(health.parts.leftLeg.fracture).toBe(true);
		expect(health.parts.leftLeg.hp).toBeLessThan(65);
		recoverAtBase(health, 1, 1);
		expect(health.parts.leftLeg.hp).toBe(65);
		expect(health.parts.leftLeg.fracture).toBe(false);
		expect(canDeploy(health)).toBe(true);

		const fullButFractured = createHealth();
		fullButFractured.parts.rightArm.fracture = true;
		expect(getRecoveryWaitMs(fullButFractured)).toBe(1);
		recoverAtBase(fullButFractured, 0);
		expect(fullButFractured.parts.rightArm.fracture).toBe(true);
		recoverAtBase(fullButFractured, 1);
		expect(fullButFractured.parts.rightArm.fracture).toBe(false);
	});
});
