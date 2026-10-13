import { describe, expect, test } from 'bun:test';
import { createGame, dispatchRaid, getScavHealingQuote, type RaidReport } from '../src/game/engine';
import { BODY_PART_LABELS, BODY_PARTS, createHealth, createMedicalInventory, healthPercent } from '../src/game/health';
import { bodyHealthPanel, medicalPackEditor, raidHealthPanel, scavHealthPanel } from '../src/gameplay-ui';
import { renderLiveRaidPanel } from '../src/raid-ui';

const NOW = 1_792_000_000_000;
function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

describe('body and medicine presentation', () => {
	test('separate wounds remain readable and functional limits do not rely on color', () => {
		const body = createHealth();
		body.parts.leftLeg.hp = 0;
		body.parts.leftLeg.fracture = true;
		body.parts.rightArm.bleeding = 'heavy';
		const before = JSON.stringify(body), html = bodyHealthPanel(freeze(body), '<img src=x>', NOW);
		for (const part of BODY_PARTS) expect(html).toContain(BODY_PART_LABELS[part]);
		expect(html.match(/role="progressbar"/g)).toHaveLength(7);
		expect(html).toContain('0 / 65');
		expect(html).toContain('Выбита · Перелом');
		expect(html).toContain('Тяжёлое кровотечение');
		expect(html).toContain('Срочно остановить кровь');
		expect(html).toContain('Передвижение 35%');
		expect(html).toContain('Бег недоступен');
		expect(html).toContain('&lt;img src=x&gt;');
		expect(html).not.toContain('<img src=x>');
		expect(JSON.stringify(body)).toBe(before);
	});

	test('base care follows the engine cost, duration, blockers and an already paid timer', () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		scav.body = createHealth(70); scav.health = healthPercent(scav.body);
		const quote = getScavHealingQuote(state, scav);
		let html = scavHealthPanel(state, scav);
		expect(html).toContain(`Лечить · ${quote.medicine} мед.`);
		expect(html).toContain(`${quote.duration} сек.`);
		state.supplies.medicine = 0;
		html = scavHealthPanel(state, scav);
		expect(html).toContain(getScavHealingQuote(state, scav).reason!);
		expect(html).toContain('data-focus-key="heal" disabled');
		scav.medicalTreatment = { startedAt: Date.now(), endsAt: Date.now() + 30_000, medicine: quote.medicine };
		html = scavHealthPanel(state, scav);
		expect(html).toContain('Курс уже оплачен');
		expect(html).toContain('Лечение · осталось');
		expect(html).toContain('data-focus-key="heal" disabled');
	});

	test('legacy inspection is read-only and the bag explains its actual paid content', () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		delete scav.body; scav.health = 75;
		scav.id = 'person" onfocus="bad';
		const before = JSON.stringify(state);
		freeze(state);
		expect(scavHealthPanel(state, scav)).toContain('330 / 440 HP');
		const bag = medicalPackEditor(state, scav);
		expect(bag).toContain('120 HP');
		expect(bag).toContain('1 медикамент при каждой отправке');
		expect(bag).toContain('включая автовыходы');
		expect(bag).toContain('data-medkit="person&quot; onfocus=&quot;bad"');
		expect(JSON.stringify(state)).toBe(before);
	});

	test('active and historical views use their own physical medicine and recorded body', () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		scav.loadout.medkit = true;
		expect(dispatchRaid(state, scav.id, 'courtyard', NOW).ok).toBe(true);
		const raid = state.raids[0]!;
		raid.expedition!.status = 'choice';
		raid.expedition!.medical!.inventory.medkit = 17;
		raid.expedition!.medical!.inventory.tourniquet = 0;
		scav.loadout.medkit = false;
		scav.body = createHealth(); scav.body.parts.rightLeg.bleeding = 'heavy'; scav.body.parts.chest.hp = 10;
		const active = raidHealthPanel(state, raid);
		expect(active).toContain('17 HP');
		expect(active).toContain('Кровотечение остаётся: нужных средств в сумке нет');
		expect(active).toContain('время и кровотечения остановлены');
		const body = createHealth(); body.parts.head.hp = 1;
		const receipt: RaidReport = { id: 'receipt', raidId: raid.id, scavName: raid.scavName, mapId: raid.mapId, at: NOW,
			success: true, lostScav: false, lostWeapon: false, money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 },
			weaponId: null, weaponAutoSold: false, description: 'Вернулся.', isAuto: false, tactic: 'balanced', events: [],
			depth: 1, discoveries: [], lostCargo: null, moduleIds: [], medical: { body, inventory: createMedicalInventory({ medkit: 3 }) } };
		const historical = raidHealthPanel(state, raid, freeze(receipt));
		expect(historical).toContain('1 / 35');
		expect(historical).toContain('3 HP');
		expect(historical).not.toContain('17 HP');
		expect(historical).not.toContain('Тяжёлое кровотечение');
		expect(historical).toContain('сохранённое состояние при завершении выхода');
		expect(renderLiveRaidPanel(state, raid, receipt)).toContain('Здоровье при возвращении 92 / 100');
		const legacyReceipt = { ...receipt };
		delete legacyReceipt.medical;
		expect(raidHealthPanel(state, raid, legacyReceipt)).toContain('состояние тела в этом отчёте не сохранилось');
	});
});
