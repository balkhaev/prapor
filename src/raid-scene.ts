import Phaser from "phaser";
import { MODULE_BY_ID, type Raid, type RaidReport, type WeaponInstance } from "./game/engine";
import { WEAPON_BY_ID } from "./game/data";
import { getRaidFieldFrame, getRaidFieldObjective, getRaidFieldPlan, projectRaidFieldPoint, readRaidFieldCamera, type RaidFieldCameraState } from "./raid-field";
import { advanceScavAnimation, createScavAnimation, type ScavAnimationState } from "./shelter-animation";
import { SCAV_ORIGIN, SCAV_POSES, SCAV_REFERENCE_HEIGHT, scavAppearance, scavAttachment, scavDirection, scavFrame, scavTexture, type ScavDirection } from "./scav-isometric";
import type { ShelterCamera, ShelterViewport } from "./shelter-camera";

type Point = { x: number; y: number };
type Plan = ReturnType<typeof getRaidFieldPlan>;
type Frame = ReturnType<typeof getRaidFieldFrame>;
export interface RaidStreetSnapshot { raids: Raid[]; selectedRaidId?: string | null; history?: RaidReport[]; weapons?: WeaponInstance[]; scavs?: { id: string; personality?: string }[] }
type Pawn = { root: Phaser.GameObjects.Container; body: Phaser.GameObjects.Container; poses: Phaser.GameObjects.Image[]; weapon: Phaser.GameObjects.Graphics; animation: ScavAnimationState; point: Point | null; appearance: number; direction: ScavDirection };
type Occluder = { object: Phaser.GameObjects.Container; x: number; y: number; width: number; height: number };
const clamp = Phaser.Math.Clamp;
const color = (value: string | number, fallback = 0x596355) => typeof value === "number" ? value : Number.parseInt(value.replace(/^#/, ""), 16) || fallback;
const mix = (a: number, b: number, amount: number) => {
	const c = (shift: number) => Math.round((a >> shift & 255) * (1 - amount) + (b >> shift & 255) * amount);
	return c(16) << 16 | c(8) << 8 | c(0);
};
const polygon = (g: Phaser.GameObjects.Graphics, points: Point[], tint: number, alpha = 1) => g.fillStyle(tint, alpha).fillPoints(points, true);
const line = (g: Phaser.GameObjects.Graphics, points: Point[], tint: number, width = 1, alpha = 1) => g.lineStyle(width, tint, alpha).strokePoints(points, false);
function random(seed: number): () => number { let n = seed >>> 0; return () => { n = Math.imul(n, 1664525) + 1013904223 >>> 0; return n / 4294967296; }; }

/** Read-only street presentation. All movement/action phases come from the paid raid's timeline. */
export class RaidStreetRenderer {
	readonly layer: Phaser.GameObjects.Container;
	private world: Phaser.GameObjects.Container;
	private hud: Phaser.GameObjects.Container;
	private effects: Phaser.GameObjects.Graphics;
	private title: Phaser.GameObjects.Text;
	private caption: Phaser.GameObjects.Text;
	private mini: Phaser.GameObjects.Graphics;
	private progress: Phaser.GameObjects.Graphics;
	private viewport: ShelterViewport;
	private camera: ShelterCamera = { zoom: 1.8, x: 0, y: 0 };
	private following = true;
	private pendingCamera: RaidFieldCameraState | null = null;
	private selectedId: string | null = null;
	private cachedRaid: Raid | null = null;
	private plan: Plan | null = null;
	private projection = { originX: 800, originY: 110, tileWidth: 64, tileHeight: 32, elevationScale: 26 };
	private bounds = { width: 1800, height: 1000 };
	private pawn: Pawn | null = null;
	private enemies: Pawn[] = [];
	private occluders: Occluder[] = [];
	private loot = new Map<string, { root: Phaser.GameObjects.Container; mark: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
	private groundMinimap: Phaser.GameObjects.Graphics;
	private report: RaidReport | null = null;
	private carriedWeapon: WeaponInstance | null = null;
	private builtRaidId: string | null = null;
	private planInput = "";
	private weaponCache = new WeakMap<Phaser.GameObjects.Graphics, string>();

	constructor(private scene: Phaser.Scene, viewport: ShelterViewport, private reducedMotion: boolean) {
		this.viewport = { ...viewport };
		this.world = scene.add.container(0, 0);
		this.hud = scene.add.container(0, 0);
		this.layer = scene.add.container(0, 0, [this.world, this.hud]).setVisible(false);
		this.effects = scene.add.graphics().setDepth(10000);
		this.world.add(this.effects);
		this.title = this.text(23, 52, "УЛИЦЫ · НАБЛЮДЕНИЕ", 17).setShadow(0, 2, "#091411", 3, true, true);
		this.caption = this.text(23, 75, "Выбери бойца в активном рейде", 12, "#c6d0b9").setShadow(0, 2, "#07140e", 2, true, true);
		this.mini = scene.add.graphics(); this.groundMinimap = scene.add.graphics(); this.progress = scene.add.graphics();
		this.hud.add([this.title, this.caption, this.groundMinimap, this.mini, this.progress]);
		this.resize(viewport);
	}

	private text(x: number, y: number, text: string, size = 12, tint = "#eee3c5") {
		return this.scene.add.text(x, y, text, { fontFamily: "Manrope, sans-serif", fontSize: `${size}px`, fontStyle: "bold", color: tint, resolution: Math.min(window.devicePixelRatio || 1, 2) });
	}
	private project(point: { x: number; y: number; z?: number }): Point { return projectRaidFieldPoint(point, this.projection); }
	private quad(x: number, y: number, width = 1, height = 1, z = 0): Point[] { return [{ x, y, z }, { x: x + width, y, z }, { x: x + width, y: y + height, z }, { x, y: y + height, z }].map((p) => this.project(p)); }
	selectRaid(id: string | null): void { if (id !== this.selectedId) { this.selectedId = id; this.cachedRaid = null; this.carriedWeapon = null; this.report = null; this.following = true; this.pendingCamera = null; } }
	reset(): void {
		this.world.removeAll(true); this.plan = null; this.planInput = ""; this.builtRaidId = null; this.selectedId = null; this.cachedRaid = null; this.carriedWeapon = null; this.report = null; this.pawn = null; this.enemies = []; this.loot.clear(); this.occluders = []; this.pendingCamera = null;
		this.groundMinimap.clear(); this.mini.clear(); this.progress.clear(); this.title.setText("УЛИЦЫ · НАБЛЮДЕНИЕ");
	}
	getCameraState(): ShelterCamera & { following: boolean } { return this.pendingCamera ? { ...this.pendingCamera } : { ...this.camera, following: this.following }; }
	/** The first real frame owns pawn placement; apply persisted camera only after that placement. */
	restoreCamera(value: unknown): void {
		const camera = readRaidFieldCamera(value);
		if (!camera) return;
		this.pendingCamera = camera;
		if (this.plan && this.pawn?.point) this.applyRestoredCamera();
	}
	private applyRestoredCamera(): void {
		if (!this.pendingCamera) return;
		const { following, ...camera } = this.pendingCamera; this.pendingCamera = null;
		this.camera = camera; this.following = following;
		if (following) this.follow(1);
		this.applyCamera();
	}
	setFollow(enabled: boolean): void { this.following = enabled; if (enabled && this.pawn) this.follow(1); this.applyCamera(); }
	resetCamera(): void { this.pendingCamera = null; this.camera.zoom = 1.8; this.setFollow(true); }
	resize(viewport: ShelterViewport): void {
		const center = { x: this.camera.x + this.viewport.width / this.camera.zoom / 2, y: this.camera.y + this.viewport.height / this.camera.zoom / 2 };
		this.viewport = { ...viewport }; this.camera.x = center.x - viewport.width / this.camera.zoom / 2; this.camera.y = center.y - viewport.height / this.camera.zoom / 2;
		this.groundMinimap.setPosition(viewport.width - 181, viewport.height - 172); this.mini.setPosition(viewport.width - 181, viewport.height - 172);
		this.progress.setPosition(23, viewport.height - 53); if (this.following) this.follow(1); this.applyCamera();
	}
	zoomBy(factor: number, at?: Point): void {
		if (!Number.isFinite(factor) || factor <= 0 || at && (!Number.isFinite(at.x) || !Number.isFinite(at.y))) return;
		const anchor = at ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
		const world = { x: this.camera.x + anchor.x / this.camera.zoom, y: this.camera.y + anchor.y / this.camera.zoom };
		this.camera.zoom = clamp(this.camera.zoom * factor, .7, 4);
		this.camera.x = world.x - anchor.x / this.camera.zoom; this.camera.y = world.y - anchor.y / this.camera.zoom;
		if (at) this.following = false; else if (this.following) this.follow(1);
		this.applyCamera();
	}
	panBy(dx: number, dy: number): void { if (!Number.isFinite(dx) || !Number.isFinite(dy)) return; this.following = false; this.camera.x += dx / this.camera.zoom; this.camera.y += dy / this.camera.zoom; this.applyCamera(); }
	private applyCamera(): void {
		// A valid raid position may sit at the map edge. Following keeps that
		// position framed instead of pushing the pawn behind the minimap.
		if (!this.following) {
			const axis = (at: number, size: number, visible: number) => clamp(at, -visible * .65, size - visible * .35);
			this.camera.x = axis(this.camera.x, this.bounds.width, this.viewport.width / this.camera.zoom); this.camera.y = axis(this.camera.y, this.bounds.height, this.viewport.height / this.camera.zoom);
		}
		this.world.setScale(this.camera.zoom).setPosition(-this.camera.x * this.camera.zoom, -this.camera.y * this.camera.zoom);
	}
	private follow(amount: number): void {
		if (!this.pawn) return;
		const x = this.pawn.root.x - this.viewport.width / this.camera.zoom / 2, y = this.pawn.root.y - this.viewport.height / this.camera.zoom * .59;
		if (amount >= 1) { this.camera.x = x; this.camera.y = y; }
		else { this.camera.x += (x - this.camera.x) * amount; this.camera.y += (y - this.camera.y) * amount; }
	}

	private build(plan: Plan, raid: Raid, appearance: number): void {
		const newRaid = this.builtRaidId !== raid.id;
		this.world.removeAll(true); this.occluders = []; this.loot.clear(); this.enemies = [];
		this.plan = plan;
		this.projection.originX = plan.height * 32 + 160;
		this.bounds = { width: (plan.width + plan.height) * 32 + 320, height: (plan.width + plan.height) * 16 + 290 };
		const ground = this.scene.add.graphics().setDepth(-1000), rng = random(plan.seed);
		this.world.add(ground);
		polygon(ground, this.quad(-1, -1, plan.width + 2, plan.height + 2), mix(color(plan.theme.ground), 0x071715, .34));
		const streets = new Set(plan.tiles.filter((tile) => tile.kind === "street").map((tile) => `${tile.x}:${tile.y}`));
		for (const tile of plan.tiles) {
			const points = this.quad(tile.x, tile.y), p = this.project({ x: tile.x + .5, y: tile.y + .5 });
			const base = tile.kind === "street" ? mix(color(plan.theme.road, 0x343c39), 0x22332e, .35) : tile.kind === "sidewalk" ? 0x7e8376 : color(plan.theme.ground);
			polygon(ground, points, mix(base, rng() > .5 ? 0x172723 : 0xaaa491, .04 + rng() * .055));
			if (tile.kind === "sidewalk") { line(ground, [points[1]!, points[2]!, points[3]!], 0xb6b5a1, 1.2, .4); line(ground, [points[0]!, points[1]!], 0x172723, 1.8, .6); }
			if (tile.kind === "street" && (tile.x + tile.y) % 3 === 0) {
				const horizontal = streets.has(`${tile.x + 1}:${tile.y}`) || streets.has(`${tile.x - 1}:${tile.y}`), vertical = streets.has(`${tile.x}:${tile.y + 1}`) || streets.has(`${tile.x}:${tile.y - 1}`);
				if (!(horizontal && vertical)) line(ground, [{ x: p.x - 5, y: p.y + (horizontal ? -2.5 : 2.5) }, { x: p.x + 5, y: p.y + (horizontal ? 2.5 : -2.5) }], 0xd0c7a0, 1.4, .35);
			}
			for (let n = 0; n < 3; n++) ground.fillStyle(tile.kind === "street" ? 0x101d1a : 0x243c2e, .22).fillEllipse(p.x + (rng() - .5) * 32, p.y + (rng() - .5) * 15, 1 + rng() * 5, 1 + rng() * 2);
			if (tile.kind === "yard" && rng() > .55) { line(ground, [{ x: p.x, y: p.y }, { x: p.x - 2, y: p.y - 5 }, { x: p.x + 2, y: p.y - 1 }, { x: p.x + 3, y: p.y - 7 }], 0x87926d, 1.2, .5); }
		}
		for (const building of plan.buildings) this.buildBuilding(building);
		for (const prop of plan.props) this.buildProp(prop);
		for (const spot of plan.lootSpots) {
			// Keep the search caption above the full character silhouette at the crate.
			const p = this.project(spot), mark = this.scene.add.graphics(), label = this.text(0, -65, spot.label, 11).setOrigin(.5).setBackgroundColor("#12231ce8").setPadding(5, 3);
			const box = this.scene.add.container(p.x, p.y).setDepth(p.y);
			if (this.scene.textures.exists("raid-props")) { const image = this.scene.add.image(0, 0, "raid-props", "crates").setOrigin(.5, 1); image.setScale(29 / image.width); box.add(image); }
			else { const crate = this.scene.add.graphics(); polygon(crate, [{ x: -11, y: -5 }, { x: 0, y: -11 }, { x: 12, y: -5 }, { x: 0, y: 2 }], 0x8e8761); polygon(crate, [{ x: -11, y: -5 }, { x: 0, y: 2 }, { x: 0, y: -10 }, { x: -11, y: -17 }], 0x5e6347); box.add(crate); }
			this.world.add(box);
			const root = this.scene.add.container(p.x, p.y, [mark, label]).setDepth(9000).setVisible(false);
			this.world.add(root); this.loot.set(spot.id, { root, mark, label });
		}
		const entry = this.project(plan.entry), checkpoint = this.project(plan.checkpoint), gates = this.scene.add.graphics().setDepth(-900);
		for (const [p, tint] of [[entry, 0x98b7a0], [checkpoint, 0xe1c590]] as const) { gates.lineStyle(2, tint, .7).strokeEllipse(p.x, p.y, 36, 17); line(gates, [{ x: p.x - 13, y: p.y }, { x: p.x + 13, y: p.y }], tint, 1, .5); }
		this.world.add(gates);
		this.pawn = this.makePawn(appearance, false); this.pawn.root.setPosition(entry.x, entry.y);
		this.effects = this.scene.add.graphics().setDepth(10000); this.world.add(this.effects);
		this.drawMiniGround(); if (newRaid) { this.camera = { zoom: 1.8, x: 0, y: 0 }; this.following = true; }
		this.builtRaidId = raid.id; if (this.following) this.follow(1); this.applyCamera();
	}

	private buildBuilding(building: Plan["buildings"][number]): void {
		const base = this.quad(building.x, building.y, building.width, building.height), top = this.quad(building.x, building.y, building.width, building.height, building.elevation);
		const tint = color(building.color), roof = color(building.roof), g = this.scene.add.graphics();
		const front = base[2]!, root = this.scene.add.container(0, 0, [g]).setDepth(front.y);
		let renderedHeight = building.elevation * 26 + (building.width + building.height) * 16;
		polygon(g, base.map((p) => ({ x: p.x + 12, y: p.y + 7 })), 0x081612, .33);
		const frames: Record<string, string> = { cabin: "cottage", apartments: "cottage", garage: "garage", warehouse: "factory", factory: "factory", hangar: "factory", bunker: "garage", trees: "cottage" };
		const frame = building.kind === "apartments" && building.id.endsWith("-1") ? "shop" : frames[building.kind] ?? "cottage";
		if (building.kind === "trees") {
			const rng = random(Math.floor(building.x * 173 + building.y * 821));
			for (let n = 0; n < 7; n++) {
				const p = this.project({ x: building.x + rng() * building.width, y: building.y + rng() * building.height }), height = 46 + rng() * 35;
				line(g, [{ x: p.x, y: p.y }, { x: p.x, y: p.y - height }], 0x4f4934, 3);
				for (let tier = 0; tier < 4; tier++) { const y = p.y - 20 - tier * 14, w = 31 - tier * 5; polygon(g, [{ x: p.x - w, y }, { x: p.x, y: y - 32 }, { x: p.x + w, y }], tier % 2 ? 0x3f5c40 : 0x314e3a); line(g, [{ x: p.x - w, y }, { x: p.x, y: y - 32 }], 0x96a47c, .7, .3); }
			}
			renderedHeight = 110;
		} else if (this.scene.textures.exists("raid-props") && this.scene.textures.get("raid-props").has(frame)) {
			const image = this.scene.add.image((base[1]!.x + base[3]!.x) / 2, front.y + 2, "raid-props", frame).setOrigin(.5, 1);
			image.setScale((building.width + building.height) * 32 / image.width); renderedHeight = image.displayHeight; root.add(image);
		} else {
			polygon(g, [base[1]!, base[2]!, top[2]!, top[1]!], mix(tint, 0x101e1a, .32));
			polygon(g, [base[3]!, base[2]!, top[2]!, top[3]!], tint);
			polygon(g, top, roof); line(g, [...top, top[0]!], mix(roof, 0xc4c0a5, .4), 1.8, .8);
			const h = building.elevation * 26;
			for (const side of [[base[3]!, base[2]!], [base[1]!, base[2]!]]) {
				const a = side[0]!, b = side[1]!, count = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 27));
				for (let row = 0; row < Math.max(1, Math.floor(h / 24)); row++) for (let n = 0; n < count; n++) {
					const t = (n + .5) / count, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t - 13 - row * 24;
					polygon(g, [{ x: x - 5, y: y - 3 }, { x: x + 5, y: y + 2 }, { x: x + 5, y: y - 11 }, { x: x - 5, y: y - 16 }], 0x172925);
					line(g, [{ x: x - 5, y: y - 3 }, { x: x + 5, y: y + 2 }], 0xc9c4aa, 1.4, .6);
					if ((n + row) % 3 === 0) polygon(g, [{ x: x - 3, y: y - 5 }, { x: x + 3, y: y - 2 }, { x: x + 3, y: y - 10 }, { x: x - 3, y: y - 13 }], 0xe5c78a, .47);
				}
				for (let row = 0; row < h; row += 13) line(g, [{ x: a.x, y: a.y - row }, { x: b.x, y: b.y - row }], mix(tint, 0x0d211b, .3), .65, .35);
			}
			const door = { x: (base[3]!.x + base[2]!.x) / 2, y: (base[3]!.y + base[2]!.y) / 2 };
			polygon(g, [{ x: door.x - 7, y: door.y - 4 }, { x: door.x + 7, y: door.y + 3 }, { x: door.x + 7, y: door.y - 21 }, { x: door.x - 7, y: door.y - 28 }], 0x28342d);
			g.fillStyle(0xd3bf8e).fillCircle(door.x + 4, door.y - 10, 1);
			line(g, [top[1]!, top[2]!], 0x121e1b, 4, .75);
		}
		this.world.add(root);
		this.occluders.push({ object: root, x: (base[1]!.x + base[3]!.x) / 2, y: front.y, width: (building.width + building.height) * 32, height: renderedHeight });
	}

	private buildProp(prop: Plan["props"][number]): void {
		const p = this.project(prop), g = this.scene.add.graphics(), root = this.scene.add.container(p.x, p.y, [g]).setDepth(p.y);
		g.fillStyle(0x07130f, .4).fillEllipse(3, 3, prop.kind === "car" ? 58 : 28, prop.kind === "car" ? 20 : 11);
		const frames: Record<string, string> = { car: "car", barrel: "barrels", crate: "crates", barrier: "barricade", sandbags: "barricade" };
		const frame = frames[prop.kind];
		if (frame && this.scene.textures.exists("raid-props") && this.scene.textures.get("raid-props").has(frame)) {
			const image = this.scene.add.image(0, 4, "raid-props", frame).setOrigin(.5, 1); image.setScale((prop.kind === "car" ? 58 : prop.kind === "barrier" || prop.kind === "sandbags" ? 59 : 39) / image.width); root.add(image);
		} else if (prop.kind === "car") {
			polygon(g, [{ x: -28, y: -8 }, { x: 8, y: -25 }, { x: 32, y: -12 }, { x: -6, y: 8 }], 0x647469);
			polygon(g, [{ x: -19, y: -13 }, { x: 5, y: -25 }, { x: 20, y: -17 }, { x: -5, y: -4 }], 0x162923);
			polygon(g, [{ x: -28, y: -8 }, { x: -6, y: 8 }, { x: -6, y: 2 }, { x: -28, y: -14 }], 0x44554b);
			for (const x of [-18, 21]) g.fillStyle(0x101913).fillEllipse(x, 0, 10, 12).fillStyle(0x888876).fillEllipse(x, 0, 4, 5);
			line(g, [{ x: -19, y: -13 }, { x: 14, y: -5 }], 0x947351, 2, .6);
		} else if (prop.kind === "tree") {
			g.fillStyle(0x493e2e).fillRect(-2, -34, 4, 34);
			for (const [x, y, w] of [[0, -35, 32], [-10, -29, 25], [10, -28, 27], [0, -49, 22]]) g.fillStyle(0x31493a, .96).fillEllipse(x!, y!, w!, w! * .9);
		} else if (prop.kind === "lamp") {
			g.lineStyle(2, 0x394739).lineBetween(0, 1, 0, -58); line(g, [{ x: 0, y: -58 }, { x: 12, y: -55 }], 0x617465, 3);
			g.fillStyle(0xe9d5a0).fillEllipse(12, -54, 9, 4);
			polygon(g, [{ x: 9, y: -53 }, { x: -6, y: 1 }, { x: 29, y: 11 }, { x: 16, y: -52 }], 0xf0dbab, .05);
		} else if (prop.kind === "barrel") {
			g.fillStyle(0x66734f).fillEllipse(0, -19, 17, 8).fillRect(-8, -19, 16, 20).fillEllipse(0, 1, 16, 7); g.fillStyle(0x8a9375).fillEllipse(0, -19, 17, 7); line(g, [{ x: -8, y: -8 }, { x: 8, y: -8 }], 0x263a2c, 2);
		} else {
			polygon(g, [{ x: -16, y: -7 }, { x: 0, y: -15 }, { x: 17, y: -6 }, { x: 0, y: 3 }], prop.kind === "crate" ? 0x9c8960 : 0x8a9171);
			polygon(g, [{ x: -16, y: -7 }, { x: 0, y: 3 }, { x: 0, y: -14 }, { x: -16, y: -23 }], 0x695e41);
			polygon(g, [{ x: 0, y: 3 }, { x: 17, y: -6 }, { x: 17, y: -22 }, { x: 0, y: -14 }], 0x7e7956);
			line(g, [{ x: -13, y: -20 }, { x: -3, y: -5 }], 0xb2a27a, 2);
		}
		this.world.add(root);
	}

	private makePawn(appearance: number, hostile: boolean): Pawn {
		const body = this.scene.add.container(0, 0), shadow = this.scene.add.ellipse(0, 2, 23, 10, 0x071510, .62);
		const texture = scavTexture(appearance), metadata = this.scene.textures.get(texture).customData as { meta?: { characterHeight?: number } };
		const height = Number(metadata.meta?.characterHeight) || SCAV_REFERENCE_HEIGHT;
		const poses = SCAV_POSES.map((pose) => this.scene.add.image(0, 0, texture, scavFrame(pose, "se")).setOrigin(SCAV_ORIGIN.x, SCAV_ORIGIN.y).setScale(48 / height).setTint(hostile ? 0xaca08c : 0xffffff));
		const weapon = this.scene.add.graphics(); body.add(poses); body.add(weapon);
		const root = this.scene.add.container(0, 0, [shadow, body]); this.world.add(root);
		return { root, body, poses, weapon, animation: createScavAnimation(appearance * .31), point: null, appearance, direction: "se" };
	}
	private paintRifle(pawn: Pawn, aim: number | null, slung: boolean, hostile: boolean): void {
		const g = pawn.weapon, attachment = scavAttachment(pawn.direction, slung);
		const bearing = slung ? attachment.flipX ? -115 : -65 : aim ?? attachment.angle;
		g.setPosition(slung ? attachment.x * .45 : attachment.x, attachment.y - (slung ? 6 : 0)).setScale(attachment.flipX ? -1 : 1, 1).setAngle(bearing - (attachment.flipX ? 180 : 0) - pawn.body.angle);
		if (attachment.behind || slung) pawn.body.sendToBack(g); else pawn.body.bringToTop(g);
		const signature = hostile ? "enemy" : `${this.carriedWeapon?.weaponId ?? "unknown"}:${this.carriedWeapon?.modules.optic?.modelId ?? "none"}:${this.carriedWeapon?.modules.muzzle?.modelId ?? "none"}`;
		if (this.weaponCache.get(g) === signature) return;
		this.weaponCache.set(g, signature); g.clear();
		const model = !hostile && this.carriedWeapon ? WEAPON_BY_ID[this.carriedWeapon.weaponId] : null;
		g.setData("muzzleLength", model?.category === "pistol" ? 13 : model?.category === "sniper" ? 38 : model?.category === "smg" ? 22 : 31);
		if (model?.category === "pistol") {
			g.fillStyle(0x303c35).fillRect(-2, -3, 15, 4); polygon(g, [{ x: -1, y: 1 }, { x: 6, y: 1 }, { x: 4, y: 9 }, { x: -1, y: 8 }], 0x5c5744); g.fillStyle(0xbdc1a6).fillRect(10, -2, 4, 1); return;
		}
		const length = model?.category === "sniper" ? 38 : model?.category === "smg" ? 22 : 31;
		g.fillStyle(hostile ? 0x675a42 : 0x877044).fillRect(-9, -2, 9, 5);
		g.fillStyle(0x1a2521).fillRect(-1, -2, 17, 4).fillRect(3, 2, 4, model?.category === "shotgun" ? 3 : 8); g.fillStyle(0xa0ac9b).fillRect(15, -1, length - 15, 2).fillRect(length - 2, -4, 2, 4);
		if (model?.category === "shotgun") g.fillStyle(0x946b47).fillRect(10, 1, 13, 3);
		if (!hostile && this.carriedWeapon?.modules.optic) g.fillStyle(0x566354).fillRect(2, -7, 10, 4).fillStyle(0xb6c3af).fillRect(10, -6, 2, 2);
		const muzzle = !hostile && this.carriedWeapon?.modules.muzzle ? MODULE_BY_ID[this.carriedWeapon.modules.muzzle.modelId] : null;
		if (muzzle?.appearance === "suppressor") { g.fillStyle(0x38483e).fillRect(length - 1, -2, 11, 4); g.setData("muzzleLength", length + 10); }
		line(g, [{ x: 2, y: -3 }, { x: 10, y: -3 }], 0xafa990, 1);
	}
	private animatePawn(pawn: Pawn, point: Point, frame: Frame, delta: number, hostile = false): void {
		const before = pawn.point, distance = before ? Math.hypot(point.x - before.x, point.y - before.y) : 0;
		const searching = !hostile && frame.action === "search", fighting = frame.action === "skirmish" || frame.action === "cover", crouching = searching || fighting;
		const target = hostile ? this.pawn?.point ?? null : frame.enemyPositions[0] ? this.project(frame.enemyPositions[0]) : null;
		const pathDirection = this.project({ x: frame.position.x + frame.direction.x, y: frame.position.y + frame.direction.y });
		if (target && fighting) pawn.direction = scavDirection(target.x - point.x, target.y - point.y, pawn.direction);
		else if (!hostile) pawn.direction = scavDirection(pathDirection.x - point.x, pathDirection.y - point.y, pawn.direction);
		else if (before) pawn.direction = scavDirection(point.x - before.x, point.y - before.y, pawn.direction);
		const facing = pawn.direction === "sw" || pawn.direction === "nw" ? -1 : 1;
		const animation = advanceScavAnimation(pawn.animation, { distance, elapsedMs: delta, walking: frame.walking && !hostile, working: crouching, facing, role: searching ? "recycler" : "radio", workDone: frame.segmentProgress * 5, workRate: crouching && !frame.paused ? 1 : 0, jobId: crouching ? `search-${frame.segmentIndex}` : null, reducedMotion: this.reducedMotion });
		pawn.animation = animation.state; pawn.point = { ...point };
		pawn.root.setPosition(point.x, point.y).setDepth(point.y + .5);
		const pose = animation.pose, weights = [pose.weights.idle, pose.weights.walkA, pose.weights.walkB, pose.weights.work];
		pawn.poses.forEach((image, index) => image.setFrame(scavFrame(SCAV_POSES[index]!, pawn.direction)).setAlpha(weights[index]!).setVisible(weights[index]! > .001));
		pawn.body.setScale(1, crouching ? .94 : pose.scaleY).setAngle(pose.angle * facing);
		const aim = target && fighting ? Math.atan2(target.y - point.y, target.x - point.x) * 180 / Math.PI : null;
		this.paintRifle(pawn, aim, searching, hostile);
	}
	private gunMuzzle(pawn: Pawn): Point {
		const point = pawn.weapon.getWorldTransformMatrix().transformPoint(Number(pawn.weapon.getData("muzzleLength")) || 31, 0);
		return { x: point.x / this.camera.zoom + this.camera.x, y: point.y / this.camera.zoom + this.camera.y };
	}

	private drawMiniGround(): void {
		if (!this.plan) return;
		const g = this.groundMinimap, plan = this.plan; g.clear();
		g.fillStyle(0x101d18, .92).fillRoundedRect(0, 0, 157, 118, 7).lineStyle(1, 0x9d9979, .6).strokeRoundedRect(0, 0, 157, 118, 7);
		const sx = 139 / plan.width, sy = 94 / plan.height;
		for (const tile of plan.tiles) g.fillStyle(tile.kind === "street" ? 0x738478 : tile.kind === "sidewalk" ? 0x879280 : 0x394838, .65).fillRect(9 + tile.x * sx, 9 + tile.y * sy, sx, sy);
		for (const building of plan.buildings) g.fillStyle(0x1d2c23).fillRect(9 + building.x * sx, 9 + building.y * sy, building.width * sx, building.height * sy);
	}
	private updateMini(frame: Frame): void {
		if (!this.plan) return;
		const g = this.mini, sx = 139 / this.plan.width, sy = 94 / this.plan.height; g.clear();
		const current = this.plan.segments[frame.segmentIndex], travelled = this.plan.segments.slice(0, frame.segmentIndex).flatMap((segment) => segment.path);
		if (current) travelled.push(...current.path.slice(0, Math.floor((current.path.length - 1) * frame.segmentProgress) + 1));
		travelled.push(frame.position);
		if (travelled.length > 1) line(g, travelled.map((point) => ({ x: 9 + point.x * sx, y: 9 + point.y * sy })), 0xc8b17b, 1.5, .7);
		for (const spot of this.plan.lootSpots) if (frame.visitedLootIds.includes(spot.id)) g.fillStyle(0x9aad78).fillRect(7 + spot.x * sx, 7 + spot.y * sy, 3, 3);
		for (const enemy of frame.enemyPositions) g.fillStyle(0xde9875).fillCircle(9 + enemy.x * sx, 9 + enemy.y * sy, 2.2);
		g.fillStyle(0xffda93).fillCircle(9 + frame.position.x * sx, 9 + frame.position.y * sy, 3);
		g.lineStyle(1, 0xffe2ac, .5).strokeCircle(9 + frame.position.x * sx, 9 + frame.position.y * sy, 5);
	}

	update(snapshot: RaidStreetSnapshot, now: number, delta: number): void {
		const id = snapshot.selectedRaidId !== undefined ? snapshot.selectedRaidId ?? snapshot.raids[0]?.id ?? null : this.selectedId ?? snapshot.raids[0]?.id ?? null;
		if (id !== this.selectedId) this.selectRaid(id);
		const activeRaid = snapshot.raids.find((raid) => raid.id === id);
		const raid = activeRaid ?? (this.cachedRaid?.id === id ? this.cachedRaid : null);
		if (!raid) { this.world.setVisible(false); this.mini.clear(); this.groundMinimap.clear(); this.progress.clear(); this.title.setText("УЛИЦЫ · НАБЛЮДЕНИЕ"); this.caption.setText("Отправь бойца в рейд и выбери «Наблюдать»"); return; }
		this.world.setVisible(true);
		this.cachedRaid = raid;
		this.report = activeRaid ? null : snapshot.history?.find((report) => report.raidId === id) ?? (this.report?.raidId === id ? this.report : null);
		this.carriedWeapon = snapshot.weapons?.find((weapon) => weapon.id === raid.weaponInstanceId) ?? this.carriedWeapon;
		const input = `${raid.mapId}:${raid.seed}:${raid.expedition?.stage ?? 1}:${raid.expedition?.branch ?? "scavenge"}:${raid.tactic}`;
		const plan = this.plan && this.planInput === input ? this.plan : getRaidFieldPlan(raid); this.planInput = input;
		const scav = snapshot.scavs?.find((candidate) => candidate.id === raid.scavId);
		const identity = [...raid.scavId].reduce((value, character) => Math.imul(value, 31) + character.charCodeAt(0) | 0, 0);
		const appearance = scav ? scavAppearance(scav.personality, identity) : this.builtRaidId === raid.id && this.pawn ? this.pawn.appearance : scavAppearance(undefined, identity);
		if (this.plan?.id !== plan.id || this.builtRaidId !== raid.id) this.build(plan, raid, appearance);
		const frame = getRaidFieldFrame(raid, this.report ? raid.endsAt : now, plan);
		const objective = getRaidFieldObjective(raid, this.report ? raid.endsAt : now, plan);
		const point = this.project(frame.position);
		const firstFrame = !this.pawn!.point;
		this.animatePawn(this.pawn!, point, frame, Math.min(100, Math.max(0, delta)));
		this.pawn!.root.setVisible(!this.report?.lostScav);
		this.pawn!.weapon.setVisible(!this.report?.lostWeapon);
		while (this.enemies.length > frame.enemyPositions.length) this.enemies.pop()!.root.destroy(true);
		frame.enemyPositions.forEach((enemy, index) => {
			const actor = this.enemies[index] ?? this.makePawn(index + 2, true); if (!this.enemies[index]) this.enemies[index] = actor;
			this.animatePawn(actor, this.project(enemy), frame, Math.min(100, Math.max(0, delta)), true);
		});
		for (const occluder of this.occluders) {
			const behind = point.y < occluder.y && point.y > occluder.y - occluder.height && Math.abs(point.x - occluder.x) < occluder.width * .45;
			occluder.object.setAlpha(behind ? .45 : 1);
		}
		for (const [id, loot] of this.loot) {
			const visited = frame.visitedLootIds.includes(id), visible = frame.visibleLootIds.includes(id);
			const current = objective.searchTargetId === id && !this.report && !frame.paused;
			loot.root.setVisible(visible); loot.mark.clear(); loot.label.setVisible(visible && !visited).setText(current ? `ПОИСК · ${Math.floor(frame.segmentProgress * 100)}%` : this.plan!.lootSpots.find((spot) => spot.id === id)?.label ?? "Поиск");
			if (visible) {
				loot.mark.lineStyle(1.5, visited ? 0xaac78e : 0xebca82, .85).strokeEllipse(0, 0, 29, 14);
				if (visited) line(loot.mark, [{ x: -5, y: -2 }, { x: -1, y: 2 }, { x: 6, y: -5 }], 0xb5d096, 1.7);
				else if (current) loot.mark.lineStyle(2.8, 0xf0d19a, .95).beginPath().arc(0, -10, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frame.segmentProgress, false).strokePath();
				else polygon(loot.mark, [{ x: 0, y: -23 }, { x: -4, y: -29 }, { x: 4, y: -29 }], 0xf0d19a);
			}
		}
		this.effects.clear();
		if (!this.report && !frame.paused && frame.enemyPositions.length) {
			for (const enemy of frame.enemyPositions) {
				const target = this.project(enemy);
				this.effects.lineStyle(1.5, 0xd49b76, .75).strokeEllipse(target.x, target.y + 1, 29, 14);
				polygon(this.effects, [{ x: target.x, y: target.y - 54 }, { x: target.x - 5, y: target.y - 63 }, { x: target.x + 5, y: target.y - 63 }], 0xe7ab80);
			}
			if (frame.action === "cover") {
				// An observation/contact marker, not a simulated hit or future combat outcome.
				this.effects.lineStyle(3, 0xaac7b0, .8).strokeEllipse(point.x, point.y + 1, 38, 19);
				line(this.effects, [{ x: point.x - 13, y: point.y - 19 }, { x: point.x - 13, y: point.y - 34 }, { x: point.x + 13, y: point.y - 34 }, { x: point.x + 13, y: point.y - 19 }], 0xb8d3bc, 2, .75);
			}
		}
		if (!this.reducedMotion && frame.action === "skirmish" && !frame.paused && !this.report && frame.enemyPositions.length) {
			const target = this.project(frame.enemyPositions[0]!); const pulse = ((now - raid.startedAt) % 1600) / 1600;
			if (pulse < .045) { const muzzle = this.gunMuzzle(this.pawn!); line(this.effects, [muzzle, { x: target.x, y: target.y - 23 }], 0xfad395, 1.5, .72); this.effects.fillStyle(0xffe7b0, .95).fillCircle(muzzle.x, muzzle.y, 4); }
			if (pulse > .22 && pulse < .255 && this.enemies[0]) line(this.effects, [this.gunMuzzle(this.enemies[0]), { x: point.x, y: point.y - 23 }], 0xdfa383, 1, .7);
		}
		if (this.pawn!.root.visible) { this.effects.lineStyle(1.3, 0xf0d295, .6).strokeEllipse(point.x, point.y + 1, 29, 14); polygon(this.effects, [{ x: point.x, y: point.y - 57 }, { x: point.x - 4, y: point.y - 64 }, { x: point.x + 4, y: point.y - 64 }], 0xf0d295); }
		if (!this.reducedMotion && plan.theme.weather === "rain") for (let n = 0; n < 25; n++) { const x = this.camera.x + ((n * 137 + now / 60) % (this.viewport.width / this.camera.zoom)), y = this.camera.y + ((n * 91 + now / 10) % (this.viewport.height / this.camera.zoom)); line(this.effects, [{ x, y }, { x: x - 2, y: y + 6 }], 0xbac9c5, .7, .17); }
		if (this.pendingCamera) this.applyRestoredCamera();
		else if (this.following) this.follow(firstFrame || delta <= 0 || this.reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, 100) / 240));
		this.applyCamera(); this.world.sort("depth"); this.updateMini(frame);
		const status = this.report ? this.report.success ? "РЕЙД ЗАВЕРШЁН · ДОБЫЧА НА БАЗЕ" : "РЕЙД ЗАВЕРШЁН · СМОТРИ ОТЧЁТ"
			: objective.settling ? "КОНТРОЛЬНАЯ ТОЧКА · ОЖИДАЕТСЯ СВОДКА" : frame.paused ? "ЖДЁТ ПРИКАЗА · ДОБЫЧА ПРИ НЁМ"
			: `${objective.label}${frame.action === "search" ? ` · ${Math.floor(frame.segmentProgress * 100)}%` : frame.enemyPositions.length ? ` · КОНТАКТ ${frame.enemyPositions.length}` : ""}`;
		this.title.setText(`${raid.scavName} · Этап ${raid.expedition?.stage ?? 1} · ${plan.theme.label}`); this.caption.setText(status);
		this.progress.clear(); this.progress.fillStyle(0x0c1c16, .92).fillRoundedRect(0, 0, Math.min(350, this.viewport.width - 224), 10, 3).fillStyle(0xcbb580).fillRoundedRect(0, 0, Math.min(350, this.viewport.width - 224) * frame.progress, 10, 3);
	}
	destroy(): void { this.layer.destroy(true); this.loot.clear(); this.enemies = []; this.occluders = []; this.pawn = null; this.cachedRaid = null; }
}
