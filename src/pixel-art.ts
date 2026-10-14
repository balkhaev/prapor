import type { LivePoint } from './game/live';

/** One authored world cell; every model uses the same 2:1 projection. */
export const PIXEL_TILE = 128;
export type PixelColor = string;
export const PIXEL_PALETTE = {
  ink: '#273b35', shadow: '#52654e', black: '#263532', rubber: '#33423c',
  steel: '#859a9b', steelShade: '#516b70', steelLight: '#b2beb3',
  brick: '#a47660', brickShade: '#735346', plaster: '#c9bb9e', plasterShade: '#95876f',
  panel: '#a5b0a6', panelShade: '#758578', roof: '#849589', roofShade: '#5a6e62',
  terra: '#9d765f', terraShade: '#6f594b', glass: '#557b81', glassLight: '#8eaaa3',
  wood: '#987b57', woodShade: '#69573f', woodLight: '#b29a70',
  leaf: '#697f4b', leafShade: '#415a3f', leafLight: '#8b9d5a', grass: '#7b8657',
  soil: '#6c624b', sand: '#b1a37d', rust: '#9c654b', rustShade: '#795040',
  cream: '#dad0ac', red: '#a35e4f', blue: '#6c8790', green: '#788779',
  yellow: '#b7a56b', white: '#d4d5bf', concrete: '#9fa696', concreteShade: '#788475',
} as const satisfies Record<string, PixelColor>;

export function pixelIso(x: number, y: number, z = 0, origin: LivePoint = { x: 0, y: 0 }): LivePoint {
  return { x: Math.round(origin.x + (x - y) * PIXEL_TILE / 2), y: Math.round(origin.y + (x + y) * PIXEL_TILE / 4 - z) };
}

/** Stable across clients; unlike world ids the visual seed never contains actor state. */
export function pixelSeed(value: string): number {
  let seed = 2166136261;
  for (let i = 0; i < value.length; i++) seed = Math.imul(seed ^ value.charCodeAt(i), 16777619);
  return seed >>> 0;
}

export function pixelRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function integer(value: number): number | null {
  return Number.isFinite(value) && Math.abs(value) <= 0x3fffffff ? Math.round(value) : null;
}

/** Pixel-only rasterization. No antialiased paths, canvas strokes or gradients. */
export class PixelRaster {
  constructor(private readonly context: CanvasRenderingContext2D, readonly width: number, readonly height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
      throw new RangeError('Pixel surface must be 1..4096 integer pixels per side');
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }

  rect(x: number, y: number, width: number, height: number, color: PixelColor): void {
    const left = integer(x), top = integer(y), right = integer(x + width), bottom = integer(y + height);
    if (left === null || top === null || right === null || bottom === null || width <= 0 || height <= 0) return;
    this.span(Math.max(0, left), Math.max(0, top), Math.min(this.width, right), Math.min(this.height, bottom), color);
  }

  pixel(x: number, y: number, color: PixelColor): void { this.rect(x, y, 1, 1, color); }

  /** Clipping precedes Bresenham so distant endpoints cannot produce an unbounded loop. */
  line(x0: number, y0: number, x1: number, y1: number, color: PixelColor, width = 1): void {
    const values = [x0, y0, x1, y1, width].map(integer);
    if (values.some(value => value === null) || width <= 0) return;
    // Resolve half-pixel ties consistently when shared edges are authored backwards.
    if (x0 > x1 || (x0 === x1 && y0 > y1)) { [x0,x1]=[x1,x0]; [y0,y1]=[y1,y0]; }
    const brush = Math.min(32, Math.max(1, Math.round(width))), half = Math.floor(brush / 2);
    const dx = x1 - x0, dy = y1 - y0;
    let low = 0, high = 1;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const ratio = q / p;
      if (p < 0) { if (ratio > high) return false; low = Math.max(low, ratio); }
      else { if (ratio < low) return false; high = Math.min(high, ratio); }
      return true;
    };
    if (!clip(-dx, x0 + half) || !clip(dx, this.width - 1 + half - x0)
      || !clip(-dy, y0 + half) || !clip(dy, this.height - 1 + half - y0)) return;
    let x = Math.round(x0 + low * dx), y = Math.round(y0 + low * dy);
    const endX = Math.round(x0 + high * dx), endY = Math.round(y0 + high * dy);
    const stepX = x < endX ? 1 : -1, stepY = y < endY ? 1 : -1;
    const deltaX = Math.abs(endX - x), deltaY = -Math.abs(endY - y);
    let error = deltaX + deltaY;
    for (;;) {
      this.rect(x - half, y - half, brush, brush, color);
      if (x === endX && y === endY) break;
      const twice = error * 2;
      if (twice >= deltaY) { error += deltaY; x += stepX; }
      if (twice <= deltaX) { error += deltaX; y += stepY; }
    }
  }

  /** Even/odd scanlines work for convex models and concave foliage silhouettes. */
  polygon(points: readonly LivePoint[], color: PixelColor): void {
    if (points.length < 3 || points.length > 256) return;
    const vertices: LivePoint[] = [];
    let minY = this.height, maxY = 0;
    for (const point of points) {
      const x = integer(point.x), y = integer(point.y);
      if (x === null || y === null) return;
      vertices.push({ x, y }); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const crossings: number[] = [];
    for (let y = Math.max(0, minY); y < Math.min(this.height, maxY); y++) {
      crossings.length = 0;
      const center = y + .5;
      for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i]!, b = vertices[(i + 1) % vertices.length]!;
        if ((a.y <= center && b.y > center) || (b.y <= center && a.y > center)) {
          crossings.push(a.x + (center - a.y) * (b.x - a.x) / (b.y - a.y));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        this.span(Math.max(0, Math.ceil(crossings[i]! - .5)), y, Math.min(this.width, Math.ceil(crossings[i + 1]! - .5)), y + 1, color);
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: PixelColor): void {
    const x = integer(cx), y = integer(cy), radiusX = integer(rx), radiusY = integer(ry);
    if (x === null || y === null || radiusX === null || radiusY === null || rx < 0 || ry < 0) return;
    if (!radiusX || !radiusY) { this.rect(x - radiusX, y - radiusY, radiusX * 2 + 1, radiusY * 2 + 1, color); return; }
    for (let row = Math.max(-radiusY, -y); row <= Math.min(radiusY, this.height - 1 - y); row++) {
      const extent = Math.floor(radiusX * Math.sqrt(Math.max(0, 1 - row * row / (radiusY * radiusY))));
      this.span(Math.max(0, x - extent), y + row, Math.min(this.width, x + extent + 1), y + row + 1, color);
    }
  }

  private span(left: number, top: number, right: number, bottom: number, color: PixelColor): void {
    if (right <= left || bottom <= top) return;
    this.context.fillStyle = color;
    this.context.fillRect(left, top, right - left, bottom - top);
  }
}
