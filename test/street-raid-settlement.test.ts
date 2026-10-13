import { describe, expect, test } from "bun:test";
import {
	advance, continueExpedition, createGame, dispatchRaid, extractRaid, getExpeditionChoices,
	getRaidPhase, healthPercent, resolveMedicalEncounter, loadGameWithSummary, parseSave, saveGame, SAVE_VERSION, type GameState,
} from "../src/game/engine";
import { getRaidFieldFrame, getRaidFieldOutcome, getRaidFieldPlan } from "../src/raid-field";
import { MAP_BY_ID } from '../src/game/data';

const NOW = 1_792_000_000_000;
function clone(state: GameState) {
	const copy = parseSave(saveGame(state));
	expect(copy).not.toBeNull();
	return copy!;
}
function controlFor(state: GameState) {
	const control = structuredClone(state);
	control.raids = [];
	for (const scav of control.scavs) if (scav.status === "raiding") scav.status = "ready";
	return control;
}

describe("street encounters remain real checkpoint settlements", () => {
	test("street variations change bounded cargo while preserving the established success, damage and RNG stream", () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!, plan = getRaidFieldPlan(raid), modifier = getRaidFieldOutcome(raid, plan);
		const control = controlFor(state), before = saveGame(state);
		for (let i = 0; i < 100; i++) {
			getRaidFieldFrame(raid, NOW + i * 300, plan);
			getRaidPhase(raid, NOW + i * 300);
		}
		expect(saveGame(state)).toBe(before);
		advance(control, raid.endsAt);
		advance(state, raid.endsAt);
		expect(raid.seed).toBe(698906565);
		expect(state.rng).toBe(698906565);
		expect(raid.expedition!.status).toBe("choice");
		const medical = resolveMedicalEncounter(raid.expedition!.medical!.start, raid.outcomeSeed ?? raid.seed, 1, MAP_BY_ID[raid.mapId]!.danger, true, raid.endsAt);
		expect(state.scavs[0]!.body).toEqual(medical.body);
		expect(state.scavs[0]!.health).toBe(healthPercent(medical.body));
		expect(state.weapons[0]!.durability).toBe(91);
		expect(Object.entries(state.weapons[0]!.modules).every(([slot, part]) => part!.durability === (slot === "receiver" ? 91 : 97))).toBe(true);
		expect(raid.expedition!.offers).toEqual(["careful", "gunsmith"]);
		expect(raid.expedition!.cargo.modules).toHaveLength(1);
		expect(raid.expedition!.cargo.modules[0]!.durability).toBe(90);
		expect(state.nextId).toBe(32);
		expect(Math.abs(raid.expedition!.cargo.money - 116 * modifier.moneyMultiplier)).toBeLessThanOrEqual(1);
		for (const key of ["ammo", "medicine", "scrap", "intel"] as const) {
			const original = { ammo: 6, medicine: 0, scrap: 2, intel: 1 };
			expect(raid.expedition!.cargo.supplies[key]).toBe(original[key] + modifier.resourceBonus[key]);
		}
		expect(raid.expedition!.trail.at(-1)!.text).toContain(plan.theme.label);
		expect(state.money).toBe(control.money);
		expect(state.supplies).toEqual(control.supplies);
		expect(state.history).toHaveLength(0);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("a deeper street charges its real branch quote once and keeps all found cargo in escrow until one extraction", () => {
		const state = createGame(NOW);
		state.money = 5000; state.supplies.ammo = 100; state.supplies.intel = 40;
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		// Isolate payment and escrow from the independent survival roll.
		raid.chance = 1;
		advance(state, raid.endsAt);
		const perk = raid.expedition!.offers[0]!, quote = getExpeditionChoices(state, raid, perk).find((item) => item.branch === "combat")!;
		const balances = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel }, oldPlan = getRaidFieldPlan(raid);
		expect(continueExpedition(state, raid.id, "combat", perk, state.lastUpdated).ok).toBe(true);
		expect(state.money).toBe(balances.money - quote.money);
		expect(state.supplies.ammo).toBe(balances.ammo - quote.ammo);
		expect(state.supplies.intel).toBe(balances.intel - quote.intel);
		expect(getRaidFieldPlan(raid).id).not.toBe(oldPlan.id);
		const paid = saveGame(state);
		expect(continueExpedition(state, raid.id, "combat", perk, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(paid);
		raid.chance = 1;
		const control = controlFor(state), inventoryCount = state.modules.length;
		advance(control, raid.endsAt);
		advance(state, raid.endsAt);
		expect(raid.expedition!.stage).toBe(2);
		expect(raid.expedition!.status).toBe("choice");
		expect(state.modules.length).toBe(inventoryCount);
		expect(state.money).toBe(control.money);
		expect(state.supplies).toEqual(control.supplies);
		const cargo = structuredClone(raid.expedition!.cargo), beforeExtraction = state.money;
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.history[0]!.money).toBe(cargo.money);
		expect(state.money).toBe(beforeExtraction + cargo.money);
		expect(state.history[0]!.moduleIds).toHaveLength(cargo.modules.length);
		const extracted = saveGame(state);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(extracted);
		expect(parseSave(extracted)).not.toBeNull();
	});

	test("regular, irregular and mid-raid offline resume settle the same encounters, ownership and manual choices", () => {
		const long = createGame(NOW);
		long.level = 2; long.xp = 90; long.money = 5000; long.supplies.ammo = 200;
		for (const [index, scav] of long.scavs.entries()) expect(dispatchRaid(long, scav.id, index === 1 ? "depot" : "courtyard", NOW).ok).toBe(true);
		const short = clone(long), resumed = clone(long), until = NOW + 180_000;
		advance(long, until);
		let i = 0;
		while (short.lastUpdated < until) {
			for (const raid of short.raids) getRaidFieldFrame(raid, short.lastUpdated);
			advance(short, Math.min(until, short.lastUpdated + [997, 9001, 3007, 17777][i++ % 4]!));
		}
		advance(resumed, NOW + 10_000);
		const loaded = loadGameWithSummary(saveGame(resumed), until)!;
		expect(loaded).not.toBeNull();
		expect(short).toEqual(long);
		expect(loaded.state).toEqual(long);
		expect(parseSave(saveGame(long))).not.toBeNull();
		for (const raid of long.raids) {
			expect(raid.expedition!.status).toBe("choice");
			expect(getRaidFieldFrame(raid, until).position).toEqual(getRaidFieldPlan(raid).checkpoint);
		}
	});

	test("a failed encounter never pays its prospective street bonus or turns observations into banked loot", () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const raid = state.raids[0]!, control = controlFor(state);
		raid.chance = 0;
		const plan = getRaidFieldPlan(raid);
		getRaidFieldOutcome(raid, plan);
		getRaidFieldFrame(raid, raid.endsAt - 1, plan);
		advance(control, raid.endsAt);
		advance(state, raid.endsAt);
		expect(state.history[0]!.success).toBe(false);
		expect(state.history[0]!.money).toBe(0);
		expect(state.history[0]!.supplies).toEqual({ ammo: 0, medicine: 0, scrap: 0, intel: 0 });
		expect(state.history[0]!.moduleIds).toEqual([]);
		expect(state.money).toBe(control.money);
		expect(state.supplies).toEqual(control.supplies);
		expect(state.blueprints).toContain("route:courtyard");
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("the existing v3 in-flight save keeps its original reward, weapon, damage and seed after street previews", async () => {
		const raw = await Bun.file(new URL("./fixtures/legacy-v3-expedition.json", import.meta.url)).text();
		const state = parseSave(raw)!;
		expect(state).not.toBeNull();
		expect(state.schemaVersion).toBe(SAVE_VERSION);
		const raid = state.raids[0]!, control = clone(state), before = saveGame(state);
		expect(raid.expedition!.legacyLoot).toBe(true);
		for (let i = 0; i < 50; i++) {
			getRaidFieldPlan(raid); getRaidFieldFrame(raid, raid.startedAt + i * 400); getRaidPhase(raid, raid.startedAt + i * 400);
		}
		expect(saveGame(state)).toBe(before);
		advance(state, raid.endsAt); advance(control, control.raids[0]!.endsAt);
		expect(state).toEqual(control);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		expect(state.history[0]!.money).toBe(204);
		expect(state.history[0]!.weaponId).toBe("mp133");
		expect(state.history[0]!.moduleIds).toEqual([]);
		expect(state.scavs[0]!.health).toBe(85);
		expect(state.weapons[0]!.durability).toBe(71);
		expect(state.rng).toBe(11355432);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});
});
