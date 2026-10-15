import "./style.css";
import { mountSceneLightControl } from './scene-light-control';
import "./gear-style.css";
import "./module-catalog.css";
import "./achievements.css";
import "./gameplay.css";
import "./raid-strategy.css";
import "./shelter-logistics.css";
import "./flea.css";
import "./boss.css";
import { bossRoster, readBossPreparation, bossRaidProgress, bossReportReceipt } from "./boss-ui";
import "./territory.css";
import "./territory-life.css";
import { createTerritoryLife, type TerritoryLifeController } from "./territory-life";
import { territorySummary, territoryBuildings, territoryPlan, buildingCatalogue, buildingCatalogueReason, buildingPlacementControls, buildingRelocationControls, type BuildingPlacement } from "./territory-ui";
import { getTerritoryPlanPoint } from "./territory-plan-input";
import {
	ATTACHMENT_LABELS,
	CATEGORY_LABELS,
	CONTRACTS,
	MAPS,
	MAP_BY_ID,
	PERSONALITY_BY_ID,
	RARITY_COLORS,
	RARITY_LABELS,
	WEAPONS,
	WEAPON_BY_ID,
	type BaseRoom,
	type Contract,
	type WeaponCategory,
} from "./game/data";
import {
	MAX_ROOM_LEVEL,
	createGame,
	getExpeditionChoices,
	RUN_PERKS,
	GEAR_MODELS,
	MARKET_OFFERS,
	BLUEPRINTS,
	getMarketReason,
	getCargoWeight,
	getCargoValue,
	getGearRecycleYield,
	getWeaponSaleValue,
	getLoadoutStats,
	getGearModel,
	getGearCraftReason,
	getGearRepairCost,
	getSupplyCapacity,
	getRecoveryAllowance,
	getRaidQuote,
	getWeaponRecycleYield,
	getWeaponRole,
	getContractProgress,
	getContractLockReason,
	getAutoRaidStatus,
	getGearCost,
	getIncomePerMinute,
	getRaidPhase,
	getRepairCost,
	getScavCapacity,
	isScavMedicallyReady,
	getStorageCapacity,
	getUpgradeCost,
	getWeaponDefinition,
	getWeaponPower,
	MODULE_SLOTS,
	MODULE_SLOT_LABELS,
	modulePlatformLabel,
	MODULE_MODELS,
	MODULE_BY_ID,
	RECEIVER_INFO,
	getModuleDefinition,
	getModuleEffectiveStats,
	getWeaponStats,
	getWeaponBuildIssues,
	getModuleInstallReason,
	getModuleCapacity,
	getModuleSaleValue,
	getModuleRecycleYield,
	getModuleRepairCost,
	getWeaponDisassembleReason,
	getModuleRemoveReason,
	ROOM_DEFINITIONS,
	RESOURCE_RECIPES,
	getBuildRoomQuote,
	getShelterSites,
	getExcavationQuote,
	getRoomFootprint,
	getShelterRoomAt,
	getRoomPosition,
	getRoomBounds,
	getRoomFacing,
	getShelterRoomAtPoint,
	getRoomFreePlacementReason,
	getFreeBuildRoomQuote,
	getRoomUpgradeQuote,
	getWorkerAssignmentReason,
	getWorkerAffinity,
	getRoomWorkerCapacity,
	getRoomProductionState,
	getResourceProductionQuote,
	getModuleProductionQuote,
	getRecruitCandidateQuote,
	getRecruitmentBoard,
	getRecruitmentRefreshQuote,
	getScavTalentOffers,
	getDismissScavReason,
	xpForLevel,
	type ActionResult,
	type AdvanceSummary,
	type GameState,
	type RaidReport,
	type Scav,
	type WeaponInstance,
	type Raid,
	type ExpeditionBranch,
	type RunPerk,
	type ModuleSlot,
	type ModuleInstance,
	type RoomInstance,
	type ShelterRoomType,
} from "./game/engine";
import { GEAR_LABELS, GEAR_EQUIPMENT_LABELS, MAX_GEAR_LEVEL, TACTICS, type GearSlot, type GearEquipmentSlot, type RaidTactic } from "./game/operations";
import { weaponMechanicsPanel } from "./weapon-mechanics-ui";
import { ammunitionCaliberLabel, ammunitionOptions, ammunitionPanel, ammunitionSnapshot, ammunitionThreat } from "./ammunition-ui";
import { createWorld } from "./scene";
import { gunArt, scavPortrait } from "./art";
import { weaponBuildArt, moduleArt } from "./armory-art";
import { pixelArsenalPreviewUrl } from "./pixel-arsenal-preview";
import { modularWeaponArtFamilies, modularWeaponArtFamily, modularWeaponArtRevision, preloadModularWeaponArt } from "./modular-weapon-art";
import { MODULE_DISPLAY_SLOTS, moduleCatalogPage, moduleFitsWeaponFamily, moduleModelMatches, moduleMountLabel, moduleSlotHint } from "./module-catalog";
import { getResolvedModuleMounts, type ModuleModel } from "./game/modules";
import { scavGearIllustration } from "./scav-gear-art";
import { roomMiniArt } from "./command-art";
import { getCommandSummary, type CommandSummary, type CommandRoomTab, type RoomCommandStatus } from "./command-summary";
import { getGameplayGuidance } from "./gameplay-guidance";
import { gameplayFocus, gameplayRoadmap, scavHealthPanel, updateScavHealthPanels, medicalPackEditor, raidHealthPanel } from "./gameplay-ui";
import { raidPlanEditor, sectorIntelPanel } from "./raid-strategy-ui";
import { getRaidPlan, type RaidObjective, type RaidPreparation } from "./game/engine";
import { FIELD_KITS, getFieldKitStock, getProductionReserve, getFieldKitProductionQuote, type FieldKit, type FieldKitSelection } from "./game/engine";
import { fieldKitStockPanel, productionReserveEditor, readProductionReserveDraft, readRoomStockTargetDraft, roomStockTargetEditor, roomUpgradeRecipeBenefits, shelterRecipeCard, type ReserveDraft } from "./shelter-logistics-ui";
import { MIN_SHELTER_ZOOM, MAX_SHELTER_ZOOM } from "./shelter-camera";
import { getShelterProductionPresentation, getShelterProductionStages, SHELTER_PRODUCTION_STAGES, type ProductionPresentation } from "./shelter-production";
import { projectShelterBounds, projectShelterPoint, shelterRoomPosition } from "./shelter-isometric";
import { renderLiveRaidPanel, updateLiveRaidPanel, getWatchedReport } from "./raid-ui";
import { createAuthoritativeClient } from "./authoritative-client";
import type { GameCommand, GameSnapshot } from "./game/commands";
import { readGameSession, type GameSession } from "./game-session";
import { createGameSound, type GameSoundCue } from "./game-sound";
import { createGameFeedbackCursor, observeGameFeedback, type GameResourceGains } from "./game-feedback";
import { recruitmentPanel, scavRecruitmentPanel } from "./recruitment-ui";
import { scavStoryPanel, scavMemorialPanel } from "./scav-story-ui";
import { getScavPersonalEvent } from "./game/scav-stories";
import { scavRelationsPanel, squadRelationsPanel, roomRelationsPanel, raidRelationsPanel } from "./squad-bonds-ui";
import "./squad-raid.css";
import { squadRaidComposer, squadRaidDecision, squadRaidOngoing, raidRepresentatives } from "./squad-raid-ui";
import {
	getSquadRaidQuote,
	getRaidGroup,
	getRaidGroupKey,
} from "./game/engine";
import { getSquadSocialEvents, getSocialPresentationKey } from "./game/squad-bonds";
import { getAchievementViews, getUnseenAchievementIds } from "./game/achievements";
import { achievementsPanel, achievementNotice, filterAchievementViews, readAchievementFilter, type AchievementFilter } from "./achievements-ui";
import { accountApi, accountErrorMessage, isAccountGoogleFragment, readAccountGoogleResult, type AccountGoogleResult, type AccountUser } from "./account-client";
import { mountAccountUI } from "./account-ui";

import { readAccountEmailLink, isAccountEmailFragment, type AccountEmailLink } from "./account-link";
import { createLiveMode } from "./live-ui";
import { ENTRY_DISTRICTS, multiplayerSelection, type RaidEntrySelection } from "./multiplayer-entry";
import { fleaPage, fleaPricePreview, readFleaOrder, readFleaInteger, raidLootReceipt, raidLootOverflow, raidGearReceipt, raidModulePending, barterConfirmation, type FleaView, type FleaTab, type TradeKindFilter, type LootCatalogGroup } from './flea-ui';
import { getBarterQuote } from './game/barter';
import { getLootUses } from './game/loot-uses';
import { readLootHunt, lootHuntHint, type LootHuntSelection } from './loot-decision-ui';
import { productionLootReceipt, productionRefundLabel, productionOutputSnapshot } from './loot-materials-ui';
import { getTradeInventory, getTradeQuote, LOOT_MODEL_BY_ID } from './game/engine';
import { MARKET_MAX_ACTIVE } from './game/flea';
import './game-theme.css';
import './immersive.css';
import './field-composition.css';
import { mountFieldObjectUI } from './field-object-ui';
import { mountFieldInterface } from './field-ui';

type Page = "home" | "raids" | "arsenal" | "base" | "contracts" | "journal" | "recruits" | "squad" | "achievements" | "flea";
const e = (value: unknown) =>
	String(value).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			]!
	);
const n = (value: number) => Math.floor(value).toLocaleString("ru-RU");
const socialStoriesLabel = (value: number) => {
	const form = value % 100 >= 11 && value % 100 <= 14 ? "историй ждут" : value % 10 === 1 ? "история ждёт" : value % 10 >= 2 && value % 10 <= 4 ? "истории ждут" : "историй ждут";
	return `${n(value)} ${form} ответа`;
};
const seconds = (value: number) =>
	`${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value) % 60)).padStart(2, "0")}`;
const paths: Record<string, string> = {
	home: "M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10",
	raids: "m3 3 7 3 4-3 7 3v15l-7-3-4 3-7-3ZM10 6v15M14 3v15",
	arsenal: "m3 7 8 2 9-1v5H9l-3 7H3l3-8-3-1ZM12 13l3 5h3l-3-5",
	base: "M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l3 3M15.5 15.5l3 3M5.5 18.5l3-3M15.5 8.5l3-3M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
	contracts: "M8 3h8v4H8ZM8 5H5v16h14V5h-3M8 12h8M8 16h5",
	journal: "M4 4h16v16H4ZM8 8h8M8 12h8M8 16h5",
	recruits: "M8 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0M4 21v-3a6 6 0 0 1 12 0v3M19 9v6M16 12h6",
	squad: "M8 9a3 3 0 1 0 0-6 3 3 0 1 0 0 6m9 2a3 3 0 1 0 0-6 3 3 0 1 0 0 6M2 20v-2a6 6 0 0 1 12 0v2m2-6a5 5 0 0 1 6 5v2M9 11l4 2",
	achievements: "M5 3h14v11l-7 7-7-7ZM8 9l3 3 5-6M8 3v3M16 3v3",
	flea: "M3 7h18v4H3ZM5 11v10h14V11M9 21v-6h6v6M5 7l2-4h10l2 4",
	money: "M3 6h18v13H3ZM7 6V4h12v2M15 10h6v5h-6ZM17 12.5h1",
	ammo: "M7 21V7l2-4 2 4v14ZM15 21V7l2-4 2 4v14M7 17h4M15 17h4",
	medicine: "M4 5h16v15H4ZM9 10h6M12 7v6",
	scrap:
		"m9 3-1 4-4 2 2 3-2 4 4 1 1 4h5l1-4 4-1-2-4 2-3-4-2-1-4ZM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
	intel: "M5 20V8h14v12ZM7 8l10-5M9 12h6M9 16h2M16 16h1",
	arrow: "M4 12h16m-6-6 6 6-6 6",
	check: "m5 12 4 4L19 6",
	lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5ZM12 14v3",
	people:
		"M4 21v-2a5 5 0 0 1 10 0v2M5 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M17 4a4 4 0 0 1 0 8M17 14a5 5 0 0 1 4 5v2",
	settings: "M12 3v4M12 17v4M3 12h4M17 12h4M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
	time: "M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20M12 6v6l4 2",
	star: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z",
	armor: "M8 3h8l1 4 4 2-2 10-7 3-7-3L3 9l4-2ZM8 8h8M8 12h8M12 8v9",
	helmet: "M4 14v-3a8 8 0 0 1 16 0v3M3 14h18v3h-6l-2 4h-3l-2-4H3ZM12 4v5M6 17v3M18 17v3",
	backpack: "M8 7V5a4 4 0 0 1 8 0v2M7 7h10l3 4v10H4V11ZM8 14h8v7H8M4 11h16",
	repeat: "M20 8H5l4-4M4 16h15l-4 4M20 8v4M4 16v-4",
	stop: "M5 5h14v14H5Z",
	sound: "M4 9h4l5-4v14l-5-4H4ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14",
};
const icon = (name: string, size = 19) =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.base}"/></svg>`;

const gearLoadoutItemId = (scav: Scav, slot: GearEquipmentSlot) => slot === "armor" ? scav.loadout.armorItemId : slot === "helmet" ? scav.loadout.helmetItemId : scav.loadout.backpackItemId;
const scavHasGear = (scav: Scav, itemId: string) => ["armor", "helmet", "backpack"].some((slot) => gearLoadoutItemId(scav, slot as GearEquipmentSlot) === itemId);


let serverReady = false;

let saveConflict = false;

let gameCommandPending=false;
let authoritative: ReturnType<typeof createAuthoritativeClient>|null=null;
let serverSnapshot: GameSnapshot|null=null;
let connectionMessage="Подключаемся к игровому серверу…";
let saveUiTimer: ReturnType<typeof setTimeout> | null = null;
let accountDialogOpen = false;
let accountChanging = false;
let accountStartupChecked = false;
let accountGeneration = 0;
let signedInUser: AccountUser | null = null;
let playerAccount: AccountUser | null = null;

let pendingAccountEmailLink: AccountEmailLink | null = readAccountEmailLink(window.location.hash);
let invalidAccountEmailLink = isAccountEmailFragment(window.location.hash) && !pendingAccountEmailLink;
let pendingAccountGoogleResult: AccountGoogleResult | null = isAccountGoogleFragment(window.location.hash) ? readAccountGoogleResult(window.location.hash) ?? 'failed' : null;
if (isAccountEmailFragment(window.location.hash) || isAccountGoogleFragment(window.location.hash)) history.replaceState(history.state, '', window.location.pathname + window.location.search);
const uiKey=()=> 'prapor.ui.'+(signedInUser?.id??'guest');
function storedSession(): unknown { try {
    return JSON.parse(localStorage.getItem(uiKey()) ?? 'null');
}
catch {
    return null;
} }
let protectedSave=false;
let state:GameState=createGame();
let offlineSummary:AdvanceSummary|null=null;
let resumedJournal: string[] = [];
let page: Page = "home";
let squadDraft: string[] = [];
let selectedMap = MAPS[0]!.id;
let selectedWeapon = state.weapons[0]?.id ?? "";
let selectedScav: string | null = null;
let inspectorVisible = false;
let roomToolOpen = false;
let showTacticalMap = false;
let selectedRoomId: string | null = state.shelter.rooms[0]?.id ?? null;
let selectedShelterSite: { column: number; row: number } | null = null;
let buildingPlacement: BuildingPlacement | null = null;
let buildingPlacementBusy = false;
let buildingDragPreview: { roomId: string; x: number; y: number; rotation: 0 | 1; reason: string | null; active: boolean } | null = null;
let roomModuleSlot: ModuleSlot | "all" = "optic";
let roomModuleSearch = "";
let contextMode: "overview" | "room" | "build" = "overview";
let roomContextTab: "staff" | "production" | "upgrade" = "staff";
let commandSummarySignature = "";
let commandOrigin: HTMLElement | null = null;
let toolOrigin: HTMLElement | null = null;
let productionWorkshopId: string | null = null;
const chosenWorkers = new Map<string, string>();
const roomRepeatPreferences = new Map<string, boolean>();
let productionReserveDraft: ReserveDraft | null = null;
const roomStockTargetDrafts = new Map<string, string>();
let inspectorOrigin: HTMLElement | null = null;
let modalOrigin: HTMLElement | null = null;
let weaponSearch = "";
let category: WeaponCategory | "all" = "all";
let collection = false;
let arsenalTab: "weapons" | "bench" | "modules" | "equipment" | "market" = "weapons";
let selectedModuleSlot: ModuleSlot = "optic";
let selectedBenchModule: string | null = null;
let moduleSlotFilter: ModuleSlot | "all" = "all";
let moduleRarityFilter: keyof typeof RARITY_LABELS | "all" = "all";
let moduleSearch = "";
let modulePlatformFilter = "all";
let moduleCatalogPageIndex = 0;
let moduleCatalogFilterKey = "";
let benchPartSearch = "";
let moduleCraftForWeapon = true;
const selectedPerks = new Map<string, RunPerk>();
let contractFilter: "open" | "done" | "all" = "open";
let achievementFilter: AchievementFilter = "all";
const fleaView: FleaView = {tab:'inventory',search:'',kind:'all',draft:null,market:null,loading:false,error:'',busy:false};
let lootHunt: LootHuntSelection | null = null;
let barterDraft: {offerId:string;itemIds:string[]} | null = null;
let fleaReadGeneration=0;
let achievementNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let achievementNoticeSchedule: ReturnType<typeof setTimeout> | null = null;
const freshAchievements = new Set<string>();
let deferredRender = false;
let world: ReturnType<typeof createWorld> | null = null;
let territoryLife: TerritoryLifeController | null = null;
let liveMode: ReturnType<typeof createLiveMode> | null = null;
let fieldInterface: ReturnType<typeof mountFieldInterface> | null = null;
let fieldObjects: ReturnType<typeof mountFieldObjectUI> | null = null;
const gameSound = createGameSound();
let toastTimer: ReturnType<typeof setTimeout>;

let worldInputBlockedUntil = 0;
let worldOverlaySignature = "";
let worldView: "base" | "map" | "raid" = "base";
let selectedRaidId: string | null = state.raids[0]?.id ?? null;
let lastWatchedRaid: Raid | null = null;
let lastWatchedReport: RaidReport | null = null;
type WorkerPlacement = { scavId: string; mode: "pointer" | "keyboard"; roomId: string | null; reason: string | null };
type CrewPointer = { scavId: string; pointerId: number; startX: number; startY: number; clientX: number; clientY: number; source: HTMLElement; started: boolean };
let workerPlacement: WorkerPlacement | null = null;
let crewPointer: CrewPointer | null = null;
let suppressWorkerClickUntil = 0;
let workerRefreshTimer: ReturnType<typeof setTimeout> | null = null;
type CameraViewState = { zoom: number; x: number; y: number; panMode: boolean; view?: "base" | "map" | "raid"; following?: boolean; minZoom?: number; maxZoom?: number };
let cameraView: CameraViewState = { zoom: 1, x: 0, y: 0, panMode: false };
const initialSession = readGameSession(storedSession(), state);
let presentationFallback = initialSession.presentation;
applySession(initialSession);
function applySession(session: GameSession) {
	page = session.page; worldView = session.view; selectedMap = session.mapId; squadDraft = session.squadDraft;
	selectedWeapon = session.weaponId; selectedScav = session.scavId; inspectorVisible = Boolean(session.scavId) && (session.inspectorOpen ?? true); selectedRoomId = session.roomId;
	selectedRaidId = session.raidId; lastWatchedRaid = state.raids.find(raid => raid.id === session.raidId) ?? null; lastWatchedReport = null;
	contextMode = session.context; selectedShelterSite = session.site; roomContextTab = session.roomTab;
	arsenalTab = session.armoryTab; selectedModuleSlot = session.moduleSlot; selectedBenchModule = session.benchModuleId; productionWorkshopId = session.workshopId;
	selectedPerks.clear(); for (const item of session.perks) selectedPerks.set(item.raidId,item.perk);
	resumedJournal = session.journal;
	weaponSearch = session.filters.weaponSearch; category = session.filters.category; collection = session.filters.collection;
	moduleSearch = session.filters.moduleSearch; benchPartSearch = session.filters.benchSearch; moduleSlotFilter = session.filters.moduleSlot;
	modulePlatformFilter = "all"; moduleCatalogPageIndex = 0; moduleCatalogFilterKey = "";
	moduleRarityFilter = session.filters.moduleRarity as typeof moduleRarityFilter; roomModuleSearch = session.filters.roomModuleSearch; roomModuleSlot = session.filters.roomModuleSlot;
	moduleCraftForWeapon = session.filters.craftForWeapon; contractFilter = session.filters.contracts;
	achievementFilter = readAchievementFilter(session.filters.achievements);
	fleaView.tab=session.flea.tab; fleaView.search=session.flea.search; fleaView.kind=session.flea.kind; fleaView.barterModelId=session.flea.barterModelId??null; fleaView.catalogGroup=session.flea.catalogGroup??'all'; lootHunt=readLootHunt(session.flea.hunt);
}
function captureSession(): GameSession {
	return readGameSession({version:1,page,view:worldView,mapId:selectedMap,weaponId:selectedWeapon,scavId:selectedScav,inspectorOpen:inspectorVisible,roomId:selectedRoomId,raidId:selectedRaidId,squadDraft,context:contextMode,site:selectedShelterSite,roomTab:roomContextTab,armoryTab:arsenalTab,moduleSlot:selectedModuleSlot,benchModuleId:selectedBenchModule,workshopId:productionWorkshopId,perks:[...selectedPerks].flatMap(([raidId,perk])=>{const raid=state.raids.find(item=>item.id===raidId);return raid?.expedition?[{raidId,perk,stage:raid.expedition.stage,seed:raid.seed}]:[]}),flea:{tab:fleaView.tab,search:fleaView.search,kind:fleaView.kind,barterModelId:fleaView.barterModelId,catalogGroup:fleaView.catalogGroup,...(lootHunt?{hunt:lootHunt}:{})},journal:[...document.querySelectorAll<HTMLDetailsElement>('details[data-report][open]')].map(item=>item.dataset.report),filters:{weaponSearch,category,collection,moduleSearch,benchSearch:benchPartSearch,moduleSlot:moduleSlotFilter,moduleRarity:moduleRarityFilter,roomModuleSearch,roomModuleSlot,craftForWeapon:moduleCraftForWeapon,contracts:contractFilter,achievements:achievementFilter},presentation:world?.getPresentationState() ?? presentationFallback},state);
}
function scheduleSessionSave() {
	if (!serverReady || saveConflict || protectedSave) return;
	if (saveUiTimer !== null) clearTimeout(saveUiTimer);
	saveUiTimer = setTimeout(() => { saveUiTimer = null; persist(); }, 300);
}
function holdWorldInput() { worldInputBlockedUntil = Date.now() + 350; }
function isInspectorOpen() { return inspectorVisible && Boolean(selectedScav) && page === "home"; }
function isContextDialogOpen() { return page === "home" && worldView === "base" && !liveMode?.isActive() && window.innerWidth <= 850 && contextMode !== "overview" && (fieldInterface?.isPanelOpen("dock") ?? true); }
function canWorldDrag() {
	if (buildingPlacement || buildingDragPreview?.active) return false;
	return !liveMode?.isActive() && !accountDialogOpen && !accountChanging && serverReady && !saveConflict && !protectedSave && worldView === "base" && page === "home" && !isInspectorOpen() && !document.querySelector("#modal-root .modal") && !isContextDialogOpen();
}
function canWorldCamera() { return !buildingDragPreview?.active && !liveMode?.isActive() && !accountDialogOpen && !accountChanging && serverReady && !saveConflict && !protectedSave && (canWorldDrag() || ((worldView === "raid" || Boolean(buildingPlacement) && worldView === "base") && page === "home" && !isInspectorOpen() && !document.querySelector("#modal-root .modal"))) && !workerPlacement && !crewPointer; }
function canWorldInteract() {
	return !liveMode?.isActive() && !accountDialogOpen && !accountChanging && serverReady && !saveConflict && !protectedSave && !workerPlacement && !crewPointer?.started && Date.now() >= worldInputBlockedUntil && page === "home" && !isInspectorOpen() && !document.querySelector("#modal-root .modal") && !isContextDialogOpen();
}
function captureInterfacePointer(event: PointerEvent) {
	const target = event.target instanceof Element ? event.target : null;
	if (target && (target.closest("#tool-root, #inspector-root, #modal-root, #command-dock, #context-shade, button, select, input, summary") || target.closest("#world") == null)) holdWorldInput();
}
document.addEventListener("pointerdown", captureInterfacePointer, true);
const app = document.querySelector<HTMLDivElement>("#app")!;
const names: Record<Page, string> = {
	home: "Штаб",
	raids: "Рейд",
	arsenal: "Арсенал",
	base: "База",
	contracts: "Контракты",
	journal: "Журнал",
	recruits: "Найм",
	squad: "Отряд",
	achievements: "Достижения",
	flea: "Барахолка",
};
app.innerHTML = `<div id="save-banner" class="save-banner" role="status" hidden></div><div class="shell command-shell"><header class="topbar command-hud"><div class="command-brand"><span class="brand-mark">П</span><div><strong>ПРАПОР</strong><small>УБЕЖИЩЕ 07</small></div></div><div class="level"><span class="eyebrow">Репутация</span><strong id="level-label"></strong><div class="xp-track"><i id="xp-fill"></i></div></div><div class="resources">${[["money", "Рубли"], ["ammo", "Патроны"], ["medicine", "Медикаменты"], ["scrap", "Материалы"], ["intel", "Разведданные"]].map(([key, label]) => `<div class="resource" title="${label}">${icon(key!,18)}<div><label>${label}</label><strong id="res-${key}"></strong></div><i class="resource-cap" id="cap-${key}"></i></div>`).join("")}</div><button class="settings" data-action="settings" aria-label="Сохранение и помощь">${icon("settings",18)}</button></header><main class="main command-main"><div class="command-toolbar"><div class="command-heading"><h1>Свои люди. Своё убежище.</h1><span><i class="status-dot"></i><span id="passive-note">База на связи</span></span></div><nav class="nav command-tools" aria-label="Инструменты штаба">${(Object.keys(names) as Page[]).map((id) => `<button data-page="${id}" aria-label="${names[id]}" title="${names[id]}">${icon(id,17)}<span>${names[id]}</span>${id === "raids" ? '<b class="badge" id="raid-badge" hidden>0</b>' : id === "squad" ? '<b class="badge" id="squad-badge" hidden>0</b>' : ""}</button>`).join("")}</nav></div><div class="command-stage-layout"><section id="hero" class="hero-grid"><section class="world-card"><div class="world-head"><div class="view-switch" aria-label="Вид сцены"><button class="active" data-view="base" aria-label="Убежище" title="Убежище" aria-pressed="true">${icon("home",14)} Убежище</button><button data-view="map" aria-label="Маршруты отряда" title="Маршруты отряда" aria-pressed="false">${icon("raids",14)} Маршруты</button><button data-view="raid" aria-label="Задание отряда" title="Задание отряда" aria-pressed="false" disabled>${icon("people",14)} Задание</button></div><button class="text-button room-index-button" data-page="base">${icon("base",14)} База</button><span class="world-coordinate mono">БАЗА 07 · СЕВЕР</span></div><div id="world" aria-label="Территория базы: постройки, двор и рабочие"></div><div class="world-bottom"><span><i class="status-dot"></i><span id="scene-hint">Выбери постройку, свободную землю или бойца</span></span><span id="world-raid-note">ОТРЯД НА БАЗЕ</span></div><div class="room-shortcuts" hidden></div></section></section><aside id="command-dock" class="command-dock" aria-label="Сводка и управление выбранным объектом"></aside></div><section id="command-crew" class="command-crew" aria-label="Отряд и рабочие"></section><section id="command-routes" class="command-routes" aria-label="Рейды и сектора"></section><div id="offline-summary"></div><footer class="footer-line command-footer"><span id="save-status">ПРОГРЕСС НА ЭТОМ УСТРОЙСТВЕ</span><span>ПРАПОР · 0.15.0</span></footer></main></div><div id="tool-root" class="tool-backdrop" hidden><section class="tool-window" role="region" aria-labelledby="tool-title"><header class="tool-head"><div id="page-head" class="page-head"></div><button class="icon-button" data-action="close-tools" aria-label="Закрыть инструмент и вернуться в штаб">×</button></header><div class="tool-scroll"><div id="expedition-alerts"></div><div id="panel"></div></div></section></div><div id="context-shade" class="context-shade" hidden></div><div id="toast" role="status" aria-live="polite" hidden></div><div id="inspector-root"></div><div id="modal-root"></div>`;
const panel = document.querySelector<HTMLDivElement>("#panel")!;
document.querySelector<HTMLButtonElement>('.nav [data-page="achievements"]')!.insertAdjacentHTML('beforeend', '<b class="badge" id="achievement-badge">0/12</b>');
app.insertAdjacentHTML('beforeend', '<aside id="achievement-notice" class="achievement-notice" aria-label="Новая нашивка" hidden></aside>');
document.querySelector(".command-footer")!.prepend(document.querySelector("#offline-summary")!);
document.querySelector(".world-head .view-switch")!.insertAdjacentHTML("afterend", '<div class="camera-controls" role="group" aria-label="Вид убежища"><button data-camera="out" aria-label="Отдалить убежище" title="Отдалить (−)">−</button><span id="camera-scale" class="camera-scale" aria-label="Масштаб">100%</span><button data-camera="in" aria-label="Приблизить убежище" title="Приблизить (+)">+</button><button data-camera="fit" class="camera-fit" aria-label="Обзор всего убежища" title="Обзор всего убежища (0)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 9V3h6m6 0h6v6m0 6v6h-6M9 21H3v-6"/></svg><span>Обзор</span></button><button data-camera="pan" aria-label="Рука: перемещать вид" title="Рука: перетаскивать убежище" aria-pressed="false"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 4-3 7-7 7h-1c-2 0-4-1-5-3L3 12a2 2 0 0 1 3-2l2 2"/></svg></button></div>');
const worldViewport = document.querySelector<HTMLElement>("#world")!;
mountSceneLightControl(document.querySelector('.world-head')!);
worldViewport.insertAdjacentHTML("afterend", '<div id="live-world" aria-label="Общий онлайн-периметр" hidden></div>');
document.querySelector(".world-head .view-switch")!.insertAdjacentHTML("beforeend", '<button data-view="live" aria-label="Автоматический рейд" title="Общий Периметр · автобаттлер" aria-pressed="false"><span class="live-tab-dot" aria-hidden="true"></span> Рейд · автобой</button>');
document.querySelector('.camera-controls [data-camera="fit"]')!.insertAdjacentHTML("beforebegin", `<button data-camera="near" class="camera-fit camera-near" aria-label="Рабочий вид базы" title="Рабочий вид базы: ближе к постройкам">${icon("base",15)}<span>К постройкам</span></button>`);
document.querySelector(".world-head")!.insertAdjacentHTML("beforeend", `<button class="scene-sound" data-action="toggle-sound" aria-label="Звуки игры" aria-pressed="false" title="Включить звуки игры">${icon("sound",17)}<span>Звук</span></button>`);
worldViewport.insertAdjacentHTML("afterend", '<div id="scene-hover" class="scene-hover" hidden><strong></strong><span></span></div>');
fieldInterface = mountFieldInterface({
	root: app, icon,
	getState: () => ({ view: liveMode?.isActive() ? "live" : worldView, context: `${contextMode}:${selectedRoomId ?? ""}:${selectedShelterSite?.column ?? ""}:${selectedShelterSite?.row ?? ""}`, status: serverReady ? "Прогресс на сервере" : connectionMessage }),
	closeContext: closeCommandContext,
	onVisibilityChange: () => setOverlayState(),
	onError: message => toast(message, false),
});
const utilityRail = document.querySelector<HTMLElement>(".command-tools")!;
utilityRail.insertAdjacentHTML("beforeend", `<button data-mission-board aria-label="Задания отряда" title="Задания отряда">${icon("people", 17)}<span>Задания</span></button>`);
utilityRail.append(document.querySelector(".scene-light-control")!, document.querySelector(".scene-sound")!, document.querySelector(".settings")!, document.querySelector('[data-action="toggle-fullscreen"]')!);
utilityRail.querySelector(".settings")!.insertAdjacentHTML("beforeend", "<span>Помощь</span>");
utilityRail.querySelector('[data-action="toggle-fullscreen"]')!.insertAdjacentHTML("beforeend", "<span>Экран</span>");
app.append(utilityRail);
mainFieldLayer();
function mainFieldLayer() {
 const layer = document.createElement("div"); layer.id = "field-object-layer";
 document.querySelector(".command-main")!.append(layer);
 fieldObjects = mountFieldObjectUI({ root: layer, getState: () => state,
  projectRoom: room => world?.projectShelterRect(getRoomBounds(room)) ?? null,
  projectScav: id => world?.projectScav(id) ?? null,
  onRoomDetails: (id, tab) => openShelterRoom(id, tab),
  onScavDetails: (id, tab) => { openInspector(id); if (tab === "orders") { const orders = document.querySelector<HTMLDetailsElement>(".inspector .order-section"); if (orders) { orders.open = true; orders.scrollIntoView({ block: "nearest" }); } } },
  insets: () => window.innerWidth <= 640 ? { top: 128, left: 8, right: 8, bottom: 170 } : window.innerHeight <= 540 ? { top: 100, left: 108, right: 14, bottom: 80 } : { top: 110, left: 84, right: 14, bottom: 110 },
 });
}
function updateSceneHover(value: { title: string; detail: string } | null) {
	const readout = document.querySelector<HTMLElement>("#scene-hover"); if (!readout) return;
	readout.hidden = !value || !canWorldInteract() || Boolean(workerPlacement || crewPointer);
	if (readout.hidden || !value) return;
	readout.querySelector("strong")!.textContent = value.title;
	readout.querySelector("span")!.textContent = value.detail;
}
function updateSoundControl() {
	const button = document.querySelector<HTMLButtonElement>(".scene-sound"); if (!button) return;
	button.setAttribute("aria-pressed", String(gameSound.enabled));
	button.title = gameSound.enabled ? "Выключить звуки игры" : "Включить звуки игры";
	button.classList.toggle("active", gameSound.enabled);
}
async function toggleGameSound() {
	await gameSound.setEnabled(!gameSound.enabled);
	updateSoundControl();
	if (gameSound.enabled) gameSound.play("confirm");
}
function resumeSoundOnGesture(event: Event) {
	if (!event.isTrusted || !gameSound.enabled || event.target instanceof Element && event.target.closest('[data-action="toggle-sound"]')) return;
	void gameSound.setEnabled(true).then(updateSoundControl);
}
document.addEventListener("pointerdown", resumeSoundOnGesture, true);
document.addEventListener("pointerup", resumeSoundOnGesture, true);
document.addEventListener("keydown", resumeSoundOnGesture, true);
updateSoundControl();
worldViewport.tabIndex = 0;
worldViewport.setAttribute("role", "region");
worldViewport.setAttribute("aria-describedby", "camera-help");
worldViewport.insertAdjacentHTML("afterend", '<p id="camera-help" class="visually-hidden">Вид убежища: плюс и минус меняют масштаб, ноль возвращает обзор, стрелки сдвигают вид. Рука позволяет перетаскивать убежище. Чтобы назначить бойца, перетащи его портрет или выбери комнату с клавиатуры.</p>');
document.querySelector(".world-card")!.insertAdjacentHTML("beforeend", '<div id="worker-room-targets" class="worker-room-targets" role="group" aria-label="Выбери рабочую комнату" hidden></div><div id="worker-placement" class="worker-placement" hidden><div><strong id="worker-placement-title"></strong><span id="worker-placement-hint"></span></div><button class="icon-button" data-worker-cancel aria-label="Отменить назначение">×</button></div>');
document.querySelector(".world-card")!.insertAdjacentHTML("beforeend", '<div id="building-drag-status" class="building-drag-status" role="status" hidden></div><div id="building-placement" class="building-placement" role="group" aria-label="Размещение постройки" hidden></div>');
app.insertAdjacentHTML("beforeend", '<div id="worker-drag-ghost" class="worker-drag-ghost" aria-hidden="true" hidden></div><div id="worker-drop-status" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></div>');
const costLabel = (cost: { money: number; scrap: number }) =>
	`${n(cost.money)} ₽ · ${cost.scrap} дет.`;
function updateCameraControls() {
	const controls = document.querySelector<HTMLElement>(".camera-controls"); if (!controls) return;
	if (liveMode?.isActive()) {
		controls.hidden = true;
		document.querySelector(".world-coordinate")!.textContent = "ПЕРИМЕТР 01 · АВТОБАТТЛЕР";
		document.querySelector("#scene-hint")!.textContent = "Потяни карту для обзора · колесо — масштаб";
		document.querySelector("#world-raid-note")!.textContent = "БОЕЦ ДЕЙСТВУЕТ САМ";
		return;
	}
	controls.hidden = worldView === "map";
	controls.setAttribute("aria-label", worldView === "raid" ? "Вид улицы" : "Вид убежища");
	worldViewport.setAttribute("aria-label", worldView === "raid" ? "Уличный рейд: движение бойца, укрытия и поиск" : "Территория базы: постройки, двор и рабочие");
	const help = document.querySelector<HTMLElement>("#camera-help"); if (help) help.textContent = worldView === "raid" ? "Уличный рейд: плюс и минус меняют масштаб, ноль возвращает следование за бойцом, стрелки сдвигают вид. Перетаскивай улицу мышью или пальцем. Выбор бойца, события и приказы находятся рядом со сценой." : "Вид убежища: плюс и минус меняют масштаб, ноль возвращает обзор, стрелки сдвигают вид. Рука позволяет перетаскивать убежище. Чтобы назначить бойца, перетащи его портрет или выбери комнату с клавиатуры.";
	const coordinate = document.querySelector<HTMLElement>(".world-coordinate"); if (coordinate) coordinate.textContent = worldView === "raid" ? `ЗА ПЕРИМЕТРОМ · ЭТАП ${watchedRaid()?.expedition?.stage ?? 1}` : "БАЗА 07 · СЕВЕР";
	const available = canWorldCamera();
	controls.querySelectorAll<HTMLButtonElement>("[data-camera]").forEach((button) => { button.disabled = !available; });
	const farther = controls.querySelector<HTMLButtonElement>('[data-camera="out"]'), closer = controls.querySelector<HTMLButtonElement>('[data-camera="in"]');
	if (farther) farther.disabled = !available || cameraView.zoom <= (cameraView.minZoom ?? MIN_SHELTER_ZOOM) + 0.001;
	if (closer) closer.disabled = !available || cameraView.zoom >= (cameraView.maxZoom ?? MAX_SHELTER_ZOOM) - 0.001;
	const fit = controls.querySelector<HTMLButtonElement>('[data-camera="fit"]');
	const near = controls.querySelector<HTMLButtonElement>('[data-camera="near"]'); if (near) near.hidden = worldView !== "base";
	if (fit) { fit.innerHTML = `${icon(worldView === "raid" ? "people" : "home", 13)} <span>${worldView === "raid" ? "За бойцом" : "Обзор"}</span>`; fit.setAttribute('aria-label', worldView === "raid" ? "Следовать за бойцом" : "Обзор всего убежища"); fit.title = worldView === "raid" ? "Следовать за бойцом (0)" : "Обзор всего убежища (0)"; }
	if (farther) farther.setAttribute('aria-label', worldView === "raid" ? "Отдалить улицу" : "Отдалить убежище");
	if (closer) closer.setAttribute('aria-label', worldView === "raid" ? "Приблизить улицу" : "Приблизить убежище");
	controls.querySelector<HTMLButtonElement>('[data-camera="pan"]')?.setAttribute("aria-pressed", String(cameraView.panMode));
	const panButton = controls.querySelector<HTMLButtonElement>('[data-camera="pan"]'); if (panButton) panButton.title = "Рука: перемещать вид. Можно удерживать пробел";
	controls.querySelector<HTMLButtonElement>('[data-camera="pan"]')?.classList.toggle("active", cameraView.panMode);
	document.querySelector(".world-card")?.classList.toggle("camera-hand-mode", cameraView.panMode);
	document.querySelector("#camera-scale")!.textContent = `${Math.round(cameraView.zoom * 100)}%`;
	document.querySelector("#scene-hint")!.textContent = worldView === "raid" ? cameraView.panMode ? "Осмотри улицу · За бойцом — вернуть камеру" : "Живой маршрут · Рука — осмотр улицы" : worldView === "map" ? "Нажми на сектор, чтобы выбрать маршрут" : cameraView.panMode ? "Перетаскивай вид · Обзор — вся база" : "Перетаскивай постройки по двору · за оградой — расширение";
	document.querySelector('.world-card')?.classList.toggle('raid-view', worldView === "raid");
	document.querySelector('.command-main')?.classList.toggle('raid-watching', worldView === "raid");
	const raidTab = document.querySelector<HTMLButtonElement>('[data-view="raid"]'); if (raidTab) raidTab.disabled = !state.raids.length && !lastWatchedRaid;
}
function onWorldCameraChange(value: CameraViewState) {
	if (value.view && value.view !== worldView) return;
	cameraView = value;
	updateCameraControls();
	positionWorkerRoomTargets();
	scheduleSessionSave();
}
function cameraAction(action: string) {
	if (!canWorldCamera() || !world) return;
	if (action === "in") world.zoomBy(1.25);
	else if (action === "out") world.zoomBy(0.8);
	else if (action === "fit") { world.setPanMode(false); world.resetCamera(); }
	else if (action === "near" && worldView === "base") { world.setPanMode(false); world.focusBase(); }
	else if (action === "pan") world.setPanMode(!cameraView.panMode);
	if (worldView === "raid" && action === "fit") world.setRaidFollow(true);
	holdWorldInput();
}
function inspectRoomView(id: string) {
	if (!state.shelter.rooms.some((room) => room.id === id)) return;
	cancelWorkerPlacement();
	if (window.innerWidth <= 850) closeCommandContext();
	setView("base");
	world?.setPanMode(false);
	world?.focusRoom(id);
	worldViewport.focus({ preventScroll: true });
	revealAssignmentControl(worldViewport);
	holdWorldInput();
}
function persist(): boolean {
    try {
        localStorage.setItem(uiKey(), JSON.stringify(captureSession()));
    }
    catch { /* UI preferences do not own gameplay. */ }
    document.querySelector('#save-status')!.textContent = serverSnapshot ? 'ПРОГРЕСС НА СЕРВЕРЕ · РЕВИЗИЯ ' + serverSnapshot.revision : 'ПОДКЛЮЧЕНИЕ К СЕРВЕРУ';
    if (serverReady)
        scheduleAchievementNotice();
    return Boolean(serverSnapshot);
}
function updateSaveBanner() {
    const banner = document.querySelector<HTMLElement>('#save-banner');
    if (!banner)
        return;
    banner.hidden = Boolean(serverReady && authoritative?.isReady()) || Boolean(liveMode?.isActive());
    if (!banner.hidden)
        banner.innerHTML = '<p>' + e(connectionMessage) + '</p><div><button class="button secondary" data-action="reconnect-server">Подключиться снова</button><button class="button ghost" data-open-live>Лайв · онлайн</button></div>';
}
function storedProgressChanged(): boolean { return false; }
function startServerSession() { if (accountStartupChecked)
    return; accountStartupChecked = true; void initializeAccount(); }
function flushAndReleaseSave() { persist(); }
function applyServerSnapshot(snapshot: GameSnapshot) {
    const oldStatus = rosterStatus(), oldShelter = shelterStatus(), oldAchievements = achievementPresentationKey();
    const oldInventory = inventoryPresentationKey();
    const oldLevel = state.level, oldContracts = readyContracts(), oldWeapons = state.weapons.map(w => w.id).join('|');
    serverSnapshot = snapshot;
    state = snapshot.state;
    serverReady = true;
    saveConflict = false;
    protectedSave = false;
    updateGameFeedback();
    hud();
    persist();
    updateSaveBanner();
    setOverlayState();
    if (oldStatus !== rosterStatus() || oldShelter !== shelterStatus() || oldAchievements !== achievementPresentationKey() || oldInventory !== inventoryPresentationKey() || oldLevel !== state.level || oldContracts !== readyContracts() || oldWeapons !== state.weapons.map(w => w.id).join('|'))
        refreshAfterAdvance();
    if (!liveMode?.isActive() && worldView === 'raid') {
        const raid = watchedRaid();
        if (raid)
            updateLiveRaidPanel(document.querySelector<HTMLElement>('#command-dock')!, raid, watchedReport(), state);
    }
}
async function gameAction(command: GameCommand): Promise<ActionResult> {
    if (!authoritative || !serverReady)
        return { ok: false, message: 'Нет подтверждённой связи с игровым сервером.' };
    if (gameCommandPending)
        return { ok: false, message: 'Сервер ещё обрабатывает предыдущий приказ.' };
    gameCommandPending = true;
    try {
        return await authoritative.action(command);
    }
    catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Связь прервалась. Приказ не повторён автоматически.' };
    }
    finally {
        gameCommandPending = false;
        fleaView.market = null;
        if(page==='flea')void refreshFleaMarket();
    }
}
async function refreshFleaMarket() {
    if (!authoritative || !serverReady || fleaView.loading) return;
    const generation=fleaReadGeneration, identity=serverSnapshot?.identity.id;
    fleaView.loading=true; fleaView.error='';
    if(page==='flea')render();
    try {
        const market=await authoritative.market();
        if(generation!==fleaReadGeneration||market.identity.id!==identity)return;
        fleaView.market=market;
    } catch(error) {
        if(generation!==fleaReadGeneration)return;
        fleaView.market=null;
        fleaView.error=error instanceof Error?error.message:'Нет связи с барахолкой.';
    } finally {
        if(generation===fleaReadGeneration){fleaView.loading=false;if(page==='flea')render();}
    }
}
function updateFleaDraftPreview() {
    if(!fleaView.draft)return;
    const preview=panel.querySelector<HTMLElement>('[data-flea-preview]');
    if(preview)preview.innerHTML=fleaPricePreview(state,fleaView);
    const order=readFleaOrder(state,fleaView.draft), active=fleaView.market?.mine.filter(offer=>offer.status==='active').length??0;
    const reason=!order?'Количество — целое от 1 до 10 000, цена — от 1 до 1 000 000 ₽.':active>=MARKET_MAX_ACTIVE?`Одновременно можно разместить ${MARKET_MAX_ACTIVE} лотов.`:order.reason;
    const submit=panel.querySelector<HTMLButtonElement>('[data-action="flea-list"]');
    if(submit)submit.disabled=gameCommandPending||fleaView.loading||!fleaView.market||Boolean(reason);
    const note=panel.querySelector<HTMLElement>('[data-flea-order-reason]');
    if(note)note.textContent=reason??(!fleaView.market?'Сначала обнови барахолку.':'Лот разместится после нажатия.');
    const guide=panel.querySelector<HTMLElement>('.flea-guide strong'), quantity=readFleaInteger(fleaView.draft.quantity,10_000), quote=quantity===null?null:getTradeQuote(state,{...fleaView.draft.ref,quantity});
    if(guide)guide.textContent=quote?.asset?`${n(quote.guidePrice)} ₽`:'—';
    const useGuide=panel.querySelector<HTMLButtonElement>('[data-action="flea-use-guide"]');
    if(useGuide)useGuide.disabled=!quote?.asset;
}
async function refreshServerProgress(): Promise<boolean> {
    try {
        await authoritative?.poll();
        return Boolean(authoritative?.isReady());
    }
    catch {
        return false;
    }
}
async function loadServerProgress() {
    world?.cancelBuildingDrag();
    cancelBuildingPlacement();
    if (!authoritative)
        return;
    productionReserveDraft = null;
    roomStockTargetDrafts.clear();
    fleaReadGeneration++; fleaView.market=null; fleaView.draft=null; fleaView.barterModelId=null; fleaView.catalogGroup='all'; fleaView.receivedGearId=null; lootHunt=null; barterDraft=null; fleaView.loading=false; fleaView.error='';
    const presentation = storedSession();
    serverReady = false;
    serverSnapshot = null;
    connectionMessage = 'Подключаем проверенный серверный прогресс…';
    updateSaveBanner();
    setOverlayState();
    authoritative.resetIdentity();
    try {
        const snapshot = await authoritative.join();
        const session = readGameSession(presentation, snapshot.state);
        applySession(session);
        presentationFallback = session.presentation;
        render();
        setView(worldView);
        world?.selectRaid(selectedRaidId);
        world?.restorePresentationState(session.presentation);
        persist();
        connectionMessage = 'Прогресс подтверждён сервером.';
        if(page==='flea')void refreshFleaMarket();
    }
    catch (error) {
        connectionMessage = error instanceof Error ? error.message : 'Игровой сервер недоступен. Повтори подключение.';
    }
    finally {
        updateSaveBanner();
        setOverlayState();
    }
}
async function connectAccount(user: AccountUser, _source: 'login' | 'register' | 'session') {
    if (accountChanging)
        throw new Error('account-operation-pending');
    accountGeneration++;
    accountChanging = true;
    signedInUser = user;
    playerAccount = user;
    accountUI.setUser(user);
    liveMode?.resetIdentity();
    cancelWorkerPlacement();
    closeModal();
    closeInspector();
    dismissAchievementNotice();
    freshAchievements.clear();
    try {
        await loadServerProgress();
        accountUI.setStatus('Прогресс и все игровые действия сохраняет сервер.', 'success');
    }
    finally {
        accountChanging = false;
        setOverlayState();
        showPendingAccountEmailLink();
    }
}
async function initializeAccount() {
    const epoch = accountGeneration;
    accountChanging = true;
    setOverlayState();
    try {
        const { user, emailEnabled, googleEnabled } = await accountApi.session();
        if (epoch !== accountGeneration)
            return;
        accountUI.setEmailEnabled(emailEnabled);
        accountUI.setGoogleEnabled(googleEnabled);
        signedInUser = user;
        playerAccount = user;
        accountUI.setUser(user);
        await loadServerProgress();
        accountUI.setStatus(user ? 'Аккаунт подключён. Прогресс принадлежит серверу.' : 'Гостевой прогресс хранится на сервере. Для игры с другого устройства войди в аккаунт.');
    }
    catch (error) {
        connectionMessage = accountErrorMessage(error);
        accountUI.setStatus(connectionMessage, 'warning');
    }
    finally {
        accountChanging = false;
        updateSaveBanner();
        setOverlayState();
        showPendingAccountEmailLink();
    }
}

function showPendingAccountEmailLink() {
	if (accountChanging) return;
	if (pendingAccountGoogleResult) {
		const result = pendingAccountGoogleResult; pendingAccountGoogleResult = null;
		accountUI.handleGoogleResult(result);
	}
	if (pendingAccountEmailLink) {
		const link = pendingAccountEmailLink; pendingAccountEmailLink = null;
		accountUI.handleEmailLink(link.kind, link.token);
	} else if (invalidAccountEmailLink) {
		invalidAccountEmailLink = false;
		accountUI.open(); toast('Ссылка из письма неполная. Запроси новое письмо в аккаунте.', false);
	}
}

function captureAccountEmailLink() {
	if (isAccountGoogleFragment(window.location.hash)) {
		pendingAccountGoogleResult = readAccountGoogleResult(window.location.hash) ?? 'failed';
		history.replaceState(history.state, '', window.location.pathname + window.location.search);
		if (!accountChanging) void initializeAccount();
		return;
	}
	if (!isAccountEmailFragment(window.location.hash)) return;
	pendingAccountEmailLink = readAccountEmailLink(window.location.hash);
	invalidAccountEmailLink = !pendingAccountEmailLink;
	history.replaceState(history.state, '', window.location.pathname + window.location.search);
	showPendingAccountEmailLink();
}

function updateAccountProfile(user: AccountUser) {
	if (signedInUser?.id === user.id) signedInUser = user;
	if (playerAccount?.id === user.id) playerAccount = user;
}

function revokeAccountSession() { accountGeneration++; signedInUser = null; playerAccount = null; accountUI.setUser(null); liveMode?.resetIdentity(); void loadServerProgress(); }

function toast(message: string, ok = true) {
	const node = document.querySelector<HTMLDivElement>("#toast")!;
	clearTimeout(toastTimer);
	node.textContent = message;
	node.className = `toast ${ok ? "" : "error"}`;
	node.hidden = false;
	toastTimer = setTimeout(() => {
		node.hidden = true;
	}, 6000);
}
function dismissAchievementNotice(restoreFocus = false) {
	if (achievementNoticeTimer !== null) clearTimeout(achievementNoticeTimer);
	if (achievementNoticeSchedule !== null) clearTimeout(achievementNoticeSchedule);
	achievementNoticeTimer = null; achievementNoticeSchedule = null;
	const node = document.querySelector<HTMLElement>('#achievement-notice');
	const focused = restoreFocus && node?.contains(document.activeElement);
	if (node) { node.hidden = true; node.innerHTML = ''; }
	if (focused) document.querySelector<HTMLButtonElement>('.nav [data-page="achievements"]')?.focus({ preventScroll: true });
}
function updateAchievementBadge() {
	const views = getAchievementViews(state), count = views.filter(view => view.unlocked).length;
	const unseen = getUnseenAchievementIds(state).length;
	const badge = document.querySelector<HTMLElement>('#achievement-badge');
	if (badge) { badge.textContent = `${count}/${views.length}`; badge.classList.toggle('has-new', unseen > 0); }
	document.querySelector<HTMLButtonElement>('.nav [data-page="achievements"]')?.setAttribute('aria-label', `Достижения: ${count} из ${views.length}${unseen ? `, новых: ${unseen}` : ''}`);
}
async function acknowledgeAchievementScreen() {
	if (page !== 'achievements' || !serverReady || saveConflict || protectedSave || document.hidden) return;
	const unseen = new Set(getUnseenAchievementIds(state));
	const ids = filterAchievementViews(getAchievementViews(state), achievementFilter).filter(view => view.unlocked && unseen.has(view.id)).map(view => view.id);
	if (ids.length) await gameAction({ type: "markAchievementsSeen", args: [ids] });
	updateAchievementBadge();
}
function scheduleAchievementNotice() {
	if (achievementNoticeSchedule !== null || !getUnseenAchievementIds(state).length) return;
	achievementNoticeSchedule = setTimeout(async () => {
		achievementNoticeSchedule = null;
		if (document.hidden || !serverReady || saveConflict || protectedSave || accountChanging || accountDialogOpen || isInspectorOpen() || document.querySelector<HTMLElement>('.field-object-card')?.hidden === false || document.querySelector('#modal-root .modal') || (page !== 'home' && page !== 'achievements')) return;
		const ids = getUnseenAchievementIds(state);
		if (!ids.length) return;
		for (const id of ids) freshAchievements.add(id);
		if (page === 'achievements') {
			if (achievementFilter === 'active') return;
			render(); acknowledgeAchievementScreen(); persist(); return;
		}
		const node = document.querySelector<HTMLElement>('#achievement-notice');
		if (!node) return;
		node.innerHTML = achievementNotice(getAchievementViews(state).filter(view => ids.includes(view.id)));
		node.hidden = false;
		if (!node.innerHTML) return;
		// A notice is seen only after it is rendered on the visible, owned game.
		await gameAction({ type: "markAchievementsSeen", args: [ids] }); updateAchievementBadge(); persist();
		if (achievementNoticeTimer !== null) clearTimeout(achievementNoticeTimer);
		achievementNoticeTimer = setTimeout(() => { achievementNoticeTimer = null; if (!node.contains(document.activeElement)) node.hidden = true; }, 12_000);
	}, 400);
}
function workerPickReason(id: string) {
	const reason = getWorkerAssignmentReason(state, id, null);
	if (reason) return reason;
	const scav = state.scavs.find((person) => person.id === id)!;
	return !isScavMedicallyReady(scav) ? scav.medicalTreatment ? "Боец проходит курс лечения." : "Бойцу нужно восстановить здоровье и подвижность." : null;
}
function announceWorkerPlacement(message: string) {
	const status = document.querySelector<HTMLElement>("#worker-drop-status");
	if (status && status.textContent !== message) status.textContent = message;
}
function queueDeferredWorkerRefresh() {
	if (!deferredRender || workerRefreshTimer != null) return;
	workerRefreshTimer = setTimeout(() => {
		workerRefreshTimer = null;
		if (deferredRender && !interacting()) render();
	}, 0);
}
function releaseCrewPointer() {
	const gesture = crewPointer;
	crewPointer = null;
	if (gesture?.source.hasPointerCapture(gesture.pointerId)) gesture.source.releasePointerCapture(gesture.pointerId);
	queueDeferredWorkerRefresh();
	updateCameraControls();
}
function clearWorkerPlacement() {
	workerPlacement = null;
	for (const id of ["worker-placement", "worker-room-targets", "worker-drag-ghost"]) { const node = document.getElementById(id); if (node) node.hidden = true; }
	document.body.classList.remove("placing-worker");
	document.querySelectorAll(".crew-chip.is-dragging").forEach((node) => node.classList.remove("is-dragging"));
	queueDeferredWorkerRefresh();
	updateCameraControls();
}
function focusWorkerHandle(id: string) {
	const handle = document.querySelector<HTMLButtonElement>(`#command-crew [data-worker-handle="${CSS.escape(id)}"]`);
	handle?.focus({ preventScroll: true });
	if (handle) revealAssignmentControl(handle);
}
function revealAssignmentControl(control: HTMLElement) {
	const main = document.querySelector<HTMLElement>(".command-main");
	if (!main || main.scrollHeight <= main.clientHeight + 1 || getComputedStyle(main).overflowY !== "auto") return;
	const viewport = main.getBoundingClientRect(), target = control.getBoundingClientRect();
	if (target.top < viewport.top || target.bottom > viewport.bottom) control.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
}
function cancelWorkerPlacement(restoreFocus = false, announce = false) {
	const id = workerPlacement?.scavId ?? crewPointer?.scavId;
	const active = Boolean(workerPlacement || crewPointer);
	releaseCrewPointer();
	clearWorkerPlacement();
	world?.cancelScavDrag();
	if (active) { holdWorldInput(); suppressWorkerClickUntil = Date.now() + 450; }
	if (announce && active) announceWorkerPlacement("Назначение отменено.");
	if (restoreFocus && id && canWorldDrag()) focusWorkerHandle(id);
}
function paintWorkerPlacement() {
	if (!workerPlacement) return;
	const scav = state.scavs.find((item) => item.id === workerPlacement!.scavId);
	if (!scav) { cancelWorkerPlacement(); return; }
	const room = state.shelter.rooms.find((item) => item.id === workerPlacement!.roomId);
	const title = `${scav.name} → ${room ? ROOM_DEFINITIONS[room.type].label : "рабочее место"}`;
	const hint = workerPlacement.reason ?? (room ? scav.assignment === room.id ? "Уже работает здесь" : `Подходит: ${Math.round(getWorkerAffinity(scav, room.type))} / 100 · ${workerPlacement.mode === "keyboard" ? "Enter — назначить" : "отпусти, чтобы назначить"}` : workerPlacement.mode === "keyboard" ? "Выбери комнату · Tab — перейти · Esc — отменить" : "Перенеси в рабочую комнату · Esc — отменить");
	const banner = document.querySelector<HTMLElement>("#worker-placement")!;
	banner.hidden = false; banner.classList.toggle("blocked", Boolean(workerPlacement.reason));
	document.querySelector("#worker-placement-title")!.textContent = title;
	document.querySelector("#worker-placement-hint")!.textContent = hint;
	document.body.classList.add("placing-worker");
	document.querySelector<HTMLElement>(`#command-crew [data-worker-card="${CSS.escape(scav.id)}"]`)?.classList.add("is-dragging");
	announceWorkerPlacement(`${title}. ${hint}`);
	updateCameraControls();
	const ghost = document.querySelector<HTMLElement>("#worker-drag-ghost")!;
	ghost.hidden = !crewPointer?.started;
	if (crewPointer?.started) {
		if (ghost.dataset.scav !== scav.id) { ghost.dataset.scav = scav.id; ghost.innerHTML = `<span class="crew-portrait">${scavPortrait(scav.personality, scav.name, scav.appearance)}</span><span><strong>${e(scav.name)}</strong><small></small></span>`; }
		ghost.querySelector("small")!.textContent = room ? workerPlacement.reason ?? ROOM_DEFINITIONS[room.type].label : "Выбери комнату";
		ghost.classList.toggle("blocked", Boolean(workerPlacement.reason));
		ghost.style.left = `${Math.max(8, Math.min(window.innerWidth - 194, crewPointer.clientX + 16))}px`;
		ghost.style.top = `${Math.max(8, Math.min(window.innerHeight - 66, crewPointer.clientY - 70))}px`;
	}
}
function onWorldDragState(value: { scavId: string; roomId: string | null; reason: string | null } | null) {
	if (!value) {
		if (workerPlacement?.mode === "pointer" || crewPointer?.started) {
			if (workerPlacement?.reason) announceWorkerPlacement(`${workerPlacement.reason} Назначение не изменено.`);
			releaseCrewPointer(); holdWorldInput(); suppressWorkerClickUntil = Date.now() + 450;
		}
		clearWorkerPlacement(); return;
	}
	workerPlacement = { ...value, mode: "pointer" };
	paintWorkerPlacement();
}
function renderWorkerRoomTargets() {
	if (workerPlacement?.mode !== "keyboard") return;
	const scav = state.scavs.find((item) => item.id === workerPlacement!.scavId); if (!scav) return;
	const layer = document.querySelector<HTMLElement>("#worker-room-targets")!;
	layer.hidden = false;
	layer.innerHTML = state.shelter.rooms.map((room) => {
		const reason = getWorkerAssignmentReason(state, scav.id, room.id), definition = ROOM_DEFINITIONS[room.type];
		return `<button class="worker-room-target ${reason ? "unavailable" : "available"}" data-worker-room="${room.id}" aria-disabled="${Boolean(reason)}" aria-describedby="worker-placement-hint" aria-label="${e(definition.label)}, сектор ${room.row + 1}, ${room.workerIds.length} из ${getRoomWorkerCapacity(room)} работников. ${e(reason ?? (scav.assignment === room.id ? "Уже работает здесь" : `Назначить ${scav.name}, подходит ${Math.round(getWorkerAffinity(scav, room.type))} из 100`))}" title="${e(reason ?? "Назначить бойца")}" style="--room-color:${definition.color}"><span>${icon(roomIcon(room.type),15)} ${e(definition.label)}</span><small>${reason ? "Недоступно" : scav.assignment === room.id ? "Уже работает" : `Назначить · ${room.workerIds.length}/${getRoomWorkerCapacity(room)}`}</small></button>`;
	}).join("");
	positionWorkerRoomTargets();
}
function positionWorkerRoomTargets() {
	if (workerPlacement?.mode !== "keyboard" || !world) return;
	const layer = document.querySelector<HTMLElement>("#worker-room-targets"), canvas = document.querySelector<HTMLCanvasElement>("#world canvas"), card = document.querySelector<HTMLElement>(".world-card");
	if (!layer || !canvas || !card) return;
	const canvasRect = canvas.getBoundingClientRect(), cardRect = card.getBoundingClientRect();
	layer.style.left = `${canvasRect.left - cardRect.left}px`; layer.style.top = `${canvasRect.top - cardRect.top}px`;
	layer.style.width = `${canvasRect.width}px`; layer.style.height = `${canvasRect.height}px`;
	layer.querySelectorAll<HTMLButtonElement>("[data-worker-room]").forEach((button) => {
		const room = state.shelter.rooms.find((item) => item.id === button.dataset.workerRoom); if (!room) return;
		const logical = getRoomBounds(room);
		const rect = world!.projectShelterRect(logical);
		button.hidden = !rect;
		if (!rect) return;
		button.style.left = `${rect.left - canvasRect.left}px`; button.style.top = `${rect.top - canvasRect.top}px`;
		button.style.width = `${rect.width}px`; button.style.height = `${rect.height}px`;
		const bounds = projectShelterBounds(logical);
		button.style.clipPath = `polygon(${[{ x: logical.x, y: logical.y }, { x: logical.x + logical.width, y: logical.y }, { x: logical.x + logical.width, y: logical.y + logical.height }, { x: logical.x, y: logical.y + logical.height }].map(projectShelterPoint).map((point) => `${(point.x - bounds.x) / bounds.width * 100}% ${(point.y - bounds.y) / bounds.height * 100}%`).join(",")})`;
		button.dataset.cameraVisible = String(rect.visible);
	});
}
function refreshWorkerRoomTargets() {
	if (workerPlacement?.mode !== "keyboard") return;
	const scav = state.scavs.find((item) => item.id === workerPlacement!.scavId); if (!scav) return;
	document.querySelectorAll<HTMLButtonElement>("#worker-room-targets [data-worker-room]").forEach((node) => {
		const room = state.shelter.rooms.find((item) => item.id === node.dataset.workerRoom); if (!room) return;
		const reason = getWorkerAssignmentReason(state, scav.id, room.id);
		node.setAttribute("aria-disabled", String(Boolean(reason)));
		node.classList.toggle("unavailable", Boolean(reason)); node.classList.toggle("available", !reason);
		node.title = reason ?? "Назначить бойца";
		node.setAttribute("aria-label", `${ROOM_DEFINITIONS[room.type].label}, сектор ${room.row + 1}, ${room.workerIds.length} из ${getRoomWorkerCapacity(room)} работников. ${reason ?? (scav.assignment === room.id ? "Уже работает здесь" : `Назначить ${scav.name}, подходит ${Math.round(getWorkerAffinity(scav, room.type))} из 100`)}`);
		node.querySelector("small")!.textContent = reason ? "Недоступно" : scav.assignment === room.id ? "Уже работает" : `Назначить · ${room.workerIds.length}/${getRoomWorkerCapacity(room)}`;
	});
	if (workerPlacement.roomId) workerPlacement.reason = getWorkerAssignmentReason(state, scav.id, workerPlacement.roomId);
	paintWorkerPlacement();
}
function beginKeyboardAssignment(id: string) {
	if (!canWorldDrag()) { toast("Вернись к убежищу, чтобы назначить бойца.", false); return; }
	const reason = workerPickReason(id); if (reason) { toast(reason, false); return; }
	if (workerPlacement?.mode === "keyboard" && workerPlacement.scavId === id) { cancelWorkerPlacement(true, true); return; }
	cancelWorkerPlacement();
	world?.setPanMode(false);
	workerPlacement = { scavId: id, mode: "keyboard", roomId: null, reason: null };
	paintWorkerPlacement(); renderWorkerRoomTargets();
	const target = document.querySelector<HTMLButtonElement>('#worker-room-targets [aria-disabled="false"]') ?? document.querySelector<HTMLButtonElement>("#worker-room-targets button") ?? document.querySelector<HTMLButtonElement>("[data-worker-cancel]");
	target?.focus({ preventScroll: true });
	if (target) revealAssignmentControl(target);
}
async function assignPlacedWorker(scavId: string, roomId: string) {
	if (storedProgressChanged()) { cancelWorkerPlacement(false, true); return; }
	if (!canWorldDrag()) { cancelWorkerPlacement(false, true); return; }
	const scav = state.scavs.find((item) => item.id === scavId), room = state.shelter.rooms.find((item) => item.id === roomId);
	const alreadyAssigned = scav?.assignment === roomId;
	const returnFocus = workerPlacement?.mode === "keyboard";
	cancelWorkerPlacement();
	const result = await gameAction({ type: "assignWorker", args: [scavId, roomId] });
	act(result.ok && scav && room ? { ...result, message: alreadyAssigned ? `${scav.name} уже работает: ${ROOM_DEFINITIONS[room.type].label}.` : `${scav.name} назначен: ${ROOM_DEFINITIONS[room.type].label}.` } : result, "assign");
	announceWorkerPlacement(result.ok && scav && room ? `${scav.name}: ${ROOM_DEFINITIONS[room.type].label}.` : result.message);
	if (returnFocus) focusWorkerHandle(scavId);
}
function startCrewPointer(event: PointerEvent) {
	if (!event.isPrimary || event.button !== 0) return;
	const target = event.target instanceof Element ? event.target : null;
	const handle = target?.closest<HTMLElement>("#command-crew [data-worker-handle]");
	const portrait = event.pointerType !== "touch" ? target?.closest<HTMLElement>("#command-crew [data-portrait-scav]") : null;
	const source = handle ?? portrait, id = handle?.dataset.workerHandle ?? portrait?.dataset.portraitScav;
	if (!source || !id || !canWorldDrag() || workerPickReason(id)) return;
	cancelWorkerPlacement();
	world?.setPanMode(false);
	crewPointer = { scavId: id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY, source, started: false };
	source.setPointerCapture(event.pointerId);
	updateCameraControls();
}
function moveCrewPointer(event: PointerEvent) {
	const gesture = crewPointer;
	if (!gesture || gesture.pointerId !== event.pointerId) return;
	gesture.clientX = event.clientX; gesture.clientY = event.clientY;
	if (!gesture.started) {
		if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 8) return;
		if (!canWorldDrag() || !world?.beginScavDrag(gesture.scavId)) { cancelWorkerPlacement(); holdWorldInput(); suppressWorkerClickUntil = Date.now() + 450; return; }
		gesture.started = true;
	}
	event.preventDefault();
	world?.moveScavDrag(event.clientX, event.clientY);
	paintWorkerPlacement();
}
function finishCrewPointer(event: PointerEvent) {
	const gesture = crewPointer;
	if (!gesture || gesture.pointerId !== event.pointerId) return;
	releaseCrewPointer();
	if (!gesture.started) return;
	event.preventDefault(); holdWorldInput(); suppressWorkerClickUntil = Date.now() + 450;
	world?.moveScavDrag(event.clientX, event.clientY);
	world?.endScavDrag();
	clearWorkerPlacement();
}
function cancelCrewPointer(event: PointerEvent) {
	if (crewPointer?.pointerId === event.pointerId) cancelWorkerPlacement(false, true);
}
function suppressWorkerClick(event: MouseEvent) {
	if (event.detail > 0 && Date.now() < suppressWorkerClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
}
function workerTargetFocus(event: FocusEvent) {
	if (workerPlacement?.mode !== "keyboard") return;
	const target = event.target instanceof Element ? event.target : null;
	const roomId = target?.closest<HTMLElement>("[data-worker-room]")?.dataset.workerRoom;
	if (roomId) {
		const button = target?.closest<HTMLElement>("[data-worker-room]"), canvas = document.querySelector<HTMLCanvasElement>("#world canvas");
		if (button && canvas) {
			const rect = button.getBoundingClientRect(), viewport = canvas.getBoundingClientRect();
			if (button.dataset.cameraVisible === "false" || rect.left < viewport.left - 1 || rect.right > viewport.right + 1 || rect.top < viewport.top - 1 || rect.bottom > viewport.bottom + 1) world?.focusRoom(roomId);
		}
		workerPlacement.roomId = roomId; workerPlacement.reason = getWorkerAssignmentReason(state, workerPlacement.scavId, roomId); paintWorkerPlacement();
	}
	else if (!target?.closest("[data-worker-handle], [data-worker-cancel]")) cancelWorkerPlacement(false, true);
}
function cancelPlacementForBlur() { cancelWorkerPlacement(false, true); world?.cancelCameraGesture(); }
function handleCameraKey(event: KeyboardEvent) {
	const target = event.target instanceof Element ? event.target : null;
	if (event.ctrlKey || event.metaKey || event.altKey || !canWorldCamera() || !world || (target !== worldViewport && !target?.closest(".camera-controls"))) return;
	if (buildingPlacement && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
		const distance = event.shiftKey ? 1 : 8;
		event.preventDefault(); event.stopImmediatePropagation();
		nudgeBuildingPlacement(event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0, event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0); return;
	}
	const moves: Record<string, [number, number]> = { ArrowLeft: [-48, 0], ArrowRight: [48, 0], ArrowUp: [0, -48], ArrowDown: [0, 48] };
	if (event.key === "+" || event.key === "=") cameraAction("in");
	else if (event.key === "-" || event.key === "_") cameraAction("out");
	else if (event.key === "0" || event.key === "Home") cameraAction("fit");
	else if (moves[event.key]) world.panBy(...moves[event.key]!);
	else if (event.key === "Escape" && cameraView.panMode) world.setPanMode(false);
	else return;
	event.preventDefault(); event.stopImmediatePropagation();
}
function focusWorldViewport(event: PointerEvent) {
	if (event.target instanceof HTMLCanvasElement && canWorldInteract()) worldViewport.focus({ preventScroll: true });
}
document.addEventListener("pointerdown", startCrewPointer);
document.addEventListener("pointermove", moveCrewPointer, { passive: false });
document.addEventListener("pointerup", finishCrewPointer);
document.addEventListener("pointercancel", cancelCrewPointer);
document.addEventListener("lostpointercapture", cancelCrewPointer);
document.addEventListener("click", suppressWorkerClick, true);
document.addEventListener("focusin", workerTargetFocus);
window.addEventListener("blur", cancelPlacementForBlur);
document.addEventListener("keydown", handleCameraKey);
worldViewport.addEventListener("pointerdown", focusWorldViewport);
function act(result: ActionResult, cue: GameSoundCue = "confirm") {
	const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const focusKey = origin?.dataset.focusKey;
	const scope = origin?.closest("#command-dock") ? "#command-dock" : origin?.closest("#tool-root") ? "#tool-root" : "#app";
	const actionSelector = origin?.dataset.action
		? ["action", "id", "mod", "slot", "jobId", "recipeId", "modelId", "moduleId", "event", "choice"].filter((key) => origin.dataset[key] != null)
			.map((key) => `[data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${CSS.escape(origin.dataset[key]!)}"]`).join("")
		: null;
	gameSound.play(result.ok ? cue : "blocked");
	toast(result.message, result.ok);
	persist();
	render();
	if (!isInspectorOpen() && (actionSelector || focusKey)) {
		const replacement = (focusKey ? document.querySelector<HTMLElement>(`${scope} [data-focus-key="${CSS.escape(focusKey)}"]`) : null) ?? (actionSelector ? document.querySelector<HTMLElement>(`${scope} ${actionSelector}`) : null);
		if (replacement && !replacement.matches(":disabled")) replacement.focus({ preventScroll: true });
		else {
			const context = replacement?.closest<HTMLElement>(".card, .weapon-detail, .contract");
			if (context) { context.tabIndex = -1; context.focus({ preventScroll: true }); }
			else if (page === "arsenal" && arsenalTab === "bench") document.querySelector<HTMLButtonElement>(`[data-bench-slot="${selectedModuleSlot}"]`)?.focus({ preventScroll: true });
			else if (page === "arsenal") document.querySelector<HTMLButtonElement>(`[data-arsenal-tab="${arsenalTab}"]`)?.focus({ preventScroll: true });
			else if (page === "flea") panel.querySelector<HTMLButtonElement>(`[data-flea-tab="${fleaView.tab}"]`)?.focus({preventScroll:true});
			else if (origin?.dataset.action === "cancel-production") activeRoomPanel().querySelector<HTMLButtonElement>('[data-room-context-tab="production"]')?.focus({ preventScroll: true });
			else if (origin?.dataset.action === "social-choice") {
				const next = document.querySelector<HTMLButtonElement>('#tool-root [data-action="social-choice"]:not(:disabled)') ?? document.querySelector<HTMLButtonElement>('#tool-root [data-action="close-tools"]');
				next?.focus({ preventScroll: true });
			}
			else if (contextMode !== "overview") activeRoomPanel().querySelector<HTMLButtonElement>('[data-action="close-context"]')?.focus({ preventScroll: true });
		}
	}
}
const scrollBehavior = (): ScrollBehavior => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
function canAfford(cost: { money: number; scrap: number }) {
	return state.money >= cost.money && state.supplies.scrap >= cost.scrap;
}
function costReason(cost: { money: number; scrap: number }) {
	const missing: string[] = [];
	if (state.money < cost.money) missing.push(`${n(cost.money - state.money)} ₽`);
	if (state.supplies.scrap < cost.scrap) missing.push(`${n(cost.scrap - state.supplies.scrap)} дет.`);
	return missing.length ? `Не хватает ${missing.join(" и ")}` : "Припасы есть";
}
function dispatchBlock(scav: Scav) {
	return getRaidQuote(state, scav, MAP_BY_ID[selectedMap]!).reason;
}
function supplyName(key: string) {
	return ({ ammo: "Патроны", medicine: "Медикаменты", scrap: "Детали", intel: "Разведданные" } as Record<string, string>)[key] ?? key;
}
function expeditionQueue() {
	const waiting = raidRepresentatives(state.raids).filter((raid) => raid.expedition?.status === "choice");
	if (!waiting.length) return "";
	return `<section class="expedition-queue" aria-label="Экспедиции ждут приказа"><div class="section-head"><h2>${icon("intel", 20)} Нужен твой приказ</h2><span class="decision-pill">${waiting.length} ${waiting.length === 1 ? "боец на связи" : "бойца на связи"}</span></div>${waiting.map((raid) => expeditionCard(raid)).join("")}</section>`;
}
function cargoWarehouseNotice(raid: Raid) {
	const cargo = raid.expedition?.cargo;
	if (!cargo) return "";
	const supplyCapacity = getSupplyCapacity(state);
	const overflow = Object.entries(cargo.supplies).filter(([key, amount]) => amount > Math.max(0, supplyCapacity[key as keyof GameState["supplies"]] - state.supplies[key as keyof GameState["supplies"]])).map(([key, amount]) => `${supplyName(key)}: ${Math.ceil(amount - Math.max(0, supplyCapacity[key as keyof GameState["supplies"]] - state.supplies[key as keyof GameState["supplies"]]))}`);
	const surplusGuns = Math.max(0, cargo.weaponIds.length - Math.max(0, getStorageCapacity(state) - state.weapons.length));
	const surplusModules = Math.max(0, cargo.modules.length - Math.max(0, getModuleCapacity(state) - state.modules.length));
	return overflow.length || surplusGuns || surplusModules ? `<p class="risk-note"><strong>На базе не всё поместится.</strong>${overflow.length ? ` Лишние припасы останутся за бортом: ${e(overflow.join(" · "))}.` : ""}${surplusGuns ? ` Стволы сверх вместимости арсенала будут проданы: ${surplusGuns}.` : ""}${surplusModules ? ` Модули сверх вместимости стойки будут проданы: ${surplusModules}.` : ""} Можно освободить место или улучшить склад перед эвакуацией.</p>` : '<p class="field-hint">Текущая добыча помещается на складе базы.</p>';
}
function moduleCargo(items: ModuleInstance[]) {
	return items.length ? `<div class="module-loot-strip">${items.map((item) => {
		const model = getModuleDefinition(item);
		return `<span class="cargo-module" style="--rarity:${RARITY_COLORS[model.rarity]}">${moduleArt(model)}<span><strong>${e(model.label)}</strong><small>${MODULE_SLOT_LABELS[model.slot]} · ${Math.round(item.durability)}%</small></span></span>`;
	}).join("")}</div>` : "";
}
function expeditionCard(raid: Raid, compact = false) {
	if (raid.squad) return squadRaidDecision(state, raid, selectedPerks.get(raid.id));
	const run = raid.expedition;
	if (!run) return "";
	const scav = state.scavs.find((item) => item.id === raid.scavId);
	if (!scav) return "";
	const capacity = run.capacity;
	const selectedPerk = selectedPerks.get(raid.id);
	const choices = getExpeditionChoices(state, raid, selectedPerk);
	const hasPerk = Boolean(selectedPerk && run.offers.includes(selectedPerk));
	const supplies = Object.entries(run.cargo.supplies).filter(([, amount]) => amount > 0).map(([key, amount]) => `<span>${icon(key, 14)} ${supplyName(key)} +${n(amount)}</span>`).join("");
	const weapons = run.cargo.weaponIds.map((id) => WEAPON_BY_ID[id]).filter((item) => Boolean(item)).map((def) => `<span>${icon("arsenal", 14)} ${e(def!.name)}</span>`).join("");
	const cargoMetrics = `<div class="loadout-stats"><span>Груз: ${getCargoWeight(run.cargo).toFixed(1)} / ${capacity.toFixed(1)} ед.</span><span>Ценность: ≈ ${n(getCargoValue(run.cargo))} ₽</span></div>`;
	const warehouseWarning = `<div data-cargo-warehouse="${raid.id}">${cargoWarehouseNotice(raid)}</div>`;
	return `<article class="decision-card" data-expedition="${raid.id}"><div class="decision-head"><div class="scav-avatar">${scavPortrait(scav.personality, scav.name, scav.appearance)}</div><div><span class="eyebrow">${e(MAP_BY_ID[raid.mapId]!.name)} · точка ${run.stage} / 3</span><h3>${e(scav.name)} ждёт приказа</h3><p>${run.stage >= 3 ? "Маршрут пройден. Забери добычу на базу." : "Добыча ещё в рюкзаке. Можно уйти или рискнуть дальше."}</p></div>${!compact ? `<button class="button ghost small" data-scav="${scav.id}">Личное дело</button>` : ""}</div><div class="decision-content"><div class="expedition-stage" aria-label="Пройдено этапов: ${run.stage} из 3">${[1, 2, 3].map((stage) => `<span class="${stage < run.stage ? "done" : stage === run.stage ? "current" : ""}">${stage < run.stage ? "✓ " : ""}${stage}. ${stage === 1 ? "Вход" : stage === 2 ? "Глубина" : "Цель"}</span>`).join("")}</div><div class="cargo-summary"><div><span>В рюкзаке</span><strong>${n(run.cargo.money)} ₽</strong><small>Наличными · припасы ниже</small></div><div><span>Защищено от потери</span><strong>Открытия</strong><small>Остаются даже при провале</small></div><div><span>Здоровье бойца</span><strong>${Math.floor(scav.health)} / 100</strong><small>Броня на входе: ${Math.round(run.loadout.armorCondition)}%</small></div></div>${bossRaidProgress(raid)}${cargoMetrics}${raidHealthPanel(state, raid)}${ammunitionSnapshot(run.ammunition?.modelId, true)}<p class="field-hint">Ценность — оценка наличных и находок, а не выплата рублями. Деньги не занимают место. При перегрузе боец оставляет лишние припасы; склад на базе тоже ограничен.</p><div class="cargo-items">${supplies}${weapons || (!supplies ? "<span>Рюкзак пока пуст</span>" : "")}</div>${moduleCargo(run.cargo.modules)}${raidLootReceipt(run.cargo.lootItems)}${raidGearReceipt(run.cargo.gearItems)}${warehouseWarning}${run.discoveries.length ? `<p class="field-hint">Записаны находки: ${run.discoveries.map((id) => e(BLUEPRINTS[id]?.label ?? "Разведанный маршрут")).join(" · ")}. Останутся у базы.</p>` : ""}${run.perks.length ? `<p class="field-hint">Опыт этой экспедиции: ${run.perks.map((perk) => e(RUN_PERKS[perk].label)).join(" · ")}</p>` : ""}${choices.length ? `<p class="risk-note">Следующий этап опаснее. При провале добыча в рюкзаке может быть потеряна; постоянные открытия сохранятся.</p>${run.offers.length ? `<div class="run-perk-pick"><h3>Находка маршрута</h3><p>Выбери один бонус. Он работает до конца этой экспедиции.</p><div class="decision-branches">${run.offers.map((perk) => `<button class="branch-choice ${perk === selectedPerk ? "active" : ""}" data-action="run-perk" data-id="${raid.id}" data-perk="${perk}" data-focus-key="perk-${perk}" aria-pressed="${perk === selectedPerk}"><strong>${e(RUN_PERKS[perk].label)}</strong><p>${e(RUN_PERKS[perk].description)}</p><small>${perk === selectedPerk ? "✓ Выбрано" : "Выбрать бонус"}</small></button>`).join("")}</div></div>` : ""}<h3>Куда дальше?</h3><div class="decision-branches">${choices.map((choice) => `<button class="branch-choice" data-action="continue-expedition" data-id="${raid.id}" data-branch="${choice.branch}" data-focus-key="branch-${choice.branch}" ${choice.reason || (run.offers.length && !hasPerk) ? "disabled" : ""}><strong>${e(choice.label)}</strong><p>${e(choice.description)}</p>${choice.boss ? `<p class="boss-choice-reward">За победу: ${n(choice.boss.bounty)} ₽ в груз + трофеи. Нужно вынести.</p>` : ""}<small>${Math.round(choice.chance * 100)}% ${choice.boss ? "победить босса" : "успеха"} · ${seconds(choice.duration)} · ${n(choice.money)} ₽ + ${choice.ammo} патр.${choice.intel ? ` + ${choice.intel} разв.` : ""}</small>${choice.ammunition ? ammunitionThreat(choice.ammunition) : ""}<span class="quote-note">${e(choice.reason ?? (run.offers.length && !hasPerk ? "Сначала выбери бонус маршрута" : `Этап ${run.stage + 1} · добыча под риском`))}</span></button>`).join("")}</div>` : ""}<div class="extract-row"><p>Эвакуация вернёт бойца и доставит добычу в пределах склада. ${run.stage < 3 ? "База готовит следующий выход." : "Экспедиция завершится."}</p><button class="button" data-action="extract" data-id="${raid.id}" data-focus-key="extract">${icon("check", 17)} Эвакуировать с добычей</button></div></div></article>`;
}
function hud() {
	updateAchievementBadge();
	if (workerPlacement && (!canWorldDrag() || workerPickReason(workerPlacement.scavId))) cancelWorkerPlacement(false, true);
	refreshWorkerRoomTargets();
	const commandSummary = getCommandSummary(state);
	refreshCommandOverview(commandSummary);
	document.querySelectorAll<HTMLButtonElement>("#command-crew [data-worker-handle]").forEach((node) => {
		const reason = workerPickReason(node.dataset.workerHandle!);
		const name = state.scavs.find((scav) => scav.id === node.dataset.workerHandle)?.name ?? "бойца";
		node.setAttribute("aria-disabled", String(Boolean(reason)));
		node.setAttribute("aria-label", `Назначить ${name} в комнату${reason ? `: ${reason}` : ". Перетащи или выбери комнату"}`);
		node.title = reason ?? "Перетащи в комнату или нажми для выбора";
	});
	document.querySelector("#res-money")!.textContent = `${n(state.money)} ₽`;
	for (const key of ["ammo", "medicine", "scrap", "intel"] as const)
		document.querySelector(`#res-${key}`)!.textContent = n(state.supplies[key]);
	document.querySelector("#level-label")!.textContent =
		`Уровень ${state.level} · ${n(state.xp)} опыта`;
	const start = xpForLevel(state.level),
		end = xpForLevel(state.level + 1);
	(document.querySelector("#xp-fill") as HTMLElement).style.width =
		`${Math.min(100, ((state.xp - start) / (end - start)) * 100)}%`;
	const waitingCount = raidRepresentatives(state.raids).filter((raid) => raid.expedition?.status === "choice").length;
	document.querySelector("#raid-badge")!.textContent = waitingCount ? "!" : String(state.raids.length);
	document.querySelector<HTMLButtonElement>('.nav [data-page="raids"]')?.setAttribute("aria-label", "Рейд");
	document.querySelector("#passive-note")!.textContent =
		state.money >= getRecoveryAllowance(state) ? "Резерв заполнен · прибыль в рейдах" : `Резерв: +${getIncomePerMinute(state)} ₽ / мин`;
	const incomeStatus = document.querySelector<HTMLElement>("#income-status");
	if (incomeStatus) incomeStatus.textContent = state.money >= getRecoveryAllowance(state) ? "РЕЗЕРВ ЗАПОЛНЕН" : `+${getIncomePerMinute(state)} ₽ / МИН ДО ${n(getRecoveryAllowance(state))} ₽`;
	const capacities = getSupplyCapacity(state);
	for (const key of ["ammo", "medicine", "scrap", "intel"] as const) {
		const resource = document.querySelector(`#res-${key}`)?.closest<HTMLElement>(".resource");
		if (resource) resource.title = `${supplyName(key)}: ${n(state.supplies[key])} / ${capacities[key]}. ${key === "medicine" ? "Пополнение — в добыче и снабжении." : state.supplies[key] >= capacities[key] ? "Склад заполнен; производство ждёт расхода." : "Производство требует работников и припасов; запас ограничен вместимостью."}`;
		const cap = document.querySelector<HTMLElement>(`#cap-${key}`); if (cap) { cap.style.setProperty("--fill", `${Math.min(100,state.supplies[key]/capacities[key]*100)}%`); cap.classList.toggle("full",state.supplies[key]>=capacities[key]); }
	}
	const moneyCap=document.querySelector<HTMLElement>("#cap-money"); if(moneyCap)moneyCap.style.setProperty("--fill",`${Math.min(100,state.money/getRecoveryAllowance(state)*100)}%`);
	document.querySelector("#world-raid-note")!.textContent = liveMode?.isActive() ? "БЕЗ ТАЙМЕРА" : state.raids.length
		? state.raids.some((raid) => raid.expedition?.status === "choice") ? "ЕСТЬ СИГНАЛ · НУЖЕН ТВОЙ ПРИКАЗ" : `В РЕЙДАХ: ${state.raids.length} · ДИКИЕ НА СВЯЗИ`
		: "ОТРЯД НА БАЗЕ";
	const orderCounter = document.querySelector("#auto-order-count");
	if (orderCounter) orderCounter.textContent = String(state.scavs.filter((scav) => scav.autoRaid.enabled).length);
	document
		.querySelectorAll<HTMLElement>("[data-raid-progress]")
		.forEach((node) => {
			const raid = state.raids.find((r) => r.id === node.dataset.raidProgress);
			if (raid)
				node.style.width = `${raid.expedition?.status === "choice" ? 100 : Math.min(100, ((Date.now() - raid.startedAt) / (raid.endsAt - raid.startedAt)) * 100)}%`;
		});
	document.querySelectorAll<HTMLElement>("[data-raid-time]").forEach((node) => {
		const raid = state.raids.find((r) => r.id === node.dataset.raidTime);
		if (raid) node.textContent = raid.expedition?.status === "choice" ? "ПРИКАЗ" : seconds((raid.endsAt - Date.now()) / 1000);
	});
	document.querySelectorAll<HTMLElement>("[data-raid-phase]").forEach((node) => {
		const raid = state.raids.find((r) => r.id === node.dataset.raidPhase);
		if (raid) node.textContent = getRaidPhase(raid, Date.now()).label;
	});
	document.querySelectorAll<HTMLElement>("[data-health]").forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.health);
		if (scav) node.textContent = `${Math.floor(scav.health)} / 100`;
	});
	document
		.querySelectorAll<HTMLElement>("[data-health-fill]")
		.forEach((node) => {
			const scav = state.scavs.find((s) => s.id === node.dataset.healthFill);
			if (scav) node.style.width = `${scav.health}%`;
		});
	document.querySelectorAll<HTMLElement>("[data-auto-status]").forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.autoStatus);
		if (scav) node.textContent = getAutoRaidStatus(state, scav);
	});
	document.querySelectorAll<HTMLElement>("[data-chance]").forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.chance);
		if (scav) node.textContent = `${Math.round(getRaidQuote(state, scav, MAP_BY_ID[selectedMap]!).chance * 100)}% успеха`;
	});
	document.querySelectorAll<HTMLElement>("[data-dispatch-cost]").forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.dispatchCost), map = MAP_BY_ID[selectedMap]!;
		if (scav) { const quote = getRaidQuote(state, scav, map); node.textContent = `${n(quote.money)} ₽ + ${quote.ammo} патр.${quote.intel ? ` + ${quote.intel} разв.` : ""}${quote.medicine ? ` + ${quote.medicine} мед.` : ""}`; }
	});
	const squadQuote = getSquadRaidQuote(state, [...squadDraft], selectedMap);
	document.querySelectorAll<HTMLButtonElement>('[data-action="dispatch-squad"]').forEach(node => { node.disabled = Boolean(squadQuote.reason); node.title = squadQuote.reason ?? "Начать общий маршрут"; });
	const squadNote = document.querySelector("[data-squad-dispatch-note]"); if (squadNote) squadNote.textContent = squadQuote.reason ?? "Оплата за каждого. Добыча остаётся в рюкзаках до общей эвакуации.";
	document.querySelectorAll<HTMLButtonElement>('[data-action="dispatch"]').forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.id);
		const reason = scav ? dispatchBlock(scav) : "Боец не найден";
		node.disabled = Boolean(reason);
		node.title = reason ?? "Первый этап новой экспедиции";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="gear"]').forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.id);
		const slot = node.dataset.slot as GearSlot;
		if (scav) node.disabled = scav.status === "raiding" || scav.gear[slot] >= MAX_GEAR_LEVEL || !canAfford(getGearCost(scav, slot));
	});
	updateScavHealthPanels(document, state);
	document.querySelectorAll<HTMLButtonElement>('[data-action="recruit"]').forEach((node) => { node.disabled = false; });
	document.querySelectorAll<HTMLButtonElement>('[data-action="recruit-candidate"]').forEach((node) => {
		const quote = getRecruitCandidateQuote(state, node.dataset.id!);
		node.disabled = Boolean(quote.reason); node.title = quote.reason ?? "Принять кандидата в отряд";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="recruit-refresh"]').forEach((node) => {
		const quote = getRecruitmentRefreshQuote(state); node.disabled = Boolean(quote.reason); node.title = quote.reason ?? "Связаться с новой тройкой кандидатов";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="story-choice"]').forEach((node) => {
		const scav = state.scavs.find(item => item.id === node.dataset.id);
		const event = scav ? getScavPersonalEvent(state, scav) : null;
		const choice = event && event.id === node.dataset.event ? event.choices.find(item => item.id === node.dataset.choice) : null;
		node.disabled = !choice || Boolean(choice.reason);
		node.title = choice?.reason ?? "Этот ответ останется в личной истории";
		const note = node.parentElement?.querySelector<HTMLElement>('[data-story-choice-note]');
		if (note) { note.textContent = choice?.reason ?? ""; note.hidden = !choice?.reason; }
	});
	const socialEvents = getSquadSocialEvents(state);
	const socialBadge = document.querySelector<HTMLElement>("#squad-badge");
	if (socialBadge) { socialBadge.textContent = String(socialEvents.length); socialBadge.hidden = socialEvents.length === 0; }
	document.querySelectorAll<HTMLButtonElement>('[data-action="social-choice"]').forEach((node) => {
		const event = socialEvents.find(item => item.id === node.dataset.event);
		const choice = event?.choices.find(item => item.id === node.dataset.choice);
		node.disabled = !choice || Boolean(choice.reason);
		node.title = choice?.reason ?? "Ответ останется в общей истории";
		const note = node.parentElement?.querySelector<HTMLElement>('[data-social-choice-note]');
		if (note) { note.textContent = choice?.reason ?? ""; note.hidden = !choice?.reason; }
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="upgrade"]').forEach((node) => {
		const room = node.dataset.id as BaseRoom, cost = getUpgradeCost(state, room);
		node.disabled = state.base[room] >= MAX_ROOM_LEVEL || !canAfford(cost);
		const note = document.querySelector(`[data-room-cost="${room}"]`);
		if (note) note.textContent = state.base[room] >= MAX_ROOM_LEVEL ? "Помещение полностью развито" : costReason(cost);
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="repair"]').forEach((node) => {
		const weapon = state.weapons.find((item) => item.id === node.dataset.id); if (!weapon) return;
		const busy = state.raids.some((raid) => raid.weaponInstanceId === weapon.id), cost = getRepairCost(weapon);
		node.disabled = busy || !needsWeaponRepair(weapon) || !canAfford(cost);
		const note = document.querySelector(`[data-weapon-cost="${weapon.id}-repair"]`);
		if (note) note.textContent = busy ? "Оружие в рейде" : !needsWeaponRepair(weapon) ? "Ремонт не нужен" : costReason(cost);
	});
	document.querySelectorAll<HTMLElement>('[data-gear-note]').forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.gearNote), slot = node.dataset.slot as GearSlot;
		if (scav) node.textContent = scav.status === "raiding" ? "После возвращения" : scav.gear[slot] >= MAX_GEAR_LEVEL ? "Полный комплект" : costReason(getGearCost(scav, slot));
	});
	document.querySelectorAll<HTMLElement>("[data-dispatch-note]").forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.dispatchNote);
		if (scav) node.textContent = dispatchBlock(scav) ?? "Готов к первому этапу";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="buy-supplies"]').forEach((node) => {
		const reason = getMarketReason(state, node.dataset.id ?? "");
		node.disabled = Boolean(reason);
		const note = document.querySelector(`[data-market-note="${node.dataset.id}"]`); if (note) note.textContent = reason ?? "Полная партия поместится на складе";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="craft-gear"]').forEach((node) => {
		const reason = getGearCraftReason(state, node.dataset.id ?? "");
		node.disabled = Boolean(reason);
		const note = document.querySelector(`[data-craft-note="${node.dataset.id}"]`); if (note) note.textContent = reason ?? "Снаряжение появится на складе";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="repair-gear"]').forEach((node) => {
		const item = state.gearItems.find((gear) => gear.id === node.dataset.id); if (!item) return;
		const owner = state.scavs.find((scav) => scavHasGear(scav, item.id));
		node.disabled = owner?.status === "raiding" || item.durability >= 100 || !canAfford(getGearRepairCost(item));
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="continue-expedition"]').forEach((node) => {
		const raid = state.raids.find((item) => item.id === node.dataset.id); if (!raid) return;
		const perk = selectedPerks.get(raid.id);
		const quote = getExpeditionChoices(state, raid, perk).find((choice) => choice.branch === node.dataset.branch);
		const reason = quote?.reason ?? (perk && raid.expedition?.offers.includes(perk) ? null : "Сначала выбери бонус маршрута");
		node.disabled = !quote || Boolean(reason);
		const note = node.querySelector<HTMLElement>(".quote-note"); if (note) note.textContent = reason ?? `Этап ${(raid.expedition?.stage ?? 0) + 1} · добыча под риском`;
	});
	document.querySelectorAll<HTMLElement>('[data-supply-count]').forEach((node) => {
		const key = node.dataset.supplyCount as keyof GameState["supplies"];
		if (key in state.supplies) node.textContent = n(state.supplies[key]);
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="recycle-gear"], [data-action="recycle-weapon"]').forEach((node) => {
		const gear = node.dataset.action === "recycle-gear" ? state.gearItems.find((item) => item.id === node.dataset.id) : null;
		const weapon = !gear ? state.weapons.find((item) => item.id === node.dataset.id) : null;
		if (!gear && !weapon) return;
		const yieldValue = gear ? getGearRecycleYield(gear) : getWeaponRecycleYield(weapon!);
		const busy = gear ? state.scavs.some((scav) => scav.status === "raiding" && scavHasGear(scav, gear.id)) : state.raids.some((raid) => raid.weaponInstanceId === weapon!.id);
		const liquidationReason = weapon ? weaponLiquidationReason(weapon) : null;
		const reason = busy ? "Предмет сейчас на маршруте" : liquidationReason ?? (state.supplies.scrap + yieldValue > capacities.scrap ? "Нет места для материалов: потрать запас или развивай склад" : null);
		node.disabled = Boolean(reason);
		node.title = reason ?? `Разбор даст ${yieldValue} деталей`;
		const note = node.parentElement?.querySelector<HTMLElement>('[data-recycle-note]'); if (note) note.textContent = reason ?? "Утилизация уничтожит предмет и его модули. Чтобы сохранить модули, используй верстак";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="sell"]').forEach((node) => {
		const weapon = state.weapons.find((item) => item.id === node.dataset.id); if (!weapon) return;
		const reason = weaponLiquidationReason(weapon); node.disabled = Boolean(reason); node.title = reason ?? "Продажа оружия вместе с установленными модулями";
	});
	document.querySelectorAll<HTMLElement>('[data-cargo-warehouse]').forEach((node) => {
		const raid = state.raids.find((item) => item.id === node.dataset.cargoWarehouse); if (!raid) return;
		const notice = cargoWarehouseNotice(raid); if (node.innerHTML !== notice) node.innerHTML = notice;
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="craft-module"]').forEach((node) => {
		const reason = getModuleProductionQuote(state, selectedProductionWorkshop()?.id ?? "", node.dataset.id ?? "").reason; node.disabled = Boolean(reason);
		const note = document.querySelector<HTMLElement>(`[data-module-craft-note="${node.dataset.id}"]`); if (note) note.textContent = reason ?? "Заказ в выбранную мастерскую; результат придёт после работы";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="repair-module"]').forEach((node) => {
		const item = state.modules.find((module) => module.id === node.dataset.id); if (!item) return;
		const cost = getModuleRepairCost(item); node.disabled = item.durability >= 100 || !canAfford(cost);
		const note = document.querySelector<HTMLElement>(`[data-module-repair-note="${item.id}"]`); if (note) note.textContent = item.durability >= 100 ? "Ремонт не нужен" : costReason(cost);
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="recycle-module"]').forEach((node) => {
		const item = state.modules.find((module) => module.id === node.dataset.id); if (!item) return;
		const blocked = state.supplies.scrap + getModuleRecycleYield(item) > capacities.scrap; node.disabled = blocked;
		const note = document.querySelector<HTMLElement>(`[data-module-recycle-note="${item.id}"]`); if (note) note.textContent = blocked ? "Нет места для деталей на складе" : "Продажа и утилизация уничтожают этот экземпляр";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="assemble-weapon"]').forEach((node) => { node.disabled = state.weapons.length >= getStorageCapacity(state); node.title = node.disabled ? "Арсенал полон: освободи место или развивай склад" : "Коробка станет основой новой сборки"; });
	for (const room of state.shelter.rooms) {
		const production = getRoomProductionState(state, room);
		document.querySelectorAll<HTMLElement>(`[data-production-readout="${room.id}"]`).forEach(readout => updateProductionReadout(readout, room, production));
		const roomSummary = commandSummary.rooms.find((item) => item.roomId === room.id);
		document.querySelectorAll<HTMLElement>(`[data-room-status="${room.id}"]`).forEach((node) => { node.textContent = production.status; });
		document.querySelectorAll<HTMLElement>(`[data-room-progress="${room.id}"]`).forEach((node) => { node.style.width = `${Math.round(production.progress * 100)}%`; });
		document.querySelectorAll<HTMLElement>(`[data-room-eta="${room.id}"]`).forEach((node) => { node.textContent = production.remainingSeconds == null ? "" : `${seconds(production.remainingSeconds)} до готовности`; });
		document.querySelectorAll<HTMLElement>(`[data-room-reason="${room.id}"]`).forEach((node) => { node.textContent = production.reason ?? (room.status !== "ready" ? "Во время стройки и улучшения работа приостановлена" : roomSummary?.cta ? roomSummary.detail : ""); });
		document.querySelectorAll<HTMLElement>(`[data-room-summary="${room.id}"]`).forEach(node => node.setAttribute("data-room-kind", roomSummary?.kind ?? "passive"));
		for (const job of room.queue) {
			document.querySelectorAll<HTMLElement>(`[data-job-progress="${job.id}"]`).forEach(node => { node.style.width = `${Math.min(100, job.workDone / job.workRequired * 100)}%`; });
			document.querySelectorAll<HTMLElement>(`[data-job-time="${job.id}"]`).forEach(node => { node.textContent = production.remainingSeconds == null ? "ПАУЗА" : seconds(production.remainingSeconds); });
			document.querySelectorAll<HTMLElement>(`[data-job-status="${job.id}"]`).forEach(node => { node.textContent = production.reason ?? production.status; });
			document.querySelectorAll<HTMLElement>(`[data-job-refund="${job.id}"]`).forEach(node => { node.textContent = productionRefundLabel(job); });
		}
	}
	document.querySelectorAll<HTMLButtonElement>('[data-action="upgrade-room"]').forEach((node) => {
		const quote = getRoomUpgradeQuote(state, node.dataset.id ?? ""); node.disabled = Boolean(quote.reason);
		const note = node.closest('.room-panel-section')?.querySelector<HTMLElement>(`[data-room-upgrade-note="${node.dataset.id}"]`); if (note) note.textContent = quote.reason ?? "Затраты будут списаны при начале улучшения";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="excavate-wall"]').forEach((node) => {
		const quote = getExcavationQuote(state, Number(node.dataset.column), Number(node.dataset.row)); node.disabled = Boolean(quote.reason);
		const note = node.parentElement?.querySelector<HTMLElement>(".quote-note"); if (note) note.textContent = quote.reason ?? "Материалы списываются один раз при начале работ.";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="build-room"]').forEach((node) => {
		const quote = getBuildRoomQuote(state, node.dataset.roomType as ShelterRoomType, Number(node.dataset.column), Number(node.dataset.row)); node.disabled = Boolean(quote.reason);
		const note = document.querySelector<HTMLElement>(`[data-build-room-note="${node.dataset.roomType}"]`); if (note) note.textContent = quote.reason ?? "Оплата при начале; стройка идёт и офлайн";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="place-building"]').forEach(node => {
		const type = node.dataset.roomType as ShelterRoomType, reason = buildingCatalogueReason(state, type);
		node.disabled = Boolean(reason);
		const note = node.closest(".territory-blueprint")?.querySelector<HTMLElement>("[data-blueprint-reason]");
		if (note) note.textContent = reason ?? "Выбери место внутри периметра";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="queue-room-module"]').forEach((node) => {
		const quote = getModuleProductionQuote(state, node.dataset.id ?? "", node.dataset.modelId ?? ""); node.disabled = Boolean(quote.reason);
		const note = node.closest('.room-module-recipe')?.querySelector<HTMLElement>(`[data-room-module-note="${node.dataset.modelId}"]`); if (note) note.textContent = quote.reason ?? "Оплаченный заказ начнётся по очереди";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="set-room-recipe"]').forEach((node) => {
		const quote = getResourceProductionQuote(state, node.dataset.id ?? "", node.dataset.recipeId ?? "");
		const room = state.shelter.rooms.find(item => item.id === node.dataset.id), recipe = RESOURCE_RECIPES.find(item => item.id === node.dataset.recipeId);
		node.disabled = !room || room.status !== "ready" || room.level < (recipe?.minLevel ?? 1) || Boolean(recipe?.lootRequirements?.length&&quote.reason);
		const recipeCard = node.closest('.resource-recipe');
		const eta = recipeCard?.querySelector<HTMLElement>(`[data-recipe-duration="${node.dataset.recipeId}"]`); if (eta) eta.textContent = quote.actualDuration == null ? `Базовая работа ${seconds(quote.duration)}` : `С текущими рабочими ≈ ${seconds(Math.ceil(quote.actualDuration))}`;
		const note = recipeCard?.querySelector<HTMLElement>(`[data-resource-recipe-note="${node.dataset.recipeId}"]`); if (note) note.textContent = quote.reason ?? "Бойцы запустят партию; результат поступит на склад";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="queue-field-kit"]').forEach(node => {
		const kit = node.dataset.kit as FieldKit, quote = getFieldKitProductionQuote(state, node.dataset.id ?? "", kit);
		node.disabled = Boolean(quote.reason);
		const note = node.closest('.resource-recipe')?.querySelector<HTMLElement>(`[data-field-kit-order-note="${FIELD_KITS[kit].recipeId}"]`); if (note) note.textContent = quote.reason ?? "Оплата сейчас. Заказ займёт место в очереди и дождётся работников; цель повторения на него не влияет.";
	});
	const kits = getFieldKitStock(state);
	document.querySelectorAll<HTMLElement>('[data-field-kit-stock]').forEach(node => { const kit = node.dataset.fieldKitStock as keyof typeof kits; node.textContent = `${kits[kit]} / ${FIELD_KITS[kit].capacity}`; });
}
function gearCard(scav: Scav, slot: GearSlot) {
	const level = scav.gear[slot], max = level >= MAX_GEAR_LEVEL, cost = getGearCost(scav, slot);
	const effect = slot === "armor"
		? "Подготовка дополняет защиту выбранной брони и снижает травмы."
		: "Подготовка повышает вместимость выбранного рюкзака и добычу.";
	return `<div class="gear-card"><div class="gear-head">${icon(slot, 22)}<div><strong>${GEAR_LABELS[slot]}</strong><span>УР. ${level} / ${MAX_GEAR_LEVEL}</span></div><div class="gear-pips" aria-label="Уровень ${level} из ${MAX_GEAR_LEVEL}">${Array.from({ length: MAX_GEAR_LEVEL }, (_, i) => `<i class="${i < level ? "filled" : ""}"></i>`).join("")}</div></div><p>${effect}</p><button class="button ghost small" data-action="gear" data-id="${scav.id}" data-slot="${slot}" data-focus-key="gear-${slot}" ${max || scav.status === "raiding" || !canAfford(cost) ? "disabled" : ""}>${max ? "Полный комплект" : `Улучшить · ${costLabel(cost)}`}</button><small class="cost-reason" data-gear-note="${scav.id}" data-slot="${slot}">${scav.status === "raiding" ? "После возвращения" : max ? "Полный комплект" : costReason(cost)}</small></div>`;
}
function autoRaidCard(scav: Scav) {
	const plan = scav.autoRaid, route = MAP_BY_ID[plan.mapId], selected = MAP_BY_ID[selectedMap]!;
	return `<div class="auto-order ${plan.enabled ? "enabled" : ""}"><div class="auto-route">${route ? e(route.name) : "Маршрут не задан"}<span>Выходов: ${n(plan.runs)}</span></div><p data-auto-status="${scav.id}">${e(getAutoRaidStatus(state, scav))}</p><label class="threshold-label">Глубина следующего автовыхода<select data-auto-depth="${scav.id}" data-focus-key="auto-depth" aria-label="Глубина автовыхода для ${e(scav.name)}">${[1,2,3].map((depth) => `<option value="${depth}" ${plan.maxDepth === depth ? "selected" : ""}>${depth} ${depth === 1 ? "этап · ранняя эвакуация" : depth === 2 ? "этапа · умеренный риск" : "этапа · полный маршрут"}</option>`).join("")}</select></label><label class="threshold-label">Выходить при здоровье<select data-auto-health="${scav.id}" data-focus-key="auto-health" aria-label="Порог здоровья для ${e(scav.name)}">${[70,85,100].map((health) => `<option value="${health}" ${plan.minHealth === health ? "selected" : ""}>${health} / 100${health === 70 ? " · обычный" : health === 85 ? " · бережный" : " · полное"}</option>`).join("")}</select></label>${plan.enabled ? `<div class="auto-order-actions"><button class="button ghost small" data-action="auto-route" data-id="${scav.id}" data-focus-key="auto-route">Маршрут: ${e(selected.name)}</button><button class="button danger small" data-action="auto-stop" data-id="${scav.id}" data-focus-key="auto-stop">${icon("stop",12)} Остановить автовыходы</button></div><small>Текущая экспедиция останется в пути. Будущие выходы отменятся.</small>` : `<button class="button secondary small" data-action="auto-enable" data-id="${scav.id}" data-focus-key="auto-enable">${icon("repeat",14)} Автовыходы: ${e(selected.name)}</button><small>Повторяет маршрут и офлайн, эвакуируется на глубине ${plan.maxDepth}. Каждый выход несёт риск.</small>`}</div>`;
}
function activeRaidPanel(raid: Raid) {
	const radio = raid.expedition?.trail.at(-1);
	if (raid.expedition?.status === "choice") return expeditionCard(raid, true);
	return `<div class="active-raid"><div class="active-raid-heading">${icon("raids", 17)}<strong>${e(MAP_BY_ID[raid.mapId]!.name)}</strong><span>${raid.isAuto ? `АВТО · ДО ${raid.expedition?.autoDepth ?? 1}` : "ЭКСПЕДИЦИЯ"}</span></div><div class="raid-time"><span data-raid-phase="${raid.id}">${e(getRaidPhase(raid, Date.now()).label)}</span><strong data-raid-time="${raid.id}">${seconds((raid.endsAt - Date.now()) / 1000)}</strong></div><div class="progress"><i data-raid-progress="${raid.id}"></i></div><p>Этап ${raid.expedition?.stage ?? 1} / ${raid.expedition ? 3 : 1}: ${Math.round(raid.chance * 100)}% успеха · ${e(TACTICS[raid.tactic].label)}. ${raid.expedition ? "В точке связи выбери эвакуацию или путь дальше." : "Старый маршрут завершится по исходным правилам."}</p>${radio ? `<p class="radio-message">${icon("intel",14)} ${e(radio.text)}</p>` : ""}${raid.expedition?.cargo.money ? `<div class="loadout-stats"><span>В рюкзаке: ${n(raid.expedition.cargo.money)} ₽</span><span>Ценность: ≈ ${n(getCargoValue(raid.expedition.cargo))} ₽</span></div>` : ""}</div>`;
}
function loadoutEditor(scav: Scav, trainingExpanded = false) {
	const stats = getLoadoutStats(state, scav), busy = scav.status === "raiding";
	const role = state.weapons.find((weapon) => weapon.id === scav.weaponInstanceId);
	const raid = state.raids.find((item) => item.scavId === scav.id);
	const ammunition = busy
		? ammunitionSnapshot(raid?.expedition?.ammunition?.modelId, true)
		: `<label class="field-label">Боеприпас${role ? ` · ${e(ammunitionCaliberLabel(RECEIVER_INFO[role.weaponId]!.caliber))}` : ""}<select data-ammo-type="${scav.id}" data-focus-key="ammo-type" aria-label="Боеприпас для ${e(scav.name)}" ${!role ? "disabled" : ""}>${ammunitionOptions(role, scav.loadout.ammoType)}</select></label>${ammunitionPanel(role, scav.loadout.ammoType, selectedMap, scav.tactic, { chargedAmmo: getRaidQuote(state, scav, MAP_BY_ID[selectedMap]!).ammo, selectScavId: scav.id, compare: true })}`;
	const options = (["armor", "helmet", "backpack"] as GearEquipmentSlot[]).map((slot) => {
		const itemId = gearLoadoutItemId(scav, slot);
		const item = state.gearItems.find((gear) => gear.id === itemId);
		const model = item ? getGearModel(item) : null;
		return `<label class="field-label">${GEAR_EQUIPMENT_LABELS[slot]}<select data-equip-gear="${scav.id}" data-slot="${slot}" data-focus-key="equip-${slot}" aria-label="${GEAR_EQUIPMENT_LABELS[slot]} для ${e(scav.name)}" ${busy ? "disabled" : ""}><option value="">Без отдельного предмета</option>${state.gearItems.filter((gear) => getGearModel(gear).slot === slot && !state.scavs.some((person) => person.id !== scav.id && scavHasGear(person, gear.id))).map((gear) => `<option value="${gear.id}" ${gear.id === itemId ? "selected" : ""}>${e(getGearModel(gear).label)} · ${Math.round(gear.durability)}%</option>`).join("")}</select></label>${model && item ? `<div class="loadout-item-note"><p>${e(model.description)}</p><small>Состояние ${Math.round(item.durability)}% · вес ${model.weight} кг${model.protection ? ` · защита до ${Math.round(model.protection * 100)}%` : ""}${model.capacity ? ` · вместимость ${model.capacity} ед.` : ""}</small>${item.durability < 100 ? `<button class="button ghost small" data-action="repair-gear" data-id="${item.id}" data-focus-key="repair-${slot}" ${busy || !canAfford(getGearRepairCost(item)) ? "disabled" : ""}>Ремонт · ${costLabel(getGearRepairCost(item))}</button>` : ""}</div>` : '<p class="field-hint">Выбранный предмет меняет защиту, вес и внешний вид бойца.</p>'}`;
	}).join("");
	return `<section class="inspector-section loadout-section"><div class="inspector-section-title"><h3>${busy ? "Комплект в рейде" : "Комплект для выхода"}</h3><button class="text-button" data-action="open-equipment" data-focus-key="equipment-store">Склад и сборка →</button></div><div class="loadout-stats"><span>Вес ${stats.weight.toFixed(1)} кг</span><span>Защита ${Math.round(stats.protection * 100)}%</span><span>Груз до ${stats.capacity.toFixed(1)} ед.</span><span>Время ×${stats.speedMultiplier.toFixed(2)}</span></div>${role ? `<p class="field-hint">${e(getWeaponRole(role).label)}: ${e(getWeaponRole(role).description)}</p>` : ""}${options}${ammunition}${medicalPackEditor(state, scav)}<details class="training-section" ${trainingExpanded ? "open" : ""}><summary data-focus-key="training-summary">Подготовка оснащения · броня ${scav.gear.armor} / рюкзак ${scav.gear.backpack}</summary><p class="field-hint">Постоянная подготовка бойца дополняет выбранные предметы.</p><div class="gear-grid">${gearCard(scav, "armor")}${gearCard(scav, "backpack")}</div></details></section>`;
}
function sortiePreview(scav: Scav) {
	if (page !== "raids" && scav.status !== "raiding") return `<section class="inspector-section sortie-section"><h3>Играть на Периметре</h3><p>В общем рейде боец действует автоматически. Выбери комплект и задачу перед выходом. Люди убежища выполняют отдельные задания.</p><button class="button" data-open-live>В рейд →</button><button class="text-button" data-mission-board>Задания отряда →</button></section>`;
	const map = MAP_BY_ID[selectedMap]!, quote = getRaidQuote(state, scav, map);
	return `<section class="inspector-section sortie-section"><h3>${scav.status === "raiding" ? "Следующая экспедиция" : "Новая экспедиция"}</h3><label class="field-label">Сектор<select data-inspector-map data-focus-key="map" aria-label="Сектор для экспедиции">${MAPS.map((sector) => `<option value="${sector.id}" ${sector.id === selectedMap ? "selected" : ""} ${state.level < sector.level ? "disabled" : ""}>${e(sector.name)}${state.level < sector.level ? ` · ур. ${sector.level}` : ""}</option>`).join("")}</select></label>${raidPlanEditor(state, scav, selectedMap)}${sectorIntelPanel(state, selectedMap)}${raidRelationsPanel(state, scav, selectedMap)}<div class="sortie-preview"><span><strong data-chance="${scav.id}">${Math.round(quote.chance * 100)}% успеха</strong><small>Первый этап</small></span><span><strong>${seconds(quote.duration)}</strong><small>До точки связи</small></span><span><strong data-dispatch-cost="${scav.id}">${n(quote.money)} ₽ + ${quote.ammo} патр.${quote.intel ? ` + ${quote.intel} разв.` : ""}${quote.medicine ? ` + ${quote.medicine} мед.` : ""}</strong><small>На входе</small></span></div><p class="field-hint">До трёх этапов. После каждого — эвакуация или риск дальше. Добыча остаётся в рюкзаке до возвращения; чертежи сохраняются сразу.</p></section>`;
}
function inspectorFooter(scav: Scav, raid: Raid | undefined) {
	if (!raid && page !== "raids") return `<footer class="inspector-actions"><div><strong>Общий Периметр</strong><span>Игроки, NPC и добыча в одном мире</span></div><button class="button" data-open-live>В рейд ${icon("arrow",17)}</button></footer>`;
	if (raid?.squad) return `<footer class="inspector-actions"><div><strong>Совместный рейд · ${getRaidGroup(state, raid).length} бойца</strong><span>Приказ касается всего состава</span></div><button class="button secondary" data-watch-raid="${getRaidGroupKey(raid)}" data-focus-key="party-watch">Наблюдать отряд →</button></footer>`;
	const run = raid?.expedition;
	if (raid && run?.status === "choice") return `<footer class="inspector-actions decision-footer"><div><strong>Точка ${run.stage} / 3 · связь установлена</strong><small class="dispatch-preview">В рюкзаке ≈ ${n(getCargoValue(run.cargo))} ₽</small><span>${run.stage >= 3 ? "Маршрут пройден. Забери добычу на базу" : "Выбери путь выше или возвращайся сейчас"}</span></div><button class="button" data-action="extract" data-id="${raid.id}" data-focus-key="footer-extract">Эвакуация ${icon("check", 17)}</button></footer>`;
	const map = MAP_BY_ID[selectedMap]!, quote = getRaidQuote(state, scav, map);
	return `<footer class="inspector-actions"><div><strong>${raid ? "Боец на маршруте" : e(map.name)}</strong><small class="dispatch-preview"><b data-chance="${scav.id}">${Math.round(quote.chance * 100)}% успеха</b> · <span data-dispatch-cost="${scav.id}">${n(quote.money)} ₽ + ${quote.ammo} патр.${quote.intel ? ` + ${quote.intel} разв.` : ""}${quote.medicine ? ` + ${quote.medicine} мед.` : ""}</span></small><span data-dispatch-note="${scav.id}">${e(quote.reason ?? "Готов к первому этапу")}</span></div><button class="button" data-action="dispatch" data-id="${scav.id}" data-focus-key="dispatch" ${quote.reason ? "disabled" : ""}>Отправить на задание ${icon("arrow", 17)}</button></footer>`;
}
function scavWorkPanel(scav: Scav) {
	const room = state.shelter.rooms.find((item) => item.id === scav.assignment); if (!room) return "";
	return `<div class="room-work-note"><strong>${icon(roomIcon(room.type), 17)} Работает: ${e(ROOM_DEFINITIONS[room.type].label)}</strong><p>Пригодность ${Math.round(getWorkerAffinity(scav, room.type))} / 100. Производство использует навык бойца. Для выхода сначала освободи его; постоянный приказ сможет продолжиться после освобождения.</p><button class="button ghost small" data-action="open-work-room" data-id="${room.id}" data-focus-key="work-room">Управлять рабочим местом →</button><button class="button secondary small" data-action="release-worker" data-id="${scav.id}" data-focus-key="release-work">Освободить для рейда</button></div>`;
}
function scavCard(scav: Scav) {
	const raid = state.raids.find((r) => r.scavId === scav.id);
	const weapon = state.weapons.find((w) => w.id === scav.weaponInstanceId);
	const personality = PERSONALITY_BY_ID[scav.personality]!;
	const ready = !dispatchBlock(scav);
	const waiting = raid?.expedition?.status === "choice";
	const assigned = scav.assignment ? state.shelter.rooms.find((room) => room.id === scav.assignment) : null;
	return `<button class="scav-card ${raid ? "on-mission" : ""} ${selectedScav === scav.id ? "selected" : ""}" data-scav="${scav.id}" aria-label="${waiting ? "Нужен приказ: " : "Открыть бойца "}${e(scav.name)}"><span class="scav-card-top"><span class="scav-avatar">${scavPortrait(scav.personality, scav.name, scav.appearance)}</span><span class="scav-identity"><strong>${e(scav.name)}</strong><span>${e(personality.name)} · ур. ${scav.level}</span></span><span class="scav-state ${assigned ? "working" : waiting ? "decision" : raid ? "away" : ready ? "ready" : "waiting"}">${scav.medicalTreatment ? "Лечится" : assigned && isScavMedicallyReady(scav) ? "На работе" : waiting ? "Приказ" : raid ? "В рейде" : ready ? "Готов" : !isScavMedicallyReady(scav) ? "Ранен" : "На базе"}</span></span><span class="scav-card-body"><span class="scav-weapon">${icon("arsenal", 17)} ${weapon ? e(getWeaponDefinition(weapon).name) : "Без оружия"}</span><span class="scav-health"><span>Здоровье <b data-health="${scav.id}">${Math.floor(scav.health)} / 100</b></span><span class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></span></span>${raid ? `<span class="scav-raid"><span><b>${e(MAP_BY_ID[raid.mapId]!.name)}${raid.expedition ? ` · этап ${raid.expedition.stage}/3` : ""}</b><strong data-raid-time="${raid.id}">${waiting ? "ПРИКАЗ" : seconds((raid.endsAt - Date.now()) / 1000)}</strong></span><span class="progress"><i data-raid-progress="${raid.id}"></i></span><small data-raid-phase="${raid.id}">${e(getRaidPhase(raid, Date.now()).label)}</small></span>` : `<span class="scav-idle-note">${assigned ? `${icon(roomIcon(assigned.type),13)} ${e(ROOM_DEFINITIONS[assigned.type].label)} · рабочий` : scav.autoRaid.enabled ? `${icon("repeat", 13)} ${e(MAP_BY_ID[scav.autoRaid.mapId]!.name)} · глубина ${scav.autoRaid.maxDepth}` : `${icon("backpack", 13)} ${getLoadoutStats(state, scav).capacity.toFixed(1)} ед. груза · ${getLoadoutStats(state, scav).weight.toFixed(1)} кг экип.`}</span>`}</span><span class="scav-card-bottom"><span>${waiting ? raid.expedition!.stage >= 3 ? "Вернуть бойца с добычей →" : "Эвакуация или ещё один этап →" : "Снаряжение и приказ"}</span>${icon("arrow", 16)}</span></button>`;
}
function openInspector(id: string) {
	if (!state.scavs.some((scav) => scav.id === id)) return;
	inspectorOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	selectedScav = id;
	inspectorVisible = true;
	fieldObjects?.close();
	page = "home";
	document.querySelector<HTMLElement>("#tool-root")!.hidden = true;
	renderInspector();
	setOverlayState();
	document.querySelector<HTMLButtonElement>('[data-action="close-inspector"]')?.focus();
}
function closeInspector() {
	const closedId = selectedScav;
	inspectorVisible = false;
	document.querySelector("#inspector-root")!.innerHTML = "";
	setOverlayState();
	if (inspectorOrigin?.isConnected && !inspectorOrigin.closest("[inert]")) inspectorOrigin.focus();
	else focusScavOrTool(closedId ?? "");
}
function focusScavOrTool(id: string) {
	if (page === "home" && worldView === "raid") { document.querySelector<HTMLElement>('.live-raid-scroll')?.scrollTo({ top: 0 }); document.querySelector<HTMLSelectElement>('[data-live-raid-select]')?.focus({ preventScroll: true }); return; }
	if (page === "home" && isContextDialogOpen()) { document.querySelector<HTMLButtonElement>('#command-dock [data-action="close-context"]')?.focus({ preventScroll: true }); return; }
	const scope = page !== "home" ? document.querySelector<HTMLElement>("#tool-root") : document.querySelector<HTMLElement>("#command-crew");
	const target = scope?.querySelector<HTMLButtonElement>(`[data-scav="${CSS.escape(id)}"]`);
	if (target?.getClientRects().length) target.focus({ preventScroll: true });
	else if (page !== "home") document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus({ preventScroll: true });
	else document.querySelector<HTMLButtonElement>('.command-tools [data-page="raids"]')?.focus({ preventScroll: true });
}
function renderInspector() {
	const root = document.querySelector<HTMLDivElement>("#inspector-root")!;
	if (!isInspectorOpen()) { root.innerHTML = ""; setOverlayState(); return; }
	const scav = state.scavs.find((item) => item.id === selectedScav);
	if (!scav) { closeInspector(); return; }
	const oldScroll = root.querySelector(".inspector-scroll")?.scrollTop ?? 0;
	const oldAmmoScroll = root.querySelector(".ammunition-cards")?.scrollLeft ?? 0;
	const ammoDetails = { compare: root.querySelector<HTMLDetailsElement>(".ammunition-comparison")?.open ?? false, routes: root.querySelector<HTMLDetailsElement>(".ammunition-route-details")?.open ?? false };
	const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
	const focusKey = active?.dataset.focusKey;
	const autoExpanded = root.querySelector<HTMLDetailsElement>(".order-section")?.open;
	const trainingExpanded = root.querySelector<HTMLDetailsElement>(".training-section")?.open;
	const socialExpanded = Array.from(root.querySelectorAll<HTMLDetailsElement>('details[data-social-detail-key][open]')).map(node => node.dataset.socialDetailKey);
	const raid = state.raids.find((r) => r.scavId === scav.id);
	const weapon = state.weapons.find((w) => w.id === scav.weaponInstanceId);
	root.innerHTML = `<div class="inspector-backdrop"><aside class="inspector" role="region" aria-labelledby="scav-title"><div class="inspector-head"><div><span class="eyebrow">Личное дело · ур. ${scav.level}</span><h2 id="scav-title">${e(scav.name)}</h2></div><button class="icon-button" data-action="close-inspector" data-focus-key="close" aria-label="Закрыть бойца">×</button></div><div class="inspector-scroll">${raid?.expedition?.status === "choice" ? activeRaidPanel(raid) : ""}<div class="scav-profile"><div class="inspector-portrait">${scavPortrait(scav.personality, scav.name, scav.appearance)}</div><div><strong>${e(PERSONALITY_BY_ID[scav.personality]!.name)}</strong><p>${e(PERSONALITY_BY_ID[scav.personality]!.description)}</p><div class="profile-stats"><span>Бой <b>${scav.combat}</b></span><span>Поиск <b>${scav.scouting}</b></span><span>Выходы <b>${scav.raids}</b></span></div></div></div>${scavStoryPanel(state, scav)}${scavRelationsPanel(state, scav)}${scavRecruitmentPanel(state, scav)}${scav.assignment ? scavWorkPanel(scav) : ""}${scavHealthPanel(state, scav)}${raid && raid.expedition?.status !== "choice" ? activeRaidPanel(raid) : ""}<section class="inspector-section"><div class="inspector-section-title"><h3>Оружие</h3>${weapon ? `<button class="text-button" data-action="inspect-weapon" data-id="${weapon.id}" data-focus-key="weapon-detail">Оружейный верстак →</button>` : ""}</div>${weapon ? `<div class="equipped-art" style="--rarity:${RARITY_COLORS[getWeaponDefinition(weapon).rarity]}">${weaponBuildArt(weapon)}<span><b>${e(getWeaponDefinition(weapon).name)}</b><small>Мощь ${getWeaponPower(weapon)} · состояние ${Math.round(weapon.durability)}%</small>${weaponReadiness(weapon)}<a class="text-button" href="${e(pixelArsenalPreviewUrl(weapon, scav.appearance))}" target="_blank" rel="noopener noreferrer">Посмотреть на бойце ↗</a></span></div>` : '<p class="field-hint">Для выхода нужен исправный ствол из арсенала.</p>'}<label class="field-label">${raid ? "Оружие занято в рейде" : "Выдать оружие"}<select aria-label="Оружие для ${e(scav.name)}" data-equip="${scav.id}" data-focus-key="weapon" ${raid ? "disabled" : ""}><option value="">Без оружия</option>${state.weapons.filter((w) => !state.scavs.some((s) => s.id !== scav.id && s.weaponInstanceId === w.id)).map((w) => `<option value="${w.id}" ${w.id === scav.weaponInstanceId ? "selected" : ""}>${e(getWeaponDefinition(w).name)} · ${Math.round(w.durability)}%${getWeaponStats(w).ready ? "" : " · не собрано"}</option>`).join("")}</select></label></section><section class="inspector-section"><h3>${raid ? "Тактика следующего выхода" : "Тактика"}</h3><div class="tactics" role="group" aria-label="Тактика для ${e(scav.name)}">${(Object.keys(TACTICS) as RaidTactic[]).map((tactic) => `<button class="${tactic === scav.tactic ? "active" : ""}" data-action="tactic" data-id="${scav.id}" data-tactic-value="${tactic}" data-focus-key="tactic-${tactic}" aria-pressed="${scav.tactic === tactic}">${TACTICS[tactic].label}</button>`).join("")}</div><p class="field-hint">${e(TACTICS[scav.tactic].description)}</p></section>${loadoutEditor(scav, trainingExpanded)}${sortiePreview(scav)}<details class="order-section" ${autoExpanded ?? scav.autoRaid.enabled ? "open" : ""}><summary data-focus-key="order-summary">${icon("repeat", 18)}<span>Постоянный приказ<small>${scav.autoRaid.enabled ? `${e(MAP_BY_ID[scav.autoRaid.mapId]!.name)} · включён` : "Повторять выходы автоматически"}</small></span><b>${scav.autoRaid.enabled ? "ВКЛ" : "+"}</b></summary>${autoRaidCard(scav)}</details></div>${inspectorFooter(scav, raid)}</aside></div>`;
	root.querySelectorAll<HTMLDetailsElement>('details[data-social-detail-key]').forEach(node => { node.open = socialExpanded.includes(node.dataset.socialDetailKey); });
	const ammoCards = root.querySelector<HTMLElement>(".ammunition-cards"); if (ammoCards) ammoCards.scrollLeft = oldAmmoScroll;
	const ammoComparison = root.querySelector<HTMLDetailsElement>(".ammunition-comparison"), ammoRoutes = root.querySelector<HTMLDetailsElement>(".ammunition-route-details");
	if (ammoComparison) ammoComparison.open = ammoDetails.compare;
	if (ammoRoutes) ammoRoutes.open = ammoDetails.routes;
	const scroll = root.querySelector<HTMLElement>(".inspector-scroll"); if (scroll) scroll.scrollTop = oldScroll;
	if (focusKey) {
		const replacement = root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
		if (replacement && !(replacement instanceof HTMLButtonElement && replacement.disabled)) replacement.focus({ preventScroll: true });
		else root.querySelector<HTMLButtonElement>('[data-action="close-inspector"]')?.focus({ preventScroll: true });
	}
	setOverlayState();
}
function setOverlayState() {
	fieldInterface?.sync();
	if (buildingDragPreview?.active && !canBuildingDrag()) world?.cancelBuildingDrag();
	paintBuildingPlacement();
	const modalOpen = accountDialogOpen || accountChanging || Boolean(document.querySelector("#modal-root .modal"));
	const drawerOpen = isInspectorOpen();
	const toolsOpen = page !== "home";
	const mobileContext = isContextDialogOpen();
	if (modalOpen || drawerOpen || toolsOpen || mobileContext) updateSceneHover(null);
	if (!canWorldDrag()) cancelWorkerPlacement(false, true);
	if (!canWorldCamera()) world?.cancelCameraGesture();
	updateCameraControls();
	const contextIdentity = mobileContext ? `${contextMode}:${selectedRoomId ?? ""}:${selectedShelterSite?.column ?? ""}:${selectedShelterSite?.row ?? ""}` : "";
	const signature = `${modalOpen}:${selectedScav ?? ""}:${page}:${contextIdentity}`;
	if (signature !== worldOverlaySignature) {
		worldOverlaySignature = signature;
		holdWorldInput();
	}
	const shell = document.querySelector<HTMLElement>(".shell")!;
	shell.inert = (!liveMode?.isActive() && (!serverReady || saveConflict || protectedSave)) || modalOpen;
	document.querySelector<HTMLElement>(".command-tools")!.inert = !serverReady || saveConflict || protectedSave || modalOpen;
	const tools = document.querySelector<HTMLElement>("#tool-root")!; tools.inert = !serverReady || saveConflict || protectedSave || modalOpen;
	document.querySelector<HTMLElement>('#inspector-root')!.inert = !serverReady || saveConflict || protectedSave;
	for (const selector of [".command-hud", ".command-toolbar", "#command-crew", "#command-routes", ".field-controls", ".field-launch"]) document.querySelector<HTMLElement>(selector)!.inert = modalOpen;
	document.querySelector<HTMLElement>(".field-raid-status")?.toggleAttribute("inert", modalOpen);
	const drawer = document.querySelector<HTMLElement>(".inspector"); if (drawer) drawer.inert = modalOpen;
	document.body.classList.toggle("overlay-open", modalOpen);
	document.body.classList.toggle("field-tools-open", toolsOpen);
	document.body.classList.toggle("field-inspector-open", drawerOpen);
	document.querySelector<HTMLElement>("#hero")!.inert = toolsOpen || mobileContext;
	const objectLayer = document.querySelector<HTMLElement>("#field-object-layer"); if (objectLayer) objectLayer.hidden = toolsOpen || drawerOpen || liveMode?.isActive() === true || worldView !== "base";
	territoryLife?.refresh();
}
function closeModal() {
	barterDraft = null;
	document.querySelector("#modal-root")!.innerHTML = "";
	setOverlayState();
	if (modalOrigin?.isConnected) modalOrigin.focus();
	else if (isInspectorOpen()) document.querySelector<HTMLButtonElement>('[data-action="close-inspector"]')?.focus();
}
function focusModal() {
	modalOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	setOverlayState();
	document.querySelector<HTMLButtonElement>("#modal-root button")?.focus();
}
function openRoom(room: BaseRoom) {
	const target = state.shelter.rooms.find((item) => item.type === room);
	if (target) openShelterRoom(target.id);
	else { roomToolOpen = false; page = "base"; render(); }
}
function openShelterRoom(id: string, requestedTab?: CommandRoomTab) {
	if (buildingPlacement) { const room = state.shelter.rooms.find(item => item.id === id); if (room) { const position = getRoomPosition(room); chooseFreeBuildingSite(position.x, position.y); } return; }
	const room = state.shelter.rooms.find((item) => item.id === id); if (!room) return;
	if (contextMode !== "room" || selectedRoomId !== id) gameSound.play("select");
	const roomOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	if (room.type === "workshop") productionWorkshopId = id;
	inspectorVisible = false;
	fieldObjects?.close();
	selectedRoomId = id;
	selectedShelterSite = null;
	contextMode = "room";
	roomContextTab = ROOM_DEFINITIONS[room.type].production ? requestedTab ?? "staff" : "upgrade";
	commandOrigin = roomOrigin;
	roomToolOpen = Boolean(liveMode?.isActive()) || worldView !== "base" || page !== "home";
	page = roomToolOpen ? "base" : "home";
	document.body.classList.add("field-dock-open");
	document.body.classList.remove("field-dock-collapsed");
	render();
	activeRoomPanelScroll()?.scrollTo({ top: 0 });
	activeRoomPanel().querySelector<HTMLButtonElement>('[data-action="close-context"]')?.focus({ preventScroll: true });
}
function activeRoomPanel(): HTMLElement {
	return roomToolOpen && page === "base" ? panel : document.querySelector<HTMLElement>("#command-dock")!;
}
function activeRoomPanelScroll(root = activeRoomPanel()): HTMLElement | null {
	return root.closest<HTMLElement>(".tool-scroll") ?? root.querySelector<HTMLElement>("[data-room-management]");
}
function renderActiveRoomPanel(): HTMLElement {
	const root = activeRoomPanel();
	if (root === panel) {
		const oldScroll = activeRoomPanelScroll(root)?.scrollTop ?? 0;
		const openLogistics = Array.from(root.querySelectorAll<HTMLDetailsElement>('details[data-logistics-detail][open]')).map(node => node.dataset.logisticsDetail);
		renderShelter();
		const scroll = activeRoomPanelScroll(root); if (scroll) scroll.scrollTop = oldScroll;
		root.querySelectorAll<HTMLDetailsElement>('details[data-logistics-detail]').forEach(node => { node.open = openLogistics.includes(node.dataset.logisticsDetail); });
	} else renderCommandBoard();
	return root;
}
function commandSummaryKey(summary: CommandSummary) {
	return JSON.stringify([getGameplayGuidance(state), summary.counts, summary.queuedJobs, summary.freeWorkers, summary.rooms.map((room) => [room.roomId, room.kind, room.title, room.detail, room.cta]), state.scavs.map(scav => [scav.id, scav.story.pending?.eventId, scav.status]), getSocialPresentationKey(state)]);
}
function focusCommandControl(key: string) {
	const dock = document.querySelector<HTMLElement>("#command-dock");
	const keyed = dock?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
	const fallback = dock?.querySelector<HTMLElement>('[data-focus-key="command-production"]');
	const target = [keyed, fallback].find((node) => node?.isConnected && node.getClientRects().length > 0 && !node.closest("[inert]"));
	if (target) {
		target.focus({ preventScroll: true });
		target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
	}
}
function refreshCommandOverview(summary: CommandSummary) {
	if (liveMode?.isActive() || worldView === "raid" || contextMode !== "overview" || interacting() || commandSummaryKey(summary) === commandSummarySignature) return;
	const dock = document.querySelector<HTMLElement>("#command-dock"); if (!dock) return;
	const activeKey = document.activeElement instanceof HTMLElement && dock.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
	const stripScroll = dock.querySelector<HTMLElement>(".command-system-grid")?.scrollLeft ?? 0;
	const explanationOpen = dock.querySelector<HTMLDetailsElement>(".gameplay-explanation")?.open ?? false;
	dock.innerHTML = commandOverview(summary);
	const explanation = dock.querySelector<HTMLDetailsElement>(".gameplay-explanation"); if (explanation) explanation.open = explanationOpen;
	const strip = dock.querySelector<HTMLElement>(".command-system-grid"); if (strip) strip.scrollLeft = stripScroll;
	if (activeKey) focusCommandControl(activeKey);
}
function openShelterSite(column: number, row: number) {
	if (buildingPlacement) { chooseBuildingSite(column, row); return; }
	const occupied = getShelterRoomAt(state.shelter, column, row);
	if (occupied) { openShelterRoom(occupied.id); return; }
	if (contextMode !== "build" || selectedShelterSite?.column !== column || selectedShelterSite?.row !== row) gameSound.play("select");
	closeInspector();
	selectedShelterSite = { column, row };
	selectedRoomId = null;
	contextMode = "build";
	commandOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	page = "home";
	render();
	setView("base");
	document.querySelector<HTMLButtonElement>('[data-action="close-context"]')?.focus({ preventScroll: true });
}
function closeCommandContext() {
	if (roomToolOpen && page !== "home") { closeTools(); return; }
	fieldInterface?.closePanel("dock");
	setOverlayState();
	if (commandOrigin?.isConnected && commandOrigin.getClientRects().length && !commandOrigin.closest("[inert]")) commandOrigin.focus({ preventScroll: true });
	else if (commandOrigin?.dataset.focusKey) focusCommandControl(commandOrigin.dataset.focusKey);
	else document.querySelector<HTMLButtonElement>('[data-page="base"]')?.focus({ preventScroll: true });
}
function placementPoint() {
	if (!buildingPlacement) return null;
	return buildingPlacement.point ?? (buildingPlacement.site ? shelterRoomPosition(buildingPlacement.site.column, buildingPlacement.site.row) : null);
}
function placementReason(): string | null {
	const point = placementPoint(); if (!buildingPlacement || !point) return null;
	const { type, roomId, rotation, facing } = buildingPlacement;
	return roomId ? getRoomFreePlacementReason(state, roomId, point.x, point.y, rotation, facing) : getFreeBuildRoomQuote(state, type, point.x, point.y, rotation, facing).reason;
}
function paintBuildingPlacement() {
	const banner = document.querySelector<HTMLElement>("#building-placement");
	if (!banner) return;
	banner.hidden = !buildingPlacement || worldView !== "base";
	document.body.classList.toggle("placing-building", Boolean(buildingPlacement));
	if (!buildingPlacement) { world?.setBuildingPlacement(null); return; }
	const focus = banner.contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement.dataset.action : null;
	banner.innerHTML = buildingPlacementControls(buildingPlacement, placementReason(), state);
	if (buildingPlacementBusy) banner.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
	const size = getRoomFootprint(buildingPlacement), point = placementPoint();
	world?.setBuildingPlacement({ type: buildingPlacement.type, roomId: buildingPlacement.roomId, rotation: buildingPlacement.rotation, facing: buildingPlacement.facing ?? 0, ...size, ...(point ?? {}) });
	if (focus) banner.querySelector<HTMLElement>(`[data-action="${focus}"]`)?.focus({ preventScroll: true });
}
function cancelBuildingPlacement() {
	buildingPlacement = null;
	paintBuildingPlacement();
}
function beginBuildingPlacement(type: ShelterRoomType, roomId?: string) {
	cancelWorkerPlacement(); world?.cancelBuildingDrag();
	const room = roomId ? state.shelter.rooms.find(item => item.id === roomId) : null;
	if (roomId && (!room || room.status !== "ready")) { toast("Дождись готовности постройки.", false); return; }
	closeInspector();
	page = "home"; contextMode = "overview"; selectedShelterSite = null;
	buildingPlacement = { type, ...(roomId ? { roomId } : {}), rotation: room?.rotation ?? 0, facing: room ? getRoomFacing(room) : 0, site: null, point: room ? getRoomPosition(room) : null };
	fieldInterface?.closePanels();
	render(); setView("base"); world?.setPanMode(false);
	paintBuildingPlacement(); worldViewport.focus({ preventScroll: true });
}
function chooseBuildingSite(column: number, row: number) {
	const point = shelterRoomPosition(column, row);
	chooseFreeBuildingSite(point.x, point.y);
}
function chooseFreeBuildingSite(x: number, y: number) {
	if (!buildingPlacement || buildingPlacementBusy) return;
	buildingPlacement.point = { x, y }; buildingPlacement.site = null;
	if (page !== "home") closeTools();
	paintBuildingPlacement();
	const reason = placementReason();
	if (reason) toast(reason, false);
	else document.querySelector<HTMLButtonElement>('[data-action="placement-confirm"]')?.focus({ preventScroll: true });
}
function nudgeBuildingPlacement(dx: number, dy: number) {
	if (!buildingPlacement || buildingPlacementBusy) return;
	const first = getShelterSites(state.shelter)[0] ?? { column: 0, row: 0 };
	const point = placementPoint() ?? shelterRoomPosition(first.column, first.row);
	buildingPlacement.point = { x: point.x + dx, y: point.y + dy }; buildingPlacement.site = null;
	paintBuildingPlacement();
}
async function confirmBuildingPlacement() {
	const point = placementPoint();
	if (!buildingPlacement || !point || buildingPlacementBusy) return;
	const reason = placementReason(); if (reason) { toast(reason, false); paintBuildingPlacement(); return; }
	const draft = buildingPlacement;
	buildingPlacementBusy = true; paintBuildingPlacement();
	try {
		const result = await gameAction(draft.roomId ? { type: "placeRoom", args: [draft.roomId, point.x, point.y, draft.rotation, draft.facing ?? 0] } : { type: "constructRoom", args: [draft.type, point.x, point.y, draft.rotation, draft.facing ?? 0] });
		if (result.ok) {
			cancelBuildingPlacement();
			selectedRoomId = draft.roomId ?? getShelterRoomAtPoint(state.shelter, point.x + 1, point.y + 1)?.id ?? null;
			selectedShelterSite = null; contextMode = "room"; roomContextTab = "upgrade";
		}
		act(result, "build");
	} finally { buildingPlacementBusy = false; paintBuildingPlacement(); }
}
function canBuildingDrag() {
	return canWorldInteract() && !buildingPlacement && !workerPlacement && !crewPointer && !gameCommandPending;
}
function onBuildingDragState(preview: typeof buildingDragPreview) {
	buildingDragPreview = preview;
	const readout = document.querySelector<HTMLElement>("#building-drag-status");
	if (!readout) return;
	readout.hidden = !preview?.active;
	document.body.classList.toggle("dragging-building", Boolean(preview?.active));
	if (!preview?.active) return;
	const room = state.shelter.rooms.find(item => item.id === preview.roomId);
	readout.textContent = preview.reason ?? `${room ? ROOM_DEFINITIONS[room.type].label : "Постройка"}: отпусти, чтобы разместить · R — поворот`;
	readout.classList.toggle("invalid", Boolean(preview.reason));
}
async function placeDraggedBuilding(roomId: string, x: number, y: number, rotation: 0 | 1, facing: 0 | 1 | 2 | 3) {
	if (!serverReady || gameCommandPending) return;
	const result = await gameAction({ type: "placeRoom", args: [roomId, x, y, rotation, facing] });
	if (result.ok) selectedRoomId = roomId;
	act(result, "build");
}
function closeTools() {
	const closedPage = page;
	if (closedPage === 'achievements') freshAchievements.clear();
	page = "home";
	render();
	if (isContextDialogOpen()) document.querySelector<HTMLButtonElement>('#command-dock [data-action="close-context"]')?.focus({ preventScroll: true });
	else if (toolOrigin?.isConnected && !toolOrigin.closest("[inert]") && toolOrigin.getClientRects().length) toolOrigin.focus({ preventScroll: true });
	else document.querySelector<HTMLButtonElement>(`.command-tools [data-page="${closedPage}"]`)?.focus({ preventScroll: true });
}
function openRecruitment() {
	toolOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	page = "recruits";
	render();
	document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus({ preventScroll: true });
}
function showScavDismissal(scavId: string) {
	const scav = state.scavs.find(item => item.id === scavId);
	const reason = getDismissScavReason(state, scavId);
	if (!scav || reason) { toast(reason ?? "Боец не найден.", false); return; }
	document.querySelector('#modal-root')!.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="dismiss-title"><h2 id="dismiss-title">Отпустить ${e(scav.name)}?</h2><p>Боец уйдёт со своими личными талантами. Оружие, броня и рюкзак останутся в твоём арсенале. Стоимость найма не возвращается.</p><p>Связи и открытия отряда сохраняются. Можно будет выбрать нового кандидата на освободившееся место.</p><div class="detail-actions"><button class="button danger" data-action="confirm-dismiss-scav" data-id="${e(scavId)}">Отпустить бойца</button><button class="button ghost" data-action="close-modal">Оставить в отряде</button></div></section></div>`;
	focusModal();
}
function roomIcon(type: ShelterRoomType) {
	return type === "workshop" || type === "recycler" ? "scrap" : type === "ammo" ? "ammo" : type === "medbay" ? "medicine" : type === "radio" ? "intel" : type === "dormitory" ? "people" : "arsenal";
}
function roomName(id: string | null) {
	const room = state.shelter.rooms.find((item) => item.id === id);
	return room ? ROOM_DEFINITIONS[room.type].label : "Комната";
}
function shelterHomeNote() {
	const busy = state.shelter.rooms.filter((room) => room.queue.length || room.recipeId);
	const working = state.scavs.filter((scav) => scav.assignment).length;
	const blocked = busy.filter((room) => getRoomProductionState(state, room).reason).length;
	return `<div class="shelter-home-note"><div><span class="eyebrow">Жизнь убежища</span><h3>${working ? `${working} бойцов на рабочих местах` : "Комнатам нужны свои люди"}</h3><p>${blocked ? `${blocked} производств ждут работников, расходников, разрешения резерва или места на складе.` : busy.length ? `Настроено производств: ${busy.length}. Готовые партии поступают на склад.` : "Назначь бойцов, выбери рецепты и поставь оружейные модули в очередь мастерской."}</p></div><button class="button secondary" data-page="base">Управлять комнатами ${icon("arrow", 16)}</button></div>${fieldKitStockPanel(state, true)}`;
}
function renderCommandBoard() {
	if (liveMode?.isActive()) { liveMode.refreshPanel(); return; }
	cancelWorkerPlacement(false, true);
	const dock = document.querySelector<HTMLElement>("#command-dock")!;
	const room = state.shelter.rooms.find((item) => item.id === selectedRoomId);
	const oldScroll = (dock.querySelector<HTMLElement>(".command-dock-scroll, .live-raid-scroll") ?? dock).scrollTop;
	const explanationOpen = dock.querySelector<HTMLDetailsElement>(".gameplay-explanation")?.open ?? false;
	const openLogistics = Array.from(dock.querySelectorAll<HTMLDetailsElement>('details[data-logistics-detail][open]')).map(node => node.dataset.logisticsDetail);
	const activeKey = document.activeElement instanceof HTMLElement && dock.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
	const mobileContext = isContextDialogOpen();
	dock.classList.toggle("context-open", contextMode !== "overview");
	dock.classList.toggle("raid-dock", worldView === "raid");
	dock.classList.toggle("gameplay-overview", worldView !== "raid" && contextMode === "overview");
	dock.setAttribute("role", "complementary");
	if (mobileContext) { dock.removeAttribute("aria-modal"); dock.setAttribute("aria-label", contextMode === "build" ? "Строительство комнаты" : "Управление комнатой"); }
	else { dock.removeAttribute("aria-modal"); dock.setAttribute("aria-label", "Сводка и управление объектом"); }
	dock.innerHTML = worldView === "raid" ? renderLiveRaidPanel(state, watchedRaid(), watchedReport(), liveCheckpointControls(watchedRaid())) : contextMode === "room" && room ? managedRoomPanel(room) : contextMode === "build" && selectedShelterSite ? `<header class="command-context-head"><span class="eyebrow">Территория базы</span><button class="icon-button" data-action="close-context" data-focus-key="context-close" aria-label="Закрыть строительство">×</button></header><div class="command-dock-scroll">${buildSitePanel(selectedShelterSite.column, selectedShelterSite.row)}</div>` : commandOverview();
	const scroll = dock.querySelector<HTMLElement>(".command-dock-scroll, .live-raid-scroll") ?? dock; scroll.scrollTop = oldScroll;
	const explanation = dock.querySelector<HTMLDetailsElement>(".gameplay-explanation"); if (explanation) explanation.open = explanationOpen;
	dock.querySelectorAll<HTMLDetailsElement>('details[data-logistics-detail]').forEach(node => { node.open = openLogistics.includes(node.dataset.logisticsDetail); });
	fieldInterface?.sync();
	if (activeKey) {
		const replacement = dock.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(activeKey)}"]`);
		if (replacement?.getClientRects().length && !replacement.closest("[inert]")) replacement.focus({ preventScroll: true });
		else if (contextMode === "overview") focusCommandControl(activeKey);
	}
	document.querySelector<HTMLElement>("#context-shade")!.hidden = !mobileContext;
	const crew = document.querySelector<HTMLElement>("#command-crew")!;
	const crewScroll = crew.querySelector<HTMLElement>(".command-crew-strip")?.scrollLeft ?? 0;
const crewEvents = getSquadSocialEvents(state);
	const focusedWorker = document.activeElement instanceof HTMLElement && crew.contains(document.activeElement) ? document.activeElement.dataset.workerHandle ?? document.activeElement.dataset.scav : null;
	const crewFocusKey = document.activeElement instanceof HTMLElement && crew.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
	const focusWasHandle = document.activeElement instanceof HTMLElement && Boolean(document.activeElement.dataset.workerHandle);
	crew.innerHTML = `<div class="command-strip-head"><h2>Свои люди <span>${state.scavs.length} / ${getScavCapacity(state)}</span><small class="crew-drag-help">Перенеси портрет в комнату</small></h2><button class="text-button" data-mission-board>Снаряжение отряда →</button><button class="icon-button" data-field-close="crew" data-focus-key="field-close-crew" aria-label="Свернуть панель людей">×</button></div><div class="command-crew-strip">${state.scavs.map((scav) => {
		const raid = state.raids.find((item) => item.scavId === scav.id), working = scav.assignment ? state.shelter.rooms.find((item) => item.id === scav.assignment) : null;
		const waiting = raid?.expedition?.status === "choice";
		const pickReason = workerPickReason(scav.id);
const sharedEvent = crewEvents.find(event => event.scavIds.includes(scav.id));
		return `<div class="crew-chip ${waiting ? "awaits-order" : ""} ${working ? "on-duty" : ""}" data-worker-card="${scav.id}"><button class="crew-inspect" data-scav="${scav.id}" aria-label="${e(scav.name)}: ${waiting ? "ждёт приказа" : working ? `работает: ${e(ROOM_DEFINITIONS[working.type].label)}` : raid ? "в рейде" : "на базе"}"><span class="crew-portrait" data-portrait-scav="${scav.id}">${scavPortrait(scav.personality, scav.name, scav.appearance)}<b>${scav.level}</b></span><span class="crew-chip-copy"><strong>${e(scav.name)}</strong><small>${waiting ? "Нужен приказ" : scav.medicalTreatment ? "Лечится" : working && isScavMedicallyReady(scav) ? e(ROOM_DEFINITIONS[working.type].label) : raid ? e(MAP_BY_ID[raid.mapId]!.name) : !isScavMedicallyReady(scav) ? "Восстанавливается" : "На базе"}</small><span class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></span></span>${waiting ? `<span class="crew-alert">!</span>` : sharedEvent ? `<span class="crew-alert" title="${e(sharedEvent.title)}" aria-label="Совместное событие ждёт ответа">${icon("squad",12)}</span>` : scav.story.pending && !raid ? `<span class="crew-alert" title="Хочет поговорить" aria-label="Личное событие">◇</span>` : getScavTalentOffers(scav) && !raid ? `<span class="crew-alert" title="Можно выбрать личный талант" aria-label="Доступен новый талант">↑</span>` : ""}</button><button class="crew-assign-handle" data-worker-handle="${scav.id}" aria-disabled="${Boolean(pickReason)}" aria-label="Назначить ${e(scav.name)} в комнату${pickReason ? `: ${e(pickReason)}` : ". Перетащи или выбери комнату"}" title="${e(pickReason ?? "Перетащи в комнату или нажми для выбора")}">${icon("people",15)}<span aria-hidden="true">⠿</span></button></div>`;
	}).join("")}<button class="crew-recruit" data-action="recruit" aria-label="Найм диких: посмотреть кандидатов" title="Выбрать нового дикого и посмотреть связи">${icon("people",23)}<span>Найм</span><small>${getRecruitmentBoard(state).length} на связи</small></button></div>`;
	const crewStrip = crew.querySelector<HTMLElement>(".command-crew-strip"); if (crewStrip) crewStrip.scrollLeft = crewScroll;
	if (focusedWorker) crew.querySelector<HTMLElement>(`[data-${focusWasHandle ? "worker-handle" : "scav"}="${CSS.escape(focusedWorker)}"]`)?.focus({ preventScroll: true });
	if (crewFocusKey) crew.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(crewFocusKey)}"]`)?.focus({ preventScroll: true });
	const routes = document.querySelector<HTMLElement>("#command-routes")!;
	const routesFocusKey = document.activeElement instanceof HTMLElement && routes.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
	routes.innerHTML = `<div class="command-strip-head"><h2>Общий Периметр</h2><button class="text-button" data-open-live>Подготовить выход →</button><button class="icon-button" data-field-close="routes" data-focus-key="field-close-routes" aria-label="Свернуть маршруты">×</button></div><div class="command-sector-strip">${ENTRY_DISTRICTS.map(district => `<button class="sector-chip" data-live-district="${district.id}" aria-label="Подготовить выход: ${district.name}"><span class="sector-chip-art" aria-hidden="true">${district.symbol}</span><span><strong>${district.name}</strong><small>${district.detail}</small></span>${icon("arrow",12)}</button>`).join("")}</div><button class="text-button" data-mission-board>Задания отряда · ${state.raids.length} в пути →</button>`;
	if (routesFocusKey) routes.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(routesFocusKey)}"]`)?.focus({ preventScroll: true });
}
function commandNextAction(item: RoomCommandStatus) {
	const room = state.shelter.rooms.find((candidate) => candidate.id === item.roomId); if (!room) return "";
	const name = ROOM_DEFINITIONS[room.type].label;
	return `<button class="command-next-action next-${item.kind}" data-command-room="${room.id}" data-command-tab="${item.tab}" data-focus-key="command-next-${room.id}-${item.kind}" aria-label="${e(name)}: ${e(item.title)}. ${e(item.cta)}" title="${e(item.detail)}"><span class="command-next-mark" aria-hidden="true">${icon(roomIcon(room.type),17)}</span><span class="command-next-copy"><strong>${e(name)} · ${e(item.title)}</strong><small>${e(item.cta)} ${icon("arrow",12)}</small></span></button>`;
}
function commandOverview(summary = getCommandSummary(state)) {
	commandSummarySignature = commandSummaryKey(summary);
	const running = summary.counts.running;
	const waiting = summary.attention.length;
	const staffed = state.scavs.filter((scav) => scav.assignment).length;
	const ready = CONTRACTS.filter((contract) => !state.claimedContracts.includes(contract.id) && !getContractLockReason(state, contract) && getContractProgress(state, contract) >= contract.target);
	const last = state.history[0];
	const productionTarget = summary.attention[0] ?? summary.rooms.find((room) => room.kind === "running") ?? summary.rooms.find((room) => room.tab === "production") ?? summary.rooms[0];
	const counts = `${running} работают · ${waiting} ждут`;
	const needsOrder = state.raids.find((raid) => raid.expedition?.status === "choice");
	const socialEvents = getSquadSocialEvents(state);
	const nextSteps = summary.attention.filter(item => item.priority >= 75).slice(0, needsOrder ? 1 : 2).map(commandNextAction).join("");
	const system = (name: string, symbol: string, detail: string, attributes: string, label = `${name}: ${detail}`, attention = false) => `<button class="command-system" ${attributes} aria-label="${e(label)}"><span class="system-symbol" aria-hidden="true">${icon(symbol,20)}</span><span><strong>${e(name)}</strong><b>${e(detail)}</b></span>${attention ? '<i class="system-attention"></i>' : ""}</button>`;
	const tools = [
		system("Производство", "scrap", `${summary.queuedJobs} заказов · ${staffed} рабочих`, `data-command-room="${productionTarget?.roomId ?? ""}" data-command-tab="${productionTarget?.tab ?? "production"}" data-focus-key="command-production"`),
		system("Отношения", "squad", socialEvents.length ? socialStoriesLabel(socialEvents.length) : "Свои люди и общие истории", 'data-page="squad" data-focus-key="command-social"', undefined, socialEvents.length > 0),
		system("Арсенал", "arsenal", `${state.weapons.length} пушек · ${state.modules.length} модулей`, 'data-page="arsenal"'),
		system("Поручения", "contracts", ready.length ? `${ready.length} наград готово` : `${state.claimedContracts.length} выполнено`, 'data-page="contracts"', undefined, ready.length > 0),
		system("Снабжение", "backpack", "Закупки и материалы", 'data-action="open-market"'),
		system("Журнал", "journal", last ? `${last.scavName}: ${last.success ? "вернулся" : "потери"}` : "Отчёты о выходах", 'data-page="journal"'),
		system("Память отряда", "intel", `${state.blueprints.length} открытий`, 'data-action="open-discoveries"'),
	].join("");
	return `<details class="command-squad-goal"><summary>Поручения убежища и отряда</summary>${gameplayFocus(getGameplayGuidance(state))}</details>${nextSteps ? `<div class="gameplay-attention"><span class="eyebrow">Оплаченная работа ждёт</span>${nextSteps}</div>` : ""}<div class="command-overview-head"><span class="eyebrow">Дела базы</span><strong>${counts}</strong><small>${summary.freeWorkers} свободных бойцов${summary.counts.building ? ` · ${summary.counts.building} строек` : ""}${state.shelter.expansions.length ? ` · участков в подготовке: ${state.shelter.expansions.length}` : ""}</small></div><div class="command-system-grid">${tools}</div>`;
}
function renderShelter() {
	if (roomToolOpen) { const room = state.shelter.rooms.find(item => item.id === selectedRoomId); if (room) { panel.innerHTML = managedRoomPanel(room); return; } }
	const planOpen = Boolean(buildingPlacement) || Boolean(panel.querySelector<HTMLDetailsElement>(".territory-layout-tools")?.open);
	panel.innerHTML = `${territorySummary(state)}<div class="section-head"><h2>Постройки во дворе</h2><span class="muted">Выбери здание для управления</span></div>${territoryBuildings(state, selectedRoomId)}<details class="territory-layout-tools" ${planOpen ? "open" : ""}><summary><span>Планировка и расширение<small>Места для строительства и новая земля</small></span><b>+</b></summary>${territoryPlan(state, selectedRoomId)}<p class="field-hint">Выбери свободное место или присоедини землю за оградой. Перетаскивай постройки прямо во дворе. Контур покажет, подходит ли место.</p></details><div class="section-head"><h2>Построить на базе</h2><span class="muted">Место выбираешь на территории</span></div>${buildingCatalogue(state)}${productionReserveEditor(state, "base", productionReserveDraft)}${fieldKitStockPanel(state)}${discoveriesSection()}`;
}
function buildSitePanel(column: number, row: number) {
	const open = getShelterSites(state.shelter).some(site => site.column === column && site.row === row);
	if (!open) {
		const expansion = state.shelter.expansions.find(site => site.column === column && site.row === row);
		const quote = getExcavationQuote(state, column, row);
		const progress = expansion ? expansion.workDone / expansion.workRequired : 0;
		return `<div class="room-management-head"><span class="eyebrow">За периметром</span><h2>${expansion ? "Готовим территорию" : "Расширить базу"}</h2><p>Присоедини соседнюю землю: она станет частью двора. Расширяй базу под большие постройки и выбирай их расположение.</p></div><div class="room-management-body">${expansion ? `<div class="production-readout"><strong>Подготовка ${Math.floor(progress * 100)}%</strong><span class="progress"><i style="width:${progress * 100}%"></i></span><p>${seconds((expansion.workRequired - expansion.workDone) / 1_000_000)} до готовности. Работы продолжаются офлайн.</p></div>` : `<div class="loadout-stats"><span>Подготовка ${seconds(quote.duration)}</span><span>Больше места во дворе</span></div><button class="button secondary" data-action="excavate-wall" data-column="${column}" data-row="${row}" ${quote.reason ? "disabled" : ""}>Присоединить землю · ${costLabel(quote)}</button><p class="quote-note">${e(quote.reason ?? "Материалы списываются один раз при начале работ.")}</p>`}</div>`;
	}
	return `<div class="room-management-head"><span class="eyebrow">Свободная земля</span><h2>Новая постройка</h2><p>Выбери здание, затем укажи место на территории. Контур покажет всю его площадь. Здания можно переставлять после завершения строительства.</p></div><div class="room-management-body">${buildingCatalogue(state)}</div>`;
}
function productionReadout(room: RoomInstance) {
	return `<div class="production-readout" data-production-readout="${room.id}">${productionReadoutContent(room, getRoomProductionState(state, room))}</div>`;
}
function productionDetail(view: ProductionPresentation) {
	return view.completed ? view.reason ? "Партия готова · ожидает склад" : "Партия готова" : view.paused ? `Приостановлено · ${view.stageLabel.toLocaleLowerCase("ru-RU")}` : view.stageLabel;
}
function productionReadoutContent(room: RoomInstance, production: ReturnType<typeof getRoomProductionState>) {
	const view = getShelterProductionPresentation(room, production);
	if (!view.jobId) return "";
	const model = view.modelId ? MODULE_BY_ID[view.modelId] : null;
	const stages = getShelterProductionStages(room.type).map(({id, label}) => [id, label] as const);
	const current = stages.findIndex(([id]) => id === view.stage);
	return `<section class="production-focus ${view.paused ? "paused" : ""}" aria-label="Текущий заказ"><div class="production-focus-head"><span class="eyebrow">Сейчас на станке</span><span data-production-state>${view.completed ? "Готово" : view.paused ? "Пауза" : "В работе"}</span></div><div class="production-product"><div class="production-product-art" aria-hidden="true">${model ? moduleArt(model) : icon(view.productKind === "scrap" ? "scrap" : view.productKind ?? "scrap", 32)}</div><div><strong>${e(view.productName)}</strong><small>${model ? e(MODULE_SLOT_LABELS[model.slot]) : `Партия · ${view.quantity} ед.`}</small></div><b data-production-percent>${Math.floor(view.progress * 100)}<small>%</small></b></div><div class="production-stages" aria-label="Этапы производства">${stages.map(([id, label], index) => `<span data-production-stage="${id}" data-phase="${view.completed || index < current ? "done" : index === current ? "current" : "pending"}"><i>${view.completed || index < current ? "✓" : index + 1}</i>${label}</span>`).join("")}</div><div class="production-detail"><span data-production-detail>${e(productionDetail(view))}</span><span data-production-queue>${room.queue.length > 1 ? `Следом: ${room.queue.length - 1}` : "Последний заказ"}</span></div></section>`;
}
function updateProductionReadout(node: HTMLElement, room: RoomInstance, production: ReturnType<typeof getRoomProductionState>) {
	const view = getShelterProductionPresentation(room, production);
	if (node.dataset.jobId !== (view.jobId ?? "")) {
		node.innerHTML = productionReadoutContent(room, production);
		node.dataset.jobId = view.jobId ?? "";
	}
	if (!view.jobId) return;
	node.querySelector('.production-focus')?.classList.toggle('paused', view.paused);
	const label = node.querySelector<HTMLElement>('[data-production-state]');
	if (label) label.textContent = view.completed ? "Готово" : view.paused ? "Пауза" : "В работе";
	const percent = node.querySelector<HTMLElement>('[data-production-percent]');
	if (percent) percent.innerHTML = `${Math.floor(view.progress * 100)}<small>%</small>`;
	const detail = node.querySelector<HTMLElement>('[data-production-detail]');
	if (detail) detail.textContent = productionDetail(view);
	const queued = node.querySelector<HTMLElement>('[data-production-queue]');
	if (queued) queued.textContent = room.queue.length > 1 ? `Следом: ${room.queue.length - 1}` : "Последний заказ";
	const stageOrder: string[] = SHELTER_PRODUCTION_STAGES.map(({id}) => id);
	const current = stageOrder.indexOf(view.stage);
	node.querySelectorAll<HTMLElement>('[data-production-stage]').forEach((stage, index) => {
		const done = view.completed || index < current;
		stage.dataset.phase = done ? "done" : index === current ? "current" : "pending";
		const number = stage.querySelector('i'); if (number) number.textContent = done ? "✓" : `${index + 1}`;
	});
}
function managedRoomPanel(room: RoomInstance) {
	const info = ROOM_DEFINITIONS[room.type], production = getRoomProductionState(state, room), upgrade = getRoomUpgradeQuote(state, room.id);
	const roomSummary = getCommandSummary(state).rooms.find((item) => item.roomId === room.id)!;
	const tab = info.production ? roomContextTab : "upgrade";
	const tabs = info.production ? [["staff","Люди"],["production","Производство"],["upgrade","Развитие"]] : [["upgrade","Развитие"]];
	const content = tab === "staff" ? roomWorkersPanel(room) : tab === "production" ? `${productionReserveEditor(state, room.id, productionReserveDraft, true)}<section class="room-panel-section"><h3>Очередь · ${room.queue.length} / 5</h3>${roomQueuePanel(room)}</section><section class="room-panel-section"><h3>${room.type === "workshop" ? "Комплекты для выхода" : "Рецепты"}</h3>${roomResourcesPanel(room)}</section>${room.type === "workshop" ? `<section class="room-panel-section"><h3>Оружейные модули</h3>${roomModulesPanel(room)}</section>` : ""}` : room.status === "building" ? '<div class="room-queue-empty">Строительство началось. Дождись готовности, затем назначь работников или развивай комнату.</div>' : `<section class="room-panel-section"><h3>Уровень ${room.level} → ${Math.min(5,room.level+1)}</h3><p>Улучшение ускоряет партии и добавляет рабочие места. Люди и оплаченная очередь сохранятся.</p>${roomUpgradeRecipeBenefits(room)}<div class="loadout-stats"><span>Время ${seconds(upgrade.duration)}</span></div><button class="button secondary" data-action="upgrade-room" data-id="${room.id}" ${upgrade.reason ? "disabled" : ""}>Улучшить · ${costLabel(upgrade)}</button><small class="quote-note" data-room-upgrade-note="${room.id}">${e(upgrade.reason ?? "Оплата при начале улучшения")}</small></section>`;
	return `<header class="command-context-head"><div><span class="eyebrow">Свободная планировка · ур. ${room.level || "—"}</span><h2>${e(info.label)}</h2></div><button class="icon-button" data-action="close-context" data-focus-key="context-close" aria-label="Закрыть комнату">×</button></header><div class="command-room-banner" data-room-summary="${room.id}" data-room-kind="${roomSummary.kind}" style="--room-accent:${info.color}">${roomMiniArt(room.type,`selected-${room.id}`).replace("<svg ", '<svg aria-hidden="true" ')}<div><strong data-room-status="${room.id}">${e(production.status)}</strong><small data-room-eta="${room.id}">${production.remainingSeconds == null ? "" : `${seconds(production.remainingSeconds)} до готовности`}</small><div class="command-room-meta"><span>${info.production ? `${icon("people",12)} ${room.workerIds.length}/${getRoomWorkerCapacity(room)}` : `${icon("check",12)} Без персонала`}</span>${info.production ? `<span>${icon("scrap",12)} Заказов: ${room.queue.length}</span>` : ""}</div><span class="progress"><i data-room-progress="${room.id}" style="width:${production.progress*100}%"></i></span><button class="text-button room-view-action" data-camera-room="${room.id}" data-focus-key="camera-room-${room.id}">Осмотреть комнату ${icon("arrow",13)}</button></div></div><div class="context-tabs" role="group" aria-label="Управление комнатой">${tabs.map(([id,label]) => `<button data-room-context-tab="${id}" data-focus-key="context-tab-${id}" aria-pressed="${tab===id}" class="${tab===id?"active":""}">${label}</button>`).join("")}</div><div class="command-dock-scroll" data-room-management tabindex="-1">${productionReadout(room)}<p class="command-room-reason" data-room-reason="${room.id}">${e(production.reason ?? (room.status !== "ready" ? "Работа приостановлена до готовности комнаты" : roomSummary.cta ? roomSummary.detail : ""))}</p>${content}${buildingRelocationControls(room)}${!info.production ? `<p class="field-hint">${e(info.description)} Работники не требуются.</p>` : ""}</div>`;
}
function roomWorkersPanel(room: RoomInstance) {
	const capacity = getRoomWorkerCapacity(room), skill = ROOM_DEFINITIONS[room.type].workerSkill;
	const required = skill === "combat" ? "Бой" : skill === "scouting" ? "Поиск" : "Бой и поиск";
	const workers = room.workerIds.map((id) => state.scavs.find((scav) => scav.id === id)).filter((scav): scav is Scav => Boolean(scav));
	const candidates = state.scavs.filter((scav) => scav.assignment !== room.id && scav.status !== "raiding" && isScavMedicallyReady(scav))
		.sort((a, b) => Number(Boolean(a.assignment)) - Number(Boolean(b.assignment)) || getWorkerAffinity(b, room.type) - getWorkerAffinity(a, room.type));
	const selected = chosenWorkers.get(room.id) ?? candidates[0]?.id ?? "";
	chosenWorkers.set(room.id, candidates.some((scav) => scav.id === selected) ? selected : candidates[0]?.id ?? "");
	const blocked = room.status !== "ready" ? "Комната ещё не готова" : workers.length >= capacity ? "Все рабочие места заняты" : !candidates.length ? "Нужен свободный боец с восстановленной подвижностью и здоровьем от 25%" : null;
	return `<section class="room-panel-section"><h3>Рабочие места <span class="muted">/ ${workers.length} из ${capacity}</span></h3><p>Подходящий навык: ${required}. Несколько работников и высокий навык ускоряют партии. Во время работы боец не уходит в рейд.</p><div class="loadout-stats"><span>Темп комнаты ×${getRoomProductionState(state, room).rate.toFixed(2)}</span><span>Учтены люди и уровень комнаты</span></div>${roomRelationsPanel(state, room, chosenWorkers.get(room.id))}<div class="worker-list">${workers.map((scav) => `<div class="worker-row"><span class="scav-avatar">${scavPortrait(scav.personality, scav.name, scav.appearance)}</span><div><strong>${e(scav.name)}</strong><p>Бой ${scav.combat} · поиск ${scav.scouting} · здоровье ${Math.floor(scav.health)}</p><span class="worker-fit">Подходит: ${Math.round(getWorkerAffinity(scav, room.type))} / 100</span></div><button class="icon-button" data-action="release-worker" data-id="${scav.id}" data-focus-key="release-${scav.id}" aria-label="Освободить ${e(scav.name)} от работы">×</button></div>`).join("") || '<div class="room-queue-empty">Рабочих нет. Оплаченный заказ дождётся назначения бойца.</div>'}</div><label class="field-label worker-assign-field">Назначить бойца<select data-room-worker="${room.id}" aria-label="Работник для ${e(ROOM_DEFINITIONS[room.type].label)}" ${blocked ? "disabled" : ""}>${candidates.map((scav) => `<option value="${scav.id}" ${chosenWorkers.get(room.id) === scav.id ? "selected" : ""}>${e(scav.name)} · подходит ${Math.round(getWorkerAffinity(scav, room.type))} / 100${scav.assignment ? ` · перевести из ${e(roomName(scav.assignment))}` : " · свободен"}</option>`).join("") || '<option>Нет доступных бойцов</option>'}</select></label><button class="button secondary" data-action="assign-worker" data-id="${room.id}" data-focus-key="assign-worker" ${blocked ? "disabled" : ""}>Назначить на работу</button><small class="quote-note">${e(blocked ?? "Боец сменит прежнее рабочее место. Автовыходы будут ждать освобождения")}</small></section>`;
}
function roomQueuePanel(room: RoomInstance) {
	if (!room.queue.length) return '<div class="room-queue-empty">Очередь свободна. Выбери рецепт или поставь модуль в заказ ниже. Работники начнут партию, когда есть припасы.</div>';
	const production = getRoomProductionState(state, room);
	return room.queue.map((job, index) => {
		const model = job.modelId ? MODULE_BY_ID[job.modelId] : null;
		const recipe = RESOURCE_RECIPES.find((item) => item.id === job.recipeId);
		const label = model?.label ?? recipe?.label ?? "Производственная партия";
		const fraction = job.workRequired ? Math.min(1, job.workDone / job.workRequired) : 0;
		const current = index === 0;
		return `<article class="room-job ${current ? "running" : ""}"><div class="room-job-head"><strong>${e(label)}</strong><span ${current ? `data-job-time="${job.id}"` : ""}>${current ? production.remainingSeconds == null ? "ПАУЗА" : seconds(production.remainingSeconds) : `ЗАКАЗ 0${index + 1}`}</span></div>${model ? `<div class="room-job-art">${moduleArt(model)}</div>` : productionOutputSnapshot(job)}<div class="progress"><i data-job-progress="${job.id}" style="width:${Math.round(fraction * 100)}%"></i></div><p ${current ? `data-job-status="${job.id}"` : ""}>${current ? e(production.reason ?? production.status) : "Ожидает завершения предыдущей партии"}</p>${productionLootReceipt(job)}<div class="room-job-foot"><span data-job-refund="${job.id}">${e(productionRefundLabel(job))}</span><button class="button ghost small" data-action="cancel-production" data-id="${room.id}" data-job-id="${job.id}" data-focus-key="cancel-${job.id}">Отменить</button></div></article>`;
	}).join("");
}
function roomResourcesPanel(room: RoomInstance) {
	const recipes = RESOURCE_RECIPES.filter((recipe) => recipe.roomType === room.type);
	return `<label class="loadout-check"><input type="checkbox" data-room-repeat="${room.id}" aria-label="Повторять выбранный рецепт: ${e(ROOM_DEFINITIONS[room.type].label)}" data-focus-key="room-repeat-${room.id}" ${room.recipeId ? room.repeat ? "checked" : "" : roomRepeatPreferences.get(room.id) === true ? "checked" : ""} ${room.status !== "ready" ? "disabled" : ""}><span>Повторять выбранный рецепт<small>Новая партия оплачивается только при запуске. При нехватке ресурсов, целых трофеев, резерве или достижении цели работа ждёт. Каждое повторение расходует новый набор предметов.</small></span></label>${roomStockTargetEditor(state, room, roomStockTargetDrafts.get(room.id))}${room.recipeId ? `<button class="button ghost small" data-action="stop-room-recipe" data-id="${room.id}">Остановить будущие партии</button><small class="quote-note">Оплаченные заказы продолжатся. Их можно отменить в очереди отдельно.</small>` : ""}<div class="resource-recipe-list">${recipes.map(recipe => shelterRecipeCard(state, room, recipe)).join("")}</div>`;
}
function roomModulesPanel(room: RoomInstance) {
	const weapon = state.weapons.find((gun) => gun.id === selectedWeapon) ?? state.weapons[0];
	const models = MODULE_MODELS.filter((model) => moduleModelMatches(model, { slot: roomModuleSlot, rarity: "all", platform: "all", search: roomModuleSearch }) && (!weapon || moduleFitsWeaponFamily(model, weapon.weaponId)));
	return `<p>Изготовление требует времени и рабочих. Заказ оплачивается при постановке в очередь; каждый модуль появится отдельным экземпляром на складе.</p><div class="room-module-filters"><label class="field-label">Детали для оружия<select data-room-module-weapon aria-label="Оружие для производства модулей">${state.weapons.map((gun) => `<option value="${gun.id}" ${gun.id === weapon?.id ? "selected" : ""}>${e(getWeaponDefinition(gun).name)}</option>`).join("")}</select></label><label class="field-label">Слот<select data-room-module-slot aria-label="Слот производимого модуля"><option value="all" ${roomModuleSlot === "all" ? "selected" : ""}>Все подходящие слоты</option>${MODULE_DISPLAY_SLOTS.map((slot) => `<option value="${slot}" ${roomModuleSlot === slot ? "selected" : ""}>${MODULE_SLOT_LABELS[slot]}</option>`).join("")}</select></label><label class="weapon-search">${icon("settings", 16)}<input type="search" data-room-module-search aria-label="Поиск производимых модулей" placeholder="Название, калибр или крепление" value="${e(roomModuleSearch)}"></label></div><div class="room-module-recipes">${models.map((model) => {
		const quote = getModuleProductionQuote(state, room.id, model.id);
		return `<article class="room-module-recipe" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">${MODULE_SLOT_LABELS[model.slot]} · ${RARITY_LABELS[model.rarity]}</span><div class="room-module-recipe-art">${moduleArt(model)}</div><h4>${e(model.label)}</h4><p>${e(model.description)}</p>${moduleModelTraits(model)}${moduleFitDetails(model, weapon)}<small class="quote-note">Базовая работа ${seconds(quote.duration)} · мастерская ур. ${model.workshopLevel}</small><button class="button secondary small" data-action="queue-room-module" data-id="${room.id}" data-model-id="${model.id}" data-focus-key="queue-${model.id}" ${quote.reason ? "disabled" : ""}>В очередь · ${costLabel(quote)}</button><small class="quote-note" data-room-module-note="${model.id}">${e(quote.reason ?? "Оплаченный заказ начнётся по очереди")}</small></article>`;
	}).join("") || '<div class="room-queue-empty">Нет деталей по этим фильтрам. Сбрось поиск или выбери другой слот.</div>'}</div>`;
}
function contractCard(contract: Contract) {
	const progress = getContractProgress(state, contract),
		claimed = state.claimedContracts.includes(contract.id),
		lockReason = getContractLockReason(state, contract),
		available = !lockReason,
		ready = available && progress >= contract.target;
	const supplies = Object.entries(contract.reward.supplies).map(([key, amount]) => `<span title="${({ ammo: "Патроны", medicine: "Медикаменты", scrap: "Детали", intel: "Разведданные" } as Record<string, string>)[key]}">${icon(key, 12)} +${amount}</span>`).join("");
	return `<article data-contract="${e(contract.id)}" class="contract ${lockReason && !claimed ? "contract-locked" : ""}"><div class="contract-mark">${icon(claimed ? "check" : lockReason ? "lock" : "contracts", 21)}</div><div class="contract-copy"><h3>${e(contract.name)}</h3><p>${e(contract.description)}</p><div class="progress"><i style="width:${Math.min(100, (progress / contract.target) * 100)}%"></i></div><small>${n(Math.min(contract.target, progress))} / ${n(contract.target)}</small>${lockReason && !claimed ? `<div class="contract-lock">${icon("lock", 11)} ${e(lockReason)}</div>` : ""}<div class="reward-supplies">${supplies}</div></div><div class="contract-reward"><span>+${n(contract.reward.money)} ₽</span><span class="muted">+${contract.reward.xp} опыта</span><button class="button secondary small" data-action="claim" data-id="${contract.id}" ${!ready || claimed ? "disabled" : ""}>${claimed ? "Выполнено" : lockReason ? "Закрыт" : ready ? "Забрать" : "В работе"}</button></div></article>`;
}
function journalCard(report: RaidReport) {
	return `<details class="journal-entry" data-report="${report.id}"><summary><time>${new Date(report.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><div class="journal-copy"><strong>${e(report.scavName)} · ${e(MAP_BY_ID[report.mapId]!.name)}</strong><p>${e(report.description)}</p><div class="journal-meta"><span>${report.isAuto ? "АВТОВЫХОД" : "ЭКСПЕДИЦИЯ"} · этапов ${report.depth} · ${e(TACTICS[report.tactic].label)}</span><span>${report.money ? `+${n(report.money)} ₽ · ` : ""}Детали +${report.supplies.scrap} · патроны +${report.supplies.ammo}</span></div></div><b class="tag report-result ${report.success ? "success" : "failure"}">${report.success ? "ВЕРНУЛСЯ" : report.lostScav ? "ПОТЕРЯН" : "ПРОВАЛ"}</b><span class="journal-expand">${icon("arrow", 14)}</span></summary><div class="journal-detail">${bossReportReceipt(report,state.history,false)}${raidLootReceipt(report.success?report.lootItems:report.lostCargo?.lootItems,report.success?"delivered":"lost")}${raidLootReceipt(report.success?report.lootPending:undefined,"pending")}${raidGearReceipt(report.success?report.gearItems:report.lostCargo?.gearItems,report.success?"delivered":"lost",state)}${raidGearReceipt(report.success?report.gearPending:undefined,"pending")}${raidModulePending(report.modulePending)}${raidLootOverflow(report.lootAutoSold)}${report.moduleIds.length ? `<div class="module-loot-strip">${report.moduleIds.map((id) => { const model = MODULE_BY_ID[id]; return model && !report.modulePending?.some(part=>part.modelId===id) ? `<span class="cargo-module" style="--rarity:${RARITY_COLORS[model.rarity]}">${moduleArt(model)}<span><strong>${e(model.label)}</strong><small>Доставлено на базу</small></span></span>` : ""; }).join("")}</div>` : ""}${report.discoveries.length ? `<div class="report-memory">${icon("intel", 18)} Сохранены открытия: ${report.discoveries.map((id) => e(BLUEPRINTS[id]?.label ?? id)).join(" · ")}</div>` : ""}${report.lostCargo ? `<p class="risk-note">Потеряна добыча из рюкзака: ≈ ${n(getCargoValue(report.lostCargo))} ₽. Постоянные открытия остались у базы.</p>` : ""}${report.weaponId ? `<div class="report-trophy" style="--rarity:${RARITY_COLORS[WEAPON_BY_ID[report.weaponId]!.rarity]}">${icon("arsenal", 21)}<div><strong>${e(WEAPON_BY_ID[report.weaponId]!.name)}</strong><span>${report.weaponAutoSold ? "Продано: арсенал заполнен" : "Найдено и отправлено в арсенал"}</span></div></div>` : ""}<ol class="route-timeline">${report.events.map((event, i) => `<li class="event-${event.kind}"><div class="timeline-marker">${String(i + 1).padStart(2, "0")}</div><div><div class="timeline-label"><strong>${e(event.label)}</strong><time>${new Date(event.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div><p>${e(event.text)}</p></div></li>`).join("")}</ol><div class="report-bottom"><span>Разведданные +${report.supplies.intel} · медикаменты +${report.supplies.medicine}</span><span>${report.lostScav ? "Боец потерян" : report.lostWeapon ? "Оружие потеряно" : "Отчёт закрыт"}</span></div></div></details>`;
}
function renderOfflineSummary() {
	const node = document.querySelector<HTMLElement>("#offline-summary")!;
	if (!offlineSummary) { node.innerHTML = ""; return; }
	const minutes = Math.floor(offlineSummary.elapsedMs / 60_000);
	const elapsed = minutes ? `${minutes} мин` : `${Math.floor(offlineSummary.elapsedMs / 1000)} с`;
	const expanded = node.querySelector<HTMLDetailsElement>(".offline-recap")?.open ?? false;
	const focused = document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement.dataset.offlineFocus : null;
	const moneyChange = offlineSummary.money === 0 ? "Рубли без изменений" : `Изменение: ${offlineSummary.money > 0 ? "+" : "−"}${n(Math.abs(offlineSummary.money))} ₽`;
	node.innerHTML = `<aside class="offline-summary"><details class="offline-recap" ${expanded ? "open" : ""}><summary data-offline-focus="summary">${icon("time",15)}<span>За ${elapsed}</span><b>${moneyChange}</b><i aria-hidden="true">${icon("arrow",12)}</i></summary><div><p>Завершено выходов: <strong>${n(offlineSummary.completedCount)}</strong>${offlineSummary.capped ? " · учтены 8 часов" : ""}. Стройка, работа назначенных бойцов и лечение рассчитаны за время отсутствия. Рубли учитывают доход и оплату производства.</p><button class="button ghost small" data-page="journal" data-offline-focus="journal">Открыть отчёты ${icon("arrow",13)}</button></div></details><button class="dismiss-button" data-action="dismiss-offline" data-offline-focus="dismiss" aria-label="Убрать сводку отсутствия" title="Убрать сводку">Ок</button></aside>`;
	if (focused) node.querySelector<HTMLElement>(`[data-offline-focus="${focused}"]`)?.focus({ preventScroll: true });
}
function renderExpeditionAlerts() {
	const waiting = raidRepresentatives(state.raids).filter((raid) => raid.expedition?.status === "choice");
	const alerts = document.querySelector<HTMLElement>("#expedition-alerts")!;
	alerts.innerHTML = page === "home" || page === "raids" ? expeditionQueue() : waiting.length ? `<div class="operations-bar decision-notice"><div>${icon("intel", 25)}<div><span class="eyebrow">Сигнал с маршрута</span><strong>${waiting.length} ${waiting.length === 1 ? "боец ждёт" : "бойца ждут"} твой приказ</strong><p>Добыча в рюкзаке. Выбери эвакуацию или следующий этап.</p></div></div><button class="button" data-action="review-decisions">Ответить →</button></div>` : "";
}
function operationsBar() {
	const enabled = state.scavs.filter((scav) => scav.autoRaid.enabled).length;
	return `<div class="operations-bar"><div>${icon("repeat", 25)}<div><span class="eyebrow">Постоянные приказы</span><strong><span id="auto-order-count">${enabled}</span> — на автовыходах</strong><p>Ручной выход ждёт приказа на точках связи. Автовыход сам эвакуируется на заданной глубине.</p></div></div>${enabled ? '<button class="button danger small" data-action="auto-stop-all">Остановить все автовыходы</button>' : (page === "raids" ? '<button class="button secondary small" data-action="focus-roster">Выбрать бойца</button>' : '<button class="button secondary small" data-mission-board>Настроить отряд</button>')}</div>`;
}
let visibleWeaponArtRequest = "";
/** Load only owned or currently displayed new parts; startup keeps its small original artwork. */
function preloadVisibleWeaponArtwork() {
	const ids = new Set<string>(state.weapons.flatMap(modularWeaponArtFamilies));
	const modelIds = [...state.modules.map((part) => part.modelId), ...Array.from(document.querySelectorAll("[data-model-id]"), (node) => node.getAttribute("data-model-id"))];
	for (const modelId of modelIds) {
		const model = modelId ? MODULE_BY_ID[modelId] : undefined;
		const family = model ? modularWeaponArtFamily(model) : undefined;
		if (family) ids.add(family);
	}
	for (const node of document.querySelectorAll("[data-weapon-model]")) {
		const id = node.getAttribute("data-weapon-model"); if (id) ids.add(id);
	}
	const signature = [...ids].sort().join("|");
	if (visibleWeaponArtRequest === signature) return;
	visibleWeaponArtRequest = signature;
	const revision = modularWeaponArtRevision();
	void preloadModularWeaponArt([...ids]).then(() => { if (modularWeaponArtRevision() !== revision) render(); });
}
function render() {
	queueMicrotask(preloadVisibleWeaponArtwork);
	squadDraft = [...new Set(squadDraft.filter(id => state.scavs.some(scav => scav.id === id)))].slice(0,3);
	deferredRender = false;
	const tabsScroll = panel.querySelector<HTMLElement>(".armory-tabs")?.scrollLeft ?? 0;
	const panelFocus = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
	const inputSelection=document.activeElement instanceof HTMLInputElement&&panel.contains(document.activeElement)?[document.activeElement.selectionStart,document.activeElement.selectionEnd] as const:null;
	const bossRosterOpen=panel.querySelector<HTMLDetailsElement>('.boss-roster')?.open??false;
	const expandedBossPrizes=[...panel.querySelectorAll<HTMLDetailsElement>('[data-boss-card] .boss-prize[open]')].map(node=>node.closest<HTMLElement>('[data-boss-card]')!.dataset.bossCard);
    const bossScavSelections=[...panel.querySelectorAll<HTMLSelectElement>('[data-boss-scav]')].map(node=>[node.dataset.bossScav!,node.value] as const);
    const expandedLootDecisions = [...panel.querySelectorAll<HTMLDetailsElement>('details[data-loot-decision][open]')].map(node=>node.dataset.lootDecision);
	const expandedReports = [...resumedJournal, ...Array.from(panel.querySelectorAll<HTMLDetailsElement>("details[data-report][open]")).map((node) => node.dataset.report)];
	const expandedSocial = Array.from(panel.querySelectorAll<HTMLDetailsElement>('details[data-social-detail-key][open]')).map(node => node.dataset.socialDetailKey);
	const expandedAchievements = Array.from(panel.querySelectorAll<HTMLDetailsElement>('details[data-achievement-detail][open]')).map(node => node.dataset.achievementDetail);
	const collapsedAchievements = Array.from(panel.querySelectorAll<HTMLDetailsElement>('details[data-achievement-detail]:not([open])')).map(node => node.dataset.achievementDetail);
	resumedJournal = [];
	document
		.querySelectorAll<HTMLButtonElement>(".nav button")
		.forEach((button) =>
			((button.classList.toggle("active", button.dataset.page === (liveMode?.isActive() ? "raids" : page))), (button.setAttribute("aria-current", button.dataset.page === (liveMode?.isActive() ? "raids" : page) ? "page" : "false")))
		);
	const captions: Record<Page, string> = {
		home: "Железо в арсенале. Свои люди на связи.",
		raids: "Задания твоих диких: снаряжение, постоянные приказы и связь на маршруте.",
		arsenal: "Собери оружие из деталей. Настрой комплект под свой маршрут.",
		base: "Территория, свободная планировка и большие постройки.",
		contracts: "Репутация строится на выполненных обещаниях.",
		journal: "Кто вышел, кто вернулся и что принёс.",
		recruits: "Выбери характер отряда. Связи переживают потери, таланты растут вместе с бойцами.",
		squad: "Дружба, споры и общие истории. Смотри, кто стал своим и кому нужна поддержка.",
		achievements: "Нашивки за решения, которые сработали. Каждая хранит свою историю.",
		flea: "Находки, их польза и твоя цена. Общая торговля между игроками.",
	};
	document.querySelector("#page-head")!.innerHTML =
		`<div><div class="eyebrow"><span class="page-number">0${Object.keys(names).indexOf(page) + 1} /</span> ${page === "home" ? "УБЕЖИЩЕ ПРАПОРА" : names[page]}</div><h2 id="tool-title">${page === "raids" ? "Задания отряда" : names[page]}</h2><p>${captions[page]}</p></div><span class="tag">${icon("time", 13)} <span id="income-status"></span></span>`;
	(document.querySelector("#hero") as HTMLElement).style.display =
		"";
	renderOfflineSummary();
	renderExpeditionAlerts();
	if (page === "home")
		panel.innerHTML = `<div class="stats-strip">${[
			[
				"people",
				state.scavs.length,
				"ДИКИХ В ОТРЯДЕ",
				`Мест: ${getScavCapacity(state)}`,
			],
			[
				"arsenal",
				state.discoveredWeapons.length,
				"ПУШЕК ОТКРЫТО",
				`из ${WEAPONS.length}`,
			],
			[
				"raids",
				state.stats.raidsWon,
				"УСПЕШНЫХ РЕЙДОВ",
				`${state.stats.raidsCompleted} всего`,
			],
			[
				"money",
				n(state.stats.moneyEarned),
				"ЗАРАБОТАНО РУБЛЕЙ",
				"за всё время",
			],
		]
			.map(
				([i, v, l, s]) =>
					`<article class="stat-card">${icon(String(i), 25)}<div><label>${l}</label><strong>${v}</strong></div><small>${s}</small></article>`
			)
			.join(
				""
			)}</div>${shelterHomeNote()}${operationsBar()}<div class="section-head"><h2>Твои люди <span class="muted">/ ${state.scavs.length}</span></h2><button class="link-button" data-mission-board>Задания отряда →</button></div><div class="card-grid scav-grid">${state.scavs.map(scavCard).join("") || '<div class="empty">Отряд пуст. Найми дикого в разделе «Рейды» — первый после потери отряда приходит бесплатно.</div>'}</div><div class="section-head"><h2>Прапор поручил</h2><button class="link-button" data-page="contracts">Все контракты →</button></div><div class="quick-contracts">${
			CONTRACTS.filter((c) => !state.claimedContracts.includes(c.id) && !getContractLockReason(state, c))
				.slice(0, 2)
				.map(contractCard)
				.join("") ||
			'<div class="empty">Все контракты закрыты. Развивай репутацию — Прапор откроет следующие поручения.</div>'
		}</div>`;
	if (page === "raids") {
		const map = MAP_BY_ID[selectedMap]!;
		panel.innerHTML = `${lootHuntHint(state,lootHunt)}${bossRoster(state)}${squadRaidComposer(state, squadDraft, selectedMap)}${raidRepresentatives(state.raids).filter(raid=>raid.squad&&raid.expedition?.status!=="choice").map(raid=>squadRaidOngoing(state,raid)).join("")}${operationsBar()}<div class="section-head"><h2>Выбери сектор</h2><button class="text-button" data-action="toggle-map" aria-expanded="${showTacticalMap}">${icon("raids", 16)} ${showTacticalMap ? "Скрыть карту" : "Тактическая карта"}</button></div><div class="maps">${MAPS.map((m, i) => `<button class="map-card ${m.id === selectedMap ? "selected" : ""} ${state.level < m.level ? "locked" : ""}" data-map="${m.id}" aria-pressed="${m.id === selectedMap}" ${state.level < m.level ? "disabled" : ""}><span class="map-graphic" style="--map-color:${m.accent}">${icon("raids", 70)}</span><span class="map-index">СЕКТОР 0${i + 1}${state.level < m.level ? ` · ${icon("lock", 10)} УР. ${m.level}` : ""}</span><h3>${e(m.name)}</h3><p>${e(m.subtitle)}</p><div class="map-meta"><span>${seconds(m.duration)} · ${m.ammoCost} патр.${m.intelCost ? ` · ${m.intelCost} разв.` : ""}</span><span>${m.reward[0]}–${m.reward[1]} ₽</span></div></button>`).join("")}</div><div class="selected-sector"><div><span class="eyebrow">Выбранный сектор</span><h3>${e(map.name)}</h3><p>${e(map.description)}</p></div><span class="sector-reward"><strong>${map.reward[0]}–${map.reward[1]} ₽</strong><small>Добыча первого этапа</small></span></div>${sectorIntelPanel(state, selectedMap)}<div class="section-head"><h2>Снаряжение отряда</h2><button class="button secondary small" data-action="recruit">${icon("people", 15)} Выбрать кандидата →</button></div><div class="card-grid scav-grid">${state.scavs.map(scavCard).join("") || '<div class="empty">Отряд потерян. Найми нового дикого бесплатно и начни снова.</div>'}</div><p class="muted roster-capacity">Отряд: ${state.scavs.length} / ${getScavCapacity(state)} · Улучшай радиорубку, чтобы нанимать больше диких. Медблок восстанавливает здоровье со временем.</p>`;
	}
	if (page === "arsenal") renderArsenal();
	if (page === "flea") {fleaView.busy=gameCommandPending;panel.innerHTML=fleaPage(state,fleaView);for(const details of panel.querySelectorAll<HTMLDetailsElement>('details[data-loot-decision]'))if(expandedLootDecisions.includes(details.dataset.lootDecision))details.open=true;}
	if (page === "recruits") panel.innerHTML = recruitmentPanel(state);
	if (page === "squad") panel.innerHTML = squadRelationsPanel(state);
	if (page === "achievements") panel.innerHTML = achievementsPanel(state, achievementFilter, new Set([...freshAchievements, ...getUnseenAchievementIds(state)]));
	if (page === "base") renderShelter();
	if (page === "contracts") {
		const contracts = CONTRACTS.filter((contract) => contractFilter === "all" || (contractFilter === "done") === state.claimedContracts.includes(contract.id));
		panel.innerHTML = `${gameplayRoadmap(state)}<div class="arsenal-toolbar"><div class="filters">${(["open", "done", "all"] as const).map((filter) => `<button data-contract-filter="${filter}" class="${contractFilter === filter ? "active" : ""}">${filter === "open" ? "Поручения" : filter === "done" ? "Выполнены" : "Все"}</button>`).join("")}</div><span class="tag">${state.claimedContracts.length} / ${CONTRACTS.length} ЗАКРЫТО</span></div><div class="contract-brief">${icon("contracts", 22)}<p>Получай награды основной цепочки, чтобы переходить к следующей цели. Коллекция, стройка и постоянные приказы дают дополнительные поручения.</p></div>${contracts.map(contractCard).join("") || '<div class="empty">Здесь пока нет поручений. Заверши первый контракт и возвращайся.</div>'}`;
	}
	if (page === "journal")
		panel.innerHTML = (state.history.length
			? `<div class="section-head"><h2>Последние отчёты · ${state.history.length}</h2><span class="muted">Всего: ${n(state.stats.raidsCompleted)} · нажми отчёт, чтобы открыть маршрут</span></div>${state.history.map(journalCard).join("")}`
			: '<div class="empty">Радио пока молчит.<br>Отправь дикого в первый рейд — здесь появится его отчёт.</div>') + scavMemorialPanel(state);
	const bossRosterNode=panel.querySelector<HTMLDetailsElement>('.boss-roster');if(bossRosterNode)bossRosterNode.open=bossRosterOpen;
	for(const node of panel.querySelectorAll<HTMLDetailsElement>('[data-boss-card] .boss-prize'))node.open=expandedBossPrizes.includes(node.closest<HTMLElement>('[data-boss-card]')!.dataset.bossCard);
    for(const [bossId,scavId] of bossScavSelections){const control=panel.querySelector<HTMLSelectElement>(`[data-boss-scav="${CSS.escape(bossId)}"]`);if(control&&[...control.options].some(option=>option.value===scavId))control.value=scavId;}
    panel.querySelectorAll<HTMLDetailsElement>("details[data-report]").forEach((node) => { node.open = expandedReports.includes(node.dataset.report); });
	panel.querySelectorAll<HTMLDetailsElement>('details[data-social-detail-key]').forEach(node => { node.open = expandedSocial.includes(node.dataset.socialDetailKey); });
	panel.querySelectorAll<HTMLDetailsElement>('details[data-achievement-detail]').forEach(node => {
		if (expandedAchievements.includes(node.dataset.achievementDetail)) node.open = true;
		else if (collapsedAchievements.includes(node.dataset.achievementDetail)) node.open = false;
	});
	renderCommandBoard();
	const tools = document.querySelector<HTMLElement>("#tool-root")!; tools.hidden = page === "home";
	tools.dataset.tool = page; tools.dataset.roomTool = String(page === "base" && roomToolOpen);
	renderInspector();
	setOverlayState();
	hud();
	const tabs = panel.querySelector<HTMLElement>(".armory-tabs"); if (tabs) tabs.scrollLeft = tabsScroll;
	if (panelFocus && !isInspectorOpen() && !document.querySelector("#modal-root .modal")) panel.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(panelFocus)}"]`)?.focus({ preventScroll: true });
	if(inputSelection&&document.activeElement instanceof HTMLInputElement&&inputSelection[0]!==null&&inputSelection[1]!==null)document.activeElement.setSelectionRange(inputSelection[0],inputSelection[1]);
}
function renderArsenal() {
	if (arsenalTab === "bench") { renderWorkbench(); return; }
	if (arsenalTab === "modules") { renderModules(); return; }
	if (arsenalTab === "equipment") { renderEquipment(); return; }
	if (arsenalTab === "market") { renderMarket(); return; }
	const noMatches = `<div class="empty">Ничего не найдено.<br>Измени поиск или категорию.<button class="button ghost small" data-action="reset-weapon-filters">Сбросить поиск и фильтры</button></div>`;
	const emptyArsenal = `<div class="empty">Арсенал пуст.<br>Отправь бойца за добычей или найми нового, если отряд потерян.<button class="button secondary small" data-mission-board>К отряду ${icon("arrow", 14)}</button></div>`;
	const guns = state.weapons.filter(
		(w) => (category === "all" || getWeaponDefinition(w).category === category) && getWeaponDefinition(w).name.toLocaleLowerCase("ru").includes(weaponSearch.toLocaleLowerCase("ru"))
	);
	if (!guns.some((w) => w.id === selectedWeapon))
		selectedWeapon = guns[0]?.id ?? "";
	const selected = state.weapons.find((w) => w.id === selectedWeapon);
	panel.innerHTML = `${arsenalTabs()}<div class="arsenal-toolbar"><div class="filters">${(["all", "rifle", "smg", "shotgun", "sniper", "pistol"] as const).map((c) => `<button data-filter="${c}" aria-pressed="${category === c}" class="${category === c ? "active" : ""}">${c === "all" ? "Все пушки" : CATEGORY_LABELS[c]}</button>`).join("")}<button data-action="collection" aria-pressed="${collection}" class="${collection ? "active" : ""}">Коллекция ${state.discoveredWeapons.length}/${WEAPONS.length}</button></div><span class="tag">${state.weapons.length} / ${getStorageCapacity(state)} МЕСТ</span></div><label class="weapon-search">${icon("arsenal", 18)}<input type="search" data-weapon-search aria-label="Поиск оружия" placeholder="Найти оружие по названию" value="${e(weaponSearch)}"></label>${
		collection
			? `<div class="weapons-grid">${WEAPONS.filter(
					(w) => (category === "all" || w.category === category) && w.name.toLocaleLowerCase("ru").includes(weaponSearch.toLocaleLowerCase("ru"))
				)
					.map((w) => {
						const known = state.discoveredWeapons.includes(w.id);
						return `<article class="weapon-card" style="--rarity:${known ? RARITY_COLORS[w.rarity] : "#424a36"};opacity:${known ? 1 : 0.45}"><span class="eyebrow">${known ? RARITY_LABELS[w.rarity] : "НЕ НАЙДЕНО"}</span>${gunArt(w.category, known ? RARITY_COLORS[w.rarity] : "#525b46")}<h3>${e(w.name)}</h3><div class="weapon-meta"><span>${CATEGORY_LABELS[w.category]}</span><span>${known ? "ОТКРЫТО" : `В рейдах`}</span></div></article>`;
					})
					.join("") || noMatches}</div>`
			: `<div class="arsenal-layout"><div class="weapons-grid">${
					guns
						.map((w) => {
							const def = getWeaponDefinition(w),
								owner = state.scavs.find((s) => s.weaponInstanceId === w.id);
							return `<button class="weapon-card ${w.id === selectedWeapon ? "selected" : ""}" style="--rarity:${RARITY_COLORS[def.rarity]}" data-weapon="${w.id}"><span class="eyebrow">${RARITY_LABELS[def.rarity]}</span>${weaponBuildArt(w)}<h3>${e(def.name)}</h3>${weaponReadiness(w)}<div class="weapon-meta"><span>МОЩЬ ${getWeaponPower(w)} · ${Math.round(w.durability)}%</span><span>${owner ? e(owner.name) : "НА СКЛАДЕ"}</span></div></button>`;
						})
						.join("") ||
					(state.weapons.length ? noMatches : emptyArsenal)
				}</div>${selected ? weaponDetail(selected) : ""}</div>`
	}`;
}
function arsenalTabs() {
	return `<div class="section-tabs armory-tabs" role="group" aria-label="Раздел арсенала">${([["weapons", "arsenal", "Оружие"], ["bench", "scrap", "Верстак"], ["modules", "settings", "Модули"], ["equipment", "armor", "Комплекты"], ["market", "money", "Снабжение"]] as const).map(([id, symbol, label]) => `<button data-arsenal-tab="${id}" aria-pressed="${arsenalTab === id}" class="${arsenalTab === id ? "active" : ""}">${icon(symbol, 17)} ${label}</button>`).join("")}<button data-page="flea">${icon("flea",17)} Барахолка</button></div>`;
}
function weaponReadiness(weapon: WeaponInstance) {
	const stats = getWeaponStats(weapon);
	return `<span class="build-status ${stats.ready ? "ready" : "incomplete"}">${icon(stats.ready ? "check" : "scrap", 14)} ${stats.ready ? "Готов к выходу" : "Нужна сборка"}</span>`;
}
function needsWeaponRepair(weapon: WeaponInstance) {
	return weapon.durability < 100 || Object.values(weapon.modules).some((part) => part.durability < 100);
}
function weaponLiquidationReason(weapon: WeaponInstance): string | null {
	if (state.raids.some((raid) => raid.weaponInstanceId === weapon.id)) return "Оружие занято на маршруте";
	if (state.weapons.length <= 1) return "Последний ствол нужен отряду для восстановления";
	if (getWeaponStats(weapon).ready && !state.weapons.some((other) => other.id !== weapon.id && getWeaponStats(other).ready)) return "Последняя готовая пушка нужна отряду. Сначала собери ещё одну";
	return null;
}
function mountLabel(mount: string) {
	return moduleMountLabel(mount);
}
function weaponStatRows(weapon: WeaponInstance, preview?: WeaponInstance) {
	const stats = getWeaponStats(weapon), next = preview ? getWeaponStats(preview) : stats;
	const baseAmmoMultiplier = getWeaponRole(weapon).ammoMultiplier;
	const metrics = [
		["power", "Мощь", false, ""], ["ergonomics", "Эргономика", false, ""],
		["recoil", "Отдача", true, ""], ["reliability", "Надёжность", false, " / 100"],
		["weight", "Вес", true, " кг"], ["ammoMultiplier", "Расход", true, "×"],
	] as const;
	return `<div class="bench-stat-grid">${metrics.map(([key, label, lower, unit]) => {
		const before = stats[key] * (key === "ammoMultiplier" ? baseAmmoMultiplier : 1), after = next[key] * (key === "ammoMultiplier" ? baseAmmoMultiplier : 1), delta = Math.round((after - before) * 100) / 100;
		const format = (value: number) => key === "weight" || key === "ammoMultiplier" ? value.toFixed(2) : String(Math.round(value));
		return `<div class="bench-stat"><span>${label}${key === "recoil" ? " ↓" : ""}</span><strong>${format(before)}${unit}${preview && delta ? `<b class="stat-after">→ ${format(after)}${unit}</b>` : ""}</strong><small class="${delta ? (lower ? delta < 0 : delta > 0) ? "better" : "worse" : ""}">${preview ? delta ? `${delta > 0 ? "+" : ""}${format(delta)}${key === "reliability" ? "" : unit}` : "Без изменений" : key === "ergonomics" ? "Выше — быстрее путь" : key === "recoil" ? "Ниже — лучше контроль в бою" : key === "reliability" ? "Индекс исправности, не шанс" : key === "weight" ? "Влияет на комплект" : key === "ammoMultiplier" ? "Без веса всего комплекта" : "Боевой вклад с учётом износа"}</small></div>`;
	}).join("")}</div>`;
}
function moduleTraits(item: ModuleInstance) {
	return moduleModelTraits(getModuleDefinition(item), getModuleEffectiveStats(item), `При ${Math.round(item.durability)}% состояния`);
}
function moduleModelTraits(model: ModuleModel, traits = model.stats, condition = "При 100% состояния") {
	const values = [
		["damage", "Мощь", ""], ["ergonomics", "Эрго", ""], ["recoil", "Отдача", ""],
		["reliability", "Надёжн.", ""], ["weight", "Вес", " кг"], ["ammoMultiplier", "Патроны", "×"],
	] as const;
	return `<small class="module-traits-condition">${condition}</small><div class="module-traits">${values.filter(([key]) => key === "ammoMultiplier" ? traits[key] !== 1 : traits[key] !== 0).map(([key, label, unit]) => `<span>${label} <b>${key === "ammoMultiplier" ? `×${traits[key].toFixed(2)}` : `${key !== "weight" && traits[key] > 0 ? "+" : ""}${Math.round(traits[key] * 100) / 100}${unit}`}</b></span>`).join("") || '<span>Штатный элемент · без дополнительных бонусов</span>'}</div>`;
}
function moduleFitDetails(model: ModuleModel, weapon?: WeaponInstance) {
	const mounts = weapon ? new Set(getResolvedModuleMounts(weapon.modules, model.slot)) : null;
	return `<div class="module-fit"><span>${model.platforms.includes("*") ? "Универсальная платформа" : `Платформа ${e(model.platforms.map(modulePlatformLabel).join(" / "))}`}</span><span>${model.calibers.includes("*") ? "Любой калибр" : `Калибр ${e(model.calibers.join(" / "))}`}</span>${model.requiresMount ? `<span class="${mounts && !mounts.has(model.requiresMount) ? "mount-missing" : ""}">Нужно: ${e(mountLabel(model.requiresMount))}${mounts ? mounts.has(model.requiresMount) ? " · есть на сборке" : " · сначала добавь крепление" : ""}</span>` : ""}${model.providesMounts.length ? `<span>Открывает: ${e(model.providesMounts.map(mountLabel).join(" / "))}</span>` : ""}</div>`;
}
function weaponMounts(weapon: WeaponInstance) {
	const mounts = getResolvedModuleMounts(weapon.modules);
	return `<div class="bench-build-mounts" aria-label="Крепления сборки"><strong>Крепления:</strong>${mounts.length ? mounts.map((mount) => `<span>${e(mountLabel(mount))}</span>`).join("") : "Без планок и резьбы для дополнительных модулей"}</div>`;
}
function preservedTuning(weapon: WeaponInstance) {
	const legacy = Object.entries(weapon.attachments).filter(([, level]) => level > 0);
	return legacy.length ? `<div class="preserved-tuning"><strong>Сохранённая доводка</strong><p>${legacy.map(([slot, level]) => `${ATTACHMENT_LABELS[slot as keyof typeof ATTACHMENT_LABELS]}: ур. ${level}`).join(" · ")}. Бонусы прежнего оружия учтены в характеристиках; физические модули настраиваются отдельно.</p></div>` : "";
}
function buildRaidEffects(weapon: WeaponInstance, preview?: WeaponInstance) {
	const scav = state.scavs.find((person) => person.weaponInstanceId === weapon.id);
	if (!scav) return '<p class="bench-raid-note">Выдай оружие бойцу, чтобы увидеть стоимость и время первого этапа с его комплектом.</p>';
	const map = MAP_BY_ID[selectedMap]!, quote = getRaidQuote(state, scav, map);
	const afterState = preview ? { ...state, weapons: state.weapons.map((gun) => gun.id === weapon.id ? preview : gun) } : state;
	const after = getRaidQuote(afterState, scav, map);
	return `<div class="bench-raid-effects"><span class="eyebrow">Первый этап · ${e(scav.name)} · ${e(map.name)}</span><div><span>Шанс <b>${Math.round(quote.chance * 100)}%${preview ? ` → ${Math.round(after.chance * 100)}%` : ""}</b></span><span>Патроны <b>${quote.ammo}${preview ? ` → ${after.ammo}` : ""}</b></span><span>До связи <b>${seconds(quote.duration)}${preview ? ` → ${seconds(after.duration)}` : ""}</b></span></div><small>Тактика, здоровье, броня и рюкзак бойца уже учтены.${scav.status === "raiding" ? " Текущая экспедиция сохранит исходную сборку." : ""}</small></div>`;
}
function selectBenchSlot(slot: ModuleSlot) {
	selectedModuleSlot = slot;
	selectedBenchModule = null;
	benchPartSearch = "";
	renderWorkbench();
	document.querySelector<HTMLButtonElement>(`[data-bench-slot="${slot}"]`)?.focus({ preventScroll: true });
	if (window.innerWidth <= 760) document.querySelector("#bench-slot-panel")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
}
function openWorkbench(id: string) {
	toolOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	page = "arsenal";
	arsenalTab = "bench";
	selectedWeapon = id;
	selectedBenchModule = null;
	selectedModuleSlot = "optic";
	render();
	document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
}
function renderWorkbench() {
	queueMicrotask(preloadVisibleWeaponArtwork);
	const weapon = state.weapons.find((item) => item.id === selectedWeapon) ?? state.weapons[0];
	if (!weapon) {
		panel.innerHTML = `${arsenalTabs()}<div class="empty">Верстак свободен. Начни сборку со ствольной коробки на складе модулей.<button class="button secondary" data-arsenal-tab="modules">${icon("settings", 17)} К модулям</button></div>`;
		return;
	}
	selectedWeapon = weapon.id;
	const def = getWeaponDefinition(weapon), info = RECEIVER_INFO[weapon.weaponId]!;
	const busy = state.raids.some((raid) => raid.weaponInstanceId === weapon.id);
	const owner = state.scavs.find((scav) => scav.weaponInstanceId === weapon.id);
	const current = weapon.modules[selectedModuleSlot];
	const candidate = state.modules.find((item) => item.id === selectedBenchModule && getModuleDefinition(item).slot === selectedModuleSlot);
	const reason = candidate ? getModuleInstallReason(state, weapon.id, candidate.id) : null;
	const preview: WeaponInstance | undefined = candidate && !reason ? { ...weapon, durability: selectedModuleSlot === "receiver" ? candidate.durability : weapon.durability, attachments: selectedModuleSlot === "receiver" ? { ...(candidate.legacyAttachments ?? { optic: 0, magazine: 0, stock: 0 }) } : weapon.attachments, modules: { ...weapon.modules, [selectedModuleSlot]: candidate } } : undefined;
	const issues = getWeaponBuildIssues(preview ?? weapon), disassembleReason = getWeaponDisassembleReason(state, weapon.id);
	const oldScroll = panel.querySelector<HTMLElement>(".bench-candidates")?.scrollTop ?? 0;
	const parts = state.modules.filter((item) => moduleModelMatches(getModuleDefinition(item), { slot: selectedModuleSlot, rarity: "all", platform: "all", search: benchPartSearch })).sort((a, b) => Number(Boolean(getModuleInstallReason(state, weapon.id, a.id))) - Number(Boolean(getModuleInstallReason(state, weapon.id, b.id))));
	const slotCards = MODULE_DISPLAY_SLOTS.map((slot) => {
		const item = weapon.modules[slot], required = info.requiredSlots.includes(slot);
		return `<button class="bench-slot ${slot === selectedModuleSlot ? "active" : ""} ${item ? "filled" : required ? "missing" : "slot-empty"}" data-bench-slot="${slot}" data-focus-key="bench-slot-${slot}" aria-pressed="${slot === selectedModuleSlot}" aria-label="${MODULE_SLOT_LABELS[slot]}: ${item ? e(getModuleDefinition(item).label) : required ? "обязательный модуль отсутствует" : "не установлен"}"><span class="bench-slot-label">${MODULE_SLOT_LABELS[slot]}${required ? '<b title="Обязателен для выхода">●</b>' : ""}</span><span class="bench-slot-art">${item ? moduleArt(getModuleDefinition(item)) : `<span class="empty-slot-icon">${icon(slot === "receiver" ? "arsenal" : "settings", 29)}</span>`}</span><strong>${item ? e(getModuleDefinition(item).label) : required ? "Нужно установить" : "Свободный слот"}</strong><small>${item ? `${Math.round(item.durability)}% состояния` : required ? "Обязателен для выхода" : "Дополнительная настройка"}</small></button>`;
	}).join("");
	panel.innerHTML = `${arsenalTabs()}<div class="bench-toolbar"><div><span class="eyebrow">Мастерская Прапора · оружейный стол</span><h2>${e(def.name)}</h2><p>${e(modulePlatformLabel(info.platform))} · ${e(info.caliber)}${owner ? ` · выдано: ${e(owner.name)}` : " · резерв базы"}</p></div><label class="field-label">Оружие на верстаке<select data-bench-weapon aria-label="Оружие на верстаке">${state.weapons.map((gun) => `<option value="${gun.id}" ${gun.id === weapon.id ? "selected" : ""}>${e(getWeaponDefinition(gun).name)}${getWeaponStats(gun).ready ? "" : " · не собрано"}</option>`).join("")}</select></label></div><div class="workbench-layout"><section class="bench-build"><div class="bench-mat"><div class="bench-mat-head">${weaponReadiness(preview ?? weapon)}<span class="mono">${preview ? "ПРЕДПРОСМОТР · НЕ УСТАНОВЛЕНО" : "ТЕКУЩАЯ СБОРКА"}</span></div><div class="workbench-stage">${weaponBuildArt(preview ?? weapon, selectedModuleSlot)}</div><div class="bench-mat-foot"><span>${icon("settings", 14)} Выбери деталь на оружии или слот ниже</span><span>${Object.keys((preview ?? weapon).modules).length} / ${MODULE_SLOTS.length} СЛОТОВ</span></div></div>${busy ? '<p class="risk-note">Оружие сейчас в рейде. Осмотр доступен; сборку и обслуживание можно изменить после возвращения.</p>' : issues.length ? `<div class="assembly-warning">${icon("scrap", 20)}<div><strong>${preview ? "После замены сборке ещё нужны детали." : "Сборка пока не готова к рейду."}</strong>${issues.map((issue) => `<p>${e(issue)}</p>`).join("")}</div></div>` : `<p class="assembly-ready">✓ Все обязательные элементы на месте. ${preview ? "Подтверди установку выбранного модуля." : "Настрой комплект под маршрут."}</p>`}${weaponMounts(preview ?? weapon)}${weaponStatRows(weapon, preview)}${weaponMechanicsPanel(weapon, selectedMap, owner?.tactic ?? "balanced", preview)}${buildRaidEffects(weapon, preview)}${preservedTuning(weapon)}<div class="bench-slots" role="group" aria-label="Слоты сборки оружия">${slotCards}</div><div class="bench-service"><a class="button secondary small" href="${e(pixelArsenalPreviewUrl(weapon, owner?.appearance ?? 0))}" target="_blank" rel="noopener noreferrer">Посмотреть на бойце ↗</a><button class="button secondary small" data-action="repair" data-id="${weapon.id}" ${busy || !needsWeaponRepair(weapon) || !canAfford(getRepairCost(weapon)) ? "disabled" : ""}>Ремонт сборки · ${costLabel(getRepairCost(weapon))}</button><button class="button ghost small" data-action="disassemble-weapon" data-id="${weapon.id}" ${disassembleReason ? "disabled" : ""}>Разобрать на модули</button></div><small class="cost-reason" data-weapon-cost="${weapon.id}-repair">${busy ? "Оружие в рейде" : !needsWeaponRepair(weapon) ? "Ремонт не нужен" : costReason(getRepairCost(weapon))}</small><small class="quote-note" data-disassemble-note>${e(disassembleReason ?? "Разбор сохранит все установленные физические детали")}</small></section><aside class="bench-slot-panel" id="bench-slot-panel"><div class="bench-panel-head"><span class="eyebrow">Выбранный слот</span><h3>${MODULE_SLOT_LABELS[selectedModuleSlot]}</h3></div>${current ? installedModulePanel(weapon, current) : `<div class="bench-current empty-current"><span>${icon("settings", 23)}</span><strong>Модуль не установлен</strong><p>${info.requiredSlots.includes(selectedModuleSlot) ? "Выбери совместимую деталь ниже, чтобы завершить сборку." : e(moduleSlotHint(selectedModuleSlot))}</p></div>`}${candidate ? candidateModulePanel(weapon, candidate, reason) : '<div class="bench-preview-hint">Выбери деталь из запаса. Увидишь сборку и изменение характеристик до установки.</div>'}<div class="bench-candidate-head"><h3>Детали из запаса <span class="muted">/ ${parts.length}</span></h3><button class="text-button" data-action="browse-modules" data-slot="${selectedModuleSlot}">Склад →</button></div><label class="weapon-search bench-part-search">${icon("settings", 16)}<input type="search" data-bench-search aria-label="Поиск деталей для выбранного слота" placeholder="Название детали" value="${e(benchPartSearch)}"></label><div class="bench-candidates">${parts.map((item) => {
		const model = getModuleDefinition(item), blocked = getModuleInstallReason(state, weapon.id, item.id);
		return `<button class="bench-candidate ${item.id === candidate?.id ? "selected" : ""} ${blocked ? "incompatible" : ""}" data-action="pick-module" data-id="${item.id}" data-focus-key="candidate-${item.id}" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="candidate-art">${moduleArt(model)}</span><span class="candidate-copy"><b>${e(model.label)}</b><small>${RARITY_LABELS[model.rarity]} · ${Math.round(item.durability)}%</small><span>${e(blocked ?? "Совместим · доступен для установки")}</span></span></button>`;
	}).join("") || '<div class="empty compact-empty">В запасе нет таких деталей.<br>Найди их в рейде или изготовь на складе модулей.</div>'}</div></aside></div>`;
	const candidates = panel.querySelector<HTMLElement>(".bench-candidates"); if (candidates) candidates.scrollTop = oldScroll;
}
function installedModulePanel(weapon: WeaponInstance, item: ModuleInstance) {
	const model = getModuleDefinition(item), reason = getModuleRemoveReason(state, weapon.id, model.slot);
	return `<div class="bench-current" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">Установлено · ${RARITY_LABELS[model.rarity]}</span>${moduleArt(model)}<h3>${e(model.label)}</h3><p>${e(model.description)}</p><div class="module-condition"><span>Состояние</span><strong>${Math.round(item.durability)}%</strong><i class="health-track"><i style="width:${item.durability}%"></i></i></div>${moduleTraits(item)}${moduleFitDetails(model, weapon)}<button class="button ghost small" data-action="remove-module" data-id="${weapon.id}" data-slot="${model.slot}" data-focus-key="remove-${model.slot}" ${reason ? "disabled" : ""}>Снять на склад</button><small class="quote-note">${e(reason ?? "Деталь сохранит состояние и вернётся в запас")}</small></div>`;
}
function candidateModulePanel(weapon: WeaponInstance, item: ModuleInstance, reason: string | null) {
	const model = getModuleDefinition(item);
	return `<div class="bench-candidate-preview" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">${reason ? "Проверка совместимости" : "Предпросмотр замены"}</span>${moduleArt(model)}<h3>${e(model.label)}</h3><p>${e(model.description)}</p>${moduleTraits(item)}${moduleFitDetails(model, weapon)}<button class="button" data-action="install-module" data-id="${weapon.id}" data-module-id="${item.id}" data-focus-key="install-${model.slot}" ${reason ? "disabled" : ""}>${weapon.modules[model.slot] ? "Заменить модуль" : "Установить модуль"} ${icon("check", 16)}</button><small class="quote-note">${e(reason ?? "При замене текущая деталь вернётся на склад; состояние обеих сохранится")}</small><button class="button ghost small" data-action="clear-module-preview">Вернуть текущую сборку</button></div>`;
}
function moduleMatches(item: ModuleInstance) {
	return moduleModelMatches(getModuleDefinition(item), { slot: moduleSlotFilter, rarity: moduleRarityFilter, platform: modulePlatformFilter, search: moduleSearch });
}
function selectedProductionWorkshop() {
	const workshops = state.shelter.rooms.filter((room) => room.type === "workshop");
	const room = workshops.find((item) => item.id === productionWorkshopId) ?? workshops.find((item) => item.status === "ready") ?? workshops[0];
	productionWorkshopId = room?.id ?? null;
	return room;
}
function renderModules() {
	queueMicrotask(preloadVisibleWeaponArtwork);
	const workshop = selectedProductionWorkshop();
	const craftExpanded = panel.querySelector<HTMLDetailsElement>(".module-craft-catalog")?.open;
	const installedExpanded = panel.querySelector<HTMLDetailsElement>(".installed-parts-list")?.open;
	const loose = state.modules.filter(moduleMatches);
	const installed = state.weapons.flatMap((weapon) => MODULE_DISPLAY_SLOTS.map((slot) => weapon.modules[slot]).filter((item): item is ModuleInstance => Boolean(item)).filter(moduleMatches).map((item) => ({ item, weapon })));
	const craftWeapon = state.weapons.find((weapon) => weapon.id === selectedWeapon) ?? state.weapons[0];
	const filters = { slot: moduleSlotFilter, rarity: moduleRarityFilter, platform: modulePlatformFilter, search: moduleSearch };
	const recipes = MODULE_MODELS.filter((model) => moduleModelMatches(model, filters) && (!moduleCraftForWeapon || !craftWeapon || moduleFitsWeaponFamily(model, craftWeapon.weaponId)));
	const filterKey = JSON.stringify([filters, moduleCraftForWeapon, moduleCraftForWeapon ? craftWeapon?.id : null]);
	if (filterKey !== moduleCatalogFilterKey) { moduleCatalogPageIndex = 0; moduleCatalogFilterKey = filterKey; }
	const recipePage = moduleCatalogPage(recipes, moduleCatalogPageIndex);
	moduleCatalogPageIndex = recipePage.index;
	const platforms = [...new Set(MODULE_MODELS.flatMap((model) => model.platforms).filter((platform) => platform !== "*"))];
	const pagination = recipePage.total ? `<nav class="module-catalog-pagination" aria-label="Страницы каталога модулей"><button class="button ghost small" data-action="module-catalog-page" data-direction="-1" ${recipePage.index === 0 ? "disabled" : ""}>← Назад</button><span aria-live="polite">${recipePage.start}–${recipePage.end} / ${recipePage.total}</span><button class="button ghost small" data-action="module-catalog-page" data-direction="1" ${recipePage.index + 1 >= recipePage.pageCount ? "disabled" : ""}>Дальше →</button></nav>` : "";
	panel.innerHTML = `${arsenalTabs()}<div class="module-storage-head"><div><span class="eyebrow">Физические детали · каждый экземпляр сохранён</span><h2>Склад модулей</h2><span class="module-catalog-total">${MODULE_MODELS.length} моделей · ${MODULE_SLOTS.length} слотов сборки</span><p>Снимай, меняй и собирай. Износ остаётся с деталью; найденная ствольная коробка становится основой нового оружия.</p></div><span class="tag">${state.modules.length} / ${getModuleCapacity(state)} В ЗАПАСЕ</span></div><div class="module-filters"><label class="field-label">Слот<select data-module-slot-filter aria-label="Фильтр модулей по слоту"><option value="all" ${moduleSlotFilter === "all" ? "selected" : ""}>Все слоты</option>${MODULE_DISPLAY_SLOTS.map((slot) => `<option value="${slot}" ${moduleSlotFilter === slot ? "selected" : ""}>${MODULE_SLOT_LABELS[slot]}</option>`).join("")}</select></label><label class="field-label">Платформа<select data-module-platform-filter aria-label="Фильтр модулей по платформе"><option value="all" ${modulePlatformFilter === "all" ? "selected" : ""}>Все платформы</option>${platforms.map((platform) => `<option value="${e(platform)}" ${modulePlatformFilter === platform ? "selected" : ""}>${e(modulePlatformLabel(platform))}</option>`).join("")}</select></label><label class="field-label">Редкость<select data-module-rarity-filter aria-label="Фильтр модулей по редкости"><option value="all" ${moduleRarityFilter === "all" ? "selected" : ""}>Любая редкость</option>${Object.keys(RARITY_LABELS).map((rarity) => `<option value="${rarity}" ${moduleRarityFilter === rarity ? "selected" : ""}>${RARITY_LABELS[rarity as keyof typeof RARITY_LABELS]}</option>`).join("")}</select></label><label class="weapon-search module-search">${icon("settings", 18)}<input type="search" data-module-search aria-label="Поиск модулей" placeholder="Название, калибр или крепление" value="${e(moduleSearch)}"></label></div><div class="module-catalog-tools"><span>Планки, кронштейны, хомуты и резьба определяют доступные прицелы, фонари, лазеры, рукояти и дульные устройства.</span><button class="text-button" data-action="reset-module-filters">Сбросить фильтры</button></div><div class="section-head"><h2>Свободные детали <span class="muted">/ ${loose.length}</span></h2><button class="text-button" data-arsenal-tab="bench">На верстак →</button></div><div class="module-inventory-grid">${loose.map((item) => moduleInventoryCard(item)).join("") || '<div class="empty compact-empty">Здесь пока нет деталей. Проверь фильтры, сними деталь с оружия или изготовь нужный модуль ниже.</div>'}</div>${installed.length ? `<details class="installed-parts-list" ${installedExpanded ? "open" : ""}><summary>На оружии · ${installed.length} ${icon("arsenal", 17)}</summary><div class="module-inventory-grid">${installed.map(({ item, weapon }) => moduleInventoryCard(item, weapon)).join("")}</div></details>` : ""}<details class="module-craft-catalog" ${craftExpanded ?? (moduleSlotFilter !== "all" || Boolean(moduleSearch)) ? "open" : ""}><summary><span>${icon("scrap", 21)} Производство деталей<small>${recipes.length} из ${MODULE_MODELS.length} моделей · по выбранным фильтрам</small></span><b>+</b></summary><div class="craft-context"><label class="loadout-check"><input type="checkbox" data-craft-for-weapon ${moduleCraftForWeapon ? "checked" : ""}><span>Для текущего оружия<small>${craftWeapon ? e(getWeaponDefinition(craftWeapon).name) : "Нет выбранной сборки"}</small></span></label>${craftWeapon ? `<select data-craft-weapon aria-label="Оружие для фильтра изготовления">${state.weapons.map((gun) => `<option value="${gun.id}" ${gun.id === craftWeapon.id ? "selected" : ""}>${e(getWeaponDefinition(gun).name)}</option>`).join("")}</select>` : ""}</div><div class="production-workshop-picker"><label class="field-label">Очередь мастерской<select data-production-workshop aria-label="Мастерская для изготовления модулей">${state.shelter.rooms.filter((room) => room.type === "workshop").map((room) => `<option value="${room.id}" ${room.id === workshop?.id ? "selected" : ""}>${e(ROOM_DEFINITIONS[room.type].label)} · сектор ${room.row + 1} · ур. ${room.level} · очередь ${room.queue.length}/5 · рабочих ${room.workerIds.length}</option>`).join("") || '<option>Построй мастерскую на базе</option>'}</select></label>${workshop ? `<button class="button ghost small" data-action="open-work-room" data-id="${workshop.id}">Назначить людей и увидеть очередь →</button>` : '<button class="button ghost small" data-page="base">Построить мастерскую →</button>'}</div><p class="field-hint">Штатные детали закрывают недостающие обязательные слоты. Более сложные варианты требуют развитой мастерской; ствольные коробки — открытия оружия. Модули производятся по времени, только с назначенными работниками.</p>${pagination}<div class="module-inventory-grid">${recipePage.items.map((model) => {
		const quote = getModuleProductionQuote(state, workshop?.id ?? "", model.id);
		return `<article class="module-card recipe-card" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">${MODULE_SLOT_LABELS[model.slot]} · ${RARITY_LABELS[model.rarity]}</span><div class="module-card-art">${moduleArt(model)}</div><h3>${e(model.label)}</h3><p>${e(model.description)}</p>${moduleModelTraits(model)}${moduleFitDetails(model, moduleCraftForWeapon ? craftWeapon : undefined)}<div class="module-fit"><span>Мастерская ур. ${model.workshopLevel} · базовая работа ${seconds(quote.duration)}</span></div><button class="button secondary small" data-action="craft-module" data-id="${model.id}" ${quote.reason ? "disabled" : ""}>В очередь · ${costLabel(quote)}</button><small class="quote-note" data-module-craft-note="${model.id}">${e(quote.reason ?? "Бойцы изготовят деталь по очереди; оплата при постановке")}</small></article>`;
	}).join("") || '<div class="empty compact-empty">Нет моделей по выбранным фильтрам.</div>'}</div>${pagination}</details>`;
}
function moduleInventoryCard(item: ModuleInstance, weapon?: WeaponInstance) {
	const model = getModuleDefinition(item), cost = getModuleRepairCost(item), stats = model.stats;
	return `<article class="module-card ${weapon ? "installed" : ""}" style="--rarity:${RARITY_COLORS[model.rarity]}"><div class="module-card-heading"><span class="eyebrow">${MODULE_SLOT_LABELS[model.slot]}</span><b>${RARITY_LABELS[model.rarity]}</b></div><div class="module-card-art">${moduleArt(model)}</div><h3>${e(model.label)}</h3><p>${e(model.description)}</p><div class="module-condition"><span>${weapon ? `На оружии: ${e(getWeaponDefinition(weapon).name)}` : "На складе"}</span><strong>${Math.round(item.durability)}%</strong><i class="health-track"><i style="width:${item.durability}%"></i></i></div>${moduleFitDetails(model, weapon)}<div class="module-fit"><span>Вес ${stats.weight.toFixed(2)} кг</span></div>${moduleTraits(item)}${weapon ? `<button class="button ghost small" data-action="open-bench" data-id="${weapon.id}" data-slot="${model.slot}">Осмотреть на верстаке →</button><small class="quote-note">Сними деталь с оружия, чтобы обслужить или продать её отдельно</small>` : `${model.slot === "receiver" ? `<button class="button secondary" data-action="assemble-weapon" data-id="${item.id}">Начать сборку оружия</button>` : `<button class="button secondary" data-action="use-module" data-id="${item.id}">Подобрать на верстаке →</button>`}<button class="button ghost small" data-action="repair-module" data-id="${item.id}" ${item.durability >= 100 || !canAfford(cost) ? "disabled" : ""}>Ремонт · ${costLabel(cost)}</button><small class="quote-note" data-module-repair-note="${item.id}">${item.durability >= 100 ? "Ремонт не нужен" : costReason(cost)}</small><div class="module-disposal"><button class="text-button" data-action="sell-module" data-id="${item.id}">Продать · ${n(getModuleSaleValue(item))} ₽</button><button class="text-button" data-action="recycle-module" data-id="${item.id}" ${state.supplies.scrap + getModuleRecycleYield(item) > getSupplyCapacity(state).scrap ? "disabled" : ""}>Утилизация · ${getModuleRecycleYield(item)} дет.</button></div><small class="quote-note" data-module-recycle-note="${item.id}">${state.supplies.scrap + getModuleRecycleYield(item) > getSupplyCapacity(state).scrap ? "Нет места для деталей на складе" : "Продажа и утилизация уничтожают этот экземпляр"}</small>`}</article>`;
}
function renderEquipment() {
	const items = state.gearItems.map((item) => {
		const model = getGearModel(item), repair = getGearRepairCost(item);
		const owner = state.scavs.find((scav) => scavHasGear(scav, item.id));
		const busy = owner?.status === "raiding";
		return `<article class="logistics-card"><span class="eyebrow">${GEAR_EQUIPMENT_LABELS[model.slot]} · ${owner ? e(owner.name) : "На складе"}</span>${scavGearIllustration(model.id, model.label)}<h3>${icon(model.slot, 23)} ${e(model.label)}</h3><p>${e(model.description)}</p><div class="loadout-stats"><span>Состояние ${Math.round(item.durability)}%</span><span>Вес ${model.weight} кг</span>${model.protection ? `<span>Защита до ${Math.round(model.protection * 100)}%</span>` : ""}${model.capacity ? `<span>Груз до ${model.capacity} ед.</span>` : ""}</div><div class="health-track"><i style="width:${item.durability}%"></i></div>${owner ? `<button class="button ghost" data-scav="${owner.id}">Комплект: ${e(owner.name)}</button>` : `<label class="field-label">Выдать бойцу<select data-assign-gear="${item.id}" data-slot="${model.slot}" aria-label="Выдать ${e(model.label)} бойцу"><option value="">Выбери бойца</option>${state.scavs.filter((scav) => scav.status !== "raiding").map((scav) => `<option value="${scav.id}">${e(scav.name)}${gearLoadoutItemId(scav, model.slot) ? " · заменить предмет" : ""}</option>`).join("")}</select></label>`}<button class="button secondary small" data-action="repair-gear" data-id="${item.id}" ${busy || item.durability >= 100 || !canAfford(repair) ? "disabled" : ""}>Ремонт · ${costLabel(repair)}</button><small class="quote-note">${busy ? "Предмет на маршруте" : item.durability >= 100 ? "Ремонт не нужен" : costReason(repair)}</small><button class="button ghost small" data-action="recycle-gear" data-id="${item.id}" ${busy ? "disabled" : ""}>Утилизация · ${getGearRecycleYield(item)} дет.</button><small class="quote-note" data-recycle-note>Утилизация возвращает материалы; предмет исчезнет</small></article>`;
	}).join("");
	const recipes = GEAR_MODELS.map((model) => {
		const reason = getGearCraftReason(state, model.id);
		const known = !model.blueprint || state.blueprints.includes(model.blueprint);
		return `<article class="logistics-card ${known ? "" : "locked"}"><span class="eyebrow">${known ? "Чертёж известен" : "Нужен чертёж"}</span>${scavGearIllustration(model.id, model.label)}<h3>${icon(model.slot, 22)} ${e(model.label)}</h3><p>${e(model.description)}</p><div class="loadout-stats"><span>Вес ${model.weight} кг</span>${model.protection ? `<span>Защита до ${Math.round(model.protection * 100)}%</span>` : ""}${model.capacity ? `<span>Груз до ${model.capacity} ед.</span>` : ""}</div><button class="button secondary" data-action="craft-gear" data-id="${model.id}" ${reason ? "disabled" : ""}>Собрать · ${costLabel(model)}</button><small class="quote-note" data-craft-note="${model.id}">${e(reason ?? "Снаряжение появится на складе")}</small></article>`;
	}).join("");
	panel.innerHTML = `${arsenalTabs()}<div class="logistics-intro">${icon("armor", 28)}<div><h3>У комплекта есть цена и характер.</h3><p>Броня и шлем повышают защиту, вместительный рюкзак удержит больше находок. Вес удлиняет путь и расход; износ ослабляет предмет. Сравни итоговый комплект в личном деле бойца.</p></div></div><div class="section-head"><h2>Склад снаряжения <span class="muted">/ ${state.gearItems.length}</span></h2><button class="text-button" data-mission-board>К бойцам →</button></div>${items ? `<div class="logistics-grid">${items}</div>` : '<div class="empty">Отдельных предметов пока нет. Собери броню, шлем или рюкзак ниже, затем выдай бойцу.</div>'}<div class="section-head"><h2>Сборка по чертежам</h2><button class="text-button" data-action="open-discoveries">Постоянные открытия →</button></div><div class="logistics-grid">${recipes}</div>`;
}
function renderMarket() {
	const capacities = getSupplyCapacity(state);
	panel.innerHTML = `${arsenalTabs()}<div class="logistics-intro">${icon("money", 28)}<div><h3>Планируй расходы до выхода.</h3><p>Патроны, разведданные, лечение и ремонт расходуются. База даёт ограниченный запас для восстановления, основная прибыль — добыча. Излишки оружия можно продать или утилизировать на материалы.</p></div></div><div class="economy-balance"><div>Резерв для восстановления<strong>${n(getRecoveryAllowance(state))} ₽</strong><span>Пассивные рубли до этой суммы</span></div><div>Отряд на автовыходах<strong>${state.scavs.filter((scav) => scav.autoRaid.enabled).length}</strong><span>Каждый повтор оплачивается</span></div><div>Запасной арсенал<strong>${state.weapons.filter((weapon) => !state.scavs.some((scav) => scav.weaponInstanceId === weapon.id)).length}</strong><span>Продажа или разбор</span></div></div><div class="section-head"><h2>Закупить припасы</h2><span class="muted">Склад имеет предел</span></div><div class="logistics-grid">${MARKET_OFFERS.map((offer) => {
		const reason = getMarketReason(state, offer.id);
		return `<article class="logistics-card"><span class="eyebrow">${supplyName(offer.supply)}</span><h3>${icon(offer.supply, 25)} ${e(offer.label)}</h3><p>На складе <b data-supply-count="${offer.supply}">${n(state.supplies[offer.supply])}</b> / ${capacities[offer.supply]} · партия +${offer.amount}</p><div class="progress"><i style="width:${Math.min(100, state.supplies[offer.supply] / capacities[offer.supply] * 100)}%"></i></div><button class="button secondary" data-action="buy-supplies" data-id="${offer.id}" ${reason ? "disabled" : ""}>Купить ${offer.amount} · ${n(offer.money)} ₽</button><small class="quote-note" data-market-note="${offer.id}">${e(reason ?? "Полная партия поместится на складе")}</small></article>`;
	}).join("")}</div><div class="raid-instruction">${icon("scrap", 25)}<div>Утилизация возвращает материалы для ремонта и изготовления.<br><span class="muted">Во вкладке «Оружие» выбери лишний ствол. Продажа принесёт рубли, утилизация — материалы. Чтобы сохранить физические модули, сними их на верстаке. Сначала сними предмет с бойца, если хочешь сохранить его комплект.</span></div></div>`;
}
function discoveriesSection() {
	const unlocked = Object.keys(BLUEPRINTS).filter((id) => state.blueprints.includes(id)).length;
	const expanded = document.querySelector<HTMLDetailsElement>("#discoveries")?.open ?? false;
	return `<details id="discoveries" class="discoveries-disclosure" ${expanded ? "open" : ""}><summary data-focus-key="discoveries-summary">${icon("intel", 20)}<span>Память отряда <b class="muted">/ ${unlocked} открытий</b></span><i aria-hidden="true">+</i></summary><div class="discoveries-content"><div class="logistics-intro">${icon("intel", 26)}<div><h3>Потеря не обнуляет путь.</h3><p>Чертежи и разведанные тропы сохраняются сразу после находки. Тайники открывают грузовую раму, оружейный склад — плитник, разведка — безопасные маршруты. Каждый выбор оставляет след.</p></div></div><div class="research-grid">${Object.entries(BLUEPRINTS).map(([id, discovery]) => {
		const known = state.blueprints.includes(id);
		return `<article class="research-card ${known ? "unlocked" : ""}"><span class="eyebrow">${known ? "✓ Открыто навсегда" : "Пока неизвестно"}</span><h3>${e(discovery.label)}</h3><p>${e(discovery.description)}</p>${known && GEAR_MODELS.some((model) => model.blueprint === id) ? '<button class="button ghost small" data-action="open-equipment">Собрать по чертежу →</button>' : ""}</article>`;
	}).join("")}</div></div></details>`;
}
function weaponDetail(weapon: WeaponInstance) {
	const def = getWeaponDefinition(weapon), role = getWeaponRole(weapon), stats = getWeaponStats(weapon);
	const owner = state.scavs.find((scav) => scav.weaponInstanceId === weapon.id);
	const busy = state.raids.some((raid) => raid.weaponInstanceId === weapon.id);
	const repair = getRepairCost(weapon), issues = getWeaponBuildIssues(weapon);
	const liquidationReason = weaponLiquidationReason(weapon);
	return `<aside class="weapon-detail"><span class="eyebrow" style="color:${RARITY_COLORS[def.rarity]}">${RARITY_LABELS[def.rarity]} · ${CATEGORY_LABELS[def.category]}</span><h2>${e(def.name)}</h2>${weaponBuildArt(weapon)}${weaponReadiness(weapon)}<p>${e(def.description)}</p>${preservedTuning(weapon)}<div class="weapon-role"><strong>${e(role.label)}</strong><p>${e(role.description)}</p><div class="loadout-stats"><span>Вес ${stats.weight.toFixed(2)} кг</span><span>Патроны ×${(stats.ammoMultiplier * role.ammoMultiplier).toFixed(2)}</span><span>Модулей ${Object.keys(weapon.modules).length} / ${MODULE_SLOTS.length}</span></div></div><div class="detail-row"><span>Мощность</span><strong>${stats.power}</strong></div><div class="detail-row"><span>Эргономика</span><strong>${Math.round(stats.ergonomics)}</strong></div><div class="detail-row"><span>Отдача · ниже лучше</span><strong>${Math.round(stats.recoil)}</strong></div><div class="detail-row"><span>Надёжность · индекс</span><strong>${Math.round(stats.reliability)} / 100</strong></div><div class="detail-row"><span>Состояние</span><strong>${Math.round(weapon.durability)}%</strong></div><div class="health-track"><i style="width:${weapon.durability}%"></i></div>${issues.length ? `<p class="risk-note">${issues.map(e).join(" · ")}</p>` : ""}${weaponMechanicsPanel(weapon, selectedMap, owner?.tactic ?? "balanced")}<button class="button bench-entry" data-action="open-bench" data-id="${weapon.id}">${icon("scrap", 18)} Открыть оружейный верстак</button><div class="detail-row"><span>Выдано</span><strong>${owner ? e(owner.name) : "На складе"}</strong></div><div class="weapon-assign">${owner ? `<button class="button ghost" data-scav="${owner.id}">${icon("people", 16)} Личное дело: ${e(owner.name)}</button>` : `<label class="field-label">Выдать бойцу<select data-assign-weapon="${weapon.id}" aria-label="Выдать ${e(def.name)} бойцу"><option value="">Выбери бойца</option>${state.scavs.filter((scav) => scav.status !== "raiding").map((scav) => `<option value="${scav.id}">${e(scav.name)}${scav.weaponInstanceId ? " · заменить ствол" : " · без оружия"}</option>`).join("")}</select></label>`}</div><div class="detail-actions"><button class="button secondary" data-action="repair" data-id="${weapon.id}" ${busy || !needsWeaponRepair(weapon) || !canAfford(repair) ? "disabled" : ""}>Ремонт сборки · ${costLabel(repair)}</button><small class="cost-reason" data-weapon-cost="${weapon.id}-repair">${busy ? "Оружие в рейде" : !needsWeaponRepair(weapon) ? "Ремонт не нужен" : costReason(repair)}</small><button class="button ghost" data-action="sell" data-id="${weapon.id}" ${liquidationReason ? "disabled" : ""} title="${e(liquidationReason ?? "Продажа вместе с установленными модулями")}">Продать сборку · ${n(getWeaponSaleValue(weapon))} ₽</button><button class="button ghost" data-action="recycle-weapon" data-id="${weapon.id}" ${liquidationReason ? "disabled" : ""} title="${e(liquidationReason ?? "Уничтожить сборку и модули, получить материалы")}">Утилизация сборки · ${getWeaponRecycleYield(weapon)} дет.</button><small class="quote-note" data-recycle-note>${e(liquidationReason ?? "Продажа и утилизация удалят всю сборку с модулями. Чтобы сохранить модули, используй верстак")}</small></div></aside>`;
}
function showSettings() {
    document.querySelector('#modal-root')!.innerHTML = '<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><h2 id="settings-title">Прогресс на сервере</h2><div class="save-summary"><span class="eyebrow">Проверенное игровое состояние</span><p>Ресурсы, инвентарь, производство и исходы рейдов считает и сохраняет сервер. Вкладки и устройства получают одно состояние. Файлы и изменения в браузере не добавляют деньги или предметы.</p><button class="button secondary" data-action="save-now">Обновить с сервера</button></div><p>Гость привязан к cookie браузера. Для доступа с другого устройства войди в аккаунт. Экспорт — копия для просмотра; загрузка произвольного прогресса отключена.</p><p>Постоянные приказы продолжаются по серверному времени. Ручная экспедиция ждёт твоего решения на контрольной точке.</p><div class="detail-actions"><button class="button ghost" data-action="export">Скачать копию прогресса</button><button class="button" data-action="close-modal">Вернуться</button></div></section></div>';
    focusModal();
}
function showAutoRaidOrder(scavId: string) {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return;
	const map = MAP_BY_ID[selectedMap]!;
	document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal auto-raid-modal" role="dialog" aria-modal="true" aria-labelledby="auto-title"><span class="eyebrow">Постоянный приказ · ${e(scav.name)}</span><h2 id="auto-title">Автовыходы: ${e(map.name)}</h2><div class="order-brief"><span>${icon("repeat", 19)} Повторять выбранный маршрут</span><span>${icon("medicine", 19)} Выходить при ${scav.autoRaid.minHealth} / 100 здоровья</span><span>${icon("backpack", 19)} Эвакуироваться на глубине ${scav.autoRaid.maxDepth} / 3</span><span>${icon("time", 19)} Работать и офлайн · до 8 часов</span></div><p>Дикий будет повторять маршрут до глубины ${scav.autoRaid.maxDepth}, затем эвакуируется автоматически. Приказ действует, пока хватает рублей на логистику, патронов, разведданных и исправного снаряжения. Он работает и офлайн; ручные выходы продолжаются только после твоего выбора.</p><p class="order-risk">Каждый повтор несёт риск: можно потерять дикого и его оружие. Броня снижает потери, но не гарантирует возвращение.</p><p>Кнопка «Остановить автовыходы» отменяет будущие выходы. Текущая экспедиция останется в пути с исходной глубиной эвакуации.</p><div class="detail-actions"><button class="button" data-action="confirm-auto" data-id="${scav.id}" data-route="${map.id}" data-min-health="${scav.autoRaid.minHealth}">${scav.autoRaid.enabled ? "Изменить приказ" : "Включить автовыходы"}</button><button class="button ghost" data-action="close-modal">Назад к бойцу</button></div></section></div>`;
	focusModal();
}
function followGameplayAction(origin: HTMLElement) {
	const guidance = getGameplayGuidance(state), action = guidance.action;
	closeModal(); closeInspector();
	toolOrigin = origin;
	if (action.mapId && MAP_BY_ID[action.mapId] && state.level >= MAP_BY_ID[action.mapId]!.level) selectedMap = action.mapId;
	if (action.kind === "watch" && action.raidId) { watchRaid(action.raidId); return; }
	if (action.kind === "room" && action.roomId) { setView("base"); openShelterRoom(action.roomId, action.tab); return; }
	if (action.kind === "scav" && action.scavId) {
		openInspector(action.scavId);
		if (guidance.campaign.contractId === "gear-ready") {
			document.querySelector<HTMLElement>(".loadout-section")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
			document.querySelector<HTMLButtonElement>('[data-focus-key="equipment-store"]')?.focus({ preventScroll: true });
		}
		return;
	}
	if (action.kind === "raid") { openMultiplayerEntry(multiplayerSelection(action.mapId)); return; }
	if (action.kind === "market") { page = "arsenal"; arsenalTab = "market"; }
	else if (action.kind === "arsenal") { page = "arsenal"; arsenalTab = "weapons"; }
	else if (action.kind === "recruits") page = "recruits";
	else if (action.kind === "room") page = "base";
	else { page = "contracts"; contractFilter = "open"; }
	render();
	const claim = action.contractId ? panel.querySelector<HTMLButtonElement>(`[data-action="claim"][data-id="${CSS.escape(action.contractId)}"]`) : null;
	if (claim && !claim.disabled) { claim.scrollIntoView({ block: "center", behavior: scrollBehavior() }); claim.focus({ preventScroll: true }); }
	else document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
}
document.addEventListener("click", async (event) => {
	storedProgressChanged();
	if ((event.target as Element).closest("#tool-root, #inspector-root, #modal-root, #command-dock, #context-shade, button, select, input, summary")) holdWorldInput();
	const artSlot = (event.target as Element).closest<SVGElement>('.workbench-stage [data-module-slot]');
	if (artSlot?.dataset.moduleSlot) { selectBenchSlot(artSlot.dataset.moduleSlot as ModuleSlot); return; }
	const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
		"button"
	);
	if (target && (!serverReady || saveConflict || protectedSave) && !target.hasAttribute('data-open-live') && target.dataset.page !== "raids" && target.dataset.view !== 'live' && !(liveMode?.isActive() && ['base','map','raid'].includes(target.dataset.view ?? '')) && !['settings','close-modal','export','import','reconnect-server','save-now'].includes(target.dataset.action ?? '')) return;
	if (!target || target.disabled) {
		if ((event.target as HTMLElement).classList.contains("inspector-backdrop")) closeInspector();
		if ((event.target as HTMLElement).classList.contains("modal-backdrop")) closeModal();
		if ((event.target as HTMLElement).classList.contains("tool-backdrop")) closeTools();
		if ((event.target as HTMLElement).id === "context-shade") closeCommandContext();
		return;
	}
	if (target.hasAttribute('data-open-live')) { openMultiplayerEntry(); return; }
	if (target.hasAttribute('data-mission-board')) { openMissionBoard(); return; }
	if (target.dataset.liveDistrict) { const district = ENTRY_DISTRICTS.find(item => item.id === target.dataset.liveDistrict); if (district) openMultiplayerEntry({ districtId: district.id }); return; }
	if (target.dataset.action === "choose-plan-ground" || buildingPlacement && target.dataset.shelterRoom && target.closest("[data-territory-plan]")) {
		if (buildingPlacement) {
			if (event.detail === 0) { closeTools(); worldViewport.focus({ preventScroll: true }); return; }
			const map = target.closest<HTMLElement>("[data-territory-plan]");
			if (map) {
				const rect = map.getBoundingClientRect();
				const point = getTerritoryPlanPoint({ x: rect.left, y: rect.top, width: rect.width, height: rect.height },
					{ x: Number(map.dataset.planOriginX), y: Number(map.dataset.planOriginY), width: Number(map.dataset.planWidth), height: Number(map.dataset.planHeight) }, event.clientX, event.clientY);
				if (point) chooseFreeBuildingSite(point.x, point.y);
			}
		} else {
			const catalogue = panel.querySelector<HTMLElement>(".territory-catalogue");
			catalogue?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
			(catalogue?.querySelector<HTMLButtonElement>('button[data-action="place-building"]:not(:disabled)') ?? catalogue)?.focus({ preventScroll: true });
		}
		return;
	}
	if (target.dataset.workerHandle) { beginKeyboardAssignment(target.dataset.workerHandle); return; }
	if (target.dataset.action === "gameplay-next") { followGameplayAction(target); return; }
	if (target.dataset.action === "toggle-sound") { void toggleGameSound(); return; }
	if (target.hasAttribute("data-worker-cancel")) { cancelWorkerPlacement(true, true); return; }
	if (target.dataset.workerRoom && workerPlacement?.mode === "keyboard") {
		const reason = getWorkerAssignmentReason(state, workerPlacement.scavId, target.dataset.workerRoom);
		if (reason) { workerPlacement.roomId = target.dataset.workerRoom; workerPlacement.reason = reason; paintWorkerPlacement(); toast(reason, false); return; }
		assignPlacedWorker(workerPlacement.scavId, target.dataset.workerRoom); return;
	}
	if (target.dataset.watchRaid) { watchRaid(target.dataset.watchRaid); return; }
	if (target.hasAttribute('data-live-close')) { setView("base"); document.querySelector<HTMLButtonElement>('[data-view="base"]')?.focus({ preventScroll: true }); return; }
	if (target.dataset.raidOrders) { const raid = state.raids.find(item => item.id === target.dataset.raidOrders); if (raid) openInspector(raid.scavId); return; }
	if (target.dataset.scav) { if (page === "home" && worldView === "base" && !liveMode?.isActive() && world?.projectScav(target.dataset.scav)) { selectedScav = target.dataset.scav; fieldObjects?.show({ kind: "scav", id: target.dataset.scav }); } else openInspector(target.dataset.scav); return; }
	if (target.dataset.ammoPick && target.dataset.ammoScav) { act(await gameAction({ type: "setLoadoutOption", args: [target.dataset.ammoScav, "ammoType", target.dataset.ammoPick] })); return; }
	if (target.dataset.camera) { cameraAction(target.dataset.camera); return; }
	if (target.dataset.cameraRoom) { inspectRoomView(target.dataset.cameraRoom); return; }
	if (target.dataset.commandRoom) { openShelterRoom(target.dataset.commandRoom, target.dataset.commandTab as CommandRoomTab); return; }
	if (target.dataset.shelterRoom) { openShelterRoom(target.dataset.shelterRoom); return; }
	if (target.dataset.roomContextTab) {
		roomContextTab = target.dataset.roomContextTab as typeof roomContextTab;
		const root = renderActiveRoomPanel();
		activeRoomPanelScroll(root)?.scrollTo({ top: 0 });
		root.querySelector<HTMLButtonElement>(`[data-room-context-tab="${roomContextTab}"]`)?.focus({ preventScroll: true });
		return;
	}
	if (target.dataset.commandMap) { selectedMap = target.dataset.commandMap; openMultiplayerEntry(multiplayerSelection(selectedMap)); return; }
	if (target.dataset.shelterColumn != null) { openShelterSite(Number(target.dataset.shelterColumn), Number(target.dataset.shelterRow)); return; }
	if (target.dataset.benchSlot) { selectBenchSlot(target.dataset.benchSlot as ModuleSlot); return; }
	if (target.dataset.roomLink) { openRoom(target.dataset.roomLink as BaseRoom); return; }
	if (target.dataset.page === "raids") { openMultiplayerEntry(); return; }
	if (target.dataset.page) {
		toolOrigin = target;
		page = target.dataset.page as Page;
		roomToolOpen = false;
		render();
		if(page==='flea')void refreshFleaMarket();
		if (page === 'achievements') { dismissAchievementNotice(); acknowledgeAchievementScreen(); }
		if (page !== "home") document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
		return;
	}
	if(target.dataset.fleaTab){fleaView.tab=target.dataset.fleaTab as FleaTab;render();return;}
	if (target.dataset.view) {
		setView(target.dataset.view as "base" | "map" | "raid" | "live");
		return;
	}
	if (target.dataset.map) {
		selectedMap = target.dataset.map;
		render();
		return;
	}
	if (target.dataset.weapon) {
		selectedWeapon = target.dataset.weapon;
		render();
		if (window.innerWidth <= 640) document.querySelector(".weapon-detail")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
		return;
	}
	if (target.dataset.filter) {
		category = target.dataset.filter as WeaponCategory | "all";
		render();
		return;
	}
	if (target.dataset.arsenalTab) {
		arsenalTab = target.dataset.arsenalTab as typeof arsenalTab;
		render();
		document.querySelector<HTMLButtonElement>(`[data-arsenal-tab="${arsenalTab}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
		return;
	}
	if (target.dataset.contractFilter) {
		contractFilter = target.dataset.contractFilter as typeof contractFilter;
		render();
		return;
	}
	if (target.dataset.achievementFilter) {
		achievementFilter = readAchievementFilter(target.dataset.achievementFilter);
		render();
		acknowledgeAchievementScreen();
		panel.querySelector<HTMLButtonElement>(`[data-achievement-filter="${achievementFilter}"]`)?.focus({ preventScroll: true });
		return;
	}
	const id = target.dataset.id ?? "";
	switch (target.dataset.action) {
		case 'boss-prepare':{
            const card=target.closest<HTMLElement>('[data-boss-card]');
            const preparation=readBossPreparation(state,target.dataset.boss,card?.querySelector<HTMLSelectElement>('[data-boss-scav]')?.value);
            if(!preparation){toast('Выбери свободного дикого для подготовки.');break;}
            selectedMap=preparation.mapId;page='raids';render();openInspector(preparation.scavId);break;
        }
        case 'flea-clear-hunt':lootHunt=null;render();break;
		case 'flea-hunt':{
			const hunt=readLootHunt({modelId:target.dataset.model,mapId:target.dataset.huntMap,branch:target.dataset.branch,depth:Number(target.dataset.depth)});
			if(!hunt||state.level<(MAP_BY_ID[hunt.mapId]?.level??Infinity))break;
			lootHunt=hunt;selectedMap=hunt.mapId;openMultiplayerEntry(multiplayerSelection(hunt.mapId, "loot"));break;
		}
		case 'flea-use-construction':{
			const type=target.dataset.roomType;
			if(!type||!Object.hasOwn(ROOM_DEFINITIONS,type))break;
			page='base';render();
			const control=panel.querySelector<HTMLButtonElement>(`[data-action="place-building"][data-room-type="${CSS.escape(type)}"]`);
			control?.closest('.territory-blueprint')?.scrollIntoView({block:'nearest',behavior:scrollBehavior()});
			if(control&&!control.disabled)control.focus({preventScroll:true});
			break;
		}
		case 'flea-use-production':{
			const recipe=RESOURCE_RECIPES.find(recipe=>recipe.id===id);
			if(!recipe)break;
			const room=state.shelter.rooms.find(room=>room.type===recipe.roomType&&room.status==='ready')??state.shelter.rooms.find(room=>room.type===recipe.roomType);
			if(!room){page='base';render();toast(`Сначала построй ${ROOM_DEFINITIONS[recipe.roomType].label}.`);break;}
			openShelterRoom(room.id,'production');
			const control=activeRoomPanel().querySelector<HTMLButtonElement>(`[data-action="set-room-recipe"][data-recipe-id="${CSS.escape(id)}"]`);
			control?.closest('.resource-recipe')?.scrollIntoView({block:'nearest',behavior:scrollBehavior()});
			if(control&&!control.disabled)control.focus({preventScroll:true});
			break;
		}
		case 'flea-barter-model':{
			const modelId=target.dataset.model;
			if(!modelId||!Object.hasOwn(LOOT_MODEL_BY_ID,modelId))break;
			fleaView.tab='barter';fleaView.barterModelId=modelId;fleaView.search='';render();break;
		}
		case 'flea-clear-barter-filter':fleaView.barterModelId=null;render();break;
		case 'flea-close-receipt':fleaView.receivedGearId=null;render();break;
		case 'flea-claim-delivery':act(await gameAction({type:'claimLootDelivery',args:[id]}));break;
		case 'flea-barter':{
			const quote=getBarterQuote(state,id);
			if(!quote.offer||quote.reason){toast(quote.reason??'Обмен недоступен.',false);break;}
			barterDraft={offerId:id,itemIds:[...quote.itemIds]};
			document.querySelector('#modal-root')!.innerHTML=barterConfirmation(state,id);focusModal();break;
		}
		case 'flea-confirm-barter':{
			if(!barterDraft||barterDraft.offerId!==id)break;
			const draft=barterDraft,gearBefore=new Set(state.gearItems.map(item=>item.id));barterDraft=null;closeModal();
			const result=await gameAction({type:'barterGear',args:[id,draft.itemIds]});
			if(result.ok){fleaView.receivedGearId=state.gearItems.find(item=>!gearBefore.has(item.id))?.id??null;if(fleaView.draft?.ref.kind==='loot'&&draft.itemIds.includes(fleaView.draft.ref.id))fleaView.draft=null;}
			act(result);break;
		}
		case 'flea-refresh':void refreshFleaMarket();break;
		case 'flea-close-draft':fleaView.draft=null;render();panel.querySelector<HTMLButtonElement>('[data-flea-tab="inventory"]')?.focus({preventScroll:true});break;
		case 'flea-select':{
			const row=getTradeInventory(state).find(item=>item.ref.id===id&&item.ref.kind===target.dataset.kind);
			if(!row||row.reason)break;
			fleaView.draft={ref:{...row.ref,quantity:1},quantity:'1',price:String(row.guidePrice)};fleaView.tab='inventory';render();
			panel.querySelector<HTMLInputElement>('[data-flea-price]')?.focus({preventScroll:true});
			panel.querySelector('.flea-editor')?.scrollIntoView({block:'nearest',behavior:scrollBehavior()});
			if(!fleaView.market)void refreshFleaMarket();
			break;
		}
		case 'flea-use-guide':{
			if(!fleaView.draft)break;
			const quantity=readFleaInteger(fleaView.draft.quantity,10_000);
			if(quantity===null){toast('Укажи целое количество.',false);break;}
			const quote=getTradeQuote(state,{...fleaView.draft.ref,quantity});
			if(!quote.asset){toast(quote.reason??'Партия недоступна.',false);break;}
			fleaView.draft.price=String(quote.guidePrice);render();break;
		}
		case 'flea-list':{
			if(!fleaView.draft)break;
			const order=readFleaOrder(state,fleaView.draft);
			if(!order||order.reason){toast(order?.reason??'Укажи целые количество и цену.',false);break;}
			const result=await gameAction({type:'listMarketItem',args:[order.ref,order.price]});
			if(result.ok){fleaView.draft=null;fleaView.tab='mine';}
			act(result);break;
		}
		case 'flea-buy':act(await gameAction({type:'buyMarketListing',args:[id]}));break;
		case 'flea-cancel':act(await gameAction({type:'cancelMarketListing',args:[id]}));break;
		case 'flea-claim':act(await gameAction({type:'claimMarketSale',args:[id]}));break;
		case 'flea-sell-loot':
		case 'flea-recycle-loot':{
			const item=state.lootItems?.find(item=>item.id===id),model=item?LOOT_MODEL_BY_ID[item.modelId]:null,row=getTradeInventory(state).find(item=>item.ref.kind==='loot'&&item.ref.id===id);
			if(!model||!row)break;
			const purpose=getLootUses(model.id).map(use=>`${use.kind==="construction"?"Стройка":use.kind==="production"?"Производство":"Бартер"}: ${use.label} ×${use.quantity}`).join(" · ");
			const sale=target.dataset.action==='flea-sell-loot',salvage=Object.entries(model.salvage).filter(([,value])=>value>0).map(([key,value])=>`${n(value)} ${({ammo:'патронов',medicine:'медикаментов',scrap:'деталей',intel:'разведданных'} as Record<string,string>)[key]}`).join(' · ');
			document.querySelector('#modal-root')!.innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="loot-disposal-title"><h2 id="loot-disposal-title">${sale?'Продать торговцу':'Разобрать'} ${e(row.label)}?</h2><p>${sale?`Торговец сразу выплатит ${n(row.traderPrice??0)} ₽. На барахолке ориентир ${n(row.guidePrice)} ₽; покупатель может предложить другую ценность.`:`Предмет будет израсходован. Убежище получит: ${e(salvage)}. Для ресурсов должно хватать места на складе.`}</p>${purpose?`<p>Этот предмет нужен для: <b>${e(purpose)}</b>. После ${sale?"продажи":"разбора"} он исчезнет из набора.</p>`:""}<div class="detail-actions"><button class="button danger" data-action="flea-confirm-disposal" data-id="${e(id)}" data-kind="${sale?'sale':'recycle'}">${sale?'Продать':'Разобрать'}</button><button class="button ghost" data-action="close-modal">Оставить</button></div></section></div>`;focusModal();break;
		}
		case 'flea-confirm-disposal':{
			closeModal();act(await gameAction(target.dataset.kind==='sale'?{type:'sellLootItem',args:[id]}:{type:'recycleLootItem',args:[id]}));break;
		}
		case 'dismiss-achievement-notice': dismissAchievementNotice(true); break;
		case "close-tools": closeTools(); break;
		case "close-context": closeCommandContext(); break;
		case "place-building": beginBuildingPlacement(target.dataset.roomType as ShelterRoomType); break;
		case "move-building": {
			const room = state.shelter.rooms.find(item => item.id === id);
			if (room) beginBuildingPlacement(room.type, room.id);
			break;
		}
		case "placement-cancel": cancelBuildingPlacement(); render(); break;
		case "placement-confirm": await confirmBuildingPlacement(); break;
		case "placement-plan": page = "base"; render(); break;
		case "open-market":
			toolOrigin = target; page = "arsenal"; arsenalTab = "market"; render(); document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus(); break;
		case "excavate-wall": {
			const result = await gameAction({ type: "excavateShelter", args: [Number(target.dataset.column), Number(target.dataset.row)] });
			act(result, "build"); return;
		}
		case "build-room": {
			const column = Number(target.dataset.column), row = Number(target.dataset.row);
			const result = await gameAction({ type: "buildRoom", args: [target.dataset.roomType as ShelterRoomType, column, row] });
			if (result.ok) { selectedRoomId = state.shelter.rooms.find((room) => room.column === column && room.row === row)?.id ?? null; selectedShelterSite = null; contextMode = "room"; roomContextTab = "upgrade"; }
			act(result, "build");
			break;
		}
		case "upgrade-room":
			act(await gameAction({ type: "upgradeRoom", args: [id] }), "build");
			break;
		case "assign-worker":
			act(await gameAction({ type: "assignWorker", args: [chosenWorkers.get(id) ?? "", id] }), "assign");
			break;
		case "release-worker":
			act(await gameAction({ type: "assignWorker", args: [id, null] }), "assign");
			break;
		case "open-work-room":
			openShelterRoom(id, "production");
			break;
		case "save-production-reserve": {
			const editor = target.closest<HTMLElement>('[data-reserve-editor]');
			if (!editor) break;
			const values = Object.fromEntries(Array.from(editor.querySelectorAll<HTMLInputElement>('[data-production-reserve]')).map(input => [input.dataset.productionReserve!, input.value])) as ReserveDraft;
			const cost = readProductionReserveDraft(values);
			if (!cost) { toast("Резерв: введи целые неотрицательные значения во все поля.", false); break; }
			const submitted = JSON.stringify(values);
			const result = await gameAction({ type: "setProductionReserve", args: [cost] });
			if (result.ok && (!productionReserveDraft || JSON.stringify(productionReserveDraft) === submitted)) productionReserveDraft = null;
			act(result);
			break;
		}
		case "save-room-stock-target": {
			const room = state.shelter.rooms.find(item => item.id === id);
			const input = target.closest('.room-stock-target')?.querySelector<HTMLInputElement>('[data-room-stock-target]');
			if (!room || !input) break;
			const value = readRoomStockTargetDraft(input.value, room);
			if (value === undefined) { toast("Цель запаса: введи целое неотрицательное значение в допустимых пределах или очисти поле.", false); break; }
			const submitted = input.value;
			const result = await gameAction({ type: "setRoomStockTarget", args: [id, value] });
			if (result.ok && roomStockTargetDrafts.get(id) === submitted) roomStockTargetDrafts.delete(id);
			act(result);
			break;
		}
		case "seek-production-resource": { openMultiplayerEntry({ purpose: "loot" }); break; }
		case "set-room-recipe": {
			const repeat = target.hasAttribute("data-loot-order") ? false : target.closest('[data-room-management]')?.querySelector<HTMLInputElement>(`[data-room-repeat="${CSS.escape(id)}"]`)?.checked ?? false;
			roomRepeatPreferences.set(id, repeat);
			const oldRecipe = state.shelter.rooms.find(room => room.id === id)?.recipeId;
			const result = await gameAction({ type: "setRoomRecipe", args: [id, target.dataset.recipeId ?? null, repeat] });
			if (result.ok && oldRecipe !== target.dataset.recipeId) roomStockTargetDrafts.delete(id);
			act(result);
			break;
		}
		case "stop-room-recipe":
			act(await gameAction({ type: "setRoomRecipe", args: [id, null, false] }));
			break;
		case "queue-room-module":
			act(await gameAction({ type: "queueModuleProduction", args: [id, target.dataset.modelId ?? ""] }));
			break;
		case "queue-field-kit":
			act(await gameAction({ type: "queueFieldKitProduction", args: [id, target.dataset.kit as FieldKit] }));
			break;
		case "cancel-production": {

			const room = state.shelter.rooms.find((item) => item.id === id), job = room?.queue.find((item) => item.id === target.dataset.jobId);
			if (!job) { render();toast("Заказ уже завершён."); break; }
			document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-production-title"><h2 id="cancel-production-title">Отменить производственный заказ?</h2><p>${job.workDone > 0 ? "Работа уже началась: оплаченные материалы и рубли не вернутся." : job.paidLoot?.length ? "Заказ пока не начат. Рубли и обычные припасы вернутся, если к моменту отмены он ещё не начнёт работу. Целые трофеи уже израсходованы и не возвращаются." : "Заказ пока не начат. Полная стоимость вернётся, если к моменту отмены он ещё не начнёт работу."} Повторение рецепта выключится; остальные оплаченные заказы останутся.</p><div class="detail-actions"><button class="button danger" data-action="confirm-cancel-production" data-id="${id}" data-job-id="${job.id}">Отменить заказ</button><button class="button ghost" data-action="close-modal">Продолжить работу</button></div></section></div>`;
			focusModal();
			break;
		}
		case "confirm-cancel-production":
			closeModal();
			act(await gameAction({ type: "cancelProduction", args: [id, target.dataset.jobId ?? ""] }));
			break;
		case "open-bench":
			openWorkbench(id);
			if (target.dataset.slot) selectBenchSlot(target.dataset.slot as ModuleSlot);
			break;
		case "browse-modules":
			moduleSlotFilter = target.dataset.slot as ModuleSlot;
			moduleSearch = "";
			moduleRarityFilter = "all";
			arsenalTab = "modules";
			render();
			window.scrollTo(0, 0);
			break;
		case "reset-module-filters":
			moduleSlotFilter = "all"; moduleRarityFilter = "all"; modulePlatformFilter = "all"; moduleSearch = ""; moduleCraftForWeapon = true;
			renderModules(); document.querySelector<HTMLInputElement>("[data-module-search]")?.focus({ preventScroll: true }); break;
		case "module-catalog-page": {
			moduleCatalogPageIndex += Number(target.dataset.direction) || 0;
			renderModules();
			const catalog = document.querySelector(".module-craft-catalog");
			catalog?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
			catalog?.querySelector<HTMLButtonElement>(`[data-direction="${target.dataset.direction}"]`)?.focus({ preventScroll: true });
			break;
		}
		case "clear-module-preview":
			selectedBenchModule = null; renderWorkbench(); document.querySelector<HTMLButtonElement>(`[data-bench-slot="${selectedModuleSlot}"]`)?.focus({ preventScroll: true }); break;
		case "pick-module":
			selectedBenchModule = id;
			renderWorkbench();
			document.querySelector<HTMLButtonElement>(`[data-action="pick-module"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
			if (window.innerWidth <= 760) document.querySelector(".bench-candidate-preview")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
			break;
		case "use-module": {
			const item = state.modules.find((module) => module.id === id); if (!item) break;
			arsenalTab = "bench";
			selectedModuleSlot = getModuleDefinition(item).slot;
			selectedBenchModule = id;
			benchPartSearch = "";
			render();
			window.scrollTo(0, 0);
			break;
		}
		case "install-module":
			act(await gameAction({ type: "installModule", args: [id, target.dataset.moduleId ?? ""] }));
			break;
		case "remove-module":
			act(await gameAction({ type: "removeModule", args: [id, target.dataset.slot as ModuleSlot] }));
			break;
		case "assemble-weapon": {
			const existing = new Set(state.weapons.map((weapon) => weapon.id));
			const result = await gameAction({ type: "assembleWeapon", args: [id] });
			if (result.ok) {
				const built = state.weapons.find((weapon) => !existing.has(weapon.id));
				if (built) { selectedWeapon = built.id; selectedModuleSlot = RECEIVER_INFO[built.weaponId]!.requiredSlots.find((slot) => !built.modules[slot]) ?? "barrel"; }
				arsenalTab = "bench";
				selectedBenchModule = null;
			}
			act(result);
			if (result.ok) window.scrollTo(0, 0);
			break;
		}
		case "craft-module":
			act(await gameAction({ type: "queueModuleProduction", args: [selectedProductionWorkshop()?.id ?? "", id] }));
			break;
		case "repair-module":
			act(await gameAction({ type: "repairModule", args: [id] }));
			break;
		case "disassemble-weapon": {
			const weapon = state.weapons.find((item) => item.id === id); if (!weapon) break;
			document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="disassemble-title"><span class="eyebrow">Сохранить физические детали</span><h2 id="disassemble-title">Разобрать ${e(getWeaponDefinition(weapon).name)} на модули?</h2><p>Все ${Object.keys(weapon.modules).length} установленных деталей вернутся на склад со своим состоянием. Сборка исчезнет; её нужно будет собрать заново со ствольной коробки. Если оружие выдано бойцу, его оружейный слот освободится.</p><div class="detail-actions"><button class="button secondary" data-action="confirm-disassemble" data-id="${id}">Разобрать на модули</button><button class="button ghost" data-action="close-modal">Сохранить сборку</button></div></section></div>`;
			focusModal();
			break;
		}
		case "confirm-disassemble":
			closeModal();
			act(await gameAction({ type: "disassembleWeapon", args: [id] }));
			break;
		case "sell-module":
		case "recycle-module": {
			const item = state.modules.find((module) => module.id === id); if (!item) break;
			const sale = target.dataset.action === "sell-module", model = getModuleDefinition(item);
			const quote = sale ? `${n(getModuleSaleValue(item))} ₽` : `${getModuleRecycleYield(item)} деталей`;
			document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="module-disposal-title"><h2 id="module-disposal-title">${sale ? "Продать" : "Утилизировать"} ${e(model.label)}?</h2><div class="modal-module-art">${moduleArt(model)}</div><p>Этот экземпляр исчезнет без возврата модулей. База получит ${quote}. ${sale ? "Стоимость зависит от состояния." : "Для деталей должно хватать места на складе."}</p><div class="detail-actions"><button class="button danger" data-action="confirm-module-disposal" data-id="${id}" data-kind="${sale ? "sale" : "recycle"}">${sale ? "Продать" : "Утилизировать"} · ${quote}</button><button class="button ghost" data-action="close-modal">Оставить</button></div></section></div>`;
			focusModal();
			break;
		}
		case "confirm-module-disposal":
			closeModal();
			act(target.dataset.kind === "sale" ? await gameAction({ type: "sellModule", args: [id] }) : await gameAction({ type: "recycleModule", args: [id] }));
			break;
		case "review-decisions":
			closeInspector();
			page = "raids";
			render();
			document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
			document.querySelector<HTMLButtonElement>('[data-action="run-perk"], [data-action="extract"]')?.focus({ preventScroll: true });
			break;
		case "run-perk": {
			const raid = state.raids.find(item => item.id === id);
			for (const member of raid ? getRaidGroup(state, raid) : []) selectedPerks.set(member.id, target.dataset.perk as RunPerk);
			render();
			const scope = isInspectorOpen() ? document.querySelector("#inspector-root") : worldView === "raid" ? document.querySelector("#command-dock") : document.querySelector("#expedition-alerts");
			scope?.querySelector<HTMLButtonElement>(`[data-action="run-perk"][data-id="${CSS.escape(id)}"][data-perk="${CSS.escape(target.dataset.perk ?? "")}"]`)?.focus({ preventScroll: true });
			break;
		}
		case "continue-expedition": {
			const perk = selectedPerks.get(id);
			if (!perk) { toast("Выбери бонус маршрута.", false); break; }
			act(await gameAction({ type: "continueExpedition", args: [id, target.dataset.branch as ExpeditionBranch, perk] }));
			selectedPerks.delete(id);
			if (!isInspectorOpen()) focusScavOrTool(state.raids.find((raid) => raid.id === id)?.scavId ?? "");
			break;
		}
		case "extract": {
			const scavId = state.raids.find((raid) => raid.id === id)?.scavId;
			act(await gameAction({ type: "extractRaid", args: [id] }));
			selectedPerks.delete(id);
			if (!isInspectorOpen() && scavId) focusScavOrTool(scavId);
			break;
		}
		case "open-equipment":
			closeInspector();
			page = "arsenal";
			arsenalTab = "equipment";
			render();
			document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
			break;
		case "open-discoveries":
			closeInspector();
			page = "base";
			render();
			const discoveries = document.querySelector<HTMLDetailsElement>("#discoveries"); if (discoveries) discoveries.open = true;
			discoveries?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
			document.querySelector("#discoveries")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
			break;
		case "craft-gear":
			act(await gameAction({ type: "craftGear", args: [id] }));
			break;
		case "repair-gear":
			act(await gameAction({ type: "repairGear", args: [id] }));
			break;
		case "buy-supplies":
			act(await gameAction({ type: "buySupplies", args: [id] }));
			break;
		case "recycle-gear":
		case "recycle-weapon": {
			const gear = target.dataset.action === "recycle-gear" ? state.gearItems.find((item) => item.id === id) : null;
			const weapon = !gear ? state.weapons.find((item) => item.id === id) : null;
			if (!gear && !weapon) break;
			const label = gear ? getGearModel(gear).label : getWeaponDefinition(weapon!).name;
			const yieldValue = gear ? getGearRecycleYield(gear) : getWeaponRecycleYield(weapon!);
			document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="recycle-title"><h2 id="recycle-title">Утилизировать ${e(label)}?</h2><p>Предмет и все установленные модули будут уничтожены. Физические модули не вернутся на склад. База получит ${yieldValue} деталей. Для них должно хватать места на складе. Если предмет выдан бойцу, слот станет пустым.</p><div class="detail-actions"><button class="button danger" data-action="confirm-recycle" data-kind="${gear ? "gear" : "weapon"}" data-id="${id}">Утилизировать · ${yieldValue} дет.</button><button class="button ghost" data-action="close-modal">Оставить</button></div></section></div>`;
			focusModal();
			break;
		}
		case "confirm-recycle":
			closeModal();
			act(target.dataset.kind === "gear" ? await gameAction({ type: "recycleGear", args: [id] }) : await gameAction({ type: "recycleWeapon", args: [id] }));
			break;
		case "focus-roster":
			document.querySelector(".scav-grid")?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
			document.querySelector<HTMLButtonElement>(".scav-grid [data-scav]")?.focus({ preventScroll: true });
			break;
		case "close-inspector":
			closeInspector();
			break;
		case "toggle-map":
			showTacticalMap = !showTacticalMap;
			render();
			setView(showTacticalMap ? "map" : "base");
			break;
		case "tactic":
			act(await gameAction({ type: "setRaidTactic", args: [id, target.dataset.tacticValue as RaidTactic] }));
			break;
		case "inspect-weapon":
			openWorkbench(id);
			break;
		case "gear":
			act(await gameAction({ type: "upgradeScavGear", args: [id, target.dataset.slot as GearSlot] }));
			break;
		case "auto-enable":
		case "auto-route":
			showAutoRaidOrder(id);
			break;
		case "confirm-auto":
			closeModal();
			act(await gameAction({ type: "setAutoRaid", args: [id, target.dataset.route!, Number(target.dataset.minHealth)] }));
			break;
		case "auto-stop":
			act(await gameAction({ type: "setAutoRaid", args: [id, null, state.scavs.find((scav) => scav.id === id)?.autoRaid.minHealth ?? 70] }));
			break;
		case "auto-stop-all": {
			act(await gameAction({ type: "stopAllAutoRaids", args: [] }));
			break;
		}
		case "dismiss-offline":
			offlineSummary = null;
			renderOfflineSummary();
			document.querySelector<HTMLButtonElement>('.command-tools [data-page="journal"]')?.focus({ preventScroll: true });
			break;
		case "dispatch-squad": {
			const result = await gameAction({ type: "dispatchSquadRaid", args: [[...squadDraft], selectedMap] });
			if (result.ok) squadDraft = [];
			act(result);
			if (result.ok && result.raidId) watchRaid(result.raidId);
			break;
		}
		case "dispatch": {
			const result = await gameAction({ type: "dispatchRaid", args: [id, selectedMap] });
			act(result);
			const raid = state.raids.find(item => item.scavId === id);
			if (result.ok && raid) watchRaid(raid.id);
			break;
		}
		case "recruit":
			openRecruitment();
			break;
		case "recruit-candidate": {
			const owned = new Set(state.scavs.map(scav => scav.id));
			const result = await gameAction({ type: "hireRecruitCandidate", args: [id] });
			act(result);
			const arrival = result.ok ? state.scavs.find(scav => !owned.has(scav.id)) : null;
			if (arrival) openInspector(arrival.id);
			break;
		}
		case "recruit-refresh":
			act(await gameAction({ type: "refreshRecruitment", args: [] }));
			break;
		case "scav-talent":
			act(await gameAction({ type: "chooseScavTalent", args: [id, target.dataset.talent ?? ""] }));
			break;
		case "story-choice":
			act(await gameAction({ type: "resolveScavPersonalEvent", args: [id, target.dataset.event ?? "", target.dataset.choice ?? ""] }));
			break;
		case "social-choice":
			act(await gameAction({ type: "resolveSocialEvent", args: [target.dataset.event ?? "", target.dataset.choice ?? ""] }));
			break;
		case "dismiss-scav":
			showScavDismissal(id);
			break;
		case "confirm-dismiss-scav": {
			const result = await gameAction({ type: "dismissScav", args: [id] });
			closeModal();
			if (result.ok) { selectedScav = null; page = "recruits"; }
			act(result);
			break;
		}
		case "recruit-roster":
			page = "raids"; render();
			document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus({ preventScroll: true });
			break;
		case "heal":
			act(await gameAction({ type: "healScav", args: [id] }));
			break;
		case "upgrade":
			act(await gameAction({ type: "upgradeBase", args: [id as BaseRoom] }));
			break;
		case "repair":
			act(await gameAction({ type: "repairWeapon", args: [id] }));
			break;
		case "sell": {
			const weapon = state.weapons.find((w) => w.id === id);
			if (weapon)
				document.querySelector("#modal-root")!.innerHTML =
					`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="sell-title"><h2 id="sell-title">Продать ${e(getWeaponDefinition(weapon).name)}?</h2><p>Оружие и все установленные модули уйдут из арсенала. Чтобы сохранить детали, сначала сними их на верстаке. Если оно выдано дикому, его нужно будет вооружить другим стволом.</p><div class="detail-actions"><button class="button danger" data-action="confirm-sell" data-id="${id}">Продать</button><button class="button ghost" data-action="close-modal">Оставить</button></div></section></div>`;
			focusModal();
			break;
		}
		case "confirm-sell":
			closeModal();
			act(await gameAction({ type: "sellWeapon", args: [id] }));
			break;
		case "claim":
			act(await gameAction({ type: "claimContract", args: [id] }));
			break;
		case "collection":
			collection = !collection;
			render();
			break;
		case "reset-weapon-filters":
			category = "all";
			weaponSearch = "";
			render();
			document.querySelector<HTMLInputElement>("[data-weapon-search]")?.focus({ preventScroll: true });
			break;
		case "settings":
			showSettings();
			break;
		case "close-modal":
			closeModal();
			break;
		case 'export':{
      const url=URL.createObjectURL(new Blob([JSON.stringify(serverSnapshot)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='prapor-server-progress.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Скачана копия серверного прогресса для просмотра.');break;
    }
    case 'save-now':closeModal();if(await refreshServerProgress())toast('Состояние обновлено с сервера.');else toast(connectionMessage,false);break;
    case 'reconnect-server':await initializeAccount();break;

	}
});
document.addEventListener("change", async (event) => {
	const target = event.target as HTMLInputElement | HTMLSelectElement;
	storedProgressChanged();
	if (!serverReady || saveConflict || protectedSave) return;
	if(target.hasAttribute('data-flea-catalog-group')){fleaView.catalogGroup=target.value as LootCatalogGroup;render();return;}
	if(target.hasAttribute('data-flea-kind')){fleaView.kind=target.value as TradeKindFilter;render();return;}
	if (target.dataset.fieldKit) {
		const focusKey = target.dataset.focusKey;
		act(await gameAction({ type: "setFieldKit", args: [target.dataset.fieldKit, target.value as FieldKitSelection] }));
		if (focusKey) document.querySelector<HTMLSelectElement>(`#inspector-root [data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
		return;
	}
	if (target.dataset.raidObjective || target.dataset.raidPreparation) {
		const scavId = target.dataset.raidObjective ?? target.dataset.raidPreparation!;
		const scav = state.scavs.find(person => person.id === scavId);
		if (!scav) return;
		const plan = getRaidPlan(scav), focusKey = target.dataset.focusKey;
		act(await gameAction({type:'setRaidPlan',args:[scavId,target.dataset.raidObjective ? target.value as RaidObjective : plan.objective,
			target.dataset.raidPreparation ? target.value as RaidPreparation : plan.preparation]}));
		if (focusKey) document.querySelector<HTMLSelectElement>(`#inspector-root [data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
		return;
	}
	if (target.hasAttribute("data-live-raid-select")) { watchRaid(target.value); document.querySelector<HTMLSelectElement>('[data-live-raid-select]')?.focus({ preventScroll: true }); return; }
	if (target.dataset.squadMember) {
		const id = target.dataset.squadMember;
		if ((target as HTMLInputElement).checked && !squadDraft.includes(id) && squadDraft.length < 3) squadDraft.push(id);
		else if (!(target as HTMLInputElement).checked) squadDraft = squadDraft.filter(item => item !== id);
		scheduleSessionSave(); render(); return;
	}
	if (target.hasAttribute("data-squad-map")) { selectedMap = target.value; scheduleSessionSave(); render(); return; }
	if (target.dataset.roomWorker) {
		chosenWorkers.set(target.dataset.roomWorker, target.value);
		const room = state.shelter.rooms.find(item => item.id === target.dataset.roomWorker);
		const socialPanel = target.closest('.room-panel-section')?.querySelector<HTMLElement>('.social-room-panel');
		if (room && socialPanel) socialPanel.outerHTML = roomRelationsPanel(state, room, target.value);
		return;
	}
	if (target.dataset.roomRepeat) {
		const room = state.shelter.rooms.find((item) => item.id === target.dataset.roomRepeat);
		roomRepeatPreferences.set(target.dataset.roomRepeat, (target as HTMLInputElement).checked);
		if (room?.recipeId) act(await gameAction({ type: "setRoomRecipe", args: [room.id, room.recipeId, (target as HTMLInputElement).checked] }));
		return;
	}
	if (target.hasAttribute("data-room-module-slot")) { roomModuleSlot = target.value as typeof roomModuleSlot; renderActiveRoomPanel().querySelector<HTMLSelectElement>('[data-room-module-slot]')?.focus({ preventScroll: true }); return; }
	if (target.hasAttribute("data-room-module-weapon")) { selectedWeapon = target.value; renderActiveRoomPanel().querySelector<HTMLSelectElement>('[data-room-module-weapon]')?.focus({ preventScroll: true }); return; }
	if (target.hasAttribute("data-production-workshop")) { productionWorkshopId = target.value; renderModules(); document.querySelector<HTMLSelectElement>('[data-production-workshop]')?.focus({ preventScroll: true }); return; }
	if (target.hasAttribute("data-bench-weapon")) {
		selectedWeapon = target.value; selectedBenchModule = null; benchPartSearch = "";
		renderWorkbench(); document.querySelector<HTMLSelectElement>('[data-bench-weapon]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-module-slot-filter")) {
		moduleSlotFilter = target.value as typeof moduleSlotFilter;
		renderModules(); document.querySelector<HTMLSelectElement>('[data-module-slot-filter]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-module-platform-filter")) {
		modulePlatformFilter = target.value;
		if (moduleCraftForWeapon && modulePlatformFilter !== "all") {
			const craftWeapon = state.weapons.find((weapon) => weapon.id === selectedWeapon) ?? state.weapons[0];
			if (craftWeapon && RECEIVER_INFO[craftWeapon.weaponId]?.platform !== modulePlatformFilter) moduleCraftForWeapon = false;
		}
		renderModules(); document.querySelector<HTMLSelectElement>("[data-module-platform-filter]")?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-module-rarity-filter")) {
		moduleRarityFilter = target.value as typeof moduleRarityFilter;
		renderModules(); document.querySelector<HTMLSelectElement>('[data-module-rarity-filter]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-craft-for-weapon")) {
		moduleCraftForWeapon = (target as HTMLInputElement).checked;
		if (moduleCraftForWeapon) modulePlatformFilter = "all";
		renderModules(); document.querySelector<HTMLInputElement>('[data-craft-for-weapon]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-craft-weapon")) {
		selectedWeapon = target.value; if (moduleCraftForWeapon) modulePlatformFilter = "all"; renderModules(); document.querySelector<HTMLSelectElement>('[data-craft-weapon]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-inspector-map")) { selectedMap = target.value; render(); }
	if (target.dataset.assignWeapon && target.value) act(await gameAction({ type: "equipWeapon", args: [target.value, target.dataset.assignWeapon] }));
	if (target.dataset.equip)
		act(await gameAction({ type: "equipWeapon", args: [target.dataset.equip, target.value || null] }));
	if (target.dataset.equipGear) act(await gameAction({ type: "equipGear", args: [target.dataset.equipGear, target.dataset.slot as GearEquipmentSlot, target.value || null] }));
	if (target.dataset.assignGear && target.value) act(await gameAction({ type: "equipGear", args: [target.value, target.dataset.slot as GearEquipmentSlot, target.dataset.assignGear] }));
	if (target.dataset.ammoType) act(await gameAction({ type: "setLoadoutOption", args: [target.dataset.ammoType, "ammoType", target.value] }));
	if (target.dataset.medkit) act(await gameAction({ type: "setLoadoutOption", args: [target.dataset.medkit, "medkit", (target as HTMLInputElement).checked] }));
	if (target.dataset.autoDepth) act(await gameAction({ type: "setAutoRaidDepth", args: [target.dataset.autoDepth, Number(target.value)] }));
	if (target.dataset.tactic)
		act(await gameAction({ type: "setRaidTactic", args: [target.dataset.tactic, target.value as RaidTactic] }));
	if (target.dataset.autoHealth) {
		const scav = state.scavs.find((item) => item.id === target.dataset.autoHealth);
		if (scav) act(await gameAction({ type: "setAutoRaid", args: [scav.id, scav.autoRaid.enabled ? scav.autoRaid.mapId : null, Number(target.value)] }));
	}

});
document.addEventListener("input", (event) => {
	const input = event.target as HTMLInputElement;
	if(input.hasAttribute('data-flea-price')||input.hasAttribute('data-flea-quantity')){
		if(fleaView.draft){if(input.hasAttribute('data-flea-price'))fleaView.draft.price=input.value;else fleaView.draft.quantity=input.value;updateFleaDraftPreview();}return;
	}
	if(input.hasAttribute('data-flea-search')){
		fleaView.search=input.value;const caret=input.selectionStart;render();const replacement=panel.querySelector<HTMLInputElement>('[data-flea-search]');replacement?.focus({preventScroll:true});if(caret!==null)replacement?.setSelectionRange(caret,caret);return;
	}
	if (input.dataset.productionReserve) {
		const reserve = getProductionReserve(state);
		productionReserveDraft ??= { money: String(reserve.money), ...Object.fromEntries(Object.entries(reserve.supplies).map(([key, value]) => [key, String(value)])) } as ReserveDraft;
		productionReserveDraft[input.dataset.productionReserve as keyof ReserveDraft] = input.value;
		return;
	}
	if (input.dataset.roomStockTarget) { roomStockTargetDrafts.set(input.dataset.roomStockTarget, input.value); return; }
	if (input.hasAttribute("data-room-module-search")) {
		roomModuleSearch = input.value; const caret = input.selectionStart;
		const replacement = renderActiveRoomPanel().querySelector<HTMLInputElement>("[data-room-module-search]"); replacement?.focus({ preventScroll: true });
		if (caret != null) replacement?.setSelectionRange(caret, caret); return;
	}
	if (input.hasAttribute("data-module-search") || input.hasAttribute("data-bench-search")) {
		const isModule = input.hasAttribute("data-module-search"), selector = isModule ? "[data-module-search]" : "[data-bench-search]";
		if (isModule) moduleSearch = input.value; else benchPartSearch = input.value;
		const caret = input.selectionStart;
		if (isModule) renderModules(); else renderWorkbench();
		const replacement = document.querySelector<HTMLInputElement>(selector); replacement?.focus({ preventScroll: true });
		if (caret != null) replacement?.setSelectionRange(caret, caret);
		return;
	}
	if (!input.hasAttribute("data-weapon-search")) return;
	weaponSearch = input.value;
	const caret = input.selectionStart;
	renderArsenal();
	const replacement = document.querySelector<HTMLInputElement>("[data-weapon-search]");
	replacement?.focus({ preventScroll: true });
	if (caret != null) replacement?.setSelectionRange(caret, caret);
});
document.addEventListener("keydown", (event) => {
	if ((!serverReady || saveConflict || protectedSave) && !document.querySelector('#modal-root .modal')) return;
	if(event.target instanceof HTMLElement&&event.target.dataset.fleaTab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
		const tabs:FleaTab[]=['inventory','barter','market','mine','catalog'],current=tabs.indexOf(fleaView.tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
		event.preventDefault();fleaView.tab=tabs[next]!;render();panel.querySelector<HTMLButtonElement>(`[data-flea-tab="${fleaView.tab}"]`)?.focus({preventScroll:true});scheduleSessionSave();return;
	}
	if ((workerPlacement || crewPointer) && event.key === "Escape") { event.preventDefault(); cancelWorkerPlacement(true, true); return; }
	if (buildingDragPreview?.active && event.key === "Escape") { event.preventDefault(); world?.cancelBuildingDrag(); return; }
	if (buildingPlacement && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) {
		const distance = event.shiftKey ? 1 : 8;
		event.preventDefault(); nudgeBuildingPlacement(event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0, event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0); return;
	}
	if (buildingPlacement && !buildingPlacementBusy && event.key === "Escape") { event.preventDefault(); cancelBuildingPlacement(); if (page !== "home") closeTools(); return; }
	if (buildingPlacement && !buildingPlacementBusy && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "r" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) {
		event.preventDefault(); buildingPlacement.facing = (((buildingPlacement.facing ?? 0) + 1) % 4) as 0 | 1 | 2 | 3; paintBuildingPlacement(); return;
	}
	if (workerPlacement?.mode === "keyboard" && event.key === "Tab") {
		const controls = Array.from(document.querySelectorAll<HTMLButtonElement>("#worker-room-targets button, #worker-placement button")).filter((node) => node.getClientRects().length > 0);
		const index = controls.indexOf(document.activeElement as HTMLButtonElement);
		if (controls.length) {
			event.preventDefault();
			const next = index < 0 ? event.shiftKey ? controls.length - 1 : 0 : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
			controls[next]?.focus({ preventScroll: true });
		}
		return;
	}
	const dialog = document.querySelector<HTMLElement>("#modal-root .modal") ?? document.querySelector<HTMLElement>(".inspector") ?? (page !== "home" ? document.querySelector<HTMLElement>(".tool-window") : isContextDialogOpen() ? document.querySelector<HTMLElement>("#command-dock") : null);
	if (!dialog && event.key === "Escape" && document.querySelector<HTMLElement>(".field-object-card")?.hidden === false) { fieldObjects?.close(); event.preventDefault(); return; }
	if (!dialog) { if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement) && fieldInterface?.dismiss()) event.preventDefault(); return; }
	if (event.key === "Escape") {
		if (event.target instanceof HTMLSelectElement) return;
		event.preventDefault();
		if (document.querySelector("#modal-root .modal")) closeModal(); else if (isInspectorOpen()) closeInspector(); else if (page !== "home") closeTools(); else closeCommandContext();
	}
	if (event.key === "Tab" && dialog.matches(".modal")) {
		const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not([hidden]):not(:disabled), a[href], summary, [tabindex="0"]')).filter((node) => node.getClientRects().length > 0);
		const first = controls[0], last = controls.at(-1);
		if (first && last && event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
		else if (first && last && !event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
	}
});
function watchedRaid() {
	const active = state.raids.find(raid => raid.id === selectedRaidId);
	if (active) lastWatchedRaid = active;
	return active ?? (lastWatchedRaid?.id === selectedRaidId ? lastWatchedRaid : null);
}
function watchedReport() {
	const report = getWatchedReport(state, selectedRaidId);
	if (report && report !== lastWatchedReport) {
		if (lastWatchedRaid?.id === report.raidId && !state.raids.some(raid=>raid.id===report.raidId)) lastWatchedRaid = structuredClone(lastWatchedRaid);
		lastWatchedReport = report;
	}
	return report ?? (lastWatchedReport?.raidId === selectedRaidId ? lastWatchedReport : null);
}
function liveCheckpointControls(raid: Raid | null) {
	const run = raid?.expedition;
	if (!raid || !run || run.status !== "choice") return "";
	const perk = selectedPerks.get(raid.id);
	const choices = getExpeditionChoices(state, raid, perk);
	const selected = Boolean(perk && run.offers.includes(perk));
	return `<h3>Контрольная точка ${run.stage} / 3</h3><p>Уйти с добычей или рискнуть следующим кварталом.</p>${cargoWarehouseNotice(raid)}${run.offers.length ? `<div class="live-perks">${run.offers.map(id => `<button data-action="run-perk" data-id="${raid.id}" data-perk="${id}" aria-pressed="${perk === id}" class="${perk === id ? 'selected' : ''}"><strong>${e(RUN_PERKS[id].label)}</strong><small>${e(RUN_PERKS[id].description)}</small></button>`).join('')}</div>` : ''}<div class="live-branches">${choices.map(quote => `<button data-action="continue-expedition" data-id="${raid.id}" data-branch="${quote.branch}" ${!selected || quote.reason ? 'disabled' : ''}><strong>${e(quote.label)} <b>${Math.round(quote.chance*100)}%</b></strong><small>${seconds(quote.duration)} · ${n(quote.money)} ₽ · ${quote.ammo} патр.${quote.intel ? ` · ${quote.intel} разв.` : ''}</small><span>${e(quote.reason ?? (!selected ? 'Сначала выбери приём' : quote.description))}</span></button>`).join('')}</div><button class="button" data-action="extract" data-id="${raid.id}">Эвакуировать с добычей →</button>`;
}
function watchRaid(id: string) {
	const member=state.raids.find(item=>item.id===id); if(member) id=getRaidGroupKey(member);
	const raid = state.raids.find(item => item.id === id);
	if (!raid && lastWatchedRaid?.id !== id) { toast("Этот выход уже завершён. Отчёт сохранён в журнале."); return; }
	if (selectedRaidId !== id) lastWatchedReport = null;
	selectedRaidId = id; if (raid) lastWatchedRaid = raid;
	document.querySelector<HTMLElement>('.live-raid-scroll, .command-dock-scroll')?.scrollTo({ top: 0 });
	selectedScav = null;
	document.querySelector<HTMLElement>('#inspector-root')!.innerHTML = '';
	page = "home"; contextMode = "overview"; selectedShelterSite = null;
	cancelWorkerPlacement(false, true);
	world?.selectRaid(id);
	setView("raid");
	world?.setRaidFollow(true);
	render();
	document.querySelector<HTMLElement>(".command-main")?.scrollTo({ top: 0, behavior: "instant" });
	worldViewport.focus({preventScroll:true});
}
function openMultiplayerEntry(selection: RaidEntrySelection = {}): void {
	liveMode?.setEntrySelection(selection); setView("live");
}
function openMissionBoard(): void {
	toolOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	page = "raids"; render();
	document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus({ preventScroll: true });
}
function setView(view: "base" | "map" | "raid" | "live") {
	const wasLive = liveMode?.isActive() ?? false;
	if (view !== "base") cancelBuildingPlacement();
	if (view === "live") {
		if (!liveMode) return;
		cancelWorkerPlacement(false, true); world?.cancelCameraGesture(); closeInspector(); closeModal();
		page = "home"; contextMode = "overview"; selectedShelterSite = null;
		worldViewport.hidden = true;
		document.querySelector('.world-card')?.classList.add('live-view');
		document.querySelector('.command-main')?.classList.add('live-watching');
		document.querySelector('.world-card')?.classList.remove('raid-view');
		document.querySelector('.command-main')?.classList.remove('raid-watching');
		liveMode.show();
		document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button => { button.classList.toggle("active", button.dataset.view === "live"); button.setAttribute("aria-pressed", String(button.dataset.view === "live")); });
		render(); updateCameraControls(); updateSaveBanner();
		return;
	}
	if (liveMode?.isActive() && !liveMode.hide()) return;
	worldViewport.hidden = false;
	document.querySelector('.world-card')?.classList.remove('live-view');
	document.querySelector('.command-main')?.classList.remove('live-watching');
	updateSceneHover(null);
	if (view === "raid") {
		const target = state.raids.find(raid => raid.id === selectedRaidId) ?? (lastWatchedRaid?.id === selectedRaidId ? null : state.raids[0]);
		if (target) { selectedRaidId = target.id; lastWatchedRaid = target; world?.selectRaid(target.id); }
		else if (!lastWatchedRaid) { openMultiplayerEntry(); return; }
		contextMode = "overview";
	}
	if (worldView !== view) cancelWorkerPlacement(false, true);
	world?.cancelCameraGesture();
	worldView = view;
	world?.setView(view);
	document
		.querySelectorAll<HTMLButtonElement>("[data-view]")
		.forEach((button) =>
			((button.classList.toggle("active", button.dataset.view === view)), (button.setAttribute("aria-pressed", String(button.dataset.view === view))))
		);
	document.querySelector("#scene-hint")!.textContent = view === "base" ? "Выбери постройку, свободную землю или бойца" : "Нажми на сектор, чтобы выбрать маршрут";
	(document.querySelector(".room-shortcuts") as HTMLElement).hidden = view === "map";
	updateCameraControls();
	if (world) renderCommandBoard();
	updateSaveBanner(); setOverlayState();
	if (wasLive) render();
}
render();
world = createWorld(
	document.querySelector<HTMLElement>("#world")!,
	() => ({
		base: state.base,
		raids: state.raids,
		maps: MAPS,
		level: state.level,
		scavs: state.scavs,
		shelter: state.shelter,
		selectedRoomId,
		selectedSite: selectedShelterSite,
		identityKey: serverSnapshot?.identity.id ?? "connecting",
		roomProduction: Object.fromEntries(state.shelter.rooms.map((room) => [room.id, getRoomProductionState(state, room)])),
		selectedScavId: selectedScav,
		selectedMapId: selectedMap,
		selectedRaidId,
		history: state.history,
		weapons: state.weapons,
		gearItems: state.gearItems,
	}),
	(id) => {
		if (!canWorldInteract()) return;
		selectedMap = id; openMultiplayerEntry(multiplayerSelection(id));
	},
	{ canInteract: canWorldInteract,
		onHover: updateSceneHover,
		canCamera: canWorldCamera,
		onCameraChange: onWorldCameraChange,
		canDrag: canWorldDrag,
		canBuildingDrag,
		getBuildingPlacementReason: (id, x, y, rotation, facing) => getRoomFreePlacementReason(state, id, x, y, rotation, facing),
		getFreeBuildPlacementReason: (placement, x, y) => placement.roomId ? getRoomFreePlacementReason(state, placement.roomId, x, y, placement.rotation, placement.facing) : getFreeBuildRoomQuote(state, placement.type as ShelterRoomType, x, y, placement.rotation, placement.facing).reason,
		onPlaceBuilding: (id, x, y, rotation, facing) => { void placeDraggedBuilding(id, x, y, rotation, facing); },
		onBuildingDragState,
		onFreeBuildSite: ({ x, y }) => chooseFreeBuildingSite(x, y),
		getAssignmentReason: (scavId, roomId) => getWorkerAssignmentReason(state, scavId, roomId),
		onAssignScav: assignPlacedWorker,
		onDragState: onWorldDragState,
		onRoom: (room) => { if (canWorldInteract()) openRoom(room); },
		onScav: (id) => { if (canWorldInteract()) { selectedScav = id; fieldObjects?.show({ kind: "scav", id }); } },
		onShelterRoom: (id) => { if (canWorldInteract()) { selectedRoomId = id; fieldObjects?.show({ kind: "room", id }); } },
		onBuildSite: ({ column, row }) => { if (canWorldInteract()) openShelterSite(column, row); } }
);
territoryLife = createTerritoryLife({ getHost: () => page === "base" ? document.querySelector<HTMLElement>("[data-territory-plan]") : null,
	getPeople: () => world?.getShelterPeople() ?? [], reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
territoryLife.refresh();
const readyContracts = () =>
	CONTRACTS.filter(
		(contract) =>
			!state.claimedContracts.includes(contract.id) &&
			!getContractLockReason(state, contract) &&
			getContractProgress(state, contract) >= contract.target
	).length;
const rosterStatus = () => `${state.scavs.map((scav) => `${scav.id}:${scav.status}:${scav.autoRaid.enabled}:${scav.assignment}:${scav.story.pending?.eventId}:${scav.story.bond}:${scav.story.stress}`).join(";")}|${state.raids.map((raid) => `${raid.id}:${raid.expedition?.stage}:${raid.expedition?.status}`).join(";")}|${getSocialPresentationKey(state)}`;
const shelterStatus = () => `${state.shelter.sites.map((p) => `${p.column}:${p.row}`).join(";")}|${state.shelter.expansions.map((p) => `${p.column}:${p.row}:${Math.floor(p.workDone / p.workRequired * 100)}`).join(";")}|` + state.shelter.rooms.map((room) => `${room.id}:${room.column}:${room.row}:${room.position?.x ?? ""}:${room.position?.y ?? ""}:${room.rotation ?? 0}:${getRoomFacing(room)}:${room.status}:${room.level}:${room.queue.map((job) => job.id).join(",")}:${room.workerIds.join(",")}:${room.recipeId}:${room.repeat}:${room.pending}:${room.cycles}`).join(";");
const achievementPresentationKey = () => getAchievementViews(state).map(view => `${view.id}:${view.unlocked}:${view.active}:${view.steps.map(step => Number(step.done)).join('')}`).join('|');
const inventoryPresentationKey = () => JSON.stringify({ weapons:state.weapons, modules:state.modules, gear:state.gearItems, scavs:state.scavs.map(({health, ...scav})=>({...scav, healthy:isScavMedicallyReady({...scav,health})})), recruitment:state.recruitment,loot:state.lootItems,pendingLoot:state.pendingLoot,raidGear:state.raids.map(raid=>raid.expedition?.cargo.gearItems),kits:getFieldKitStock(state) });
function interacting() {
	return Boolean(workerPlacement || crewPointer || buildingDragPreview?.active) || (document.activeElement?.tagName === "SELECT" && !document.activeElement.hasAttribute("data-live-raid-select")) || document.activeElement?.tagName === "INPUT" || Boolean(document.querySelector("#modal-root .modal"));
}
function refreshAfterAdvance() {
	if (interacting()) deferredRender = true;
	else render();
}
let feedbackCursor = createGameFeedbackCursor(state, initialSession.view === "raid" ? initialSession.raidId : null);
const resourcePulseTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
function pulseResourceGains(gains: GameResourceGains) {
	for (const [key, gain] of Object.entries(gains)) {
		if (gain <= 0) continue;
		const resource = document.querySelector<HTMLElement>(`#res-${key}`)?.closest<HTMLElement>(".resource");
		if (!resource) continue;
		const previous = resourcePulseTimers.get(resource); if (previous) clearTimeout(previous);
		resource.dataset.gain = `+${n(gain)}`; resource.classList.add("resource-pop");
		resourcePulseTimers.set(resource, setTimeout(() => { resource.classList.remove("resource-pop"); delete resource.dataset.gain; resourcePulseTimers.delete(resource); }, 1300));
	}
}
function updateGameFeedback(quiet = false) {
	const feedback = observeGameFeedback(feedbackCursor, state, worldView === "raid" ? selectedRaidId : null);
	feedbackCursor = feedback.cursor;
	if (!quiet) {
		for (const event of feedback.events) gameSound.play(event.cue);
		if (feedback.events.some((event) => event.cue === "complete" || event.cue === "return")) pulseResourceGains(feedback.gains);
	}
}
let nextServerReconnect = 0;
const simulationTimer = setInterval(() => {
	if (!document.hidden && !accountChanging && !gameCommandPending) {
		if (serverReady) void refreshServerProgress();
		else if (Date.now() >= nextServerReconnect) {
			nextServerReconnect = Date.now() + 3000;
			void initializeAccount();
		}
	}
	if (deferredRender && !interacting()) render();
}, 1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelWorkerPlacement(false,true);world?.cancelCameraGesture();persist();}else if(!accountChanging&&serverReady)void refreshServerProgress();});
window.addEventListener('pagehide',flushAndReleaseSave);window.addEventListener('beforeunload',persist);window.addEventListener('pageshow',event=>{if(event.persisted)void refreshServerProgress();});
for (const type of ['click','change','input','toggle','pointerup']) document.addEventListener(type, scheduleSessionSave);
let contextIsMobile = window.innerWidth <= 850;
const responsiveContext = () => {
	cancelWorkerPlacement(false, true);
	world?.cancelCameraGesture();
	const mobile = window.innerWidth <= 850;
	if (mobile === contextIsMobile) return;
	contextIsMobile = mobile;
	renderCommandBoard(); setOverlayState();
};
window.addEventListener("resize", responsiveContext);
import.meta.hot?.dispose(() => {
	fieldObjects?.destroy();
	fieldInterface?.destroy();
	territoryLife?.destroy();
	liveMode?.destroy();
	dismissAchievementNotice();
	window.removeEventListener('hashchange', captureAccountEmailLink);
	authoritative?.destroy();accountUI.destroy();accountRoot.remove();
	cancelWorkerPlacement();
	gameSound.destroy();
	document.removeEventListener("pointerdown", resumeSoundOnGesture, true);
	document.removeEventListener("pointerup", resumeSoundOnGesture, true);
	document.removeEventListener("keydown", resumeSoundOnGesture, true);
	for (const timer of resourcePulseTimers.values()) clearTimeout(timer); resourcePulseTimers.clear();
	persist();
	clearInterval(simulationTimer);
	clearTimeout(toastTimer);
	if (workerRefreshTimer != null) clearTimeout(workerRefreshTimer);
	if (saveUiTimer !== null) clearTimeout(saveUiTimer);
	flushAndReleaseSave();
	world?.game.destroy(true);
	window.removeEventListener("resize", responsiveContext);
	document.removeEventListener("pointerdown", captureInterfacePointer, true);
	document.removeEventListener("pointerdown", startCrewPointer);
	document.removeEventListener("pointermove", moveCrewPointer);
	document.removeEventListener("pointerup", finishCrewPointer);
	document.removeEventListener("pointercancel", cancelCrewPointer);
	document.removeEventListener("lostpointercapture", cancelCrewPointer);
	document.removeEventListener("click", suppressWorkerClick, true);
	document.removeEventListener("focusin", workerTargetFocus);
	window.removeEventListener("blur", cancelPlacementForBlur);
	document.removeEventListener("keydown", handleCameraKey);
	worldViewport.removeEventListener("pointerdown", focusWorldViewport);
});
setView(worldView);
world?.selectRaid(selectedRaidId);
world?.restorePresentationState(initialSession.presentation);
updateSaveBanner();
const accountRoot = document.createElement('div');
accountRoot.id = 'account-root'; document.body.append(accountRoot);
const accountUI = mountAccountUI({
	root: accountRoot,
	onAuthenticated: connectAccount,
	onAuthRevoked: revokeAccountSession,
	onUserChanged: updateAccountProfile,
	onEmailVerified: async () => {
		const { user, emailEnabled, googleEnabled } = await accountApi.session();
		accountUI.setEmailEnabled(emailEnabled);
		accountUI.setGoogleEnabled(googleEnabled);
		if (user && signedInUser?.id === user.id) { updateAccountProfile(user); accountUI.setUser(user); }
		else if (!user && signedInUser) revokeAccountSession();
	},
	onDialogChange: open => { accountDialogOpen = open; setOverlayState(); },
  onBeforeLogout:async()=>!gameCommandPending&&!accountChanging&&!liveMode?.isActionPending(),
  onBeforeGoogle:()=>{if(gameCommandPending||accountChanging||liveMode?.isActionPending())return false;persist();return true;},
  onLogout:async()=>{accountGeneration++;signedInUser=null;playerAccount=null;liveMode?.resetIdentity();await loadServerProgress();accountUI.setStatus('Аккаунт отключён. Подключён гостевой серверный прогресс.');},
  onReconnect:async()=>{await loadServerProgress();},onSync:async()=>{await refreshServerProgress();},
});
liveMode = createLiveMode({
	world: document.querySelector<HTMLElement>('#live-world')!,
	hudRoot: app,
	dock: document.querySelector<HTMLElement>('#command-dock')!,
	getAccountId: () => signedInUser?.id ?? null,
	getGameId: () => authoritative?.getSnapshot()?.identity.id ?? null,
	isGameReady: () => Boolean(authoritative?.isReady()),
	getStock: () => serverReady ? {ammo:state.supplies.ammo,medicine:state.supplies.medicine,money:state.money} : null,
	onEconomyChange: () => {
		fleaReadGeneration++; fleaView.market=null; fleaView.loading=false;
		authoritative?.invalidateMarket();
		void refreshServerProgress().then(ready=>{if(ready&&page==='flea')void refreshFleaMarket();});
	},
	onMarket: () => {
		fleaReadGeneration++; fleaView.market=null; fleaView.loading=false; authoritative?.invalidateMarket();
		page='flea'; fleaView.tab='inventory'; render();
		void refreshServerProgress().then(ready=>{if(ready&&page==='flea')void refreshFleaMarket();});
	},
	onExit: () => setView("base"),
	onMissionBoard: openMissionBoard,
	onAccount: () => document.querySelector<HTMLButtonElement>('.account-launcher')?.click(),
	onError: message => toast(message, false),
});
document.querySelector('.command-hud')!.append(accountRoot.querySelector('.account-launcher')!);
authoritative=createAuthoritativeClient({getAccountId:()=>signedInUser?.id??null,onSnapshot:applyServerSnapshot,onStatus:status=>{
  connectionMessage=status.message;
  if(status.phase==='offline'||status.phase==='changed'){fleaView.market=null;fleaView.error=status.message;if(page==='flea')render();}
  if(status.phase==='changed') {serverReady=false; if(!accountChanging) queueMicrotask(()=>void initializeAccount());}
  updateSaveBanner();setOverlayState();
}});
window.addEventListener('hashchange', captureAccountEmailLink);
window.addEventListener('online',()=>{if(!accountChanging){if(serverReady)void refreshServerProgress();else void initializeAccount();}});
startServerSession();
