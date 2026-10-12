import Phaser from "phaser";
import { getRaidPhase, type Raid, type RoomInstance } from "./game/engine";
import { type BaseRoom } from "./game/data";

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
	label: Phaser.GameObjects.Text;
	order: Phaser.GameObjects.Arc;
	selection: Phaser.GameObjects.Ellipse;
	hovered: boolean;
	gearSignature: string;
	anchor: Point;
	working: boolean;
	walking: boolean;
	phase: number;
};
export interface WorldInteractions {
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
};
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
	workshop: { label: "МАСТЕРСКАЯ", color: 0xc1a16b, light: 0xffca79, wall: 0x343b2c },
	ammo: { label: "ПАТРОННЫЙ ЦЕХ", color: 0xd1ae5b, light: 0xffc75d, wall: 0x443b24 },
	recycler: { label: "РАЗБОРКА", color: 0xc8835f, light: 0xeeb58b, wall: 0x3f3227 },
	medbay: { label: "МЕДБЛОК", color: 0x94bbaa, light: 0xd2ead3, wall: 0x2d423b },
	radio: { label: "РАДИОУЗЕЛ", color: 0x83afaa, light: 0xbcdac0, wall: 0x253d38 },
	storage: { label: "СКЛАД", color: 0xa8b38a, light: 0xe2d9a3, wall: 0x343d31 },
	dormitory: { label: "ЖИЛОЙ БЛОК", color: 0xb69ba5, light: 0xe5c1a1, wall: 0x3c3534 },
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
): { game: Phaser.Game; setView: (view: View) => void } {
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
			this.syncSnapshot();
			this.show(requestedView);
			this.game.canvas.setAttribute("aria-hidden", "true");
			this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
				this.raidActors.clear();
				this.places.clear();
				this.cells.clear();
				this.scavs.clear();
			});
		}

		show(view: View): void {
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

		private makeGlow(): void {
			const texture = this.textures.createCanvas("prapor-light", 256, 256);
			if (!texture) return;
			const context = texture.getContext();
			const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
			gradient.addColorStop(0, "rgba(255,201,123,.55)");
			gradient.addColorStop(0.2, "rgba(255,181,83,.26)");
			gradient.addColorStop(0.6, "rgba(213,133,51,.07)");
			gradient.addColorStop(1, "rgba(213,133,51,0)");
			context.fillStyle = gradient;
			context.fillRect(0, 0, 256, 256);
			texture.refresh();
		}

		private paintBunker(): void {
			const g = this.add.graphics();
			this.baseLayer.add(g);
			const rng = random(90312);
			g.fillStyle(0x202920).fillRect(0, 0, WIDTH, 128);
			g.fillStyle(0x192218).fillRect(0, 71, WIDTH, 56);
			for (const building of [{ x: 530, w: 78, h: 38 }, { x: 615, w: 57, h: 51 }, { x: 711, w: 97, h: 36 }]) {
				g.fillStyle(0x111d15).fillRect(building.x, 81 - building.h, building.w, building.h);
				for (let x = building.x + 9; x < building.x + building.w - 5; x += 15)
					g.fillStyle(0x7f8861, .09).fillRect(x, 51, 5, 10);
			}
			line(g, [{ x: 729, y: 84 }, { x: 729, y: 21 }, { x: 743, y: 21 }], 0x5a684d, 3);
			line(g, [{ x: 650, y: 75 }, { x: 650, y: 28 }, { x: 651, y: 27 }], 0x4a5d46, 2);
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
			g.fillStyle(0x3b4533).fillRect(42, 73, 143, 60);
			g.fillStyle(0x616b51).fillRect(35, 68, 157, 9);
			g.fillStyle(0x131f16).fillRoundedRect(91, 80, 54, 53, 3);
			g.lineStyle(3, 0x7a8165).strokeRoundedRect(91, 80, 54, 53, 3);
			g.fillStyle(0x485b43).fillRect(98, 86, 39, 20);
			line(g, [{ x: 117, y: 87 }, { x: 117, y: 107 }], 0x1b2c1b, 2);
			g.fillStyle(C.gold).fillRect(132, 113, 3, 3);
			g.fillStyle(0x253326).fillRect(181, 86, 620, 47);
			g.fillStyle(0x859070, .22).fillRect(181, 86, 620, 2);
			g.fillStyle(0x5b6550).fillRect(181, 130, 620, 4);
			for (let x = 194; x < 786; x += 26) line(g, [{ x, y: 130 }, { x: x + 12, y: 130 }], C.gold, 2, .21);
			g.fillStyle(0x17251a).fillRect(197, 90, 73, 27);
			g.fillStyle(0x777b5e).fillRect(203, 94, 17, 17).fillRect(224, 94, 17, 8).fillRect(247, 94, 16, 15);
			g.fillStyle(0x202d20).fillRect(693, 109, 67, 5).fillRect(701, 114, 3, 15).fillRect(749, 114, 3, 15);
			g.fillStyle(0x5b5e41).fillRect(704, 102, 15, 7).fillRect(735, 104, 17, 5);
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
			this.baseCaption = this.text(31, 25, "УБЕЖИЩЕ · СВОИ ЛЮДИ", 15, "#ded2ae");
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
			const label = this.text(10, 8, "", 12, "#d5c8aa");
			const status = this.text(10, 87, "", 9, "#a3b29a");
			const lamp = this.add.image(85, 43, "prapor-light").setScale(.66, .38).setAlpha(.12).setBlendMode(Phaser.BlendModes.ADD);
			const zone = this.add.zone(86, 50, ROOM_WIDTH, ROOM_HEIGHT).setInteractive({ useHandCursor: true });
			const root = this.add.container(p.x, p.y, [art, lamp, animation, frame, label, status, progress, zone]);
			this.baseLayer.add(root);
			const cell: ShelterCell = { root, art, frame, progress, animation, label, status, lamp, zone, signature: "", column, row, hovered: false, room: null, working: false };
			this.cells.set(`${column}:${row}`, cell);
			zone.on("pointerover", () => { if (requestedView === "base") { cell.hovered = true; this.paintCellFrame(cell); } });
			zone.on("pointerout", () => { cell.hovered = false; this.paintCellFrame(cell); });
			zone.on("pointerdown", () => {
				if (requestedView !== "base") return;
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
			const selected = Boolean(cell.room && snapshot().selectedRoomId === cell.room.id);
			const building = cell.room && cell.room.status !== "ready";
			const color = selected || cell.hovered ? C.light : building ? C.gold : cell.working ? 0x93ad78 : 0x65735a;
			cell.frame.clear().lineStyle(selected ? 2.5 : 1, color, selected || cell.hovered ? 1 : .42).strokeRect(1, 1, ROOM_WIDTH - 2, ROOM_HEIGHT - 2);
			if (selected || cell.hovered) {
				for (const x of [1, ROOM_WIDTH - 9]) for (const y of [1, ROOM_HEIGHT - 9]) cell.frame.fillStyle(C.gold, .85).fillRect(x, y, 8, 2).fillRect(x, y, 2, 8);
			}
		}

		private paintRoom(cell: ShelterCell): void {
			const g = cell.art;
			const room = cell.room;
			g.clear();
			if (!room) {
				g.fillStyle(0x252e23).fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
				const rng = random(cell.column * 829 + cell.row * 127 + 416);
				for (let n = 0; n < 45; n++) g.fillStyle(n % 2 ? 0x6d7055 : 0x0a150c, .23).fillRect(rng() * 170, rng() * 98, 3 + rng() * 10, 2 + rng() * 5);
				line(g, [{ x: 5, y: 82 }, { x: 27, y: 67 }, { x: 54, y: 78 }, { x: 102, y: 58 }, { x: 127, y: 75 }, { x: 170, y: 68 }], 0x111d13, 5);
				g.lineStyle(1, 0x76856b, .32).strokeRoundedRect(68, 38, 36, 28, 2);
				line(g, [{ x: 76, y: 52 }, { x: 96, y: 52 }], 0xa5ad89, 2, .66);
				line(g, [{ x: 86, y: 42 }, { x: 86, y: 62 }], 0xa5ad89, 2, .66);
				cell.label.setText("НОВЫЙ УЧАСТОК").setColor("#949f82");
				cell.status.setText("+ ПОСТРОИТЬ КОМНАТУ").setColor("#a8b496");
				cell.lamp.setVisible(false);
				return;
			}
			const style = ROOM_STYLE[room.type] ?? ROOM_STYLE.workshop!;
			g.fillStyle(style.wall).fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
			g.fillStyle(0x142018, .3).fillRect(0, 25, ROOM_WIDTH, 65);
			g.fillStyle(0x7f8a6a, .14).fillRect(1, 1, ROOM_WIDTH - 2, 23);
			for (let y = 35; y < 83; y += 15) line(g, [{ x: 2, y }, { x: 170, y }], 0x829173, 1, .09);
			for (let x = 25; x < 170; x += 37) line(g, [{ x, y: 26 }, { x, y: 83 }], 0x0b1d11, 1, .3);
			g.fillStyle(0x626b51).fillRect(0, 81, ROOM_WIDTH, 7);
			g.fillStyle(0x142117).fillRect(0, 88, ROOM_WIDTH, 12);
			line(g, [{ x: 4, y: 30 }, { x: 162, y: 30 }, { x: 162, y: 76 }], 0x748563, 2, .55);
			for (const x of [11, 49, 87, 125]) g.fillStyle(0xa0aa89).fillRect(x, 27, 3, 5);
			g.fillStyle(0x19271b).fillRect(65, 22, 43, 6);
			g.fillStyle(style.light, .9).fillRect(68, 25, 37, 2);
			polygon(g, [{ x: 67, y: 28 }, { x: 28, y: 81 }, { x: 146, y: 81 }, { x: 106, y: 28 }], style.light, .038);
			cell.label.setText(`${style.label} · ${room.level || 1}`).setColor("#d8d5bb");
			cell.lamp.setVisible(true).setTint(style.light);
			this.paintFurniture(g, room.type, room.level);
			if (room.status !== "ready") {
				g.fillStyle(0x101b11, .47).fillRect(1, 25, 170, 59);
				for (const x of [21, 87, 150]) line(g, [{ x, y: 28 }, { x, y: 80 }], 0x9b8c5e, 3);
				for (const y of [43, 65]) line(g, [{ x: 16, y }, { x: 154, y }], 0x8b8157, 3);
				line(g, [{ x: 21, y: 78 }, { x: 87, y: 31 }, { x: 150, y: 78 }], 0xd0ad69, 2, .65);
				g.fillStyle(0xb4a05d).fillRect(17, 77, 18, 5).fillRect(141, 77, 18, 5);
				for (let x = 12; x < 166; x += 12) line(g, [{ x, y: 83 }, { x: x + 5, y: 79 }], x % 24 ? 0x141e14 : 0xe2b667, 3);
				cell.label.setText(`${room.status === "building" ? "СТРОИТСЯ" : "УЛУЧШЕНИЕ"} · ${room.construction?.targetLevel ?? room.level + 1}`).setColor("#e8c28c");
			}
		}

		private paintFurniture(g: Phaser.GameObjects.Graphics, type: string, level: number): void {
			const panel = (x: number, y: number, w: number, h: number, color: number) => {
				g.fillStyle(0x0d1a11).fillRect(x + 2, y + 2, w, h);
				g.fillStyle(color).fillRect(x, y, w, h);
				line(g, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }], 0xb2b79b, 1, .28);
			};
			const chest = (x: number, y: number, w: number, h: number, color = 0x6e7953) => {
				panel(x, y, w, h, color);
				line(g, [{ x: x + 5, y }, { x: x + 5, y: y + h }, { x: x + w - 5, y: y + h }, { x: x + w - 5, y }], 0x263a26, 2);
				g.fillStyle(0xc6bd82).fillRect(x + w / 2 - 4, y + 4, 8, 3);
			};
			switch (type) {
				case "workshop":
					panel(12, 37, 53, 33, 0x475a44);
					for (let x = 18; x < 58; x += 10) { line(g, [{ x, y: 42 }, { x: x + 3, y: 54 }], 0xbcb79a, 2); g.fillStyle(0x222c21).fillRect(x - 1, 55, 5, 5); }
					panel(11, 72, 78, 7, 0x87724f);
					g.fillStyle(0x44503a).fillRect(16, 79, 4, 4).fillRect(80, 79, 4, 4);
					panel(75, 57, 22, 19, 0x5c6b50);
					g.fillStyle(0x9aab80).fillRect(74, 60, 24, 3);
					line(g, [{ x: 68, y: 69 }, { x: 104, y: 69 }], 0xadb796, 2);
					g.fillStyle(0x293d2b).fillCircle(79, 64, 6);
					panel(113, 60, 46, 20, 0x685d43);
					rifle(g, 131, 60, .5);
					chest(120, 75, 24, 9);
					break;
				case "ammo":
					panel(23, 37, 49, 43, 0x81754b);
					panel(30, 45, 33, 25, 0x253829);
					g.fillStyle(0xa49b6a).fillRect(42, 43, 9, 27).fillRect(33, 68, 27, 5);
					g.fillStyle(0x9b8c5b).fillEllipse(47, 36, 33, 8);
					panel(78, 71, 74, 10, 0x53634a);
					for (let x = 84; x < 145; x += 9) g.fillStyle(0xd5b967).fillRect(x, 66, 3, 8);
					chest(114, 40, 32, 20, 0x938052);
					g.fillStyle(0x576b47).fillRect(152, 58, 9, 23);
					break;
				case "recycler":
					panel(17, 48, 65, 34, 0x665442);
					polygon(g, [{ x: 18, y: 48 }, { x: 28, y: 36 }, { x: 68, y: 36 }, { x: 81, y: 48 }], 0x8b7450);
					g.fillStyle(0x192e21).fillRect(28, 48, 44, 19);
					for (let x = 30; x < 70; x += 7) g.fillStyle(0xb49d72).fillRect(x, 51, 3, 10);
					panel(86, 72, 67, 9, 0x4f6046);
					line(g, [{ x: 96, y: 65 }, { x: 108, y: 68 }, { x: 116, y: 62 }, { x: 130, y: 68 }], 0xa2a98b, 4);
					chest(118, 43, 35, 20, 0x595e46);
					g.fillStyle(0x82543c).fillRect(5, 68, 8, 13);
					break;
				case "medbay":
					panel(11, 35, 49, 24, 0x5d7965);
					panel(14, 38, 43, 18, 0x233c30);
					line(g, [{ x: 17, y: 48 }, { x: 24, y: 48 }, { x: 29, y: 43 }, { x: 34, y: 53 }, { x: 39, y: 43 }, { x: 44, y: 48 }, { x: 52, y: 48 }], 0xb5d0a5, 1.2);
					panel(12, 68, 62, 8, 0x9cac97);
					g.fillStyle(0xc4c8ac).fillRoundedRect(16, 63, 52, 7, 2);
					g.fillStyle(0xe0d8ba).fillRect(16, 61, 12, 8);
					line(g, [{ x: 15, y: 76 }, { x: 15, y: 82 }, { x: 69, y: 82 }, { x: 69, y: 76 }], 0x6d8368, 2);
					panel(101, 38, 38, 42, 0x78896f);
					g.fillStyle(0xd4d6b5).fillRect(116, 44, 7, 18).fillRect(110, 50, 19, 6);
					line(g, [{ x: 104, y: 68 }, { x: 136, y: 68 }], 0x344d38, 2);
					g.fillStyle(0xd7d0af).fillRect(142, 70, 17, 4);
					line(g, [{ x: 154, y: 68 }, { x: 154, y: 63 }, { x: 147, y: 63 }], 0x97b49a, 2);
					break;
				case "radio":
					panel(12, 68, 96, 12, 0x4b6555);
					panel(20, 44, 43, 26, 0x678372);
					panel(24, 47, 35, 19, 0x153326);
					g.lineStyle(1, 0x9dbb87, .65).strokeCircle(42, 57, 7);
					line(g, [{ x: 28, y: 57 }, { x: 56, y: 57 }], 0x6b8e65, 1);
					panel(73, 53, 26, 16, 0x253f30);
					g.fillStyle(0xd1ba79).fillCircle(92, 62, 3);
					for (let x = 78; x < 91; x += 4) g.fillStyle(0x8eb176).fillRect(x, 57, 2, 3);
					panel(125, 34, 31, 47, 0x3e5b48);
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
						g.fillStyle(0x586854).fillRect(x, 46, 3, 36).fillRect(x + 60, 46, 3, 36);
						for (const y of [49, 71]) {
							panel(x, y, 63, 5, 0x849178);
							g.fillStyle(0xc2bba5).fillRect(x + 5, y - 4, 13, 5);
							g.fillStyle(0x6c7569).fillRect(x + 20, y - 4, 37, 5);
						}
						line(g, [{ x: x + 52, y: 50 }, { x: x + 52, y: 82 }], 0x859575, 2);
						for (let y = 56; y < 80; y += 7) line(g, [{ x: x + 48, y }, { x: x + 57, y }], 0x859575, 1.5);
					}
					chest(77, 70, 16, 11, 0x76654d);
					break;
			}
			for (let n = 0; n < Math.min(5, level); n++) g.fillStyle(0xdcc894, .65).fillRect(152 - n * 5, 12, 3, 3);
		}

		private clickFeedback(at: Point, layer: Phaser.GameObjects.Container): void {
			const ring = this.add.circle(at.x, at.y, 15).setStrokeStyle(2, C.light, .85).setDepth(1500);
			layer.add(ring);
			this.tweens.add({ targets: ring, scale: reducedMotion ? 1 : 2.2, alpha: 0, duration: reducedMotion ? 80 : 320, onComplete: () => ring.destroy() });
		}

		private createScav(scavId: string, index: number): ScavActor {
			const actor = this.add.container(220, 128).setDepth(30);
			const body = this.add.container(0, 0);
			const shadow = this.add.ellipse(0, 1, 18, 5, 0x06110a, .45);
			const selection = this.add.ellipse(0, 1, 27, 9).setStrokeStyle(1.5, C.gold).setVisible(false);
			const legA = this.add.rectangle(-3, -5, 4, 10, 0x1b2b1e);
			const legB = this.add.rectangle(3, -5, 4, 10, 0x273727);
			const hand = this.add.rectangle(6, -21, 4, 13, 0xa18e65).setOrigin(.5, .15);
			const graphic = this.add.graphics();
			const coats = [0x839273, 0xa28c60, 0x6f8b77, 0x8b7a65];
			const coat = coats[index % coats.length]!;
			graphic.fillStyle(coat).fillRect(-6, -27, 12, 16);
			graphic.fillStyle(0x344b33).fillRect(-4, -24, 8, 10);
			graphic.fillStyle(0xa7a77c).fillRect(-3, -22, 2, 5).fillRect(1, -22, 2, 5);
			graphic.fillStyle(0xbfa57b).fillRect(-4, -36, 8, 9);
			graphic.fillStyle(0x344c35).fillRect(-5, -38, 10, 5);
			graphic.fillStyle(0x172a1c).fillRect(1, -33, 2, 2);
			const gear = this.add.graphics();
			body.add([legA, legB, graphic, gear, hand]);
			const label = this.text(0, -51, "", 12, "#f0dbac").setOrigin(.5).setBackgroundColor("#162219").setPadding(5, 3).setVisible(false);
			const order = this.add.circle(-10, -32, 3, C.sage).setStrokeStyle(1, 0x19261a).setVisible(false);
			const hit = this.add.zone(0, -21, 32, 46).setInteractive({ useHandCursor: true });
			const slot: ScavActor = { actor, body, legA, legB, hand, gear, label, order, selection, hovered: false, gearSignature: "", anchor: { x: 220, y: 128 }, working: false, walking: false, phase: index * 1.71 };
			hit.on("pointerover", () => { if (requestedView === "base") { slot.hovered = true; selection.setVisible(true); label.setVisible(true); actor.setDepth(80); } });
			hit.on("pointerout", () => { slot.hovered = false; const selected = snapshot().selectedScavId === scavId; selection.setVisible(selected); label.setVisible(selected); actor.setDepth(30); });
			hit.on("pointerdown", () => { if (requestedView === "base") { this.clickFeedback({ x: actor.x, y: actor.y - 19 }, this.baseLayer); interactions.onScav?.(scavId); } });
			actor.add([shadow, selection, body, label, order, hit]);
			this.baseLayer.add(actor);
			this.scavs.set(scavId, slot);
			return slot;
		}

		private syncShelter(state: WorldSnapshot): void {
			const rooms = state.shelter?.rooms ?? [];
			let workingRooms = 0;
			for (const cell of this.cells.values()) {
				const room = rooms.find((candidate) => candidate.column === cell.column && candidate.row === cell.row) ?? null;
				cell.room = room;
				const production = room ? state.roomProduction?.[room.id] : undefined;
				cell.working = Boolean(room?.status === "ready" && room.queue.length && room.workerIds.length && production?.rate && !production.reason);
				if (cell.working) workingRooms++;
				const signature = room ? `${room.id}:${room.type}:${room.level}:${room.status}` : "empty";
				if (cell.signature !== signature) { cell.signature = signature; this.paintRoom(cell); }
				this.paintCellFrame(cell);
				cell.progress.clear();
				if (room) {
					const construction = room.construction;
					const progress = construction ? construction.workDone / Math.max(1, construction.workRequired) : production?.progress ?? 0;
					const color = construction ? C.gold : 0x95b37b;
					cell.progress.fillStyle(0x08190d).fillRect(1, 97, 170, 3);
					cell.progress.fillStyle(color, .9).fillRect(1, 97, Phaser.Math.Clamp(progress, 0, 1) * 170, 3);
					const seconds = production?.remainingSeconds;
					const remaining = Math.ceil(seconds ?? 0);
					const time = seconds === null || seconds === undefined ? "" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
					const status = construction ? `${Math.floor(progress * 100)}% · РАБОТЫ` : room.type === "storage" ? "ЗАПАСЫ БАЗЫ" : room.type === "dormitory" ? "МЕСТА ДЛЯ ОТРЯДА" : !room.workerIds.length ? "НУЖЕН РАБОТНИК" : production?.reason ? production.reason : `${production?.status ?? "РАБОТА"} ${time}`;
					const clippedStatus = `${status.toLocaleUpperCase("ru-RU").slice(0, 22)}${status.length > 22 ? "…" : ""}`;
					cell.status.setText(clippedStatus).setColor(construction ? "#e8c18a" : cell.working ? "#b1c89a" : "#a4b096");
					cell.lamp.setAlpha(construction ? .08 : cell.working ? .18 : .11);
				}
			}
			this.baseCaption.setText(`УБЕЖИЩЕ · УРОВЕНЬ ${state.level}`);
			this.shelterCaption.setText(`${rooms.length} КОМНАТ · ${workingRooms} ПРОИЗВОДЯТ · ${rooms.filter((room) => room.status !== "ready").length} СТРОЯТСЯ`);
			const people = state.scavs ?? [];
			const alive = new Set(people.map((scav) => scav.id));
			for (const [id, actor] of this.scavs) if (!alive.has(id)) { actor.actor.destroy(true); this.scavs.delete(id); }
			let freeIndex = 0;
			people.forEach((scav, index) => {
				const slot = this.scavs.get(scav.id) ?? this.createScav(scav.id, index);
				const room = rooms.find((candidate) => candidate.id === scav.assignment && candidate.workerIds.includes(scav.id));
				const production = room ? state.roomProduction?.[room.id] : undefined;
				const workerRank = room?.workerIds.indexOf(scav.id) ?? 0;
				slot.working = Boolean(room && room.queue.length && scav.status === "ready" && room.status === "ready" && production?.rate && !production.reason);
				slot.walking = !room && scav.status === "ready";
				if (room) { const p = cellPosition(room.column, room.row); slot.anchor = { x: p.x + 68 + Math.max(0, workerRank) * 32, y: p.y + 80 }; }
				else { slot.anchor = { x: 307 + freeIndex % 7 * 55, y: 129 }; freeIndex++; }
				slot.actor.setVisible(scav.status !== "raiding").setAlpha(scav.status === "wounded" ? .6 : .75 + Math.min(100, scav.health) / 400);
				const selected = state.selectedScavId === scav.id;
				slot.selection.setVisible(selected || slot.hovered).setStrokeStyle(1.5, selected ? C.light : C.gold);
				slot.label.setText(`${scav.name?.toLocaleUpperCase("ru-RU") ?? ""}${scav.status === "wounded" ? " · РАНЕН" : ""}`).setVisible(selected || slot.hovered);
				slot.order.setVisible(Boolean(scav.autoRaid?.enabled)).setFillStyle(scav.autoRaid?.waitingReason ? C.gold : C.sage);
				const gearSignature = `${scav.gear?.armor ?? 0}:${scav.gear?.backpack ?? 0}:${Boolean(room)}`;
				if (slot.gearSignature !== gearSignature) {
					slot.gearSignature = gearSignature;
					slot.gear.clear();
					if (!room && scav.gear?.backpack) slot.gear.fillStyle(0x8c7650).fillRect(-10, -26, 5, 16).lineStyle(1, 0xbca16b).strokeRect(-10, -26, 5, 16);
					if (scav.gear?.armor) slot.gear.fillStyle(0x708060).fillRect(-4, -25, 8, 9).fillStyle(0xc4bc80).fillRect(-3, -23, 2, 2);
				}
			});
			this.baseLayer.sort("depth");
		}

		private animateShelter(time: number): void {
			this.elevator.setY(reducedMotion ? 179 : 179 + (1 - Math.cos(time / 5100)) * 111);
			for (const slot of this.scavs.values()) {
				const phase = time / 340 + slot.phase;
				const animated = !reducedMotion && slot.actor.visible;
				const walk = animated && slot.walking;
				const work = animated && slot.working;
				const sway = walk ? Math.sin(time / 2200 + slot.phase) * 17 : 0;
				slot.actor.setPosition(slot.anchor.x + sway, slot.anchor.y);
				slot.body.setY(work ? Math.sin(phase) * .8 : walk ? Math.abs(Math.sin(phase)) * -.9 : 0);
				slot.legA.setY(-5 + (walk ? Math.sin(phase) * 2 : 0));
				slot.legB.setY(-5 - (walk ? Math.sin(phase) * 2 : 0));
				slot.hand.setAngle(work ? -48 + Math.sin(phase) * 28 : walk ? Math.sin(phase) * 16 : 0);
				slot.body.setScale(walk && Math.cos(time / 2200 + slot.phase) < 0 ? -1 : 1, 1);
			}
			for (const cell of this.cells.values()) {
				const g = cell.animation;
				g.clear();
				if (!cell.room) continue;
				const work = cell.working && !reducedMotion;
				if (cell.room.status !== "ready") {
					g.fillStyle(C.gold, .9).fillCircle(115, 62, 3);
					line(g, [{ x: 115, y: 65 }, { x: 115, y: 79 }], 0x938063, 7);
					line(g, [{ x: 117, y: 68 }, { x: 127, y: 62 + (reducedMotion ? 0 : Math.sin(time / 180) * 4) }], 0xccb287, 2);
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
			zone.on("pointerdown", () => {
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
			zone.on("pointerover", () => {
				const item = this.places.get(place.id);
				if (requestedView !== "map" || !item) return;
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
			this.lastSelection = `${state.selectedScavId ?? ""}:${state.selectedMapId ?? ""}:${state.selectedRoomId ?? ""}`;
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
					marker.on("pointerover", () => {
						const item = this.raidActors.get(raid.id);
						if (requestedView !== "map" || !item) return;
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
					marker.on("pointerdown", () => {
						if (requestedView !== "map") return;
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

		update(time: number): void {
			const selection = snapshot();
			if (time - this.lastSync > 1000 || `${selection.selectedScavId ?? ""}:${selection.selectedMapId ?? ""}:${selection.selectedRoomId ?? ""}` !== this.lastSelection) {
				this.lastSync = time;
				this.syncSnapshot();
			}
			if (requestedView === "base") {
				this.animateShelter(time);
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
	return { game, setView: (view) => scene.show(view) };
}
