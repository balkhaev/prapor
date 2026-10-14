import type { LivePoint } from './game/live';

export type PixelSprite = { image: HTMLCanvasElement; anchor: LivePoint };
export type PixelDetail = 32 | 64 | 128;

/** Display resolution and world-art resolution are independent. Text stays at display resolution. */
export function pixelDetail(tile: number, ratio: number): PixelDetail {
  return tile * ratio >= 100 ? 128 : tile >= 28 ? 64 : 32;
}

export function pixelSpriteRect(sprite: PixelSprite, point: LivePoint, scale: number, ratio: number): { x: number; y: number; width: number; height: number } {
  const snap = (value: number) => Math.round(value * ratio) / ratio;
  return { x: snap(point.x - sprite.anchor.x * scale), y: snap(point.y - sprite.anchor.y * scale), width: Math.max(1 / ratio, snap(sprite.image.width * scale)), height: Math.max(1 / ratio, snap(sprite.image.height * scale)) };
}

/** The raid compositor samples integer-painted sprites, without a low-resolution screen buffer. */
export class PixelRaidRenderer {
  private ratio = 1;
  constructor(readonly context: CanvasRenderingContext2D) {}
  resize(width: number, height: number, deviceRatio: number): void {
    this.ratio = Math.max(1, Math.min(Number.isFinite(deviceRatio) ? deviceRatio : 1, 2));
    this.context.canvas.width = Math.round(width * this.ratio);
    this.context.canvas.height = Math.round(height * this.ratio);
    this.context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.context.imageSmoothingEnabled = false;
  }
  get deviceRatio(): number { return this.ratio; }
  detail(tile: number): PixelDetail { return pixelDetail(tile, this.ratio); }
  spritePoint(sprite: PixelSprite, point: LivePoint, scale: number, local: LivePoint): LivePoint {
    const rect = pixelSpriteRect(sprite, point, scale, this.ratio);
    return { x: Math.round((rect.x + local.x * rect.width / sprite.image.width) * this.ratio) / this.ratio, y: Math.round((rect.y + local.y * rect.height / sprite.image.height) * this.ratio) / this.ratio };
  }
  sprite(sprite: PixelSprite, point: LivePoint, scale: number, width: number, height: number): void {
    const rect = pixelSpriteRect(sprite, point, scale, this.ratio);
    if (rect.x + rect.width < 0 || rect.y + rect.height < 0 || rect.x > width || rect.y > height) return;
    this.context.imageSmoothingEnabled = false;
    this.context.drawImage(sprite.image, rect.x, rect.y, rect.width, rect.height);
  }
}
