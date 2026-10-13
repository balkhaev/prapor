/** Shared, mutable health rules. Callers own clocks, hit rolls and treatment cancellation. */
export const BODY_PARTS = ["head", "chest", "stomach", "leftArm", "rightArm", "leftLeg", "rightLeg"] as const;
export type BodyPart = typeof BODY_PARTS[number];
export type Bleeding = "none" | "light" | "heavy";
export interface PartHealth { hp: number; maxHp: number; bleeding: Bleeding; fracture: boolean }
export interface HealthState { parts: Record<BodyPart, PartHealth>; painUntil: number }
export interface MedicalInventory { medkit: number; bandage: number; tourniquet: number; splint: number; painkiller: number; surgery: number }
export type TreatmentType = keyof MedicalInventory;
export interface TreatmentChoice { type: TreatmentType; part: BodyPart }
export interface TreatmentResult { ok: boolean; reason: string; healed: number }
export interface HitOptions { protection?: number; penetration?: number; bleeding?: Exclude<Bleeding, "none">; fracture?: boolean }
export interface HitResult { damage: number; absorbed: number; destroyed: BodyPart[]; dead: boolean }
export interface InjuryEffects { movement: number; aim: number; reload: number; stamina: number; treatment: number; sprint: boolean; pain: boolean }

export const BODY_PART_MAX_HP: Record<BodyPart, number> = { head: 35, chest: 85, stomach: 70, leftArm: 60, rightArm: 60, leftLeg: 65, rightLeg: 65 };
export const BODY_PART_LABELS: Record<BodyPart, string> = { head: "Голова", chest: "Грудь", stomach: "Живот", leftArm: "Левая рука", rightArm: "Правая рука", leftLeg: "Левая нога", rightLeg: "Правая нога" };
export const TOTAL_HEALTH = 440;
export const TREATMENT_DURATION_MS: Record<TreatmentType, number> = { bandage: 2_000, tourniquet: 4_000, medkit: 5_000, splint: 4_000, painkiller: 3_000, surgery: 15_000 };
export const TREATMENT_LABELS: Record<TreatmentType, string> = { medkit: "Аптечка", bandage: "Бинт", tourniquet: "Жгут", splint: "Шина", painkiller: "Обезболивающее", surgery: "Хирургический набор" };
export const TREATMENT_TYPES = ["medkit", "bandage", "tourniquet", "splint", "painkiller", "surgery"] as const;
const MICROS = 1_000_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const micros = (value: number) => Math.round(value * MICROS);
const isLimb = (part: BodyPart) => part === "leftArm" || part === "rightArm" || part === "leftLeg" || part === "rightLeg";
const isVital = (part: BodyPart) => part === "head" || part === "chest";
const fail = (reason: string): TreatmentResult => ({ ok: false, reason, healed: 0 });

export function isBodyPart(value: unknown): value is BodyPart { return typeof value === "string" && (BODY_PARTS as readonly string[]).includes(value); }
export function isTreatmentType(value: unknown): value is TreatmentType { return typeof value === "string" && (TREATMENT_TYPES as readonly string[]).includes(value); }

/** Legacy shelter HP=0 represented a living casualty; never kill one during migration. */
export function createHealth(percent = 100): HealthState {
	if (!Number.isFinite(percent)) throw new Error("health-percent");
	const ratio = clamp(percent, 0, 100) / 100;
	const parts = {} as HealthState["parts"];
	for (const part of BODY_PARTS) parts[part] = { hp: Math.max(isVital(part) ? 1 : 0, micros(BODY_PART_MAX_HP[part] * ratio) / MICROS), maxHp: BODY_PART_MAX_HP[part], bleeding: "none", fracture: false };
	return { parts, painUntil: 0 };
}

export function createMedicalInventory(loadout: boolean | Partial<MedicalInventory> = true): MedicalInventory {
	const empty: MedicalInventory = { medkit: 0, bandage: 0, tourniquet: 0, splint: 0, painkiller: 0, surgery: 0 };
	if (typeof loadout === "boolean") return loadout ? { medkit: 120, bandage: 2, tourniquet: 1, splint: 1, painkiller: 1, surgery: 1 } : empty;
	return parseMedicalInventory({ ...empty, ...loadout });
}

export function healthPercent(health: HealthState): number { return BODY_PARTS.reduce((sum, part) => sum + micros(health.parts[part].hp), 0) / MICROS / TOTAL_HEALTH * 100; }
export function isAlive(health: HealthState): boolean { return health.parts.head.hp > 0 && health.parts.chest.hp > 0; }
export function isStable(health: HealthState): boolean { return isAlive(health) && BODY_PARTS.every((part) => health.parts[part].bleeding === "none"); }
export function canDeploy(health: HealthState, minPercent = 25): boolean {
	return Number.isFinite(minPercent) && isStable(health) && healthPercent(health) + 1e-8 >= minPercent
		&& BODY_PARTS.every((part) => !health.parts[part].fracture && health.parts[part].hp >= BODY_PART_MAX_HP[part] * .25);
}

export function injuryEffects(health: HealthState, now = 0): InjuryEffects {
	const suppressPain = health.painUntil > now;
	const pain = BODY_PARTS.some((part) => health.parts[part].fracture || health.parts[part].hp < health.parts[part].maxHp * .5) && !suppressPain;
	const limbEffect = (part: BodyPart): number => {
		const state = health.parts[part];
		if (state.hp === 0) return .35;
		if (state.fracture) return suppressPain ? .8 : .55;
		return state.hp < state.maxHp * .25 ? .8 : 1;
	};
	const legs = Math.min(limbEffect("leftLeg"), limbEffect("rightLeg"));
	const arms = Math.min(limbEffect("leftArm"), limbEffect("rightArm"));
	const stomach = health.parts.stomach.hp === 0 ? .35 : health.parts.stomach.hp < health.parts.stomach.maxHp * .3 ? .7 : 1;
	return { movement: legs, aim: Math.min(arms, pain ? .85 : 1), reload: arms, stamina: stomach, treatment: 1 / Math.max(.35, arms), sprint: legs >= .8 && health.parts.leftLeg.hp > 0 && health.parts.rightLeg.hp > 0, pain };
}

/** Equal overflow shares drain living zones once. They never roll additional injuries. */
function spreadDamage(health: HealthState, damage: number): void {
	let remaining = damage;
	while (remaining > 0) {
		const living = BODY_PARTS.filter((part) => health.parts[part].hp > 0);
		if (!living.length) return;
		const share = Math.floor(remaining / living.length), remainder = remaining % living.length;
		let spent = 0;
		for (let index = 0; index < living.length; index++) {
			const state = health.parts[living[index]!];
			const taken = Math.min(micros(state.hp), share + (index < remainder ? 1 : 0));
			state.hp = (micros(state.hp) - taken) / MICROS;
			spent += taken;
		}
		if (!spent) return;
		remaining -= spent;
	}
}

export function applyHit(health: HealthState, part: BodyPart, damage: number, options: HitOptions = {}): HitResult {
	if (!isBodyPart(part) || !Number.isFinite(damage) || damage < 0 || damage > 1_000_000) throw new Error("health-hit");
	for (const value of [options.protection, options.penetration]) if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) throw new Error("health-protection");
	if (options.bleeding !== undefined && options.bleeding !== "light" && options.bleeding !== "heavy" || options.fracture !== undefined && typeof options.fracture !== "boolean") throw new Error("health-hit-injury");
	if (!isAlive(health) || damage === 0) return { damage: 0, absorbed: 0, destroyed: [], dead: !isAlive(health) };
	const before = BODY_PARTS.filter((zone) => health.parts[zone].hp > 0);
	const original = micros(damage), amount = Math.round(original * (1 - clamp((options.protection ?? 0) - (options.penetration ?? 0), 0, .9)));
	const state = health.parts[part], targetedAlive = state.hp > 0;
	const local = Math.min(micros(state.hp), amount);
	state.hp = (micros(state.hp) - local) / MICROS;
	if (amount > local && !isVital(part)) spreadDamage(health, amount - local);
	if (targetedAlive && amount > 0) {
		if (options.bleeding === "heavy" || options.bleeding === "light" && state.bleeding === "none") state.bleeding = options.bleeding;
		if (options.fracture && isLimb(part)) state.fracture = true;
	}
	return { damage: amount / MICROS, absorbed: (original - amount) / MICROS, destroyed: before.filter((zone) => health.parts[zone].hp === 0), dead: !isAlive(health) };
}

/** Whole milliseconds and micro-HP give the same result for a long or split tick. */
export function advanceBleeding(health: HealthState, elapsedMs: number): number {
	if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) throw new Error("health-elapsed");
	if (!isAlive(health) || elapsedMs === 0) return 0;
	const rate = BODY_PARTS.reduce((total, part) => total + (health.parts[part].bleeding === "heavy" ? 250 : health.parts[part].bleeding === "light" ? 50 : 0), 0);
	if (!rate) return 0;
	const duration = Math.min(elapsedMs, Math.ceil(micros(health.parts.head.hp) / rate), Math.ceil(micros(health.parts.chest.hp) / rate));
	let lost = 0;
	for (const part of BODY_PARTS) {
		const state = health.parts[part], taken = Math.min(micros(state.hp), duration * rate);
		state.hp = (micros(state.hp) - taken) / MICROS;
		lost += taken;
	}
	return lost / MICROS;
}

export function stabilizeAtBase(health: HealthState): void {
	for (const part of BODY_PARTS) health.parts[part].bleeding = "none";
	health.painUntil = 0;
}

/** Shelter care also restores surgical loss and broken limbs, without resurrecting deaths. */
export function recoverAtBase(health: HealthState, elapsedMs: number, medbayLevel = 0): void {
	if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || !Number.isInteger(medbayLevel) || medbayLevel < 0 || medbayLevel > 100) throw new Error("health-recovery");
	if (!isAlive(health)) return;
	stabilizeAtBase(health);
	for (const part of BODY_PARTS) {
		const state = health.parts[part], base = BODY_PART_MAX_HP[part];
		const gain = Math.round(base * (40 + medbayLevel * 25) / 100) * elapsedMs;
		state.maxHp = Math.min(micros(base), micros(state.maxHp) + gain) / MICROS;
		state.hp = Math.min(micros(state.maxHp), micros(state.hp) + gain) / MICROS;
		if (elapsedMs > 0 && state.hp >= base) state.fracture = false;
	}
}

/** First millisecond when the same shelter kernel permits the next departure. */
export function getRecoveryWaitMs(health: HealthState, minPercent = 25, medbayLevel = 0): number {
	if (!isAlive(health) || !Number.isFinite(minPercent) || minPercent < 0 || minPercent > 100) return Infinity;
	if (!Number.isInteger(medbayLevel) || medbayLevel < 0 || medbayLevel > 100) throw new Error("health-recovery");
	const start = structuredClone(health);
	stabilizeAtBase(start);
	if (canDeploy(start, minPercent)) return 0;
	let high = Math.max(1, ...BODY_PARTS.map((part) => Math.ceil((micros(BODY_PART_MAX_HP[part]) - micros(start.parts[part].hp)) / Math.round(BODY_PART_MAX_HP[part] * (40 + medbayLevel * 25) / 100))));
	let low = 0;
	while (low < high) {
		const middle = Math.floor((low + high) / 2), candidate = structuredClone(start);
		recoverAtBase(candidate, middle, medbayLevel);
		if (canDeploy(candidate, minPercent)) high = middle;
		else low = middle + 1;
	}
	return low;
}

export function canTreat(health: HealthState, inventory: MedicalInventory, type: TreatmentType, part: BodyPart, now = 0): TreatmentResult {
	if (!isBodyPart(part) || !isTreatmentType(type) || !Number.isFinite(now) || now < 0) return fail("Некорректное лечение.");
	if (!isAlive(health)) return fail("Боец погиб.");
	if (inventory[type] <= 0) return fail(`Нет средства: ${TREATMENT_LABELS[type]}.`);
	const state = health.parts[part];
	if (type === "bandage" && state.bleeding !== "light") return fail("Бинт нужен при лёгком кровотечении.");
	if (type === "tourniquet" && state.bleeding !== "heavy") return fail("Жгут нужен при тяжёлом кровотечении.");
	if (type === "splint" && !state.fracture) return fail("На этой конечности нет перелома.");
	if (type === "medkit") {
		if (state.hp === 0) return fail("Выбитую зону сначала восстановите хирургическим набором.");
		if (state.hp >= state.maxHp) return fail("Эта зона уже восстановлена.");
		if (state.bleeding !== "none") return fail("Сначала остановите кровотечение.");
	}
	if (type === "surgery") {
		if (isVital(part)) return fail("Голову и грудь нельзя восстановить полевой хирургией.");
		if (state.hp > 0) return fail("Хирургия нужна только для выбитой зоны.");
		if (state.bleeding !== "none") return fail("Перед хирургией остановите кровотечение.");
	}
	if (type === "painkiller") {
		if (health.painUntil > now) return fail("Обезболивающее ещё действует.");
		if (!injuryEffects(health, now).pain) return fail("Боли нет.");
	}
	return { ok: true, reason: "Можно лечить.", healed: 0 };
}

/** The adapter calls this only after the uninterrupted treatment timer completes. */
export function completeTreatment(health: HealthState, inventory: MedicalInventory, type: TreatmentType, part: BodyPart, now = 0): TreatmentResult {
	const check = canTreat(health, inventory, type, part, now);
	if (!check.ok) return check;
	const state = health.parts[part];
	let healed = 0;
	if (type === "medkit") {
		healed = Math.min(40 * MICROS, micros(inventory.medkit), micros(state.maxHp) - micros(state.hp)) / MICROS;
		state.hp = (micros(state.hp) + micros(healed)) / MICROS;
		inventory.medkit = (micros(inventory.medkit) - micros(healed)) / MICROS;
	} else {
		inventory[type]--;
		if (type === "bandage" || type === "tourniquet") state.bleeding = "none";
		if (type === "splint") state.fracture = false;
		if (type === "painkiller") health.painUntil = now + 90_000;
		if (type === "surgery") { state.maxHp = Math.min(state.maxHp, BODY_PART_MAX_HP[part] * .65); state.hp = 1; healed = 1; }
	}
	return { ok: true, reason: `${TREATMENT_LABELS[type]}: ${BODY_PART_LABELS[part].toLowerCase()}.`, healed };
}

/** Automatic care always stops blood loss before restoring vital health and movement. */
export function selectTreatment(health: HealthState, inventory: MedicalInventory, now = 0): TreatmentChoice | null {
	if (!isAlive(health)) return null;
	for (const type of ["tourniquet", "bandage"] as const) for (const part of BODY_PARTS) if (canTreat(health, inventory, type, part, now).ok) return { type, part };
	for (const part of ["head", "chest"] as const) if (health.parts[part].hp < health.parts[part].maxHp * .6 && canTreat(health, inventory, "medkit", part, now).ok) return { type: "medkit", part };
	for (const part of ["leftLeg", "rightLeg", "leftArm", "rightArm", "stomach"] as const) for (const type of ["surgery", "splint"] as const) if (canTreat(health, inventory, type, part, now).ok) return { type, part };
	for (const part of BODY_PARTS) if (canTreat(health, inventory, "medkit", part, now).ok) return { type: "medkit", part };
	if (canTreat(health, inventory, "painkiller", "head", now).ok) return { type: "painkiller", part: "head" };
	return null;
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("health-object");
	const source = value as Record<string, unknown>;
	if (Object.keys(source).length !== keys.length || keys.some((key) => !Object.hasOwn(source, key))) throw new Error("health-fields");
	return source;
}
function number(value: unknown, max: number, integer = false): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || integer && !Number.isSafeInteger(value)) throw new Error("health-number");
	return value;
}

export function parseHealth(value: unknown): HealthState {
	const source = object(value, ["parts", "painUntil"]), sourceParts = object(source.parts, BODY_PARTS);
	const parts = {} as HealthState["parts"];
	for (const part of BODY_PARTS) {
		const state = object(sourceParts[part], ["hp", "maxHp", "bleeding", "fracture"]);
		const maxHp = number(state.maxHp, BODY_PART_MAX_HP[part]);
		if (maxHp < BODY_PART_MAX_HP[part] * .65 || isVital(part) && maxHp !== BODY_PART_MAX_HP[part]) throw new Error("health-maximum");
		if (state.bleeding !== "none" && state.bleeding !== "light" && state.bleeding !== "heavy") throw new Error("health-bleeding");
		if (typeof state.fracture !== "boolean" || state.fracture && !isLimb(part)) throw new Error("health-fracture");
		parts[part] = { hp: number(state.hp, maxHp), maxHp, bleeding: state.bleeding, fracture: state.fracture };
	}
	return { parts, painUntil: number(source.painUntil, Number.MAX_SAFE_INTEGER, true) };
}

export function parseMedicalInventory(value: unknown): MedicalInventory {
	const source = object(value, TREATMENT_TYPES), result = {} as MedicalInventory;
	for (const type of TREATMENT_TYPES) result[type] = number(source[type], type === "medkit" ? 10_000 : 100, type !== "medkit");
	return result;
}
