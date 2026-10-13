import { describe, expect, test } from "bun:test";
import { CONTRACTS } from "../src/game/data";
import {
	advance, assignWorker, cancelProduction, claimContract, craftGear, createGame,
	equipGear, getContractLockReason, getContractProgress, getModuleCapacity,
	parseSave, queueModuleProduction, saveGame, setRoomRecipe, upgradeScavGear,
	type GameState,
} from "../src/game/engine";

const NOW = 1_792_000_000_000;
const contract = (id: string) => CONTRACTS.find((item) => item.id === id)!;
function returned() {
	const state = createGame(NOW);
	state.stats.raidsWon = 1;
	state.stats.raidsCompleted = 1;
	expect(claimContract(state, "first-return").ok).toBe(true);
	return state;
}
function workshop(state: GameState) { return state.shelter.rooms.find((room) => room.type === "workshop")!; }

describe("contracts follow the raid, equipment and shelter loops", () => {
	test("a production contract credits warehouse delivery, not payment, staffing or unfinished work", () => {
		const state = returned(), bench = workshop(state), goal = contract("working-shelter");
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		advance(state, NOW + 60_000);
		expect(getContractProgress(state, goal)).toBe(0);
		expect(claimContract(state, goal.id).ok).toBe(false);
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 1000);
		expect(bench.queue[0]!.workDone).toBeGreaterThan(0);
		expect(getContractProgress(state, goal)).toBe(0);
		advance(state, state.lastUpdated + 600_000);
		expect(getContractProgress(state, goal)).toBe(1);
		const money = state.money;
		expect(claimContract(state, goal.id).ok).toBe(true);
		expect(state.money).toBe(money + goal.reward.money);
		const restored = parseSave(saveGame(state));
		expect(restored).not.toBeNull();
		const once = saveGame(restored!);
		expect(claimContract(restored!, goal.id).ok).toBe(false);
		expect(saveGame(restored!)).toBe(once);
	});

	test("finished production waiting for warehouse space earns progress only after unloading", () => {
		const state = returned(), bench = workshop(state), goal = contract("working-shelter");
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		while (state.modules.length < getModuleCapacity(state)) state.modules.push({
			id: `module-${state.nextId++}`, modelId: "factory-sks-stock", durability: 100, foundAt: NOW,
		});
		advance(state, NOW + 600_000);
		expect(bench.queue[0]!.workDone).toBe(bench.queue[0]!.workRequired);
		expect(getContractProgress(state, goal)).toBe(0);
		expect(claimContract(state, goal.id).ok).toBe(false);
		state.modules.pop();
		advance(state, state.lastUpdated + 1);
		expect(getContractProgress(state, goal)).toBe(1);
		expect(claimContract(state, goal.id).ok).toBe(true);
	});

	test("cancelled work gives no progress and a resource batch is a valid first delivery", () => {
		const state = returned(), bench = workshop(state), goal = contract("working-shelter");
		expect(assignWorker(state, state.scavs[0]!.id, bench.id, NOW).ok).toBe(true);
		expect(queueModuleProduction(state, bench.id, "factory-sks-stock", NOW).ok).toBe(true);
		advance(state, NOW + 1000);
		expect(cancelProduction(state, bench.id, bench.queue[0]!.id, state.lastUpdated).ok).toBe(true);
		expect(getContractProgress(state, goal)).toBe(0);
		const medbay = state.shelter.rooms.find((room) => room.type === "medbay")!;
		expect(assignWorker(state, state.scavs[0]!.id, medbay.id, state.lastUpdated).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 600_000);
		expect(getContractProgress(state, goal)).toBe(1);
		expect(claimContract(state, goal.id).ok).toBe(true);
	});

	test("physical equipment completes preparation, while merely owning gear does not", () => {
		const state = returned(), goal = contract("gear-ready"), scav = state.scavs[0]!;
		expect(craftGear(state, "light_vest").ok).toBe(true);
		const armor = state.gearItems.at(-1)!;
		expect(craftGear(state, "scout_pack").ok).toBe(true);
		const pack = state.gearItems.at(-1)!;
		expect(getContractProgress(state, goal)).toBe(0);
		expect(equipGear(state, scav.id, "armor", armor.id).ok).toBe(true);
		expect(getContractProgress(state, goal)).toBe(1);
		expect(equipGear(state, state.scavs[1]!.id, "armor", armor.id).ok).toBe(true);
		expect(getContractProgress(state, goal)).toBe(1);
		expect(equipGear(state, scav.id, "backpack", pack.id).ok).toBe(true);
		expect(getContractProgress(state, goal)).toBe(2);
		expect(claimContract(state, goal.id).ok).toBe(true);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("personal preparation and physical equipment can be combined without duplicate item credit", () => {
		const state = returned(), goal = contract("gear-ready"), scav = state.scavs[0]!;
		expect(upgradeScavGear(state, scav.id, "armor").ok).toBe(true);
		expect(getContractProgress(state, goal)).toBe(1);
		expect(craftGear(state, "scout_pack").ok).toBe(true);
		const pack = state.gearItems.at(-1)!;
		expect(equipGear(state, scav.id, "backpack", pack.id).ok).toBe(true);
		expect(getContractProgress(state, goal)).toBe(2);
		// Read-only progress remains honest for incomplete presentation snapshots.
		state.scavs[1]!.loadout.backpackItemId = pack.id;
		state.scavs[1]!.loadout.armorItemId = pack.id;
		state.scavs[2]!.loadout.armorItemId = "missing-item";
		expect(getContractProgress(state, goal)).toBe(2);
	});

	test("the original personal-upgrade preparation path still completes the contract", () => {
		const state = returned(), scav = state.scavs[0]!, goal = contract("gear-ready");
		expect(upgradeScavGear(state, scav.id, "armor").ok).toBe(true);
		expect(upgradeScavGear(state, scav.id, "backpack").ok).toBe(true);
		expect(getContractProgress(state, goal)).toBe(2);
		expect(claimContract(state, goal.id).ok).toBe(true);
	});

	test("manual players can complete the sector chain and veteran milestone without automatic sorties", () => {
		const state = returned();
		state.xp = 90 * 8 ** 2; state.level = 9;
		state.claimedContracts.push("depot-route", "steady-returns");
		state.stats.raidsWon = 12; state.stats.raidsCompleted = 40;
		state.stats.mapWins = { forest: 4, factory: 3, reserve: 3, bunker: 1 };
		for (const id of ["forest-line", "factory-route", "reserve-route", "bunker-route", "veteran-command"]) {
			expect(getContractLockReason(state, contract(id))).toBeNull();
			expect(claimContract(state, id).ok).toBe(true);
		}
		expect(state.stats.autoRaidsCompleted).toBe(0);
		expect(state.claimedContracts).not.toContain("auto-route");
	});

	test("later sector contracts require their sector's wins, previous reward and reputation", () => {
		const state = returned(), goal = contract("factory-route");
		state.xp = 90 * 3 ** 2; state.level = 4;
		state.stats.raidsWon = 40; state.stats.raidsCompleted = 40;
		state.stats.mapWins = { courtyard: 40 };
		expect(getContractProgress(state, goal)).toBe(0);
		expect(getContractLockReason(state, goal)).toContain("5 уровне");
		state.xp = 90 * 4 ** 2; state.level = 5;
		expect(getContractLockReason(state, goal)).toContain("Тихая линия");
		state.claimedContracts.push("forest-line");
		expect(getContractLockReason(state, goal)).toBeNull();
		expect(claimContract(state, goal.id).ok).toBe(false);
		state.stats.mapWins = { factory: 3 };
		expect(claimContract(state, goal.id).ok).toBe(true);
	});

	test("existing claimed contracts survive save migration even after losing the qualifying equipment", () => {
		const state = createGame(NOW);
		state.claimedContracts = ["first-return", "gear-ready", "auto-route", "forest-line"];
		const previous = JSON.parse(saveGame(state)); previous.schemaVersion = 9;
		const restored = parseSave(JSON.stringify(previous));
		expect(restored).not.toBeNull();
		expect(restored!.claimedContracts).toEqual(state.claimedContracts);
		expect(getContractProgress(restored!, contract("gear-ready"))).toBe(0);
		const before = saveGame(restored!);
		expect(claimContract(restored!, "gear-ready").ok).toBe(false);
		expect(saveGame(restored!)).toBe(before);
	});
});
