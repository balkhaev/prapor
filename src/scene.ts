import Phaser from "phaser";
import { getRaidPhase, type Raid, type RaidReport, type RoomInstance, type WeaponInstance } from "./game/engine";
import { type BaseRoom } from "./game/data";
import { advanceShelterRoute, clientToShelterPoint, getShelterCell, planShelterRoute, SHELTER_SHAFT_X, SHELTER_FLOOR_Y } from "./shelter-motion";
import { clampShelterCamera, focusShelterRect, panShelterCamera, projectShelterRect, resizeShelterCamera, shelterViewportForSize, viewportToShelter, zoomShelterCamera, type ShelterCamera, type ShelterRect, type ShelterViewport, type ClientRect } from "./shelter-camera";
import { advanceShelterLift, createShelterLift, restoreShelterLift, type LiftRequest } from "./shelter-lift";
import { advanceScavAnimation, createScavAnimation, type ScavAnimationState } from "./shelter-animation";
import { type ProductionPresentation } from "./shelter-production";
import { createShelterStation, type ShelterStation } from "./shelter-stations";
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
	liftSide: -1 | 1;
	inLift: boolean;
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
	getPresentationState: () => unknown;
	restorePresentationState: (value: unknown) => void;
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
	backdrop: Phaser.GameObjects.Image | null;
	frame: Phaser.GameObjects.Graphics;
	progress: Phaser.GameObjects.Graphics;
	animation: Phaser.GameObjects.Graphics;
	station: ShelterStation;
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
		private liftDisplay!: Phaser.GameObjects.Text;
		private liftDoorAmount = 0;
		private liftDisplaySignature = "";
		private pendingPresentation: unknown = null;
		private presentationReady = false;
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
			this.presentationReady = true;
			if (this.pendingPresentation) { const saved = this.pendingPresentation; this.pendingPresentation = null; this.restorePresentationState(saved); }
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
				this.presentationReady = false;
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

		getPresentationState(): unknown {
			if (!this.presentationReady) return this.pendingPresentation;
			const actual = snapshot();
			// Actions save immediately, before the next visual sync. Never export a
			// stale base presence after dispatch, removal, reassignment or import.
			const actors = [...this.scavs].filter(([id, slot]) => {
				if (actual.shelter !== this.viewState?.shelter || !slot.actor.visible) return false;
				const scav = actual.scavs?.find((candidate) => candidate.id === id);
				const assignment = actual.shelter?.rooms.find((room) => room.id === scav?.assignment && room.workerIds.includes(id))?.id ?? null;
				return Boolean(scav && scav.status !== "raiding" && assignment === slot.assignment);
			});
			const eligible = new Set(actors.map(([id]) => id));
			const lift = structuredClone(this.liftModel);
			if (lift.passengerId && (!eligible.has(lift.passengerId) || !this.scavs.get(lift.passengerId)?.inLift)
				|| lift.trip && !eligible.has(lift.trip.id)) {
				lift.passengerId = null; lift.trip = null; lift.phase = "pickup"; lift.cancelledTrip = false; lift.doorOpen = false;
				lift.targetY = SHELTER_FLOOR_Y.reduce<number>((y, floor) => Math.abs(floor - lift.y) < Math.abs(y - lift.y) ? floor : y, 228);
			}
			lift.queue = lift.queue.filter((ticket) => eligible.has(ticket.id));
			lift.completed = lift.completed.filter((ticket) => eligible.has(ticket.id));
			return { version: 1, camera: { ...this.viewCamera }, viewport: { ...this.viewport }, panMode: this.panMode,
				raidId: requestedRaidId, raidCamera: this.raidStreet?.getCameraState(), lift,
				actors: actors.map(([id, slot]) => ({ id,
					x: slot.actor.x, y: slot.actor.y, assignment: slot.assignment, role: slot.role, goal: slot.goal,
					anchor: { ...slot.anchor }, route: slot.route.map((point) => ({ ...point })), liftSide: slot.liftSide,
					visit: slot.visit, facing: slot.facing, dwellMs: Math.max(0, slot.dwellUntil - this.time.now), animation: { ...slot.animation } })) };
		}

		restorePresentationState(value: unknown): void {
			if (!value || typeof value !== "object") return;
			if (!this.presentationReady) { this.pendingPresentation = value; return; }
			const data = value as Record<string, unknown>;
			if (data.version !== 1) return;
			this.cancelScavDrag(); this.cancelCameraGesture();
			// Imports replace model identity. Synchronize that reset before applying
			// positions so the following regular sync cannot wipe restored motion.
			if (snapshot().shelter !== this.viewState?.shelter) this.syncSnapshot();
			const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" ? v as Record<string, unknown> : null;
			const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
			const camera = object(data.camera), savedViewport = object(data.viewport);
			if (camera && finite(camera.zoom) && finite(camera.x) && finite(camera.y) && camera.zoom >= 1 && camera.zoom <= 4) {
				const priorViewport = savedViewport && finite(savedViewport.width) && finite(savedViewport.height) && savedViewport.width > 0 && savedViewport.height > 0 ? { width: savedViewport.width, height: savedViewport.height } : this.viewport;
				this.viewCamera = resizeShelterCamera({ zoom: camera.zoom, x: camera.x, y: camera.y }, priorViewport, this.viewport);
			}
			if (typeof data.panMode === "boolean") this.panMode = data.panMode;
			const state = snapshot(), restored = new Set<string>(), lift = Array.isArray(data.actors) ? restoreShelterLift(data.lift) : null;
			const point = (v: unknown, inCabin = false): Point | null => {
				const p = object(v);
				if (!p || !finite(p.x) || !finite(p.y)) return null;
				const x = p.x, y = p.y;
				if (x < 32 || x > 808) return null;
				const floor = SHELTER_FLOOR_Y.find((floor) => Math.abs(floor - y) < .01);
				if (floor !== undefined) return { x, y: floor };
				return inCabin && Math.abs(x - SHELTER_SHAFT_X) < .01 && y >= 129 && y <= 450 ? { x, y } : null;
			};
			if (lift && Array.isArray(data.actors)) for (const slot of this.scavs.values()) slot.inLift = false;
			if (lift && Array.isArray(data.actors)) for (const raw of data.actors.slice(0, 32)) {
				const saved = object(raw); if (!saved || typeof saved.id !== "string") continue;
				const slot = this.scavs.get(saved.id), scav = state.scavs?.find((candidate) => candidate.id === saved.id);
				if (!slot || !scav || scav.status === "raiding" || saved.assignment !== slot.assignment || saved.role !== slot.role) continue;
				const at = point(saved, lift?.passengerId === saved.id), anchor = point(saved.anchor);
				if (!at || !anchor || typeof saved.goal !== "string" || saved.goal.length > 180) continue;
				const allowedGoal = slot.assignment ? saved.goal.startsWith(`work:${slot.assignment}:`) : slot.role === "rest" ? saved.goal === slot.goal
					: saved.goal.startsWith("idle-home:") || saved.goal.startsWith("visit:") && state.shelter?.rooms.some((room) => saved.goal === `visit:${saved.visit}:${room.id}`);
				if (!allowedGoal || !Array.isArray(saved.route) || saved.route.length > 8) continue;
				const unchangedGoal = !slot.assignment || saved.goal === slot.goal;
				const route = saved.route.map((p) => point(p));
				if (route.some((p) => !p)) continue;
				const legs = [at, ...route as Point[]];
				if (legs.some((to, index) => index > 0 && Math.abs(to.y - legs[index - 1]!.y) > .01 && Math.abs(to.x - SHELTER_SHAFT_X) > .01)
					|| Math.hypot((route.length ? route[route.length - 1]!.x : at.x) - anchor.x, (route.length ? route[route.length - 1]!.y : at.y) - anchor.y) > 1) continue;
				// A changed real production phase keeps its current destination. The
				// saved feet position is useful, but old work never overrides the game.
				slot.actor.setPosition(at.x, at.y); slot.liftSide = saved.liftSide === -1 ? -1 : 1;
				if (unchangedGoal) { slot.anchor = anchor; slot.goal = saved.goal; slot.route = route as Point[]; }
				else slot.route = this.actorRoute(slot, slot.anchor);
				if (finite(saved.visit)) slot.visit = Math.max(0, Math.min(1_000_000, Math.floor(saved.visit)));
				if (finite(saved.dwellMs)) slot.dwellUntil = this.time.now + Math.max(0, Math.min(60_000, saved.dwellMs));
				slot.facing = saved.facing === -1 ? -1 : 1;
				const animation = object(saved.animation);
				if (animation) { const next = { ...slot.animation }; for (const key of Object.keys(next) as (keyof ScavAnimationState)[]) if (key !== "observedJob" && finite(animation[key])) (next as unknown as Record<string, unknown>)[key] = animation[key]; next.observedJob = typeof animation.observedJob === "string" ? animation.observedJob : null; slot.animation = next; }
				restored.add(saved.id);
			}
			if (lift) {
				if (lift.passengerId && !restored.has(lift.passengerId)) {
					// A removed/reassigned passenger is never pulled out of a real room
					// into an old cabin. Park the empty cabin physically at a nearby floor.
					lift.passengerId = null; lift.trip = null; lift.phase = "pickup"; lift.cancelledTrip = false;
					lift.targetY = SHELTER_FLOOR_Y.reduce<number>((y, floor) => Math.abs(floor - lift.y) < Math.abs(y - lift.y) ? floor : y, 228);
					lift.doorOpen = false;
				}
				lift.queue = lift.queue.filter((ticket) => restored.has(ticket.id)); this.liftModel = lift;
				this.liftDoorAmount = lift.doorOpen ? 1 : 0;
				if (lift.passengerId) { const rider = this.scavs.get(lift.passengerId); if (rider) { rider.inLift = true; rider.actor.setPosition(SHELTER_SHAFT_X, lift.y); } }
			}
			if (typeof data.raidId === "string" && data.raidId === requestedRaidId && (state.raids.some((raid) => raid.id === data.raidId) || state.history?.some((report) => report.raidId === data.raidId))) { this.selectRaid(data.raidId); this.raidStreet.restoreCamera(data.raidCamera); }
			this.paintLift(0); this.applyCamera();
		}
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
			this.viewCamera = focusShelterRect(this.viewCamera, { ...p, width: ROOM_WIDTH, height: ROOM_HEIGHT }, 2.5, this.viewport);
			if (this.drag) {
				this.drag.point = null; this.drag.roomId = null; this.drag.cellKey = null;
				this.dragGhost.clear();
				for (const cell of this.cells.values()) this.paintCellFrame(cell);
			}
			this.applyCamera(); return true;
		}

		projectShelterRect(rect: ShelterRect): (ClientRect & { visible: boolean }) | null {
			return this.baseLayer && requestedView === "base" ? projectShelterRect(rect, this.viewCamera, this.game.canvas.getBoundingClientRect(), this.viewport) : null;
		}

		private clientWorld(clientX: number, clientY: number): Point | null {
			const viewport = clientToShelterPoint(clientX, clientY, this.game.canvas.getBoundingClientRect(), this.viewport.width, this.viewport.height);
			return viewport ? viewportToShelter(viewport, this.viewCamera, this.viewport) : null;
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
				const hit = [...this.scavs].filter(([, slot]) => slot.actor.visible && Math.abs(slot.actor.x - point.x) <= 16 * slot.actor.scaleX && point.y >= slot.actor.y - 44 * slot.actor.scaleY && point.y <= slot.actor.y + 2).sort((a, b) => Math.hypot(a[1].actor.x - point.x, a[1].actor.y - 21 - point.y) - Math.hypot(b[1].actor.x - point.x, b[1].actor.y - 21 - point.y))[0];
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
			const g = this.add.graphics();
			this.baseLayer.add(g);
			const rng = random(90312);
			for (let y = 0; y < 128; y += 3) g.fillStyle(blend(0x182d3f, 0x677268, y / 155)).fillRect(0, y, WIDTH, 3);
			g.fillStyle(0xc0c5a8, .12).fillEllipse(480, 37, 44, 35);
			g.fillStyle(0xd4d6b7, .38).fillCircle(480, 37, 5);
			// Distant ruins, nearer tree lines and the lit entrance occupy separate depth planes.
			for (const district of [{ x: 422, w: 78, h: 31 }, { x: 506, w: 90, h: 57 }, { x: 611, w: 58, h: 42 }, { x: 681, w: 112, h: 49 }]) {
				g.fillStyle(0x294340, .66).fillRect(district.x, 83 - district.h, district.w, district.h);
				g.fillStyle(0x9aae94, .16).fillRect(district.x, 83 - district.h, district.w, 2);
				for (let x = district.x + 9; x < district.x + district.w - 8; x += 16) for (let y = 88 - district.h; y < 78; y += 15) {
					g.fillStyle((x + y) % 3 ? 0x708d7b : 0xc6a76c, (x + y) % 3 ? .14 : .28).fillRect(x, y, 5, 7);
				}
			}
			for (const plant of [{ x: 12, h: 41 }, { x: 25, h: 32 }, { x: 307, h: 21 }, { x: 461, h: 25 }, { x: 818, h: 45 }]) {
				line(g, [{ x: plant.x, y: 90 }, { x: plant.x, y: 91 - plant.h }], 0x182e2b, 2);
				for (let n = 0; n < 4; n++) {
					const y = 84 - n * plant.h / 6, w = (4 - n) * 5;
					polygon(g, [{ x: plant.x - w, y }, { x: plant.x, y: y - 15 }, { x: plant.x + w, y }], 0x203a30, .9);
					line(g, [{ x: plant.x - w, y }, { x: plant.x - 1, y: y - 12 }], 0x8aab85, .6, .17);
				}
			}
			g.fillStyle(0x8eaaa1, .05).fillRect(0, 71, WIDTH, 14);
			polygon(g, [{ x: 0, y: 91 }, { x: 95, y: 78 }, { x: 196, y: 93 }, { x: 305, y: 87 }, { x: 493, y: 91 }, { x: 687, y: 82 }, { x: 840, y: 94 }, { x: 840, y: 134 }, { x: 0, y: 134 }], 0x24382e);
			line(g, [{ x: 648, y: 85 }, { x: 648, y: 30 }, { x: 653, y: 27 }, { x: 657, y: 29 }], 0x587664, 4);
			g.fillStyle(0x162b27).fillEllipse(653, 28, 13, 4);
			line(g, [{ x: 732, y: 86 }, { x: 737, y: 18 }, { x: 747, y: 18 }, { x: 754, y: 86 }], 0x668270, 3);
			g.fillStyle(0x41665d).fillRect(730, 14, 31, 20);
			g.fillStyle(0x90aa89, .28).fillEllipse(745, 14, 32, 7);
			line(g, [{ x: 731, y: 35 }, { x: 754, y: 67 }, { x: 736, y: 66 }, { x: 751, y: 38 }], 0x789880, 1.2, .6);
			// Local power stays visible as physical poles and sagging cable, without a new simulation.
			for (const pole of [282, 787]) {
				line(g, [{ x: pole, y: 86 }, { x: pole, y: 25 }], 0x786c4e, 3);
				line(g, [{ x: pole - 11, y: 32 }, { x: pole + 12, y: 32 }], 0xa4a98a, 2);
				g.fillStyle(0xc0c8aa).fillRect(pole - 8, 27, 3, 7).fillRect(pole + 5, 27, 3, 7);
			}
			const cable: Point[] = [];
			for (let n = 0; n <= 30; n++) cable.push({ x: 282 + n * 505 / 30, y: 28 + Math.sin(n / 30 * Math.PI) * 11 });
			line(g, cable, 0x152827, 1.1, .82);
			line(g, [{ x: 281, y: 35 }, { x: 231, y: 49 }, { x: 166, y: 64 }], 0x172b26, 1.2);
			for (let n = 0; n < 90; n++) {
				const x = rng() * 840, y = 84 + rng() * 47;
				g.fillStyle(n % 2 ? 0x87a278 : 0x10231d, .25).fillRect(x, y, 2 + rng() * 6, 1);
			}
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
			const casing = this.add.graphics().setDepth(15);
			for (const x of [29, 212, 620, 801]) {
				casing.fillStyle(0x15221f).fillRect(x + 2, 146, 10, 336);
				casing.fillStyle(0x657263).fillRect(x, 146, 7, 334);
				casing.fillStyle(0xabb19a, .46).fillRect(x, 146, 1.5, 334);
				casing.fillStyle(0x273a30).fillRect(x + 5, 146, 2, 334);
				for (let y = 170; y < 470; y += 37) {
					casing.fillStyle(0x26362b).fillRect(x + 1, y, 5, 8);
					casing.fillStyle(0xb8bba1, .45).fillCircle(x + 3, y + 3, 1);
				}
			}
			for (const y of [137, 248, 359, 470]) {
				polygon(casing, [{ x: 29, y }, { x: 803, y }, { x: 811, y: y + 5 }, { x: 34, y: y + 5 }], 0x88927f);
				casing.fillStyle(0x536352).fillRect(34, y + 5, 777, 6);
				casing.fillStyle(0x13241e).fillRect(34, y + 10, 777, 2);
				line(casing, [{ x: 35, y: y + 5 }, { x: 808, y: y + 5 }], 0xc5c5a8, 1, .45);
				for (let x = 42; x < 800; x += 35) line(casing, [{ x, y: y + 8 }, { x: x + 12, y: y + 8 }], 0x9aa18c, 1, .18);
				casing.fillStyle(0x0b1c18).fillRect(393, y, 54, 12);
				line(casing, [{ x: 393, y: y + 5 }, { x: 401, y: y + 5 }], 0xd2b879, 2, .6);
				line(casing, [{ x: 439, y: y + 5 }, { x: 447, y: y + 5 }], 0xd2b879, 2, .6);
			}
			line(casing, [{ x: 24, y: 154 }, { x: 24, y: 488 }, { x: 786, y: 488 }], 0x323f31, 5);
			line(casing, [{ x: 24, y: 154 }, { x: 24, y: 488 }, { x: 786, y: 488 }], 0x8b947b, 1.7, .52);
			for (const x of [56, 185, 337, 523, 687, 782]) casing.fillStyle(0x526649).fillRect(x, 484, 3, 9);
			this.baseLayer.add(casing);
			const lift = this.add.graphics();
			lift.fillStyle(0x384a37).fillRect(0, 0, 32, 59);
			lift.fillStyle(0x101e13).fillRect(4, 6, 24, 43);
			lift.lineStyle(2, 0x78846b).strokeRect(0, 0, 32, 59);
			for (let x = 7; x < 30; x += 6) line(lift, [{ x, y: 7 }, { x, y: 49 }], 0x606f54, 1);
			line(lift, [{ x: 4, y: 30 }, { x: 28, y: 30 }], 0x879271, 2);
			lift.fillStyle(C.gold).fillRect(4, 54, 24, 3);
			this.elevator = this.add.container(404, 179, [lift]).setDepth(20);
			this.baseLayer.add(this.elevator);
			this.liftDoors = this.add.graphics().setDepth(90);
			this.liftDisplay = this.text(420, 151, "ЛИФТ", 8, "#dde2c7").setOrigin(.5).setBackgroundColor("#10242a").setPadding(3, 2).setDepth(91);
			this.baseLayer.add([this.liftDoors, this.liftDisplay]);
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
			const backdrop = this.textures.exists("shelter-room-atlas") ? this.add.image(2, 24, "shelter-room-atlas", 7).setOrigin(0).setDisplaySize(168, 60) : null;
			const art = this.add.graphics();
			const frame = this.add.graphics();
			const progress = this.add.graphics();
			const animation = this.add.graphics();
			const label = this.text(10, 2, "", 18, "#fff0d6").setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setShadow(0, 1, "#081416", 0, true, true);
			const status = this.text(22, 82, "", 14, "#c1d8bd").setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setShadow(0, 1, "#051010", 0, true, true);
			const productLabel = this.text(86, 25, "", 9, "#f4e4bb").setOrigin(.5, 0).setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setBackgroundColor("#10231e").setPadding(4, 2).setVisible(false);
			const feedback = this.text(86, 43, "", 16, "#e6ffce").setOrigin(.5).setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setBackgroundColor("#163023").setPadding(6, 3).setVisible(false);
			const lamp = this.add.image(85, 43, "prapor-light").setScale(.66, .38).setAlpha(.12).setBlendMode(Phaser.BlendModes.ADD);
			const zone = this.add.zone(86, 50, ROOM_WIDTH, ROOM_HEIGHT).setInteractive({ useHandCursor: true });
			const root = this.add.container(p.x, p.y, [...(backdrop ? [backdrop] : []), art, lamp, animation, frame, label, status, productLabel, progress, feedback, zone]);
			const station = createShelterStation(this, root);
			root.moveTo(station.layer, root.list.indexOf(frame));
			this.baseLayer.add(root);
			const cell: ShelterCell = { root, art, backdrop, frame, progress, animation, station, production: null, productLabel, label, status, lamp, zone, signature: "", column, row, hovered: false, room: null, working: false, operational: "empty", feedback, lastCycles: null, completedAt: -10000 };
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
			cell.label.setAlpha(cell.room || selected || cell.hovered ? 1 : .68);
			cell.status.setAlpha(cell.room || selected || cell.hovered ? 1 : .65);
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
			if (cell.room || selected || cell.hovered) cell.frame.lineStyle(selected ? 2.5 : 1, color, selected || cell.hovered ? 1 : .64).strokeRect(1, 1, ROOM_WIDTH - 2, ROOM_HEIGHT - 2);
			if (selected || cell.hovered) {
				for (const x of [1, ROOM_WIDTH - 9]) for (const y of [1, ROOM_HEIGHT - 9]) cell.frame.fillStyle(C.gold, .85).fillRect(x, y, 8, 2).fillRect(x, y, 2, 8);
			}
			if (cell.operational === "working") cell.frame.fillStyle(0xc1e4a6, .78).fillRect(2, 78, 4, 14);
			else if (cell.operational === "blocked") cell.frame.fillStyle(0xf0b37e, .9).fillRect(2, 80, 4, 12);
		}

		private paintRoom(cell: ShelterCell): void {
			const g = cell.art, room = cell.room;
			g.clear();
			if (cell.backdrop) {
				// The atlas is a cached static interior. Operational lights, machines,
				// workers and room chrome remain separate live layers above it.
				const frames: Record<string, number> = { workshop: 0, medbay: 1, radio: 2, storage: 3, ammo: 4, recycler: 5, dormitory: 6 };
				const style = ROOM_STYLE[room?.type ?? "workshop"]!;
				cell.backdrop.setFrame(room ? frames[room.type] ?? 0 : 7).setAlpha(room ? 1 : .58).setTint(room ? 0xffffff : cell.row === 1 ? 0xadb79c : 0x92a5a5).setFlipX(!room && cell.column % 2 === 1);
				cell.backdrop.setPosition(room ? 2 : 0, room ? 24 : 0).setDisplaySize(room ? 168 : ROOM_WIDTH, room ? 60 : ROOM_HEIGHT);
				if (!room) {
					g.fillStyle(0x0b1c1b, .7).fillRoundedRect(6, 3, 110, 21, 3);
					g.fillStyle(0x0c201d, .64).fillCircle(86, 54, 16);
					g.lineStyle(1.3, 0xb6c9a5, .45).strokeCircle(86, 54, 13);
					line(g, [{ x: 79, y: 54 }, { x: 93, y: 54 }], 0xd3dfbd, 2, .75);
					line(g, [{ x: 86, y: 47 }, { x: 86, y: 61 }], 0xd3dfbd, 2, .75);
					g.fillStyle(0x0c201d, .68).fillRoundedRect(17, 82, 132, 16, 3);
					cell.label.setText("Свободно").setFontSize(16).setColor("#afc0a4");
					cell.status.setText("ПОСТРОИТЬ").setFontSize(12).setColor("#a3b398"); cell.lamp.setVisible(false); return;
				}
				g.fillStyle(blend(style.wall, 0x07151b, .52)).fillRect(0, 0, ROOM_WIDTH, 24);
				g.fillStyle(0x091416).fillRect(0, 84, ROOM_WIDTH, 16);
				g.fillStyle(style.color, .8).fillRect(2, 2, 3, 19).fillRect(1, 23, 170, 1);
				line(g, [{ x: 1, y: 25 }, { x: 1, y: 84 }, { x: 171, y: 84 }, { x: 171, y: 25 }], 0x101d20, 3);
				line(g, [{ x: 2, y: 83 }, { x: 170, y: 83 }], style.color, 1, .5);
				for (const x of [4, 166]) g.fillStyle(0xbabbaa, .7).fillCircle(x, 28, 1).fillCircle(x, 79, 1);
				for (let n = 0; n < Math.min(5, room.level); n++) g.fillStyle(0xe3d4a9, .85).fillRect(151 - n * 5, 18, 3, 2);
				cell.label.setText(style.label).setFontSize(18).setColor("#fff1dc"); cell.status.setFontSize(14); cell.lamp.setVisible(true).setTint(style.light).setAlpha(.08);
				if (room.status !== "ready") {
					g.fillStyle(0x091115, .52).fillRect(2, 24, 168, 60);
					for (const x of [21, 87, 150]) { line(g, [{ x, y: 28 }, { x, y: 81 }], 0x111d20, 5); line(g, [{ x, y: 28 }, { x, y: 80 }], 0xd6b776, 2.3); }
					for (const y of [43, 65]) line(g, [{ x: 16, y }, { x: 154, y }], 0xb59c6b, 2.5);
					line(g, [{ x: 21, y: 78 }, { x: 87, y: 31 }, { x: 150, y: 78 }], 0xd0ad69, 1.5, .9);
					for (let x = 12; x < 166; x += 12) line(g, [{ x, y: 83 }, { x: x + 5, y: 79 }], x % 24 ? 0x141e14 : 0xe2b667, 3);
					cell.label.setText(`${room.status === "building" ? "СТРОИТСЯ" : "УЛУЧШЕНИЕ"} · ${room.construction?.targetLevel ?? room.level + 1}`).setColor("#ffce8a");
				}
				return;
			}
			if (!room) {
				const rng = random(cell.column * 829 + cell.row * 127 + 416);
				const stone = cell.row === 1 ? [0x3e4138, 0x4e4e3d, 0x343c33] : [0x343e40, 0x414a43, 0x28383a];
				g.fillStyle(stone[2]!).fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
				for (let n = 0; n < 11; n++) {
					const x = rng() * 190 - 14, y = rng() * 100, w = 22 + rng() * 46, h = 9 + rng() * 17;
					polygon(g, [{ x, y }, { x: x + w * .64, y: y - h * .5 }, { x: x + w, y: y + 2 }, { x: x + w * .72, y: y + h }, { x: x + 3, y: y + h * .83 }], stone[n % 3]!);
					line(g, [{ x: x + 2, y: y + 2 }, { x: x + w * .64, y: y - h * .4 }, { x: x + w - 2, y: y + 3 }], 0xa7ae8c, 1, .15);
				}
				const seam: Point[] = [];
				for (let n = 0; n < 8; n++) seam.push({ x: n * 25, y: 55 + Math.sin(n * .8 + cell.column) * 13 });
				line(g, seam, 0x11231e, 3, .52);
				line(g, [{ x: 36 + cell.column * 9, y: 0 }, { x: 45 + cell.column * 7, y: 19 }, { x: 39 + cell.column * 8, y: 39 }], 0x826d43, 1.2, .37);
				g.fillStyle(0x0d211c, .42).fillRoundedRect(7, 3, 107, 20, 4);
				g.fillStyle(0x182b22, .34).fillEllipse(86, 55, 36, 33);
				g.lineStyle(1.2, 0xadc1a1, .36).strokeCircle(86, 55, 13);
				line(g, [{ x: 79, y: 55 }, { x: 93, y: 55 }], 0xd3dfbd, 2, .65);
				line(g, [{ x: 86, y: 48 }, { x: 86, y: 62 }], 0xd3dfbd, 2, .65);
				cell.label.setText("Свободно").setFontSize(16).setColor("#afc0a4");
				cell.status.setText("ПОСТРОИТЬ").setFontSize(12).setColor("#a3b398");
				cell.lamp.setVisible(false);
				return;
			}
			const style = ROOM_STYLE[room.type] ?? ROOM_STYLE.workshop!;
			g.fillStyle(0x101919).fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
			for (let y = 24; y < 82; y += 3) g.fillStyle(blend(style.wall, 0x101e25, (y - 24) / 170)).fillRect(6, y, 160, 3);
			polygon(g, [{ x: 1, y: 23 }, { x: 15, y: 34 }, { x: 15, y: 73 }, { x: 1, y: 84 }], blend(style.wall, 0x172522, .31));
			polygon(g, [{ x: 157, y: 34 }, { x: 171, y: 23 }, { x: 171, y: 84 }, { x: 157, y: 73 }], blend(style.wall, 0x081518, .48));
			polygon(g, [{ x: 1, y: 23 }, { x: 171, y: 23 }, { x: 157, y: 34 }, { x: 15, y: 34 }], blend(style.wall, 0xa2ae9c, .22));
			polygon(g, [{ x: 15, y: 73 }, { x: 157, y: 73 }, { x: 171, y: 86 }, { x: 1, y: 86 }], blend(style.wall, 0x9ba7a3, .32));
			line(g, [{ x: 15, y: 35 }, { x: 15, y: 73 }, { x: 156, y: 73 }, { x: 156, y: 35 }], 0x0a1b19, 2, .68);
			line(g, [{ x: 3, y: 25 }, { x: 15, y: 34 }, { x: 156, y: 34 }, { x: 169, y: 25 }], style.color, 1.2, .48);
			for (const x of [12, 39, 66, 93, 120, 147]) line(g, [{ x, y: 76 }, { x: (x - 86) * 1.16 + 86, y: 86 }], 0x111d1c, 1, .55);
			line(g, [{ x: 3, y: 80 }, { x: 168, y: 80 }], 0xc9c9b1, .8, .15);
			g.fillStyle(0x091416).fillRect(0, 84, ROOM_WIDTH, 16);
			g.fillStyle(blend(style.wall, 0x09151a, .42)).fillRect(1, 1, ROOM_WIDTH - 2, 22);
			g.fillStyle(style.color, .7).fillRect(1, 23, ROOM_WIDTH - 2, 1);
			g.fillStyle(style.color, .6).fillRect(2, 2, 3, 19);
			if (room.type === "medbay") {
				for (let x = 16; x < 155; x += 24) for (let y = 35; y < 72; y += 12) {
					g.fillStyle((x + y) % 5 ? 0x769b93 : 0xabc4b3, .15).fillRect(x, y, 22, 10);
					line(g, [{ x, y: y + 11 }, { x: x + 22, y: y + 11 }], 0xc5e0cd, .7, .18);
				}
			} else if (room.type === "radio") {
				for (const x of [16, 64, 111]) {
					g.fillStyle(0x0c2a2b, .34).fillRect(x, 36, 43, 34);
					line(g, [{ x, y: 36 }, { x: x + 42, y: 36 }], 0x6ea99f, 1, .24);
				}
			} else if (room.type === "dormitory") {
				g.fillStyle(0xc2a8bf, .12).fillRoundedRect(17, 36, 138, 36, 2);
				line(g, [{ x: 17, y: 64 }, { x: 154, y: 64 }], 0xcbbaad, 1, .16);
			} else {
				for (const x of [17, 52, 87, 122]) {
					g.fillStyle(0x0c211c, .2).fillRect(x, 35, 32, 38);
					line(g, [{ x, y: 35 }, { x: x + 31, y: 35 }, { x: x + 31, y: 72 }], style.color, .8, .22);
				}
			}
			line(g, [{ x: 10, y: 30 }, { x: 161, y: 30 }, { x: 161, y: 76 }], 0x12221f, 4);
			line(g, [{ x: 10, y: 29 }, { x: 161, y: 29 }, { x: 161, y: 73 }], blend(style.color, 0x4f6257, .48), 1.5);
			for (const x of [13, 49, 87, 124]) g.fillStyle(0xc1c7ad, .7).fillRect(x, 27, 2, 5);
			g.fillStyle(0x081315).fillRoundedRect(60, 23, 52, 8, 2);
			g.fillStyle(0xc6cab4, .55).fillRect(63, 25, 46, 2);
			g.fillStyle(style.light).fillRect(66, 27, 40, 2);
			polygon(g, [{ x: 66, y: 29 }, { x: 35, y: 79 }, { x: 144, y: 79 }, { x: 106, y: 29 }], style.light, .075);
			cell.label.setText(style.label).setFontSize(18).setColor("#fff1dc");
			cell.status.setFontSize(14);
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
				polygon(g, [{ x: x + 1, y: y + h }, { x: x + w + 4, y: y + h - 1 }, { x: x + w + 11, y: y + h + 5 }, { x: x + 7, y: y + h + 5 }], 0x031315, .5);
				polygon(g, [{ x, y }, { x: x + 5, y: y - 4 }, { x: x + w + 5, y: y - 4 }, { x: x + w, y }], blend(color, 0xe1ddbd, .3));
				polygon(g, [{ x: x + w, y }, { x: x + w + 5, y: y - 4 }, { x: x + w + 5, y: y + h - 4 }, { x: x + w, y: y + h }], blend(color, 0x112825, .4));
				for (let band = 0; band < 5; band++) g.fillStyle(blend(color, 0x0b1d20, band / 20)).fillRect(x, y + h * band / 5, w, h / 5 + .2);
				line(g, [{ x, y: y + h }, { x, y }, { x: x + w, y }], blend(color, 0xf1e2c4, .5), 1, .8);
				line(g, [{ x: x + w, y: y + 1 }, { x: x + w, y: y + h }], 0x061215, .8, .78);
				if (h > 15 && w > 16) {
					g.fillStyle(0xd4d8ba, .55).fillCircle(x + 3, y + 3, .9).fillCircle(x + w - 3, y + h - 3, .9);
					line(g, [{ x: x + 3, y: y + h - 3 }, { x: x + w - 3, y: y + h - 3 }], 0xb5bba1, .7, .18);
				}
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
					g.lineStyle(1.4, 0xbdc6ac).strokeCircle(79, 64, 7);
					g.fillStyle(0x8f9c86).fillCircle(79, 64, 2.7);
					line(g, [{ x: 70, y: 57 }, { x: 94, y: 57 }], 0xe8d2a7, 1.2, .7);
					panel(113, 60, 46, 20, 0x8b7250);
					rifle(g, 131, 60, .5);
					chest(120, 75, 24, 9);
					break;
				case "ammo":
					panel(23, 37, 49, 43, 0x929267);
					panel(30, 45, 33, 25, 0x253829);
					g.fillStyle(0xa49b6a).fillRect(42, 43, 9, 27).fillRect(33, 68, 27, 5);
					g.fillStyle(0xcfd3b0, .18).fillRect(31, 46, 9, 20);
					line(g, [{ x: 38, y: 47 }, { x: 38, y: 65 }], 0xf3e4b2, .8, .28);
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
					polygon(g, [{ x: 28, y: 48 }, { x: 33, y: 52 }, { x: 68, y: 52 }, { x: 72, y: 48 }], 0xc99f76, .7);
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
					g.fillStyle(0xf1ead3, .17).fillRect(104, 40, 9, 25);
					g.fillStyle(0xd4d6b5).fillRect(116, 44, 7, 18).fillRect(110, 50, 19, 6);
					line(g, [{ x: 104, y: 68 }, { x: 136, y: 68 }], 0x344d38, 2);
					g.fillStyle(0xd7d0af).fillRect(142, 70, 17, 4);
					line(g, [{ x: 154, y: 68 }, { x: 154, y: 63 }, { x: 147, y: 63 }], 0x97b49a, 2);
					break;
				case "radio":
					panel(12, 68, 96, 12, 0x497a78);
					panel(20, 44, 43, 26, 0x629d99);
					panel(24, 47, 35, 19, 0x0f383a);
					polygon(g, [{ x: 25, y: 48 }, { x: 39, y: 48 }, { x: 53, y: 65 }, { x: 47, y: 65 }], 0x77c5b2, .16);
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
			const slot: ScavActor = { actor, body, legA, legB, hand, sprite, poses, animation: createScavAnimation(index * .37), appearance, gear, tool, label, order, selection, hovered: false, gearSignature: "", anchor: { ...at }, route: [], goal: "", assignment: null, role: "idle", dwellUntil: this.time.now + 2000 + index * 800, visit: 0, facing: 1, climbing: false, status: "ready", health: 100, working: false, walking: false, walkSpan: 0, phase: index * 1.71, liftSide: at.x < SHELTER_SHAFT_X ? -1 : 1, inLift: false };
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
				cell.production = cell.station.setProduction(room, production ?? null);
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
					const reason = production?.reason?.toLocaleLowerCase("ru-RU") ?? "";
					const briefReason = reason.includes("склад") || reason.includes("мест") ? "СКЛАД ПОЛОН" : reason.includes("рабоч") ? "НУЖЕН РАБОЧИЙ" : reason.includes("нужно") ? "НУЖНЫ РЕСУРСЫ" : production?.reason ?? "";
					const status = construction ? `СТРОЙКА ${Math.floor(progress * 100)}%` : room.type === "storage" ? "ЗАПАСЫ" : room.type === "dormitory" ? "МЕСТА ОТРЯДА" : cell.working ? `${Math.floor((cell.production?.progress ?? 0) * 100)}% · ${cell.production?.stageLabel ?? "Сборка"}` : production?.reason ? briefReason : !room.workerIds.length ? "НУЖЕН РАБОЧИЙ" : production?.status === "Нет заказа" ? "БЕЗ ЗАКАЗА" : "ЖДЁТ ПАРТИЮ";
					const clippedStatus = `${status.toLocaleUpperCase("ru-RU").slice(0, 17)}${status.length > 17 ? "…" : ""}`;
					cell.status.setText(clippedStatus).setColor(construction ? "#ffd399" : cell.working ? "#d1efb0" : cell.operational === "blocked" ? "#edc294" : "#c1cbbc");
					if (cell.working) {
						cell.progress.fillStyle(0x0d2219).fillCircle(11, 90, 5);
						polygon(cell.progress, [{ x: 9, y: 86 }, { x: 15, y: 90 }, { x: 9, y: 94 }], 0xc6e8a4);
					} else if (cell.operational === "blocked") cell.progress.fillStyle(0xf0bd8f).fillRect(7, 86, 3, 8).fillRect(12, 86, 3, 8);
					else if (construction) { line(cell.progress, [{ x: 7, y: 94 }, { x: 14, y: 87 }], 0xf4c687, 2.3); cell.progress.fillStyle(0xf4c687).fillRect(12, 85, 6, 3); }
					else cell.progress.lineStyle(1.5, 0xb5c2b1, .85).strokeCircle(11, 90, 4);
					cell.lamp.setAlpha(cell.backdrop ? construction ? .1 : cell.working ? .13 : .06 : construction ? .12 : cell.working ? .3 : .2);
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
			const instant = reducedMotion && !slot.inLift;
			slot.route = instant ? [] : this.actorRoute(slot, at);
			if (instant) slot.actor.setPosition(at.x, at.y);
			slot.working = false;
		}

		private actorRoute(slot: ScavActor, at: Point): Point[] {
			const from = { x: slot.actor.x, y: slot.actor.y }, route = planShelterRoute(from, at);
			if (Math.abs(from.y - at.y) > .01 && SHELTER_FLOOR_Y.some((floor) => Math.abs(from.y - floor) < .01) && !slot.inLift) {
				slot.liftSide = from.x < SHELTER_SHAFT_X ? -1 : from.x > SHELTER_SHAFT_X ? 1 : at.x < SHELTER_SHAFT_X ? -1 : 1;
				const waiting = { x: SHELTER_SHAFT_X + slot.liftSide * 26, y: from.y };
				if (route[0]?.y === from.y) route[0] = waiting; else route.unshift(waiting);
			}
			return route;
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
				if (scav.status === "raiding") { slot.actor.setVisible(false); slot.route = []; slot.goal = "raiding"; slot.working = false; slot.inLift = false; return; }
				if (previousStatus === "raiding") slot.actor.setPosition(112, 129);
				slot.actor.setVisible(true).setScale(1.05).setAlpha(this.drag?.scavId === scav.id ? .45 : scav.status === "wounded" ? .78 : 1);
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
			// A single car owns vertical travel. Walking actors never consume a
			// vertical route leg; one shared delta advances pickup, doors and riders.
			const liftRequests: LiftRequest[] = [];
			for (const [id, slot] of this.scavs) {
				const next = slot.route[0];
				const passenger = this.liftModel.passengerId === id && slot.inLift;
				// A returned scav has a new entrance presence. An old, cancelled
				// cabin ticket must finish parking before this identity can call again.
				if (this.liftModel.passengerId === id && !slot.inLift) continue;
				if (slot.actor.visible && next && (passenger || Math.abs(next.y - slot.actor.y) > .01) && (this.drag?.scavId !== id || passenger)) liftRequests.push({ id, from: slot.actor.y, to: next.y, ready: Math.abs(slot.actor.x - SHELTER_SHAFT_X) < .01 });
			}
			const lift = advanceShelterLift(this.liftModel, liftRequests, step * 1000);
			this.liftModel = lift.state;
			for (const id of lift.boarded) { const rider = this.scavs.get(id); if (rider?.actor.visible) rider.inLift = true; }
			if (lift.state.passengerId) { const rider = this.scavs.get(lift.state.passengerId); if (rider?.inLift && rider.actor.visible) rider.actor.setPosition(SHELTER_SHAFT_X, lift.state.y); }
			for (const drop of lift.dropped) {
				const slot = this.scavs.get(drop.id);
				if (!slot?.inLift || !slot.actor.visible) continue;
				slot.inLift = false;
				slot.actor.setPosition(SHELTER_SHAFT_X, drop.to);
				slot.route = this.actorRoute(slot, slot.anchor);
			}
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
				let walkedDistance = 0;
				if (slot.actor.visible && this.drag?.scavId !== id) {
					this.patrolActor(slot, id, time);
					const speed = slot.status === "wounded" ? 27 : 58;
					const passenger = this.liftModel.passengerId === id && slot.inLift;
					const next = slot.route[0], vertical = passenger || Boolean(next && Math.abs(next.y - slot.actor.y) > .01);
					const hadRoute = slot.route.length > 0;
					if (vertical && !passenger) {
						const entering = this.liftModel.phase === "boarding" && this.liftModel.trip?.id === id;
						const ahead = this.liftModel.queue.slice(0, Math.max(0, this.liftModel.queue.findIndex((ticket) => ticket.id === id))).filter((ticket) => ticket.from === slot.actor.y && this.scavs.get(ticket.id)?.liftSide === slot.liftSide).length;
						const waitingX = SHELTER_SHAFT_X + slot.liftSide * (26 + ahead * 24);
						const targetX = entering ? SHELTER_SHAFT_X : waitingX;
						const dx = targetX - slot.actor.x, advance = Math.sign(dx) * Math.min(Math.abs(dx), speed * step);
						slot.actor.setX(slot.actor.x + advance); walkedDistance = Math.abs(advance);
						slot.walking = walkedDistance > .001; slot.climbing = false;
						if (slot.walking) slot.facing = dx < 0 ? -1 : 1;
						if (slot.hovered || this.viewState?.selectedScavId === id) {
							const name = this.viewState?.scavs?.find((scav) => scav.id === id)?.name?.toLocaleUpperCase("ru-RU") ?? "";
							slot.label.setText(`${name}\n${entering ? "ВХОДИТ В ЛИФТ" : "ЖДЁТ ЛИФТ"}`);
						}
					} else {
						const distance = next ? Math.hypot(next.x - slot.actor.x, next.y - slot.actor.y) : 0;
						const motion = advanceShelterRoute({ x: slot.actor.x, y: slot.actor.y }, slot.route, vertical ? 0 : Math.min(speed * step, distance));
						if (!vertical) walkedDistance = Math.abs(motion.point.x - slot.actor.x);
						slot.route = motion.route;
						if (hadRoute) slot.actor.setPosition(motion.point.x, motion.point.y);
							slot.walking = hadRoute && !vertical; slot.climbing = passenger;
						if (slot.walking && !vertical) slot.facing = motion.facing;
						if (hadRoute && motion.arrived) { slot.dwellUntil = time + 6500 + (slot.phase % 4) * 1700; slot.walking = false; slot.climbing = false; }
					}
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
						line(this.ambient, [{ x: slot.actor.x, y: slot.actor.y }, ...slot.route], 0xe8c99d, 2, .26);
						this.ambient.lineStyle(1.2, 0xe8c99d, .55).strokeEllipse(slot.anchor.x, slot.anchor.y, 17, 6);
					}
				}
			}
			this.paintLift(step * 1000);
			for (const cell of this.cells.values()) {
				const g = cell.animation;
				g.clear();
				cell.productLabel.setVisible(Boolean(cell.production?.jobId) && (this.viewCamera.zoom >= 1.6 || cell.hovered || this.viewState?.selectedRoomId === cell.room?.id));
				if (!cell.room) continue;
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
				cell.station.update(time, delta, reducedMotion);
			}
		}

		private paintLift(elapsedMs: number): void {
			const lift = this.liftModel, top = lift.y - 49;
			this.elevator.setY(top);
			const target = lift.doorOpen ? 1 : 0;
			this.liftDoorAmount = reducedMotion ? target : target + (this.liftDoorAmount - target) * Math.exp(-elapsedMs / 70);
			const openness = this.liftDoorAmount, door = this.liftDoors;
			door.setPosition(404, top).clear();
			door.fillStyle(0x597279, .62).fillRect(4, 7, 12 * (1 - openness), 42).fillRect(16 + 12 * openness, 7, 12 * (1 - openness), 42);
			line(door, [{ x: 16 - 12 * openness, y: 7 }, { x: 16 - 12 * openness, y: 49 }], 0xc1c9b6, 1, .85);
			line(door, [{ x: 16 + 12 * openness, y: 7 }, { x: 16 + 12 * openness, y: 49 }], 0xc1c9b6, 1, .85);
			door.fillStyle(0x152e32).fillRect(1, 6, 3, 44).fillRect(28, 6, 3, 44);
			door.fillStyle(lift.phase === "travel" || lift.phase === "pickup" ? 0xe6c581 : lift.doorOpen ? 0xb7d998 : 0x8fa99d).fillCircle(27, 4, 2);
			const floor = SHELTER_FLOOR_Y.indexOf(lift.targetY as typeof SHELTER_FLOOR_Y[number]);
			const direction = Math.abs(lift.targetY - lift.y) < .01 ? "" : lift.targetY > lift.y ? "↓ " : "↑ ";
			const place = floor === 0 ? "ВХОД" : `−${Math.max(1, floor)}`;
			const phase = lift.phase === "boarding" ? "ПОСАДКА" : lift.phase === "alighting" ? "ВЫХОД" : lift.phase === "pickup" ? "ПОДАЧА" : lift.phase === "travel" ? "В ПУТИ" : "СТОЯНКА";
			const signature = `${direction}${place}\n${phase}${lift.queue.length ? ` · ${lift.queue.length}` : ""}`;
			if (signature !== this.liftDisplaySignature) { this.liftDisplaySignature = signature; this.liftDisplay.setText(signature); }
			this.liftDisplay.setPosition(420, top - 10).setVisible(this.viewCamera.zoom >= 1.6 || lift.phase !== "idle");
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
		getPresentationState: () => scene.getPresentationState(),
		restorePresentationState: (value) => scene.restorePresentationState(value),
		zoomBy: (factor, clientX, clientY) => scene.zoomBy(factor, clientX, clientY),
		panBy: (dx, dy) => scene.panBy(dx, dy),
		resetCamera: () => scene.resetCamera(),
		setPanMode: (enabled) => scene.setPanMode(enabled),
		focusRoom: (id) => scene.focusRoom(id),
		projectShelterRect: (rect) => scene.projectShelterRect(rect),
	};
}
