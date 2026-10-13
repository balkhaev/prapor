import Phaser from "phaser";
import { getRaidPhase, type Raid, type RaidReport, type RoomInstance, type WeaponInstance, getShelterSites, getShelterFrontier, type ShelterSite, type ShelterExpansion, ROOM_DEFINITIONS, getRoomWorkerCapacity } from "./game/engine";
import { getRoomFootprint, getRoomPosition, getRoomBounds, getRoomFacing, getRoomLocalPoint, getRoomEntrance, getShelterRoomAtPoint } from "./game/shelter";
import { type BaseRoom } from "./game/data";
import type { GearItem, Loadout } from "./game/systems";
import { ScavEquipment } from "./scav-equipment";
import { SCAV_EQUIPMENT_ATLASES } from "./scav-gear-art";
import { getScavVisualLoadout } from "./scav-loadout";
import { advanceShelterRoute, clientToShelterPoint } from "./shelter-motion";
import { clampShelterCamera, getMinShelterZoom, shelterOverviewCamera, focusShelterRect, panShelterCamera, projectShelterRect, resizeShelterCamera, shelterViewportForSize, viewportToShelter, zoomShelterCamera, type ShelterCamera, type ShelterRect, type ShelterViewport, type ClientRect } from "./shelter-camera";
import { getShelterTerritoryCell, getShelterCorridorSegments, getShelterOpenGroundPoints, getShelterBuildingRect, isShelterPointInTerritory, getShelterWalkingRoute, getShelterWorldBounds, type ShelterLayoutBuilding } from "./shelter-layout";
import { advanceScavAnimation, createScavAnimation, type ScavAnimationState } from "./shelter-animation";
import { SCAV_DIRECTIONS, SCAV_ORIGIN, SCAV_REFERENCE_HEIGHT, scavAppearance, scavAttachment, scavAvailableAppearance, scavDirection, scavFrame, scavPreloadAppearances, scavTexture, scavTorsoAnchor, scavHeadAnchor, type ScavDirection, type ScavPose } from "./scav-isometric";
import { advanceShelterStationClock, getShelterProductionPresentation, type ProductionPresentation } from "./shelter-production";
import { projectShelterPoint, unprojectShelterPoint, projectShelterBounds, shelterBuildingDepth, shelterBuildingHitPolygon, shelterRectPolygon, shelterRoomPolygon, shelterRoomPosition, shelterRoomRect } from "./shelter-isometric";
import { paintIsometricRoom, paintIsometricProduction, getShelterChimney, getShelterPorchLamp } from "./shelter-isometric-art";
import { RaidStreetRenderer } from "./raid-scene";
import { getShelterLandscape, paintShelterLandscape, paintShelterDecoration, type ShelterLandscape, type ShelterLandscapeDecoration } from "./shelter-landscape";
import { sampleShelterAtmosphere, sampleShelterWind, paintShelterAtmosphereGround, paintShelterAtmosphereAir, paintShelterAtmosphereGlows, type ShelterSmokeEmitter, type ShelterAtmosphereLight } from "./shelter-atmosphere";
import { getShelterRoutine, restoreShelterRoutine, type ShelterRoutine } from "./shelter-routines";

export interface WorldSnapshot {
	identityKey?: string;
	base: Record<string, number>;
	raids: Raid[];
	selectedRaidId?: string | null;
	history?: RaidReport[];
	weapons?: WeaponInstance[];
	gearItems?: GearItem[];
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
	shelter?: { rooms: RoomInstance[]; sites?: ShelterSite[]; expansions?: ShelterExpansion[] };
	roomProduction?: Record<string, { progress: number; remainingSeconds: number | null; rate: number; status: string; reason: string | null }>;
	scavs?: {
		id: string;
		name?: string;
		personality?: string;
		appearance?: number;
		status: "ready" | "raiding" | "wounded";
		health: number;
		gear?: { armor: number; backpack: number };
		loadout?: Loadout;
		weaponInstanceId?: string | null;
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
	direction: ScavDirection;
	equipment: ScavEquipment;
	visualLoadout: ReturnType<typeof getScavVisualLoadout>;
	tool: Phaser.GameObjects.Graphics;
	label: Phaser.GameObjects.Text;
	order: Phaser.GameObjects.Arc;
	selection: Phaser.GameObjects.Ellipse;
	hovered: boolean;
	gearSignature: string;
	routine: ShelterRoutine | null;
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
	onHover?: (info: { title: string; detail: string } | null) => void;
	getAssignmentReason?: (scavId: string, roomId: string) => string | null;
	onAssignScav?: (scavId: string, roomId: string) => void;
	onDragState?: (state: { scavId: string; roomId: string | null; reason: string | null } | null) => void;
	onRoom?: (room: BaseRoom) => void;
	onScav?: (id: string) => void;
	onShelterRoom?: (roomId: string) => void;
	onBuildSite?: (site: { column: number; row: number }) => void;
	onShelterSite?: (column: number, row: number) => void;
	canBuildingDrag?: () => boolean;
	getBuildingPlacementReason?: (roomId: string, x: number, y: number, rotation: 0 | 1, facing: 0 | 1 | 2 | 3) => string | null;
	getFreeBuildPlacementReason?: (placement: BuildingPlacement, x: number, y: number) => string | null;
	onPlaceBuilding?: (roomId: string, x: number, y: number, rotation: 0 | 1, facing: 0 | 1 | 2 | 3) => void;
	onBuildingDragState?: (state: BuildingDragState | null) => void;
	onFreeBuildSite?: (point: Point) => void;
}
export interface BuildingDragState { roomId: string; x: number; y: number; rotation: 0 | 1; facing: 0 | 1 | 2 | 3; reason: string | null; active: boolean }
export interface WorldCameraState extends ShelterCamera { panMode: boolean; view: WorldView; following?: boolean; minZoom?: number; maxZoom?: number }
export interface BuildingPlacement {
	type?: string;
	roomId?: string;
	rotation: 0 | 1;
	facing?: 0 | 1 | 2 | 3;
	width: number;
	height: number;
	column?: number;
	row?: number;
	x?: number;
	y?: number;
}
export interface WorldController {
	game: Phaser.Game;
	setView: (view: View) => void;
	selectRaid: (id: string | null) => void;
	setRaidFollow: (enabled: boolean) => void;
	getPresentationState: () => unknown;
	restorePresentationState: (value: unknown) => void;
	beginScavDrag: (id: string) => boolean;
	moveScavDrag: (clientX: number, clientY: number) => void;
	endScavDrag: () => void;
	cancelScavDrag: () => void;
	cancelBuildingDrag: () => void;
	cancelCameraGesture: () => void;
	getCameraState: () => WorldCameraState;
	zoomBy: (factor: number, clientX?: number, clientY?: number) => void;
	panBy: (dx: number, dy: number) => void;
	resetCamera: () => void;
	setPanMode: (enabled: boolean) => void;
	focusRoom: (id: string) => boolean;
	focusBase: () => void;
	setBuildingPlacement: (selection: BuildingPlacement | null) => void;
	projectShelterRect: (rect: ShelterRect) => (ClientRect & { visible: boolean }) | null;
}
type ShelterCell = {
	root: Phaser.GameObjects.Container;
	chrome: Phaser.GameObjects.Container;
	open: boolean;
	expansion: ShelterExpansion | null;
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
	roomId?: string;
	working: boolean;
	operational: "empty" | "building" | "working" | "blocked" | "idle" | "passive";
	feedback: Phaser.GameObjects.Text;
	lastCycles: number | null;
	completedAt: number;
};
type DragSession = { scavId: string; roomId: string | null; reason: string | null; cellKey: string | null; point: Point | null; canvas: boolean; shelter: WorldSnapshot["shelter"]; scav: NonNullable<WorldSnapshot["scavs"]>[number] };
type CanvasGesture = { scavId: string; pointerId: number; clientX: number; clientY: number; active: boolean };
type BuildingGesture = BuildingDragState & { pointerId: number; clientX: number; clientY: number; offset: Point; source: Point; identityKey?: string; room: RoomInstance };
type RaidMarker = {
	actor: Phaser.GameObjects.Container;
	ring: Phaser.GameObjects.Ellipse;
	label: Phaser.GameObjects.Text;
	phase: Phaser.GameObjects.Text;
	hovered: boolean;
};
const WIDTH = 840;
const HEIGHT = 520;
const cellPosition = shelterRoomPosition;
const roomRect = getRoomBounds;
const roomBuildings = (rooms: readonly RoomInstance[]): ShelterLayoutBuilding[] => rooms.map((room) => ({ column: room.column, row: room.row, position: getRoomPosition(room), facing: getRoomFacing(room), ...getRoomFootprint(room) }));
const cellPolygon = (cell: ShelterCell) => cell.room ? shelterRectPolygon(roomRect(cell.room)) : shelterRoomPolygon(cell.column, cell.row);
const roomCellKey = (id: string) => `room:${id}`;
const ROOM_STYLE: Record<string, { label: string; color: number; light: number; wall: number }> = {
	workshop: { label: "МАСТЕРСКАЯ", color: 0xd7a368, light: 0xffcc88, wall: 0x594438 },
	ammo: { label: "ПАТРОНЫ", color: 0xd4d889, light: 0xf1e4a5, wall: 0x515038 },
	recycler: { label: "РАЗБОРКА", color: 0xdd9373, light: 0xffbd99, wall: 0x613e34 },
	medbay: { label: "МЕДБЛОК", color: 0x89d6d0, light: 0xc7f8ef, wall: 0x355c5c },
	radio: { label: "РАДИО", color: 0x8cd4d5, light: 0xace9d7, wall: 0x294b50 },
	storage: { label: "СКЛАД", color: 0xb6c694, light: 0xe6e9b3, wall: 0x465546 },
	dormitory: { label: "ЖИЛЬЁ", color: 0xd0b8ea, light: 0xf1d9f4, wall: 0x55495b },
	hangar: { label: "АНГАР", color: 0x87a0ad, light: 0xb0cfda, wall: 0x405961 },
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
		private shelterCaption!: Phaser.GameObjects.Text;
		private ambient!: Phaser.GameObjects.Graphics;
		private atmosphereGround!: Phaser.GameObjects.Graphics;
		private atmosphereAir!: Phaser.GameObjects.Graphics;
		private atmosphereGlows!: Phaser.GameObjects.Graphics;
		private landscape: ShelterLandscape | null = null;
		private smokeEmitters: ShelterSmokeEmitter[] = [];
		private atmosphereLights: ShelterAtmosphereLight[] = [];
		private windProps: { art: Phaser.GameObjects.Graphics; decoration: ShelterLandscapeDecoration }[] = [];
		private lastAtmospherePaint = -1000;
		private lastWindPaint = -1000;
		private dragGhost!: Phaser.GameObjects.Graphics;
		private placementGhost!: Phaser.GameObjects.Graphics;
		private buildingGhost!: Phaser.GameObjects.Graphics;
		private buildingPlacement: BuildingPlacement | null = null;
		private placementHover: Point | null = null;
		private buildingGesture: BuildingGesture | null = null;
		private drag: DragSession | null = null;
		private gesture: CanvasGesture | null = null;
		private nativeEvents = new AbortController();
		private viewState: WorldSnapshot | null = null;
		private terrain!: Phaser.GameObjects.Graphics;
		private exteriorProps: Phaser.GameObjects.Graphics[] = [];
		private perimeterFences: Phaser.GameObjects.Graphics[] = [];
		private layoutSignature = "";
		private worldBounds: ShelterRect = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
		private pendingPresentation: unknown = null;
		private presentationReady = false;
		private restoringPresentation = false;
		private capturingPresentation = false;
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
		private requestedScavAtlases = new Set<number>();
		private lastSync = 0;
		private lastSelection = "";
		private hq: Point = { x: 110, y: 357 };

		constructor() {
			super("PraporWorld");
		}

		preload(): void {
			this.load.spritesheet("shelter-room-atlas", "/art/shelter-rooms.png", { frameWidth: 768, frameHeight: 256 });
			for (const appearance of scavPreloadAppearances(snapshot().scavs)) this.queueScavAtlas(appearance);
			this.load.atlas("raid-props", "/art/raid-props.png", "/art/raid-props.json");
			for (const atlas of SCAV_EQUIPMENT_ATLASES) this.load.atlas(atlas.key, `/art/${atlas.basename}.png`, `/art/${atlas.basename}.json`);
		}

		private queueScavAtlas(appearance: number): void {
			if (this.requestedScavAtlases.has(appearance) || this.textures.exists(scavTexture(appearance))) return;
			this.requestedScavAtlases.add(appearance);
			this.load.atlas(scavTexture(appearance), `/art/scav-isometric-${appearance}.png`, `/art/scav-isometric-${appearance}.json`);
		}

		private requestScavAtlas(appearance: number): void {
			this.queueScavAtlas(appearance);
			if (!this.load.isLoading() && this.load.list.size > 0) this.load.start();
		}

		private refreshScavAtlases(): void {
			if (!this.presentationReady) return;
			this.syncPeople(snapshot());
			if (requestedView === "raid") this.raidStreet.update(snapshot(), Date.now(), 0);
		}

		create(): void {
			this.cameras.main.setBackgroundColor(C.void);
			this.makeGlow();
			this.baseLayer = this.add.container(0, 0);
			this.mapLayer = this.add.container(0, 30);
			this.paintBunker();
			this.paintMap();
			this.raidStreet = new RaidStreetRenderer(this, this.viewport, reducedMotion, (appearance) => this.requestScavAtlas(appearance));
			this.load.on(Phaser.Loader.Events.COMPLETE, this.refreshScavAtlases, this);
			this.raidStreet.selectRaid(requestedRaidId);
			this.installDragListeners();
			this.installViewportObserver();
			this.syncSnapshot();
			this.show(requestedView);
			this.presentationReady = true;
			if (this.pendingPresentation) this.restorePresentationState(this.pendingPresentation);
			this.game.canvas.setAttribute("aria-hidden", "true");
			this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
				this.cancelScavDrag();
				this.cancelBuildingDrag();
				this.cancelCameraGesture();
				this.raidStreet.destroy();
				this.viewportObserver?.disconnect();
				if (this.viewportFrame) cancelAnimationFrame(this.viewportFrame);
				this.nativeEvents.abort();
				this.load.off(Phaser.Loader.Events.COMPLETE, this.refreshScavAtlases, this);
				this.requestedScavAtlases.clear();
				this.raidActors.clear();
				this.places.clear();
				this.cells.clear();
				this.scavs.clear();
				this.presentationReady = false;
			});
		}

		show(view: View): void {
			if (view !== requestedView) { this.cancelScavDrag(); this.cancelBuildingDrag(); this.cancelCameraGesture(); }
			requestedView = view;
			interactions.onHover?.(null);
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
			if (view === "raid") this.raidStreet.resize(this.viewport);
		}

		getCameraState(): WorldCameraState { return { ...(requestedView === "raid" && this.raidStreet ? this.raidStreet.getCameraState() : this.viewCamera), panMode: this.panMode, view: requestedView, minZoom: requestedView === "raid" ? .7 : getMinShelterZoom(this.viewport, this.worldBounds), maxZoom: 4 }; }
		getPresentationState(): unknown {
			if (!this.presentationReady || this.restoringPresentation) return this.pendingPresentation;
			const actual = snapshot();
			// An action can save before Phaser's next frame. Update destinations and
			// assignments at the existing feet positions; neither clock nor movement
			// advances here. Callback-driven captures must not recursively synchronize.
			if (!this.capturingPresentation) {
				this.capturingPresentation = true;
				try { this.syncShelter(actual); } finally { this.capturingPresentation = false; }
			}
			const actors = [...this.scavs].filter(([id, slot]) => {
				if (actual.shelter !== this.viewState?.shelter || !slot.actor.visible) return false;
				const scav = actual.scavs?.find((candidate) => candidate.id === id);
				const assignment = actual.shelter?.rooms.find((room) => room.id === scav?.assignment && room.workerIds.includes(id))?.id ?? null;
				return Boolean(scav && scav.status !== "raiding" && assignment === slot.assignment);
			});
			return { version: 1, layout: "surface", camera: { ...this.viewCamera }, viewport: { ...this.viewport }, panMode: this.panMode,
				raidId: requestedRaidId, raidCamera: this.raidStreet?.getCameraState(),
				actors: actors.map(([id, slot]) => ({ id, x: slot.position.x, y: slot.position.y,
					assignment: slot.assignment, role: slot.role, goal: slot.goal, anchor: { ...slot.anchor },
					routine: slot.routine ? { point: { ...slot.routine.point }, activity: slot.routine.activity } : null,
					visit: slot.visit, facing: slot.facing, direction: slot.direction, dwellMs: Math.max(0, slot.dwellUntil - this.time.now), animation: { ...slot.animation } })) };
		}

		restorePresentationState(value: unknown): void {
			if (!value || typeof value !== "object") return;
			if (!this.presentationReady) { this.pendingPresentation = value; return; }
			const data = value as Record<string, unknown>; if (data.version !== 1) return;
			// Captures triggered by camera/drag callbacks during restoration keep the
			// queued data, rather than persisting bootstrap defaults over the saved view.
			this.pendingPresentation = value; this.restoringPresentation = true;
			try {
			this.cancelScavDrag(); this.cancelCameraGesture();
			if (snapshot().shelter !== this.viewState?.shelter) this.syncSnapshot();
			const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" ? v as Record<string, unknown> : null;
			const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
			const camera = object(data.camera), savedViewport = object(data.viewport);
			if (camera && finite(camera.zoom) && finite(camera.x) && finite(camera.y) && camera.zoom > 0 && camera.zoom <= 4) {
				const prior = savedViewport && finite(savedViewport.width) && finite(savedViewport.height) && savedViewport.width > 0 && savedViewport.height > 0 ? { width: savedViewport.width, height: savedViewport.height } : this.viewport;
				this.viewCamera = resizeShelterCamera({ zoom: camera.zoom, x: camera.x, y: camera.y }, prior, this.viewport, this.worldBounds);
			}
			if (typeof data.panMode === "boolean") this.panMode = data.panMode;
			const state = snapshot(), sites = getShelterSites(state.shelter ?? { rooms: [] });
			const point = (v: unknown): Point | null => { const p = object(v); return p && finite(p.x) && finite(p.y) && Math.abs(p.x) < 100_000 && Math.abs(p.y) < 100_000 ? { x: p.x, y: p.y } : null; };
			// Old underground positions are discarded; current surface paths are regenerated
			// through actual doors and carved corridors, so stale routes cannot cross new walls.
			if (data.layout === "surface" && Array.isArray(data.actors)) for (const raw of data.actors.slice(0, 32)) {
				const saved = object(raw); if (!saved || typeof saved.id !== "string") continue;
				const slot = this.scavs.get(saved.id), scav = state.scavs?.find((candidate) => candidate.id === saved.id);
				if (!slot || !scav || scav.status === "raiding" || saved.assignment !== slot.assignment || saved.role !== slot.role) continue;
				const at = point(saved), anchor = point(saved.anchor);
				if (!at || !anchor || typeof saved.goal !== "string" || saved.goal.length > 180) continue;
				const goal = saved.goal;
				const visit = finite(saved.visit) ? Math.max(0, Math.min(1_000_000, Math.floor(saved.visit))) : 0;
				const restoredRoutine = !slot.assignment && slot.role === "idle" && goal.startsWith("routine:") ? restoreShelterRoutine({ scavId: scav.id, personality: scav.personality,
					visit, from: at, sites, buildings: roomBuildings(state.shelter?.rooms ?? []), decorations: this.landscape?.decorations ?? [],
					reservedTargets: data.actors.slice(0, 32).flatMap(otherRaw => {
						const other = object(otherRaw), person = state.scavs?.find(item => item.id === other?.id), target = other && point(other.anchor);
						return target && person && person.id !== scav.id && person.status === "ready" && !person.assignment ? [target] : [];
					}) }, saved.routine) : null;
				if (goal.startsWith("routine:") && (!restoredRoutine || goal !== `routine:${visit}:${restoredRoutine.activity}` || Math.hypot(anchor.x - restoredRoutine.point.x, anchor.y - restoredRoutine.point.y) > .01)) continue;
				const allowed = slot.assignment ? goal.startsWith(`work:${slot.assignment}:`) : slot.role === "rest" ? goal === slot.goal
					: Boolean(restoredRoutine) || goal.startsWith("idle-home:") || goal.startsWith("visit:") && state.shelter?.rooms.some((room) => goal === `visit:${saved.visit}:${room.id}`);
				if (!allowed) continue;
				const destination = slot.assignment ? slot.anchor : anchor;
				const route = getShelterWalkingRoute(at, destination, sites, roomBuildings(state.shelter?.rooms ?? []));
				if (!route.length && Math.hypot(at.x - destination.x, at.y - destination.y) > .01) continue;
				const onFloor = isShelterPointInTerritory(at, sites);
				const onCorridor = getShelterCorridorSegments(sites, roomBuildings(state.shelter?.rooms ?? [])).some(({from,to}) => Math.abs(from.x - to.x) < .001 ? Math.abs(at.x - from.x) < .001 && at.y >= Math.min(from.y,to.y) && at.y <= Math.max(from.y,to.y) : Math.abs(at.y - from.y) < .001 && at.x >= Math.min(from.x,to.x) && at.x <= Math.max(from.x,to.x));
				const onStreet = at.y >= 38 && at.y <= 132 && at.x >= Math.min(...sites.map((p) => cellPosition(p.column,p.row).x)) - 40 && at.x <= Math.max(...sites.map((p) => cellPosition(p.column,p.row).x)) + 212;
				const onDoor = sites.some((p) => { const origin = cellPosition(p.column, p.row); return Math.abs(at.x - origin.x - 86) < .001 && at.y >= origin.y + 100 && at.y <= origin.y + 116; });
				if (!onFloor && !onCorridor && !onStreet && !onDoor) continue;
				this.placeActor(slot, at); slot.route = reducedMotion ? [] : route; slot.anchor = { ...destination };
				slot.routine = restoredRoutine;
				if (!slot.assignment || goal === slot.goal) slot.goal = goal;
				if (reducedMotion) this.placeActor(slot, destination);
				if (finite(saved.visit)) slot.visit = Math.max(0, Math.min(1_000_000, Math.floor(saved.visit)));
				if (finite(saved.dwellMs)) slot.dwellUntil = this.time.now + Math.max(0, Math.min(60_000, saved.dwellMs));
				slot.facing = saved.facing === -1 ? -1 : 1;
				if (SCAV_DIRECTIONS.includes(saved.direction as ScavDirection)) slot.direction = saved.direction as ScavDirection;
				const animation = object(saved.animation);
				if (animation) { const next = { ...slot.animation }; for (const key of Object.keys(next) as (keyof ScavAnimationState)[]) if (key !== "observedJob" && finite(animation[key]) && Math.abs(animation[key]) < 1e7) (next as unknown as Record<string, unknown>)[key] = animation[key]; next.observedJob = typeof animation.observedJob === "string" ? animation.observedJob : null; slot.animation = next; }
			}
			if (typeof data.raidId === "string" && data.raidId === requestedRaidId && (state.raids.some((raid) => raid.id === data.raidId) || state.history?.some((report) => report.raidId === data.raidId))) { this.selectRaid(data.raidId); this.raidStreet.restoreCamera(data.raidCamera); }
			this.applyCamera();
			} finally { this.restoringPresentation = false; this.pendingPresentation = null; }
		}

		selectRaid(id: string | null): void { requestedRaidId = id; this.raidStreet?.selectRaid(id); if (requestedView === "raid" && this.raidStreet) this.raidStreet.update(snapshot(), Date.now(), 0); this.applyCamera(); }
		setRaidFollow(enabled: boolean): void { this.raidStreet?.setFollow(enabled); this.applyCamera(); }

		private cameraAllowed(): boolean {
			return Boolean(this.baseLayer && this.scene.isActive() && (requestedView === "base" || requestedView === "raid") && !document.hidden && !this.drag && !this.gesture && !this.buildingGesture && interactions.canCamera?.() !== false);
		}

		private applyCamera(): void {
			this.viewCamera = clampShelterCamera(this.viewCamera, this.viewport, this.worldBounds);
			this.baseLayer?.setScale(this.viewCamera.zoom).setPosition(-this.viewCamera.x * this.viewCamera.zoom, -this.viewCamera.y * this.viewCamera.zoom);
			this.mapLayer?.setPosition((this.viewport.width - WIDTH) / 2, (this.viewport.height - HEIGHT) / 2 + 30);
			this.input?.setDefaultCursor(this.buildingGesture?.active ? "grabbing" : this.panMode || this.spacePressed || requestedView === "raid" ? "grab" : "default");
			if (this.panMode || this.spacePressed || requestedView !== "base") interactions.onHover?.(null);
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
			this.cancelScavDrag(); this.cancelBuildingDrag(); this.cancelPan(); this.spacePressed = false;
			const next = shelterViewportForSize(rect.width, rect.height);
			this.viewCamera = resizeShelterCamera(this.viewCamera, this.viewport, next, this.worldBounds);
			const changed = Math.abs(next.width - this.viewport.width) > .001 || Math.abs(next.height - this.viewport.height) > .001;
			this.viewport = next;
			// FIT still scales uniformly, but its logical viewport now occupies the
			// whole stage. Only the fully visible overview keeps centered margins.
			this.scale.getParentBounds();
			if (changed) this.scale.setGameSize(next.width, next.height);
			else this.scale.refresh();
			this.raidStreet?.resize(next);
			this.applyCamera();
		}

		zoomBy(factor: number, clientX?: number, clientY?: number): void {
			if (!this.cameraAllowed() || !Number.isFinite(factor) || factor <= 0) return;
			const anchor = clientX !== undefined && clientY !== undefined ? clientToShelterPoint(clientX, clientY, this.game.canvas.getBoundingClientRect(), this.viewport.width, this.viewport.height) : { x: this.viewport.width / 2, y: this.viewport.height / 2 };
			if (!anchor) return;
			if (requestedView === "raid") { this.raidStreet.zoomBy(factor, clientX !== undefined && clientY !== undefined ? anchor : undefined); this.applyCamera(); return; }
			this.viewCamera = zoomShelterCamera(this.viewCamera, this.viewCamera.zoom * factor, anchor, this.viewport, this.worldBounds); this.applyCamera();
		}

		panBy(dx: number, dy: number): void { if (this.cameraAllowed()) { if (requestedView === "raid") this.raidStreet.panBy(dx, dy); else this.viewCamera = panShelterCamera(this.viewCamera, dx, dy, this.viewport, this.worldBounds); this.applyCamera(); } }
		resetCamera(): void { if (this.cameraAllowed()) { if (requestedView === "raid") this.raidStreet.resetCamera(); else this.viewCamera = shelterOverviewCamera(this.viewport, this.worldBounds); this.applyCamera(); } }
		setPanMode(enabled: boolean): void { this.panMode = Boolean(enabled); this.cancelPan(); if (enabled) { this.cancelScavDrag(); this.cancelBuildingDrag(); } this.applyCamera(); }
		focusBase(): void {
			if (!this.cameraAllowed() || requestedView !== "base") return;
			const sites = getShelterSites(snapshot().shelter ?? { rooms: [] });
			if (!sites.length) { this.resetCamera(); return; }
			const bounds = sites.map((site) => projectShelterBounds(shelterRoomRect(site.column, site.row)));
			const left = Math.min(...bounds.map((p) => p.x)), top = Math.min(...bounds.map((p) => p.y)) - 42;
			const width = Math.max(...bounds.map((p) => p.x + p.width)) - left, height = Math.max(...bounds.map((p) => p.y + p.height)) - top;
			const zoom = Math.min(2, this.viewport.width / (width + 96), this.viewport.height / (height + 100));
			this.viewCamera = focusShelterRect(this.viewCamera, { x: left, y: top, width, height }, zoom, this.viewport, this.worldBounds);
			this.panMode = false; this.applyCamera();
		}

		focusRoom(id: string): boolean {
			if (!this.baseLayer || requestedView !== "base" || document.hidden) return false;
			const room = snapshot().shelter?.rooms.find((candidate) => candidate.id === id);
			if (!room) return false;
			const bounds = projectShelterBounds(roomRect(room));
			const zoom = Math.min(2.5, this.viewport.width / (bounds.width + 80), this.viewport.height / (bounds.height + 80));
			this.viewCamera = focusShelterRect(this.viewCamera, { ...bounds, y: bounds.y - 24, height: bounds.height + 24 }, zoom, this.viewport, this.worldBounds);
			if (this.drag) {
				this.drag.point = null; this.drag.roomId = null; this.drag.cellKey = null;
				this.dragGhost.clear();
				for (const cell of this.cells.values()) this.paintCellFrame(cell);
			}
			this.applyCamera(); return true;
		}

		projectShelterRect(rect: ShelterRect): (ClientRect & { visible: boolean }) | null {
			return this.baseLayer && requestedView === "base" ? projectShelterRect(projectShelterBounds(rect), this.viewCamera, this.game.canvas.getBoundingClientRect(), this.viewport, this.worldBounds) : null;
		}

		setBuildingPlacement(selection: BuildingPlacement | null): void {
			if (selection) this.cancelBuildingDrag();
			this.buildingPlacement = selection ? { ...selection } : null;
			if (!selection) this.placementHover = null;
			this.paintBuildingPlacement();
		}

		private paintBuildingPlacement(): void {
			if (!this.placementGhost) return;
			this.placementGhost.clear();
			if (requestedView !== "base") return;
			const drag = this.buildingGesture;
			const placement = drag?.active ? { roomId: drag.roomId, rotation: drag.rotation, facing: drag.facing, ...getRoomFootprint(drag.room), x: drag.x, y: drag.y } : this.buildingPlacement;
			if (!placement) return;
			const paint = (point: Point, pinned: boolean) => {
				const reason = drag?.active ? drag.reason : interactions.getFreeBuildPlacementReason?.(placement, point.x, point.y)
					?? (placement.roomId ? interactions.getBuildingPlacementReason?.(placement.roomId, point.x, point.y, placement.rotation, placement.facing ?? 0) : null);
				const size = shelterRoomRect(0, 0, placement.width, placement.height);
				const odd = (placement.facing ?? 0) % 2, width = odd ? size.height : size.width, height = odd ? size.width : size.height;
				const corners = shelterRectPolygon({ ...point, width, height }), tint = reason ? 0xed997e : 0xb6eaa0;
				polygon(this.placementGhost, corners, tint, pinned ? .15 : .22);
				line(this.placementGhost, [...corners, corners[0]!], tint, pinned ? 2 : 3, pinned ? .6 : 1);
				const facing = placement.facing ?? 0;
				const door = facing === 0 ? { x: point.x + width / 2, y: point.y + height } : facing === 1 ? { x: point.x, y: point.y + height / 2 } : facing === 2 ? { x: point.x + width / 2, y: point.y } : { x: point.x + width, y: point.y + height / 2 };
				const normal = [{x:0,y:1},{x:-1,y:0},{x:0,y:-1},{x:1,y:0}][facing]!;
				const arrow = projectShelterPoint(door), tip = projectShelterPoint({ x: door.x + normal.x * 24, y: door.y + normal.y * 24 });
				line(this.placementGhost, [arrow, tip], tint, 3, 1);
				const angle = Math.atan2(tip.y - arrow.y, tip.x - arrow.x);
				for (const side of [-1, 1]) line(this.placementGhost, [tip, { x: tip.x - Math.cos(angle + side * .6) * 9, y: tip.y - Math.sin(angle + side * .6) * 9 }], tint, 2, 1);
				if (!pinned) {
					const elevated = corners.map((point) => ({ x: point.x, y: point.y - 20 }));
					line(this.placementGhost, [...elevated, elevated[0]!], tint, 1, .65);
					for (let i = 0; i < corners.length; i++) line(this.placementGhost, [corners[i]!, elevated[i]!], tint, 1, .6);
				}
			};
			const pinned = placement.x !== undefined && placement.y !== undefined ? { x: placement.x, y: placement.y }
				: placement.column !== undefined && placement.row !== undefined ? cellPosition(placement.column, placement.row) : null;
			if (pinned) paint(pinned, !drag?.active);
			if (!drag?.active && this.placementHover && (!pinned || Math.hypot(this.placementHover.x - pinned.x, this.placementHover.y - pinned.y) > .01)) paint(this.placementHover, false);
		}

		private clientWorld(clientX: number, clientY: number): Point | null {
			const viewport = clientToShelterPoint(clientX, clientY, this.game.canvas.getBoundingClientRect(), this.viewport.width, this.viewport.height);
			return viewport ? unprojectShelterPoint(viewportToShelter(viewport, this.viewCamera, this.viewport, this.worldBounds)) : null;
		}

		private roomAtPoint(point: Point): RoomInstance | null {
			const shelter = snapshot().shelter ?? { rooms: [] };
			const visual = projectShelterPoint(point);
			// Cabins are upright above their footprint; their roofs are draggable too.
			return [...shelter.rooms].sort((a, b) => shelterBuildingDepth(roomRect(b)) - shelterBuildingDepth(roomRect(a)))
				.find((room) => Phaser.Geom.Polygon.Contains(new Phaser.Geom.Polygon(shelterBuildingHitPolygon(roomRect(room))), visual.x, visual.y)) ?? null;
		}

		private buildingAllowed(): boolean {
			return requestedView === "base" && !document.hidden && !this.panMode && !this.spacePressed
				&& interactions.canInteract?.() !== false && interactions.canBuildingDrag?.() !== false;
		}

		private moveBuildingDrag(clientX: number, clientY: number): void {
			const drag = this.buildingGesture;
			if (!drag) return;
			if (!this.buildingAllowed() || !this.buildingSourceCurrent(drag)) { this.cancelBuildingDrag(); return; }
			const point = this.clientWorld(clientX, clientY);
			if (!point) {
				drag.reason = "Отпусти постройку на территории базы";
				this.paintBuildingPlacement();
				interactions.onBuildingDragState?.({ roomId: drag.roomId, x: drag.x, y: drag.y, rotation: drag.rotation, facing: drag.facing, reason: drag.reason, active: true });
				return;
			}
			drag.x = point.x - drag.offset.x; drag.y = point.y - drag.offset.y;
			drag.clientX = clientX; drag.clientY = clientY;
			drag.reason = drag.room.status !== "ready" ? "Дождись окончания строительных работ" : interactions.getBuildingPlacementReason?.(drag.roomId, drag.x, drag.y, drag.rotation, drag.facing) ?? null;
			const from = projectShelterPoint(drag.source), to = projectShelterPoint(drag);
			this.buildingGhost.setPosition(to.x - from.x, to.y - from.y).setVisible(true);
			this.paintBuildingPlacement();
			interactions.onBuildingDragState?.({ roomId: drag.roomId, x: drag.x, y: drag.y, rotation: drag.rotation, facing: drag.facing, reason: drag.reason, active: true });
		}

		private buildingSourceCurrent(drag: BuildingGesture): boolean {
			const state = snapshot(), room = state.shelter?.rooms.find((candidate) => candidate.id === drag.roomId);
			if (state.identityKey !== drag.identityKey || !room || room.status !== drag.room.status || room.type !== drag.room.type || (room.rotation ?? 0) !== drag.rotation || getRoomFacing(room) !== getRoomFacing(drag.room)) return false;
			const at = getRoomPosition(room);
			return Math.hypot(at.x - drag.source.x, at.y - drag.source.y) < .001;
		}

		cancelBuildingDrag(): void {
			const drag = this.buildingGesture;
			this.buildingGesture = null;
			this.buildingGhost?.clear().setPosition(0, 0).setVisible(false);
			if (drag) {
				this.cells.get(roomCellKey(drag.roomId))?.root.setAlpha(1);
				this.cells.get(roomCellKey(drag.roomId))?.chrome.setAlpha(1);
				if (this.game.canvas.hasPointerCapture?.(drag.pointerId)) this.game.canvas.releasePointerCapture(drag.pointerId);
				interactions.onBuildingDragState?.(null);
			}
			this.paintBuildingPlacement(); this.applyCamera();
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
				&& !this.drag && !this.gesture && !this.buildingGesture
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
			if (!ROOM_DEFINITIONS[room.type].production) return "Здесь нет рабочих мест";
			return "Назначение недоступно";
		}

		beginScavDrag(scavId: string): boolean {
			if (!this.baseLayer || !this.scene.isActive() || requestedView !== "base" || document.hidden || this.drag || this.buildingGesture || this.buildingPlacement || this.panGesture || this.panMode || this.spacePressed || interactions.canDrag?.() === false || !interactions.onAssignScav) return false;
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
			const site = point ? getShelterTerritoryCell(point) : null;
			const room = point ? getShelterRoomAtPoint(state.shelter ?? { rooms: [] }, point.x, point.y) : undefined;
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
			const room = drag.point ? getShelterRoomAtPoint(state.shelter ?? { rooms: [] }, drag.point.x, drag.point.y) : undefined;
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
				if (event.button !== 0 || this.gesture || this.drag || this.buildingGesture || interactions.canInteract?.() === false) return;
				const point = this.clientWorld(event.clientX, event.clientY);
				if (!point) return;
				if (this.buildingPlacement) {
					event.preventDefault();
					if (interactions.onFreeBuildSite) interactions.onFreeBuildSite(point);
					else { const site = getShelterTerritoryCell(point); if (site) interactions.onBuildSite?.(site); }
					return;
				}
				const visual = projectShelterPoint(point);
				const hit = [...this.scavs].filter(([, slot]) => slot.actor.visible && Math.abs(slot.actor.x - visual.x) <= 16 * slot.actor.scaleX && visual.y >= slot.actor.y - 44 * slot.actor.scaleY && visual.y <= slot.actor.y + 2).sort((a, b) => Math.hypot(a[1].actor.x - visual.x, a[1].actor.y - 21 - visual.y) - Math.hypot(b[1].actor.x - visual.x, b[1].actor.y - 21 - visual.y))[0];
				if (hit) {
					this.gesture = { scavId: hit[0], pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, active: false };
					canvas.setPointerCapture(event.pointerId); return;
				}
				const room = this.roomAtPoint(point);
				if (room) {
					const origin = getRoomPosition(room);
					this.buildingGesture = { roomId: room.id, room, source: { ...origin }, identityKey: snapshot().identityKey, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, offset: { x: point.x - origin.x, y: point.y - origin.y }, ...origin, rotation: room.rotation ?? 0, facing: getRoomFacing(room), active: false, reason: null };
					canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
				}
				const site = getShelterTerritoryCell(point), cell = site && this.cells.get(`${site.column}:${site.row}`);
				if (cell) { this.clickFeedback(projectShelterPoint(point), this.baseLayer); if (interactions.onBuildSite) interactions.onBuildSite(site!); else interactions.onShelterSite?.(site!.column, site!.row); }
			}, options);
			canvas.addEventListener("pointermove", (event) => {
				if (this.buildingPlacement && requestedView === "base") {
					const point = this.clientWorld(event.clientX, event.clientY);
					this.placementHover = point;
					this.paintBuildingPlacement();
				}
				if (this.cameraTouches.has(event.pointerId)) this.cameraTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
				const pinch = this.pinchGesture;
				if (pinch && pinch.ids.includes(event.pointerId)) {
					if (!this.cameraAllowed()) { this.cancelCameraGesture(); return; }
					const a = this.cameraTouches.get(pinch.ids[0]), b = this.cameraTouches.get(pinch.ids[1]), rect = canvas.getBoundingClientRect();
					if (!a || !b || rect.width <= 0 || rect.height <= 0) return;
					const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
					const anchor = { x: (pinch.midpoint.x - rect.left) * this.viewport.width / rect.width, y: (pinch.midpoint.y - rect.top) * this.viewport.height / rect.height };
					if (requestedView === "raid") { this.raidStreet.zoomBy(distance / pinch.distance, anchor); this.raidStreet.panBy((pinch.midpoint.x - midpoint.x) * this.viewport.width / rect.width, (pinch.midpoint.y - midpoint.y) * this.viewport.height / rect.height); }
					else { this.viewCamera = zoomShelterCamera(this.viewCamera, this.viewCamera.zoom * distance / pinch.distance, anchor, this.viewport, this.worldBounds); this.viewCamera = panShelterCamera(this.viewCamera, (pinch.midpoint.x - midpoint.x) * this.viewport.width / rect.width, (pinch.midpoint.y - midpoint.y) * this.viewport.height / rect.height, this.viewport, this.worldBounds); }
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
				const building = this.buildingGesture;
				if (building && event.pointerId === building.pointerId) {
					if (!building.active && Math.hypot(event.clientX - building.clientX, event.clientY - building.clientY) >= 6) {
						if (!this.buildingAllowed() || !interactions.onPlaceBuilding) { this.cancelBuildingDrag(); return; }
						if (building.room.status !== "ready") { interactions.onHover?.({ title: ROOM_DEFINITIONS[building.room.type].label, detail: "Дождись окончания строительных работ" }); this.cancelBuildingDrag(); return; }
						building.active = true;
						this.cells.get(roomCellKey(building.roomId))?.root.setAlpha(.35);
						this.cells.get(roomCellKey(building.roomId))?.chrome.setAlpha(.35);
						this.buildingGhost.clear().setAlpha(.65);
						paintIsometricRoom(this.buildingGhost, building.room.column, building.room.row, building.room);
						this.input.setDefaultCursor("grabbing");
					}
					if (building.active) { event.preventDefault(); this.moveBuildingDrag(event.clientX, event.clientY); }
					return;
				}
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
				const building = this.buildingGesture;
				if (building && event.pointerId === building.pointerId) {
					if (building.active) {
						this.moveBuildingDrag(event.clientX, event.clientY);
						const allowed = this.buildingGesture === building && this.buildingAllowed() && !building.reason;
						this.cancelBuildingDrag();
						if (allowed) interactions.onPlaceBuilding?.(building.roomId, building.x, building.y, building.rotation, building.facing);
						else if (building.reason) interactions.onHover?.({ title: "Постройку нельзя разместить", detail: building.reason });
					} else {
						const tapped = Math.hypot(event.clientX - building.clientX, event.clientY - building.clientY) < 6;
						this.cancelBuildingDrag();
						if (tapped && interactions.canInteract?.() !== false) {
							if (interactions.onShelterRoom) interactions.onShelterRoom(building.roomId);
							else if (["workshop", "medbay", "radio", "storage"].includes(building.room.type)) interactions.onRoom?.(building.room.type as BaseRoom);
						}
					}
					return;
				}
				const gesture = this.gesture;
				if (!gesture || event.pointerId !== gesture.pointerId) return;
				if (gesture.active) { this.moveScavDrag(event.clientX, event.clientY); this.endScavDrag(); return; }
				const tapped = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 8;
				this.clearGesture();
				if (tapped && requestedView === "base" && interactions.canInteract?.() !== false && this.clientWorld(event.clientX, event.clientY)) interactions.onScav?.(gesture.scavId);
			}, options);
			canvas.addEventListener("pointercancel", () => { this.cancelScavDrag(); this.cancelBuildingDrag(); this.cancelCameraGesture(); }, options);
			canvas.addEventListener("pointerleave", () => { this.placementHover = null; this.paintBuildingPlacement(); }, options);
			canvas.addEventListener("lostpointercapture", () => { if (this.gesture) this.cancelScavDrag(); if (this.buildingGesture) this.cancelBuildingDrag(); if (this.panGesture) this.cancelCameraGesture(); }, options);
			canvas.addEventListener("dblclick", (event) => {
				if (requestedView !== "base" || !this.cameraAllowed()) return;
				if (this.buildingPlacement) return;
				const point = this.clientWorld(event.clientX, event.clientY), room = point ? this.roomAtPoint(point) : null;
				if (room) { event.preventDefault(); this.focusRoom(room.id); }
			}, options);
			canvas.addEventListener("wheel", (event) => {
				if (!this.cameraAllowed() || event.target !== canvas) return;
				event.preventDefault(); this.zoomBy(Math.exp(-Phaser.Math.Clamp(event.deltaY, -160, 160) * .0025), event.clientX, event.clientY);
			}, { ...options, passive: false });
			window.addEventListener("keydown", (event) => {
				if (event.key === "Escape" && (this.drag || this.gesture || this.buildingGesture || this.panGesture)) { event.preventDefault(); this.cancelScavDrag(); this.cancelBuildingDrag(); this.cancelCameraGesture(); }
				if (!event.defaultPrevented && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "r" && this.buildingAllowed() && !(event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]"))) {
					const drag = this.buildingGesture;
					if (drag?.active) {
						event.preventDefault(); drag.facing = ((drag.facing + 1) % 4) as 0 | 1 | 2 | 3;
						this.buildingGhost.clear(); paintIsometricRoom(this.buildingGhost, drag.room.column, drag.room.row, { ...drag.room, facing: drag.facing });
						this.moveBuildingDrag(drag.clientX, drag.clientY);
					}
				}
				if (event.code === "Space" && this.cameraAllowed() && (document.activeElement === canvas || parent.contains(document.activeElement)) && !(event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true],button"))) {
					event.preventDefault(); this.spacePressed = true; this.applyCamera();
				}
			}, options);
			window.addEventListener("keyup", (event) => { if (event.code === "Space" && this.spacePressed) { this.spacePressed = false; this.cancelPan(); this.applyCamera(); } }, options);
			window.addEventListener("blur", () => { this.cancelScavDrag(); this.cancelBuildingDrag(); this.cancelCameraGesture(); }, options);
			window.addEventListener("resize", () => { this.cancelScavDrag(); this.cancelBuildingDrag(); this.cancelCameraGesture(); }, options);
			document.addEventListener("visibilitychange", () => { if (document.hidden) { this.cancelScavDrag(); this.cancelBuildingDrag(); this.cancelCameraGesture(); } }, options);
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
			this.terrain = this.add.graphics().setDepth(-1_000_000_000); this.baseLayer.add(this.terrain);
			this.atmosphereGround = this.add.graphics().setDepth(-999_999_998);
			this.atmosphereGlows = this.add.graphics().setDepth(999_999).setBlendMode(Phaser.BlendModes.ADD);
			this.atmosphereAir = this.add.graphics().setDepth(1_000_002);
			this.baseLayer.add([this.atmosphereGround, this.atmosphereGlows, this.atmosphereAir]);
			this.ambient = this.add.graphics().setDepth(1_000_000); this.baseLayer.add(this.ambient);
			this.dragGhost = this.add.graphics().setDepth(100_000_000); this.baseLayer.add(this.dragGhost);
			this.placementGhost = this.add.graphics().setDepth(100_000_002); this.baseLayer.add(this.placementGhost);
			this.buildingGhost = this.add.graphics().setDepth(100_000_001).setVisible(false); this.baseLayer.add(this.buildingGhost);
			this.baseCaption = this.text(29, 27, "ТЕРРИТОРИЯ БАЗЫ 07", 15, "#ded2ae").setVisible(false);
			this.shelterCaption = this.text(29, 477, "ПОСТРОЙКИ · ДВОР · ПРОИЗВОДСТВО", 10, "#abb69c").setVisible(false);
			this.baseLayer.add([this.baseCaption, this.shelterCaption]);
			this.syncShelterLayout(snapshot());
		}

		private syncShelterLayout(state: WorldSnapshot): void {
			const shelter = state.shelter ?? { rooms: [] }, sites = getShelterSites(shelter);
			const frontier = getShelterFrontier(shelter), expansions = shelter.expansions ?? [];
			const all = [...sites, ...frontier, ...expansions];
			const buildings = roomBuildings(shelter.rooms);
			const signature = `${sites.map((p) => `${p.column}:${p.row}`).join(";")}|${expansions.map((p) => `${p.column}:${p.row}`).join(";")}|${shelter.rooms.map((room) => `${room.id}:${room.type}:${room.status}:${getRoomPosition(room).x}:${getRoomPosition(room).y}:${room.rotation ?? 0}:${getRoomFacing(room)}`).join(";")}`;
			if (signature === this.layoutSignature) return;
			const first = !this.layoutSignature; this.layoutSignature = signature;
			this.worldBounds = getShelterWorldBounds(sites, [...frontier, ...expansions]);
			this.viewCamera = first ? shelterOverviewCamera(this.viewport, this.worldBounds) : clampShelterCamera(this.viewCamera, this.viewport, this.worldBounds);
			const keys = new Set(all.map((p) => `${p.column}:${p.row}`));
			for (const room of shelter.rooms) keys.add(roomCellKey(room.id));
			for (const [key, cell] of this.cells) if (!keys.has(key)) { cell.root.destroy(true); cell.chrome.destroy(true); cell.zone.destroy(); this.cells.delete(key); }
			for (const p of all) if (!this.cells.has(`${p.column}:${p.row}`)) this.createCell(p.column, p.row);
			for (const room of shelter.rooms) if (!this.cells.has(roomCellKey(room.id))) this.createCell(room.column, room.row, room);
			const landscape = getShelterLandscape(sites, buildings, expansions);
			this.landscape = landscape; this.lastAtmospherePaint = -1000; this.lastWindPaint = -1000;
			this.smokeEmitters = []; this.atmosphereLights = []; this.windProps = [];
			for (const room of shelter.rooms) if (room.status === "ready") {
				const chimney = getShelterChimney(room);
				if (chimney && ["workshop", "medbay", "dormitory"].includes(room.type)) this.smokeEmitters.push({ ...projectShelterPoint(chimney.point), height: chimney.height, kind: "chimney", strength: .65 });
				const light = getShelterPorchLamp(room);
				this.atmosphereLights.push({ ...projectShelterPoint(light.point), kind: "lamp", height: light.height });
			}
			for (const slot of this.scavs.values()) if (!slot.assignment) { slot.routine = null; slot.goal = ""; slot.route = []; slot.dwellUntil = 0; }
			const g = this.terrain; g.clear();
			paintShelterLandscape(g, landscape, this.worldBounds);
			for (const prop of this.exteriorProps) prop.destroy(); this.exteriorProps = [];
			for (const decoration of landscape.decorations) {
				const art = this.add.graphics().setDepth(projectShelterPoint(decoration.point).y);
				paintShelterDecoration(art, decoration);
				this.baseLayer.add(art); this.exteriorProps.push(art);
				if (["tree", "bush", "fern"].includes(decoration.kind)) this.windProps.push({ art, decoration });
				const point = projectShelterPoint(decoration.point);
				if (decoration.kind === "camp") {
					this.smokeEmitters.push({ ...point, kind: "fire", height: 7 });
					this.atmosphereLights.push({ ...point, kind: "fire", height: 4 });
				} else if (decoration.kind === "lamp") this.atmosphereLights.push({ x: point.x + 7, y: point.y, kind: "lamp", height: 30 });
			}
			for (const fence of this.perimeterFences) fence.destroy(); this.perimeterFences = [];
			for (const edge of landscape.perimeter) {
				const start = projectShelterPoint(edge.from), end = projectShelterPoint(edge.to), height = 19;
				const panels = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 38));
				const rear = edge.side === "north" || edge.side === "west";
				// Each connected panel has a local depth so a long perimeter cannot cross a cabin or worker.
				for (let i = 0; i < panels; i++) {
					const logicalPoint = (fraction: number) => ({ x: edge.from.x + (edge.to.x - edge.from.x) * fraction, y: edge.from.y + (edge.to.y - edge.from.y) * fraction });
					const from = logicalPoint(i / panels), to = logicalPoint((i + 1) / panels);
					const aa = projectShelterPoint(from), bb = projectShelterPoint(to), groundDepth = (aa.y + bb.y) / 2;
					let depth = rear ? groundDepth - 35 : groundDepth;
					if (rear) for (const building of buildings) {
						const rect = getShelterBuildingRect(building);
						const adjacent = edge.side === "north"
							? Math.abs(rect.y - 16 - from.y) < .001 && to.x > rect.x - 5 && from.x < rect.x + rect.width + 5
							: Math.abs(rect.x - 10 - from.x) < .001 && to.y > rect.y - 5 && from.y < rect.y + rect.height + 5;
						if (adjacent) depth = Math.min(depth, projectShelterPoint({ x: rect.x + rect.width / 2, y: rect.y + 18 }).y - 20.1);
					}
					const fence = this.add.graphics().setDepth(depth);
					this.baseLayer.add(fence); this.perimeterFences.push(fence);
					polygon(fence, [aa, bb, { x: bb.x, y: bb.y - height }, { x: aa.x, y: aa.y - height }], 0x5c705e, .15);
					for (const lift of [3, height]) line(fence, [{ x: aa.x, y: aa.y - lift }, { x: bb.x, y: bb.y - lift }], 0xa5ad87, 1.3, .75);
					for (const at of [aa, ...(i === panels - 1 ? [bb] : [])]) {
						line(fence, [{ x: at.x, y: at.y + 1 }, { x: at.x, y: at.y - height - 2 }], 0x536852, 2.4, .9);
						line(fence, [{ x: at.x - 1, y: at.y - height - 2 }, { x: at.x + 1, y: at.y - height - 2 }], 0xa0ac8b, 2, .9);
					}
					line(fence, [{ x: aa.x, y: aa.y - 5 }, { x: bb.x, y: bb.y - height + 4 }], 0x91a180, .6, .32);
					line(fence, [{ x: aa.x, y: aa.y - height + 4 }, { x: bb.x, y: bb.y - 5 }], 0x91a180, .6, .32);
				}
			}
			const street = projectShelterPoint({ x: 390, y: 52 });
			this.baseCaption.setPosition(street.x, street.y - 24).setOrigin(.5).setText("УЛИЦА · ВЫХОД В РЕЙД").setFontSize(9).setAlpha(.65).setVisible(true).setDepth(10_000_000);
			this.applyCamera();
			this.paintBuildingPlacement();
		}

		private createCell(column: number, row: number, room?: RoomInstance): void {
			const p = cellPosition(column, row);
			const lot = { x: p.x - 10, y: p.y - 16, width: 192, height: 132 };
			const corners = [{ x: lot.x, y: lot.y }, { x: lot.x + lot.width, y: lot.y }, { x: lot.x + lot.width, y: lot.y + lot.height }, { x: lot.x, y: lot.y + lot.height }].map(projectShelterPoint);
			const at = projectShelterPoint({ x: p.x + 86, y: p.y + 18 });
			const front = projectShelterPoint({ x: p.x + 86, y: p.y + 93 });
			const art = this.add.graphics(), frame = this.add.graphics(), progress = this.add.graphics(), animation = this.add.graphics();
			const label = this.text(at.x, at.y - 23, "", 11, "#fff0d6").setOrigin(.5, 0).setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setBackgroundColor("#11251ee8").setPadding(4, 2);
			const status = this.text(front.x, front.y - 4, "", 8, "#c1d8bd").setOrigin(.5).setFontFamily("Manrope, sans-serif").setLetterSpacing(0).setBackgroundColor("#10221ded").setPadding(3, 2);
			const productLabel = this.text(at.x, at.y - 39, "", 9, "#f4e4bb").setOrigin(.5).setLetterSpacing(0).setBackgroundColor("#10231e").setPadding(4, 2).setVisible(false);
			const feedback = this.text(front.x, front.y - 23, "", 12, "#e6ffce").setOrigin(.5).setLetterSpacing(0).setBackgroundColor("#163023").setPadding(5, 3).setVisible(false);
			const lamp = this.add.image(at.x, at.y + 5, "prapor-light").setScale(.30, .18).setAlpha(.08).setBlendMode(Phaser.BlendModes.ADD);
			const bounds = projectShelterBounds(lot);
			const zone = this.add.zone(bounds.x, bounds.y, bounds.width, bounds.height).setOrigin(0);
			zone.setInteractive(new Phaser.Geom.Polygon(corners.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }))), Phaser.Geom.Polygon.Contains);
			zone.input!.cursor = "pointer";
			const root = this.add.container(0, 0, [art, lamp, animation, frame, progress]).setDepth(at.y - 20);
			const chrome = this.add.container(0, 0, [label, status, productLabel, feedback]).setDepth(10_000_000);
			this.baseLayer.add([root, chrome, zone.setDepth(-100_000_000)]);
			const cell: ShelterCell = { root, chrome, open: false, expansion: null, art, frame, progress, animation, stationClock: 0, stationJob: null, production: null, productLabel, label, status, lamp, zone, signature: "", column, row, hovered: false, room: room ?? null, roomId: room?.id, working: false, operational: "empty", feedback, lastCycles: null, completedAt: -10000 };
			this.cells.set(room ? roomCellKey(room.id) : `${column}:${row}`, cell);
			zone.on("pointerover", (pointer: Phaser.Input.Pointer) => { if (this.acceptsPointer(pointer, "base")) { cell.hovered = true; for (const candidate of this.cells.values()) if (candidate === cell || candidate.room?.id === cell.room?.id) this.paintCellFrame(candidate); if (!this.buildingPlacement) this.describeCell(cell); } });
			zone.on("pointerout", () => { cell.hovered = false; for (const candidate of this.cells.values()) if (candidate === cell || candidate.room?.id === cell.room?.id) this.paintCellFrame(candidate); interactions.onHover?.(null); });
			// Taps and building drags share native pointer-up, so opening an inspector
			// cannot replace the scene beneath a held pointer.
		}

		private describeCell(cell: ShelterCell): void {
			if (cell.room) {
				const room = cell.room, production = this.viewState?.roomProduction?.[room.id];
				const eta = production?.remainingSeconds != null ? ` · ${Math.ceil(production.remainingSeconds)} с` : "";
				interactions.onHover?.({ title: `${ROOM_DEFINITIONS[room.type].label} · ур. ${room.level || 1}`,
						detail: `${room.workerIds.length}/${getRoomWorkerCapacity(room)} работников · ${production?.reason ?? production?.status ?? "На базе"}${eta}` });
			} else if (cell.expansion) {
				interactions.onHover?.({ title: "Расширяем территорию", detail: `${Math.ceil((cell.expansion.workRequired - cell.expansion.workDone) / 1_000_000)} с до нового участка` });
			} else interactions.onHover?.(cell.open ? { title: "Свободная земля", detail: "Выбери место для новой постройки или переноса" } : { title: "Земля за оградой", detail: "Присоединить: 60 ₽ и 2 детали · новый участок за 20 с" });
		}

		private paintCellFrame(cell: ShelterCell): void {
			cell.frame.clear();
			const state = snapshot(), corners = cellPolygon(cell);
			const hovered = cell.hovered || Boolean(cell.room && [...this.cells.values()].some((candidate) => candidate.room?.id === cell.room?.id && candidate.hovered));
			const selected = Boolean(cell.room ? state.selectedRoomId === cell.room.id : state.selectedSite?.column === cell.column && state.selectedSite.row === cell.row);
			const building = cell.room && cell.room.status !== "ready";
			// Open ground has no fixed placement markers; only actual buildings get outlines.
			if (!cell.room) {
				cell.label.setVisible(Boolean(cell.expansion && (hovered || selected)));
				cell.status.setVisible(Boolean(cell.expansion && (hovered || selected)));
				return;
			}
			let tint = selected || hovered ? C.light : building ? C.gold : cell.room ? ROOM_STYLE[cell.room.type]?.color ?? 0x899a7c : 0x788b71;
			cell.label.setAlpha(cell.room || selected || hovered ? 1 : .6).setVisible(Boolean(cell.room || selected || hovered || cell.expansion));
			cell.status.setVisible(Boolean(cell.expansion || selected || hovered || cell.working || building));
			cell.status.setAlpha(selected || hovered || cell.working || building ? 1 : .5);
			if (this.drag) {
				const reason = cell.room ? this.assignmentReason(this.drag.scavId, cell.room.id) : "Сначала построй комнату";
				const target = cell.room ? this.drag.roomId === cell.room.id : this.drag.cellKey === `${cell.column}:${cell.row}`; tint = reason ? 0xcc7f6d : 0xa6d193;
				polygon(cell.frame, corners, tint, target ? .23 : .07);
				line(cell.frame, [...corners, corners[0]!], tint, target ? 3 : 1.3, target ? 1 : .65); return;
			}
			if (!selected && !hovered) return;
			polygon(cell.frame, corners, tint, selected ? .08 : .04);
			line(cell.frame, [...corners, corners[0]!], tint, selected ? 1.8 : 1, selected ? .7 : .4);
		}

		private paintRoom(cell: ShelterCell): void {
			cell.art.clear();
			if (cell.room) paintIsometricRoom(cell.art, cell.column, cell.row, cell.room);
			else if (cell.expansion) {
				const p = cellPosition(cell.column, cell.row), at = projectShelterPoint({ x: p.x + 86, y: p.y + 50 });
				cell.art.fillStyle(0xb19767, .18).fillEllipse(at.x, at.y, 82, 30);
				for (const offset of [-26, 26]) {
					line(cell.art, [{ x: at.x + offset, y: at.y + 4 }, { x: at.x + offset, y: at.y - 13 }], 0xb79458, 2);
				}
				line(cell.art, [{ x: at.x - 26, y: at.y - 8 }, { x: at.x + 26, y: at.y - 8 }], 0xe4bf6f, 2, .8);
			}
			const style = ROOM_STYLE[cell.room?.type ?? "workshop"]!;
			cell.label.setText(cell.room ? `${style.label} · ${cell.room.level || ""}` : cell.open ? "СВОБОДНАЯ ЗЕМЛЯ" : cell.expansion ? "РАСШИРЕНИЕ" : "ЗА ОГРАДОЙ").setFontSize(cell.room ? 11 : 9).setColor(cell.room ? "#fff1dc" : "#afc0a4");
			cell.status.setText(cell.room ? "" : cell.open ? "+ ПОСТРОИТЬ" : cell.expansion ? "ИДУТ РАБОТЫ" : "ПРИСОЕДИНИТЬ →");
			cell.lamp.setVisible(Boolean(cell.room)).setTint(style.light);
		}

		private positionCellChrome(cell: ShelterCell): void {
			const rect = cell.room ? roomRect(cell.room) : shelterRoomRect(cell.column, cell.row);
			const at = projectShelterPoint({ x: rect.x + rect.width / 2, y: rect.y + 18 });
			const front = projectShelterPoint(cell.room ? getRoomEntrance(cell.room, 7) : { x: rect.x + rect.width / 2, y: rect.y + rect.height - 7 });
			cell.label.setPosition(at.x, at.y - 43); cell.status.setPosition(front.x, front.y - 4);
			cell.productLabel.setPosition(at.x, at.y - 63); cell.feedback.setPosition(front.x, front.y - 23);
			cell.lamp.setPosition(at.x, at.y + 5); cell.root.setDepth(cell.room ? shelterBuildingDepth(rect) : -999_999_999);
			if (cell.room) {
				const hit = shelterBuildingHitPolygon(rect);
				const x = Math.min(...hit.map((point) => point.x)), y = Math.min(...hit.map((point) => point.y));
				const width = Math.max(...hit.map((point) => point.x)) - x, height = Math.max(...hit.map((point) => point.y)) - y;
				cell.zone.setPosition(x, y).setSize(width, height).setDepth(cell.root.depth + .1);
				cell.zone.setInteractive(new Phaser.Geom.Polygon(hit.map((point) => ({ x: point.x - x, y: point.y - y }))), Phaser.Geom.Polygon.Contains);
				cell.zone.input!.cursor = cell.room.status === "ready" ? "grab" : "pointer";
			}
		}

		private clickFeedback(at: Point, layer: Phaser.GameObjects.Container): void {
			const ring = this.add.circle(at.x, at.y, 15).setStrokeStyle(2, C.light, .85).setDepth(100_000_001);
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
			const tool = this.add.graphics().setPosition(6, -21);
			const scav = snapshot().scavs?.find((candidate) => candidate.id === scavId);
			const requestedAppearance = scavAppearance(scav?.personality, index, scav?.appearance);
			const appearance = scavAvailableAppearance(requestedAppearance, (texture) => this.textures.exists(texture));
			const texture = scavTexture(appearance);
			const atlasData = this.textures.get(texture).customData as { meta?: { characterHeight?: number } };
			const characterHeight = Number(atlasData.meta?.characterHeight) || SCAV_REFERENCE_HEIGHT;
			const makePose = (pose: ScavPose) => this.add.image(0, 0, texture, scavFrame(pose, "se")).setOrigin(SCAV_ORIGIN.x, SCAV_ORIGIN.y).setScale(48 / characterHeight);
			const poses = this.textures.exists(texture) ? { idle: makePose("idle"), walkA: makePose("walk-a").setVisible(false), walkB: makePose("walk-b").setVisible(false), work: makePose("work").setVisible(false) } : null;
			const sprite = poses?.idle ?? null;
			if (sprite) { legA.setVisible(false); legB.setVisible(false); graphic.setVisible(false); hand.setVisible(false); tool.setPosition(13, -21); }
			body.add([legA, legB, graphic, ...(poses ? [poses.idle, poses.walkA, poses.walkB, poses.work] : []), hand, tool]);
			const equipment = new ScavEquipment(this, body);
			const visualLoadout = getScavVisualLoadout(scav ?? {}, snapshot().gearItems ?? [], snapshot().weapons ?? []);
			equipment.update(visualLoadout, "se", { mode: "slung" });
			const label = this.text(0, -64, "", 16, "#ffedc7").setOrigin(.5).setFontFamily("Manrope, sans-serif").setFontStyle("bold").setLetterSpacing(0).setBackgroundColor("#0b1b20").setPadding(7, 4).setVisible(false);
			const order = this.add.circle(-10, -34, 3.5, C.sage).setStrokeStyle(1, 0x10242b).setVisible(false);
			const hit = this.add.zone(0, -21, 32, 46).setInteractive({ useHandCursor: true });
			const slot: ScavActor = { actor, body, legA, legB, hand, sprite, poses, animation: createScavAnimation(index * .37), appearance, direction: "se", equipment, visualLoadout, tool, label, order, selection, hovered: false, gearSignature: "", routine: null, position: { ...at }, anchor: { ...at }, route: [], goal: "", assignment: null, role: "idle", dwellUntil: this.time.now + 2000 + index * 800, visit: 0, facing: 1, climbing: false, status: "ready", health: 100, working: false, walking: false, walkSpan: 0, phase: index * 1.71 };
			hit.on("pointerover", (pointer: Phaser.Input.Pointer) => { if (this.acceptsPointer(pointer, "base")) { slot.hovered = true; selection.setVisible(true); label.setVisible(true); actor.setDepth(1_000_001); } });
			hit.on("pointerout", () => { slot.hovered = false; const selected = snapshot().selectedScavId === scavId; selection.setVisible(selected); label.setVisible(selected); actor.setDepth(actor.y); });
			// Native pointer-up distinguishes a deliberate tap from a drag before opening the inspector.
			actor.add([shadow, selection, body, label, order, hit]);
			this.baseLayer.add(actor);
			this.scavs.set(scavId, slot);
			return slot;
		}

		private setScavAppearance(slot: ScavActor, appearance: number): void {
			if (slot.appearance === appearance || !slot.poses) return;
			const texture = scavTexture(appearance);
			const atlasData = this.textures.get(texture).customData as { meta?: { characterHeight?: number } };
			const height = Number(atlasData.meta?.characterHeight) || SCAV_REFERENCE_HEIGHT;
			for (const [key, pose] of [["idle", "idle"], ["walkA", "walk-a"], ["walkB", "walk-b"], ["work", "work"]] as const) {
				slot.poses[key].setTexture(texture, scavFrame(pose, slot.direction)).setOrigin(SCAV_ORIGIN.x, SCAV_ORIGIN.y).setScale(48 / height);
			}
			slot.appearance = appearance;
		}

		private syncShelter(state: WorldSnapshot): void {
			if (this.viewState && (state.identityKey !== this.viewState.identityKey || !state.identityKey && state.shelter !== this.viewState.shelter)) {
				this.cancelScavDrag(); this.cancelBuildingDrag(); this.cancelCameraGesture();
				this.raidStreet?.reset();
				for (const slot of this.scavs.values()) slot.actor.destroy(true);
				this.scavs.clear();
				for (const cell of this.cells.values()) { cell.lastCycles = null; cell.completedAt = -10000; cell.feedback.setVisible(false); }
			}
			this.viewState = state;
			this.syncShelterLayout(state);
			const rooms = state.shelter?.rooms ?? [];
			let workingRooms = 0;
			for (const cell of this.cells.values()) {
				const room = cell.roomId ? rooms.find((candidate) => candidate.id === cell.roomId) ?? null : null;
				if (cell.room?.id !== room?.id) { cell.lastCycles = null; cell.completedAt = -10000; cell.feedback.setVisible(false); }
				cell.room = room;
				cell.root.setVisible(true); cell.chrome.setVisible(true);
				cell.open = Boolean(room) || getShelterSites(state.shelter ?? { rooms: [] }).some((p) => p.column === cell.column && p.row === cell.row);
				cell.expansion = cell.roomId ? null : state.shelter?.expansions?.find((p) => p.column === cell.column && p.row === cell.row) ?? null;
				const production = room ? state.roomProduction?.[room.id] : undefined;
				cell.production = room ? getShelterProductionPresentation(room, production ?? null) : null;
				if (cell.stationJob !== cell.production?.jobId) { cell.stationClock = 0; cell.stationJob = cell.production?.jobId ?? null; }
				const productName = cell.production?.jobId ? cell.production.productName : "";
				cell.productLabel.setText(productName.length > 29 ? `${productName.slice(0, 28)}…` : productName);
				cell.working = Boolean(room?.status === "ready" && room.queue.length && room.workerIds.length && production?.rate && !production.reason);
				cell.operational = !room ? "empty" : room.status !== "ready" ? "building" : !ROOM_DEFINITIONS[room.type].production ? "passive" : cell.working ? "working" : production?.reason || room.queue.length ? "blocked" : "idle";
				if (cell.working) workingRooms++;
				const signature = room ? `${room.id}:${getRoomPosition(room).x}:${getRoomPosition(room).y}:${room.rotation ?? 0}:${getRoomFacing(room)}:${room.type}:${room.level}:${room.status}` : `${cell.open}:${Boolean(cell.expansion)}`;
				if (cell.signature !== signature) { cell.signature = signature; this.positionCellChrome(cell); this.paintRoom(cell); }
				this.paintCellFrame(cell);
				if (cell.hovered) this.describeCell(cell);
				cell.progress.clear();
				if (room) {
					if (cell.lastCycles !== null && room.cycles > cell.lastCycles) {
						cell.completedAt = this.time.now;
						cell.feedback.setText(`+${room.cycles - cell.lastCycles} ПАРТИЯ`).setVisible(true).setAlpha(1);
					}
					cell.lastCycles = room.cycles;
					const construction = room.construction;
					const progress = construction ? construction.workDone / Math.max(1, construction.workRequired) : production?.progress ?? 0;
					const color = construction ? 0xf6c58b : cell.operational === "blocked" ? 0xe9ad7f : 0xb2d692;
					const rect = roomRect(room), badge = projectShelterPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height - 7 });
					cell.progress.fillStyle(0x071710).fillRect(badge.x - 35, badge.y + 4, 70, 3);
					cell.progress.fillStyle(color, .95).fillRect(badge.x - 35, badge.y + 4, Phaser.Math.Clamp(progress, 0, 1) * 70, 3);
					const reason = production?.reason?.toLocaleLowerCase("ru-RU") ?? "";
					const briefReason = reason.includes("склад") || reason.includes("мест") ? "СКЛАД ПОЛОН" : reason.includes("рабоч") ? "НУЖЕН РАБОЧИЙ" : reason.includes("нужно") ? "НУЖНЫ РЕСУРСЫ" : production?.reason ?? "";
					const status = construction ? `СТРОЙКА ${Math.floor(progress * 100)}%` : room.type === "storage" ? "ЗАПАСЫ" : room.type === "dormitory" ? "МЕСТА ОТРЯДА" : room.type === "hangar" ? "БОЛЬШИЕ ЗАПАСЫ" : cell.working ? `${Math.floor((cell.production?.progress ?? 0) * 100)}% · ${cell.production?.stageLabel ?? "Сборка"}` : production?.reason ? briefReason : !room.workerIds.length ? "НУЖЕН РАБОЧИЙ" : production?.status === "Нет заказа" ? "БЕЗ ЗАКАЗА" : "ЖДЁТ ПАРТИЮ";
					const clippedStatus = `${status.toLocaleUpperCase("ru-RU").slice(0, 17)}${status.length > 17 ? "…" : ""}`;
					cell.status.setText(clippedStatus).setColor(construction ? "#ffd399" : cell.working ? "#d1efb0" : cell.operational === "blocked" ? "#edc294" : "#c1cbbc");
					cell.lamp.setAlpha(construction ? .1 : cell.working ? .18 : .06);
				}
			}
			this.baseCaption.setText("УЛИЦА · ВЫХОД В РЕЙД");
			this.shelterCaption.setText(`${rooms.length} ПОСТРОЕК · ${workingRooms} ПРОИЗВОДЯТ · ${rooms.filter((room) => room.status !== "ready").length} СТРОЯТСЯ`);
			this.paintBuildingPlacement();
			this.syncPeople(state);
			this.baseLayer.sort("depth");
		}

		private homePosition(rank: number, count: number): Point {
			const shelter = this.viewState?.shelter ?? { rooms: [] }, sites = getShelterSites(shelter);
			const free = getShelterOpenGroundPoints(sites, roomBuildings(shelter.rooms));
			if (free.length) {
				return { ...free[rank % free.length]! };
			}
			const paths = getShelterCorridorSegments(sites, roomBuildings(shelter.rooms)).filter(({ from, to }) => from.y > 132 && to.y > 132);
			const segment = paths[rank % Math.max(1, paths.length)];
			if (segment) { const ratio = (rank + 1) / (count + 1); return { x: segment.from.x + (segment.to.x - segment.from.x) * ratio, y: segment.from.y + (segment.to.y - segment.from.y) * ratio }; }
			return { x: 318, y: 132 };
		}

		private placeActor(slot: ScavActor, at: Point): void {
			slot.position = { ...at };
			const visual = projectShelterPoint(at);
			slot.actor.setPosition(visual.x, visual.y).setDepth(slot.hovered ? 1_000_001 : visual.y);
		}

		private sendActor(slot: ScavActor, goal: string, at: Point): void {
			if (slot.goal === goal && Math.hypot(slot.anchor.x - at.x, slot.anchor.y - at.y) < 1) return;
			slot.goal = goal; slot.anchor = { ...at };
			slot.route = reducedMotion ? [] : getShelterWalkingRoute(slot.position, at, getShelterSites(this.viewState?.shelter ?? { rooms: [] }), roomBuildings(this.viewState?.shelter?.rooms ?? []));
			if (reducedMotion) this.placeActor(slot, at);
			slot.working = false;
		}

		private syncPeople(state: WorldSnapshot): void {
			const people = state.scavs ?? [], rooms = state.shelter?.rooms ?? [];
			const alive = new Set(people.map((scav) => scav.id));
			for (const [id, slot] of this.scavs) if (!alive.has(id)) { if (this.drag?.scavId === id) this.cancelScavDrag(); slot.actor.destroy(true); this.scavs.delete(id); }
			const free = people.filter((scav) => scav.status !== "raiding" && !rooms.some((room) => room.id === scav.assignment && room.workerIds.includes(scav.id)));
			people.forEach((scav, index) => {
				const requestedAppearance = scavAppearance(scav.personality, index, scav.appearance);
				this.requestScavAtlas(requestedAppearance);
				const room = rooms.find((candidate) => candidate.id === scav.assignment && candidate.workerIds.includes(scav.id));
				const production = room ? state.roomProduction?.[room.id] : undefined;
				const presentation = room ? this.cells.get(roomCellKey(room.id))?.production ?? null : null;
				const rank = Math.max(0, room?.workerIds.indexOf(scav.id) ?? 0);
				const station = room?.type === "workshop" && presentation?.active ? presentation.stage === "assembly" ? 104 : 51 : 86;
				const at = room ? getRoomLocalPoint(room, station + rank * 24, 80) : this.homePosition(Math.max(0, free.indexOf(scav)), free.length);
				const slot = this.scavs.get(scav.id) ?? this.createScav(scav.id, index, at);
				this.setScavAppearance(slot, scavAvailableAppearance(requestedAppearance, (texture) => this.textures.exists(texture)));
				slot.visualLoadout = getScavVisualLoadout(scav, state.gearItems ?? [], state.weapons ?? []);
				const torso = scavTorsoAnchor(Object.values(slot.poses ?? {}).map((image) => ({ weight: image.visible ? image.alpha : 0, torso: (image.frame.customData as { custom?: { torso?: Point } }).custom?.torso })));
				const head = scavHeadAnchor(Object.values(slot.poses ?? {}).map((image) => ({ weight: image.visible ? image.alpha : 0, head: (image.frame.customData as { custom?: { head?: Point } }).custom?.head })));
				slot.equipment.update(slot.visualLoadout, slot.direction, { working: slot.working, mode: "slung", bodyAngle: slot.body.angle, torso, head });
				const previousStatus = slot.status, previousAssignment = slot.assignment;
				slot.assignment = room?.id ?? null; slot.status = scav.status; slot.health = scav.health;
				if (room || scav.status !== "ready") slot.routine = null;
				if (this.drag?.scavId === scav.id && (scav.status === "raiding" || scav.health < 25 || this.drag.shelter !== state.shelter || this.drag.scav !== scav)) this.cancelScavDrag();
				if (scav.status === "raiding") {
					if (previousStatus !== "raiding") { this.sendActor(slot, "depart", { x: 318, y: 102 }); slot.actor.setVisible(!reducedMotion); }
					if (!slot.route.length) slot.actor.setVisible(false);
					slot.working = false; slot.role = "depart"; return;
				}
				if (previousStatus === "raiding") this.placeActor(slot, { x: 318, y: 102 });
				slot.actor.setVisible(true).setScale(.78).setAlpha(this.drag?.scavId === scav.id ? .45 : scav.status === "wounded" ? .78 : 1);
				if (scav.status === "wounded" && (!room || scav.health < 25)) {
					const rest = rooms.find((candidate) => candidate.type === "medbay" && candidate.status === "ready") ?? rooms.find((candidate) => candidate.type === "dormitory" && candidate.status === "ready");
					this.sendActor(slot, `rest:${rest?.id ?? "entrance"}`, rest ? getRoomLocalPoint(rest, 35 + index % 3 * 20, 80) : at);
					slot.role = "rest";
				} else if (room) {
					// Workshop stages use real bench/lathe positions. Changing stage is
					// a short floor walk; pausing keeps the last station and route.
					if (presentation?.active || previousAssignment !== room.id || !slot.goal.startsWith(`work:${room.id}:`) || Math.hypot(slot.anchor.x - at.x, slot.anchor.y - at.y) > 1) this.sendActor(slot, `work:${room.id}:${rank}:${presentation?.active ? presentation.stage : "idle"}`, at);
					slot.role = room.type;
				} else if (!slot.goal || previousAssignment !== null || previousStatus !== "ready") {
					this.sendActor(slot, `idle-home:${index}`, at); slot.role = "idle";
				}
				slot.working = Boolean(room && !slot.route.length && scav.health >= 25 && presentation?.active);
				const selected = state.selectedScavId === scav.id;
				slot.selection.setVisible(selected || slot.hovered || this.drag?.scavId === scav.id).setStrokeStyle(1.5, selected ? C.light : C.gold);
				const activities: Record<string, string> = { workshop: "СОБИРАЕТ ДЕТАЛИ", ammo: "СНАРЯЖАЕТ ПАТРОНЫ", recycler: "СОРТИРУЕТ УТИЛЬ", medbay: "ГОТОВИТ МЕДИКАМЕНТЫ", radio: "РАБОТАЕТ В ЭФИРЕ" };
				const activity = slot.role === "rest" ? slot.route.length ? "ИДЁТ ОТДЫХАТЬ" : "ВОССТАНАВЛИВАЕТСЯ" : slot.route.length ? room ? `ИДЁТ: ${ROOM_STYLE[room.type]?.label ?? "КОМНАТА"}` : "ИДЁТ ПО ДВОРУ" : slot.working ? room?.type === "workshop" ? presentation?.stageLabel.toLocaleUpperCase("ru-RU") ?? "РАБОТАЕТ" : activities[slot.role] ?? "РАБОТАЕТ" : room ? production?.reason?.toLocaleUpperCase("ru-RU").slice(0, 24) ?? "ЖДЁТ ЗАКАЗ" : slot.routine?.label.toLocaleUpperCase("ru-RU") ?? "НА БАЗЕ";
				slot.label.setText(`${scav.name?.toLocaleUpperCase("ru-RU") ?? ""}\n${activity}`).setVisible(selected || slot.hovered);
				slot.order.setVisible(Boolean(scav.autoRaid?.enabled)).setFillStyle(scav.autoRaid?.waitingReason ? C.gold : C.sage);
				const gearSignature = `${slot.role}:${slot.routine?.activity ?? ""}`;
				if (slot.gearSignature !== gearSignature) {
					slot.gearSignature = gearSignature; slot.tool.clear();
					if (slot.role === "workshop") { line(slot.tool, [{ x: 1, y: 1 }, { x: 10, y: 1 }], 0xc6cbb6, 2); slot.tool.lineStyle(1.3, 0xd4d5ba).strokeCircle(11, 1, 2.3); }
					if (slot.role === "ammo") slot.tool.fillStyle(0xe7c577).fillRect(1, 0, 3, 8).fillStyle(0xffdfa0).fillRect(1, 0, 3, 1);
					if (slot.role === "recycler") { line(slot.tool, [{ x: 1, y: 0 }, { x: 2, y: 9 }], 0xd5bb92, 2); slot.tool.fillStyle(0x9dac9b).fillRect(-2, 8, 8, 3); }
					if (slot.role === "medbay") slot.tool.fillStyle(0xd8ebe0).fillRect(0, 1, 5, 7).fillStyle(0x98cabc).fillRect(1, -1, 3, 2);
					if (slot.role === "radio") slot.tool.fillStyle(0xbdc9a6).fillRect(-1, 0, 6, 7).fillStyle(0x659789).fillRect(0, 1, 4, 3);
					if (slot.role === "idle" && slot.routine && ["warm", "rest", "chat"].includes(slot.routine.activity)) {
						slot.tool.fillStyle(0x4b6559).fillRoundedRect(0, 0, 5, 5, 1).lineStyle(.7, 0xd9cbb0).strokeEllipse(2.5, 0, 5, 1.7).strokeCircle(5, 2, 1.5);
					}
				}
			});
		}

		private patrolActor(slot: ScavActor, id: string, time: number): void {
			if (slot.assignment || slot.status !== "ready" || slot.route.length || time < slot.dwellUntil || reducedMotion) return;
			const state = this.viewState;
			slot.visit++;
			const person = state?.scavs?.find(scav => scav.id === id);
			const routine = getShelterRoutine({ scavId: id, personality: person?.personality, visit: slot.visit, from: slot.position,
				sites: getShelterSites(state?.shelter ?? { rooms: [] }), buildings: roomBuildings(state?.shelter?.rooms ?? []), decorations: this.landscape?.decorations ?? [],
					reservedTargets: [...this.scavs.values()].filter(other => other !== slot && other.actor.visible && !other.assignment && other.status === "ready").map(other => other.anchor) });
			slot.routine = routine; slot.role = "idle";
			if (routine) this.sendActor(slot, `routine:${slot.visit}:${routine.activity}`, routine.point);
			slot.dwellUntil = time + (routine?.dwellMs ?? 7000);
		}

		private animateAtmosphere(time: number): void {
			if (!this.landscape || !this.atmosphereAir) return;
			if (reducedMotion && this.lastAtmospherePaint >= 0) return;
			if (time - this.lastWindPaint >= 83) {
				this.lastWindPaint = time;
				const wind = sampleShelterWind(time, reducedMotion);
				for (const { art, decoration } of this.windProps) {
					art.clear(); paintShelterDecoration(art, decoration, wind.sway * (1.1 + decoration.seed % 5 * .1));
				}
			}
			if (time - this.lastAtmospherePaint < 50) return;
			this.lastAtmospherePaint = time;
			const frame = sampleShelterAtmosphere({ timeMs: time, groundBounds: this.worldBounds, smokeEmitters: this.smokeEmitters, lights: this.atmosphereLights,
				birdBounds: { x: this.worldBounds.x + 60, y: this.worldBounds.y + 25, width: Math.max(100, this.worldBounds.width - 120), height: 55 },
				mistZones: this.windProps.filter(prop => prop.decoration.kind === "tree" && !prop.decoration.owned).slice(-3).map(prop => {
					const at = projectShelterPoint(prop.decoration.point);
					return { x: at.x - 48, y: at.y - 12, width: 96, height: 20 };
				}), reducedMotion });
			this.atmosphereGround.clear(); paintShelterAtmosphereGround(this.atmosphereGround, frame);
			this.atmosphereAir.clear(); paintShelterAtmosphereAir(this.atmosphereAir, frame);
			this.atmosphereGlows.clear(); paintShelterAtmosphereGlows(this.atmosphereGlows, frame);
		}

		private animateShelter(time: number, delta: number): void {
			const step = Math.min(Math.max(delta, 0), 100) / 1000;
			this.animateAtmosphere(time);
			this.ambient.clear();
			for (const [id, slot] of this.scavs) {
				let walkedDistance = 0;
				if (slot.actor.visible && this.drag?.scavId !== id) {
					this.patrolActor(slot, id, time);
					const speed = slot.status === "wounded" ? 27 : 58;
					const next = slot.route[0];
					const hadRoute = slot.route.length > 0;
					const distance = next ? Math.hypot(next.x - slot.position.x, next.y - slot.position.y) : 0;
					const before = slot.position;
					const motion = advanceShelterRoute(slot.position, slot.route, Math.min(speed * step, distance));
					walkedDistance = Math.hypot(motion.point.x - slot.position.x, motion.point.y - slot.position.y);
					slot.route = motion.route;
					if (hadRoute) this.placeActor(slot, motion.point);
					slot.walking = hadRoute; slot.climbing = false;
					if (slot.walking && Math.abs(motion.point.x - before.x) > .001) slot.facing = motion.facing;
					if (walkedDistance > .001) {
						const previous = projectShelterPoint(before), current = projectShelterPoint(motion.point);
						slot.direction = scavDirection(current.x - previous.x, current.y - previous.y, slot.direction);
					}
					if (hadRoute && motion.arrived) { slot.dwellUntil = time + (slot.routine?.dwellMs ?? 6500 + (slot.phase % 4) * 1700); slot.walking = false; slot.climbing = false; if (slot.status === "raiding") slot.actor.setVisible(false); }
				} else { slot.walking = false; slot.climbing = false; }
				const room = this.viewState?.shelter?.rooms.find((candidate) => candidate.id === slot.assignment);
				const production = room ? this.viewState?.roomProduction?.[room.id] : undefined;
				const presentation = room ? this.cells.get(roomCellKey(room.id))?.production ?? null : null;
				slot.working = Boolean(slot.status !== "raiding" && slot.health >= 25 && !slot.route.length && this.drag?.scavId !== id && presentation?.active);
				if (slot.working && room) {
					slot.direction = (["ne", "se", "sw", "nw"] as const)[getRoomFacing(room)];
					slot.facing = slot.direction.endsWith("e") ? 1 : -1;
				}
				if (!slot.assignment && !slot.walking && slot.routine?.lookAt) {
					const from = projectShelterPoint(slot.position), to = projectShelterPoint(slot.routine.lookAt);
					slot.direction = scavDirection(to.x - from.x, to.y - from.y, slot.direction); slot.facing = slot.direction.endsWith("e") ? 1 : -1;
				}
				const animation = advanceScavAnimation(slot.animation, { distance: walkedDistance, elapsedMs: step * 1000, walking: slot.walking || walkedDistance > 0, working: slot.working, facing: slot.facing, role: slot.role, workDone: (room?.queue[0]?.workDone ?? 0) / 1_000_000, workRate: production?.rate ?? 0, jobId: presentation?.jobId ?? null, stage: presentation?.stage, stageProgress: presentation?.stageProgress, reducedMotion, paused: !slot.actor.visible || this.drag?.scavId === id });
				slot.animation = animation.state;
				const pose = animation.pose;
				if (slot.poses) for (const [key, frame] of [["idle", "idle"], ["walkA", "walk-a"], ["walkB", "walk-b"], ["work", "work"]] as const) {
					const image = slot.poses[key], nextFrame = scavFrame(frame, slot.direction);
					if (image.frame.name !== nextFrame) image.setFrame(nextFrame);
					image.setVisible(pose.weights[key] > .001).setAlpha(pose.weights[key]);
				}
				// All visual transforms pivot at the common feet baseline. Physics,
				// hit zones and drag coordinates use the same projected feet position.
				const relaxed = Boolean(slot.routine && !slot.walking && !slot.working && slot.status === "ready");
				const breath = relaxed && !reducedMotion ? Math.sin(time / 4300 * Math.PI * 2 + slot.phase) * .42 : 0;
				slot.body.setPosition(0, 0).setScale(slot.sprite ? 1 : pose.scaleX, pose.scaleY).setAngle(pose.angle * (slot.direction[1] === "e" ? 1 : -1) + breath);
				const torso = scavTorsoAnchor(Object.values(slot.poses ?? {}).map((image) => ({ weight: image.visible ? image.alpha : 0, torso: (image.frame.customData as { custom?: { torso?: Point } }).custom?.torso })));
				const head = scavHeadAnchor(Object.values(slot.poses ?? {}).map((image) => ({ weight: image.visible ? image.alpha : 0, head: (image.frame.customData as { custom?: { head?: Point } }).custom?.head })));
				slot.equipment.update(slot.visualLoadout, slot.direction, { working: slot.working, mode: "slung", bodyAngle: slot.body.angle, torso, head });
				const stride = (slot.animation.stride % 1) * Math.PI * 2;
				slot.legA.setAngle(Math.sin(stride) * 9 * slot.animation.walkBlend);
				slot.legB.setAngle(-Math.sin(stride) * 9 * slot.animation.walkBlend);
				slot.hand.setAngle(pose.handAngle);
				if (slot.sprite) {
					const idleProp = relaxed && slot.routine && ["warm", "rest", "chat"].includes(slot.routine.activity), hand = scavAttachment(slot.direction, slot.working);
					slot.tool.setPosition(hand.x + (slot.working ? pose.toolX - 13 : 0) * (hand.flipX ? -1 : 1), hand.y + (slot.working ? pose.toolY + 21 : 0)).setScale(hand.flipX ? -1 : 1, 1).setAngle(slot.working ? pose.toolAngle + (hand.behind ? -24 : 24) : 0).setVisible(slot.working || Boolean(idleProp));
					if (hand.behind) slot.body.sendToBack(slot.tool); else slot.body.bringToTop(slot.tool);
				} else slot.tool.setPosition(pose.toolX - 7, pose.toolY).setAngle(pose.toolAngle).setVisible(slot.working);
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
			for (const cell of this.cells.values()) {
				const g = cell.animation;
				g.clear();
				const selected = cell.room ? this.viewState?.selectedRoomId === cell.room.id : this.viewState?.selectedSite?.column === cell.column && this.viewState.selectedSite.row === cell.row;
				const hovered = cell.hovered || Boolean(cell.room && [...this.cells.values()].some((candidate) => candidate.room?.id === cell.room?.id && candidate.hovered));
				cell.status.setVisible(Boolean(cell.room) && this.viewCamera.zoom >= 1.4 || hovered || Boolean(selected) || Boolean(cell.expansion));
				const labelScale = 1 / Math.max(1, this.viewCamera.zoom / 1.8);
				cell.label.setScale(labelScale); cell.status.setScale(labelScale);
				cell.productLabel.setVisible(Boolean(cell.production?.jobId) && (this.viewCamera.zoom >= 1.6 || cell.hovered || this.viewState?.selectedRoomId === cell.room?.id));
				if (!cell.room) {
					if (cell.expansion) {
						const p = cellPosition(cell.column, cell.row), at = projectShelterPoint({ x: p.x + 86, y: p.y + 60 });
						const progress = cell.expansion.workDone / cell.expansion.workRequired;
						cell.status.setText(`РАСЧИЩАЕМ ${Math.floor(progress * 100)}%`);
						g.fillStyle(0xd8bd87).fillRect(at.x - 28, at.y + 12, 56 * progress, 3);
					}
					continue;
				}
				const elapsed = time - cell.completedAt, rect = roomRect(cell.room);
				const badge = projectShelterPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height - 7 });
				cell.feedback.setVisible(elapsed >= 0 && elapsed < 1800).setAlpha(reducedMotion ? 1 : Phaser.Math.Clamp(1 - elapsed / 1800, 0, 1)).setY(badge.y - 23 - (reducedMotion ? 0 : Math.max(0, elapsed) / 120));
				if (cell.working) cell.lamp.setAlpha(reducedMotion ? .18 : .16 + (Math.sin(time / 1300 + cell.column + cell.row) + 1) * .025);
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
			if (this.buildingGesture && (!this.buildingAllowed() || !this.buildingSourceCurrent(this.buildingGesture))) this.cancelBuildingDrag();
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
		getPresentationState: () => scene.getPresentationState(),
		restorePresentationState: (value) => scene.restorePresentationState(value),
		beginScavDrag: (id) => scene.beginScavDrag(id),
		moveScavDrag: (clientX, clientY) => scene.moveScavDrag(clientX, clientY),
		endScavDrag: () => scene.endScavDrag(),
		cancelScavDrag: () => scene.cancelScavDrag(),
		cancelBuildingDrag: () => scene.cancelBuildingDrag(),
		cancelCameraGesture: () => scene.cancelCameraGesture(),
		getCameraState: () => scene.getCameraState(),
		zoomBy: (factor, clientX, clientY) => scene.zoomBy(factor, clientX, clientY),
		panBy: (dx, dy) => scene.panBy(dx, dy),
		resetCamera: () => scene.resetCamera(),
		setPanMode: (enabled) => scene.setPanMode(enabled),
		focusRoom: (id) => scene.focusRoom(id),
		focusBase: () => scene.focusBase(),
		setBuildingPlacement: (selection) => scene.setBuildingPlacement(selection),
		projectShelterRect: (rect) => scene.projectShelterRect(rect),
	};
}
