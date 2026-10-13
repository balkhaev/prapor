import type { GameState, Raid, RaidReport, Scav } from './game/engine';
import { MAP_BY_ID, type Supplies } from './game/data';
import { getRaidPlan, getSectorIntel, RAID_OBJECTIVES, RAID_PREPARATIONS, SECTOR_KNOWLEDGE_CHANCE, SECTOR_PRESSURE_CHANCE, type RaidObjective, type RaidStrategy } from './game/raid-strategy';
import { FIELD_KITS, getFieldKitStock } from './game/shelter-logistics';

const e = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const n = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const objectiveIds = Object.keys(RAID_OBJECTIVES) as RaidObjective[];

function supplyAmount(supply: keyof Supplies, value: number): string {
	const amount = Math.floor(value), tail = amount % 100, digit = amount % 10;
	const form = tail >= 11 && tail <= 14 ? 2 : digit === 1 ? 0 : digit >= 2 && digit <= 4 ? 1 : 2;
	const units = { ammo: ['патрон', 'патрона', 'патронов'], medicine: ['медикамент', 'медикамента', 'медикаментов'], scrap: ['ед. металла', 'ед. металла', 'ед. металла'], intel: ['разведданных', 'разведданных', 'разведданных'] };
	return `${n(amount)} ${units[supply][form]}`;
}

function strategyLabel(strategy: Pick<RaidStrategy, 'objective' | 'preparation'>): string {
	return `${RAID_OBJECTIVES[strategy.objective].label} · ${RAID_PREPARATIONS[strategy.preparation].label}`;
}

export function fieldKitEditor(state: GameState, scav: Scav): string {
	const stock = getFieldKitStock(state), selection = scav.fieldKit ?? 'none';
	const kit = selection === 'none' ? null : FIELD_KITS[selection];
	const room = kit ? state.shelter.rooms.find(item => item.type === (selection === 'maintenance' ? 'workshop' : 'medbay')) : null;
	const effect = selection === 'maintenance' ? 'Износ оружия и установленных модулей −40% на всех этапах.' : selection === 'trauma' ? 'Травмы бойца −35% на всех этапах.' : 'Без расхода комплектов. Изготавливай поддержку в мастерской или медблоке.';
	return `<div class="raid-field-kit"><label class="field-label">Комплект из убежища<select data-field-kit="${e(scav.id)}" data-focus-key="field-kit" aria-label="Комплект для выхода ${e(scav.name)}"><option value="none" ${selection === 'none' ? 'selected' : ''}>Без комплекта</option>${(['maintenance', 'trauma'] as const).map(id => `<option value="${id}" ${selection === id ? 'selected' : ''}>${e(FIELD_KITS[id].label)} · на складе ${stock[id]}</option>`).join('')}</select></label><p class="raid-field-kit-note ${kit && !stock[selection as keyof typeof stock] ? 'raid-field-kit-warning' : ''}">${e(effect)} ${kit ? `Расход: 1 комплект на бойца при каждой отправке, включая автовыход. Шанс пройти этап не меняется.${stock[selection as keyof typeof stock] === 0 ? ' На складе нет комплекта — отправка будет ждать производства.' : ''}` : ''}</p>${kit ? `<button class="text-button" ${room ? `data-action="open-work-room" data-id="${e(room.id)}"` : 'data-page="base"'}>${room ? `Изготовить: ${selection === 'maintenance' ? 'мастерская' : 'медблок'} →` : 'Построить комнату →'}</button>` : ''}</div>`;
}

/** Configures the next departure; the running sortie reads its own snapshot. */
export function raidPlanEditor(state: GameState, scav: Scav, mapId: string): string {
	const plan = getRaidPlan(scav), objective = RAID_OBJECTIVES[plan.objective], preparation = RAID_PREPARATIONS[plan.preparation];
	const busy = state.raids.some(raid => raid.scavId === scav.id) || scav.status === 'raiding';
	const effects = [objective.supply ? `Успешный этап даёт +${supplyAmount(objective.supply, objective.resourceBonus)}; целевой ресурс сохраняют в первую очередь при перегрузе.` : 'Обычный баланс припасов, денег и трофеев.',
		objective.moneyMultiplier < 1 ? `Деньги −${Math.round((1 - objective.moneyMultiplier) * 100)}%, шанс найти модуль — вдвое ниже.` : '',
		objective.chanceBonus ? `Шанс пройти этап ${objective.chanceBonus > 0 ? '+' : '−'}${Math.round(Math.abs(objective.chanceBonus) * 100)} п.п.` : '',
		objective.durationMultiplier !== 1 ? `Время этапа +${Math.round((objective.durationMultiplier - 1) * 100)}%.` : ''].filter(Boolean).join(' ');
	const preparationText = plan.preparation === 'scouted'
		? `${n(preparation.money)} ₽ и ${preparation.intel} разведданных на этого бойца: +${Math.round(preparation.chanceBonus * 100)} п.п. к шансу и −${Math.round((1 - preparation.durationMultiplier) * 100)}% времени на всех этапах. Оплата один раз, при отправке.`
		: 'Без дополнительной оплаты. Можно заранее проверить маршрут за 20 ₽ и 2 разведданных на каждого бойца.';
	return `<section class="raid-plan-editor" aria-label="План выхода ${e(scav.name)}"><div class="raid-plan-heading"><span class="eyebrow">${busy ? 'План следующего выхода' : 'Задача на выход'}</span><small>${e(MAP_BY_ID[mapId]?.name ?? 'Выбранный сектор')}</small></div><div class="raid-plan-fields"><label class="field-label">Что искать<select data-raid-objective="${e(scav.id)}" data-focus-key="raid-objective" aria-label="Цель выхода ${e(scav.name)}">${objectiveIds.map(id => `<option value="${id}" ${plan.objective === id ? 'selected' : ''}>${e(RAID_OBJECTIVES[id].label)}</option>`).join('')}</select></label><label class="field-label">Подготовка маршрута<select data-raid-preparation="${e(scav.id)}" data-focus-key="raid-preparation" aria-label="Подготовка выхода ${e(scav.name)}">${(Object.keys(RAID_PREPARATIONS) as (keyof typeof RAID_PREPARATIONS)[]).map(id => `<option value="${id}" ${plan.preparation === id ? 'selected' : ''}>${e(RAID_PREPARATIONS[id].label)}${id === 'scouted' ? ` · ${preparationCost(id)}` : ''}</option>`).join('')}</select></label></div><p class="raid-plan-effect">${e(effects)}</p><p class="raid-plan-preparation">${e(preparationText)}</p>${fieldKitEditor(state, scav)}<small class="raid-plan-note">${busy ? 'Приказы уже идущего выхода сохранены. Эти настройки действуют со следующей отправки, в том числе в автосерии.' : 'Цель меняет добычу, но груз попадает на склад только после эвакуации. Эти настройки действуют и в автосерии.'}</small></section>`;
}

function preparationCost(id: keyof typeof RAID_PREPARATIONS): string {
	const preparation = RAID_PREPARATIONS[id];
	return `${n(preparation.money)} ₽ + ${preparation.intel} разв.`;
}

/** A compact personal order in the squad picker, without assuming party-wide plans. */
export function raidPlanSummary(scav: Scav): string {
	const plan = getRaidPlan(scav);
	return `<span class="raid-plan-summary">${e(RAID_OBJECTIVES[plan.objective].label)} · ${plan.preparation === 'scouted' ? `Разведка: ${preparationCost(plan.preparation)} за бойца` : 'Без разведподготовки'}${scav.fieldKit && scav.fieldKit !== 'none' ? ` · ${e(FIELD_KITS[scav.fieldKit].label)} ×1` : ''}</span>`;
}

export function sectorIntelPanel(state: GameState, mapId: string): string {
	if (!Object.hasOwn(MAP_BY_ID, mapId)) return '';
	const intel = getSectorIntel(state, mapId), knowledgeBonus = (intel.knowledge * SECTOR_KNOWLEDGE_CHANCE * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
	const pressurePenalty = (intel.pressure * Math.abs(SECTOR_PRESSURE_CHANCE) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
	return `<section class="sector-intel" aria-label="Обстановка в секторе ${e(MAP_BY_ID[mapId]!.name)}"><div class="sector-intel-heading"><span class="eyebrow">Обстановка в секторе</span><strong>${e(MAP_BY_ID[mapId]!.name)}</strong></div><div class="sector-intel-grid"><div><span>Знание местности</span><strong>${intel.knowledge} / 5</strong><meter min="0" max="5" value="${intel.knowledge}" aria-label="Знание местности: ${intel.knowledge} из 5"></meter><small>+${knowledgeBonus} п.п. к шансу</small></div><div class="${intel.pressure >= 4 ? 'sector-intel-pressure' : ''}"><span>Внимание патрулей</span><strong>${intel.pressure} / 6</strong><meter min="0" max="6" value="${intel.pressure}" aria-label="Внимание патрулей: ${intel.pressure} из 6"></meter><small>−${pressurePenalty} п.п. к шансу</small></div></div><p>Успешная эвакуация с целью «Разведданные» или завершённая разведветка углубляет знание местности. Каждый завершённый выход привлекает патрули; глубокий маршрут или бой — сильнее. Выход в другой сектор снижает их внимание здесь.</p><small>Подготовленная разведка помогает пройти этап, но не гарантирует возвращение.</small></section>`;
}

/** Only a recorded snapshot describes a running sortie or historical receipt. */
export function planBrief(item: Pick<Raid, 'strategy' | 'fieldKit'> | Pick<RaidReport, 'strategy' | 'fieldKit'>): string {
	const kit = item.fieldKit ? `${e(FIELD_KITS[item.fieldKit].label)}: ${item.fieldKit === 'maintenance' ? 'износ оружия и модулей −40%' : 'травмы −35%'}` : item.fieldKit === null ? 'Без комплекта из убежища' : '';
	return item.strategy || kit ? `<small class="raid-plan-brief">${item.strategy ? `Задача: ${e(strategyLabel(item.strategy))}` : ''}${kit ? `${item.strategy ? ' · ' : ''}Комплект: ${kit}` : ''}</small>` : '';
}

export function raidStrategyResults(report: RaidReport, receipts: readonly RaidReport[] = [report]): string {
	const members = report.squad?.members;
	const rows = members ? members.map(member => ({ name: member.scavName, receipt: member.raidId === report.raidId ? report : receipts.find(item => item.raidId === member.raidId) }))
		: [{ name: report.scavName, receipt: report }];
	if (!rows.some(row => row.receipt?.strategy)) return '';
	return `<div class="raid-strategy-results"><span class="eyebrow">Задача и результат</span>${rows.map(({ name, receipt }) => {
		if (!receipt) return `<p><strong>${e(name)}</strong><span>Личный отчёт не сохранился; доставка по его задаче неизвестна.</span></p>`;
		if (!receipt.strategy) return `<p><strong>${e(name)}</strong><span>Выход по прежним правилам; задача в отчёте не указана.</span></p>`;
		const strategy = receipt.strategy, objective = RAID_OBJECTIVES[strategy.objective];
		const delivered = objective.supply
			? `На склад доставлено ${supplyAmount(objective.supply, receipt.success ? receipt.supplies[objective.supply] : 0)} по целевой задаче.`
			: 'Общий поиск; доставленная добыча перечислена ниже.';
		return `<p><strong>${e(name)}</strong><span>${e(strategyLabel(strategy))}. ${e(delivered)}${receipt.fieldKit ? ` В выходе использован ${e(FIELD_KITS[receipt.fieldKit].label)}; ${receipt.fieldKit === 'maintenance' ? 'износ оружия и модулей −40%' : 'травмы −35%'} на всех этапах.` : receipt.fieldKit === null ? ' Без комплекта из убежища.' : ''}</span></p>`;
	}).join('')}${report.sectorOutcome ? `<small class="raid-strategy-sector-result">Обстановка после выхода: знание ${report.sectorOutcome.knowledge} / 5 · патрули ${report.sectorOutcome.pressure} / 6. Это зафиксированный итог выхода.</small>` : ''}</div>`;
}
