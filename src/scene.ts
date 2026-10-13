import Phaser from "phaser";
import { getRaidPhase, type Raid, type RaidReport, type RoomInstance, type WeaponInstance } from "./game/engine";
import { type BaseRoom } from "./game/data";
import { advanceShelterRoute, clientToShelterPoint, getShelterCell, planShelterRoute, SHELTER_SHAFT_X } from "./shelter-motion";
import { clampShelterCamera, focusShelterRect, panShelterCamera, projectShelterRect, resizeShelterCamera, shelterViewportForSize, viewportToShelter, zoomShelterCamera, type ShelterCamera, type ShelterRect, type ShelterViewport, type ClientRect } from "./shelter-camera";
import { advanceShelterLift, createShelterLift, type LiftRequest } from "./shelter-lift";
import { advanceScavAnimation, createScavAnimation, type ScavAnimationState } from "./shelter-animation";
import { advanceShelterStationClock, getShelterProductionPresentation, type ProductionPresentation } from "./shelter-production";
import { projectShelterPoint, unprojectShelterPoint, projectShelterBounds, shelterRoomPolygon, shelterRoomPosition } from "./shelter-isometric";
import { paintIsometricRoom, paintIsometricProduction } from "./shelter-isometric-art";
import { RaidStreetRenderer } from "./raid-scene";

export interface WorldSnapshot {
	base: Record<string, number>;
	raids: Raid[];
	selectedRaidId?: string | null;
	history?: RaidReport[];
	weapons?: WeaponInstance[];
	maps: {
		id: string;
		name: string;
		level: number;
		position: { x: number; y: number };
		accent: string;
	}[];
	level: number;
	selectedScavId?: string | null;
	selectedMapId?: string | null;
	selectedRoomId?: string | null;
	selectedSite?: { column: number; row: number } | null;
	shelter?: { rooms: RoomInstance[] };
	roomProduction?: Record<string, { progress: number; remainingSeconds: number | null; rate: number; status: string; reason: string | null }>;
	scavs?: {
		id: string;
		name?: string;
		status: "ready" | "raiding" | "wounded";
		health: number;
		gear?: { armor: number; backpack: number };
		autoRaid?: { enabled: boolean; waitingReason: string | null };
		assignment?: string | null;
	}[];
}

type Point = { x: number; y: number };
export type WorldView = "base" | "map" | "raid";
type View = WorldView;
type MapPlace = WorldSnapshot["maps"][number];
type ScavActor = {
	actor: Phaser.GameObjects.Container;
	body: Phaser.GameObjects.Container;
	legA: Phaser.GameObjects.Rectangle;
	legB: Phaser.GameObjects.Rectangle;
	hand: Phaser.GameObjects.Rectangle;
	sprite: Phaser.GameObjects.Image | null;
	poses: { idle: Phaser.GameObjects.Image; walkA: Phaser.GameObjects.Image; walkB: Phaser.GameObjects.Image; work: Phaser.GameObjects.Image } | null;
	animation: ScavAnimationState;
	appearance: number;
	gear: Phaser.GameObjects.Graphics;
	tool: Phaser.GameObjects.Graphics;
	label: Phaser.GameObjects.Text;
	order: Phaser.GameObjects.Arc;
	selection: Phaser.GameObjects.Ellipse;
	hovered: boolean;
	gearSignature: string;
	position: Point;
	anchor: Point;
	route: Point[];
	goal: string;
	assignment: string | null;
	role: string;
	dwellUntil: number;
	visit: number;
	facing: -1 | 1;
	climbing: boolean;
	status: "ready" | "raiding" | "wounded";
	health: number;
	working: boolean;
	walking: boolean;
	walkSpan: number;
	phase: number;
};
export interface WorldInteractions {
	canInteract?: () => boolean;
	canDrag?: () => boolean;
	canCamera?: () => boolean;
	onCameraChange?: (state: WorldCameraState) => void;
	getAssignmentReason?: (scavId: string, roomId: string) => string | null;
	onAssignScav?: (scavId: string, roomId: string) => void;
	onDragState?: (state: { scavId: string; roomId: string | null; reason: string | null } | null) => void;
	onRoom?: (room: BaseRoom) => void;
	onScav?: (id: string) => void;
	onShelterRoom?: (roomId: string) => void;
	onBuildSite?: (site: { column: number; row: number }) => void;
	onShelterSite?: (column: number, row: number) => void;
}
export interface WorldCameraState extends ShelterCamera { panMode: boolean; view: WorldView; following?: boolean; minZoom?: number; maxZoom?: number }
export interface WorldController {
	game: Phaser.Game;
	setView: (view: View) => void;
	selectRaid: (id: string | null) => void;
	setRaidFollow: (enabled: boolean) => void;
	beginScavDrag: (id: string) => boolean;
	moveScavDrag: (clientX: number, clientY: number) => void;
	endScavDrag: () => void;
	cancelScavDrag: () => void;
	cancelCameraGesture: () => void;
	getCameraState: () => WorldCameraState;
	zoomBy: (factor: number, clientX?: number, clientY?: number) => void;
	panBy: (dx: number, dy: number) => void;
	resetCamera: () => void;
	setPanMode: (enabled: boolean) => void;
	focusRoom: (id: string) => boolean;
	projectShelterRect: (rect: ShelterRect) => (ClientRect & { visible: boolean }) | null;
}
type ShelterCell = {
	root: Phaser.GameObjects.Container;
	art: Phaser.GameObjects.Graphics;
	frame: Phaser.GameObjects.Graphics;
	progress: Phaser.GameObjects.Graphics;
	animation: Phaser.GameObjects.Graphics;
	stationClock: number;
	stationJob: string | null;
	production: ProductionPresentation | null;
	productLabel: Phaser.GameObjects.Text;
	label: Phaser.GameObjects.Text;
	status: Phaser.GameObjects.Text;
	lamp: Phaser.GameObjects.Image;
	zone: Phaser.GameObjects.Zone;
	signature: string;
	column: number;
	row: number;
	hovered: boolean;
	room: RoomInstance | null;
	working: boolean;
	operational: "empty" | "building" | "working" | "blocked" | "idle" | "passive";
	feedback: Phaser.GameObjects.Text;
	lastCycles: number | null;
	completedAt: number;
};
type DragSession = { scavId: string; roomId: string | null; reason: string | null; cellKey: string | null; point: Point | null; canvas: boolean; shelter: WorldSnapshot["shelter"]; scav: NonNullable<WorldSnapshot["scavs"]>[number] };
type CanvasGesture = { scavId: string; pointerId: number; clientX: number; clientY: number; active: boolean };
type RaidMarker = {
	actor: Phaser.GameObjects.Container;
	ring: Phaser.GameObjects.Ellipse;
	label: Phaser.GameObjects.Text;
	phase: Phaser.GameObjects.Text;
	hovered: boolean;
};
const WIDTH = 840;
const HEIGHT = 520;
const ROOM_WIDTH = 172;
const ROOM_HEIGHT = 100;
const cellPosition = shelterRoomPosition;
const ROOM_STYLE: Record<string, { label: string; color: number; light: number; wall: number }> = {
	workshop: { label: "МАСТЕРСКАЯ", color: 0xd7a368, light: 0xffcc88, wall: 0x594438 },
	ammo: { label: "ПАТРОНЫ", color: 0xd4d889, light: 0xf1e4a5, wall: 0x515038 },
	recycler: { label: "РАЗБОРКА", color: 0xdd9373, light: 0xffbd99, wall: 0x613e34 },
	medbay: { label: "МЕДБЛОК", color: 0x89d6d0, light: 0xc7f8ef, wall: 0x355c5c },
	radio: { label: "РАДИО", color: 0x8cd4d5, light: 0xace9d7, wall: 0x294b50 },
	storage: { label: "СКЛАД", color: 0xb6c694, light: 0xe6e9b3, wall: 0x465546 },
	dormitory: { label: "ЖИЛЬЁ", color: 0xd0b8ea, light: 0xf1d9f4, wall: 0x55495b },
};
const blend = (a: number, b: number, amount: number): number => {
	const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
	return (channel(16) << 16) | (channel(8) << 8) | channel(0);
};
const FONT = '"IBM Plex Mono", "Courier New", monospace';
const C = {
	void: 0x111510,
	ink: 0x111710,
	wall: 0x353930,
	edge: 0x59604b,
	gold: 0xe1b576,
	light: 0xffd896,
	sage: 0x879579,
	red: 0x974f3c,
};
const tint = (hex: string, fallback = C.gold): number => {
	const parsed = Number.parseInt(hex.replace(/^#/, ""), 16);
	return Number.isFinite(parsed) ? parsed : fallback;
};
function random(seed: number): () => number {
	let n = seed >>> 0;
	return () => {
		n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
		return n / 4294967296;
	};
}
function polygon(
	g: Phaser.GameObjects.Graphics,
	points: Point[],
	color: number,
	alpha = 1
): void {
	g.fillStyle(color, alpha).fillPoints(points, true);
}
function line(
	g: Phaser.GameObjects.Graphics,
	points: Point[],
	color: number,
	width = 1,
	alpha = 1
): void {
	g.lineStyle(width, color, alpha).strokePoints(points, false);
}
function dashed(
	g: Phaser.GameObjects.Graphics,
	a: Point,
	b: Point,
	color: number,
	width = 1,
	alpha = 1
): void {
	const distance = Math.hypot(b.x - a.x, b.y - a.y);
	for (let t = 0; t < distance; t += 12) {
		const end = Math.min(t + 6, distance);
		line(
			g,
			[
				{
					x: a.x + ((b.x - a.x) * t) / distance,
					y: a.y + ((b.y - a.y) * t) / distance,
				},
				{
					x: a.x + ((b.x - a.x) * end) / distance,
					y: a.y + ((b.y - a.y) * end) / distance,
				},
			],
			color,
			width,
			alpha
		);
	}
}
function position(place: MapPlace): Point {
	const { x, y } = place.position;
	if (Math.abs(x) <= 1 && Math.abs(y) <= 1)
		return { x: 70 + x * 700, y: 62 + y * 330 };
	if (Math.abs(x) <= 100 && Math.abs(y) <= 100)
		return { x: 70 + x * 7, y: 62 + y * 3.3 };
	return { x: Phaser.Math.Clamp(x, 70, 770), y: Phaser.Math.Clamp(y, 62, 400) };
}

/** Procedural artwork: the room is painted once; only actors, lamps and raid markers animate. */
export function createWorld(
	parent: HTMLElement,
	snapshot: () => WorldSnapshot,
	onMap: (id: string) => void,
	interactions: WorldInteractions = {}
): WorldController {
	let requestedView: View = "base";
	let requestedRaidId: string | null = null;
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const stageRect = parent.getBoundingClientRect();
	const initialViewport = shelterViewportForSize(stageRect.width, stageRect.height);

	class PraporWorld extends Phaser.Scene {
		private baseLayer!: Phaser.GameObjects.Container;
		private mapLayer!: Phaser.GameObjects.Container;
		private raidStreet!: RaidStreetRenderer;
		private baseCaption!: Phaser.GameObjects.Text;
		private operationsCaption!: Phaser.GameObjects.Text;
		private selectedRoute!: Phaser.GameObjects.Graphics;
		private cells = new Map<string, ShelterCell>();
		private elevator!: Phaser.GameObjects.Container;
		private shelterCaption!: Phaser.GameObjects.Text;
		private ambient!: Phaser.GameObjects.Graphics;
		private dragGhost!: Phaser.GameObjects.Graphics;
		private drag: DragSession | null = null;
		private gesture: CanvasGesture | null = null;
		private nativeEvents = new AbortController();
		private viewState: WorldSnapshot | null = null;
		private liftModel = createShelterLift();
		private liftDoors!: Phaser.GameObjects.Graphics;
		private viewCamera: ShelterCamera = { zoom: 1, x: 0, y: 0 };
		private viewport: ShelterViewport = { ...initialViewport };
		private viewportObserver: ResizeObserver | null = null;
		private viewportFrame = 0;
		private stageSize = { width: 0, height: 0 };
		private panMode = false;
		private spacePressed = false;
		private panGesture: { pointerId: number; clientX: number; clientY: number } | null = null;
		private cameraTouches = new Map<number, Point>();
		private pinchGesture: { ids: [number, number]; distance: number; midpoint: Point } | null = null;
		private places = new Map<
			string,
			{
				dot: Phaser.GameObjects.Graphics;
				label: Phaser.GameObjects.Text;
				detail: Phaser.GameObjects.Text;
				active: boolean;
				hovered: boolean;
				zone: Phaser.GameObjects.Zone;
			}
		>();
		private raidActors = new Map<string, RaidMarker>();
		private scavs = new Map<string, ScavActor>();
		private lastSync = 0;
		private lastSelection = "";
		private hq: Point = { x: 110, y: 357 };

		constructor() {
			super("PraporWorld");
		}

		preload(): void {
			this.load.spritesheet("shelter-room-atlas", "/art/shelter-rooms.png", { frameWidth: 768, frameHeight: 256 });
			this.load.atlas("scav-workers", "/art/scav-workers.png", "/art/scav-workers.json");
			this.load.atlas("raid-props", "/art/raid-props.png", "/art/raid-props.json");
		}

		create(): void {
			this.cameras.main.setBackgroundColor(C.void);
			this.makeGlow();
			this.baseLayer = this.add.container(0, 0);
			this.mapLayer = this.add.container(0, 30);
			this.paintBunker();
			this.paintMap();
			this.raidStreet = new RaidStreetRenderer(this, this.viewport, reducedMotion);
			this.raidStreet.selectRaid(requestedRaidId);
			this.installDragListeners();
			this.installViewportObserver();
			this.syncSnapshot();
			this.show(requestedView);
			this.game.canvas.setAttribute("aria-hidden", "true");
			this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
				this.cancelScavDrag();
				this.cancelCameraGesture();
				this.raidStreet.destroy();
				this.viewportObserver?.disconnect();
				if (this.viewportFrame) cancelAnimationFrame(this.viewportFrame);
				this.nativeEvents.abort();
				this.raidActors.clear();
				this.places.clear();
				this.cells.clear();
				this.scavs.clear();
			});
		}

		show(view: View): void {
			if (view !== requestedView) { this.cancelScavDrag(); this.cancelCameraGesture(); }
			requestedView = view;
			if (!this.baseLayer) return;
			this.baseLayer.setVisible(view === "base");
			this.mapLayer.setVisible(view === "map");
			this.raidStreet.layer.setVisible(view === "raid");
			this.input.setDefaultCursor("default");
			this.scavs.forEach((actor) => { actor.hovered = false; });
			this.places.forEach((place) => { place.hovered = false; });
			this.syncSnapshot();
			if (view === "raid") this.raidStreet.update(snapshot(), Date.now(), 0);
			this.applyCamera();
		}

		getCameraState(): WorldCameraState { return { ...(requestedView === "raid" && this.raidStreet ? this.raidStreet.getCameraState() : this.viewCamera), panMode: this.panMode, view: requestedView, minZoom: requestedView === "raid" ? .7 : 1, maxZoom: 4 }; }
		selectRaid(id: string | null): void { requestedRaidId = id; this.raidStreet?.selectRaid(id); if (requestedView === "raid" && this.raidStreet) this.raidStreet.update(snapshot(), Date.now(), 0); this.applyCamera(); }
		setRaidFollow(enabled: boolean): void { this.raidStreet?.setFollow(enabled); this.applyCamera(); }

		private cameraAllowed(): boolean {
			return Boolean(this.baseLayer && this.scene.isActive() && (requestedView === "base" || requestedView === "raid") && !document.hidden && !this.drag && !this.gesture && interactions.canCamera?.() !== false);
		}

		private applyCamera(): void {
			this.viewCamera = clampShelterCamera(this.viewCamera, this.viewport);
			this.baseLayer?.setScale(this.viewCamera.zoom).setPosition(-this.viewCamera.x * this.viewCamera.zoom, -this.viewCamera.y * this.viewCamera.zoom);
			this.mapLayer?.setPosition((this.viewport.width - WIDTH) / 2, (this.viewport.height - HEIGHT) / 2 + 30);
			this.input?.setDefaultCursor(this.panMode || this.spacePressed || requestedView === "raid" ? "grab" : "default");
			interactions.onCameraChange?.(this.getCameraState());
		}

		private installViewportObserver(): void {
			this.resizeViewport();
			this.viewportObserver = new ResizeObserver(() => {
				if (!this.viewportFrame) this.viewportFrame = requestAnimationFrame(() => { this.viewportFrame = 0; this.resizeViewport(); });
			});
			this.viewportObserver.observe(parent);
		}

		private resizeViewport(): void {
			const rect = parent.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0 || Math.abs(rect.width - this.stageSize.width) < .01 && Math.abs(rect.height - this.stageSize.height) < .01) return;
			this.stageSize = { width: rect.width, height: rect.height };
			this.cancelScavDrag(); this.cancelPan(); this.spacePressed = false;
			const next = shelterViewportForSize(rect.width, rect.height);
			this.viewCamera = resizeShelterCamera(this.viewCamera, this.viewport, next);
			const changed = Math.abs(next.width - this.viewport.width) > .001 || Math.abs(next.height - this.viewport.height) > .001;
			this.viewport = next;
			this.raidStreet?.resize(next);
			// FIT still scales uniformly, but its logical viewport now occupies the
			// whole stage. Only the fully visible overview keeps centered margins.
			this.scale.getParentBounds();
			if (changed) this.scale.setGameSize(next.width, next.height);
			else this.scale.refresh();
			this.applyCamera();
		}

		zoomBy(factor: number, clientX?: number, clientY?: number): void {
			if (!this.cameraAllowed() || !Number.isFinite(factor) || factor <= 0) return;
			const anchor = clientX !== undefined && clientY !== undefined ? clientToShelterPoint(clientX, clientY, this.game.canvas.getBoundingClientRect(), this.viewport.width, this.viewport.height) : { x: this.viewport.width / 2, y: this.viewport.height / 2 };
			if (!anchor) return;
			if (requestedView === "raid") { this.raidStreet.zoomBy(factor, clientX !== undefined && clientY !== undefined ? anchor : undefined); this.applyCamera(); return; }
			this.viewCamera = zoomShelterCamera(this.viewCamera, this.viewCamera.zoom * factor, anchor, this.viewport); this.applyCamera();
		}

		panBy(dx: number, dy: number): void { if (this.cameraAllowed()) { if (requestedView === "raid") this.raidStreet.panBy(dx, dy); else this.viewCamera = panShelterCamera(this.viewCamera, dx, dy, this.viewport); this.applyCamera(); } }
		resetCamera(): void { if (this.cameraAllowed()) { if (requestedView === "raid") this.raidStreet.resetCamera(); else this.viewCamera = { zoom: 1, x: 0, y: 0 }; this.applyCamera(); } }
		setPanMode(enabled: boolean): void { this.panMode = Boolean(enabled); this.cancelPan(); if (enabled) this.cancelScavDrag(); this.applyCamera(); }
		focusRoom(id: string): boolean {
			if (!this.baseLayer || requestedView !== "base" || document.hidden) return false;
			const room = snapshot().shelter?.rooms.find((candidate) => candidate.id === id);
			if (!room) return false;
			const p = cellPosition(room.column, room.row);
			const bounds = projectShelterBounds({ ...p, width: ROOM_WIDTH, height: ROOM_HEIGHT });
			this.viewCamera = focusShelterRect(this.viewCamera, { ...bounds, y: bounds.y - 24, height: bounds.height + 24 }, 2.5, this.viewport);
			if (this.drag) {
				this.drag.point = null; this.drag.roomId = null; this.drag.cellKey = null;
				this.dragGhost.clear();
				for (const cell of this.cells.values()) this.paintCellFrame(cell);
			}
			this.applyCamera(); return true;
		}

		projectShelterRect(rect: ShelterRect): (ClientRect & { visible: boolean }) | null {
			return this.baseLayer && requestedView === "base" ? projectShelterRect(projectShelterBounds(rect), this.viewCamera, this.game.canvas.getBoundingClientRect(), this.viewport) : null;
		}

		private clientWorld(clientX: number, clientY: number): Point | null {
			const viewport = clientToShelterPoint(clientX, clientY, this.game.canvas.getBoundingClientRect(), this.viewport.width, this.viewport.height);
			return viewport ? unprojectShelterPoint(viewportToShelter(viewport, this.viewCamera, this.viewport)) : null;
		}

		private cancelPan(): void {
			const ids = new Set([...(this.panGesture ? [this.panGesture.pointerId] : []), ...(this.pinchGesture?.ids ?? [])]);
			this.panGesture = null; this.pinchGesture = null; this.cameraTouches.clear();
			for (const id of ids) if (this.game.canvas.hasPointerCapture?.(id)) this.game.canvas.releasePointerCapture(id);
		}

		cancelCameraGesture(): void { this.cancelPan(); this.spacePressed = false; this.applyCamera(); }

		private text(
			x: number,
			y: number,
			value: string,
			size = 10,
			color = "#aea98d"
		): Phaser.GameObjects.Text {
			return this.add.text(x, y, value, {
				fontFamily: FONT,
				fontSize: `${size}px`,
				color,
				letterSpacing: 1,
				resolution: Math.min(window.devicePixelRatio || 1, 2),
			});
		}

		private acceptsPointer(pointer: Phaser.Input.Pointer, view: View): boolean {
			return requestedView === view
				&& !this.panGesture && !(view === "base" && (this.panMode || this.spacePressed))
				&& (!pointer.event || !("button" in pointer.event) || pointer.event.button === 0)
				&& !this.drag && !this.gesture
				&& interactions.canInteract?.() !== false
				&& pointer.event?.target === this.game.canvas;
		}

		private assignmentReason(scavId: string, roomId: string): string | null {
			if (interactions.getAssignmentReason) return interactions.getAssignmentReason(scavId, roomId);
			const state = snapshot(), scav = state.scavs?.find((candidate) => candidate.id === scavId), room = state.shelter?.rooms.find((candidate) => candidate.id === roomId);
			if (!scav) return "Бойца больше нет в отряде";
			if (scav.status === "raiding" || scav.health < 25) return scav.status === "raiding" ? "Боец в рейде" : "Сначала вылечи бойца";
			if (!room) return "Комната недоступна";
			if (room.status !== "ready") return "Дождись окончания работ";
			if (room.type === "storage" || room.type === "dormitory") return "Здесь нет рабочих мест";
			return "Назначение недоступно";
		}

		beginScavDrag(scavId: string): boolean {
			if (!this.baseLayer || !this.scene.isActive() || requestedView !== "base" || document.hidden || this.drag || this.panGesture || this.panMode || this.spacePressed || interactions.canDrag?.() === false || !interactions.onAssignScav) return false;
			const state = snapshot(), scav = state.scavs?.find((candidate) => candidate.id === scavId);
			if (!scav || scav.status === "raiding" || scav.health < 25) return false;
			this.drag = { scavId, roomId: null, reason: null, cellKey: null, point: null, canvas: false, shelter: state.shelter, scav };
			this.scavs.get(scavId)?.actor.setAlpha(.45);
			for (const cell of this.cells.values()) this.paintCellFrame(cell);
			interactions.onDragState?.({ scavId, roomId: null, reason: null });
			return true;
		}

		moveScavDrag(clientX: number, clientY: number): void {
			const drag = this.drag;
			if (!drag) return;
			const state = snapshot();
			if (requestedView !== "base" || document.hidden || interactions.canDrag?.() === false || state.shelter !== drag.shelter || state.scavs?.find((scav) => scav.id === drag.scavId) !== drag.scav || drag.scav.status === "raiding" || drag.scav.health < 25) { this.cancelScavDrag(); return; }
			const point = this.clientWorld(clientX, clientY);
			const site = point ? getShelterCell(point) : null;
			const room = site ? state.shelter?.rooms.find((candidate) => candidate.column === site.column && candidate.row === site.row) : undefined;
			const roomId = room?.id ?? null;
			const reason = roomId ? this.assignmentReason(drag.scavId, roomId) : site ? "Сначала построй комнату" : point ? "Перенеси бойца в производственную комнату" : "Отпусти над комнатой убежища";
			const changed = drag.roomId !== roomId || drag.reason !== reason;
			drag.point = point; drag.cellKey = site ? `${site.column}:${site.row}` : null; drag.roomId = roomId; drag.reason = reason;
			this.dragGhost.clear();
			if (drag.canvas && point) {
				const visual = projectShelterPoint(point);
				this.dragGhost.fillStyle(0x0a1915, .45).fillEllipse(visual.x, visual.y + 20, 24, 8);
				this.dragGhost.fillStyle(0xb2c68e).fillRect(visual.x - 7, visual.y - 13, 14, 18).fillStyle(0xcab18b).fillRect(visual.x - 5, visual.y - 24, 10, 10);
				this.dragGhost.fillStyle(0x557663).fillRect(visual.x - 6, visual.y - 26, 12, 5).fillStyle(0x365341).fillRect(visual.x - 5, visual.y + 5, 4, 12).fillRect(visual.x + 2, visual.y + 5, 4, 12);
				this.dragGhost.lineStyle(2, reason ? 0xd49a7e : 0xb7dfa0, .9).strokeRoundedRect(visual.x - 12, visual.y - 30, 25, 51, 4);
			}
			for (const cell of this.cells.values()) this.paintCellFrame(cell);
			if (changed) interactions.onDragState?.({ scavId: drag.scavId, roomId, reason });
		}

		endScavDrag(): void {
			const drag = this.drag;
			if (!drag) { this.clearGesture(); return; }
			const state = snapshot();
			const site = drag.point ? getShelterCell(drag.point) : null;
			const room = site ? state.shelter?.rooms.find((candidate) => candidate.column === site.column && candidate.row === site.row) : undefined;
			const allowed = requestedView === "base" && !document.hidden && interactions.canDrag?.() !== false && state.shelter === drag.shelter && state.scavs?.find((scav) => scav.id === drag.scavId) === drag.scav && room?.id === drag.roomId && this.assignmentReason(drag.scavId, room.id) === null;
			this.cancelScavDrag();
			if (allowed && room) interactions.onAssignScav?.(drag.scavId, room.id);
		}

		cancelScavDrag(): void {
			const drag = this.drag;
			this.drag = null;
			this.clearGesture();
			this.dragGhost?.clear();
			if (!drag) return;
			const scav = snapshot().scavs?.find((candidate) => candidate.id === drag.scavId);
			this.scavs.get(drag.scavId)?.actor.setAlpha(scav?.status === "wounded" ? .7 : 1);
			for (const cell of this.cells.values()) this.paintCellFrame(cell);
			interactions.onDragState?.(null);
		}

		private clearGesture(): void {
			const gesture = this.gesture;
			this.gesture = null;
			if (gesture && this.game.canvas.hasPointerCapture?.(gesture.pointerId)) this.game.canvas.releasePointerCapture(gesture.pointerId);
		}

		private installDragListeners(): void {
			const canvas = this.game.canvas, options = { signal: this.nativeEvents.signal };
			canvas.style.touchAction = "none";
			canvas.addEventListener("pointerdown", (event) => {
				if (event.target !== canvas || requestedView !== "base" && requestedView !== "raid") return;
				if (event.pointerType === "touch" && (this.panMode || requestedView === "raid") && this.cameraAllowed()) {
					this.cameraTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
					if (this.cameraTouches.size === 2 && this.cameraAllowed()) {
						const entries = [...this.cameraTouches], a = entries[0]!, b = entries[1]!;
						this.pinchGesture = { ids: [a[0], b[0]], distance: Math.max(1, Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y)), midpoint: { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 } };
						canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
					}
				}
				if (event.button === 1 || this.panMode || this.spacePressed || requestedView === "raid" && event.button === 0) {
					if (this.panGesture || !this.cameraAllowed()) return;
					event.preventDefault();
					this.panGesture = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
					canvas.setPointerCapture(event.pointerId); this.input.setDefaultCursor("grabbing");
					return;
				}
				if (requestedView !== "base") return;
				if (event.button !== 0 || this.gesture || this.drag || interactions.canInteract?.() === false) return;
				const point = this.clientWorld(event.clientX, event.clientY);
				if (!point) return;
				const visual = projectShelterPoint(point);
				const hit = [...this.scavs].filter(([, slot]) => slot.actor.visible && Math.abs(slot.actor.x - visual.x) <= 16 * slot.actor.scaleX && visual.y >= slot.actor.y - 44 * slot.actor.scaleY && visual.y <= slot.actor.y + 2).sort((a, b) => Math.hypot(a[1].actor.x - visual.x, a[1].actor.y - 21 - visual.y) - Math.hypot(b[1].actor.x - visual.x, b[1].actor.y - 21 - visual.y))[0];
				if (!hit) return;
				this.gesture = { scavId: hit[0], pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, active: false };
				canvas.setPointerCapture(event.pointerId);
			}, options);
			canvas.addEventListener("pointermove", (event) => {
				if (this.cameraTouches.has(event.pointerId)) this.cameraTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
				const pinch = this.pinchGesture;
				if (pinch && pinch.ids.includes(event.pointerId)) {
					if (!this.cameraAllowed()) { this.cancelCameraGesture(); return; }
					const a = this.cameraTouches.get(pinch.ids[0]), b = this.cameraTouches.get(pinch.ids[1]), rect = canvas.getBoundingClientRect();
					if (!a || !b || rect.width <= 0 || rect.height <= 0) return;
					const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
					const anchor = { x: (pinch.midpoint.x - rect.left) * this.viewport.width / rect.width, y: (pinch.midpoint.y - rect.top) * this.viewport.height / rect.height };
					if (requestedView === "raid") { this.raidStreet.zoomBy(distance / pinch.distance, anchor); this.raidStreet.panBy((pinch.midpoint.x - midpoint.x) * this.viewport.width / rect.width, (pinch.midpoint.y - midpoint.y) * this.viewport.height / rect.height); }
					else { this.viewCamera = zoomShelterCamera(this.viewCamera, this.viewCamera.zoom * distance / pinch.distance, anchor, this.viewport); this.viewCamera = panShelterCamera(this.viewCamera, (pinch.midpoint.x - midpoint.x) * this.viewport.width / rect.width, (pinch.midpoint.y - midpoint.y) * this.viewport.height / rect.height, this.viewport); }
					pinch.distance = distance; pinch.midpoint = midpoint; event.preventDefault(); this.applyCamera(); return;
				}
				const pan = this.panGesture;
				if (pan && event.pointerId === pan.pointerId) {
					if (!this.cameraAllowed()) { this.cancelCameraGesture(); return; }
					event.preventDefault();
					const rect = canvas.getBoundingClientRect();
					if (rect.width > 0 && rect.height > 0) this.panBy(-(event.clientX - pan.clientX) * this.viewport.width / rect.width, -(event.clientY - pan.clientY) * this.viewport.height / rect.height);
					pan.clientX = event.clientX; pan.clientY = event.clientY;
					this.input.setDefaultCursor("grabbing"); return;
				}
				const gesture = this.gesture;
				if (!gesture || event.pointerId !== gesture.pointerId) return;
				if (!gesture.active && Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) >= 8) {
					if (!this.beginScavDrag(gesture.scavId)) { this.clearGesture(); return; }
					gesture.active = true;
					if (this.drag) this.drag.canvas = true;
				}
				if (gesture.active) { event.preventDefault(); this.moveScavDrag(event.clientX, event.clientY); }
			}, options);
			canvas.addEventListener("pointerup", (event) => {
				if (this.pinchGesture?.ids.includes(event.pointerId)) { this.cancelPan(); this.applyCamera(); return; }
				if (this.panGesture?.pointerId === event.pointerId) { this.cancelPan(); this.applyCamera(); return; }
				const gesture = this.gesture;
				if (!gesture || event.pointerId !== gesture.pointerId) return;
				if (gesture.active) { this.moveScavDrag(event.clientX, event.clientY); this.endScavDrag(); return; }
				const tapped = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 8;
				this.clearGesture();
				if (tapped && requestedView === "base" && interactions.canInteract?.() !== false && this.clientWorld(event.clientX, event.clientY)) interactions.onScav?.(gesture.scavId);
			}, options);
			canvas.addEventListener("pointercancel", () => { this.cancelScavDrag(); this.cancelCameraGesture(); }, options);
			canvas.addEventListener("lostpointercapture", () => { if (this.gesture) this.cancelScavDrag(); if (this.panGesture) this.cancelCameraGesture(); }, options);
			canvas.addEventListener("wheel", (event) => {
				if (!this.cameraAllowed() || event.target !== canvas) return;
				event.preventDefault(); this.zoomBy(Math.exp(-Phaser.Math.Clamp(event.deltaY, -160, 160) * .0025), event.clientX, event.clientY);
			}, { ...options, passive: false });
			window.addEventListener("keydown", (event) => {
				if (event.key === "Escape" && (this.drag || this.gesture || this.panGesture)) { event.preventDefault(); this.cancelScavDrag(); this.cancelCameraGesture(); }
				if (event.code === "Space" && this.cameraAllowed() && (document.activeElement === canvas || parent.contains(document.activeElement)) && !(event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true],button"))) {
					event.preventDefault(); this.spacePressed = true; this.applyCamera();
				}
			}, options);
			window.addEventListener("keyup", (event) => { if (event.code === "Space" && this.spacePressed) { this.spacePressed = false; this.cancelPan(); this.applyCamera(); } }, options);
			window.addEventListener("blur", () => { this.cancelScavDrag(); this.cancelCameraGesture(); }, options);
			window.addEventListener("resize", () => { this.cancelScavDrag(); this.cancelCameraGesture(); }, options);
			document.addEventListener("visibilitychange", () => { if (document.hidden) { this.cancelScavDrag(); this.cancelCameraGesture(); } }, options);
		}

		private makeGlow(): void {
			const texture = this.textures.createCanvas("prapor-light", 256, 256);
			if (!texture) return;
			const context = texture.getContext();
			const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
			gradient.addColorStop(0, "rgba(255,255,255,.65)");
			gradient.addColorStop(0.2, "rgba(255,255,255,.33)");
			gradient.addColorStop(0.6, "rgba(255,255,255,.09)");
			gradient.addColorStop(1, "rgba(255,255,255,0)");
			context.fillStyle = gradient;
			context.fillRect(0, 0, 256, 256);
			texture.refresh();
		}

		private paintBunker(): void {
			const g = this.add.graphics().setDepth(-1000);
			this.baseLayer.add(g);
			g.fillStyle(0x14221d).fillRect(0, 0, WIDTH, HEIGHT);
			const quad = (x: number, y: number, width: number, height: number) => [
				{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
			].map(projectShelterPoint);
			const footprint = quad(20, 75, 800, 410);
			polygon(g, footprint.map((p) => ({ x: p.x + 12, y: p.y + 16 })), 0x060f0c, .7);
			polygon(g, [footprint[1]!, footprint[2]!, { ...footprint[2]!, y: footprint[2]!.y + 14 }, { ...footprint[1]!, y: footprint[1]!.y + 14 }], 0x344238);
			polygon(g, [footprint[3]!, footprint[2]!, { ...footprint[2]!, y: footprint[2]!.y + 14 }, { ...footprint[3]!, y: footprint[3]!.y + 14 }], 0x23362d);
			polygon(g, footprint, 0x465044);
			line(g, [...footprint, footprint[0]!], 0x8d9680, 2, .6);
			const rng = random(90312);
			for (let x = 20; x < 820; x += 20) for (let y = 75; y < 485; y += 20) {
				polygon(g, quad(x, y, 19, 19), blend(0x50594b, 0x1c3027, rng() * .35), .8);
				const p = projectShelterPoint({ x: x + rng() * 20, y: y + rng() * 20 });
				g.fillStyle(0xb1b296, .1).fillEllipse(p.x, p.y, 2 + rng() * 3, 1);
			}
			// The same route spine and room addresses are retained in the simulation.
			for (const y of [129, 228, 339, 450]) {
				line(g, [{ x: 30, y }, { x: 810, y }].map(projectShelterPoint), 0xb6b18b, 2, .28);
			}
			for (const x of [400, 440]) line(g, [{ x, y: 100 }, { x, y: 465 }].map(projectShelterPoint), 0xc0bb92, 1, .5);
			for (let y = 105; y < 465; y += 14) line(g, [{ x: 407, y }, { x: 433, y }].map(projectShelterPoint), 0x202e26, 2, .7);
			for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) this.createCell(column, row);
			// Supply crates and a perimeter light ground the open-roof bunker in the raid's visual world.
			for (const [x, y] of [[76, 108], [205, 106], [740, 105]]) {
				const p = projectShelterPoint({ x: x!, y: y! });
				if (this.textures.exists("raid-props") && this.textures.get("raid-props").has("crates")) {
					const crate = this.add.image(p.x, p.y, "raid-props", "crates").setOrigin(.5, 1).setDepth(p.y);
					crate.setScale(34 / crate.width); this.baseLayer.add(crate);
				}
			}
			const lift = this.add.graphics();
			polygon(lift, [{ x: -15, y: -5 }, { x: 0, y: -12 }, { x: 15, y: -5 }, { x: 0, y: 3 }], 0x84907a);
			polygon(lift, [{ x: -15, y: -5 }, { x: 0, y: 3 }, { x: 0, y: 7 }, { x: -15, y: -1 }], 0x43594a);
			polygon(lift, [{ x: 15, y: -5 }, { x: 0, y: 3 }, { x: 0, y: 7 }, { x: 15, y: -1 }], 0x2a4135);
			for (const x of [-13, 13]) line(lift, [{ x, y: -3 }, { x, y: -21 }], 0xa8ac8b, 1.4);
			this.liftDoors = this.add.graphics();
			this.elevator = this.add.container(0, 0, [lift, this.liftDoors]); this.baseLayer.add(this.elevator);
			this.ambient = this.add.graphics().setDepth(800); this.baseLayer.add(this.ambient);
			this.dragGhost = this.add.graphics().setDepth(1200); this.baseLayer.add(this.dragGhost);
			this.baseCaption = this.text(29, 27, "УБЕЖИЩЕ 07", 15, "#ded2ae").setVisible(false);
			this.shelterCaption = this.text(29, 477, "КОМНАТЫ · ЛЮДИ · ПРОИЗВОДСТВО", 10, "#abb69c");
			this.baseLayer.add([this.baseCaption, this.shelterCaption]);
			this.shelterCaption.setDepth(900); this.baseLayer.sort("depth");
		}

		private createCell(column: number, row: number): void {
			const p = cellPosition(column, row), corners = shelterRoomPolygon(column, row);
			const at = projectShelterPoint({ x: p.x + 86, y: p.y + 18 });
			const front = projectShelterPoint({ x: p.x + 86, y: p.y + 93 });
			const art = this.add.graphics(), frame = this.add.graphics(), progress = this.add.graphics(), animation = this.add.graphics();
			const label = this.text(at.x, at.y - 23, "", 11, "#fff0d6").setOrigin(.5, 0).setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setBackgroundColor("#11251ee8").setPadding(4, 2);
			const status = this.text(front.x, front.y - 4, "", 8, "#c1d8bd").setOrigin(.5).setFontFamily("Manrope, sans-serif").setLetterSpacing(0).setBackgroundColor("#10221ded").setPadding(3, 2);
			const productLabel = this.text(at.x, at.y - 39, "", 9, "#f4e4bb").setOrigin(.5).setLetterSpacing(0).setBackgroundColor("#10231e").setPadding(4, 2).setVisible(false);
			const feedback = this.text(front.x, front.y - 23, "", 12, "#e6ffce").setOrigin(.5).setLetterSpacing(0).setBackgroundColor("#163023").setPadding(5, 3).setVisible(false);
			const lamp = this.add.image(at.x, at.y + 5, "prapor-light").setScale(.30, .18).setAlpha(.08).setBlendMode(Phaser.BlendModes.ADD);
			const bounds = projectShelterBounds({ ...p, width: ROOM_WIDTH, height: ROOM_HEIGHT });
			const zone = this.add.zone(bounds.x, bounds.y, bounds.width, bounds.height).setOrigin(0);
			zone.setInteractive(new Phaser.Geom.Polygon(corners.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }))), Phaser.Geom.Polygon.Contains);
			zone.input!.cursor = "pointer";
			const root = this.add.container(0, 0, [art, lamp, animation, frame, progress]).setDepth(at.y - 20);
			const chrome = this.add.container(0, 0, [label, status, productLabel, feedback]).setDepth(950);
			this.baseLayer.add([root, chrome, zone.setDepth(-800)]);
			const cell: ShelterCell = { root, art, frame, progress, animation, stationClock: 0, stationJob: null, production: null, productLabel, label, status, lamp, zone, signature: "", column, row, hovered: false, room: null, working: false, operational: "empty", feedback, lastCycles: null, completedAt: -10000 };
			this.cells.set(`${column}:${row}`, cell);
			zone.on("pointerover", (pointer: Phaser.Input.Pointer) => { if (this.acceptsPointer(pointer, "base")) { cell.hovered = true; this.paintCellFrame(cell); } });
			zone.on("pointerout", () => { cell.hovered = false; this.paintCellFrame(cell); });
			zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
				if (!this.acceptsPointer(pointer, "base")) return;
				this.clickFeedback(projectShelterPoint({ x: p.x + 86, y: p.y + 50 }), this.baseLayer);
				if (cell.room) {
					if (interactions.onShelterRoom) interactions.onShelterRoom(cell.room.id);
					else if (["workshop", "medbay", "radio", "storage"].includes(cell.room.type)) interactions.onRoom?.(cell.room.type as BaseRoom);
				} else if (interactions.onBuildSite) interactions.onBuildSite({ column, row });
				else interactions.onShelterSite?.(column, row);
			});
		}

		private paintCellFrame(cell: ShelterCell): void {
			const state = snapshot(), corners = shelterRoomPolygon(cell.column, cell.row);
			const selected = Boolean(cell.room ? state.selectedRoomId === cell.room.id : state.selectedSite?.column === cell.column && state.selectedSite.row === cell.row);
			const building = cell.room && cell.room.status !== "ready";
			let tint = selected || cell.hovered ? C.light : building ? C.gold : cell.room ? ROOM_STYLE[cell.room.type]?.color ?? 0x899a7c : 0x788b71;
			cell.label.setAlpha(cell.room || selected || cell.hovered ? 1 : .6);
			cell.status.setAlpha(cell.room || selected || cell.hovered ? 1 : .5);
			cell.frame.clear();
			if (this.drag) {
				const reason = cell.room ? this.assignmentReason(this.drag.scavId, cell.room.id) : "Сначала построй комнату";
				const target = this.drag.cellKey === `${cell.column}:${cell.row}`; tint = reason ? 0xcc7f6d : 0xa6d193;
				polygon(cell.frame, corners, tint, target ? .23 : .07);
				line(cell.frame, [...corners, corners[0]!], tint, target ? 3 : 1.3, target ? 1 : .65); return;
			}
			if (selected || cell.hovered) polygon(cell.frame, corners, tint, selected ? .12 : .05);
			line(cell.frame, [...corners, corners[0]!], tint, selected ? 2.5 : 1, selected || cell.hovered ? 1 : .36);
		}

		private paintRoom(cell: ShelterCell): void {
			cell.art.clear(); paintIsometricRoom(cell.art, cell.column, cell.row, cell.room);
			const style = ROOM_STYLE[cell.room?.type ?? "workshop"]!;
			cell.label.setText(cell.room ? `${style.label} · ${cell.room.level || ""}` : "СВОБОДНО").setColor(cell.room ? "#fff1dc" : "#afc0a4");
			cell.status.setText(cell.room ? "" : "+ ПОСТРОИТЬ");
			cell.lamp.setVisible(Boolean(cell.room)).setTint(style.light);
		}

		private clickFeedback(at: Point, layer: Phaser.GameObjects.Container): void {
			const ring = this.add.circle(at.x, at.y, 15).setStrokeStyle(2, C.light, .85).setDepth(1500);
			layer.add(ring);
			this.tweens.add({ targets: ring, scale: reducedMotion ? 1 : 2.2, alpha: 0, duration: reducedMotion ? 80 : 320, onComplete: () => ring.destroy() });
		}

		private createScav(scavId: string, index: number, at: Point): ScavActor {
			const visual = projectShelterPoint(at);
			const actor = this.add.container(visual.x, visual.y).setDepth(visual.y);
			const body = this.add.container(0, 0);
			const shadow = this.add.ellipse(0, 1, 20, 5, 0x041014, .6);
			const selection = this.add.ellipse(0, 1, 27, 9).setStrokeStyle(1.5, C.gold).setVisible(false);
			const legA = this.add.rectangle(-3, 0, 4, 10, 0x526359).setOrigin(.5, 1).setStrokeStyle(.8, 0x07141b);
			const legB = this.add.rectangle(3, 0, 4, 10, 0x354f4a).setOrigin(.5, 1).setStrokeStyle(.8, 0x07141b);
			const hand = this.add.rectangle(6, -21, 4, 13, 0xc7ac86).setStrokeStyle(.7, 0x183433).setOrigin(.5, .15);
			const graphic = this.add.graphics();
			const coats = [0xbec49a, 0xd1ac78, 0x88c3bd, 0xba9ab7, 0xd08f77];
			const coat = coats[index % coats.length]!;
			graphic.fillStyle(0x0a1720).fillRoundedRect(-7, -29, 14, 19, 2);
			graphic.fillStyle(coat).fillRect(-6, -27, 12, 16);
			graphic.fillStyle(blend(coat, 0x163337, .45)).fillRect(-4, -24, 8, 10);
			graphic.fillStyle(0xe5c895).fillRect(-3, -22, 2, 5).fillRect(1, -22, 2, 5);
			graphic.fillStyle(blend(coat, 0xffeed6, .45)).fillRect(-6, -27, 11, 2);
			graphic.fillStyle(0x08161b).fillRect(-5, -41, 10, 14);
			graphic.fillStyle(index % 3 ? 0xd8b790 : 0xe4c7a2).fillRect(-4, -39, 8, 11);
			graphic.fillStyle(index % 2 ? 0x876e4e : 0x608b83).fillRoundedRect(-6, -43, 12, 6, 2);
			graphic.fillStyle(index % 2 ? 0xc7ab77 : 0xb5cfb9).fillRect(-5, -42, 9, 1);
			graphic.fillStyle(0x15252b).fillRect(1, -35, 2, 2).fillRect(0, -30, 3, 1);
			const gear = this.add.graphics();
			const tool = this.add.graphics().setPosition(6, -21);
			const appearance = index % 4;
			const makePose = (pose: string) => this.add.image(0, 0, "scav-workers", `${pose}-${appearance}`).setOrigin(.5, 332 / 340).setScale(44 / 319);
			const poses = this.textures.exists("scav-workers") ? { idle: makePose("idle"), walkA: makePose("walk-a").setVisible(false), walkB: makePose("walk-b").setVisible(false), work: makePose("work").setVisible(false) } : null;
			const sprite = poses?.idle ?? null;
			if (sprite) { legA.setVisible(false); legB.setVisible(false); graphic.setVisible(false); hand.setVisible(false); tool.setPosition(13, -21); }
			body.add([legA, legB, graphic, ...(poses ? [poses.idle, poses.walkA, poses.walkB, poses.work] : []), gear, hand, tool]);
			const label = this.text(0, -64, "", 16, "#ffedc7").setOrigin(.5).setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setBackgroundColor("#0b1b20").setPadding(7, 4).setVisible(false);
			const order = this.add.circle(-10, -34, 3.5, C.sage).setStrokeStyle(1, 0x10242b).setVisible(false);
			const hit = this.add.zone(0, -21, 32, 46).setInteractive({ useHandCursor: true });
			const slot: ScavActor = { actor, body, legA, legB, hand, sprite, poses, animation: createScavAnimation(index * .37), appearance, gear, tool, label, order, selection, hovered: false, gearSignature: "", position: { ...at }, anchor: { ...at }, route: [], goal: "", assignment: null, role: "idle", dwellUntil: this.time.now + 2000 + index * 800, visit: 0, facing: 1, climbing: false, status: "ready", health: 100, working: false, walking: false, walkSpan: 0, phase: index * 1.71 };
			hit.on("pointerover", (pointer: Phaser.Input.Pointer) => { if (this.acceptsPointer(pointer, "base")) { slot.hovered = true; selection.setVisible(true); label.setVisible(true); actor.setDepth(850); } });
			hit.on("pointerout", () => { slot.hovered = false; const selected = snapshot().selectedScavId === scavId; selection.setVisible(selected); label.setVisible(selected); actor.setDepth(actor.y); });
			// Native pointer-up distinguishes a deliberate tap from a drag before opening the inspector.
			actor.add([shadow, selection, body, label, order, hit]);
			this.baseLayer.add(actor);
			this.scavs.set(scavId, slot);
			return slot;
		}

		private syncShelter(state: WorldSnapshot): void {
			if (this.viewState && state.shelter !== this.viewState.shelter) {
				this.cancelScavDrag(); this.cancelCameraGesture(); this.liftModel = createShelterLift();
				this.raidStreet?.reset();
				for (const slot of this.scavs.values()) slot.actor.destroy(true);
				this.scavs.clear();
				for (const cell of this.cells.values()) { cell.lastCycles = null; cell.completedAt = -10000; cell.feedback.setVisible(false); }
			}
			this.viewState = state;
			const rooms = state.shelter?.rooms ?? [];
			let workingRooms = 0;
			for (const cell of this.cells.values()) {
				const room = rooms.find((candidate) => candidate.column === cell.column && candidate.row === cell.row) ?? null;
				if (cell.room?.id !== room?.id) { cell.lastCycles = null; cell.completedAt = -10000; cell.feedback.setVisible(false); }
				cell.room = room;
				const production = room ? state.roomProduction?.[room.id] : undefined;
				cell.production = room ? getShelterProductionPresentation(room, production ?? null) : null;
				if (cell.stationJob !== cell.production?.jobId) { cell.stationClock = 0; cell.stationJob = cell.production?.jobId ?? null; }
				const productName = cell.production?.jobId ? cell.production.productName : "";
				cell.productLabel.setText(productName.length > 29 ? `${productName.slice(0, 28)}…` : productName);
				cell.working = Boolean(room?.status === "ready" && room.queue.length && room.workerIds.length && production?.rate && !production.reason);
				cell.operational = !room ? "empty" : room.status !== "ready" ? "building" : room.type === "storage" || room.type === "dormitory" ? "passive" : cell.working ? "working" : production?.reason || room.queue.length ? "blocked" : "idle";
				if (cell.working) workingRooms++;
				const signature = room ? `${room.id}:${room.type}:${room.level}:${room.status}` : "empty";
				if (cell.signature !== signature) { cell.signature = signature; this.paintRoom(cell); }
				this.paintCellFrame(cell);
				cell.progress.clear();
				if (room) {
					if (cell.lastCycles !== null && room.cycles > cell.lastCycles) {
						cell.completedAt = this.time.now;
						cell.feedback.setText(`+${room.cycles - cell.lastCycles} ГОТОВО`).setVisible(true).setAlpha(1).setY(projectShelterPoint({ ...cellPosition(cell.column, cell.row), x: cellPosition(cell.column, cell.row).x + 86, y: cellPosition(cell.column, cell.row).y + 93 }).y - 23);
					}
					cell.lastCycles = room.cycles;
					const construction = room.construction;
					const progress = construction ? construction.workDone / Math.max(1, construction.workRequired) : production?.progress ?? 0;
					const color = construction ? 0xf6c58b : cell.operational === "blocked" ? 0xe9ad7f : 0xb2d692;
					const p = cellPosition(cell.column, cell.row), badge = projectShelterPoint({ x: p.x + 86, y: p.y + 93 });
					cell.progress.fillStyle(0x071710).fillRect(badge.x - 35, badge.y + 4, 70, 3);
					cell.progress.fillStyle(color, .95).fillRect(badge.x - 35, badge.y + 4, Phaser.Math.Clamp(progress, 0, 1) * 70, 3);
					const reason = production?.reason?.toLocaleLowerCase("ru-RU") ?? "";
					const briefReason = reason.includes("склад") || reason.includes("мест") ? "СКЛАД ПОЛОН" : reason.includes("рабоч") ? "НУЖЕН РАБОЧИЙ" : reason.includes("нужно") ? "НУЖНЫ РЕСУРСЫ" : production?.reason ?? "";
					const status = construction ? `СТРОЙКА ${Math.floor(progress * 100)}%` : room.type === "storage" ? "ЗАПАСЫ" : room.type === "dormitory" ? "МЕСТА ОТРЯДА" : cell.working ? `${Math.floor((cell.production?.progress ?? 0) * 100)}% · ${cell.production?.stageLabel ?? "Сборка"}` : production?.reason ? briefReason : !room.workerIds.length ? "НУЖЕН РАБОЧИЙ" : production?.status === "Нет заказа" ? "БЕЗ ЗАКАЗА" : "ЖДЁТ ПАРТИЮ";
					const clippedStatus = `${status.toLocaleUpperCase("ru-RU").slice(0, 17)}${status.length > 17 ? "…" : ""}`;
					cell.status.setText(clippedStatus).setColor(construction ? "#ffd399" : cell.working ? "#d1efb0" : cell.operational === "blocked" ? "#edc294" : "#c1cbbc");
					cell.lamp.setAlpha(construction ? .1 : cell.working ? .18 : .06);
				}
			}
			this.baseCaption.setText(`УБЕЖИЩЕ · УРОВЕНЬ ${state.level}`);
			this.shelterCaption.setText(`${rooms.length} КОМНАТ · ${workingRooms} ПРОИЗВОДЯТ · ${rooms.filter((room) => room.status !== "ready").length} СТРОЯТСЯ`);
			this.syncPeople(state);
			this.baseLayer.sort("depth");
		}

		private homePosition(rank: number, count: number): Point {
			const left = Math.min(4, count), onLeft = rank < left;
			const total = onLeft ? left : Math.max(1, count - left);
			const start = onLeft ? 282 : 465, span = onLeft ? 95 : 306;
			return { x: start + (total > 1 ? (onLeft ? rank : rank - left) * span / (total - 1) : span / 2), y: 129 };
		}

		private placeActor(slot: ScavActor, at: Point): void {
			slot.position = { ...at };
			const visual = projectShelterPoint(at);
			slot.actor.setPosition(visual.x, visual.y).setDepth(slot.hovered ? 850 : visual.y);
		}

		private sendActor(slot: ScavActor, goal: string, at: Point): void {
			if (slot.goal === goal && Math.hypot(slot.anchor.x - at.x, slot.anchor.y - at.y) < 1) return;
			slot.goal = goal; slot.anchor = { ...at };
			slot.route = reducedMotion ? [] : planShelterRoute(slot.position, at);
			if (reducedMotion) this.placeActor(slot, at);
			slot.working = false;
		}

		private syncPeople(state: WorldSnapshot): void {
			const people = state.scavs ?? [], rooms = state.shelter?.rooms ?? [];
			const alive = new Set(people.map((scav) => scav.id));
			for (const [id, slot] of this.scavs) if (!alive.has(id)) { if (this.drag?.scavId === id) this.cancelScavDrag(); slot.actor.destroy(true); this.scavs.delete(id); }
			const free = people.filter((scav) => scav.status !== "raiding" && !rooms.some((room) => room.id === scav.assignment && room.workerIds.includes(scav.id)));
			people.forEach((scav, index) => {
				const room = rooms.find((candidate) => candidate.id === scav.assignment && candidate.workerIds.includes(scav.id));
				const production = room ? state.roomProduction?.[room.id] : undefined;
				const presentation = room ? this.cells.get(`${room.column}:${room.row}`)?.production ?? null : null;
				const rank = Math.max(0, room?.workerIds.indexOf(scav.id) ?? 0), roomPoint = room ? cellPosition(room.column, room.row) : null;
				const station = room?.type === "workshop" && presentation?.active ? presentation.stage === "assembly" ? 104 : 51 : 86;
				const at = roomPoint ? { x: roomPoint.x + station + rank * 24, y: roomPoint.y + 80 } : this.homePosition(Math.max(0, free.indexOf(scav)), free.length);
				const slot = this.scavs.get(scav.id) ?? this.createScav(scav.id, index, at);
				const previousStatus = slot.status, previousAssignment = slot.assignment;
				slot.assignment = room?.id ?? null; slot.status = scav.status; slot.health = scav.health;
				if (this.drag?.scavId === scav.id && (scav.status === "raiding" || scav.health < 25 || this.drag.shelter !== state.shelter || this.drag.scav !== scav)) this.cancelScavDrag();
				if (scav.status === "raiding") { slot.actor.setVisible(false); slot.route = []; slot.goal = "raiding"; slot.working = false; return; }
				if (previousStatus === "raiding") this.placeActor(slot, { x: 112, y: 129 });
				slot.actor.setVisible(true).setScale(.78).setAlpha(this.drag?.scavId === scav.id ? .45 : scav.status === "wounded" ? .78 : 1);
				if (scav.status === "wounded" && (!room || scav.health < 25)) {
					const rest = rooms.find((candidate) => candidate.type === "medbay" && candidate.status === "ready") ?? rooms.find((candidate) => candidate.type === "dormitory" && candidate.status === "ready");
					const p = rest ? cellPosition(rest.column, rest.row) : null;
					this.sendActor(slot, `rest:${rest?.id ?? "entrance"}`, p ? { x: p.x + 35 + index % 3 * 20, y: p.y + 80 } : at);
					slot.role = "rest";
				} else if (room) {
					// Workshop stages use real bench/lathe positions. Changing stage is
					// a short floor walk; pausing keeps the last station and route.
					if (presentation?.active || previousAssignment !== room.id || !slot.goal.startsWith(`work:${room.id}:`)) this.sendActor(slot, `work:${room.id}:${rank}:${presentation?.active ? presentation.stage : "idle"}`, at);
					slot.role = room.type;
				} else if (!slot.goal || previousAssignment !== null || previousStatus !== "ready") {
					this.sendActor(slot, `idle-home:${index}`, at); slot.role = "idle";
				}
				slot.working = Boolean(room && !slot.route.length && scav.health >= 25 && presentation?.active);
				const selected = state.selectedScavId === scav.id;
				slot.selection.setVisible(selected || slot.hovered || this.drag?.scavId === scav.id).setStrokeStyle(1.5, selected ? C.light : C.gold);
				const activities: Record<string, string> = { workshop: "СОБИРАЕТ ДЕТАЛИ", ammo: "СНАРЯЖАЕТ ПАТРОНЫ", recycler: "СОРТИРУЕТ УТИЛЬ", medbay: "ГОТОВИТ МЕДИКАМЕНТЫ", radio: "РАБОТАЕТ В ЭФИРЕ" };
				const activity = slot.role === "rest" ? slot.route.length ? "ИДЁТ ОТДЫХАТЬ" : "ВОССТАНАВЛИВАЕТСЯ" : slot.route.length ? room ? `ИДЁТ: ${ROOM_STYLE[room.type]?.label ?? "КОМНАТА"}` : "ОСМАТРИВАЕТ БАЗУ" : slot.working ? room?.type === "workshop" ? presentation?.stageLabel.toLocaleUpperCase("ru-RU") ?? "РАБОТАЕТ" : activities[slot.role] ?? "РАБОТАЕТ" : room ? production?.reason?.toLocaleUpperCase("ru-RU").slice(0, 24) ?? "ЖДЁТ ЗАКАЗ" : "НА БАЗЕ";
				slot.label.setText(`${scav.name?.toLocaleUpperCase("ru-RU") ?? ""}\n${activity}`).setVisible(selected || slot.hovered);
				slot.order.setVisible(Boolean(scav.autoRaid?.enabled)).setFillStyle(scav.autoRaid?.waitingReason ? C.gold : C.sage);
				const gearSignature = `${scav.gear?.armor ?? 0}:${scav.gear?.backpack ?? 0}:${slot.role}`;
				if (slot.gearSignature !== gearSignature) {
					slot.gearSignature = gearSignature; slot.gear.clear(); slot.tool.clear();
					if (!slot.sprite && !room && scav.gear?.backpack) slot.gear.fillStyle(0x8c7650).fillRect(-10, -26, 5, 16).lineStyle(1, 0xbca16b).strokeRect(-10, -26, 5, 16);
					if (!slot.sprite && scav.gear?.armor) slot.gear.fillStyle(0x708060).fillRect(-4, -25, 8, 9).fillStyle(0xc4bc80).fillRect(-3, -23, 2, 2);
					if (slot.role === "workshop") { line(slot.tool, [{ x: 1, y: 1 }, { x: 10, y: 1 }], 0xc6cbb6, 2); slot.tool.lineStyle(1.3, 0xd4d5ba).strokeCircle(11, 1, 2.3); }
					if (slot.role === "ammo") slot.tool.fillStyle(0xe7c577).fillRect(1, 0, 3, 8).fillStyle(0xffdfa0).fillRect(1, 0, 3, 1);
					if (slot.role === "recycler") { line(slot.tool, [{ x: 1, y: 0 }, { x: 2, y: 9 }], 0xd5bb92, 2); slot.tool.fillStyle(0x9dac9b).fillRect(-2, 8, 8, 3); }
					if (slot.role === "medbay") slot.tool.fillStyle(0xd8ebe0).fillRect(0, 1, 5, 7).fillStyle(0x98cabc).fillRect(1, -1, 3, 2);
					if (slot.role === "radio") slot.tool.fillStyle(0xbdc9a6).fillRect(-1, 0, 6, 7).fillStyle(0x659789).fillRect(0, 1, 4, 3);
				}
			});
		}

		private patrolActor(slot: ScavActor, id: string, time: number): void {
			if (slot.assignment || slot.status !== "ready" || slot.route.length || time < slot.dwellUntil || reducedMotion) return;
			const state = this.viewState, ready = state?.shelter?.rooms.filter((room) => room.status === "ready") ?? [];
			slot.visit++;
			const people = state?.scavs?.filter((scav) => scav.status !== "raiding" && !scav.assignment) ?? [];
			if (!ready.length || slot.visit % 3 === 0) this.sendActor(slot, `idle-home:${slot.visit}`, this.homePosition(Math.max(0, people.findIndex((scav) => scav.id === id)), people.length));
			else {
				const room = ready[(Math.floor(slot.phase * 7) + slot.visit * 3) % ready.length]!, p = cellPosition(room.column, room.row);
				this.sendActor(slot, `visit:${slot.visit}:${room.id}`, { x: p.x + (slot.visit % 2 ? 27 : 146), y: p.y + 80 });
			}
			slot.role = "idle"; slot.dwellUntil = time + 9000 + slot.phase * 400;
		}

		private animateShelter(time: number, delta: number): void {
			const step = Math.min(Math.max(delta, 0), 100) / 1000;
			// The shared platform owns travel along the central passage. Walking
			// actors wait for pickup; one delta advances its gate and passenger.
			const liftRequests: LiftRequest[] = [];
			for (const [id, slot] of this.scavs) {
				const next = slot.route[0];
				const passenger = this.liftModel.passengerId === id;
				if (slot.actor.visible && next && Math.abs(slot.position.x - SHELTER_SHAFT_X) < .01 && (passenger || Math.abs(next.y - slot.position.y) > .01) && (this.drag?.scavId !== id || passenger)) liftRequests.push({ id, from: slot.position.y, to: next.y });
			}
			const lift = advanceShelterLift(this.liftModel, liftRequests, step * 1000);
			this.liftModel = lift.state;
			const rider = lift.state.passengerId ? this.scavs.get(lift.state.passengerId) : null;
			if (rider) this.placeActor(rider, { x: SHELTER_SHAFT_X, y: lift.state.y });
			for (const drop of lift.dropped) {
				const slot = this.scavs.get(drop.id);
				if (!slot?.actor.visible) continue;
				this.placeActor(slot, { x: SHELTER_SHAFT_X, y: drop.to });
				slot.route = planShelterRoute({ x: SHELTER_SHAFT_X, y: drop.to }, slot.anchor);
			}
			this.ambient.clear();
			for (const [id, slot] of this.scavs) {
				let walkedDistance = 0;
				if (slot.actor.visible && this.drag?.scavId !== id) {
					this.patrolActor(slot, id, time);
					const speed = slot.status === "wounded" ? 27 : 58;
					const next = slot.route[0], vertical = this.liftModel.passengerId === id || Boolean(next && Math.abs(next.y - slot.position.y) > .01);
					const hadRoute = slot.route.length > 0;
					const distance = next ? Math.hypot(next.x - slot.position.x, next.y - slot.position.y) : 0;
					const motion = advanceShelterRoute(slot.position, slot.route, vertical ? 0 : Math.min(speed * step, distance));
					if (!vertical) walkedDistance = Math.abs(motion.point.x - slot.position.x);
					slot.route = motion.route;
					if (hadRoute) this.placeActor(slot, motion.point);
					slot.walking = hadRoute && !vertical; slot.climbing = this.liftModel.passengerId === id;
					if (slot.walking && !vertical) slot.facing = motion.facing;
					if (hadRoute && motion.arrived) { slot.dwellUntil = time + 6500 + (slot.phase % 4) * 1700; slot.walking = false; slot.climbing = false; }
				} else { slot.walking = false; slot.climbing = false; }
				const room = this.viewState?.shelter?.rooms.find((candidate) => candidate.id === slot.assignment);
				const production = room ? this.viewState?.roomProduction?.[room.id] : undefined;
				const presentation = room ? this.cells.get(`${room.column}:${room.row}`)?.production ?? null : null;
				slot.working = Boolean(slot.status !== "raiding" && slot.health >= 25 && !slot.route.length && this.drag?.scavId !== id && presentation?.active);
				if (slot.working) slot.facing = 1;
				const animation = advanceScavAnimation(slot.animation, { distance: walkedDistance, elapsedMs: step * 1000, walking: slot.walking || walkedDistance > 0, working: slot.working, facing: slot.facing, role: slot.role, workDone: (room?.queue[0]?.workDone ?? 0) / 1_000_000, workRate: production?.rate ?? 0, jobId: presentation?.jobId ?? null, stage: presentation?.stage, stageProgress: presentation?.stageProgress, reducedMotion, paused: !slot.actor.visible || this.drag?.scavId === id });
				slot.animation = animation.state;
				const pose = animation.pose;
				if (slot.poses) for (const key of ["idle", "walkA", "walkB", "work"] as const) slot.poses[key].setVisible(pose.weights[key] > .001).setAlpha(pose.weights[key]);
				// All visual transforms pivot at the common feet baseline. Physics,
				// hit zones, lift attachment and drag coordinates remain unchanged.
				slot.body.setPosition(0, 0).setScale(pose.scaleX, pose.scaleY).setAngle(pose.angle * pose.scaleX);
				const stride = (slot.animation.stride % 1) * Math.PI * 2;
				slot.legA.setAngle(Math.sin(stride) * 9 * slot.animation.walkBlend);
				slot.legB.setAngle(-Math.sin(stride) * 9 * slot.animation.walkBlend);
				slot.hand.setAngle(pose.handAngle);
				slot.tool.setPosition(pose.toolX - (slot.sprite ? 0 : 7), pose.toolY).setAngle(pose.toolAngle).setVisible(slot.working);
				if (slot.actor.visible) {
					this.ambient.fillStyle(slot.working ? 0xc4d3a4 : 0x9bbebb, slot.working ? .2 : .12).fillEllipse(slot.actor.x, slot.actor.y + 1, 19, 3);
					if (slot.label.visible) {
						slot.label.setScale(1 / Math.max(1, this.viewCamera.zoom / 1.5));
						const halfWidth = slot.label.width * slot.label.scaleX / 2, scale = slot.actor.scaleX;
						const left = this.viewCamera.x + 10 / this.viewCamera.zoom, right = this.viewCamera.x + (this.viewport.width - 10) / this.viewCamera.zoom;
						slot.label.setX(Phaser.Math.Clamp(0, (left - slot.actor.x) / scale + halfWidth, (right - slot.actor.x) / scale - halfWidth));
						slot.label.setY(Math.max(-64, (this.viewCamera.y + 8 / this.viewCamera.zoom - slot.actor.y) / scale + slot.label.height * slot.label.scaleY / 2));
					}
					if ((slot.hovered || this.viewState?.selectedScavId === id) && slot.route.length) {
						line(this.ambient, [slot.position, ...slot.route].map(projectShelterPoint), 0xe8c99d, 2, .26);
						const target = projectShelterPoint(slot.anchor);
						this.ambient.lineStyle(1.2, 0xe8c99d, .55).strokeEllipse(target.x, target.y, 17, 6);
					}
				}
			}
			const liftPoint = projectShelterPoint({ x: SHELTER_SHAFT_X, y: this.liftModel.y });
			this.elevator.setPosition(liftPoint.x, liftPoint.y).setDepth(liftPoint.y - 1);
			this.liftDoors.clear();
			if (!this.liftModel.doorOpen) line(this.liftDoors, [{ x: -13, y: -21 }, { x: 13, y: -21 }], 0xb4b692, 1.6, .85);
			this.liftDoors.fillStyle(this.liftModel.phase === "travel" ? 0xe0c17b : this.liftModel.doorOpen ? 0xb1d28a : 0x7f9384).fillCircle(13, -22, 2);
			for (const cell of this.cells.values()) {
				const g = cell.animation;
				g.clear();
				cell.productLabel.setVisible(Boolean(cell.production?.jobId) && (this.viewCamera.zoom >= 1.6 || cell.hovered || this.viewState?.selectedRoomId === cell.room?.id));
				if (!cell.room) continue;
				const elapsed = time - cell.completedAt, p = cellPosition(cell.column, cell.row);
				const badge = projectShelterPoint({ x: p.x + 86, y: p.y + 93 });
				cell.feedback.setVisible(elapsed >= 0 && elapsed < 1800).setAlpha(reducedMotion ? 1 : Phaser.Math.Clamp(1 - elapsed / 1800, 0, 1)).setY(badge.y - 23 - (reducedMotion ? 0 : Math.max(0, elapsed) / 120));
				if (cell.production) cell.stationClock = advanceShelterStationClock(cell.stationClock, delta, cell.production, reducedMotion);
				paintIsometricProduction(g, cell.column, cell.row, cell.room, cell.production, cell.stationClock, reducedMotion);
			}
		}
		private paintMap(): void {
			const g = this.add.graphics();
			this.mapLayer.add(g);
			g.fillStyle(0x1e2921).fillRect(0, 0, WIDTH, HEIGHT);
			g.fillStyle(0x26352a).fillRoundedRect(20, 20, 800, 420, 2);
			const rng = random(4731);
			for (let n = 0; n < 1300; n++)
				g.fillStyle(n % 2 ? 0xc3bc87 : 0x07120b, 0.035).fillRect(
					20 + rng() * 800,
					20 + rng() * 420,
					1 + rng() * 3,
					1
				);
			for (let x = 30; x <= 810; x += 42)
				line(
					g,
					[
						{ x, y: 20 },
						{ x, y: 440 },
					],
					0x738563,
					1,
					0.13
				);
			for (let y = 20; y <= 440; y += 42)
				line(
					g,
					[
						{ x: 20, y },
						{ x: 820, y },
					],
					0x738563,
					1,
					0.13
				);

			// Survey contours wrap forest hills and a river; no per-frame path rebuilding.
			for (const hill of [
				{ x: 235, y: 120, rx: 130, ry: 65 },
				{ x: 620, y: 340, rx: 164, ry: 86 },
				{ x: 720, y: 105, rx: 88, ry: 51 },
			]) {
				for (let ring = 1; ring <= 5; ring++) {
					const points: Point[] = [];
					for (let n = 0; n <= 64; n++) {
						const angle = (n / 64) * Math.PI * 2;
						const wave =
							1 +
							Math.sin(angle * 4 + ring * 0.2) * 0.11 +
							Math.sin(angle * 7) * 0.035;
						points.push({
							x: hill.x + ((Math.cos(angle) * hill.rx * ring) / 5) * wave,
							y: hill.y + ((Math.sin(angle) * hill.ry * ring) / 5) * wave,
						});
					}
					line(g, points, 0x7d8a64, 1, 0.18);
				}
			}
			const river: Point[] = [];
			for (let y = 25; y <= 433; y += 8)
				river.push({
					x: 454 + Math.sin(y / 61) * 47 + Math.sin(y / 24) * 11,
					y,
				});
			line(g, river, 0x101f1e, 17);
			line(g, river, 0x587c76, 9, 0.55);
			line(g, river, 0x87a49a, 1, 0.4);
			for (let n = 0; n < 75; n++) {
				const x = 72 + rng() * 690,
					y = 65 + rng() * 330;
				if (Math.abs(x - (454 + Math.sin(y / 61) * 47)) < 45) continue;
				const h = 5 + rng() * 5;
				polygon(
					g,
					[
						{ x, y: y - h },
						{ x: x - 4, y },
						{ x: x + 4, y },
					],
					0x14241b,
					0.8
				);
				line(
					g,
					[
						{ x, y: y - h + 2 },
						{ x, y: y + 3 },
					],
					0x6c7954,
					1,
					0.2
				);
			}
			// Industrial footprint blocks: yards, apartment grids and the fenced perimeter.
			for (const district of [
				{ x: 590, y: 132, w: 4, h: 3 },
				{ x: 285, y: 262, w: 3, h: 3 },
				{ x: 655, y: 248, w: 3, h: 2 },
			]) {
				for (let row = 0; row < district.h; row++)
					for (let col = 0; col < district.w; col++) {
						g.fillStyle(0x7e8161, 0.26).fillRect(
							district.x + col * 18,
							district.y + row * 14,
							11,
							8
						);
						g.lineStyle(1, 0xa5a17b, 0.22).strokeRect(
							district.x + col * 18,
							district.y + row * 14,
							11,
							8
						);
					}
				g.lineStyle(1, 0xa59d72, 0.2).strokeRect(
					district.x - 7,
					district.y - 7,
					district.w * 18 + 2,
					district.h * 14 + 2
				);
			}
			const places = snapshot().maps;
			let previous = this.hq;
			for (const place of places) {
				const p = position(place);
				const elbow = { x: p.x * 0.56 + previous.x * 0.44, y: previous.y - 20 };
				line(g, [previous, elbow, p], 0x111d13, 7, 0.8);
				line(g, [previous, elbow, p], 0x8b8968, 3, 0.48);
				dashed(g, previous, elbow, 0xc9b68a, 1, 0.35);
				dashed(g, elbow, p, 0xc9b68a, 1, 0.35);
				dashed(g, this.hq, p, 0xa59467, 1, 0.2);
				previous = p;
			}
			// Headquarters, compass and marginal field annotations.
			g.fillStyle(0xa6a279).fillRect(this.hq.x - 7, this.hq.y - 6, 14, 12);
			g.lineStyle(1, 0xc9bd8b).strokeRect(
				this.hq.x - 12,
				this.hq.y - 11,
				24,
				22
			);
			const compass = { x: 777, y: 66 };
			line(
				g,
				[
					{ x: compass.x, y: compass.y - 15 },
					{ x: compass.x, y: compass.y + 15 },
				],
				0xafb08a,
				1
			);
			line(
				g,
				[
					{ x: compass.x - 12, y: compass.y },
					{ x: compass.x + 12, y: compass.y },
				],
				0xafb08a,
				1
			);
			polygon(
				g,
				[
					{ x: compass.x, y: compass.y - 16 },
					{ x: compass.x - 3, y: compass.y - 8 },
					{ x: compass.x + 3, y: compass.y - 8 },
				],
				C.gold
			);
			this.mapLayer.add(this.text(777, 38, "С", 12, "#dacf9f").setOrigin(0.5));
			this.mapLayer.add(
				this.text(33, 32, "ОПЕРАТИВНАЯ КАРТА", 15, "#ddd6b4")
			);
			this.operationsCaption = this.text(33, 58, "", 12, "#bdc5a4");
			this.mapLayer.add(this.operationsCaption);
			this.mapLayer.add(
				this.text(
					32,
					420,
					"НАЖМИ НА РАЙОН, ЧТОБЫ ВЫБРАТЬ МАРШРУТ",
					12,
					"#b9bda0"
				)
			);
			this.mapLayer.add(
				this.text(774, 421, "1:25 000", 11, "#b4a783").setOrigin(1, 0)
			);
			this.mapLayer.add(
				this.text(this.hq.x, this.hq.y + 23, "БАЗА", 13, "#d4caa5").setOrigin(
					0.5
				)
			);
			this.selectedRoute = this.add.graphics();
			this.mapLayer.add(this.selectedRoute);
			for (const place of places) this.mapPlace(place);
		}

		private mapPlace(place: MapPlace): void {
			const p = position(place);
			const dot = this.add.graphics();
			const label = this.text(
				p.x,
				p.y + 28,
				place.name.toUpperCase(),
				16,
				"#e1dbc0"
			).setOrigin(0.5);
			label.setBackgroundColor("#14251b").setPadding(9, 5);
			const detail = this.text(p.x, p.y + 57, "", 12, "#c0c3a0").setOrigin(0.5)
				.setBackgroundColor("#1b2b20").setPadding(5, 3);
			const zone = this.add
				.zone(p.x, p.y + 22, Math.max(label.width + 14, 136), 110)
				.setInteractive({ useHandCursor: true });
			zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
				if (!this.acceptsPointer(pointer, "map")) return;
				const current = snapshot();
				const candidate = current.maps.find((entry) => entry.id === place.id);
				if (
					requestedView === "map" &&
					candidate &&
					current.level >= candidate.level
				) {
					this.clickFeedback(p, this.mapLayer);
					onMap(place.id);
					this.syncSnapshot();
				}
			});
			zone.on("pointerover", (pointer: Phaser.Input.Pointer) => {
				const item = this.places.get(place.id);
				if (!this.acceptsPointer(pointer, "map") || !item) return;
				item.hovered = true;
				this.syncSnapshot();
			});
			zone.on("pointerout", () => {
				const item = this.places.get(place.id);
				if (item) item.hovered = false;
				this.syncSnapshot();
			});
			this.mapLayer.add([dot, label, detail, zone]);
			this.places.set(place.id, { dot, label, detail, zone, active: false, hovered: false });
		}

		private syncSnapshot(): void {
			if (!this.baseCaption) return;
			const state = snapshot();
			this.lastSelection = `${state.selectedScavId ?? ""}:${state.selectedMapId ?? ""}:${state.selectedRoomId ?? ""}:${state.selectedSite?.column ?? ""}:${state.selectedSite?.row ?? ""}`;
			this.syncShelter(state);
			this.operationsCaption.setText(`В РЕЙДЕ: ${state.raids.length}  ·  ЖДУТ ПРИКАЗ: ${state.raids.filter((raid) => raid.expedition?.status === "choice").length}`);
			this.selectedRoute.clear();
			const selectedPlace = state.maps.find((place) => place.id === state.selectedMapId && state.level >= place.level);
			if (selectedPlace) {
				const selectedPoint = position(selectedPlace);
				line(this.selectedRoute, [this.hq, selectedPoint], C.gold, 4, 0.12);
				dashed(this.selectedRoute, this.hq, selectedPoint, C.light, 2, 0.7);
			}
			for (const place of state.maps) {
				const item = this.places.get(place.id);
				if (!item) continue;
				const p = position(place),
					active = state.level >= place.level;
				const selected = active && state.selectedMapId === place.id;
				const highlighted = selected || (active && item.hovered);
				const color = highlighted ? C.light : active ? tint(place.accent) : 0x899279;
				item.active = active;
				if (item.zone.input) item.zone.input.cursor = active ? "pointer" : "not-allowed";
				item.dot.clear();
				if (highlighted) item.dot.fillStyle(C.gold, 0.13).fillCircle(p.x, p.y, 27);
				item.dot
					.lineStyle(highlighted ? 2 : 1, color, active ? 0.75 : 0.35)
					.strokeCircle(p.x, p.y, highlighted ? 24 : 20);
				item.dot.fillStyle(0x14231a).fillCircle(p.x, p.y, 11);
				item.dot
					.lineStyle(2, color, active ? 1 : 0.55)
					.strokeCircle(p.x, p.y, 11);
				item.dot.fillStyle(color, active ? 1 : 0.4).fillCircle(p.x, p.y, 3);
				for (const d of [-1, 1]) {
					line(
						item.dot,
						[
							{ x: p.x + d * 14, y: p.y },
							{ x: p.x + d * 22, y: p.y },
						],
						color,
						1,
						0.7
					);
					line(
						item.dot,
						[
							{ x: p.x, y: p.y + d * 14 },
							{ x: p.x, y: p.y + d * 22 },
						],
						color,
						1,
						0.7
					);
				}
				item.label.setColor(highlighted ? "#ffdfa4" : active ? "#e1dbc0" : "#a2ae93")
					.setBackgroundColor(highlighted ? "#3b3c2a" : "#14251b");
				item.detail.setColor(active ? "#c0c3a0" : "#a2ae93");
				const raiding = state.raids.filter(
					(raid) => raid.mapId === place.id
				).length;
				item.detail.setText(
					active
						? raiding
							? `В РЕЙДЕ: ${raiding}`
							: selected ? "МАРШРУТ ВЫБРАН" : "ВЫБРАТЬ ↗"
						: `ЗАКРЫТО · УР. ${place.level}`
				);
			}
			const live = new Set(state.raids.map((raid) => raid.id));
			for (const [id, marker] of this.raidActors)
				if (!live.has(id)) {
					this.tweens.killTweensOf(marker.ring);
					marker.actor.destroy(true);
					this.raidActors.delete(id);
				}
			for (const raid of state.raids)
				if (!this.raidActors.has(raid.id)) {
					const marker = this.add.container(this.hq.x, this.hq.y);
					const color = raid.isAuto ? 0xa8c986 : 0xe8bb76;
					const ring = this.add
						.ellipse(0, 0, 20, 20)
						.setStrokeStyle(1, color, 0.6);
					const dot = this.add.rectangle(0, 0, 8, 8, color).setAngle(45);
					const label = this.text(
						0,
						-26,
						raid.scavName.toLocaleUpperCase("ru-RU"),
						14,
						"#f3dfb4"
					).setOrigin(0.5);
					const phase = this.text(0, 22, "", 12, "#edcc91").setOrigin(0.5);
					label
						.setBackgroundColor("#17231b")
						.setPadding(3, 2)
						.setVisible(false);
					phase
						.setBackgroundColor("#17231b")
						.setPadding(3, 2)
						.setVisible(false);
					marker.setSize(44, 44).setInteractive({ useHandCursor: true });
					marker.on("pointerover", (pointer: Phaser.Input.Pointer) => {
						const item = this.raidActors.get(raid.id);
						if (!this.acceptsPointer(pointer, "map") || !item) return;
						item.hovered = true;
						label.setVisible(true);
						phase.setVisible(true);
					});
					marker.on("pointerout", () => {
						const item = this.raidActors.get(raid.id);
						if (item) item.hovered = false;
						const selected = snapshot().selectedScavId === raid.scavId;
						const waiting = snapshot().raids.find((item) => item.id === raid.id)?.expedition?.status === "choice";
						label.setVisible(selected);
						phase.setVisible(selected || waiting);
					});
					marker.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
						if (!this.acceptsPointer(pointer, "map")) return;
						this.clickFeedback({ x: marker.x, y: marker.y }, this.mapLayer);
						interactions.onScav?.(raid.scavId);
					});
					marker.add([ring, dot, label, phase]);
					this.mapLayer.add(marker);
					this.raidActors.set(raid.id, { actor: marker, ring, label, phase, hovered: false });
					if (!reducedMotion) this.tweens.add({
						targets: ring,
						scale: 1.65,
						alpha: 0.08,
						duration: 1400,
						repeat: -1,
					});
				}
			for (const raid of state.raids) {
				const marker = this.raidActors.get(raid.id);
				if (!marker) continue;
				const selected = state.selectedScavId === raid.scavId;
				const waiting = raid.expedition?.status === "choice";
				marker.label.setVisible(selected || marker.hovered);
				marker.phase.setVisible(selected || marker.hovered || waiting).setText(
					waiting && !selected && !marker.hovered ? "!" : `${raid.isAuto ? "↻ " : ""}${getRaidPhase(raid, Date.now()).label.toLocaleUpperCase("ru-RU")}`
				);
				marker.phase.setColor(waiting ? "#ffe0a0" : "#edcc91");
				marker.actor.setDepth(selected ? 2000 : 0);
			}
			this.mapLayer.sort("depth");
		}

		update(time: number, delta: number): void {
			if (this.drag && (document.hidden || interactions.canDrag?.() === false)) this.cancelScavDrag();
			if ((this.panGesture || this.spacePressed) && !this.cameraAllowed()) this.cancelCameraGesture();
			const selection = snapshot();
			if (time - this.lastSync > 1000 || `${selection.selectedScavId ?? ""}:${selection.selectedMapId ?? ""}:${selection.selectedRoomId ?? ""}:${selection.selectedSite?.column ?? ""}:${selection.selectedSite?.row ?? ""}` !== this.lastSelection) {
				this.lastSync = time;
				this.syncSnapshot();
			}
			if (requestedView === "base" && !document.hidden) {
				this.animateShelter(time, delta);
				this.baseLayer.sort("depth");
			} else if (requestedView === "raid" && !document.hidden) {
				this.raidStreet.update(selection, Date.now(), delta);
			} else if (requestedView === "map" && !document.hidden) {
				const state = snapshot(),
					now = Date.now();
				for (const raid of state.raids) {
					const marker = this.raidActors.get(raid.id),
						place = state.maps.find((candidate) => candidate.id === raid.mapId);
					if (!marker || !place) continue;
					const p = position(place);
					const progress = Phaser.Math.Clamp(
						(now - raid.startedAt) / Math.max(1, raid.endsAt - raid.startedAt),
						0,
						1
					);
					// Travel out, search locally, then return; completed raids wait at headquarters.
					let travel: number;
					if (raid.expedition?.status === "choice") travel = 1;
					else if (progress < 0.22) travel = progress / 0.22;
					else if (progress > 0.8) travel = (1 - progress) / 0.2;
					else travel = 1;
					const search = progress >= 0.22 && progress <= 0.8;
					const siblings = state.raids.filter(
						(candidate) => candidate.mapId === raid.mapId
					);
					const rank = siblings.findIndex(
						(candidate) => candidate.id === raid.id
					);
					const offset = (rank - (siblings.length - 1) / 2) * 13;
					marker.actor.setPosition(
						this.hq.x +
							(p.x - this.hq.x) * travel +
							(search ? Math.sin(time / 1800 + raid.startedAt) * 14 : 0) +
							offset,
						this.hq.y +
							(p.y - this.hq.y) * travel +
							(search
								? Math.cos(time / 2300 + raid.startedAt) * 10
								: -Math.sin(travel * Math.PI) * 20)
					);
				}
			}
		}
	}

	const scene = new PraporWorld();
	const game = new Phaser.Game({
		type: Phaser.AUTO,
		parent,
		width: initialViewport.width,
		height: initialViewport.height,
		backgroundColor: "#10120f",
		antialias: true,
		pixelArt: false,
		roundPixels: true,
		scale: {
			mode: Phaser.Scale.FIT,
			autoCenter: Phaser.Scale.CENTER_BOTH,
			width: initialViewport.width,
			height: initialViewport.height,
		},
		fps: { target: 60 },
		audio: { noAudio: true },
		scene: [scene],
	});
	return {
		game, setView: (view) => scene.show(view),
		selectRaid: (id) => scene.selectRaid(id),
		setRaidFollow: (enabled) => scene.setRaidFollow(enabled),
		beginScavDrag: (id) => scene.beginScavDrag(id),
		moveScavDrag: (clientX, clientY) => scene.moveScavDrag(clientX, clientY),
		endScavDrag: () => scene.endScavDrag(),
		cancelScavDrag: () => scene.cancelScavDrag(),
		cancelCameraGesture: () => scene.cancelCameraGesture(),
		getCameraState: () => scene.getCameraState(),
		zoomBy: (factor, clientX, clientY) => scene.zoomBy(factor, clientX, clientY),
		panBy: (dx, dy) => scene.panBy(dx, dy),
		resetCamera: () => scene.resetCamera(),
		setPanMode: (enabled) => scene.setPanMode(enabled),
		focusRoom: (id) => scene.focusRoom(id),
		projectShelterRect: (rect) => scene.projectShelterRect(rect),
	};
}
