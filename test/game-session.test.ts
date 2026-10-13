import {expect,test} from 'bun:test';
import {advance,buildRoom,createGame,dispatchRaid,excavateShelter,saveGame} from '../src/game/engine';
import {readGameSession} from '../src/game-session';

test('restoring a session validates references without changing paid gameplay',()=>{
	const state=createGame(10_000), before=saveGame(state);
	const restored=readGameSession({version:1,page:'arsenal',view:'base',weaponId:state.weapons[1]!.id,scavId:state.scavs[0]!.id,roomId:state.shelter.rooms[0]!.id,context:'room',armoryTab:'bench',moduleSlot:'barrel',filters:{weaponSearch:'СКС',category:'rifle',moduleSlot:'optic',moduleRarity:'rare',roomModuleSlot:'stock',contracts:'done'},presentation:{version:1,lift:{y:228}}},state);
	expect(restored.page).toBe('arsenal');expect(restored.armoryTab).toBe('bench');expect(restored.moduleSlot).toBe('barrel');expect(restored.filters.roomModuleSlot).toBe('stock');expect(restored.weaponId).toBe(state.weapons[1]!.id);expect(restored.scavId).toBe(state.scavs[0]!.id);expect(restored.context).toBe('room');expect(restored.presentation).toEqual({version:1,lift:{y:228}});expect(saveGame(state)).toBe(before);
});
test('unknown or malformed view state falls back safely instead of becoming game state',()=>{
	const state=createGame(10_000);
	for(const value of [null,42,[],{version:2,page:'arsenal'}, {version:1,page:'constructor',weaponId:'gun-999',scavId:'scav-999',context:'build',site:{column:4,row:99},moduleSlot:'__proto__',filters:{category:'constructor',moduleRarity:'__proto__',weaponSearch:42}}]){
		const result=readGameSession(value,state);expect(result.page).toBe('home');expect(result.weaponId).toBe(state.weapons[0]!.id);expect(result.scavId).toBeNull();expect(result.context).toBe('overview');expect(result.site).toBeNull();expect(result.moduleSlot).toBe('optic');expect(result.filters.category).toBe('all');expect(result.filters.moduleRarity).toBe('all');expect(result.filters.weaponSearch).toBe('');
	}
});
test('occupied construction sites and stale IDs are not restored as active controls',()=>{
	const state=createGame(10_000), room=state.shelter.rooms[0]!;
	const result=readGameSession({version:1,view:'raid',raidId:'raid-999',context:'build',site:{column:room.column,row:room.row},benchModuleId:'module-999',workshopId:state.shelter.rooms[1]!.id},state);
	expect(result.view).toBe('base');expect(result.context).toBe('overview');expect(result.site).toBeNull();expect(result.benchModuleId).toBeNull();expect(result.workshopId).toBeNull();
});
test('a selected raid perk belongs to the exact paid stage, seed and offered choice',()=>{
	let state=createGame(10_000);
	for(let attempt=0;attempt<100;attempt++){
		state=createGame(10_000+attempt);state.scavs[0]!.combat=100;state.scavs[0]!.scouting=100;
		expect(dispatchRaid(state,state.scavs[0]!.id,'courtyard',state.lastUpdated).ok).toBe(true);advance(state,state.raids[0]!.endsAt);
		if(state.raids[0]?.expedition?.status==='choice')break;
	}
	const raid=state.raids[0]!,run=raid.expedition!,perk=run.offers[0]!;expect(run.status).toBe('choice');
	const valid={raidId:raid.id,stage:run.stage,seed:raid.seed,perk},before=saveGame(state);
	expect(readGameSession({version:1,view:'raid',raidId:raid.id,perks:[valid,valid]},state).perks).toEqual([valid]);
	for(const invalid of [{...valid,stage:run.stage+1},{...valid,seed:raid.seed+1},{...valid,raidId:'raid-999'},{...valid,perk:'constructor'}])expect(readGameSession({version:1,perks:[invalid]},state).perks).toEqual([]);
	expect(saveGame(state)).toBe(before);
});
test('unbounded search text and broken presentation data cannot break restoration',()=>{
	const state=createGame(10_000),circular:Record<string,unknown>={};circular.self=circular;
	expect(readGameSession({version:1,filters:{weaponSearch:'a'.repeat(1000)},presentation:{text:'x'.repeat(48_001)}},state).presentation).toBeNull();
	expect(readGameSession({version:1,presentation:circular},state).presentation).toBeNull();
	expect(readGameSession({version:1,filters:{weaponSearch:'a'.repeat(1000)}},state).filters.weaponSearch).toHaveLength(160);
});

test('build context restores signed perimeter walls on the left, right and deeper side without advancing gameplay',()=>{
	const state=createGame(10_000),before=saveGame(state);
	for(const site of [{column:-1,row:1},{column:4,row:2},{column:2,row:3}]){
		const restored=readGameSession({version:1,page:'base',view:'base',context:'build',site,roomTab:'upgrade'},state);
		expect(restored.site).toEqual(site);expect(restored.context).toBe('build');expect(restored.page).toBe('base');expect(restored.roomTab).toBe('upgrade');
	}
	expect(saveGame(state)).toBe(before);
});

test('a selected expanded site survives pending work and completion but is cleared when a room occupies it',()=>{
	const state=createGame(10_000);state.money=2_000;state.supplies.scrap=30;
	const sites=[{column:-1,row:1},{column:4,row:2},{column:2,row:3}];
	for(const site of sites)expect(excavateShelter(state,site.column,site.row,state.lastUpdated).ok).toBe(true);
	advance(state,17_319);
	let before=saveGame(state);
	for(const site of sites){
		const restored=readGameSession({version:1,view:'base',context:'build',site},state);
		expect(restored.site).toEqual(site);expect(restored.context).toBe('build');
	}
	expect(saveGame(state)).toBe(before);
	advance(state,30_000);
	before=saveGame(state);
	for(const site of [...sites,{column:-2,row:1},{column:5,row:2},{column:2,row:4}]){
		const restored=readGameSession({version:1,view:'base',context:'build',site},state);
		expect(restored.site).toEqual(site);expect(restored.context).toBe('build');
	}
	expect(saveGame(state)).toBe(before);
	expect(buildRoom(state,'ammo',-1,1,state.lastUpdated).ok).toBe(true);
	before=saveGame(state);
	const occupied=readGameSession({version:1,view:'base',context:'build',site:sites[0]},state);
	expect(occupied.site).toBeNull();expect(occupied.context).toBe('overview');expect(saveGame(state)).toBe(before);
});

test('session restoration rejects street coordinates, disconnected rock and malformed expanded sites',()=>{
	const state=createGame(10_000),before=saveGame(state);
	for(const site of [{column:0,row:-1},{column:-1,row:-1},{column:-2,row:1},{column:5,row:2},{column:8,row:8},{column:0,row:4},{column:-129,row:0},{column:0,row:129},{column:-.5,row:1},{column:'-1',row:1},{column:4,row:NaN}]){
		const restored=readGameSession({version:1,view:'base',context:'build',site},state);
		expect(restored.site).toBeNull();expect(restored.context).toBe('overview');
	}
	expect(saveGame(state)).toBe(before);
});
