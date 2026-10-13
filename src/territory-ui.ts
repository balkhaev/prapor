import { ROOM_DEFINITIONS, getRoomFootprint, getRoomBounds, getRoomFacing, getRoomLocalSize, getShelterSites, type GameState, type RoomInstance, type ShelterRoomType } from "./game/engine";
import { getLootRequirementQuote } from './game/loot-uses';
import { lootRequirementsPanel } from './loot-materials-ui';
import { roomMiniArt } from "./command-art";
import { getTerritoryPlanLayout } from "./territory-plan";
import type { ShelterLandscapeDecoration } from "./shelter-landscape";

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export interface BuildingPlacement { type: ShelterRoomType; roomId?: string; rotation: 0 | 1; facing?: 0 | 1 | 2 | 3; site: { column: number; row: number } | null; point?: { x: number; y: number } | null }
export const BUILDING_FACING_LABELS = ["во двор", "влево", "к задней границе", "вправо"] as const;
export function buildingCatalogueReason(state: GameState, type: ShelterRoomType): string | null {
	const info = ROOM_DEFINITIONS[type], unlock = info.unlockLevel ?? 1;
	return state.level < unlock ? `Откроется на уровне ${unlock}` : state.money < info.cost.money || state.supplies.scrap < info.cost.scrap ? "Не хватает рублей или деталей" : getLootRequirementQuote(state,info.lootRequirements).reason;
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

function planRoof(room: RoomInstance): string {
	const { width, height } = getRoomLocalSize(room), facing = getRoomFacing(room), bounds = getRoomBounds(room);
	const color = ROOM_DEFINITIONS[room.type].color;
	const turn = facing === 1 ? `translate(${height} 0) rotate(90)` : facing === 2 ? `translate(${width} ${height}) rotate(180)` : facing === 3 ? `translate(0 ${width}) rotate(-90)` : "";
	const seams = Array.from({ length: Math.max(4, Math.floor(width / 26)) }, (_, index) => {
		const x = 12 + index * (width - 24) / Math.max(3, Math.floor(width / 26) - 1);
		return `<path d="M${x} 9V${height - 9}" stroke="#172e2b" stroke-width="1.4" opacity=".2"/>`;
	}).join("");
	const feature = room.type === "medbay" ? `<path d="M${width - 31} 19v22m-11-11h22" stroke="#e7ead8" stroke-width="7" opacity=".75"/>`
		: room.type === "radio" ? `<circle cx="${width - 27}" cy="26" r="9" fill="#d0d9cb" stroke="#425854" stroke-width="2"/><path d="M${width - 27} 26l14-16m-6 0h6v6" stroke="#b4c4bd" stroke-width="3"/>`
		: room.type === "workshop" || room.type === "ammo" ? `<rect x="${width - 29}" y="14" width="13" height="17" rx="1" fill="#38443e" stroke="#a8ac96" stroke-width="2"/><rect x="${width - 32}" y="12" width="19" height="5" fill="#727465"/>`
		: `<rect x="15" y="14" width="${Math.min(width / 3, 52)}" height="12" rx="2" fill="#b3bcb0" opacity=".3" stroke="#273e34" stroke-width="2"/>`;
	return `<svg class="territory-roof" viewBox="0 0 ${bounds.width} ${bounds.height}" preserveAspectRatio="none" aria-hidden="true"><g transform="${turn}"><rect x="0" y="0" width="${width}" height="${height}" rx="4" fill="#263932"/><path d="M4 4H${width - 4}V${height / 2}H4Z" fill="${color}"/><path d="M4 ${height / 2}H${width - 4}V${height - 4}H4Z" fill="${color}" opacity=".67"/>${seams}<path d="M4 ${height / 2}H${width - 4}" stroke="#e1d3a7" stroke-width="3" opacity=".4"/><path d="M4 4H${width - 4}V${height - 4}H4Z" fill="none" stroke="#d0c4a0" stroke-width="2" opacity=".6"/>${feature}<rect x="${width / 2 - 17}" y="${height - 5}" width="34" height="8" rx="1" fill="#2b3d32" stroke="#d2c6a2" stroke-width="2"/><path d="M${width / 2 - 12} ${height + 8}H${width / 2 + 12}" stroke="#c7b797" stroke-width="4"/></g></svg>`;
}

function planDecoration(decoration: ShelterLandscapeDecoration): string {
	const { point: { x, y }, radius, kind, seed } = decoration;
	if (kind === "gate") return `<path d="M${x - 28} ${y}v-16m56 16v-16" stroke="#c7baa0" stroke-width="5"/><path d="M${x - 27} ${y - 10}l-16-8m70 8l16-8" stroke="#8f9c7a" stroke-width="3"/>`;
	if (kind === "tree" || kind === "bush") return `<g opacity="${decoration.owned ? ".8" : ".7"}"><ellipse cx="${x + 7}" cy="${y + 8}" rx="${radius + 3}" ry="${radius * .75}" fill="#102a22" opacity=".4"/><circle cx="${x}" cy="${y}" r="${radius}" fill="${kind === "tree" ? "#365944" : "#66825a"}"/><circle cx="${x - radius * .3}" cy="${y - radius * .27}" r="${radius * .7}" fill="${seed % 2 ? "#597550" : "#486e50"}"/><circle cx="${x + radius * .35}" cy="${y + radius * .2}" r="${radius * .6}" fill="#2f533e"/><path d="M${x - 4} ${y + 4}l7-9" stroke="#859471" stroke-width="2" opacity=".45"/></g>`;
	if (kind === "puddle") return `<ellipse cx="${x}" cy="${y}" rx="${radius}" ry="${radius * .6}" fill="#9caaa1" opacity=".3"/><path d="M${x - radius / 2} ${y - 2}h${radius * .8}" stroke="#c4c9b6" stroke-width="2" opacity=".3"/>`;
	if (kind === "rock" || kind === "stump") return `<path d="M${x - radius} ${y}l${radius / 2}-${radius * .7}h${radius}l${radius / 2} ${radius * .9}l-${radius} ${radius * .5}Z" fill="${kind === "rock" ? "#899483" : "#918062"}" opacity=".65"/>`;
	if (kind === "logs" || kind === "woodpile") return `<g transform="translate(${x} ${y}) rotate(-16)" stroke="#baa280" stroke-width="5">${[-5, 1, 7].map(offset => `<path d="M-${radius} ${offset}h${radius * 1.7}"/>`).join("")}</g>`;
	if (kind === "bench") return `<g transform="translate(${x} ${y}) rotate(-12)"><rect x="-15" y="-6" width="30" height="12" rx="2" fill="#b39a73"/><path d="M-10-9v18m20-18v18" stroke="#364737" stroke-width="3"/></g>`;
	if (kind === "camp") return `<circle cx="${x}" cy="${y}" r="12" fill="#394e3d" stroke="#b7aa89" stroke-width="4"/><path d="M${x - 6} ${y + 3}l12-6m-11-2l9 9" stroke="#bda078" stroke-width="4"/>`;
	if (kind === "barrels") return `<circle cx="${x - 5}" cy="${y}" r="6" fill="#7b8676" stroke="#2f4839" stroke-width="2"/><circle cx="${x + 5}" cy="${y + 6}" r="6" fill="#9f9c7c" stroke="#2f4839" stroke-width="2"/>`;
	if (kind === "fern") return `<path d="M${x} ${y + 6}v-14m0 5l-6-4m6 9l7-5m-7 2l-5-2" stroke="#6b8058" stroke-width="2" fill="none"/>`;
	return `<circle cx="${x}" cy="${y}" r="4" fill="#dcbd79" opacity=".6"/>`;
}

/** Buildings and map clicks use actual ground coordinates; the owned yard is a single surface. */
export function territoryPlan(state: GameState, selectedId: string | null): string {
	const { bounds, landscape, expansions } = getTerritoryPlanLayout(state);
	const position = (x: number, y: number) => `left:${(x - bounds.x) / bounds.width * 100}%;top:${(y - bounds.y) / bounds.height * 100}%`;
	const ground = landscape.lots.map(rect => `M${rect.x} ${rect.y}h${rect.width}v${rect.height}h-${rect.width}Z`).join("");
	const boundary = landscape.perimeter.map(({ from, to }) => `M${from.x} ${from.y}L${to.x} ${to.y}`).join("");
	const paths = landscape.paths.map(({ from, to }) => {
		const x = (from.x + to.x) / 2, y = (from.y + to.y) / 2;
		return `<path d="M${from.x} ${from.y}Q${x + (to.y - from.y) * .035} ${y - (to.x - from.x) * .035} ${to.x} ${to.y}"/>`;
	}).join("");
	const patches = Array.from({ length: Math.min(75, landscape.lots.length * 3 + 9) }, (_, index) => {
		const fraction = (salt: number) => ((Math.imul(index + salt, 1103515245) >>> 0) % 1000) / 1000;
		return `<ellipse cx="${bounds.x + fraction(17) * bounds.width}" cy="${bounds.y + fraction(73) * bounds.height}" rx="${27 + fraction(41) * 96}" ry="${14 + fraction(109) * 46}" fill="${index % 3 ? "#b0ac7c" : "#3c6547"}" opacity="${index % 3 ? ".13" : ".18"}" transform="rotate(${fraction(37) * 60 - 30} ${bounds.x + fraction(17) * bounds.width} ${bounds.y + fraction(73) * bounds.height})"/>`;
	}).join("");
	const buildings = state.shelter.rooms.map(room => {
		const rect = getRoomBounds(room), info = ROOM_DEFINITIONS[room.type];
		const placement = `${position(rect.x, rect.y)};width:${rect.width / bounds.width * 100}%;height:${rect.height / bounds.height * 100}%`;
		return `<button class="free-plan-building ${selectedId === room.id ? "active" : ""} ${room.status !== "ready" ? "under-construction" : ""}" data-shelter-room="${escape(room.id)}" data-plan-building-x="${rect.x}" data-plan-building-y="${rect.y}" data-plan-building-width="${rect.width}" data-plan-building-height="${rect.height}" style="${placement};--room-color:${info.color}" aria-label="Управлять постройкой: ${escape(info.label)}">${planRoof(room)}<span class="territory-map-building-label"><strong>${escape(info.label)}</strong><small>${room.status === "ready" ? `Ур. ${room.level}` : "Строительство"}</small></span></button>`;
	}).join("");
	const border = expansions.map(({ site, point, side, label, progress }) => {
		return `<button class="territory-map-expansion ${side} ${progress !== null ? "in-progress" : ""}" data-shelter-column="${site.column}" data-shelter-row="${site.row}" style="${position(point.x, point.y)}" aria-label="${progress !== null ? `Подготовка новой земли: ${progress}%` : `Расширить территорию: ${label.toLowerCase()}`}"><b aria-hidden="true">${progress !== null ? `${progress}%` : "+"}</b><span>${progress !== null ? "Подготовка земли" : label}</span></button>`;
	}).join("");
	return `<div class="territory-plan-caption"><span>Вид сверху</span><small>Здания стоят там, где ты их разместил</small></div><div class="territory-plan-scroll"><div class="territory-plan" data-territory-plan data-plan-origin-x="${bounds.x}" data-plan-origin-y="${bounds.y}" data-plan-width="${bounds.width}" data-plan-height="${bounds.height}" role="group" aria-label="План территории базы" style="aspect-ratio:${bounds.width}/${bounds.height};min-width:${Math.max(540, bounds.width * .57)}px"><button class="territory-plan-ground" data-action="choose-plan-ground" aria-label="Выбрать место во дворе"></button><svg class="territory-map-art" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="territory-ground" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#72815d"/><stop offset="1" stop-color="#566c4e"/></linearGradient><clipPath id="territory-owned"><path d="${ground}"/></clipPath><filter id="territory-earth"><feTurbulence type="fractalNoise" baseFrequency=".12" numOctaves="3" seed="17"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".13"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter></defs><path d="${ground}" fill="#132f26" transform="translate(6 9)" opacity=".6"/><path d="${ground}" fill="url(#territory-ground)"/><g clip-path="url(#territory-owned)">${patches}<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#839069" opacity=".22" filter="url(#territory-earth)"/><g fill="none" stroke="#344a37" stroke-width="25" stroke-linecap="round" opacity=".2">${paths}</g><g fill="none" stroke="#b4a17c" stroke-width="18" stroke-linecap="round" opacity=".55">${paths}</g><g fill="none" stroke="#d0bf98" stroke-width="9" stroke-linecap="round" opacity=".25">${paths}</g></g><path d="${boundary}" fill="none" stroke="#263f31" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="${boundary}" fill="none" stroke="#c1b591" stroke-width="2" stroke-linecap="round" opacity=".7"/>${landscape.decorations.map(planDecoration).join("")}<text x="${bounds.x + 24}" y="${bounds.y + 31}" fill="#c4c9ae" font-size="13" letter-spacing="3" opacity=".7">ЛЕСНАЯ ОПУШКА</text><path d="M318 107v-16m-5 7l5-7 5 7" stroke="#c0c8b0" stroke-width="2" fill="none" opacity=".6"/><text x="335" y="102" fill="#c4c9ae" font-size="11" opacity=".7">ВЪЕЗД</text></svg>${buildings}${border}</div></div><div class="territory-legend"><span>Постройки и входы</span><span>Свободный двор</span><span>Новая земля за оградой</span></div>`;
}

export function buildingCatalogue(state: GameState): string {
	return `<div class="territory-catalogue" tabindex="-1" aria-label="Доступные постройки">${(Object.keys(ROOM_DEFINITIONS) as ShelterRoomType[]).map(type => {
		const info = ROOM_DEFINITIONS[type], size = getRoomFootprint({ type }), unlock = info.unlockLevel ?? 1;
		const reason = buildingCatalogueReason(state, type);
		return `<article class="territory-blueprint ${state.level < unlock ? "locked" : ""}"><div class="blueprint-art" aria-hidden="true">${roomMiniArt(type, `blueprint-${type}`)}</div><div><h3>${escape(info.label)}</h3><p>${escape(info.description)}</p><span class="tag">${size.width * size.height > 1 ? "Крупная постройка" : "Компактная постройка"}</span> <small>${info.cost.money} ₽ · ${info.cost.scrap} дет. · ${info.buildSeconds} с</small>${lootRequirementsPanel(getLootRequirementQuote(state,info.lootRequirements).requirements,'Предметы для постройки')}</div><button class="button secondary small" data-action="place-building" data-room-type="${type}" ${reason ? "disabled" : ""}>${state.level < unlock ? `Уровень ${unlock}` : "Выбрать место"}</button><small class="quote-note" data-blueprint-reason>${escape(reason ?? "Выбери место внутри периметра")}</small></article>`;
	}).join("")}</div>`;
}

export function buildingPlacementControls(placement: BuildingPlacement, reason: string | null, state?: GameState): string {
	const info = ROOM_DEFINITIONS[placement.type], selected = Boolean(placement.point || placement.site);
	return `<div class="building-placement-copy"><strong>${placement.roomId ? "Перенос" : "Строительство"}: ${escape(info.label)} · вход ${BUILDING_FACING_LABELS[placement.facing ?? 0]}</strong><span role="status">${escape(reason ?? (selected ? "Место подходит. R — поворот. Стрелки двигают контур точнее, Shift — медленнее." : "Выбери точку во дворе. Зелёный контур — можно размещать. R — поворот."))}</span>${state&&!placement.roomId?lootRequirementsPanel(getLootRequirementQuote(state,info.lootRequirements).requirements,'Расход при начале стройки'):''}</div><div class="building-placement-actions"><button class="button secondary small" data-action="placement-plan">План</button><button class="button small" data-action="placement-confirm" ${!selected || reason ? "disabled" : ""}>${placement.roomId ? "Перенести" : `Построить · ${info.cost.money} ₽`}</button><button class="icon-button" data-action="placement-cancel" aria-label="Отменить размещение">×</button></div>`;
}

export function buildingRelocationControls(room: RoomInstance): string {
	return `<section class="room-panel-section building-layout-controls"><h3>Место и вход</h3><p>Вход ${BUILDING_FACING_LABELS[getRoomFacing(room)]}. Перетащи здание в удобное место во дворе. Перенос бесплатный; работники и оплаченные заказы сохранятся.</p><div class="building-layout-actions"><button class="button secondary" data-action="move-building" data-id="${escape(room.id)}" ${room.status !== "ready" ? "disabled" : ""}>Переставить постройку</button></div>${room.status !== "ready" ? '<small class="quote-note">Дождись окончания строительных работ.</small>' : ""}</section>`;
}
