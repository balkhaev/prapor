import Phaser from "phaser";
import { type Raid, type RaidReport, type WeaponInstance } from "./game/engine";
import { getRaidFieldFrame, getRaidFieldObjective, getRaidFieldPlan, getRaidFieldPlanId, projectRaidFieldPoint, readRaidFieldCamera, type RaidFieldCameraState } from "./raid-field";
import { advanceRaidFeedback, followRaidCamera, getRaidActionLabel, getRaidRoutePreview, type RaidFeedbackState, type RaidShotCue } from "./raid-feedback";
import { scavAppearance, scavPixelGear } from "./scav-isometric";
import { SCAV_APPEARANCES } from "./game/scav-appearances";
import { PixelPhaserActor } from './pixel-phaser-actor';
import { pixelFacing, type PixelFacing } from './pixel-animation';
import { PixelBuildingArt } from './pixel-buildings';
import { PixelPropArt } from './pixel-props';
import { PixelContainerArt } from './pixel-containers';
import { PixelRaster, PIXEL_PALETTE as P } from './pixel-art';
import { paintPropAtmosphere, paintBuildingAtmosphere } from './pixel-environment';
import { raidGroundArt } from './raid-ground-art';
import { SceneLightBuffer, propLampSources } from './pixel-lighting';
import { readSceneClimate } from './scene-climate';
import { paintSceneWeather } from './scene-weather';
import { SceneWeatherCache } from './scene-weather-cache';
import type { LiveCityBuilding, LiveWorldProp } from './game/live';
import { raidPixelBuilding, raidPixelFrame, raidPixelProp } from './pixel-raid-presentation';
import { PIXEL_SCENE_THEME as T, pixelSceneTint as tintColor } from './pixel-scene-theme';
import { fitMinimap, minimapPoint, minimapViewport, raidMinimapTrail } from './minimap-presentation';
import type { BossId } from './game/bosses';
import { getHostileVisualLoadout, getRaidVisualLoadout } from "./scav-loadout";
import type { ShelterCamera, ShelterViewport } from "./shelter-camera";
import { getSquadRaidFieldFrame, type SquadRaidFieldFrame, type SquadRaidFieldShot } from "./squad-raid-field";
import type { ScavVisualLoadout } from "./scav-loadout";
import { getBoss } from './game/bosses';
import { bossVisualLoadout } from './boss-ui';

type Point = { x: number; y: number };
type Plan = ReturnType<typeof getRaidFieldPlan>;
type Frame = ReturnType<typeof getRaidFieldFrame>;
export interface RaidStreetSnapshot { raids: Raid[]; selectedRaidId?: string | null; history?: RaidReport[]; weapons?: WeaponInstance[]; scavs?: { id: string; personality?: string; appearance?: number }[] }
type Pawn = { root: Phaser.GameObjects.Container; body: Phaser.GameObjects.Container; actor: PixelPhaserActor; point: Point | null; appearance: number; direction: PixelFacing; firedAt?: number; bossBadge?: Phaser.GameObjects.Text };
type Occluder = { object: Phaser.GameObjects.Container; x: number; y: number; width: number; height: number };
let nextSceneryTexture = 0;
const MINI = { width: 148, height: 120, inset: 9, top: 21, innerWidth: 130, innerHeight: 78 };
const clamp = Phaser.Math.Clamp;
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
	private hudPlate: Phaser.GameObjects.Graphics;
	private actionBadge: Phaser.GameObjects.Text;
	private detail: Phaser.GameObjects.Text;
	private alertRoot: Phaser.GameObjects.Container;
	private alertPlate: Phaser.GameObjects.Graphics;
	private alertText: Phaser.GameObjects.Text;
	private feedback: RaidFeedbackState | null = null;
	private compactHud = false;
	private hudCssScale = 1;
	private hudTop = 43;
	private hudBottomInset = 30;
	private mini: Phaser.GameObjects.Graphics;
	private miniGuide: Phaser.GameObjects.Container;
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
	private squadPawns = new Map<string, Pawn>();
	private squadLabels = new Map<string, { root: Phaser.GameObjects.Container; text: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics }>();
	private squadFrame: SquadRaidFieldFrame | null = null;
	private cachedGroup: Raid[] = [];
	private enemies: Pawn[] = [];
	private occluders: Occluder[] = [];
	private loot = new Map<string, { root: Phaser.GameObjects.Container; mark: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>();
	private groundMinimap: Phaser.GameObjects.Graphics;
	private report: RaidReport | null = null;
	private carriedWeapon: WeaponInstance | null = null;
	private visualLoadout: ReturnType<typeof getRaidVisualLoadout> | null = null;
	private hostileLoadouts = new Map<number, ReturnType<typeof getHostileVisualLoadout>>();
	private bossLoadouts = new Map<string,ScavVisualLoadout>();
	private builtRaidId: string | null = null;
	private planInput = "";
	private buildingArt = new PixelBuildingArt();
	private propArt = new PixelPropArt();
	private containerArt = new PixelContainerArt();
	private sceneryTextures = new Set<string>();
	private environment: { art: Phaser.GameObjects.Graphics; prop?: LiveWorldProp; building?: LiveCityBuilding }[] = [];
	private environmentAt = 0;
	private lightBuffer = new SceneLightBuffer();
	private lightTexture: Phaser.Textures.CanvasTexture;
	private lightImage: Phaser.GameObjects.Image;
	private lightKey: string;
	private weatherGraphics: Phaser.GameObjects.Graphics;
	private weatherCache = new SceneWeatherCache();
	private paintedWeather: ReturnType<SceneWeatherCache['get']> | null = null;

	constructor(private scene: Phaser.Scene, viewport: ShelterViewport, private reducedMotion: boolean, _requestScavAtlas: (appearance: number) => void = () => {}) {
		this.viewport = { ...viewport };
		this.world = scene.add.container(0, 0);
		this.hud = scene.add.container(0, 0);
		this.layer = scene.add.container(0, 0, [this.world, this.hud]).setVisible(false);
		this.lightKey = `raid-light-${nextSceneryTexture++}`;
		this.lightTexture = scene.textures.createCanvas(this.lightKey, 1, 1)!;
		this.lightImage = scene.add.image(0, 0, this.lightKey).setOrigin(0).setVisible(false);
		this.layer.addAt(this.lightImage, 1);
		this.weatherGraphics = scene.add.graphics().setVisible(false);
		this.layer.addAt(this.weatherGraphics, 2);
		this.effects = scene.add.graphics().setDepth(10000);
		this.world.add(this.effects);
		this.hudPlate = scene.add.graphics();
		this.title = this.text(27, 54, "УЛИЦЫ · НАБЛЮДЕНИЕ", 15);
		this.actionBadge = this.text(27, 81, "", 10, T.self);
		this.caption = this.text(27, 101, "Выбери бойца в активном рейде", 12, T.text);
		this.detail = this.text(27, 138, "", 10, T.muted);
		this.alertPlate = scene.add.graphics(); this.alertText = this.text(13, 9, "", 12).setWordWrapWidth(310, true);
		this.alertRoot = scene.add.container(23, 0, [this.alertPlate, this.alertText]).setVisible(false);
		this.mini = scene.add.graphics(); this.groundMinimap = scene.add.graphics(); this.progress = scene.add.graphics();
		this.miniGuide = scene.add.container(0, 0, [this.text(9, 5, "УЛИЦЫ", 8, T.muted), this.text(MINI.width - 9, 5, "С ↑", 8).setOrigin(1, 0),
			this.text(17, 104, "Боец", 8), this.text(62, 104, "Цель", 8), this.text(109, 104, "Связь", 8)]).setVisible(false);
		this.hud.add([this.hudPlate, this.title, this.actionBadge, this.caption, this.detail, this.groundMinimap, this.mini, this.miniGuide, this.progress, this.alertRoot]);
		this.resize(viewport);
	}

	private text(x: number, y: number, text: string, size = 12, tint: string = T.text) {
		return this.scene.add.text(x, y, text, { fontFamily: "Manrope, sans-serif", fontSize: `${size}px`, fontStyle: "bold", color: tint, resolution: Math.min(window.devicePixelRatio || 1, 2) });
	}
	private project(point: { x: number; y: number; z?: number }): Point { return projectRaidFieldPoint(point, this.projection); }
	private quad(x: number, y: number, width = 1, height = 1, z = 0): Point[] { return [{ x, y, z }, { x: x + width, y, z }, { x: x + width, y: y + height, z }, { x, y: y + height, z }].map((p) => this.project(p)); }
	selectRaid(id: string | null): void { if (id !== this.selectedId) { this.selectedId = id; this.cachedRaid = null; this.cachedGroup = []; this.squadFrame = null; this.carriedWeapon = null; this.report = null; this.following = true; this.pendingCamera = null; this.feedback = null; this.alertRoot.setVisible(false); } }
	reset(): void {
		this.lightImage.setVisible(false); this.lightBuffer.clear();
		this.weatherGraphics.clear().setVisible(false); this.weatherCache.clear(); this.paintedWeather = null;
		this.world.removeAll(true); this.clearScenery(); this.plan = null; this.planInput = ""; this.builtRaidId = null; this.selectedId = null; this.cachedRaid = null; this.carriedWeapon = null; this.report = null; this.pawn = null; this.enemies = []; this.loot.clear(); this.occluders = []; this.pendingCamera = null;
		this.squadPawns.clear(); this.squadLabels.clear(); this.squadFrame = null; this.cachedGroup = [];
		this.groundMinimap.clear(); this.mini.clear(); this.miniGuide.setVisible(false); this.progress.clear(); this.title.setText("УЛИЦЫ · НАБЛЮДЕНИЕ");
		this.feedback = null; this.alertRoot.setVisible(false); this.actionBadge.setText(""); this.detail.setText("");
		this.paintHudPlate();
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
		if (following) this.follow(0, true);
		this.applyCamera();
	}
	setFollow(enabled: boolean): void { this.following = enabled; if (enabled && this.pawn) this.follow(0, true); this.applyCamera(); }
	resetCamera(): void { this.pendingCamera = null; this.camera.zoom = 1.8; this.setFollow(true); }
	resize(viewport: ShelterViewport): void {
		this.weatherCache.clear(); this.weatherGraphics.clear(); this.paintedWeather = null;
		const center = { x: this.camera.x + this.viewport.width / this.camera.zoom / 2, y: this.camera.y + this.viewport.height / this.camera.zoom / 2 };
		this.viewport = { ...viewport }; this.camera.x = center.x - viewport.width / this.camera.zoom / 2; this.camera.y = center.y - viewport.height / this.camera.zoom / 2;
		const canvas = this.scene.game.canvas, rect = canvas.getBoundingClientRect();
		const card = canvas.closest(".world-card"), head = card?.querySelector(".world-head")?.getBoundingClientRect(), bottom = card?.querySelector(".world-bottom")?.getBoundingClientRect();
		this.hudCssScale = rect.width > 0 && viewport.width > 0 ? rect.width / viewport.width : 1;
		this.compactHud = rect.width > 0 && rect.width <= 480;
		const inverseScale = 1 / this.hudCssScale;
		const headInset = head ? Math.max(0, head.bottom - rect.top) : 0;
		this.hudTop = this.compactHud ? (headInset + 8) * inverseScale : Math.max(43, (headInset + 8) * inverseScale);
		this.hudBottomInset = ((bottom ? Math.max(0, rect.bottom - bottom.top) : 0) + 8) * inverseScale;
		const miniScale = (this.compactHud ? .9 : 1) * inverseScale;
		const right = Math.max(17, 8 * inverseScale), miniY = viewport.height - MINI.height * miniScale - this.hudBottomInset;
		for (const item of [this.groundMinimap, this.mini, this.miniGuide]) item.setPosition(viewport.width - MINI.width * miniScale - right, miniY).setScale(miniScale);
		this.title.setVisible(!this.compactHud).setPosition(27, this.hudTop + 11);
		this.caption.setVisible(!this.compactHud).setPosition(27, this.hudTop + 58);
		this.detail.setVisible(!this.compactHud).setPosition(27, this.hudTop + 95);
		this.actionBadge.setFontSize(this.compactHud ? 12 * inverseScale : 10)
			.setPosition(this.compactHud ? 16 * inverseScale : 27, this.compactHud ? this.hudTop + 6 * inverseScale : this.hudTop + 38)
			.setWordWrapWidth(this.compactHud ? 124 * inverseScale : 342, true);
		this.paintHudPlate();
		this.alertRoot.setPosition(23, viewport.height - 137);
		if (this.compactHud) this.alertRoot.setVisible(false);
		this.progress.setPosition(23, viewport.height - this.hudBottomInset - 10); if (this.following) this.follow(0, true); this.applyCamera();
	}
	private paintHudPlate(): void {
		this.hudPlate.clear().setVisible(!this.compactHud || Boolean(this.actionBadge.text));
		if (this.compactHud) {
			const inverseScale = 1 / this.hudCssScale;
			const width = Math.min(this.viewport.width - 16 * inverseScale, Math.max(90 * inverseScale, this.actionBadge.width + 16 * inverseScale));
			const height = Math.max(26 * inverseScale, this.actionBadge.height + 12 * inverseScale);
			this.hudPlate.fillStyle(tintColor(T.panel), .94).fillRoundedRect(8 * inverseScale, this.hudTop, width, height, 5 * inverseScale)
				.lineStyle(inverseScale, tintColor(T.border), .65).strokeRoundedRect(8 * inverseScale, this.hudTop, width, height, 5 * inverseScale);
		} else {
			const width = Math.min(366, this.viewport.width - 30);
			this.hudPlate.fillStyle(tintColor(T.panel), .91).fillRoundedRect(15, this.hudTop, width, 117, 6).lineStyle(1, tintColor(T.border), .36).strokeRoundedRect(15, this.hudTop, width, 117, 6);
			this.title.setWordWrapWidth(width - 24, true); this.caption.setWordWrapWidth(width - 24, true);
		}
	}
	zoomBy(factor: number, at?: Point): void {
		if (!Number.isFinite(factor) || factor <= 0 || at && (!Number.isFinite(at.x) || !Number.isFinite(at.y))) return;
		const anchor = at ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
		const world = { x: this.camera.x + anchor.x / this.camera.zoom, y: this.camera.y + anchor.y / this.camera.zoom };
		this.camera.zoom = clamp(this.camera.zoom * factor, .7, 4);
		this.camera.x = world.x - anchor.x / this.camera.zoom; this.camera.y = world.y - anchor.y / this.camera.zoom;
		if (at) this.following = false; else if (this.following) this.follow(0, true);
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
	private follow(deltaMs: number, snap = false): void {
		if (!this.pawn) return;
		const focus = this.squadFrame ? this.project(this.squadFrame.focus) : this.pawn.root;
		this.camera = followRaidCamera(this.camera, focus, this.viewport, deltaMs, snap, this.reducedMotion);
	}

	private build(plan: Plan, raid: Raid, appearance: number): void {
		const newRaid = this.builtRaidId !== raid.id;
		this.world.removeAll(true); this.clearScenery(); this.occluders = []; this.loot.clear(); this.enemies = [];
		this.squadPawns.clear(); this.squadLabels.clear();
		this.plan = plan;
		this.projection.originX = plan.height * 32 + 160;
		this.bounds = { width: (plan.width + plan.height) * 32 + 320, height: (plan.width + plan.height) * 16 + 290 };
		const ground = this.scene.add.graphics().setDepth(-1000);
		this.world.add(ground);
		const yard = plan.mapId === 'forest' ? tintColor(P.leafShade) : plan.mapId === 'depot' ? tintColor(P.soil) : tintColor(P.grass);
		polygon(ground, this.quad(-1, -1, plan.width + 2, plan.height + 2), mix(yard, tintColor(P.ink), .34));
		this.world.add(this.sceneryImage(raidGroundArt(plan), this.project({ x: 0, y: 0 })).setDepth(-999));
		for (const building of plan.buildings) this.buildBuilding(building);
		for (const prop of plan.props) this.buildProp(prop);
		for (const spot of plan.lootSpots) {
			// Keep the search caption above the full character silhouette at the crate.
			const p = this.project(spot), mark = this.scene.add.graphics(), label = this.text(0, -65, spot.label, 11).setOrigin(.5).setBackgroundColor(`${T.panel}e8`).setPadding(5, 3);
			const box = this.scene.add.container(p.x, p.y).setDepth(p.y);
			const containerKind = spot.category === 'medical' ? 'medbag' : spot.category === 'intel' ? 'cabinet' : spot.category === 'workshop' ? 'toolbox' : 'crate';
			box.add(this.sceneryImage(this.containerArt.get({ containerKind }), { x: 0, y: 0 }, .55));
			this.world.add(box);
			const root = this.scene.add.container(p.x, p.y, [mark, label]).setDepth(9000).setVisible(false);
			this.world.add(root); this.loot.set(spot.id, { root, mark, label });
		}
		const entry = this.project(plan.entry), checkpoint = this.project(plan.checkpoint), gates = this.scene.add.graphics().setDepth(-900);
		for (const [p, tint] of [[entry, tintColor(T.extract)], [checkpoint, tintColor(T.self)]] as const) { gates.lineStyle(2, tint, .7).strokeEllipse(p.x, p.y, 36, 17); line(gates, [{ x: p.x - 13, y: p.y }, { x: p.x + 13, y: p.y }], tint, 1, .5); }
		this.world.add(gates);
		// Only independent Phaser textures remain after a street is built.
		this.buildingArt.clear(); this.propArt.clear(); this.containerArt.clear();
		this.pawn = this.makePawn(appearance, false); this.pawn.root.setPosition(entry.x, entry.y);
		this.effects = this.scene.add.graphics().setDepth(10000); this.world.add(this.effects);
		this.drawMiniGround(); if (newRaid) { this.camera = { zoom: 1.8, x: 0, y: 0 }; this.following = true; }
		this.builtRaidId = raid.id; if (this.following) this.follow(0, true); this.applyCamera();
	}

	/** Phaser owns independent canvases; clearing native art cannot blank an active texture. */
	private sceneryImage(sprite: { image: HTMLCanvasElement; anchor: Point }, point: Point, scale = 1): Phaser.GameObjects.Image {
		const copy = document.createElement('canvas'); copy.width = sprite.image.width; copy.height = sprite.image.height;
		const context = copy.getContext('2d');
		if (context) { context.imageSmoothingEnabled = false; context.drawImage(sprite.image, 0, 0); }
		const key = `raid-pixel-scenery-${++nextSceneryTexture}`;
		this.scene.textures.addCanvas(key, copy)?.setFilter(Phaser.Textures.FilterMode.NEAREST);
		this.sceneryTextures.add(key);
		return this.scene.add.image(point.x, point.y, key).setOrigin(sprite.anchor.x / copy.width, sprite.anchor.y / copy.height).setScale(scale);
	}
	private clearScenery(): void {
		this.environment = [];
		for (const key of this.sceneryTextures) this.scene.textures.remove(key);
		this.sceneryTextures.clear(); this.buildingArt.clear(); this.propArt.clear(); this.containerArt.clear();
	}
	private buildBuilding(building: Plan["buildings"][number]): void {
		const base = this.quad(building.x, building.y, building.width, building.height), front = base[2]!;
		const root = this.scene.add.container(0, 0).setDepth(front.y);
		let renderedHeight: number;
		if (building.kind === 'trees') {
			const rng = random(Math.floor(building.x * 173 + building.y * 821));
			for (let n = 0; n < 7; n++) {
				const prop = raidPixelProp({ id: `${building.id}-${n}`, kind: 'tree', x: building.x + rng() * building.width, y: building.y + rng() * building.height, blocking: true });
				prop.variant = n % 4;
				root.add(this.sceneryImage(this.propArt.get(prop), this.project({ x: prop.x - prop.width / 2, y: prop.y - prop.height / 2 }), .5));
				this.addEnvironment(root, this.project({ x: prop.x - prop.width / 2, y: prop.y - prop.height / 2 }), { prop });
			}
			renderedHeight = 135;
		} else {
			const sprite = this.buildingArt.get(raidPixelBuilding(building), false, 64);
			const image = this.sceneryImage(sprite, this.project(building)); root.add(image);
			this.addEnvironment(root, this.project(building), { building: raidPixelBuilding(building) });
			renderedHeight = front.y - (image.y - sprite.anchor.y);
		}
		this.world.add(root);
		this.occluders.push({ object: root, x: (base[1]!.x + base[3]!.x) / 2, y: front.y, width: (building.width + building.height) * 32, height: renderedHeight });
	}
	private buildProp(prop: Plan["props"][number]): void {
		const point = this.project(prop), root = this.scene.add.container(point.x, point.y).setDepth(point.y);
		if (prop.kind === 'sandbags') {
			// Low, stepped bags use the same pigments and native pixel size as world cover.
			const image = document.createElement('canvas'); image.width = 120; image.height = 80;
			const context = image.getContext('2d');
			if (context) {
				const r = new PixelRaster(context, 120, 80);
				r.ellipse(60, 64, 52, 13, P.ink);
				for (let row = 0; row < 3; row++) for (let n = 0; n < 4; n++) {
					const x = 16 + n * 24 + (row % 2) * 8, y = 57 - row * 10;
					r.ellipse(x, y, 14, 8, P.woodShade); r.ellipse(x, y - 2, 13, 7, P.sand);
					r.line(x - 8, y - 4, x + 7, y - 4, P.cream); r.line(x + 10, y - 2, x + 9, y + 2, P.wood);
				}
			}
			root.add(this.sceneryImage({ image, anchor: { x: 60, y: 64 } }, { x: 0, y: 0 }, .5));
		} else {
			const native = raidPixelProp(prop), offset = this.project({ x: prop.x - native.width / 2, y: prop.y - native.height / 2 });
			root.add(this.sceneryImage(this.propArt.get(native), { x: offset.x - point.x, y: offset.y - point.y }, .5));
			this.addEnvironment(root, { x: offset.x - point.x, y: offset.y - point.y }, { prop: native });
		}
		this.world.add(root);
	}
	private addEnvironment(parent: Phaser.GameObjects.Container, origin: Point, source: { prop?: LiveWorldProp; building?: LiveCityBuilding }): void {
		if (source.prop && !['tree', 'shrub', 'planter', 'garden', 'lamp'].includes(source.prop.kind)) return;
		const art = this.scene.add.graphics().setPosition(origin.x, origin.y).setScale(.5);
		parent.add(art); this.environment.push({ art, ...source });
	}
	private paintEnvironment(now: number, paused: boolean): void {
		if (!paused) this.environmentAt = now;
		for (const item of this.environment) {
			const art = item.art.clear();
			const plot = (x: number, y: number, width: number, height: number, color: string, alpha: number) => { art.fillStyle(tintColor(color), alpha).fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height)); };
			if (item.prop) paintPropAtmosphere(item.prop, this.environmentAt, plot, this.reducedMotion);
			if (item.building) paintBuildingAtmosphere(item.building, this.environmentAt, plot, this.reducedMotion);
		}
	}
	private paintLighting(climate: ReturnType<typeof readSceneClimate>): void {
		const zoom = this.camera.zoom;
		const lamps = (this.plan?.props ?? []).flatMap(prop => {
			if (prop.kind !== 'lamp') return [];
			const native = raidPixelProp(prop), origin = this.project({ x: prop.x - native.width / 2, y: prop.y - native.height / 2 });
			return propLampSources(native).map(light => ({ x: (origin.x + light.x * .5 - this.camera.x) * zoom, y: (origin.y + light.y * .5 - this.camera.y) * zoom,
				headY: (origin.y + light.headY * .5 - this.camera.y) * zoom, radius: light.radius * .5 * zoom }));
		});
		if (this.lightBuffer.paint(this.viewport.width, this.viewport.height, lamps, undefined, climate)) {
			const canvas = this.lightBuffer.canvas;
			this.lightTexture.setSize(canvas.width, canvas.height);
			const context = this.lightTexture.getContext(); context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(canvas, 0, 0);
			this.lightTexture.refresh(); this.lightImage.setDisplaySize(this.viewport.width, this.viewport.height);
		}
		this.lightImage.setVisible(true);
	}
	private paintWeather(climate: ReturnType<typeof readSceneClimate>): void {
		// Internal Phaser coordinates may be much larger than the visible canvas.
		// Sample density and streak size in display pixels, then adapt this one layer.
		const displayScale = this.hudCssScale;
		const weather = this.weatherCache.get({ width: this.viewport.width * displayScale, height: this.viewport.height * displayScale,
			timeMs: climate.timeMs, rain: climate.rain, fog: climate.fog, wind: climate.wind, reducedMotion: this.reducedMotion });
		this.weatherGraphics.setScale(1 / displayScale).setVisible(true);
		if (weather !== this.paintedWeather) {
			this.weatherGraphics.clear(); paintSceneWeather(this.weatherGraphics, weather); this.paintedWeather = weather;
		}
	}

	private makePawn(appearance: number, _hostile: boolean): Pawn {
		const body = this.scene.add.container(0, 0), actor = new PixelPhaserActor(this.scene, body);
		const root = this.scene.add.container(0, 0, [body]); this.world.add(root);
		return { root, body, actor, point: null, appearance, direction: 'se' };
	}
	private setPawnAppearance(pawn: Pawn, appearance: number): void { pawn.appearance = appearance; }
	private animatePawn(pawn: Pawn, point: Point, frame: Frame, hostile = false, visualAppearance = pawn.appearance, memberLoadout?: ScavVisualLoadout, assistTarget?: Point | null,
		presentation: { downed?: boolean; lostWeapon?: boolean; limping?: boolean; bossId?: BossId; shot?: RaidShotCue | SquadRaidFieldShot | null } = {}): void {
		const before = pawn.point, fighting = frame.action === 'skirmish' || frame.action === 'cover';
		const target = assistTarget ?? (hostile ? this.pawn?.point ?? null : frame.enemyPositions[0] ? this.project(frame.enemyPositions[0]) : null);
		const pathDirection = this.project({ x: frame.position.x + frame.direction.x, y: frame.position.y + frame.direction.y });
		if (target && fighting) pawn.direction = pixelFacing(target.x - point.x, target.y - point.y, pawn.direction);
		else if (!hostile) pawn.direction = pixelFacing(pathDirection.x - this.project(frame.position).x, pathDirection.y - this.project(frame.position).y, pawn.direction);
		else if (before) pawn.direction = pixelFacing(point.x - before.x, point.y - before.y, pawn.direction);
		const loadout = memberLoadout ?? (hostile ? this.hostileLoadouts.get(visualAppearance) ?? getHostileVisualLoadout(visualAppearance) : this.visualLoadout ?? { armorModelId: null, packModelId: null, weapon: null });
		if (hostile && !memberLoadout) this.hostileLoadouts.set(visualAppearance, loadout);
		const clock = frame.weatherPhase * 1000;
		// Pose recoil follows an already observed cue; entering a combat pose never creates a shot.
		if (presentation.shot && !this.report && !frame.paused && !this.reducedMotion) pawn.firedAt = clock - (1 - presentation.shot.strength) * (this.squadFrame ? 80 : 75);
		const animation = raidPixelFrame(this.plan!, frame, { facing: pawn.direction, appearance: pawn.appearance, hostile, downed: presentation.downed, limping: presentation.limping,
			reducedMotion: this.reducedMotion, shotAge: pawn.firedAt === undefined ? undefined : clock - pawn.firedAt });
		pawn.actor.update({ appearance: pawn.appearance, faction: hostile ? 'raiders' : 'scavs', limping: presentation.limping, bossId: presentation.bossId }, animation,
			presentation.lostWeapon ? null : loadout.weapon, scavPixelGear(loadout));
		pawn.point = { ...point }; pawn.root.setPosition(point.x, point.y).setDepth(point.y + .5);
	}
	private gunMuzzle(pawn: Pawn): Point | undefined {
		const point = pawn.actor.muzzlePoint();
		return point ? { x: pawn.root.x + point.x, y: pawn.root.y + point.y } : undefined;
	}
	private updateSquad(frame: SquadRaidFieldFrame): void {
		const boxes: { x: number; y: number; width: number; height: number }[] = [];
		for (const [index, member] of frame.members.entries()) {
			const appearance = member.appearance;
			const pawn = this.squadPawns.get(member.scavId) ?? (index === 0 ? this.pawn! : this.makePawn(appearance, false));
			this.squadPawns.set(member.scavId, pawn); this.setPawnAppearance(pawn, appearance);
			const point = this.project(member.position), target = member.helpingId ? frame.members.find((candidate) => candidate.scavId === member.helpingId) : null;
			const helping = member.action === "rescue" || member.action === "escort", targetPoint = helping && target ? this.project(target.position) : null;
			const action: Frame["action"] = member.action === "rescue" || member.action === "wounded" ? member.walking ? "move" : "search"
				: member.action === "hesitation" || member.action === "fallen" ? "cover" : member.action === "escort" ? frame.frame.action : member.action;
			const direction = targetPoint && !member.walking ? { x: target!.position.x - member.position.x, y: target!.position.y - member.position.y } : member.direction;
			this.animatePawn(pawn, point, { ...frame.frame, position: member.position, direction, walking: member.walking, action }, false, member.appearance, member.loadout, targetPoint,
				{ downed: member.lostScav || member.action === 'fallen', lostWeapon: member.lostWeapon, limping: member.action === 'wounded', shot: frame.shots.find(shot => !shot.hostile && shot.actorId === member.scavId) });
			pawn.root.setVisible(true).setAlpha(member.lostScav ? .7 : 1);
			let label = this.squadLabels.get(member.scavId);
			if (!label) {
				const text = this.text(0, 0, "", 10).setOrigin(.5, 1).setBackgroundColor(`${T.panel}eb`).setPadding(5, 3), bar = this.scene.add.graphics();
				const root = this.scene.add.container(0, 0, [bar, text]).setDepth(9002); this.world.add(root);
				label = { root, text, bar }; this.squadLabels.set(member.scavId, label);
			}
			const icon = member.lostScav ? "×" : member.helpedById ? "+" : member.helpingId ? "↗" : member.coordination === "rivals" ? "!" : String(index + 1);
			label.text.setText(`${icon} ${member.name}\n${member.statusText}`).setColor(member.lostScav ? T.muted : member.action === "wounded" || member.action === "hesitation" ? T.injured : member.helpingId || member.helpedById ? T.healthy : T.text);
			let labelY = point.y - 58;
			const width = label.text.width, height = label.text.height;
			for (let iteration = 0; iteration < 4; iteration++) {
				const blocked = boxes.some((box) => Math.abs(point.x - box.x) < (width + box.width) / 2 + 4 && labelY > box.y - box.height - 5 && labelY - height < box.y + 5);
				if (!blocked) break;
				labelY -= height + 7;
			}
			boxes.push({ x: point.x, y: labelY, width, height }); label.root.setPosition(point.x, labelY);
			label.bar.clear();
			if (labelY < point.y - 60) line(label.bar, [{ x: 0, y: 4 }, { x: 0, y: point.y - 48 - labelY }], tintColor(T.muted), 1, .4);
			// HP is the known departure value; the simulation confirms damage at the checkpoint.
			const tint = member.lostScav ? tintColor(T.hostile) : member.action === "wounded" ? tintColor(T.injured) : member.coordination === "rivals" ? tintColor(P.woodLight) : tintColor(T.healthy);
			label.bar.fillStyle(tintColor(T.panel), .9).fillRoundedRect(-19, 1, 38, 3, 1).fillStyle(tint, .9).fillRoundedRect(-19, 1, member.lostScav ? 0 : 38 * member.health / 100, 3, 1);
		}
	}
	private drawSquadShot(shot: SquadRaidFieldShot, frame: SquadRaidFieldFrame): void {
		if (this.reducedMotion || this.report) return;
		const shooter = shot.hostile ? this.enemies[shot.enemyIndex] : this.squadPawns.get(shot.actorId);
		const target = shot.hostile ? frame.members.find((member) => member.scavId === shot.targetId)?.position : frame.frame.enemyPositions[shot.enemyIndex];
		if (!shooter || !target) return;
		const muzzle = this.gunMuzzle(shooter); if (!muzzle) return;
		const point = this.project(target), radius = 2 + shot.strength * 3;
		line(this.effects, [muzzle, { x: point.x, y: point.y - 23 }], shot.hostile ? tintColor(T.injured) : tintColor(T.tracer), 1.2, shot.strength * .75);
		this.effects.fillStyle(tintColor(T.flash), shot.strength).fillCircle(muzzle.x, muzzle.y, radius);
	}
	private drawSquadSupport(frame: SquadRaidFieldFrame): void {
		for (const member of frame.members) {
			const point = this.project(member.position), tint = member.lostScav ? tintColor(T.hostile) : member.action === "wounded" || member.action === "hesitation" ? tintColor(T.injured) : member.helpingId ? tintColor(T.healthy) : tintColor(T.ally);
			this.effects.lineStyle(1.2, tint, .65).strokeEllipse(point.x, point.y + 1, 25, 12);
			if (member.helpingId) {
				const target = frame.members.find((candidate) => candidate.scavId === member.helpingId);
				if (target) {
					const to = this.project(target.position); line(this.effects, [point, to], member.action === "cover" ? tintColor(T.ally) : tintColor(T.healthy), 1.4, .6);
					if (member.action === "rescue") this.effects.lineStyle(1.8, tintColor(T.text), .9).lineBetween(to.x - 5, to.y - 48, to.x + 5, to.y - 48).lineBetween(to.x, to.y - 53, to.x, to.y - 43);
				}
			}
		}
	}

	private drawMiniGround(): void {
		if (!this.plan) return;
		const g = this.groundMinimap, plan = this.plan; g.clear();
		this.miniGuide.setVisible(true);
		g.fillStyle(tintColor(T.panel), .94).fillRoundedRect(0, 0, MINI.width, MINI.height, 3).lineStyle(1, tintColor(T.border), .65).strokeRoundedRect(0, 0, MINI.width, MINI.height, 3);
		const layout = fitMinimap(plan, { x: MINI.inset, y: MINI.top, width: MINI.innerWidth, height: MINI.innerHeight });
		g.fillStyle(tintColor(P.ink)).fillRect(layout.x, layout.y, layout.width, layout.height);
		for (const tile of plan.tiles) {
			const p = minimapPoint(layout, tile);
			g.fillStyle(tile.kind === "street" ? tintColor(P.concreteShade) : tile.kind === "sidewalk" ? tintColor(P.concrete) : tintColor(P.leafShade), .65).fillRect(p.x, p.y, layout.scale, layout.scale);
		}
		for (const building of plan.buildings) { const p = minimapPoint(layout, building); g.fillStyle(tintColor(P.ink)).fillRect(p.x, p.y, building.width * layout.scale, building.height * layout.scale); }
		g.lineStyle(1, tintColor(T.border), .6).strokeRect(layout.x, layout.y, layout.width, layout.height);
		g.fillStyle(tintColor(T.self)).fillCircle(11, 109, 2.5);
		polygon(g, [{ x: 55, y: 106 }, { x: 58, y: 109 }, { x: 55, y: 112 }, { x: 52, y: 109 }], tintColor(T.self));
		g.lineStyle(1, tintColor(T.extract)).strokeRect(101, 106, 5, 5);
	}
	private updateMini(frame: Frame): void {
		if (!this.plan) return;
		const g = this.mini, plan = this.plan, layout = fitMinimap(plan, { x: MINI.inset, y: MINI.top, width: MINI.innerWidth, height: MINI.innerHeight }); g.clear();
		const at = (point: Point) => minimapPoint(layout, point);
		const cameraCorner = (x: number, y: number) => {
			const px = (this.camera.x + x / this.camera.zoom - this.projection.originX) / (this.projection.tileWidth / 2);
			const py = (this.camera.y + y / this.camera.zoom - this.projection.originY) / (this.projection.tileHeight / 2);
			return { x: (px + py) / 2, y: (py - px) / 2 };
		};
		const view = minimapViewport(plan, [cameraCorner(0, 0), cameraCorner(this.viewport.width, 0), cameraCorner(this.viewport.width, this.viewport.height), cameraCorner(0, this.viewport.height)], layout);
		if (view.length > 2) { polygon(g, view, tintColor(T.text), .07); g.lineStyle(1, tintColor(T.text), .6).strokePoints(view, true); }
		const travelled = raidMinimapTrail(plan, frame).map(at);
		if (travelled.length > 1) line(g, travelled, tintColor(T.route), 1.4, .85);
		const preview = getRaidRoutePreview(plan, frame);
		if (preview.length > 1) line(g, preview.map(at), tintColor(T.self), 1, .6);
		const current = plan.segments[frame.segmentIndex];
		const search = frame.action === 'search' ? plan.lootSpots.find(spot => spot.id === current?.targetId && frame.visibleLootIds.includes(spot.id)) : undefined;
		const target = search ?? preview.at(-1);
		if (target) { const p = at(target); polygon(g, [{ x: p.x, y: p.y - 4 }, { x: p.x + 4, y: p.y }, { x: p.x, y: p.y + 4 }, { x: p.x - 4, y: p.y }], tintColor(T.self)); }
		for (const spot of plan.lootSpots) if (frame.visitedLootIds.includes(spot.id)) { const p = at(spot); g.fillStyle(tintColor(T.healthy)).fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
		const checkpoint = at(plan.checkpoint);
		g.fillStyle(tintColor(T.panel)).fillRect(checkpoint.x - 3, checkpoint.y - 3, 6, 6).lineStyle(1.5, tintColor(T.extract)).strokeRect(checkpoint.x - 3, checkpoint.y - 3, 6, 6);
		for (const enemy of frame.enemyPositions) { const p = at(enemy); g.fillStyle(tintColor(T.panel)).fillCircle(p.x, p.y, 3).fillStyle(tintColor(T.hostile)).fillCircle(p.x, p.y, 2); }
		if (this.squadFrame) for (const [index, member] of this.squadFrame.members.entries()) {
			const p = at(member.position);
			const tint = member.lostScav ? tintColor(T.hostile) : index === 0 ? tintColor(T.self) : index === 1 ? tintColor(T.healthy) : tintColor(T.ally);
			g.fillStyle(tintColor(T.panel)).fillCircle(p.x, p.y, 3.6).fillStyle(tint).fillCircle(p.x, p.y, member.lostScav ? 1.7 : 2.5);
			if (!index || member.helpingId) g.lineStyle(1, !index ? tintColor(T.text) : tint, .8).strokeCircle(p.x, p.y, 4);
		} else {
			const p = at(frame.position); g.fillStyle(tintColor(T.panel)).fillCircle(p.x, p.y, 4.5).fillStyle(tintColor(T.self)).fillCircle(p.x, p.y, 3);
			g.lineStyle(1, tintColor(T.text), .9).strokeCircle(p.x, p.y, 4.5);
		}
	}

	private drawActionMarker(frame: Frame, point: Point): void {
		if (!this.plan || this.report) return;
		const g = this.effects;
		const preview = getRaidRoutePreview(this.plan, frame);
		if (preview.length > 1) {
			const route = preview.map((position) => this.project(position)), target = route.at(-1)!, before = route.at(-2)!;
			line(g, route, tintColor(T.route), 2, .4);
			for (const waypoint of route.slice(1, -1)) g.fillStyle(tintColor(T.route), .65).fillEllipse(waypoint.x, waypoint.y, 5, 2.5);
			g.lineStyle(1.3, tintColor(T.route), .7).strokeEllipse(target.x, target.y, 21, 10);
			const angle = Math.atan2(target.y - before.y, target.x - before.x), dx = Math.cos(angle), dy = Math.sin(angle);
			polygon(g, [{ x: target.x + dx * 5, y: target.y + dy * 5 }, { x: target.x - dx * 3 - dy * 3, y: target.y - dy * 3 + dx * 3 }, { x: target.x - dx * 3 + dy * 3, y: target.y - dy * 3 - dx * 3 }], tintColor(T.route), .85);
		}
		if (frame.action === "search" && !frame.paused) {
			g.lineStyle(1.2, tintColor(T.loot), .4).strokeEllipse(point.x, point.y + 1, 43, 21);
			const points: Point[] = [];
			for (let i = 0; i <= Math.ceil(frame.segmentProgress * 36); i++) {
				const angle = -Math.PI / 2 + Math.PI * 2 * Math.min(frame.segmentProgress, i / 36);
				points.push({ x: point.x + Math.cos(angle) * 21.5, y: point.y + 1 + Math.sin(angle) * 10.5 });
			}
			if (points.length > 1) line(g, points, tintColor(T.loot), 2.2, .9);
			line(g, [{ x: point.x - 6, y: point.y - 43 }, { x: point.x - 6, y: point.y - 49 }, { x: point.x + 6, y: point.y - 49 }, { x: point.x + 6, y: point.y - 43 }], tintColor(T.loot), 1.2, .8);
		}
		if (frame.action === "checkpoint" || frame.paused && frame.progress >= 1) {
			g.lineStyle(2, tintColor(T.extract), .7).strokeEllipse(point.x, point.y + 1, 45, 22);
			g.lineStyle(1, tintColor(T.extract), .35).strokeEllipse(point.x, point.y + 1, 55, 27);
		}
	}

	private drawShot(shot: RaidShotCue | null, frame: Frame, point: Point): void {
		if (!shot || !this.pawn || !frame.enemyPositions.length || this.report) return;
		const shooter = shot.hostile ? this.enemies[0] : this.pawn;
		if (!shooter) return;
		const muzzle = this.gunMuzzle(shooter); if (!muzzle) return;
		const target = shot.hostile ? point : this.project(frame.enemyPositions[0]!);
		line(this.effects, [muzzle, { x: target.x, y: target.y - 23 }], shot.hostile ? tintColor(T.injured) : tintColor(T.tracer), 1.2, shot.strength * .75);
		const radius = 2 + shot.strength * 3;
		polygon(this.effects, [{ x: muzzle.x - radius, y: muzzle.y }, { x: muzzle.x - 1, y: muzzle.y - 1 }, { x: muzzle.x, y: muzzle.y - radius }, { x: muzzle.x + 1, y: muzzle.y - 1 }, { x: muzzle.x + radius, y: muzzle.y }, { x: muzzle.x + 1, y: muzzle.y + 1 }, { x: muzzle.x, y: muzzle.y + radius }, { x: muzzle.x - 1, y: muzzle.y + 1 }], tintColor(T.flash), shot.strength);
	}

	private updateAlert(): void {
		const alert = this.feedback?.alert;
		this.alertRoot.setVisible(Boolean(alert) && !this.compactHud);
		if (!alert || this.compactHud) return;
		const danger = alert.action === "skirmish", tint = danger ? tintColor(T.hostile) : alert.action === "search" ? tintColor(T.loot) : tintColor(T.healthy);
		const width = Math.max(150, Math.min(348, this.viewport.width - MINI.width - 57));
		this.alertText.setWordWrapWidth(width - 26, true);
		this.alertText.setText(`${getRaidActionLabel(alert.action)}\n${alert.label}`).setColor(danger ? T.injured : T.text);
		const height = this.alertText.height + 18;
		this.alertPlate.clear().fillStyle(tintColor(T.panel), .95).fillRoundedRect(0, 0, width, height, 5).lineStyle(1, tint, .65).strokeRoundedRect(0, 0, width, height, 5).fillStyle(tint).fillRect(0, 7, 3, height - 14);
		this.alertRoot.setY(Math.min(this.viewport.height - 137, this.viewport.height - this.hudBottomInset - 22 - height));
		this.alertRoot.setAlpha(this.reducedMotion ? 1 : Math.min(1, alert.remainingMs / 450));
	}

	update(snapshot: RaidStreetSnapshot, now: number, delta: number): void {
		const climate = readSceneClimate();
		const requestedId = snapshot.selectedRaidId !== undefined ? snapshot.selectedRaidId ?? snapshot.raids[0]?.id ?? null : this.selectedId ?? snapshot.raids[0]?.id ?? null;
		const requestedRaid = snapshot.raids.find((raid) => raid.id === requestedId);
		const cachedMember = this.cachedRaid?.squad?.members.some((member) => member.raidId === requestedId);
		const id = requestedRaid?.squad?.leaderRaidId ?? (cachedMember ? this.cachedRaid!.squad!.leaderRaidId : requestedId);
		if (id !== this.selectedId) this.selectRaid(id);
		const activeRaid = snapshot.raids.find((raid) => raid.id === id);
		const raid = activeRaid ?? (this.cachedRaid?.id === id ? this.cachedRaid : null);
		if (!raid) {
			this.world.setVisible(false); this.lightImage.setVisible(false); this.weatherGraphics.clear().setVisible(false); this.weatherCache.clear(); this.paintedWeather = null;
			this.mini.clear(); this.groundMinimap.clear(); this.miniGuide.setVisible(false); this.progress.clear(); this.title.setText("УЛИЦЫ · НАБЛЮДЕНИЕ"); this.caption.setText("Отправь бойца в рейд и выбери «Наблюдать»"); this.actionBadge.setText(""); this.detail.setText(""); this.feedback = null; this.alertRoot.setVisible(false); this.paintHudPlate(); return;
		}
		this.world.setVisible(true);
		this.cachedRaid = raid;
		this.report = activeRaid ? null : snapshot.history?.find((report) => report.raidId === id || report.squad?.leaderRaidId === id) ?? (this.report?.raidId === id ? this.report : null);
		if (activeRaid) this.cachedGroup = snapshot.raids.filter((candidate) => raid.squad?.members.some((member) => member.raidId === candidate.id));
		this.carriedWeapon = snapshot.weapons?.find((weapon) => weapon.id === raid.weaponInstanceId) ?? this.carriedWeapon;
		this.visualLoadout = getRaidVisualLoadout(raid, this.carriedWeapon);
		const input = getRaidFieldPlanId(raid);
		const plan = this.plan && this.planInput === input ? this.plan : getRaidFieldPlan(raid); this.planInput = input;
		const scav = snapshot.scavs?.find((candidate) => candidate.id === raid.scavId);
		const identity = [...raid.scavId].reduce((value, character) => Math.imul(value, 31) + character.charCodeAt(0) | 0, 0);
		const requestedAppearance = scav ? scavAppearance(scav.personality, identity, scav.appearance) : scavAppearance(undefined, identity, this.report?.scavAppearance ?? raid.scavAppearance);
		const appearance = requestedAppearance;
		if (this.plan?.id !== plan.id || this.builtRaidId !== raid.id) this.build(plan, raid, appearance);
		this.setPawnAppearance(this.pawn!, appearance);
		this.squadFrame = getSquadRaidFieldFrame(raid, activeRaid ? snapshot.raids : this.cachedGroup, now, plan, this.report);
		const frame = this.squadFrame?.frame ?? getRaidFieldFrame(raid, this.report ? raid.endsAt : now, plan);
		const objective = getRaidFieldObjective(raid, this.report ? raid.endsAt : now, plan);
		const feedback = advanceRaidFeedback(this.feedback, { raidId: raid.id, planId: plan.id, frame, deltaMs: delta, reducedMotion: this.reducedMotion, settled: Boolean(this.report) });
		this.feedback = feedback.state;
		const point = this.project(frame.position);
		const firstFrame = !this.pawn!.point;
		if (this.squadFrame) this.updateSquad(this.squadFrame);
		else {
			this.animatePawn(this.pawn!, point, frame, false, appearance, undefined, undefined, { lostWeapon: this.report?.lostWeapon, shot: !feedback.shot?.hostile ? feedback.shot : null });
			this.pawn!.root.setVisible(!this.report?.lostScav);
		}
		while (this.enemies.length > frame.enemyPositions.length) this.enemies.pop()!.root.destroy(true);
		frame.enemyPositions.forEach((enemy, index) => {
			const requestedEnemy = SCAV_APPEARANCES[(Math.imul(plan.seed, 31) + Math.imul(index + 1, 7919) >>> 0) % SCAV_APPEARANCES.length]!.id;
			const enemyAppearance = requestedEnemy;
			const actor = this.enemies[index] ?? this.makePawn(enemyAppearance, true); if (!this.enemies[index]) this.enemies[index] = actor;
			this.setPawnAppearance(actor, enemyAppearance);
			const boss=plan.boss&&enemy.x===plan.boss.position.x&&enemy.y===plan.boss.position.y?getBoss(plan.boss.id):null;
			let loadout:ScavVisualLoadout|undefined;
			if(boss){loadout=this.bossLoadouts.get(boss.id);if(!loadout){loadout=bossVisualLoadout(boss);this.bossLoadouts.set(boss.id,loadout);}if(!actor.bossBadge){actor.bossBadge=this.text(0,-76,`БОСС · ${boss.name}`,10,T.boss).setOrigin(.5).setBackgroundColor(`${T.panel}ee`).setPadding(5,3);actor.root.add(actor.bossBadge);}actor.bossBadge.setText(`БОСС · ${boss.name}`).setVisible(true);}
			else actor.bossBadge?.setVisible(false);
			this.animatePawn(actor, this.project(enemy), frame, true, requestedEnemy, loadout, undefined,
				{ bossId: boss?.id, shot: this.squadFrame ? this.squadFrame.shots.find(shot => shot.hostile && shot.enemyIndex === index) : index === 0 && feedback.shot?.hostile ? feedback.shot : null });
		});
		for (const occluder of this.occluders) {
			const points = this.squadFrame ? this.squadFrame.members.filter((member) => !member.lostScav).map((member) => this.project(member.position)) : [point];
			const behind = points.some((candidate) => candidate.y < occluder.y && candidate.y > occluder.y - occluder.height && Math.abs(candidate.x - occluder.x) < occluder.width * .45);
			occluder.object.setAlpha(behind ? .45 : 1);
		}
		for (const [id, loot] of this.loot) {
			const visited = frame.visitedLootIds.includes(id), visible = frame.visibleLootIds.includes(id);
			const current = objective.searchTargetId === id && !this.report && !frame.paused;
			loot.root.setVisible(visible); loot.mark.clear(); loot.label.setVisible(visible && !visited).setText(current ? `ПОИСК · ${Math.floor(frame.segmentProgress * 100)}%` : this.plan!.lootSpots.find((spot) => spot.id === id)?.label ?? "Поиск");
			if (visible) {
				loot.mark.lineStyle(1.5, visited ? tintColor(T.healthy) : tintColor(T.loot), .85).strokeEllipse(0, 0, 29, 14);
				if (visited) line(loot.mark, [{ x: -5, y: -2 }, { x: -1, y: 2 }, { x: 6, y: -5 }], tintColor(T.healthy), 1.7);
				else if (current) loot.mark.lineStyle(2.8, tintColor(T.loot), .95).beginPath().arc(0, -10, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frame.segmentProgress, false).strokePath();
				else polygon(loot.mark, [{ x: 0, y: -23 }, { x: -4, y: -29 }, { x: 4, y: -29 }], tintColor(T.loot));
			}
		}
		this.effects.clear();
		this.paintEnvironment(now, frame.paused);
		this.drawActionMarker(frame, point);
		if (!this.report && !frame.paused && frame.enemyPositions.length) {
			for (const enemy of frame.enemyPositions) {
				const target = this.project(enemy);
				this.effects.lineStyle(1.5, tintColor(T.hostile), .75).strokeEllipse(target.x, target.y + 1, 29, 14);
				polygon(this.effects, [{ x: target.x, y: target.y - 54 }, { x: target.x - 5, y: target.y - 63 }, { x: target.x + 5, y: target.y - 63 }], tintColor(T.hostile));
				if (frame.action === "skirmish") for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
					line(this.effects, [{ x: target.x + dx! * 12, y: target.y - 24 + dy! * 3 }, { x: target.x + dx! * 12, y: target.y - 24 + dy! * 9 }, { x: target.x + dx! * 6, y: target.y - 24 + dy! * 9 }], tintColor(T.hostile), 1.1, .8);
				}
			}
			if (frame.action === "cover") {
				// An observation/contact marker, not a simulated hit or future combat outcome.
				this.effects.lineStyle(3, tintColor(T.ally), .8).strokeEllipse(point.x, point.y + 1, 38, 19);
				line(this.effects, [{ x: point.x - 13, y: point.y - 19 }, { x: point.x - 13, y: point.y - 34 }, { x: point.x + 13, y: point.y - 34 }, { x: point.x + 13, y: point.y - 19 }], tintColor(T.ally), 2, .75);
			}
		}
		if (this.squadFrame) {
			this.drawSquadSupport(this.squadFrame);
			for (const shot of this.squadFrame.shots) this.drawSquadShot(shot, this.squadFrame);
		} else this.drawShot(feedback.shot, frame, point);
		if (!this.squadFrame && this.pawn!.root.visible) {
			const actionTint = frame.action === "skirmish" ? tintColor(T.hostile) : frame.action === "search" ? tintColor(T.loot) : frame.action === "cover" ? tintColor(T.ally) : tintColor(T.self);
			this.effects.lineStyle(1.3, actionTint, .6).strokeEllipse(point.x, point.y + 1, 29, 14); polygon(this.effects, [{ x: point.x, y: point.y - 57 }, { x: point.x - 4, y: point.y - 64 }, { x: point.x + 4, y: point.y - 64 }], actionTint);
		}
		if (this.pendingCamera) this.applyRestoredCamera();
		else if (this.following) this.follow(delta, firstFrame);
		this.applyCamera(); this.world.sort("depth"); this.paintLighting(climate); this.paintWeather(climate); this.updateMini(frame);
		const status = this.report ? this.report.success ? "РЕЙД ЗАВЕРШЁН · ДОБЫЧА НА БАЗЕ" : "РЕЙД ЗАВЕРШЁН · СМОТРИ ОТЧЁТ"
			: objective.settling ? "КОНТРОЛЬНАЯ ТОЧКА · ОЖИДАЕТСЯ СВОДКА" : frame.paused ? "ЖДЁТ ПРИКАЗА · ДОБЫЧА ПРИ НЁМ"
			: `${objective.label}${frame.action === "search" ? ` · ${Math.floor(frame.segmentProgress * 100)}%` : frame.enemyPositions.length ? ` · КОНТАКТ ${frame.enemyPositions.length}` : ""}`;
		const action = this.squadFrame?.activeAction;
		const actorName = action ? this.squadFrame!.members.find((member) => member.scavId === action.actorId)?.name ?? "Боец" : "";
		const targetName = action ? this.squadFrame!.members.find((member) => member.scavId === action.targetId)?.name ?? "товарища" : "";
		const actionText = action ? action.kind === "rescue" ? `${actorName} спасает ${targetName}` : action.kind === "cover" ? `${actorName} прикрывает ${targetName}` : `${actorName} медлит из-за конфликта` : "";
		this.title.setText(this.squadFrame ? `ОТРЯД · ${this.squadFrame.members.length} ДИКИХ · ${plan.theme.label}` : `${raid.scavName} · ${plan.theme.label}`); this.caption.setText(actionText || status);
		this.actionBadge.setText(this.report ? "СВОДКА ПОЛУЧЕНА" : this.compactHud && actionText ? actionText : `${this.squadFrame ? `ОТРЯД ${this.squadFrame.members.length} · ` : ""}${action?.kind === "rescue" ? "СПАСЕНИЕ" : action?.kind === "hesitation" ? "РАЗЛАД" : getRaidActionLabel(frame.action)}`).setColor(action?.kind === "rescue" ? T.healthy : frame.action === "skirmish" ? T.hostile : frame.action === "search" ? T.loot : T.text);
		this.detail.setText(`Этап ${raid.expedition?.stage ?? 1} · Участок ${objective.segment}/${objective.segments}${!frame.paused && !this.report ? ` · ${objective.remainingSeconds} с` : ""}`);
		this.paintHudPlate();
		this.updateAlert();
		this.progress.clear(); this.progress.fillStyle(tintColor(T.panel), .92).fillRoundedRect(0, 0, Math.min(350, this.viewport.width - 224), 10, 3).fillStyle(tintColor(T.self)).fillRoundedRect(0, 0, Math.min(350, this.viewport.width - 224) * frame.progress, 10, 3);
	}
	destroy(): void { this.layer.destroy(true); this.weatherCache.clear(); this.paintedWeather = null; this.scene.textures.remove(this.lightKey); this.lightBuffer.clear(); this.clearScenery(); this.loot.clear(); this.hostileLoadouts.clear(); this.bossLoadouts.clear(); this.squadPawns.clear(); this.squadLabels.clear(); this.squadFrame = null; this.cachedGroup = []; this.enemies = []; this.occluders = []; this.pawn = null; this.cachedRaid = null; this.visualLoadout = null; }
}
