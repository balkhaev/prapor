import "./style.css";
import {
	ATTACHMENT_LABELS,
	BASE_ROOM_LABELS,
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
	craftModule,
	getModuleCraftReason,
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
} from "./game/engine";
import { GEAR_LABELS, MAX_GEAR_LEVEL, TACTICS, type GearSlot, type RaidTactic } from "./game/operations";
import { createWorld } from "./scene";
import { gunArt, scavPortrait } from "./art";
import { weaponBuildArt, moduleArt } from "./armory-art";

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
const portrait = `<svg viewBox="0 0 54 64" aria-hidden="true"><path fill="#b1b681" d="M8 64V49l12-7h15l12 7v15"/><path fill="#1a2216" d="M8 52h11l8 9 9-9h11v12H8"/><path fill="#b99f72" d="M17 19h22v16l-7 10H23l-6-10"/><path fill="#384229" d="M12 19 17 8h22l6 11v4H12"/><path fill="#666d43" d="M15 16h26v5H15"/><path fill="#232b1b" d="M19 28h5v2h-5m11-2h5v2h-5M21 35h13l-2 4h-8"/><path fill="#877349" d="M26 28h3v7h-3"/><path fill="#d2b665" d="M25 11h6v3h-6"/></svg>`;

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
let focusRoom: BaseRoom | null = null;
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
const app = document.querySelector<HTMLDivElement>("#app")!;
const names: Record<Page, string> = {
	home: "Убежище",
	raids: "Рейды",
	arsenal: "Арсенал",
	base: "Развитие базы",
	contracts: "Контракты",
	journal: "Журнал",
};
app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">П</div><div><strong>ПРАПОР</strong><small>СВОИ ЛЮДИ. СВОЁ ДЕЛО.</small></div></div><div class="nav-label">Оперативный штаб</div><nav class="nav" aria-label="Разделы игры">${(Object.keys(names) as Page[]).map((id) => `<button data-page="${id}" aria-label="${names[id]}">${icon(id)}<span>${id === "base" ? "База" : names[id]}</span>${id === "raids" ? '<b class="badge" id="raid-badge">0</b>' : ""}</button>`).join("")}</nav><div class="base-status"><i class="status-dot"></i>База на связи<span class="muted" id="passive-note">Мастерская работает</span></div><footer>IDLE-РОГУЛАЙТ · 0.5</footer></aside><main class="main"><header class="topbar"><div class="level"><span class="eyebrow">Репутация</span><strong id="level-label"></strong><div class="xp-track"><i id="xp-fill"></i></div></div><div class="resources">${[["money", "Рубли"], ["ammo", "Патроны"], ["medicine", "Медикаменты"], ["scrap", "Детали"], ["intel", "Разведданные"]].map(([key, label]) => `<div class="resource" title="${label}">${icon(key!)}<div><label>${label}</label><strong id="res-${key}"></strong></div></div>`).join("")}</div><button class="settings" data-action="settings" aria-label="Сохранение и помощь">${icon("settings")}</button></header><div class="content"><div id="page-head" class="page-head"></div><div id="offline-summary"></div><div id="expedition-alerts"></div><div id="hero" class="hero-grid"><section class="world-card"><div class="world-head"><div class="view-switch" aria-label="Вид сцены"><button class="active" data-view="base" aria-pressed="true">${icon("home", 15)} Убежище</button><button data-view="map" aria-pressed="false">${icon("raids", 15)} Карта секторов</button></div><span class="mono world-coordinate">БАЗА 07 · СЕВЕР</span></div><div id="world" aria-label="Двумерная сцена убежища и карта рейдов"></div><div class="world-bottom"><span><i class="status-dot"></i><span id="scene-hint">Нажми на комнату или бойца</span></span><span id="world-raid-note">ОТРЯД НА БАЗЕ</span></div><div class="room-shortcuts" aria-label="Комнаты базы">${(Object.keys(BASE_ROOM_LABELS) as BaseRoom[]).map((room) => `<button class="room-shortcut" data-room-link="${room}">${icon(room === "workshop" ? "scrap" : room === "medbay" ? "medicine" : room === "radio" ? "intel" : "arsenal", 15)}${BASE_ROOM_LABELS[room]}</button>`).join("")}</div></section><aside class="briefing"><div class="briefing-top"><div class="portrait">${portrait}</div><div><span class="eyebrow">На связи</span><strong>Прапор</strong></div><span class="radio-live">● ЭФИР</span></div><h2 id="briefing-title">Каждому — ствол.<br>Каждому — маршрут.</h2><p id="briefing-copy"></p><button class="button" data-page="raids">Подготовить выход ${icon("arrow", 17)}</button><div class="briefing-note">База работает и офлайн · до 8 часов</div></aside></div><div id="panel"></div><div class="footer-line"><span id="save-status">ПРОГРЕСС СОХРАНЯЕТСЯ НА ЭТОМ УСТРОЙСТВЕ</span><span>МАСТЕРСКАЯ РАБОТАЕТ И БЕЗ ТЕБЯ</span></div></div></main></div><div id="toast" role="status" aria-live="polite" hidden></div><div id="inspector-root"></div><div id="modal-root"></div>`;
const panel = document.querySelector<HTMLDivElement>("#panel")!;
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
		if (resource) resource.title = `${supplyName(key)}: ${n(state.supplies[key])} / ${capacities[key]}. ${key === "medicine" ? "Пополнение — в добыче и снабжении." : state.supplies[key] >= capacities[key] ? "Склад заполнен; производство ждёт расхода." : "База пополняет запас до вместимости."}`;
	}
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
		const reason = getModuleCraftReason(state, node.dataset.id ?? ""); node.disabled = Boolean(reason);
		const note = document.querySelector<HTMLElement>(`[data-module-craft-note="${node.dataset.id}"]`); if (note) note.textContent = reason ?? "Новый экземпляр появится в запасе";
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
function scavCard(scav: Scav) {
	const raid = state.raids.find((r) => r.scavId === scav.id);
	const weapon = state.weapons.find((w) => w.id === scav.weaponInstanceId);
	const personality = PERSONALITY_BY_ID[scav.personality]!;
	const ready = !dispatchBlock(scav);
	const waiting = raid?.expedition?.status === "choice";
	return `<button class="scav-card ${raid ? "on-mission" : ""} ${selectedScav === scav.id ? "selected" : ""}" data-scav="${scav.id}" aria-label="${waiting ? "Нужен приказ: " : "Открыть бойца "}${e(scav.name)}"><span class="scav-card-top"><span class="scav-avatar">${scavPortrait(scav.personality, scav.name)}</span><span class="scav-identity"><strong>${e(scav.name)}</strong><span>${e(personality.name)} · ур. ${scav.level}</span></span><span class="scav-state ${waiting ? "decision" : raid ? "away" : ready ? "ready" : "waiting"}">${waiting ? "Приказ" : raid ? "В рейде" : ready ? "Готов" : scav.health < 25 ? "Ранен" : "На базе"}</span></span><span class="scav-card-body"><span class="scav-weapon">${icon("arsenal", 17)} ${weapon ? e(getWeaponDefinition(weapon).name) : "Без оружия"}</span><span class="scav-health"><span>Здоровье <b data-health="${scav.id}">${Math.floor(scav.health)} / 100</b></span><span class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></span></span>${raid ? `<span class="scav-raid"><span><b>${e(MAP_BY_ID[raid.mapId]!.name)}${raid.expedition ? ` · этап ${raid.expedition.stage}/3` : ""}</b><strong data-raid-time="${raid.id}">${waiting ? "ПРИКАЗ" : seconds((raid.endsAt - Date.now()) / 1000)}</strong></span><span class="progress"><i data-raid-progress="${raid.id}"></i></span><small data-raid-phase="${raid.id}">${e(getRaidPhase(raid, Date.now()).label)}</small></span>` : `<span class="scav-idle-note">${scav.autoRaid.enabled ? `${icon("repeat", 13)} ${e(MAP_BY_ID[scav.autoRaid.mapId]!.name)} · глубина ${scav.autoRaid.maxDepth}` : `${icon("backpack", 13)} ${getLoadoutStats(state, scav).capacity.toFixed(1)} ед. груза · ${getLoadoutStats(state, scav).weight.toFixed(1)} кг экип.`}</span>`}</span><span class="scav-card-bottom"><span>${waiting ? raid.expedition!.stage >= 3 ? "Вернуть бойца с добычей →" : "Эвакуация или ещё один этап →" : "Снаряжение и приказ"}</span>${icon("arrow", 16)}</span></button>`;
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
	if (inspectorOrigin?.isConnected) inspectorOrigin.focus();
	else (document.querySelector<HTMLButtonElement>(`[data-scav="${CSS.escape(closedId ?? "")}"]`) ?? document.querySelector<HTMLButtonElement>('.nav button.active'))?.focus({ preventScroll: true });
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
	root.innerHTML = `<div class="inspector-backdrop"><aside class="inspector" role="dialog" aria-modal="true" aria-labelledby="scav-title"><div class="inspector-head"><div><span class="eyebrow">Личное дело · ур. ${scav.level}</span><h2 id="scav-title">${e(scav.name)}</h2></div><button class="icon-button" data-action="close-inspector" data-focus-key="close" aria-label="Закрыть бойца">×</button></div><div class="inspector-scroll">${raid?.expedition?.status === "choice" ? activeRaidPanel(raid) : ""}<div class="scav-profile"><div class="inspector-portrait">${scavPortrait(scav.personality, scav.name)}</div><div><strong>${e(PERSONALITY_BY_ID[scav.personality]!.name)}</strong><p>${e(PERSONALITY_BY_ID[scav.personality]!.description)}</p><div class="profile-stats"><span>Бой <b>${scav.combat}</b></span><span>Поиск <b>${scav.scouting}</b></span><span>Выходы <b>${scav.raids}</b></span></div></div></div><div class="health-panel"><div><span>Здоровье</span><strong data-health="${scav.id}">${Math.floor(scav.health)} / 100</strong></div><div class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></div><div class="health-panel-bottom"><span data-heal-note="${scav.id}">Медблок восстанавливает бесплатно</span><button class="button ghost small" data-action="heal" data-id="${scav.id}" data-focus-key="heal" ${raid || scav.health >= 100 || state.supplies.medicine < medicineCost(scav) ? "disabled" : ""}>${icon("medicine", 15)} Лечить · ${medicineCost(scav)} мед.</button></div></div>${raid && raid.expedition?.status !== "choice" ? activeRaidPanel(raid) : ""}<section class="inspector-section"><div class="inspector-section-title"><h3>Оружие</h3>${weapon ? `<button class="text-button" data-action="inspect-weapon" data-id="${weapon.id}" data-focus-key="weapon-detail">Оружейный верстак →</button>` : ""}</div>${weapon ? `<div class="equipped-art" style="--rarity:${RARITY_COLORS[getWeaponDefinition(weapon).rarity]}">${weaponBuildArt(weapon)}<span><b>${e(getWeaponDefinition(weapon).name)}</b><small>Мощь ${getWeaponPower(weapon)} · состояние ${Math.round(weapon.durability)}%</small>${weaponReadiness(weapon)}</span></div>` : '<p class="field-hint">Для выхода нужен исправный ствол из арсенала.</p>'}<label class="field-label">${raid ? "Оружие занято в рейде" : "Выдать оружие"}<select aria-label="Оружие для ${e(scav.name)}" data-equip="${scav.id}" data-focus-key="weapon" ${raid ? "disabled" : ""}><option value="">Без оружия</option>${state.weapons.filter((w) => !state.scavs.some((s) => s.id !== scav.id && s.weaponInstanceId === w.id)).map((w) => `<option value="${w.id}" ${w.id === scav.weaponInstanceId ? "selected" : ""}>${e(getWeaponDefinition(w).name)} · ${Math.round(w.durability)}%${getWeaponStats(w).ready ? "" : " · не собрано"}</option>`).join("")}</select></label></section><section class="inspector-section"><h3>${raid ? "Тактика следующего выхода" : "Тактика"}</h3><div class="tactics" role="group" aria-label="Тактика для ${e(scav.name)}">${(Object.keys(TACTICS) as RaidTactic[]).map((tactic) => `<button class="${tactic === scav.tactic ? "active" : ""}" data-action="tactic" data-id="${scav.id}" data-tactic-value="${tactic}" data-focus-key="tactic-${tactic}" aria-pressed="${scav.tactic === tactic}">${TACTICS[tactic].label}</button>`).join("")}</div><p class="field-hint">${e(TACTICS[scav.tactic].description)}</p></section>${loadoutEditor(scav, trainingExpanded)}${sortiePreview(scav)}<details class="order-section" ${autoExpanded ?? scav.autoRaid.enabled ? "open" : ""}><summary data-focus-key="order-summary">${icon("repeat", 18)}<span>Постоянный приказ<small>${scav.autoRaid.enabled ? `${e(MAP_BY_ID[scav.autoRaid.mapId]!.name)} · включён` : "Повторять выходы автоматически"}</small></span><b>${scav.autoRaid.enabled ? "ВКЛ" : "+"}</b></summary>${autoRaidCard(scav)}</details></div>${inspectorFooter(scav, raid)}</aside></div>`;
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
	(document.querySelector(".shell") as HTMLElement).inert = modalOpen || drawerOpen;
	const drawer = document.querySelector<HTMLElement>(".inspector"); if (drawer) drawer.inert = modalOpen;
	document.body.classList.toggle("overlay-open", modalOpen || drawerOpen);
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
	focusRoom = room;
	page = "base";
	render();
	window.scrollTo(0, 0);
	const card = document.querySelector<HTMLElement>(`[data-room="${room}"]`);
	card?.focus({ preventScroll: true });
	card?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
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
	node.innerHTML = `<aside class="offline-summary"><div class="offline-icon">${icon("time", 26)}</div><div><span class="eyebrow">С возвращением на базу</span><h3>База была на связи ${elapsed}${offlineSummary.capped ? " · учтены 8 часов" : ""}.</h3><p>Заработано <strong>+${n(offlineSummary.money)} ₽</strong> · завершено выходов <strong>${n(offlineSummary.completedCount)}</strong>. Мастерская пополнила припасы, медблок восстановил диких.</p></div><button class="button ghost small" data-page="journal">Отчёты ${icon("arrow", 13)}</button><button class="dismiss-button" data-action="dismiss-offline" aria-label="Закрыть сводку">×</button></aside>`;
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
		base: "Развивай базу и сохраняй открытия после потерь.",
		contracts: "Репутация строится на выполненных обещаниях.",
		journal: "Кто вышел, кто вернулся и что принёс.",
	};
	document.querySelector("#page-head")!.innerHTML =
		`<div><div class="eyebrow"><span class="page-number">0${Object.keys(names).indexOf(page) + 1} /</span> ${page === "home" ? "УБЕЖИЩЕ ПРАПОРА" : names[page]}</div><h1>${page === "home" ? "Хозяйство под контролем." : names[page]}</h1><p>${captions[page]}</p></div><span class="tag">${icon("time", 13)} <span id="income-status"></span></span>`;
	(document.querySelector("#hero") as HTMLElement).style.display =
		page === "home" || (page === "raids" && showTacticalMap) ? "" : "none";
	document.querySelector("#briefing-title")!.innerHTML = state.scavs.some((scav) => scav.autoRaid.enabled) ? "Люди знают<br>своё дело, брат." : "Каждому — ствол.<br>Каждому — маршрут.";
	document.querySelector("#briefing-copy")!.textContent = state.scavs.some((scav) => scav.autoRaid.enabled) ? "Постоянные приказы повторяют выходы на заданную глубину. Следи за расходом и износом: медблок лечит бойцов, мастерская готовит ограниченный резерв. Дальние этапы приносят больше и рискуют всем рюкзаком." : "Подбери комплект и отправь дикого на первый этап. В точке связи выбери: вернуться с добычей или взять бонус и идти глубже. Открытия останутся у базы даже после потерь.";
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
			)}</div>${operationsBar()}<div class="section-head"><h2>Твои люди <span class="muted">/ ${state.scavs.length}</span></h2><button class="link-button" data-page="raids">Управлять отрядом →</button></div><div class="card-grid scav-grid">${state.scavs.map(scavCard).join("") || '<div class="empty">Отряд пуст. Найми дикого в разделе «Рейды» — первый после потери отряда приходит бесплатно.</div>'}</div><div class="section-head"><h2>Прапор поручил</h2><button class="link-button" data-page="contracts">Все контракты →</button></div><div class="quick-contracts">${
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
	if (page === "base") {
		const descriptions: Record<BaseRoom, string> = {
			workshop: `Пополняет резерв до ${n(getRecoveryAllowance(state))} ₽ со скоростью ${getIncomePerMinute(state)} ₽/мин. Производит патроны и детали в пределах склада.`,
			medbay: `Бесплатно восстанавливает ${((0.04 + state.base.medbay * 0.025) * 60).toFixed(1)} здоровья в минуту. Улучшение ускоряет лечение.`,
			radio: `Мест для диких: ${getScavCapacity(state)}. Пополняет ограниченный запас разведданных, повышает шанс успеха и сокращает путь.`,
			storage: `${getStorageCapacity(state)} мест под оружие, ${getModuleCapacity(state)} свободных модулей. Повышает вместимость запасов и арсенала. Оружие сверх лимита автоматически продаётся при возвращении.`,
		};
		panel.innerHTML = `<div class="card-grid">${(
			Object.keys(BASE_ROOM_LABELS) as BaseRoom[]
		)
			.map((room) => {
				const cost = getUpgradeCost(state, room),
					max = state.base[room] >= MAX_ROOM_LEVEL;
				return `<article class="card room-card ${focusRoom === room ? "focused" : ""}" tabindex="-1" data-room="${room}"><span class="room-level">УР. ${state.base[room]} / ${MAX_ROOM_LEVEL}</span><div class="room-icon">${icon(room === "workshop" ? "scrap" : room === "medbay" ? "medicine" : room === "radio" ? "intel" : "arsenal", 32)}</div><span class="eyebrow">Помещение убежища</span><h3 style="margin-top:10px">${BASE_ROOM_LABELS[room]}</h3><p>${descriptions[room]}</p><div class="progress"><i style="width:${(state.base[room] / MAX_ROOM_LEVEL) * 100}%"></i></div><button class="button secondary" data-action="upgrade" data-id="${room}" ${max || !canAfford(cost) ? "disabled" : ""}>${max ? "Максимальный уровень" : `Улучшить · ${costLabel(cost)}`}</button><small class="cost-reason" data-room-cost="${room}">${max ? "Помещение полностью развито" : costReason(cost)}</small></article>`;
			})
			.join(
				""
			)}</div><div class="raid-instruction">${icon("time", 24)}<div>Работа не останавливается, когда ты уходишь.<br><span class="muted">За отсутствие учитывается до 8 часов: база пополняет резерв и запасы до их пределов, медблок лечит бойцов, постоянные приказы выполняют выходы. Бойцы с постоянным приказом повторяют рейды, пока есть здоровье, патроны, разведданные и исправное оружие. Ручная экспедиция дождётся решения в точке связи; автовыход эвакуируется на заданной глубине. Каждый этап остаётся риском.</span></div></div>${discoveriesSection()}`;
	}
	if (page === "contracts") {
		const contracts = CONTRACTS.filter((contract) => contractFilter === "all" || (contractFilter === "done") === state.claimedContracts.includes(contract.id));
		panel.innerHTML = `<div class="arsenal-toolbar"><div class="filters">${(["open", "done", "all"] as const).map((filter) => `<button data-contract-filter="${filter}" class="${contractFilter === filter ? "active" : ""}">${filter === "open" ? "Поручения" : filter === "done" ? "Выполнены" : "Все"}</button>`).join("")}</div><span class="tag">${state.claimedContracts.length} / ${CONTRACTS.length} ЗАКРЫТО</span></div><div class="contract-brief">${icon("contracts", 22)}<p>Поручения дают рубли, опыт и припасы для следующего выхода. Завершай цепочку: награды открывают новые задания, а репутация — новые сектора.</p></div>${contracts.map(contractCard).join("") || '<div class="empty">Здесь пока нет поручений. Заверши первый контракт и возвращайся.</div>'}`;
	}
	if (page === "journal")
		panel.innerHTML = state.history.length
			? `<div class="section-head"><h2>Последние отчёты · ${state.history.length}</h2><span class="muted">Всего: ${n(state.stats.raidsCompleted)} · нажми отчёт, чтобы открыть маршрут</span></div>${state.history.map(journalCard).join("")}`
			: '<div class="empty">Радио пока молчит.<br>Отправь дикого в первый рейд — здесь появится его отчёт.</div>';
	panel.querySelectorAll<HTMLDetailsElement>("details[data-report]").forEach((node) => { node.open = expandedReports.includes(node.dataset.report); });
	renderInspector();
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
	closeInspector();
	page = "arsenal";
	arsenalTab = "bench";
	selectedWeapon = id;
	selectedBenchModule = null;
	selectedModuleSlot = "optic";
	render();
	window.scrollTo(0, 0);
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
function renderModules() {
	const craftExpanded = panel.querySelector<HTMLDetailsElement>(".module-craft-catalog")?.open;
	const installedExpanded = panel.querySelector<HTMLDetailsElement>(".installed-parts-list")?.open;
	const loose = state.modules.filter(moduleMatches);
	const installed = state.weapons.flatMap((weapon) => MODULE_SLOTS.map((slot) => weapon.modules[slot]).filter((item): item is ModuleInstance => Boolean(item)).filter(moduleMatches).map((item) => ({ item, weapon })));
	const craftWeapon = state.weapons.find((weapon) => weapon.id === selectedWeapon) ?? state.weapons[0];
	const craftInfo = craftWeapon ? RECEIVER_INFO[craftWeapon.weaponId] : null;
	const recipes = MODULE_MODELS.filter((model) => (moduleSlotFilter === "all" || model.slot === moduleSlotFilter) && (moduleRarityFilter === "all" || model.rarity === moduleRarityFilter) && `${model.label} ${model.description}`.toLocaleLowerCase("ru").includes(moduleSearch.toLocaleLowerCase("ru")) && (!moduleCraftForWeapon || !craftInfo || ((model.platforms.includes("*") || model.platforms.includes(craftInfo.platform)) && (model.calibers.includes("*") || model.calibers.includes(craftInfo.caliber)) && (model.slot !== "receiver" || model.weaponId === craftWeapon?.weaponId))));
	panel.innerHTML = `${arsenalTabs()}<div class="module-storage-head"><div><span class="eyebrow">Физические детали · каждый экземпляр сохранён</span><h2>Склад модулей</h2><p>Снимай, меняй и собирай. Износ остаётся с деталью; найденная ствольная коробка становится основой нового оружия.</p></div><span class="tag">${state.modules.length} / ${getModuleCapacity(state)} В ЗАПАСЕ</span></div><div class="module-filters"><label class="field-label">Слот<select data-module-slot-filter aria-label="Фильтр модулей по слоту"><option value="all" ${moduleSlotFilter === "all" ? "selected" : ""}>Все слоты</option>${MODULE_SLOTS.map((slot) => `<option value="${slot}" ${moduleSlotFilter === slot ? "selected" : ""}>${MODULE_SLOT_LABELS[slot]}</option>`).join("")}</select></label><label class="field-label">Редкость<select data-module-rarity-filter aria-label="Фильтр модулей по редкости"><option value="all" ${moduleRarityFilter === "all" ? "selected" : ""}>Любая редкость</option>${Object.keys(RARITY_LABELS).map((rarity) => `<option value="${rarity}" ${moduleRarityFilter === rarity ? "selected" : ""}>${RARITY_LABELS[rarity as keyof typeof RARITY_LABELS]}</option>`).join("")}</select></label><label class="weapon-search module-search">${icon("settings", 18)}<input type="search" data-module-search aria-label="Поиск модулей" placeholder="Название или свойства детали" value="${e(moduleSearch)}"></label></div><div class="section-head"><h2>Свободные детали <span class="muted">/ ${loose.length}</span></h2><button class="text-button" data-arsenal-tab="bench">На верстак →</button></div><div class="module-inventory-grid">${loose.map((item) => moduleInventoryCard(item)).join("") || '<div class="empty compact-empty">Здесь пока нет деталей. Проверь фильтры, сними деталь с оружия или изготовь нужный модуль ниже.</div>'}</div>${installed.length ? `<details class="installed-parts-list" ${installedExpanded ? "open" : ""}><summary>На оружии · ${installed.length} ${icon("arsenal", 17)}</summary><div class="module-inventory-grid">${installed.map(({ item, weapon }) => moduleInventoryCard(item, weapon)).join("")}</div></details>` : ""}<details class="module-craft-catalog" ${craftExpanded ?? (moduleSlotFilter !== "all" || Boolean(moduleSearch)) ? "open" : ""}><summary><span>${icon("scrap", 21)} Изготовление деталей<small>${recipes.length} моделей по выбранным фильтрам · за рубли и детали</small></span><b>+</b></summary><div class="craft-context"><label class="loadout-check"><input type="checkbox" data-craft-for-weapon ${moduleCraftForWeapon ? "checked" : ""}><span>Для текущего оружия<small>${craftWeapon ? e(getWeaponDefinition(craftWeapon).name) : "Нет выбранной сборки"}</small></span></label>${craftWeapon ? `<select data-craft-weapon aria-label="Оружие для фильтра изготовления">${state.weapons.map((gun) => `<option value="${gun.id}" ${gun.id === craftWeapon.id ? "selected" : ""}>${e(getWeaponDefinition(gun).name)}</option>`).join("")}</select>` : ""}</div><p class="field-hint">Штатные детали закрывают недостающие обязательные слоты. Более сложные варианты требуют развитой мастерской; ствольные коробки — открытия оружия.</p><div class="module-inventory-grid">${recipes.map((model) => {
		const reason = getModuleCraftReason(state, model.id);
		return `<article class="module-card recipe-card" style="--rarity:${RARITY_COLORS[model.rarity]}"><span class="eyebrow">${MODULE_SLOT_LABELS[model.slot]} · ${RARITY_LABELS[model.rarity]}</span><div class="module-card-art">${moduleArt(model)}</div><h3>${e(model.label)}</h3><p>${e(model.description)}</p><div class="module-fit"><span>${model.platforms.includes("*") ? "Универсальная платформа" : `Платформа ${e(model.platforms.map(modulePlatformLabel).join(" / "))}`}</span><span>Мастерская ур. ${model.workshopLevel}</span></div><button class="button secondary small" data-action="craft-module" data-id="${model.id}" ${reason ? "disabled" : ""}>Изготовить · ${costLabel(model.craftCost)}</button><small class="quote-note" data-module-craft-note="${model.id}">${e(reason ?? "Новый экземпляр появится в запасе")}</small></article>`;
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
	return `<section id="discoveries"><div class="section-head"><h2>Память отряда <span class="muted">/ ${unlocked} открытий</span></h2></div><div class="logistics-intro">${icon("intel", 26)}<div><h3>Потеря не обнуляет путь.</h3><p>Чертежи и разведанные тропы сохраняются сразу после находки. Тайники открывают грузовую раму, оружейный склад — плитник, разведка — безопасные маршруты. Каждый выбор оставляет след.</p></div></div><div class="research-grid">${Object.entries(BLUEPRINTS).map(([id, discovery]) => {
		const known = state.blueprints.includes(id);
		return `<article class="research-card ${known ? "unlocked" : ""}"><span class="eyebrow">${known ? "✓ Открыто навсегда" : "Пока неизвестно"}</span><h3>${e(discovery.label)}</h3><p>${e(discovery.description)}</p>${known && GEAR_MODELS.some((model) => model.blueprint === id) ? '<button class="button ghost small" data-action="open-equipment">Собрать по чертежу →</button>' : ""}</article>`;
	}).join("")}</div></section>`;
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
		`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><h2 id="settings-title">Твоё дело — при тебе.</h2><p>Прогресс хранится в этом браузере. Перед сменой устройства экспортируй сохранение. За отсутствие учитывается до 8 часов пополнения резерва, запасов, лечения и рейдов по постоянным приказам. Рубли и припасы пополняются до предела базы.</p><p>Автовыходы повторяются офлайн до выбранной глубины и нехватки ресурсов, здоровья или исправного оружия. Ручная экспедиция остановится в точке связи до твоего приказа. Они несут риск потери бойца и ствола. Останови постоянный приказ в карточке дикого, чтобы отменить будущие выходы.</p>${protectedSave ? '<p class="order-risk">Исходный файл не удалось прочитать. Он остаётся в браузере без изменений; автоматическое сохранение временной сессии отключено. Скачай исходный файл и импортируй корректное сохранение.</p>' : ""}<p>Начни с «Дворов»: выбери бойца и оружие, отправь на первый этап. После точки связи эвакуируйся или выбери бонус и путь дальше. Чертежи и память маршрутов сохраняются после потерь; рубли и найденные предметы попадут на базу при эвакуации.</p><div class="detail-actions"><button class="button secondary" data-action="export">${protectedSave ? "Скачать исходный файл" : "Экспорт"}</button><button class="button ghost" data-action="import">Импорт</button></div><input type="file" accept="application/json,.json" id="save-file" hidden><div class="save-note">Сохранение восстанавливает отряд, физические сборки и запасные модули с их состоянием, комплекты, чертежи, приказы и текущие этапы. Ручные экспедиции ждут твоего приказа в точке связи. Импорт заменит текущий прогресс после проверки файла.</div><button class="button ghost" style="width:100%;margin-top:20px" data-action="close-modal">Продолжить</button></section></div>`;
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
	const artSlot = (event.target as Element).closest<SVGElement>('.workbench-stage [data-module-slot]');
	if (artSlot?.dataset.moduleSlot) { selectBenchSlot(artSlot.dataset.moduleSlot as ModuleSlot); return; }
	const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
		"button"
	);
	if (!target || target.disabled) {
		if ((event.target as HTMLElement).classList.contains("inspector-backdrop")) closeInspector();
		if ((event.target as HTMLElement).classList.contains("modal-backdrop")) closeModal();
		return;
	}
	if (target.dataset.scav) { openInspector(target.dataset.scav); return; }
	if (target.dataset.benchSlot) { selectBenchSlot(target.dataset.benchSlot as ModuleSlot); return; }
	if (target.dataset.roomLink) { openRoom(target.dataset.roomLink as BaseRoom); return; }
	if (target.dataset.page) {
		closeInspector();
		page = target.dataset.page as Page;
		render();
		window.scrollTo(0, 0);
		if (page === "raids") setView("map");
		else if (page === "home") setView("base");
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
			act(craftModule(state, id));
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
			window.scrollTo(0, 0);
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
			if (!selectedScav) document.querySelector<HTMLButtonElement>(`[data-scav="${CSS.escape(state.raids.find((raid) => raid.id === id)?.scavId ?? "")}"]`)?.focus({ preventScroll: true });
			break;
		}
		case "extract": {
			const scavId = state.raids.find((raid) => raid.id === id)?.scavId;
			act(extractRaid(state, id));
			selectedPerks.delete(id);
			if (!selectedScav && scavId) document.querySelector<HTMLButtonElement>(`[data-scav="${CSS.escape(scavId)}"]`)?.focus({ preventScroll: true });
			break;
		}
		case "open-equipment":
			closeInspector();
			page = "arsenal";
			arsenalTab = "equipment";
			render();
			window.scrollTo(0, 0);
			break;
		case "open-discoveries":
			closeInspector();
			page = "base";
			render();
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
			if (showTacticalMap) { setView("map"); document.querySelector("#hero")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }); }
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
	const dialog = document.querySelector<HTMLElement>("#modal-root .modal") ?? document.querySelector<HTMLElement>(".inspector");
	if (!dialog) return;
	if (event.key === "Escape") {
		if (event.target instanceof HTMLSelectElement) return;
		event.preventDefault();
		if (document.querySelector("#modal-root .modal")) closeModal(); else closeInspector();
	}
	if (event.key === "Tab") {
		const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not([hidden]), a[href], summary, [tabindex="0"]')).filter((node) => node.getClientRects().length > 0);
		const first = controls[0], last = controls.at(-1);
		if (first && last && event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
		else if (first && last && !event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
	}
});
function setView(view: "base" | "map") {
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
		selectedScavId: selectedScav,
		selectedMapId: selectedMap,
	}),
	(id) => {
		selectedMap = id;
		page = "raids";
		render();
		setView("map");
	},
	{ onRoom: openRoom, onScav: openInspector }
);
let ticks = 0;
const readyContracts = () =>
	CONTRACTS.filter(
		(contract) =>
			!state.claimedContracts.includes(contract.id) &&
			!getContractLockReason(state, contract) &&
			getContractProgress(state, contract) >= contract.target
	).length;
	const rosterStatus = () => `${state.scavs.map((scav) => `${scav.id}:${scav.status}:${scav.autoRaid.enabled}`).join(";")}|${state.raids.map((raid) => `${raid.id}:${raid.expedition?.stage}:${raid.expedition?.status}`).join(";")}`;
function interacting() {
	return document.activeElement?.tagName === "SELECT" || document.activeElement?.tagName === "INPUT" || Boolean(document.querySelector("#modal-root .modal"));
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
		beforeContracts = readyContracts();
	const summary = advance(state);
	hud();
	if (
		summary.completedCount ||
		state.level !== beforeLevel ||
		rosterStatus() !== beforeStatus ||
		readyContracts() !== beforeContracts
	) {
		refreshAfterAdvance();
		notifyCompleted(summary);
	}
	if (deferredRender && !interacting()) render();
	if (++ticks % 5 === 0) persist();
}, 1000);
document.addEventListener("visibilitychange", () => {
	if (document.hidden) persist();
	else {
		const summary = advance(state);
		if (summary.elapsedMs >= 60_000 || summary.completedCount) offlineSummary = summary;
		refreshAfterAdvance();
		persist();
	}
});
window.addEventListener("pagehide", persist);
window.addEventListener("beforeunload", persist);
import.meta.hot?.dispose(() => {
	persist();
	clearInterval(simulationTimer);
	clearTimeout(toastTimer);
	world?.game.destroy(true);
});
if (protectedSave) {
	toast(
		"Исходный прогресс не перезаписан. Скачай его в настройках и импортируй корректный файл.",
		false
	);
}
