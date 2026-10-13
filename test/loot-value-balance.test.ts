import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { MAPS } from '../src/game/data';
import { balanceLootPool, getRaidLootPool, LOOT_MODEL_BY_ID, rollRaidLoot } from '../src/game/loot';
import { getLootDecisionProfile, getLootHuntOptions } from '../src/game/loot-value';
import { getMarketFees } from '../src/game/flea';
import { BARTER_OFFERS } from '../src/game/barter';

const random = (seed: number) => { let x = seed; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; };
const share = (pool: ReturnType<typeof getRaidLootPool>, rarity: string) => pool.filter(entry => !entry.model.autoSell && entry.model.rarity === rarity).reduce((sum, entry) => sum + entry.weight, 0) / pool.reduce((sum, entry) => sum + entry.weight, 0);

describe('loot value, scarcity and purposeful searches', () => {
	test('deep rarity budgets survive a larger common catalogue and preserve category targeting', () => {
		const pool = getRaidLootPool('bunker', 'scavenge', 3);
		expect(share(pool, 'legendary')).toBeCloseTo(.0188, 10);
		expect(share(pool, 'epic')).toBeCloseTo(.0846, 10);
		expect(share(pool, 'rare')).toBeCloseTo(.235, 10);
		expect(pool.filter(entry => entry.model.autoSell).reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(.06, 10);
		const base = getRaidLootPool('bunker', 'scavenge', 3, 24);
		const expanded = balanceLootPool([...base, ...base.filter(entry => entry.model.rarity === 'common' && !entry.model.autoSell)], 3);
		expect(share(expanded, 'legendary')).toBeCloseTo(share(pool, 'legendary'), 10);
		expect(share(expanded, 'rare')).toBeCloseTo(share(pool, 'rare'), 10);
		const targeted = getLootHuntOptions('cipher-book');
		expect(targeted[0]!.branch).toBe('recon'); expect(targeted[0]!.mapId).toBe('reserve');
	});
	test('first-stage junk remains bounded and riskier deep branches improve high-tier chance', () => {
		const first = getRaidLootPool('courtyard', 'scavenge', 1), total = first.reduce((sum, entry) => sum + entry.weight, 0);
		expect(first.filter(entry => entry.model.autoSell).reduce((sum, entry) => sum + entry.weight, 0) / total).toBeCloseTo(.1, 10);
		expect(share(first, 'uncommon')).toBeCloseTo(.216, 10);
		expect(first.some(entry => ['rare', 'epic', 'legendary'].includes(entry.model.rarity))).toBe(false);
		expect(share(getRaidLootPool('bunker', 'combat', 3), 'legendary')).toBeGreaterThan(share(getRaidLootPool('bunker', 'scavenge', 3), 'legendary'));
		expect(getLootHuntOptions('military-cpu')[0]).toMatchObject({ mapId: 'reserve', branch: 'combat', depth: 3 });
		expect(getLootHuntOptions('prototype-optics')[0]).toMatchObject({ mapId: 'bunker', branch: 'combat', depth: 3 });
	});
	test('displayed checkpoint odds match the actual one-or-two trophy draw, before delivery', () => {
		for (const id of ['military-cpu', 'prototype-optics']) {
			const best = getLootHuntOptions(id)[0]!, rng = random(7919); let found = 0;
			for (let i = 0; i < 12_000; i++) if (rollRaidLoot(best.mapId, best.branch, best.depth, rng).some(item => item.id === id)) found++;
			expect(Math.abs(found / 12_000 - best.checkpointChance)).toBeLessThan(.006);
			expect(best.checkpointChance).toBeGreaterThan(best.pickChance);
			expect(best.checkpointChance).toBeLessThan(.04);
		}
	});
	test('every trophy has a real hunt; stage one only offers playable scavenging and late gates remain', () => {
		for (const id of Object.keys(LOOT_MODEL_BY_ID)) {
			const model = LOOT_MODEL_BY_ID[id]!, hunts = getLootHuntOptions(id);
			expect(hunts.length).toBeGreaterThan(0);
			for (const option of hunts) {
				expect(option.depth).toBeGreaterThanOrEqual(model.minDepth);
				expect(MAPS.find(map => map.id === option.mapId)!.level).toBeGreaterThanOrEqual(model.minSectorLevel);
				if (option.depth === 1) expect(option.branch).toBe('scavenge');
				expect(option.pickChance).toBeGreaterThan(0); expect(option.checkpointChance).toBeLessThanOrEqual(1);
			}
		}
		expect(getLootHuntOptions('__proto__')).toEqual([]); expect(getLootDecisionProfile('__proto__')).toBeNull();
	});
	test('value comparisons use exact fees and the complete barter bundle, not one ingredient', () => {
		const cpu = getLootDecisionProfile('military-cpu')!;
		expect(cpu.vendorPrice).toBe(577); expect(cpu.marketGuideNet).toBe(976);
		const luxury = getLootDecisionProfile('luxury-watch')!, fees = getMarketFees(300);
		expect(luxury.marketGuideNet).toBe(fees.proceeds - fees.listingFee);
		expect(luxury.barters[0]).toMatchObject({ inputGuideValue: 440, inputTraderValue: 242, craftMoney: 295, craftScrap: 10 });
		for (const offer of BARTER_OFFERS) {
			const value = getLootDecisionProfile(offer.requirements[0]!.modelId)!.barters.find(item => item.offerId === offer.id)!;
			expect(value.inputTraderValue).toBeLessThan(value.craftMoney + value.craftScrap * 14.5);
		}
	});
	test('craft decisions expose actual new outputs and combined kit leftovers without altering guides', () => {
		expect(getLootDecisionProfile('antibiotics')!.recipes[0]).toMatchObject({ money: 5, output: { medicine: 6 }, inputTraderValue: 88 });
		expect(getLootDecisionProfile('patrol-log')!.recipes[0]).toMatchObject({ output: { intel: 9 }, money: 10 });
		expect(getLootDecisionProfile('sewing-kit')!.recipes[0]).toMatchObject({ outputKit: 'maintenance', output: { scrap: 1, medicine: 1 }, money: 8, inputTraderValue: 70 });
		expect(LOOT_MODEL_BY_ID['military-cpu']!.guidePrice).toBe(1050);
	});
	test('all 50 paid version-24 models retain the released 54 pools and 1080 seeded outcomes', () => {
		const rows = [];
		for (const map of MAPS) for (const branch of ['scavenge', 'combat', 'recon'] as const) for (const depth of [1, 2, 3]) {
			const pools = getRaidLootPool(map.id, branch, depth, 24).map(entry => [entry.model.id, entry.weight]);
			const rolls = Array.from({ length: 20 }, (_, i) => rollRaidLoot(map.id, branch, depth, random((i + 1) * 7919), 24).map(model => model.id));
			rows.push({ map: map.id, branch, depth, pools, rolls });
		}
		expect(createHash('sha256').update(JSON.stringify(rows)).digest('hex')).toBe('b8e53adad1fc418118740bddfc53b8f84509182c98f39280dfed837c7727e244');
	});
});
