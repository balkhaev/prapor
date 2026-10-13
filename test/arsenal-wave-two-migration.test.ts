import { describe, expect, test } from "bun:test";
import { SAVE_VERSION, advance, continueExpedition, craftModule, createGame, dispatchRaid, extractRaid, getExpeditionChoices, loadGameWithSummary, parseSave, parseTradeModule, parseTradeWeapon, saveGame, setLoadoutOption, setRaidPlan, setRaidTactic, type GameState } from "../src/game/engine";
import { ARSENAL_SAVE_VERSION, ARSENAL_WAVE_TWO_SAVE_VERSION, moduleAvailableInSave, weaponAvailableInSave } from "../src/game/catalog-releases";
import { MODULE_MODELS } from "../src/game/modules";
import { RELEASED_V17_FIXTURES } from "./released-v17-arsenal-fixtures";
import { RELEASED_V18_FIXTURES } from "./released-v18-arsenal-fixtures";
import { useWeaponPlatformFixture } from "./weapon-fixtures";
import { withoutMedical } from "./legacy-health-fixture";

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
	return JSON.stringify(value);
}
const fingerprint = (value: unknown) => new Bun.CryptoHasher("sha256").update(canonical(value)).digest("hex");
function releasedFormat(state: GameState, version = ARSENAL_SAVE_VERSION) {
	const raw = JSON.parse(saveGame(state)); if (version < 18) withoutMedical(raw); raw.schemaVersion = version;
	return raw;
}
const stateFingerprint = (state: GameState, version = ARSENAL_SAVE_VERSION) => fingerprint(releasedFormat(state, version));
function depart(fixture: typeof RELEASED_V17_FIXTURES[number] | typeof RELEASED_V18_FIXTURES[number], version = ARSENAL_SAVE_VERSION) {
	const state = createGame(fixture.now), scav = state.scavs[0]!;
	state.money = 100_000; state.supplies = { ammo: 10_000, medicine: 100, scrap: 1_000, intel: 100 }; state.level = 9; state.xp = 5_760;
	useWeaponPlatformFixture(state, state.weapons[0]!, fixture.weaponId); scav.combat = 90; scav.scouting = 90; state.sectorIntel = { [fixture.mapId]: { knowledge: 3, pressure: 2 } };
	for (const action of [setRaidTactic(state, scav.id, "cautious"), setLoadoutOption(state, scav.id, "ammoType", fixture.type), setRaidPlan(state, scav.id, "intel", "scouted"), dispatchRaid(state, scav.id, fixture.mapId, state.lastUpdated)]) expect(action.ok).toBe(true);
	state.raids[0]!.expedition!.lootCatalogVersion = version;
	expect(stateFingerprint(state,version)).toBe(fixture.paid);
	const loaded = parseSave(JSON.stringify(releasedFormat(state,version))); expect(loaded).not.toBeNull();
	return loaded!;
}
function irregularly(state: GameState, until: number) {
	const steps = [173, 1_093, 30_011, 907, 8_999];
	for (let index = 0; state.lastUpdated < until; index++) advance(state, Math.min(until, state.lastUpdated + steps[index % steps.length]!));
}

describe("second arsenal release preserves genuine paid v17 sorties", () => {
	for (const release of [{ version:17, fixtures: RELEASED_V17_FIXTURES }, { version:18, fixtures: RELEASED_V18_FIXTURES }]) test(`released v${release.version} retains quotes, physical loot, health, payout and offline settlement`, () => {
		for (const fixture of release.fixtures) {
			const state = depart(fixture,release.version), raid = state.raids[0]!, active = saveGame(state), offline = parseSave(active)!;
			advance(state, raid.endsAt); irregularly(offline, raid.endsAt);
			expect(stateFingerprint(state,release.version)).toBe(fixture.first); expect(offline).toEqual(state); expect(loadGameWithSummary(active, raid.endsAt)!.state).toEqual(state);
			const perk = raid.expedition!.offers[0]!;
			expect(fingerprint(getExpeditionChoices(state, raid, perk))).toBe(fixture.choices);
			expect(continueExpedition(state, raid.id, fixture.branch, perk, state.lastUpdated).ok).toBe(true);
			expect(stateFingerprint(state,release.version)).toBe(fixture.nextPaid);
			const second = parseSave(saveGame(state))!; advance(state, raid.endsAt); irregularly(second, raid.endsAt);
			expect(stateFingerprint(state,release.version)).toBe(fixture.second); expect(second).toEqual(state);
			expect(raid.expedition!.cargo.modules.map(part => part.modelId)).toEqual([...fixture.cargoModels]);
			expect(raid.expedition!.cargo.weaponIds).toEqual([...fixture.cargoWeapons]);
			expect(raid.expedition!.lootCatalogVersion).toBe(release.version);
			expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
			expect(stateFingerprint(state,release.version)).toBe(fixture.extracted); expect(parseSave(saveGame(state))).toEqual(state);
		}
	});
	test("v17 accepts every released module while v16 and v17 cannot inject later catalogues", () => {
		expect(MODULE_MODELS.slice(0,621).every(part => moduleAvailableInSave(part.id,17))).toBe(true);
		expect(MODULE_MODELS.slice(621).every(part => !moduleAvailableInSave(part.id,17) && moduleAvailableInSave(part.id,SAVE_VERSION))).toBe(true);
		expect(weaponAvailableInSave("p90",16)).toBe(false); expect(weaponAvailableInSave("p90",17)).toBe(true);
		expect(weaponAvailableInSave("glock20",17)).toBe(false); expect(weaponAvailableInSave("glock20",SAVE_VERSION)).toBe(true);
		const state = createGame(1_792_500_000_000); useWeaponPlatformFixture(state,state.weapons[0]!,"glock20");
		expect(parseSave(saveGame(state))).toEqual(state);
		const raw = JSON.parse(saveGame(state)); raw.schemaVersion = 17; expect(parseSave(JSON.stringify(raw))).toBeNull();
		const inventory = createGame(state.lastUpdated); inventory.base.workshop = 4; inventory.money = 100_000; inventory.supplies.scrap = 1_000;
		expect(craftModule(inventory,"barrel-glock-10mm-short").ok).toBe(true);
		const old = JSON.parse(saveGame(inventory)); old.schemaVersion = 17; expect(parseSave(JSON.stringify(old))).toBeNull();
	});
	test("new departures pin this catalogue, current trade and save accept every new physical gun", () => {
		expect(SAVE_VERSION).toBeGreaterThanOrEqual(ARSENAL_WAVE_TWO_SAVE_VERSION);
		for (const weaponId of ["g36","aug","fal","sr25","vector","fiveseven","sr2","sr1","glock20","ash12","vpo209","svdk","awm","m870"]) {
			const state = createGame(1_792_500_000_000); useWeaponPlatformFixture(state,state.weapons[0]!,weaponId);
			const gun = state.weapons[0]!; gun.durability = 73; gun.modules.receiver!.durability = 73;
			expect(parseTradeWeapon(structuredClone(gun))).toEqual(gun);
			for (const part of Object.values(gun.modules)) expect(parseTradeModule(structuredClone(part))).toEqual(part);
			expect(parseSave(saveGame(state))).toEqual(state);
			expect(dispatchRaid(state,state.scavs[0]!.id,"courtyard",state.lastUpdated).ok).toBe(true);
			expect(state.raids[0]!.expedition!.lootCatalogVersion).toBe(SAVE_VERSION); expect(parseSave(saveGame(state))).toEqual(state);
		}
	});
});
