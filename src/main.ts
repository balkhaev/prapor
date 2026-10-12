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
	type Attachment,
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
	equipWeapon,
	getContractProgress,
	getContractLockReason,
	getAutoRaidStatus,
	getGearCost,
	getIncomePerMinute,
	getModCost,
	getRaidChance,
	getRaidDuration,
	getRaidAmmoCost,
	getRaidPhase,
	getRepairCost,
	getScavCapacity,
	getStorageCapacity,
	getUpgradeCost,
	getWeaponDefinition,
	getWeaponPower,
	healScav,
	loadGameWithSummary,
	modWeapon,
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
} from "./game/engine";
import { GEAR_LABELS, MAX_GEAR_LEVEL, TACTICS, type GearSlot, type RaidTactic } from "./game/operations";
import { createWorld } from "./scene";

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
function gunArt(category: WeaponCategory, color: string) {
	const long = category === "rifle" || category === "sniper";
	const pistol = category === "pistol";
	return `<svg class="gun-art" viewBox="0 0 240 88" role="img" aria-label="Силуэт оружия"><g transform="translate(${pistol ? 42 : 0} 0)" stroke="#12160f" stroke-width="2"><path fill="${color}" d="M${long ? 25 : 43} 31h${pistol ? 75 : 110}v17H${long ? 25 : 43}z"/><path fill="#8c927e" d="M${pistol ? 109 : 135} 36h${pistol ? 25 : 70}v7h-${pistol ? 25 : 70}z"/><path fill="#67543a" d="m${long ? 25 : 43} 35-19 5-15 20h17l25-17Z"/><path fill="#4a513e" d="m77 47-8 25h14l7-25m14 0 6 22h17l-7-22"/>${long ? '<path fill="#454e3b" d="M126 26h10v6h-10M165 25h27v8h-27m9-10v2h10v-2"/>' : ""}${category === "shotgun" ? '<path fill="#836943" d="M126 42h53v8h-53"/>' : ""}<path fill="#22291d" d="M48 35h24v7H48"/><path stroke="#c4c9b0" stroke-width="1" opacity=".4" d="M83 35h36m-36 5h36"/></g></svg>`;
}

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
let category: WeaponCategory | "all" = "all";
let collection = false;
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
app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">П</div><div><strong>ПРАПОР</strong><small>ДЕЛО ИМЕЕТ ЗНАЧЕНИЕ</small></div></div><div class="nav-label">Оперативный штаб</div><nav class="nav" aria-label="Разделы игры">${(Object.keys(names) as Page[]).map((id) => `<button data-page="${id}" title="${names[id]}">${icon(id)}<span>${names[id]}</span>${id === "raids" ? '<b class="badge" id="raid-badge">0</b>' : ""}</button>`).join("")}</nav><div class="base-status"><i class="status-dot"></i>Убежище работает<span class="muted" id="passive-note">Мастерская приносит доход</span></div><footer>ОДИНОЧНАЯ IDLE-ИГРА · 0.2</footer></aside><main class="main"><header class="topbar"><div class="level"><span class="eyebrow">Репутация Прапора</span><strong id="level-label"></strong><div class="xp-track"><i id="xp-fill"></i></div></div><div class="resources">${[
	["money", "Рубли"],
	["ammo", "Патроны"],
	["medicine", "Медикаменты"],
	["scrap", "Детали"],
	["intel", "Разведданные"],
]
	.map(
		([key, label]) =>
			`<div class="resource">${icon(key!)}<div><label>${label}</label><strong id="res-${key}"></strong></div></div>`
	)
	.join(
		""
	)}</div><button class="settings" data-action="settings" aria-label="Сохранение и помощь">${icon("settings")}</button></header><div class="content"><div id="page-head" class="page-head"></div><div id="offline-summary"></div><div id="hero" class="hero-grid"><section class="world-card"><div class="world-head"><div class="view-switch"><button class="active" data-view="base">УБЕЖИЩЕ</button><button data-view="map">КАРТА СЕКТОРОВ</button></div><span class="mono">БАЗА № 07 · СЕКТОР СЕВЕР</span></div><div id="world" aria-label="Двумерная сцена убежища и карта рейдов"></div><div class="world-bottom"><span><i class="status-dot"></i>РАДИОСВЯЗЬ УСТОЙЧИВА</span><span id="world-raid-note">ОТРЯД НА БАЗЕ</span></div></section><aside class="briefing"><div class="stamp">ПРАПОР</div><div class="briefing-top"><div class="portrait">${portrait}</div><div><span class="eyebrow">На связи</span><div style="font-size:13px;font-weight:700;margin-top:5px">Прапор · хозяин базы</div></div></div><h2 id="briefing-title">Пушки сами себя<br>не найдут, брат.</h2><p id="briefing-copy">Снаряди дикого, задай тактику и маршрут. Постоянный приказ отправит его снова, когда здоровье восстановится.</p><button class="button" data-page="raids">Приказы и снаряжение ${icon("arrow", 16)}</button><div class="briefing-note">ПРИКАЗЫ СОХРАНЯЮТСЯ · ОФЛАЙН ДО 8 ЧАСОВ<br>Любой выход несёт риск потери оружия и бойца.</div></aside></div><div id="panel"></div><div class="footer-line"><span id="save-status">ПРОГРЕСС СОХРАНЯЕТСЯ НА ЭТОМ УСТРОЙСТВЕ</span><span>МАСТЕРСКАЯ РАБОТАЕТ И БЕЗ ТЕБЯ · ДО 8 ЧАСОВ</span></div></div></main></div><div id="toast" role="status" aria-live="polite" hidden></div><div id="modal-root"></div>`;
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
	toast(result.message, result.ok);
	persist();
	render();
}
function canAfford(cost: { money: number; scrap: number }) {
	return state.money >= cost.money && state.supplies.scrap >= cost.scrap;
}
function dispatchBlock(scav: Scav) {
	const map = MAP_BY_ID[selectedMap]!, weapon = state.weapons.find((w) => w.id === scav.weaponInstanceId);
	if (state.raids.some((r) => r.scavId === scav.id)) return "Дикий уже на маршруте";
	if (!weapon) return "Выдай оружие";
	if (weapon.durability < 10) return "Нужен ремонт оружия";
	if (scav.health < 25) return "Нужно хотя бы 25 здоровья";
	if (state.level < map.level) return `Нужен уровень ${map.level}`;
	if (state.supplies.ammo < getRaidAmmoCost(scav, map)) return "Мастерская пополняет патроны";
	if (state.supplies.intel < map.intelCost) return "Радиорубка пополняет разведданные";
	return null;
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
	document.querySelector("#raid-badge")!.textContent = String(
		state.raids.length
	);
	document.querySelector("#passive-note")!.textContent =
		`Мастерская: +${getIncomePerMinute(state)} ₽ / мин`;
	document.querySelector("#world-raid-note")!.textContent = state.raids.length
		? `В РЕЙДАХ: ${state.raids.length} · ДИКИЕ НА СВЯЗИ`
		: "ОТРЯД НА БАЗЕ";
	const orderCounter = document.querySelector("#auto-order-count");
	if (orderCounter) orderCounter.textContent = String(state.scavs.filter((scav) => scav.autoRaid.enabled).length);
	document
		.querySelectorAll<HTMLElement>("[data-raid-progress]")
		.forEach((node) => {
			const raid = state.raids.find((r) => r.id === node.dataset.raidProgress);
			if (raid)
				node.style.width = `${Math.min(100, ((Date.now() - raid.startedAt) / (raid.endsAt - raid.startedAt)) * 100)}%`;
		});
	document.querySelectorAll<HTMLElement>("[data-raid-time]").forEach((node) => {
		const raid = state.raids.find((r) => r.id === node.dataset.raidTime);
		if (raid) node.textContent = seconds((raid.endsAt - Date.now()) / 1000);
	});
	document.querySelectorAll<HTMLElement>("[data-raid-phase]").forEach((node) => {
		const raid = state.raids.find((r) => r.id === node.dataset.raidPhase);
		if (raid) node.textContent = getRaidPhase(raid, Date.now()).label;
	});
	document.querySelectorAll<HTMLElement>("[data-health]").forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.health);
		if (scav) node.textContent = `${Math.round(scav.health)} / 100`;
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
		if (scav) node.textContent = `${Math.round(getRaidChance(state, scav, MAP_BY_ID[selectedMap]!) * 100)}% успеха`;
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="dispatch"]').forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.id);
		const reason = scav ? dispatchBlock(scav) : "Боец не найден";
		node.disabled = Boolean(reason);
		node.title = reason ?? "Разовый выход в выбранный сектор";
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="gear"]').forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.id);
		const slot = node.dataset.slot as GearSlot;
		if (scav) node.disabled = scav.status === "raiding" || scav.gear[slot] >= MAX_GEAR_LEVEL || !canAfford(getGearCost(scav, slot));
	});
	document.querySelectorAll<HTMLButtonElement>('[data-action="heal"]').forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.id);
		if (scav) node.disabled = scav.status === "raiding" || scav.health >= 100 || state.supplies.medicine < 1;
	});
	document.querySelectorAll<HTMLElement>("[data-dispatch-note]").forEach((node) => {
		const scav = state.scavs.find((s) => s.id === node.dataset.dispatchNote);
		if (scav) node.textContent = dispatchBlock(scav) ?? "Готов к разовому выходу";
	});
}
function gearCard(scav: Scav, slot: GearSlot) {
	const level = scav.gear[slot], max = level >= MAX_GEAR_LEVEL, cost = getGearCost(scav, slot);
	const effect = slot === "armor"
		? level ? `+${level * 2} п.п. успеха · травмы −${level * 16}%` : "Защита от ранений и гибели"
		: level ? `+${level * 12}% добычи` : "Больше добычи с каждого выхода";
	return `<div class="gear-card"><div class="gear-head">${icon(slot, 22)}<div><strong>${GEAR_LABELS[slot]}</strong><span>УР. ${level} / ${MAX_GEAR_LEVEL}</span></div><div class="gear-pips" aria-label="Уровень ${level} из ${MAX_GEAR_LEVEL}">${Array.from({ length: MAX_GEAR_LEVEL }, (_, i) => `<i class="${i < level ? "filled" : ""}"></i>`).join("")}</div></div><p>${effect}</p><button class="button ghost small" data-action="gear" data-id="${scav.id}" data-slot="${slot}" ${max || scav.status === "raiding" || !canAfford(cost) ? "disabled" : ""}>${max ? "Полный комплект" : `Улучшить · ${costLabel(cost)}`}</button></div>`;
}
function autoRaidCard(scav: Scav) {
	const plan = scav.autoRaid, route = MAP_BY_ID[plan.mapId], selected = MAP_BY_ID[selectedMap]!;
	return `<div class="auto-order ${plan.enabled ? "enabled" : ""}"><div class="auto-order-head"><span>${icon("repeat", 15)} ПОСТОЯННЫЙ ПРИКАЗ</span><b>${plan.enabled ? "ВКЛ" : "ВЫКЛ"}</b></div><div class="auto-route">${route ? e(route.name) : "Маршрут не задан"}<span>Выходов: ${n(plan.runs)}</span></div><p data-auto-status="${scav.id}">${e(getAutoRaidStatus(state, scav))}</p><label class="threshold-label">Выходить при здоровье<select data-auto-health="${scav.id}" aria-label="Порог здоровья для ${e(scav.name)}">${[70, 85, 100].map((health) => `<option value="${health}" ${plan.minHealth === health ? "selected" : ""}>${health} / 100${health === 70 ? " · обычный" : health === 85 ? " · бережный" : " · полное"}</option>`).join("")}</select></label>${plan.enabled ? `<div class="auto-order-actions"><button class="button ghost small" data-action="auto-route" data-id="${scav.id}">Маршрут: ${e(selected.name)}</button><button class="button danger small" data-action="auto-stop" data-id="${scav.id}">${icon("stop", 12)} Остановить автовыходы</button></div><small>Текущий рейд продолжится. Следующий выход отменится.</small>` : `<button class="button secondary small" data-action="auto-enable" data-id="${scav.id}">${icon("repeat", 14)} Автовыходы: ${e(selected.name)}</button><small>Повторяет рейды и офлайн. Может потерять бойца и оружие.</small>`}</div>`;
}
function scavCard(scav: Scav) {
	const raid = state.raids.find((r) => r.scavId === scav.id),
		map = MAP_BY_ID[selectedMap]!;
	const personality = PERSONALITY_BY_ID[scav.personality]!;
	return `<article class="card scav-card"><div class="card-heading"><div class="scav-avatar">${e(scav.name[0])}</div><div><h3>${e(scav.name)}</h3><span class="muted">${e(personality.name)} · ур. ${scav.level}</span></div><span class="tag">${raid ? "В РЕЙДЕ" : scav.health < 25 ? "РАНЕН" : "НА БАЗЕ"}</span></div><div class="scav-stats"><span>Бой <strong>${scav.combat}</strong></span><span>Поиск <strong>${scav.scouting}</strong></span><span data-health="${scav.id}">${Math.round(scav.health)} / 100</span></div><div class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></div><label class="field-label">Оружие<select aria-label="Оружие для ${e(scav.name)}" data-equip="${scav.id}" ${raid ? "disabled" : ""}><option value="">Без оружия</option>${state.weapons
					.filter(
						(w) =>
							!state.scavs.some(
								(s) => s.id !== scav.id && s.weaponInstanceId === w.id
							)
					)
					.map(
						(w) =>
							`<option value="${w.id}" ${w.id === scav.weaponInstanceId ? "selected" : ""}>${e(getWeaponDefinition(w).name)} · ${Math.round(w.durability)}%</option>`
					)
					.join(
						""
					)}</select></label><label class="field-label">${raid ? "Тактика следующего выхода" : "Тактика"}<select data-tactic="${scav.id}" aria-label="Тактика для ${e(scav.name)}">${(Object.keys(TACTICS) as RaidTactic[]).map((tactic) => `<option value="${tactic}" ${scav.tactic === tactic ? "selected" : ""}>${TACTICS[tactic].label}</option>`).join("")}</select></label><p class="tactic-note">${e(TACTICS[scav.tactic].description)}</p><div class="gear-grid">${gearCard(scav, "armor")}${gearCard(scav, "backpack")}</div>${raid ? `<div class="active-raid"><div class="active-raid-heading">${icon("raids", 15)}<strong>${e(MAP_BY_ID[raid.mapId]!.name)}</strong><span>${raid.isAuto ? "АВТО" : "РАЗОВЫЙ"}</span></div><div class="raid-time"><span data-raid-phase="${raid.id}">${e(getRaidPhase(raid, Date.now()).label)}</span><strong data-raid-time="${raid.id}">${seconds((raid.endsAt - Date.now()) / 1000)}</strong></div><div class="progress"><i data-raid-progress="${raid.id}"></i></div><p>Шанс на выходе: ${Math.round(raid.chance * 100)}% · ${e(TACTICS[raid.tactic].label)}<br>Отчёт по этапам появится после возвращения.</p></div>` : `<div class="scav-action"><span class="chance" title="Вероятность успешного возвращения"><span data-chance="${scav.id}">${Math.round(getRaidChance(state, scav, map) * 100)}% успеха</span><br><small class="muted">${seconds(getRaidDuration(state, scav, map))} · ${getRaidAmmoCost(scav, map)} патр.</small></span><button class="button small" data-action="dispatch" data-id="${scav.id}" ${dispatchBlock(scav) ? "disabled" : ""}>В рейд ${icon("arrow", 14)}</button></div><p class="dispatch-note" data-dispatch-note="${scav.id}">${e(dispatchBlock(scav) ?? "Готов к разовому выходу")}</p><button class="button ghost small heal-button" data-action="heal" data-id="${scav.id}" ${scav.health >= 100 || state.supplies.medicine < 1 ? "disabled" : ""}>${icon("medicine", 14)} Лечить медикаментами</button>`}${autoRaidCard(scav)}</article>`;
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
	return `<details class="journal-entry" data-report="${report.id}"><summary><time>${new Date(report.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><div class="journal-copy"><strong>${e(report.scavName)} · ${e(MAP_BY_ID[report.mapId]!.name)}</strong><p>${e(report.description)}</p><div class="journal-meta"><span>${report.isAuto ? "АВТОВЫХОД" : "РАЗОВЫЙ"} · ${e(TACTICS[report.tactic].label)}</span><span>${report.money ? `+${n(report.money)} ₽ · ` : ""}Детали +${report.supplies.scrap} · патроны +${report.supplies.ammo}</span></div></div><b class="tag report-result ${report.success ? "success" : "failure"}">${report.success ? "ВЕРНУЛСЯ" : report.lostScav ? "ПОТЕРЯН" : "ПРОВАЛ"}</b><span class="journal-expand">${icon("arrow", 14)}</span></summary><div class="journal-detail">${report.weaponId ? `<div class="report-trophy" style="--rarity:${RARITY_COLORS[WEAPON_BY_ID[report.weaponId]!.rarity]}">${icon("arsenal", 21)}<div><strong>${e(WEAPON_BY_ID[report.weaponId]!.name)}</strong><span>${report.weaponAutoSold ? "Продано: арсенал заполнен" : "Найдено и отправлено в арсенал"}</span></div></div>` : ""}<ol class="route-timeline">${report.events.map((event, i) => `<li class="event-${event.kind}"><div class="timeline-marker">0${i + 1}</div><div><div class="timeline-label"><strong>${e(event.label)}</strong><time>${new Date(event.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div><p>${e(event.text)}</p></div></li>`).join("")}</ol><div class="report-bottom"><span>Разведданные +${report.supplies.intel} · медикаменты +${report.supplies.medicine}</span><span>${report.lostScav ? "Боец потерян" : report.lostWeapon ? "Оружие потеряно" : "Отчёт закрыт"}</span></div></div></details>`;
}
function renderOfflineSummary() {
	const node = document.querySelector<HTMLElement>("#offline-summary")!;
	if (!offlineSummary) { node.innerHTML = ""; return; }
	const minutes = Math.floor(offlineSummary.elapsedMs / 60_000);
	const elapsed = minutes ? `${minutes} мин` : `${Math.floor(offlineSummary.elapsedMs / 1000)} с`;
	node.innerHTML = `<aside class="offline-summary"><div class="offline-icon">${icon("time", 26)}</div><div><span class="eyebrow">С возвращением на базу</span><h3>База отработала ${elapsed}${offlineSummary.capped ? " · учтены 8 часов" : ""}.</h3><p>Заработано <strong>+${n(offlineSummary.money)} ₽</strong> · завершено выходов <strong>${n(offlineSummary.completedCount)}</strong>. Мастерская пополнила припасы, медблок восстановил диких.</p></div><button class="button ghost small" data-page="journal">Отчёты ${icon("arrow", 13)}</button><button class="dismiss-button" data-action="dismiss-offline" aria-label="Закрыть сводку">×</button></aside>`;
}
function operationsBar() {
	const enabled = state.scavs.filter((scav) => scav.autoRaid.enabled).length;
	return `<div class="operations-bar"><div>${icon("repeat", 25)}<div><span class="eyebrow">Постоянные приказы</span><strong><span id="auto-order-count">${enabled}</span> диких на автовыходах</strong><p>Медблок лечит, мастерская снабжает. Маршруты и пороги здоровья — у каждого бойца свои.</p></div></div>${enabled ? '<button class="button danger small" data-action="auto-stop-all">Остановить все автовыходы</button>' : '<button class="button secondary small" data-page="raids">Настроить отряд</button>'}</div>`;
}
function render() {
	deferredRender = false;
	const expandedReports = Array.from(panel.querySelectorAll<HTMLDetailsElement>("details[data-report][open]")).map((node) => node.dataset.report);
	document
		.querySelectorAll<HTMLButtonElement>(".nav button")
		.forEach((button) =>
			button.classList.toggle("active", button.dataset.page === page)
		);
	const captions: Record<Page, string> = {
		home: "Железо в арсенале. Свои люди на связи.",
		raids: "Снаряжай диких, выбирай маршрут, забирай добычу.",
		arsenal: "Каждая пушка — история. Собери свою коллекцию.",
		base: "Хорошее убежище работает даже без приказов.",
		contracts: "Репутация строится на выполненных обещаниях.",
		journal: "Кто вышел, кто вернулся и что принёс.",
	};
	document.querySelector("#page-head")!.innerHTML =
		`<div><div class="eyebrow"><span class="page-number">0${Object.keys(names).indexOf(page) + 1} /</span> ${page === "home" ? "УБЕЖИЩЕ ПРАПОРА" : names[page]}</div><h1>${page === "home" ? "Хозяйство под контролем." : names[page]}</h1><p>${captions[page]}</p></div><span class="tag">${icon("time", 13)} +${getIncomePerMinute(state)} ₽ / МИН</span>`;
	(document.querySelector("#hero") as HTMLElement).style.display =
		page === "home" || page === "raids" ? "" : "none";
	document.querySelector("#briefing-title")!.innerHTML = state.scavs.some((scav) => scav.autoRaid.enabled) ? "Люди знают<br>своё дело, брат." : "Каждому — ствол.<br>Каждому — маршрут.";
	document.querySelector("#briefing-copy")!.textContent = state.scavs.some((scav) => scav.autoRaid.enabled) ? "Твои приказы работают даже без тебя. Следи за бронёй и стволами: после каждой вылазки медблок готовит бойца к следующей, а радиорубка держит связь." : "Выдай дикому оружие, подбери тактику, броню и рюкзак. Автовыходы повторят выбранный маршрут, когда боец восстановится — даже если ты закроешь игру.";
	renderOfflineSummary();
	if (page === "home")
		panel.innerHTML = `<div class="stats-strip">${[
			[
				"people",
				state.scavs.length,
				"ДИКИХ В ОТРЯДЕ",
				`${getScavCapacity(state)} мест`,
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
			)}</div>${operationsBar()}<div class="section-head"><h2>Твои люди <span class="muted">/ ${state.scavs.length}</span></h2><button class="link-button" data-page="raids">Управлять отрядом →</button></div><div class="card-grid scav-grid">${state.scavs.slice(0, 3).map(scavCard).join("") || '<div class="empty">Отряд пуст. Найми дикого в разделе «Рейды» — первый после потери отряда приходит бесплатно.</div>'}</div><div class="section-head"><h2>Прапор поручил</h2><button class="link-button" data-page="contracts">Все контракты →</button></div><div class="quick-contracts">${
			CONTRACTS.filter((c) => !state.claimedContracts.includes(c.id) && !getContractLockReason(state, c))
				.slice(0, 2)
				.map(contractCard)
				.join("") ||
			'<div class="empty">Все контракты закрыты. Развивай репутацию — Прапор откроет следующие поручения.</div>'
		}</div>`;
	if (page === "raids") {
		const map = MAP_BY_ID[selectedMap]!;
		panel.innerHTML = `${operationsBar()}<div class="section-head"><h2>Выбери сектор</h2><span class="muted">${MAPS.filter((m) => state.level >= m.level).length} / ${MAPS.length} открыто</span></div><div class="maps">${MAPS.map((m, i) => `<button class="map-card ${m.id === selectedMap ? "selected" : ""} ${state.level < m.level ? "locked" : ""}" data-map="${m.id}" ${state.level < m.level ? "disabled" : ""}><span class="map-graphic">${icon("raids", 100)}</span><span class="map-index">СЕКТОР 0${i + 1}${state.level < m.level ? ` · ${icon("lock", 10)} УР. ${m.level}` : ""}</span><h3>${e(m.name)}</h3><p>${e(m.subtitle)}</p><div class="map-meta"><span>${seconds(m.duration)} · ${m.ammoCost} патр.${m.intelCost ? ` · ${m.intelCost} разв.` : ""}</span><span>${m.reward[0]}–${m.reward[1]} ₽</span></div></button>`).join("")}</div><div class="raid-instruction">${icon("raids", 24)}<div><strong>${e(map.name)}</strong> · ${e(map.description)}<br><span class="muted">При провале возможна потеря оружия и бойца. На шанс влияют здоровье, тактика, броня, ствол и радиорубка. Выбор сектора меняет разовый выход; постоянный приказ хранит собственный маршрут.</span></div></div><div class="section-head"><h2>Снаряжение отряда</h2><button class="button secondary small" data-action="recruit" ${state.scavs.length >= getScavCapacity(state) ? "disabled" : ""}>${icon("people", 15)} Нанять · ${recruitCost(state)} ₽</button></div><div class="card-grid scav-grid">${state.scavs.map(scavCard).join("") || '<div class="empty">Отряд потерян. Найми нового дикого бесплатно и начни снова.</div>'}</div><p class="muted" style="font-size:11px;margin-top:15px">Отряд: ${state.scavs.length} / ${getScavCapacity(state)} · Улучшай радиорубку, чтобы нанимать больше диких. Медблок восстанавливает здоровье со временем.</p>`;
	}
	if (page === "arsenal") renderArsenal();
	if (page === "base") {
		const descriptions: Record<BaseRoom, string> = {
			workshop: `Доход +${getIncomePerMinute(state)} ₽/мин. Производит патроны и детали для рейдов и ремонта.`,
			medbay: `Бесплатно восстанавливает ${((0.04 + state.base.medbay * 0.025) * 60).toFixed(1)} здоровья в минуту. Улучшение ускоряет лечение.`,
			radio: `${getScavCapacity(state)} места для диких. Производит разведданные, повышает шанс успеха и сокращает путь.`,
			storage: `${getStorageCapacity(state)} мест под оружие. При переполнении новая добыча автоматически продаётся.`,
		};
		panel.innerHTML = `<div class="card-grid">${(
			Object.keys(BASE_ROOM_LABELS) as BaseRoom[]
		)
			.map((room) => {
				const cost = getUpgradeCost(state, room),
					max = state.base[room] >= MAX_ROOM_LEVEL;
				return `<article class="card room-card"><span class="room-level">УР. ${state.base[room]} / ${MAX_ROOM_LEVEL}</span><div class="room-icon">${icon(room === "workshop" ? "scrap" : room === "medbay" ? "medicine" : room === "radio" ? "intel" : "arsenal", 32)}</div><span class="eyebrow">Помещение убежища</span><h3 style="margin-top:10px">${BASE_ROOM_LABELS[room]}</h3><p>${descriptions[room]}</p><div class="progress"><i style="width:${(state.base[room] / MAX_ROOM_LEVEL) * 100}%"></i></div><button class="button secondary" data-action="upgrade" data-id="${room}" ${max ? "disabled" : ""}>${max ? "Максимальный уровень" : `Улучшить · ${costLabel(cost)}`}</button></article>`;
			})
			.join(
				""
			)}</div><div class="raid-instruction">${icon("time", 24)}<div>Работа не останавливается, когда ты уходишь.<br><span class="muted">При возвращении начисляется до 8 часов дохода, производства, лечения и автовыходов. Бойцы с постоянным приказом повторяют рейды, пока есть здоровье, патроны, разведданные и исправное оружие. Медблок и мастерская помогают продолжать маршрут; каждый выход остаётся риском.</span></div></div>`;
	}
	if (page === "contracts") {
		const contracts = CONTRACTS.filter((contract) => contractFilter === "all" || (contractFilter === "done") === state.claimedContracts.includes(contract.id));
		panel.innerHTML = `<div class="arsenal-toolbar"><div class="filters">${(["open", "done", "all"] as const).map((filter) => `<button data-contract-filter="${filter}" class="${contractFilter === filter ? "active" : ""}">${filter === "open" ? "Поручения" : filter === "done" ? "Выполнены" : "Все"}</button>`).join("")}</div><span class="tag">${state.claimedContracts.length} / ${CONTRACTS.length} ЗАКРЫТО</span></div><div class="contract-brief">${icon("contracts", 22)}<p>Поручения дают рубли, опыт и припасы для следующего выхода. Завершай цепочку: награды открывают новые задания, а репутация — новые сектора.</p></div>${contracts.map(contractCard).join("") || '<div class="empty">Здесь пока нет поручений. Заверши первый контракт и возвращайся.</div>'}`;
	}
	if (page === "journal")
		panel.innerHTML = state.history.length
			? `<div class="section-head"><h2>Последние ${state.history.length} выходов</h2><span class="muted">Всего: ${n(state.stats.raidsCompleted)} · нажми отчёт, чтобы открыть маршрут</span></div>${state.history.map(journalCard).join("")}`
			: '<div class="empty">Радио пока молчит.<br>Отправь дикого в первый рейд — здесь появится его отчёт.</div>';
	panel.querySelectorAll<HTMLDetailsElement>("details[data-report]").forEach((node) => { node.open = expandedReports.includes(node.dataset.report); });
	hud();
}
function renderArsenal() {
	const guns = state.weapons.filter(
		(w) => category === "all" || getWeaponDefinition(w).category === category
	);
	if (!state.weapons.some((w) => w.id === selectedWeapon))
		selectedWeapon = state.weapons[0]?.id ?? "";
	const selected = state.weapons.find((w) => w.id === selectedWeapon);
	panel.innerHTML = `<div class="arsenal-toolbar"><div class="filters">${(["all", "rifle", "smg", "shotgun", "sniper", "pistol"] as const).map((c) => `<button data-filter="${c}" class="${category === c ? "active" : ""}">${c === "all" ? "Все пушки" : CATEGORY_LABELS[c]}</button>`).join("")}<button data-action="collection" class="${collection ? "active" : ""}">Коллекция ${state.discoveredWeapons.length}/${WEAPONS.length}</button></div><span class="tag">${state.weapons.length} / ${getStorageCapacity(state)} МЕСТ</span></div>${
		collection
			? `<div class="weapons-grid">${WEAPONS.filter(
					(w) => category === "all" || w.category === category
				)
					.map((w) => {
						const known = state.discoveredWeapons.includes(w.id);
						return `<article class="weapon-card" style="--rarity:${known ? RARITY_COLORS[w.rarity] : "#424a36"};opacity:${known ? 1 : 0.45}"><span class="eyebrow">${known ? RARITY_LABELS[w.rarity] : "НЕ НАЙДЕНО"}</span>${gunArt(w.category, known ? RARITY_COLORS[w.rarity] : "#525b46")}<h3>${e(w.name)}</h3><div class="weapon-meta"><span>${CATEGORY_LABELS[w.category]}</span><span>${known ? "ОТКРЫТО" : `В рейдах`}</span></div></article>`;
					})
					.join("")}</div>`
			: `<div class="arsenal-layout"><div class="weapons-grid">${
					guns
						.map((w) => {
							const def = getWeaponDefinition(w),
								owner = state.scavs.find((s) => s.weaponInstanceId === w.id);
							return `<button class="weapon-card ${w.id === selectedWeapon ? "selected" : ""}" style="--rarity:${RARITY_COLORS[def.rarity]}" data-weapon="${w.id}"><span class="eyebrow">${RARITY_LABELS[def.rarity]}</span>${gunArt(def.category, RARITY_COLORS[def.rarity])}<h3>${e(def.name)}</h3><div class="weapon-meta"><span>МОЩЬ ${getWeaponPower(w)} · ${Math.round(w.durability)}%</span><span>${owner ? e(owner.name) : "НА СКЛАДЕ"}</span></div></button>`;
						})
						.join("") ||
					'<div class="empty">В этой категории ещё нет оружия.</div>'
				}</div>${selected ? weaponDetail(selected) : '<div class="empty">Арсенал пуст. Бесплатный новобранец получит ПМ, если весь отряд потерян.</div>'}</div>`
	}`;
}
function weaponDetail(weapon: WeaponInstance) {
	const def = getWeaponDefinition(weapon),
		owner = state.scavs.find((s) => s.weaponInstanceId === weapon.id),
		busy = state.raids.some((r) => r.weaponInstanceId === weapon.id),
		repair = getRepairCost(weapon);
	return `<aside class="weapon-detail"><span class="eyebrow" style="color:${RARITY_COLORS[def.rarity]}">${RARITY_LABELS[def.rarity]} · ${CATEGORY_LABELS[def.category]}</span><h2>${e(def.name)}</h2>${gunArt(def.category, RARITY_COLORS[def.rarity])}<p>${e(def.description)}</p><div class="detail-row"><span>Мощность</span><strong>${getWeaponPower(weapon)}</strong></div><div class="detail-row"><span>Надёжность</span><strong>${def.reliability}%</strong></div><div class="detail-row"><span>Состояние</span><strong>${Math.round(weapon.durability)}%</strong></div><div class="health-track"><i style="width:${weapon.durability}%"></i></div><div class="detail-row"><span>Выдано</span><strong>${owner ? e(owner.name) : "На складе"}</strong></div><div class="mods">${(Object.keys(ATTACHMENT_LABELS) as Attachment[]).map((mod) => `<div class="mod-row"><div>${ATTACHMENT_LABELS[mod]} <span>ур. ${weapon.attachments[mod]}</span></div><button class="button ghost small" data-action="mod" data-id="${weapon.id}" data-mod="${mod}" ${busy || weapon.attachments[mod] >= 3 ? "disabled" : ""} title="${costLabel(getModCost(weapon, mod))}">${weapon.attachments[mod] >= 3 ? "MAX" : `${getModCost(weapon, mod).money} ₽ + ${getModCost(weapon, mod).scrap} дет.`}</button></div>`).join("")}</div><div class="detail-actions"><button class="button secondary" data-action="repair" data-id="${weapon.id}" ${busy || weapon.durability >= 100 ? "disabled" : ""}>Ремонт · ${costLabel(repair)}</button><button class="button ghost" data-action="sell" data-id="${weapon.id}" ${busy || state.weapons.length <= 1 ? "disabled" : ""}>Продать · ${Math.max(15, Math.round(def.value * (0.35 + weapon.durability / 200)))} ₽</button></div></aside>`;
}
function showSettings() {
	document.querySelector("#modal-root")!.innerHTML =
		`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><h2 id="settings-title">Твоё дело — при тебе.</h2><p>Прогресс хранится в этом браузере. Перед сменой устройства экспортируй сохранение. При возвращении база начисляет до 8 часов дохода, производства, лечения и рейдов по постоянным приказам.</p><p>Автовыходы продолжаются офлайн до нехватки ресурсов, здоровья или исправного оружия. Они несут риск потери бойца и ствола. Останови постоянный приказ в карточке дикого, чтобы отменить будущие выходы.</p>${protectedSave ? '<p class="order-risk">Исходный файл не удалось прочитать. Он остаётся в браузере без изменений; автоматическое сохранение временной сессии отключено. Скачай исходный файл и импортируй корректное сохранение.</p>' : ""}<p>Начни с «Дворов»: выбери дикого и оружие, отправь в рейд. Забери награду контракта «Первый выход», затем развивай мастерскую и радиорубку.</p><div class="detail-actions"><button class="button secondary" data-action="export">${protectedSave ? "Скачать исходный файл" : "Экспорт"}</button><button class="button ghost" data-action="import">Импорт</button></div><input type="file" accept="application/json,.json" id="save-file" hidden><div class="save-note">Один рейд — один результат. Сохранение восстанавливает отряд, оружие, броню, рюкзаки, тактику, приказы и рейды. Импорт заменит текущий прогресс после проверки файла.</div><button class="button ghost" style="width:100%;margin-top:20px" data-action="close-modal">Продолжить</button></section></div>`;
	(
		document.querySelector('[data-action="export"]') as HTMLButtonElement
	).focus();
}
function showAutoRaidOrder(scavId: string) {
	const scav = state.scavs.find((item) => item.id === scavId);
	if (!scav) return;
	const map = MAP_BY_ID[selectedMap]!;
	document.querySelector("#modal-root")!.innerHTML = `<div class="modal-backdrop"><section class="modal auto-raid-modal" role="dialog" aria-modal="true" aria-labelledby="auto-title"><span class="eyebrow">Постоянный приказ · ${e(scav.name)}</span><h2 id="auto-title">Автовыходы: ${e(map.name)}</h2><div class="order-brief"><span>${icon("repeat", 19)} Повторять выбранный маршрут</span><span>${icon("medicine", 19)} Выходить при ${scav.autoRaid.minHealth} / 100 здоровья</span><span>${icon("time", 19)} Работать и офлайн · до 8 часов</span></div><p>Дикий будет снова уходить в рейды, как только вернётся и восстановится. Приказ действует, пока хватает патронов и разведданных и оружие пригодно к бою. Мастерская и медблок могут подготовить следующий выход.</p><p class="order-risk">Каждый повтор несёт риск: можно потерять дикого и его оружие. Броня снижает потери, но не гарантирует возвращение.</p><p>Кнопка «Остановить автовыходы» отменяет будущие выходы. Текущий рейд боец завершит.</p><div class="detail-actions"><button class="button" data-action="confirm-auto" data-id="${scav.id}" data-route="${map.id}" data-min-health="${scav.autoRaid.minHealth}">${scav.autoRaid.enabled ? "Изменить приказ" : "Включить автовыходы"}</button><button class="button ghost" data-action="close-modal">Назад к бойцу</button></div></section></div>`;
	document.querySelector<HTMLButtonElement>('[data-action="confirm-auto"]')!.focus();
}
document.addEventListener("click", (event) => {
	const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
		"button"
	);
	if (!target || target.disabled) return;
	if (target.dataset.page) {
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
		return;
	}
	if (target.dataset.filter) {
		category = target.dataset.filter as WeaponCategory | "all";
		render();
		return;
	}
	if (target.dataset.contractFilter) {
		contractFilter = target.dataset.contractFilter as typeof contractFilter;
		render();
		return;
	}
	const id = target.dataset.id ?? "";
	switch (target.dataset.action) {
		case "gear":
			act(upgradeScavGear(state, id, target.dataset.slot as GearSlot));
			break;
		case "auto-enable":
		case "auto-route":
			showAutoRaidOrder(id);
			break;
		case "confirm-auto":
			document.querySelector("#modal-root")!.innerHTML = "";
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
					`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="sell-title"><h2 id="sell-title">Продать ${e(getWeaponDefinition(weapon).name)}?</h2><p>Оружие уйдёт из арсенала. Если оно выдано дикому, его нужно будет вооружить другим стволом.</p><div class="detail-actions"><button class="button danger" data-action="confirm-sell" data-id="${id}">Продать</button><button class="button ghost" data-action="close-modal">Оставить</button></div></section></div>`;
			break;
		}
		case "confirm-sell":
			document.querySelector("#modal-root")!.innerHTML = "";
			act(sellWeapon(state, id));
			break;
		case "mod":
			act(modWeapon(state, id, target.dataset.mod as Attachment));
			break;
		case "claim":
			act(claimContract(state, id));
			break;
		case "collection":
			collection = !collection;
			render();
			break;
		case "settings":
			showSettings();
			break;
		case "close-modal":
			document.querySelector("#modal-root")!.innerHTML = "";
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
	if (target.dataset.equip)
		act(equipWeapon(state, target.dataset.equip, target.value || null));
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
			document.querySelector("#modal-root")!.innerHTML = "";
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
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape")
		document.querySelector("#modal-root")!.innerHTML = "";
});
function setView(view: "base" | "map") {
	world?.setView(view);
	document
		.querySelectorAll<HTMLButtonElement>("[data-view]")
		.forEach((button) =>
			button.classList.toggle("active", button.dataset.view === view)
		);
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
	}),
	(id) => {
		selectedMap = id;
		page = "raids";
		render();
		setView("map");
	}
);
let ticks = 0;
const readyContracts = () =>
	CONTRACTS.filter(
		(contract) =>
			!state.claimedContracts.includes(contract.id) &&
			!getContractLockReason(state, contract) &&
			getContractProgress(state, contract) >= contract.target
	).length;
const rosterStatus = () => `${state.scavs.map((scav) => `${scav.id}:${scav.status}:${scav.autoRaid.enabled}`).join(";")}|${state.raids.map((raid) => raid.id).join(";")}`;
function interacting() {
	return document.activeElement?.tagName === "SELECT" || Boolean(document.querySelector("#modal-root .modal"));
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
