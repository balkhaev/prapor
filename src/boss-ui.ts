import { BOSSES, getBoss, getBossForMap, type BossDefinition } from './game/bosses';
import { MAP_BY_ID, WEAPON_BY_ID } from './game/data';
import { LOOT_MODEL_BY_ID } from './game/loot';
import { FACTORY_KITS, MODULE_BY_ID } from './game/modules';
import { GEAR_MODEL_BY_ID } from './game/systems';
import { getRaidQuote, type GameState, type Raid, type RaidReport, type Scav, type WeaponInstance } from './game/engine';
import { weaponBuildArt } from './armory-art';
import type { ScavVisualLoadout } from './scav-loadout';

const e=(value:unknown)=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const n=(value:number)=>Math.floor(value).toLocaleString('ru-RU');

/** Decorative factory build; this never creates or equips an inventory instance. */
export function bossWeapon(boss:BossDefinition): WeaponInstance {
  return {id:`boss-display-${boss.id}`,weaponId:boss.weaponId,durability:100,attachments:{optic:0,stock:0,magazine:0},foundAt:0,
    modules:Object.fromEntries(Object.entries(FACTORY_KITS[boss.weaponId]??{}).map(([slot,modelId])=>[slot,{id:`boss-display-${boss.id}-${slot}`,modelId,durability:100,foundAt:0}])) as WeaponInstance['modules']};
}
export function bossWeaponArt(boss:BossDefinition): string { return weaponBuildArt(bossWeapon(boss)); }
export function bossVisualLoadout(boss:BossDefinition):ScavVisualLoadout {
  const gear=GEAR_MODEL_BY_ID[boss.armorModelId]!;
  return {armorModelId:gear.slot==='armor'?gear.id:null,helmetModelId:gear.slot==='helmet'?gear.id:null,packModelId:null,weapon:bossWeapon(boss)};
}
export function bossRewardLabel(boss:BossDefinition): string {
  return [LOOT_MODEL_BY_ID[boss.trophyModelId]?.label,LOOT_MODEL_BY_ID[boss.lootModelId]?.label,GEAR_MODEL_BY_ID[boss.gearModelId]?.label,MODULE_BY_ID[boss.moduleModelId]?.label].filter(Boolean).join(' · ');
}
export function readBossPreparation(state:GameState,bossId:unknown,scavId:unknown): {mapId:string;scavId:string}|null {
  const boss=typeof bossId==='string'?getBoss(bossId):null,scav=state.scavs.find(scav=>scav.id===scavId);
  return boss&&scav&&scav.status!=='raiding'&&!state.raids.some(raid=>raid.scavId===scav.id)&&state.level>=MAP_BY_ID[boss.mapId]!.level?{mapId:boss.mapId,scavId:scav.id}:null;
}
export function bossRoster(state:GameState): string {
  return `<details class="boss-roster"><summary>Охота на главарей · 4 цели</summary><p>Выбери бойца и проверь его комплект. В личном деле вручную выбери цель «Охота на босса»; в совместном выходе она нужна каждому участнику. Первый этап — подход, бой происходит на указанном этапе по ветке «Оружейный склад».</p><div class="boss-roster-grid">${BOSSES.map(boss=>{
    const map=MAP_BY_ID[boss.mapId]!,locked=state.level<map.level,until=state.bossCooldowns?.[boss.id]??0,active=state.raids.some(raid=>raid.bossHunt===boss.id),armor=GEAR_MODEL_BY_ID[boss.armorModelId]!;
    const status=locked?`Сектор с уровня ${map.level}`:active?'Охота уже идёт':until>state.lastUpdated?`Вернётся через ${Math.ceil((until-state.lastUpdated)/60_000)} мин.`:'Цель доступна';
    return `<article class="boss-card" data-boss-card="${boss.id}"><span class="eyebrow">${e(boss.title)}</span><h3>${e(boss.name)}</h3><div class="boss-weapon">${bossWeaponArt(boss)}</div><strong>${e(WEAPON_BY_ID[boss.weaponId]!.name)} · ${e(armor.label)}</strong><small>Защита комплекта +${Math.round(armor.protection*100)}% · ${e(map.name)} · этап ${boss.depth} · Оружейный склад</small><p>${e(boss.description)}</p><details class="boss-prize"><summary>Добыча за победу · ${n(boss.bounty)} ₽</summary><p>${e(bossRewardLabel(boss))}</p><small>Снаряжение и модуль: 90% состояния. Один набор на весь отряд. Награда занимает место в рюкзаке; до эвакуации её можно потерять.</small></details><small class="cost-reason">${e(status)}</small><label class="field-label">Кого подготовить<select data-boss-scav="${boss.id}" data-focus-key="boss-scav-${boss.id}" aria-label="Боец для охоты на ${e(boss.name)}"><option value="">Выбери дикого</option>${state.scavs.filter(scav=>scav.status!=='raiding').map(scav=>`<option value="${e(scav.id)}">${e(scav.name)}</option>`).join('')}</select></label><button class="button secondary small" data-action="boss-prepare" data-boss="${boss.id}" ${locked?'disabled':''}>Подготовить охоту →</button></article>`;
  }).join('')}</div></details>`;
}
export function bossPlanBrief(state:GameState,scav:Scav,mapId:string): string {
  if(scav.raidPlan?.objective!=='boss')return '';
  const boss=getBossForMap(mapId);
  if(!boss)return '<p class="risk-note">В этом секторе нет главаря. Выбери сектор с целью охоты.</p>';
  const quote=getRaidQuote(state,scav,MAP_BY_ID[mapId]!);
  return `<div class="boss-plan"><strong>Цель: ${e(boss.name)} · этап ${boss.depth}</strong><p>На целевой точке связи выбери «Бой: ${e(boss.name)}». Другая ветка обходит главаря. Первый этап ниже — только подход, его шанс не означает победу над боссом.</p><small>Бой: дополнительно ${boss.extraAmmo} патр. + ${boss.extraIntel} разв. + ${boss.extraSeconds} с; штраф ${Math.round(boss.chancePenalty*100)} п.п. Точную цену и шанс увидишь перед продолжением.</small><small>${e(quote.bossAvailable?'Цель доступна.':quote.reason??'Цель временно недоступна.')}</small><p>За победу: ${n(boss.bounty)} ₽ в груз + ${e(bossRewardLabel(boss))}. Нужны место в рюкзаке и эвакуация.</p></div>`;
}
export function bossRaidProgress(raid:Raid): string {
  const boss=raid.bossHunt?getBoss(raid.bossHunt):null;
  if(!boss)return '';
  const encounter=raid.expedition?.bossEncounter;
  return `<p class="boss-progress"><strong>Охота: ${e(boss.name)}</strong> · ${encounter?encounter.defeated?'Босс побеждён; награда остаётся под риском до эвакуации.':'Встреча с боссом подтверждена; победы нет.':`Встреча ещё не подтверждена. Цель: бой на ${boss.depth}-м этапе; другая ветка обходит босса.`}</p>`;
}
/** Victory and delivery are independent facts. The party earns a single physical bundle. */
export function bossReportReceipt(report:RaidReport,receipts:readonly RaidReport[]=[report],aggregate=true): string {
  const boss=report.bossHunt?getBoss(report.bossHunt):report.bossEncounter?getBoss(report.bossEncounter.bossId):null;
  if(!boss)return '';
  const encounter=report.bossEncounter;
  if(!encounter)return `<section class="boss-result"><strong>Охота: ${e(boss.name)}</strong><p>Встреча с боссом не подтверждена. Выход завершён до боя или по другой ветке; награда за босса не получена.</p></section>`;
  if(!encounter.defeated)return `<section class="boss-result"><strong>Бой с ${e(boss.name)} · этап ${encounter.stage}</strong><p>Босс не побеждён. Награда за победу не получена; судьба обычного груза указана в отчёте.</p></section>`;
  const carrier=receipts.find(receipt=>receipt.raidId===encounter.carrierRaidId),owned=carrier?.bossEncounter;
  if(!aggregate&&encounter.carrierRaidId!==report.raidId)return `<section class="boss-result"><strong>${e(boss.name)} побеждён отрядом</strong><p>Носитель единственного набора: ${e(carrier?.scavName??encounter.carrierRaidId??'не указан')}. Этот боец не получал второй набор; доставка награды отражена в личном отчёте носителя.</p></section>`;
  if(!carrier||!owned)return `<section class="boss-result"><strong>${e(boss.name)} побеждён</strong><p>Один набор награды получил носитель ${e(encounter.carrierRaidId??'не указан')}. Его личный отчёт не сохранился; доставка этого набора неизвестна.</p></section>`;
  const deliveredLoot=(carrier.lootItems??[]).filter(item=>owned.lootItemIds.includes(item.id)),pendingLoot=(carrier.lootPending??[]).filter(item=>owned.lootItemIds.includes(item.id)),deliveredGear=(carrier.gearItems??[]).filter(item=>owned.gearItemIds.includes(item.id)),pendingGear=(carrier.gearPending??[]).filter(item=>owned.gearItemIds.includes(item.id));
  const rows=[...deliveredLoot.map(item=>`${LOOT_MODEL_BY_ID[item.modelId]!.label} · доставлено при эвакуации · ${item.id}`),...pendingLoot.map(item=>`${LOOT_MODEL_BY_ID[item.modelId]!.label} · ожидало места в посылке · ${item.id}`),...deliveredGear.map(item=>`${GEAR_MODEL_BY_ID[item.modelId]!.label} · доставлено при эвакуации · ${item.id}`),...pendingGear.map(item=>`${GEAR_MODEL_BY_ID[item.modelId]!.label} · ожидало места на стойке · ${item.id}`)];
  if(!carrier.success)rows.push(...owned.lootItemIds.map(id=>`Трофей ${id} · потерян`),...owned.gearItemIds.map(id=>`Снаряжение ${id} · потеряно`));
  if(owned.moduleItemIds.length)rows.push(`${MODULE_BY_ID[boss.moduleModelId]!.label} · ${carrier.success?carrier.modulePending?.some(item=>owned.moduleItemIds.includes(item.id))?'ожидал места в посылке':'доставлен при эвакуации':'потерян'} · ${owned.moduleItemIds.join(', ')}`);
  return `<section class="boss-result"><strong>${e(boss.name)} побеждён · этап ${encounter.stage}</strong><p>Носитель единственного набора: ${e(carrier.scavName)}. ${carrier.success?`${n(owned.bounty)} ₽ награды входят в наличные отчёта.`:`${n(owned.bounty)} ₽ награды не доставлены.`}</p>${rows.map(row=>`<small>${e(row)}</small>`).join('')}<small>Это итог эвакуации. Текущий остаток и посылки — на складе; оставленные при перегрузе предметы не входят в сохранённый набор.</small></section>`;
}
