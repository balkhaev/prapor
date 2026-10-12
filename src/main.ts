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
	getIncomePerMinute,
	getModCost,
	getRaidChance,
	getRaidDuration,
	getRepairCost,
	getScavCapacity,
	getStorageCapacity,
	getUpgradeCost,
	getWeaponDefinition,
	getWeaponPower,
	healScav,
	loadGame,
	modWeapon,
	recruitCost,
	recruitScav,
	repairWeapon,
	saveGame,
	sellWeapon,
	upgradeBase,
	xpForLevel,
	type ActionResult,
	type GameState,
	type Scav,
	type WeaponInstance,
} from "./game/engine";
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
let state: GameState = loadGame(raw) ?? createGame();
let page: Page = "home";
let selectedMap = MAPS[0]!.id;
let selectedWeapon = state.weapons[0]?.id ?? "";
let category: WeaponCategory | "all" = "all";
let collection = false;
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
app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">П</div><div><strong>ПРАПОР</strong><small>ДЕЛО ИМЕЕТ ЗНАЧЕНИЕ</small></div></div><div class="nav-label">Оперативный штаб</div><nav class="nav" aria-label="Разделы игры">${(Object.keys(names) as Page[]).map((id) => `<button data-page="${id}" title="${names[id]}">${icon(id)}<span>${names[id]}</span>${id === "raids" ? '<b class="badge" id="raid-badge">0</b>' : ""}</button>`).join("")}</nav><div class="base-status"><i class="status-dot"></i>Убежище работает<span class="muted" id="passive-note">Мастерская приносит доход</span></div><footer>ОДИНОЧНАЯ IDLE-ИГРА · 0.1</footer></aside><main class="main"><header class="topbar"><div class="level"><span class="eyebrow">Репутация Прапора</span><strong id="level-label"></strong><div class="xp-track"><i id="xp-fill"></i></div></div><div class="resources">${[
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
	)}</div><button class="settings" data-action="settings" aria-label="Сохранение и помощь">${icon("settings")}</button></header><div class="content"><div id="page-head" class="page-head"></div><div id="hero" class="hero-grid"><section class="world-card"><div class="world-head"><div class="view-switch"><button class="active" data-view="base">УБЕЖИЩЕ</button><button data-view="map">КАРТА СЕКТОРОВ</button></div><span class="mono">БАЗА № 07 · СЕКТОР СЕВЕР</span></div><div id="world" aria-label="Двумерная сцена убежища и карта рейдов"></div><div class="world-bottom"><span><i class="status-dot"></i>РАДИОСВЯЗЬ УСТОЙЧИВА</span><span id="world-raid-note">ОТРЯД НА БАЗЕ</span></div></section><aside class="briefing"><div class="stamp">ПРАПОР</div><div class="briefing-top"><div class="portrait">${portrait}</div><div><span class="eyebrow">На связи</span><div style="font-size:13px;font-weight:700;margin-top:5px">Прапор · хозяин базы</div></div></div><h2>Пушки сами себя<br>не найдут, брат.</h2><p>Выдай дикому ствол, выбери сектор и отправляй за добычей. Кто вернётся — принесёт железо. А мы сделаем из этого дело.</p><button class="button" data-page="raids">Снарядить первый рейд ${icon("arrow", 16)}</button><div class="briefing-note">ДВОРЫ · ОТ 30 СЕКУНД · ДОСТУПНЫ СРАЗУ<br>При провале можно потерять оружие и бойца.</div></aside></div><div id="panel"></div><div class="footer-line"><span id="save-status">ПРОГРЕСС СОХРАНЯЕТСЯ НА ЭТОМ УСТРОЙСТВЕ</span><span>МАСТЕРСКАЯ РАБОТАЕТ И БЕЗ ТЕБЯ · ДО 8 ЧАСОВ</span></div></div></main></div><div id="toast" role="status" aria-live="polite" hidden></div><div id="modal-root"></div>`;
const panel = document.querySelector<HTMLDivElement>("#panel")!;
const costLabel = (cost: { money: number; scrap: number }) =>
	`${n(cost.money)} ₽ · ${cost.scrap} дет.`;
function persist(): boolean {
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
}
function scavCard(scav: Scav) {
	const weapon = state.weapons.find((w) => w.id === scav.weaponInstanceId),
		raid = state.raids.find((r) => r.scavId === scav.id),
		map = MAP_BY_ID[selectedMap]!;
	const personality = PERSONALITY_BY_ID[scav.personality]!;
	return `<article class="card scav-card"><div class="card-heading"><div class="scav-avatar">${e(scav.name[0])}</div><div><h3>${e(scav.name)}</h3><span class="muted">${e(personality.name)} · ур. ${scav.level}</span></div><span class="tag">${raid ? "В РЕЙДЕ" : scav.health < 25 ? "РАНЕН" : "НА БАЗЕ"}</span></div><div class="scav-stats"><span>Бой <strong>${scav.combat}</strong></span><span>Поиск <strong>${scav.scouting}</strong></span><span data-health="${scav.id}">${Math.round(scav.health)} / 100</span></div><div class="health-track"><i data-health-fill="${scav.id}" style="width:${scav.health}%"></i></div>${
		raid
			? `<p style="margin-top:18px">${e(MAP_BY_ID[raid.mapId]!.name)} · ${weapon ? e(getWeaponDefinition(weapon).name) : ""}</p><div class="raid-time"><span>НА МАРШРУТЕ</span><strong data-raid-time="${raid.id}"></strong></div><div class="progress"><i data-raid-progress="${raid.id}"></i></div><p>Добыча и отчёт появятся после возвращения.</p>`
			: `<select aria-label="Оружие для ${e(scav.name)}" data-equip="${scav.id}"><option value="">Без оружия</option>${state.weapons
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
					)}</select><div class="scav-action"><span class="chance" title="Вероятность успешного возвращения">${Math.round(getRaidChance(state, scav, map) * 100)}% успеха<br><small class="muted">${seconds(getRaidDuration(state, scav, map))} · ${map.ammoCost} патр.</small></span><button class="button small" data-action="dispatch" data-id="${scav.id}" ${!weapon || scav.health < 25 ? "disabled" : ""}>В рейд ${icon("arrow", 14)}</button></div>${scav.health < 100 ? `<button style="width:100%;margin-top:10px" class="button ghost small" data-action="heal" data-id="${scav.id}">Лечить медикаментами</button>` : ""}`
	}</article>`;
}
function contractCard(contract: Contract) {
	const progress = getContractProgress(state, contract),
		claimed = state.claimedContracts.includes(contract.id),
		available = state.level >= contract.level,
		ready = available && progress >= contract.target;
	return `<article class="contract"><div class="contract-mark">${icon(claimed ? "check" : "contracts", 21)}</div><div class="contract-copy"><h3>${e(contract.name)}</h3><p>${e(contract.description)}</p><div class="progress"><i style="width:${Math.min(100, (progress / contract.target) * 100)}%"></i></div><small>${Math.min(contract.target, progress)} / ${contract.target}${!available ? ` · Нужен уровень ${contract.level}` : ""}</small></div><div class="contract-reward"><span>+${n(contract.reward.money)} ₽</span><span class="muted">+${contract.reward.xp} опыта</span><button class="button secondary small" data-action="claim" data-id="${contract.id}" ${!ready || claimed ? "disabled" : ""}>${claimed ? "Выполнено" : ready ? "Забрать" : "В работе"}</button></div></article>`;
}
function render() {
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
			)}</div><div class="section-head"><h2>Твои люди <span class="muted">/ ${state.scavs.length}</span></h2><button class="link-button" data-page="raids">Управлять отрядом →</button></div><div class="card-grid">${state.scavs.slice(0, 3).map(scavCard).join("") || '<div class="empty">Отряд пуст. Найми дикого в разделе «Рейды» — первый после потери отряда приходит бесплатно.</div>'}</div><div class="section-head"><h2>Прапор поручил</h2><button class="link-button" data-page="contracts">Все контракты →</button></div><div class="quick-contracts">${
			CONTRACTS.filter((c) => !state.claimedContracts.includes(c.id))
				.slice(0, 2)
				.map(contractCard)
				.join("") ||
			'<div class="empty">Все контракты закрыты. База работает, рейды продолжаются.</div>'
		}</div>`;
	if (page === "raids") {
		const map = MAP_BY_ID[selectedMap]!;
		panel.innerHTML = `<div class="section-head"><h2>Выбери сектор</h2><span class="muted">${MAPS.filter((m) => state.level >= m.level).length} / ${MAPS.length} открыто</span></div><div class="maps">${MAPS.map((m, i) => `<button class="map-card ${m.id === selectedMap ? "selected" : ""} ${state.level < m.level ? "locked" : ""}" data-map="${m.id}" ${state.level < m.level ? "disabled" : ""}><span class="map-graphic">${icon("raids", 100)}</span><span class="map-index">СЕКТОР 0${i + 1}${state.level < m.level ? ` · ${icon("lock", 10)} УР. ${m.level}` : ""}</span><h3>${e(m.name)}</h3><p>${e(m.subtitle)}</p><div class="map-meta"><span>${seconds(m.duration)} · ${m.ammoCost} патр.${m.intelCost ? ` · ${m.intelCost} разв.` : ""}</span><span>${m.reward[0]}–${m.reward[1]} ₽</span></div></button>`).join("")}</div><div class="raid-instruction">${icon("raids", 24)}<div><strong>${e(map.name)}</strong> · ${e(map.description)}<br><span class="muted">При провале теряются припасы, возможна потеря снаряжения и бойца. Шанс зависит от здоровья, оружия, навыков и радиорубки.</span></div></div><div class="section-head"><h2>Снаряжение отряда</h2><button class="button secondary small" data-action="recruit" ${state.scavs.length >= getScavCapacity(state) ? "disabled" : ""}>${icon("people", 15)} Нанять · ${recruitCost(state)} ₽</button></div><div class="card-grid">${state.scavs.map(scavCard).join("") || '<div class="empty">Отряд потерян. Найми нового дикого бесплатно и начни снова.</div>'}</div><p class="muted" style="font-size:11px;margin-top:15px">Отряд: ${state.scavs.length} / ${getScavCapacity(state)} · Улучшай радиорубку, чтобы нанимать больше диких. Медблок восстанавливает здоровье со временем.</p>`;
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
			)}</div><div class="raid-instruction">${icon("time", 24)}<div>Работа не останавливается, когда ты уходишь.<br><span class="muted">При возвращении начисляется до 8 часов дохода, производства и лечения. Рейды завершаются автоматически один раз. Повторные рейды запускай сам.</span></div></div>`;
	}
	if (page === "contracts")
		panel.innerHTML = CONTRACTS.map(contractCard).join("");
	if (page === "journal")
		panel.innerHTML = state.history.length
			? `<div class="section-head"><h2>Последние ${state.history.length} выходов</h2><span class="muted">Всего: ${state.stats.raidsCompleted}</span></div>${state.history.map((report) => `<article class="journal-row"><time>${new Date(report.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time><span><strong>${e(report.scavName)} · ${e(MAP_BY_ID[report.mapId]!.name)}</strong><br>${e(report.description)}${report.weaponId ? `<br><span style="color:${RARITY_COLORS[WEAPON_BY_ID[report.weaponId]!.rarity]}">${e(WEAPON_BY_ID[report.weaponId]!.name)}${report.weaponAutoSold ? " · продано: арсенал заполнен" : ""}</span>` : ""}<br><small class="muted">${report.money ? `+${report.money} ₽ · ` : ""}Патроны +${report.supplies.ammo} · детали +${report.supplies.scrap} · разведданные +${report.supplies.intel}</small></span><b class="tag" style="color:${report.success ? "var(--green)" : "var(--red)"}">${report.success ? "ВЕРНУЛСЯ" : "ПРОВАЛ"}</b></article>`).join("")}`
			: '<div class="empty">Радио пока молчит.<br>Отправь дикого в первый рейд — здесь появится его отчёт.</div>';
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
		`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><h2 id="settings-title">Твоё дело — при тебе.</h2><p>Прогресс хранится в этом браузере. Перед сменой устройства экспортируй сохранение. При возвращении база начисляет до 8 часов дохода и завершает отправленные рейды.</p><p>Начни с «Дворов»: выбери дикого и оружие, отправь в рейд. Забери награду контракта «Первый выход», затем развивай мастерскую и радиорубку.</p><div class="detail-actions"><button class="button secondary" data-action="export">Экспорт</button><button class="button ghost" data-action="import">Импорт</button></div><input type="file" accept="application/json,.json" id="save-file" hidden><div class="save-note">Один рейд — один результат. Сохранение восстанавливает отряд, оружие, улучшения и рейды. Импорт заменит текущий прогресс после проверки файла.</div><button class="button ghost" style="width:100%;margin-top:20px" data-action="close-modal">Продолжить</button></section></div>`;
	(
		document.querySelector('[data-action="export"]') as HTMLButtonElement
	).focus();
}
document.addEventListener("click", (event) => {
	const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
		"button"
	);
	if (!target || target.disabled) return;
	if (target.dataset.page) {
		page = target.dataset.page as Page;
		render();
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
	const id = target.dataset.id ?? "";
	switch (target.dataset.action) {
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
				new Blob([saveGame(state)], { type: "application/json" })
			);
			const a = document.createElement("a");
			a.href = url;
			a.download = "prapor-save.json";
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			toast("Сохранение экспортировано.");
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
	if (target.id === "save-file") {
		const file = (target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 1_000_000) {
			toast("Файл слишком большой.", false);
			return;
		}
		try {
			const next = loadGame(await file.text());
			if (!next) {
				toast("Сохранение повреждено или имеет другую версию.", false);
				return;
			}
			const old = state;
			state = next;
			if (!persist()) {
				state = old;
				toast("Импорт отменён: браузер не смог записать сохранение.", false);
				return;
			}
			document.querySelector("#modal-root")!.innerHTML = "";
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
			state.level >= contract.level &&
			getContractProgress(state, contract) >= contract.target
	).length;
const rosterHealth = () =>
	state.scavs
		.map((scav) => `${scav.id}:${scav.status}:${scav.health === 100}`)
		.join(";");
setInterval(() => {
	const beforeLevel = state.level,
		beforeHealth = rosterHealth(),
		beforeContracts = readyContracts();
	const summary = advance(state);
	hud();
	if (
		summary.completed.length ||
		state.level !== beforeLevel ||
		rosterHealth() !== beforeHealth ||
		readyContracts() !== beforeContracts
	) {
		render();
		for (const report of summary.completed)
			toast(`${report.scavName}: ${report.description}`, report.success);
	}
	if (++ticks % 5 === 0) persist();
}, 1000);
document.addEventListener("visibilitychange", () => {
	if (document.hidden) persist();
	else {
		const summary = advance(state);
		render();
		if (summary.completed.length)
			toast(
				`Пока тебя не было, завершено рейдов: ${summary.completed.length}. Отчёты в журнале.`
			);
	}
});
window.addEventListener("pagehide", persist);
if (raw && !loadGame(raw)) {
	toast(
		"Сохранение не удалось прочитать. Исходный файл остаётся в браузере до первого нового сохранения.",
		false
	);
} else if (raw) {
	const previous = JSON.parse(raw) as { lastUpdated: number };
	const elapsed = (Date.now() - previous.lastUpdated) / 60000;
	if (elapsed >= 1)
		toast(
			`С возвращением. База отработала ${Math.min(480, Math.floor(elapsed))} мин. Проверь арсенал и журнал.`
		);
}
