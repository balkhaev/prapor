import { describe, expect, test } from 'bun:test';
import { PixelRaidRenderer, pixelDetail, pixelSpriteRect, type PixelSprite } from '../src/pixel-renderer';
import { paintPixelActor } from '../src/pixel-actors';
import { SCAV_DIRECTIONS, SCAV_POSES } from '../src/scav-isometric';

describe('high resolution pixel compositor', () => {
  test('display density changes the framebuffer without changing world-art dimensions', () => {
    const transforms: number[][] = [], canvas = { width: 0, height: 0 };
    const context = { canvas, imageSmoothingEnabled: true, setTransform: (...args: number[]) => transforms.push(args) } as unknown as CanvasRenderingContext2D;
    const renderer = new PixelRaidRenderer(context);
    renderer.resize(1080, 720, 2);
    expect(canvas).toEqual({ width: 2160, height: 1440 });
    expect(transforms[0]).toEqual([2, 0, 0, 2, 0, 0]);
    expect(context.imageSmoothingEnabled).toBe(false);
    renderer.resize(390, 386, 1);
    expect(canvas).toEqual({ width: 390, height: 386 });
    expect(renderer.detail(48)).toBe(64);
    expect(pixelDetail(64, 2)).toBe(128);
    expect(pixelDetail(18, 2)).toBe(32);
  });

  test('fractional camera positions land on device pixels and offscreen sprites add no draw', () => {
    const image = { width: 211, height: 183 } as HTMLCanvasElement;
    const sprite: PixelSprite = { image, anchor: { x: 62, y: 117 } };
    const point = { x: 120.27, y: 170.33 }, rect = pixelSpriteRect(sprite, point, .53, 2);
    for (const value of Object.values(rect)) expect(Number.isInteger(value * 2)).toBe(true);
    const draws: unknown[][] = [];
    const context = { imageSmoothingEnabled: true, drawImage: (...args: unknown[]) => draws.push(args) } as unknown as CanvasRenderingContext2D;
    const renderer = new PixelRaidRenderer(context);
    renderer.sprite(sprite, { x: -1000, y: -1000 }, 1, 800, 600);
    expect(draws).toHaveLength(0);
    renderer.sprite(sprite, point, .5, 800, 600);
    expect(draws).toHaveLength(1); expect(context.imageSmoothingEnabled).toBe(false);
  });
});

test('all saved appearance bearings and poses paint bounded integer pixels without changing the actor', () => {
  let count = 0;
  const context = { setTransform() {}, fillRect(x: number, y: number, w: number, h: number) {
    count++;
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || x + w > 112 || y + h > 112) throw new Error('Actor pixels left their native frame');
  } } as unknown as CanvasRenderingContext2D;
  for (let appearance = 0; appearance < 32; appearance++) for (const direction of SCAV_DIRECTIONS) for (const pose of [...SCAV_POSES, 'downed'] as const) {
    const actor = { appearance, faction: appearance % 2 ? 'raiders' as const : 'scavs' as const }, before = { ...actor };
    paintPixelActor(context, actor, direction, pose, appearance % 3 !== 0);
    expect(actor).toEqual(before);
  }
  expect(count).toBeGreaterThan(10000);
});
