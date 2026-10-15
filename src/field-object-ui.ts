import { scavPortrait } from "./art";
import { roomMiniArt } from "./command-art";
import { getCommandSummary, type CommandRoomTab } from "./command-summary";
import {
	ROOM_DEFINITIONS, RESOURCE_RECIPES, getRoomProductionState, getRoomWorkerCapacity,
	getWeaponDefinition, isScavMedicallyReady, type GameState, type RoomInstance,
} from "./game/engine";
import type { ClientRect } from "./shelter-camera";

export type FieldObjectSelection = { kind: "room" | "scav"; id: string };
export type FieldObjectAnchor = ClientRect & { visible: boolean };
export type FieldScavTab = "equipment" | "orders";
export interface FieldObjectInsets { top?: number; right?: number; bottom?: number; left?: number }
export interface FieldObjectPlacement {
	left: number; top: number; width: number; maxHeight: number;
	anchorX: number; anchorY: number;
	side: "above" | "below" | "docked";
}
export interface FieldObjectOptions {
	root: HTMLElement;
	getState: () => GameState;
	projectRoom: (room: RoomInstance) => FieldObjectAnchor | null;
	projectScav: (id: string) => FieldObjectAnchor | null;
	getScavActivity?: (id: string) => string | null | undefined;
	onRoomDetails: (id: string, tab: CommandRoomTab) => void;
	onScavDetails: (id: string, tab: FieldScavTab) => void;
	onClose?: () => void;
	insets?: FieldObjectInsets | (() => FieldObjectInsets);
}
export interface FieldObjectController {
	show: (selection: FieldObjectSelection) => void;
	close: () => void;
	refresh: () => void;
	destroy: () => void;
}

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
const percent = (value: number) => Math.round(clamp(Number.isFinite(value) ? value : 0, 0, 1) * 100);
const duration = (seconds: number) => {
	const whole = Math.max(0, Math.ceil(seconds));
	return whole >= 60 ? `${Math.floor(whole / 60)} мин ${whole % 60} с` : `${whole} с`;
};

/** Projected anchors are client coordinates; the card is positioned in its own overlay. */
export function placeFieldObjectCard(
	anchor: FieldObjectAnchor, surface: ClientRect, card: { width: number; height: number }, insets: FieldObjectInsets = {},
): FieldObjectPlacement | null {
	if (![anchor.left, anchor.top, anchor.width, anchor.height, surface.left, surface.top, surface.width, surface.height, card.width, card.height].every(Number.isFinite)
		|| surface.width <= 0 || surface.height <= 0 || card.width <= 0 || card.height <= 0) return null;
	const pad = (value: number | undefined, fallback: number) => Number.isFinite(value) ? Math.max(0, value!) : fallback;
	const left = Math.min(pad(insets.left, 16), surface.width / 3), right = Math.min(pad(insets.right, 16), surface.width / 3);
	const top = Math.min(pad(insets.top, 88), surface.height / 3), bottom = Math.min(pad(insets.bottom, 90), surface.height / 3);
	const width = Math.min(card.width, surface.width - left - right), maxHeight = surface.height - top - bottom;
	const height = Math.min(card.height, maxHeight), x = anchor.left + anchor.width / 2 - surface.left;
	const roof = anchor.top - surface.top, feet = roof + anchor.height, gap = 16;
	if (surface.width <= 600 || !anchor.visible) {
		const cardLeft = surface.width <= 600 ? (surface.width - width) / 2 : surface.width - right - width;
		return { left: cardLeft, top: surface.height - bottom - height, width, maxHeight, anchorX: x - cardLeft, anchorY: feet - (surface.height - bottom - height), side: "docked" };
	}
	const above = roof - gap - height, below = feet + gap;
	const spaceAbove = roof - gap - top, spaceBelow = surface.height - bottom - below;
	const side = spaceAbove >= height || spaceAbove >= spaceBelow ? "above" : "below";
	const cardLeft = clamp(x - width / 2, left, surface.width - right - width);
	const cardTop = clamp(side === "above" ? above : below, top, surface.height - bottom - height);
	return { left: cardLeft, top: cardTop, width, maxHeight, anchorX: x - cardLeft, anchorY: (side === "above" ? roof : feet) - cardTop, side };
}

const closeButton = '<button type="button" class="field-object-close" data-field-object-action="close" aria-label="Закрыть карточку">×</button>';
const action = (key: string, label: string, primary = false) => `<button type="button" class="field-object-action${primary ? " is-primary" : ""}" data-field-object-action="${key}">${label}</button>`;

/** The compact card reads the same jobs, assignments and medical state as the full inspector. */
export function fieldObjectContent(state: GameState, selection: FieldObjectSelection, activity?: string | null): string | null {
	if (selection.kind === "room") {
		const room = state.shelter.rooms.find(candidate => candidate.id === selection.id);
		if (!room) return null;
		const definition = ROOM_DEFINITIONS[room.type], production = getRoomProductionState(state, room);
		const status = getCommandSummary(state).rooms.find(candidate => candidate.roomId === room.id)!;
		const progress = percent(production.progress), running = Boolean(room.construction || production.job);
		const recipe = production.job && RESOURCE_RECIPES.find(candidate => candidate.id === production.job!.recipeId);
		const job = room.construction ? room.status === "building" ? "Строительство" : `Уровень ${room.construction.targetLevel}` : recipe?.label ?? "Текущая партия";
		const tone = status.kind === "running" || status.kind === "ready" || status.kind === "passive" ? "good" : status.kind === "building" ? "neutral" : "attention";
		return `<div class="field-object-header"><span class="field-object-symbol" aria-hidden="true">${roomMiniArt(room.type, "field-room")}</span><div class="field-object-copy"><span class="field-object-kicker">Постройка · ур. ${room.level || "—"}</span><h3>${escape(definition.label)}</h3></div>${closeButton}</div>
<div class="field-object-status" data-tone="${tone}"><i aria-hidden="true"></i><strong>${escape(status.title)}</strong></div>
<p class="field-object-note" title="${escape(status.detail)}">${escape(status.detail)}</p>
<div class="field-object-meta">${definition.production ? `<span>Люди <b>${room.workerIds.length} / ${getRoomWorkerCapacity(room)}</b></span><span>Очередь <b>${room.queue.length}</b></span>` : '<span>Обеспечение базы <b>Постоянно</b></span>'}</div>
${running ? `<div class="field-object-production"><div><span>${escape(job)}</span><b>${production.remainingSeconds === null ? `${progress}%` : duration(production.remainingSeconds)}</b></div><progress class="field-object-progress" value="${progress}" max="100" aria-label="${escape(job)}: ${progress}%"></progress></div>` : ""}
<div class="field-object-actions">${definition.production ? action("room-staff", "Люди", status.tab === "staff") + action("room-production", "Производство", status.tab === "production") : ""}${action("room-upgrade", "Развитие", status.tab === "upgrade")}</div>`;
	}
	const scav = state.scavs.find(candidate => candidate.id === selection.id);
	if (!scav) return null;
	const room = state.shelter.rooms.find(candidate => candidate.id === scav.assignment && candidate.workerIds.includes(scav.id));
	const raid = state.raids.find(candidate => candidate.scavId === scav.id);
	const medicallyReady = isScavMedicallyReady(scav), health = percent(scav.health / 100);
	const status = raid?.expedition?.status === "choice" ? "Ждёт приказа" : raid || scav.status === "raiding" ? "В рейде" : scav.medicalTreatment ? "Лечится" : !medicallyReady ? "Восстанавливается" : activity || (room ? `Работает: ${ROOM_DEFINITIONS[room.type].label}` : "Свободен на базе");
	const weapon = state.weapons.find(candidate => candidate.id === scav.weaponInstanceId);
	return `<div class="field-object-header"><span class="field-object-portrait">${scavPortrait(scav.personality, scav.name, scav.appearance)}</span><div class="field-object-copy"><span class="field-object-kicker">Дикий · ур. ${scav.level}</span><h3>${escape(scav.name)}</h3></div>${closeButton}</div>
<div class="field-object-status" data-tone="${medicallyReady ? "good" : "attention"}"><i aria-hidden="true"></i><strong>${escape(status)}</strong></div>
<div class="field-object-meta"><span>Здоровье <b>${health} / 100</b></span><span>Выходы <b>${scav.raids}</b></span></div>
<progress class="field-object-progress field-object-health" value="${health}" max="100" aria-label="Здоровье: ${health} из 100"></progress>
<p class="field-object-weapon">${escape(weapon ? getWeaponDefinition(weapon).name : "Оружие не выдано")}</p>
<div class="field-object-actions">${action("scav-equipment", "Снаряжение", !raid)}${action("scav-orders", "Приказы", Boolean(raid))}</div>`;
}

/** Selection survives refreshes and camera movement. Only explicit show/close changes it. */
export function mountFieldObjectUI(options: FieldObjectOptions): FieldObjectController {
	const document = options.root.ownerDocument;
	const card = document.createElement("section");
	card.className = "field-object-card";
	card.setAttribute("role", "region");
	card.setAttribute("aria-label", "Выбранный объект");
	card.hidden = true;
	options.root.append(card);
	let selection: FieldObjectSelection | null = null, signature = "", frame = 0, lastContent = 0, destroyed = false;
	const view = document.defaultView!;
	const position = () => {
		if (!selection || destroyed) return;
		const state = options.getState();
		const room = selection.kind === "room" ? state.shelter.rooms.find(candidate => candidate.id === selection!.id) : null;
		const anchor = selection.kind === "room" ? room ? options.projectRoom(room) : null : options.projectScav(selection.id);
		if (!anchor) { card.hidden = true; return; }
		card.hidden = false;
		const surface = options.root.getBoundingClientRect();
		const insets = typeof options.insets === "function" ? options.insets() : options.insets;
		const placement = placeFieldObjectCard(anchor, surface, { width: Math.min(320, surface.width - 32), height: card.offsetHeight || 250 }, insets);
		if (!placement) { card.hidden = true; return; }
		card.dataset.side = placement.side;
		card.dataset.offscreen = String(!anchor.visible);
		card.style.left = `${placement.left}px`;
		card.style.top = `${placement.top}px`;
		card.style.width = `${placement.width}px`;
		card.style.maxHeight = `${placement.maxHeight}px`;
		card.style.setProperty("--field-anchor-x", `${clamp(placement.anchorX, 20, placement.width - 20)}px`);
		card.style.setProperty("--field-anchor-y", `${placement.anchorY}px`);
	};
	const refresh = () => {
		if (!selection || destroyed) return;
		const content = fieldObjectContent(options.getState(), selection, selection.kind === "scav" ? options.getScavActivity?.(selection.id) : null);
		if (content === null) { card.hidden = true; return; }
		if (content !== signature) {
			const focus = card.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.fieldObjectAction : undefined;
			card.innerHTML = content;
			card.dataset.kind = selection.kind;
			card.dataset.objectId = selection.id;
			card.setAttribute("aria-label", selection.kind === "room" ? "Управление постройкой" : "Выбранный боец");
			signature = content;
			if (focus) card.querySelector<HTMLButtonElement>(`[data-field-object-action="${focus}"]`)?.focus({ preventScroll: true });
		}
		position();
	};
	const animate = (time: number) => {
		frame = 0;
		if (!selection || destroyed) return;
		if (time - lastContent >= 500) { lastContent = time; refresh(); } else position();
		frame = view.requestAnimationFrame(animate);
	};
	const close = () => {
		if (!selection) return;
		selection = null; card.hidden = true;
		if (frame) view.cancelAnimationFrame(frame);
		frame = 0;
		options.onClose?.();
	};
	const click = (event: MouseEvent) => {
		const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-field-object-action]");
		if (!button || !selection) return;
		event.stopPropagation();
		const key = button.dataset.fieldObjectAction;
		if (key === "close") close();
		else if (selection.kind === "room" && key?.startsWith("room-")) options.onRoomDetails(selection.id, key.slice(5) as CommandRoomTab);
		else if (selection.kind === "scav" && key?.startsWith("scav-")) options.onScavDetails(selection.id, key.slice(5) as FieldScavTab);
	};
	const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && !card.hidden) { event.stopPropagation(); close(); } };
	card.addEventListener("click", click);
	card.addEventListener("keydown", keydown);
	return {
		show(next) {
			if (destroyed) return;
			selection = { ...next }; refresh();
			if (!frame) frame = view.requestAnimationFrame(animate);
		},
		close, refresh,
		destroy() {
			destroyed = true;
			if (frame) view.cancelAnimationFrame(frame);
			selection = null;
			card.removeEventListener("click", click); card.removeEventListener("keydown", keydown); card.remove();
		},
	};
}
