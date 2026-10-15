import { afterEach, expect, test } from 'bun:test';
import { LiveScene } from '../src/live-scene';
import { getLiveMap } from '../src/game/live-maps';
import type { LiveCommand, LiveSnapshot } from '../src/game/live';
import { raidEntryMap } from '../src/raid-entry-ui';

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

class Element {
  tabIndex = 0; className = ''; innerHTML = '';
  listeners = new Map<string, (event: unknown) => void>();
  classList = { add() {}, remove() {} };
  getContext() { return {}; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  setAttribute() {} append() {} focus() {} remove() {}
  querySelectorAll() { return []; }
  addEventListener(name: string, callback: (event: unknown) => void) { this.listeners.set(name, callback); }
  removeEventListener(name: string) { this.listeners.delete(name); }
}

test('observing the raid map never sends movement, search or loot orders', () => {
  const keys = ['document', 'ResizeObserver', 'MutationObserver'] as const;
  const old = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const canvas = new Element(), controls = new Element(); let element = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => element++ ? controls : canvas } });
  const Observer = class { observe() {} disconnect() {} };
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: Observer });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: Observer });
  restore = () => keys.forEach((key, index) => { if (old[index]) Object.defineProperty(globalThis, key, old[index]!); else Reflect.deleteProperty(globalThis, key); });
  const commands: LiveCommand[] = [], selections: string[] = [];
  const scene = new LiveScene(new Element() as unknown as HTMLElement, command => commands.push(command), id => selections.push(id));
  const world = getLiveMap('perimeter');
  const other = { id: 'other', kind: 'player' as const, name: 'Наблюдаемый', appearance: 0, x: 14, y: 14, health: 100, action: 'idle' as const, safeUntil: 0 };
  const privateScene = scene as unknown as { snapshot: LiveSnapshot; active: boolean; following: boolean; camera: { x: number; y: number }; hitTargets: Array<{ entity: typeof other; x: number; y: number; bounds?: { x: number; y: number; width: number; height: number } }>; waypointTargets: Array<{ point: { x: number; y: number }; x: number; y: number }> };
  privateScene.snapshot = { world, entities: [other], selfId: 'self', drops: [{ id: 'loot', x: 16, y: 12, amount: 1 }] } as unknown as LiveSnapshot;
  privateScene.active = true;
  const click = (x: number, y: number) => canvas.listeners.get('click')!({ clientX: x, clientY: y });
  click(400, 260); // Ground and an available loot marker cannot take over the raid.
  privateScene.hitTargets = [{ entity: other, x: 320, y: 240 }];
  click(320, 240);
  expect(selections).toEqual(['other']);
  // Magnified rifles and prone models follow their actual cropped image rather
  // than a fixed upright body hit box; the last painted model takes precedence.
  const front = { ...other, id: 'front' };
  privateScene.hitTargets = [
    { entity: other, x: 320, y: 240, bounds: { x: 260, y: 120, width: 160, height: 135 } },
    { entity: front, x: 330, y: 250, bounds: { x: 280, y: 130, width: 150, height: 135 } },
  ];
  click(410, 145);
  expect(selections).toEqual(['other', 'front']);
  click(250, 145);
  expect(selections).toEqual(['other', 'front']);
  privateScene.waypointTargets = [{ point: { x: 30, y: 40 }, x: 450, y: 300 }];
  click(450, 300);
  expect(privateScene.camera).toEqual({ x: 30, y: 40 });
  expect(privateScene.following).toBe(false);
  click(728, 119); // Minimap recentres the camera instead of changing the server target.
  expect(privateScene.camera.x).toBeGreaterThan(100);
  expect(privateScene.camera.y).toBeGreaterThan(100);
  expect(commands).toEqual([]);
  privateScene.active = false;
});

test('the preparation scheme uses public city quarters and never includes hidden actor data', () => {
  const world = getLiveMap('perimeter');
  const server = { id: 'perimeter-1', name: 'Периметр', online: 1, capacity: 32, startedAt: 1,
    maps: [{ id: world.id, name: world.name, description: world.description, theme: world.theme, width: world.width, height: world.height, online: 1, npcs: 1, city: world.city }],
    districts: world.districts.map(district => ({ ...district, online: 0, npcs: 0 })) };
  const html = raidEntryMap(server, 'depot', true);
  expect(html).toContain('схема кварталов');
  expect(html).toContain('entry-map-roof');
  expect(html).toContain('data-live-button="district:depot" aria-pressed="true" disabled');
  expect(html).toContain(world.city!.quarters[0]!.name);
  expect(html).not.toContain('scav-perimeter');
  expect(html).not.toContain('containerId');
});
