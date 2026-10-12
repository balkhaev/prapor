import Phaser from "phaser";
import { moduleArt } from "./armory-art";
import { MODULE_BY_ID } from "./game/modules";
import type { RoomInstance, ShelterRoomType } from "./game/shelter";
import { advanceShelterStationClock, getShelterProductionPresentation, type ProductionPresentation, type ProductionSnapshot } from "./shelter-production";

export interface ShelterStation {
	readonly layer: Phaser.GameObjects.Container;
	setProduction: (room: RoomInstance | null, production?: ProductionSnapshot | null) => ProductionPresentation | null;
	update: (time: number, delta: number, reducedMotion?: boolean) => void;
	destroy: () => void;
}

const PAINT = {
	ink: 0x102422, steel: 0x7e928a, highlight: 0xd3d5bc, bronze: 0xd0ad69,
	green: 0xb1d58e, blue: 0x89c3be, amber: 0xf0c57d, dark: 0x314940,
};
type ModuleTextureCache = { pending: Set<string>; retryAfter: Map<string, number>; retained: Map<string, number>; used: Map<string, number> };
const textureLoads = new WeakMap<Phaser.Textures.TextureManager, ModuleTextureCache>();
const WARM_MODULE_TEXTURES = 24;
const textureKey = (modelId: string) => `shelter-product-${modelId}`;

function moduleTextureCache(textures: Phaser.Textures.TextureManager): ModuleTextureCache {
	let cache = textureLoads.get(textures);
	if (!cache) { cache = { pending: new Set(), retryAfter: new Map(), retained: new Map(), used: new Map() }; textureLoads.set(textures, cache); }
	return cache;
}

function pruneModuleTextures(textures: Phaser.Textures.TextureManager, cache: ModuleTextureCache): void {
	const unused = [...cache.used].filter(([key]) => !cache.retained.has(key)).sort((a, b) => a[1] - b[1]);
	for (let i = 0; i < unused.length - WARM_MODULE_TEXTURES; i++) {
		const key = unused[i]![0];
		cache.used.delete(key);
		if (textures.exists(key)) textures.remove(key);
	}
}

function ensureModuleTexture(scene: Phaser.Scene, modelId: string): string | null {
	const model = Object.hasOwn(MODULE_BY_ID, modelId) ? MODULE_BY_ID[modelId] : null;
	if (!model) return null;
	const key = textureKey(model.id);
	const loads = moduleTextureCache(scene.textures);
	if (scene.textures.exists(key)) { loads.used.set(key, Date.now()); return key; }
	if (!loads.pending.has(key) && Date.now() >= (loads.retryAfter.get(key) ?? 0)) {
		loads.pending.add(key);
		const textures = scene.textures, tracking = loads;
		const detach = () => { textures.off(Phaser.Textures.Events.ADD, loaded); textures.off(Phaser.Textures.Events.ERROR, failed); };
		const loaded = (loadedKey: string) => {
			if (loadedKey !== key) return;
			tracking.pending.delete(key); tracking.retryAfter.delete(key); tracking.used.set(key, Date.now()); detach();
			pruneModuleTextures(textures, tracking);
		};
		const failed = (failedKey: string) => {
			if (failedKey !== key) return;
			tracking.pending.delete(key); tracking.retryAfter.set(key, Date.now() + 5000); detach();
		};
		// These completion listeners belong to the load, so removing/importing a
		// room cannot leave a failed texture permanently marked as loading.
		textures.on(Phaser.Textures.Events.ADD, loaded);
		textures.on(Phaser.Textures.Events.ERROR, failed);
		// One high-resolution rasterization per actual module model, shared by rooms.
		// Reuse the inventory silhouette, materials and appearance, rather than a generic part.
		const svg = moduleArt(model).replace('viewBox="0 0 240 120"', 'width="480" height="240" viewBox="0 0 240 120"');
		scene.textures.addBase64(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
	}
	return null;
}

function stroke(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number, width = 1, alpha = 1): void {
	g.lineStyle(width, color, alpha).lineBetween(x1, y1, x2, y2);
}
function round(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1, radius = 1): void {
	g.fillStyle(color, alpha).fillRoundedRect(x, y, w, h, radius);
}
function indicator(g: Phaser.GameObjects.Graphics, x: number, y: number, presentation: ProductionPresentation, clock: number): void {
	const color = presentation.completed ? PAINT.green : presentation.paused ? PAINT.amber : PAINT.green;
	g.fillStyle(PAINT.ink, .88).fillCircle(x, y, 2.1);
	g.fillStyle(color, presentation.active ? .9 : .55).fillCircle(x, y, 1.1);
	if (presentation.active) g.fillStyle(color, .08 + Math.sin(clock / 260) * .035).fillCircle(x, y, 4);
}

function spark(g: Phaser.GameObjects.Graphics, x: number, y: number, clock: number, index: number, spread = 7): void {
	const t = (clock / 310 + index * .27) % 1;
	const direction = index % 2 ? 1 : -1;
	stroke(g, x + direction * t * spread, y + t * 5, x + direction * t * spread + direction * 1.8, y + t * 5 + 1.5, index % 2 ? PAINT.amber : PAINT.highlight, .6, (1 - t) * .9);
}

function workshop(g: Phaser.GameObjects.Graphics, p: ProductionPresentation, clock: number, animate: boolean): void {
	// The left workbench and right lathe match the detailed room atlas below this layer.
	const preparation = p.stage === "preparation", inspection = p.stage === "inspection" || p.completed;
	const x = preparation || inspection ? 63 : 121;
	g.fillStyle(PAINT.ink, .68).fillEllipse(x, 63.2, preparation || inspection ? 51 : 46, 4.2);
	stroke(g, x - 24, 61.9, x + 24, 61.9, PAINT.steel, .8, .85);
	if (preparation) {
		round(g, 39, 60, 9, 2, PAINT.steel);
		round(g, 40, 56, 1.5, 5, PAINT.highlight);
		round(g, 47, 55, 1.5, 6, PAINT.highlight);
		stroke(g, 51, 61, 56, 54, PAINT.bronze, 1.2);
		g.fillStyle(PAINT.highlight, .8).fillCircle(92, 59, 1).fillCircle(96, 60, .8).fillCircle(99, 58, .65);
	} else if (!inspection) {
		const cut = Math.sin(clock / 330) * 1.1;
		round(g, 107, 57.7, 4.5, 4.6, PAINT.dark, .95);
		stroke(g, 109.2, 58, 114.8 + cut, 54.8, PAINT.highlight, 1.2);
		stroke(g, 115 + cut, 54.7, 118 + cut, 54.7, PAINT.bronze, .8);
		g.lineStyle(.65, PAINT.steel, .95).strokeCircle(128, 60.2, 3.1);
		const angle = clock / 130;
		stroke(g, 128, 60.2, 128 + Math.cos(angle) * 2.7, 60.2 + Math.sin(angle) * 2.7, PAINT.highlight, .8);
		stroke(g, 128, 60.2, 128 - Math.cos(angle) * 2.7, 60.2 - Math.sin(angle) * 2.7, PAINT.highlight, .8);
		if (animate && (clock % 1350) < 790) for (let i = 0; i < 5; i++) spark(g, 115 + cut, 55.1, clock, i, 7 + i);
		for (let i = 0; i < 4; i++) { const chip = (clock / 620 + i * .23) % 1; g.fillStyle(PAINT.steel, .75).fillRect(111 + chip * 19, 63 + i % 2, 1.5, .6); }
	} else {
		const scan = Math.sin(clock / 380) * 3;
		stroke(g, 47 + scan, 50, 47 + scan, 62, PAINT.highlight, .75);
		stroke(g, 47 + scan, 50, 53 + scan, 50, PAINT.highlight, .75);
		stroke(g, 47 + scan, 62, 53 + scan, 62, PAINT.highlight, .75);
		stroke(g, 89 - scan, 50, 89 - scan, 62, PAINT.highlight, .75);
		stroke(g, 89 - scan, 50, 84 - scan, 50, PAINT.highlight, .75);
		stroke(g, 89 - scan, 62, 84 - scan, 62, PAINT.highlight, .75);
		if (p.completed) { stroke(g, 95, 57, 97, 59, PAINT.green, 1.2); stroke(g, 97, 59, 101, 54, PAINT.green, 1.2); }
	}
	indicator(g, 145, 54, p, animate ? clock : 0);
}

function ammo(g: Phaser.GameObjects.Graphics, p: ProductionPresentation, clock: number, animate: boolean): void {
	const press = (1 - Math.cos(clock / 180)) * 2.9;
	round(g, 30.6, 42, 3.6, 5.8 + press, PAINT.steel);
	round(g, 29.2, 47 + press, 6.2, 1.6, PAINT.highlight);
	stroke(g, 31.4, 43, 31.4, 47 + press, 0xe6d2a1, .55);
	if (p.stage !== "preparation") {
		const run = clock / 55;
		for (let i = 0; i < 7; i++) {
			const x = 65 + (run + i * 9) % 61;
			round(g, x, 57.4, 1.9, 4.7, PAINT.bronze, .95, .35);
			stroke(g, x + .6, 57.2, x + .6, 59.8, 0xf7d793, .55);
			g.fillStyle(0x8c6441).fillTriangle(x, 57.4, x + 1.9, 57.4, x + .95, 55.9);
		}
	}
	for (let i = 0; i < 4; i++) { const angle = clock / 230 + i; g.lineStyle(.65, PAINT.steel, .9).strokeCircle(79 + i * 13, 64.4, 1.6); stroke(g, 79 + i * 13, 64.4, 79 + i * 13 + Math.cos(angle) * 1.1, 64.4 + Math.sin(angle) * 1.1, PAINT.highlight, .55); }
	const filled = Math.floor(p.progress * Math.min(12, p.quantity || 12));
	for (let i = 0; i < filled; i++) round(g, 142 + i % 6 * 1.9, 68 - Math.floor(i / 6) * 4.2, 1.3, 3.7, PAINT.bronze, .92, .2);
	if (p.stage === "inspection") {
		const x = 130 + clock / 70 % 27;
		stroke(g, x, 55, x, 66, PAINT.green, .6, .65);
	}
	indicator(g, 48.7, 56, p, animate ? clock : 0);
}

function recycler(g: Phaser.GameObjects.Graphics, p: ProductionPresentation, clock: number, animate: boolean): void {
	const belt = clock / 150;
	for (let i = 0; i < 5; i++) {
		const x = 61 + i * 10.7, y = 52.5 + i * 4.0;
		g.fillStyle(PAINT.ink, .68).fillCircle(x, y, 2.4);
		g.lineStyle(.6, PAINT.steel).strokeCircle(x, y, 2.0);
		const angle = belt + i * .35;
		stroke(g, x, y, x + Math.cos(angle) * 1.75, y + Math.sin(angle) * 1.75, PAINT.highlight, .55);
	}
	if (!p.completed) for (let i = 0; i < 6; i++) {
		const travel = (clock / 2300 + i * .17) % 1;
		const x = 49 + travel * 64, y = 47 + travel * 23;
		g.fillStyle(i % 2 ? 0xaeb4a0 : PAINT.steel, .9).fillTriangle(x, y - 1.8, x - 2, y + 1.1, x + 2.5, y + 1.3);
		stroke(g, x - .8, y, x + 1, y, PAINT.highlight, .55, .6);
	}
	if (animate && p.stage === "assembly") for (let i = 0; i < 3; i++) spark(g, 49, 47, clock, i, 5);
	const sorted = Math.floor(p.progress * Math.min(6, p.quantity || 6));
	for (let i = 0; i < sorted; i++) { round(g, 100 + i % 3 * 3.4, 76 - Math.floor(i / 3) * 2.8, 2.6, 1.8, PAINT.steel); stroke(g, 100 + i % 3 * 3.4, 76 - Math.floor(i / 3) * 2.8, 101.7 + i % 3 * 3.4, 76 - Math.floor(i / 3) * 2.8, PAINT.highlight, .5); }
	indicator(g, 42, 50, p, animate ? clock : 0);
}

function medbay(g: Phaser.GameObjects.Graphics, p: ProductionPresentation, clock: number, animate: boolean): void {
	// Diagnostics run only while the medical batch is being produced.
	round(g, 62.6, 46.2, 7.9, 7.5, PAINT.ink, .94);
	const sweep = clock / 90 % 8;
	g.lineStyle(.45, PAINT.green, .9).beginPath().moveTo(63, 50).lineTo(64.4, 50).lineTo(65, 48).lineTo(65.5, 51.8).lineTo(66.2, 49.3).lineTo(67, 50).lineTo(70, 50).strokePath();
	if (animate) stroke(g, 63 + sweep, 47, 63 + sweep, 53, PAINT.green, .5, .45);
	const bottles = p.stage === "preparation" ? 1 : p.stage === "assembly" ? 2 : 3;
	for (let i = 0; i < bottles; i++) {
		const x = 97 + i * 5.5;
		round(g, x, 56, 3.1, 6.5, 0x9bc8bd, .8, .5);
		round(g, x + .4, 54.5, 2.3, 1.8, PAINT.highlight, .9, .3);
		round(g, x + .45, 58.3, 2.2, 3.2, PAINT.blue, .95, .3);
		stroke(g, x + .7, 56.3, x + .7, 61, 0xd0eee0, .45, .75);
	}
	if (p.stage === "assembly") {
		stroke(g, 100, 48.5, 100, 54, PAINT.steel, .9);
		if (animate) { const drop = clock / 380 % 1; g.fillStyle(0xb7e7d4, .85).fillCircle(100, 51.5 + drop * 3, .65); }
	} else if (p.stage === "inspection" || p.completed) {
		g.lineStyle(.65, PAINT.green, .7).strokeRoundedRect(94.5, 53, 21, 12, 1);
	}
	indicator(g, 67.5, 44.3, p, animate ? clock : 0);
}

function radio(g: Phaser.GameObjects.Graphics, p: ProductionPresentation, clock: number, animate: boolean): void {
	const cx = 56.1, cy = 45.3, angle = clock / 900;
	g.fillStyle(PAINT.ink, .25).fillCircle(cx, cy, 8.2);
	g.lineStyle(.4, PAINT.green, .47).strokeCircle(cx, cy, 7.5).strokeCircle(cx, cy, 4.7).strokeCircle(cx, cy, 2.0);
	stroke(g, cx - 8, cy, cx + 8, cy, PAINT.green, .4, .4); stroke(g, cx, cy - 8, cx, cy + 8, PAINT.green, .4, .4);
	stroke(g, cx, cy, cx + Math.cos(angle) * 7.7, cy + Math.sin(angle) * 7.7, PAINT.green, .7, .95);
	if (animate) stroke(g, cx, cy, cx + Math.cos(angle - .12) * 7.7, cy + Math.sin(angle - .12) * 7.7, PAINT.green, 1.8, .11);
	g.fillStyle(PAINT.highlight, .9).fillCircle(cx - 3.7, cy - 2.8, .65).fillCircle(cx + 4.1, cy + 2.3, .55);
	for (let i = 0; i < 4; i++) {
		const level = 1 + (Math.sin(clock / 170 + i * 1.4) + 1) * 1.8;
		round(g, 90 + i * 2.1, 50.7 - level, 1.1, level, PAINT.blue, .85, .1);
	}
	const lines = Math.max(1, Math.floor(p.progress * 4));
	round(g, 132, 61.3, 8.5, 9, 0xc0c3a3, .9, .4);
	for (let i = 0; i < lines; i++) stroke(g, 133.5, 63 + i * 1.4, 138.8 - i % 2, 63 + i * 1.4, 0x344a3b, .45, .9);
	indicator(g, 92.6, 38, p, animate ? clock : 0);
}

/** Add above the room artwork and below labels/actors. Coordinates match the 172×100 cell. */
export function createShelterStation(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, options: { width?: number; height?: number } = {}): ShelterStation {
	const layer = scene.add.container(0, 0).setScale((options.width ?? 172) / 172, (options.height ?? 100) / 100);
	const machines = scene.add.graphics();
	const product = scene.add.image(0, 0, "__WHITE").setVisible(false);
	const finishing = scene.add.graphics();
	layer.add([machines, product, finishing]);
	parent.add(layer);
	let presentation: ProductionPresentation | null = null;
	let type: ShelterRoomType = "workshop";
	let clock = 0;
	let expectedTexture: string | null = null;
	let jobId: string | null = null;
	let roomReference: RoomInstance | null = null;
	let destroyed = false;
	let redraw = true;
	let lastReduced = false;
	const cache = moduleTextureCache(scene.textures);
	const releaseTexture = (key: string | null) => {
		if (!key) return;
		const count = cache.retained.get(key) ?? 0;
		if (count <= 1) cache.retained.delete(key); else cache.retained.set(key, count - 1);
		pruneModuleTextures(scene.textures, cache);
	};
	const onTextureAdded = (key: string) => {
		if (!destroyed && key === expectedTexture && presentation?.modelId) { product.setTexture(key).setDisplaySize(46, 23).setVisible(true); redraw = true; }
	};
	scene.textures.on(Phaser.Textures.Events.ADD, onTextureAdded);

	const setProduction = (room: RoomInstance | null, production: ProductionSnapshot | null = null): ProductionPresentation | null => {
		if (destroyed) return null;
		presentation = room ? getShelterProductionPresentation(room, production) : null;
		type = room?.type ?? "workshop";
		layer.setVisible(Boolean(room?.status === "ready" && presentation?.jobId));
		if (roomReference !== room || jobId !== presentation?.jobId) { clock = 0; jobId = presentation?.jobId ?? null; roomReference = room; }
		product.setVisible(false);
		const nextTexture = presentation?.modelId && type === "workshop" ? textureKey(presentation.modelId) : null;
		if (nextTexture !== expectedTexture) {
			if (nextTexture) cache.retained.set(nextTexture, (cache.retained.get(nextTexture) ?? 0) + 1);
			const previousTexture = expectedTexture;
			expectedTexture = nextTexture;
			releaseTexture(previousTexture);
		}
		if (presentation?.modelId && type === "workshop") {
			const ready = ensureModuleTexture(scene, presentation.modelId);
			if (ready) product.setTexture(ready).setDisplaySize(46, 23).setVisible(true);
		}
		redraw = true;
		return presentation;
	};
	const update = (_time: number, delta: number, reducedMotion = false): void => {
		if (destroyed || !presentation?.jobId || !layer.visible) return;
		clock = advanceShelterStationClock(clock, delta, presentation, reducedMotion);
		const animate = presentation.active && !reducedMotion;
		if (!animate && !redraw && reducedMotion === lastReduced) return;
		lastReduced = reducedMotion;
		redraw = false;
		machines.clear(); finishing.clear();
		switch (type) {
			case "workshop": workshop(machines, presentation, clock, animate); break;
			case "ammo": ammo(machines, presentation, clock, animate); break;
			case "recycler": recycler(machines, presentation, clock, animate); break;
			case "medbay": medbay(machines, presentation, clock, animate); break;
			case "radio": radio(machines, presentation, clock, animate); break;
			case "storage": case "dormitory": break;
		}
		if (type === "workshop" && presentation.modelId) {
			const bench = presentation.stage !== "assembly";
			product.setPosition(bench ? 67 : 124, 56.2 + (!bench ? Math.sin(clock / 140) * .22 : 0))
				.setDisplaySize(bench ? 46 : 40, bench ? 23 : 20).setAlpha(presentation.stage === "preparation" ? .78 : 1);
			// Physical vice jaws and inspection brackets sit in front of the actual part.
			if (!bench) {
				round(finishing, 106.5, 56.8, 5, 5, PAINT.dark, .95, .5);
				round(finishing, 146, 56.8, 4, 5, PAINT.steel, .95, .5);
				stroke(finishing, 108, 57.5, 108, 60.5, PAINT.highlight, .7);
				stroke(finishing, 147, 57.5, 147, 60.5, PAINT.highlight, .7);
			} else if (presentation.stage === "inspection" && animate) {
				const scan = 44 + clock / 50 % 46;
				stroke(finishing, scan, 47, scan, 65, PAINT.green, .6, .35);
			}
		}
	};
	const destroy = () => {
		if (destroyed) return;
		destroyed = true;
		scene.events.off(Phaser.Scenes.Events.SHUTDOWN, destroy);
		scene.textures.off(Phaser.Textures.Events.ADD, onTextureAdded);
		layer.destroy(true);
		releaseTexture(expectedTexture); expectedTexture = null;
	};
	scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);
	return { layer, setProduction, update, destroy };
}
