import { expect, test } from 'bun:test';
import { assignWorker, createGame, getBuildRoomQuote, saveGame, setRoomRecipe } from '../src/game/engine';
import { LOOT_MODELS, JUNK_MODELS, USEFUL_LOOT_MODELS, LOOT_MODEL_BY_ID, getLootTraderPrice } from '../src/game/loot';
import { getLootRequirementQuote, getLootUses } from '../src/game/loot-uses';
import { ROOM_DEFINITIONS, RESOURCE_RECIPES, type ProductionJob, type ShelterRoomType } from '../src/game/shelter';
import { buildingCatalogue, buildingCatalogueReason, buildingPlacementControls } from '../src/territory-ui';
import { lootRequirementsPanel, lootUsesPanel, productionLootReceipt, productionRefundLabel } from '../src/loot-materials-ui';
import { fleaPage, raidLootOverflow, type FleaView } from '../src/flea-ui';
import { shelterRecipeCard } from '../src/shelter-logistics-ui';
import { liveLootCargo } from '../src/live-loot-ui';
import type { LivePlayer } from '../src/game/live';

const NOW=1_792_000_000_000;
const view: FleaView={tab:'catalog',search:'',kind:'all',draft:null,market:null,loading:false,error:'',busy:false};
function add(state:ReturnType<typeof createGame>,modelId:string,quantity=1){for(let i=0;i<quantity;i++)(state.lootItems??=[]).push({id:`loot-${state.nextId++}`,modelId,foundAt:NOW});}
const button=(html:string,action:string)=>html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))?.[0]??'';

test('junk and useful items have distinct, truthful dispositions at every rarity',()=>{
  const state=createGame(NOW),before=saveGame(state),html=fleaPage(state,view);
  expect(LOOT_MODELS).toHaveLength(50);expect(JUNK_MODELS).toHaveLength(12);expect(USEFUL_LOOT_MODELS).toHaveLength(38);expect(html).toContain('Находок: 50');expect(html).toContain('Легендарное');
  for(const model of JUNK_MODELS){const row=lootUsesPanel(model.id);expect(row).toContain('автопродажа при доставке');expect(row).toContain('Не используется в рецептах');expect(row).not.toContain('К бартеру');expect(getLootUses(model.id)).toEqual([]);}
  for(const model of USEFUL_LOOT_MODELS){expect(lootUsesPanel(model.id)).toContain('К бартеру');expect(lootUsesPanel(model.id)).not.toContain('автопродажа');}
  expect(html).toContain('Автопродажа');expect(html).toContain(LOOT_MODEL_BY_ID['military-cpu']!.label);expect(html).toContain(LOOT_MODEL_BY_ID['prototype-optics']!.label);expect(saveGame(state)).toBe(before);
});
test('ordinary useful loot reveals exact construction, crafting and barter opportunities',()=>{
  const html=lootUsesPanel('duct-tape');expect(html).toContain('Бартер ·');expect(html).toContain('Стройка ·');expect(html).toContain('Производство ·');
  expect(html).toContain('data-action="flea-use-construction"');expect(html).toContain('data-action="flea-use-production"');expect(html).toContain('data-model="duct-tape"');expect(html).toContain('×1');
  expect(lootUsesPanel('constructor')).toBe('');expect(lootUsesPanel('__proto__')).toBe('');
});
test('search finds intended uses and rarity, rather than requiring players to remember exact loot names',()=>{
  const state=createGame(NOW),legendary=fleaPage(state,{...view,search:'легендарное'}),junk=fleaPage(state,{...view,search:'автопродажа'}),production=fleaPage(state,{...view,search:'производство'});
  expect(legendary).toContain(LOOT_MODEL_BY_ID['military-cpu']!.label);expect(legendary).toContain(LOOT_MODEL_BY_ID['prototype-optics']!.label);expect(legendary).not.toContain('<h4>Пассатижи</h4>');
  for(const model of JUNK_MODELS)expect(junk).toContain(`<h4>${model.label}</h4>`);expect(junk).not.toContain('<h4>Пассатижи</h4>');expect(production).toContain('<h4>Пассатижи</h4>');expect(production).toContain('<h4>Стерильный бинт</h4>');
});
test('material preview counts only physical stash items and explains missing named components before payment',()=>{
  const state=createGame(NOW);add(state,'pliers');state.pendingLoot=[{id:`delivery-${state.nextId++}`,raidId:'raid-990',at:NOW,items:[{id:`loot-${state.nextId++}`,modelId:'duct-tape',foundAt:NOW}]}];
  const quote=getLootRequirementQuote(state,[{modelId:'pliers',quantity:1},{modelId:'duct-tape',quantity:2}]),before=saveGame(state),html=lootRequirementsPanel(quote.requirements);
  expect(html).toContain('Пассатижи');expect(html).toContain('Армированный скотч');expect(html).toContain('На складе 1 / нужно 1');expect(html).toContain('На складе 0 / нужно 2');expect(html).toContain('предметы на барахолке не входят');expect(quote.reason).toContain('Армированный скотч ×2');expect(saveGame(state)).toBe(before);
});
test('building catalogue and placement display full requirements while relocation needs no second material set',()=>{
  const state=createGame(NOW);state.money=10_000;state.supplies.scrap=40;
  const need=ROOM_DEFINITIONS.workshop.lootRequirements!;
  const quote=getBuildRoomQuote(state,'workshop',0,1),catalog=buildingCatalogue(state),preview=buildingPlacementControls({type:'workshop',rotation:0,site:{column:0,row:1}},quote.reason,state);
  expect(catalog).toContain('Предметы для постройки');expect(preview).toContain('Расход при начале стройки');expect(button(preview,'placement-confirm')).toContain('disabled');expect(buildingCatalogueReason(state,'workshop')).toContain('целые трофеи');
  for(const input of need)add(state,input.modelId,input.quantity);
  const ready=getBuildRoomQuote(state,'workshop',0,1);expect(ready.reason).toBeNull();expect(buildingCatalogueReason(state,'workshop')).toBeNull();expect(button(buildingPlacementControls({type:'workshop',rotation:0,site:{column:0,row:1}},null,state),'placement-confirm')).not.toContain('disabled');
  const move=buildingPlacementControls({type:'workshop',roomId:'room-workshop',rotation:0,site:{column:0,row:1}},null,state);expect(move).not.toContain('loot-material-requirements');expect(move).toContain('Перенос');
});
test('all loot recipes show named inputs and use their own recipe rather than the cash-only kit shortcut',()=>{
  const recipes=RESOURCE_RECIPES.filter(recipe=>recipe.lootRequirements?.length);expect(recipes).toHaveLength(7);
  for(const recipe of recipes){const state=createGame(NOW),room=state.shelter.rooms.find(room=>room.type===recipe.roomType)??{...state.shelter.rooms[0]!,id:'room-ammo-test',type:'ammo' as ShelterRoomType};if(!state.shelter.rooms.some(item=>item.id===room.id))state.shelter.rooms.push(room);
    const missing=shelterRecipeCard(state,room,recipe);expect(missing).toContain('Целые предметы для партии');expect(missing).toContain('Заказать одну партию');expect(missing).toContain('повторение включается отдельно');expect(missing).toContain('data-loot-order="true"');expect(missing).not.toContain('data-action="queue-field-kit"');expect(button(missing,'set-room-recipe')).toContain('disabled');
    for(const input of recipe.lootRequirements!)add(state,input.modelId,input.quantity);expect(assignWorker(state,state.scavs[1]!.id,room.id,NOW).ok).toBe(true);
    const ready=shelterRecipeCard(state,room,recipe);expect(button(ready,'set-room-recipe')).not.toContain('disabled');for(const input of recipe.lootRequirements!)expect(ready).toContain(LOOT_MODEL_BY_ID[input.modelId]!.label);
  }
});
test('paid inputs and cancellation text never promise physical trophies back even before work begins',()=>{
  const state=createGame(NOW),room=state.shelter.rooms.find(room=>room.type==='workshop')!,recipe=RESOURCE_RECIPES.find(recipe=>recipe.id==='maintenance-from-loot')!;
  for(const input of recipe.lootRequirements!)add(state,input.modelId,input.quantity);assignWorker(state,state.scavs[1]!.id,room.id,NOW);expect(setRoomRecipe(state,room.id,recipe.id,false,NOW).ok).toBe(true);
  const job=room.queue[0]!;expect(productionLootReceipt(job)).toContain('Материалы израсходованы');expect(productionLootReceipt(job)).toContain('даже если работа ещё не началась');expect(productionRefundLabel(job)).toBe('Не начат · вернутся только рубли и припасы');
  expect(productionRefundLabel({...job,workDone:1})).toBe('Работа начата · отмена без возврата');const old={...job};delete old.paidLoot;expect(productionRefundLabel(old)).toBe('Не начат · полный возврат при отмене');expect(productionLootReceipt(old)).toBe('');
});
test('automatic junk receipts show actual cash once while preserving historical overflow facts separately',()=>{
  const state=createGame(NOW);add(state,JUNK_MODELS[0]!.id);add(state,'duct-tape');const [junk,useful]=state.lootItems!;
  const html=raidLootOverflow([{item:junk!,money:0},{item:useful!,money:getLootTraderPrice(useful!)}]);expect(html).toContain('Утиль продан при доставке · 0 ₽');expect(html).toContain(`${LOOT_MODEL_BY_ID[junk!.modelId]!.label} — 0 ₽`);expect(html).toContain('Выручка уже входит в наличные отчёта');expect(html).toContain('Ранее продано торговцу');expect(html).toContain('Не поместилось');
});
test('multiplayer bag distinguishes automatic junk cash from items kept for player decisions',()=>{
  const junk={id:'raid-loot-1',modelId:JUNK_MODELS[0]!.id,foundAt:NOW},useful={id:'raid-loot-2',modelId:'pliers',foundAt:NOW};
  const player={lootItems:[junk,useful],pendingDelivery:[],gameId:'guest-test'} as unknown as LivePlayer;
  const html=liveLootCargo(player);expect(html).toContain('Утиль: 1 шт.');expect(html).toContain('автопродажа при доставке');expect(html).toContain('Производство');expect(html).toContain('свою цену');
  const onlyJunk=liveLootCargo({...player,lootItems:[junk]});expect(onlyJunk).not.toContain('свою цену');expect(onlyJunk).toContain('автопродажа при доставке');
});
test('presentation escapes unexpected progress labels and never mutates a paid job',()=>{
  const job={paidLoot:[{id:'loot-1',modelId:'pliers',foundAt:NOW}]} as Pick<ProductionJob,'paidLoot'>,before=JSON.stringify(job);expect(productionLootReceipt(job)).toContain('Пассатижи');expect(JSON.stringify(job)).toBe(before);
  expect(lootRequirementsPanel([{modelId:'<img>',required:1,owned:0}],'<script>')).toContain('&lt;script&gt;');expect(lootRequirementsPanel(undefined)).toBe('');
});
