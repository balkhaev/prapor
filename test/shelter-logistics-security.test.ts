import { describe, expect, test } from "bun:test";
import {
	advance, assignWorker, buildRoom, cancelProduction, continueExpedition, createGame,
	dispatchRaid, dispatchSquadRaid, extractRaid, getFieldKitStock,
	getProductionReserve, getRoomProductionState, getRoomUpgradeQuote, getSquadRaidQuote,
	parseSave, queueFieldKitProduction, queueModuleProduction, saveGame, setFieldKit, setProductionReserve,
	setRoomRecipe, setRoomStockTarget, upgradeRoom, type ActionResult, type GameState,
	type RoomInstance, type ShelterCost,
} from "../src/game/engine";
import { withoutArsenalLoot } from "./legacy-strategy-fixture";

const NOW = 1_792_000_000_000;
const requireAction = (result: ActionResult) => expect(result.ok, result.message).toBe(true);
const cost = (money = 0, changes: Partial<ShelterCost["supplies"]> = {}): ShelterCost =>
	({ money, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0, ...changes } });
function funded(seed = 1): GameState {
	const state = createGame(NOW);
	state.rng = Math.imul(seed, 0x9e3779b1) >>> 0 || 1;
	state.money = 20_000;
	state.supplies = { ammo: 100, medicine: 0, scrap: 100, intel: 30 };
	return state;
}
function room(state: GameState, type: RoomInstance["type"]) {
	return state.shelter.rooms.find((item) => item.type === type)!;
}
function restore(state: GameState): GameState {
	const restored = parseSave(saveGame(state));
	expect(restored).not.toBeNull();
	return restored!;
}
function finishBatch(state: GameState, productionRoom: RoomInstance) {
	const remaining = getRoomProductionState(state, productionRoom).remainingSeconds;
	expect(remaining).not.toBeNull();
	advance(state, state.lastUpdated + Math.ceil(remaining! * 1000));
}
function manufacture(state: GameState, kit: "maintenance" | "trauma", count = 1) {
	const productionRoom = room(state, kit === "maintenance" ? "workshop" : "medbay"), worker = state.scavs[1]!;
	state.supplies.medicine = Math.max(state.supplies.medicine, count);
	requireAction(assignWorker(state, worker.id, productionRoom.id, state.lastUpdated));
	for (let index = 0; index < count; index++) {
		requireAction(setRoomRecipe(state, productionRoom.id, `${kit}-kit`, false, state.lastUpdated));
		finishBatch(state, productionRoom);
	}
	requireAction(assignWorker(state, worker.id, null, state.lastUpdated));
	expect(getFieldKitStock(state)[kit]).toBe(count);
}
function advanceIrregularly(state: GameState, until: number) {
	const steps = [41, 719, 5_991, 2_301, 11_003];
	for (let index = 0; state.lastUpdated < until; index++)
		advance(state, Math.min(until, state.lastUpdated + steps[index % steps.length]!));
}

describe("shelter logistics boundaries and paid event ownership", () => {
	test("invalid floors, stock targets and field kit names reject without spending or changing orders", () => {
		const state = funded(), medbay = room(state, "medbay");
		for (const invalid of [cost(-1), cost(1.5), cost(1_000_000_001), cost(0, { ammo: -1 }), cost(0, { medicine: 0.5 }), cost(0, { scrap: 1_000_001 }), cost(Number.NaN), { ...cost(), extra: true }]) {
			const before = saveGame(state);
			expect(setProductionReserve(state, invalid, NOW).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		requireAction(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW));
		for (const invalid of [-1, .5, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
			const before = saveGame(state);
			expect(setRoomStockTarget(state, medbay.id, invalid, NOW).ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		for (const invalid of ["toString", "__proto__", "free"] as const) {
			const before = saveGame(state);
			expect(setFieldKit(state, state.scavs[0]!.id, invalid as "none").ok).toBe(false);
			expect(saveGame(state)).toBe(before);
		}
		const before = saveGame(state);
		expect(setRoomStockTarget(state, "missing", 3, NOW).ok).toBe(false);
		expect(setFieldKit(state, "missing", "maintenance").ok).toBe(false);
		expect(saveGame(state)).toBe(before);
	});

	test("floors protect new production only, while an already paid batch finishes and raid fees remain spendable", () => {
		const state = funded(), medbay = room(state, "medbay"), workshop = room(state, "workshop");
		requireAction(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW));
		requireAction(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW));
		const paidJob = structuredClone(medbay.queue[0]!);
		requireAction(setProductionReserve(state, cost(state.money, { ammo: state.supplies.ammo, scrap: state.supplies.scrap }), NOW));
		const before = saveGame(state);
		expect(queueModuleProduction(state, workshop.id, "factory-sks-stock", NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		finishBatch(state, medbay);
		expect(state.supplies.medicine).toBe(paidJob.output.supplies.medicine);
		expect(medbay.cycles).toBe(1);
		expect(medbay.queue).toHaveLength(0);
		const beforeRaid = { money: state.money, ammo: state.supplies.ammo };
		requireAction(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated));
		expect(state.money).toBeLessThan(beforeRaid.money);
		expect(state.supplies.ammo).toBeLessThan(beforeRaid.ammo);
		expect(restore(state)).toEqual(state);
	});

	test("all alternate recipes require the actual room's second level, including imported paid jobs", () => {
		for (const [type, recipeId] of [["ammo", "ammo-careful"], ["recycler", "scrap-precise"], ["medbay", "medicine-express"], ["radio", "intel-analysis"]] as const) {
			const state = funded();
			if (!state.shelter.rooms.some((item) => item.type === type)) {
				requireAction(buildRoom(state, type, 0, 1, state.lastUpdated));
				const construction = room(state, type).construction!;
				advance(state, state.lastUpdated + construction.workRequired / 1000);
			}
			const productionRoom = room(state, type);
			requireAction(assignWorker(state, state.scavs[1]!.id, productionRoom.id, state.lastUpdated));
			const locked = saveGame(state);
			expect(setRoomRecipe(state, productionRoom.id, recipeId, false, state.lastUpdated).ok).toBe(false);
			expect(saveGame(state)).toBe(locked);
			const upgrade = getRoomUpgradeQuote(state, productionRoom.id);
			requireAction(upgradeRoom(state, productionRoom.id, state.lastUpdated));
			advance(state, state.lastUpdated + upgrade.duration * 1000);
			state.supplies = { ammo: 24, medicine: 0, scrap: 20, intel: 5 };
			requireAction(setRoomRecipe(state, productionRoom.id, recipeId, false, state.lastUpdated));
			expect(productionRoom.queue[0]!.recipeId).toBe(recipeId);
			expect(restore(state)).toEqual(state);
			const raw = JSON.parse(saveGame(state));
			raw.shelter.rooms.find((item: any) => item.id === productionRoom.id).level = 1;
			expect(parseSave(JSON.stringify(raw))).toBeNull();
		}
	});

	test("a reserve below actual stock constrains only inputs that the chosen recipe consumes", () => {
		const state = funded(), medbay = room(state, "medbay");
		requireAction(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW));
		requireAction(setProductionReserve(state, cost(0, { ammo: 1_000, medicine: 50, scrap: 99 }), NOW));
		requireAction(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW));
		expect(medbay.queue).toHaveLength(0);
		expect(state.supplies.scrap).toBe(100);
		requireAction(setProductionReserve(state, cost(0, { ammo: 1_000, medicine: 50, scrap: 98 }), NOW));
		expect(medbay.queue).toHaveLength(1);
		expect(state.supplies.scrap).toBe(98);
		expect(getProductionReserve(state)).toEqual(cost(0, { ammo: 1_000, medicine: 50, scrap: 98 }));
	});

	test("repeat targets never buy a partial batch and resume after stock is spent", () => {
		const state = funded(), medbay = room(state, "medbay");
		requireAction(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW));
		requireAction(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW));
		requireAction(setRoomStockTarget(state, medbay.id, 4, NOW));
		finishBatch(state, medbay);
		expect(state.supplies.medicine).toBe(3);
		expect(medbay.cycles).toBe(1);
		expect(medbay.queue).toHaveLength(0);
		const pausedMoney = state.money, pausedScrap = state.supplies.scrap;
		advance(state, state.lastUpdated + 60_000);
		expect(state.money).toBe(pausedMoney);
		expect(state.supplies.scrap).toBeGreaterThanOrEqual(pausedScrap);
		expect(medbay.queue).toHaveLength(0);
		state.supplies.medicine -= 2;
		advance(state, state.lastUpdated + 1);
		expect(medbay.queue).toHaveLength(1);
		finishBatch(state, medbay);
		expect(state.supplies.medicine).toBe(4);
		expect(medbay.cycles).toBe(2);
		expect(medbay.queue).toHaveLength(0);
		expect(restore(state)).toEqual(state);
	});

	test("one-off field kit orders share the paid workshop queue, respect reserves and wait for personnel", () => {
		const state = funded(), workshop = room(state, "workshop"), medbay = room(state, "medbay");
		const original = { money: state.money, scrap: state.supplies.scrap };
		requireAction(queueModuleProduction(state, workshop.id, "factory-sks-stock", NOW));
		requireAction(queueFieldKitProduction(state, workshop.id, "maintenance", NOW));
		expect(workshop.queue.map((job) => job.kind)).toEqual(["module", "resource"]);
		const kitOrder = workshop.queue[1]!, afterOrder = { money: state.money, scrap: state.supplies.scrap };
		expect(kitOrder.paid).toEqual(cost(25, { scrap: 3 }));
		expect(getFieldKitStock(state).maintenance).toBe(0);
		const beforeInvalid = saveGame(state);
		expect(queueFieldKitProduction(state, medbay.id, "maintenance", NOW).ok).toBe(false);
		expect(queueFieldKitProduction(state, workshop.id, "toString" as "maintenance", NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(beforeInvalid);
		requireAction(setProductionReserve(state, cost(state.money, { scrap: state.supplies.scrap }), NOW));
		const beforeReserve = saveGame(state);
		expect(queueFieldKitProduction(state, workshop.id, "maintenance", NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(beforeReserve);
		advance(state, NOW + 20_000);
		expect(workshop.queue.every((job) => job.workDone === 0)).toBe(true);
		expect(state.money).toBe(afterOrder.money);
		requireAction(cancelProduction(state, workshop.id, kitOrder.id, state.lastUpdated));
		expect(state.money).toBe(afterOrder.money + 25);
		expect(state.supplies.scrap).toBe(afterOrder.scrap + 3);
		expect(state.money).toBeLessThan(original.money);
		expect(state.supplies.scrap).toBeLessThan(original.scrap);
		const refunded = saveGame(state);
		expect(cancelProduction(state, workshop.id, kitOrder.id, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(refunded);
		expect(restore(state)).toEqual(state);
	});

	test("lowering a target cannot cancel paid output; changing the recipe clears its old target", () => {
		const state = funded(), medbay = room(state, "medbay");
		requireAction(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW));
		requireAction(setRoomRecipe(state, medbay.id, "medicine-batch", true, NOW));
		requireAction(setRoomStockTarget(state, medbay.id, 0, NOW));
		finishBatch(state, medbay);
		expect(state.supplies.medicine).toBe(3);
		expect(medbay.queue).toHaveLength(0);
		requireAction(setRoomRecipe(state, medbay.id, "trauma-kit", true, state.lastUpdated));
		expect(medbay.stockTarget).toBeUndefined();
		expect(medbay.queue[0]!.recipeId).toBe("trauma-kit");
		expect(restore(state)).toEqual(state);
	});

	test("kit production caps stock, reserves inputs once and cannot replay cancellation refunds", () => {
		const state = funded(), workshop = room(state, "workshop");
		requireAction(assignWorker(state, state.scavs[1]!.id, workshop.id, NOW));
		const original = { money: state.money, scrap: state.supplies.scrap };
		requireAction(setRoomRecipe(state, workshop.id, "maintenance-kit", false, NOW));
		expect(state.money).toBe(original.money - 25);
		expect(state.supplies.scrap).toBe(original.scrap - 3);
		const jobId = workshop.queue[0]!.id;
		requireAction(cancelProduction(state, workshop.id, jobId, NOW));
		expect(state.money).toBe(original.money);
		expect(state.supplies.scrap).toBe(original.scrap);
		expect(getFieldKitStock(state).maintenance).toBe(0);
		const refunded = saveGame(state);
		expect(cancelProduction(state, workshop.id, jobId, NOW).ok).toBe(false);
		expect(saveGame(state)).toBe(refunded);
		requireAction(setRoomRecipe(state, workshop.id, "maintenance-kit", true, NOW));
		advance(state, NOW + 12 * 60_000);
		expect(getFieldKitStock(state).maintenance).toBe(8);
		expect(workshop.cycles).toBe(8);
		expect(workshop.queue).toHaveLength(0);
		const paid = state.money;
		advance(state, state.lastUpdated + 60_000);
		expect(state.money).toBe(paid);
		expect(getFieldKitStock(state).maintenance).toBe(8);
		expect(restore(state)).toEqual(state);
	});

	test("a squad with too few field kits cannot partially depart or consume its one remaining kit", () => {
		const state = funded(); manufacture(state, "maintenance");
		const ids = state.scavs.slice(0, 2).map((scav) => scav.id);
		for (const id of ids) requireAction(setFieldKit(state, id, "maintenance"));
		expect(getSquadRaidQuote(state, ids, "courtyard").reason).not.toBeNull();
		const before = saveGame(state);
		expect(dispatchSquadRaid(state, ids, "courtyard", state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(before);
		expect(getFieldKitStock(state).maintenance).toBe(1);
		requireAction(setFieldKit(state, ids[1]!, "none"));
		requireAction(dispatchSquadRaid(state, ids, "courtyard", state.lastUpdated));
		expect(state.raids).toHaveLength(2);
		expect(getFieldKitStock(state).maintenance).toBe(0);
		expect(state.raids[0]!.fieldKit).toBe("maintenance");
		expect(state.raids[1]!.fieldKit).toBeUndefined();
		expect(restore(state)).toEqual(state);
	});

	test("the kit is consumed at departure once; editing the future order never changes the active snapshot", () => {
		let played = false;
		for (let seed = 1; seed <= 64 && !played; seed++) {
			const state = funded(seed); manufacture(state, "maintenance");
			const scav = state.scavs[0]!;
			requireAction(setFieldKit(state, scav.id, "maintenance"));
			requireAction(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated));
			const raid = state.raids[0]!;
			expect(getFieldKitStock(state).maintenance).toBe(0);
			const paid = saveGame(state);
			expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(false);
			expect(saveGame(state)).toBe(paid);
			requireAction(setFieldKit(state, scav.id, "trauma"));
			expect(raid.fieldKit).toBe("maintenance");
			expect(restore(state).raids[0]!.fieldKit).toBe("maintenance");
			advance(state, raid.endsAt);
			if (!state.raids.length) continue;
			requireAction(continueExpedition(state, raid.id, "scavenge", raid.expedition!.offers[0]!, state.lastUpdated));
			expect(getFieldKitStock(state).maintenance).toBe(0);
			advance(state, raid.endsAt);
			if (state.raids.length) requireAction(extractRaid(state, raid.id, state.lastUpdated));
			expect(state.history[0]!.fieldKit).toBe("maintenance");
			expect(restore(state)).toEqual(state);
			const reportId = state.history[0]!.id;
			const reloaded = restore(state); advance(reloaded, reloaded.lastUpdated + 60_000);
			expect(reloaded.history[0]!.id).toBe(reportId);
			expect(getFieldKitStock(reloaded).maintenance).toBe(0);
			played = true;
		}
		expect(played).toBe(true);
	});

	test("mixed reserve-limited production and a paid field kit raid settle identically across restored clocks", () => {
		const whole = funded(19); manufacture(whole, "trauma");
		const medbay = room(whole, "medbay"), scav = whole.scavs[0]!;
		requireAction(assignWorker(whole, whole.scavs[1]!.id, medbay.id, whole.lastUpdated));
		requireAction(setProductionReserve(whole, cost(19_850, { scrap: 95 }), whole.lastUpdated));
		requireAction(setRoomRecipe(whole, medbay.id, "medicine-batch", true, whole.lastUpdated));
		requireAction(setRoomStockTarget(whole, medbay.id, 5, whole.lastUpdated));
		requireAction(setFieldKit(whole, scav.id, "trauma"));
		requireAction(dispatchRaid(whole, scav.id, "courtyard", whole.lastUpdated));
		let irregular = restore(whole);
		const checkpointAt = whole.raids[0]!.endsAt;
		advance(whole, checkpointAt); advanceIrregularly(irregular, checkpointAt);
		expect(irregular).toEqual(whole);
		for (const current of [whole, irregular]) if (current.raids.length)
			requireAction(extractRaid(current, current.raids[0]!.id, current.lastUpdated));
		irregular = restore(irregular);
		const until = whole.lastUpdated + 6 * 60_000;
		advance(whole, until); advanceIrregularly(irregular, until);
		expect(irregular).toEqual(whole);
		expect(restore(whole)).toEqual(whole);
	});

	test("imports reject invented reserves, stock, recipe outputs and field kit effects", () => {
		const state = funded(), workshop = room(state, "workshop");
		requireAction(setProductionReserve(state, cost(100, { ammo: 12 }), NOW));
		requireAction(assignWorker(state, state.scavs[1]!.id, workshop.id, NOW));
		requireAction(setRoomRecipe(state, workshop.id, "maintenance-kit", true, NOW));
		requireAction(setRoomStockTarget(state, workshop.id, 2, NOW));
		requireAction(setFieldKit(state, state.scavs[0]!.id, "maintenance"));
		const raw = JSON.parse(saveGame(state));
		for (const mutate of [
			(value: any) => { value.shelter.logistics.reserve.money = -1; },
			(value: any) => { value.shelter.logistics.reserve.supplies.ammo = .1; },
			(value: any) => { value.shelter.logistics.reserve.supplies.extra = 0; },
			(value: any) => { value.shelter.logistics.kits.maintenance = 9; },
			(value: any) => { value.shelter.logistics.kits.trauma = -.1; },
			(value: any) => { value.shelter.logistics.kits.extra = 1; },
			(value: any) => { value.shelter.logistics.freeKits = true; },
			(value: any) => { value.shelter.rooms[0].stockTarget = 9; },
			(value: any) => { value.shelter.rooms[0].stockTarget = .5; },
			(value: any) => { value.shelter.rooms[0].queue[0].paid.money = 0; },
			(value: any) => { value.shelter.rooms[0].queue[0].paid.supplies.scrap = 0; },
			(value: any) => { value.shelter.rooms[0].queue[0].output.fieldKit = "trauma"; },
			(value: any) => { value.shelter.rooms[0].queue[0].output.supplies.ammo = 12; },
			(value: any) => { value.shelter.rooms[0].queue[0].workRequired = 1; },
			(value: any) => { value.scavs[0].fieldKit = "__proto__"; },
		]) {
			const forged = structuredClone(raw); mutate(forged);
			expect(parseSave(JSON.stringify(forged))).toBeNull();
		}
		expect(restore(state)).toEqual(state);
	});

	test("invalid live and retained kit snapshots cannot be imported", () => {
		const state = funded(); manufacture(state, "trauma");
		requireAction(setFieldKit(state, state.scavs[0]!.id, "trauma"));
		requireAction(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated));
		for (const invalid of ["none", "toString", { injuryMultiplier: 0 }]) {
			const raw = JSON.parse(saveGame(state)); raw.raids[0].fieldKit = invalid;
			expect(parseSave(JSON.stringify(raw))).toBeNull();
		}
		advance(state, state.raids[0]!.endsAt);
		if (state.raids.length) requireAction(extractRaid(state, state.raids[0]!.id, state.lastUpdated));
		for (const invalid of ["none", "toString", { injuryMultiplier: 0 }]) {
			const raw = JSON.parse(saveGame(state)); raw.history[0].fieldKit = invalid;
			expect(parseSave(JSON.stringify(raw))).toBeNull();
		}
		expect(restore(state)).toEqual(state);
	});

	test("v12 paid production and an active raid retain their former settlement without acquiring free kits", () => {
		const current = funded(27), medbay = room(current, "medbay");
		requireAction(assignWorker(current, current.scavs[1]!.id, medbay.id, NOW));
		requireAction(setRoomRecipe(current, medbay.id, "medicine-batch", false, NOW));
		requireAction(dispatchRaid(current, current.scavs[0]!.id, "courtyard", NOW));
		withoutArsenalLoot(current);
		// Derive a genuine pre-ballistics sortie: v12 never contained the later ammo snapshot.
		delete current.raids[0]!.expedition!.ammunition;
		advance(current, NOW + 7_123);
		const raw = JSON.parse(saveGame(current)); raw.schemaVersion = 12;
		delete raw.shelter.logistics;
		for (const item of raw.shelter.rooms) delete item.stockTarget;
		for (const item of raw.scavs) delete item.fieldKit;
		for (const item of [...raw.raids, ...raw.history]) delete item.fieldKit;
		const migrated = parseSave(JSON.stringify(raw));
		expect(migrated).not.toBeNull();
		expect(migrated!.raids[0]!.fieldKit).toBeUndefined();
		expect(getFieldKitStock(migrated!)).toEqual({ maintenance: 0, trauma: 0 });
		const until = current.raids[0]!.endsAt;
		advance(current, until); advanceIrregularly(migrated!, until);
		for (const state of [current, migrated!]) if (state.raids.length)
			requireAction(extractRaid(state, state.raids[0]!.id, state.lastUpdated));
		advance(current, until + 90_000); advanceIrregularly(migrated!, until + 90_000);
		expect(migrated).toEqual(current);
		expect(restore(migrated!)).toEqual(migrated!);
	});
});
