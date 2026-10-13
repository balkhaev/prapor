import { describe, expect, test } from "bun:test";
import { MAPS } from "../src/game/data";
import {
	MAX_OFFLINE_MS, SAVE_VERSION, advance, assignWorker, continueExpedition,
	dispatchRaid, dispatchSquadRaid, equipWeapon, extractRaid, getExpeditionChoices,
	getLossReaction, getRaidGroup, getRaidGroupKey, getRaidQuote, getRoomUpgradeQuote,
	getSquadRaidActions, getSquadRaidQuote, getSquadSocialEvents,
	loadGameWithSummary, modWeapon, parseSave, queueModuleProduction, resolveSocialEvent,
	saveGame, sellWeapon, setAutoRaid, setLoadoutOption, setRaidTactic, upgradeRoom,
	type GameState, type Raid, type RaidReport,
} from "../src/game/engine";
import { exportGameSave, parseGameSave } from "../src/game-save";
import { readGameSession } from "../src/game-session";
import { fundedSquadFixture as funded, earnSquadRelationship as earnRelationship, genuineSquadSettlement as genuineSettlement } from "./squad-raid-fixtures";

const NOW = 1_792_000_000_000;

function ids(state: GameState, count = 3) { return state.scavs.slice(0, count).map((scav) => scav.id); }

function copy(state: GameState) {
	const parsed = parseSave(saveGame(state));
	expect(parsed).not.toBeNull();
	return parsed!;
}

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

function tickIrregularly(state: GameState, until: number) {
	const intervals = [997, 131, 7_001, 20_013, 301, 8_999];
	for (let index = 0; state.lastUpdated < until; index++)
		advance(state, Math.min(until, state.lastUpdated + intervals[index % intervals.length]!));
}

/** Find a genuine successful party arrival without forcing a roll or mutating a combat snapshot. */
function checkpoint(count = 3, setup?: (state: GameState) => void) {
	for (let offset = 0; offset < 512; offset++) {
		const state = funded(NOW + offset);
		setup?.(state);
		const memberIds = ids(state, count);
		expect(dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated).ok).toBe(true);
		const departures = structuredClone(state.raids);
		advance(state, Math.max(...state.raids.map((raid) => raid.endsAt)));
		if (state.raids.length === count && state.raids.every((raid) => raid.expedition?.status === "choice"))
			return { state, raids: state.raids, memberIds, departures, offset };
	}
	throw new Error("No genuine successful squad checkpoint found");
}

function physicalIds(state: GameState) {
	return [...state.modules, ...state.weapons.flatMap((gun) => Object.values(gun.modules)),
		...state.raids.flatMap((raid) => raid.expedition?.cargo.modules ?? [])].map((part) => part.id);
}

function outcome(report: RaidReport, scavId: string) { return report.squad!.outcomes.find((item) => item.scavId === scavId)!; }

function memberSucceeded(state: GameState, raid: Raid) {
	return state.raids.find((item) => item.id === raid.id)?.expedition?.status === "choice"
		|| state.history.find((item) => item.raidId === raid.id)?.success === true;
}

describe("coordinated two and three scav expeditions", () => {
	test("a frozen preview is pure, deterministic, itemized and costs each real loadout once", () => {
		const state = funded(), memberIds = ids(state);
		state.scavs[1]!.loadout.medkit = true;
		state.scavs[2]!.loadout.medkit = true;
		const saved = saveGame(state);
		freeze(state);
		const quote = getSquadRaidQuote(state, memberIds, "courtyard");
		expect(quote.reason).toBeNull();
		expect(quote.members.map((member) => member.scavId)).toEqual(memberIds);
		for (const key of ["money", "ammo", "intel", "medicine"] as const)
			expect(quote[key]).toBe(quote.members.reduce((sum, member) => sum + member[key], 0));
		expect(quote.medicine).toBe(2);
		expect(quote.rescueKits).toBe(2);
		expect(new Set(quote.members.map((member) => member.role)).size).toBe(3);
		expect(quote.relationships).toHaveLength(3);
		for (let index = 0; index < 20; index++) expect(getSquadRaidQuote(state, memberIds, "courtyard")).toEqual(quote);
		expect(saveGame(state)).toBe(saved);
	});

	test("invalid size, identity, sector and clock never consume funds or random draws", () => {
		const state = funded(), memberIds = ids(state), saved = saveGame(state);
		for (const selected of [[], memberIds.slice(0, 1), [...memberIds, memberIds[0]!], [memberIds[0]!, memberIds[0]!], [memberIds[0]!, "scav-missing"]]) {
			expect(getSquadRaidQuote(state, selected, "courtyard").reason).not.toBeNull();
			expect(dispatchSquadRaid(state, selected, "courtyard", state.lastUpdated).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
		for (const mapId of ["missing", "constructor", "__proto__", MAPS.find((map) => map.level > state.level)!.id]) {
			expect(dispatchSquadRaid(state, memberIds, mapId, state.lastUpdated).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
		for (const now of [NaN, Infinity, -1]) {
			expect(dispatchSquadRaid(state, memberIds, "courtyard", now).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
	});

	test("a blocked teammate or unaffordable total cannot launch a partial group", () => {
		for (const block of ["health", "unarmed", "broken", "assignment", "money", "ammo", "medicine", "intel"] as const) {
			const state = funded(), memberIds = ids(state), member = state.scavs[2]!;
			if (block === "health") member.health = 24;
			if (block === "unarmed") expect(equipWeapon(state, member.id, null).ok).toBe(true);
			if (block === "broken") state.weapons.find((gun) => gun.id === member.weaponInstanceId)!.durability = 9;
			if (block === "assignment") expect(assignWorker(state, member.id, state.shelter.rooms.find((room) => room.type === "workshop")!.id, state.lastUpdated).ok).toBe(true);
			if (block === "medicine") { member.loadout.medkit = true; state.supplies.medicine = 0; }
			if (block === "money") state.money = getSquadRaidQuote(state, memberIds, "courtyard").money - 1;
			if (block === "ammo") state.supplies.ammo = getSquadRaidQuote(state, memberIds, "courtyard").ammo - 1;
			const mapId = block === "intel" ? MAPS.find((map) => map.intelCost > 0)!.id : "courtyard";
			if (block === "intel") { state.level = 9; state.xp = 5760; state.supplies.intel = 0; }
			const saved = saveGame(state);
			expect(getSquadRaidQuote(state, memberIds, mapId).reason).not.toBeNull();
			expect(dispatchSquadRaid(state, memberIds, mapId, state.lastUpdated).ok).toBe(false);
			expect(saveGame(state)).toBe(saved);
		}
	});

	test("dispatch commits two or three real members with shared route and timing while retaining personal faces and equipment", () => {
		for (const count of [2, 3]) {
			const state = funded(), memberIds = ids(state, count), quote = getSquadRaidQuote(state, memberIds, "courtyard"), before = structuredClone(state);
			const result = dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated);
			expect(result.ok).toBe(true);
			expect(state.raids).toHaveLength(count);
			expect(result.raidId).toBe(state.raids[0]!.id);
			expect(new Set(state.raids.map((raid) => raid.id)).size).toBe(count);
			expect(new Set(state.raids.map((raid) => getRaidGroupKey(raid))).size).toBe(1);
			expect(new Set(state.raids.map((raid) => raid.endsAt)).size).toBe(1);
			expect(state.raids.every((raid) => raid.startedAt === before.lastUpdated && raid.endsAt === before.lastUpdated + quote.duration * 1_000)).toBe(true);
			for (const raid of state.raids) {
				const scav = before.scavs.find((item) => item.id === raid.scavId)!;
				expect(getRaidGroup(state, raid).map((member) => member.scavId)).toEqual(memberIds);
				expect(raid.scavAppearance).toBe(scav.appearance);
				expect(raid.weaponInstanceId).toBe(scav.weaponInstanceId!);
				expect(raid.expedition?.baseDuration).toBeGreaterThan(0);
			}
			expect(state.money).toBe(before.money - quote.money);
			for (const key of ["ammo", "medicine", "intel"] as const) expect(state.supplies[key]).toBe(before.supplies[key] - quote[key]);
			expect(state.scavs.filter((scav) => scav.status === "raiding")).toHaveLength(count);
			expect(parseSave(saveGame(state))).not.toBeNull();
		}
	});

	test("all active members and all physical weapons stay locked; a second launch cannot duplicate them", () => {
		const state = funded(), memberIds = ids(state);
		expect(dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated).ok).toBe(true);
		const saved = saveGame(state), spare = state.weapons.find((gun) => !state.scavs.some((scav) => scav.weaponInstanceId === gun.id))!;
		for (const scav of state.scavs) {
			expect(dispatchRaid(state, scav.id, "courtyard", state.lastUpdated).ok).toBe(false);
			expect(equipWeapon(state, scav.id, spare.id).ok).toBe(false);
			expect(sellWeapon(state, scav.weaponInstanceId!).ok).toBe(false);
			expect(modWeapon(state, scav.weaponInstanceId!, "stock").ok).toBe(false);
		}
		expect(dispatchSquadRaid(state, memberIds.slice(0, 2), "courtyard", state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
	});

	test("the minimum healthy team is allowed but two people cannot claim one physical weapon", () => {
		const state = funded(), memberIds = ids(state, 2);
		for (const scav of state.scavs.slice(0, 2)) scav.health = 25;
		expect(getSquadRaidQuote(state, memberIds, "courtyard").reason).toBeNull();
		expect(dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated).ok).toBe(true);
		const duplicate = funded(); duplicate.scavs[1]!.weaponInstanceId = duplicate.scavs[0]!.weaponInstanceId;
		const saved = saveGame(duplicate);
		expect(getSquadRaidQuote(duplicate, ids(duplicate, 2), "courtyard").reason).not.toBeNull();
		expect(dispatchSquadRaid(duplicate, ids(duplicate, 2), "courtyard", duplicate.lastUpdated).ok).toBe(false);
		expect(saveGame(duplicate)).toBe(saved);
	});

	test("a successful arrival gives a common decision without banking cargo or manufacturing an extra friendship", () => {
		const { state, raids } = checkpoint(), before = structuredClone(state.social);
		expect(state.history).toHaveLength(0);
		expect(state.stats.raidsCompleted).toBe(0);
		expect(new Set(raids.map((raid) => JSON.stringify(raid.expedition!.offers))).size).toBe(1);
		expect(raids.every((raid) => raid.expedition!.cargo.money > 0)).toBe(true);
		expect(state.social.pairs.every((pair) => pair.sortiesTogether === 0)).toBe(true);
		const saved = saveGame(state), rng = state.rng;
		for (let index = 0; index < 20; index++) for (const raid of raids) getExpeditionChoices(state, raid, raid.expedition!.offers[0]);
		expect(saveGame(state)).toBe(saved);
		expect(state.rng).toBe(rng);
		expect(state.social).toEqual(before);
	});

	test("any teammate selects one shared next stage and pays the group quote exactly once", () => {
		const { state, raids } = checkpoint(), raid = raids[2]!, perk = raid.expedition!.offers[0]!;
		const quotes = raids.map((member) => getExpeditionChoices(state, member, perk));
		expect(quotes[1]).toEqual(quotes[0]); expect(quotes[2]).toEqual(quotes[0]);
		const quote = quotes[0]!.find((choice) => choice.branch === "recon")!, before = structuredClone(state);
		expect(continueExpedition(state, raid.id, "recon", perk, state.lastUpdated).ok).toBe(true);
		expect(state.money).toBe(before.money - quote.money);
		expect(state.supplies.ammo).toBe(before.supplies.ammo - quote.ammo);
		expect(state.supplies.intel).toBe(before.supplies.intel - quote.intel);
		expect(state.raids.every((member) => member.expedition!.stage === 2 && member.expedition!.branch === "recon" && member.expedition!.status === "travel" && member.expedition!.perks.includes(perk))).toBe(true);
		expect(new Set(state.raids.map((member) => member.endsAt)).size).toBe(1);
		const saved = saveGame(state);
		for (const member of state.raids) expect(continueExpedition(state, member.id, "recon", perk, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expect(parseSave(saved)).not.toBeNull();
	});

	test("an unaffordable group continuation leaves every member at the checkpoint", () => {
		const { state, raids } = checkpoint(), raid = raids[1]!, perk = raid.expedition!.offers[0]!;
		state.money = getExpeditionChoices(state, raid, perk).find((choice) => choice.branch === "combat")!.money - 1;
		const saved = saveGame(state);
		expect(continueExpedition(state, raid.id, "combat", perk, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
		expect(state.raids.every((member) => member.expedition!.status === "choice")).toBe(true);
	});

	test("extracting from any member banks every physical cargo once and produces exactly one report per real person", () => {
		const { state, raids, memberIds } = checkpoint(), carried = raids.flatMap((raid) => raid.expedition!.cargo.modules.map((part) => ({ ...part })));
		const before = structuredClone(state), raidIds = raids.map((raid) => raid.id);
		expect(extractRaid(state, raids[1]!.id, state.lastUpdated).ok).toBe(true);
		expect(state.raids).toHaveLength(0); expect(state.history).toHaveLength(3);
		expect(state.stats.raidsCompleted).toBe(3);
		expect(new Set(state.history.map((report) => report.raidId))).toEqual(new Set(raidIds));
		expect(state.history.every((report) => report.success && !report.lostScav)).toBe(true);
		expect(state.money).toBe(before.money + state.history.reduce((sum, report) => sum + report.money, 0));
		for (const part of carried) expect(state.modules.find((item) => item.id === part.id)).toEqual(part);
		expect(new Set(physicalIds(state)).size).toBe(physicalIds(state).length);
		for (const memberId of memberIds) expect(state.scavs.find((scav) => scav.id === memberId)!.raids).toBe(1);
		expect(state.social.pairs.every((pair) => pair.sortiesTogether === 1)).toBe(true);
		const saved = saveGame(state);
		for (const raidId of raidIds) {
			expect(extractRaid(state, raidId, state.lastUpdated).ok).toBe(false);
			expect(continueExpedition(state, raidId, "combat", "careful", state.lastUpdated).ok).toBe(false);
		}
		expect(advance(state, state.lastUpdated).completedCount).toBe(0);
		expect(saveGame(state)).toBe(saved);
		expect(parseSave(saved)).not.toBeNull();
	});

	test("midstage reload and irregular online ticks settle the exact same inventories, deaths, social ledger and random state", () => {
		const initial = funded();
		expect(dispatchSquadRaid(initial, ids(initial), "courtyard", initial.lastUpdated).ok).toBe(true);
		const midpoint = initial.lastUpdated + Math.round((initial.raids[0]!.endsAt - initial.lastUpdated) * .58);
		advance(initial, midpoint);
		const bulk = copy(initial), irregular = copy(initial), until = initial.raids[0]!.endsAt + 17_019;
		advance(bulk, until); tickIrregularly(irregular, until);
		const imported = loadGameWithSummary(saveGame(initial), until)!;
		expect(irregular).toEqual(bulk); expect(imported.state).toEqual(bulk);
		expect(parseSave(saveGame(bulk))).not.toBeNull();
	});

	test("a saved party decision survives the eight hour cap and clock rollback without rerolling cargo or replaying events", () => {
		const { state } = checkpoint(), before = structuredClone(state.raids), rng = state.rng, nextId = state.nextId;
		const loaded = loadGameWithSummary(saveGame(state), state.lastUpdated + MAX_OFFLINE_MS * 3)!;
		expect(loaded.summary.capped).toBe(true); expect(loaded.summary.completedCount).toBe(0);
		expect(loaded.state.rng).toBe(rng); expect(loaded.state.nextId).toBe(nextId);
		for (const raid of loaded.state.raids) {
			const old = before.find((item) => item.id === raid.id)!;
			expect(raid.expedition!.cargo).toEqual(old.expedition!.cargo);
			expect(raid.expedition!.perks).toEqual(old.expedition!.perks);
			expect(raid.squad).toEqual(old.squad);
		}
		const rollback = loadGameWithSummary(saveGame(loaded.state), NOW - 60_000)!;
		expect(rollback.summary.elapsedMs).toBe(0);
		expect(new Set(rollback.state.raids.map((raid) => raid.endsAt)).size).toBe(1);
		expect(rollback.state.raids.every((raid) => raid.expedition!.trail.every((event, index, all) => event.at <= rollback.state.lastUpdated && (index === 0 || event.at >= all[index - 1]!.at)))).toBe(true);
		expect(parseSave(saveGame(rollback.state))).not.toBeNull();
		const saved = saveGame(rollback.state); advance(rollback.state, rollback.state.lastUpdated);
		expect(saveGame(rollback.state)).toBe(saved);
	});

	test("an export restores the actual linked member and selected raid screen, not a new formation or owned inventory", () => {
		const state = funded(); expect(dispatchSquadRaid(state, ids(state), "courtyard", state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + 7_019);
		const raid = state.raids[2]!, session = { version: 1, page: "raids", view: "raid", raidId: raid.id, scavId: raid.scavId, mapId: raid.mapId };
		const exported = exportGameSave(state, session), restored = parseGameSave(exported, state.lastUpdated)!;
		expect(restored.state).toEqual(state);
		const view = readGameSession(restored.session, restored.state);
		expect(view.raidId).toBe(raid.id); expect(view.scavId).toBe(raid.scavId); expect(view.view).toBe("raid");
		expect(getRaidGroup(restored.state, restored.state.raids[2]!).map((member) => member.scavId)).toEqual(ids(state));
	});

	test("a saved draft deduplicates live physical identities, keeps an explicit empty selection, and never reserves people or kit", () => {
		const state = funded(), saved = saveGame(state), memberIds = ids(state);
		const session = readGameSession({ version: 1, squadDraft: [memberIds[2], "scav-missing", memberIds[2], memberIds[0], memberIds[1], "scav-missing"] }, state);
		expect(session.squadDraft).toEqual([memberIds[2]!, memberIds[0]!, memberIds[1]!]);
		expect(readGameSession({ version: 1, squadDraft: [] }, state).squadDraft).toEqual([]);
		expect(readGameSession({ version: 1 }, state).squadDraft).toEqual(memberIds.slice(0, 2));
		const restored = parseGameSave(exportGameSave(state, session), state.lastUpdated)!;
		expect(readGameSession(restored.session, restored.state).squadDraft).toEqual(session.squadDraft);
		expect(saveGame(state)).toBe(saved);
		expect(dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated).ok).toBe(true);
		const active = saveGame(state); expect(readGameSession(session, state).squadDraft).toEqual(session.squadDraft);
		expect(saveGame(state)).toBe(active);
	});

	test("a v8 solo raid keeps its original paid costs, seed, duration, chance and true solo relationship provenance", () => {
		const state = funded(); expect(dispatchRaid(state, state.scavs[0]!.id, "courtyard", state.lastUpdated).ok).toBe(true);
		const before = structuredClone(state), raw = JSON.parse(saveGame(state));
		raw.schemaVersion = 8; for (const raid of raw.raids) delete raid.squad; for (const report of raw.history) delete report.squad;
		const restored = parseSave(JSON.stringify(raw))!;
		expect(restored).not.toBeNull(); expect(restored.schemaVersion).toBe(SAVE_VERSION);
		expect(restored.money).toBe(before.money); expect(restored.supplies).toEqual(before.supplies); expect(restored.rng).toBe(before.rng);
		const raid = restored.raids[0]!;
		for (const key of ["id", "scavId", "seed", "chance", "startedAt", "endsAt", "weaponInstanceId"] as const) expect(raid[key]).toEqual(before.raids[0]![key]);
		expect(getRaidGroup(restored, raid)).toEqual([raid]);
		advance(restored, raid.endsAt); advance(before, before.raids[0]!.endsAt);
		expect(restored).toEqual(before);
		expect(restored.social.pairs.every((pair) => pair.sortiesTogether === 0)).toBe(true);
	});

	test("earned friend and rival ties are frozen into combat instead of changing an active party when shelter relationships change", () => {
		for (const kind of ["friend", "rival"] as const) {
			const state = funded(), memberIds = earnRelationship(state, kind), quote = getSquadRaidQuote(state, memberIds, "courtyard");
			expect(quote.relationships[0]!.score > 0).toBe(kind === "friend");
			expect(dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated).ok).toBe(true);
			const raids = structuredClone(state.raids), active = saveGame(state), event = getSquadSocialEvents(state).find((item) => item.scavIds.includes(memberIds[0]!) && item.scavIds.includes(memberIds[1]!));
			if (event) expect(resolveSocialEvent(state, event.id, event.choices[0]!.id).ok).toBe(false);
			expect(saveGame(state)).toBe(active);
			expect(state.raids).toEqual(raids);
			for (const raid of state.raids) expect(getSquadRaidActions(raid)).toEqual(getSquadRaidActions(structuredClone(raid)));
			expect(parseSave(active)).not.toBeNull();
		}
	});

	test("friend cover and conflict hesitation change genuine injury settlement as well as the quoted chance", () => {
		for (const kind of ["friend", "rival"] as const) {
			let checked = false;
			for (let offset = 0; offset < 64 && !checked; offset++) {
				const state = funded(NOW + offset), memberIds = earnRelationship(state, kind), solo = structuredClone(state);
				const quoted = getSquadRaidQuote(state, memberIds, "courtyard");
				for (const member of quoted.members) {
					const scav = state.scavs.find((item) => item.id === member.scavId)!;
					const own = getRaidQuote(state, scav, MAPS[0]!);
					expect(member.chance >= own.chance).toBe(kind === "friend");
					expect(Math.abs(member.chance - own.chance)).toBeLessThanOrEqual(.041);
				}
				expect(dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated).ok).toBe(true);
				const partyRaids = structuredClone(state.raids);
				for (const id of memberIds) expect(dispatchRaid(solo, id, "courtyard", solo.lastUpdated).ok).toBe(true);
				const soloRaids = structuredClone(solo.raids);
				expect(partyRaids.map((raid) => raid.seed)).toEqual(soloRaids.map((raid) => raid.seed));
				expect(getSquadRaidActions(partyRaids[0]!).every((action) => action.kind === (kind === "friend" ? "cover" : "hesitation"))).toBe(true);
				const solitaryHealth = new Map<string, number>();
				for (const raid of [...soloRaids].sort((a, b) => a.endsAt - b.endsAt)) {
					advance(solo, raid.endsAt);
					solitaryHealth.set(raid.scavId, solo.scavs.find((scav) => scav.id === raid.scavId)?.health ?? 0);
				}
				advance(state, partyRaids[0]!.endsAt);
				const comparable = partyRaids.filter((raid) => memberSucceeded(state, raid) === memberSucceeded(solo, soloRaids.find((item) => item.scavId === raid.scavId)!));
				const actual = comparable.find((raid) => state.scavs.some((scav) => scav.id === raid.scavId) && (solitaryHealth.get(raid.scavId) ?? 0) > 0);
				if (!actual) continue;
				const health = state.scavs.find((scav) => scav.id === actual.scavId)!.health, withoutCover = solitaryHealth.get(actual.scavId)!;
				expect(kind === "friend" ? health > withoutCover : health < withoutCover).toBe(true);
				expect(parseSave(saveGame(state))).not.toBeNull(); checked = true;
			}
			expect(checked).toBe(true);
		}
	});

	test("a paid buddy kit rescues a real otherwise fatal casualty, keeps the same weapon and withdraws the entire group exactly once", () => {
		const { state, before, departure, raids, summary, report } = genuineSettlement("rescue");
		const rescued = report.squad!.outcomes.find((item) => item.rescuedBy)!, helper = report.squad!.members.find((member) => member.scavId === rescued.rescuedBy)!;
		const noKits = structuredClone(before);
		for (const scav of noKits.scavs) expect(setLoadoutOption(noKits, scav.id, "medkit", false).ok).toBe(true);
		expect(dispatchSquadRaid(noKits, ids(noKits), "depot", noKits.lastUpdated).ok).toBe(true);
		expect(noKits.raids.map((raid) => raid.seed)).toEqual(raids.map((raid) => raid.seed));
		expect(noKits.raids.map((raid) => raid.chance)).toEqual(raids.map((raid) => raid.chance));
		advance(noKits, noKits.raids[0]!.endsAt);
		const fatal = noKits.history.find((item) => item.raidId === rescued.raidId)!;
		expect(fatal.lostScav).toBe(true); expect(fatal.lostWeapon).toBe(true);
		expect(rescued.success).toBe(false); expect(rescued.lostScav).toBe(false); expect(rescued.lostWeapon).toBe(false);
		expect(state.raids).toHaveLength(0); expect(summary.completedCount).toBe(3); expect(summary.completed).toHaveLength(3);
		expect(new Set(summary.completed.map((item) => item.raidId)).size).toBe(3);
		expect(helper.medkit).toBe(true); expect(outcome(report, helper.scavId).success).toBe(true);
		expect(report.squad!.usedMedkits).toContain(helper.scavId);
		expect(new Set(report.squad!.usedMedkits).size).toBe(report.squad!.usedMedkits.length);
		expect(departure.supplies.medicine).toBe(before.supplies.medicine - 3);
		const rescuedScav = state.scavs.find((scav) => scav.id === rescued.scavId)!, original = before.scavs.find((scav) => scav.id === rescued.scavId)!;
		expect(rescuedScav.weaponInstanceId).toBe(original.weaponInstanceId);
		expect(state.weapons.some((gun) => gun.id === original.weaponInstanceId)).toBe(true);
		expect(state.memorials.some((fallen) => fallen.id === rescued.scavId)).toBe(false);
		expect(state.history.every((item) => JSON.stringify(item.squad) === JSON.stringify(report.squad))).toBe(true);
		expect(state.social.pairs.every((pair) => pair.sortiesTogether === 1)).toBe(true);
		expect(parseSave(saveGame(state))).not.toBeNull();
		const saved = saveGame(state); for (const raid of raids) expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
	});

	test("a genuine partial fatality leaves separate truthful reports, frees every survivor and creates grief for the correct physical friend", () => {
		const { state, departure, raids, summary, report, friendIds } = genuineSettlement("casualty", true);
		const fallen = report.squad!.members.find((member) => member.raidId === report.raidId)!, friendId = friendIds.find((id) => id !== fallen.scavId)!;
		expect(report.lostScav).toBe(true); expect(state.raids).toHaveLength(0);
		expect(summary.completedCount).toBe(3); expect(new Set(summary.completed.map((item) => item.raidId)).size).toBe(3);
		expect(state.scavs.some((scav) => scav.id === fallen.scavId)).toBe(false);
		expect(state.memorials.find((item) => item.id === fallen.scavId)?.name).toBe(fallen.scavName);
		expect(state.scavs.every((scav) => scav.status !== "raiding")).toBe(true);
		expect(state.history.every((item) => item.squad?.outcomes.some((result) => result.scavId === fallen.scavId && result.lostScav))).toBe(true);
		if (state.scavs.some((scav) => scav.id === friendId)) {
			const loss = getLossReaction(state, friendId).find((item) => item.fallenId === fallen.scavId)!;
			expect(loss).toBeDefined(); expect(loss.fallenName).toBe(fallen.scavName); expect(loss.severity).toBeGreaterThan(8);
		}
		const irregular = structuredClone(departure); tickIrregularly(irregular, state.lastUpdated);
		expect(irregular).toEqual(state);
		expect(new Set(physicalIds(state)).size).toBe(physicalIds(state).length);
		expect(parseSave(saveGame(state))).not.toBeNull();
		const saved = saveGame(state); for (const raid of raids) expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(false);
		expect(saveGame(state)).toBe(saved);
	});

	test("three genuinely successful coordinated stages retain bounded trails and physical cargo across every save", () => {
		let completed: GameState | null = null;
		for (let offset = 0; offset < 128 && !completed; offset++) {
			const state = funded(NOW + offset);
			expect(dispatchSquadRaid(state, ids(state), "courtyard", state.lastUpdated).ok).toBe(true);
			for (let stage = 1; stage <= 3; stage++) {
				advance(state, state.raids[0]!.endsAt);
				if (state.raids.length !== 3) break;
				expect(state.raids.every((raid) => raid.expedition!.stage === stage && raid.expedition!.status === "choice")).toBe(true);
				expect(parseSave(saveGame(state))).not.toBeNull();
				if (stage === 3) { completed = state; break; }
				const raid = state.raids[stage - 1]!, perk = raid.expedition!.offers.includes("careful") ? "careful" : raid.expedition!.offers[0]!;
				expect(continueExpedition(state, raid.id, "recon", perk, state.lastUpdated).ok).toBe(true);
				expect(parseSave(saveGame(state))).not.toBeNull();
			}
		}
		expect(completed).not.toBeNull();
		const state = completed!, raidIds = state.raids.map((raid) => raid.id), parts = state.raids.flatMap((raid) => raid.expedition!.cargo.modules);
		for (const raid of state.raids) { expect(raid.expedition!.offers).toEqual([]); expect(getExpeditionChoices(state, raid)).toEqual([]); }
		expect(extractRaid(state, state.raids[2]!.id, state.lastUpdated).ok).toBe(true);
		expect(state.history.every((report) => report.depth === 3 && report.events.length <= 10)).toBe(true);
		expect(new Set(state.history.map((report) => report.raidId))).toEqual(new Set(raidIds));
		for (const part of parts) expect(state.modules.some((item) => item.id === part.id)).toBe(true);
		expect(state.social.pairs.every((pair) => pair.sortiesTogether === 1)).toBe(true);
		expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("enabled individual routes wait for the entire manual party, then restart only after all group reports exist", () => {
		const { state, raids, memberIds } = checkpoint();
		for (const id of memberIds) expect(setAutoRaid(state, id, "courtyard", 25, state.lastUpdated).ok).toBe(true);
		const held = structuredClone(state.raids); advance(state, state.lastUpdated + 30_000);
		expect(state.raids).toEqual(held); expect(state.history).toHaveLength(0);
		expect(extractRaid(state, raids[1]!.id, state.lastUpdated).ok).toBe(true);
		expect(state.raids).toHaveLength(0); expect(state.history).toHaveLength(3);
		advance(state, state.lastUpdated);
		expect(state.raids).toHaveLength(3); expect(state.raids.every((raid) => raid.isAuto && !raid.squad)).toBe(true);
		expect(new Set(state.raids.map((raid) => raid.scavId))).toEqual(new Set(memberIds));
		expect(state.history).toHaveLength(3); expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("a ready selected repeat policy cannot seize one fighter during catchup before manual group dispatch", () => {
		for (const elapsed of [1, 1_000]) {
			const state = funded(), memberIds = ids(state);
			state.supplies.ammo = 0;
			for (const id of memberIds) expect(setAutoRaid(state, id, "courtyard", 25, state.lastUpdated).ok).toBe(true);
			expect(state.raids).toHaveLength(0); state.supplies.ammo = 500;
			expect(dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated + elapsed).ok).toBe(true);
			expect(state.raids).toHaveLength(3); expect(state.raids.every((raid) => raid.squad && !raid.isAuto)).toBe(true);
			expect(state.scavs.every((scav) => scav.autoRaid.enabled && scav.autoRaid.runs === 0)).toBe(true);
			expect(state.stats.autoRaidsCompleted).toBe(0); expect(parseSave(saveGame(state))).not.toBeNull();
		}
	});

	test("changing the next sortie tactic while outside preserves the current solo and party combat snapshots", () => {
		for (const group of [false, true]) {
			const state = funded(), memberIds = ids(state, group ? 3 : 1);
			expect((group ? dispatchSquadRaid(state, memberIds, "courtyard", state.lastUpdated) : dispatchRaid(state, memberIds[0]!, "courtyard", state.lastUpdated)).ok).toBe(true);
			const raids = structuredClone(state.raids), samePolicyControl = structuredClone(state);
			for (const id of memberIds) expect(setRaidTactic(state, id, "bold").ok).toBe(true);
			expect(state.raids).toEqual(raids); expect(state.scavs.filter((scav) => memberIds.includes(scav.id)).every((scav) => scav.tactic === "bold")).toBe(true);
			expect(parseSave(saveGame(state))).not.toBeNull();
			advance(state, raids[0]!.endsAt); advance(samePolicyControl, raids[0]!.endsAt);
			expect(state.raids).toEqual(samePolicyControl.raids); expect(state.history).toEqual(samePolicyControl.history);
			if (state.raids.length) {
				const raid = state.raids[0]!, unchanged = samePolicyControl.raids[0]!, perk = raid.expedition!.offers[0]!;
				expect(getExpeditionChoices(state, raid, perk)).toEqual(getExpeditionChoices(samePolicyControl, unchanged, perk));
				expect(continueExpedition(state, raid.id, "recon", perk, state.lastUpdated).ok).toBe(true);
				expect(continueExpedition(samePolicyControl, unchanged.id, "recon", perk, samePolicyControl.lastUpdated).ok).toBe(true);
				expect(state.raids).toEqual(samePolicyControl.raids); expect(parseSave(saveGame(state))).not.toBeNull();
			}
		}
	});

	test("a previously earned paid work contribution may level up fighters already outside without rewriting or invalidating their frozen party", () => {
		const state = funded(), room = state.shelter.rooms.find((item) => item.type === "workshop")!, workers = state.scavs.slice(1);
		state.level = 9; state.xp = 5760;
		const quote = getRoomUpgradeQuote(state, room.id); expect(upgradeRoom(state, room.id, state.lastUpdated).ok).toBe(true);
		advance(state, state.lastUpdated + quote.duration * 1_000);
		for (const worker of workers) expect(assignWorker(state, worker.id, room.id, state.lastUpdated).ok).toBe(true);
		for (let index = 0; index < 19; index++) {
			expect(queueModuleProduction(state, room.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
			while (room.queue.length) advance(state, state.lastUpdated + 1_000);
		}
		expect(workers.every((scav) => scav.xp === 57 && scav.level === 1)).toBe(true);
		expect(queueModuleProduction(state, room.id, "factory-sks-stock", state.lastUpdated).ok).toBe(true);
		const job = room.queue[0]!;
		while (job.workDone < Math.ceil(job.workRequired / 5)) advance(state, state.lastUpdated + 100);
		for (const worker of workers) expect(assignWorker(state, worker.id, null, state.lastUpdated).ok).toBe(true);
		expect(assignWorker(state, state.scavs[0]!.id, room.id, state.lastUpdated).ok).toBe(true);
		expect(dispatchSquadRaid(state, workers.map((scav) => scav.id), "factory", state.lastUpdated).ok).toBe(true);
		const active = structuredClone(state.raids);
		while (room.queue.length) advance(state, state.lastUpdated + 100);
		expect(state.lastUpdated).toBeLessThan(active[0]!.endsAt);
		expect(workers.every((scav) => scav.xp === 60 && scav.level === 2)).toBe(true);
		expect(state.raids).toEqual(active); expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("strict saved combat and casualty reports reject fabricated rescue kits, altered action timing and forged participant outcomes", () => {
		const { state, departure, report } = genuineSettlement("rescue");
		for (const mutation of [
			(squad: NonNullable<Raid["squad"]>) => { squad.usedMedkits = [squad.members[0]!.scavId]; },
			(squad: NonNullable<Raid["squad"]>) => { squad.actions[0]!.progress += .001; },
			(squad: NonNullable<Raid["squad"]>) => { squad.actions[0]!.kind = "rescue"; },
			(squad: NonNullable<Raid["squad"]>) => { squad.actions[0]!.text = "Free help without a paid kit"; },
			(squad: NonNullable<Raid["squad"]>) => { squad.members[1]!.weaponModules.receiver = "receiver-pm"; },
		]) {
			const corrupted = structuredClone(departure);
			for (const raid of corrupted.raids) mutation(raid.squad!);
			expect(parseSave(saveGame(corrupted))).toBeNull();
		}
		const victim = report.squad!.outcomes.find((item) => item.rescuedBy)!;
		for (const mutation of [
			(squad: NonNullable<RaidReport["squad"]>) => { squad.usedMedkits = []; },
			(squad: NonNullable<RaidReport["squad"]>) => { squad.outcomes.find((item) => item.scavId === victim.scavId)!.rescuedBy = null; },
			(squad: NonNullable<RaidReport["squad"]>) => { squad.outcomes.find((item) => item.scavId === victim.scavId)!.lostScav = true; },
			(squad: NonNullable<RaidReport["squad"]>) => { squad.outcomes[0]!.scavId = "scav-missing"; },
			(squad: NonNullable<RaidReport["squad"]>) => { squad.outcomes[0]!.success = !squad.outcomes[0]!.success; },
		]) {
			const corrupted = structuredClone(state);
			for (const item of corrupted.history) mutation(item.squad!);
			expect(parseSave(saveGame(corrupted))).toBeNull();
		}
		expect(parseSave(saveGame(departure))).not.toBeNull(); expect(parseSave(saveGame(state))).not.toBeNull();
	});

	test("strict saves reject orphaned or divergent members and unknown snapshot fields instead of spawning separate ghost parties", () => {
		const state = funded(); expect(dispatchSquadRaid(state, ids(state), "courtyard", state.lastUpdated).ok).toBe(true);
		const raw = JSON.parse(saveGame(state));
		const mutations = [
			(value: typeof raw) => { value.raids[0].squad.untrusted = { reward: 9999 }; },
			(value: typeof raw) => { delete value.raids[1].squad; },
			(value: typeof raw) => { value.raids.pop(); },
			(value: typeof raw) => { value.raids[1].endsAt++; },
			(value: typeof raw) => { value.raids[1].startedAt++; },
			(value: typeof raw) => { value.raids[1].chance = Math.max(.15, value.raids[1].chance - .001); },
			(value: typeof raw) => { value.raids[1].mapId = MAPS.find((map) => map.id !== value.raids[1].mapId)!.id; },
			(value: typeof raw) => { value.raids[1].expedition.stage++; },
			(value: typeof raw) => { value.raids[1].expedition.branch = "combat"; },
			(value: typeof raw) => { value.raids[1].scavAppearance = (value.raids[1].scavAppearance + 1) % 32; },
		];
		for (const mutate of mutations) {
			const invalid = structuredClone(raw); mutate(invalid);
			expect(parseSave(JSON.stringify(invalid))).toBeNull();
		}
		const future = structuredClone(raw); future.schemaVersion = SAVE_VERSION + 1;
		expect(parseSave(JSON.stringify(future))).toBeNull();
		expect(parseSave(JSON.stringify(raw))).not.toBeNull();
	});
});
