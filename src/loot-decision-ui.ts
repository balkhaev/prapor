import { MAP_BY_ID } from './game/data';
import { LOOT_MODEL_BY_ID } from './game/loot';
import { BARTER_OFFERS, getBarterQuote } from './game/barter';
import { getLootDecisionProfile, getLootHuntOptions } from './game/loot-value';
import { GEAR_MODEL_BY_ID, type ExpeditionBranch } from './game/systems';
import { RESOURCE_RECIPE_BY_ID, ROOM_DEFINITIONS } from './game/shelter';
import { FIELD_KITS, getResourceProductionQuote, type GameState } from './game/engine';

const e=(value:unknown)=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const n=(value:number)=>Math.floor(value).toLocaleString('ru-RU');
const branchNames={scavenge:'Тайники',combat:'Оружейный склад',recon:'Разведка'};
const supplies={ammo:'Патроны',medicine:'Медикаменты',scrap:'Детали',intel:'Разведданные'};
export interface LootHuntSelection { modelId:string; mapId:string; branch:ExpeditionBranch; depth:number }

export function readLootHunt(value:unknown): LootHuntSelection | null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const source=value as Record<string,unknown>;
  if(Object.keys(source).length!==4||!['modelId','mapId','branch','depth'].every(key=>Object.hasOwn(source,key))||typeof source.modelId!=='string'||!Object.hasOwn(LOOT_MODEL_BY_ID,source.modelId)||LOOT_MODEL_BY_ID[source.modelId]!.autoSell)return null;
  const route=getLootHuntOptions(source.modelId).find(route=>route.mapId===source.mapId&&route.branch===source.branch&&route.depth===source.depth);
  return route?{modelId:source.modelId,mapId:route.mapId,branch:route.branch,depth:route.depth}:null;
}
export function chanceLabel(chance:number): string {
  return chance>0&&chance*100<.01?'<0,01%':`${(chance*100).toLocaleString('ru-RU',{maximumFractionDigits:2})}%`;
}
export function lootHuntHint(state:GameState,hunt:LootHuntSelection|null): string {
  const selection=readLootHunt(hunt);
  if(!selection)return '';
  const model=LOOT_MODEL_BY_ID[selection.modelId]!,map=MAP_BY_ID[selection.mapId]!,route=getLootHuntOptions(model.id).find(route=>route.mapId===selection.mapId&&route.branch===selection.branch&&route.depth===selection.depth)!;
  return `<section class="loot-hunt-hint"><span class="eyebrow">Цель поиска · ${e(model.label)}</span><strong>${e(map.name)} · этап ${selection.depth} · ${branchNames[selection.branch]}</strong><p>Первый этап — «Тайники». ${selection.depth>1?`На точках связи вручную выбери маршрут «${branchNames[selection.branch]}» к ${selection.depth}-му этапу. `:''}Затем эвакуируй добычу. Найти хотя бы один предмет на успешно пройденном целевом этапе: ${e(chanceLabel(route.checkpointChance))}.</p><small>${state.level<map.level?`Сектор откроется на уровне ${map.level}. `:''}Это шанс находки до выбора груза и эвакуации; перегруз и провал могут лишить трофея. Цель не меняет оплаченный план и не отправляет бойцов.</small><button class="text-button" data-action="flea-clear-hunt">Убрать цель поиска</button></section>`;
}
export function lootDecisionPanel(state:GameState,modelId:string): string {
  const model=Object.hasOwn(LOOT_MODEL_BY_ID,modelId)?LOOT_MODEL_BY_ID[modelId]:null;
  if(!model||model.autoSell)return '';
  const profile=getLootDecisionProfile(modelId);
  if(!profile)return '';
  const ranked=getLootHuntOptions(modelId),available=ranked.filter(route=>state.level>=MAP_BY_ID[route.mapId]!.level);
  const routes=available.length?[available[0]!]:ranked.slice(0,3);
  if(available.length){
    const add=(route:typeof ranked[number]|undefined)=>{if(route&&routes.length<3&&!routes.some(shown=>shown.mapId===route.mapId&&shown.branch===route.branch&&shown.depth===route.depth))routes.push(route);};
    add(ranked[0]);
    add(available.find(route=>!routes.some(shown=>shown.mapId===route.mapId&&shown.branch===route.branch&&shown.depth===route.depth)));
    for(const route of ranked)add(route);
  }
  return `<details class="loot-decision" data-loot-decision="${e(modelId)}"><summary data-focus-key="loot-decision-${e(modelId)}">Ценность и поиск</summary><div class="loot-decision-body"><div class="loot-cash-choices"><span>Торговец сейчас<strong>${n(profile.vendorPrice)} ₽</strong></span><span>Барахолка при цене ${n(model.guidePrice)} ₽<strong>${n(profile.marketGuideNet)} ₽ после сборов</strong><small>Только если купят. Цену лота выбираешь сам.</small></span></div><p class="loot-salvage-choice">Разбор предмета: ${Object.entries(profile.salvage).filter(([,amount])=>amount>0).map(([key,amount])=>`${supplies[key as keyof typeof supplies]} ×${amount}`).join(" · ")||"без материалов"}. Предмет будет израсходован.</p>${profile.barters.length?`<h5>Бартер на готовое снаряжение</h5>${profile.barters.map(value=>{const offer=BARTER_OFFERS.find(offer=>offer.id===value.offerId)!,gear=GEAR_MODEL_BY_ID[value.gearModelId]!,quote=getBarterQuote(state,offer.id);return `<article class="loot-choice"><strong>${e(gear.label)} · 100%</strong><small>${gear.protection?`Защита +${Math.round(gear.protection*100)}% · `:''}${gear.capacity?`Груз до ${gear.capacity} ед. · `:''}${gear.weight} кг</small><p>Полный набор: ${offer.requirements.map(need=>`${e(LOOT_MODEL_BY_ID[need.modelId]!.label)} ×${need.quantity}`).join(' · ')}.</p><small>Отдать торговцу весь набор: ${n(value.inputTraderValue)} ₽. Ориентир набора: ${n(value.inputGuideValue)} ₽.</small><small>Альтернатива по чертежу: ${n(value.craftMoney)} ₽ + ${value.craftScrap} дет. Бартер выдаёт предмет без чертежа и платы рублями.</small><small class="cost-reason">${e(quote.reason??'Набор на складе собран.')}</small><button class="text-button" data-action="flea-barter-model" data-model="${e(modelId)}">Посмотреть обмен →</button></article>`}).join('')}`:''}${profile.recipes.length?`<h5>Производство из целых предметов</h5>${profile.recipes.map(value=>{const recipe=RESOURCE_RECIPE_BY_ID[value.recipeId]!,room=state.shelter.rooms.find(room=>room.type===value.roomType&&room.status==='ready'),quote=room?getResourceProductionQuote(state,room.id,recipe.id):null,output=[value.outputKit?`${FIELD_KITS[value.outputKit].label} ×1`:'',...Object.entries(value.output).filter(([,amount])=>amount>0).map(([key,amount])=>`${supplies[key as keyof typeof supplies]} ×${amount}`)].filter(Boolean).join(' · ');return `<article class="loot-choice"><strong>${e(recipe.label)} → ${e(output)}</strong><p>Набор: ${(recipe.lootRequirements??[]).map(need=>`${e(LOOT_MODEL_BY_ID[need.modelId]!.label)} ×${need.quantity}`).join(' · ')}.</p><small>Отдать торговцу весь набор: ${n(value.inputTraderValue)} ₽. На партию дополнительно: ${n(value.money)} ₽${Object.entries(recipe.cost.supplies).filter(([,amount])=>amount>0).map(([key,amount])=>` + ${supplies[key as keyof typeof supplies]} ×${amount}`).join('')} · базовая работа ${value.durationSeconds} с.</small><small class="cost-reason">${e(quote?.reason??(room?'Партия доступна.':`Построй ${ROOM_DEFINITIONS[value.roomType].label} уровня ${value.minLevel}.`))}</small><button class="text-button" data-action="flea-use-production" data-id="${e(recipe.id)}">К рецепту →</button></article>`}).join('')}`:''}<h5>Где искать в экспедициях диких</h5><p class="loot-odds-explanation">Шанс найти хотя бы один предмет на успешно пройденном этапе. До выбора груза в рюкзак и эвакуации; это не шанс возвращения с трофеем.</p><div class="loot-hunt-routes">${routes.map(route=>{const map=MAP_BY_ID[route.mapId]!,locked=state.level<map.level;return `<article><div><strong>${e(map.name)} · этап ${route.depth}</strong><small>${branchNames[route.branch]} · ${e(chanceLabel(route.checkpointChance))}</small><small>При одном выборе находки: ${e(chanceLabel(route.pickChance))}${locked?` · уровень ${map.level}`:''}</small></div><button class="button secondary small" data-action="flea-hunt" data-model="${e(modelId)}" data-hunt-map="${e(route.mapId)}" data-branch="${route.branch}" data-depth="${route.depth}" ${locked?'disabled':''}>${locked?`Уровень ${map.level}`:'Искать здесь'}</button></article>`}).join('')}</div></div></details>`;
}
