import { BOSSES, getBoss } from './game/bosses';
import { WEAPON_BY_ID } from './game/data';
import { GEAR_MODEL_BY_ID } from './game/systems';
import type { LiveDistrictId, LiveEntity, LivePurpose, LiveSnapshot, LiveStatus } from './game/live';
import { bossWeaponArt, bossRewardLabel } from './boss-ui';

const e=(value:unknown)=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function readLiveBossRoute(value:unknown):{districtId:LiveDistrictId;purpose:'boss'}|null {
  const boss=typeof value==='string'?getBoss(value):null;
  return boss?{districtId:boss.districtId,purpose:'boss'}:null;
}
/** A navigation reference to the public arena; never reads an NPC position. */
export function getLiveBossHuntGuide(snapshot:LiveSnapshot,requestedBossId:string|null=null):{bossId:string;districtId:LiveDistrictId;poiId:string}|null {
  if(snapshot.self.purpose!=='boss')return null;
  const statuses=snapshot.server.bosses??[],entry=statuses.find(entry=>entry.bossId===requestedBossId)??statuses.find(entry=>entry.districtId===snapshot.self.districtId);
  return entry&&snapshot.world.pois.some(poi=>poi.id===entry.poiId&&poi.districtId===entry.districtId)?{bossId:entry.bossId,districtId:entry.districtId,poiId:entry.poiId}:null;
}
export function liveBossRoster(status:LiveStatus|null,districtId:LiveDistrictId,purpose:LivePurpose):string {
  return `<details class="live-boss-roster" ${purpose==='boss'?'open':''}><summary>Главари Периметра · 4 цели</summary>${BOSSES.map(boss=>{const entry=status?.bosses?.find(entry=>entry.bossId===boss.id),district=status?.districts.find(district=>district.id===boss.districtId),selected=purpose==='boss'&&districtId===boss.districtId;return `<article class="live-boss-card"><strong>${e(boss.name)} · ${e(district?.name??({village:'Посёлок',sawmill:'Лесопилка',customs:'Таможня',depot:'Депо'}[boss.districtId]))}</strong><small>${e(boss.title)} · ${entry?entry.state==='alive'?'Охраняет район':`Побеждён · вернётся ${new Date(entry.respawnAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`:'Статус появится после связи с сервером'}</small><div class="boss-weapon">${bossWeaponArt(boss)}</div><p>${e(boss.description)}</p><small>После победы в теле: ${boss.bounty} ₽ + ${e(bossRewardLabel(boss))}. Забери груз и дойди до выхода.</small><button class="button secondary small" data-live-button="boss-route:${boss.id}" aria-pressed="${selected}">${selected?'Выбран район охоты':'Выбрать район охоты'}</button></article>`}).join('')}<p class="live-controls-help">Выбор задаёт район и цель входа. Войти нужно отдельной кнопкой. Живой боец остаётся на своей позиции; к главарю идёт пешком.</p></details>`;
}
/** Rendered only for an entity already admitted into the server's visible snapshot. */
export function liveBossEntityDetails(entity:LiveEntity):string {
  const boss=entity.bossId?getBoss(entity.bossId):null;
  if(!boss)return '';
  return `<div class="live-boss-weapon">${bossWeaponArt(boss)}</div><small class="live-boss-details">БОСС · ${e(WEAPON_BY_ID[boss.weaponId]!.name)} · ${e(GEAR_MODEL_BY_ID[boss.armorModelId]!.label)} · входящий урон −${Math.round((1-boss.live.incomingDamage)*100)}% · урон ×${boss.live.outgoingDamage.toLocaleString('ru-RU')}<br>Здоровье ${Math.ceil(entity.health)}% · награда в теле после победы, до доставки</small>`;
}
export function liveBossGuidance(snapshot:LiveSnapshot,poiIds:readonly string[]):string {
  if(snapshot.self.purpose!=='boss')return '';
  const statuses=snapshot.server.bosses??[],entry=statuses.find(entry=>poiIds.includes(entry.poiId))??statuses.find(entry=>entry.districtId===snapshot.self.districtId);
  if(!entry)return '<p class="live-boss-goal">Ищи охраняемый район главаря. Его положение появляется только при наблюдении; награда требует победы, сбора груза и выхода.</p>';
  const poi=snapshot.world.pois.find(poi=>poi.id===entry.poiId);
  return `<p class="live-boss-goal"><strong>${e(entry.name)} · ${e(poi?.name??'Охраняемый район')}</strong><br>${entry.state==='alive'?'Цель жива.':'Цель побеждена; ждём возвращения.'} Ориентир — известная территория, а не текущее положение NPC. Награда остаётся в теле: забери её, умести в рюкзак и доставь у выхода.</p>`;
}
