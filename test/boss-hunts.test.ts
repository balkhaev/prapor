import { describe, expect, test } from 'bun:test';
import { advance, claimLootDelivery, continueExpedition, craftGear, createGame, equipGear, extractRaid, dispatchRaid, dispatchSquadRaid, getExpeditionChoices, getLootCapacity, getModuleCapacity, getRaidQuote, getSquadRaidQuote, parseSave, saveGame, setAutoRaid, setLoadoutOption, setRaidPlan, BOSSES, type GameState, type Raid } from '../src/game/engine';
import { MAP_BY_ID } from '../src/game/data';
import { getRaidFieldPlan } from '../src/raid-field';
import { readGameCommand } from '../server/game';

const NOW = 1_792_000_000_000;
function funded(offset = 0) {
	const state = createGame(NOW + offset); state.level = 9; state.xp = 5760; state.money = 30_000;
	state.supplies = { ammo: 500, medicine: 50, scrap: 1000, intel: 100 }; state.rng = offset + 1;
	for (const scav of state.scavs) { scav.combat = 80; scav.scouting = 80; expect(setLoadoutOption(state, scav.id, 'medkit', true).ok).toBe(true); }
	return state;
}
function check(state: GameState) { expect(parseSave(saveGame(state))).toEqual(state); }
function perk(raid: Raid) { return raid.expedition!.offers.includes('careful') ? 'careful' as const : raid.expedition!.offers[0]!; }
function hunt(boss = BOSSES[0]!, party = false, startOffset = 0) {
	for (let offset = startOffset; offset < startOffset + 512; offset++) {
		const state = funded(offset), people = party ? state.scavs.slice(0, 2) : state.scavs.slice(0, 1);
		for (const scav of people) expect(setRaidPlan(state, scav.id, 'boss', 'scouted').ok).toBe(true);
		const result = party ? dispatchSquadRaid(state, people.map(person => person.id), boss.mapId, state.lastUpdated) : dispatchRaid(state, people[0]!.id, boss.mapId, state.lastUpdated);
		expect(result.ok).toBe(true);
		for (const raid of state.raids) raid.expedition!.capacity = 50;
		let reached = false, paidFightMoney = 0;
		while (state.raids.length === people.length) {
			const raid = state.raids[0]!;
			if (raid.expedition!.stage === boss.depth) paidFightMoney = state.money;
			advance(state, raid.endsAt);
			if (state.raids.length !== people.length) break;
			if (raid.expedition!.bossEncounter?.defeated) { reached = true; break; }
			if (!continueExpedition(state, raid.id, raid.expedition!.stage + 1 === boss.depth ? 'combat' : 'recon', perk(raid), state.lastUpdated).ok) break;
		}
		if (reached) return { state, raid: state.raids[0]!, boss, offset, paidFightMoney };
	}
	throw new Error(`No genuine ${boss.id} hunt found`);
}

describe('paid ordinary boss hunts', () => {
	test('server accepts only the boss plan intent; unsupported maps and mixed parties spend nothing', () => {
		const state = funded(), scav = state.scavs[0]!;
		expect(readGameCommand({ type: 'setRaidPlan', args: [scav.id, 'boss', 'scouted'] }).type).toBe('setRaidPlan');
		expect(() => readGameCommand({ type: 'dispatchRaid', args: [scav.id, 'depot', { defeated: true }] })).toThrow();
		expect(setRaidPlan(state, scav.id, 'boss', 'none').ok).toBe(true);
		const before = saveGame(state); expect(dispatchRaid(state, scav.id, 'courtyard', state.lastUpdated).ok).toBe(false); expect(saveGame(state)).toBe(before);
		expect(getSquadRaidQuote(state, state.scavs.slice(0, 2).map(person => person.id), 'depot').reason).toContain('каждому');
		expect(dispatchSquadRaid(state, state.scavs.slice(0, 2).map(person => person.id), 'depot', state.lastUpdated).ok).toBe(false); expect(saveGame(state)).toBe(before);
	});
	test('boss costs and chance apply only to the exact combat stage; first approach and frozen future orders stay honest', () => {
		const state = funded(), scav = state.scavs[0]!, boss = BOSSES[0]!;
		const ordinary = getRaidQuote(state, scav, MAP_BY_ID[boss.mapId]!); expect(setRaidPlan(state, scav.id, 'boss', 'none').ok).toBe(true);
		const quote = getRaidQuote(state, scav, MAP_BY_ID[boss.mapId]!); expect(quote.chance).toBe(ordinary.chance); expect(quote.ammo).toBe(ordinary.ammo); expect(quote.duration).toBe(ordinary.duration);
		expect(dispatchRaid(state, scav.id, boss.mapId, state.lastUpdated).ok).toBe(true); const raid = state.raids[0]!;
		raid.chance = 1; advance(state, raid.endsAt); expect(raid.expedition!.bossEncounter).toBeUndefined();
		const before = saveGame(state), choice = getExpeditionChoices(state, raid, perk(raid)).find(row => row.branch === 'combat')!;
		const neutral = structuredClone(raid); delete neutral.bossHunt; neutral.strategy!.objective = 'general';
		const base = getExpeditionChoices(state, neutral, perk(raid)).find(row => row.branch === 'combat')!;
		expect(choice.boss?.id).toBe(boss.id); expect(choice.ammo - base.ammo).toBe(boss.extraAmmo); expect(choice.intel - base.intel).toBe(boss.extraIntel); expect(choice.duration - base.duration).toBe(boss.extraSeconds); expect(choice.chance).toBeCloseTo(Math.max(.15, base.chance - boss.chancePenalty));
		expect(getExpeditionChoices(state, raid, perk(raid)).filter(row => row.branch !== 'combat').every(row => row.boss === undefined)).toBe(true); expect(saveGame(state)).toBe(before);
		expect(setRaidPlan(state, scav.id, 'ammo', 'none').ok).toBe(true); expect(getExpeditionChoices(state, raid, perk(raid))).toContainEqual(choice);
		expect(continueExpedition(state, raid.id, 'combat', perk(raid), state.lastUpdated).ok).toBe(true); expect(raid.chance).toBe(choice.chance); expect(getRaidFieldPlan(raid).boss?.id).toBe(boss.id); check(state);
	});
	test('all four genuine fights give one physical bundle and cargo bounty; repeated settlement cannot duplicate it', () => {
		for (const boss of BOSSES) {
			const { state, raid, paidFightMoney } = hunt(boss), encounter = raid.expedition!.bossEncounter!;
			expect(encounter.bossId).toBe(boss.id); expect(encounter.defeated).toBe(true); expect(encounter.bounty).toBe(boss.bounty); expect(encounter.carrierRaidId).toBe(raid.id);
			expect(encounter.lootItemIds).toHaveLength(2); expect(encounter.gearItemIds).toHaveLength(1); expect(encounter.moduleItemIds).toHaveLength(1);
			expect(state.lootItems ?? []).toEqual([]); expect(state.gearItems).toEqual([]); expect(state.modules.some(part => encounter.moduleItemIds.includes(part.id))).toBe(false); expect(state.money).toBe(paidFightMoney);
			const before = saveGame(state); advance(state, state.lastUpdated); expect(saveGame(state)).toBe(before); check(state);
			expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true); expect(state.lootItems!.some(item => item.modelId === boss.trophyModelId)).toBe(true); expect(state.gearItems.some(item => item.modelId === boss.gearModelId && item.durability === 90)).toBe(true); expect(state.modules.some(item => item.id === encounter.moduleItemIds[0] && item.durability === 90)).toBe(true); check(state);
			const money = state.money; expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(false); expect(state.money).toBe(money);
		}
	});
	test('early extraction, missed combat and failed fight never declare a defeat or start cooldown', () => {
		for (const outcome of ['early', 'miss', 'fail'] as const) {
			const state = funded(), scav = state.scavs[0]!; setRaidPlan(state, scav.id, 'boss', 'scouted'); dispatchRaid(state, scav.id, 'depot', state.lastUpdated); const raid = state.raids[0]!;
			raid.chance = 1; advance(state, raid.endsAt);
			if (outcome !== 'early') { expect(continueExpedition(state, raid.id, outcome === 'miss' ? 'recon' : 'combat', perk(raid), state.lastUpdated).ok).toBe(true); raid.chance = outcome === 'fail' ? 0 : 1; advance(state, raid.endsAt); }
			if (state.raids.length) expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true);
			expect(state.bossCooldowns).toBeUndefined(); expect(state.lootItems?.some(item => item.modelId.startsWith('boss-')) ?? false).toBe(false); expect(state.history[0]!.bossEncounter?.defeated ?? false).toBe(false); check(state);
		}
	});
	test('defeated loot remains at risk on the next stage; cooldown persists through loss, reload and clock rollback', () => {
		const { state, raid, boss } = hunt(), items = structuredClone(raid.expedition!.cargo.lootItems!), encounter = structuredClone(raid.expedition!.bossEncounter!);
		expect(continueExpedition(state, raid.id, 'recon', perk(raid), state.lastUpdated).ok).toBe(true); raid.chance = 0; advance(state, raid.endsAt);
		expect(state.history[0]!.success).toBe(false); expect(state.history[0]!.bossEncounter).toEqual(encounter); expect(state.history[0]!.lostCargo!.lootItems).toEqual(items); expect(state.lootItems ?? []).toEqual([]); check(state);
		const restored = parseSave(saveGame(state))!, oldCooldown = restored.bossCooldowns![boss.id]!; advance(restored, restored.lastUpdated - 1000);
		expect(restored.bossCooldowns![boss.id]).toBe(oldCooldown - 1000); expect(restored.history[0]!.lostCargo!.lootItems).toEqual(items); check(restored);
		const survivor = restored.scavs[0]!; setRaidPlan(restored, survivor.id, 'boss', 'none'); expect(getRaidQuote(restored, survivor, MAP_BY_ID[boss.mapId]!).bossCooldownUntil).toBe(oldCooldown - 1000);
		advance(restored, oldCooldown); expect(getRaidQuote(restored, survivor, MAP_BY_ID[boss.mapId]!).bossAvailable).toBe(true);
	});
	test('boss module is preserved on a full rack, mixed parcel claim is atomic across all three capacities and survives journal rollover', () => {
		const { state, raid } = hunt(), encounter = structuredClone(raid.expedition!.bossEncounter!), bossModule = structuredClone(raid.expedition!.cargo.modules.find(part => part.id === encounter.moduleItemIds[0])!);
		state.lootItems = Array.from({ length: getLootCapacity(state) }, () => ({ id: `loot-${state.nextId++}`, modelId: 'duct-tape', foundAt: state.lastUpdated }));
		state.gearItems = Array.from({ length: 28 }, () => ({ id: `gear-${state.nextId++}`, modelId: 'canvas_pack', durability: 100 }));
		state.modules = Array.from({ length: getModuleCapacity(state) }, () => ({ ...structuredClone(bossModule), id: `module-${state.nextId++}` }));
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true); const parcel = state.pendingLoot![0]!;
		expect(parcel.moduleItems).toEqual([bossModule]); expect(state.history[0]!.modulePending).toEqual([bossModule]); check(state);
		const before = saveGame(state); expect(claimLootDelivery(state, parcel.id).ok).toBe(false); expect(saveGame(state)).toBe(before);
		state.lootItems = []; state.gearItems = []; const rackFull = saveGame(state); expect(claimLootDelivery(state, parcel.id).ok).toBe(false); expect(saveGame(state)).toBe(rackFull);
		const collision = structuredClone(state); collision.modules[0] = structuredClone(bossModule); expect(parseSave(saveGame(collision))).toBeNull();
		state.history = []; check(state); state.modules.shift(); expect(claimLootDelivery(state, parcel.id).ok).toBe(true); expect(state.modules.at(-1)).toEqual(bossModule); expect(state.pendingLoot).toEqual([]); expect(claimLootDelivery(state, parcel.id).ok).toBe(false); check(state);
	});
	test('a coordinated party defeats once and gives the bundle only to its primary carrier', () => {
		const { state, raid, boss } = hunt(BOSSES[0]!, true), carrier = raid.squad!.leaderRaidId;
		for (const member of state.raids) { expect(member.expedition!.bossEncounter!.carrierRaidId).toBe(carrier); expect(member.expedition!.bossEncounter!.defeated).toBe(true); }
		expect(state.raids.flatMap(member => member.expedition!.bossEncounter!.lootItemIds)).toHaveLength(2); expect(state.raids.flatMap(member => member.expedition!.bossEncounter!.gearItemIds)).toHaveLength(1); expect(state.raids.flatMap(member => member.expedition!.bossEncounter!.moduleItemIds)).toHaveLength(1); check(state);
		expect(extractRaid(state, raid.id, state.lastUpdated).ok).toBe(true); expect(state.lootItems!.filter(item => item.modelId === boss.trophyModelId)).toHaveLength(1); expect(state.history.filter(report => report.bossEncounter!.bounty === boss.bounty)).toHaveLength(1); check(state);
	});
	test('another simultaneous hunt is rejected before spending and a disrupted real party earns no boss reward', () => {
		const active = funded(); for (const scav of active.scavs) setRaidPlan(active, scav.id, 'boss', 'scouted');
		expect(dispatchRaid(active, active.scavs[0]!.id, 'depot', active.lastUpdated).ok).toBe(true);
		const before = saveGame(active); expect(dispatchRaid(active, active.scavs[1]!.id, 'depot', active.lastUpdated).ok).toBe(false); expect(saveGame(active)).toBe(before);
		let failed: GameState | null = null;
		for (let offset = 0; offset < 128 && !failed; offset++) {
			const state = funded(offset); for (const scav of state.scavs.slice(0, 2)) setRaidPlan(state, scav.id, 'boss', 'scouted');
			dispatchSquadRaid(state, state.scavs.slice(0, 2).map(scav => scav.id), 'depot', state.lastUpdated); advance(state, state.raids[0]!.endsAt);
			if (state.raids.length !== 2 || !continueExpedition(state, state.raids[0]!.id, 'combat', perk(state.raids[0]!), state.lastUpdated).ok) continue;
			advance(state, state.raids[0]!.endsAt); if (!state.raids.length && state.history.some(report => report.bossEncounter)) failed = state;
		}
		expect(failed).not.toBeNull(); expect(failed!.bossCooldowns).toBeUndefined();
		for (const report of failed!.history) { expect(report.bossEncounter!.defeated).toBe(false); expect(report.bossEncounter!.carrierRaidId).toBeNull(); expect(report.bossEncounter!.lootItemIds).toEqual([]); }
		expect(failed!.lootItems?.some(item => item.modelId.startsWith('boss-')) ?? false).toBe(false); check(failed!);
	});
	test('automatic dispatch wakes at real cooldown expiry and a long tick matches short ticks', () => {
		const long = funded(); setRaidPlan(long, long.scavs[0]!.id, 'boss', 'scouted'); long.bossCooldowns = { bugor: NOW + 1000 };
		expect(setAutoRaid(long, long.scavs[0]!.id, 'depot', 70, NOW).ok).toBe(true); expect(long.raids).toEqual([]); check(long);
		const short = structuredClone(long); advance(long, NOW + 2000); for (let elapsed = 100; elapsed <= 2000; elapsed += 100) advance(short, NOW + elapsed);
		expect(long.raids[0]!.startedAt).toBe(NOW + 1000); expect(long).toEqual(short); check(long);
	});
	test('a genuine later squad defeat preserves the single earlier boss victory and truthful lost reward receipt', () => {
		let result: GameState | null = null;
		for (let offset = 0; offset < 128 && !result; offset++) {
			const { state, raid } = hunt(BOSSES[0]!, true, offset);
			if (!continueExpedition(state, raid.id, 'recon', perk(raid), state.lastUpdated).ok) continue;
			advance(state, raid.endsAt);
			if (!state.raids.length && state.history.some(report => !report.success)) result = state;
		}
		expect(result).not.toBeNull(); expect(result!.bossCooldowns!.bugor).toBeGreaterThan(0);
		for (const report of result!.history) expect(report.bossEncounter!.defeated).toBe(true);
		expect(result!.history.reduce((sum, report) => sum + report.bossEncounter!.bounty, 0)).toBe(BOSSES[0]!.bounty); check(result!);
	});
	test('strict version and receipt provenance reject injected, mismatched and duplicate boss rewards', () => {
		const { state } = hunt(); check(state);
		for (const mutate of [
			(raw: GameState) => { raw.schemaVersion = 25; },
			(raw: GameState) => { raw.raids[0]!.expedition!.lootCatalogVersion = 25; },
			(raw: GameState) => { raw.raids[0]!.bossHunt = 'lesnik'; },
			(raw: GameState) => { raw.raids[0]!.expedition!.bossEncounter!.bounty++; },
			(raw: GameState) => { raw.raids[0]!.expedition!.bossEncounter!.lootItemIds.push(raw.raids[0]!.expedition!.bossEncounter!.lootItemIds[0]!); },
			(raw: GameState) => { delete raw.raids[0]!.expedition!.bossEncounter; },
			(raw: GameState) => { raw.bossCooldowns!.bugor = raw.lastUpdated + 1e9; },
		]) { const raw = structuredClone(state); mutate(raw); expect(parseSave(saveGame(raw))).toBeNull(); }
		const legacy = funded(); legacy.schemaVersion = 25; expect(parseSave(saveGame(legacy))).not.toBeNull(); legacy.scavs[0]!.raidPlan = { objective: 'boss', preparation: 'none' }; expect(parseSave(saveGame(legacy))).toBeNull();
	});
	test('paid v25 routes keep their exact ordinary quotes, seeded rewards, damage and field plans in v26', () => {
		const state = funded(); dispatchRaid(state, state.scavs[0]!.id, 'depot', state.lastUpdated); state.raids[0]!.expedition!.lootCatalogVersion = 25; state.schemaVersion = 25;
		const migrated = parseSave(saveGame(state))!, original = structuredClone(state), raid = original.raids[0]!;
		expect(getRaidFieldPlan(migrated.raids[0]!)).toEqual(getRaidFieldPlan(raid)); advance(original, raid.endsAt); advance(migrated, raid.endsAt);
		expect(migrated.raids).toEqual(original.raids); expect(migrated.history).toEqual(original.history); expect(migrated.weapons).toEqual(original.weapons); expect(migrated.scavs).toEqual(original.scavs); expect(migrated.rng).toBe(original.rng); expect(migrated.bossCooldowns).toBeUndefined();
		if (original.raids.length) expect(getExpeditionChoices(migrated, migrated.raids[0]!, perk(migrated.raids[0]!))).toEqual(getExpeditionChoices(original, original.raids[0]!, perk(original.raids[0]!)));
	});
	test('real armor, ranged preparation and a roomy pack improve boss survival while the reward stays physical', () => {
		const bare = funded(), prepared = structuredClone(bare), scav = prepared.scavs[0]!;
		prepared.blueprints.push('plate_armor', 'cargo_pack'); expect(craftGear(prepared, 'plate_armor').ok).toBe(true); expect(equipGear(prepared, scav.id, 'armor', prepared.gearItems.at(-1)!.id).ok).toBe(true); expect(craftGear(prepared, 'cargo_pack').ok).toBe(true); expect(equipGear(prepared, scav.id, 'backpack', prepared.gearItems.at(-1)!.id).ok).toBe(true);
		for (const state of [bare, prepared]) { setRaidPlan(state, state.scavs[0]!.id, 'boss', state === prepared ? 'scouted' : 'none'); dispatchRaid(state, state.scavs[0]!.id, 'depot', state.lastUpdated); state.raids[0]!.chance = 1; advance(state, state.raids[0]!.endsAt); }
		const weak = getExpeditionChoices(bare, bare.raids[0]!, 'careful').find(row => row.branch === 'combat')!, strong = getExpeditionChoices(prepared, prepared.raids[0]!, 'careful').find(row => row.branch === 'combat')!;
		expect(strong.chance - weak.chance).toBeGreaterThan(.08); expect(prepared.raids[0]!.expedition!.capacity).toBeGreaterThan(bare.raids[0]!.expedition!.capacity);
	});
});
