import { FIELD_KITS, getFieldKitStock, getProductionReserve, getResourceProductionQuote, getFieldKitProductionQuote, type GameState, type RoomInstance } from './game/engine';
import { RESOURCE_RECIPES, RESOURCE_RECIPE_BY_ID, ROOM_DEFINITIONS, type ShelterCost } from './game/shelter';
import type { Supplies } from './game/data';

const e = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const n = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const labels = { money: 'Рубли', ammo: 'Патроны', medicine: 'Медикаменты', scrap: 'Детали', intel: 'Разведданные' };
const keys = ['money', 'ammo', 'medicine', 'scrap', 'intel'] as const;
export type ReserveDraft = Record<typeof keys[number], string>;
const recipeById = (id: string | null) => id && Object.hasOwn(RESOURCE_RECIPE_BY_ID, id) ? RESOURCE_RECIPE_BY_ID[id]! : null;

function integerInput(value: string, maximum: number): number | null {
	const text = value.trim();
	if (!/^(0|[1-9]\d*)$/.test(text)) return null;
	const amount = Number(text);
	return Number.isSafeInteger(amount) && amount <= maximum ? amount : null;
}

/** Blank, fractional and non-finite values cannot become an accidental zero reserve. */
export function readProductionReserveDraft(draft: ReserveDraft): ShelterCost | null {
	const values = keys.map(key => integerInput(draft[key], key === 'money' ? 1_000_000_000 : 1_000_000));
	if (values.some(value => value === null)) return null;
	return { money: values[0]!, supplies: { ammo: values[1]!, medicine: values[2]!, scrap: values[3]!, intel: values[4]! } };
}

export function readRoomStockTargetDraft(value: string, room: RoomInstance): number | null | undefined {
	if (value.trim() === '') return null;
	const recipe = recipeById(room.recipeId);
	return integerInput(value, recipe?.outputKit ? FIELD_KITS[recipe.outputKit].capacity : 1_000_000) ?? undefined;
}

export function productionReserveEditor(state: GameState, scope: string, draft: ReserveDraft | null = null, compact = false): string {
	const reserve = getProductionReserve(state);
	const values = { money: reserve.money, ...reserve.supplies };
	const editor = `<div class="production-reserve-editor" data-reserve-editor="${e(scope)}"><p>Оставлять на выходы и лечение. Новые партии и заказы модулей ждут, если оплата опустит запас ниже этих значений. Рейды, лечение и стройка могут расходовать резерв; оплаченная очередь продолжится.</p><div class="production-reserve-fields">${keys.map(key => `<label class="field-label">${labels[key]}<input type="number" inputmode="numeric" min="0" max="${key === 'money' ? 1_000_000_000 : 1_000_000}" step="1" value="${e(draft?.[key] ?? values[key])}" data-production-reserve="${key}" data-focus-key="reserve-${e(scope)}-${key}" aria-label="Резерв производства: ${labels[key]}"></label>`).join('')}</div><button class="button secondary small" data-action="save-production-reserve" data-focus-key="reserve-${e(scope)}-apply">Применить резерв</button><small class="quote-note">Общий для всех комнат. Значения сохраняются только после применения.</small></div>`;
	return compact ? `<details class="shelter-logistics-details" data-logistics-detail="reserve-${e(scope)}"><summary>Общий резерв для выходов <span>Настроить</span></summary>${editor}</details>`
		: `<section class="shelter-logistics-section"><div class="section-head"><h3>Резерв для выходов</h3><span class="eyebrow">ОБЩИЙ ДЛЯ ПРОИЗВОДСТВА</span></div>${editor}</section>`;
}

export function fieldKitStockPanel(state: GameState, compact = false): string {
	const stock = getFieldKitStock(state);
	return `<section class="shelter-kit-stock ${compact ? 'compact' : ''}" aria-label="Запас комплектов для выхода"><div><span class="eyebrow">Поддержка из убежища</span><h3>Комплекты для выхода</h3><p>Выбери один комплект для бойца в плане выхода. Он расходуется при каждой отправке, включая автосерию; действует на весь маршрут.</p></div><div class="shelter-kit-grid">${(['maintenance', 'trauma'] as const).map(kit => {
		const definition = FIELD_KITS[kit], roomType = kit === 'maintenance' ? 'workshop' : 'medbay';
		const room = state.shelter.rooms.find(item => item.type === roomType);
		return `<article><div><strong>${e(definition.label)}</strong><b data-field-kit-stock="${kit}">${stock[kit]} / ${definition.capacity}</b></div><p>${e(definition.description)} Шанс пройти этап не меняется.</p><button class="text-button" ${room ? `data-action="open-work-room" data-id="${e(room.id)}"` : 'data-page="base"'}>${room ? `${ROOM_DEFINITIONS[roomType].label}: изготовить →` : `Построить: ${ROOM_DEFINITIONS[roomType].label} →`}</button></article>`;
	}).join('')}</div><small>Комплекты делают назначенные рабочие. Пока боец работает, он не участвует в рейдах.</small></section>`;
}

export function roomStockTargetEditor(state: GameState, room: RoomInstance, draft?: string): string {
	const recipe = recipeById(room.recipeId);
	const resource = recipe ? (Object.keys(recipe.output) as (keyof Supplies)[]).find(key => recipe.output[key] > 0) : null;
	const stock = recipe?.outputKit ? getFieldKitStock(state)[recipe.outputKit] : resource ? state.supplies[resource] : null;
	const limit = recipe?.outputKit ? FIELD_KITS[recipe.outputKit].capacity : 1_000_000;
	const subject = recipe?.outputKit ? FIELD_KITS[recipe.outputKit].label : resource ? labels[resource] : 'Выбери рецепт';
	return `<div class="room-stock-target"><label class="field-label">Запас для повторения<input type="number" inputmode="numeric" min="0" max="${limit}" step="1" placeholder="Без ограничения" value="${e(draft ?? room.stockTarget ?? '')}" data-room-stock-target="${e(room.id)}" data-focus-key="stock-target-${e(room.id)}" aria-label="Целевой запас: ${e(ROOM_DEFINITIONS[room.type].label)}" ${!recipe || room.status !== 'ready' ? 'disabled' : ''}></label><button class="button secondary small" data-action="save-room-stock-target" data-id="${e(room.id)}" data-focus-key="stock-target-${e(room.id)}-apply" ${!recipe || room.status !== 'ready' ? 'disabled' : ''}>Применить цель</button><small class="quote-note">${e(subject)}${stock === null ? '' : `: на складе ${n(stock)}`}. Повторение ждёт, если целая следующая партия превысит цель, и возобновится после расхода. Пустое поле снимает ограничение. Оплаченные партии завершатся; при смене рецепта цель сбрасывается.</small></div>`;
}

function costLabel(cost: ShelterCost): string {
	return [cost.money ? `${n(cost.money)} ₽` : '', ...(Object.keys(cost.supplies) as (keyof Supplies)[]).filter(key => cost.supplies[key] > 0).map(key => `${cost.supplies[key]} ${labels[key].toLowerCase()}`)].filter(Boolean).join(' + ') || 'Без расхода';
}
const time = (seconds: number) => `${Math.floor(Math.ceil(seconds) / 60)}:${String(Math.ceil(seconds) % 60).padStart(2, '0')}`;

export function shelterRecipeCard(state: GameState, room: RoomInstance, recipe: typeof RESOURCE_RECIPES[number]): string {
	const quote = getResourceProductionQuote(state, room.id, recipe.id), selected = room.recipeId === recipe.id;
	const kitQuote = recipe.outputKit ? getFieldKitProductionQuote(state, room.id, recipe.outputKit) : null;
	const locked = room.level < (recipe.minLevel ?? 1), requirements = Object.keys(recipe.cost.supplies) as (keyof Supplies)[];
	const need = requirements.filter(key => recipe.cost.supplies[key] > 0).sort((a, b) => Number(state.supplies[a] >= recipe.cost.supplies[a]) - Number(state.supplies[b] >= recipe.cost.supplies[b]))[0];
	const output = recipe.outputKit ? `${FIELD_KITS[recipe.outputKit].label} +1 · хранится до ${FIELD_KITS[recipe.outputKit].capacity}`
		: (Object.keys(recipe.output) as (keyof Supplies)[]).filter(key => recipe.output[key] > 0).map(key => `${labels[key]} +${recipe.output[key]}`).join(' · ');
	return `<article class="resource-recipe ${selected ? 'selected' : ''} ${locked ? 'locked' : ''}"><div class="resource-recipe-head"><strong>${e(recipe.label)}</strong>${recipe.minLevel && recipe.minLevel > 1 ? `<span class="tag">УР. ${recipe.minLevel}</span>` : ''}</div><p>${e(recipe.description)}</p><div class="recipe-output"><span>${e(output)}</span></div><div class="loadout-stats"><span>Партия: ${e(costLabel(recipe.cost))}</span><span data-recipe-duration="${e(recipe.id)}">${quote.actualDuration == null ? `Базовая работа ${time(quote.duration)}` : `С текущими рабочими ≈ ${time(quote.actualDuration)}`}</span></div>${recipe.outputKit ? '<p class="field-hint">Комплект берут в плане выхода; он поддерживает весь маршрут и расходуется один раз на бойца. Рабочий, занятый этой партией, не выходит в рейд.</p>' : ''}${kitQuote ? `<button class="button secondary" data-action="queue-field-kit" data-id="${e(room.id)}" data-kit="${e(recipe.outputKit)}" data-focus-key="kit-order-${e(recipe.id)}" ${kitQuote.reason ? 'disabled' : ''}>Изготовить один · ${e(costLabel(recipe.cost))}</button><small class="quote-note" data-field-kit-order-note="${e(recipe.id)}">${e(kitQuote.reason ?? 'Оплата сейчас. Заказ займёт место в очереди и дождётся работников; цель повторения на него не влияет.')}</small>` : ''}<button class="button ${kitQuote ? 'ghost small' : 'secondary'}" data-action="set-room-recipe" data-id="${e(room.id)}" data-recipe-id="${e(recipe.id)}" data-focus-key="recipe-${e(recipe.id)}" ${room.status !== 'ready' || locked ? 'disabled' : ''}>${selected ? 'Подтвердить рецепт и режим' : locked ? `Откроется на уровне ${recipe.minLevel}` : kitQuote ? 'Выбрать для автоматического выпуска' : 'Выбрать рецепт'}</button><small class="quote-note" data-resource-recipe-note="${e(recipe.id)}">${e(quote.reason ?? 'Бойцы запустят партию; результат поступит на склад')}</small>${need ? `<div class="production-raid-need"><span>Для следующей партии нужны ${labels[need].toLowerCase()}: ${recipe.cost.supplies[need]}. На складе ${n(state.supplies[need])}.</span><button class="text-button" data-action="seek-production-resource" data-supply="${need}">Выход за ${need === 'ammo' ? 'патронами' : need === 'medicine' ? 'медикаментами' : need === 'scrap' ? 'деталями' : 'разведданными'} →</button></div>` : ''}</article>`;
}

export function roomUpgradeRecipeBenefits(room: RoomInstance): string {
	const recipes = RESOURCE_RECIPES.filter(recipe => recipe.roomType === room.type && (recipe.minLevel ?? 1) === room.level + 1);
	return recipes.length ? `<div class="room-upgrade-recipes"><strong>Следующий уровень открывает выбор</strong>${recipes.map(recipe => `<p><b>${e(recipe.label)}</b> · ${e(recipe.description)}</p>`).join('')}</div>` : '';
}
