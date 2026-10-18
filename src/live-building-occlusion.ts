import type { LivePoint } from './game/live';
import type { PixelSprite } from './pixel-renderer';

type Rect = LivePoint & { width: number; height: number };
export type BuildingActorWindow = Rect & { depth: number };

/** Only confirmed, currently drawn actors supply these windows. Keep enough
 * room for a shouldered rifle, leaning pose and the feet at either facing. */
export function buildingActorWindow(point: LivePoint, screen: LivePoint, zoom: number): BuildingActorWindow {
  return { x: screen.x - 64 * zoom, y: screen.y - 72 * zoom, width: 128 * zoom, height: 96 * zoom,
    depth: point.x + point.y + .1 };
}

export function overlappingBuildingActors(rect: Rect, depth: number, actors: readonly BuildingActorWindow[]): BuildingActorWindow[] {
  return actors.filter(actor => actor.depth <= depth && actor.x < rect.x + rect.width && actor.x + actor.width > rect.x
    && actor.y < rect.y + rect.height && actor.y + actor.height > rect.y);
}

/** A whole house is one cached sprite, so its front-corner sort can otherwise
 * cover a fighter along either long facade. Fade only the overlapping pixels
 * in a soft window; exterior street activity does not remove the whole roof.
 * Compositing stays on a single viewport buffer, never on the world or atlas. */
export class BuildingActorOcclusion {
  private canvas: HTMLCanvasElement | null = null;

  clear(): void {
    if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; }
    this.canvas = null;
  }

  paint(context: CanvasRenderingContext2D, sprite: PixelSprite, rect: Rect, depth: number,
    actors: readonly BuildingActorWindow[], width: number, height: number, ratio: number): boolean {
    const windows = overlappingBuildingActors(rect, depth, actors).filter(actor => actor.x < width && actor.x + actor.width > 0
      && actor.y < height && actor.y + actor.height > 0);
    if (!windows.length) return false;
    const canvas = this.canvas ??= document.createElement('canvas');
    const pixelWidth = Math.ceil(width * ratio), pixelHeight = Math.ceil(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    const layer = canvas.getContext('2d');
    if (!layer) return false;
    layer.setTransform(ratio, 0, 0, ratio, 0, 0);
    layer.clearRect(0, 0, width, height);
    layer.globalAlpha = 1; layer.globalCompositeOperation = 'source-over'; layer.imageSmoothingEnabled = false;
    layer.drawImage(sprite.image, rect.x, rect.y, rect.width, rect.height);
    layer.globalCompositeOperation = 'destination-out';
    for (const window of windows) {
      const rx = window.width / 2, ry = window.height / 2;
      layer.save(); layer.translate(window.x + rx, window.y + ry); layer.scale(rx, ry);
      const fade = layer.createRadialGradient(0, 0, 0, 0, 0, 1);
      fade.addColorStop(0, '#000000ff'); fade.addColorStop(.72, '#000000f5'); fade.addColorStop(1, '#00000000');
      layer.fillStyle = fade; layer.fillRect(-1, -1, 2, 2); layer.restore();
    }
    layer.globalCompositeOperation = 'source-over';
    context.drawImage(canvas, 0, 0, pixelWidth, pixelHeight, 0, 0, width, height);
    return true;
  }
}
