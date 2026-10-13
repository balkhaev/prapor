import { expect, test } from 'bun:test';
import { createGame, saveGame } from '../src/game/engine';
import { getLootHuntOptions, getLootDecisionProfile } from '../src/game/loot-value';
import { LOOT_MODEL_BY_ID, USEFUL_LOOT_MODELS, JUNK_MODELS } from '../src/game/loot';
import { MAP_BY_ID } from '../src/game/data';
import { lootDecisionPanel, lootHuntHint, readLootHunt, chanceLabel } from '../src/loot-decision-ui';
import { productionOutputSnapshot } from '../src/loot-materials-ui';
import { fleaPage, type FleaView } from '../src/flea-ui';
import { readGameSession } from '../src/game-session';

const NOW=1_792_000_000_000;
const view:FleaView={tab:'catalog',search:'',kind:'all',draft:null,market:null,loading:false,error:'',busy:false};
const number=(value:number)=>value.toLocaleString('ru-RU');

test('cash comparison separates guaranteed trader pricing, asking-price fees and an actual full barter bundle',()=>{
  const state=createGame(NOW),before=saveGame(state),html=lootDecisionPanel(state,'secure-drive'),profile=getLootDecisionProfile('secure-drive')!;
  expect(html).toContain('Ценность и поиск');expect(html).toContain(`${profile.vendorPrice} ₽`);expect(html).toContain(`${profile.marketGuideNet} ₽ после сборов`);expect(html).toContain('Только если купят');expect(html).toContain('Цену лота выбираешь сам');
  expect(html).toContain('Защищённый накопитель ×1 · Банка кофе ×1');expect(html).toContain('Ориентир набора: 955 ₽');expect(html).toContain('650 ₽ + 22 дет.');expect(html).toContain('Защита +15%');expect(html).not.toContain('прибыль');expect(saveGame(state)).toBe(before);
});
test('recipe comparison includes every output of the revised batch and all physical inputs plus cash',()=>{
  const state=createGame(NOW),sewing=lootDecisionPanel(state,'sewing-kit'),medicine=lootDecisionPanel(state,'antibiotics'),intel=lootDecisionPanel(state,'patrol-log');
  expect(sewing).toContain('Ремкомплект ×1 · Медикаменты ×1 · Детали ×1');expect(sewing).toContain('Коробка крепежа ×2');expect(sewing).toContain('На партию дополнительно: 8 ₽');expect(sewing).toContain('базовая работа 60 с');
  expect(medicine).toContain('Медикаменты ×6');expect(medicine).toContain('Упаковка антибиотиков ×1');expect(intel).toContain('Разведданные ×9');
});
test('hunt options are exact conditional checkpoint chances and lock inaccessible sectors without promising extraction',()=>{
  const state=createGame(NOW),modelId='military-cpu',options=getLootHuntOptions(modelId),html=lootDecisionPanel(state,modelId);
  const rendered=html.match(/data-action="flea-hunt"[^>]*>/g)!;expect(rendered).toHaveLength(3);
  for(const option of options.slice(0,3)){expect(html).toContain(chanceLabel(option.checkpointChance));expect(html).toContain(chanceLabel(option.pickChance));expect(html).toContain(`data-hunt-map="${option.mapId}"`);}
  expect(html).toContain('успешно пройденном этапе');expect(html).toContain('это не шанс возвращения с трофеем');expect(rendered.every(button=>button.includes('disabled'))).toBe(true);
  state.level=10;expect(lootDecisionPanel(state,modelId).match(/data-action="flea-hunt"[^>]*>/g)!.every(button=>!button.includes('disabled'))).toBe(true);
  state.level=1;state.money=10_000;
  const early=lootDecisionPanel(state,'duct-tape').match(/data-action="flea-hunt"[^>]*>/g)!;
  expect(early[0]).toContain('data-hunt-map="courtyard"');expect(early[0]).not.toContain('disabled');
  state.level=3;
  const gemstone=lootDecisionPanel(state,'gemstone').match(/data-action="flea-hunt"[^>]*>/g)!;
  expect(gemstone[0]).toContain('data-hunt-map="forest"');expect(gemstone[0]).not.toContain('disabled');expect(gemstone.some(button=>button.includes('disabled'))).toBe(true);
});
test('hunt selection accepts only actual reachable named-loot routes and never changes paid game state',()=>{
  const state=createGame(NOW),modelId='pliers',route=getLootHuntOptions(modelId).find(route=>route.depth===1)!,selection={modelId,mapId:route.mapId,branch:route.branch,depth:route.depth},before=saveGame(state);
  expect(readLootHunt(selection)).toEqual(selection);expect(readLootHunt({...selection,branch:'combat'})).toBeNull();expect(readLootHunt({...selection,branch:'recon'})).toBeNull();
  for(const invalid of [{...selection,modelId:'constructor'},{...selection,mapId:'__proto__'},{...selection,depth:4},{...selection,depth:'1'},{...selection,extra:true},null,[]])expect(readLootHunt(invalid)).toBeNull();
  expect(readLootHunt({...selection,modelId:JUNK_MODELS[0]!.id})).toBeNull();expect(saveGame(state)).toBe(before);
});
test('route hint keeps a manual route and labels odds independently of chance to return',()=>{
  const state=createGame(NOW),modelId='prototype-optics',route=getLootHuntOptions(modelId)[0]!,hunt=readLootHunt({modelId,...{mapId:route.mapId,branch:route.branch,depth:route.depth}})!,before=saveGame(state),html=lootHuntHint(state,hunt);
  expect(html).toContain(LOOT_MODEL_BY_ID[modelId]!.label);expect(html).toContain(MAP_BY_ID[route.mapId]!.name);expect(html).toContain('Первый этап — «Тайники»');expect(html).toContain('вручную выбери маршрут');expect(html).toContain('не отправляет бойцов');expect(html).toContain('перегруз и провал');expect(html).toContain('flea-clear-hunt');expect(saveGame(state)).toBe(before);
});
test('safe session persists hunt intent as a view reference without creating another inventory or changing raid plans',()=>{
  const state=createGame(NOW),route=getLootHuntOptions('military-cpu')[0]!,hunt={modelId:'military-cpu',mapId:route.mapId,branch:route.branch,depth:route.depth},before=saveGame(state),session=readGameSession({version:1,page:'flea',flea:{hunt}},state);
  expect(session.flea.hunt).toEqual(hunt);expect(readGameSession({version:1,flea:{hunt:{...hunt,mapId:'missing'}}},state).flea.hunt).toBeUndefined();expect(saveGame(state)).toBe(before);
});
test('catalogue and owned stock show useful-item decisions while junk retains only its automatic sale purpose',()=>{
  const state=createGame(NOW);state.lootItems=[{id:`loot-${state.nextId++}`,modelId:'military-cpu',foundAt:NOW}];
  expect(fleaPage(state,{...view,tab:'inventory'})).toContain('data-loot-decision="military-cpu"');const catalog=fleaPage(state,view);
  for(const model of USEFUL_LOOT_MODELS)expect(catalog).toContain(`data-loot-decision="${model.id}"`);for(const model of JUNK_MODELS)expect(catalog).not.toContain(`data-loot-decision="${model.id}"`);
});
test('small nonzero odds stay nonzero and percentages never become a fabricated expected payout',()=>{
  expect(chanceLabel(.00001)).toBe('<0,01%');expect(chanceLabel(.03113)).toBe('3,11%');expect(chanceLabel(0)).toBe('0%');
  const profile=getLootDecisionProfile('military-cpu')!;expect(lootDecisionPanel(createGame(NOW),'military-cpu')).toContain(`${number(profile.marketGuideNet)} ₽ после сборов`);
});
test('already paid production orders retain actual old output and work snapshots after the recipe is improved',()=>{
  const old={output:{supplies:{ammo:0,medicine:5,scrap:0,intel:0},moduleModelId:null},workRequired:75_000_000},current={...old,output:{...old.output,supplies:{...old.output.supplies,medicine:6}}};
  expect(productionOutputSnapshot(old)).toContain('Медикаменты +5');expect(productionOutputSnapshot(old)).not.toContain('Медикаменты +6');expect(productionOutputSnapshot(current)).toContain('Медикаменты +6');expect(productionOutputSnapshot(old)).toContain('75 с');
  const sewing={output:{fieldKit:'maintenance' as const,supplies:{ammo:0,medicine:1,scrap:1,intel:0},moduleModelId:null},workRequired:60_000_000};expect(productionOutputSnapshot(sewing)).toContain('Ремкомплект +1');expect(productionOutputSnapshot(sewing)).toContain('Медикаменты +1');expect(productionOutputSnapshot(sewing)).toContain('Детали +1');
});
