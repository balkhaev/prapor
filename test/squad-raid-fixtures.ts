import {
	advance, assignWorker, createGame, dispatchSquadRaid, getRoomUpgradeQuote,
	getScavRelations, getSquadSocialEvents, queueModuleProduction, resolveSocialEvent,
	setLoadoutOption, setRaidTactic, upgradeRoom, type ActionResult, type GameState,
} from "../src/game/engine";

export const SQUAD_FIXTURE_NOW = 1_792_000_000_000;
const requireAction = (result: ActionResult) => { if (!result.ok) throw new Error(result.message); };

export function fundedSquadFixture(now = SQUAD_FIXTURE_NOW): GameState {
	const state = createGame(now);
	state.money = 30_000;
	state.supplies = { ammo: 500, medicine: 50, scrap: 1_000, intel: 100 };
	return state;
}

/** Paid work and authored decisions establish ties; no fixture edits a bond score. */
export function earnSquadRelationship(state: GameState, kind: "friend" | "rival") {
	const candidates = state.scavs.flatMap((scav) => getScavRelations(state, scav.id)
		.map((relation) => ({ first: scav, second: state.scavs.find((item) => item.id === relation.peerId)!, relation })));
	const selected = candidates.sort((a, b) => kind === "friend"
		? b.relation.compatibility - a.relation.compatibility : a.relation.compatibility - b.relation.compatibility)[0]!;
	const room = state.shelter.rooms.find((item) => item.type === "workshop")!;
	const upgrade = getRoomUpgradeQuote(state, room.id);
	requireAction(upgradeRoom(state, room.id, state.lastUpdated));
	advance(state, state.lastUpdated + upgrade.duration * 1_000);
	for (const scav of [selected.first, selected.second]) requireAction(assignWorker(state, scav.id, room.id, state.lastUpdated));
	for (let index = 0; index < (kind === "friend" ? 3 : 4); index++) {
		requireAction(queueModuleProduction(state, room.id, "factory-sks-stock", state.lastUpdated));
		while (room.queue.length) advance(state, state.lastUpdated + 1_000);
	}
	if (kind === "friend") {
		const event = getSquadSocialEvents(state).find((item) => item.eventId === "first_shift" && item.scavIds.includes(selected.first.id) && item.scavIds.includes(selected.second.id));
		if (!event) throw new Error("No earned friendship event");
		requireAction(resolveSocialEvent(state, event.id, "tea"));
	}
	for (const scav of [selected.first, selected.second]) requireAction(assignWorker(state, scav.id, null, state.lastUpdated));
	if (getScavRelations(state, selected.first.id).find((item) => item.peerId === selected.second.id)?.status !== kind)
		throw new Error(`Paid work did not establish ${kind}`);
	return [selected.first.id, selected.second.id];
}

/** Searches genuine dispatched outcomes; never forces chance, action plans, health damage or death. */
export function genuineSquadSettlement(wanted: "rescue" | "casualty", friends = false) {
	for (let offset = 0; offset < 2_048; offset++) {
		const state = fundedSquadFixture(SQUAD_FIXTURE_NOW + offset);
		const friendIds = friends ? earnSquadRelationship(state, "friend") : [];
		state.level = 9; state.xp = 5760;
		for (const scav of state.scavs) {
			requireAction(setRaidTactic(state, scav.id, "bold"));
			requireAction(setLoadoutOption(state, scav.id, "medkit", wanted === "rescue"));
		}
		const before = structuredClone(state);
		requireAction(dispatchSquadRaid(state, state.scavs.map((scav) => scav.id), "depot", state.lastUpdated));
		const departure = structuredClone(state), raids = structuredClone(state.raids);
		const summary = advance(state, raids[0]!.endsAt);
		const report = state.history.find((item) => {
			if (wanted === "rescue") return item.squad?.outcomes.some((outcome) => outcome.rescuedBy);
			if (!item.lostScav) return false;
			if (!friends) return true;
			const fallenId = item.squad!.members.find((member) => member.raidId === item.raidId)!.scavId;
			return friendIds.includes(fallenId) && friendIds.some((id) => id !== fallenId && state.scavs.some((scav) => scav.id === id));
		});
		if (report) return { state, before, departure, raids, summary, report, friendIds, offset };
	}
	throw new Error(`No genuine ${wanted} party found`);
}
