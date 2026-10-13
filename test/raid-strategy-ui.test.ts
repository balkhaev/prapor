import { describe, expect, test } from 'bun:test';
import { createGame, dispatchRaid, dispatchSquadRaid, setRaidPlan, type RaidReport } from '../src/game/engine';
import { RAID_OBJECTIVES, RAID_PREPARATIONS } from '../src/game/raid-strategy';
import { planBrief, raidPlanEditor, raidPlanSummary, raidStrategyResults, sectorIntelPanel } from '../src/raid-strategy-ui';
import { renderLiveRaidPanel, renderRaidResult } from '../src/raid-ui';
import { squadRaidComposer } from '../src/squad-raid-ui';

const NOW = 1_792_000_000_000;
function report(overrides: Partial<RaidReport> = {}): RaidReport {
	return { id: 'receipt', raidId: 'raid', scavName: 'Боец', mapId: 'courtyard', at: NOW,
		success: true, lostScav: false, lostWeapon: false, money: 50,
		supplies: { ammo: 1, medicine: 0, scrap: 0, intel: 0 }, weaponId: null, weaponAutoSold: false,
		description: 'Груз доставлен.', isAuto: false, tactic: 'balanced', events: [], depth: 1,
		discoveries: [], lostCargo: null, moduleIds: [], ...overrides };
}
function freeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

describe('raid planning presentation', () => {
	test('legacy neutral plans render without creating state, starting raids or spending supplies', () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		delete scav.raidPlan;
		delete state.sectorIntel;
		const before = JSON.stringify(state);
		freeze(state);
		for (let index = 0; index < 5; index++) {
			const editor = raidPlanEditor(state, scav, 'courtyard'), sector = sectorIntelPanel(state, 'courtyard');
			expect(editor).toContain('<option value="general" selected>');
			expect(editor).toContain('<option value="none" selected>');
			expect(sector).toContain('Знание местности');
			expect(sector).toContain('value="0"');
			expect(raidPlanSummary(scav)).toContain(RAID_OBJECTIVES.general.label);
		}
		expect(JSON.stringify(state)).toBe(before);
		expect(sectorIntelPanel(state, '__proto__')).toBe('');
		expect(planBrief({})).toBe('');
		expect(raidStrategyResults(report())).toBe('');
	});

	test('personal plan controls escape names and identifiers and explain recurring per-person preparation', () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		scav.id = 'person" onfocus="bad';
		scav.name = '<img src=x onerror=bad>';
		scav.raidPlan = { objective: 'ammo', preparation: 'scouted' };
		const html = raidPlanEditor(state, scav, 'courtyard');
		expect(html).toContain('data-raid-objective="person&quot; onfocus=&quot;bad"');
		expect(html).toContain('&lt;img src=x onerror=bad&gt;');
		expect(html).not.toContain('<img src=x');
		expect(html).toContain('data-focus-key="raid-objective"');
		expect(html).toContain('data-focus-key="raid-preparation"');
		expect(html).toContain('20 ₽ и 2 разведданных на этого бойца');
		expect(html).toContain('+5 п.п.');
		expect(html).toContain('−10% времени на всех этапах');
		expect(html).toContain('Оплата один раз, при отправке');
		expect(html).toContain('Деньги −25%');
		expect(html).toContain('в первую очередь при перегрузе');
		expect(html).toContain('в автосерии');
	});

	test('editing a busy person describes the next sortie and keeps the live objective frozen', () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		expect(dispatchRaid(state, scav.id, 'courtyard', NOW).ok).toBe(true);
		const raid = state.raids[0]!, snapshot = structuredClone(raid.strategy);
		expect(setRaidPlan(state, scav.id, 'medicine', 'scouted').ok).toBe(true);
		const html = raidPlanEditor(state, scav, 'courtyard');
		expect(html).toContain('План следующего выхода');
		expect(html).toContain('Приказы уже идущего выхода сохранены');
		expect(html).toContain('<option value="medicine" selected>');
		expect(planBrief(raid)).toContain(RAID_OBJECTIVES.general.label);
		expect(planBrief(raid)).not.toContain(RAID_OBJECTIVES.medicine.label);
		expect(raid.strategy).toEqual(snapshot);
	});

	test('sector meters show capped state effects in percentage points and motivate rotating', () => {
		const state = createGame(NOW);
		state.sectorIntel = { courtyard: { knowledge: 5, pressure: 6 } };
		const before = JSON.stringify(state), html = sectorIntelPanel(freeze(state), 'courtyard');
		expect(html).toContain('+3 п.п.');
		expect(html).toContain('−6 п.п.');
		expect(html).toContain('max="5" value="5"');
		expect(html).toContain('max="6" value="6"');
		expect(html).toContain('Выход в другой сектор снижает');
		expect(html).toContain('не гарантирует возвращение');
		expect(JSON.stringify(state)).toBe(before);
	});

	test('report strategy uses real delivered target supplies even on warehouse overflow or failure', () => {
		const strategy = { objective: 'intel', preparation: 'scouted', knowledge: 1, pressure: 2 } as const;
		const receipt = report({ strategy, scavName: '<img src=x onerror=bad>', supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 },
			lostCargo: { money: 100, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 9 }, weaponIds: [], modules: [] },
			sectorOutcome: { knowledge: 2, pressure: 3 } });
		for (const candidate of [receipt, { ...receipt, success: false }]) {
			const before = JSON.stringify(candidate), html = raidStrategyResults(freeze(candidate));
			expect(html).toContain('На склад доставлено 0 разведданных');
			expect(html).not.toContain('9 разведданных');
			expect(html).toContain(RAID_PREPARATIONS.scouted.label);
			expect(html).toContain('знание 2 / 5 · патрули 3 / 6');
			expect(html).toContain('&lt;img src=x onerror=bad&gt;');
			expect(html).not.toContain('<img src=x');
			expect(JSON.stringify(candidate)).toBe(before);
		}
	});

	test('mixed squad orders and receipts remain personal, including missing historical members', () => {
		const state = createGame(NOW), ids = state.scavs.slice(0, 2).map(scav => scav.id);
		state.money = 5000; state.supplies.ammo = 200; state.supplies.intel = 100;
		expect(setRaidPlan(state, ids[0]!, 'ammo', 'none').ok).toBe(true);
		expect(setRaidPlan(state, ids[1]!, 'medicine', 'scouted').ok).toBe(true);
		const composer = squadRaidComposer(state, ids, 'courtyard');
		expect(composer).toContain('Разведка: 20 ₽ + 2 разв. за бойца');
		expect(composer).toContain(RAID_OBJECTIVES.ammo.label);
		expect(composer).toContain(RAID_OBJECTIVES.medicine.label);
		expect(dispatchSquadRaid(state, ids, 'courtyard', NOW).ok).toBe(true);
		const raids = state.raids, leader = raids[0]!, squad = { ...leader.squad!, outcomes: leader.squad!.members.map(member => ({ scavId: member.scavId,
			raidId: member.raidId, success: true, lostScav: false, lostWeapon: false, health: 90, rescuedBy: null })) };
		const receipts = raids.map((raid, index) => report({ id: `receipt-${index}`, raidId: raid.id, scavName: raid.scavName,
			strategy: raid.strategy, squad, supplies: { ammo: index === 0 ? 8 : 0, medicine: index === 1 ? 3 : 0, scrap: 0, intel: 0 } }));
		state.history = receipts;
		const active = renderLiveRaidPanel(state, leader, null);
		expect(active).toContain(`Задача: ${RAID_OBJECTIVES.ammo.label}`);
		expect(active).toContain(`Задача: ${RAID_OBJECTIVES.medicine.label}`);
		const result = renderRaidResult(state, receipts[0]!);
		expect(result).toContain('На склад доставлено 8 патронов');
		expect(result).toContain('На склад доставлено 3 медикамента');
		state.history = [];
		const partial = renderRaidResult(state, receipts[0]!);
		expect(partial).toContain('На склад доставлено 8 патронов');
		expect(partial).not.toContain('На склад доставлено 3 медикамента');
		expect(partial).toContain('Личный отчёт не сохранился');
		expect(partial).not.toContain('Подтверждённая доставка отряда');
		expect(raidStrategyResults(receipts[0]!, [])).toContain('На склад доставлено 8 патронов');
	});
});
