import { MAPS, RARITY_COLORS, type WeaponCategory } from './game/data';
import { RUN_PERKS, getShelterSites, getShelterFrontier, isShelterSiteCoordinate, type GameState, type RunPerk } from './game/engine';
import { MODULE_SLOTS, type ModuleSlot } from './game/modules';

export type SessionPage = 'home'|'raids'|'arsenal'|'base'|'contracts'|'journal'|'recruits'|'squad';
export interface GameSession {
	version: 1;
	page: SessionPage;
	view: 'base'|'map'|'raid';
	mapId: string;
	weaponId: string;
	scavId: string|null;
	roomId: string|null;
	raidId: string|null;
	context: 'overview'|'room'|'build';
	site: {column:number;row:number}|null;
	roomTab: 'staff'|'production'|'upgrade';
	armoryTab: 'weapons'|'bench'|'modules'|'equipment'|'market';
	moduleSlot: ModuleSlot;
	benchModuleId: string|null;
	workshopId: string|null;
	perks: {raidId:string;stage:number;seed:number;perk:RunPerk}[];
	journal: string[];
	/** A selection of existing people, never a second roster or reserved kit. */
	squadDraft: string[];
	filters: {
		weaponSearch:string;category:WeaponCategory|'all';collection:boolean;
		moduleSearch:string;benchSearch:string;moduleSlot:ModuleSlot|'all';moduleRarity:string;
		roomModuleSearch:string;roomModuleSlot:ModuleSlot|'all';craftForWeapon:boolean;
		contracts:'open'|'done'|'all';
	};
	presentation: unknown;
}
const object = (value:unknown):Record<string,unknown> => value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const choose = <T extends string>(value:unknown,options:readonly T[],fallback:T):T => typeof value==='string'&&options.includes(value as T)?value as T:fallback;
const id = (value:unknown,items:readonly {id:string}[]):string|null => typeof value==='string'&&items.some(item=>item.id===value)?value:null;
const query = (value:unknown) => typeof value==='string'?value.slice(0,160):'';
const slots = MODULE_SLOTS;

/** UI state is a reference to owned gameplay, never a second inventory or clock. */
export function readGameSession(value:unknown,state:GameState):GameSession {
	const source=object(value), valid=source.version===1?source:{}, filters=object(valid.filters);
	const roomId=id(valid.roomId,state.shelter.rooms)??state.shelter.rooms[0]?.id??null;
	let page=choose(valid.page,['home','raids','arsenal','base','contracts','journal','recruits','squad'] as const,'home');
	let view=choose(valid.view,['base','map','raid'] as const,'base');
	const raidId=id(valid.raidId,state.raids), report=state.history.find(item=>item.raidId===valid.raidId);
	const journal=Array.isArray(valid.journal)?valid.journal.filter((item):item is string=>typeof item==='string'&&state.history.some(report=>report.id===item)).slice(0,30):[];
	const squadDraft=Array.isArray(valid.squadDraft)?[...new Set(valid.squadDraft.filter((value):value is string=>typeof value==='string'&&state.scavs.some(scav=>scav.id===value)))].slice(0,3):state.scavs.filter(scav=>scav.status!=='raiding'&&!scav.assignment&&scav.health>=25&&scav.weaponInstanceId).slice(0,2).map(scav=>scav.id);
	if(view==='raid'&&!raidId){view='base';if(report){page='journal';if(!journal.includes(report.id))journal.push(report.id);}}
	const siteSource=object(valid.site);
	const column=siteSource.column,row=siteSource.row;
	const selectableSites=[...getShelterSites(state.shelter),...getShelterFrontier(state.shelter),...state.shelter.expansions];
	const site=typeof column==='number'&&typeof row==='number'&&isShelterSiteCoordinate(column,row)&&selectableSites.some(site=>site.column===column&&site.row===row)&&!state.shelter.rooms.some(room=>room.column===column&&room.row===row)?{column,row}:null;
	let context=choose(valid.context,['overview','room','build'] as const,'overview');
	if(view!=='base'||context==='room'&&!roomId||context==='build'&&!site)context='overview';
	const perks:GameSession['perks']=[];
	if(Array.isArray(valid.perks))for(const raw of valid.perks.slice(0,30)){
		const selected=object(raw), raid=state.raids.find(item=>item.id===selected.raidId), run=raid?.expedition;
		if(!raid||!run||run.status!=='choice'||run.stage!==selected.stage||raid.seed!==selected.seed||typeof selected.perk!=='string'||!Object.hasOwn(RUN_PERKS,selected.perk)||!run.offers.includes(selected.perk as RunPerk)||perks.some(item=>item.raidId===raid.id))continue;
		perks.push({raidId:raid.id,stage:run.stage,seed:raid.seed,perk:selected.perk as RunPerk});
	}
	let presentation:unknown=null;
	try {if(valid.presentation!==null&&typeof valid.presentation==='object'&&JSON.stringify(valid.presentation).length<=48_000)presentation=JSON.parse(JSON.stringify(valid.presentation));}catch{/* Gameplay remains valid if its view state cannot be read. */}
	return {version:1,page,view,mapId:choose(valid.mapId,MAPS.map(map=>map.id),MAPS[0]!.id),weaponId:id(valid.weaponId,state.weapons)??state.weapons[0]?.id??'',scavId:id(valid.scavId,state.scavs),roomId,raidId,context,site,roomTab:choose(valid.roomTab,['staff','production','upgrade'] as const,'staff'),armoryTab:choose(valid.armoryTab,['weapons','bench','modules','equipment','market'] as const,'weapons'),moduleSlot:choose(valid.moduleSlot,slots,'optic'),benchModuleId:id(valid.benchModuleId,state.modules),workshopId:id(valid.workshopId,state.shelter.rooms.filter(room=>room.type==='workshop')),perks,journal,squadDraft,filters:{weaponSearch:query(filters.weaponSearch),category:choose(filters.category,['all','rifle','smg','shotgun','sniper','pistol'] as const,'all'),collection:filters.collection===true,moduleSearch:query(filters.moduleSearch),benchSearch:query(filters.benchSearch),moduleSlot:choose(filters.moduleSlot,['all',...slots],'all'),moduleRarity:choose(filters.moduleRarity,['all',...Object.keys(RARITY_COLORS)],'all'),roomModuleSearch:query(filters.roomModuleSearch),roomModuleSlot:choose(filters.roomModuleSlot,['all',...slots],'optic'),craftForWeapon:filters.craftForWeapon!==false,contracts:choose(filters.contracts,['open','done','all'] as const,'open')},presentation};
}
