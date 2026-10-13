import { describe, expect, test } from 'bun:test';
import { advance, continueExpedition, createGame, dispatchRaid, extractRaid, parseSave, saveGame } from '../src/game/engine';
import { getConfirmedRaidCargo } from '../src/raid-ui';
import { getRaidFieldObjective, getRaidFieldPlan, readRaidFieldCamera } from '../src/raid-field';
import { MODULE_BY_ID } from '../src/game/modules';

const NOW = 1_792_000_000_000;
function start() {
	const state = createGame(NOW);
	state.money = 5000; state.supplies.ammo = 200; state.supplies.intel = 100;
	expect(dispatchRaid(state,state.scavs[0]!.id,'courtyard',NOW).ok).toBe(true);
	return { state, raid: state.raids[0]! };
}

describe('truthful raid continuity and confirmed cargo', () => {
	test('street searches disclose observations, never mint cargo or bank a previewed finding', () => {
		const { state, raid } = start(), plan = getRaidFieldPlan(raid), duration = raid.endsAt - raid.startedAt;
		const lastSearch = plan.segments.filter(segment => segment.kind === 'search').at(-1)!;
		const at = raid.startedAt + Math.ceil(lastSearch.end * duration), before = saveGame(state);
		for (let i=0; i<30; i++) {
			const objective = getRaidFieldObjective(raid,at,plan);
			expect(objective.visited).toHaveLength(objective.totalSearches);
			expect(objective.visited.every(spot => spot.at <= at)).toBe(true);
			expect(getConfirmedRaidCargo(raid).parts).toEqual([]);
			expect(getConfirmedRaidCargo(raid).money).toBe(0);
		}
		expect(saveGame(state)).toBe(before);
		const inventoryIds = state.modules.map(part => part.id);
		advance(state,raid.endsAt);
		expect(raid.expedition!.status).toBe('choice');
		const cargo = getConfirmedRaidCargo(raid);
		expect(cargo.status).toBe('carried');
		expect(cargo.parts.length).toBeGreaterThan(0);
		expect(cargo.parts.map(part => part.instanceId)).toEqual(raid.expedition!.cargo.modules.map(part => part.id));
		expect(cargo.parts.every(part => part.durability === raid.expedition!.cargo.modules.find(item => item.id === part.instanceId)?.durability)).toBe(true);
		expect(state.modules.map(part => part.id)).toEqual(inventoryIds);
	});

	test('import preserves real cargo identity and condition, extraction history does not guess at stash items', () => {
		const { state, raid } = start(); advance(state,raid.endsAt);
		const restored = parseSave(saveGame(state))!, restoredRaid = restored.raids[0]!;
		expect(getConfirmedRaidCargo(restoredRaid)).toEqual(getConfirmedRaidCargo(raid));
		const checkpointSnapshot = structuredClone(restoredRaid), actualCargo = getConfirmedRaidCargo(checkpointSnapshot);
		expect(extractRaid(restored,restoredRaid.id,restored.lastUpdated).ok).toBe(true);
		const report = restored.history[0]!, delivered = getConfirmedRaidCargo(checkpointSnapshot,report);
		expect(delivered.status).toBe('delivered');
		expect(delivered.parts).toEqual(actualCargo.parts);
		const found = restored.modules.find(part => part.id === actualCargo.parts[0]!.instanceId)!;
		found.durability = 100; // Later stash servicing must not rewrite the retained finding snapshot.
		expect(getConfirmedRaidCargo(checkpointSnapshot,report).parts).toEqual(actualCargo.parts);
		const withoutPhysicalHistory = structuredClone(checkpointSnapshot);
		withoutPhysicalHistory.expedition!.cargo.modules = [];
		const modelOnly = getConfirmedRaidCargo(withoutPhysicalHistory,report);
		expect(modelOnly.parts.map(part => part.model.id)).toEqual(report.moduleIds);
		expect(modelOnly.parts.every(part => part.instanceId === null && part.durability === null && part.foundAt === null)).toBe(true);
		expect(getConfirmedRaidCargo(checkpointSnapshot,{ ...report, raidId:'other-raid' }).status).toBe('carried');
	});

	test('a failed deeper stage shows only the actual lost checkpoint cargo and cannot report it delivered', () => {
		const { state, raid } = start(); advance(state,raid.endsAt);
		const confirmed = structuredClone(raid.expedition!.cargo), perk = raid.expedition!.offers[0]!;
		expect(continueExpedition(state,raid.id,'combat',perk,state.lastUpdated).ok).toBe(true);
		raid.chance = 0;
		advance(state,raid.endsAt);
		const report = state.history[0]!;
		expect(report.success).toBe(false);
		expect(report.lostCargo).toEqual(confirmed);
		const cargo = getConfirmedRaidCargo(raid,report);
		expect(cargo.status).toBe('lost');
		expect(cargo.money).toBe(confirmed.money);
		expect(cargo.parts.map(part => part.instanceId)).toEqual(confirmed.modules.map(part => part.id));
		expect(cargo.parts.every(part => part.model === MODULE_BY_ID[part.model.id])).toBe(true);
		expect(state.modules.some(part => confirmed.modules.some(lost => lost.id === part.id))).toBe(false);
	});

	test('current objective survives reload and stale supplied plans cannot leak an earlier branch or future result', () => {
		const { state, raid } = start(), oldPlan = getRaidFieldPlan(raid);
		const search = oldPlan.segments.find(segment => segment.kind === 'search')!, duration = raid.endsAt - raid.startedAt;
		const at = raid.startedAt + Math.round((search.start+search.end)/2*duration), before = saveGame(state);
		const current = getRaidFieldObjective(raid,at,oldPlan);
		expect(current.searchTargetId).toBe(search.targetId);
		expect(current.remainingSeconds).toBeGreaterThan(0);
		expect(current.visited).toEqual([]);
		expect(current.detail).toContain('контрольной точке');
		expect(getRaidFieldObjective({ ...raid,chance:0 },at,oldPlan)).toEqual(getRaidFieldObjective({ ...raid,chance:1 },at,oldPlan));
		expect(getRaidFieldObjective(parseSave(before)!.raids[0]!,at)).toEqual(current);
		expect(saveGame(state)).toBe(before);
		expect(getRaidFieldObjective(raid,raid.endsAt,oldPlan).settling).toBe(true);
		advance(state,raid.endsAt);
		expect(getRaidFieldObjective(raid,raid.endsAt+86_400_000,oldPlan)).toEqual(getRaidFieldObjective(raid,raid.endsAt,oldPlan));
		expect(getRaidFieldObjective(raid,raid.endsAt,oldPlan).settling).toBe(false);
		const perk = raid.expedition!.offers[0]!;
		expect(continueExpedition(state,raid.id,'combat',perk,state.lastUpdated).ok).toBe(true);
		expect(getRaidFieldPlan(raid).id).not.toBe(oldPlan.id);
		expect(getRaidFieldObjective(raid,raid.startedAt,oldPlan)).toEqual(getRaidFieldObjective(raid,raid.startedAt));
		expect(getRaidFieldObjective(raid,raid.startedAt).visited).toEqual([]);
	});

	test('camera restoration rejects malformed payloads and retains independent follow/manual intent', () => {
		const manual = { zoom:2.7,x:-50,y:320,following:false }, before = structuredClone(manual);
		expect(readRaidFieldCamera(manual)).toEqual(manual);
		expect(readRaidFieldCamera(JSON.parse(JSON.stringify(manual)))).toEqual(manual);
		expect(manual).toEqual(before);
		expect(readRaidFieldCamera({ ...manual,zoom:500,following:true })).toEqual({ ...manual,zoom:4,following:true });
		expect(readRaidFieldCamera({ ...manual,zoom:-2 })!.zoom).toBe(.7);
		for (const invalid of [null,[],42,'camera',{}, { ...manual,zoom:NaN }, { ...manual,x:Infinity }, { ...manual,y:'0' }, { ...manual,following:'false' }, { zoom:2,x:3,y:4 }]) {
			expect(readRaidFieldCamera(invalid)).toBeNull();
		}
	});
});
