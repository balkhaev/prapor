import { afterEach, describe, expect, test } from 'bun:test';
import { createLiveMode } from '../src/live-ui';
import { readLiveEntry } from '../src/live-client';
import { getLiveLoadout, quoteLiveKits, type LiveEntry } from '../src/game/live-entry';
import { createHealth, createMedicalInventory } from '../src/game/health';
import { getLiveMap } from '../src/game/live-maps';
import type { LiveSnapshot } from '../src/game/live';

const GAME='cba21a6d-2936-4590-9433-dfa2b58c8dc8', NEXT='4ad58c2f-7616-4600-8134-83b7a210814d';
function fixture(): { entry: LiveEntry; state: LiveSnapshot } {
  const { npcSpawns: _npcs, lootSpawns: _loot, ...world } = structuredClone(getLiveMap('perimeter'));
  const server = { id:'perimeter-1',name:'Периметр 01',online:1,capacity:32,startedAt:1000,
    maps:[{id:world.id,name:world.name,description:world.description,theme:world.theme,width:world.width,height:world.height,online:1,npcs:0,city:world.city}],
    districts:world.districts.map((district,index)=>({...district,online:index===0?1:0,npcs:0})) };
  const stock={money:640,ammo:100,medicine:3};
  const state: LiveSnapshot = {server,world,worldVersion:world.version,now:Date.now(),selfId:'player-1',visibleChunks:[{x:0,y:0}],
    self:{id:'player-1',ammo:24,medkits:2,cargo:0,stash:0,kills:0,respawnAt:0,patrol:false,targetId:null,travelReadyAt:0,districtId:'customs',purpose:'loot',searching:null,gameId:GAME,lootItems:[],pendingDelivery:[],body:createHealth(),medicine:createMedicalInventory(),treatment:null,leaveAt:0,loadout:getLiveLoadout('scav')},
    entities:[{id:'player-1',name:'Боец',kind:'player',appearance:0,...world.districts[0]!.spawns[0]!,health:100,action:'idle',safeUntil:0}],drops:[],events:[]};
  return {entry:{server,now:state.now,mode:'new',fighter:null,stock,kits:quoteLiveKits(stock)},state};
}
class Element {
  hidden=false;innerHTML='';disabled=false;dataset:Record<string,string>={};children:Element[]=[];parent:Element|null=null;
  classList={add(){},remove(){}};listeners=new Map<string,(event:unknown)=>void>();
  append(...elements:Element[]){for(const element of elements){element.parent=this;this.children.push(element);}}
  contains(value:unknown):boolean{return value===this||this.children.some(child=>child.contains(value));}
  querySelector(){return null;}querySelectorAll(){return [];}closest(){return this;}getAttribute(){return null;}
  setAttribute(){}removeAttribute(){}remove(){}focus(){}
  addEventListener(type:string,callback:(event:unknown)=>void){this.listeners.set(type,callback);}removeEventListener(type:string){this.listeners.delete(type);}
  click(action:string){const target=new Element();target.dataset.liveButton=action;this.append(target);this.listeners.get('click')?.({target});}
}
let dispose: (()=>void)|null=null;
afterEach(()=>{dispose?.();dispose=null;});
function harness(run:(path:string,init:RequestInit)=>Promise<Response>,getGameId=()=>GAME) {
  const doc=Object.getOwnPropertyDescriptor(globalThis,'document'),win=Object.getOwnPropertyDescriptor(globalThis,'window');
  const timers=new Map<number,()=>void>();let timer=0;
  Object.defineProperty(globalThis,'document',{configurable:true,value:{activeElement:null,createElement:()=>new Element(),querySelector:()=>null,addEventListener(){},removeEventListener(){}}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout:(callback:()=>void)=>{timers.set(++timer,callback);return timer;},clearTimeout:(id:number)=>timers.delete(id)}});
  const world=new Element(),dock=new Element(),calls:Array<{path:string;init:RequestInit}>=[];
  const mode=createLiveMode({world:world as unknown as HTMLElement,dock:dock as unknown as HTMLElement,getAccountId:()=>null,getGameId,onExit(){},onAccount(){},onMarket(){},
    sceneFactory:()=>({show(){},hide(){},clear(){},setSelected(){},update(){},destroy(){}}),
    fetch:(async(url:string,init:RequestInit)=>{const path=url.split('/').at(-1)!;calls.push({path,init});return run(path,init);}) as typeof fetch});
  dispose=()=>{mode.destroy();if(doc)Object.defineProperty(globalThis,'document',doc);else Reflect.deleteProperty(globalThis,'document');if(win)Object.defineProperty(globalThis,'window',win);else Reflect.deleteProperty(globalThis,'window');};
  const settle=async()=>{for(let count=0;count<30;count++)await Promise.resolve();};
  return {mode,world,dock,calls,settle,overlay:world.children[0]!,firePoll(){const next=timers.entries().next().value;if(next){timers.delete(next[0]);next[1]();}}};
}

describe('authoritative multiplayer sortie preparation',()=>{
  test('preparing after a downed snapshot restores the full entry city and route preview',async()=>{
    const {entry,state}=fixture();const route=state.world.routes!.find(route=>route.districtId==='customs'&&route.purpose==='loot')!;
    entry.server.routes=[{id:route.id,name:route.name,description:route.description,districtId:route.districtId,purpose:route.purpose,stops:route.poiIds.map(id=>state.world.pois.find(poi=>poi.id===id)!.name)}];
    let joined=false;
    const h=harness(async path=>{
      if(path==='leave')return Response.json({ok:true});
      if(path==='entry')return Response.json(joined?{...entry,mode:'downed',fighter:{id:state.selfId,name:'Боец',x:state.entities[0]!.x,y:state.entities[0]!.y,health:0,body:state.self.body,medicine:state.self.medicine,ammo:state.self.ammo,districtId:'customs',purpose:'loot',cargo:0,lootCount:0,respawnAt:state.self.respawnAt,online:true,loadout:state.self.loadout}}:entry);
      if(path==='join'){joined=true;return Response.json(state);}
      return Response.json({...state,server:{...state.server,maps:state.server.maps.map(({city:_city,...map})=>map)}});
    });
    h.mode.show();await h.settle();h.overlay.click('join');await h.settle();
    state.entities[0]!.health=0;state.self.body=createHealth(0);state.self.respawnAt=state.now+1000;
    h.firePoll();await h.settle();
    expect(state.world.city!.quarters.every(quarter => h.overlay.innerHTML.includes(quarter.name))).toBe(true);
    expect(h.overlay.innerHTML.includes('data-entry-roof')).toBe(true);expect(h.overlay.innerHTML).toContain(route.name);
    expect(h.dock.innerHTML).toContain('<h2>Периметр 01</h2>');expect(h.calls.some(call=>call.path==='action')).toBe(false);
  });
  test('automatic sortie reads server intent and sends pause, resume, route and recall once without replay during polling',async()=>{
    const {entry,state}=fixture();const route=state.world.routes!.find(route=>route.purpose==='loot'&&route.districtId==='customs')!;
    state.self.automation={enabled:true,stage:'route',goal:'Идёт к первому ориентиру',targetId:null,target:null,routeId:route.id,routeName:route.name,stopIndex:0,stopCount:route.poiIds.length,reason:null,startedAt:state.now,completedAt:0};
    const commands:unknown[]=[];
    const h=harness(async(path,init)=>{
      if(path==='entry')return Response.json(entry);
      if(path==='leave')return Response.json({ok:true});
      if(path==='action'){
        const command=JSON.parse(init.body as string);commands.push(command);
        if(command.type==='automation'){state.self.automation!.enabled=command.enabled;state.self.automation!.stage=command.enabled?'route':'paused';}
        if(command.type==='recall'){state.self.automation!.stage='extract';state.self.automation!.goal='Возвращается к выходу';}
      }
      return Response.json(state);
    });
    h.mode.show();await h.settle();h.overlay.click('join');await h.settle();
    expect(h.dock.innerHTML).toContain('АВТОБОЙ АКТИВЕН');expect(h.dock.innerHTML).toContain('Идёт к первому ориентиру');
    expect(h.dock.innerHTML).not.toContain('WASD');expect(h.dock.innerHTML).not.toContain('data-live-button="move:');expect(commands).toEqual([]);
    h.dock.click('auto-toggle');await h.settle();expect(h.dock.innerHTML).toContain('АВТОБОЙ НА ПАУЗЕ');
    h.firePoll();await h.settle();expect(commands).toEqual([{type:'automation',enabled:false}]);
    h.dock.click('auto-toggle');await h.settle();h.dock.click(`route:${route.id}`);await h.settle();h.dock.click('recall');await h.settle();
    expect(commands).toEqual([{type:'automation',enabled:false},{type:'automation',enabled:true},{type:'automation',enabled:true,routeId:route.id},{type:'recall'}]);
    expect(h.dock.innerHTML).toContain('Возвращается к выходу');
    h.firePoll();await h.settle();expect(commands).toHaveLength(4);
    state.self.automation!.enabled=false;state.self.automation!.stage='complete';state.self.automation!.completedAt=state.now+1000;state.self.automation!.goal='Груз доставлен';
    h.firePoll();await h.settle();expect(h.dock.innerHTML).toContain('Рейд завершён');expect(h.dock.innerHTML).toContain('Вернуться в убежище');
    expect(h.dock.innerHTML).not.toContain('data-live-button="auto-toggle"');expect(h.dock.innerHTML).not.toContain('data-live-button="recall"');expect(commands).toHaveLength(4);
  });
  test('entry parser detaches the private body and rejects hidden actor fields, forged costs and inconsistent continuation',()=>{
    const {entry,state}=fixture();const self=state.entities[0]!;
    entry.mode='continue';entry.fighter={id:self.id,name:self.name,x:self.x,y:self.y,health:self.health,body:state.self.body,medicine:state.self.medicine,ammo:24,districtId:'customs',purpose:'loot',cargo:0,lootCount:0,respawnAt:0,online:false,loadout:getLiveLoadout('scav')};
    const decoded=readLiveEntry(entry);decoded.fighter!.body.parts.chest.hp=12;decoded.kits[0]!.cost.money=900;
    expect(entry.fighter.body.parts.chest.hp).not.toBe(12);expect(entry.kits[0]!.cost.money).toBe(0);
    expect(()=>readLiveEntry({...entry,entities:state.entities})).toThrow();
    expect(()=>readLiveEntry({...entry,mode:'new'})).toThrow();
    expect(()=>readLiveEntry({...entry,kits:[{...entry.kits[0]!,cost:{...entry.kits[0]!.cost,ammo:23}}]})).toThrow();
    expect(()=>readLiveEntry({...entry,kits:[entry.kits[0]!,entry.kits[0]!]})).toThrow();
    expect(()=>readLiveEntry({...entry,fighter:{...entry.fighter!,loadout:{...entry.fighter!.loadout!,damage:101}}})).toThrow();
  });

  test('a new sortie chooses district, purpose and priced kit on the playing surface and sends identifiers only',async()=>{
    const {entry,state}=fixture();
    const h=harness(async(path,init)=>{if(path==='entry')return Response.json(entry);if(path==='leave')return Response.json({ok:true});if(path==='join'){const options=JSON.parse(init.body as string);state.self.districtId=options.districtId;state.self.purpose=options.purpose;state.self.loadout=getLiveLoadout(options.kitId);state.self.ammo=40;return Response.json(state);}throw new Error(path);});
    h.mode.setEntrySelection({districtId:'sawmill',purpose:'pve'});h.mode.show();await h.settle();
    expect(h.overlay.innerHTML).toContain('Выход в рейд');expect(h.overlay.innerHTML).toContain('Боевой комплект');expect(h.overlay.innerHTML).toContain('ПМ');expect(h.overlay.innerHTML).toContain('СКС');
    h.overlay.click('district:village');h.overlay.click('purpose:pvp');h.overlay.click('kit:scout');h.overlay.click('join');await h.settle();
    expect(JSON.parse(h.calls.find(call=>call.path==='join')!.init.body as string)).toEqual({districtId:'village',purpose:'pvp',kitId:'scout',intent:'deploy'});
    expect(h.dock.innerHTML).toContain('Комплект разведчика');expect(h.dock.innerHTML).toContain('К зелёному выходу');expect(h.dock.innerHTML).toContain('Игроки поблизости');
    expect(h.dock.innerHTML).toContain('live-medical-fold');expect(h.dock.innerHTML).not.toContain('class="live-medical-fold urgent" open');
    expect(h.calls.some(call=>call.path==='action')).toBe(false);
  });

  test('returning to a living fighter ignores new selections and requests continuation without a new kit or location',async()=>{
    const {entry,state}=fixture();const self=state.entities[0]!;
    self.health=55;state.self.body=createHealth(0.55);state.self.cargo=78;
    entry.mode='continue';entry.fighter={id:self.id,name:self.name,x:self.x,y:self.y,health:55,body:state.self.body,medicine:state.self.medicine,ammo:24,districtId:'customs',purpose:'loot',cargo:78,lootCount:0,respawnAt:0,online:false,loadout:getLiveLoadout('scav')};
    const h=harness(async path=>Response.json(path==='entry'?entry:path==='leave'?{ok:true}:state));
    h.mode.setEntrySelection({districtId:'depot',purpose:'pvp'});h.mode.show();await h.settle();
    expect(h.overlay.innerHTML).toContain('Продолжить рейд');expect(h.overlay.innerHTML).toContain('55% здоровья');expect(h.overlay.innerHTML).toContain('Повторной оплаты нет');
    h.overlay.click('kit:assault');h.overlay.click('district:village');h.overlay.click('join');await h.settle();
    expect(JSON.parse(h.calls.find(call=>call.path==='join')!.init.body as string)).toEqual({intent:'continue'});
    expect(h.dock.innerHTML).toContain('Ранения · нужна помощь');expect(h.dock.innerHTML).toContain('class="live-medical-fold urgent" open');
    expect(state.self.cargo).toBe(78);expect(h.calls.some(call=>call.path==='action')).toBe(false);
  });

  test('unavailable supplies block deployment without manufacturing ammunition or replaying a command',async()=>{
    const {entry}=fixture();entry.stock={money:640,ammo:0,medicine:0};entry.kits=quoteLiveKits(entry.stock);
    const h=harness(async path=>Response.json(path==='entry'?entry:{ok:true}));h.mode.show();await h.settle();h.overlay.click('join');await h.settle();
    expect(h.overlay.innerHTML).toContain('На складе нет патронов');expect(h.overlay.innerHTML).toContain('Склад и барахолка');expect(h.calls.some(call=>call.path==='join')).toBe(false);
  });

  test('an entry reply for the previous headquarters cannot expose its body or quote after an identity switch',async()=>{
    const {entry}=fixture();let game=GAME,finishOld!: (reply:Response)=>void;
    const h=harness(async(path,init)=>path==='entry'&&new Headers(init.headers).get('x-prapor-game')===GAME?new Promise<Response>(resolve=>{finishOld=resolve;}):Response.json(path==='entry'?{...entry,stock:{money:15,ammo:1,medicine:0},kits:quoteLiveKits({money:15,ammo:1,medicine:0})}:{ok:true}),()=>game);
    h.mode.show();await h.settle();game=NEXT;h.mode.resetIdentity();await h.settle();finishOld(Response.json(entry));await h.settle();
    expect(h.overlay.innerHTML).toContain('1 патронов');expect(h.overlay.innerHTML).not.toContain('100 патронов');expect(h.calls.some(call=>call.path==='join')).toBe(false);
  });
});
