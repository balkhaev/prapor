import { ROOM_DEFINITIONS, getRoomFootprint, getRoomBounds, getShelterSites, getShelterFrontier, getShelterRoomAt, type GameState, type RoomInstance, type ShelterRoomType } from "./game/engine";
import { roomMiniArt } from "./command-art";

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export interface BuildingPlacement { type: ShelterRoomType; roomId?: string; rotation: 0 | 1; site: { column: number; row: number } | null; point?: { x: number; y: number } | null }
export function buildingCatalogueReason(state: GameState, type: ShelterRoomType): string | null {
	const info = ROOM_DEFINITIONS[type], unlock = info.unlockLevel ?? 1;
	return state.level < unlock ? `Откроется на уровне ${unlock}` : state.money < info.cost.money || state.supplies.scrap < info.cost.scrap ? "Не хватает рублей или деталей" : null;
}

export function territorySummary(state: GameState): string {
	const total = getShelterSites(state.shelter).length, area = total * 192 * 132;
	const occupied = state.shelter.rooms.reduce((sum, room) => { const bounds = getRoomBounds(room); return sum + bounds.width * bounds.height; }, 0);
	const free = Math.max(0, Math.round((area - occupied) / area * 100));
	return `<section class="territory-summary"><div><span class="eyebrow">Твоя территория</span><h2>База · ${state.shelter.rooms.length} построек</h2><p>Перетаскивай здания прямо по двору. Место выбираешь свободно.</p></div><div class="territory-space"><strong>${free}%</strong><span>свободной земли</span></div></section>`;
}

export function territoryBuildings(state: GameState, selectedId: string | null): string {
	return `<div class="territory-building-list">${state.shelter.rooms.map(room => {
		const info = ROOM_DEFINITIONS[room.type];
		return `<button class="territory-building-card ${selectedId === room.id ? "active" : ""}" data-shelter-room="${escape(room.id)}" style="--room-color:${info.color}" aria-label="Управлять постройкой: ${escape(info.label)}"><span class="territory-building-art">${roomMiniArt(room.type, `yard-${room.id}`).replace('<svg ', '<svg aria-hidden="true" ')}</span><span class="territory-building-copy"><strong>${escape(info.label)}</strong><small>Уровень ${room.level || "—"} · ${info.production ? `${room.workerIds.length} работников` : "Без персонала"}</small><span data-room-status="${escape(room.id)}">${room.status === "ready" ? "На базе" : "Строительные работы"}</span></span><span class="territory-building-arrow" aria-hidden="true">↗</span></button>`;
	}).join("")}</div>`;
}

/** This is a spatial, keyboard-accessible plan, not a sorted list of rooms. */
export function territoryPlan(state: GameState, selectedId: string | null): string {
	const sites = getShelterSites(state.shelter), frontier = getShelterFrontier(state.shelter), cells = [...sites, ...frontier, ...state.shelter.expansions];
	const left = Math.min(...cells.map(site => site.column)), top = Math.min(...cells.map(site => site.row));
	const columns = Math.max(...cells.map(site => site.column)) - left + 1;
	const position = (column: number, row: number, width = 1, height = 1) => `grid-column:${column - left + 1}/span ${width};grid-row:${row - top + 1}/span ${height}`;
	const ground = sites.filter(site => !getShelterRoomAt(state.shelter, site.column, site.row)).map(site => `<button class="territory-cell empty" data-shelter-column="${site.column}" data-shelter-row="${site.row}" style="${position(site.column, site.row)}" aria-label="Свободный участок ${site.column}, ${site.row}"><b>+</b><small>${site.column}, ${site.row}</small></button>`).join("");
	const rows = Math.max(...cells.map(site => site.row)) - top + 1;
	const buildings = state.shelter.rooms.map(room => {
		const rect = getRoomBounds(room), info = ROOM_DEFINITIONS[room.type];
		const placement = `left:${(rect.x - (30 + left * 192)) / (columns * 192) * 100}%;top:${(rect.y - (132 + top * 132)) / (rows * 132) * 100}%;width:${rect.width / (columns * 192) * 100}%;height:${rect.height / (rows * 132) * 100}%`;
		return `<button class="territory-cell structure free-plan-building ${selectedId === room.id ? "active" : ""}" data-shelter-room="${escape(room.id)}" style="${placement};--room-color:${info.color}" aria-label="Управлять постройкой: ${escape(info.label)}"><strong>${escape(info.label)}</strong><small>Уровень ${room.level || "—"}</small><span data-room-status="${escape(room.id)}">${room.status === "ready" ? "Готово" : "Строительство"}</span></button>`;
	}).join("");
	const border = [...frontier, ...state.shelter.expansions].map(site => {
		const progress = state.shelter.expansions.find(job => job.column === site.column && job.row === site.row);
		return `<button class="territory-cell frontier" data-shelter-column="${site.column}" data-shelter-row="${site.row}" style="${position(site.column, site.row)}" aria-label="Расширить территорию: ${site.column}, ${site.row}"><b>${progress ? `${Math.floor(progress.workDone / progress.workRequired * 100)}%` : "↗"}</b><small>${progress ? "Подготовка" : "+ участок"}</small></button>`;
	}).join("");
	return `<div class="territory-plan-scroll"><div class="territory-plan" role="group" aria-label="План территории базы" style="--territory-columns:${columns};--territory-rows:${rows}">${ground}${buildings}${border}</div></div><div class="territory-legend"><span>Постройки</span><span>Свободная земля</span><span>Расширение периметра</span></div>`;
}

export function buildingCatalogue(state: GameState): string {
	return `<div class="territory-catalogue">${(Object.keys(ROOM_DEFINITIONS) as ShelterRoomType[]).map(type => {
		const info = ROOM_DEFINITIONS[type], size = getRoomFootprint({ type }), unlock = info.unlockLevel ?? 1;
		const reason = buildingCatalogueReason(state, type);
		return `<article class="territory-blueprint ${state.level < unlock ? "locked" : ""}"><div class="blueprint-footprint" aria-hidden="true" style="--blueprint-columns:${size.width}">${Array.from({ length: size.width * size.height }, () => "<i></i>").join("")}</div><div><h3>${escape(info.label)}</h3><p>${escape(info.description)}</p><span class="tag">${size.width * size.height > 1 ? "Крупная постройка" : "Компактная постройка"}</span> <small>${info.cost.money} ₽ · ${info.cost.scrap} дет. · ${info.buildSeconds} с</small></div><button class="button secondary small" data-action="place-building" data-room-type="${type}" ${reason ? "disabled" : ""}>${state.level < unlock ? `Уровень ${unlock}` : "Выбрать место"}</button><small class="quote-note" data-blueprint-reason>${reason ?? "Выбери место внутри периметра"}</small></article>`;
	}).join("")}</div>`;
}

export function buildingPlacementControls(placement: BuildingPlacement, reason: string | null): string {
	const size = getRoomFootprint(placement), info = ROOM_DEFINITIONS[placement.type], selected = Boolean(placement.point || placement.site);
	return `<div class="building-placement-copy"><strong>${placement.roomId ? "Перенос" : "Строительство"}: ${escape(info.label)}</strong><span role="status">${escape(reason ?? (selected ? "Место подходит. Стрелки двигают контур точнее, Shift — медленнее." : "Выбери точку во дворе. Зелёный контур — можно размещать."))}</span></div><div class="building-placement-actions"><button class="button ghost small" data-action="placement-rotate" ${size.width === size.height ? "disabled" : ""} aria-label="Повернуть постройку">↻ Повернуть</button><button class="button secondary small" data-action="placement-plan">План</button><button class="button small" data-action="placement-confirm" ${!selected || reason ? "disabled" : ""}>${placement.roomId ? "Перенести" : `Построить · ${info.cost.money} ₽`}</button><button class="icon-button" data-action="placement-cancel" aria-label="Отменить размещение">×</button></div>`;
}

export function buildingRelocationControls(room: RoomInstance): string {
	return `<section class="room-panel-section building-layout-controls"><h3>Место на территории</h3><p>Перетащи здание прямо по двору или выбери точку кнопкой ниже. Перенос бесплатный; работники и оплаченные заказы сохранятся.</p><button class="button secondary" data-action="move-building" data-id="${escape(room.id)}" ${room.status !== "ready" ? "disabled" : ""}>Переставить постройку</button>${room.status !== "ready" ? '<small class="quote-note">Дождись окончания строительных работ.</small>' : ""}</section>`;
}
