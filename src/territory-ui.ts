import { ROOM_DEFINITIONS, getRoomFootprint, getRoomBounds, getRoomFacing, getShelterSites, type GameState, type RoomInstance, type ShelterRoomType } from "./game/engine";
import { getLootRequirementQuote } from './game/loot-uses';
import { lootRequirementsPanel } from './loot-materials-ui';
import { roomMiniArt } from "./command-art";
import { getTerritoryPlanLayout } from "./territory-plan";
import type { ShelterLandscapeDecoration } from "./shelter-landscape";
import { projectShelterPoint, shelterBuildingDepth, shelterBuildingHitPolygon } from "./shelter-isometric";
import { paintIsometricRoom } from "./shelter-isometric-art";
import type Phaser from "phaser";

type PlanPoint = { x: number; y: number };
const pointList = (points: readonly PlanPoint[]) => points.map(point => `${point.x},${point.y}`).join(" ");
const projectionOrigin = projectShelterPoint({ x: 0, y: 0 });
const projectionX = projectShelterPoint({ x: 1, y: 0 });
const projectionY = projectShelterPoint({ x: 0, y: 1 });
const groundTransform = `matrix(${projectionX.x - projectionOrigin.x} ${projectionX.y - projectionOrigin.y} ${projectionY.x - projectionOrigin.x} ${projectionY.y - projectionOrigin.y} ${projectionOrigin.x} ${projectionOrigin.y})`;

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

/** Reuse the live base painter so roofs, doors and interior equipment stay consistent. */
function planBuilding(room: RoomInstance, hull: readonly PlanPoint[], extent: { x: number; y: number; width: number; height: number }): string {
	let fill = "#000000", stroke = "#000000", fillAlpha = 1, strokeAlpha = 1, strokeWidth = 1;
	const parts: string[] = [];
	const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
	const graphics = {
		fillStyle(color: number, alpha = 1) { fill = hex(color); fillAlpha = alpha; return graphics; },
		lineStyle(width: number, color: number, alpha = 1) { strokeWidth = width; stroke = hex(color); strokeAlpha = alpha; return graphics; },
		fillPoints(points: PlanPoint[], close = false) { parts.push(`<${close ? "polygon" : "polyline"} points="${pointList(points)}" fill="${fill}" fill-opacity="${fillAlpha}"/>`); return graphics; },
		strokePoints(points: PlanPoint[], close = false) { parts.push(`<${close ? "polygon" : "polyline"} points="${pointList(points)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeAlpha}"/>`); return graphics; },
		lineBetween(x: number, y: number, x2: number, y2: number) { parts.push(`<path d="M${x} ${y}L${x2} ${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeAlpha}" fill="none"/>`); return graphics; },
		fillCircle(x: number, y: number, radius: number) { parts.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" fill-opacity="${fillAlpha}"/>`); return graphics; },
		fillEllipse(x: number, y: number, width: number, height: number) { parts.push(`<ellipse cx="${x}" cy="${y}" rx="${width / 2}" ry="${height / 2}" fill="${fill}" fill-opacity="${fillAlpha}"/>`); return graphics; },
	};
	paintIsometricRoom(graphics as unknown as Phaser.GameObjects.Graphics, room.column, room.row, room);
	return `<svg class="territory-building-art" viewBox="${extent.x} ${extent.y} ${extent.width} ${extent.height}" preserveAspectRatio="none" aria-hidden="true"><g class="territory-building-volume">${parts.join("")}</g><polygon class="territory-building-selection" points="${pointList(hull)}" fill="none"/></svg>`;
}

function flatDecoration(decoration: ShelterLandscapeDecoration): string {
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

function planDecoration(decoration: ShelterLandscapeDecoration): string {
	const { radius, kind, seed } = decoration, { x, y } = projectShelterPoint(decoration.point);
	if (kind === "tree" || kind === "bush") {
		const height = kind === "tree" ? 28 + radius * .85 : 5, r = kind === "tree" ? radius * .85 : radius * .72;
		const canopy = kind === "tree" && seed % 3 === 0
			? `<path d="M0 ${-height - r}L${r * .75} ${-height + r * .1}H${-r * .75}Z" fill="#53714b"/><path d="M0 ${-height - r * .62}L${r} ${-height + r * .5}H${-r}Z" fill="#375b40"/><path d="M0 ${-height - r * .2}L${r * 1.05} ${-height + r * .85}H${-r * 1.05}Z" fill="#2c513b"/><path d="M0 ${-height - r * .8}L${-r * .4} ${-height - r * .1}" stroke="#82926b" stroke-width="1.5" opacity=".4"/>`
			: `<ellipse cx="0" cy="${-height}" rx="${r}" ry="${r * .84}" fill="#31543c"/><ellipse cx="${-r * .28}" cy="${-height - r * .25}" rx="${r * .67}" ry="${r * .64}" fill="${seed % 2 ? "#5b7750" : "#4d714b"}"/><ellipse cx="${r * .33}" cy="${-height + r * .2}" rx="${r * .62}" ry="${r * .57}" fill="#365d40"/><path d="M${-r * .56} ${-height - r * .24}l${r * .32}-${r * .2}" stroke="#a4af82" stroke-width="1.7" opacity=".3"/>`;
		return `<g transform="translate(${x} ${y})" opacity="${decoration.owned ? ".95" : ".8"}"><ellipse cx="${r * .28}" cy="4" rx="${r * .9}" ry="${r * .34}" fill="#102b21" opacity=".32"/>${kind === "tree" ? `<path d="M0 0v-${height}" stroke="#7d6b4c" stroke-width="4"/><path d="M0-10l-${r * .35}-${height * .3}" stroke="#685a41" stroke-width="2"/>` : ""}${canopy}</g>`;
	}
	if (kind === "gate") {
		const a = projectShelterPoint({ x: decoration.point.x - 28, y: decoration.point.y }), b = projectShelterPoint({ x: decoration.point.x + 28, y: decoration.point.y });
		return `<path d="M${a.x} ${a.y}v-18m${b.x - a.x} ${18 + b.y - a.y}v-18" stroke="#bbad8a" stroke-width="3"/><path d="M${a.x} ${a.y - 12}l-12-6m${b.x - a.x + 12} ${b.y - a.y + 6}l12-3" stroke="#829777" stroke-width="2"/>`;
	}
	if (kind === "lamp") return `<g transform="translate(${x} ${y})"><path d="M0 0v-18h5" stroke="#abb594" stroke-width="1.5"/><circle cx="5" cy="-17" r="3" fill="#ead196"/><circle cx="5" cy="-17" r="7" fill="#ead196" opacity=".12"/></g>`;
	return `<g transform="${groundTransform}">${flatDecoration(decoration)}</g>`;
}

/** Buildings and map clicks use actual ground coordinates; the owned yard is a single surface. */
export function territoryPlan(state: GameState, selectedId: string | null): string {
	const { bounds, projectedBounds, landscape, expansions } = getTerritoryPlanLayout(state);
	const position = (x: number, y: number) => `left:${(x - projectedBounds.x) / projectedBounds.width * 100}%;top:${(y - projectedBounds.y) / projectedBounds.height * 100}%`;
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
	const buildings = [...state.shelter.rooms].sort((a, b) => shelterBuildingDepth(getRoomBounds(a)) - shelterBuildingDepth(getRoomBounds(b))).map((room, index) => {
		const rect = getRoomBounds(room), info = ROOM_DEFINITIONS[room.type];
		const hull = shelterBuildingHitPolygon(rect), left = Math.min(...hull.map(point => point.x)), top = Math.min(...hull.map(point => point.y));
		const extent = { x: left, y: top, width: Math.max(...hull.map(point => point.x)) - left, height: Math.max(...hull.map(point => point.y)) - top };
		const clip = hull.map(point => `${(point.x - left) / extent.width * 100}% ${(point.y - top) / extent.height * 100}%`).join(",");
		const placement = `${position(left, top)};width:${extent.width / projectedBounds.width * 100}%;height:${extent.height / projectedBounds.height * 100}%;z-index:${20 + index * 10};clip-path:polygon(${clip})`;
		return `<button class="free-plan-building ${selectedId === room.id ? "active" : ""} ${room.status !== "ready" ? "under-construction" : ""}" data-shelter-room="${escape(room.id)}" data-plan-building-x="${rect.x}" data-plan-building-y="${rect.y}" data-plan-building-width="${rect.width}" data-plan-building-height="${rect.height}" data-plan-building-depth="${shelterBuildingDepth(rect)}" style="${placement};--room-color:${info.color}" aria-label="Управлять постройкой: ${escape(info.label)}">${planBuilding(room, hull, extent)}<span class="territory-map-building-label"><strong>${escape(info.label)}</strong><small>${room.status === "ready" ? `Ур. ${room.level}` : "Строительство"}</small></span></button>`;
	}).join("");
	const border = expansions.map(({ site, point, side, label, progress }) => {
		const at = projectShelterPoint(point);
		return `<button class="territory-map-expansion ${side} ${progress !== null ? "in-progress" : ""}" data-shelter-column="${site.column}" data-shelter-row="${site.row}" style="${position(at.x, at.y)};z-index:${state.shelter.rooms.length * 10 + 40}" aria-label="${progress !== null ? `Подготовка новой земли: ${progress}%` : `Расширить территорию: ${label.toLowerCase()}`}"><b aria-hidden="true">${progress !== null ? `${progress}%` : "+"}</b><span>${progress !== null ? "Подготовка земли" : label}</span></button>`;
	}).join("");
	const fence = landscape.perimeter.map(({ from, to }) => {
		const a = projectShelterPoint(from), b = projectShelterPoint(to), length = Math.hypot(to.x - from.x, to.y - from.y);
		const posts = Array.from({ length: Math.ceil(length / 54) + 1 }, (_, index) => {
			const t = Math.min(1, index * 54 / length), point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
			return `<path d="M${point.x} ${point.y + 1}v-11" stroke="#b4af88" stroke-width="1.8"/>`;
		}).join("");
		return `<path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="#263f31" stroke-width="4"/><path d="M${a.x} ${a.y - 7}L${b.x} ${b.y - 7}" stroke="#829775" stroke-width="1.8"/>${posts}`;
	}).join("");
	const entrance = projectShelterPoint({ x: 318, y: 108 });
	const decorations = [...landscape.decorations].sort((a, b) => projectShelterPoint(a.point).y - projectShelterPoint(b.point).y).map(planDecoration).join("");
	return `<div class="territory-plan-caption"><span>Изометрический план</span><small>Свободный двор · здания на своих местах</small></div>
	<div class="territory-plan-scroll"><div class="territory-plan" data-territory-plan data-plan-projection="isometric" data-plan-origin-x="${projectedBounds.x}" data-plan-origin-y="${projectedBounds.y}" data-plan-width="${projectedBounds.width}" data-plan-height="${projectedBounds.height}" role="group" aria-label="План территории базы" style="aspect-ratio:${projectedBounds.width}/${projectedBounds.height};min-width:${Math.max(560, projectedBounds.width * .62)}px">
	<button class="territory-plan-ground" data-action="choose-plan-ground" aria-label="Выбрать место во дворе"></button>
	<svg class="territory-map-art" viewBox="${projectedBounds.x} ${projectedBounds.y} ${projectedBounds.width} ${projectedBounds.height}" preserveAspectRatio="none" aria-hidden="true">
	<defs><linearGradient id="territory-ground" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#78835f"/><stop offset="1" stop-color="#5b704e"/></linearGradient><clipPath id="territory-owned"><path d="${ground}"/></clipPath><filter id="territory-earth"><feTurbulence type="fractalNoise" baseFrequency=".12" numOctaves="3" seed="17"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".13"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter></defs>
	<g transform="${groundTransform}"><path d="${ground}" fill="#152f25" transform="translate(0 12)" opacity=".75"/><path d="${ground}" fill="url(#territory-ground)"/>
	<g clip-path="url(#territory-owned)">${patches}<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#839069" opacity=".22" filter="url(#territory-earth)"/><g fill="none" stroke="#344a37" stroke-width="25" stroke-linecap="round" opacity=".2">${paths}</g><g fill="none" stroke="#b4a17c" stroke-width="18" stroke-linecap="round" opacity=".55">${paths}</g><g fill="none" stroke="#d0bf98" stroke-width="9" stroke-linecap="round" opacity=".25">${paths}</g></g><path d="${boundary}" fill="none" stroke="#263f31" stroke-width="3" stroke-linejoin="round"/></g>
	<g class="territory-map-fence">${fence}</g>${decorations}<text x="${projectedBounds.x + 24}" y="${projectedBounds.y + 34}" fill="#c4c9ae" font-size="12" letter-spacing="2.5" opacity=".7">ЛЕСНАЯ БАЗА</text><text x="${entrance.x}" y="${entrance.y - 6}" text-anchor="middle" fill="#d0d1b5" font-size="10" opacity=".8">ВЪЕЗД</text></svg>${buildings}${border}</div></div>
	<div class="territory-legend"><span>Постройки и входы</span><span>Свободный двор</span><span>Новая земля за оградой</span></div>`;
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
