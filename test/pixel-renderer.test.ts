import { describe, expect, test } from 'bun:test';
import { PixelRaidRenderer, pixelDetail, pixelSpriteRect, type PixelSprite } from '../src/pixel-renderer';

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

  test('cropped weapon sockets follow the exact rounded image rectangle at every display density', () => {
    const sprite: PixelSprite = { image: { width: 121, height: 159 } as HTMLCanvasElement, anchor: { x: 51, y: 148 } };
    const context = { canvas: { width: 0, height: 0 }, setTransform() {} } as unknown as CanvasRenderingContext2D;
    const renderer = new PixelRaidRenderer(context), point = { x: 200.35, y: 180.8 }, socket = { x: 109, y: 67 };
    for (const ratio of [1, 1.25, 2]) {
      renderer.resize(800, 600, ratio);
      const rect = pixelSpriteRect(sprite, point, .32, ratio), mount = renderer.spritePoint(sprite, point, .32, socket);
      expect(Math.abs(mount.x - (rect.x + socket.x * rect.width / sprite.image.width))).toBeLessThanOrEqual(.5 / ratio);
      expect(Math.abs(mount.y - (rect.y + socket.y * rect.height / sprite.image.height))).toBeLessThanOrEqual(.5 / ratio);
    }
  });
});
