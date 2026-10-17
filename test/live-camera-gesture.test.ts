import { afterEach, expect, test } from 'bun:test';
import { LiveScene } from '../src/live-scene';
import type { LiveCommand, LiveEntity, LiveFactionSite, LivePoint, LiveSnapshot } from '../src/game/live';

class Element {
	listeners = new Map<string, (event: any) => void>();
	captures = new Set<number>();
	classes = new Set<string>();
	classList = { add: (value: string) => this.classes.add(value), remove: (value: string) => this.classes.delete(value) };
	getContext() { return {}; }
	getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
	setAttribute() {} append() {} focus() {} remove() {}
	querySelectorAll() { return []; }
	querySelector() { return null; }
	addEventListener(name: string, callback: (event: any) => void) { this.listeners.set(name, callback); }
	removeEventListener(name: string) { this.listeners.delete(name); }
	setPointerCapture(id: number) { this.captures.add(id); }
	hasPointerCapture(id: number) { return this.captures.has(id); }
	releasePointerCapture(id: number) { this.captures.delete(id); this.listeners.get('lostpointercapture')?.({ pointerId: id }); }
	emit(name: string, x: number, y: number, pointerId = 1, button = 0) { this.listeners.get(name)?.({ pointerId, button, clientX: x, clientY: y, preventDefault() {} }); }
}

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

function setup() {
	const canvas = new Element(), controls = new Element(); let elements = 0;
	const keys = ['document', 'ResizeObserver', 'MutationObserver', 'cancelAnimationFrame'] as const;
	const old = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), Observer = class { observe() {} disconnect() {} };
	const values = [{ createElement: () => elements++ ? controls : canvas }, Observer, Observer, () => {}];
	keys.forEach((key, index) => Object.defineProperty(globalThis, key, { configurable: true, value: values[index] }));
	restore = () => keys.forEach((key, index) => { if (old[index]) Object.defineProperty(globalThis, key, old[index]!); else Reflect.deleteProperty(globalThis, key); });
	const commands: LiveCommand[] = [], selections: string[] = [];
	const scene = new LiveScene(new Element() as unknown as HTMLElement, command => commands.push(command), id => selections.push(id));
	const view = scene as unknown as { active: boolean; snapshot: LiveSnapshot; camera: LivePoint; following: boolean; overview: boolean; cityOverview: boolean; zoom: number; tile: number; origin: LivePoint; fieldRect: { x: number; y: number; width: number; height: number }; hitTargets: { entity: LiveEntity; x: number; y: number }[]; project: (point: LivePoint) => LivePoint; unproject: (x: number, y: number) => LivePoint; paint: () => void; viewTile: (world: LiveSnapshot['world']) => number };
	view.snapshot = { world: { width: 1024, height: 1024 }, selfId: 'self' } as LiveSnapshot;
	view.active = true; view.paint = () => {}; view.camera = { x: 512, y: 512 };
	view.fieldRect = { x: 0, y: 0, width: 800, height: 520 }; view.origin = { x: 400, y: 301.6 };
	view.hitTargets = [{ entity: { id: 'other' } as LiveEntity, x: 320, y: 240 }];
	return { scene, view, canvas, commands, selections };
}

test('dragging over an actor pans without selecting it; the next short click still inspects', () => {
	const { view, canvas, selections, commands } = setup();
	canvas.emit('pointerdown', 320, 240); canvas.emit('pointermove', 360, 270); canvas.emit('pointerup', 360, 270);
	canvas.emit('click', 320, 240);
	expect(selections).toEqual([]); expect(view.following).toBe(false);
	expect(canvas.captures.size).toBe(0); expect(canvas.classes.has('is-dragging')).toBe(false);
	canvas.emit('pointerdown', 320, 240); canvas.emit('pointermove', 322, 242); canvas.emit('pointerup', 322, 242); canvas.emit('click', 322, 242);
	expect(selections).toEqual(['other']); expect(commands).toEqual([]);
});

test('follow uses the last rendered center at the drag threshold instead of jumping to the press-time center', () => {
	const { view, canvas } = setup();
	canvas.emit('pointerdown', 320, 240);
	view.camera = { x: 513, y: 514 }; // The followed fighter moves while the mouse is still within tap tolerance.
	const before = view.project({ x: 520, y: 520 });
	canvas.emit('pointermove', 360, 265);
	const after = view.project({ x: 520, y: 520 });
	expect(after.x - before.x).toBeCloseTo(40, 8); expect(after.y - before.y).toBeCloseTo(25, 8);
	expect(view.following).toBe(false);
});

test('overview drag preserves both rendered scale and ground position while changing camera modes', () => {
	const { view, canvas } = setup();
	view.overview = true; view.following = false; view.origin = { x: 400, y: 280.8 }; view.tile = view.viewTile(view.snapshot.world);
	const before = view.project({ x: 520, y: 500 }), tile = view.tile;
	canvas.emit('pointerdown', 300, 200); canvas.emit('pointermove', 340, 225);
	const after = view.project({ x: 520, y: 500 });
	expect(after.x - before.x).toBeCloseTo(40, 8); expect(after.y - before.y).toBeCloseTo(25, 8);
	expect(view.overview).toBe(false); expect(view.tile).toBe(tile); expect(view.zoom * 64).toBeCloseTo(tile, 8);
});

test('cancel and lost capture release only the owned pointer and never turn a drag into an actor click', () => {
	for (const cancel of ['pointercancel', 'lostpointercapture']) {
		const { canvas, selections } = setup();
		canvas.emit('pointerdown', 320, 240); canvas.emit(cancel, 320, 240, 2);
		expect(canvas.captures.has(1)).toBe(true);
		canvas.emit('pointermove', 355, 260); canvas.emit(cancel, 355, 260);
		canvas.emit('pointerup', 320, 240); canvas.emit('click', 320, 240);
		expect(canvas.captures.size).toBe(0); expect(canvas.classes.has('is-dragging')).toBe(false); expect(selections).toEqual([]);
		restore?.(); restore = undefined;
	}
});

test('far release without move events still pans, and hiding a held map releases capture', () => {
	const { canvas, selections, scene, view } = setup();
	canvas.emit('pointerdown', 320, 240); canvas.emit('pointerup', 360, 270); canvas.emit('click', 320, 240);
	expect(view.following).toBe(false); expect(selections).toEqual([]);
	canvas.emit('pointerdown', 320, 240); scene.hide();
	expect(canvas.captures.size).toBe(0); expect(canvas.classes.has('is-dragging')).toBe(false);
});

test('middle and right mouse drags pan the map with the same screen distance', () => {
	const { canvas, view, commands } = setup();
	for (const button of [1, 2]) {
		const before = view.project({ x: 520, y: 520 });
		canvas.emit('pointerdown', 300, 200, 1, button); canvas.emit('pointermove', 330, 220, 1, button); canvas.emit('pointerup', 330, 220, 1, button);
		const after = view.project({ x: 520, y: 520 });
		expect(after.x - before.x).toBeCloseTo(30, 8); expect(after.y - before.y).toBeCloseTo(20, 8);
	}
	expect(commands).toEqual([]);
});

test('wheel zoom stays anchored under the pointer when leaving overview or automatic follow', () => {
	const { canvas, view } = setup();
	for (const overview of [true, false]) {
		view.overview = overview; view.following = !overview;
		view.origin = { x: 400, y: 520 * (overview ? .54 : .58) }; view.tile = view.viewTile(view.snapshot.world);
		const before = view.unproject(350, 230);
		canvas.listeners.get('wheel')?.({ clientX: 350, clientY: 230, deltaY: -100, preventDefault() {} });
		const after = view.unproject(350, 230);
		expect(after.x).toBeCloseTo(before.x, 8); expect(after.y).toBeCloseTo(before.y, 8);
		expect(view.following).toBe(false); expect(view.overview).toBe(false);
	}
});

test('faction markers show only current local observations and their selection never commands an actor', () => {
	const { canvas, view, scene, commands, selections } = setup();
	const markers = scene as unknown as { context: CanvasRenderingContext2D; selectedFactionSite: string | null;
		factionSiteTargets: { site: LiveFactionSite; x: number; y: number }[]; paintFactionSites(snapshot: LiveSnapshot): void };
	const labels: string[] = [];
	Object.assign(markers.context, { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {},
		measureText(text: string) { return { width: text.length * 5 }; }, strokeText() {}, fillText(text: string) { labels.push(text); } });
	const site: LiveFactionSite = { id: 'observed-base', x: 512, y: 512, kind: 'base', owner: 'scavs', contested: false };
	view.snapshot = { ...view.snapshot, now: 1000, events: [], entities: [], factionSites: [site] };
	markers.paintFactionSites(view.snapshot);
	expect(markers.factionSiteTargets.map(target => target.site.id)).toEqual([site.id]); expect(labels).toEqual([]);
	const target = markers.factionSiteTargets[0]!;
	canvas.emit('click', target.x, target.y); markers.paintFactionSites(view.snapshot);
	expect(markers.selectedFactionSite).toBe(site.id); expect(labels).toEqual(['База диких']);
	scene.setSelected(null); // The surrounding HUD repeats this on normal refreshes.
	expect(markers.selectedFactionSite).toBe(site.id);
	expect(commands).toEqual([]); expect(selections).toEqual([]);
	labels.length = 0; view.overview = true; markers.paintFactionSites(view.snapshot);
	expect(markers.factionSiteTargets).toEqual([]); expect(labels).toEqual([]);
	view.overview = false; scene.update({ ...view.snapshot, factionSites: [] });
	expect(markers.selectedFactionSite).toBeNull(); expect(markers.factionSiteTargets).toEqual([]);
	markers.paintFactionSites(view.snapshot); expect(labels).toEqual([]);
});
