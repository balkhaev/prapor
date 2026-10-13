import { expect, test } from 'bun:test';
import { barterGear, claimLootDelivery, createGame, equipGear, getLoadoutStats, getLootCapacity, saveGame, type LootItem } from '../src/game/engine';
import { BARTER_OFFERS, getBarterQuote } from '../src/game/barter';
import { GEAR_MODEL_BY_ID } from '../src/game/systems';
import { USEFUL_LOOT_MODELS } from '../src/game/loot';
import { barterCards, barterConfirmation, barterPurpose, fleaPage, gearAssignment, pendingLootParcels, raidLootReceipt, type FleaView } from '../src/flea-ui';
import { readGameSession } from '../src/game-session';
import { getConfirmedRaidCargo } from '../src/raid-ui';
import type { Raid, RaidReport } from '../src/game/engine';

const NOW=1_792_000_000_000;
const view=(changes:Partial<FleaView>={}):FleaView=>({tab:'barter',search:'',kind:'all',draft:null,market:null,loading:false,error:'',busy:false,...changes});
function add(state:ReturnType<typeof createGame>,modelId:string,quantity=1){for(let i=0;i<quantity;i++)(state.lootItems??=[]).push({id:`loot-${state.nextId++}`,modelId,foundAt:NOW});}
function readyOffer(){const state=createGame(NOW),offer=BARTER_OFFERS.find(offer=>offer.gearModelId==='padded_vest')!;for(const need of offer.requirements)add(state,need.modelId,need.quantity);return {state,offer};}

test('all useful named trophies expose a barter purpose in inventory and catalogue, beyond a cash price',()=>{
  const state=createGame(NOW);for(const model of USEFUL_LOOT_MODELS)add(state,model.id);
  const before=saveGame(state),stock=fleaPage(state,view({tab:'inventory'})),catalog=fleaPage(state,view({tab:'catalog'}));
  for(const model of USEFUL_LOOT_MODELS){expect(barterPurpose(model.id).length).toBeGreaterThan(0);expect(stock).toContain(`data-model="${model.id}"`);expect(catalog).toContain(`data-model="${model.id}"`);}
  expect(stock).toContain('Ты сам выбираешь');expect(catalog).toContain('Сохранить для:');expect(catalog).toContain('Бартер ·');expect(saveGame(state)).toBe(before);
});
test('barter shows actual owned quantities, missing names, equipment tradeoffs and ready offers first',()=>{
  const {state,offer}=readyOffer(),before=saveGame(state),html=barterCards(state,view());
  expect(html.indexOf(`data-barter-offer="${offer.id}"`)).toBeLessThan(html.indexOf('data-barter-offer="barter-canvas_pack"'));
  expect(html).toContain('Защита +3%');expect(html).toContain('Вместимость 36 ед.');expect(html).toContain('На складе 2 / нужно 2');expect(html).toContain('Искать в рейде:');expect(html).toContain('Рубли не списываются');expect(html).toContain('Набор собран');expect(saveGame(state)).toBe(before);
  const filtered=barterCards(state,view({barterModelId:'old-watch'}));expect(filtered).toContain(offer.id);expect(filtered).not.toContain('data-barter-offer="barter-heavy_armor"');
  expect(barterCards(state,view({search:'тепловизионный'}))).toContain('barter-frame_pack');expect(barterCards(state,view({search:'несуществующий трофей'}))).toContain('обменов нет');
});
test('full gear rack prevents confirmation and preserves exact items; malformed references never create offers',()=>{
  const {state,offer}=readyOffer();state.gearItems=Array.from({length:28},()=>({id:`gear-${state.nextId++}`,modelId:'steel_helmet',durability:100}));
  const before=saveGame(state),html=barterCards(state,view({barterModelId:'old-watch'}));expect(html).toContain('Стойка снаряжения полна');expect(html).toContain('disabled');expect(barterConfirmation(state,offer.id)).toContain('disabled');expect(barterConfirmation(state,'constructor')).toBe('');expect(saveGame(state)).toBe(before);
});
test('a confirmed bundle creates ordinary armour which changes the chosen scav next raid loadout',()=>{
  const {state,offer}=readyOffer(),scav=state.scavs[1]!,before=getLoadoutStats(state,scav),quote=getBarterQuote(state,offer.id),modal=barterConfirmation(state,offer.id),money=state.money;
  expect(modal).toContain('Будут израсходованы только эти предметы');expect(modal).toContain('Подтвердить обмен');expect(modal).toContain('деньги не списываются');
  expect(barterGear(state,offer.id,quote.itemIds).ok).toBe(true);const item=state.gearItems.at(-1)!,model=GEAR_MODEL_BY_ID[item.modelId]!;
  expect(state.money).toBe(money);expect(state.scavs.every(scav=>scav.loadout.armorItemId!==item.id)).toBe(true);
  const receipt=fleaPage(state,view({receivedGearId:item.id}));expect(receipt).toContain('Бартер выполнен');expect(receipt).toContain('Выбери дикого');expect(receipt).toContain(`data-assign-gear="${item.id}"`);
  expect(equipGear(state,scav.id,model.slot,item.id).ok).toBe(true);expect(getLoadoutStats(state,scav).protection).toBeGreaterThan(before.protection);expect(gearAssignment(state,item)).toContain(scav.name);expect(gearAssignment(state,item)).not.toContain('data-assign-gear');
});
test('equipment recipient is never automatic and escaping protects renamed scav options and search drafts',()=>{
  const {state,offer}=readyOffer();barterGear(state,offer.id,getBarterQuote(state,offer.id).itemIds);state.scavs[0]!.name='<img onerror=boom>';state.scavs[1]!.status='raiding';
  const html=fleaPage(state,view({receivedGearId:state.gearItems.at(-1)!.id,search:'" onfocus="boom'}));expect(html).toContain('&lt;img onerror=boom&gt;');expect(html).not.toContain('<img onerror=boom>');expect(html).not.toContain(`value="${state.scavs[1]!.id}"`);expect(html).toContain('&quot; onfocus=&quot;boom');expect(html).not.toContain('value="" onfocus="boom');
});
test('pending named loot is retained, collection is explicit, full capacity explains the blocker',()=>{
  const state=createGame(NOW);for(let i=0;i<getLootCapacity(state);i++)add(state,'duct-tape');const item:LootItem={id:`loot-${state.nextId++}`,modelId:'old-watch',foundAt:NOW};
  state.pendingLoot=[{id:`delivery-${state.nextId++}`,raidId:'raid-999',at:NOW,items:[item]}];const before=saveGame(state),id=state.pendingLoot[0]!.id;
  const full=pendingLootParcels(state);expect(full).toContain('Предметы не проданы');expect(full).toContain('Освободи ещё 1 мест');expect(full).toContain('disabled');expect(claimLootDelivery(state,id).ok).toBe(false);expect(saveGame(state)).toBe(before);
  state.lootItems!.pop();expect(pendingLootParcels(state)).not.toContain('disabled');expect(claimLootDelivery(state,id).ok).toBe(true);expect(state.lootItems!.at(-1)).toEqual(item);expect(pendingLootParcels(state)).toBe('');
});
test('pending raid receipt describes immutable extraction facts without pretending it was sold or delivered',()=>{
  const item:LootItem={id:'loot-80',modelId:'duct-tape',foundAt:NOW},report={raidId:'raid-50',success:true,money:1,supplies:{ammo:0,medicine:0,scrap:0,intel:0},moduleIds:[],weaponId:null,lootItems:[],lootPending:[item]} as unknown as RaidReport;
  const cargo=getConfirmedRaidCargo({id:report.raidId} as Raid,report);expect(cargo.lootItems).toEqual([]);expect(cargo.lootPending).toEqual([item]);
  const html=raidLootReceipt(cargo.lootPending,'pending');expect(html).toContain('При эвакуации ожидали места');expect(html).toContain('текущий статус');expect(html).not.toContain('продано торговцу');expect(html).not.toContain('Трофеи доставлены');expect(html).toContain('data-page="flea"');
});
test('session restores only known named barter filters while preserving manual stock and asking draft outside gameplay',()=>{
  const state=createGame(NOW),before=saveGame(state),session=readGameSession({version:1,page:'flea',flea:{tab:'barter',barterModelId:'thermal-sensor'}},state);expect(session.flea.tab).toBe('barter');expect(session.flea.barterModelId).toBe('thermal-sensor');
  for(const invalid of ['constructor','__proto__','<script>'])expect(readGameSession({version:1,flea:{tab:'barter',barterModelId:invalid}},state).flea.barterModelId).toBeUndefined();expect(saveGame(state)).toBe(before);
});
