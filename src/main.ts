import "./style.css";
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
	SAVE_KEY,
	MAX_ROOM_LEVEL,
	advance,
	claimContract,
	createGame,
	dispatchRaid,
	continueExpedition,
	extractRaid,
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
	craftGear,
	equipGear,
	repairGear,
	recycleGear,
	setLoadoutOption,
	setAutoRaidDepth,
	getSupplyCapacity,
	getRecoveryAllowance,
	getRaidQuote,
	buySupplies,
	recycleWeapon,
	getWeaponRecycleYield,
	getWeaponRole,
	equipWeapon,
	getContractProgress,
	getContractLockReason,
	getAutoRaidStatus,
	getGearCost,
	getIncomePerMinute,
	getRaidPhase,
	getRepairCost,
	getScavCapacity,
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
	getWeaponStats,
	getWeaponBuildIssues,
	getModuleInstallReason,
	installModule,
	removeModule,
	assembleWeapon,
	disassembleWeapon,
	getModuleCapacity,
	getModuleSaleValue,
	getModuleRecycleYield,
	getModuleRepairCost,
	getWeaponDisassembleReason,
	getModuleRemoveReason,
	repairModule,
	sellModule,
	recycleModule,
	ROOM_DEFINITIONS,
	RESOURCE_RECIPES,
	getBuildRoomQuote,
	buildRoom,
	getRoomUpgradeQuote,
	upgradeRoom,
	assignWorker,
	getWorkerAssignmentReason,
	getWorkerAffinity,
	getRoomWorkerCapacity,
	getRoomProductionState,
	getResourceProductionQuote,
	getModuleProductionQuote,
	queueModuleProduction,
	setRoomRecipe,
	cancelProduction,
	healScav,
	loadGameWithSummary,
	recruitCost,
	recruitScav,
	repairWeapon,
	saveGame,
	sellWeapon,
	setAutoRaid,
	setRaidTactic,
	stopAllAutoRaids,
	upgradeBase,
	upgradeScavGear,
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
import { GEAR_LABELS, MAX_GEAR_LEVEL, TACTICS, type GearSlot, type RaidTactic } from "./game/operations";
import { createWorld } from "./scene";
import { gunArt, scavPortrait } from "./art";
import { weaponBuildArt, moduleArt } from "./armory-art";
import { sectorArt, roomMiniArt } from "./command-art";

type Page = "home" | "raids" | "arsenal" | "base" | "contracts" | "journal";
const e = (value: unknown) =>
	String(value).replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			]!
	);
const n = (value: number) => Math.floor(value).toLocaleString("ru-RU");
const seconds = (value: number) =>
	`${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value) % 60)).padStart(2, "0")}`;
const paths: Record<string, string> = {
	home: "M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10",
	raids: "m3 3 7 3 4-3 7 3v15l-7-3-4 3-7-3ZM10 6v15M14 3v15",
	arsenal: "m3 7 8 2 9-1v5H9l-3 7H3l3-8-3-1ZM12 13l3 5h3l-3-5",
	base: "M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l3 3M15.5 15.5l3 3M5.5 18.5l3-3M15.5 8.5l3-3M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
	contracts: "M8 3h8v4H8ZM8 5H5v16h14V5h-3M8 12h8M8 16h5",
	journal: "M4 4h16v16H4ZM8 8h8M8 12h8M8 16h5",
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
	backpack: "M8 7V5a4 4 0 0 1 8 0v2M7 7h10l3 4v10H4V11ZM8 14h8v7H8M4 11h16",
	repeat: "M20 8H5l4-4M4 16h15l-4 4M20 8v4M4 16v-4",
	stop: "M5 5h14v14H5Z",
};
const icon = (name: string, size = 19) =>
	`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.base}"/></svg>`;


let raw: string | null = null;
try {
	raw = localStorage.getItem(SAVE_KEY);
} catch {
	/* A playable session still works without storage. */
}
const loaded = loadGameWithSummary(raw);
let state: GameState = loaded?.state ?? createGame();
let offlineSummary: AdvanceSummary | null = loaded && (loaded.summary.elapsedMs >= 60_000 || loaded.summary.completedCount) ? loaded.summary : null;
let page: Page = "home";
let selectedMap = MAPS[0]!.id;
let selectedWeapon = state.weapons[0]?.id ?? "";
let selectedScav: string | null = null;
let showTacticalMap = false;
let selectedRoomId: string | null = state.shelter.rooms[0]?.id ?? null;
let selectedShelterSite: { column: number; row: number } | null = null;
let roomModuleSlot: ModuleSlot | "all" = "optic";
let roomModuleSearch = "";
let contextMode: "overview" | "room" | "build" = "overview";
let roomContextTab: "staff" | "production" | "upgrade" = "staff";
let commandOrigin: HTMLElement | null = null;
let toolOrigin: HTMLElement | null = null;
let productionWorkshopId: string | null = null;
const chosenWorkers = new Map<string, string>();
const roomRepeatPreferences = new Map<string, boolean>();
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
let benchPartSearch = "";
let moduleCraftForWeapon = true;
const selectedPerks = new Map<string, RunPerk>();
let contractFilter: "open" | "done" | "all" = "open";
let deferredRender = false;
let world: ReturnType<typeof createWorld> | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
let storageWarning = false;
let worldInputBlockedUntil = 0;
let worldOverlaySignature = "";
let worldView: "base" | "map" = "base";
type WorkerPlacement = { scavId: string; mode: "pointer" | "keyboard"; roomId: string | null; reason: string | null };
type CrewPointer = { scavId: string; pointerId: number; startX: number; startY: number; clientX: number; clientY: number; source: HTMLElement; started: boolean };
let workerPlacement: WorkerPlacement | null = null;
let crewPointer: CrewPointer | null = null;
let suppressWorkerClickUntil = 0;
let workerRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function holdWorldInput() { worldInputBlockedUntil = Date.now() + 350; }
function canWorldDrag() {
	return worldView === "base" && page === "home" && !selectedScav && !document.querySelector("#modal-root .modal") && !(window.innerWidth <= 850 && contextMode !== "overview");
}
function canWorldInteract() {
	return !workerPlacement && !crewPointer?.started && Date.now() >= worldInputBlockedUntil && page === "home" && !selectedScav && !document.querySelector("#modal-root .modal") && !(window.innerWidth <= 850 && contextMode !== "overview");
}
function captureInterfacePointer(event: PointerEvent) {
	const target = event.target instanceof Element ? event.target : null;
	if (target && (target.closest("#tool-root, #inspector-root, #modal-root, #command-dock, #context-shade, button, select, input, summary") || target.closest("#world") == null)) holdWorldInput();
}
document.addEventListener("pointerdown", captureInterfacePointer, true);
const app = document.querySelector<HTMLDivElement>("#app")!;
const names: Record<Page, string> = {
	home: "Штаб",
	raids: "Рейды",
	arsenal: "Арсенал",
	base: "Комнаты",
	contracts: "Контракты",
	journal: "Журнал",
};
app.innerHTML = `<div class="shell command-shell"><header class="topbar command-hud"><div class="command-brand"><span class="brand-mark">П</span><div><strong>ПРАПОР</strong><small>УБЕЖИЩЕ 07</small></div></div><div class="level"><span class="eyebrow">Репутация</span><strong id="level-label"></strong><div class="xp-track"><i id="xp-fill"></i></div></div><div class="resources">${[["money", "Рубли"], ["ammo", "Патроны"], ["medicine", "Медикаменты"], ["scrap", "Материалы"], ["intel", "Разведданные"]].map(([key, label]) => `<div class="resource" title="${label}">${icon(key!,18)}<div><label>${label}</label><strong id="res-${key}"></strong></div><i class="resource-cap" id="cap-${key}"></i></div>`).join("")}</div><button class="settings" data-action="settings" aria-label="Сохранение и помощь">${icon("settings",18)}</button></header><main class="main command-main"><div class="command-toolbar"><div class="command-heading"><h1>Свои люди. Своё убежище.</h1><span><i class="status-dot"></i><span id="passive-note">База на связи</span></span></div><nav class="nav command-tools" aria-label="Инструменты штаба">${(Object.keys(names) as Page[]).map((id) => `<button data-page="${id}" aria-label="${names[id]}" title="${names[id]}">${icon(id,17)}<span>${names[id]}</span>${id === "raids" ? '<b class="badge" id="raid-badge">0</b>' : ""}</button>`).join("")}</nav></div><div class="command-stage-layout"><section id="hero" class="hero-grid"><section class="world-card"><div class="world-head"><div class="view-switch" aria-label="Вид сцены"><button class="active" data-view="base" aria-pressed="true">${icon("home",14)} Убежище</button><button data-view="map" aria-pressed="false">${icon("raids",14)} Сектора</button></div><button class="text-button room-index-button" data-page="base">${icon("base",14)} Комнаты</button><span class="world-coordinate mono">БАЗА 07 · СЕВЕР</span></div><div id="world" aria-label="Графический штаб: комнаты, рабочие и стройка"></div><div class="world-bottom"><span><i class="status-dot"></i><span id="scene-hint">Нажми на комнату или бойца</span></span><span id="world-raid-note">ОТРЯД НА БАЗЕ</span></div><div class="room-shortcuts" hidden></div></section></section><aside id="command-dock" class="command-dock" aria-label="Сводка и управление выбранным объектом"></aside></div><section id="command-crew" class="command-crew" aria-label="Отряд и рабочие"></section><section id="command-routes" class="command-routes" aria-label="Рейды и сектора"></section><div id="offline-summary"></div><footer class="footer-line command-footer"><span id="save-status">ПРОГРЕСС НА ЭТОМ УСТРОЙСТВЕ</span><span>ПРАПОР · 0.8</span></footer></main></div><div id="tool-root" class="tool-backdrop" hidden><section class="tool-window" role="dialog" aria-modal="true" aria-labelledby="tool-title"><header class="tool-head"><div id="page-head" class="page-head"></div><button class="icon-button" data-action="close-tools" aria-label="Закрыть инструмент и вернуться в штаб">×</button></header><div class="tool-scroll"><div id="expedition-alerts"></div><div id="panel"></div></div></section></div><div id="context-shade" class="context-shade" hidden></div><div id="toast" role="status" aria-live="polite" hidden></div><div id="inspector-root"></div><div id="modal-root"></div>`;
const panel = document.querySelector<HTMLDivElement>("#panel")!;
document.querySelector(".world-card")!.insertAdjacentHTML("beforeend", '<div id="worker-room-targets" class="worker-room-targets" role="group" aria-label="Выбери рабочую комнату" hidden></div><div id="worker-placement" class="worker-placement" hidden><div><strong id="worker-placement-title"></strong><span id="worker-placement-hint"></span></div><button class="icon-button" data-worker-cancel aria-label="Отменить назначение">×</button></div>');
app.insertAdjacentHTML("beforeend", '<div id="worker-drag-ghost" class="worker-drag-ghost" aria-hidden="true" hidden></div><div id="worker-drop-status" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></div>');
const costLabel = (cost: { money: number; scrap: number }) =>
	`${n(cost.money)} ₽ · ${cost.scrap} дет.`;
let protectedSave = Boolean(raw && !loaded);
function persist(): boolean {
	if (protectedSave) {
		document.querySelector("#save-status")!.textContent = "ИСХОДНЫЙ ПРОГРЕСС НЕ ПЕРЕЗАПИСАН · НУЖЕН КОРРЕКТНЫЙ ИМПОРТ";
		return false;
	}
	try {
		localStorage.setItem(SAVE_KEY, saveGame(state));
		document.querySelector("#save-status")!.textContent =
			"СОХРАНЕНО НА ЭТОМ УСТРОЙСТВЕ";
		return true;
	} catch {
		document.querySelector("#save-status")!.textContent =
			"ХРАНИЛИЩЕ НЕДОСТУПНО · ЭКСПОРТИРУЙ СОХРАНЕНИЕ";
		if (!storageWarning) {
			storageWarning = true;
			toast(
				"Браузер не разрешает сохранять прогресс. Используй экспорт в настройках.",
				false
			);
		}
		return false;
	}
}
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
function workerPickReason(id: string) {
	const reason = getWorkerAssignmentReason(state, id, null);
	if (reason) return reason;
	return state.scavs.find((scav) => scav.id === id)!.health < 25 ? "Бойцу нужно восстановиться до 25% здоровья." : null;
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
}
function clearWorkerPlacement() {
	workerPlacement = null;
	for (const id of ["worker-placement", "worker-room-targets", "worker-drag-ghost"]) { const node = document.getElementById(id); if (node) node.hidden = true; }
	document.body.classList.remove("placing-worker");
	document.querySelectorAll(".crew-chip.is-dragging").forEach((node) => node.classList.remove("is-dragging"));
	queueDeferredWorkerRefresh();
}
function focusWorkerHandle(id: string) {
	document.querySelector<HTMLButtonElement>(`#command-crew [data-worker-handle="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}
function cancelWorkerPlacement(restoreFocus = false, announce = false) {
	const id = workerPlacement?.scavId ?? crewPointer?.scavId;
	const active = Boolean(workerPlacement || crewPointer?.started);
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
	const ghost = document.querySelector<HTMLElement>("#worker-drag-ghost")!;
	ghost.hidden = !crewPointer?.started;
	if (crewPointer?.started) {
		if (ghost.dataset.scav !== scav.id) { ghost.dataset.scav = scav.id; ghost.innerHTML = `<span class="crew-portrait">${scavPortrait(scav.personality, scav.name)}</span><span><strong>${e(scav.name)}</strong><small></small></span>`; }
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
	const canvas = document.querySelector<HTMLCanvasElement>("#world canvas"), card = document.querySelector<HTMLElement>(".world-card");
	if (!canvas || !card) return;
	const canvasRect = canvas.getBoundingClientRect(), cardRect = card.getBoundingClientRect();
	layer.style.left = `${canvasRect.left - cardRect.left}px`; layer.style.top = `${canvasRect.top - cardRect.top}px`;
	layer.style.width = `${canvasRect.width}px`; layer.style.height = `${canvasRect.height}px`;
	layer.innerHTML = state.shelter.rooms.map((room) => {
		const reason = getWorkerAssignmentReason(state, scav.id, room.id), definition = ROOM_DEFINITIONS[room.type];
		const x = [40, 220, 448, 628][room.column] ?? 40;
		return `<button class="worker-room-target ${reason ? "unavailable" : "available"}" data-worker-room="${room.id}" aria-disabled="${Boolean(reason)}" aria-describedby="worker-placement-hint" aria-label="${e(definition.label)}, этаж ${room.row + 1}, ${room.workerIds.length} из ${getRoomWorkerCapacity(room)} работников. ${e(reason ?? (scav.assignment === room.id ? "Уже работает здесь" : `Назначить ${scav.name}, подходит ${Math.round(getWorkerAffinity(scav, room.type))} из 100`))}" title="${e(reason ?? "Назначить бойца")}" style="left:${x / 840 * 100}%;top:${(148 + room.row * 111) / 520 * 100}%;width:${172 / 840 * 100}%;height:${100 / 520 * 100}%;--room-color:${definition.color}"><span>${icon(roomIcon(room.type),15)} ${e(definition.label)}</span><small>${reason ? "Недоступно" : scav.assignment === room.id ? "Уже работает" : `Назначить · ${room.workerIds.length}/${getRoomWorkerCapacity(room)}`}</small></button>`;
	}).join("");
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
		node.setAttribute("aria-label", `${ROOM_DEFINITIONS[room.type].label}, этаж ${room.row + 1}, ${room.workerIds.length} из ${getRoomWorkerCapacity(room)} работников. ${reason ?? (scav.assignment === room.id ? "Уже работает здесь" : `Назначить ${scav.name}, подходит ${Math.round(getWorkerAffinity(scav, room.type))} из 100`)}`);
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
	workerPlacement = { scavId: id, mode: "keyboard", roomId: null, reason: null };
	paintWorkerPlacement(); renderWorkerRoomTargets();
	(document.querySelector<HTMLButtonElement>('#worker-room-targets [aria-disabled="false"]') ?? document.querySelector<HTMLButtonElement>("#worker-room-targets button") ?? document.querySelector<HTMLButtonElement>("[data-worker-cancel]"))?.focus({ preventScroll: true });
}
function assignPlacedWorker(scavId: string, roomId: string) {
	if (!canWorldDrag()) { cancelWorkerPlacement(false, true); return; }
	const scav = state.scavs.find((item) => item.id === scavId), room = state.shelter.rooms.find((item) => item.id === roomId);
	const alreadyAssigned = scav?.assignment === roomId;
	const returnFocus = workerPlacement?.mode === "keyboard";
	cancelWorkerPlacement();
	const result = assignWorker(state, scavId, roomId);
	act(result.ok && scav && room ? { ...result, message: alreadyAssigned ? `${scav.name} уже работает: ${ROOM_DEFINITIONS[room.type].label}.` : `${scav.name} назначен: ${ROOM_DEFINITIONS[room.type].label}.` } : result);
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
	crewPointer = { scavId: id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY, source, started: false };
	source.setPointerCapture(event.pointerId);
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
	if (roomId) { workerPlacement.roomId = roomId; workerPlacement.reason = getWorkerAssignmentReason(state, workerPlacement.scavId, roomId); paintWorkerPlacement(); }
	else if (!target?.closest("[data-worker-handle], [data-worker-cancel]")) cancelWorkerPlacement(false, true);
}
function cancelPlacementForBlur() { cancelWorkerPlacement(false, true); }
document.addEventListener("pointerdown", startCrewPointer);
document.addEventListener("pointermove", moveCrewPointer, { passive: false });
document.addEventListener("pointerup", finishCrewPointer);
document.addEventListener("pointercancel", cancelCrewPointer);
document.addEventListener("lostpointercapture", cancelCrewPointer);
document.addEventListener("click", suppressWorkerClick, true);
document.addEventListener("focusin", workerTargetFocus);
window.addEventListener("blur", cancelPlacementForBlur);
function act(result: ActionResult) {
	const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const actionSelector = origin?.dataset.action
		? ["action", "id", "mod", "slot"].filter((key) => origin.dataset[key] != null)
			.map((key) => `[data-${key}="${CSS.escape(origin.dataset[key]!)}"]`).join("")
		: null;
	toast(result.message, result.ok);
	persist();
	render();
	if (!selectedScav && actionSelector) {
		const replacement = document.querySelector<HTMLButtonElement>(actionSelector);
		if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
		else {
			const context = replacement?.closest<HTMLElement>(".card, .weapon-detail, .contract");
			if (context) { context.tabIndex = -1; context.focus({ preventScroll: true }); }
			else if (page === "arsenal" && arsenalTab === "bench") document.querySelector<HTMLButtonElement>(`[data-bench-slot="${selectedModuleSlot}"]`)?.focus({ preventScroll: true });
			else if (page === "arsenal") document.querySelector<HTMLButtonElement>(`[data-arsenal-tab="${arsenalTab}"]`)?.focus({ preventScroll: true });
			else if (contextMode !== "overview") document.querySelector<HTMLButtonElement>('[data-action="close-context"]')?.focus({ preventScroll: true });
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
function medicineCost(scav: Scav) {
	return Math.ceil((100 - scav.health) / (25 + state.base.medbay * 5));
}
function dispatchBlock(scav: Scav) {
	return getRaidQuote(state, scav, MAP_BY_ID[selectedMap]!).reason;
}
function supplyName(key: string) {
	return ({ ammo: "Патроны", medicine: "Медикаменты", scrap: "Детали", intel: "Разведданные" } as Record<string, string>)[key] ?? key;
}
function expeditionQueue() {
	const waiting = state.raids.filter((raid) => raid.expedition?.status === "choice");
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
	return `<article class="decision-card" data-expedition="${raid.id}"><div class="decision-head"><div class="scav-avatar">${scavPortrait(scav.personality, scav.name)}</div><div><span class="eyebrow">${e(MAP_BY_ID[raid.mapId]!.name)} · точка ${run.stage} / 3</span><h3>${e(scav.name)} ждёт приказа</h3><p>${run.stage >= 3 ? "Маршрут пройден. Забери добычу на базу." : "Добыча ещё в рюкзаке. Можно уйти или рискнуть дальше."}</p></div>${!compact ? `<button class="button ghost small" data-scav="${scav.id}">Личное дело</button>` : ""}</div><div class="decision-content"><div class="expedition-stage" aria-label="Пройдено этапов: ${run.stage} из 3">${[1, 2, 3].map((stage) => `<span class="${stage < run.stage ? "done" : stage === run.stage ? "current" : ""}">${stage < run.stage ? "✓ " : ""}${stage}. ${stage === 1 ? "Вход" : stage === 2 ? "Глубина" : "Цель"}</span>`).join("")}</div><div class="cargo-summary"><div><span>В рюкзаке</span><strong>${n(run.cargo.money)} ₽</strong><small>Наличными · припасы ниже</small></div><div><span>Защищено от потери</span><strong>Открытия</strong><small>Остаются даже при провале</small></div><div><span>Здоровье бойца</span><strong>${Math.floor(scav.health)} / 100</strong><small>Броня на входе: ${Math.round(run.loadout.armorCondition)}%</small></div></div>${cargoMetrics}<p class="field-hint">Ценность — оценка наличных и находок, а не выплата рублями. Деньги не занимают место. При перегрузе боец оставляет лишние припасы; склад на базе тоже ограничен.</p><div class="cargo-items">${supplies}${weapons || (!supplies ? "<span>Рюкзак пока пуст</span>" : "")}</div>${moduleCargo(run.cargo.modules)}${warehouseWarning}${run.discoveries.length ? `<p class="field-hint">Записаны находки: ${run.discoveries.map((id) => e(BLUEPRINTS[id]?.label ?? "Разведанный маршрут")).join(" · ")}. Останутся у базы.</p>` : ""}${run.perks.length ? `<p class="field-hint">Опыт этой экспедиции: ${run.perks.map((perk) => e(RUN_PERKS[perk].label)).join(" · ")}</p>` : ""}${choices.length ? `<p class="risk-note">Следующий этап опаснее. При провале добыча в рюкзаке может быть потеряна; постоянные открытия сохранятся.</p>${run.offers.length ? `<div class="run-perk-pick"><h3>Находка маршрута</h3><p>Выбери один бонус. Он работает до конца этой экспедиции.</p><div class="decision-branches">${run.offers.map((perk) => `<button class="branch-choice ${perk === selectedPerk ? "active" : ""}" data-action="run-perk" data-id="${raid.id}" data-perk="${perk}" data-focus-key="perk-${perk}" aria-pressed="${perk === selectedPerk}"><strong>${e(RUN_PERKS[perk].label)}</strong><p>${e(RUN_PERKS[perk].description)}</p><small>${perk === selectedPerk ? "✓ Выбрано" : "Выбрать бонус"}</small></button>`).join("")}</div></div>` : ""}<h3>Куда дальше?</h3><div class="decision-branches">${choices.map((choice) => `<button class="branch-choice" data-action="continue-expedition" data-id="${raid.id}" data-branch="${choice.branch}" data-focus-key="branch-${choice.branch}" ${choice.reason || (run.offers.length && !hasPerk) ? "disabled" : ""}><strong>${e(choice.label)}</strong><p>${e(choice.description)}</p><small>${Math.round(choice.chance * 100)}% успеха · ${seconds(choice.duration)} · ${n(choice.money)} ₽ + ${choice.ammo} патр.${choice.intel ? ` + ${choice.intel} разв.` : ""}</small><span class="quote-note">${e(choice.reason ?? (run.offers.length && !hasPerk ? "Сначала выбери бонус маршрута" : `Этап ${run.stage + 1} · добыча под риском`))}</span></button>`).join("")}</div>` : ""}<div class="extract-row"><p>Эвакуация вернёт бойца и доставит добычу в пределах склада. ${run.stage < 3 ? "База готовит следующий выход." : "Экспедиция завершится."}</p><button class="button" data-action="extract" data-id="${raid.id}" data-focus-key="extract">${icon("check", 17)} Эвакуировать с добычей</button></div></div></article>`;
}
function hud() {
	if (workerPlacement && (!canWorldDrag() || workerPickReason(workerPlacement.scavId))) cancelWorkerPlacement(false, true);
	refreshWorkerRoomTargets();
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
	const waitingCount = state.raids.filter((raid) => raid.expedition?.status === "choice").length;
	document.querySelector("#raid-badge")!.textContent = waitingCount ? "!" : String(state.raids.length);
	document.querySelector<HTMLButtonElement>('.nav [data-page="raids"]')?.setAttribute("aria-label", waitingCount ? `Рейды: ${waitingCount} ждут приказа` : "Рейды");
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
	document.querySelector("#world-raid-note")!.textContent = state.raids.length
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
	document.querySelectorAll<HTMLButtonElement>('[data-action="heal"]').forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.id);
		if (scav) {
			const cost = medicineCost(scav);
			node.disabled = scav.status === "raiding" || scav.health >= 100 || state.supplies.medicine < cost;
			node.innerHTML = `${icon("medicine", 15)} ${scav.health >= 100 ? "Здоров" : `Лечить · ${cost} мед.`}`;
			const note = document.querySelector(`[data-heal-note="${scav.id}"]`);
			if (note) note.textContent = scav.status === "raiding" ? "Лечение доступно после возвращения" : state.supplies.medicine < cost ? `Нужно ${cost} мед. · медблок лечит бесплатно` : "Медблок восстанавливает бесплатно";
		}
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="recruit"]').forEach((node) => { node.disabled = state.scavs.length >= getScavCapacity(state) || state.money < recruitCost(state); });
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
		const owner = state.scavs.find((scav) => scav.loadout.armorItemId === item.id || scav.loadout.backpackItemId === item.id);
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
		const busy = gear ? state.scavs.some((scav) => scav.status === "raiding" && (scav.loadout.armorItemId === gear.id || scav.loadout.backpackItemId === gear.id)) : state.raids.some((raid) => raid.weaponInstanceId === weapon!.id);
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
		document.querySelectorAll<HTMLElement>(`[data-room-status="${room.id}"]`).forEach((node) => { node.textContent = production.status; });
		document.querySelectorAll<HTMLElement>(`[data-room-progress="${room.id}"]`).forEach((node) => { node.style.width = `${Math.round(production.progress * 100)}%`; });
		document.querySelectorAll<HTMLElement>(`[data-room-eta="${room.id}"]`).forEach((node) => { node.textContent = production.remainingSeconds == null ? "" : `${seconds(production.remainingSeconds)} до готовности`; });
		document.querySelectorAll<HTMLElement>(`[data-room-reason="${room.id}"]`).forEach((node) => { node.textContent = production.reason ?? (room.status !== "ready" ? "Во время стройки и улучшения работа приостановлена" : ""); });
		for (const job of room.queue) {
			const progress = document.querySelector<HTMLElement>(`[data-job-progress="${job.id}"]`); if (progress) progress.style.width = `${Math.min(100, job.workDone / job.workRequired * 100)}%`;
			const time = document.querySelector<HTMLElement>(`[data-job-time="${job.id}"]`); if (time) time.textContent = production.remainingSeconds == null ? "ПАУЗА" : seconds(production.remainingSeconds);
			const reason = document.querySelector<HTMLElement>(`[data-job-status="${job.id}"]`); if (reason) reason.textContent = production.reason ?? production.status;
			const refund = document.querySelector<HTMLElement>(`[data-job-refund="${job.id}"]`); if (refund) refund.textContent = job.workDone === 0 ? "Не начат · полный возврат при отмене" : "Работа начата · отмена без возврата";
		}
	}
	document.querySelectorAll<HTMLButtonElement>('[data-action="upgrade-room"]').forEach((node) => {
		const quote = getRoomUpgradeQuote(state, node.dataset.id ?? ""); node.disabled = Boolean(quote.reason);
		const note = document.querySelector<HTMLElement>(`[data-room-upgrade-note="${node.dataset.id}"]`); if (note) note.textContent = quote.reason ?? "Затраты будут списаны при начале улучшения";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="build-room"]').forEach((node) => {
		const quote = getBuildRoomQuote(state, node.dataset.roomType as ShelterRoomType, Number(node.dataset.column), Number(node.dataset.row)); node.disabled = Boolean(quote.reason);
		const note = document.querySelector<HTMLElement>(`[data-build-room-note="${node.dataset.roomType}"]`); if (note) note.textContent = quote.reason ?? "Оплата при начале; стройка идёт и офлайн";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="queue-room-module"]').forEach((node) => {
		const quote = getModuleProductionQuote(state, node.dataset.id ?? "", node.dataset.modelId ?? ""); node.disabled = Boolean(quote.reason);
		const note = document.querySelector<HTMLElement>(`[data-room-module-note="${node.dataset.modelId}"]`); if (note) note.textContent = quote.reason ?? "Оплаченный заказ начнётся по очереди";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="set-room-recipe"]').forEach((node) => {
		const quote = getResourceProductionQuote(state, node.dataset.id ?? "", node.dataset.recipeId ?? "");
		const note = document.querySelector<HTMLElement>(`[data-resource-recipe-note="${node.dataset.recipeId}"]`); if (note) note.textContent = quote.reason ?? "Бойцы запустят партию; результат поступит на склад";
	});
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
	const options = (["armor", "backpack"] as GearSlot[]).map((slot) => {
		const itemId = slot === "armor" ? scav.loadout.armorItemId : scav.loadout.backpackItemId;
		const item = state.gearItems.find((gear) => gear.id === itemId);
		const model = item ? getGearModel(item) : null;
		return `<label class="field-label">${slot === "armor" ? "Броня" : "Рюкзак"}<select data-equip-gear="${scav.id}" data-slot="${slot}" data-focus-key="equip-${slot}" aria-label="${slot === "armor" ? "Броня" : "Рюкзак"} для ${e(scav.name)}" ${busy ? "disabled" : ""}><option value="">Без отдельного предмета</option>${state.gearItems.filter((gear) => getGearModel(gear).slot === slot && !state.scavs.some((person) => person.id !== scav.id && (person.loadout.armorItemId === gear.id || person.loadout.backpackItemId === gear.id))).map((gear) => `<option value="${gear.id}" ${gear.id === itemId ? "selected" : ""}>${e(getGearModel(gear).label)} · ${Math.round(gear.durability)}%</option>`).join("")}</select></label>${model && item ? `<div class="loadout-item-note"><p>${e(model.description)}</p><small>Состояние ${Math.round(item.durability)}% · вес ${model.weight} кг${model.protection ? ` · защита до ${Math.round(model.protection * 100)}%` : ""}${model.capacity ? ` · вместимость ${model.capacity} ед.` : ""}</small>${item.durability < 100 ? `<button class="button ghost small" data-action="repair-gear" data-id="${item.id}" data-focus-key="repair-${slot}" ${busy || !canAfford(getGearRepairCost(item)) ? "disabled" : ""}>Ремонт · ${costLabel(getGearRepairCost(item))}</button>` : ""}</div>` : '<p class="field-hint">Базовое оснащение сохранится. Отдельный предмет добавит свойства и износ.</p>'}`;
	}).join("");
	return `<section class="inspector-section loadout-section"><div class="inspector-section-title"><h3>${busy ? "Комплект в рейде" : "Комплект для выхода"}</h3><button class="text-button" data-action="open-equipment" data-focus-key="equipment-store">Склад и сборка →</button></div><div class="loadout-stats"><span>Вес ${stats.weight.toFixed(1)} кг</span><span>Защита ${Math.round(stats.protection * 100)}%</span><span>Груз до ${stats.capacity.toFixed(1)} ед.</span><span>Время ×${stats.speedMultiplier.toFixed(2)}</span></div>${role ? `<p class="field-hint">${e(getWeaponRole(role).label)}: ${e(getWeaponRole(role).description)}</p>` : ""}${options}<label class="field-label">Боеприпас<select data-ammo-type="${scav.id}" data-focus-key="ammo-type" aria-label="Боеприпас для ${e(scav.name)}" ${busy ? "disabled" : ""}><option value="standard" ${scav.loadout.ammoType === "standard" ? "selected" : ""}>Обычный · меньше расход</option><option value="piercing" ${scav.loadout.ammoType === "piercing" ? "selected" : ""}>Бронебойный · больше расход</option></select></label><p class="field-hint">Бронебойный боеприпас повышает шанс в бою, но требует больше патронов.</p><label class="loadout-check"><input type="checkbox" data-medkit="${scav.id}" data-focus-key="medkit" ${scav.loadout.medkit ? "checked" : ""} ${busy ? "disabled" : ""}><span>Аптечка в рейд<small>Тратит медикаменты на входе и снижает тяжесть травм.</small></span></label><details class="training-section" ${trainingExpanded ? "open" : ""}><summary data-focus-key="training-summary">Подготовка оснащения · броня ${scav.gear.armor} / рюкзак ${scav.gear.backpack}</summary><p class="field-hint">Постоянная подготовка бойца дополняет выбранные предметы.</p><div class="gear-grid">${gearCard(scav, "armor")}${gearCard(scav, "backpack")}</div></details></section>`;
}
function sortiePreview(scav: Scav) {
	const map = MAP_BY_ID[selectedMap]!, quote = getRaidQuote(state, scav, map);
	return `<section class="inspector-section sortie-section"><h3>${scav.status === "raiding" ? "Следующая экспедиция" : "Новая экспедиция"}</h3><label class="field-label">Сектор<select data-inspector-map data-focus-key="map" aria-label="Сектор для экспедиции">${MAPS.map((sector) => `<option value="${sector.id}" ${sector.id === selectedMap ? "selected" : ""} ${state.level < sector.level ? "disabled" : ""}>${e(sector.name)}${state.level < sector.level ? ` · ур. ${sector.level}` : ""}</option>`).join("")}</select></label><div class="sortie-preview"><span><strong data-chance="${scav.id}">${Math.round(quote.chance * 100)}% успеха</strong><small>Первый этап</small></span><span><strong>${seconds(quote.duration)}</strong><small>До точки связи</small></span><span><strong data-dispatch-cost="${scav.id}">${n(quote.money)} ₽ + ${quote.ammo} патр.${quote.intel ? ` + ${quote.intel} разв.` : ""}${quote.medicine ? ` + ${quote.medicine} мед.` : ""}</strong><small>На входе</small></span></div><p class="field-hint">До трёх этапов. После каждого — эвакуация или риск дальше. Добыча остаётся в рюкзаке до возвращения; чертежи сохраняются сразу.</p></section>`;
}
function inspectorFooter(scav: Scav, raid: Raid | undefined) {
	const run = raid?.expedition;
	if (raid && run?.status === "choice") return `<footer class="inspector-actions decision-footer"><div><strong>Точка ${run.stage} / 3 · связь установлена</strong><small class="dispatch-preview">В рюкзаке ≈ ${n(getCargoValue(run.cargo))} ₽</small><span>${run.stage >= 3 ? "Маршрут пройден. Забери добычу на базу" : "Выбери путь выше или возвращайся сейчас"}</span></div><button class="button" data-action="extract" data-id="${raid.id}" data-focus-key="footer-extract">Эвакуация ${icon("check", 17)}</button></footer>`;
	const map = MAP_BY_ID[selectedMap]!, quote = getRaidQuote(state, scav, map);
	return `<footer class="inspector-actions"><div><strong>${raid ? "Боец на маршруте" : e(map.name)}</strong><small class="dispatch-preview"><b data-chance="${scav.id}">${Math.round(quote.chance * 100)}% успеха</b> · <span data-dispatch-cost="${scav.id}">${n(quote.money)} ₽ + ${quote.ammo} патр.${quote.intel ? ` + ${quote.intel} разв.` : ""}${quote.medicine ? ` + ${quote.medicine} мед.` : ""}</span></small><span data-dispatch-note="${scav.id}">${e(quote.reason ?? "Готов к первому этапу")}</span></div><button class="button" data-action="dispatch" data-id="${scav.id}" data-focus-key="dispatch" ${quote.reason ? "disabled" : ""}>В рейд ${icon("arrow", 17)}</button></footer>`;
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
	return `<button class="scav-card ${raid ? "on-mission" : ""} ${selectedScav === scav.id ? "selected" : ""}" data-scav="${scav.id}" aria-label="${waiting ? "Нужен приказ: " : "Открыть бойца "}${e(scav.name)}"><span class="scav-card-top"><span class="scav-avatar">${scavPortrait(scav.personality, scav.name)}</span><span class="scav-identity"><strong>${e(scav.name)}</strong><span>${e(personality.name)} · ур. ${scav.level}</span></span><span class="scav-state ${assigned ? "working" : waiting ? "decision" : raid ? "away" : ready ? "ready" : "waiting"}">${assigned ? "На работе" : waiting ? "Приказ" : raid ? "В рейде" : ready ? "Готов" : scav.health < 25 ? "Ранен" : "На базе"}</span></span><span class="scav-card-body"><span class="scav-weapon">${icon("arsenal", 17)} ${weapon ? e(getWeaponDefinition(weapon).name) : "Без оружия"}</span><span class="scav-health"><span>Здоровье <b data-health="${scav.id}">${Math.floor(scav.health)} / 100</b></span><span class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></span></span>${raid ? `<span class="scav-raid"><span><b>${e(MAP_BY_ID[raid.mapId]!.name)}${raid.expedition ? ` · этап ${raid.expedition.stage}/3` : ""}</b><strong data-raid-time="${raid.id}">${waiting ? "ПРИКАЗ" : seconds((raid.endsAt - Date.now()) / 1000)}</strong></span><span class="progress"><i data-raid-progress="${raid.id}"></i></span><small data-raid-phase="${raid.id}">${e(getRaidPhase(raid, Date.now()).label)}</small></span>` : `<span class="scav-idle-note">${assigned ? `${icon(roomIcon(assigned.type),13)} ${e(ROOM_DEFINITIONS[assigned.type].label)} · рабочий` : scav.autoRaid.enabled ? `${icon("repeat", 13)} ${e(MAP_BY_ID[scav.autoRaid.mapId]!.name)} · глубина ${scav.autoRaid.maxDepth}` : `${icon("backpack", 13)} ${getLoadoutStats(state, scav).capacity.toFixed(1)} ед. груза · ${getLoadoutStats(state, scav).weight.toFixed(1)} кг экип.`}</span>`}</span><span class="scav-card-bottom"><span>${waiting ? raid.expedition!.stage >= 3 ? "Вернуть бойца с добычей →" : "Эвакуация или ещё один этап →" : "Снаряжение и приказ"}</span>${icon("arrow", 16)}</span></button>`;
}
function openInspector(id: string) {
	if (!state.scavs.some((scav) => scav.id === id)) return;
	inspectorOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	selectedScav = id;
	renderInspector();
	setOverlayState();
	document.querySelector<HTMLButtonElement>('[data-action="close-inspector"]')?.focus();
}
function closeInspector() {
	const closedId = selectedScav;
	selectedScav = null;
	document.querySelector("#inspector-root")!.innerHTML = "";
	setOverlayState();
	if (inspectorOrigin?.isConnected && !inspectorOrigin.closest("[inert]")) inspectorOrigin.focus();
	else focusScavOrTool(closedId ?? "");
}
function focusScavOrTool(id: string) {
	if (page === "home" && window.innerWidth <= 850 && contextMode !== "overview") { document.querySelector<HTMLButtonElement>('#command-dock [data-action="close-context"]')?.focus({ preventScroll: true }); return; }
	const scope = page !== "home" ? document.querySelector<HTMLElement>("#tool-root") : document.querySelector<HTMLElement>("#command-crew");
	const target = scope?.querySelector<HTMLButtonElement>(`[data-scav="${CSS.escape(id)}"]`);
	if (target) target.focus({ preventScroll: true });
	else if (page !== "home") document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus({ preventScroll: true });
	else document.querySelector<HTMLButtonElement>('.command-tools [data-page="raids"]')?.focus({ preventScroll: true });
}
function renderInspector() {
	const root = document.querySelector<HTMLDivElement>("#inspector-root")!;
	if (!selectedScav) { root.innerHTML = ""; setOverlayState(); return; }
	const scav = state.scavs.find((item) => item.id === selectedScav);
	if (!scav) { closeInspector(); return; }
	const oldScroll = root.querySelector(".inspector-scroll")?.scrollTop ?? 0;
	const active = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
	const focusKey = active?.dataset.focusKey;
	const autoExpanded = root.querySelector<HTMLDetailsElement>(".order-section")?.open;
	const trainingExpanded = root.querySelector<HTMLDetailsElement>(".training-section")?.open;
	const raid = state.raids.find((r) => r.scavId === scav.id);
	const weapon = state.weapons.find((w) => w.id === scav.weaponInstanceId);
	root.innerHTML = `<div class="inspector-backdrop"><aside class="inspector" role="dialog" aria-modal="true" aria-labelledby="scav-title"><div class="inspector-head"><div><span class="eyebrow">Личное дело · ур. ${scav.level}</span><h2 id="scav-title">${e(scav.name)}</h2></div><button class="icon-button" data-action="close-inspector" data-focus-key="close" aria-label="Закрыть бойца">×</button></div><div class="inspector-scroll">${raid?.expedition?.status === "choice" ? activeRaidPanel(raid) : ""}<div class="scav-profile"><div class="inspector-portrait">${scavPortrait(scav.personality, scav.name)}</div><div><strong>${e(PERSONALITY_BY_ID[scav.personality]!.name)}</strong><p>${e(PERSONALITY_BY_ID[scav.personality]!.description)}</p><div class="profile-stats"><span>Бой <b>${scav.combat}</b></span><span>Поиск <b>${scav.scouting}</b></span><span>Выходы <b>${scav.raids}</b></span></div></div></div>${scav.assignment ? scavWorkPanel(scav) : ""}<div class="health-panel"><div><span>Здоровье</span><strong data-health="${scav.id}">${Math.floor(scav.health)} / 100</strong></div><div class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></div><div class="health-panel-bottom"><span data-heal-note="${scav.id}">Медблок восстанавливает бесплатно</span><button class="button ghost small" data-action="heal" data-id="${scav.id}" data-focus-key="heal" ${raid || scav.health >= 100 || state.supplies.medicine < medicineCost(scav) ? "disabled" : ""}>${icon("medicine", 15)} Лечить · ${medicineCost(scav)} мед.</button></div></div>${raid && raid.expedition?.status !== "choice" ? activeRaidPanel(raid) : ""}<section class="inspector-section"><div class="inspector-section-title"><h3>Оружие</h3>${weapon ? `<button class="text-button" data-action="inspect-weapon" data-id="${weapon.id}" data-focus-key="weapon-detail">Оружейный верстак →</button>` : ""}</div>${weapon ? `<div class="equipped-art" style="--rarity:${RARITY_COLORS[getWeaponDefinition(weapon).rarity]}">${weaponBuildArt(weapon)}<span><b>${e(getWeaponDefinition(weapon).name)}</b><small>Мощь ${getWeaponPower(weapon)} · состояние ${Math.round(weapon.durability)}%</small>${weaponReadiness(weapon)}</span></div>` : '<p class="field-hint">Для выхода нужен исправный ствол из арсенала.</p>'}<label class="field-label">${raid ? "Оружие занято в рейде" : "Выдать оружие"}<select aria-label="Оружие для ${e(scav.name)}" data-equip="${scav.id}" data-focus-key="weapon" ${raid ? "disabled" : ""}><option value="">Без оружия</option>${state.weapons.filter((w) => !state.scavs.some((s) => s.id !== scav.id && s.weaponInstanceId === w.id)).map((w) => `<option value="${w.id}" ${w.id === scav.weaponInstanceId ? "selected" : ""}>${e(getWeaponDefinition(w).name)} · ${Math.round(w.durability)}%${getWeaponStats(w).ready ? "" : " · не собрано"}</option>`).join("")}</select></label></section><section class="inspector-section"><h3>${raid ? "Тактика следующего выхода" : "Тактика"}</h3><div class="tactics" role="group" aria-label="Тактика для ${e(scav.name)}">${(Object.keys(TACTICS) as RaidTactic[]).map((tactic) => `<button class="${tactic === scav.tactic ? "active" : ""}" data-action="tactic" data-id="${scav.id}" data-tactic-value="${tactic}" data-focus-key="tactic-${tactic}" aria-pressed="${scav.tactic === tactic}">${TACTICS[tactic].label}</button>`).join("")}</div><p class="field-hint">${e(TACTICS[scav.tactic].description)}</p></section>${loadoutEditor(scav, trainingExpanded)}${sortiePreview(scav)}<details class="order-section" ${autoExpanded ?? scav.autoRaid.enabled ? "open" : ""}><summary data-focus-key="order-summary">${icon("repeat", 18)}<span>Постоянный приказ<small>${scav.autoRaid.enabled ? `${e(MAP_BY_ID[scav.autoRaid.mapId]!.name)} · включён` : "Повторять выходы автоматически"}</small></span><b>${scav.autoRaid.enabled ? "ВКЛ" : "+"}</b></summary>${autoRaidCard(scav)}</details></div>${inspectorFooter(scav, raid)}</aside></div>`;
	const scroll = root.querySelector<HTMLElement>(".inspector-scroll"); if (scroll) scroll.scrollTop = oldScroll;
	if (focusKey) {
		const replacement = root.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`);
		if (replacement && !(replacement instanceof HTMLButtonElement && replacement.disabled)) replacement.focus({ preventScroll: true });
		else root.querySelector<HTMLButtonElement>('[data-action="close-inspector"]')?.focus({ preventScroll: true });
	}
	setOverlayState();
}
function setOverlayState() {
	const modalOpen = Boolean(document.querySelector("#modal-root .modal"));
	const drawerOpen = Boolean(selectedScav);
	const toolsOpen = page !== "home";
	const mobileContext = window.innerWidth <= 850 && contextMode !== "overview";
	if (!canWorldDrag()) cancelWorkerPlacement(false, true);
	const contextIdentity = mobileContext ? `${contextMode}:${selectedRoomId ?? ""}:${selectedShelterSite?.column ?? ""}:${selectedShelterSite?.row ?? ""}` : "";
	const signature = `${modalOpen}:${selectedScav ?? ""}:${page}:${contextIdentity}`;
	if (signature !== worldOverlaySignature) {
		worldOverlaySignature = signature;
		holdWorldInput();
	}
	const shell = document.querySelector<HTMLElement>(".shell")!;
	shell.inert = modalOpen || drawerOpen || toolsOpen;
	const tools = document.querySelector<HTMLElement>("#tool-root")!; tools.inert = modalOpen || drawerOpen;
	if (mobileContext && !shell.inert) {
		document.querySelector<HTMLElement>(".command-hud")!.inert = true;
		document.querySelector<HTMLElement>(".command-toolbar")!.inert = true;
		document.querySelector<HTMLElement>("#hero")!.inert = true;
		document.querySelector<HTMLElement>("#command-crew")!.inert = true;
		document.querySelector<HTMLElement>("#command-routes")!.inert = true;
	} else {
		for (const selector of [".command-hud", ".command-toolbar", "#hero", "#command-crew", "#command-routes"]) document.querySelector<HTMLElement>(selector)!.inert = false;
	}
	const drawer = document.querySelector<HTMLElement>(".inspector"); if (drawer) drawer.inert = modalOpen;
	document.body.classList.toggle("overlay-open", modalOpen || drawerOpen || toolsOpen || mobileContext);
}
function closeModal() {
	document.querySelector("#modal-root")!.innerHTML = "";
	setOverlayState();
	if (modalOrigin?.isConnected) modalOrigin.focus();
	else if (selectedScav) document.querySelector<HTMLButtonElement>('[data-action="close-inspector"]')?.focus();
}
function focusModal() {
	modalOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	setOverlayState();
	document.querySelector<HTMLButtonElement>("#modal-root button")?.focus();
}
function openRoom(room: BaseRoom) {
	const target = state.shelter.rooms.find((item) => item.type === room);
	if (target) openShelterRoom(target.id);
	else { page = "base"; render(); setView("base"); window.scrollTo(0, 0); }
}
function openShelterRoom(id: string) {
	const room = state.shelter.rooms.find((item) => item.id === id); if (!room) return;
	if (room.type === "workshop") productionWorkshopId = id;
	closeInspector();
	selectedRoomId = id;
	selectedShelterSite = null;
	contextMode = "room";
	roomContextTab = ROOM_DEFINITIONS[room.type].production ? "staff" : "upgrade";
	commandOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	page = "home";
	render();
	setView("base");
	document.querySelector<HTMLButtonElement>('[data-action="close-context"]')?.focus({ preventScroll: true });
}
function openShelterSite(column: number, row: number) {
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
	contextMode = "overview";
	selectedShelterSite = null;
	renderCommandBoard();
	setOverlayState();
	if (commandOrigin?.isConnected && commandOrigin.getClientRects().length) commandOrigin.focus({ preventScroll: true });
	else document.querySelector<HTMLButtonElement>('[data-page="base"]')?.focus({ preventScroll: true });
}
function closeTools() {
	const closedPage = page;
	page = "home";
	render();
	if (window.innerWidth <= 850 && contextMode !== "overview") document.querySelector<HTMLButtonElement>('#command-dock [data-action="close-context"]')?.focus({ preventScroll: true });
	else if (toolOrigin?.isConnected && !toolOrigin.closest("[inert]") && toolOrigin.getClientRects().length) toolOrigin.focus({ preventScroll: true });
	else document.querySelector<HTMLButtonElement>(`.command-tools [data-page="${closedPage}"]`)?.focus({ preventScroll: true });
}
function roomIcon(type: ShelterRoomType) {
	return type === "workshop" || type === "recycler" ? "scrap" : type === "ammo" ? "ammo" : type === "medbay" ? "medicine" : type === "radio" ? "intel" : type === "dormitory" ? "people" : "arsenal";
}
function roomName(id: string | null) {
	const room = state.shelter.rooms.find((item) => item.id === id);
	return room ? ROOM_DEFINITIONS[room.type].label : "Комната";
}
function productionCost(cost: { money: number; supplies: GameState["supplies"] }) {
	return [cost.money ? `${n(cost.money)} ₽` : "", ...Object.entries(cost.supplies).filter(([, amount]) => amount > 0).map(([key, amount]) => `${amount} ${key === "ammo" ? "патр." : key === "medicine" ? "мед." : key === "scrap" ? "дет." : "разв."}`)].filter(Boolean).join(" + ") || "Без расхода припасов";
}
function productionOutput(output: GameState["supplies"]) {
	return `<div class="recipe-output">${Object.entries(output).filter(([, amount]) => amount > 0).map(([key, amount]) => `<span>${icon(key, 13)} ${supplyName(key)} +${amount}</span>`).join("")}</div>`;
}
function shelterOverview() {
	const rooms = state.shelter.rooms, workers = state.scavs.filter((scav) => scav.assignment), busy = rooms.filter((room) => room.queue.length).length;
	const free = state.scavs.filter((scav) => !scav.assignment && scav.status !== "raiding" && scav.health >= 25).length;
	return `<div class="shelter-overview"><div><span>Построено комнат</span><strong>${rooms.filter((room) => room.status === "ready").length} / 12</strong><small>${rooms.filter((room) => room.status !== "ready").length} — в стройке или улучшении</small></div><div><span>Назначены на работу</span><strong>${workers.length} бойцов</strong><small>Свободны на базе: ${free}</small></div><div><span>Заказы в комнатах</span><strong>${rooms.reduce((sum, room) => sum + room.queue.length, 0)}</strong><small>${busy} комнат с очередью</small></div><div><span>Готовые партии</span><strong>${rooms.reduce((sum, room) => sum + room.cycles, 0)}</strong><small>Производство идёт и офлайн</small></div></div>`;
}
function shelterHomeNote() {
	const busy = state.shelter.rooms.filter((room) => room.queue.length || room.recipeId);
	const working = state.scavs.filter((scav) => scav.assignment).length;
	const blocked = busy.filter((room) => getRoomProductionState(state, room).reason).length;
	return `<div class="shelter-home-note"><div><span class="eyebrow">Жизнь убежища</span><h3>${working ? `${working} бойцов на рабочих местах` : "Комнатам нужны свои люди"}</h3><p>${blocked ? `${blocked} производств ждут работников, расходников или места на складе.` : busy.length ? `Настроено производств: ${busy.length}. Готовые партии поступают на склад.` : "Назначь бойцов, выбери рецепты и поставь оружейные модули в очередь мастерской."}</p></div><button class="button secondary" data-page="base">Управлять комнатами ${icon("arrow", 16)}</button></div>`;
}
function renderCommandBoard() {
	cancelWorkerPlacement(false, true);
	const dock = document.querySelector<HTMLElement>("#command-dock")!;
	const room = state.shelter.rooms.find((item) => item.id === selectedRoomId);
	const oldScroll = dock.querySelector<HTMLElement>(".command-dock-scroll")?.scrollTop ?? 0;
	const activeKey = document.activeElement instanceof HTMLElement && dock.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
	const mobileContext = window.innerWidth <= 850 && contextMode !== "overview";
	dock.classList.toggle("context-open", contextMode !== "overview");
	dock.setAttribute("role", mobileContext ? "dialog" : "complementary");
	if (mobileContext) { dock.setAttribute("aria-modal", "true"); dock.setAttribute("aria-label", contextMode === "build" ? "Строительство комнаты" : "Управление комнатой"); }
	else { dock.removeAttribute("aria-modal"); dock.setAttribute("aria-label", "Сводка и управление объектом"); }
	dock.innerHTML = contextMode === "room" && room ? managedRoomPanel(room) : contextMode === "build" && selectedShelterSite ? `<header class="command-context-head"><span class="eyebrow">Новая комната</span><button class="icon-button" data-action="close-context" data-focus-key="context-close" aria-label="Закрыть строительство">×</button></header><div class="command-dock-scroll">${buildSitePanel(selectedShelterSite.column, selectedShelterSite.row)}</div>` : commandOverview();
	const scroll = dock.querySelector<HTMLElement>(".command-dock-scroll"); if (scroll) scroll.scrollTop = oldScroll;
	if (activeKey) dock.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(activeKey)}"]`)?.focus({ preventScroll: true });
	document.querySelector<HTMLElement>("#context-shade")!.hidden = !mobileContext;
	const crew = document.querySelector<HTMLElement>("#command-crew")!;
	const crewScroll = crew.querySelector<HTMLElement>(".command-crew-strip")?.scrollLeft ?? 0;
	const focusedWorker = document.activeElement instanceof HTMLElement && crew.contains(document.activeElement) ? document.activeElement.dataset.workerHandle ?? document.activeElement.dataset.scav : null;
	const focusWasHandle = document.activeElement instanceof HTMLElement && Boolean(document.activeElement.dataset.workerHandle);
	crew.innerHTML = `<div class="command-strip-head"><h2>Свои люди <span>${state.scavs.length} / ${getScavCapacity(state)}</span><small class="crew-drag-help">Перенеси портрет в комнату</small></h2><button class="text-button" data-page="raids">Снаряжение и приказы →</button></div><div class="command-crew-strip">${state.scavs.map((scav) => {
		const raid = state.raids.find((item) => item.scavId === scav.id), working = scav.assignment ? state.shelter.rooms.find((item) => item.id === scav.assignment) : null;
		const waiting = raid?.expedition?.status === "choice";
		const pickReason = workerPickReason(scav.id);
		return `<div class="crew-chip ${waiting ? "awaits-order" : ""} ${working ? "on-duty" : ""}" data-worker-card="${scav.id}"><button class="crew-inspect" data-scav="${scav.id}" aria-label="${e(scav.name)}: ${waiting ? "ждёт приказа" : working ? `работает: ${e(ROOM_DEFINITIONS[working.type].label)}` : raid ? "в рейде" : "на базе"}"><span class="crew-portrait" data-portrait-scav="${scav.id}">${scavPortrait(scav.personality, scav.name)}<b>${scav.level}</b></span><span class="crew-chip-copy"><strong>${e(scav.name)}</strong><small>${waiting ? "Нужен приказ" : working ? e(ROOM_DEFINITIONS[working.type].label) : raid ? e(MAP_BY_ID[raid.mapId]!.name) : scav.health < 25 ? "Восстанавливается" : "На базе"}</small><span class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></span></span>${waiting ? `<span class="crew-alert">!</span>` : ""}</button><button class="crew-assign-handle" data-worker-handle="${scav.id}" aria-disabled="${Boolean(pickReason)}" aria-label="Назначить ${e(scav.name)} в комнату${pickReason ? `: ${e(pickReason)}` : ". Перетащи или выбери комнату"}" title="${e(pickReason ?? "Перетащи в комнату или нажми для выбора")}">${icon("people",15)}<span aria-hidden="true">⠿</span></button></div>`;
	}).join("")}<button class="crew-recruit" data-action="recruit" ${state.scavs.length >= getScavCapacity(state) || state.money < recruitCost(state) ? "disabled" : ""} aria-label="Нанять нового бойца">${icon("people",23)}<span>Нанять</span><small>${recruitCost(state)} ₽</small></button></div>`;
	const crewStrip = crew.querySelector<HTMLElement>(".command-crew-strip"); if (crewStrip) crewStrip.scrollLeft = crewScroll;
	if (focusedWorker) crew.querySelector<HTMLElement>(`[data-${focusWasHandle ? "worker-handle" : "scav"}="${CSS.escape(focusedWorker)}"]`)?.focus({ preventScroll: true });
	const routes = document.querySelector<HTMLElement>("#command-routes")!;
	routes.innerHTML = `<div class="command-strip-head"><h2>За периметром <span>${state.raids.length} в пути</span></h2><button class="text-button" data-page="raids">Подготовить выход →</button></div>${state.raids.length ? `<div class="command-active-raids">${state.raids.map((raid) => `<button class="mission-chip ${raid.expedition?.status === "choice" ? "needs-decision" : ""}" data-scav="${raid.scavId}"><span>${icon("raids",15)} ${e(raid.scavName)} · ${e(MAP_BY_ID[raid.mapId]!.name)}</span><strong data-raid-time="${raid.id}">${raid.expedition?.status === "choice" ? "ПРИКАЗ" : seconds((raid.endsAt-Date.now())/1000)}</strong><i class="progress"><i data-raid-progress="${raid.id}"></i></i></button>`).join("")}</div>` : ""}<div class="command-sector-strip">${MAPS.map((map) => `<button class="sector-chip ${map.id === selectedMap ? "selected" : ""} ${state.level < map.level ? "locked" : ""}" data-command-map="${map.id}" ${state.level < map.level ? "disabled" : ""} aria-label="Подготовить выход: ${e(map.name)}${state.level < map.level ? `, требуется уровень ${map.level}` : ""}"><span class="sector-chip-art">${sectorArt(map.id, `board-${map.id}`)}</span><span><strong>${e(map.name)}</strong><small>${state.level < map.level ? `УР. ${map.level} · закрыт` : `${map.reward[0]}–${map.reward[1]} ₽`}</small></span>${state.level < map.level ? icon("lock",12) : icon("arrow",12)}</button>`).join("")}</div>`;
}
function commandOverview() {
	const productionRooms = state.shelter.rooms.filter((room) => room.queue.length || room.pending || room.repeat);
	const running = productionRooms.filter((room) => !getRoomProductionState(state, room).reason && room.queue.length).length;
	const staffed = state.scavs.filter((scav) => scav.assignment).length;
	const ready = CONTRACTS.filter((contract) => !state.claimedContracts.includes(contract.id) && !getContractLockReason(state, contract) && getContractProgress(state, contract) >= contract.target);
	const weapon = state.weapons.find((item) => item.id === selectedWeapon) ?? state.weapons[0];
	const last = state.history[0];
	return `<div class="command-overview-head"><span class="eyebrow">Штаб на связи</span><strong>Всё хозяйство — перед тобой.</strong></div><div class="command-system-grid"><button class="command-system production-system" data-shelter-room="${state.shelter.rooms.find((room) => room.type === "workshop")?.id ?? ""}"><span class="system-art">${roomMiniArt("workshop","summary-workshop")}</span><span><strong>Производство</strong><b>${running} работают · ${staffed} рабочих</b><small>${productionRooms.length ? `${productionRooms.length} комнат с заказами` : "Назначить людей и заказы"}</small></span></button><button class="command-system armory-system" data-page="arsenal"><span class="system-art">${weapon ? weaponBuildArt(weapon) : icon("arsenal",30)}</span><span><strong>Арсенал</strong><b>${state.weapons.length} пушек · ${state.modules.length} модулей</b><small>Верстак и комплекты</small></span></button><button class="command-system" data-page="contracts"><span class="system-mark">${icon("contracts",26)}</span><span><strong>Поручения</strong><b>${ready.length ? `${ready.length} наград готово` : `${state.claimedContracts.length} выполнено`}</b><small>Забрать у Прапора</small></span>${ready.length ? '<i class="system-attention"></i>' : ""}</button><button class="command-system" data-action="open-market"><span class="system-art">${roomMiniArt("storage","summary-storage")}</span><span><strong>Снабжение</strong><b>${state.weapons.length} / ${getStorageCapacity(state)} в арсенале</b><small>Закупки и материалы</small></span></button><button class="command-system" data-page="journal"><span class="system-mark">${icon("journal",25)}</span><span><strong>Журнал</strong><b>${state.history.length} отчётов</b><small>${last ? `${e(last.scavName)}: ${last.success ? "вернулся" : "потери"}` : "Радио пока молчит"}</small></span></button><button class="command-system" data-action="open-discoveries"><span class="system-mark">${icon("intel",25)}</span><span><strong>Память отряда</strong><b>${state.blueprints.length} открытий</b><small>Сохранено навсегда</small></span></button></div><div class="command-job-stack">${productionRooms.slice(0,2).map((room) => { const status=getRoomProductionState(state,room); return `<button class="command-job-chip" data-shelter-room="${room.id}"><span>${icon(roomIcon(room.type),15)} ${e(ROOM_DEFINITIONS[room.type].label)}</span><small data-room-status="${room.id}">${e(status.status)}</small><i class="progress"><i data-room-progress="${room.id}" style="width:${status.progress*100}%"></i></i></button>`; }).join("") || '<div class="command-first-work"><span>База ждёт твоего приказа.</span><p>Выбери комнату на схеме, назначь людей и запусти производство.</p></div>'}</div>`;
}
function renderShelter() {
	const recipeScroll = panel.querySelector<HTMLElement>(".room-module-recipes")?.scrollTop ?? 0;
	if (!selectedShelterSite && !state.shelter.rooms.some((room) => room.id === selectedRoomId)) selectedRoomId = state.shelter.rooms[0]?.id ?? null;
	const rooms = state.shelter.rooms;
	const grid = [0, 1, 2].map((row) => `<div class="shelter-floor"><div class="shelter-floor-label">УРОВЕНЬ 0${row + 1}</div><div class="shelter-floor-grid">${[0, 1, 2, 3].map((column) => {
		const room = rooms.find((item) => item.column === column && item.row === row);
		if (!room) return `<button class="shelter-site ${selectedShelterSite?.column === column && selectedShelterSite.row === row ? "active" : ""}" data-shelter-column="${column}" data-shelter-row="${row}" aria-label="Построить комнату: уровень ${row + 1}, ячейка ${column + 1}">${icon("base", 27)}<strong>Новая комната</strong><span>Свободная ячейка</span><small>Выбрать помещение +</small></button>`;
		const info = ROOM_DEFINITIONS[room.type], production = getRoomProductionState(state, room);
		return `<button class="shelter-site built ${room.status !== "ready" ? "building" : ""} ${production.reason ? "blocked" : ""} ${selectedRoomId === room.id ? "active" : ""}" data-shelter-room="${room.id}" data-focus-key="room-${room.id}" aria-pressed="${selectedRoomId === room.id}" style="--room-color:${info.color}">${icon(roomIcon(room.type), 27)}<strong>${e(info.label)}</strong><span>Ур. ${room.level || "—"} · ${room.workerIds.length} / ${getRoomWorkerCapacity(room)} работников</span><small data-room-status="${room.id}">${e(production.status)}</small><span class="progress"><i data-room-progress="${room.id}" style="width:${Math.round(production.progress * 100)}%"></i></span></button>`;
	}).join("")}</div></div>`).join("");
	panel.innerHTML = `${shelterOverview()}<section class="shelter-sites command-room-index"><div class="shelter-sites-head"><h2>Комнаты и свободные ячейки</h2><span class="eyebrow">ВЫБЕРИ ОБЪЕКТ</span></div>${grid}<p class="field-hint">Управление выбранной комнатой откроется рядом со схемой убежища.</p></section>${discoveriesSection()}`;
	const recipes = panel.querySelector<HTMLElement>(".room-module-recipes"); if (recipes) recipes.scrollTop = recipeScroll;
}
function buildSitePanel(column: number, row: number) {
	return `<div class="room-management-head"><span class="eyebrow">Уровень ${row + 1} · ячейка ${column + 1}</span><h2>Расширить убежище</h2><p>Построй помещение, дождись окончания стройки, затем назначь рабочих. Склад и жилой блок работают без персонала.</p></div><div class="room-management-body"><div class="shelter-build-options">${(Object.keys(ROOM_DEFINITIONS) as ShelterRoomType[]).map((type) => {
		const info = ROOM_DEFINITIONS[type], quote = getBuildRoomQuote(state, type, column, row);
		return `<article class="shelter-build-option"><h3>${icon(roomIcon(type), 24)} ${e(info.label)}</h3><p>${e(info.description)}</p><div class="loadout-stats"><span>Стройка ${seconds(quote.duration)}</span><span>${info.production ? "Нужны работники" : "Без работников"}</span></div><button class="button secondary" data-action="build-room" data-room-type="${type}" data-column="${column}" data-row="${row}" ${quote.reason ? "disabled" : ""}>Построить · ${costLabel(quote)}</button><small class="quote-note" data-build-room-note="${type}">${e(quote.reason ?? "Оплата при начале; стройка идёт и офлайн")}</small></article>`;
	}).join("")}</div></div>`;
}
function managedRoomPanel(room: RoomInstance) {
	const info = ROOM_DEFINITIONS[room.type], production = getRoomProductionState(state, room), upgrade = getRoomUpgradeQuote(state, room.id);
	const tab = info.production ? roomContextTab : "upgrade";
	const tabs = info.production ? [["staff","Люди"],["production","Производство"],["upgrade","Развитие"]] : [["upgrade","Развитие"]];
	const content = tab === "staff" ? roomWorkersPanel(room) : tab === "production" ? `<section class="room-panel-section"><h3>Очередь · ${room.queue.length} / 5</h3>${roomQueuePanel(room)}</section><section class="room-panel-section"><h3>${room.type === "workshop" ? "Оружейные модули" : "Рецепты"}</h3>${room.type === "workshop" ? roomModulesPanel(room) : roomResourcesPanel(room)}</section>` : room.status === "building" ? '<div class="room-queue-empty">Строительство началось. Дождись готовности, затем назначь работников или развивай комнату.</div>' : `<section class="room-panel-section"><h3>Уровень ${room.level} → ${Math.min(5,room.level+1)}</h3><p>Улучшение расширяет возможности комнаты. Люди и оплаченная очередь сохранятся.</p><div class="loadout-stats"><span>Время ${seconds(upgrade.duration)}</span></div><button class="button secondary" data-action="upgrade-room" data-id="${room.id}" ${upgrade.reason ? "disabled" : ""}>Улучшить · ${costLabel(upgrade)}</button><small class="quote-note" data-room-upgrade-note="${room.id}">${e(upgrade.reason ?? "Оплата при начале улучшения")}</small></section>`;
	return `<header class="command-context-head"><div><span class="eyebrow">Комната · ур. ${room.level || "—"}</span><h2>${e(info.label)}</h2></div><button class="icon-button" data-action="close-context" data-focus-key="context-close" aria-label="Закрыть комнату">×</button></header><div class="command-room-banner" style="--room-accent:${info.color}">${roomMiniArt(room.type,`selected-${room.id}`)}<div><strong data-room-status="${room.id}">${e(production.status)}</strong><small data-room-eta="${room.id}">${production.remainingSeconds == null ? "" : `${seconds(production.remainingSeconds)} до готовности`}</small><span class="progress"><i data-room-progress="${room.id}" style="width:${production.progress*100}%"></i></span></div></div><div class="context-tabs" role="group" aria-label="Управление комнатой">${tabs.map(([id,label]) => `<button data-room-context-tab="${id}" data-focus-key="context-tab-${id}" aria-pressed="${tab===id}" class="${tab===id?"active":""}">${label}</button>`).join("")}</div><div class="command-dock-scroll" id="room-management" tabindex="-1"><p class="command-room-reason" data-room-reason="${room.id}">${e(production.reason ?? (room.status !== "ready" ? "Работа приостановлена до готовности комнаты" : ""))}</p>${content}${!info.production ? `<p class="field-hint">${e(info.description)} Работники не требуются.</p>` : ""}</div>`;
}
function roomWorkersPanel(room: RoomInstance) {
	const capacity = getRoomWorkerCapacity(room), skill = ROOM_DEFINITIONS[room.type].workerSkill;
	const required = skill === "combat" ? "Бой" : skill === "scouting" ? "Поиск" : "Бой и поиск";
	const workers = room.workerIds.map((id) => state.scavs.find((scav) => scav.id === id)).filter((scav): scav is Scav => Boolean(scav));
	const candidates = state.scavs.filter((scav) => scav.assignment !== room.id && scav.status !== "raiding" && scav.health >= 25)
		.sort((a, b) => Number(Boolean(a.assignment)) - Number(Boolean(b.assignment)) || getWorkerAffinity(b, room.type) - getWorkerAffinity(a, room.type));
	const selected = chosenWorkers.get(room.id) ?? candidates[0]?.id ?? "";
	chosenWorkers.set(room.id, candidates.some((scav) => scav.id === selected) ? selected : candidates[0]?.id ?? "");
	const blocked = room.status !== "ready" ? "Комната ещё не готова" : workers.length >= capacity ? "Все рабочие места заняты" : !candidates.length ? "Нужен свободный боец с 25 здоровья" : null;
	return `<section class="room-panel-section"><h3>Рабочие места <span class="muted">/ ${workers.length} из ${capacity}</span></h3><p>Подходящий навык: ${required}. Несколько работников и высокий навык ускоряют партии. Во время работы боец не уходит в рейд.</p><div class="loadout-stats"><span>Темп комнаты ×${getRoomProductionState(state, room).rate.toFixed(2)}</span><span>Учтены люди и уровень комнаты</span></div><div class="worker-list">${workers.map((scav) => `<div class="worker-row"><span class="scav-avatar">${scavPortrait(scav.personality, scav.name)}</span><div><strong>${e(scav.name)}</strong><p>Бой ${scav.combat} · поиск ${scav.scouting} · здоровье ${Math.floor(scav.health)}</p><span class="worker-fit">Подходит: ${Math.round(getWorkerAffinity(scav, room.type))} / 100</span></div><button class="icon-button" data-action="release-worker" data-id="${scav.id}" data-focus-key="release-${scav.id}" aria-label="Освободить ${e(scav.name)} от работы">×</button></div>`).join("") || '<div class="room-queue-empty">Рабочих нет. Оплаченный заказ дождётся назначения бойца.</div>'}</div><label class="field-label worker-assign-field">Назначить бойца<select data-room-worker="${room.id}" aria-label="Работник для ${e(ROOM_DEFINITIONS[room.type].label)}" ${blocked ? "disabled" : ""}>${candidates.map((scav) => `<option value="${scav.id}" ${chosenWorkers.get(room.id) === scav.id ? "selected" : ""}>${e(scav.name)} · подходит ${Math.round(getWorkerAffinity(scav, room.type))} / 100${scav.assignment ? ` · перевести из ${e(roomName(scav.assignment))}` : " · свободен"}</option>`).join("") || '<option>Нет доступных бойцов</option>'}</select></label><button class="button secondary" data-action="assign-worker" data-id="${room.id}" data-focus-key="assign-worker" ${blocked ? "disabled" : ""}>Назначить на работу</button><small class="quote-note">${e(blocked ?? "Боец сменит прежнее рабочее место. Автовыходы будут ждать освобождения")}</small></section>`;
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
		return `<article class="room-job ${current ? "running" : ""}"><div class="room-job-head"><strong>${e(label)}</strong><span ${current ? `data-job-time="${job.id}"` : ""}>${current ? production.remainingSeconds == null ? "ПАУЗА" : seconds(production.remainingSeconds) : `ЗАКАЗ 0${index + 1}`}</span></div>${model ? `<div class="room-job-art">${moduleArt(model)}</div>` : productionOutput(job.output.supplies)}<div class="progress"><i data-job-progress="${job.id}" style="width:${Math.round(fraction * 100)}%"></i></div><p ${current ? `data-job-status="${job.id}"` : ""}>${current ? e(production.reason ?? production.status) : "Ожидает завершения предыдущей партии"}</p><div class="room-job-foot"><span data-job-refund="${job.id}">${job.workDone === 0 ? "Не начат · полный возврат при отмене" : "Работа начата · отмена без возврата"}</span><button class="button ghost small" data-action="cancel-production" data-id="${room.id}" data-job-id="${job.id}" data-focus-key="cancel-${job.id}">Отменить</button></div></article>`;
	}).join("");
}
function roomResourcesPanel(room: RoomInstance) {
	const recipes = RESOURCE_RECIPES.filter((recipe) => recipe.roomType === room.type);
	return `<label class="loadout-check"><input type="checkbox" data-room-repeat="${room.id}" ${room.recipeId ? room.repeat ? "checked" : "" : roomRepeatPreferences.get(room.id) === false ? "" : "checked"} ${room.status !== "ready" ? "disabled" : ""}><span>Повторять выбранный рецепт<small>Новая партия оплачивается только при запуске. При нехватке ресурсов работа ждёт пополнения.</small></span></label>${room.recipeId ? `<button class="button ghost small" data-action="stop-room-recipe" data-id="${room.id}">Остановить будущие партии</button><small class="quote-note">Оплаченные заказы продолжатся. Их можно отменить в очереди отдельно.</small>` : ""}<div class="resource-recipe-list">${recipes.map((recipe) => {
		const quote = getResourceProductionQuote(state, room.id, recipe.id), selected = room.recipeId === recipe.id;
		return `<article class="resource-recipe ${selected ? "selected" : ""}"><div class="resource-recipe-head">${icon(roomIcon(room.type), 21)}<strong>${e(recipe.label)}</strong></div><p>${e(recipe.description)}</p>${productionOutput(recipe.output)}<div class="loadout-stats"><span>Партия: ${productionCost(recipe.cost)}</span><span>Базовая работа ${seconds(quote.duration)}</span></div><button class="button secondary" data-action="set-room-recipe" data-id="${room.id}" data-recipe-id="${recipe.id}" data-focus-key="recipe-${recipe.id}" ${room.status !== "ready" ? "disabled" : ""}>${selected ? "Подтвердить рецепт и режим" : "Выбрать рецепт"}</button><small class="quote-note" data-resource-recipe-note="${recipe.id}">${e(quote.reason ?? "Бойцы запустят партию; результат поступит на склад")}</small></article>`;
	}).join("")}</div>`;
}
function roomModulesPanel(room: RoomInstance) {
	const weapon = state.weapons.find((gun) => gun.id === selectedWeapon) ?? state.weapons[0];
	const info = weapon ? RECEIVER_INFO[weapon.weaponId] : null;
	const models = MODULE_MODELS.filter((model) => (roomModuleSlot === "all" || model.slot === roomModuleSlot) && `${model.label} ${model.description}`.toLocaleLowerCase("ru").includes(roomModuleSearch.toLocaleLowerCase("ru")) && (!info || (model.platforms.includes("*") || model.platforms.includes(info.platform)) && (model.calibers.includes("*") || model.calibers.includes(info.caliber)) && (model.slot !== "receiver" || model.weaponId === weapon?.weaponId)));
	return `<p>Изготовление требует времени и рабочих. Заказ оплачивается при постановке в очередь; каждый модуль появится отдельным экземпляром на складе.</p><div class="room-module-filters"><label class="field-label">Детали для оружия<select data-room-module-weapon aria-label="Оружие для производства модулей">${state.weapons.map((gun) => `<option value="${gun.id}" ${gun.id === weapon?.id ? "selected" : ""}>${e(getWeaponDefinition(gun).name)}</option>`).join("")}</select></label><label class="field-label">Слот<select data-room-module-slot aria-label="Слот производимого модуля"><option value="all" ${roomModuleSlot === "all" ? "selected" : ""}>Все подходящие слоты</option>${MODULE_SLOTS.map((slot) => `<option value="${slot}" ${roomModuleSlot === slot ? "selected" : ""}>${MODULE_SLOT_LABELS[slot]}</option>`).join("")}</select></label><label class="weapon-search">${icon("settings", 16)}<input type="search" data-room-module-search aria-label="Поиск производимых модулей" placeholder="Название или свойства" value="${e(roomModuleSearch)}"></label></div><div class="room-module-recipes">${models.map((model) => {
		const quote = getModuleProductionQuote(state, room.id, model.id);
		return `<article class="room-module-recipe" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">${MODULE_SLOT_LABELS[model.slot]} · ${RARITY_LABELS[model.rarity]}</span><div class="room-module-recipe-art">${moduleArt(model)}</div><h4>${e(model.label)}</h4><p>${e(model.description)}</p><small class="quote-note">Базовая работа ${seconds(quote.duration)} · мастерская ур. ${model.workshopLevel}</small><button class="button secondary small" data-action="queue-room-module" data-id="${room.id}" data-model-id="${model.id}" data-focus-key="queue-${model.id}" ${quote.reason ? "disabled" : ""}>В очередь · ${costLabel(quote)}</button><small class="quote-note" data-room-module-note="${model.id}">${e(quote.reason ?? "Оплаченный заказ начнётся по очереди")}</small></article>`;
	}).join("") || '<div class="room-queue-empty">Нет деталей по этим фильтрам. Сбрось поиск или выбери другой слот.</div>'}</div>`;
}
function contractCard(contract: Contract) {
	const progress = getContractProgress(state, contract),
		claimed = state.claimedContracts.includes(contract.id),
		lockReason = getContractLockReason(state, contract),
		available = !lockReason,
		ready = available && progress >= contract.target;
	const supplies = Object.entries(contract.reward.supplies).map(([key, amount]) => `<span title="${({ ammo: "Патроны", medicine: "Медикаменты", scrap: "Детали", intel: "Разведданные" } as Record<string, string>)[key]}">${icon(key, 12)} +${amount}</span>`).join("");
	return `<article class="contract ${lockReason && !claimed ? "contract-locked" : ""}"><div class="contract-mark">${icon(claimed ? "check" : lockReason ? "lock" : "contracts", 21)}</div><div class="contract-copy"><h3>${e(contract.name)}</h3><p>${e(contract.description)}</p><div class="progress"><i style="width:${Math.min(100, (progress / contract.target) * 100)}%"></i></div><small>${n(Math.min(contract.target, progress))} / ${n(contract.target)}</small>${lockReason && !claimed ? `<div class="contract-lock">${icon("lock", 11)} ${e(lockReason)}</div>` : ""}<div class="reward-supplies">${supplies}</div></div><div class="contract-reward"><span>+${n(contract.reward.money)} ₽</span><span class="muted">+${contract.reward.xp} опыта</span><button class="button secondary small" data-action="claim" data-id="${contract.id}" ${!ready || claimed ? "disabled" : ""}>${claimed ? "Выполнено" : lockReason ? "Закрыт" : ready ? "Забрать" : "В работе"}</button></div></article>`;
}
function journalCard(report: RaidReport) {
	return `<details class="journal-entry" data-report="${report.id}"><summary><time>${new Date(report.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><div class="journal-copy"><strong>${e(report.scavName)} · ${e(MAP_BY_ID[report.mapId]!.name)}</strong><p>${e(report.description)}</p><div class="journal-meta"><span>${report.isAuto ? "АВТОВЫХОД" : "ЭКСПЕДИЦИЯ"} · этапов ${report.depth} · ${e(TACTICS[report.tactic].label)}</span><span>${report.money ? `+${n(report.money)} ₽ · ` : ""}Детали +${report.supplies.scrap} · патроны +${report.supplies.ammo}</span></div></div><b class="tag report-result ${report.success ? "success" : "failure"}">${report.success ? "ВЕРНУЛСЯ" : report.lostScav ? "ПОТЕРЯН" : "ПРОВАЛ"}</b><span class="journal-expand">${icon("arrow", 14)}</span></summary><div class="journal-detail">${report.moduleIds.length ? `<div class="module-loot-strip">${report.moduleIds.map((id) => { const model = MODULE_BY_ID[id]; return model ? `<span class="cargo-module" style="--rarity:${RARITY_COLORS[model.rarity]}">${moduleArt(model)}<span><strong>${e(model.label)}</strong><small>Доставлено на базу</small></span></span>` : ""; }).join("")}</div>` : ""}${report.discoveries.length ? `<div class="report-memory">${icon("intel", 18)} Сохранены открытия: ${report.discoveries.map((id) => e(BLUEPRINTS[id]?.label ?? id)).join(" · ")}</div>` : ""}${report.lostCargo ? `<p class="risk-note">Потеряна добыча из рюкзака: ≈ ${n(getCargoValue(report.lostCargo))} ₽. Постоянные открытия остались у базы.</p>` : ""}${report.weaponId ? `<div class="report-trophy" style="--rarity:${RARITY_COLORS[WEAPON_BY_ID[report.weaponId]!.rarity]}">${icon("arsenal", 21)}<div><strong>${e(WEAPON_BY_ID[report.weaponId]!.name)}</strong><span>${report.weaponAutoSold ? "Продано: арсенал заполнен" : "Найдено и отправлено в арсенал"}</span></div></div>` : ""}<ol class="route-timeline">${report.events.map((event, i) => `<li class="event-${event.kind}"><div class="timeline-marker">${String(i + 1).padStart(2, "0")}</div><div><div class="timeline-label"><strong>${e(event.label)}</strong><time>${new Date(event.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div><p>${e(event.text)}</p></div></li>`).join("")}</ol><div class="report-bottom"><span>Разведданные +${report.supplies.intel} · медикаменты +${report.supplies.medicine}</span><span>${report.lostScav ? "Боец потерян" : report.lostWeapon ? "Оружие потеряно" : "Отчёт закрыт"}</span></div></div></details>`;
}
function renderOfflineSummary() {
	const node = document.querySelector<HTMLElement>("#offline-summary")!;
	if (!offlineSummary) { node.innerHTML = ""; return; }
	const minutes = Math.floor(offlineSummary.elapsedMs / 60_000);
	const elapsed = minutes ? `${minutes} мин` : `${Math.floor(offlineSummary.elapsedMs / 1000)} с`;
	const expanded=node.querySelector<HTMLDetailsElement>(".offline-recap")?.open??window.innerWidth>640;
	const moneyChange=`${offlineSummary.money>=0?"+":"−"}${n(Math.abs(offlineSummary.money))} ₽`;
	node.innerHTML = `<aside class="offline-summary"><details class="offline-recap" ${expanded?"open":""}><summary>${icon("time",17)}<span>База на связи ${elapsed}<b>Чистое изменение: ${moneyChange}</b></span><i aria-hidden="true">+</i></summary><div><p>Завершено выходов: <strong>${n(offlineSummary.completedCount)}</strong>${offlineSummary.capped ? " · учтены 8 часов" : ""}. Назначенные бойцы продолжили очереди, медблок восстановил здоровье. Изменение рублей учитывает доход и оплату производства.</p><button class="button ghost small" data-page="journal">Отчёты ${icon("arrow",13)}</button></div></details><button class="dismiss-button" data-action="dismiss-offline" aria-label="Закрыть сводку">×</button></aside>`;
}
function renderExpeditionAlerts() {
	const waiting = state.raids.filter((raid) => raid.expedition?.status === "choice");
	const alerts = document.querySelector<HTMLElement>("#expedition-alerts")!;
	alerts.innerHTML = page === "home" || page === "raids" ? expeditionQueue() : waiting.length ? `<div class="operations-bar decision-notice"><div>${icon("intel", 25)}<div><span class="eyebrow">Сигнал с маршрута</span><strong>${waiting.length} ${waiting.length === 1 ? "боец ждёт" : "бойца ждут"} твой приказ</strong><p>Добыча в рюкзаке. Выбери эвакуацию или следующий этап.</p></div></div><button class="button" data-action="review-decisions">Ответить →</button></div>` : "";
}
function operationsBar() {
	const enabled = state.scavs.filter((scav) => scav.autoRaid.enabled).length;
	return `<div class="operations-bar"><div>${icon("repeat", 25)}<div><span class="eyebrow">Постоянные приказы</span><strong><span id="auto-order-count">${enabled}</span> — на автовыходах</strong><p>Ручной выход ждёт приказа на точках связи. Автовыход сам эвакуируется на заданной глубине.</p></div></div>${enabled ? '<button class="button danger small" data-action="auto-stop-all">Остановить все автовыходы</button>' : (page === "raids" ? '<button class="button secondary small" data-action="focus-roster">Выбрать бойца</button>' : '<button class="button secondary small" data-page="raids">Настроить отряд</button>')}</div>`;
}
function render() {
	deferredRender = false;
	const tabsScroll = panel.querySelector<HTMLElement>(".armory-tabs")?.scrollLeft ?? 0;
	const panelFocus = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
	const expandedReports = Array.from(panel.querySelectorAll<HTMLDetailsElement>("details[data-report][open]")).map((node) => node.dataset.report);
	document
		.querySelectorAll<HTMLButtonElement>(".nav button")
		.forEach((button) =>
			((button.classList.toggle("active", button.dataset.page === page)), (button.setAttribute("aria-current", button.dataset.page === page ? "page" : "false")))
		);
	const captions: Record<Page, string> = {
		home: "Железо в арсенале. Свои люди на связи.",
		raids: "Три этапа. Выбери путь, сохрани добычу или рискни дальше.",
		arsenal: "Собери оружие из деталей. Настрой комплект под свой маршрут.",
		base: "Комнаты, люди и настоящие производственные очереди.",
		contracts: "Репутация строится на выполненных обещаниях.",
		journal: "Кто вышел, кто вернулся и что принёс.",
	};
	document.querySelector("#page-head")!.innerHTML =
		`<div><div class="eyebrow"><span class="page-number">0${Object.keys(names).indexOf(page) + 1} /</span> ${page === "home" ? "УБЕЖИЩЕ ПРАПОРА" : names[page]}</div><h2 id="tool-title">${names[page]}</h2><p>${captions[page]}</p></div><span class="tag">${icon("time", 13)} <span id="income-status"></span></span>`;
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
			)}</div>${shelterHomeNote()}${operationsBar()}<div class="section-head"><h2>Твои люди <span class="muted">/ ${state.scavs.length}</span></h2><button class="link-button" data-page="raids">Управлять отрядом →</button></div><div class="card-grid scav-grid">${state.scavs.map(scavCard).join("") || '<div class="empty">Отряд пуст. Найми дикого в разделе «Рейды» — первый после потери отряда приходит бесплатно.</div>'}</div><div class="section-head"><h2>Прапор поручил</h2><button class="link-button" data-page="contracts">Все контракты →</button></div><div class="quick-contracts">${
			CONTRACTS.filter((c) => !state.claimedContracts.includes(c.id) && !getContractLockReason(state, c))
				.slice(0, 2)
				.map(contractCard)
				.join("") ||
			'<div class="empty">Все контракты закрыты. Развивай репутацию — Прапор откроет следующие поручения.</div>'
		}</div>`;
	if (page === "raids") {
		const map = MAP_BY_ID[selectedMap]!;
		panel.innerHTML = `${operationsBar()}<div class="section-head"><h2>Выбери сектор</h2><button class="text-button" data-action="toggle-map" aria-expanded="${showTacticalMap}">${icon("raids", 16)} ${showTacticalMap ? "Скрыть карту" : "Тактическая карта"}</button></div><div class="maps">${MAPS.map((m, i) => `<button class="map-card ${m.id === selectedMap ? "selected" : ""} ${state.level < m.level ? "locked" : ""}" data-map="${m.id}" aria-pressed="${m.id === selectedMap}" ${state.level < m.level ? "disabled" : ""}><span class="map-graphic" style="--map-color:${m.accent}">${icon("raids", 70)}</span><span class="map-index">СЕКТОР 0${i + 1}${state.level < m.level ? ` · ${icon("lock", 10)} УР. ${m.level}` : ""}</span><h3>${e(m.name)}</h3><p>${e(m.subtitle)}</p><div class="map-meta"><span>${seconds(m.duration)} · ${m.ammoCost} патр.${m.intelCost ? ` · ${m.intelCost} разв.` : ""}</span><span>${m.reward[0]}–${m.reward[1]} ₽</span></div></button>`).join("")}</div><div class="selected-sector"><div><span class="eyebrow">Выбранный сектор</span><h3>${e(map.name)}</h3><p>${e(map.description)}</p></div><span class="sector-reward"><strong>${map.reward[0]}–${map.reward[1]} ₽</strong><small>Добыча первого этапа</small></span></div><div class="section-head"><h2>Снаряжение отряда</h2><button class="button secondary small" data-action="recruit" ${state.scavs.length >= getScavCapacity(state) || state.money < recruitCost(state) ? "disabled" : ""}>${icon("people", 15)} Нанять · ${recruitCost(state)} ₽</button></div><div class="card-grid scav-grid">${state.scavs.map(scavCard).join("") || '<div class="empty">Отряд потерян. Найми нового дикого бесплатно и начни снова.</div>'}</div><p class="muted roster-capacity">Отряд: ${state.scavs.length} / ${getScavCapacity(state)} · Улучшай радиорубку, чтобы нанимать больше диких. Медблок восстанавливает здоровье со временем.</p>`;
	}
	if (page === "arsenal") renderArsenal();
	if (page === "base") renderShelter();
	if (page === "contracts") {
		const contracts = CONTRACTS.filter((contract) => contractFilter === "all" || (contractFilter === "done") === state.claimedContracts.includes(contract.id));
		panel.innerHTML = `<div class="arsenal-toolbar"><div class="filters">${(["open", "done", "all"] as const).map((filter) => `<button data-contract-filter="${filter}" class="${contractFilter === filter ? "active" : ""}">${filter === "open" ? "Поручения" : filter === "done" ? "Выполнены" : "Все"}</button>`).join("")}</div><span class="tag">${state.claimedContracts.length} / ${CONTRACTS.length} ЗАКРЫТО</span></div><div class="contract-brief">${icon("contracts", 22)}<p>Поручения дают рубли, опыт и припасы для следующего выхода. Завершай цепочку: награды открывают новые задания, а репутация — новые сектора.</p></div>${contracts.map(contractCard).join("") || '<div class="empty">Здесь пока нет поручений. Заверши первый контракт и возвращайся.</div>'}`;
	}
	if (page === "journal")
		panel.innerHTML = state.history.length
			? `<div class="section-head"><h2>Последние отчёты · ${state.history.length}</h2><span class="muted">Всего: ${n(state.stats.raidsCompleted)} · нажми отчёт, чтобы открыть маршрут</span></div>${state.history.map(journalCard).join("")}`
			: '<div class="empty">Радио пока молчит.<br>Отправь дикого в первый рейд — здесь появится его отчёт.</div>';
	panel.querySelectorAll<HTMLDetailsElement>("details[data-report]").forEach((node) => { node.open = expandedReports.includes(node.dataset.report); });
	renderCommandBoard();
	const tools = document.querySelector<HTMLElement>("#tool-root")!; tools.hidden = page === "home";
	renderInspector();
	setOverlayState();
	hud();
	const tabs = panel.querySelector<HTMLElement>(".armory-tabs"); if (tabs) tabs.scrollLeft = tabsScroll;
	if (panelFocus && !selectedScav && !document.querySelector("#modal-root .modal")) panel.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(panelFocus)}"]`)?.focus({ preventScroll: true });
}
function renderArsenal() {
	if (arsenalTab === "bench") { renderWorkbench(); return; }
	if (arsenalTab === "modules") { renderModules(); return; }
	if (arsenalTab === "equipment") { renderEquipment(); return; }
	if (arsenalTab === "market") { renderMarket(); return; }
	const noMatches = `<div class="empty">Ничего не найдено.<br>Измени поиск или категорию.<button class="button ghost small" data-action="reset-weapon-filters">Сбросить поиск и фильтры</button></div>`;
	const emptyArsenal = `<div class="empty">Арсенал пуст.<br>Отправь бойца за добычей или найми нового, если отряд потерян.<button class="button secondary small" data-page="raids">К отряду ${icon("arrow", 14)}</button></div>`;
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
	return `<div class="section-tabs armory-tabs" role="group" aria-label="Раздел арсенала">${([["weapons", "arsenal", "Оружие"], ["bench", "scrap", "Верстак"], ["modules", "settings", "Модули"], ["equipment", "armor", "Комплекты"], ["market", "money", "Снабжение"]] as const).map(([id, symbol, label]) => `<button data-arsenal-tab="${id}" aria-pressed="${arsenalTab === id}" class="${arsenalTab === id ? "active" : ""}">${icon(symbol, 17)} ${label}</button>`).join("")}</div>`;
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
	return mount === "rail-top" ? "Верхняя планка" : mount === "rail-bottom" ? "Нижняя планка цевья" : mount === "dovetail" ? "Боковой кронштейн" : mount.startsWith("thread:") ? `Резьба ${mount.slice(7)}` : mount;
}
function weaponStatRows(weapon: WeaponInstance, preview?: WeaponInstance) {
	const stats = getWeaponStats(weapon), next = preview ? getWeaponStats(preview) : stats;
	const baseAmmoMultiplier = getWeaponRole(weapon).ammoMultiplier;
	const metrics = [
		["power", "Мощь", false, ""], ["ergonomics", "Эргономика", false, ""],
		["recoil", "Отдача", true, ""], ["reliability", "Надёжность", false, "%"],
		["weight", "Вес", true, " кг"], ["ammoMultiplier", "Расход", true, "×"],
	] as const;
	return `<div class="bench-stat-grid">${metrics.map(([key, label, lower, unit]) => {
		const before = stats[key] * (key === "ammoMultiplier" ? baseAmmoMultiplier : 1), after = next[key] * (key === "ammoMultiplier" ? baseAmmoMultiplier : 1), delta = Math.round((after - before) * 100) / 100;
		const format = (value: number) => key === "weight" || key === "ammoMultiplier" ? value.toFixed(2) : String(Math.round(value));
		return `<div class="bench-stat"><span>${label}${key === "recoil" ? " ↓" : ""}</span><strong>${format(before)}${unit}${preview && delta ? `<b class="stat-after">→ ${format(after)}${unit}</b>` : ""}</strong><small class="${delta ? (lower ? delta < 0 : delta > 0) ? "better" : "worse" : ""}">${preview ? delta ? `${delta > 0 ? "+" : ""}${format(delta)}${unit}` : "Без изменений" : key === "ergonomics" ? "Выше — быстрее путь" : key === "recoil" ? "Ниже — точнее бой" : key === "reliability" ? "С учётом состояния" : key === "weight" ? "Влияет на комплект" : key === "ammoMultiplier" ? "Без веса всего комплекта" : "С учётом износа"}</small></div>`;
	}).join("")}</div>`;
}
function moduleTraits(item: ModuleInstance) {
	const model = getModuleDefinition(item), traits = model.stats;
	const values = [
		["damage", "Мощь", ""], ["ergonomics", "Эрго", ""], ["recoil", "Отдача", ""],
		["reliability", "Надёжн.", ""], ["weight", "Вес", " кг"], ["ammoMultiplier", "Патроны", "×"],
	] as const;
	return `<div class="module-traits">${values.filter(([key]) => key === "ammoMultiplier" ? traits[key] !== 1 : traits[key] !== 0).map(([key, label, unit]) => `<span>${label} <b>${key === "ammoMultiplier" ? `×${traits[key].toFixed(2)}` : `${key !== "weight" && traits[key] > 0 ? "+" : ""}${Math.round(traits[key] * 100) / 100}${unit}`}</b></span>`).join("") || '<span>Штатный элемент · без дополнительных бонусов</span>'}</div>`;
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
	closeInspector();
	page = "arsenal";
	arsenalTab = "bench";
	selectedWeapon = id;
	selectedBenchModule = null;
	selectedModuleSlot = "optic";
	render();
	document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
}
function renderWorkbench() {
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
	const issues = getWeaponBuildIssues(weapon), disassembleReason = getWeaponDisassembleReason(state, weapon.id);
	const oldScroll = panel.querySelector<HTMLElement>(".bench-candidates")?.scrollTop ?? 0;
	const parts = state.modules.filter((item) => getModuleDefinition(item).slot === selectedModuleSlot && getModuleDefinition(item).label.toLocaleLowerCase("ru").includes(benchPartSearch.toLocaleLowerCase("ru"))).sort((a, b) => Number(Boolean(getModuleInstallReason(state, weapon.id, a.id))) - Number(Boolean(getModuleInstallReason(state, weapon.id, b.id))));
	const slotCards = MODULE_SLOTS.map((slot) => {
		const item = weapon.modules[slot], required = info.requiredSlots.includes(slot);
		return `<button class="bench-slot ${slot === selectedModuleSlot ? "active" : ""} ${item ? "filled" : required ? "missing" : "slot-empty"}" data-bench-slot="${slot}" data-focus-key="bench-slot-${slot}" aria-pressed="${slot === selectedModuleSlot}" aria-label="${MODULE_SLOT_LABELS[slot]}: ${item ? e(getModuleDefinition(item).label) : required ? "обязательный модуль отсутствует" : "не установлен"}"><span class="bench-slot-label">${MODULE_SLOT_LABELS[slot]}${required ? '<b title="Обязателен для выхода">●</b>' : ""}</span><span class="bench-slot-art">${item ? moduleArt(getModuleDefinition(item)) : `<span class="empty-slot-icon">${icon(slot === "receiver" ? "arsenal" : "settings", 29)}</span>`}</span><strong>${item ? e(getModuleDefinition(item).label) : required ? "Нужно установить" : "Свободный слот"}</strong><small>${item ? `${Math.round(item.durability)}% состояния` : required ? "Обязателен для выхода" : "Дополнительная настройка"}</small></button>`;
	}).join("");
	panel.innerHTML = `${arsenalTabs()}<div class="bench-toolbar"><div><span class="eyebrow">Мастерская Прапора · оружейный стол</span><h2>${e(def.name)}</h2><p>${e(modulePlatformLabel(info.platform))} · ${e(info.caliber)}${owner ? ` · выдано: ${e(owner.name)}` : " · резерв базы"}</p></div><label class="field-label">Оружие на верстаке<select data-bench-weapon aria-label="Оружие на верстаке">${state.weapons.map((gun) => `<option value="${gun.id}" ${gun.id === weapon.id ? "selected" : ""}>${e(getWeaponDefinition(gun).name)}${getWeaponStats(gun).ready ? "" : " · не собрано"}</option>`).join("")}</select></label></div><div class="workbench-layout"><section class="bench-build"><div class="bench-mat"><div class="bench-mat-head">${weaponReadiness(weapon)}<span class="mono">${preview ? "ПРЕДПРОСМОТР · НЕ УСТАНОВЛЕНО" : "ТЕКУЩАЯ СБОРКА"}</span></div><div class="workbench-stage">${weaponBuildArt(preview ?? weapon, selectedModuleSlot)}</div><div class="bench-mat-foot"><span>${icon("settings", 14)} Выбери деталь на оружии или слот ниже</span><span>${Object.keys(weapon.modules).length} / 8 СЛОТОВ</span></div></div>${busy ? '<p class="risk-note">Оружие сейчас в рейде. Осмотр доступен; сборку и обслуживание можно изменить после возвращения.</p>' : issues.length ? `<div class="assembly-warning">${icon("scrap", 20)}<div><strong>Сборка пока не готова к рейду.</strong>${issues.map((issue) => `<p>${e(issue)}</p>`).join("")}</div></div>` : '<p class="assembly-ready">✓ Все обязательные элементы на месте. Настрой комплект под маршрут.</p>'}${weaponStatRows(weapon, preview)}${buildRaidEffects(weapon, preview)}${preservedTuning(weapon)}<div class="bench-slots" role="group" aria-label="Слоты сборки оружия">${slotCards}</div><div class="bench-service"><button class="button secondary small" data-action="repair" data-id="${weapon.id}" ${busy || !needsWeaponRepair(weapon) || !canAfford(getRepairCost(weapon)) ? "disabled" : ""}>Ремонт сборки · ${costLabel(getRepairCost(weapon))}</button><button class="button ghost small" data-action="disassemble-weapon" data-id="${weapon.id}" ${disassembleReason ? "disabled" : ""}>Разобрать на модули</button></div><small class="cost-reason" data-weapon-cost="${weapon.id}-repair">${busy ? "Оружие в рейде" : !needsWeaponRepair(weapon) ? "Ремонт не нужен" : costReason(getRepairCost(weapon))}</small><small class="quote-note" data-disassemble-note>${e(disassembleReason ?? "Разбор сохранит все установленные физические детали")}</small></section><aside class="bench-slot-panel" id="bench-slot-panel"><div class="bench-panel-head"><span class="eyebrow">Выбранный слот</span><h3>${MODULE_SLOT_LABELS[selectedModuleSlot]}</h3></div>${current ? installedModulePanel(weapon, current) : `<div class="bench-current empty-current"><span>${icon("settings", 23)}</span><strong>Модуль не установлен</strong><p>${info.requiredSlots.includes(selectedModuleSlot) ? "Выбери совместимую деталь ниже, чтобы завершить сборку." : "Можно оставить слот свободным или настроить оружие."}</p></div>`}${candidate ? candidateModulePanel(weapon, candidate, reason) : '<div class="bench-preview-hint">Выбери деталь из запаса. Увидишь сборку и изменение характеристик до установки.</div>'}<div class="bench-candidate-head"><h3>Детали из запаса <span class="muted">/ ${parts.length}</span></h3><button class="text-button" data-action="browse-modules" data-slot="${selectedModuleSlot}">Склад →</button></div><label class="weapon-search bench-part-search">${icon("settings", 16)}<input type="search" data-bench-search aria-label="Поиск деталей для выбранного слота" placeholder="Название детали" value="${e(benchPartSearch)}"></label><div class="bench-candidates">${parts.map((item) => {
		const model = getModuleDefinition(item), blocked = getModuleInstallReason(state, weapon.id, item.id);
		return `<button class="bench-candidate ${item.id === candidate?.id ? "selected" : ""} ${blocked ? "incompatible" : ""}" data-action="pick-module" data-id="${item.id}" data-focus-key="candidate-${item.id}" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="candidate-art">${moduleArt(model)}</span><span class="candidate-copy"><b>${e(model.label)}</b><small>${RARITY_LABELS[model.rarity]} · ${Math.round(item.durability)}%</small><span>${e(blocked ?? "Совместим · доступен для установки")}</span></span></button>`;
	}).join("") || '<div class="empty compact-empty">В запасе нет таких деталей.<br>Найди их в рейде или изготовь на складе модулей.</div>'}</div></aside></div>`;
	const candidates = panel.querySelector<HTMLElement>(".bench-candidates"); if (candidates) candidates.scrollTop = oldScroll;
}
function installedModulePanel(weapon: WeaponInstance, item: ModuleInstance) {
	const model = getModuleDefinition(item), reason = getModuleRemoveReason(state, weapon.id, model.slot);
	return `<div class="bench-current" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">Установлено · ${RARITY_LABELS[model.rarity]}</span>${moduleArt(model)}<h3>${e(model.label)}</h3><p>${e(model.description)}</p><div class="module-condition"><span>Состояние</span><strong>${Math.round(item.durability)}%</strong><i class="health-track"><i style="width:${item.durability}%"></i></i></div>${moduleTraits(item)}<button class="button ghost small" data-action="remove-module" data-id="${weapon.id}" data-slot="${model.slot}" data-focus-key="remove-${model.slot}" ${reason ? "disabled" : ""}>Снять на склад</button><small class="quote-note">${e(reason ?? "Деталь сохранит состояние и вернётся в запас")}</small></div>`;
}
function candidateModulePanel(weapon: WeaponInstance, item: ModuleInstance, reason: string | null) {
	const model = getModuleDefinition(item);
	return `<div class="bench-candidate-preview" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">${reason ? "Проверка совместимости" : "Предпросмотр замены"}</span>${moduleArt(model)}<h3>${e(model.label)}</h3><p>${e(model.description)}</p>${moduleTraits(item)}<div class="module-fit"><span>Платформа: ${model.platforms.includes("*") ? "любая" : e(model.platforms.map(modulePlatformLabel).join(" / "))}</span><span>Калибр: ${model.calibers.includes("*") ? "любой" : e(model.calibers.join(" / "))}</span>${model.requiresMount ? `<span>Крепление: ${e(mountLabel(model.requiresMount))}</span>` : ""}</div><button class="button" data-action="install-module" data-id="${weapon.id}" data-module-id="${item.id}" data-focus-key="install-${model.slot}" ${reason ? "disabled" : ""}>${weapon.modules[model.slot] ? "Заменить модуль" : "Установить модуль"} ${icon("check", 16)}</button><small class="quote-note">${e(reason ?? "При замене текущая деталь вернётся на склад; состояние обеих сохранится")}</small></div>`;
}
function moduleMatches(item: ModuleInstance) {
	const model = getModuleDefinition(item);
	return (moduleSlotFilter === "all" || model.slot === moduleSlotFilter) && (moduleRarityFilter === "all" || model.rarity === moduleRarityFilter) && `${model.label} ${model.description}`.toLocaleLowerCase("ru").includes(moduleSearch.toLocaleLowerCase("ru"));
}
function selectedProductionWorkshop() {
	const workshops = state.shelter.rooms.filter((room) => room.type === "workshop");
	const room = workshops.find((item) => item.id === productionWorkshopId) ?? workshops.find((item) => item.status === "ready") ?? workshops[0];
	productionWorkshopId = room?.id ?? null;
	return room;
}
function renderModules() {
	const workshop = selectedProductionWorkshop();
	const craftExpanded = panel.querySelector<HTMLDetailsElement>(".module-craft-catalog")?.open;
	const installedExpanded = panel.querySelector<HTMLDetailsElement>(".installed-parts-list")?.open;
	const loose = state.modules.filter(moduleMatches);
	const installed = state.weapons.flatMap((weapon) => MODULE_SLOTS.map((slot) => weapon.modules[slot]).filter((item): item is ModuleInstance => Boolean(item)).filter(moduleMatches).map((item) => ({ item, weapon })));
	const craftWeapon = state.weapons.find((weapon) => weapon.id === selectedWeapon) ?? state.weapons[0];
	const craftInfo = craftWeapon ? RECEIVER_INFO[craftWeapon.weaponId] : null;
	const recipes = MODULE_MODELS.filter((model) => (moduleSlotFilter === "all" || model.slot === moduleSlotFilter) && (moduleRarityFilter === "all" || model.rarity === moduleRarityFilter) && `${model.label} ${model.description}`.toLocaleLowerCase("ru").includes(moduleSearch.toLocaleLowerCase("ru")) && (!moduleCraftForWeapon || !craftInfo || ((model.platforms.includes("*") || model.platforms.includes(craftInfo.platform)) && (model.calibers.includes("*") || model.calibers.includes(craftInfo.caliber)) && (model.slot !== "receiver" || model.weaponId === craftWeapon?.weaponId))));
	panel.innerHTML = `${arsenalTabs()}<div class="module-storage-head"><div><span class="eyebrow">Физические детали · каждый экземпляр сохранён</span><h2>Склад модулей</h2><p>Снимай, меняй и собирай. Износ остаётся с деталью; найденная ствольная коробка становится основой нового оружия.</p></div><span class="tag">${state.modules.length} / ${getModuleCapacity(state)} В ЗАПАСЕ</span></div><div class="module-filters"><label class="field-label">Слот<select data-module-slot-filter aria-label="Фильтр модулей по слоту"><option value="all" ${moduleSlotFilter === "all" ? "selected" : ""}>Все слоты</option>${MODULE_SLOTS.map((slot) => `<option value="${slot}" ${moduleSlotFilter === slot ? "selected" : ""}>${MODULE_SLOT_LABELS[slot]}</option>`).join("")}</select></label><label class="field-label">Редкость<select data-module-rarity-filter aria-label="Фильтр модулей по редкости"><option value="all" ${moduleRarityFilter === "all" ? "selected" : ""}>Любая редкость</option>${Object.keys(RARITY_LABELS).map((rarity) => `<option value="${rarity}" ${moduleRarityFilter === rarity ? "selected" : ""}>${RARITY_LABELS[rarity as keyof typeof RARITY_LABELS]}</option>`).join("")}</select></label><label class="weapon-search module-search">${icon("settings", 18)}<input type="search" data-module-search aria-label="Поиск модулей" placeholder="Название или свойства детали" value="${e(moduleSearch)}"></label></div><div class="section-head"><h2>Свободные детали <span class="muted">/ ${loose.length}</span></h2><button class="text-button" data-arsenal-tab="bench">На верстак →</button></div><div class="module-inventory-grid">${loose.map((item) => moduleInventoryCard(item)).join("") || '<div class="empty compact-empty">Здесь пока нет деталей. Проверь фильтры, сними деталь с оружия или изготовь нужный модуль ниже.</div>'}</div>${installed.length ? `<details class="installed-parts-list" ${installedExpanded ? "open" : ""}><summary>На оружии · ${installed.length} ${icon("arsenal", 17)}</summary><div class="module-inventory-grid">${installed.map(({ item, weapon }) => moduleInventoryCard(item, weapon)).join("")}</div></details>` : ""}<details class="module-craft-catalog" ${craftExpanded ?? (moduleSlotFilter !== "all" || Boolean(moduleSearch)) ? "open" : ""}><summary><span>${icon("scrap", 21)} Производство деталей<small>${recipes.length} моделей по выбранным фильтрам · за рубли и детали</small></span><b>+</b></summary><div class="craft-context"><label class="loadout-check"><input type="checkbox" data-craft-for-weapon ${moduleCraftForWeapon ? "checked" : ""}><span>Для текущего оружия<small>${craftWeapon ? e(getWeaponDefinition(craftWeapon).name) : "Нет выбранной сборки"}</small></span></label>${craftWeapon ? `<select data-craft-weapon aria-label="Оружие для фильтра изготовления">${state.weapons.map((gun) => `<option value="${gun.id}" ${gun.id === craftWeapon.id ? "selected" : ""}>${e(getWeaponDefinition(gun).name)}</option>`).join("")}</select>` : ""}</div><div class="production-workshop-picker"><label class="field-label">Очередь мастерской<select data-production-workshop aria-label="Мастерская для изготовления модулей">${state.shelter.rooms.filter((room) => room.type === "workshop").map((room) => `<option value="${room.id}" ${room.id === workshop?.id ? "selected" : ""}>${e(ROOM_DEFINITIONS[room.type].label)} · этаж ${room.row + 1} · ур. ${room.level} · очередь ${room.queue.length}/5 · рабочих ${room.workerIds.length}</option>`).join("") || '<option>Построй мастерскую на базе</option>'}</select></label>${workshop ? `<button class="button ghost small" data-action="open-work-room" data-id="${workshop.id}">Назначить людей и увидеть очередь →</button>` : '<button class="button ghost small" data-page="base">Построить мастерскую →</button>'}</div><p class="field-hint">Штатные детали закрывают недостающие обязательные слоты. Более сложные варианты требуют развитой мастерской; ствольные коробки — открытия оружия. Модули производятся по времени, только с назначенными работниками.</p><div class="module-inventory-grid">${recipes.map((model) => {
		const quote = getModuleProductionQuote(state, workshop?.id ?? "", model.id);
		return `<article class="module-card recipe-card" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">${MODULE_SLOT_LABELS[model.slot]} · ${RARITY_LABELS[model.rarity]}</span><div class="module-card-art">${moduleArt(model)}</div><h3>${e(model.label)}</h3><p>${e(model.description)}</p><div class="module-fit"><span>${model.platforms.includes("*") ? "Универсальная платформа" : `Платформа ${e(model.platforms.map(modulePlatformLabel).join(" / "))}`}</span><span>Мастерская ур. ${model.workshopLevel} · базовая работа ${seconds(quote.duration)}</span></div><button class="button secondary small" data-action="craft-module" data-id="${model.id}" ${quote.reason ? "disabled" : ""}>В очередь · ${costLabel(quote)}</button><small class="quote-note" data-module-craft-note="${model.id}">${e(quote.reason ?? "Бойцы изготовят деталь по очереди; оплата при постановке")}</small></article>`;
	}).join("") || '<div class="empty compact-empty">Нет моделей по выбранным фильтрам.</div>'}</div></details>`;
}
function moduleInventoryCard(item: ModuleInstance, weapon?: WeaponInstance) {
	const model = getModuleDefinition(item), cost = getModuleRepairCost(item), stats = model.stats;
	return `<article class="module-card ${weapon ? "installed" : ""}" style="--rarity:${RARITY_COLORS[model.rarity]}"><div class="module-card-heading"><span class="eyebrow">${MODULE_SLOT_LABELS[model.slot]}</span><b>${RARITY_LABELS[model.rarity]}</b></div><div class="module-card-art">${moduleArt(model)}</div><h3>${e(model.label)}</h3><p>${e(model.description)}</p><div class="module-condition"><span>${weapon ? `На оружии: ${e(getWeaponDefinition(weapon).name)}` : "На складе"}</span><strong>${Math.round(item.durability)}%</strong><i class="health-track"><i style="width:${item.durability}%"></i></i></div><div class="module-fit"><span>${model.platforms.includes("*") ? "Универсальная платформа" : `Платформа ${e(model.platforms.map(modulePlatformLabel).join(" / "))}`}</span><span>${model.calibers.includes("*") ? "Любой калибр" : `Калибр ${e(model.calibers.join(" / "))}`}</span>${model.requiresMount ? `<span>Нужно крепление ${e(mountLabel(model.requiresMount))}</span>` : ""}<span>Вес ${stats.weight.toFixed(2)} кг</span></div>${moduleTraits(item)}${weapon ? `<button class="button ghost small" data-action="open-bench" data-id="${weapon.id}" data-slot="${model.slot}">Осмотреть на верстаке →</button><small class="quote-note">Сними деталь с оружия, чтобы обслужить или продать её отдельно</small>` : `${model.slot === "receiver" ? `<button class="button secondary" data-action="assemble-weapon" data-id="${item.id}">Начать сборку оружия</button>` : `<button class="button secondary" data-action="use-module" data-id="${item.id}">Подобрать на верстаке →</button>`}<button class="button ghost small" data-action="repair-module" data-id="${item.id}" ${item.durability >= 100 || !canAfford(cost) ? "disabled" : ""}>Ремонт · ${costLabel(cost)}</button><small class="quote-note" data-module-repair-note="${item.id}">${item.durability >= 100 ? "Ремонт не нужен" : costReason(cost)}</small><div class="module-disposal"><button class="text-button" data-action="sell-module" data-id="${item.id}">Продать · ${n(getModuleSaleValue(item))} ₽</button><button class="text-button" data-action="recycle-module" data-id="${item.id}" ${state.supplies.scrap + getModuleRecycleYield(item) > getSupplyCapacity(state).scrap ? "disabled" : ""}>Утилизация · ${getModuleRecycleYield(item)} дет.</button></div><small class="quote-note" data-module-recycle-note="${item.id}">${state.supplies.scrap + getModuleRecycleYield(item) > getSupplyCapacity(state).scrap ? "Нет места для деталей на складе" : "Продажа и утилизация уничтожают этот экземпляр"}</small>`}</article>`;
}
function renderEquipment() {
	const items = state.gearItems.map((item) => {
		const model = getGearModel(item), repair = getGearRepairCost(item);
		const owner = state.scavs.find((scav) => scav.loadout.armorItemId === item.id || scav.loadout.backpackItemId === item.id);
		const busy = owner?.status === "raiding";
		return `<article class="logistics-card"><span class="eyebrow">${model.slot === "armor" ? "Броня" : "Рюкзак"} · ${owner ? e(owner.name) : "На складе"}</span><h3>${icon(model.slot, 23)} ${e(model.label)}</h3><p>${e(model.description)}</p><div class="loadout-stats"><span>Состояние ${Math.round(item.durability)}%</span><span>Вес ${model.weight} кг</span>${model.protection ? `<span>Защита до ${Math.round(model.protection * 100)}%</span>` : ""}${model.capacity ? `<span>Груз до ${model.capacity} ед.</span>` : ""}</div><div class="health-track"><i style="width:${item.durability}%"></i></div>${owner ? `<button class="button ghost" data-scav="${owner.id}">Комплект: ${e(owner.name)}</button>` : `<label class="field-label">Выдать бойцу<select data-assign-gear="${item.id}" data-slot="${model.slot}" aria-label="Выдать ${e(model.label)} бойцу"><option value="">Выбери бойца</option>${state.scavs.filter((scav) => scav.status !== "raiding").map((scav) => `<option value="${scav.id}">${e(scav.name)}${(model.slot === "armor" ? scav.loadout.armorItemId : scav.loadout.backpackItemId) ? " · заменить предмет" : ""}</option>`).join("")}</select></label>`}<button class="button secondary small" data-action="repair-gear" data-id="${item.id}" ${busy || item.durability >= 100 || !canAfford(repair) ? "disabled" : ""}>Ремонт · ${costLabel(repair)}</button><small class="quote-note">${busy ? "Предмет на маршруте" : item.durability >= 100 ? "Ремонт не нужен" : costReason(repair)}</small><button class="button ghost small" data-action="recycle-gear" data-id="${item.id}" ${busy ? "disabled" : ""}>Утилизация · ${getGearRecycleYield(item)} дет.</button><small class="quote-note" data-recycle-note>Утилизация возвращает материалы; предмет исчезнет</small></article>`;
	}).join("");
	const recipes = GEAR_MODELS.map((model) => {
		const reason = getGearCraftReason(state, model.id);
		const known = !model.blueprint || state.blueprints.includes(model.blueprint);
		return `<article class="logistics-card ${known ? "" : "locked"}"><span class="eyebrow">${known ? "Чертёж известен" : "Нужен чертёж"}</span><h3>${icon(model.slot, 22)} ${e(model.label)}</h3><p>${e(model.description)}</p><div class="loadout-stats"><span>Вес ${model.weight} кг</span>${model.protection ? `<span>Защита до ${Math.round(model.protection * 100)}%</span>` : ""}${model.capacity ? `<span>Груз до ${model.capacity} ед.</span>` : ""}</div><button class="button secondary" data-action="craft-gear" data-id="${model.id}" ${reason ? "disabled" : ""}>Собрать · ${costLabel(model)}</button><small class="quote-note" data-craft-note="${model.id}">${e(reason ?? "Снаряжение появится на складе")}</small></article>`;
	}).join("");
	panel.innerHTML = `${arsenalTabs()}<div class="logistics-intro">${icon("armor", 28)}<div><h3>У комплекта есть цена и характер.</h3><p>Тяжёлая броня повышает защиту, вместительный рюкзак удержит больше находок. Вес удлиняет путь и расход; износ ослабляет предмет. Сравни итоговый комплект в личном деле бойца.</p></div></div><div class="section-head"><h2>Склад снаряжения <span class="muted">/ ${state.gearItems.length}</span></h2><button class="text-button" data-page="raids">К бойцам →</button></div>${items ? `<div class="logistics-grid">${items}</div>` : '<div class="empty">Отдельных предметов пока нет. Собери лёгкую броню или рюкзак ниже, затем выдай бойцу.</div>'}<div class="section-head"><h2>Сборка по чертежам</h2><button class="text-button" data-action="open-discoveries">Постоянные открытия →</button></div><div class="logistics-grid">${recipes}</div>`;
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
	return `<aside class="weapon-detail"><span class="eyebrow" style="color:${RARITY_COLORS[def.rarity]}">${RARITY_LABELS[def.rarity]} · ${CATEGORY_LABELS[def.category]}</span><h2>${e(def.name)}</h2>${weaponBuildArt(weapon)}${weaponReadiness(weapon)}<p>${e(def.description)}</p>${preservedTuning(weapon)}<div class="weapon-role"><strong>${e(role.label)}</strong><p>${e(role.description)}</p><div class="loadout-stats"><span>Вес ${stats.weight.toFixed(2)} кг</span><span>Патроны ×${(stats.ammoMultiplier * role.ammoMultiplier).toFixed(2)}</span><span>Модулей ${Object.keys(weapon.modules).length} / 8</span></div></div><div class="detail-row"><span>Мощность</span><strong>${stats.power}</strong></div><div class="detail-row"><span>Эргономика</span><strong>${Math.round(stats.ergonomics)}</strong></div><div class="detail-row"><span>Отдача · ниже лучше</span><strong>${Math.round(stats.recoil)}</strong></div><div class="detail-row"><span>Надёжность</span><strong>${Math.round(stats.reliability)}%</strong></div><div class="detail-row"><span>Состояние</span><strong>${Math.round(weapon.durability)}%</strong></div><div class="health-track"><i style="width:${weapon.durability}%"></i></div>${issues.length ? `<p class="risk-note">${issues.map(e).join(" · ")}</p>` : ""}<button class="button bench-entry" data-action="open-bench" data-id="${weapon.id}">${icon("scrap", 18)} Открыть оружейный верстак</button><div class="detail-row"><span>Выдано</span><strong>${owner ? e(owner.name) : "На складе"}</strong></div><div class="weapon-assign">${owner ? `<button class="button ghost" data-scav="${owner.id}">${icon("people", 16)} Личное дело: ${e(owner.name)}</button>` : `<label class="field-label">Выдать бойцу<select data-assign-weapon="${weapon.id}" aria-label="Выдать ${e(def.name)} бойцу"><option value="">Выбери бойца</option>${state.scavs.filter((scav) => scav.status !== "raiding").map((scav) => `<option value="${scav.id}">${e(scav.name)}${scav.weaponInstanceId ? " · заменить ствол" : " · без оружия"}</option>`).join("")}</select></label>`}</div><div class="detail-actions"><button class="button secondary" data-action="repair" data-id="${weapon.id}" ${busy || !needsWeaponRepair(weapon) || !canAfford(repair) ? "disabled" : ""}>Ремонт сборки · ${costLabel(repair)}</button><small class="cost-reason" data-weapon-cost="${weapon.id}-repair">${busy ? "Оружие в рейде" : !needsWeaponRepair(weapon) ? "Ремонт не нужен" : costReason(repair)}</small><button class="button ghost" data-action="sell" data-id="${weapon.id}" ${liquidationReason ? "disabled" : ""} title="${e(liquidationReason ?? "Продажа вместе с установленными модулями")}">Продать сборку · ${n(getWeaponSaleValue(weapon))} ₽</button><button class="button ghost" data-action="recycle-weapon" data-id="${weapon.id}" ${liquidationReason ? "disabled" : ""} title="${e(liquidationReason ?? "Уничтожить сборку и модули, получить материалы")}">Утилизация сборки · ${getWeaponRecycleYield(weapon)} дет.</button><small class="quote-note" data-recycle-note>${e(liquidationReason ?? "Продажа и утилизация удалят всю сборку с модулями. Чтобы сохранить модули, используй верстак")}</small></div></aside>`;
}
function showSettings() {
	document.querySelector("#modal-root")!.innerHTML =
		`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><h2 id="settings-title">Твоё дело — при тебе.</h2><p>Прогресс хранится в этом браузере. Перед сменой устройства экспортируй сохранение. За отсутствие учитывается до 8 часов стройки, пополнения резерва, работы назначенных бойцов, лечения и рейдов по постоянным приказам. Рубли и припасы пополняются до предела базы.</p><p>Автовыходы повторяются офлайн до выбранной глубины и нехватки ресурсов, здоровья или исправного оружия. Ручная экспедиция остановится в точке связи до твоего приказа. Они несут риск потери бойца и ствола. Останови постоянный приказ в карточке дикого, чтобы отменить будущие выходы.</p>${protectedSave ? '<p class="order-risk">Исходный файл не удалось прочитать. Он остаётся в браузере без изменений; автоматическое сохранение временной сессии отключено. Скачай исходный файл и импортируй корректное сохранение.</p>' : ""}<p>Для назначения на работу перетащи бойца на комнату: мышью — за портрет или фигурку, на телефоне — за значок рядом с портретом. Кнопка «Назначить» рядом с портретом позволяет выбрать комнату с клавиатуры; Tab переключает комнаты, Enter назначает, Esc отменяет. Для выхода в рейд сначала освободи работника.</p><p>Начни с «Дворов»: выбери бойца и оружие, отправь на первый этап. После точки связи эвакуируйся или выбери бонус и путь дальше. Чертежи и память маршрутов сохраняются после потерь; рубли и найденные предметы попадут на базу при эвакуации.</p><div class="detail-actions"><button class="button secondary" data-action="export">${protectedSave ? "Скачать исходный файл" : "Экспорт"}</button><button class="button ghost" data-action="import">Импорт</button></div><input type="file" accept="application/json,.json" id="save-file" hidden><div class="save-note">Сохранение восстанавливает отряд, физические сборки и запасные модули с их состоянием, комплекты, чертежи, приказы и текущие этапы. Ручные экспедиции ждут твоего приказа в точке связи. Импорт заменит текущий прогресс после проверки файла.</div><button class="button ghost" style="width:100%;margin-top:20px" data-action="close-modal">Продолжить</button></section></div>`;
	focusModal();
}
function showAutoRaidOrder(scavId: string) {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return;
	const map = MAP_BY_ID[selectedMap]!;
	document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal auto-raid-modal" role="dialog" aria-modal="true" aria-labelledby="auto-title"><span class="eyebrow">Постоянный приказ · ${e(scav.name)}</span><h2 id="auto-title">Автовыходы: ${e(map.name)}</h2><div class="order-brief"><span>${icon("repeat", 19)} Повторять выбранный маршрут</span><span>${icon("medicine", 19)} Выходить при ${scav.autoRaid.minHealth} / 100 здоровья</span><span>${icon("backpack", 19)} Эвакуироваться на глубине ${scav.autoRaid.maxDepth} / 3</span><span>${icon("time", 19)} Работать и офлайн · до 8 часов</span></div><p>Дикий будет повторять маршрут до глубины ${scav.autoRaid.maxDepth}, затем эвакуируется автоматически. Приказ действует, пока хватает рублей на логистику, патронов, разведданных и исправного снаряжения. Он работает и офлайн; ручные выходы продолжаются только после твоего выбора.</p><p class="order-risk">Каждый повтор несёт риск: можно потерять дикого и его оружие. Броня снижает потери, но не гарантирует возвращение.</p><p>Кнопка «Остановить автовыходы» отменяет будущие выходы. Текущая экспедиция останется в пути с исходной глубиной эвакуации.</p><div class="detail-actions"><button class="button" data-action="confirm-auto" data-id="${scav.id}" data-route="${map.id}" data-min-health="${scav.autoRaid.minHealth}">${scav.autoRaid.enabled ? "Изменить приказ" : "Включить автовыходы"}</button><button class="button ghost" data-action="close-modal">Назад к бойцу</button></div></section></div>`;
	focusModal();
}
document.addEventListener("click", (event) => {
	if ((event.target as Element).closest("#tool-root, #inspector-root, #modal-root, #command-dock, #context-shade, button, select, input, summary")) holdWorldInput();
	const artSlot = (event.target as Element).closest<SVGElement>('.workbench-stage [data-module-slot]');
	if (artSlot?.dataset.moduleSlot) { selectBenchSlot(artSlot.dataset.moduleSlot as ModuleSlot); return; }
	const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
		"button"
	);
	if (!target || target.disabled) {
		if ((event.target as HTMLElement).classList.contains("inspector-backdrop")) closeInspector();
		if ((event.target as HTMLElement).classList.contains("modal-backdrop")) closeModal();
		if ((event.target as HTMLElement).classList.contains("tool-backdrop")) closeTools();
		if ((event.target as HTMLElement).id === "context-shade") closeCommandContext();
		return;
	}
	if (target.dataset.workerHandle) { beginKeyboardAssignment(target.dataset.workerHandle); return; }
	if (target.hasAttribute("data-worker-cancel")) { cancelWorkerPlacement(true, true); return; }
	if (target.dataset.workerRoom && workerPlacement?.mode === "keyboard") {
		const reason = getWorkerAssignmentReason(state, workerPlacement.scavId, target.dataset.workerRoom);
		if (reason) { workerPlacement.roomId = target.dataset.workerRoom; workerPlacement.reason = reason; paintWorkerPlacement(); toast(reason, false); return; }
		assignPlacedWorker(workerPlacement.scavId, target.dataset.workerRoom); return;
	}
	if (target.dataset.scav) { openInspector(target.dataset.scav); return; }
	if (target.dataset.shelterRoom) { openShelterRoom(target.dataset.shelterRoom); return; }
	if (target.dataset.roomContextTab) { roomContextTab = target.dataset.roomContextTab as typeof roomContextTab; renderCommandBoard(); document.querySelector<HTMLButtonElement>(`[data-room-context-tab="${roomContextTab}"]`)?.focus({ preventScroll: true }); return; }
	if (target.dataset.commandMap) { selectedMap = target.dataset.commandMap; toolOrigin = target; page = "raids"; render(); document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus(); return; }
	if (target.dataset.shelterColumn != null) { openShelterSite(Number(target.dataset.shelterColumn), Number(target.dataset.shelterRow)); return; }
	if (target.dataset.benchSlot) { selectBenchSlot(target.dataset.benchSlot as ModuleSlot); return; }
	if (target.dataset.roomLink) { openRoom(target.dataset.roomLink as BaseRoom); return; }
	if (target.dataset.page) {
		closeInspector();
		toolOrigin = target;
		page = target.dataset.page as Page;
		render();
		if (page !== "home") document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
		return;
	}
	if (target.dataset.view) {
		setView(target.dataset.view as "base" | "map");
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
	const id = target.dataset.id ?? "";
	switch (target.dataset.action) {
		case "close-tools": closeTools(); break;
		case "close-context": closeCommandContext(); break;
		case "open-market":
			toolOrigin = target; page = "arsenal"; arsenalTab = "market"; render(); document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus(); break;
		case "build-room": {
			const column = Number(target.dataset.column), row = Number(target.dataset.row);
			const result = buildRoom(state, target.dataset.roomType as ShelterRoomType, column, row);
			if (result.ok) { selectedRoomId = state.shelter.rooms.find((room) => room.column === column && room.row === row)?.id ?? null; selectedShelterSite = null; contextMode = "room"; roomContextTab = "upgrade"; }
			act(result);
			break;
		}
		case "upgrade-room":
			act(upgradeRoom(state, id));
			break;
		case "assign-worker":
			act(assignWorker(state, chosenWorkers.get(id) ?? "", id));
			break;
		case "release-worker":
			act(assignWorker(state, id, null));
			break;
		case "open-work-room":
			openShelterRoom(id);
			break;
		case "set-room-recipe": {
			const repeat = document.querySelector<HTMLInputElement>(`[data-room-repeat="${CSS.escape(id)}"]`)?.checked ?? true;
			roomRepeatPreferences.set(id, repeat);
			act(setRoomRecipe(state, id, target.dataset.recipeId ?? null, repeat));
			break;
		}
		case "stop-room-recipe":
			act(setRoomRecipe(state, id, null, false));
			break;
		case "queue-room-module":
			act(queueModuleProduction(state, id, target.dataset.modelId ?? ""));
			break;
		case "cancel-production": {
			const summary = advance(state); persist();
			const room = state.shelter.rooms.find((item) => item.id === id), job = room?.queue.find((item) => item.id === target.dataset.jobId);
			if (!job) { render(); notifyCompleted(summary); toast("Заказ уже завершён."); break; }
			document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-production-title"><h2 id="cancel-production-title">Отменить производственный заказ?</h2><p>${job.workDone > 0 ? "Работа уже началась: оплаченные материалы и рубли не вернутся." : "Заказ пока не начат. Полная стоимость вернётся, если к моменту отмены он ещё не начнёт работу."} Повторение рецепта выключится; остальные оплаченные заказы останутся.</p><div class="detail-actions"><button class="button danger" data-action="confirm-cancel-production" data-id="${id}" data-job-id="${job.id}">Отменить заказ</button><button class="button ghost" data-action="close-modal">Продолжить работу</button></div></section></div>`;
			focusModal();
			break;
		}
		case "confirm-cancel-production":
			closeModal();
			act(cancelProduction(state, id, target.dataset.jobId ?? ""));
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
			act(installModule(state, id, target.dataset.moduleId ?? ""));
			break;
		case "remove-module":
			act(removeModule(state, id, target.dataset.slot as ModuleSlot));
			break;
		case "assemble-weapon": {
			const existing = new Set(state.weapons.map((weapon) => weapon.id));
			const result = assembleWeapon(state, id);
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
			act(queueModuleProduction(state, selectedProductionWorkshop()?.id ?? "", id));
			break;
		case "repair-module":
			act(repairModule(state, id));
			break;
		case "disassemble-weapon": {
			const weapon = state.weapons.find((item) => item.id === id); if (!weapon) break;
			document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="disassemble-title"><span class="eyebrow">Сохранить физические детали</span><h2 id="disassemble-title">Разобрать ${e(getWeaponDefinition(weapon).name)} на модули?</h2><p>Все ${Object.keys(weapon.modules).length} установленных деталей вернутся на склад со своим состоянием. Сборка исчезнет; её нужно будет собрать заново со ствольной коробки. Если оружие выдано бойцу, его оружейный слот освободится.</p><div class="detail-actions"><button class="button secondary" data-action="confirm-disassemble" data-id="${id}">Разобрать на модули</button><button class="button ghost" data-action="close-modal">Сохранить сборку</button></div></section></div>`;
			focusModal();
			break;
		}
		case "confirm-disassemble":
			closeModal();
			act(disassembleWeapon(state, id));
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
			act(target.dataset.kind === "sale" ? sellModule(state, id) : recycleModule(state, id));
			break;
		case "review-decisions":
			closeInspector();
			page = "raids";
			render();
			document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
			document.querySelector<HTMLButtonElement>('[data-action="run-perk"], [data-action="extract"]')?.focus({ preventScroll: true });
			break;
		case "run-perk": {
			selectedPerks.set(id, target.dataset.perk as RunPerk);
			render();
			const scope = selectedScav ? document.querySelector("#inspector-root") : document.querySelector("#expedition-alerts");
			scope?.querySelector<HTMLButtonElement>(`[data-action="run-perk"][data-id="${CSS.escape(id)}"][data-perk="${CSS.escape(target.dataset.perk ?? "")}"]`)?.focus({ preventScroll: true });
			break;
		}
		case "continue-expedition": {
			const perk = selectedPerks.get(id);
			if (!perk) { toast("Выбери бонус маршрута.", false); break; }
			act(continueExpedition(state, id, target.dataset.branch as ExpeditionBranch, perk));
			selectedPerks.delete(id);
			if (!selectedScav) focusScavOrTool(state.raids.find((raid) => raid.id === id)?.scavId ?? "");
			break;
		}
		case "extract": {
			const scavId = state.raids.find((raid) => raid.id === id)?.scavId;
			act(extractRaid(state, id));
			selectedPerks.delete(id);
			if (!selectedScav && scavId) focusScavOrTool(scavId);
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
			act(craftGear(state, id));
			break;
		case "repair-gear":
			act(repairGear(state, id));
			break;
		case "buy-supplies":
			act(buySupplies(state, id));
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
			act(target.dataset.kind === "gear" ? recycleGear(state, id) : recycleWeapon(state, id));
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
			act(setRaidTactic(state, id, target.dataset.tacticValue as RaidTactic));
			break;
		case "inspect-weapon":
			openWorkbench(id);
			break;
		case "gear":
			act(upgradeScavGear(state, id, target.dataset.slot as GearSlot));
			break;
		case "auto-enable":
		case "auto-route":
			showAutoRaidOrder(id);
			break;
		case "confirm-auto":
			closeModal();
			act(setAutoRaid(state, id, target.dataset.route!, Number(target.dataset.minHealth)));
			break;
		case "auto-stop":
			act(setAutoRaid(state, id, null, state.scavs.find((scav) => scav.id === id)?.autoRaid.minHealth ?? 70));
			break;
		case "auto-stop-all": {
			act(stopAllAutoRaids(state));
			break;
		}
		case "dismiss-offline":
			offlineSummary = null;
		renderOfflineSummary();
			break;
		case "dispatch":
			act(dispatchRaid(state, id, selectedMap));
			break;
		case "recruit":
			act(recruitScav(state));
			break;
		case "heal":
			act(healScav(state, id));
			break;
		case "upgrade":
			act(upgradeBase(state, id as BaseRoom));
			break;
		case "repair":
			act(repairWeapon(state, id));
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
			act(sellWeapon(state, id));
			break;
		case "claim":
			act(claimContract(state, id));
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
		case "export": {
			persist();
			const url = URL.createObjectURL(
				new Blob([protectedSave && raw ? raw : saveGame(state)], { type: "application/json" })
			);
			const a = document.createElement("a");
			a.href = url;
			a.download = "prapor-save.json";
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			toast(protectedSave ? "Исходный файл скачан без изменений." : "Сохранение экспортировано.");
			break;
		}
		case "import":
			document.querySelector<HTMLInputElement>("#save-file")!.click();
			break;
	}
});
document.addEventListener("change", async (event) => {
	const target = event.target as HTMLInputElement | HTMLSelectElement;
	if (target.dataset.roomWorker) { chosenWorkers.set(target.dataset.roomWorker, target.value); return; }
	if (target.dataset.roomRepeat) {
		const room = state.shelter.rooms.find((item) => item.id === target.dataset.roomRepeat);
		roomRepeatPreferences.set(target.dataset.roomRepeat, (target as HTMLInputElement).checked);
		if (room?.recipeId) act(setRoomRecipe(state, room.id, room.recipeId, (target as HTMLInputElement).checked));
		return;
	}
	if (target.hasAttribute("data-room-module-slot")) { roomModuleSlot = target.value as typeof roomModuleSlot; renderCommandBoard(); document.querySelector<HTMLSelectElement>('[data-room-module-slot]')?.focus({ preventScroll: true }); return; }
	if (target.hasAttribute("data-room-module-weapon")) { selectedWeapon = target.value; renderCommandBoard(); document.querySelector<HTMLSelectElement>('[data-room-module-weapon]')?.focus({ preventScroll: true }); return; }
	if (target.hasAttribute("data-production-workshop")) { productionWorkshopId = target.value; renderModules(); document.querySelector<HTMLSelectElement>('[data-production-workshop]')?.focus({ preventScroll: true }); return; }
	if (target.hasAttribute("data-bench-weapon")) {
		selectedWeapon = target.value; selectedBenchModule = null; benchPartSearch = "";
		renderWorkbench(); document.querySelector<HTMLSelectElement>('[data-bench-weapon]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-module-slot-filter")) {
		moduleSlotFilter = target.value as typeof moduleSlotFilter;
		renderModules(); document.querySelector<HTMLSelectElement>('[data-module-slot-filter]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-module-rarity-filter")) {
		moduleRarityFilter = target.value as typeof moduleRarityFilter;
		renderModules(); document.querySelector<HTMLSelectElement>('[data-module-rarity-filter]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-craft-for-weapon")) {
		moduleCraftForWeapon = (target as HTMLInputElement).checked;
		renderModules(); document.querySelector<HTMLInputElement>('[data-craft-for-weapon]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-craft-weapon")) {
		selectedWeapon = target.value; renderModules(); document.querySelector<HTMLSelectElement>('[data-craft-weapon]')?.focus({ preventScroll: true }); return;
	}
	if (target.hasAttribute("data-inspector-map")) { selectedMap = target.value; render(); }
	if (target.dataset.assignWeapon && target.value) act(equipWeapon(state, target.value, target.dataset.assignWeapon));
	if (target.dataset.equip)
		act(equipWeapon(state, target.dataset.equip, target.value || null));
	if (target.dataset.equipGear) act(equipGear(state, target.dataset.equipGear, target.dataset.slot as GearSlot, target.value || null));
	if (target.dataset.assignGear && target.value) act(equipGear(state, target.value, target.dataset.slot as GearSlot, target.dataset.assignGear));
	if (target.dataset.ammoType) act(setLoadoutOption(state, target.dataset.ammoType, "ammoType", target.value));
	if (target.dataset.medkit) act(setLoadoutOption(state, target.dataset.medkit, "medkit", (target as HTMLInputElement).checked));
	if (target.dataset.autoDepth) act(setAutoRaidDepth(state, target.dataset.autoDepth, Number(target.value)));
	if (target.dataset.tactic)
		act(setRaidTactic(state, target.dataset.tactic, target.value as RaidTactic));
	if (target.dataset.autoHealth) {
		const scav = state.scavs.find((item) => item.id === target.dataset.autoHealth);
		if (scav) act(setAutoRaid(state, scav.id, scav.autoRaid.enabled ? scav.autoRaid.mapId : null, Number(target.value)));
	}
	if (target.id === "save-file") {
		const file = (target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 1_000_000) {
			toast("Файл слишком большой.", false);
			return;
		}
		try {
			const imported = loadGameWithSummary(await file.text());
			if (!imported) {
				toast("Сохранение повреждено или имеет другую версию.", false);
				return;
			}
			const old = state;
			const oldProtected = protectedSave;
			cancelWorkerPlacement();
			state = imported.state;
			protectedSave = false;
			if (!persist()) {
				state = old;
				protectedSave = oldProtected;
				toast("Импорт отменён: браузер не смог записать сохранение.", false);
				return;
			}
			closeModal();
			closeInspector();
			page = "home";
			contextMode = "overview";
			selectedShelterSite = null;
			selectedRoomId = state.shelter.rooms[0]?.id ?? null;
			selectedBenchModule = null;
			productionWorkshopId = null;
			selectedPerks.clear(); chosenWorkers.clear(); roomRepeatPreferences.clear();
			toolOrigin = null; commandOrigin = null;
			offlineSummary = imported.summary.elapsedMs >= 60_000 || imported.summary.completedCount ? imported.summary : null;
			selectedWeapon = state.weapons[0]?.id ?? "";
			selectedMap = MAPS[0]!.id;
			render();
			toast("Сохранение восстановлено.");
		} catch {
			toast("Не удалось прочитать сохранение.", false);
		}
	}
});
document.addEventListener("input", (event) => {
	const input = event.target as HTMLInputElement;
	if (input.hasAttribute("data-room-module-search")) {
		roomModuleSearch = input.value; const caret = input.selectionStart; renderCommandBoard();
		const replacement = document.querySelector<HTMLInputElement>("[data-room-module-search]"); replacement?.focus({ preventScroll: true });
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
	if ((workerPlacement || crewPointer) && event.key === "Escape") { event.preventDefault(); cancelWorkerPlacement(true, true); return; }
	if (workerPlacement?.mode === "keyboard" && event.key === "Tab") {
		const controls = Array.from(document.querySelectorAll<HTMLButtonElement>("#worker-room-targets button, #worker-placement button")).filter((node) => node.getClientRects().length > 0);
		const first = controls[0], last = controls.at(-1);
		if (first && last && event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLButtonElement))) { event.preventDefault(); last.focus({ preventScroll: true }); }
		else if (first && last && !event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLButtonElement))) { event.preventDefault(); first.focus({ preventScroll: true }); }
		return;
	}
	const dialog = document.querySelector<HTMLElement>("#modal-root .modal") ?? document.querySelector<HTMLElement>(".inspector") ?? (page !== "home" ? document.querySelector<HTMLElement>(".tool-window") : window.innerWidth <= 850 && contextMode !== "overview" ? document.querySelector<HTMLElement>("#command-dock") : null);
	if (!dialog) return;
	if (event.key === "Escape") {
		if (event.target instanceof HTMLSelectElement) return;
		event.preventDefault();
		if (document.querySelector("#modal-root .modal")) closeModal(); else if (selectedScav) closeInspector(); else if (page !== "home") closeTools(); else closeCommandContext();
	}
	if (event.key === "Tab") {
		const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not([hidden]), a[href], summary, [tabindex="0"]')).filter((node) => node.getClientRects().length > 0);
		const first = controls[0], last = controls.at(-1);
		if (first && last && event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
		else if (first && last && !event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
	}
});
function setView(view: "base" | "map") {
	if (worldView !== view) cancelWorkerPlacement(false, true);
	worldView = view;
	world?.setView(view);
	document
		.querySelectorAll<HTMLButtonElement>("[data-view]")
		.forEach((button) =>
			((button.classList.toggle("active", button.dataset.view === view)), (button.setAttribute("aria-pressed", String(button.dataset.view === view))))
		);
	document.querySelector("#scene-hint")!.textContent = view === "base" ? "Нажми на комнату или бойца" : "Нажми на сектор, чтобы выбрать маршрут";
	(document.querySelector(".room-shortcuts") as HTMLElement).hidden = view === "map";
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
		roomProduction: Object.fromEntries(state.shelter.rooms.map((room) => [room.id, getRoomProductionState(state, room)])),
		selectedScavId: selectedScav,
		selectedMapId: selectedMap,
	}),
	(id) => {
		if (!canWorldInteract()) return;
		selectedMap = id;
		page = "raids";
		render();
		document.querySelector<HTMLButtonElement>('[data-action="close-tools"]')?.focus();
	},
	{ canInteract: canWorldInteract,
		canDrag: canWorldDrag,
		getAssignmentReason: (scavId, roomId) => getWorkerAssignmentReason(state, scavId, roomId),
		onAssignScav: assignPlacedWorker,
		onDragState: onWorldDragState,
		onRoom: (room) => { if (canWorldInteract()) openRoom(room); },
		onScav: (id) => { if (canWorldInteract()) openInspector(id); },
		onShelterRoom: (id) => { if (canWorldInteract()) openShelterRoom(id); },
		onBuildSite: ({ column, row }) => { if (canWorldInteract()) openShelterSite(column, row); } }
);
let ticks = 0;
const readyContracts = () =>
	CONTRACTS.filter(
		(contract) =>
			!state.claimedContracts.includes(contract.id) &&
			!getContractLockReason(state, contract) &&
			getContractProgress(state, contract) >= contract.target
	).length;
const rosterStatus = () => `${state.scavs.map((scav) => `${scav.id}:${scav.status}:${scav.autoRaid.enabled}:${scav.assignment}`).join(";")}|${state.raids.map((raid) => `${raid.id}:${raid.expedition?.stage}:${raid.expedition?.status}`).join(";")}`;
const shelterStatus = () => state.shelter.rooms.map((room) => `${room.id}:${room.status}:${room.level}:${room.queue.map((job) => job.id).join(",")}:${room.workerIds.join(",")}:${room.recipeId}:${room.repeat}:${room.pending}:${room.cycles}`).join(";");
function interacting() {
	return Boolean(workerPlacement || crewPointer) || document.activeElement?.tagName === "SELECT" || document.activeElement?.tagName === "INPUT" || Boolean(document.querySelector("#modal-root .modal"));
}
function refreshAfterAdvance() {
	if (interacting()) deferredRender = true;
	else render();
}
function notifyCompleted(summary: AdvanceSummary) {
	if (summary.completedCount > 1) toast(`Завершено выходов: ${n(summary.completedCount)}. Добыча в арсенале, подробности в журнале.`);
	else if (summary.completedCount === 1) {
		const report = summary.completed[0];
		if (report) toast(`${report.scavName}: ${report.description}`, report.success);
	}
}
const simulationTimer = setInterval(() => {
	if (document.hidden) return;
	const beforeLevel = state.level,
		beforeStatus = rosterStatus(),
		beforeShelter = shelterStatus(),
		beforeContracts = readyContracts();
	const summary = advance(state);
	hud();
	if (
		summary.completedCount ||
		state.level !== beforeLevel ||
		rosterStatus() !== beforeStatus ||
		shelterStatus() !== beforeShelter ||
		readyContracts() !== beforeContracts
	) {
		refreshAfterAdvance();
		notifyCompleted(summary);
	}
	if (deferredRender && !interacting()) render();
	if (++ticks % 5 === 0) persist();
}, 1000);
document.addEventListener("visibilitychange", () => {
	if (document.hidden) { cancelWorkerPlacement(false, true); persist(); }
	else {
		const summary = advance(state);
		if (summary.elapsedMs >= 60_000 || summary.completedCount) offlineSummary = summary;
		refreshAfterAdvance();
		persist();
	}
});
window.addEventListener("pagehide", persist);
window.addEventListener("beforeunload", persist);
let contextIsMobile = window.innerWidth <= 850;
const responsiveContext = () => {
	cancelWorkerPlacement(false, true);
	const mobile = window.innerWidth <= 850;
	if (mobile === contextIsMobile) return;
	contextIsMobile = mobile;
	renderCommandBoard(); setOverlayState();
};
window.addEventListener("resize", responsiveContext);
import.meta.hot?.dispose(() => {
	cancelWorkerPlacement();
	persist();
	clearInterval(simulationTimer);
	clearTimeout(toastTimer);
	if (workerRefreshTimer != null) clearTimeout(workerRefreshTimer);
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
});
if (protectedSave) {
	toast(
		"Исходный прогресс не перезаписан. Скачай его в настройках и импортируй корректный файл.",
		false
	);
}
