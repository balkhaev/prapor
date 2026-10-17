import { expect, test } from 'bun:test';
import { createGame, saveGame, getLootCapacity, type Raid, type RaidReport } from '../src/game/engine';
import { GEAR_MODELS, type GearItem } from '../src/game/systems';
import { MODULE_MODELS, MODULE_SLOTS, MODULE_SLOT_LABELS } from '../src/game/modules';
import { getConfirmedRaidCargo } from '../src/raid-ui';
import { catalogGroupFilter, fleaPage, pendingLootParcels, physicalLootCatalog, raidGearReceipt, raidLootReceipt, type FleaView } from '../src/flea-ui';
import { getLiveLootDefinition } from '../src/game/live-loot';
import { liveDropDetails, liveDropLabel, liveLootCargo, liveLootTotals } from '../src/live-loot-ui';
import type { EconomyLoot, LiveDrop, LivePlayer } from '../src/game/live';
import { readGameSession } from '../src/game-session';

const NOW=1_792_000_000_000;
const view:FleaView={tab:'catalog',search:'',kind:'all',draft:null,market:null,loading:false,error:'',busy:false};
const item:GearItem={id:'gear-90',modelId:'cargo_pack',durability:50};
function makeRaid(){return {id:'raid-70',expedition:{cargo:{money:1,supplies:{ammo:0,medicine:0,scrap:0,intel:0},weaponIds:[],modules:[],gearItems:[item]},capacity:32}} as unknown as Raid;}
function report(){return {raidId:'raid-70',success:true,money:1,supplies:{ammo:0,medicine:0,scrap:0,intel:0},moduleIds:[],weaponId:null,gearItems:[{...item,modelId:'steel_helmet',durability:75}],gearPending:[]} as unknown as RaidReport;}

test('carried, delivered, pending and lost gear remain exact distinct extraction facts',()=>{
  const raid=makeRaid(),receipt=report();expect(getConfirmedRaidCargo(raid).gearItems).toEqual([item]);
  expect(getConfirmedRaidCargo(raid,receipt).gearItems).toEqual(receipt.gearItems);expect(getConfirmedRaidCargo(raid,receipt).gearItems).not.toEqual([item]);
  const returned=getConfirmedRaidCargo(raid,receipt);returned.gearItems![0]!.durability=10;expect(receipt.gearItems![0]!.durability).toBe(75);
  const old={...receipt};delete old.gearItems;delete old.gearPending;expect(getConfirmedRaidCargo(raid,old).gearItems).toBeUndefined();
  const pending={...receipt,gearItems:[],gearPending:[item]};expect(getConfirmedRaidCargo(raid,pending).gearPending).toEqual([item]);
  const lost={...receipt,success:false,lostCargo:raid.expedition!.cargo};expect(getConfirmedRaidCargo(raid,lost).gearItems).toEqual([item]);
});
test('gear receipt shows native art and actual worn benefits without promising an owned item before extraction',()=>{
  const state=createGame(NOW),before=saveGame(state),carried=raidGearReceipt([item],'carried',state);
  expect(carried).toContain('Снаряжение в рюкзаке');expect(carried).toContain('Грузовая рама');expect(carried).toContain('gear-illustration');expect(carried).toContain('Состояние 50%');expect(carried).toContain('Вместимость 27.6 ед.');expect(carried).not.toContain('data-assign-gear');
  const lost=raidGearReceipt([item],'lost',state);expect(lost).toContain('Снаряжение потеряно');expect(lost).not.toContain('data-action="open-equipment"');expect(lost).not.toContain('data-assign-gear');
  const pending=raidGearReceipt([item],'pending',state);expect(pending).toContain('Сохранено');expect(pending).toContain('текущий статус');expect(pending).toContain('data-page="flea"');expect(pending).not.toContain('продано');expect(saveGame(state)).toBe(before);
});
test('actual delivered gear offers manual recipient choice only for that same current owned instance',()=>{
  const state=createGame(NOW);state.gearItems.push({...item});const html=raidGearReceipt([item],'delivered',state);
  expect(html).toContain('data-assign-gear="gear-90"');expect(html).toContain('Выбери дикого');expect(state.scavs.every(scav=>scav.loadout.backpackItemId!==item.id)).toBe(true);
  state.gearItems[0]!.id='gear-91';const noLongerOwned=raidGearReceipt([item],'delivered',state);expect(noLongerOwned).not.toContain('data-assign-gear');expect(noLongerOwned).toContain('К стойке снаряжения');
});
test('mixed pending parcel requires room in both the named stash and equipment rack before any collection',()=>{
  const state=createGame(NOW);state.gearItems=Array.from({length:28},(_,index)=>({id:`gear-${100+index}`,modelId:'padded_vest',durability:100}));
  state.pendingLoot=[{id:'delivery-150',raidId:'raid-70',at:NOW,items:[{id:'loot-151',modelId:'pliers',foundAt:NOW}],gearItems:[item]}];
  const fullGear=pendingLootParcels(state);expect(fullGear).toContain('Пассатижи');expect(fullGear).toContain('Грузовая рама');expect(fullGear).toContain('Забрать посылку · 2 шт.');expect(fullGear).toContain('На стойке снаряжения не хватает 1 мест');expect(fullGear.match(/data-action="flea-claim-delivery"[^>]*>/)?.[0]).toContain('disabled');
  state.gearItems.pop();state.lootItems=Array.from({length:getLootCapacity(state)},(_,index)=>({id:`loot-${200+index}`,modelId:'duct-tape',foundAt:NOW}));
  const fullNamed=pendingLootParcels(state);expect(fullNamed).toContain('мест для трофеев');expect(fullNamed.match(/data-action="flea-claim-delivery"[^>]*>/)?.[0]).toContain('disabled');
  state.lootItems.pop();expect(pendingLootParcels(state).match(/data-action="flea-claim-delivery"[^>]*>/)?.[0]).not.toContain('disabled');
  state.pendingLoot[0]!.items=[];expect(pendingLootParcels(state)).toContain('Забрать посылку · 1 шт.');expect(pendingLootParcels(state)).toContain('Грузовая рама');
});
test('catalogue exposes real equipment models and module slots with searchable category controls',()=>{
  const state=createGame(NOW),before=saveGame(state),gear=fleaPage(state,{...view,catalogGroup:'gear'}),modules=fleaPage(state,{...view,catalogGroup:'module'});
  for(const model of GEAR_MODELS)expect(gear).toContain(model.label);expect(gear).toContain('состояние добычи');expect(gear).not.toContain('<h4>Пассатижи</h4>');
  for(const slot of MODULE_SLOTS)expect(modules).toContain(MODULE_SLOT_LABELS[slot]);expect(modules).toContain('Ствольная коробка, ствол');expect(modules).not.toContain('<h4>Грузовая рама</h4>');
  const packs=physicalLootCatalog({catalogGroup:'gear',search:'рюкзак'});expect(packs).toContain('Рамный рюкзак');expect(packs).not.toContain('<h4>Стальная каска</h4>');
  expect(catalogGroupFilter('medicine')).toContain('value="medicine" selected');expect(saveGame(state)).toBe(before);
  for(const [modelId,exact] of [['faded-receipt','0.03'],['rusty-nail','0.04'],['gemstone','0.05']] as const){
    const loot={id:'loot-99',modelId,foundAt:NOW},receipt=raidLootReceipt([loot]);
    expect(receipt).toContain(`${exact} кг`);expect(receipt).not.toContain('0.0 кг');
    expect(liveLootCargo({gameId:'guest-test',lootItems:[loot],pendingDelivery:[]} as unknown as LivePlayer)).toContain(`${exact.replace('.',',')} кг`);
    expect(fleaPage(state,{...view,search:modelId==='gemstone'?'Огранённый камень':modelId==='rusty-nail'?'Ржавый гвоздь':'Выцветший чек'})).toContain(`${exact} кг`);
  }
});
test('multiplayer mixed inventory uses real module and armour definitions, condition and images without invalid loot lookup',()=>{
  const module=MODULE_MODELS.find(model=>model.slot==='optic')!,items:EconomyLoot[]=[{id:crypto.randomUUID(),kind:'gear',modelId:item.modelId,foundAt:NOW,durability:50},{id:crypto.randomUUID(),kind:'module',modelId:module.id,foundAt:NOW,durability:64},{id:crypto.randomUUID(),modelId:'gold-ring',foundAt:NOW}];
  const totals=liveLootTotals(items),definitions=items.map(getLiveLootDefinition);expect(totals.weight).toBe(definitions.reduce((sum,value)=>sum+value.weight,0));expect(totals.guide).toBe(definitions.reduce((sum,value)=>sum+value.guidePrice,0));expect(totals.trader).toBe(definitions.reduce((sum,value)=>sum+(value.traderPrice??0),0));
  const player={gameId:'guest-test',lootItems:items,pendingDelivery:[]} as unknown as LivePlayer,html=liveLootCargo(player);expect(html).toContain(module.label);expect(html).toContain('Грузовая рама');expect(html).toContain('Состояние 64%');expect(html).toContain('Состояние 50%');expect(html).toContain('Вместимость 27.6');expect(html).toContain('live-physical-loot-art');expect(html).toContain('установить на оружие');expect(html).toContain('выдать своему дикому');
  const gearOnly={id:'drop-1',x:0,y:0,amount:0,items:[items[0]!]} as const;expect(liveDropLabel({...gearOnly,items:[...gearOnly.items]})).toBe('Грузовая рама');expect(liveDropDetails({...gearOnly,items:[...gearOnly.items]})).not.toContain('торговцу');
});

test('visible NPC base caches label the same physical loot without changing contents or details',()=>{
  const drop:LiveDrop={id:'drop-cache',x:10,y:12,amount:25,items:[{id:crypto.randomUUID(),modelId:'gold-ring',foundAt:NOW}]};
  const before=structuredClone(drop),normalLabel=liveDropLabel(drop),normalDetails=liveDropDetails(drop);
  for(const [faction,label] of [['scavs','Тайник диких'],['raiders','Тайник рейдеров']] as const){
    const cache={...drop,npcBase:{id:'sawmill-poi',faction}};
    expect(liveDropLabel(cache)).toBe(`${label} · ${normalLabel}`);
    expect(liveDropDetails(cache)).toBe(normalDetails);
    expect(cache.items).toBe(drop.items);
  }
  expect(drop).toEqual(before);
});
test('category session references are harmless, bounded and reject invented groups',()=>{
  const state=createGame(NOW),before=saveGame(state);
  for(const catalogGroup of ['gear','module','medicine','valuables','tools','junk','all'] as const)expect(readGameSession({version:1,flea:{tab:'catalog',catalogGroup}},state).flea.catalogGroup).toBe(catalogGroup);
  for(const catalogGroup of ['constructor','__proto__','<script>'])expect(readGameSession({version:1,flea:{tab:'catalog',catalogGroup}},state).flea.catalogGroup).toBeUndefined();expect(saveGame(state)).toBe(before);
});
