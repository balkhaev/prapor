import { describe, expect, test } from "bun:test";
import {
	SAVE_VERSION, advance, continueExpedition, createGame, dispatchRaid, extractRaid, getExpeditionChoices, loadGameWithSummary,
	parseSave, saveGame, setLoadoutOption, setRaidPlan, setRaidTactic, type GameState,
} from "../src/game/engine";
import { ARSENAL_SAVE_VERSION } from "../src/game/catalog-releases";
import { useWeaponPlatformFixture } from "./weapon-fixtures";
import { withoutLoot } from "./legacy-loot-fixture";
import { withoutArsenalLoot } from "./legacy-strategy-fixture";
import type { AmmoType } from "../src/game/ammunition";

// Generated with the released v15 engine at 7df999da336ea1c70797ed519ec8f35e1823e63e.
// Public actions reproduce the actual paid saves; their fingerprints prove the
// input, quotes, loot, resources, injury, social history and extraction stay exact.
// This regression needs neither a second checkout nor historical engine code.
const FIXTURES = [
  {
    "now": 1792310000000,
    "weaponId": "pm",
    "type": "standard",
    "mapId": "courtyard",
    "branch": "combat",
    "paid": "2cba77d45caf8146125a27fe951a02a4c86ebe038cb9d28a16aee5b8ac6d7e35",
    "first": "1bc38fcefe9600a445a1ebe534e1830303b3b9731da9a7e0f4b56706aafaa058",
    "choices": "cf5f22b5cf3bb3f5af45c82ac853960799499a0811d22c661ff240fb8316450a",
    "nextPaid": "d4674ac1482c84b346e20b732adca8cd54cfb48fb93bc20e7e3803f17f715dab",
    "second": "2c2b6f7e6aec72eaa29fc65c4f7464ae750d691ca6ff601e39cf5099df9be85f",
    "extracted": "60e225051d3b342e253ca1050ffcea0fc560605b7e93266b688d785bf8b2f9a2",
    "cargoModels": [
      "optic-reflex",
      "barrel-tt-7.62x25-short"
    ],
    "cargoWeapons": []
  },
  {
    "now": 1792310001000,
    "weaponId": "tt",
    "type": "piercing",
    "mapId": "factory",
    "branch": "recon",
    "paid": "b6a05d2eddc31b7546a4e5cb9c35e0f1231d11d560fc056e1de26d3e6a5efa85",
    "first": "4aeebdbb864ba6c2b78e8c28019563dfe20a48039c6d160a5ff4594ddcac03d4",
    "choices": "28fbb87ebe74eab819fe71555e16b0ee2c3e76ab3010489f3611d9fa24a12a64",
    "nextPaid": "7fb2b73108785ed239dd6a490b8cb26056ed9e2aef1b1ebdd13ec2501093dabe",
    "second": "df12f5a781513081d1fa6ddf9f309cb194e5e3b3f52c4e84f7bf363677964f3b",
    "extracted": "d48c720a4186bebec306bfb00d5ad719bfaaa63e82c3f3687295ef1e1eb0c1cc",
    "cargoModels": [
      "factory-akm-magazine",
      "magazine-ak-5.45x39-window"
    ],
    "cargoWeapons": []
  },
  {
    "now": 1792310002000,
    "weaponId": "ak74",
    "type": "expanding",
    "mapId": "forest",
    "branch": "scavenge",
    "paid": "7abab44431ccfc5f58ee781cad98ca350eac7967d77d2ef1dbbdd4bc4a7c9558",
    "first": "d65a10feb427f8540926e4ae5ed06c19aa94f591d636d8b9272b49eaab91ba02",
    "choices": "1b6df259f351a888b6f5e2a3c054323c2da8a72f477df14bdd225ae064178e47",
    "nextPaid": "dcfed9b5edc05788c0549ec2949965cd0efcf9e7a27bdeed157b0f5ebff30c7d",
    "second": "e044ab6b28239343d27ddb5bb4ac2e9ca0b7c1c4b62df78afd3181a1dfd221ff",
    "extracted": "394d7ac6148d468b418cbe94066e8c60da331627dab9895be26e7a4ff2707f4d",
    "cargoModels": [],
    "cargoWeapons": [
      "mosin"
    ]
  },
  {
    "now": 1792310003004,
    "weaponId": "akm",
    "type": "precision",
    "mapId": "reserve",
    "branch": "combat",
    "paid": "110260760e6695c802d4689869e304feee76079214eccd8b3ca7a159dd25e11f",
    "first": "5fdf2419ebb76229893332f698905930f496c6884206ff93047ab8346af85a4c",
    "choices": "290918d41fe566214a76c8d5e0f6b51618ec829f7c049a1ee3b70cb88fd981d4",
    "nextPaid": "66d0b1c95be19c68b26b4923ea3a3fa6aa8ea431936012a1bff2c5a81e4e9222",
    "second": "945d91e05eac8f9eaec703f2873e2dea9bb8d9e6843d888a6dd11fcff4efa3f2",
    "extracted": "cfaa1a4cbaf8d42069fb700f48f65060a24e663d1aec13378010e23e8a292b77",
    "cargoModels": [
      "mount-barrel-ring",
      "receiver-asval",
      "flashlight-mini",
      "muzzle-7.62x39-flash"
    ],
    "cargoWeapons": []
  },
  {
    "now": 1792310004004,
    "weaponId": "vss",
    "type": "subsonic",
    "mapId": "bunker",
    "branch": "recon",
    "paid": "3c2a8d6fb72d6b81b5f6058f1286d98b0073ea81ad9573927b57d81d1187bbbd",
    "first": "51389674af568c62a18781ca7666a4019df3caf59d7fca9af1515745eb496994",
    "choices": "d55a71c3968a4842236a77630ac021f5b5aa811dac072c40a7653c166296cb59",
    "nextPaid": "8ed7b77df60de25cc8a68fd5c48085730bcde58a6cf0e36db9d320522f186cad",
    "second": "f8dfa6b39409a8e8fe5c5a6340e8ee5e588588d41ff05b2c6eabea67a021f7c1",
    "extracted": "b58f25c209bc4da18daee22baa9cd94a6500c05ac5f4333ddbe425c65c05c103",
    "cargoModels": [
      "flashlight-taped",
      "mount-dovetail-low"
    ],
    "cargoWeapons": [
      "vss"
    ]
  },
  {
    "now": 1792310005002,
    "weaponId": "svd",
    "type": "tracer",
    "mapId": "depot",
    "branch": "scavenge",
    "paid": "92ce45efbc45a48a2b3432f5052063e753e5adab86d44b28daea6b4ae653171c",
    "first": "f855d749486d4d71f96832e463b03405d00fe84fc1cb8263fac5379c3c6bded4",
    "choices": "af6d6e8ff8e8d4d87eda726b94958e1f06cb1210f2e7556bda9246a4ae96a765",
    "nextPaid": "6d26f01a158d004bf9bf2409e47ea43569af2741751df5f75c9ab7a09c4a0ca6",
    "second": "db2f04599c390557f4c4cf53c370d483f2e728da99a2ecd088eaa91ef1a19144",
    "extracted": "e4ca9af59158766bcab7229d1a99c001717ce437d9bf703b2c36664ecea30006",
    "cargoModels": [],
    "cargoWeapons": []
  },
  {
    "now": 1792310006001,
    "weaponId": "sks",
    "type": "highpressure",
    "mapId": "bunker",
    "branch": "combat",
    "paid": "56fb896d8fac83bf14c307ce48bd13012667ce50f9f678a604e69f4da23cd6ce",
    "first": "84eedf050fc5a88936c6e1b3989fb8b7aefcb7055bdd71e5308196d1a411da77",
    "choices": "3d80fc4f8a86d572410a1d480404376d899748c457fdca81a91287f1d1be2c4b",
    "nextPaid": "5bc90b7c3671dd8b837f0525e9e082656393e9b9cc1e67fb6659557fa16d3d20",
    "second": "53d4d1f5dc2596dfad07598f27611191dd2517a8f8436e7b312733fbc41566b0",
    "extracted": "f9b3cce57177357865d3e0cfdd39451065e9b30ff0cb0d7bf8e4143d7f2da522",
    "cargoModels": [
      "foregrip-stubby",
      "laser-micro",
      "mount-barrel-dual"
    ],
    "cargoWeapons": []
  },
  {
    "now": 1792310007003,
    "weaponId": "mp133",
    "type": "surplus",
    "mapId": "reserve",
    "branch": "recon",
    "paid": "f95a4d54f32f47c261e17ce6a5a4b87a883149f1fb26abfd2547857dbae729bf",
    "first": "26715fdc2ef7072246166799e04babbaa3aa3f090d7cd6d66a0f76d7da4377d4",
    "choices": "41c2a624ab017a2c2fd5a1b32ba112b60e8c6e26cad39e55f7e1c1e2f995a221",
    "nextPaid": "0c5d78d3d0373f203c344f99bd3ac27ee5bc8700ba97fc0df25e4da9032e6b2c",
    "second": "01f79a02e3980a1f3de5f2da3f65f3d9ee41fece9054d1091e130ce7b0b2459f",
    "extracted": "823ee9b51448f3b2599d00f7094f05bbbba9eb624b8a8125c7e6a8da42e6c791",
    "cargoModels": [
      "factory-asval-handguard",
      "receiver-rpk"
    ],
    "cargoWeapons": []
  }
] as const;

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
	return JSON.stringify(value);
}
const fingerprint = (value: unknown) => new Bun.CryptoHasher("sha256").update(canonical(value)).digest("hex");
function oldFormat(state: GameState) {
	const raw = JSON.parse(saveGame(state)); raw.schemaVersion = 15;
	const lootArrays = [raw.lootItems, ...raw.raids.map((raid: { expedition?: { cargo?: { lootItems?: unknown[] } } }) => raid.expedition?.cargo?.lootItems), ...raw.history.flatMap((report: { lootItems?: unknown[]; lootAutoSold?: unknown[]; lostCargo?: { lootItems?: unknown[] } }) => [report.lootItems, report.lootAutoSold, report.lostCargo?.lootItems])];
	for (const items of lootArrays) expect(items?.length ?? 0).toBe(0);
	withoutLoot(raw);
	for (const raid of raw.raids) if (raid.expedition) delete raid.expedition.lootCatalogVersion;
	return raw;
}
const stateFingerprint = (state: GameState) => fingerprint(oldFormat(state));
function departRecipe(fixture: { now: number; weaponId: string; mapId: string; type: AmmoType }): GameState {
	const state = createGame(fixture.now), scav = state.scavs[0]!;
	state.money = 100_000; state.supplies = { ammo: 10_000, medicine: 100, scrap: 1_000, intel: 100 };
	state.level = 9; state.xp = 5_760;
	useWeaponPlatformFixture(state, state.weapons[0]!, fixture.weaponId);
	scav.combat = 90; scav.scouting = 90;
	state.sectorIntel = { [fixture.mapId]: { knowledge: 3, pressure: 2 } };
	for (const action of [setRaidTactic(state, scav.id, "cautious"), setLoadoutOption(state, scav.id, "ammoType", fixture.type), setRaidPlan(state, scav.id, "intel", "scouted"), dispatchRaid(state, scav.id, fixture.mapId, state.lastUpdated)]) expect(action.ok).toBe(true);
	return state;
}
function paidFixture(fixture: typeof FIXTURES[number]): GameState {
	const state = departRecipe(fixture);
	const raw = oldFormat(state);
	expect(fingerprint(raw)).toBe(fixture.paid);
	const migrated = parseSave(JSON.stringify(raw));
	expect(migrated).not.toBeNull();
	expect(migrated!.raids[0]!.expedition!.lootCatalogVersion).toBeUndefined();
	return migrated!;
}
function settleIrregularly(state: GameState, until: number) {
	const intervals = [271, 2_093, 11_017, 997, 37_021];
	for (let index = 0; state.lastUpdated < until; index++) advance(state, Math.min(until, state.lastUpdated + intervals[index % intervals.length]!));
}

describe("paid v15 expeditions retain their original weapon and module loot catalogue", () => {
	test("all eight genuine legacy ammunition saves settle exactly as the released engine with matching offline results", () => {
		for (const fixture of FIXTURES) {
			const state = paidFixture(fixture), raw = saveGame(state), irregular = parseSave(raw)!, until = state.raids[0]!.endsAt;
			advance(state, until); settleIrregularly(irregular, until);
			expect(stateFingerprint(state)).toBe(fixture.first);
			expect(irregular).toEqual(state);
			expect(loadGameWithSummary(raw, until)!.state).toEqual(state);
			const restored = parseSave(saveGame(state));
			expect(restored).toEqual(state);
			expect(restored!.raids[0]!.expedition!.lootCatalogVersion).toBeUndefined();
		}
	});

	test("continuing an old paid sortie preserves its real quotes, seeded weapons and modules, payout and offline settlement", () => {
		let moduleLoot = 0, weaponLoot = 0;
		for (const fixture of FIXTURES) {
			const state = paidFixture(fixture), raid = state.raids[0]!;
			advance(state, raid.endsAt);
			const perk = raid.expedition!.offers[0]!;
			expect(fingerprint(getExpeditionChoices(state, raid, perk))).toBe(fixture.choices);
			expect(continueExpedition(state, raid.id, fixture.branch, perk, state.lastUpdated).ok).toBe(true);
			expect(stateFingerprint(state)).toBe(fixture.nextPaid);
			expect(raid.expedition!.lootCatalogVersion).toBeUndefined();
			const raw = saveGame(state), irregular = parseSave(raw)!, until = raid.endsAt;
			advance(state, until); settleIrregularly(irregular, until);
			expect(stateFingerprint(state)).toBe(fixture.second);
			expect(irregular).toEqual(state);
			expect(loadGameWithSummary(raw, until)!.state).toEqual(state);
			expect(raid.expedition!.cargo.modules.map((module) => module.modelId)).toEqual([...fixture.cargoModels]);
			expect(raid.expedition!.cargo.weaponIds).toEqual([...fixture.cargoWeapons]);
			moduleLoot += fixture.cargoModels.length; weaponLoot += fixture.cargoWeapons.length;
			expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
			expect(stateFingerprint(state)).toBe(fixture.extracted);
			expect(parseSave(saveGame(state))).toEqual(state);
		}
		expect(moduleLoot).toBeGreaterThan(0);
		expect(weaponLoot).toBeGreaterThan(0);
	});

	test("new departures pin the current catalogue and an old-format save cannot inject that future flag", () => {
		const state = createGame(FIXTURES[0].now);
		expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.raids[0]!.expedition!.lootCatalogVersion).toBe(SAVE_VERSION);
		expect(state.raids[0]!.expedition!.lootCatalogVersion!).toBeGreaterThanOrEqual(ARSENAL_SAVE_VERSION);
		expect(parseSave(saveGame(state))).toEqual(state);
		const raw = JSON.parse(saveGame(state)); raw.schemaVersion = 15;
		withoutLoot(raw);
		expect(parseSave(JSON.stringify(raw))).toBeNull();
		delete raw.raids[0].expedition.lootCatalogVersion;
		expect(parseSave(JSON.stringify(raw))).not.toBeNull();
	});
});

// The released loot/flea v16 engine at 7d307ea generated these real paid saves.
// Unlike v15, these retain lootVersion, individual trophies and their receipts.
const V16_FIXTURES = [
  {
    "now": 1792310003004,
    "weaponId": "akm",
    "type": "precision",
    "mapId": "reserve",
    "branch": "combat",
    "paid": "db65a4836e99e19dc17fbdc5f767e84da5bd339029c25bb8fae6c6067ed757b2",
    "first": "0b4f05604e3553b8592f1017cfa1c6abd2fb544f247f502ab17582b0b1e07830",
    "choices": "290918d41fe566214a76c8d5e0f6b51618ec829f7c049a1ee3b70cb88fd981d4",
    "nextPaid": "902f400aa0382b98c9967fece032fb2fcd24649f2ea2c94f6adb54814f7f6307",
    "second": "29f910a70fb8c23f2751f077107b0351144e0aca45e9f2db46cce858dbe12e7d",
    "extracted": "e10d5bb4add3988e4726fee3796ea911a062c54a45fc9f75408db6a8443b1217",
    "cargoModels": [
      "mount-barrel-ring",
      "receiver-asval",
      "flashlight-mini",
      "muzzle-7.62x39-flash"
    ],
    "cargoWeapons": [],
    "cargoLoot": [
      "patrol-log",
      "antiseptic"
    ]
  },
  {
    "now": 1792310006001,
    "weaponId": "sks",
    "type": "highpressure",
    "mapId": "bunker",
    "branch": "combat",
    "paid": "b025df40019f3ec948d1381e63ee1e31066f069a1dd3e6eb7b868e66f4a36c03",
    "first": "1e10af669f9a307a83674d15baf9ed27887964c942e627a92dbba599ed1cadc5",
    "choices": "3d80fc4f8a86d572410a1d480404376d899748c457fdca81a91287f1d1be2c4b",
    "nextPaid": "c1e8490d7550d5312071c341e8af4e1c3d2076d466c027e693513bd7f43897d0",
    "second": "114cedad97499e0d1559c1f67c300e6cc29955983899d97a41fa72f44d90d185",
    "extracted": "4aa0f2c40b7d75cac62e2a24c56d50b8482ccf12e8e830a4750dabe1dd670954",
    "cargoModels": [
      "foregrip-stubby",
      "laser-micro",
      "mount-barrel-dual"
    ],
    "cargoWeapons": [],
    "cargoLoot": [
      "tool-case",
      "battery"
    ]
  }
] as const;
function v16Fingerprint(state: GameState): string {
	const raw = JSON.parse(saveGame(state)); raw.schemaVersion = 16;
	for (const raid of raw.raids) if (raid.expedition) delete raid.expedition.lootCatalogVersion;
	return fingerprint(raw);
}
test("released v16 paid trophies, receipt provenance and seed outcomes migrate without enabling future arsenal drops", () => {
	for (const fixture of V16_FIXTURES) {
		const departed = withoutArsenalLoot(departRecipe(fixture)), raw = JSON.parse(saveGame(departed)); raw.schemaVersion = 16;
		expect(fingerprint(raw)).toBe(fixture.paid);
		const state = parseSave(JSON.stringify(raw));
		expect(state).not.toBeNull();
		expect(state).toEqual(departed);
		const raid = state!.raids[0]!;
		expect(raid.lootVersion).toBe(1);
		expect(raid.expedition!.lootCatalogVersion).toBeUndefined();
		advance(state!, raid.endsAt);
		expect(v16Fingerprint(state!)).toBe(fixture.first);
		const perk = raid.expedition!.offers[0]!;
		expect(fingerprint(getExpeditionChoices(state!, raid, perk))).toBe(fixture.choices);
		expect(continueExpedition(state!, raid.id, fixture.branch, perk, state!.lastUpdated).ok).toBe(true);
		expect(v16Fingerprint(state!)).toBe(fixture.nextPaid);
		const active = saveGame(state!), restored = parseSave(active)!, until = raid.endsAt;
		advance(state!, until); settleIrregularly(restored, until);
		expect(v16Fingerprint(state!)).toBe(fixture.second);
		expect(restored).toEqual(state!);
		expect(loadGameWithSummary(active, until)!.state).toEqual(state!);
		expect(raid.expedition!.cargo.lootItems!.map((item) => item.modelId)).toEqual([...fixture.cargoLoot]);
		expect(raid.expedition!.cargo.lootItems!.length).toBeGreaterThan(0);
		expect(raid.expedition!.cargo.modules.map((module) => module.modelId)).toEqual([...fixture.cargoModels]);
		expect(extractRaid(state!, raid.id, state!.lastUpdated).ok).toBe(true);
		expect(v16Fingerprint(state!)).toBe(fixture.extracted);
		expect(state!.history[0]!.lootItems!.length).toBeGreaterThan(0);
		expect(parseSave(saveGame(state!))).toEqual(state);
	}
});
