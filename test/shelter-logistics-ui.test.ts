import { describe, expect, test } from 'bun:test';
import { assignWorker, createGame, dispatchRaid, setFieldKit, setRoomStockTarget, setProductionReserve, setRoomRecipe } from '../src/game/engine';
import { RESOURCE_RECIPE_BY_ID } from '../src/game/shelter';
import { fieldKitStockPanel, productionReserveEditor, readProductionReserveDraft, readRoomStockTargetDraft, roomStockTargetEditor, roomUpgradeRecipeBenefits, shelterRecipeCard, type ReserveDraft } from '../src/shelter-logistics-ui';
import { fieldKitEditor, planBrief, raidPlanSummary } from '../src/raid-strategy-ui';

const NOW = 1_792_000_000_000;
const draft = (changes: Partial<ReserveDraft> = {}): ReserveDraft => ({ money: '100', ammo: '6', medicine: '2', scrap: '0', intel: '2', ...changes });
function freeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
	return value;
}

describe('shelter logistics presentation', () => {
	test('reserve submissions reject blank, fractional, negative, exponential, overflow and non-finite input', () => {
		expect(readProductionReserveDraft(draft())).toEqual({ money: 100, supplies: { ammo: 6, medicine: 2, scrap: 0, intel: 2 } });
		for (const bad of ['', ' ', '-1', '2.5', 'Infinity', 'NaN', '1e2', '2abc', '1000001']) expect(readProductionReserveDraft(draft({ ammo: bad }))).toBeNull();
		expect(readProductionReserveDraft(draft({ money: '1000000001' }))).toBeNull();
		expect(readProductionReserveDraft(draft({ money: '1000000000', scrap: '1000000' }))).not.toBeNull();
	});

	test('old saves render zero reserve and kit stock without creating state', () => {
		const state = createGame(NOW); delete state.shelter.logistics;
		const before = JSON.stringify(state); freeze(state);
		const reserve = productionReserveEditor(state, 'base'), kits = fieldKitStockPanel(state);
		expect(reserve).toContain('Рейды, лечение и стройка могут расходовать резерв');
		expect(reserve).toContain('оплаченная очередь продолжится');
		expect(reserve.match(/value="0"/g)).toHaveLength(5);
		expect(kits).toContain('0 / 8'); expect(kits).toContain('не участвует в рейдах');
		expect(kits).toContain('Шанс пройти этап не меняется');
		expect(JSON.stringify(state)).toBe(before);
	});

	test('reserve editor presents committed amounts and keeps an unsaved escaped draft separate', () => {
		const state = createGame(NOW); expect(setProductionReserve(state, { money: 80, supplies: { ammo: 5, medicine: 0, scrap: 0, intel: 1 } }, NOW).ok).toBe(true);
		const before = JSON.stringify(state);
		const html = productionReserveEditor(state, 'room" onclick="bad', draft({ ammo: '"/><img onerror=bad>' }), true);
		expect(html).toContain('data-reserve-editor="room&quot; onclick=&quot;bad"');
		expect(html).toContain('&quot;/&gt;&lt;img onerror=bad&gt;'); expect(html).not.toContain('<img');
		expect(html).toContain('Применить резерв'); expect(html).toContain('только после применения');
		expect(JSON.stringify(state)).toBe(before);
	});

	test('repeat target shows the selected output stock, full-batch waiting and explicit clearing', () => {
		const state = createGame(NOW), room = state.shelter.rooms.find(item => item.type === 'medbay')!;
		expect(setRoomRecipe(state, room.id, 'medicine-batch', true, NOW).ok).toBe(true);
		expect(setRoomStockTarget(state, room.id, 9, NOW).ok).toBe(true);
		const html = roomStockTargetEditor(state, room);
		expect(html).toContain('value="9"'); expect(html).toContain('Медикаменты: на складе');
		expect(html).toContain('целая следующая партия превысит цель'); expect(html).toContain('возобновится после расхода');
		expect(html).toContain('Оплаченные партии завершатся'); expect(html).toContain('при смене рецепта цель сбрасывается');
		expect(readRoomStockTargetDraft('', room)).toBeNull(); expect(readRoomStockTargetDraft('0', room)).toBe(0);
		expect(readRoomStockTargetDraft('NaN', room)).toBeUndefined(); expect(readRoomStockTargetDraft('1.5', room)).toBeUndefined();
		room.recipeId = 'trauma-kit'; expect(readRoomStockTargetDraft('8', room)).toBe(8); expect(readRoomStockTargetDraft('9', room)).toBeUndefined();
		room.recipeId = '__proto__'; expect(roomStockTargetEditor(state, room)).toContain('Выбери рецепт');
	});

	test('level two recipes show their tradeoff before unlock and worker-adjusted time after staffing', () => {
		const state = createGame(NOW), room = state.shelter.rooms.find(item => item.type === 'radio')!;
		const recipe = RESOURCE_RECIPE_BY_ID['intel-analysis']!;
		const locked = shelterRecipeCard(state, room, recipe);
		expect(locked).toContain('Откроется на уровне 2'); expect(locked).toContain('Нужно это помещение уровня 2');
		expect(locked).toContain('Экономит рубли ценой деталей и времени'); expect(locked).toContain('Базовая работа 1:30');
		expect(roomUpgradeRecipeBenefits(room)).toContain(recipe.label);
		room.level = 2; expect(assignWorker(state, state.scavs[0]!.id, room.id, NOW).ok).toBe(true);
		expect(shelterRecipeCard(state, room, recipe)).toContain('С текущими рабочими ≈');
		expect(shelterRecipeCard(state, room, recipe)).toContain('data-supply="scrap"');
	});

	test('kit recipes expose a paid single-order queue alongside automatic selection and preserve worker cost', () => {
		const state = createGame(NOW), room = state.shelter.rooms.find(item => item.type === 'workshop')!;
		const html = shelterRecipeCard(state, room, RESOURCE_RECIPE_BY_ID['maintenance-kit']!);
		expect(html).toContain('data-action="queue-field-kit"'); expect(html).toContain('data-kit="maintenance"');
		expect(html).toContain('Изготовить один'); expect(html).toContain('Выбрать для автоматического выпуска');
		expect(html).toContain('дождётся работников'); expect(html).toContain('цель повторения на него не влияет');
		expect(html).toContain('Рабочий, занятый этой партией, не выходит в рейд');
		expect(html).toContain('Ремкомплект +1 · хранится до 8');
	});

	test('kit choice shows stock, missing-production link and single-person repeated expenditure', () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		expect(setFieldKit(state, scav.id, 'trauma').ok).toBe(true);
		const before = JSON.stringify(state); freeze(state);
		const html = fieldKitEditor(state, scav);
		expect(html).toContain('Комплект для выхода Борода'); expect(html).toContain('Травмы бойца −35%');
		expect(html).toContain('при каждой отправке, включая автовыход'); expect(html).toContain('Шанс пройти этап не меняется');
		expect(html).toContain('На складе нет комплекта'); expect(html).toContain('data-id="room-medbay"');
		expect(raidPlanSummary(scav)).toContain('Травмокомплект ×1'); expect(JSON.stringify(state)).toBe(before);
	});

	test('live support brief uses consumed kit snapshot after future choice changes', () => {
		const state = createGame(NOW), scav = state.scavs[0]!;
		state.shelter.logistics = { reserve: { money: 0, supplies: { ammo: 0, medicine: 0, scrap: 0, intel: 0 } }, kits: { maintenance: 1, trauma: 1 } };
		expect(setFieldKit(state, scav.id, 'maintenance').ok).toBe(true);
		expect(dispatchRaid(state, scav.id, 'courtyard', NOW).ok).toBe(true);
		expect(setFieldKit(state, scav.id, 'trauma').ok).toBe(true);
		const html = planBrief(state.raids[0]!);
		expect(html).toContain('Ремкомплект'); expect(html).toContain('износ оружия и модулей −40%'); expect(html).not.toContain('Травмокомплект');
		expect(planBrief({})).toBe('');
	});
});
