import { withoutMedical } from './legacy-health-fixture';
import { expect, test } from "bun:test";
import { withoutLoot } from "./legacy-loot-fixture";
import { advance, assignWorker, continueExpedition, createGame, dispatchRaid, FIELD_KITS, getAmmoEffect, getExpeditionChoices, healthPercent, resolveMedicalEncounter, getFieldKitStock, getResourceProductionQuote, getRoomProductionState, parseSave, queueFieldKitProduction, queueModuleProduction, saveGame, setAutoRaid, setFieldKit, setGameOutcomeSeedSource, setLoadoutOption, setRoomRecipe, setRoomStockTarget, TACTICS, upgradeRoom, type FieldKit, type GameState, type RoomInstance } from "../src/game/engine";
import { MAP_BY_ID } from "../src/game/data";

const NOW = 1_792_000_000_000;
function funded() {
	const state = createGame(NOW); state.money = 20_000; state.supplies = { ammo: 100, medicine: 10, scrap: 100, intel: 30 };
	return state;
}
const room = (state: GameState, type: RoomInstance["type"]) => state.shelter.rooms.find(item => item.type === type)!;
function finishBatch(state: GameState, current: RoomInstance) {
	const seconds = getRoomProductionState(state, current).remainingSeconds;
	expect(seconds).not.toBeNull(); advance(state, state.lastUpdated + Math.ceil(seconds! * 1000));
}
function kitFixture() {
	const state = funded();
	for (const kit of ["maintenance", "trauma"] as FieldKit[]) {
		const current = room(state, kit === "maintenance" ? "workshop" : "medbay");
		expect(queueFieldKitProduction(state, current.id, kit, state.lastUpdated).ok).toBe(true);
		expect(assignWorker(state, state.scavs[1]!.id, current.id, state.lastUpdated).ok).toBe(true);
		finishBatch(state, current);
		expect(assignWorker(state, state.scavs[1]!.id, null, state.lastUpdated).ok).toBe(true);
	}
	return state;
}

test("room upgrades unlock the actual room's alternatives, while another high-level room never grants access", () => {
	const state = funded(), medbay = room(state, "medbay");
	state.base.medbay = 5;
	expect(getResourceProductionQuote(state, medbay.id, "medicine-express").block).toBe("level");
	const before = saveGame(state);
	expect(setRoomRecipe(state, medbay.id, "medicine-express", false, NOW).ok).toBe(false);
	expect(saveGame(state)).toBe(before);
	expect(upgradeRoom(state, medbay.id, NOW).ok).toBe(true);
	advance(state, NOW + medbay.construction!.workRequired / 1000);
	expect(medbay.level).toBe(2);
	expect(assignWorker(state, state.scavs[1]!.id, medbay.id, state.lastUpdated).ok).toBe(true);
	expect(setRoomRecipe(state, medbay.id, "medicine-express", false, state.lastUpdated).ok).toBe(true);
	const job = medbay.queue[0]!;
	expect(job.workRequired).toBe(30_000_000);
	expect(job.paid).toEqual({ money: 30, supplies: { ammo: 2, medicine: 0, scrap: 1, intel: 0 } });
	expect(job.output.supplies.medicine).toBe(2);
});

test("an explicit kit order queues behind a paid weapon part, can wait for staffing and delivers just once", () => {
	const state = funded(), workshop = room(state, "workshop");
	expect(queueModuleProduction(state, workshop.id, "factory-sks-stock", NOW).ok).toBe(true);
	const paidPart = structuredClone(workshop.queue[0]!);
	const before = { money: state.money, scrap: state.supplies.scrap };
	expect(queueFieldKitProduction(state, workshop.id, "maintenance", NOW).ok).toBe(true);
	expect(state.money).toBe(before.money - 25); expect(state.supplies.scrap).toBe(before.scrap - 3);
	expect(workshop.queue).toHaveLength(2); expect(workshop.queue[0]).toEqual(paidPart);
	advance(state, NOW + 10_000);
	expect(workshop.queue[1]!.workDone).toBe(0);
	expect(assignWorker(state, state.scavs[1]!.id, workshop.id, state.lastUpdated).ok).toBe(true);
	finishBatch(state, workshop); finishBatch(state, workshop);
	expect(getFieldKitStock(state).maintenance).toBe(1);
	expect(workshop.queue).toHaveLength(0);
	advance(state, state.lastUpdated + 100_000);
	expect(getFieldKitStock(state).maintenance).toBe(1);
	expect(parseSave(saveGame(state))).toEqual(state);
});

test("a one-shot selected behind a different paid recipe remains pending and survives reload", () => {
	const state = funded(), medbay = room(state, "medbay");
	state.supplies.medicine = 0;
	expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
	expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, NOW).ok).toBe(true);
	expect(setRoomRecipe(state, medbay.id, "trauma-kit", false, NOW).ok).toBe(true);
	expect(medbay.pending).toBe(true);
	expect(parseSave(saveGame(state))).toEqual(state);
	finishBatch(state, medbay);
	expect(medbay.queue[0]!.output.fieldKit).toBe("trauma");
	finishBatch(state, medbay);
	expect(getFieldKitStock(state).trauma).toBe(1); expect(medbay.queue).toHaveLength(0);
});

test("reached targets remain planned waiting after the worker leaves for a sortie", () => {
	const state = funded(), medbay = room(state, "medbay");
	state.supplies.medicine = 0;
	expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
	expect(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW).ok).toBe(true);
	expect(setRoomStockTarget(state, medbay.id, 3, NOW).ok).toBe(true);
	finishBatch(state, medbay);
	expect(assignWorker(state, state.scavs[1]!.id, null, state.lastUpdated).ok).toBe(true);
	expect(getResourceProductionQuote(state, medbay.id, "medicine-batch").block).toBe("target");
	expect(medbay.queue).toHaveLength(0);
});

test("the support slot changes real wear and injury over multiple stages without rerolling the first checkpoint", () => {
	const initial = kitFixture();
	let secondStages = 0, reductions = 0;
	for (let seed = 1; seed <= 20; seed++) {
		const runs = ["none", "maintenance", "trauma"].map(kit => {
			const state = structuredClone(initial); state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
			const scav = state.scavs[0]!, weapon = state.weapons.find(item => item.id === scav.weaponInstanceId)!;
			expect(setFieldKit(state, scav.id, kit as "none" | FieldKit).ok).toBe(true);
			expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
			const raid = state.raids[0]!; advance(state, raid.endsAt);
			return { state, scav, weapon, raid };
		});
		const [base, maintenance, trauma] = runs;
		expect(maintenance!.raid.seed).toBe(base!.raid.seed); expect(trauma!.raid.seed).toBe(base!.raid.seed);
		expect(maintenance!.scav.health).toBe(base!.scav.health);
		expect(trauma!.weapon.durability).toBe(base!.weapon.durability);
		expect(maintenance!.weapon.durability).toBeGreaterThan(base!.weapon.durability);
		expect(trauma!.scav.health).toBeGreaterThanOrEqual(base!.scav.health);
		if (trauma!.scav.health > base!.scav.health) reductions++;
		if (base!.state.raids.length && runs.every(run => run.state.raids.length && getExpeditionChoices(run.state, run.raid, run.raid.expedition!.offers[0]).every(choice => !choice.reason))) {
			expect(maintenance!.raid.expedition!.cargo).toEqual(base!.raid.expedition!.cargo);
			expect(trauma!.raid.expedition!.cargo).toEqual(base!.raid.expedition!.cargo);
			for (const run of runs) {
				expect(continueExpedition(run.state, run.raid.id, "scavenge", run.raid.expedition!.offers[0]!, run.state.lastUpdated).ok).toBe(true);
				advance(run.state, run.raid.endsAt);
			}
			expect(maintenance!.weapon.durability).toBeGreaterThan(base!.weapon.durability);
			expect(trauma!.scav.health).toBeGreaterThanOrEqual(base!.scav.health);
			secondStages++;
		}
	}
	expect(secondStages).toBeGreaterThan(10); expect(reductions).toBeGreaterThan(10);
});

test("an automatic order waits for a newly produced kit after consuming its last one", () => {
	const state = kitFixture(), scav = state.scavs[0]!;
	state.rng = Math.imul(1, 0x9e3779b1) >>> 0;
	expect(setFieldKit(state, scav.id, "trauma").ok).toBe(true);
	expect(setLoadoutOption(state, scav.id, "medkit", true).ok).toBe(true);
	expect(setAutoRaid(state, scav.id, "courtyard", 25, state.lastUpdated).ok).toBe(true);
	expect(state.raids[0]!.fieldKit).toBe("trauma"); expect(getFieldKitStock(state).trauma).toBe(0);
	advance(state, state.raids[0]!.endsAt);
	expect(state.history[0]!.fieldKit).toBe("trauma"); expect(state.raids).toHaveLength(0);
	expect(scav.autoRaid.waitingReason).toContain(FIELD_KITS.trauma.label.toLowerCase());
	const medbay = room(state, "medbay");
	expect(assignWorker(state, state.scavs[1]!.id, medbay.id, state.lastUpdated).ok).toBe(true);
	expect(queueFieldKitProduction(state, medbay.id, "trauma", state.lastUpdated).ok).toBe(true);
	finishBatch(state, medbay);
	expect(state.raids[0]!.fieldKit).toBe("trauma"); expect(getFieldKitStock(state).trauma).toBe(0);
});

test("v13 ammunition and server outcome seeds migrate unchanged while shelter logistics remain exclusive to v14", () => {
	const state = funded(), workshop = room(state, "workshop"), scav = state.scavs[0]!;
	expect(queueModuleProduction(state, workshop.id, "factory-sks-stock", NOW).ok).toBe(true);
	expect(setLoadoutOption(state, scav.id, "ammoType", "expanding").ok).toBe(true);
	setGameOutcomeSeedSource(state, () => 123_456);
	expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
	withoutLoot(state);
	advance(state, NOW + 7_123);
	withoutMedical(state);
	const raw = JSON.parse(saveGame(state)); raw.schemaVersion = 13;
	const restored = parseSave(JSON.stringify(raw));
	expect(restored).not.toBeNull(); expect(restored).toEqual(state);
	expect(restored!.raids[0]!.outcomeSeed).toBe(123_456);
	expect(restored!.raids[0]!.expedition!.ammunition).toEqual(state.raids[0]!.expedition!.ammunition);
	expect(restored!.shelter.logistics).toBeUndefined();
	for (const injection of [
		(value: typeof raw) => { value.scavs[0].fieldKit = "maintenance"; },
		(value: typeof raw) => { value.raids[0].fieldKit = "trauma"; },
		(value: typeof raw) => { value.shelter.rooms[0].stockTarget = 1; },
		(value: typeof raw) => { value.shelter.logistics = { reserve: { money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 } }, kits: { maintenance: 1, trauma: 0 } }; },
	]) {
		const invalid = structuredClone(raw); injection(invalid); expect(parseSave(JSON.stringify(invalid))).toBeNull();
	}
	advance(state, state.raids[0]!.endsAt); advance(restored!, restored!.raids[0]!.endsAt);
	expect(restored).toEqual(state);
});

test("ammo ballistics and physical kits multiply together, retaining exact damage and wear through mid-raid reload", () => {
	const initial = kitFixture(), map = MAP_BY_ID.courtyard!;
	const random = (seed: number) => {
		let value = seed >>> 0 || 0x6d2b79f5;
		return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
	};
	for (const ammoType of ["standard", "piercing", "expanding", "precision"] as const) {
		for (const kit of ["maintenance", "trauma"] as const) {
			let checked = false;
			for (let seed = 1; seed <= 32 && !checked; seed++) {
				const state = structuredClone(initial), scav = state.scavs[0]!, weapon = state.weapons.find(item => item.id === scav.weaponInstanceId)!;
				expect(setLoadoutOption(state, scav.id, "ammoType", ammoType).ok).toBe(true);
				expect(setFieldKit(state, scav.id, kit).ok).toBe(true);
				setGameOutcomeSeedSource(state, () => seed);
				expect(dispatchRaid(state, scav.id, map.id, state.lastUpdated).ok).toBe(true);
				const raid = state.raids[0]!, roll = random((seed ^ Math.imul(1, 0x45d9f3b)) >>> 0);
				if (roll() >= raid.chance) continue;
				const expectedWear = Math.ceil((5 + roll() * (7 + map.danger * 8) + 2) * raid.expedition!.weaponMechanics!.wearMultiplier * raid.expedition!.ammunition!.wearMultiplier * FIELD_KITS[kit].wearMultiplier);
				const ammunition = getAmmoEffect(weapon, ammoType, map.id, "scavenge", 1, raid.tactic);
				expect(raid.expedition!.medical!.start.injuryMultiplier).toBeCloseTo(TACTICS[raid.tactic].injuryMultiplier * ammunition.injuryMultiplier * FIELD_KITS[kit].injuryMultiplier);
				const expectedMedical = resolveMedicalEncounter(raid.expedition!.medical!.start, seed, 1, map.danger, true, raid.endsAt);
				const restored = parseSave(saveGame(state)); expect(restored).not.toBeNull(); expect(restored).toEqual(state);
				advance(state, raid.endsAt); advance(restored!, restored!.raids[0]!.endsAt);
				expect(weapon.durability).toBe(100 - expectedWear); expect(scav.body).toEqual(expectedMedical.body); expect(scav.health).toBe(healthPercent(expectedMedical.body));
				expect(restored).toEqual(state);
				for (const [slot, part] of Object.entries(weapon.modules)) if (slot !== "receiver") expect(part.durability).toBeCloseTo(100 - 3 * FIELD_KITS[kit].wearMultiplier);
				checked = true;
			}
			expect(checked).toBe(true);
		}
	}
});
