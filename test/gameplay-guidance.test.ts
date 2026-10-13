import { describe, expect, test } from "bun:test";
import { GAMEPLAY_BEATS, getGameplayGuidance } from "../src/gameplay-guidance";
import { CONTRACTS, MAP_BY_ID } from "../src/game/data";
import {
	advance, assignWorker, claimContract, craftGear, createGame, dispatchRaid,
	dispatchSquadRaid, equipGear, getContractProgress, getRaidQuote,
	getRoomProductionState, getSupplyCapacity, queueModuleProduction, saveGame, getScavHealingQuote,
	setRoomRecipe, setFieldKit, xpForLevel, type GameState, type RoomInstance,
} from "../src/game/engine";
import { applyHit, createHealth, healthPercent } from "../src/game/health";

const NOW = 1_792_000_000_000;
function room(state: GameState, type: RoomInstance["type"]) { return state.shelter.rooms.find((item) => item.type === type)!; }
function passed(state: GameState, until: string) {
	const index = GAMEPLAY_BEATS.findIndex((beat) => beat.contractId === until);
	state.claimedContracts = GAMEPLAY_BEATS.slice(0, index + 1).map((beat) => beat.contractId);
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
	return value;
}
function checkpoint(squad = false) {
	for (let offset = 0; offset < 256; offset++) {
		const state = createGame(NOW + offset);
		const result = squad ? dispatchSquadRaid(state, state.scavs.slice(0, 2).map((scav) => scav.id), "courtyard", state.lastUpdated)
			: dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated);
		expect(result.ok).toBe(true);
		const leader = state.raids[0]!;
		advance(state, Math.max(...state.raids.map((raid) => raid.endsAt)));
		if (state.raids.length && state.raids.every((raid) => raid.expedition?.status === "choice")) return { state, leaderId: leader.id };
	}
	throw new Error("No successful checkpoint fixture found");
}

describe("gameplay loop guidance", () => {
	test("high aggregate health with fractures directs to the actual medical course without mutating readiness", () => {
		const state = createGame(NOW);
		for (const scav of state.scavs) { scav.body = createHealth(); applyHit(scav.body, "leftLeg", 1, { fracture: true }); scav.health = healthPercent(scav.body); scav.status = "wounded"; }
		const before = JSON.stringify(state), guidance = getGameplayGuidance(freeze(state));
		expect(guidance.action).toMatchObject({ kind: "scav", label: "Восстановить бойца" });
		const scav = state.scavs.find(person => person.id === guidance.action.scavId)!, quote = getScavHealingQuote(state, scav);
		expect(guidance.action.detail).toContain("здоровье и подвижность");
		expect(guidance.action.detail).toContain(`${quote.medicine} медикаментов`);
		expect(guidance.action.detail).toContain(`${quote.duration} сек.`);
		expect(JSON.stringify(state)).toBe(before);
	});

	test("an ongoing clinical course is already paid and its remaining time follows simulation time", () => {
		const state = createGame(NOW);
		for (const scav of state.scavs) { scav.medicalTreatment = { startedAt: NOW, endsAt: NOW + 45_000, medicine: 1 }; scav.status = "wounded"; }
		state.supplies.medicine = 0;
		let guidance = getGameplayGuidance(state);
		expect(guidance.action).toMatchObject({ kind: "scav", label: "Дождаться лечения" });
		expect(guidance.action.detail).toContain("курс уже оплачен, осталось 45 сек.");
		state.lastUpdated += 10_000;
		const before = JSON.stringify(state);
		guidance = getGameplayGuidance(freeze(state));
		expect(guidance.action.detail).toContain("осталось 35 сек.");
		expect(guidance.action.detail).not.toContain("стоит");
		expect(JSON.stringify(state)).toBe(before);
	});

	test("a missing chosen field kit connects raid readiness to its actual producing room", () => {
		const state = createGame(NOW);
		for (const scav of state.scavs) expect(setFieldKit(state, scav.id, "maintenance").ok).toBe(true);
		const saved = saveGame(state);
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "room", roomId: room(state, "workshop").id, tab: "staff", label: "Подготовить ремкомплект" });
		expect(getGameplayGuidance(state).action.detail).toContain("выбрать выход без комплекта");
		expect(saveGame(state)).toBe(saved);
	});

	test("new game immediately prepares an affordable solo sortie rather than staffing every room", () => {
		const state = createGame(NOW), result = getGameplayGuidance(state);
		expect(result.campaign).toMatchObject({ index: 1, total: 8, contractId: "first-return", progress: 0, target: 1, completed: false });
		expect(result.phase).toBe("prepare");
		expect(result.action).toMatchObject({ kind: "raid", mapId: "courtyard" });
		const scav = state.scavs.find((candidate) => candidate.id === result.action.scavId)!;
		expect(getRaidQuote(state, scav, MAP_BY_ID[result.action.mapId!]!).reason).toBeNull();
		expect(result.action.detail).toContain("одного бойца");
		expect(result.steps.map((item) => item.label)).toEqual(["Подготовка", "Выход", "Решение", "Вложение"]);
		expect(state.shelter.rooms.every((target) => !target.workerIds.length)).toBe(true);
	});

	test("frozen repeated previews do not dispatch autos, pay, finish work or advance time", () => {
		const state = createGame(NOW);
		expect(queueModuleProduction(state, room(state, "workshop").id, "optic-reflex", NOW).ok).toBe(true);
		state.scavs[0]!.autoRaid.enabled = true;
		const saved = saveGame(state), expected = getGameplayGuidance(state);
		freeze(state);
		for (let frame = 0; frame < 40; frame++) expect(getGameplayGuidance(state)).toEqual(expected);
		expect(saveGame(state)).toBe(saved);
		expect(state.raids).toHaveLength(0);
		expect(room(state, "workshop").queue).toHaveLength(1);
	});

	test("manual checkpoint outranks a ready reward and opens its exact raid", () => {
		const { state, leaderId } = checkpoint();
		state.stats.raidsWon = 1;
		expect(getGameplayGuidance(state)).toMatchObject({ phase: "decision", action: { kind: "watch", raidId: leaderId } });
		expect(getGameplayGuidance(state).action.detail).toContain("весь груз под риском");
	});

	test("a party checkpoint resolves to the leader even when raid storage order changes", () => {
		const { state, leaderId } = checkpoint(true);
		state.raids.reverse();
		const saved = saveGame(state);
		expect(getGameplayGuidance(state)).toMatchObject({ phase: "decision", action: { kind: "watch", raidId: leaderId } });
		expect(saveGame(state)).toBe(saved);
	});

	test("a ready unlocked campaign reward precedes paid blockers; claimed chapters never regress", () => {
		const state = createGame(NOW);
		state.stats.raidsWon = 1;
		expect(queueModuleProduction(state, room(state, "workshop").id, "optic-reflex", NOW).ok).toBe(true);
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "contracts", contractId: "first-return" });
		expect(claimContract(state, "first-return").ok).toBe(true);
		state.stats.raidsWon = 0;
		expect(getGameplayGuidance(state).campaign.contractId).toBe("working-shelter");
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "room", roomId: room(state, "workshop").id, tab: "staff" });
	});

	test("paid output capacity targets its actual room ahead of an active sortie", () => {
		const state = createGame(NOW), medbay = room(state, "medbay");
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, NOW).ok).toBe(true);
		state.supplies.medicine = getSupplyCapacity(state).medicine;
		advance(state, NOW + Math.ceil(getRoomProductionState(state, medbay).remainingSeconds! * 1000));
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const saved = saveGame(state);
		expect(getGameplayGuidance(state)).toMatchObject({ phase: "invest", action: { kind: "room", roomId: medbay.id, tab: "production" } });
		expect(getGameplayGuidance(state).action.detail).toContain("Оплаченная партия сохраняется");
		expect(saveGame(state)).toBe(saved);
	});

	test("unpaid idle rooms do not distract from a running raid", () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		expect(getGameplayGuidance(state)).toMatchObject({ phase: "raid", action: { kind: "watch", raidId: state.raids[0]!.id } });
	});

	test("production chapter guides one worker, one real order, delivery and then reward", () => {
		const state = createGame(NOW);
		passed(state, "first-return");
		const target = room(state, "medbay");
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "room", roomId: target.id, tab: "staff" });
		expect(assignWorker(state, state.scavs[1]!.id, target.id, NOW).ok).toBe(true);
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "room", roomId: target.id, tab: "production", label: "Заказать первую партию" });
		expect(setRoomRecipe(state, target.id, "medicine-batch", false, NOW).ok).toBe(true);
		const saved = saveGame(state);
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "room", roomId: target.id, tab: "production", label: "Проверить первую партию" });
		expect(saveGame(state)).toBe(saved);
		advance(state, NOW + Math.ceil(getRoomProductionState(state, target).remainingSeconds! * 1000));
		expect(target.cycles).toBe(1);
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "contracts", contractId: "working-shelter" });
		expect(claimContract(state, "working-shelter").ok).toBe(true);
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "scav", label: "Снарядить бойца" });
	});

	test("physical assigned armor and backpack satisfy kit progress without an upgrade command", () => {
		const state = createGame(NOW);
		passed(state, "working-shelter");
		expect(craftGear(state, "light_vest").ok).toBe(true);
		expect(craftGear(state, "scout_pack").ok).toBe(true);
		expect(equipGear(state, state.scavs[0]!.id, "armor", state.gearItems[0]!.id).ok).toBe(true);
		expect(equipGear(state, state.scavs[0]!.id, "backpack", state.gearItems[1]!.id).ok).toBe(true);
		expect(getContractProgress(state, CONTRACTS.find((contract) => contract.id === "gear-ready")!)).toBe(2);
		expect(getGameplayGuidance(state).campaign.progress).toBe(2);
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "contracts", contractId: "gear-ready" });
	});

	test("a future ready kit reward does not hijack the unfinished production chapter", () => {
		const state = createGame(NOW);
		passed(state, "first-return");
		state.scavs[0]!.gear.armor = 2;
		expect(getGameplayGuidance(state).campaign.contractId).toBe("working-shelter");
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "room", tab: "staff" });
		expect(getGameplayGuidance(state).action.contractId).toBeUndefined();
	});

	test("kit guidance uses already owned equipment without requiring funds", () => {
		const state = createGame(NOW);
		passed(state, "working-shelter");
		expect(craftGear(state, "light_vest").ok).toBe(true);
		state.money = 0; state.supplies.scrap = 0;
		const saved = saveGame(state), result = getGameplayGuidance(state);
		expect(result.action).toMatchObject({ kind: "scav", label: "Выдать готовое снаряжение" });
		expect(result.action.detail).toContain("повторная покупка не нужна");
		expect(saveGame(state)).toBe(saved);
	});

	test("kit funding routes to an affordable open raid or the actual reserve blocker", () => {
		const state = createGame(NOW);
		passed(state, "working-shelter");
		state.money = 30; state.supplies.scrap = 0;
		const result = getGameplayGuidance(state);
		expect(result.action).toMatchObject({ kind: "raid", mapId: "courtyard" });
		expect(result.action.detail).toContain("снаряжения сейчас не хватает");
		state.money = 0;
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "arsenal", label: "Проверить резерв на выход" });
	});

	test("veteran claims skip the inserted production chapter but retain genuinely incomplete goals", () => {
		const state = createGame(NOW);
		state.claimedContracts = ["first-return", "gear-ready", "depot-route"];
		state.level = 3; state.xp = xpForLevel(3);
		const saved = saveGame(state), result = getGameplayGuidance(state);
		expect(result.campaign).toMatchObject({ index: 5, contractId: "forest-line", progress: 0 });
		expect(result.action).toMatchObject({ kind: "raid", mapId: "forest" });
		expect(saveGame(state)).toBe(saved);
		state.claimedContracts = ["first-return", "depot-route"];
		expect(getGameplayGuidance(state).campaign.contractId).toBe("gear-ready");
	});

	test("missing campaign level chooses an affordable open sector and states exact XP remaining", () => {
		const state = createGame(NOW);
		passed(state, "forest-line");
		state.level = 3; state.xp = xpForLevel(3) + 20; state.supplies.intel = 0;
		const result = getGameplayGuidance(state);
		expect(result.campaign.contractId).toBe("factory-route");
		expect(result.action).toMatchObject({ kind: "raid", mapId: "depot" });
		expect(result.action.detail).toContain("на 5 уровне");
		expect(result.action.detail).toContain(String(xpForLevel(5) - state.xp));
		const scav = state.scavs.find((candidate) => candidate.id === result.action.scavId)!;
		expect(getRaidQuote(state, scav, MAP_BY_ID[result.action.mapId!]!).reason).toBeNull();
		state.money = 0; state.supplies.ammo = 0;
		expect(getGameplayGuidance(state).action.detail).toContain(String(xpForLevel(5) - state.xp));
		expect(getGameplayGuidance(state).action.mapId).not.toBe("factory");
	});

	test("empty and wounded squads have concrete recovery paths with no assumed payment", () => {
		const state = createGame(NOW);
		for (const scav of state.scavs) { scav.health = 10; scav.status = "wounded"; }
		state.supplies.medicine = 0;
		const result = getGameplayGuidance(state);
		expect(result.action.kind).toBe("scav");
		expect(result.action.scavId).toBeDefined();
		expect(result.action.detail).toContain("Бесплатное восстановление");
		state.scavs = [];
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "recruits", label: "Восстановить отряд" });
	});

	test("lost or entirely wounded workers recover before an unpaid staffing instruction for a paid queue", () => {
		const state = createGame(NOW);
		expect(queueModuleProduction(state, room(state, "workshop").id, "optic-reflex", NOW).ok).toBe(true);
		for (const scav of state.scavs) { scav.health = 1; scav.status = "wounded"; }
		state.supplies.medicine = 0;
		expect(getGameplayGuidance(state).action.kind).toBe("scav");
		state.scavs = [];
		expect(getGameplayGuidance(state).action.kind).toBe("recruits");
		expect(room(state, "workshop").queue).toHaveLength(1);
	});

	test("full medicine capacity selects the feasible radio recipe without staffing or paying in preview", () => {
		const state = createGame(NOW);
		passed(state, "first-return");
		state.supplies.medicine = getSupplyCapacity(state).medicine;
		const saved = saveGame(state);
		expect(getGameplayGuidance(state).action).toMatchObject({ kind: "room", roomId: room(state, "radio").id, tab: "staff" });
		expect(saveGame(state)).toBe(saved);
	});

	test("two full resource outputs have a concrete affordable module alternative", () => {
		const state = createGame(NOW);
		passed(state, "first-return");
		state.supplies.medicine = getSupplyCapacity(state).medicine;
		state.supplies.intel = getSupplyCapacity(state).intel;
		const saved = saveGame(state), result = getGameplayGuidance(state);
		expect(result.action).toMatchObject({ kind: "room", roomId: room(state, "workshop").id, tab: "staff" });
		expect(result.action.detail).toContain("Склад припасов полон");
		expect(result.action.detail).toContain("модуля");
		expect(saveGame(state)).toBe(saved);
	});

	test("production guidance stays stable while the same paid order is progressing", () => {
		const state = createGame(NOW), medbay = room(state, "medbay");
		passed(state, "first-return");
		expect(assignWorker(state, state.scavs[1]!.id, medbay.id, NOW).ok).toBe(true);
		expect(setRoomRecipe(state, medbay.id, "medicine-batch", false, NOW).ok).toBe(true);
		const expected = getGameplayGuidance(state);
		advance(state, NOW + 1000);
		expect(getGameplayGuidance(state)).toEqual(expected);
	});

	test("no resources, unarmed fighters, broken guns and assigned squad do not propose blocked raids", () => {
		for (const blocker of ["resources", "unarmed", "broken", "assigned"] as const) {
			const state = createGame(NOW);
			if (blocker === "resources") { state.money = 0; state.supplies.ammo = 0; }
			if (blocker === "unarmed") for (const scav of state.scavs) scav.weaponInstanceId = null;
			if (blocker === "broken") for (const gun of state.weapons) gun.durability = 0;
			if (blocker === "assigned") for (let index = 0; index < state.scavs.length; index++)
				expect(assignWorker(state, state.scavs[index]!.id, state.shelter.rooms[index]!.id, NOW).ok).toBe(true);
			const saved = saveGame(state), result = getGameplayGuidance(state);
			expect(result.action.kind).not.toBe("raid");
			expect(result.action.detail.length).toBeGreaterThan(20);
			expect(saveGame(state)).toBe(saved);
			if (blocker === "assigned") { expect(result.action.kind).toBe("room"); expect(result.action.tab).toBe("staff"); expect(result.action.roomId).toBeDefined(); }
			if (blocker === "broken") { expect(result.action.kind).toBe("arsenal"); expect(result.action.detail).toContain("ремонт"); }
		}
	});

	test("completed campaign keeps the loop available and never repeats claimed rewards", () => {
		const state = createGame(NOW);
		passed(state, "bunker-route"); state.level = 9; state.xp = xpForLevel(9);
		const result = getGameplayGuidance(state);
		expect(result.campaign).toMatchObject({ index: 8, total: 8, contractId: null, completed: true, nextTitle: null });
		expect(result.action.kind).toBe("raid");
		expect(result.action.contractId).toBeUndefined();
	});
});
