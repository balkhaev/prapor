import { expect, test } from 'bun:test';
import { createGame, saveGame, getModuleCapacity, getWeaponStats, type BossEncounter, type Raid, type RaidReport } from '../src/game/engine';
import { BOSSES } from '../src/game/bosses';
import { MAP_BY_ID } from '../src/game/data';
import { getLootHuntOptions } from '../src/game/loot-value';
import { bossRoster, bossPlanBrief, bossRaidProgress, bossReportReceipt, readBossPreparation, bossVisualLoadout } from '../src/boss-ui';
import { liveBossEntityDetails, liveBossRoster, liveBossGuidance, readLiveBossRoute } from '../src/live-boss-ui';
import { lootDecisionPanel, lootHuntHint, readLootHunt } from '../src/loot-decision-ui';
import { raidPlanEditor } from '../src/raid-strategy-ui';
import { fleaPage, pendingLootParcels, type FleaView } from '../src/flea-ui';
import { getConfirmedRaidCargo } from '../src/raid-ui';
import type { LiveEntity, LiveSnapshot } from '../src/game/live';

const NOW=1_800_000_000_000,boss=BOSSES[0]!;
const view:FleaView={tab:'catalog',search:'',kind:'all',draft:null,market:null,loading:false,error:'',busy:false};
function encounter():BossEncounter{return {bossId:boss.id,stage:boss.depth,at:NOW,defeated:true,carrierRaidId:'raid-10',bounty:boss.bounty,lootItemIds:['loot-11','loot-12'],gearItemIds:['gear-13'],moduleItemIds:['module-14']};}
function receipt():RaidReport{return {raidId:'raid-10',scavName:'Носитель',success:true,bossHunt:boss.id,bossEncounter:encounter(),lootItems:[{id:'loot-11',modelId:boss.trophyModelId,foundAt:NOW}],lootPending:[{id:'loot-12',modelId:boss.lootModelId,foundAt:NOW}],gearItems:[],gearPending:[{id:'gear-13',modelId:boss.gearModelId,durability:90}],modulePending:[{id:'module-14',modelId:boss.moduleModelId,durability:90,foundAt:NOW}],moduleIds:[boss.moduleModelId]} as unknown as RaidReport;}

test('four concrete hunts show native weapons, exact sectors, target stages and cargo without changing state',()=>{
  const state=createGame(NOW),before=saveGame(state),html=bossRoster(state);
  for(const boss of BOSSES){expect(html).toContain(`data-boss-card="${boss.id}"`);expect(html).toContain(`data-weapon-model="${boss.weaponId}"`);expect(html).toContain(MAP_BY_ID[boss.mapId]!.name);expect(html).toContain(`этап ${boss.depth}`);expect(html).toContain(`${boss.bounty} ₽`);const loadout=bossVisualLoadout(boss);expect(loadout.weapon!.weaponId).toBe(boss.weaponId);expect(getWeaponStats(loadout.weapon!).ready).toBe(true);expect([loadout.armorModelId,loadout.helmetModelId]).toContain(boss.armorModelId);}
  expect(html).toContain('Выбери дикого');expect(html).toContain('Первый этап — подход');expect(html).toContain('Один набор на весь отряд');expect(html).toContain('Подготовить охоту');expect(saveGame(state)).toBe(before);
  state.level=10;state.bossCooldowns={[boss.id]:NOW+12*60_000};expect(bossRoster(state)).toContain('Вернётся через 12 мин.');
});
test('preparation validates a manually chosen owned free scav and does not set a plan, equip or pay',()=>{
  const state=createGame(NOW),scav=state.scavs[0]!,before=saveGame(state);
  expect(readBossPreparation(state,boss.id,scav.id)).toBeNull();state.level=10;
  const funded=saveGame(state);expect(readBossPreparation(state,boss.id,scav.id)).toEqual({mapId:boss.mapId,scavId:scav.id});expect(saveGame(state)).toBe(funded);
  for(const invalid of ['constructor','__proto__','missing'])expect(readBossPreparation(state,invalid,scav.id)).toBeNull();expect(readBossPreparation(state,boss.id,'enemy')).toBeNull();expect(readBossPreparation(state,boss.id,'')).toBeNull();
  scav.status='raiding';expect(readBossPreparation(state,boss.id,scav.id)).toBeNull();expect(before).not.toBe(funded);
});
test('boss plan explains manual target branch and keeps first-stage odds separate from boss victory',()=>{
  const state=createGame(NOW),scav=state.scavs[0]!;state.level=10;scav.raidPlan={objective:'boss',preparation:'none'};
  const html=raidPlanEditor(state,scav,boss.mapId);expect(html).toContain('value="boss" selected');expect(html).toContain(`Бой: ${boss.name}`);expect(html).toContain('Первый этап ниже — только подход');expect(html).toContain('не означает победу');expect(html).toContain(`${boss.extraAmmo} патр. + ${boss.extraIntel} разв.`);expect(bossPlanBrief(state,scav,'courtyard')).toContain('нет главаря');
  const raid={bossHunt:boss.id,expedition:{}} as Raid;expect(bossRaidProgress(raid)).toContain('Встреча ещё не подтверждена');raid.expedition!.bossEncounter=encounter();expect(bossRaidProgress(raid)).toContain('под риском до эвакуации');
});
test('boss-only trophies never display fabricated random pick odds or a guaranteed delivery',()=>{
  const state=createGame(NOW);state.level=10;
  for(const boss of BOSSES){const html=lootDecisionPanel(state,boss.trophyModelId),route=getLootHuntOptions(boss.trophyModelId)[0]!,hunt=readLootHunt({modelId:boss.trophyModelId,mapId:route.mapId,branch:route.branch,depth:route.depth})!;
    expect(html).toContain('Гарантированный трофей за победу');expect(html).toContain('Обычные тайники его не содержат');expect(html).not.toContain('При одном выборе находки');expect(html.slice(html.indexOf('<h5>Трофей главаря'))).not.toContain('100%');expect(html).toContain(`data-hunt-map="${boss.mapId}"`);expect(lootHuntHint(state,hunt)).toContain('Вручную');expect(lootHuntHint(state,hunt)).toContain('не меняет оплаченный план');
  }
  expect(fleaPage(state,view)).toContain('обычные тайники его не содержат');
});
test('victory receipt distinguishes delivered, pending, lost and the one carrier of a squad bundle',()=>{
  const report=receipt(),html=bossReportReceipt(report);expect(html).toContain('Бугор побеждён');expect(html).toContain('loot-11');expect(html).toContain('доставлено при эвакуации');expect(html).toContain('loot-12');expect(html).toContain('ожидало места');expect(html).toContain('gear-13');expect(html).toContain('module-14');expect(html).toContain('ожидал места в посылке');expect(html).not.toContain('продан');
  const lost={...report,success:false,lootItems:[],lootPending:[],gearPending:[],modulePending:[]};expect(bossReportReceipt(lost)).toContain('100 ₽ награды не доставлены');expect(bossReportReceipt(lost)).toContain('потерян');
  const peer={...report,raidId:'raid-20',scavName:'Прикрытие',bossEncounter:{...encounter(),bounty:0,lootItemIds:[],gearItemIds:[],moduleItemIds:[]}};
  const personal=bossReportReceipt(peer,[peer,report],false);expect(personal).toContain('не получал второй набор');expect(personal).not.toContain('loot-11');expect(bossReportReceipt(peer,[peer,report])).toContain('loot-11');
  expect(bossReportReceipt({...report,bossEncounter:undefined})).toContain('Встреча с боссом не подтверждена');expect(bossReportReceipt({...report,bossEncounter:{...encounter(),defeated:false}})).toContain('Босс не побеждён');
});
test('the original boss module waits intact and blocks the whole parcel when its rack is full',()=>{
  const state=createGame(NOW),part=receipt().modulePending![0]!;state.pendingLoot=[{id:'delivery-15',raidId:'raid-10',at:NOW,items:[],moduleItems:[part]}];
  state.modules=Array.from({length:getModuleCapacity(state)},(_,index)=>({...part,id:`module-${100+index}`}));
  const html=pendingLootParcels(state);expect(html).toContain('module-14');expect(html).toContain('90%');expect(html).toContain('Для модулей не хватает 1 мест');expect(html).toContain('Вся посылка сохранена целиком');expect(html.match(/data-action="flea-claim-delivery"[^>]*>/)![0]).toContain('disabled');
  state.modules.pop();expect(pendingLootParcels(state).match(/data-action="flea-claim-delivery"[^>]*>/)![0]).not.toContain('disabled');
  const raid={id:'raid-10',expedition:{cargo:{money:0,supplies:{ammo:0,medicine:0,scrap:0,intel:0},modules:[part],weaponIds:[]},capacity:28}} as unknown as Raid;
  expect(getConfirmedRaidCargo(raid,receipt()).parts).toHaveLength(0);expect(getConfirmedRaidCargo(raid,receipt()).modulePending).toEqual([part]);
});
test('live hunt selects authored district without entry and only actual boss entities expose boss weapon and health',()=>{
  for(const boss of BOSSES)expect(readLiveBossRoute(boss.id)).toEqual({districtId:boss.districtId,purpose:'boss'});expect(readLiveBossRoute('__proto__')).toBeNull();expect(readLiveBossRoute('constructor')).toBeNull();
  const entity={kind:'scav',name:'<img>',health:35.2,bossId:boss.id} as LiveEntity;expect(liveBossEntityDetails(entity)).toContain('Здоровье 36%');expect(liveBossEntityDetails(entity)).toContain('data-weapon-model="pp91"');expect(liveBossEntityDetails({...entity,bossId:undefined})).toBe('');
  const html=liveBossRoster(null,'village','boss');expect(html).toContain('Войти нужно отдельной кнопкой');expect(html).toContain('Статус появится');expect(html).not.toContain('Цель жива');
  const snapshot={self:{purpose:'boss',districtId:'village'},server:{bosses:[{bossId:boss.id,name:'<script>',districtId:'village',poiId:'arena',state:'alive',respawnAt:0,area:{x:400,y:401,width:3,height:4}}]},world:{pois:[{id:'arena',name:'Склад района'}]},entities:[]} as unknown as LiveSnapshot;
  const guidance=liveBossGuidance(snapshot,['arena']);expect(guidance).toContain('Склад района');expect(guidance).toContain('не текущее положение NPC');expect(guidance).toContain('&lt;script&gt;');expect(guidance).not.toContain('400');expect(guidance).not.toContain('401');
});
