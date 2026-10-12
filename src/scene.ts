import Phaser from "phaser";
import { getRaidPhase, type Raid } from "./game/engine";
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
	scavs?: {
		id: string;
		name?: string;
		status: "ready" | "raiding" | "wounded";
		health: number;
		gear?: { armor: number; backpack: number };
		autoRaid?: { enabled: boolean; waitingReason: string | null };
	}[];
}

type Point = { x: number; y: number };
type View = "base" | "map";
type MapPlace = WorldSnapshot["maps"][number];
type ScavActor = {
	actor: Phaser.GameObjects.Container;
	motion: Phaser.Tweens.Tween[];
	gear: Phaser.GameObjects.Graphics;
	label: Phaser.GameObjects.Text;
	order: Phaser.GameObjects.Arc;
	selection: Phaser.GameObjects.Ellipse;
	hovered: boolean;
	gearSignature: string;
};
export interface WorldInteractions {
	onRoom?: (room: BaseRoom) => void;
	onScav?: (id: string) => void;
}
type RaidMarker = {
	actor: Phaser.GameObjects.Container;
	ring: Phaser.GameObjects.Ellipse;
	label: Phaser.GameObjects.Text;
	phase: Phaser.GameObjects.Text;
	hovered: boolean;
};
const WIDTH = 840;
const HEIGHT = 460;
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
const iso = (u: number, v: number, height = 0): Point => ({
	x: 420 + (u - v) * 26,
	y: 115 + (u + v) * 13 - height,
});
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
function box(
	g: Phaser.GameObjects.Graphics,
	u: number,
	v: number,
	du: number,
	dv: number,
	h: number,
	top: number,
	left: number,
	right: number
): void {
	const a = iso(u, v),
		b = iso(u + du, v),
		c = iso(u + du, v + dv),
		d = iso(u, v + dv);
	const at = iso(u, v, h),
		bt = iso(u + du, v, h),
		ct = iso(u + du, v + dv, h),
		dt = iso(u, v + dv, h);
	polygon(
		g,
		[a, b, { x: c.x + 8, y: c.y + 4 }, { x: d.x + 8, y: d.y + 4 }],
		0x080b08,
		0.32
	);
	polygon(g, [bt, b, c, ct], right);
	polygon(g, [dt, d, c, ct], left);
	polygon(g, [at, bt, ct, dt], top);
	line(g, [dt, ct, bt], 0xffffff, 1, 0.08);
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
function crate(
	g: Phaser.GameObjects.Graphics,
	u: number,
	v: number,
	size = 1,
	h = 16
): void {
	box(g, u, v, size, size * 0.72, h, 0x7e7953, 0x555739, 0x666442);
	const a = iso(u, v + size * 0.72, h),
		b = iso(u + size, v + size * 0.72, h);
	const a0 = iso(u, v + size * 0.72),
		b0 = iso(u + size, v + size * 0.72);
	line(g, [a, b0], 0x393e2d, 3);
	line(g, [b, a0], 0x393e2d, 3);
	for (const off of [0.18, 0.77]) {
		line(
			g,
			[
				iso(u + size * off, v, h + 1),
				iso(u + size * off, v + size * 0.72, h + 1),
			],
			0x323c2d,
			3
		);
	}
	const label = iso(u + size * 0.48, v + size * 0.72, h * 0.56);
	g.fillStyle(0xd1c797).fillRect(label.x - 5, label.y - 2, 9, 4);
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
		private roomLabels = new Map<BaseRoom, Phaser.GameObjects.Text>();
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
		private scavs: ScavActor[] = [];
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
			this.mapLayer = this.add.container(0, 0);
			this.paintBunker();
			this.paintMap();
			this.syncSnapshot();
			this.show(requestedView);
			this.game.canvas.setAttribute("aria-hidden", "true");
			this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
				this.raidActors.clear();
				this.places.clear();
				this.roomLabels.clear();
				this.scavs = [];
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

		private object(
			depth: number,
			paint: (g: Phaser.GameObjects.Graphics) => void
		): Phaser.GameObjects.Graphics {
			const g = this.add.graphics().setDepth(depth);
			paint(g);
			this.baseLayer.add(g);
			return g;
		}

		private paintBunker(): void {
			const rng = random(90312);
			this.object(-20, (g) => {
				g.fillStyle(0x090c09).fillEllipse(425, 303, 712, 293);
				const floor = [iso(0, 0), iso(12, 0), iso(12, 12), iso(0, 12)];
				polygon(
					g,
					floor.map((p) => ({ x: p.x, y: p.y + 9 })),
					0x050805
				);
				polygon(
					g,
					[iso(0, 12), iso(12, 12), { x: 420, y: 439 }, { x: 108, y: 283 }],
					0x33392c
				);
				polygon(
					g,
					[iso(12, 0), iso(12, 12), { x: 420, y: 439 }, { x: 732, y: 283 }],
					0x222b20
				);
				for (let u = 0; u < 12; u++) {
					for (let v = 0; v < 12; v++) {
						const colors = [0x4b4e40, 0x4d5144, 0x434a3c, 0x535345, 0x464d3e];
						polygon(
							g,
							[iso(u, v), iso(u + 1, v), iso(u + 1, v + 1), iso(u, v + 1)],
							colors[Math.floor(rng() * colors.length)] ?? C.wall
						);
						line(
							g,
							[iso(u, v), iso(u + 1, v), iso(u + 1, v + 1)],
							0x191f19,
							1,
							0.7
						);
						if (rng() > 0.68) {
							const p = iso(u + 0.35, v + 0.6);
							line(
								g,
								[p, { x: p.x + 9, y: p.y + 2 }, { x: p.x + 13, y: p.y - 1 }],
								0x232c24,
								1,
								0.7
							);
						}
						if (rng() > 0.52) {
							const p = iso(u + 0.3, v + 0.5);
							g.fillStyle(0x98917a, 0.11).fillRect(p.x, p.y, 3, 1);
						}
					}
				}
				// Worn walkway paint and the iron service hatch.
				for (let n = 0; n < 14; n++) {
					const u = 4 + n * 0.42;
					line(g, [iso(u, 4.2), iso(u + 0.22, 4.2)], 0xc1a363, 2, 0.42);
				}
				polygon(
					g,
					[iso(7.9, 7.2), iso(9.3, 7.2), iso(9.3, 8.4), iso(7.9, 8.4)],
					0x292f27
				);
				for (let n = 0; n < 7; n++)
					line(
						g,
						[iso(8 + n * 0.18, 7.3), iso(8 + n * 0.18, 8.3)],
						0x181f18,
						2
					);
				line(
					g,
					[iso(8, 7.3), iso(9.2, 7.3), iso(9.2, 8.3), iso(8, 8.3), iso(8, 7.3)],
					0x76785c,
					1,
					0.6
				);
			});
			for (const pool of [
				{ u: 3.4, v: 3.2, scale: 1.9, alpha: 0.24 },
				{ u: 7.7, v: 9.4, scale: 2.3, alpha: 0.27 },
				{ u: 9.8, v: 5.7, scale: 1.5, alpha: 0.2 },
			]) {
				const p = iso(pool.u, pool.v);
				this.baseLayer.add(this.add.image(p.x, p.y, "prapor-light")
					.setScale(pool.scale, pool.scale * 0.44)
					.setAlpha(pool.alpha)
					.setBlendMode(Phaser.BlendModes.ADD)
					.setDepth(-15));
			}

			this.object(-10, (g) => {
				polygon(
					g,
					[iso(0, 0), iso(0, 12), iso(0, 12, 84), iso(0, 0, 84)],
					0x394034
				);
				polygon(
					g,
					[iso(0, 0), iso(12, 0), iso(12, 0, 84), iso(0, 0, 84)],
					0x2b332a
				);
				polygon(
					g,
					[
						iso(0, 0, 84),
						iso(0, 12, 84),
						iso(-0.2, 12, 84),
						iso(-0.2, -0.2, 84),
					],
					0x737565
				);
				polygon(
					g,
					[
						iso(0, 0, 84),
						iso(12, 0, 84),
						iso(12, -0.2, 84),
						iso(-0.2, -0.2, 84),
					],
					0x4c5944
				);
				for (let n = 0; n <= 12; n += 1.5) {
					line(g, [iso(0, n), iso(0, n, 82)], 0x202a20, 2);
					line(g, [iso(n, 0), iso(n, 0, 82)], 0x19241c, 2);
				}
				for (const h of [20, 44, 68]) {
					line(g, [iso(0, 0, h), iso(0, 12, h)], 0x747766, 1, 0.2);
					line(g, [iso(0, 0, h), iso(12, 0, h)], 0x768272, 1, 0.16);
				}
				// Oxidized pipes with clamp collars.
				line(g, [iso(0, 0, 72), iso(0, 11.8, 72)], 0x111911, 7);
				line(g, [iso(0, 0, 74), iso(0, 11.8, 74)], 0x6e7053, 3);
				line(g, [iso(0, 0, 74), iso(11.8, 0, 74)], 0x5d6850, 4);
				for (let n = 1; n < 12; n += 2) {
					line(g, [iso(0, n, 69), iso(0, n, 78)], 0x929179, 3);
					line(g, [iso(n, 0, 70), iso(n, 0, 78)], 0x84836a, 3);
				}
				// Steel door, inspection window, caution stripe, an exhausted extraction fan.
				polygon(
					g,
					[iso(0, 7.6), iso(0, 10.1), iso(0, 10.1, 63), iso(0, 7.6, 63)],
					0x121d17
				);
				line(
					g,
					[iso(0, 7.6), iso(0, 7.6, 63), iso(0, 10.1, 63), iso(0, 10.1)],
					0x69745c,
					4
				);
				polygon(
					g,
					[iso(0, 8.2, 39), iso(0, 9.5, 39), iso(0, 9.5, 54), iso(0, 8.2, 54)],
					0x263a2d
				);
				line(g, [iso(0, 8.85, 39), iso(0, 8.85, 54)], 0x7b8e69, 2);
				const handle = iso(0, 7.9, 24);
				line(
					g,
					[
						{ x: handle.x - 5, y: handle.y },
						{ x: handle.x + 3, y: handle.y - 4 },
					],
					0x9ba080,
					2
				);
				for (let n = 0; n < 7; n++) {
					line(
						g,
						[iso(0.1, 7.6 + n * 0.34), iso(0.45, 7.6 + n * 0.34)],
						n % 2 ? 0x101910 : 0xb99a52,
						5
					);
				}
				const fan = iso(2.5, 0, 50);
				g.fillStyle(0x131d16).fillEllipse(fan.x, fan.y, 34, 39);
				g.lineStyle(3, 0x727966).strokeEllipse(fan.x, fan.y, 34, 39);
				for (let n = -11; n <= 11; n += 5)
					line(
						g,
						[
							{ x: fan.x + n, y: fan.y - 14 },
							{ x: fan.x + n, y: fan.y + 14 },
						],
						0x555f4b,
						1
					);
				g.fillStyle(0x7b8065).fillCircle(fan.x, fan.y, 4);
				// Warm service lights reveal the wall relief without flattening the room.
				for (const span of [{ u: 0.1, v: 2.1, axis: "v" }, { u: 8, v: 0.1, axis: "u" }]) {
					const start = iso(span.u, span.v, 58);
					const end = iso(span.u + (span.axis === "u" ? 1.4 : 0), span.v + (span.axis === "v" ? 1.4 : 0), 58);
					line(g, [start, end], 0x121c15, 8);
					line(g, [start, end], 0xa28a5d, 5);
					line(g, [start, end], 0xffd79a, 2);
				}
			});

			// The rear ammunition shelves are real objects in the same depth-sorted world as the actors.
			for (const [u, v] of [
				[1.3, 1.8],
				[1.3, 4.3],
			]) {
				this.object(iso(u ?? 0, v ?? 0).y, (g) => {
					const x = u ?? 0,
						y = v ?? 0;
					box(g, x, y, 1.1, 2.2, 47, 0x606749, 0x333e2e, 0x4b573b);
					for (const h of [10, 25, 42]) {
						line(
							g,
							[iso(x + 1.1, y, h), iso(x + 1.1, y + 2.2, h)],
							0x899271,
							3
						);
						for (let n = 0; n < 4; n++) {
							const p = iso(x + 1.12, y + 0.3 + n * 0.47, h + 7);
							g.fillStyle(n % 2 ? 0xa1925c : 0x75865c).fillRect(
								p.x - 6,
								p.y - 5,
								10,
								8
							);
							g.fillStyle(0xd1bd7e).fillRect(p.x - 3, p.y - 3, 4, 2);
						}
					}
				});
			}

			this.object(205, (g) => {
				box(g, 6.7, 0.8, 3.1, 0.7, 52, 0x616c50, 0x233127, 0x3d4b34);
				for (let n = 0; n < 4; n++) {
					const p = iso(7 + n * 0.71, 1.54, 30);
					rifle(g, p.x, p.y, 0.63, n % 2 === 0);
					line(
						g,
						[
							{ x: p.x - 13, y: p.y - 10 },
							{ x: p.x - 13, y: p.y + 12 },
						],
						0x8a9676,
						1
					);
				}
				line(g, [iso(6.7, 1.5, 7), iso(9.8, 1.5, 7)], 0x7e8869, 3);
			});

			this.object(233, (g) => {
				box(g, 10.05, 1.2, 1.1, 1.1, 44, 0x687457, 0x344934, 0x43593d);
				for (const h of [14, 29])
					line(g, [iso(10.05, 2.3, h), iso(11.15, 2.3, h)], 0x273827, 2);
				for (const h of [7, 22, 36]) {
					const p = iso(10.5, 2.33, h);
					g.fillStyle(0x9fa785).fillRect(p.x - 3, p.y - 1, 7, 2);
				}
			});

			this.object(277, (g) => {
				for (let n = 0; n < 3; n++)
					crate(
						g,
						9.2 + (n % 2) * 1.13,
						3.2 + Math.floor(n / 2) * 0.92,
						1.05,
						n === 2 ? 24 : 17
					);
				crate(g, 10.3, 3.3, 0.72, 27);
			});

			this.object(320, (g) => {
				// A canvas cot, first-aid case and an IV stand give the medbay its own silhouette.
				for (const u of [9.35, 10.45])
					for (const v of [4.9, 6.85])
						box(g, u, v, 0.14, 0.14, 15, 0x8c9480, 0x3b4434, 0x56634b);
				box(g, 9.3, 4.8, 1.35, 2.25, 18, 0x74816a, 0x344735, 0x4c5c45);
				polygon(g, [iso(9.4, 5.25, 19), iso(10.55, 5.25, 19), iso(10.55, 6.9, 19), iso(9.4, 6.9, 19)], 0xabb49a);
				box(g, 9.47, 4.98, 0.97, 0.35, 23, 0xd1cfb2, 0x78866c, 0x929c7d);
				const medical = iso(10.7, 5.2, 21);
				g.fillStyle(0x9b9f82).fillRoundedRect(medical.x - 10, medical.y - 13, 23, 18, 2);
				g.fillStyle(0x844735).fillRect(medical.x - 1, medical.y - 10, 4, 12);
				g.fillStyle(0x844735).fillRect(medical.x - 5, medical.y - 6, 12, 4);
				const stand = iso(10.9, 6.8);
				line(g, [{ x: stand.x - 9, y: stand.y }, { x: stand.x + 9, y: stand.y }], 0x758772, 2);
				line(g, [stand, { x: stand.x, y: stand.y - 58 }, { x: stand.x - 9, y: stand.y - 58 }], 0xaab398, 2);
				g.fillStyle(0xbbc5a3, 0.7).fillRoundedRect(stand.x - 14, stand.y - 53, 10, 14, 2);
				line(g, [{ x: stand.x - 9, y: stand.y - 39 }, { x: stand.x - 9, y: stand.y - 25 }, iso(10.3, 6.3, 23)], 0xb4bc96, 1, 0.6);
			});

			this.object(318, (g) => {
				// Radio desk: thin top, iron feet, radio, phosphor CRT, paper map.
				for (const [u, v] of [
					[2.8, 7],
					[4.9, 7],
					[2.8, 8],
				])
					box(g, u ?? 0, v ?? 0, 0.18, 0.18, 23, 0x6a6e54, 0x30392c, 0x404737);
				box(g, 2.6, 6.8, 2.7, 1.45, 25, 0x9a875c, 0x514f36, 0x685e3d);
				const screen = iso(3.2, 7.1, 40);
				g.fillStyle(0x18291f).fillRect(screen.x - 10, screen.y - 9, 21, 19);
				g.fillStyle(0x56865d).fillRect(screen.x - 7, screen.y - 6, 15, 11);
				g.fillStyle(0x9bc28a).fillRect(screen.x - 4, screen.y - 4, 6, 1);
				g.fillStyle(0x9bc28a).fillRect(screen.x - 4, screen.y - 1, 10, 1);
				g.fillStyle(0x172219).fillRect(screen.x - 3, screen.y + 10, 6, 3);
				const radio = iso(4.55, 7.1, 32);
				g.fillStyle(0x20291c).fillRect(radio.x - 9, radio.y - 6, 18, 13);
				g.fillStyle(0x9aa77b).fillRect(radio.x - 5, radio.y - 3, 6, 3);
				g.fillStyle(0xe0a357).fillCircle(radio.x + 5, radio.y + 2, 2);
				line(
					g,
					[
						{ x: radio.x + 6, y: radio.y - 6 },
						{ x: radio.x + 9, y: radio.y - 24 },
					],
					0x9ca087,
					1
				);
				polygon(
					g,
					[
						iso(3.7, 7.7, 26),
						iso(4.5, 7.7, 26),
						iso(4.5, 8.1, 26),
						iso(3.7, 8.1, 26),
					],
					0xb4b397
				);
				line(g, [iso(3.8, 7.8, 27), iso(4.4, 7.9, 27)], 0x677758, 1);
			});

			this.object(355, (g) => {
				box(g, 6.4, 9, 2.45, 1.3, 24, 0x8c7953, 0x454a34, 0x5c593a);
				const table = iso(7.5, 9.6, 27);
				rifle(g, table.x, table.y, 0.8);
				const tool = iso(6.9, 9.4, 31);
				g.fillStyle(0x455d57).fillRect(tool.x - 9, tool.y - 5, 14, 9);
				g.lineStyle(2, 0x7e9583).strokeRect(tool.x - 9, tool.y - 5, 14, 9);
				for (let n = 0; n < 5; n++) {
					const bullet = iso(8.2 + n * 0.09, 9.4, 25);
					g.fillStyle(0xbeb27d).fillRect(bullet.x, bullet.y - 4, 2, 5);
				}
				const vise = iso(8.6, 10.1, 27);
				g.fillStyle(0x3d4843).fillRect(vise.x - 6, vise.y - 7, 11, 10);
				line(
					g,
					[
						{ x: vise.x - 10, y: vise.y - 2 },
						{ x: vise.x + 9, y: vise.y - 2 },
					],
					0x9aa18a,
					2
				);
				for (const off of [0.4, 1.45])
					line(
						g,
						[iso(6.4 + off, 10.3, 7), iso(7.2 + off, 10.3, 7)],
						0x9fa17c,
						2
					);
			});

			this.object(393, (g) => {
				crate(g, 9.9, 10.4, 0.95, 19);
				crate(g, 10.8, 9.8, 0.8, 26);
				const barrel = iso(3.1, 10.6);
				g.fillStyle(0x5d3529).fillRect(barrel.x - 12, barrel.y - 28, 24, 27);
				g.fillStyle(0x8d543e).fillEllipse(barrel.x, barrel.y - 28, 24, 11);
				g.lineStyle(3, 0x2d3528).strokeEllipse(barrel.x, barrel.y - 7, 24, 10);
				g.lineStyle(2, 0x313c2c).strokeEllipse(barrel.x, barrel.y - 23, 24, 9);
				g.fillStyle(0xb7a372).fillRect(barrel.x - 5, barrel.y - 21, 8, 8);
			});

			this.roomHotspot("storage", "СКЛАД", { x: 191, y: 160 }, iso(1.8, 4.1, 29));
			this.roomHotspot("radio", "РАДИОУЗЕЛ", { x: 211, y: 274 }, iso(3.4, 7.7, 28));
			this.roomHotspot("medbay", "МЕДПУНКТ", { x: 683, y: 302 }, iso(10, 5.9, 20));
			this.roomHotspot("workshop", "МАСТЕРСКАЯ", { x: 439, y: 397 }, iso(7.6, 9.5, 28));
			this.createScav(5.3, 5.1, 0x748363, { u: 8.8, v: 5.2 }, 7000);
			this.createScav(5, 8.6, 0x9b8356, { u: 3.2, v: 5.6 }, 9000);
			this.createScav(8.3, 8, 0x606f62, { u: 7, v: 6.3 }, 6500);
			this.createScav(3.7, 4.4, 0x7d7258, { u: 5.1, v: 3.3 }, 8100);
			this.createScav(9.2, 7, 0x7d7959, { u: 9.5, v: 5.7 }, 7400);
			this.createScav(4.7, 10.2, 0x596f60, { u: 5.9, v: 8.6 }, 8900);
			this.createScav(6.6, 3.8, 0x827764, { u: 4.8, v: 4.7 }, 7600);

			for (const data of [
				{ u: 3.4, v: 3.2 },
				{ u: 8.9, v: 5.8 },
				{ u: 6.1, v: 9.1 },
			])
				this.lamp(data.u, data.v);
			const dust = random(811);
			for (let n = 0; n < 30; n++) {
				const mote = this.add
					.rectangle(
						170 + dust() * 490,
						115 + dust() * 250,
						n % 3 ? 1 : 2,
						1,
						0xf4ca80,
						0.15 + dust() * 0.15
					)
					.setDepth(950);
				this.baseLayer.add(mote);
				if (!reducedMotion) this.tweens.add({
					targets: mote,
					x: mote.x + 12,
					y: mote.y - 22,
					alpha: 0.03,
					duration: 3000 + dust() * 5000,
					yoyo: true,
					repeat: -1,
					delay: dust() * 4000,
				});
			}
			// Top and bottom edges form a vignette without a shader or external asset.
			this.object(1000, (g) => {
				for (let n = 0; n < 18; n++) {
					g.fillStyle(C.void, 0.03 + n * 0.003).fillRect(0, n * 2, WIDTH, 2);
					g.fillStyle(C.void, 0.018 + n * 0.004).fillRect(
						0,
						HEIGHT - n * 2 - 2,
						WIDTH,
						2
					);
				}
				g.lineStyle(1, 0x747652, 0.14).strokeRect(
					18,
					18,
					WIDTH - 36,
					HEIGHT - 36
				);
			});
			this.baseCaption = this.text(
				30,
				31,
				"УБЕЖИЩЕ · УРОВЕНЬ 1",
				14,
				"#d3c6a2"
			).setDepth(1100);
			this.baseLayer.add(this.baseCaption);
			this.baseLayer.add(
				this.text(
					30,
					436,
					"ОБЪЕКТЫ И ДИКИЕ ДОСТУПНЫ ПО НАЖАТИЮ",
					11,
					"#a5ac8e"
				).setDepth(1100)
			);
			this.baseLayer.sort("depth");
		}

		private roomHotspot(room: BaseRoom, name: string, at: Point, target: Point): void {
			const leader = this.add.graphics().setDepth(1040);
			line(leader, [target, { x: at.x, y: target.y }, at], 0xd0b07b, 1, 0.46);
			leader.fillStyle(0xf0c985).fillCircle(target.x, target.y, 2.5);
			this.baseLayer.add(leader);
			const label = this.text(0, 0, `${name} · 1 ↗`, 15, "#ddd2af").setOrigin(0.5);
			const width = label.width + 28;
			const surface = this.add.graphics();
			const draw = (hovered: boolean): void => {
				surface.clear().fillStyle(0x090f0b, 0.4).fillRoundedRect(-width / 2 + 2, -17 + 4, width, 34, 5);
				surface.fillStyle(hovered ? 0x3c4030 : 0x18231a, 0.97).fillRoundedRect(-width / 2, -17, width, 34, 5);
				surface.lineStyle(hovered ? 2 : 1, hovered ? C.gold : 0x667153, hovered ? 1 : 0.8).strokeRoundedRect(-width / 2, -17, width, 34, 5);
				label.setColor(hovered ? "#ffe3ae" : "#ddd2af");
				leader.setAlpha(hovered ? 1 : 0.7);
			};
			draw(false);
			const zone = this.add.zone(0, 0, width, 42).setInteractive({ useHandCursor: true });
			zone.on("pointerover", () => { if (requestedView === "base") draw(true); });
			zone.on("pointerout", () => draw(false));
			zone.on("pointerdown", () => {
				if (requestedView !== "base") return;
				draw(true);
				this.clickFeedback(at, this.baseLayer);
				interactions.onRoom?.(room);
			});
			this.baseLayer.add(this.add.container(at.x, at.y, [surface, label, zone]).setDepth(1050));
			this.roomLabels.set(room, label);
		}

		private clickFeedback(at: Point, layer: Phaser.GameObjects.Container): void {
			const ring = this.add.circle(at.x, at.y, 15).setStrokeStyle(2, C.light, 0.85).setDepth(1500);
			layer.add(ring);
			this.tweens.add({
				targets: ring, scale: reducedMotion ? 1 : 2.2, alpha: 0,
				duration: reducedMotion ? 80 : 320,
				onComplete: () => ring.destroy(),
			});
		}

		private createScav(
			u: number,
			v: number,
			coat: number,
			target: { u: number; v: number },
			duration: number
		): void {
			const p = iso(u, v),
				destination = iso(target.u, target.v);
			const actor = this.add.container(p.x, p.y).setDepth(p.y + 3);
			const body = this.add.container(0, 0);
			const shadow = this.add.ellipse(0, 1, 21, 9, 0x070b07, 0.45);
			const selection = this.add.ellipse(0, 1, 34, 15).setStrokeStyle(2, C.gold).setVisible(false);
			const legA = this.add.rectangle(-4, -5, 5, 11, 0x242d22);
			const legB = this.add.rectangle(4, -5, 5, 11, 0x293328);
			const graphic = this.add.graphics();
			graphic.fillStyle(0x4b4f36).fillRect(-9, -27, 5, 16);
			graphic.fillStyle(coat).fillRect(-7, -27, 14, 15);
			graphic.fillStyle(0x3c4935).fillRect(-5, -24, 10, 12);
			graphic.fillStyle(0xb0a179).fillRect(-4, -22, 3, 6);
			graphic.fillStyle(0xa49262).fillRect(1, -22, 3, 6);
			graphic.fillStyle(0xbdab7f).fillRect(-5, -37, 10, 10);
			graphic.fillStyle(0x263529).fillRect(-6, -38, 12, 5);
			graphic.fillStyle(0x1c241d).fillRect(1, -33, 3, 2);
			graphic.fillStyle(coat).fillRect(5, -25, 5, 10);
			graphic.fillStyle(0xbea87b).fillRect(7, -17, 4, 4);
			rifle(graphic, 6, -16, 0.41, false);
			const gear = this.add.graphics();
			body.add([legA, legB, graphic, gear]);
			const label = this.text(0, -57, "", 14, "#f0dbac").setOrigin(0.5)
				.setBackgroundColor("#162219").setPadding(7, 4).setVisible(false);
			const order = this.add.circle(-14, -33, 4, C.sage).setStrokeStyle(1, 0x19261a).setVisible(false);
			const index = this.scavs.length;
			const hit = this.add.zone(0, -24, 46, 64).setInteractive({ useHandCursor: true });
			hit.on("pointerover", () => {
				const slot = this.scavs[index];
				if (requestedView !== "base" || !slot) return;
				slot.hovered = true;
				selection.setVisible(true);
				label.setVisible(true);
			});
			hit.on("pointerout", () => {
				const slot = this.scavs[index];
				if (!slot) return;
				slot.hovered = false;
				const selected = snapshot().selectedScavId === snapshot().scavs?.[index]?.id;
				selection.setVisible(Boolean(selected));
				label.setVisible(Boolean(selected));
			});
			hit.on("pointerdown", () => {
				const scav = snapshot().scavs?.[index];
				if (requestedView !== "base" || !scav) return;
				this.clickFeedback({ x: actor.x, y: actor.y - 20 }, this.baseLayer);
				interactions.onScav?.(scav.id);
			});
			actor.add([shadow, selection, body, label, order, hit]);
			this.baseLayer.add(actor);
			const motion = [
				this.tweens.add({
					targets: legA,
					y: -2,
					duration: 200,
					yoyo: true,
					repeat: -1,
				}),
				this.tweens.add({
					targets: legB,
					y: -8,
					duration: 200,
					yoyo: true,
					repeat: -1,
				}),
				this.tweens.add({
					targets: body,
					y: -1.2,
					duration: 400,
					yoyo: true,
					repeat: -1,
				}),
				this.tweens.add({
					targets: actor,
					x: destination.x,
					y: destination.y,
					duration,
					ease: "Sine.easeInOut",
					yoyo: true,
					repeat: -1,
					delay: u * 210,
					onYoyo: () => body.setScale(-1, 1),
					onRepeat: () => body.setScale(1, 1),
				}),
			];
			this.scavs.push({ actor, motion, gear, label, order, selection, hovered: false, gearSignature: "" });
		}

		private lamp(u: number, v: number): void {
			const p = iso(u, v);
			const glow = this.add
				.image(p.x, p.y - 7, "prapor-light")
				.setScale(1.28, 0.64)
				.setBlendMode(Phaser.BlendModes.ADD)
				.setAlpha(0.47)
				.setDepth(p.y - 2);
			this.baseLayer.add(glow);
			const cone = this.add.graphics().setDepth(820);
			polygon(
				cone,
				[
					{ x: p.x, y: p.y - 85 },
					{ x: p.x - 62, y: p.y + 17 },
					{ x: p.x + 62, y: p.y + 17 },
				],
				0xe8b85e,
				0.028
			);
			line(
				cone,
				[
					{ x: p.x, y: p.y - 119 },
					{ x: p.x, y: p.y - 86 },
				],
				0x10180f,
				2
			);
			polygon(
				cone,
				[
					{ x: p.x - 10, y: p.y - 88 },
					{ x: p.x - 5, y: p.y - 98 },
					{ x: p.x + 5, y: p.y - 98 },
					{ x: p.x + 10, y: p.y - 88 },
				],
				0x696c50
			);
			cone.fillStyle(C.light).fillEllipse(p.x, p.y - 87, 17, 5);
			this.baseLayer.add(cone);
			const halo = this.add
				.image(p.x, p.y - 86, "prapor-light")
				.setScale(0.39)
				.setAlpha(0.67)
				.setBlendMode(Phaser.BlendModes.ADD)
				.setDepth(825);
			this.baseLayer.add(halo);
			if (!reducedMotion) this.tweens.add({
				targets: [glow, halo],
				alpha: "+=0.07",
				duration: 1700 + u * 97,
				yoyo: true,
				repeat: -1,
				ease: "Sine.easeInOut",
			});
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
			this.lastSelection = `${state.selectedScavId ?? ""}:${state.selectedMapId ?? ""}`;
			this.baseCaption.setText(`УБЕЖИЩЕ · УРОВЕНЬ ${state.level}`);
			const names: Record<BaseRoom, string> = {
				storage: "СКЛАД", radio: "РАДИОУЗЕЛ", medbay: "МЕДПУНКТ", workshop: "МАСТЕРСКАЯ",
			};
			for (const [room, label] of this.roomLabels)
				label.setText(`${names[room]} · ${state.base[room] ?? 1} ↗`);
			this.operationsCaption.setText(
				`В РЕЙДЕ: ${state.raids.length}  ·  ЖДУТ ПРИКАЗ: ${state.raids.filter((raid) => raid.expedition?.status === "choice").length}`
			);
			this.scavs.forEach((slot, index) => {
				const { actor, motion, gear, label, order, selection } = slot;
				const scav = state.scavs?.[index];
				const visible =
					state.scavs === undefined
						? index < 3
						: Boolean(scav && scav.status !== "raiding");
				const moving = !reducedMotion && visible && (!scav || scav.status === "ready");
				actor.setVisible(visible);
				const selected = Boolean(scav && state.selectedScavId === scav.id);
				selection.setVisible(selected || slot.hovered).setStrokeStyle(2, selected ? C.light : C.gold);
				label.setText(`${scav?.name?.toLocaleUpperCase("ru-RU") ?? ""}${scav?.status === "wounded" ? " · РАНЕН" : ""}`)
					.setVisible(selected || slot.hovered);
				order.setVisible(Boolean(scav?.autoRaid?.enabled));
				order.setFillStyle(scav?.autoRaid?.waitingReason ? C.gold : C.sage);
				const armor = scav?.gear?.armor ?? 0;
				const backpack = scav?.gear?.backpack ?? 0;
				const gearSignature = `${armor}:${backpack}`;
				if (slot.gearSignature !== gearSignature) {
					slot.gearSignature = gearSignature;
					gear.clear();
					if (backpack) {
						gear
							.fillStyle(0x776743)
							.fillRect(-12, -26, 5 + backpack, 14 + backpack);
						gear
							.lineStyle(1, 0xa79664)
							.strokeRect(-12, -26, 5 + backpack, 14 + backpack);
					}
					if (armor) {
						gear
							.fillStyle(armor > 1 ? 0x606d4e : 0x465640)
							.fillRect(-5, -25, 9, 10);
						gear.fillStyle(0xa8aa7e).fillRect(-4, -24, armor, 2);
						gear.lineStyle(1, 0x263525).strokeRect(-5, -25, 9, 10);
					}
				}
				actor.setAlpha(
					scav?.status === "wounded"
						? 0.7
						: scav
							? 0.65 + (Phaser.Math.Clamp(scav.health, 0, 100) / 100) * 0.35
							: 1
				);
				for (const tween of motion) {
					if (moving && tween.isPaused()) tween.resume();
					else if (!moving && !tween.isPaused()) tween.pause();
				}
			});
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
			if (time - this.lastSync > 1000 || `${selection.selectedScavId ?? ""}:${selection.selectedMapId ?? ""}` !== this.lastSelection) {
				this.lastSync = time;
				this.syncSnapshot();
			}
			if (requestedView === "base") {
				for (const { actor } of this.scavs) actor.setDepth(actor.y + 3);
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
