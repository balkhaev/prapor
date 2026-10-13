import { BODY_PARTS, BODY_PART_LABELS, TREATMENT_LABELS, TREATMENT_DURATION_MS, advanceBleeding, applyHit, completeTreatment, createHealth, createMedicalInventory, healthPercent, injuryEffects, isAlive, isStable, selectTreatment, type BodyPart, type HealthState, type MedicalInventory } from './health';

/** A paid kit and the frozen medical inputs for the current stage. */
export interface RaidMedicalStart {
	body: HealthState;
	inventory: MedicalInventory;
	injuryMultiplier: number;
	armorProtection: number;
	helmetProtection: number;
}
export interface RaidMedicalState {
	version: 1;
	inventory: MedicalInventory;
	start: RaidMedicalStart;
}
export const RAID_MEDICAL_KIT = { medkit: 120, bandage: 2, tourniquet: 1, splint: 1, painkiller: 1, surgery: 1 } as const;
export function raidMedicalInventory(enabled: boolean): MedicalInventory { return createMedicalInventory(enabled ? RAID_MEDICAL_KIT : false); }

function randomFor(seed: number) {
	let value = seed >>> 0;
	return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

/** The same pure forecast drives squad rescues and the actual settlement. */
export function resolveMedicalEncounter(start: RaidMedicalStart, seed: number, stage: number, danger: number, success: boolean, now: number, rescued = false) {
	const body = structuredClone(start.body), inventory = structuredClone(start.inventory);
	const random = randomFor((seed ^ Math.imul(stage, 0x391a27b5)) >>> 0);
	const events: string[] = [];
	const zones: BodyPart[] = ['chest', 'chest', 'chest', 'stomach', 'stomach', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
	const shots = success ? 1 + (random() < danger ? 1 : 0) : 3 + (random() < danger ? 1 : 0);
	for (let index = 0; index < shots && isAlive(body); index++) {
		// Deep failed contacts can include an aimed ambush; ordinary fire never rolls a headshot.
		const part: BodyPart = !success && stage >= 2 && index === 0 && random() < danger * .08 ? 'head' : zones[Math.floor(random() * zones.length)]!;
		const damage = (success ? 12 + stage * 3 + random() * 12 : 30 + stage * 6 + random() * 24) * start.injuryMultiplier;
		const protection = part === 'head' ? start.helmetProtection : part === 'chest' || part === 'stomach' ? start.armorProtection : 0;
		const penetration = Math.min(.8, .12 + danger * .35 + stage * .04);
		const bleeding = random() < (success ? .18 : .48) ? (random() < .25 + danger * .3 ? 'heavy' : 'light') : undefined;
		const fracture = (part.includes('Arm') || part.includes('Leg')) && random() < (success ? .06 : .23);
		if (rescued) {
			// Cover interrupts the otherwise fatal contact before its damage applies.
			const trial = structuredClone(body); applyHit(trial, part, damage, { protection, penetration, bleeding, fracture });
			if (!isAlive(trial)) { events.push('Товарищ прикрыл отход до смертельного попадания.'); break; }
		}
		const hit = applyHit(body, part, damage, { protection, penetration, bleeding, fracture });
		events.push(`${BODY_PART_LABELS[part]}: −${Math.ceil(hit.damage)} HP${hit.absorbed > 0 ? `; броня остановила ${Math.ceil(hit.absorbed)}` : ''}${body.parts[part].bleeding !== 'none' ? `; ${body.parts[part].bleeding === 'heavy' ? 'тяжёлое' : 'лёгкое'} кровотечение` : ''}${body.parts[part].fracture ? '; перелом' : ''}${body.parts[part].hp <= 0 ? '; зона выбита' : ''}.`);
	}
	if (rescued) for (const part of BODY_PARTS) body.parts[part].bleeding = 'none';
	let medicalMs = 0;
	// Treatment happens inside the simulated stage, never during a real-world choice wait.
	for (let count = 0; count < 24 && isAlive(body); count++) {
		const treatment = selectTreatment(body, inventory, now + medicalMs);
		if (!treatment) break;
		const duration = Math.ceil(TREATMENT_DURATION_MS[treatment.type] * injuryEffects(body, now + medicalMs).treatment);
		advanceBleeding(body, duration);
		medicalMs += duration;
		if (!isAlive(body)) break;
		const result = completeTreatment(body, inventory, treatment.type, treatment.part, now + medicalMs);
		if (!result.ok) break;
		events.push(`${TREATMENT_LABELS[treatment.type]} → ${BODY_PART_LABELS[treatment.part]}${result.healed ? `: +${Math.ceil(result.healed)} HP` : ''}.`);
	}
	if (rescued && isAlive(body)) {
		// Rescue is a withdrawal before death, not resurrection or an extra death roll.
		for (const part of BODY_PARTS) body.parts[part].bleeding = 'none';
		const ratio = Math.min(1, 23 / Math.max(1, healthPercent(body)));
		for (const part of BODY_PARTS) body.parts[part].hp = Math.max(part === 'head' || part === 'chest' ? 1 : 0, body.parts[part].hp * ratio);
	}
	if (!isStable(body) && isAlive(body)) events.push('Кровотечение не остановлено: дальнейший путь запрещён, требуется отход.');
	return { body, inventory, events, medicalMs, dead: !isAlive(body), stable: isStable(body) };
}

/** Old living zero-HP survivors never become casualties during migration. */
export function legacyBody(percent: number): HealthState { return createHealth(percent); }
