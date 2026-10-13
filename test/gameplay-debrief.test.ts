import { describe, expect, test } from 'bun:test';
import { advance, createGame, dispatchRaid, dispatchSquadRaid, saveGame, type RaidReport } from '../src/game/engine';
import { getGameplayGuidance } from '../src/gameplay-guidance';
import { renderRaidResult } from '../src/raid-ui';

const NOW = 1_792_000_000_000;
function report(overrides: Partial<RaidReport> = {}): RaidReport {
	return { id: 'old-report', raidId: 'old-raid', scavName: 'Боец', mapId: 'courtyard', at: NOW,
		success: true, lostScav: false, lostWeapon: false, money: 120,
		supplies: { ammo: 3, medicine: 1, scrap: 4, intel: 2 }, weaponId: null, weaponAutoSold: false,
		description: 'Груз доставлен.', isAuto: false, tactic: 'balanced', events: [], depth: 1,
		discoveries: [], lostCargo: null, moduleIds: ['factory-sks-stock'], ...overrides };
}

describe('raid result closes the gameplay loop without altering rewards', () => {
	test('explains delivered resources and provides one action from the current game', () => {
		const state = createGame(NOW), receipt = report(), before = saveGame(state);
		const html = renderRaidResult(state,receipt), action = getGameplayGuidance(state).action;
		expect(html).toContain('4 металла — на ремонт, строительство и производство');
		expect(html).toContain('2 разведданных — на выходы в новые секторы');
		expect(html).toContain('Модули — для сборки и улучшения оружия');
		expect(html).toContain('детали сверх вместимости уже проданы');
		expect(html).toContain(action.label);
		expect(html).toContain(action.detail);
		expect(html.match(/data-action="gameplay-next"/g)).toHaveLength(1);
		for (let i = 0; i < 10; i++) renderRaidResult(state,receipt);
		expect(saveGame(state)).toBe(before);
	});

	test('never labels lost cargo as delivered, including legacy reports without cargo details', () => {
		const state = createGame(NOW), lost = report({ success: false, money: 0,
			supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 }, moduleIds: [],
			lostCargo: { money: 650, supplies: { ammo: 10, medicine: 2, scrap: 20, intel: 7 },
				weaponIds: [], modules: [{ id: 'lost-part', modelId: 'factory-sks-stock', durability: 80, foundAt: NOW }] } });
		for (const receipt of [lost, { ...lost, lostCargo: null }]) {
			const html = renderRaidResult(state,receipt);
			expect(html).toContain('Груз этого бойца не доставлен');
			expect(html).toContain('Невынесенный груз не попал в запас базы');
			expect(html).not.toContain('20 металла');
			expect(html).not.toContain('650');
			expect(html).not.toContain('Модули — для сборки');
		}
	});

	test('a disrupted squad credits only retained personal cargo and handles missing old receipts', () => {
		const state = createGame(NOW);
		state.money = 5000; state.supplies.ammo = 200; state.supplies.intel = 100;
		expect(dispatchSquadRaid(state,state.scavs.slice(0,2).map(scav => scav.id),'courtyard',NOW).ok).toBe(true);
		const snapshot = state.raids[0]!.squad!, members = snapshot.members;
		const squad = { ...snapshot, outcomes: members.map((member,index) => ({ scavId: member.scavId,
			raidId: member.raidId, success: index === 1, lostScav: false, lostWeapon: false, health: 20, rescuedBy: null })) };
		const failed = report({ raidId: members[0]!.raidId, success: false, money: 0,
			supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 }, moduleIds: [], squad });
		const retained = report({ id: 'survivor-report', raidId: members[1]!.raidId, money: 333,
			supplies: { ammo: 0, medicine: 0, scrap: 6, intel: 0 }, moduleIds: [], squad });
		state.history = [failed,retained];
		const before = saveGame(state), html = renderRaidResult(state,failed);
		expect(html).toContain('Подтверждённая доставка отряда');
		expect(html).toContain('<strong>333 ₽</strong>');
		expect(html).toContain('6 металла — на ремонт');
		expect(html).not.toContain('Невынесенный груз не попал в запас базы');
		expect(html).not.toContain('Добыча потеряна');
		expect(renderRaidResult(state,retained)).toContain('<strong>333 ₽</strong>');
		expect(saveGame(state)).toBe(before);
		state.history = [];
		const partial = renderRaidResult(state,retained);
		expect(partial).toContain('По сохранившимся личным отчётам');
		expect(partial).toContain('<strong>333 ₽</strong>');
		const failedOnly = renderRaidResult(state,failed);
		expect(failedOnly).toContain('Полный итог груза отряда в последних записях не сохранился');
	});

	test('an old report directs the player to a currently pending raid decision', () => {
		const state = createGame(NOW);
		expect(dispatchRaid(state,state.scavs[0]!.id,'courtyard',NOW).ok).toBe(true);
		advance(state,state.raids[0]!.endsAt);
		expect(state.raids[0]!.expedition!.status).toBe('choice');
		const guidance = getGameplayGuidance(state), before = saveGame(state), html = renderRaidResult(state,report());
		expect(guidance.action.raidId).toBe(state.raids[0]!.id);
		expect(html).toContain(guidance.action.label);
		expect(html).toContain(guidance.action.detail);
		expect(saveGame(state)).toBe(before);
	});
});
