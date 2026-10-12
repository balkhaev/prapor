import Phaser from "phaser";
import { getRaidPhase, type Raid, type RoomInstance } from "./game/engine";
import { type BaseRoom } from "./game/data";
import { advanceShelterRoute, clientToShelterPoint, getShelterCell, planShelterRoute, SHELTER_SHAFT_X } from "./shelter-motion";

export interface WorldSnapshot {
	base: Record<string, number>;
	raids: Raid[];
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
type View = "base" | "map";
type MapPlace = WorldSnapshot["maps"][number];
type ScavActor = {
	actor: Phaser.GameObjects.Container;
	body: Phaser.GameObjects.Container;
	legA: Phaser.GameObjects.Rectangle;
	legB: Phaser.GameObjects.Rectangle;
	hand: Phaser.GameObjects.Rectangle;
	gear: Phaser.GameObjects.Graphics;
	tool: Phaser.GameObjects.Graphics;
	label: Phaser.GameObjects.Text;
	order: Phaser.GameObjects.Arc;
	selection: Phaser.GameObjects.Ellipse;
	hovered: boolean;
	gearSignature: string;
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
	getAssignmentReason?: (scavId: string, roomId: string) => string | null;
	onAssignScav?: (scavId: string, roomId: string) => void;
	onDragState?: (state: { scavId: string; roomId: string | null; reason: string | null } | null) => void;
	onRoom?: (room: BaseRoom) => void;
	onScav?: (id: string) => void;
	onShelterRoom?: (roomId: string) => void;
	onBuildSite?: (site: { column: number; row: number }) => void;
	onShelterSite?: (column: number, row: number) => void;
}
type ShelterCell = {
	root: Phaser.GameObjects.Container;
	art: Phaser.GameObjects.Graphics;
	frame: Phaser.GameObjects.Graphics;
	progress: Phaser.GameObjects.Graphics;
	animation: Phaser.GameObjects.Graphics;
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
const cellPosition = (column: number, row: number): Point => ({ x: [40, 220, 448, 628][column] ?? 40, y: 148 + row * 111 });
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
function rifle(
	g: Phaser.GameObjects.Graphics,
	x: number,
	y: number,
	scale = 1,
	warm = true
): void {
	const p = (px: number, py: number): Point => ({
		x: x + px * scale,
		y: y + py * scale,
	});
	polygon(
		g,
		[p(-20, -3), p(-11, -4), p(-7, 0), p(-13, 3), p(-21, 2)],
		warm ? 0x8d6542 : 0x34403a
	);
	line(g, [p(-12, 0), p(12, 0)], 0x17221c, 5 * scale);
	line(g, [p(10, 0), p(26, 0)], 0x9b9c83, 2 * scale);
	line(g, [p(25, 0), p(25, -4)], 0x9b9c83, 2 * scale);
	polygon(g, [p(-1, 2), p(6, 2), p(4, 11), p(0, 10)], 0x17221c);
	polygon(g, [p(-8, 3), p(-3, 3), p(-5, 8), p(-9, 7)], 0x293329);
	line(g, [p(2, -4), p(9, -4)], 0x8d977b, 2 * scale);
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
): { game: Phaser.Game; setView: (view: View) => void; beginScavDrag: (id: string) => boolean; moveScavDrag: (clientX: number, clientY: number) => void; endScavDrag: () => void; cancelScavDrag: () => void } {
	let requestedView: View = "base";
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	class PraporWorld extends Phaser.Scene {
		private baseLayer!: Phaser.GameObjects.Container;
		private mapLayer!: Phaser.GameObjects.Container;
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
		private shaftUser: string | null = null;
		private liftFeet = 228;
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

		create(): void {
			this.cameras.main.setBackgroundColor(C.void);
			this.makeGlow();
			this.baseLayer = this.add.container(0, 0);
			this.mapLayer = this.add.container(0, 30);
			this.paintBunker();
			this.paintMap();
			this.installDragListeners();
			this.syncSnapshot();
			this.show(requestedView);
			this.game.canvas.setAttribute("aria-hidden", "true");
			this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
				this.cancelScavDrag();
				this.nativeEvents.abort();
				this.raidActors.clear();
				this.places.clear();
				this.cells.clear();
				this.scavs.clear();
			});
		}

		show(view: View): void {
			if (view !== requestedView) this.cancelScavDrag();
			requestedView = view;
			if (!this.baseLayer) return;
			this.baseLayer.setVisible(view === "base");
			this.mapLayer.setVisible(view === "map");
			this.input.setDefaultCursor("default");
			this.scavs.forEach((actor) => { actor.hovered = false; });
			this.places.forEach((place) => { place.hovered = false; });
			this.syncSnapshot();
		}

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
				&& !this.drag
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
			if (!this.baseLayer || !this.scene.isActive() || requestedView !== "base" || document.hidden || this.drag || interactions.canDrag?.() === false || !interactions.onAssignScav) return false;
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
			const point = clientToShelterPoint(clientX, clientY, this.game.canvas.getBoundingClientRect(), WIDTH, HEIGHT);
			const site = point ? getShelterCell(point) : null;
			const room = site ? state.shelter?.rooms.find((candidate) => candidate.column === site.column && candidate.row === site.row) : undefined;
			const roomId = room?.id ?? null;
			const reason = roomId ? this.assignmentReason(drag.scavId, roomId) : site ? "Сначала построй комнату" : point ? "Перенеси бойца в производственную комнату" : "Отпусти над комнатой убежища";
			const changed = drag.roomId !== roomId || drag.reason !== reason;
			drag.point = point; drag.cellKey = site ? `${site.column}:${site.row}` : null; drag.roomId = roomId; drag.reason = reason;
			this.dragGhost.clear();
			if (drag.canvas && point) {
				this.dragGhost.fillStyle(0x0a1915, .45).fillEllipse(point.x, point.y + 20, 24, 8);
				this.dragGhost.fillStyle(0xb2c68e).fillRect(point.x - 7, point.y - 13, 14, 18).fillStyle(0xcab18b).fillRect(point.x - 5, point.y - 24, 10, 10);
				this.dragGhost.fillStyle(0x557663).fillRect(point.x - 6, point.y - 26, 12, 5).fillStyle(0x365341).fillRect(point.x - 5, point.y + 5, 4, 12).fillRect(point.x + 2, point.y + 5, 4, 12);
				this.dragGhost.lineStyle(2, reason ? 0xd49a7e : 0xb7dfa0, .9).strokeRoundedRect(point.x - 12, point.y - 30, 25, 51, 4);
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
				if (event.button !== 0 || event.target !== canvas || requestedView !== "base" || this.gesture || this.drag || interactions.canInteract?.() === false) return;
				const point = clientToShelterPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), WIDTH, HEIGHT);
				if (!point) return;
				const hit = [...this.scavs].filter(([, slot]) => slot.actor.visible && Math.abs(slot.actor.x - point.x) <= 16 * slot.actor.scaleX && point.y >= slot.actor.y - 44 * slot.actor.scaleY && point.y <= slot.actor.y + 2).sort((a, b) => Math.hypot(a[1].actor.x - point.x, a[1].actor.y - 21 - point.y) - Math.hypot(b[1].actor.x - point.x, b[1].actor.y - 21 - point.y))[0];
				if (!hit) return;
				this.gesture = { scavId: hit[0], pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, active: false };
				canvas.setPointerCapture(event.pointerId);
			}, options);
			canvas.addEventListener("pointermove", (event) => {
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
				const gesture = this.gesture;
				if (!gesture || event.pointerId !== gesture.pointerId) return;
				if (gesture.active) { this.moveScavDrag(event.clientX, event.clientY); this.endScavDrag(); return; }
				const tapped = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 8;
				this.clearGesture();
				if (tapped && requestedView === "base" && interactions.canInteract?.() !== false && clientToShelterPoint(event.clientX, event.clientY, canvas.getBoundingClientRect())) interactions.onScav?.(gesture.scavId);
			}, options);
			canvas.addEventListener("pointercancel", () => this.cancelScavDrag(), options);
			canvas.addEventListener("lostpointercapture", () => { if (this.gesture) this.cancelScavDrag(); }, options);
			window.addEventListener("keydown", (event) => { if (event.key === "Escape" && (this.drag || this.gesture)) { event.preventDefault(); this.cancelScavDrag(); } }, options);
			window.addEventListener("blur", () => this.cancelScavDrag(), options);
			window.addEventListener("resize", () => this.cancelScavDrag(), options);
			document.addEventListener("visibilitychange", () => { if (document.hidden) this.cancelScavDrag(); }, options);
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
			const g = this.add.graphics();
			this.baseLayer.add(g);
			const rng = random(90312);
			for (let y = 0; y < 128; y += 4) g.fillStyle(blend(0x263946, 0x26372e, y / 128)).fillRect(0, y, WIDTH, 4);
			g.fillStyle(0x879890, .13).fillEllipse(481, 40, 24, 24);
			g.fillStyle(0xb2c0ac, .38).fillCircle(481, 40, 4);
			g.fillStyle(0x1a2927, .8).fillRect(0, 78, WIDTH, 49);
			for (const building of [{ x: 530, w: 78, h: 38 }, { x: 615, w: 57, h: 51 }, { x: 711, w: 97, h: 36 }]) {
				g.fillStyle(0x162526).fillRect(building.x, 81 - building.h, building.w, building.h);
				g.fillStyle(0x668077, .12).fillRect(building.x, 81 - building.h, building.w, 2);
				for (let x = building.x + 9; x < building.x + building.w - 5; x += 15)
					g.fillStyle(0x7f8861, .09).fillRect(x, 51, 5, 10);
			}
			line(g, [{ x: 729, y: 84 }, { x: 729, y: 21 }, { x: 743, y: 21 }], 0x5a684d, 3);
			line(g, [{ x: 650, y: 75 }, { x: 650, y: 28 }, { x: 651, y: 27 }], 0x4a5d46, 2);
			g.fillStyle(0x6c8c82, .07).fillRect(0, 76, WIDTH, 8);
			g.fillStyle(0x30312a).fillRect(0, 126, WIDTH, HEIGHT - 126);
			for (const stratum of [{ y: 155, h: 67, c: 0x332f26 }, { y: 275, h: 57, c: 0x2d2b24 }, { y: 402, h: 69, c: 0x292c24 }]) {
				polygon(g, [{ x: 0, y: stratum.y }, { x: 186, y: stratum.y - 8 }, { x: 394, y: stratum.y + 7 }, { x: 840, y: stratum.y - 11 }, { x: 840, y: stratum.y + stratum.h }, { x: 0, y: stratum.y + stratum.h + 13 }], stratum.c);
			}
			for (let n = 0; n < 950; n++) {
				const x = rng() * WIDTH, y = 127 + rng() * 393;
				g.fillStyle(n % 4 ? 0x8b8060 : 0x0c160f, .08 + rng() * .16).fillRect(x, y, 1 + rng() * 5, 1 + rng() * 2);
			}
			line(g, [{ x: 3, y: 142 }, { x: 22, y: 169 }, { x: 10, y: 222 }], 0x171d16, 2);
			line(g, [{ x: 826, y: 262 }, { x: 832, y: 307 }, { x: 820, y: 351 }], 0x171d16, 2);
			g.fillStyle(0x101b13).fillRect(28, 133, 784, 349);
			g.fillStyle(0x555d49).fillRect(30, 137, 780, 11);
			g.fillStyle(0x363f30).fillRect(28, 147, 10, 335).fillRect(802, 147, 10, 335);
			for (let row = 0; row <= 3; row++) {
				const y = 144 + row * 111;
				g.fillStyle(0x525b46).fillRect(31, y, 778, 9);
				g.fillStyle(0x9ca082, .3).fillRect(31, y, 778, 1);
				g.fillStyle(0x121c13).fillRect(31, y + 7, 778, 3);
				for (let x = 40; x < 796; x += 32) g.fillStyle(0x151e15, .35).fillRect(x, y + 4, 17, 1);
			}
			// The entrance is a shared place for free workers, separated from production rooms.
			g.fillStyle(0x4b5147).fillRect(42, 73, 143, 60);
			g.fillStyle(0x717966).fillRect(35, 68, 157, 9);
			g.fillStyle(0xb0b49c, .45).fillRect(35, 68, 157, 2);
			g.fillStyle(0x111d19, .45).fillRect(42, 77, 143, 3);
			g.fillStyle(0x131f16).fillRoundedRect(91, 80, 54, 53, 3);
			g.lineStyle(3, 0x7a8165).strokeRoundedRect(91, 80, 54, 53, 3);
			g.fillStyle(0x98aa79).fillRect(98, 86, 39, 20);
			g.fillStyle(0xd4d9a4, .23).fillRect(99, 87, 37, 4);
			line(g, [{ x: 117, y: 87 }, { x: 117, y: 107 }], 0x1b2c1b, 2);
			g.fillStyle(C.gold).fillRect(132, 113, 3, 3);
			g.fillStyle(0x2c3c32).fillRect(181, 86, 620, 47);
			g.fillStyle(0x657766, .13).fillRect(182, 89, 617, 26);
			g.fillStyle(0x859070, .22).fillRect(181, 86, 620, 2);
			g.fillStyle(0x5b6550).fillRect(181, 130, 620, 4);
			for (let x = 194; x < 786; x += 26) line(g, [{ x, y: 130 }, { x: x + 12, y: 130 }], C.gold, 2, .21);
			g.fillStyle(0x17251a).fillRect(197, 90, 73, 27);
			g.fillStyle(0x777b5e).fillRect(203, 94, 17, 17).fillRect(224, 94, 17, 8).fillRect(247, 94, 16, 15);
			g.fillStyle(0x202d20).fillRect(693, 109, 67, 5).fillRect(701, 114, 3, 15).fillRect(749, 114, 3, 15);
			g.fillStyle(0x5b5e41).fillRect(704, 102, 15, 7).fillRect(735, 104, 17, 5);
			for (const x of [324, 568, 768]) {
				line(g, [{ x, y: 87 }, { x, y: 96 }], 0x101d18, 1.3);
				g.fillStyle(0x738778).fillRect(x - 11, 95, 22, 4);
				g.fillStyle(0xdcdcb6).fillRect(x - 8, 98, 16, 2);
				polygon(g, [{ x: x - 8, y: 100 }, { x: x + 8, y: 100 }, { x: x + 27, y: 130 }, { x: x - 27, y: 130 }], 0xe1d4aa, .06);
			}
			g.fillStyle(0x263a30).fillRect(772, 111, 14, 17);
			g.fillStyle(0x728269).fillEllipse(779, 110, 14, 4);
			g.fillStyle(0xd0ae77).fillRect(776, 116, 5, 6);
			for (let x = 181; x < 780; x += 85) {
				g.fillStyle(0x17241a).fillRect(x, 126, 2, 10);
				g.fillStyle(0x7a8a5a).fillRect(x - 3, 124, 7, 2);
			}
			g.fillStyle(0x131e15).fillRect(393, 84, 54, 394);
			line(g, [{ x: 399, y: 91 }, { x: 399, y: 474 }], 0x67715b, 2);
			line(g, [{ x: 441, y: 91 }, { x: 441, y: 474 }], 0x67715b, 2);
			for (let y = 101; y < 474; y += 18) {
				line(g, [{ x: 398, y }, { x: 405, y }], 0x354735, 2);
				line(g, [{ x: 435, y }, { x: 442, y }], 0x354735, 2);
			}
			for (let row = 0; row < 3; row++) {
				this.baseLayer.add(this.text(10, 184 + row * 111, `−${row + 1}`, 13, "#9ba589"));
				for (let column = 0; column < 4; column++) this.createCell(column, row);
			}
			const lift = this.add.graphics();
			lift.fillStyle(0x384a37).fillRect(0, 0, 32, 59);
			lift.fillStyle(0x101e13).fillRect(4, 6, 24, 43);
			lift.lineStyle(2, 0x78846b).strokeRect(0, 0, 32, 59);
			for (let x = 7; x < 30; x += 6) line(lift, [{ x, y: 7 }, { x, y: 49 }], 0x606f54, 1);
			line(lift, [{ x: 4, y: 30 }, { x: 28, y: 30 }], 0x879271, 2);
			lift.fillStyle(C.gold).fillRect(4, 54, 24, 3);
			this.elevator = this.add.container(404, 179, [lift]).setDepth(20);
			this.baseLayer.add(this.elevator);
			for (const light of [{ x: 119, y: 108, tint: 0xffd7a0 }, { x: 324, y: 111, tint: 0xece1b4 }, { x: 568, y: 111, tint: 0xc6e5cc }]) {
				this.baseLayer.add(this.add.image(light.x, light.y, "prapor-light").setTint(light.tint).setScale(.43, .25).setAlpha(.18).setBlendMode(Phaser.BlendModes.ADD));
			}
			this.ambient = this.add.graphics().setDepth(10);
			this.baseLayer.add(this.ambient);
			this.dragGhost = this.add.graphics().setDepth(1200);
			this.baseLayer.add(this.dragGhost);
			this.baseCaption = this.text(31, 25, "УБЕЖИЩЕ · СВОИ ЛЮДИ", 15, "#ded2ae").setVisible(false);
			this.baseLayer.add(this.baseCaption);
			this.baseLayer.add(this.text(99, 75, "07", 10, "#e4c994"));
			this.baseLayer.add(this.text(545, 116, "ВХОД · СВОБОДНЫЙ ОТРЯД", 9, "#8f9f81"));
			this.shelterCaption = this.text(31, 493, "КОМНАТЫ · ЛЮДИ · ПРОИЗВОДСТВО", 12, "#abb69c");
			this.baseLayer.add(this.shelterCaption);
			this.baseLayer.sort("depth");
		}

		private createCell(column: number, row: number): void {
			const p = cellPosition(column, row);
			const art = this.add.graphics();
			const frame = this.add.graphics();
			const progress = this.add.graphics();
			const animation = this.add.graphics();
			const label = this.text(10, 2, "", 18, "#fff0d6").setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setShadow(0, 1, "#081416", 0, true, true);
			const status = this.text(22, 82, "", 14, "#c1d8bd").setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setShadow(0, 1, "#051010", 0, true, true);
			const feedback = this.text(86, 43, "", 16, "#e6ffce").setOrigin(.5).setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setBackgroundColor("#163023").setPadding(6, 3).setVisible(false);
			const lamp = this.add.image(85, 43, "prapor-light").setScale(.66, .38).setAlpha(.12).setBlendMode(Phaser.BlendModes.ADD);
			const zone = this.add.zone(86, 50, ROOM_WIDTH, ROOM_HEIGHT).setInteractive({ useHandCursor: true });
			const root = this.add.container(p.x, p.y, [art, lamp, animation, frame, label, status, progress, feedback, zone]);
			this.baseLayer.add(root);
			const cell: ShelterCell = { root, art, frame, progress, animation, label, status, lamp, zone, signature: "", column, row, hovered: false, room: null, working: false, operational: "empty", feedback, lastCycles: null, completedAt: -10000 };
			this.cells.set(`${column}:${row}`, cell);
			zone.on("pointerover", (pointer: Phaser.Input.Pointer) => { if (this.acceptsPointer(pointer, "base")) { cell.hovered = true; this.paintCellFrame(cell); } });
			zone.on("pointerout", () => { cell.hovered = false; this.paintCellFrame(cell); });
			zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
				if (!this.acceptsPointer(pointer, "base")) return;
				this.clickFeedback({ x: p.x + 86, y: p.y + 49 }, this.baseLayer);
				if (cell.room) {
					if (interactions.onShelterRoom) interactions.onShelterRoom(cell.room.id);
					else if (["workshop", "medbay", "radio", "storage"].includes(cell.room.type)) interactions.onRoom?.(cell.room.type as BaseRoom);
				}
				else if (interactions.onBuildSite) interactions.onBuildSite({ column, row });
				else interactions.onShelterSite?.(column, row);
			});
		}

		private paintCellFrame(cell: ShelterCell): void {
			const state = snapshot();
			const selected = Boolean(cell.room ? state.selectedRoomId === cell.room.id : state.selectedSite?.column === cell.column && state.selectedSite.row === cell.row);
			const building = cell.room && cell.room.status !== "ready";
			const color = selected || cell.hovered ? C.light : building ? C.gold : cell.room ? ROOM_STYLE[cell.room.type]?.color ?? 0x899a7c : 0x788b71;
			cell.frame.clear();
			if (this.drag) {
				const reason = cell.room ? this.assignmentReason(this.drag.scavId, cell.room.id) : "Сначала построй комнату";
				const target = this.drag.cellKey === `${cell.column}:${cell.row}`;
				const color = reason ? 0xcc7f6d : 0xa6d193;
				cell.frame.fillStyle(color, target ? .17 : .045).fillRect(2, 24, ROOM_WIDTH - 4, ROOM_HEIGHT - 27);
				cell.frame.lineStyle(target ? 3 : 1.4, color, target ? 1 : .58).strokeRect(1, 1, ROOM_WIDTH - 2, ROOM_HEIGHT - 2);
				return;
			}
			if (selected || cell.hovered) cell.frame.fillStyle(selected ? 0xffd99e : color, selected ? .055 : .025).fillRect(2, 24, ROOM_WIDTH - 4, ROOM_HEIGHT - 27);
			cell.frame.lineStyle(selected ? 2.5 : 1, color, selected || cell.hovered ? 1 : cell.room ? .64 : .28).strokeRect(1, 1, ROOM_WIDTH - 2, ROOM_HEIGHT - 2);
			if (selected || cell.hovered) {
				for (const x of [1, ROOM_WIDTH - 9]) for (const y of [1, ROOM_HEIGHT - 9]) cell.frame.fillStyle(C.gold, .85).fillRect(x, y, 8, 2).fillRect(x, y, 2, 8);
			}
			if (cell.operational === "working") cell.frame.fillStyle(0xc1e4a6, .78).fillRect(2, 78, 4, 14);
			else if (cell.operational === "blocked") cell.frame.fillStyle(0xf0b37e, .9).fillRect(2, 80, 4, 12);
		}

		private paintRoom(cell: ShelterCell): void {
			const g = cell.art, room = cell.room;
			g.clear();
			if (!room) {
				g.fillStyle(0x2d342b).fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
				const rng = random(cell.column * 829 + cell.row * 127 + 416);
				for (let n = 0; n < 15; n++) {
					const x = rng() * 176 - 7, y = 25 + rng() * 66, w = 12 + rng() * 33, h = 8 + rng() * 12;
					polygon(g, [{ x, y }, { x: x + w * .62, y: y - h * .4 }, { x: x + w, y: y + 2 }, { x: x + w * .7, y: y + h }, { x: x + 2, y: y + h * .85 }], n % 2 ? 0x444536 : 0x222c23);
					line(g, [{ x: x + 1, y: y + 1 }, { x: x + w * .62, y: y - h * .3 }, { x: x + w - 1, y: y + 3 }], 0x75816a, 1, .16);
				}
				g.fillStyle(0x151f18, .64).fillRect(0, 0, ROOM_WIDTH, 24).fillRect(0, 84, ROOM_WIDTH, 16);
				g.lineStyle(1, 0x99aa8c, .18).strokeRect(8, 31, 156, 46);
				for (let x = 21; x < 158; x += 18) for (let y = 38; y < 77; y += 18) g.fillStyle(0xa5b995, .18).fillCircle(x, y, .7);
				g.fillStyle(0x273c2c, .95).fillRoundedRect(66, 36, 40, 34, 4);
				g.lineStyle(1, 0xa6b99a, .66).strokeRoundedRect(66, 36, 40, 34, 4);
				line(g, [{ x: 77, y: 53 }, { x: 95, y: 53 }], 0xc6d6b9, 2.3, .9);
				line(g, [{ x: 86, y: 44 }, { x: 86, y: 62 }], 0xc6d6b9, 2.3, .9);
				cell.label.setText("УЧАСТОК +").setColor("#c2d1b6");
				cell.status.setText("ПОСТРОИТЬ").setColor("#bdcea9");
				cell.lamp.setVisible(false);
				return;
			}
			const style = ROOM_STYLE[room.type] ?? ROOM_STYLE.workshop!;
			g.fillStyle(0x101919).fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
			for (let y = 24; y < 82; y += 3) g.fillStyle(blend(style.wall, 0x101e25, (y - 24) / 170)).fillRect(6, y, 160, 3);
			polygon(g, [{ x: 0, y: 22 }, { x: 8, y: 30 }, { x: 8, y: 74 }, { x: 0, y: 83 }], blend(style.wall, 0x0b1314, .46));
			polygon(g, [{ x: 164, y: 30 }, { x: 172, y: 22 }, { x: 172, y: 83 }, { x: 164, y: 74 }], blend(style.wall, 0x030d0f, .58));
			polygon(g, [{ x: 8, y: 75 }, { x: 164, y: 75 }, { x: 172, y: 86 }, { x: 0, y: 86 }], blend(style.wall, 0x9ba7a3, .27));
			for (const x of [12, 39, 66, 93, 120, 147]) line(g, [{ x, y: 76 }, { x: (x - 86) * 1.16 + 86, y: 86 }], 0x111d1c, 1, .55);
			line(g, [{ x: 3, y: 80 }, { x: 168, y: 80 }], 0xc9c9b1, .8, .15);
			g.fillStyle(0x091416).fillRect(0, 84, ROOM_WIDTH, 16);
			g.fillStyle(blend(style.wall, 0x09151a, .42)).fillRect(1, 1, ROOM_WIDTH - 2, 22);
			g.fillStyle(style.color, .7).fillRect(1, 23, ROOM_WIDTH - 2, 1);
			g.fillStyle(style.color, .6).fillRect(2, 2, 3, 19);
			for (let y = 35; y < 76; y += 15) line(g, [{ x: 9, y }, { x: 164, y }], style.color, .7, .15);
			for (let x = 25; x < 164; x += 37) line(g, [{ x, y: 31 }, { x, y: 74 }], 0x071518, 1, .28);
			line(g, [{ x: 10, y: 30 }, { x: 161, y: 30 }, { x: 161, y: 76 }], 0x12221f, 4);
			line(g, [{ x: 10, y: 29 }, { x: 161, y: 29 }, { x: 161, y: 73 }], blend(style.color, 0x4f6257, .48), 1.5);
			for (const x of [13, 49, 87, 124]) g.fillStyle(0xc1c7ad, .7).fillRect(x, 27, 2, 5);
			g.fillStyle(0x081315).fillRoundedRect(60, 23, 52, 8, 2);
			g.fillStyle(0xc6cab4, .55).fillRect(63, 25, 46, 2);
			g.fillStyle(style.light).fillRect(66, 27, 40, 2);
			polygon(g, [{ x: 66, y: 29 }, { x: 35, y: 79 }, { x: 144, y: 79 }, { x: 106, y: 29 }], style.light, .075);
			cell.label.setText(style.label).setColor("#fff1dc");
			cell.lamp.setVisible(true).setTint(style.light);
			this.paintFurniture(g, room.type, room.level);
			this.paintRoomDetails(g, room.type, style.color);
			if (room.status !== "ready") {
				g.fillStyle(0x091115, .47).fillRect(1, 25, 170, 59);
				for (const x of [21, 87, 150]) {
					line(g, [{ x: x + 1, y: 30 }, { x: x + 1, y: 81 }], 0x101b1b, 5);
					line(g, [{ x, y: 28 }, { x, y: 80 }], 0xd6b776, 2.5);
				}
				for (const y of [43, 65]) { line(g, [{ x: 16, y: y + 2 }, { x: 154, y: y + 2 }], 0x192422, 5); line(g, [{ x: 16, y }, { x: 154, y }], 0xb59c6b, 2.5); }
				line(g, [{ x: 21, y: 78 }, { x: 87, y: 31 }, { x: 150, y: 78 }], 0xd0ad69, 1.5, .9);
				g.fillStyle(0xe0c385).fillRect(17, 78, 18, 4).fillRect(141, 78, 18, 4);
				for (let x = 12; x < 166; x += 12) line(g, [{ x, y: 83 }, { x: x + 5, y: 79 }], x % 24 ? 0x141e14 : 0xe2b667, 3);
				g.fillStyle(0xd5b374).fillRect(136, 29, 15, 10);
				g.fillStyle(0x2d3328).fillRect(141, 31, 3, 5).fillRect(141, 37, 3, 1);
				cell.label.setText(`${room.status === "building" ? "СТРОИТСЯ" : "УЛУЧШЕНИЕ"} · ${room.construction?.targetLevel ?? room.level + 1}`).setColor("#ffce8a");
			}
		}

		private paintRoomDetails(g: Phaser.GameObjects.Graphics, type: string, accent: number): void {
			// Fine material details are painted once, independently of production animation.
			const screw = (x: number, y: number) => { g.fillStyle(0xc3c6b0, .72).fillCircle(x, y, 1.1); line(g, [{ x: x - .6, y: y + .6 }, { x: x + .6, y: y - .6 }], 0x142321, .7); };
			for (const p of [{ x: 8, y: 25 }, { x: 164, y: 25 }, { x: 8, y: 81 }, { x: 164, y: 81 }]) screw(p.x, p.y);
			if (type === "workshop") {
				line(g, [{ x: 22, y: 72 }, { x: 61, y: 72 }], 0xdbc08d, 1.3, .65);
				for (let x = 28; x < 58; x += 7) { g.fillStyle(0xbca574).fillRect(x, 69, 2, 3); g.fillStyle(0x353d35).fillRect(x, 68, 2, 1); }
				line(g, [{ x: 104, y: 37 }, { x: 99, y: 47 }, { x: 104, y: 61 }], 0x191e1e, 2);
				g.fillStyle(0xbaa782).fillRect(109, 35, 44, 16);
				g.fillStyle(0x8c8069).fillRect(112, 38, 37, 10);
				rifle(g, 130, 42, .56, true);
				g.fillStyle(0xba9b70).fillCircle(81, 64, 2);
				line(g, [{ x: 109, y: 68 }, { x: 149, y: 68 }], 0xd2b07c, .7, .55);
				for (const x of [14, 63, 115, 156]) screw(x, 76);
			} else if (type === "ammo") {
				g.fillStyle(0x24341f).fillRect(10, 42, 9, 27);
				for (let y = 45; y < 68; y += 4) line(g, [{ x: 12, y }, { x: 17, y }], 0xb9b977, 1);
				line(g, [{ x: 71, y: 52 }, { x: 78, y: 52 }, { x: 78, y: 70 }], 0xabaf75, 2);
				g.fillStyle(0x172522).fillCircle(69, 60, 5);
				g.lineStyle(1, 0xd2cea2).strokeCircle(69, 60, 4);
				line(g, [{ x: 69, y: 60 }, { x: 71, y: 57 }], 0xe2b468, 1);
				for (let x = 83; x < 146; x += 8) g.fillStyle(0x212e23).fillCircle(x, 77, 2);
			} else if (type === "recycler") {
				for (let x = 22; x < 81; x += 10) line(g, [{ x, y: 78 }, { x: x + 4, y: 73 }], x % 20 ? 0x1c2521 : 0xdda66c, 3);
				g.lineStyle(1.3, 0xa2765b).strokeCircle(78, 55, 10);
				g.fillStyle(0x333a2f).fillCircle(78, 55, 7);
				line(g, [{ x: 10, y: 40 }, { x: 10, y: 32 }, { x: 51, y: 32 }], 0x8e6b51, 3);
				g.fillStyle(0xb4a083).fillRect(97, 41, 13, 9);
				line(g, [{ x: 103, y: 43 }, { x: 99, y: 47 }, { x: 107, y: 47 }], 0x526350, 1.5);
			} else if (type === "medbay") {
				g.fillStyle(0x82c2c0, .18).fillEllipse(38, 58, 64, 22);
				g.fillStyle(0xd7e6db).fillRect(77, 51, 19, 23);
				line(g, [{ x: 81, y: 52 }, { x: 87, y: 52 }, { x: 87, y: 72 }], 0x7ea5a1, 1);
				g.fillStyle(0xa9d0c3).fillCircle(92, 65, 2);
				for (let x = 104; x < 138; x += 8) { g.fillStyle(0xd8e3d0).fillRect(x, 73, 4, 6); g.fillStyle(0x9ec2bb).fillRect(x, 72, 4, 2); }
				line(g, [{ x: 78, y: 36 }, { x: 90, y: 36 }, { x: 90, y: 43 }], 0xbfdbcf, 2);
				g.fillStyle(0xb9dcce).fillEllipse(90, 44, 13, 4);
			} else if (type === "radio") {
				g.fillStyle(0x70d4bb, .13).fillEllipse(40, 67, 67, 25);
				for (let x = 24; x < 58; x += 4) for (let y = 47; y < 67; y += 4) g.fillStyle(0x86baa7, .08).fillRect(x, y, 1, 1);
				line(g, [{ x: 28, y: 69 }, { x: 29, y: 74 }, { x: 69, y: 74 }, { x: 72, y: 68 }], 0x132c2c, 2);
				g.fillStyle(0x8eaaa0).fillRect(29, 71, 29, 3);
				for (let x = 31; x < 58; x += 4) line(g, [{ x, y: 71 }, { x, y: 74 }], 0x314b48, .8);
				for (const x of [113, 117]) line(g, [{ x, y: 36 }, { x, y: 75 }], 0x15272a, 1.5);
				g.fillStyle(0xa5b48f).fillRect(99, 35, 10, 6);
			} else if (type === "storage") {
				g.fillStyle(0x222f28).fillRect(79, 34, 5, 49);
				g.fillStyle(0xd8c286).fillRect(19, 43, 10, 4).fillRect(102, 76, 11, 3);
				line(g, [{ x: 9, y: 33 }, { x: 154, y: 33 }], 0x89a187, 1.5);
				g.fillStyle(0xbfa57a).fillRect(149, 56, 12, 19);
				g.fillStyle(0x726c4f).fillRect(152, 59, 6, 12);
				for (const x of [16, 79, 89, 152]) screw(x, 80);
			} else if (type === "dormitory") {
				g.fillStyle(0xc1abc9).fillRect(31, 46, 41, 4).fillRect(115, 68, 40, 4);
				g.fillStyle(0x9082a1).fillRect(31, 48, 41, 2).fillRect(115, 70, 40, 2);
				g.fillStyle(0xc9a779).fillRoundedRect(76, 41, 18, 9, 2);
				g.fillStyle(0xf2d6a1).fillRect(78, 43, 14, 3);
				line(g, [{ x: 85, y: 49 }, { x: 85, y: 65 }], 0x9e8c75, 1.5);
				g.fillStyle(0x9f879b).fillRect(9, 34, 22, 9);
				g.fillStyle(0xc1b2bd).fillRect(12, 36, 16, 5);
			}
			g.fillStyle(accent, .12).fillRect(7, 82, 157, 1);
		}
		private paintFurniture(g: Phaser.GameObjects.Graphics, type: string, level: number): void {
			const panel = (x: number, y: number, w: number, h: number, color: number) => {
				g.fillStyle(0x061013, .8).fillRect(x + 2, y + 3, w, h);
				g.fillStyle(color).fillRect(x, y, w, h);
				g.fillStyle(blend(color, 0x030c10, .22)).fillRect(x, y + h * .7, w, h * .3);
				line(g, [{ x, y: y + h }, { x, y }, { x: x + w, y }], blend(color, 0xe0dfc5, .4), 1, .75);
				line(g, [{ x: x + w, y: y + 1 }, { x: x + w, y: y + h }], 0x061215, 1, .75);
			};
			const chest = (x: number, y: number, w: number, h: number, color = 0x8c855d) => {
				panel(x, y, w, h, color);
				line(g, [{ x: x + 5, y }, { x: x + 5, y: y + h }, { x: x + w - 5, y: y + h }, { x: x + w - 5, y }], 0x30453a, 2);
				g.fillStyle(0xe0c995).fillRect(x + w / 2 - 4, y + 4, 8, 3);
				line(g, [{ x: x + w / 2 - 2, y: y + 5 }, { x: x + w / 2 + 2, y: y + 5 }], 0x817b5b, .5);
			};
			switch (type) {
				case "workshop":
					panel(12, 37, 53, 33, 0x8c704e);
					for (let x = 18; x < 58; x += 10) { line(g, [{ x, y: 42 }, { x: x + 3, y: 54 }], 0xbcb79a, 2); g.fillStyle(0x222c21).fillRect(x - 1, 55, 5, 5); }
					panel(11, 72, 78, 7, 0x9e8059);
					g.fillStyle(0x44503a).fillRect(16, 79, 4, 4).fillRect(80, 79, 4, 4);
					panel(75, 57, 22, 19, 0x75867c);
					g.fillStyle(0x9aab80).fillRect(74, 60, 24, 3);
					line(g, [{ x: 68, y: 69 }, { x: 104, y: 69 }], 0xadb796, 2);
					g.fillStyle(0x293d2b).fillCircle(79, 64, 6);
					panel(113, 60, 46, 20, 0x8b7250);
					rifle(g, 131, 60, .5);
					chest(120, 75, 24, 9);
					break;
				case "ammo":
					panel(23, 37, 49, 43, 0x929267);
					panel(30, 45, 33, 25, 0x253829);
					g.fillStyle(0xa49b6a).fillRect(42, 43, 9, 27).fillRect(33, 68, 27, 5);
					g.fillStyle(0x9b8c5b).fillEllipse(47, 36, 33, 8);
					panel(78, 71, 74, 10, 0x53634a);
					for (let x = 84; x < 145; x += 9) g.fillStyle(0xd5b967).fillRect(x, 66, 3, 8);
					chest(114, 40, 32, 20, 0x938052);
					g.fillStyle(0x576b47).fillRect(152, 58, 9, 23);
					break;
				case "recycler":
					panel(17, 48, 65, 34, 0x92624f);
					polygon(g, [{ x: 18, y: 48 }, { x: 28, y: 36 }, { x: 68, y: 36 }, { x: 81, y: 48 }], 0x8b7450);
					g.fillStyle(0x192e21).fillRect(28, 48, 44, 19);
					for (let x = 30; x < 70; x += 7) g.fillStyle(0xb49d72).fillRect(x, 51, 3, 10);
					panel(86, 72, 67, 9, 0x4f6046);
					line(g, [{ x: 96, y: 65 }, { x: 108, y: 68 }, { x: 116, y: 62 }, { x: 130, y: 68 }], 0xa2a98b, 4);
					chest(118, 43, 35, 20, 0x595e46);
					g.fillStyle(0x82543c).fillRect(5, 68, 8, 13);
					break;
				case "medbay":
					panel(11, 35, 49, 24, 0x7aa7a4);
					panel(14, 38, 43, 18, 0x163d43);
					line(g, [{ x: 17, y: 48 }, { x: 24, y: 48 }, { x: 29, y: 43 }, { x: 34, y: 53 }, { x: 39, y: 43 }, { x: 44, y: 48 }, { x: 52, y: 48 }], 0xb5d0a5, 1.2);
					panel(12, 68, 62, 8, 0xa9cbc3);
					g.fillStyle(0xd2e5d6).fillRoundedRect(16, 63, 52, 7, 2);
					g.fillStyle(0xe0d8ba).fillRect(16, 61, 12, 8);
					line(g, [{ x: 15, y: 76 }, { x: 15, y: 82 }, { x: 69, y: 82 }, { x: 69, y: 76 }], 0x6d8368, 2);
					panel(101, 38, 38, 42, 0xa5c9c2);
					g.fillStyle(0xd4d6b5).fillRect(116, 44, 7, 18).fillRect(110, 50, 19, 6);
					line(g, [{ x: 104, y: 68 }, { x: 136, y: 68 }], 0x344d38, 2);
					g.fillStyle(0xd7d0af).fillRect(142, 70, 17, 4);
					line(g, [{ x: 154, y: 68 }, { x: 154, y: 63 }, { x: 147, y: 63 }], 0x97b49a, 2);
					break;
				case "radio":
					panel(12, 68, 96, 12, 0x497a78);
					panel(20, 44, 43, 26, 0x629d99);
					panel(24, 47, 35, 19, 0x0f383a);
					g.lineStyle(1, 0x9dbb87, .65).strokeCircle(42, 57, 7);
					line(g, [{ x: 28, y: 57 }, { x: 56, y: 57 }], 0x6b8e65, 1);
					panel(73, 53, 26, 16, 0x253f30);
					g.fillStyle(0xd1ba79).fillCircle(92, 62, 3);
					for (let x = 78; x < 91; x += 4) g.fillStyle(0x8eb176).fillRect(x, 57, 2, 3);
					panel(125, 34, 31, 47, 0x466b74);
					for (let y = 39; y < 78; y += 8) { panel(128, y, 25, 5, 0x183222); g.fillStyle(0x90b079).fillRect(148, y + 1, 2, 2); }
					line(g, [{ x: 82, y: 52 }, { x: 85, y: 32 }], 0x93a07f, 1.5);
					break;
				case "storage":
					for (const x of [13, 87]) {
						panel(x, 37, 65, 45, 0x31412e);
						line(g, [{ x, y: 36 }, { x, y: 81 }, { x: x + 65, y: 81 }, { x: x + 65, y: 36 }], 0x91a07a, 3);
						for (const y of [40, 56, 72]) {
							chest(x + 6, y, 24, 11, y === 40 ? 0x847651 : 0x64754c);
							chest(x + 35, y, 23, 11);
							line(g, [{ x, y: y + 12 }, { x: x + 65, y: y + 12 }], 0x8e9d78, 2);
						}
					}
					break;
				case "dormitory":
					for (const x of [12, 96]) {
						g.fillStyle(0x9a91a4).fillRect(x, 46, 3, 36).fillRect(x + 60, 46, 3, 36);
						for (const y of [49, 71]) {
							panel(x, y, 63, 5, 0x938b9e);
							g.fillStyle(0xc2bba5).fillRect(x + 5, y - 4, 13, 5);
							g.fillStyle(0x9d8eaf).fillRect(x + 20, y - 4, 37, 5);
						}
						line(g, [{ x: x + 52, y: 50 }, { x: x + 52, y: 82 }], 0x859575, 2);
						for (let y = 56; y < 80; y += 7) line(g, [{ x: x + 48, y }, { x: x + 57, y }], 0x859575, 1.5);
					}
					chest(77, 70, 16, 11, 0x76654d);
					break;
			}
			for (let n = 0; n < Math.min(5, level); n++) g.fillStyle(0xe3d4a9, .8).fillRect(152 - n * 5, 19, 3, 2);
		}

		private clickFeedback(at: Point, layer: Phaser.GameObjects.Container): void {
			const ring = this.add.circle(at.x, at.y, 15).setStrokeStyle(2, C.light, .85).setDepth(1500);
			layer.add(ring);
			this.tweens.add({ targets: ring, scale: reducedMotion ? 1 : 2.2, alpha: 0, duration: reducedMotion ? 80 : 320, onComplete: () => ring.destroy() });
		}

		private createScav(scavId: string, index: number, at: Point): ScavActor {
			const actor = this.add.container(at.x, at.y).setDepth(30);
			const body = this.add.container(0, 0);
			const shadow = this.add.ellipse(0, 1, 20, 5, 0x041014, .6);
			const selection = this.add.ellipse(0, 1, 27, 9).setStrokeStyle(1.5, C.gold).setVisible(false);
			const legA = this.add.rectangle(-3, -5, 4, 10, 0x526359).setStrokeStyle(.8, 0x07141b);
			const legB = this.add.rectangle(3, -5, 4, 10, 0x354f4a).setStrokeStyle(.8, 0x07141b);
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
			body.add([legA, legB, graphic, gear, hand, tool]);
			const label = this.text(0, -64, "", 16, "#ffedc7").setOrigin(.5).setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setBackgroundColor("#0b1b20").setPadding(7, 4).setVisible(false);
			const order = this.add.circle(-10, -34, 3.5, C.sage).setStrokeStyle(1, 0x10242b).setVisible(false);
			const hit = this.add.zone(0, -21, 32, 46).setInteractive({ useHandCursor: true });
			const slot: ScavActor = { actor, body, legA, legB, hand, gear, tool, label, order, selection, hovered: false, gearSignature: "", anchor: { ...at }, route: [], goal: "", assignment: null, role: "idle", dwellUntil: this.time.now + 2000 + index * 800, visit: 0, facing: 1, climbing: false, status: "ready", health: 100, working: false, walking: false, walkSpan: 0, phase: index * 1.71 };
			hit.on("pointerover", (pointer: Phaser.Input.Pointer) => { if (this.acceptsPointer(pointer, "base")) { slot.hovered = true; selection.setVisible(true); label.setVisible(true); actor.setDepth(80); } });
			hit.on("pointerout", () => { slot.hovered = false; const selected = snapshot().selectedScavId === scavId; selection.setVisible(selected); label.setVisible(selected); actor.setDepth(30); });
			// Native pointer-up distinguishes a deliberate tap from a drag before opening the inspector.
			actor.add([shadow, selection, body, label, order, hit]);
			this.baseLayer.add(actor);
			this.scavs.set(scavId, slot);
			return slot;
		}

		private syncShelter(state: WorldSnapshot): void {
			if (this.viewState && state.shelter !== this.viewState.shelter) {
				this.cancelScavDrag(); this.shaftUser = null; this.liftFeet = 228;
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
						cell.feedback.setText(`+${room.cycles - cell.lastCycles} ГОТОВО`).setVisible(true).setAlpha(1).setY(43);
					}
					cell.lastCycles = room.cycles;
					const construction = room.construction;
					const progress = construction ? construction.workDone / Math.max(1, construction.workRequired) : production?.progress ?? 0;
					const color = construction ? 0xf6c58b : cell.operational === "blocked" ? 0xe9ad7f : 0xb2d692;
					cell.progress.fillStyle(0x030e11).fillRect(1, 96, 170, 4);
					cell.progress.fillStyle(color, .95).fillRect(1, 96, Phaser.Math.Clamp(progress, 0, 1) * 170, 4);
					cell.progress.fillStyle(0xecf2d5, .24).fillRect(1, 96, Phaser.Math.Clamp(progress, 0, 1) * 170, 1);
					for (let worker = 0; worker < Math.min(3, room.workerIds.length); worker++) {
						const x = 162 - worker * 8;
						cell.progress.fillStyle(cell.working ? 0xc7dcaa : 0x9eb7ad, .85).fillCircle(x, 7, 1.7).fillRoundedRect(x - 2.4, 9, 4.8, 4, 1);
					}
					const seconds = production?.remainingSeconds;
					const remaining = Math.ceil(seconds ?? 0);
					const time = seconds === null || seconds === undefined ? "" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
					const reason = production?.reason?.toLocaleLowerCase("ru-RU") ?? "";
					const briefReason = reason.includes("склад") || reason.includes("мест") ? "СКЛАД ПОЛОН" : reason.includes("рабоч") ? "НУЖЕН РАБОЧИЙ" : reason.includes("нужно") ? "НУЖНЫ РЕСУРСЫ" : production?.reason ?? "";
					const status = construction ? `СТРОЙКА ${Math.floor(progress * 100)}%` : room.type === "storage" ? "ЗАПАСЫ" : room.type === "dormitory" ? "МЕСТА ОТРЯДА" : cell.working ? `РАБОТА ${time}` : production?.reason ? briefReason : !room.workerIds.length ? "НУЖЕН РАБОЧИЙ" : production?.status === "Нет заказа" ? "БЕЗ ЗАКАЗА" : "ЖДЁТ ПАРТИЮ";
					const clippedStatus = `${status.toLocaleUpperCase("ru-RU").slice(0, 17)}${status.length > 17 ? "…" : ""}`;
					cell.status.setText(clippedStatus).setColor(construction ? "#ffd399" : cell.working ? "#d1efb0" : cell.operational === "blocked" ? "#edc294" : "#c1cbbc");
					if (cell.working) {
						cell.progress.fillStyle(0x0d2219).fillCircle(11, 90, 5);
						polygon(cell.progress, [{ x: 9, y: 86 }, { x: 15, y: 90 }, { x: 9, y: 94 }], 0xc6e8a4);
					} else if (cell.operational === "blocked") cell.progress.fillStyle(0xf0bd8f).fillRect(7, 86, 3, 8).fillRect(12, 86, 3, 8);
					else if (construction) { line(cell.progress, [{ x: 7, y: 94 }, { x: 14, y: 87 }], 0xf4c687, 2.3); cell.progress.fillStyle(0xf4c687).fillRect(12, 85, 6, 3); }
					else cell.progress.lineStyle(1.5, 0xb5c2b1, .85).strokeCircle(11, 90, 4);
					cell.lamp.setAlpha(construction ? .12 : cell.working ? .3 : .2);
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

		private sendActor(slot: ScavActor, goal: string, at: Point): void {
			if (slot.goal === goal && Math.hypot(slot.anchor.x - at.x, slot.anchor.y - at.y) < 1) return;
			slot.goal = goal; slot.anchor = { ...at };
			slot.route = reducedMotion ? [] : planShelterRoute({ x: slot.actor.x, y: slot.actor.y }, at);
			if (reducedMotion) slot.actor.setPosition(at.x, at.y);
			slot.working = false;
		}

		private syncPeople(state: WorldSnapshot): void {
			const people = state.scavs ?? [], rooms = state.shelter?.rooms ?? [];
			const alive = new Set(people.map((scav) => scav.id));
			for (const [id, slot] of this.scavs) if (!alive.has(id)) { if (this.drag?.scavId === id) this.cancelScavDrag(); slot.actor.destroy(true); this.scavs.delete(id); }
			const free = people.filter((scav) => scav.status !== "raiding" && !rooms.some((room) => room.id === scav.assignment && room.workerIds.includes(scav.id)));
			people.forEach((scav, index) => {
				const room = rooms.find((candidate) => candidate.id === scav.assignment && candidate.workerIds.includes(scav.id));
				const rank = Math.max(0, room?.workerIds.indexOf(scav.id) ?? 0), roomPoint = room ? cellPosition(room.column, room.row) : null;
				const at = roomPoint ? { x: roomPoint.x + 68 + rank * 32, y: roomPoint.y + 80 } : this.homePosition(Math.max(0, free.indexOf(scav)), free.length);
				const slot = this.scavs.get(scav.id) ?? this.createScav(scav.id, index, at);
				const previousStatus = slot.status, previousAssignment = slot.assignment;
				slot.assignment = room?.id ?? null; slot.status = scav.status; slot.health = scav.health;
				if (this.drag?.scavId === scav.id && (scav.status === "raiding" || scav.health < 25 || this.drag.shelter !== state.shelter || this.drag.scav !== scav)) this.cancelScavDrag();
				if (scav.status === "raiding") { slot.actor.setVisible(false); slot.route = []; slot.goal = "raiding"; slot.working = false; return; }
				if (previousStatus === "raiding") slot.actor.setPosition(112, 129);
				slot.actor.setVisible(true).setScale(1.05).setAlpha(this.drag?.scavId === scav.id ? .45 : scav.status === "wounded" ? .78 : 1);
				if (scav.status === "wounded" && (!room || scav.health < 25)) {
					const rest = rooms.find((candidate) => candidate.type === "medbay" && candidate.status === "ready") ?? rooms.find((candidate) => candidate.type === "dormitory" && candidate.status === "ready");
					const p = rest ? cellPosition(rest.column, rest.row) : null;
					this.sendActor(slot, `rest:${rest?.id ?? "entrance"}`, p ? { x: p.x + 35 + index % 3 * 20, y: p.y + 80 } : at);
					slot.role = "rest";
				} else if (room) {
					this.sendActor(slot, `work:${room.id}:${rank}`, at);
					slot.role = room.type;
				} else if (!slot.goal || previousAssignment !== null || previousStatus !== "ready") {
					this.sendActor(slot, `idle-home:${index}`, at); slot.role = "idle";
				}
				const production = room ? state.roomProduction?.[room.id] : undefined;
				slot.working = Boolean(room && !slot.route.length && scav.health >= 25 && room.status === "ready" && room.queue.length && production?.rate && !production.reason);
				const selected = state.selectedScavId === scav.id;
				slot.selection.setVisible(selected || slot.hovered || this.drag?.scavId === scav.id).setStrokeStyle(1.5, selected ? C.light : C.gold);
				const activities: Record<string, string> = { workshop: "СОБИРАЕТ ДЕТАЛИ", ammo: "СНАРЯЖАЕТ ПАТРОНЫ", recycler: "СОРТИРУЕТ УТИЛЬ", medbay: "ГОТОВИТ МЕДИКАМЕНТЫ", radio: "РАБОТАЕТ В ЭФИРЕ" };
				const activity = slot.role === "rest" ? slot.route.length ? "ИДЁТ ОТДЫХАТЬ" : "ВОССТАНАВЛИВАЕТСЯ" : slot.route.length ? room ? `ИДЁТ: ${ROOM_STYLE[room.type]?.label ?? "КОМНАТА"}` : "ОСМАТРИВАЕТ БАЗУ" : slot.working ? activities[slot.role] ?? "РАБОТАЕТ" : room ? production?.reason?.toLocaleUpperCase("ru-RU").slice(0, 24) ?? "ЖДЁТ ЗАКАЗ" : "НА БАЗЕ";
				slot.label.setText(`${scav.name?.toLocaleUpperCase("ru-RU") ?? ""}\n${activity}`).setVisible(selected || slot.hovered);
				slot.order.setVisible(Boolean(scav.autoRaid?.enabled)).setFillStyle(scav.autoRaid?.waitingReason ? C.gold : C.sage);
				const gearSignature = `${scav.gear?.armor ?? 0}:${scav.gear?.backpack ?? 0}:${slot.role}`;
				if (slot.gearSignature !== gearSignature) {
					slot.gearSignature = gearSignature; slot.gear.clear(); slot.tool.clear();
					if (!room && scav.gear?.backpack) slot.gear.fillStyle(0x8c7650).fillRect(-10, -26, 5, 16).lineStyle(1, 0xbca16b).strokeRect(-10, -26, 5, 16);
					if (scav.gear?.armor) slot.gear.fillStyle(0x708060).fillRect(-4, -25, 8, 9).fillStyle(0xc4bc80).fillRect(-3, -23, 2, 2);
					if (slot.role === "workshop") { line(slot.tool, [{ x: 1, y: 6 }, { x: 3, y: 16 }], 0xc6cbb6, 2); slot.tool.lineStyle(1.3, 0xd4d5ba).strokeCircle(3, 17, 2.5); }
					if (slot.role === "ammo") slot.tool.fillStyle(0xe7c577).fillRect(1, 8, 3, 8);
					if (slot.role === "recycler") { line(slot.tool, [{ x: 1, y: 8 }, { x: 2, y: 17 }], 0xd5bb92, 2); slot.tool.fillStyle(0x9dac9b).fillRect(-2, 16, 8, 3); }
					if (slot.role === "medbay") slot.tool.fillStyle(0xd8ebe0).fillRect(0, 9, 5, 7).fillStyle(0x98cabc).fillRect(1, 7, 3, 2);
					if (slot.role === "radio") slot.tool.fillStyle(0xbdc9a6).fillRect(-1, 8, 6, 7).fillStyle(0x659789).fillRect(0, 9, 4, 3);
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
			if (this.shaftUser && (!this.scavs.get(this.shaftUser)?.actor.visible || !this.scavs.get(this.shaftUser)?.route.length)) this.shaftUser = null;
			this.ambient.clear();
			if (!reducedMotion) {
				for (let n = 0; n < 5; n++) {
					const cycle = (time / 11000 + n / 5) % 1;
					this.ambient.fillStyle(0xb1c2b8, .07 * (1 - cycle)).fillEllipse(651 - cycle * 24, 26 - cycle * 21, 3 + cycle * 17, 3 + cycle * 9);
				}
				for (let n = 0; n < 7; n++) {
					const cycle = (time / 17000 + n / 7) % 1;
					this.ambient.fillStyle(0xdac99c, .1 * Math.sin(cycle * Math.PI)).fillRect(227 + n * 74 + cycle * 11, 126 - cycle * 35, 1, 1);
				}
			}
			const focusedRoom = this.viewState?.shelter?.rooms.find((room) => room.id === this.viewState?.selectedRoomId);
			if (focusedRoom) {
				const y = cellPosition(focusedRoom.column, focusedRoom.row).y + 83;
				line(this.ambient, [{ x: 38, y }, { x: 802, y }], ROOM_STYLE[focusedRoom.type]?.light ?? C.gold, 1.3, .12);
				this.ambient.fillStyle(C.light, .48).fillRect(414, y - 1, 12, 2);
			}
			for (const [id, slot] of this.scavs) {
				const phase = time / 340 + slot.phase;
				const animated = !reducedMotion && slot.actor.visible;
				if (slot.actor.visible && this.drag?.scavId !== id) {
					this.patrolActor(slot, id, time);
					let speed = slot.status === "wounded" ? 27 : 58;
					const next = slot.route[0], vertical = Boolean(next && Math.abs(slot.actor.x - SHELTER_SHAFT_X) < 1 && Math.abs(next.y - slot.actor.y) > 1);
					if (vertical) {
						if (!this.shaftUser) this.shaftUser = id;
						if (this.shaftUser !== id) speed = 0;
						else if (Math.abs(this.liftFeet - slot.actor.y) > .5) {
							this.liftFeet += Math.sign(slot.actor.y - this.liftFeet) * Math.min(Math.abs(slot.actor.y - this.liftFeet), 78 * step); speed = 0;
						} else speed = 45;
					}
					const hadRoute = slot.route.length > 0;
					const motion = advanceShelterRoute({ x: slot.actor.x, y: slot.actor.y }, slot.route, speed * step);
					slot.route = motion.route;
					if (hadRoute) slot.actor.setPosition(motion.point.x, motion.point.y);
					slot.walking = hadRoute && speed > 0; slot.climbing = vertical && speed > 0;
					if (slot.walking && !vertical) slot.facing = motion.facing;
					if (vertical && this.shaftUser === id && speed > 0) this.liftFeet = slot.actor.y;
					if (vertical && this.shaftUser === id && (!slot.route.length || Math.abs(slot.route[0]!.y - slot.actor.y) < 1)) this.shaftUser = null;
					if (hadRoute && motion.arrived) { slot.dwellUntil = time + 6500 + (slot.phase % 4) * 1700; slot.walking = false; slot.climbing = false; }
				} else { slot.walking = false; slot.climbing = false; }
				const room = this.viewState?.shelter?.rooms.find((candidate) => candidate.id === slot.assignment);
				const production = room ? this.viewState?.roomProduction?.[room.id] : undefined;
				slot.working = Boolean(slot.status !== "raiding" && slot.health >= 25 && !slot.route.length && this.drag?.scavId !== id && room?.status === "ready" && room.queue.length && production?.rate && !production.reason);
				const walk = animated && slot.walking, work = animated && slot.working;
				slot.body.setY(work ? Math.sin(phase) * .8 : walk ? Math.abs(Math.sin(phase)) * -.9 : animated ? Math.sin(time / 1600 + slot.phase) * .3 : 0);
				slot.legA.setY(-5 + (walk ? Math.sin(phase) * 2 : 0));
				slot.legB.setY(-5 - (walk ? Math.sin(phase) * 2 : 0));
				let angle = walk ? slot.climbing ? -115 + Math.sin(phase) * 20 : Math.sin(phase) * 19 : 0;
				if (work) angle = slot.role === "radio" ? -125 + Math.sin(time / 900 + slot.phase) * 4 : slot.role === "medbay" ? -38 + Math.sin(time / 700 + slot.phase) * 10 : slot.role === "ammo" ? -53 + Math.sin(time / 350 + slot.phase) * 16 : slot.role === "recycler" ? -35 + Math.sin(time / 280 + slot.phase) * 40 : -45 + Math.sin(time / 320 + slot.phase) * 27;
				slot.hand.setAngle(angle); slot.tool.setAngle(angle).setVisible(slot.working);
				slot.body.setScale(slot.facing, 1);
				if (slot.actor.visible) {
					this.ambient.fillStyle(slot.working ? 0xc4d3a4 : 0x9bbebb, slot.working ? .2 : .12).fillEllipse(slot.actor.x, slot.actor.y + 1, 19, 3);
					if (slot.label.visible) {
						const halfWidth = slot.label.width / 2, scale = slot.actor.scaleX;
						slot.label.setX(Phaser.Math.Clamp(0, (10 - slot.actor.x) / scale + halfWidth, (WIDTH - 10 - slot.actor.x) / scale - halfWidth));
					}
					if ((slot.hovered || this.viewState?.selectedScavId === id) && slot.route.length) {
						line(this.ambient, [{ x: slot.actor.x, y: slot.actor.y }, ...slot.route], 0xe8c99d, 2, .26);
						this.ambient.lineStyle(1.2, 0xe8c99d, .55).strokeEllipse(slot.anchor.x, slot.anchor.y, 17, 6);
					}
				}
			}
			this.elevator.setY(this.liftFeet - 49);
			for (const cell of this.cells.values()) {
				const g = cell.animation;
				g.clear();
				if (!cell.room) continue;
				const work = cell.working && !reducedMotion;
				const elapsed = time - cell.completedAt;
				cell.feedback.setVisible(elapsed >= 0 && elapsed < 1800).setAlpha(reducedMotion ? 1 : Phaser.Math.Clamp(1 - elapsed / 1800, 0, 1)).setY(43 - (reducedMotion ? 0 : Math.max(0, elapsed) / 120));
				if (cell.room.status !== "ready") {
					g.fillStyle(C.gold, .9).fillCircle(115, 62, 3);
					line(g, [{ x: 115, y: 65 }, { x: 115, y: 79 }], 0x938063, 7);
					line(g, [{ x: 117, y: 68 }, { x: 127, y: 62 + (reducedMotion ? 0 : Math.sin(time / 180) * 4) }], 0xccb287, 2);
					if (!reducedMotion) for (let n = 0; n < 3; n++) {
						const cycle = (time / 520 + n * .3) % 1;
						line(g, [{ x: 128, y: 62 }, { x: 128 + cycle * (7 + n * 3), y: 62 + cycle * 13 }], 0xffd07c, 1, 1 - cycle);
					}
					continue;
				}
				if (cell.room.type === "radio") {
					const angle = work ? time / 700 : -.5;
					line(g, [{ x: 42, y: 57 }, { x: 42 + Math.cos(angle) * 7, y: 57 + Math.sin(angle) * 7 }], 0xa8cd93, 1.2, work ? .8 : .3);
					if (work) g.fillStyle(0xc5e2a4, .8).fillCircle(151, 39 + Math.floor(time / 400) % 5 * 8, 1.2);
				} else if (cell.room.type === "workshop" && work) {
					for (let n = 0; n < 3; n++) { const phase = (time / 300 + n * .32) % 1; line(g, [{ x: 80, y: 63 }, { x: 80 + phase * (9 + n * 4), y: 63 + phase * 13 }], 0xffd080, 1, 1 - phase); }
				} else if (cell.room.type === "ammo" && work) {
					g.fillStyle(0xc0b37c).fillRect(42, 46 + (Math.sin(time / 330) + 1) * 6, 9, 16);
					for (let n = 0; n < 5; n++) g.fillStyle(0xd9bb63).fillRect(84 + (time / 60 + n * 12) % 59, 65, 3, 8);
				} else if (cell.room.type === "recycler" && work) {
					for (let n = 0; n < 4; n++) g.fillStyle(0xa3a783).fillRect(88 + (time / 75 + n * 15) % 64, 70, 5, 3);
				} else if (cell.room.type === "medbay" && work) {
					g.fillStyle(0xc0d9a6, .65).fillRect(17 + time / 90 % 34, 42, 1, 11);
				}
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
			const selection = snapshot();
			if (time - this.lastSync > 1000 || `${selection.selectedScavId ?? ""}:${selection.selectedMapId ?? ""}:${selection.selectedRoomId ?? ""}:${selection.selectedSite?.column ?? ""}:${selection.selectedSite?.row ?? ""}` !== this.lastSelection) {
				this.lastSync = time;
				this.syncSnapshot();
			}
			if (requestedView === "base" && !document.hidden) {
				this.animateShelter(time, delta);
				this.baseLayer.sort("depth");
			} else {
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
		width: WIDTH,
		height: HEIGHT,
		backgroundColor: "#10120f",
		antialias: true,
		pixelArt: false,
		roundPixels: true,
		scale: {
			mode: Phaser.Scale.FIT,
			autoCenter: Phaser.Scale.CENTER_BOTH,
			width: WIDTH,
			height: HEIGHT,
		},
		fps: { target: 30 },
		audio: { noAudio: true },
		scene: [scene],
	});
	return {
		game, setView: (view) => scene.show(view),
		beginScavDrag: (id) => scene.beginScavDrag(id),
		moveScavDrag: (clientX, clientY) => scene.moveScavDrag(clientX, clientY),
		endScavDrag: () => scene.endScavDrag(),
		cancelScavDrag: () => scene.cancelScavDrag(),
	};
}
