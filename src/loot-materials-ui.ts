import { LOOT_MODEL_BY_ID } from './game/loot';
import { getLootUses } from './game/loot-uses';
import type { ProductionJob } from './game/shelter';
import { RARITY_LABELS } from './game/data';
import { FIELD_KITS } from './game/shelter-logistics';

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]!));
export interface LootRequirementProgress { modelId: string; required: number; owned: number }
export function lootSearchText(modelId: string): string {
  const model=Object.hasOwn(LOOT_MODEL_BY_ID,modelId)?LOOT_MODEL_BY_ID[modelId]:null;
  if(!model)return '';
  return `${model.label} ${model.description} ${RARITY_LABELS[model.rarity]} ${model.autoSell?'утиль мусор автопродажа':getLootUses(modelId).map(use=>`${use.kind==='construction'?'стройка':use.kind==='production'?'производство':'бартер'} ${use.label}`).join(' ')}`;
}

/** Named items stay separate from fungible scrap and cash in every payment preview. */
export function lootRequirementsPanel(requirements: readonly LootRequirementProgress[] | undefined, purpose = 'Материалы из рейдов'): string {
  if(!requirements?.length)return '';
  return `<section class="loot-material-requirements"><strong>${escape(purpose)}</strong><div>${requirements.map(need=>`<div class="${need.owned>=need.required?'complete':'missing'}"><span>${escape(LOOT_MODEL_BY_ID[need.modelId]?.label??'Неизвестный материал')}</span><b>На складе ${need.owned} / нужно ${need.required}</b></div>`).join('')}</div><small>Целые предметы расходуются при запуске. Разобранные материалы и предметы на барахолке не входят в этот набор.</small></section>`;
}

export function lootUsesPanel(modelId: string): string {
  const model=Object.hasOwn(LOOT_MODEL_BY_ID,modelId)?LOOT_MODEL_BY_ID[modelId]:null;
  if(!model)return '';
  if(model.autoSell)return '<p class="loot-disposition junk">Утиль · автопродажа при доставке. Не используется в рецептах.</p>';
  const uses=getLootUses(modelId);
  if(!uses.length)return '';
  return `<div class="loot-uses"><strong>Сохранить для:</strong>${uses.map(use=>`<div><span>${escape(use.kind==='construction'?'Стройка':use.kind==='production'?'Производство':'Бартер')} · ${escape(use.label)} ×${use.quantity}</span><button class="text-button" data-action="${use.kind==='barter'?'flea-barter-model':use.kind==='construction'?'flea-use-construction':'flea-use-production'}" ${use.kind==='barter'?`data-model="${escape(modelId)}"`:use.kind==='construction'?`data-room-type="${escape(use.id)}"`:`data-id="${escape(use.id)}"`}>${use.kind==='barter'?'К бартеру':use.kind==='construction'?'К постройке':'К рецепту'} →</button></div>`).join('')}</div>`;
}

export function productionLootReceipt(job: Pick<ProductionJob,'paidLoot'>): string {
  if(!job.paidLoot?.length)return '';
  return `<p class="production-loot-paid">Материалы израсходованы: ${job.paidLoot.map(item=>escape(LOOT_MODEL_BY_ID[item.modelId]?.label??'Трофей')).join(' · ')}. Целые трофеи не возвращаются при отмене, даже если работа ещё не началась.</p>`;
}
export function productionRefundLabel(job: Pick<ProductionJob,'paidLoot'|'workDone'>): string {
  return job.workDone>0?'Работа начата · отмена без возврата':job.paidLoot?.length?'Не начат · вернутся только рубли и припасы':'Не начат · полный возврат при отмене';
}
export function productionOutputSnapshot(job: Pick<ProductionJob,'output'|'workRequired'>): string {
  const labels={ammo:'Патроны',medicine:'Медикаменты',scrap:'Детали',intel:'Разведданные'};
  const outputs=[job.output.fieldKit?`${FIELD_KITS[job.output.fieldKit].label} +1`:'',...Object.entries(job.output.supplies).filter(([,amount])=>amount>0).map(([key,amount])=>`${labels[key as keyof typeof labels]} +${amount}`)].filter(Boolean);
  return `<div class="recipe-output">${outputs.map(output=>`<span>${escape(output)}</span>`).join('')}</div><small class="production-paid-duration">Оплаченная базовая работа: ${Math.round(job.workRequired/1_000_000)} с.</small>`;
}
