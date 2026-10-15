import { PixelRaster } from './pixel-art';

/** Rasterize the same integer primitives to a compact, self-contained SVG.
 * A final pixel buffer removes hidden spans before serializing UI thumbnails. */
export function pixelSvg(width: number, height: number, paint: (raster: PixelRaster, context: CanvasRenderingContext2D) => void, crop = { x: 0, y: 0, width, height }): string {
  const colors = [''], indices = new Map<string, number>(), pixels = new Uint16Array(width * height);
  const context = {
    fillStyle: '', imageSmoothingEnabled: false, globalAlpha: 1, globalCompositeOperation: 'source-over',
    setTransform() {},
    fillRect(x: number, y: number, w: number, h: number) {
      const color = this.fillStyle;
      let index = indices.get(color);
      if (index === undefined) { index = colors.length; indices.set(color, index); colors.push(color); }
      for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) pixels.fill(index, row * width + Math.max(0, x), row * width + Math.min(width, x + w));
    },
  };
  // PixelRaster only uses the integer fill surface above, never browser paths.
  const surface = context as unknown as CanvasRenderingContext2D;
  paint(new PixelRaster(surface, width, height), surface);
  const paths = new Map<number, string[]>();
  for (let y = crop.y; y < crop.y + crop.height; y++) {
    for (let x = crop.x; x < crop.x + crop.width;) {
      const index = pixels[y * width + x]!, start = x++;
      while (x < crop.x + crop.width && pixels[y * width + x] === index) x++;
      if (!index) continue;
      const runs = paths.get(index) ?? []; paths.set(index, runs);
      runs.push(`M${start - crop.x} ${y - crop.y}h${x - start}v1h-${x - start}z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${crop.width} ${crop.height}" shape-rendering="crispEdges">${[...paths].map(([index, runs]) => `<path fill="${colors[index]}" d="${runs.join('')}"/>`).join('')}</svg>`;
}
