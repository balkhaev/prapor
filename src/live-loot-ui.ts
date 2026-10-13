import { LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT, type EconomyLoot, type LiveDrop, type LivePlayer } from './game/live';
import { getLootTraderPrice, LOOT_CATEGORY_LABELS, LOOT_MODEL_BY_ID } from './game/loot';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const money = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const weight = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export function liveLootTotals(items: readonly EconomyLoot[]) {
  return items.reduce((total, item) => {
    const model = LOOT_MODEL_BY_ID[item.modelId]!;
    total.weight += model.weight; total.guide += model.guidePrice; total.trader += getLootTraderPrice(item);
    return total;
  }, { weight: 0, guide: 0, trader: 0 });
}

function lootRows(items: readonly EconomyLoot[]): string {
  return items.map(item => {
    const model = LOOT_MODEL_BY_ID[item.modelId]!;
    return `<li class="live-loot-item rarity-${model.rarity}"><span><strong>${escape(model.label)}</strong><small>${escape(LOOT_CATEGORY_LABELS[model.category])} · ${weight(model.weight)} кг</small></span><span><b>${money(model.guidePrice)} ₽</b><small>торговцу ${money(getLootTraderPrice(item))} ₽</small></span></li>`;
  }).join('');
}

/** Carried items still risk being lost; parcels already extracted never go back on the map. */
export function liveLootCargo(player: LivePlayer): string {
  const items = player.lootItems ?? [], total = liveLootTotals(items);
  const parcels = player.pendingDelivery ?? [], pendingItems = parcels.flatMap(parcel => parcel.items);
  const pendingMoney = parcels.reduce((sum, parcel) => sum + parcel.money, 0);
  if (!player.gameId && !items.length && !parcels.length) return '';
  return `<section class="live-cargo"><h3>Рюкзак <span>${items.length}/${LIVE_LOOT_CAPACITY}</span></h3><div class="live-cargo-weight"><span>${weight(total.weight)} / ${LIVE_LOOT_WEIGHT} кг</span><span>Ориентир ${money(total.guide)} ₽</span></div><div class="live-load-bar" aria-label="Вес рюкзака ${weight(total.weight)} из ${LIVE_LOOT_WEIGHT} кг"><i style="width:${Math.min(100, total.weight / LIVE_LOOT_WEIGHT * 100)}%"></i></div>${items.length ? `<ul class="live-loot-items">${lootRows(items)}</ul><p>Торговцу: ${money(total.trader)} ₽. На барахолке назначишь свою цену после доставки.</p>` : '<p>Ищи тайники и добычу противников. Каждый предмет можно оставить для убежища или продать.</p>'}<p class="live-cargo-risk">Донеси до зелёного выхода. Если бойца выбьют, добыча останется на карте.</p></section>${parcels.length ? `<section class="live-delivery" role="status"><h3>Уже вынесено · ждёт доставки</h3><p>Предметов: ${pendingItems.length}${pendingMoney ? ` · деньги: ${money(pendingMoney)} ₽` : ''}. Добыча сохранена вне карты и не теряется, если бойца выбьют.</p><ul class="live-loot-items">${lootRows(pendingItems)}</ul>${parcels.map(parcel => `<p>${escape(parcel.message)}</p>`).join('')}<p>Освободи место на складе убежища. Доставка повторится автоматически.</p></section>` : ''}`;
}

export function liveDropLabel(drop: LiveDrop): string {
  const items = drop.items ?? [];
  const named = items.map(item => LOOT_MODEL_BY_ID[item.modelId]!.label).join(', ');
  return items.length ? `${named}${drop.amount ? ` · ${money(drop.amount)} ₽` : ''}` : `Груз · ${money(drop.amount)} ₽`;
}

export function liveDropDetails(drop: LiveDrop): string {
  const items = drop.items ?? [], total = liveLootTotals(items);
  return items.length ? `${weight(total.weight)} кг · ориентир ${money(total.guide)} ₽ · торговцу ${money(total.trader)} ₽` : 'Денежный груз';
}

/** Refresh HQ after a committed deposit, supply deduction or observed outbox delivery. */
export function liveEconomyChanged(previous: LivePlayer | null, next: LivePlayer, command?: string): boolean {
  if (!next.gameId) return false;
  if (command === 'resupply' || command === 'extract' || command === 'travel') return true;
  if (!previous || previous.gameId !== next.gameId) return true;
  if (next.ammo > previous.ammo || next.medkits > previous.medkits) return true;
  const before = previous.pendingDelivery ?? [], after = next.pendingDelivery ?? [];
  if (before.length > after.length) return true;
  const afterIds = new Set(after.flatMap(parcel => parcel.items).map(item => item.id));
  return before.flatMap(parcel => parcel.items).some(item => !afterIds.has(item.id));
}
