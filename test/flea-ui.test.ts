import { expect, test } from 'bun:test';
import { createGame, getTradeInventory, saveGame, LOOT_MODELS, getLootTraderPrice } from '../src/game/engine';
import { fleaPage, fleaPricePreview, filterTradeRows, readFleaInteger, readFleaOrder, raidLootReceipt, raidLootOverflow, type FleaView } from '../src/flea-ui';
import { getMarketFees, type MarketListing, type MarketSnapshot } from '../src/game/flea';
import { readGameSession } from '../src/game-session';
import { getConfirmedRaidCargo } from '../src/raid-ui';
import type { Raid, RaidReport } from '../src/game/engine';

const NOW=1_792_000_000_000;
const market = (offers:MarketListing[]=[],mine:MarketListing[]=[]):MarketSnapshot=>({identity:{id:'guest-1',kind:'guest',name:'Гость'},serverNow:NOW,offers,mine,receivables:mine.filter(item=>item.claimable).reduce((sum,item)=>sum+item.proceeds,0)});
const view = (changes:Partial<FleaView>={}):FleaView=>({tab:'inventory',search:'',kind:'all',draft:null,market:market(),loading:false,error:'',busy:false,...changes});
const listing=(changes:Partial<MarketListing>={}):MarketListing=>({id:'offer-1',asset:{kind:'supply',id:'ammo',quantity:7},label:'Патроны',guidePrice:25,price:100,...getMarketFees(100),createdAt:NOW,status:'active',soldAt:null,claimedAt:null,owner:false,claimable:false,...changes});
function lootGame(){const state=createGame(NOW);state.lootItems=[{id:`loot-${state.nextId++}`,modelId:'circuit-board',foundAt:NOW}];return state;}

test('inventory is one read-only view of all actual families and records each guide separately from trader payment',()=>{
  const state=lootGame();state.shelter.logistics={reserve:{money:0,supplies:{ammo:0,medicine:0,scrap:0,intel:0}},kits:{maintenance:2,trauma:1}};
  state.modules.push(structuredClone(Object.values(state.weapons[0]!.modules)[0]!));state.modules.at(-1)!.id=`part-${state.nextId++}`;
  const before=saveGame(state),html=fleaPage(state,view());
  expect(html).toContain('Плата управления');expect(html).toContain('Ремкомплект');expect(html).toContain('Трофеи');expect(html).toContain('Модули');expect(html).toContain('Экипировка');expect(html).toContain('Припасы');expect(html).toContain('Ориентир');expect(html).toContain('Торговец');
  expect(getTradeInventory(state).every(row=>row.guidePrice>0)).toBe(true);
  expect(filterTradeRows(state,'пЛаТа','loot')).toHaveLength(1);expect(filterTradeRows(state,'плата','weapon')).toHaveLength(0);expect(saveGame(state)).toBe(before);
});
test('quantity and total asking price are integer drafts; preview shows nonrefundable fee and actual proceeds',()=>{
  const state=createGame(NOW),draft={ref:{kind:'supply' as const,id:'ammo',quantity:1},quantity:'7',price:'101'};
  const order=readFleaOrder(state,draft)!;
  expect(order.ref.quantity).toBe(7);expect(order.price).toBe(101);expect(order.fee).toBe(3);expect(order.commission).toBe(6);expect(order.proceeds).toBe(95);
  const html=fleaPage(state,view({draft}));expect(html).toContain('Цена всего лота');expect(html).toContain('value="101"');expect(html).toContain('value="7"');expect(html).toContain('не гарантирована');expect(fleaPricePreview(state,view({draft}))).toContain('95');
  for(const invalid of ['','0','-2','2.1','1e2','+2',' 2','2 ','01','Infinity','1000001'])expect(readFleaInteger(invalid,1_000_000)).toBeNull();
  expect(readFleaOrder(state,{...draft,quantity:'10001'})).toBeNull();
  const item=lootGame(),ref={kind:'loot' as const,id:item.lootItems![0]!.id,quantity:1};expect(readFleaOrder(item,{ref,quantity:'2',price:'100'})).toBeNull();
});
test('quantity exceeds owned stock and fee shortage remain visible without changing the draft or gameplay',()=>{
  const state=createGame(NOW);state.money=0;
  const draft={ref:{kind:'supply' as const,id:'ammo',quantity:1},quantity:'1',price:'500'},before=saveGame(state);
  expect(readFleaOrder(state,draft)?.reason).toContain('размещения');
  expect(fleaPage(state,view({draft}))).toContain('Для размещения нужно');expect(draft.price).toBe('500');
  expect(readFleaOrder(state,{...draft,quantity:'100'})?.reason).toContain('Недостаточно');expect(saveGame(state)).toBe(before);
});
test('unavailable supply party never labels the unit guide as the whole listing value',()=>{
  const state=createGame(NOW),draft={ref:{kind:'supply' as const,id:'ammo',quantity:1},quantity:'10',price:'100'};
  const available=fleaPage(state,view({draft}));expect(available).toContain('Ориентир за весь лот</span><strong>65 ₽</strong>');
  const unavailable=fleaPage(state,view({draft:{...draft,quantity:'9999'}}));expect(unavailable).toContain('Ориентир за весь лот</span><strong>—</strong>');expect(unavailable).toContain('data-action="flea-use-guide" disabled');expect(unavailable).toContain('Недостаточно предметов');
  expect(fleaPage(state,view({draft:{...draft,quantity:'2.5'}}))).toContain('Ориентир за весь лот</span><strong>—</strong>');
  expect(fleaPricePreview(state,view({draft:{...draft,quantity:'9999'}}))).toContain('К получению');
});
test('market explains real party quantity, protects own escrow and escapes user-facing text',()=>{
  const state=createGame(NOW),unsafe=listing({label:'<img src=x onerror=boom>'});
  const html=fleaPage(state,view({tab:'market',market:market([unsafe])}));
  expect(html).toContain('Количество: 7 шт.');expect(html).toContain('&lt;img');expect(html).not.toContain('<img src=x');expect(html).toContain('data-action="flea-buy"');
  const own=listing({owner:true});const ownHtml=fleaPage(state,view({tab:'mine',market:market([own],[own])}));expect(ownHtml).toContain('data-action="flea-cancel"');expect(ownHtml).not.toContain('data-action="flea-buy"');
  const sold=listing({owner:true,status:'sold',soldAt:NOW+1,claimable:true});expect(fleaPage(state,view({tab:'mine',market:market([],[sold])}))).toContain('Получить 95');
  const full=Array.from({length:6},(_,index)=>listing({owner:true,id:`own-${index}`}));const draft={ref:{kind:'supply' as const,id:'ammo',quantity:1},quantity:'1',price:'50'};
  expect(fleaPage(state,view({draft,market:market(full,full)}))).toContain('Одновременно можно разместить 6 лотов');
});
test('catalog covers every named item, utility, weight and sector depth; legacy session defaults are harmless',()=>{
  const state=createGame(NOW),before=saveGame(state),html=fleaPage(state,view({tab:'catalog'}));
  for(const model of LOOT_MODELS)expect(html).toContain(model.label);
  expect(html).toContain('Разбор:');expect(html).toContain('₽ за кг');expect(html).toContain('От 3-го этапа');expect(html).toContain(`Находок: ${LOOT_MODELS.length}`);
  const restored=readGameSession({version:1,page:'flea',flea:{tab:'mine',search:'x'.repeat(200),kind:'loot'}},state);expect(restored.page).toBe('flea');expect(restored.flea.search).toHaveLength(160);expect(restored.flea.tab).toBe('mine');
  expect(readGameSession({version:1,flea:{tab:'constructor',kind:'__proto__',draft:{price:999}}},state).flea).toEqual({tab:'inventory',search:'',kind:'all'});expect(saveGame(state)).toBe(before);
});
test('cancelled offer shows only the spent listing fee, while sold offers distinguish payable and received money',()=>{
  const state=createGame(NOW),cancelled=listing({owner:true,status:'cancelled'});
  const html=fleaPage(state,view({tab:'mine',market:market([],[cancelled])}));
  expect(html).toContain('Отменён · предмет возвращён');expect(html).toContain('Сбор за размещение 2 ₽ уплачен и не возвращается.');
  expect(html).not.toContain('к получению 95');expect(html).not.toContain('комиссия при продаже');expect(html).not.toContain('data-action="flea-claim"');expect(html).not.toContain('data-action="flea-buy"');expect(html).not.toContain('data-action="flea-cancel"');
  const sold=listing({owner:true,status:'sold',soldAt:NOW+1,claimable:true});
  expect(fleaPage(state,view({tab:'mine',market:market([],[sold])}))).toContain('комиссия удержана 5 ₽ · к получению 95 ₽');
  const claimed={...sold,claimedAt:NOW+2,claimable:false};
  const paid=fleaPage(state,view({tab:'mine',market:market([],[claimed])}));expect(paid).toContain('комиссия удержана 5 ₽ · получено 95 ₽');expect(paid).not.toContain('data-action="flea-claim"');
});
test('named receipts use actual cargo and delivery, and separately describe overflow money and losses',()=>{
  const state=lootGame(),item=state.lootItems![0]!;
  expect(raidLootReceipt([item],'carried')).toContain('Трофеи в рюкзаке');expect(raidLootReceipt([item],'delivered')).toContain('data-page="flea"');expect(raidLootReceipt([item],'lost')).not.toContain('data-page="flea"');
  const overflow=raidLootOverflow([{item,money:getLootTraderPrice(item)}]);expect(overflow).toContain('Не поместилось');expect(overflow).toContain('уже входят в наличные');expect(overflow).toContain('143');
  expect(raidLootReceipt(undefined)).toBe('');expect(raidLootOverflow(undefined)).toBe('');
  const raid={id:'raid-1',expedition:{cargo:{money:1,supplies:{ammo:0,medicine:0,scrap:0,intel:0},weaponIds:[],modules:[],lootItems:[item]},capacity:10}} as unknown as Raid;
  const oldReport={raidId:'raid-1',success:true,money:1,supplies:{ammo:0,medicine:0,scrap:0,intel:0},moduleIds:[],weaponId:null} as unknown as RaidReport;
  expect(getConfirmedRaidCargo(raid,null).lootItems).toEqual([item]);expect(getConfirmedRaidCargo(raid,oldReport).lootItems).toBeUndefined();
  expect(getConfirmedRaidCargo(raid,{...oldReport,lootItems:[]}).lootItems).toEqual([]);
});
