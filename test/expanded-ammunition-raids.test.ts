import { describe, expect, test } from "bun:test";
import {
	SAVE_VERSION, advance, assignWorker, continueExpedition, createGame, dispatchRaid, dispatchSquadRaid,
	extractRaid, FIELD_KITS, getExpeditionChoices, getFieldKitStock, getLoadoutStats, getRaidQuote,
	getRoomProductionState, getSquadRaidQuote,
	getWeaponRole, getWeaponStats, installModule, loadGameWithSummary, parseSave, removeModule,
	queueFieldKitProduction, saveGame, setAutoRaid, setAutoRaidDepth, setFieldKit, setLoadoutOption,
	setProductionReserve, setRaidPlan, setRaidTactic, setRoomRecipe, setRoomStockTarget,
	type FieldKit, type GameState, type Raid, type WeaponInstance,
} from "../src/game/engine";
import { AMMO_TYPES, getAmmoEffect, getAmmoModel, type AmmoType } from "../src/game/ammunition";
import { MAP_BY_ID, WEAPONS } from "../src/game/data";
import { RECEIVER_INFO } from "../src/game/modules";
import { TACTICS } from "../src/game/operations";
import { EXPEDITION_BRANCHES } from "../src/game/systems";
import { useWeaponPlatformFixture } from "./weapon-fixtures";
import { withoutArsenalLoot } from "./legacy-strategy-fixture";

const NOW = 1_792_010_000_000;
const EXPANDED_TYPES: readonly AmmoType[] = ["subsonic", "tracer", "highpressure", "surplus"];
const RELEASED_TYPES: readonly AmmoType[] = ["standard", "piercing", "expanding", "precision"];

function funded(now = NOW): GameState {
	const state = createGame(now);
	state.money = 100_000;
	state.supplies = { ammo: 10_000, medicine: 100, scrap: 1_000, intel: 100 };
	return state;
}
function restore(state: GameState): GameState {
	const copy = parseSave(saveGame(state));
	expect(copy).not.toBeNull();
	return copy!;
}
function settleIrregularly(state: GameState, until: number) {
	const intervals = [271, 2_093, 11_017, 997, 37_021];
	for (let index = 0; state.lastUpdated < until; index++) advance(state, Math.min(until, state.lastUpdated + intervals[index % intervals.length]!));
}
function suppressor(state: GameState, weapon: WeaponInstance) {
	const modelId = `muzzle-${RECEIVER_INFO[weapon.weaponId]!.caliber}-suppressor`;
	const part = { id: `module-${state.nextId++}`, modelId, durability: 100, foundAt: state.lastUpdated };
	state.modules.push(part);
	expect(installModule(state, weapon.id, part.id).ok).toBe(true);
	return part;
}
/** A genuine paid and settled checkpoint; no fabricated chances or combat rolls. */
function checkpoint(type: AmmoType, count = 1, completedRecon = false, legacyCatalog = false): { state: GameState; raid: Raid } {
	for (let offset = 0; offset < 512; offset++) {
		const state = funded(NOW + offset), ids = state.scavs.slice(0, count).map((scav) => scav.id);
		state.sectorIntel = { courtyard: { knowledge: 3, pressure: 2 } };
		for (const [index, id] of ids.entries()) {
			expect(setLoadoutOption(state, id, "ammoType", count === 1 ? type : RELEASED_TYPES[index]!).ok).toBe(true);
			expect(setRaidPlan(state, id, "intel", "scouted").ok).toBe(true);
		}
		expect((count === 1 ? dispatchRaid(state, ids[0]!, "courtyard", state.lastUpdated)
			: dispatchSquadRaid(state, ids, "courtyard", state.lastUpdated)).ok).toBe(true);
		if (legacyCatalog) withoutArsenalLoot(state);
		advance(state, Math.max(...state.raids.map((raid) => raid.endsAt)));
		if (state.raids.length !== count || state.raids.some((raid) => raid.expedition?.status !== "choice")) continue;
		const raid = state.raids[0]!;
		if (completedRecon) {
			expect(continueExpedition(state, raid.id, "recon", raid.expedition!.offers[0]!, state.lastUpdated).ok).toBe(true);
			advance(state, raid.endsAt);
			if (state.raids.length !== count || state.raids.some((member) => member.expedition?.status !== "choice")) continue;
		}
		return { state, raid };
	}
	throw new Error("No genuine expanded-ammunition checkpoint found");
}
/** Released v14 fields are produced and paid through their public actions. */
function logisticsCheckpoint(type: AmmoType, kit: FieldKit): { state: GameState; raid: Raid } {
	for (let offset = 0; offset < 512; offset++) {
		const state = funded(NOW + offset), scav = state.scavs[0]!, worker = state.scavs[1]!;
		const room = state.shelter.rooms.find((item) => item.type === (kit === "maintenance" ? "workshop" : "medbay"))!;
		expect(setProductionReserve(state, { money: 2_000, supplies: { ammo: 60, medicine: 4, scrap: 10, intel: 2 } }, state.lastUpdated).ok).toBe(true);
		for (let batch = 0; batch < 2; batch++) {
			expect(queueFieldKitProduction(state, room.id, kit, state.lastUpdated).ok).toBe(true);
			expect(assignWorker(state, worker.id, room.id, state.lastUpdated).ok).toBe(true);
			const seconds = getRoomProductionState(state, room).remainingSeconds;
			expect(seconds).not.toBeNull();
			advance(state, state.lastUpdated + Math.ceil(seconds! * 1_000));
			expect(assignWorker(state, worker.id, null, state.lastUpdated).ok).toBe(true);
		}
		expect(getFieldKitStock(state)[kit]).toBe(2);
		expect(setRoomRecipe(state, room.id, FIELD_KITS[kit].recipeId, true, state.lastUpdated).ok).toBe(true);
		expect(setRoomStockTarget(state, room.id, 3, state.lastUpdated).ok).toBe(true);
		expect(queueFieldKitProduction(state, room.id, kit, state.lastUpdated).ok).toBe(true);
		state.sectorIntel = { courtyard: { knowledge: 3, pressure: 2 } };
		expect(setFieldKit(state, scav.id, kit).ok).toBe(true);
		expect(setLoadoutOption(state, scav.id, "ammoType", type).ok).toBe(true);
		expect(setRaidPlan(state, scav.id, "intel", "scouted").ok).toBe(true);
		expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
		withoutArsenalLoot(state);
		const raid = state.raids[0]!;
		expect(raid.fieldKit).toBe(kit);
		expect(getFieldKitStock(state)[kit]).toBe(1);
		advance(state, raid.endsAt);
		if (state.raids[0]?.expedition?.status === "choice") return { state, raid };
	}
	throw new Error("No genuine v14 ammunition and logistics checkpoint found");
}

describe("expanded cartridges stay real through dispatch, settlement and saved expeditions", () => {
	test("all platforms dispatch every new cartridge type for exactly the previewed resources and snapshot", () => {
		expect(AMMO_TYPES).toEqual([...RELEASED_TYPES, ...EXPANDED_TYPES]);
		let dispatches = 0;
		for (const definition of WEAPONS) for (const type of EXPANDED_TYPES) {
			const state = funded(), scav = state.scavs[0]!, weapon = state.weapons[0]!, map = MAP_BY_ID.courtyard!;
			useWeaponPlatformFixture(state, weapon, definition.id);
			expect(setLoadoutOption(state, scav.id, "ammoType", type).ok).toBe(true);
			const model = getAmmoModel(weapon, type), quote = getRaidQuote(state, scav, map);
			const before = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel, rng: state.rng };
			expect(quote.ammunition).toEqual(getAmmoEffect(weapon, type, map.id, "scavenge", 1, scav.tactic));
			expect(quote.ammo).toBe(Math.max(1, Math.ceil(map.ammoCost * TACTICS[scav.tactic].ammoMultiplier
				* getWeaponRole(weapon).ammoMultiplier * getWeaponStats(weapon).ammoMultiplier * getLoadoutStats(state, scav).ammoMultiplier * model.ammoMultiplier)));
			for (let index = 0; index < 5; index++) expect(getRaidQuote(state, scav, map)).toEqual(quote);
			expect(state.rng).toBe(before.rng);
			expect(dispatchRaid(state, scav.id, map.id, state.lastUpdated).ok).toBe(true);
			const raid = state.raids[0]!;
			expect(raid.chance).toBe(quote.chance);
			expect(raid.endsAt - raid.startedAt).toBe(quote.duration * 1_000);
			expect(state.money).toBe(before.money - quote.money);
			expect(state.supplies.ammo).toBe(before.ammo - quote.ammo);
			expect(state.supplies.intel).toBe(before.intel - quote.intel);
			expect(raid.expedition!.ammunition).toEqual({ modelId: model.id, firstBonus: quote.ammunition!.bonus,
				wearMultiplier: model.wearMultiplier, ammoMultiplier: model.ammoMultiplier });
			expect(restore(state)).toEqual(state);
			dispatches++;
		}
		expect(dispatches).toBe(WEAPONS.length * EXPANDED_TYPES.length);
	});

	test("each new cartridge commits the actual next-stage quote without changing its paid snapshot", () => {
		for (const type of EXPANDED_TYPES) {
			const { state, raid } = checkpoint(type), expedition = raid.expedition!, perk = expedition.offers[0]!;
			const snapshot = structuredClone(expedition.ammunition), beforePreview = saveGame(state);
			const choices = getExpeditionChoices(state, raid, perk), model = getAmmoModel(state.weapons[0]!, type);
			for (const choice of choices) {
				expect(choice.ammunition).toEqual(getAmmoEffect(state.weapons[0]!, type, raid.mapId, choice.branch, 2, raid.tactic));
				expect(choice.ammo).toBe(Math.max(1, Math.ceil(MAP_BY_ID[raid.mapId]!.ammoCost * TACTICS[raid.tactic].ammoMultiplier
					* EXPEDITION_BRANCHES[choice.branch].ammoMultiplier * expedition.ammoMultiplier * model.ammoMultiplier)
					+ ([...expedition.perks, perk].includes("pathfinder") ? 1 : 0)));
			}
			expect(saveGame(state)).toBe(beforePreview);
			const choice = choices.find((item) => item.branch === "combat")!, before = { money: state.money, ammo: state.supplies.ammo, intel: state.supplies.intel };
			expect(continueExpedition(state, raid.id, choice.branch, perk, state.lastUpdated).ok).toBe(true);
			expect(raid.chance).toBe(choice.chance);
			expect(raid.endsAt - raid.startedAt).toBe(choice.duration * 1_000);
			expect(state.money).toBe(before.money - choice.money);
			expect(state.supplies.ammo).toBe(before.ammo - choice.ammo);
			expect(state.supplies.intel).toBe(before.intel - choice.intel);
			expect(expedition.ammunition).toEqual(snapshot);
			expect(restore(state)).toEqual(state);
		}
	});

	test("subsonic quotes use the real suppressor and cannot silently swap ammunition or remove the silencer mid-raid", () => {
		const state = funded(), scav = state.scavs[0]!, weapon = state.weapons[0]!;
		expect(setLoadoutOption(state, scav.id, "ammoType", "subsonic").ok).toBe(true);
		const bare = getRaidQuote(state, scav, MAP_BY_ID.forest!).ammunition!;
		const part = suppressor(state, weapon), silenced = getRaidQuote(state, scav, MAP_BY_ID.forest!).ammunition!;
		expect(silenced.bonus).toBeGreaterThan(bare.bonus);
		expect(silenced).toEqual(getAmmoEffect(weapon, "subsonic", "forest", "scavenge", 1, scav.tactic));
		const bareWeapon = { ...weapon, modules: { ...weapon.modules } }; delete bareWeapon.modules.muzzle;
		expect(getAmmoEffect(weapon, "subsonic", "forest", "combat", 1, scav.tactic).bonus)
			.toBe(getAmmoEffect(bareWeapon, "subsonic", "forest", "combat", 1, scav.tactic).bonus);
		expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const paid = saveGame(state);
		for (const type of AMMO_TYPES) expect(setLoadoutOption(state, scav.id, "ammoType", type).ok).toBe(false);
		expect(removeModule(state, weapon.id, "muzzle").ok).toBe(false);
		expect(saveGame(state)).toBe(paid);
		expect(restore(state).weapons[0]!.modules.muzzle).toEqual(part);
	});

	test("high-pressure rounds cause real additional receiver wear for matched encounter seeds", () => {
		for (let offset = 0; offset < 12; offset++) {
			const standard = funded(NOW + offset), pressure = funded(NOW + offset);
			const standardWeapon = standard.weapons[0]!, pressureWeapon = pressure.weapons[0]!;
			expect(setLoadoutOption(pressure, pressure.scavs[0]!.id, "ammoType", "highpressure").ok).toBe(true);
			for (const state of [standard, pressure]) expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
			expect(pressure.raids[0]!.seed).toBe(standard.raids[0]!.seed);
			expect(pressure.rng).toBe(standard.rng);
			expect(pressure.raids[0]!.expedition!.ammunition!.wearMultiplier).toBeGreaterThan(1);
			for (const state of [standard, pressure]) advance(state, state.raids[0]!.endsAt);
			expect(pressureWeapon.durability).toBeLessThan(standardWeapon.durability);
			expect(pressureWeapon.modules.receiver!.durability).toBe(pressureWeapon.durability);
		}
	});

	test("the strengthened and cheap surplus charges cause different real wounds in matched failed encounters", () => {
		let compared = false;
		for (let offset = 0; offset < 512 && !compared; offset++) {
			const pressure = funded(NOW + offset), surplus = funded(NOW + offset);
			for (const [state, type] of [[pressure, "highpressure"], [surplus, "surplus"]] as const) {
				state.level = 9; state.xp = 5_760;
				expect(setLoadoutOption(state, state.scavs[0]!.id, "ammoType", type).ok).toBe(true);
				expect(dispatchRaid(state, state.scavs[0]!.id, "bunker", state.lastUpdated).ok).toBe(true);
			}
			const strongRaid = pressure.raids[0]!, cheapRaid = surplus.raids[0]!;
			expect(strongRaid.seed).toBe(cheapRaid.seed);
			expect(pressure.rng).toBe(surplus.rng);
			expect(strongRaid.expedition!.ammunition!.firstBonus).toBeGreaterThan(cheapRaid.expedition!.ammunition!.firstBonus);
			advance(pressure, strongRaid.endsAt); advance(surplus, cheapRaid.endsAt);
			const strongReport = pressure.history.find((report) => report.raidId === strongRaid.id), cheapReport = surplus.history.find((report) => report.raidId === cheapRaid.id);
			if (strongReport?.success !== false || cheapReport?.success !== false) continue;
			const strongScav = pressure.scavs.find((scav) => scav.id === strongRaid.scavId), cheapScav = surplus.scavs.find((scav) => scav.id === cheapRaid.scavId);
			if (!strongScav || !cheapScav) continue;
			expect(strongScav.health).toBeGreaterThan(cheapScav.health);
			expect(pressure.rng).toBe(surplus.rng);
			expect(restore(pressure)).toEqual(pressure); expect(restore(surplus)).toEqual(surplus);
			compared = true;
		}
		expect(compared).toBe(true);
	});

	test("released v13 active loads retain their exact paid snapshots, cargo, recon, strategy and offline settlement", () => {
		for (const type of RELEASED_TYPES) {
			const { state, raid } = checkpoint(type, 1, true, true), paid = structuredClone(raid), raw = JSON.parse(saveGame(state));
			raw.schemaVersion = 13;
			const migrated = parseSave(JSON.stringify(raw));
			expect(migrated).not.toBeNull();
			expect(migrated!.schemaVersion).toBe(SAVE_VERSION);
			expect(migrated).toEqual(state);
			expect(migrated!.raids[0]).toEqual(paid);
			expect(migrated!.raids[0]!.expedition!.reconCompleted).toBe(true);
			expect(migrated!.raids[0]!.expedition!.ammunition).toEqual(paid.expedition!.ammunition);
			expect(migrated!.raids[0]!.expedition!.cargo).toEqual(paid.expedition!.cargo);
			expect(migrated!.sectorIntel).toEqual(state.sectorIntel);
			expect(migrated!.money).toBe(state.money);
			expect(migrated!.supplies).toEqual(state.supplies);
			const perk = raid.expedition!.offers[0]!, choices = getExpeditionChoices(state, raid, perk);
			expect(getExpeditionChoices(migrated!, migrated!.raids[0]!, perk)).toEqual(choices);
			for (const current of [state, migrated!]) expect(continueExpedition(current, current.raids[0]!.id, "combat", perk, current.lastUpdated).ok).toBe(true);
			const offline = saveGame(migrated!), until = raid.endsAt + 3_017;
			advance(state, until); settleIrregularly(migrated!, until);
			expect(migrated).toEqual(state);
			expect(loadGameWithSummary(offline, until)!.state).toEqual(state);
		}
	});

	test("released v14 ammunition preserves paid field kits, reserve and queued production through migration and settlement", () => {
		for (const type of RELEASED_TYPES) for (const kit of ["maintenance", "trauma"] as const) {
			const { state, raid } = logisticsCheckpoint(type, kit), paid = structuredClone(raid), shelter = structuredClone(state.shelter);
			const raw = JSON.parse(saveGame(state)); raw.schemaVersion = 14;
			const migrated = parseSave(JSON.stringify(raw));
			expect(migrated).not.toBeNull();
			expect(migrated!.schemaVersion).toBe(SAVE_VERSION);
			expect(migrated).toEqual(state);
			expect(migrated!.shelter).toEqual(shelter);
			expect(migrated!.raids[0]).toEqual(paid);
			expect(migrated!.raids[0]!.fieldKit).toBe(kit);
			expect(migrated!.scavs[0]!.fieldKit).toBe(kit);
			expect(getFieldKitStock(migrated!)[kit]).toBe(1);
			const room = migrated!.shelter.rooms.find((item) => item.type === (kit === "maintenance" ? "workshop" : "medbay"))!;
			expect(room.stockTarget).toBe(3);
			expect(room.queue[0]!.output.fieldKit).toBe(kit);
			const perk = raid.expedition!.offers[0]!, choices = getExpeditionChoices(state, raid, perk);
			expect(getExpeditionChoices(migrated!, migrated!.raids[0]!, perk)).toEqual(choices);
			for (const current of [state, migrated!]) {
				expect(setFieldKit(current, current.scavs[0]!.id, "none").ok).toBe(true);
				expect(current.raids[0]!.fieldKit).toBe(kit);
				expect(continueExpedition(current, current.raids[0]!.id, "combat", perk, current.lastUpdated).ok).toBe(true);
			}
			const offline = saveGame(migrated!), until = raid.endsAt + 3_017;
			advance(state, until); settleIrregularly(migrated!, until);
			expect(migrated).toEqual(state);
			expect(loadGameWithSummary(offline, until)!.state).toEqual(state);
		}
	});

	test("v13 and v14 cannot inject v15 choices into a free loadout, active paid load or historical squad member", () => {
		const ready = JSON.parse(saveGame(funded())), { state, raid } = checkpoint("standard", 3, false, true);
		const active = JSON.parse(saveGame(state));
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
		const history = JSON.parse(saveGame(state));
		for (const version of [13, 14]) {
			for (const fixture of [ready, active, history]) {
				fixture.schemaVersion = version;
				expect(parseSave(JSON.stringify(fixture))).not.toBeNull();
			}
			for (const type of EXPANDED_TYPES) {
			const scav = structuredClone(ready); scav.scavs[0].loadout.ammoType = type;
			expect(parseSave(JSON.stringify(scav))).toBeNull();
			const paid = structuredClone(active);
			paid.scavs[0].loadout.ammoType = type;
			paid.raids[0].expedition.loadout.ammoType = type;
			const model = getAmmoModel(state.weapons.find((weapon) => weapon.id === active.raids[0].weaponInstanceId)!, type);
			paid.raids[0].expedition.ammunition.modelId = model.id;
			paid.raids[0].expedition.ammunition.wearMultiplier = model.wearMultiplier;
			paid.raids[0].expedition.ammunition.ammoMultiplier = model.ammoMultiplier;
			for (const member of paid.raids) member.squad.members[0].loadout.ammoType = type;
			expect(parseSave(JSON.stringify(paid))).toBeNull();
			const historical = structuredClone(history);
			for (const report of historical.history) report.squad.members[0].loadout.ammoType = type;
			expect(parseSave(JSON.stringify(historical))).toBeNull();
			}
		}
	});

	test("new types survive repeated automatic sorties with identical bulk, irregular and offline results", () => {
		for (const type of EXPANDED_TYPES) {
			const initial = funded();
			for (const scav of initial.scavs) {
				expect(setLoadoutOption(initial, scav.id, "ammoType", type).ok).toBe(true);
				expect(setRaidTactic(initial, scav.id, "cautious").ok).toBe(true);
				expect(setAutoRaidDepth(initial, scav.id, 3).ok).toBe(true);
				expect(setAutoRaid(initial, scav.id, "courtyard", 25, initial.lastUpdated).ok).toBe(true);
			}
			expect(initial.raids).toHaveLength(3);
			const bulk = restore(initial), irregular = restore(initial), until = initial.lastUpdated + 5 * 60_000;
			advance(bulk, until); settleIrregularly(irregular, until);
			expect(bulk.history.length).toBeGreaterThan(0);
			expect(irregular).toEqual(bulk);
			expect(loadGameWithSummary(saveGame(initial), until)!.state).toEqual(bulk);
			expect(restore(bulk)).toEqual(bulk);
		}
	});

	test("mixed-calibre squad quotes charge each member's new ammunition including actual suppressed assemblies", () => {
		const state = funded(), ids = state.scavs.map((scav) => scav.id), types = ["subsonic", "highpressure", "surplus"] as const;
		for (const [index, scav] of state.scavs.entries()) {
			const weapon = state.weapons.find((item) => item.id === scav.weaponInstanceId)!;
			useWeaponPlatformFixture(state, weapon, ["sks", "pm", "ak74"][index]!);
			if (index === 0) suppressor(state, weapon);
			expect(setLoadoutOption(state, scav.id, "ammoType", types[index]!).ok).toBe(true);
		}
		const singles = state.scavs.map((scav) => getRaidQuote(state, scav, MAP_BY_ID.courtyard!));
		const squad = getSquadRaidQuote(state, ids, "courtyard"), before = state.supplies.ammo;
		expect(squad.ammo).toBe(singles.reduce((sum, quote) => sum + quote.ammo, 0));
		expect(dispatchSquadRaid(state, ids, "courtyard", state.lastUpdated).ok).toBe(true);
		expect(state.supplies.ammo).toBe(before - squad.ammo);
		for (const [index, raid] of state.raids.entries()) {
			expect(raid.expedition!.ammunition!.firstBonus).toBe(singles[index]!.ammunition!.bonus);
			expect(raid.expedition!.ammunition!.modelId).toBe(singles[index]!.ammunition!.model.id);
			expect(raid.squad!.members[index]!.loadout.ammoType).toBe(types[index]!);
		}
		expect(restore(state)).toEqual(state);
	});
});
