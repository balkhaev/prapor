import { describe, expect, test } from "bun:test";
import { advance, createGame, dispatchRaid, extractRaid, parseSave, recruitScav, saveGame, SAVE_VERSION } from "../src/game/engine";
import { chooseScavAppearance, defaultScavAppearance, isScavAppearance, SCAV_APPEARANCES } from "../src/game/scav-appearances";

const NOW = 1_792_000_000_000;

describe("persistent scav model identities", () => {
	test("32 permanent atlas IDs cover eight distinct appearances for each personality", () => {
		expect(SCAV_APPEARANCES.map((appearance) => appearance.id)).toEqual(Array.from({ length: 32 }, (_, index) => index));
		expect(new Set(SCAV_APPEARANCES.map((appearance) => appearance.name)).size).toBe(32);
		for (const [personality, base] of [["veteran", 0], ["collector", 1], ["runner", 2], ["careful", 3]] as const) {
			expect(defaultScavAppearance(personality)).toBe(base);
			expect(SCAV_APPEARANCES.filter((appearance) => appearance.personality === personality)).toHaveLength(8);
		}
		for (const appearance of SCAV_APPEARANCES) expect(isScavAppearance(appearance.id)).toBe(true);
		for (const invalid of [-1, 32, .5, NaN, Infinity, "3", null, undefined, true, {}]) expect(isScavAppearance(invalid)).toBe(false);
		expect(defaultScavAppearance("toString")).toBe(0);
		expect(chooseScavAppearance("__proto__", "scav-1")).toBe(0);
	});

	test("stable selection uses every available model before repeating and leaves its inputs intact", () => {
		for (const personality of ["veteran", "collector", "runner", "careful"]) {
			const used: number[] = [];
			for (let index = 0; index < 8; index++) {
				const before = [...used], identity = `scav-${index + 1}:Боец`;
				const selected = chooseScavAppearance(personality, identity, used);
				expect(chooseScavAppearance(personality, identity, used)).toBe(selected);
				expect(used).toEqual(before);
				expect(before).not.toContain(selected);
				expect(SCAV_APPEARANCES[selected]!.personality).toBe(personality);
				used.push(selected);
			}
			expect(new Set(used).size).toBe(8);
			expect(chooseScavAppearance(personality, "exhausted", used)).toBe(chooseScavAppearance(personality, "exhausted"));
		}
	});

	test("the opening roster retains its original faces while recruits diversify without changing paid rolls", () => {
		const state = createGame(NOW);
		expect(state.scavs.map((scav) => scav.appearance)).toEqual([0, 1, 2]);
		state.base.radio = 5; state.money = 50_000;
		const originalRolls = [
			{ name: "Леший", personality: "collector", combat: 36, scouting: 25, rng: 698906565, money: 49570 },
			{ name: "Крот", personality: "veteran", combat: 24, scouting: 31, rng: 3444066765, money: 49050 },
			{ name: "Немой", personality: "careful", combat: 29, scouting: 27, rng: 1245771093, money: 48440 },
			{ name: "Гвоздь", personality: "collector", combat: 25, scouting: 38, rng: 3383073568, money: 47740 },
		];
		for (const [index, roll] of originalRolls.entries()) {
			const owned = state.scavs.map((scav) => scav.appearance);
			expect(recruitScav(state).ok).toBe(true);
			const scav = state.scavs.at(-1)!;
			expect({ name: scav.name, personality: scav.personality, combat: scav.combat, scouting: scav.scouting, rng: state.rng, money: state.money }).toEqual(roll);
			expect(state.nextId).toBe(31 + index);
			expect(isScavAppearance(scav.appearance)).toBe(true);
			expect(owned).not.toContain(scav.appearance);
			expect(SCAV_APPEARANCES[scav.appearance!]!.personality).toBe(scav.personality);
		}
		expect(parseSave(saveGame(state))).toEqual(state);
	});

	test("every model survives roster and active-raid round trips without a schema bump", () => {
		expect(SAVE_VERSION).toBe(5);
		for (const appearance of SCAV_APPEARANCES) {
			const state = createGame(NOW), scav = state.scavs[0]!;
			scav.appearance = appearance.id;
			expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
			expect(state.raids[0]!.scavAppearance).toBe(appearance.id);
			const before = saveGame(state), loaded = parseSave(before)!;
			expect(loaded).toEqual(state);
			expect(saveGame(state)).toBe(before);
			expect(parseSave(saveGame(loaded))).toEqual(loaded);
		}
	});

	test("changing the visual model leaves raid charges, loot, combat and RNG identical", () => {
		for (const expedition of [false, true]) {
			const outcomes = [0, 31].map((appearance) => {
				const state = createGame(NOW), scav = state.scavs[0]!;
				scav.appearance = appearance;
				expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
				const raid = state.raids[0]!;
				if (!expedition) raid.expedition = null;
				raid.chance = 1;
				advance(state, raid.endsAt);
				if (expedition) expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
				const outcome = JSON.parse(saveGame(state));
				for (const actor of outcome.scavs) delete actor.appearance;
				for (const report of outcome.history) delete report.scavAppearance;
				return outcome;
			});
			expect(outcomes[0]).toEqual(outcomes[1]);
		}
	});

	test("saves without appearance data preserve personality faces and the existing gameplay cursor", async () => {
		const state = createGame(NOW);
		state.base.radio = 5; state.money = 50_000;
		for (let index = 0; index < 3; index++) expect(recruitScav(state).ok).toBe(true);
		const legacy = JSON.parse(saveGame(state));
		for (const scav of legacy.scavs) delete scav.appearance;
		const loaded = parseSave(JSON.stringify(legacy))!;
		expect(loaded).not.toBeNull();
		expect(loaded.scavs.map((scav) => scav.appearance)).toEqual([0, 1, 2, 1, 0, 3]);
		expect(loaded.rng).toBe(state.rng); expect(loaded.nextId).toBe(state.nextId);
		expect(loaded.money).toBe(state.money); expect(loaded.supplies).toEqual(state.supplies);
		const oldSave = await Bun.file(new URL("./fixtures/legacy-v3-expedition.json", import.meta.url)).text();
		const oldState = parseSave(oldSave)!;
		expect(oldState).not.toBeNull();
		for (const scav of oldState.scavs) expect(scav.appearance).toBe(defaultScavAppearance(scav.personality));
		expect(parseSave(saveGame(oldState))).toEqual(oldState);
	});

	test("both migrated sorties and current expeditions retain a lost actor's model in their report", () => {
		for (const expedition of [false, true]) {
			const state = createGame(NOW), scav = state.scavs[0]!;
			scav.appearance = 7;
			expect(dispatchRaid(state, scav.id, "courtyard", NOW).ok).toBe(true);
			const raid = state.raids[0]!;
			if (!expedition) raid.expedition = null;
			raid.chance = 0; raid.seed = expedition ? 41 : 40;
			advance(state, raid.endsAt);
			const report = state.history[0]!;
			expect(report.lostScav).toBe(true);
			expect(state.scavs.some((actor) => actor.id === scav.id)).toBe(false);
			expect(report.scavAppearance).toBe(7);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
	});

	test("invalid roster, raid and report model IDs reject the whole imported save", () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", NOW).ok).toBe(true);
		const active = saveGame(state);
		state.raids[0]!.expedition = null; state.raids[0]!.chance = 0; state.raids[0]!.seed = 40;
		advance(state, state.raids[0]!.endsAt);
		const settled = saveGame(state);
		for (const invalid of [-1, 32, .5, "7", null, true, {}]) {
			const roster = JSON.parse(active); roster.scavs[0].appearance = invalid;
			expect(parseSave(JSON.stringify(roster))).toBeNull();
			const raid = JSON.parse(active); raid.raids[0].scavAppearance = invalid;
			expect(parseSave(JSON.stringify(raid))).toBeNull();
			const report = JSON.parse(settled); report.history[0].scavAppearance = invalid;
			expect(parseSave(JSON.stringify(report))).toBeNull();
		}
	});
});
