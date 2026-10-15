import { afterEach, expect, test } from 'bun:test';
import type Phaser from 'phaser';
import { PixelPhaserActor, PIXEL_PHASER_ACTOR_CACHE_BYTES } from '../src/pixel-phaser-actor';
import { PIXEL_FACINGS } from '../src/pixel-animation';
import { createWeaponShowcaseBuild } from '../src/weapon-showcase';

let restoreDocument: (() => void) | undefined;
afterEach(() => { restoreDocument?.(); restoreDocument = undefined; });

function harness() {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
    const canvas = { width: 0, height: 0, copies: 0 };
    const context = { fillStyle: '', setTransform() {}, fillRect() {}, drawImage() { canvas.copies++; }, imageSmoothingEnabled: true };
    return Object.assign(canvas, { getContext: () => context });
  } } });
  restoreDocument = () => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); };
  const textures = new Map<string, HTMLCanvasElement & { copies: number }>();
  const removed: string[] = [], filters: number[] = [];
  const scene = {
    textures: {
      addCanvas(key: string, canvas: HTMLCanvasElement & { copies: number }) { textures.set(key, canvas); return { setFilter(filter: number) { filters.push(filter); } }; },
      remove(key: string) { textures.delete(key); removed.push(key); },
    },
    add: { image() {
      const image = { key: '', originX: 0, originY: 0, scale: 0, destroyed: false,
        setTexture(key: string) { image.key = key; return image; }, setOrigin(x: number, y: number) { image.originX = x; image.originY = y; return image; },
        setScale(value: number) { image.scale = value; return image; }, destroy() { image.destroyed = true; } };
      return image;
    } },
  };
  function actor() { return new PixelPhaserActor(scene as unknown as Phaser.Scene, { add() {}, once() {} } as unknown as Phaser.GameObjects.Container); }
  return { actor, textures, removed, filters };
}

const look = { appearance: 7 }, frame = { mode: 'idle', frame: 0, facing: 'se' } as const;
const gear = { profile: 'light', helmet: false, armor: false, backpack: false } as const;
const imageKey = (actor: PixelPhaserActor) => (actor.image as unknown as { key: string }).key;

test('Phaser actors share copied nearest textures and preserve their feet pivot and sockets', () => {
  const h = harness(), a = h.actor(), b = h.actor(), weapon = createWeaponShowcaseBuild('akm', 'field');
  const anotherInstance = { ...weapon, id: 'another-instance' };
  a.update(look, frame, weapon, gear); b.update(look, frame, anotherInstance, gear);
  expect(h.textures.size).toBe(1); expect(imageKey(a)).toBe(imageKey(b)); expect(h.filters).toEqual([1]);
  const texture = h.textures.get(imageKey(a))!, image = a.image as unknown as { originX: number; originY: number };
  expect(texture.width).toBeGreaterThan(20); expect(texture.height).toBeGreaterThan(100); expect(texture.copies).toBe(1);
  // PixelActorArt.clear() has already run: Phaser's independent image must remain intact.
  expect(image.originX * texture.width).toBeGreaterThan(0); expect(image.originY * texture.height).toBeGreaterThan(100);
  const muzzle = a.muzzlePoint()!; expect(muzzle.y).toBeLessThan(0); expect(Number.isFinite(muzzle.x)).toBe(true);
  a.update(look, frame, weapon, gear, 96); expect(a.muzzlePoint()).toEqual({ x: muzzle.x * 2, y: muzzle.y * 2 });
  a.destroy(); expect(h.textures.has(imageKey(b))).toBe(true); b.destroy();
});

test('actual assembly, absent parts, empty hands and gear changes invalidate the shared appearance', () => {
  const h = harness(), a = h.actor(), weapon = createWeaponShowcaseBuild('akm', 'field');
  a.update(look, frame, weapon, gear); const fieldKey = imageKey(a);
  a.update(look, frame, { ...weapon, modules: {} }, gear);
  expect(imageKey(a)).not.toBe(fieldKey); expect(a.muzzlePoint()).toBeUndefined(); expect(a.ejectionPoint()).toBeUndefined();
  a.update(look, frame, null, gear); const emptyKey = imageKey(a); expect(a.muzzlePoint()).toBeUndefined();
  a.update(look, frame, null, { ...gear, backpack: true }); expect(imageKey(a)).not.toBe(emptyKey);
  a.update({ appearance: 9 }, frame, weapon, gear); expect(imageKey(a)).not.toBe(fieldKey);
  a.destroy(); a.update(look, frame, weapon, gear); expect((a.image as unknown as { destroyed: boolean }).destroyed).toBe(true);
});

test('retina minification keeps readable tiers without moving the body or weapon sockets', () => {
  const h = harness(), a = h.actor();
  a.update(look, frame, 'sks', gear, 48, { screenScale: .5, deviceRatio: 2 });
  const farKey = imageKey(a), muzzle = a.muzzlePoint(), ejection = a.ejectionPoint();
  a.update(look, frame, 'sks', gear, 48, { screenScale: .625, deviceRatio: 2 });
  const middleKey = imageKey(a); expect(middleKey).not.toBe(farKey);
  // More physical pixels at the same small apparent height retain this coherent
  // middle atlas instead of falling back to high-frequency native face detail.
  a.update(look, frame, 'sks', gear, 48, { screenScale: 1, deviceRatio: 2 });
  expect(imageKey(a)).toBe(middleKey);
  a.update(look, frame, 'sks', gear, 48, { screenScale: 1.5, deviceRatio: 2 });
  expect(imageKey(a)).not.toBe(middleKey);
  expect(a.muzzlePoint()).toEqual(muzzle); expect(a.ejectionPoint()).toEqual(ejection);
  expect(h.textures.size).toBe(3);
  a.destroy();
});

test('the texture cache remains bounded while an earlier actor is still displaying its frame', () => {
  const h = harness(), pinned = h.actor(), moving = h.actor();
  pinned.update(look, frame, 'svd', gear); const pinnedKey = imageKey(pinned);
  for (let i = 0; i < 800; i++) moving.update({ appearance: i % 32 }, {
    facing: PIXEL_FACINGS[Math.floor(i / 32) % 8]!, mode: 'walk', frame: Math.floor(i / 256),
  }, 'svd', { profile: 'assault', armor: true, helmet: true, backpack: true });
  expect(h.removed.length).toBeGreaterThan(0); expect(h.textures.has(pinnedKey)).toBe(true);
  const bytes = [...h.textures.values()].reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0);
  expect(bytes).toBeLessThanOrEqual(PIXEL_PHASER_ACTOR_CACHE_BYTES);
  pinned.destroy(); moving.destroy();
});
