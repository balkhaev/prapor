import { expect, test } from 'bun:test';
import { createAuthoritativeClient } from '../src/authoritative-client';
import { createGame } from '../src/game/engine';
import { getMarketFees } from '../src/game/flea';

const NOW=1_792_000_000_000;
const snapshot=(id='guest-1',kind:'guest'|'account'='guest',revision=1)=>({state:createGame(NOW),revision,serverNow:NOW,identity:{id,kind,name:'Игрок'}});
const market=(id='guest-1',kind:'guest'|'account'='guest')=>({identity:{id,kind,name:'Игрок'},serverNow:NOW,offers:[],mine:[],receivables:0});
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const transport=(run:(url:string,init?:RequestInit)=>Promise<Response>):typeof fetch=>run as unknown as typeof fetch;
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));

test('market reads share the authoritative identity, serialize with spending, and deduplicate overlapping refreshes',async()=>{
  let release!:(response:Response)=>void,reads=0,actions=0;
  const client=createAuthoritativeClient({getAccountId:()=>null,onSnapshot:()=>{},fetch:transport(async(url,init)=>{
    if(url.endsWith('/market')){reads++;expect(init?.headers).toMatchObject({'x-prapor-game':'guest-1'});expect(init?.method).toBe('GET');return new Promise(resolve=>{release=resolve;});}
    if(url.endsWith('/action')){actions++;return response({...snapshot('guest-1','guest',2),result:{ok:true,message:'Готово'}});}
    return response(snapshot());
  })});
  await client.join();const first=client.market(),second=client.market();expect(first).toBe(second);await tick();
  const action=client.action({type:'refreshRecruitment',args:[]});expect(actions).toBe(0);release(response(market()));await first;await action;
  expect(reads).toBe(1);expect(actions).toBe(1);expect(client.getMarketSnapshot()).toBeNull();client.destroy();
});
test('old market response cannot follow a changed player or refill the cache',async()=>{
  let account:string|null=null,release!:(response:Response)=>void;
  const client=createAuthoritativeClient({getAccountId:()=>account,onSnapshot:()=>{},fetch:transport(async url=>url.endsWith('/market')?new Promise(resolve=>{release=resolve;}):response(snapshot(account??'guest-1',account?'account':'guest')))});
  await client.join();const pending=client.market();await tick();account='account-2';client.resetIdentity();release(response(market()));
  await expect(pending).rejects.toThrow('Аккаунт изменился');expect(client.getMarketSnapshot()).toBeNull();await client.join();expect(client.getSnapshot()?.identity.id).toBe('account-2');client.destroy();
});
test('wrong identity, malformed prices and failed refresh hide previous offers without replaying an action',async()=>{
  let mode='valid',actions=0;
  const client=createAuthoritativeClient({getAccountId:()=>null,onSnapshot:()=>{},fetch:transport(async url=>{
    if(url.endsWith('/action')){actions++;throw new TypeError('network');}
    if(!url.endsWith('/market'))return response(snapshot());
    if(mode==='network')throw new TypeError('network');
    if(mode==='wrong')return response(market('guest-other'));
    if(mode==='invalid')return response({...market(),offers:[{id:'x',asset:{kind:'supply',id:'ammo',quantity:1},label:'Ammo',guidePrice:10,price:10,...getMarketFees(10),commission:0,createdAt:NOW,status:'active',soldAt:null,claimedAt:null,owner:false,claimable:false}]});
    return response(market());
  })});
  await client.join();await client.market();expect(client.getMarketSnapshot()).not.toBeNull();mode='network';await expect(client.market()).rejects.toThrow('Нет связи');expect(client.getMarketSnapshot()).toBeNull();expect(client.isReady()).toBe(true);
  mode='invalid';await expect(client.market()).rejects.toThrow('неполную сводку');expect(client.getMarketSnapshot()).toBeNull();
  mode='wrong';await expect(client.market()).rejects.toThrow('Аккаунт изменился');expect(client.getMarketSnapshot()).toBeNull();expect(client.isReady()).toBe(false);
  await client.join();expect((await client.action({type:'buyMarketListing',args:['offer-1']})).ok).toBe(false);expect(actions).toBe(1);expect((await client.action({type:'buyMarketListing',args:['offer-1']})).ok).toBe(false);expect(actions).toBe(1);client.destroy();
});
