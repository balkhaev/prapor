import { LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT, type EconomyLoot, type LiveDrop, type LivePlayer } from './game/live';
import { LOOT_CATEGORY_LABELS } from './game/loot';
import { getLootUses } from './game/loot-uses';
import { RARITY_LABELS } from './game/data';
import { getLiveLootDefinition } from './game/live-loot';
import { GEAR_MODEL_BY_ID } from './game/systems';
import { MODULE_BY_ID } from './game/modules';
import { scavGearIllustration } from './scav-gear-art';
import { moduleArt } from './armory-art';
import { gearBenefits } from './flea-ui';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const money = (value: number) => Math.floor(value).toLocaleString('ru-RU');
const weight = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: value > 0 && value < 1 ? 2 : 1 });

export function liveLootTotals(items: readonly EconomyLoot[]) {
  return items.reduce((total, item) => {
    const model = getLiveLootDefinition(item);
    total.weight += model.weight; total.guide += model.guidePrice; total.trader += model.traderPrice??0;
    return total;
  }, { weight: 0, guide: 0, trader: 0 });
}

function lootRows(items: readonly EconomyLoot[]): string {
  return items.map(item => {
    const model = getLiveLootDefinition(item),category=model.kind==='gear'?'Снаряжение':model.kind==='module'?'Оружейный модуль':LOOT_CATEGORY_LABELS[model.category as keyof typeof LOOT_CATEGORY_LABELS];
    const uses=model.kind==='gear'?'После доставки можно выдать своему дикому':model.kind==='module'?'После доставки можно установить на оружие':[...new Set(getLootUses(model.modelId).map(use=>use.kind==='construction'?'Стройка':use.kind==='production'?'Производство':'Бартер'))].join(' · ');
    const art=model.kind==='gear'?scavGearIllustration(model.modelId,model.label):model.kind==='module'?moduleArt(MODULE_BY_ID[model.modelId]!):'';
    return `<li class="live-loot-item rarity-${model.rarity}">${art?`<span class="live-physical-loot-art">${art}</span>`:''}<span><strong>${escape(model.label)}</strong><small>${escape(RARITY_LABELS[model.rarity])} · ${escape(category)} · ${weight(model.weight)} кг${model.condition===null?'':` · Состояние ${model.condition}%`}</small>${model.kind==='gear'?`<small>${escape(gearBenefits(GEAR_MODEL_BY_ID[model.modelId]!,model.condition??100))}</small>`:''}<small>${model.autoSell?'Утиль · автопродажа при доставке':escape(uses||'Выбираешь продажу сам')}</small></span><span><b>${money(model.guidePrice)} ₽</b><small>${model.traderPrice===null?'Сохраняется целиком':`${model.autoSell?'автопродажа':'торговцу'} ${money(model.traderPrice)} ₽`}</small></span></li>`;
  }).join('');
}

/** Carried items still risk being lost; parcels already extracted never go back on the map. */
export function liveLootCargo(player: LivePlayer): string {
  const items = player.lootItems ?? [], total = liveLootTotals(items);
  const junk=items.filter(item=>getLiveLootDefinition(item).autoSell),autoCash=junk.reduce((sum,item)=>sum+(getLiveLootDefinition(item).traderPrice??0),0),useful=items.length-junk.length;
  const parcels = player.pendingDelivery ?? [], pendingItems = parcels.flatMap(parcel => parcel.items);
  const pendingMoney = parcels.reduce((sum, parcel) => sum + parcel.money, 0);
  if (!player.gameId && !items.length && !parcels.length) return '';
  return `<section class="live-cargo"><h3>Рюкзак <span>${items.length}/${LIVE_LOOT_CAPACITY}</span></h3><div class="live-cargo-weight"><span>${weight(total.weight)} / ${LIVE_LOOT_WEIGHT} кг</span><span>Ориентир ${money(total.guide)} ₽</span></div><div class="live-load-bar" aria-label="Вес рюкзака ${weight(total.weight)} из ${LIVE_LOOT_WEIGHT} кг"><i style="width:${Math.min(100, total.weight / LIVE_LOOT_WEIGHT * 100)}%"></i></div>${items.length ? `<ul class="live-loot-items">${lootRows(items)}</ul>${junk.length?`<p>Утиль: ${junk.length} шт. · автопродажа при доставке ${money(autoCash)} ₽.</p>`:''}${useful?`<p>Полезные предметы сохрани для стройки, производства и бартера; снаряжение выдашь диким, модули установишь на оружие.${items.some(item=>{const model=getLiveLootDefinition(item);return !model.autoSell&&model.traderPrice!==null;})?` Торговцу за подходящие предметы: ${money(total.trader-autoCash)} ₽.`:""} На барахолке назначишь свою цену после доставки.</p>`:''}` : '<p>Ищи тайники и добычу противников. Утиль продастся при доставке, полезные находки останутся для твоих решений.</p>'}<p class="live-cargo-risk">Донеси до зелёного выхода. Если бойца выбьют, добыча останется на карте.</p></section>${parcels.length ? `<section class="live-delivery" role="status"><h3>Уже вынесено · ждёт доставки</h3><p>Предметов: ${pendingItems.length}${pendingMoney ? ` · деньги: ${money(pendingMoney)} ₽` : ''}. Добыча сохранена вне карты и не теряется, если бойца выбьют.</p><ul class="live-loot-items">${lootRows(pendingItems)}</ul>${parcels.map(parcel => `<p>${escape(parcel.message)}</p>`).join('')}<p>Освободи место на складе убежища. Доставка повторится автоматически.</p></section>` : ''}`;
}

export function liveDropLabel(drop: LiveDrop): string {
  const items = drop.items ?? [];
  const named = items.map(item => getLiveLootDefinition(item).label).join(', ');
  return items.length ? `${named}${drop.amount ? ` · ${money(drop.amount)} ₽` : ''}` : `Груз · ${money(drop.amount)} ₽`;
}

export function liveDropDetails(drop: LiveDrop): string {
  const items = drop.items ?? [], total = liveLootTotals(items);
  return items.length ? `${weight(total.weight)} кг · ориентир ${money(total.guide)} ₽${items.some(item=>getLiveLootDefinition(item).traderPrice!==null)?` · торговцу за подходящие предметы ${money(total.trader)} ₽`:''}` : 'Денежный груз';
}

/** Refresh HQ after a committed deposit, supply deduction or observed outbox delivery. */
export function liveEconomyChanged(previous: LivePlayer | null, next: LivePlayer, command?: string): boolean {
  if (!next.gameId) return false;
  if (command === 'resupply' || command === 'extract' || command === 'travel') return true;
  if (!previous || previous.gameId !== next.gameId) return true;
  if (next.ammo > previous.ammo || next.medkits > previous.medkits) return true;
  if (Object.keys(next.medicine).some(type => next.medicine[type as keyof typeof next.medicine] > previous.medicine[type as keyof typeof previous.medicine])) return true;
  const before = previous.pendingDelivery ?? [], after = next.pendingDelivery ?? [];
  if (before.length > after.length) return true;
  const afterIds = new Set(after.flatMap(parcel => parcel.items).map(item => item.id));
  return before.flatMap(parcel => parcel.items).some(item => !afterIds.has(item.id));
}
