import { afterEach, describe, expect, test } from 'bun:test';
import { createLiveMode } from '../src/live-ui';
import { liveDropDetails, liveDropLabel, liveEconomyChanged, liveLootCargo, liveLootTotals } from '../src/live-loot-ui';
import { LOOT_MODELS } from '../src/game/loot';
import type { EconomyLoot, LiveSnapshot } from '../src/game/live';
import { getLiveMap, isLiveWalkable } from '../src/game/live-maps';
import { createHealth, createMedicalInventory } from '../src/game/health';

const GAME='cba21a6d-2936-4590-9433-dfa2b58c8dc8', NEXT='4ad58c2f-7616-4600-8134-83b7a210814d';
const loot=(modelId='gold-ring',suffix=1):EconomyLoot=>({id:`532cfa7a-5ca1-4742-a07c-ffefdc785d${String(suffix).padStart(2,'0')}`,modelId,foundAt:1000});
function fixture(game=GAME):LiveSnapshot {
  const {npcSpawns:_npcs,lootSpawns:_loot,...world}=structuredClone(getLiveMap('perimeter'));
  const maps=[{id:world.id,name:world.name,description:world.description,theme:world.theme,width:world.width,height:world.height,online:1,npcs:0}];
  const exit=world.extracts[0]!;
  return {
    server:{id:'perimeter-1',name:'Периметр 01',online:1,capacity:32,startedAt:1000,maps,districts:world.districts.map((district,index)=>({...district,online:index===0?1:0,npcs:0}))},now:2000,selfId:'player-1',world,worldVersion:world.version,visibleChunks:[{x:0,y:0}],
    self:{id:'player-1',ammo:30,medkits:1,cargo:0,stash:0,kills:0,respawnAt:0,patrol:false,targetId:null,travelReadyAt:0,districtId:'customs',purpose:'loot',searching:null,gameId:game,lootItems:[],pendingDelivery:[],economyMessage:'',body:createHealth(),medicine:createMedicalInventory({medkit:40,bandage:2,tourniquet:1,splint:1,painkiller:1,surgery:1}),treatment:null,leaveAt:0},
    entities:[{id:'player-1',name:'Игрок',kind:'player',appearance:0,...exit,health:100,action:'idle',safeUntil:0}],drops:[],events:[],
  };
}
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const tick=()=>new Promise<void>(resolve=>globalThis.setTimeout(resolve,0));

/** A small DOM double; presentation is injected, but the real polling and command controller runs. */
class Element {
  hidden=false; innerHTML=''; disabled=false; dataset:Record<string,string>={};
  classList={add:()=>{},remove:()=>{}};
  listeners=new Map<string,EventListenerOrEventListenerObject>();
  append(..._elements:unknown[]){} remove(){} setAttribute(_name:string,_value:string){} removeAttribute(_name:string){}
  querySelector(){return null;} querySelectorAll(){return [];} closest(){return this;}
  contains(value:unknown){return value instanceof Element;}
  addEventListener(name:string,listener:EventListenerOrEventListenerObject){this.listeners.set(name,listener);}
  removeEventListener(name:string){this.listeners.delete(name);}
  click(action:string){const button=new Element();button.dataset.liveButton=action;(this.listeners.get('click') as (event:unknown)=>void)({target:button});}
}
let cleanup:(()=>void)|null=null;
afterEach(()=>{cleanup?.();cleanup=null;});
function harness(run:(url:string,init:RequestInit)=>Promise<Response>,getGameId:()=>string|null=()=>GAME,getAccountId:()=>string|null=()=>null) {
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const timers=new Map<number,()=>void>();let timer=0;
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>new Element(),querySelector:()=>null,activeElement:null,addEventListener:()=>{},removeEventListener:()=>{}}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout:(callback:()=>void)=>{timers.set(++timer,callback);return timer;},clearTimeout:(id:number)=>timers.delete(id)}});
  const world=new Element(),dock=new Element(),updates:LiveSnapshot[]=[],routeUpdates:string[][]=[];
  let economicChanges=0,marketOpens=0;
  const calls:{url:string;init:RequestInit}[]=[];
  const mode=createLiveMode({world:world as unknown as HTMLElement,dock:dock as unknown as HTMLElement,getAccountId,getGameId,getStock:()=>({ammo:100,medicine:3}),
    onExit:()=>{},onAccount:()=>{},onMarket:()=>{marketOpens++;},onEconomyChange:()=>{economicChanges++;},
    sceneFactory:()=>({show:()=>{},hide:()=>{},clear:()=>{},setSelected:()=>{},setRoute:ids=>routeUpdates.push([...ids]),update:snapshot=>updates.push(snapshot),destroy:()=>{}}),
    fetch:(async (url:string,init:RequestInit)=>{calls.push({url,init});return run(url,init);}) as unknown as typeof fetch,
  });
  cleanup=()=>{mode.destroy();if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument);else Reflect.deleteProperty(globalThis,'document');if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else Reflect.deleteProperty(globalThis,'window');};
  const pump=async()=>{await tick();await tick();};
  return {mode,dock,calls,updates,routeUpdates,pump,get economicChanges(){return economicChanges;},get marketOpens(){return marketOpens;},firePoll(){const next=timers.entries().next().value;if(next){timers.delete(next[0]);next[1]();}}};
}

describe('live loot and headquarters presentation',()=>{
  test('routes show real stops, choose guidance locally and request movement to a walkable entrance with cached geometry',async()=>{
    const state=fixture();
    state.server.routes=state.world.routes!.map(({id,name,description,districtId,purpose,poiIds})=>({id,name,description,districtId,purpose,stops:poiIds.map(id=>state.world.pois.find(poi=>poi.id===id)!.name)}));
    const h=harness(async url=>{
      if(url.endsWith('/status'))return response(state.server);
      if(url.endsWith('/action'))return response({...state,world:undefined});
      if(url.endsWith('/leave'))return response({ok:true});
      return response(state);
    });
    h.mode.show();await h.pump();
    h.dock.click('district:sawmill');h.dock.click('purpose:quests');
    const scouting=state.server.routes.find(route=>route.districtId==='sawmill'&&route.purpose==='quests')!;
    expect(h.dock.innerHTML).toContain(scouting.name);
    for(const stop of scouting.stops)expect(h.dock.innerHTML).toContain(stop);
    expect(h.calls.some(call=>call.url.endsWith('/action'))).toBe(false);
    h.dock.click('join');await h.pump();
    const original=state.world.routes!.find(route=>route.purpose===state.self.purpose&&route.districtId===state.self.districtId)!;
    expect(h.routeUpdates.at(-1)).toEqual(original.poiIds);
    const selected=state.world.routes!.find(route=>route.purpose===state.self.purpose&&route.districtId==='sawmill')!;
    const before=h.calls.length;
    h.dock.click(`route:${selected.id}`);
    expect(h.calls).toHaveLength(before);
    expect(h.routeUpdates.at(-1)).toEqual(selected.poiIds);
    expect(h.dock.innerHTML).toContain(selected.name);
    const poi=state.world.pois.find(poi=>poi.id===selected.poiIds[0])!;
    h.dock.click(`poi:${poi.id}`);await h.pump();
    const request=h.calls.find(call=>call.url.endsWith('/action'))!;
    const command=JSON.parse(request.init.body as string);
    expect(command.type).toBe('move');
    expect(poi.entrances).toContainEqual({x:command.x,y:command.y});
    expect(isLiveWalkable(state.world,command)).toBe(true);
    expect(request.init.headers).toMatchObject({'x-prapor-game':GAME,'x-prapor-world-version':state.world.version});
    expect(h.routeUpdates.at(-1)).toEqual(selected.poiIds);
    expect(h.updates.at(-1)?.world.routes).toEqual(state.world.routes);
    expect(h.updates.at(-1)?.self.gameId).toBe(GAME);
  });
  test('every catalog item has the same weight and guide value in live mode as on the flea market',()=>{
    for(const model of LOOT_MODELS){
      const item=loot(model.id),player=fixture().self;player.lootItems=[item];
      const totals=liveLootTotals([item]);
      expect(totals.weight).toBe(model.weight);expect(totals.guide).toBe(model.guidePrice);expect(totals.trader).toBeLessThan(totals.guide);
      const html=liveLootCargo(player);
      expect(html).toContain(model.label);expect(html).toContain('Ориентир');
      if(model.autoSell){expect(html).toContain('автопродажа при доставке');expect(html).not.toContain('свою цену');}
      else{expect(html).toContain('торговцу');expect(html).toContain('свою цену');}
      expect(liveDropLabel({id:'drop',x:2,y:2,amount:0,items:[item]})).toBe(model.label);
      expect(liveDropDetails({id:'drop',x:2,y:2,amount:0,items:[item]})).toContain('ориентир');
    }
  });
  test('keeps carried loot distinct from safe extracted parcels and escapes receipt messages',()=>{
    const player=fixture().self;player.lootItems=[loot('gold-ring')];
    player.pendingDelivery=[{items:[loot('thermal-sensor',2)],money:17,message:'<img src=x onerror=alert(1)>'}];
    const html=liveLootCargo(player);
    expect(html).toContain('1/32');expect(html).toContain('0,1 / 12 кг');
    expect(html).toContain('Уже вынесено · ждёт доставки');expect(html).toContain('не теряется, если бойца выбьют');
    expect(html).toContain('Предметов: 1 · деньги: 17 ₽');expect(html).toContain('&lt;img');expect(html).not.toContain('<img');
    const beginning=html.indexOf('live-delivery');
    expect(html.slice(0,beginning)).not.toContain('Тепловизионный модуль');
  });
  test('recognizes money-only delivery and never treats newly carried loot as an HQ deposit',()=>{
    const before=fixture().self,next=structuredClone(before);
    next.lootItems=[loot()];expect(liveEconomyChanged(before,next)).toBe(false);
    before.pendingDelivery=[{items:[],money:50,message:'Нет места'}];
    expect(liveEconomyChanged(before,next)).toBe(true);
    expect(liveEconomyChanged(next,next,'resupply')).toBe(true);
  });
  test('refilling a consumed aid refreshes headquarters even when the medkit HP and ammunition stay full',async()=>{
    const state=fixture();state.self.ammo=60;state.self.medkits=2;state.self.medicine.medkit=80;state.self.medicine.splint=0;
    const h=harness(async url=>url.endsWith('/status')?response(state.server):url.endsWith('/leave')?response({ok:true}):response(state));
    h.mode.show();await h.pump();h.dock.click('join');await h.pump();
    expect(h.dock.innerHTML).toContain('Заберёшь: патроны +0, лекарства +1');
    expect(h.dock.innerHTML).not.toContain('Комплект пополнен');
    expect(h.dock.innerHTML).not.toContain('data-live-button="resupply" disabled');
    state.self.medicine.splint=1;h.firePoll();await h.pump();
    expect(h.economicChanges).toBe(2);expect(h.dock.innerHTML).toContain('Комплект пополнен');
  });
  test('connects the live market button, named inventory and refill using the captured shelter identity',async()=>{
    const state=fixture();state.self.lootItems=[loot()];
    const h=harness(async url=>url.endsWith('/status')?response(state.server):url.endsWith('/leave')?response({ok:true}):response(state));
    h.mode.show();await h.pump();h.dock.click('join');await h.pump();
    expect(h.dock.innerHTML).toContain('Золотое кольцо');expect(h.dock.innerHTML).toContain('Склад и барахолка');
    expect(h.dock.innerHTML).toContain('Заберёшь: патроны +30, лекарства +1');
    h.dock.click('resupply');await h.pump();
    const action=h.calls.find(call=>call.url.endsWith('/action'))!;
    expect(JSON.parse(action.init.body as string)).toEqual({type:'resupply'});
    expect(action.init.headers).toMatchObject({'x-prapor-game':GAME,'x-prapor-live':'player-1'});
    expect(h.economicChanges).toBe(2);
    h.dock.click('market');await h.pump();expect(h.marketOpens).toBe(1);
  });
  test('refreshes headquarters after extraction and after the pending parcel arrives on a fresh read',async()=>{
    let state=fixture();state.self.lootItems=[loot()];
    const h=harness(async (url,init)=>{
      if(url.endsWith('/status'))return response(state.server);
      if(url.endsWith('/action')){
        expect(JSON.parse(init.body as string)).toEqual({type:'extract'});
        const items=state.self.lootItems!;state=structuredClone(state);state.self.lootItems=[];
        state.self.pendingDelivery=[{items,money:0,message:'Освободи место'}];
      }
      return response(state);
    });
    h.mode.show();await h.pump();h.dock.click('join');await h.pump();
    h.dock.click('extract');await h.pump();
    expect(h.economicChanges).toBe(2);expect(h.dock.innerHTML).toContain('Уже вынесено');
    state.self.pendingDelivery=[];h.firePoll();await h.pump();
    expect(h.economicChanges).toBe(3);expect(h.dock.innerHTML).not.toContain('Уже вынесено');
  });
  test('a response from the previous shelter cannot restore its inventory or trigger an economy refresh',async()=>{
    let game=GAME,release!: (response:Response)=>void;
    const h=harness(async url=>{
      if(url.endsWith('/status'))return response(fixture().server);
      if(url.endsWith('/action'))return new Promise<Response>(resolve=>{release=resolve;});
      return response(fixture(game));
    },()=>game);
    h.mode.show();await h.pump();h.dock.click('join');await h.pump();
    h.dock.click('extract');await h.pump();
    game=NEXT;h.mode.refreshPanel();
    const old=fixture();old.self.lootItems=[loot('secure-drive')];release(response(old));await h.pump();
    expect(h.economicChanges).toBe(1);expect(h.updates).toHaveLength(1);expect(h.dock.innerHTML).not.toContain('Защищённый накопитель');
    h.dock.click('join');await h.pump();expect(h.updates.at(-1)?.self.gameId).toBe(NEXT);
    expect(h.calls.filter(call=>call.url.endsWith('/action'))).toHaveLength(1);
  });
  test('a delayed resupply confirmation refreshes HQ when its stocks finally reach the player',async()=>{
    const state=fixture();
    const h=harness(async url=>url.endsWith('/status')?response(state.server):response(state));
    h.mode.show();await h.pump();h.dock.click('join');await h.pump();
    h.dock.click('resupply');await h.pump();expect(h.economicChanges).toBe(2);
    state.self.ammo=60;state.self.medkits=2;state.self.medicine.medkit=80;h.firePoll();await h.pump();
    expect(h.economicChanges).toBe(3);expect(h.dock.innerHTML).toContain('Комплект пополнен');
  });
  test('a late join for another account is cleaned up before joining the current identity',async()=>{
    let game=GAME,account:string|null='account-a',release!: (response:Response)=>void,joins=0;
    const h=harness(async url=>{
      if(url.endsWith('/status'))return response(fixture().server);
      if(url.endsWith('/join')){
        if(++joins===1)return new Promise<Response>(resolve=>{release=resolve;});
        return response(fixture(game));
      }
      return response({ok:true});
    },()=>game,()=>account);
    h.mode.show();await h.pump();h.dock.click('join');await h.pump();
    account='account-b';game=NEXT;h.mode.resetIdentity();await h.pump();h.dock.click('join');
    const old=fixture();old.self.lootItems=[loot('secure-drive')];release(response(old));await h.pump();await h.pump();
    expect(h.updates).toHaveLength(1);expect(h.updates[0]!.self.gameId).toBe(NEXT);expect(h.economicChanges).toBe(1);
    const requests=h.calls.filter(call=>!call.url.endsWith('/status'));
    expect(requests.map(call=>call.url)).toEqual(['/api/live/join','/api/live/leave','/api/live/join']);
    expect(requests[1]!.init.headers).toMatchObject({'x-prapor-account':'account-a','x-prapor-game':GAME});
    expect(requests[2]!.init.headers).toMatchObject({'x-prapor-account':'account-b','x-prapor-game':NEXT});
    expect(h.dock.innerHTML).not.toContain('Защищённый накопитель');
  });
  test('an uncertain spending command is observed but never automatically replayed',async()=>{
    const state=fixture();let actions=0;
    const h=harness(async url=>{
      if(url.endsWith('/status'))return response(state.server);
      if(url.endsWith('/action')){actions++;throw new TypeError('lost response');}
      return response(state);
    });
    h.mode.show();await h.pump();h.dock.click('join');await h.pump();
    h.dock.click('resupply');await h.pump();expect(h.dock.innerHTML).toContain('автоматически не повторяется');
    h.firePoll();await h.pump();expect(actions).toBe(1);expect(h.economicChanges).toBe(1);
  });
  test('entry waits for the authoritative headquarters rather than creating a separate live wallet',async()=>{
    const h=harness(async()=>response(fixture().server),()=>null);
    h.mode.show();await h.pump();expect(h.dock.innerHTML).toContain('Подключаемся к убежищу');
    h.dock.click('join');await h.pump();expect(h.calls.some(call=>call.url.endsWith('/join'))).toBe(false);
  });
});
