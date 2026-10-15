/** Actor-only raster detail. Geometry, interaction and animation use native units. */
export type PixelActorDetail = 32 | 64 | 160;
const neighbours4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

/** Density can retain a middle tier, but cannot make a tiny apparent body legible.
 * Keep the native cloth/face detail for bodies large enough in CSS space as well. */
export function pixelActorDetail(screenHeightCss: number, deviceRatio = 1): PixelActorDetail {
  if (!Number.isFinite(screenHeightCss) || screenHeightCss <= 0) return 160;
  const density = Number.isFinite(deviceRatio) ? Math.max(1, Math.min(2, deviceRatio)) : 1;
  const pixels = screenHeightCss * density;
  return screenHeightCss >= 64 ? 160 : screenHeightCss >= 28 && pixels >= 36 ? 64 : 32;
}

/** Coverage sampling keeps narrow barrels and separated limbs that a nearest
 * texel sample can drop. The result keeps the exact source surface and origin;
 * only its painted pixels change. Blocks align with native world-art coordinates
 * so a changing tight crop cannot move their grid between animation frames. */
export function clarifyPixelActor(
  source: Uint8ClampedArray, width: number, height: number, detail: PixelActorDetail,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): Uint8ClampedArray {
  if (detail === 160 || width < 1 || height < 1 || source.length !== width * height * 4) return source;
  const step = detail === 32 ? 5 : 3;
  const firstX = -((origin.x % step + step) % step), firstY = -((origin.y % step + step) % step);
  const columns = Math.ceil((width - firstX) / step), rows = Math.ceil((height - firstY) / step);
  const planes = new Float32Array(columns * rows * 4), occupied = new Uint8Array(columns * rows);
  const rowFirst = new Int32Array(height).fill(width), rowLast = new Int32Array(height).fill(-1);
  // The authored palette has broad material swatches. Retaining the dominant
  // swatch keeps a vest or steel receiver from becoming a muddy cloth average.
  const swatches = new Map<number, number>();
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const left = Math.max(0, firstX + column * step), top = Math.max(0, firstY + row * step);
    const right = Math.min(width, firstX + (column + 1) * step), bottom = Math.min(height, firstY + (row + 1) * step);
    let alpha = 0, red = 0, green = 0, blue = 0, dominant = 0, dominantWeight = 0;
    swatches.clear();
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const index = (y * width + x) * 4, weight = source[index + 3]! / 255;
      alpha += weight; red += source[index]! * weight; green += source[index + 1]! * weight; blue += source[index + 2]! * weight;
      if (weight) {
        rowFirst[y] = Math.min(rowFirst[y]!, x); rowLast[y] = Math.max(rowLast[y]!, x);
        const swatch = source[index]! << 16 | source[index + 1]! << 8 | source[index + 2]!;
        const total = (swatches.get(swatch) ?? 0) + weight; swatches.set(swatch, total);
        if (total > dominantWeight) { dominant = swatch; dominantWeight = total; }
      }
    }
    if (!alpha) continue;
    const cell = row * columns + column, index = cell * 4;
    occupied[cell] = 1;
    // Larger light/shade planes survive minification and the world's night tint.
    red /= alpha; green /= alpha; blue /= alpha;
    if (dominantWeight / alpha >= .35) {
      red = red * .3 + (dominant >>> 16) * .7;
      green = green * .3 + (dominant >>> 8 & 255) * .7;
      blue = blue * .3 + (dominant & 255) * .7;
    }
    const luminance = red * .2126 + green * .7152 + blue * .0722;
    const gain = luminance >= 100 ? 1.14 : .94;
    planes[index] = red * gain; planes[index + 1] = green * gain; planes[index + 2] = blue * gain;
    // A one-pixel feature still contributes coverage. Strengthen that surviving
    // sample instead of widening the actor container or its weapon geometry.
    planes[index + 3] = Math.min(255, Math.max(145, alpha / ((right - left) * (bottom - top)) * 340));
  }
  const result = new Uint8ClampedArray(source.length);
  const has = (x: number, y: number) => x >= 0 && x < columns && y >= 0 && y < rows && occupied[y * columns + x] === 1;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    if (!has(column, row)) continue;
    const index = (row * columns + column) * 4;
    let red = planes[index]!, green = planes[index + 1]!, blue = planes[index + 2]!;
    // A small, bounded contrast stroke separates adjacent material planes. It
    // follows real painted differences, never terrain or a faction glow.
    let neighbourLight = 0, neighbours = 0;
    for (const [dx, dy] of neighbours4) if (has(column + dx, row + dy)) {
      const next = ((row + dy) * columns + column + dx) * 4;
      neighbourLight += planes[next]! * .2126 + planes[next + 1]! * .7152 + planes[next + 2]! * .0722; neighbours++;
    }
    if (neighbours) {
      const contrast = Math.max(-14, Math.min(14, (red * .2126 + green * .7152 + blue * .0722 - neighbourLight / neighbours) * .7));
      red += contrast; green += contrast; blue += contrast;
    }
    // A one-cell barrel needs its dark silhouette. Light only the upper edge of
    // a plane with material beneath it, rather than washing out thin equipment.
    const upperEdge = !has(column, row - 1) && has(column, row + 1);
    const darkEdge = !has(column - 1, row) || !has(column + 1, row) || !has(column, row + 1);
    if (darkEdge) { red = red * .57 + 9; green = green * .57 + 12; blue = blue * .57 + 11; }
    if (upperEdge) {
      // A restrained warm upper edge reads as reflected light, without a glow.
      red = red * .7 + 218 * .3; green = green * .7 + 208 * .3; blue = blue * .7 + 172 * .3;
    }
    const left = Math.max(0, firstX + column * step), top = Math.max(0, firstY + row * step);
    const right = Math.min(width, firstX + (column + 1) * step), bottom = Math.min(height, firstY + (row + 1) * step);
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const target = (y * width + x) * 4;
      // Coverage may strengthen an exterior barrel, but must not fill authored
      // air between legs, a slung rifle and the torso, or the bent aiming arms.
      if (!source[target + 3] && x > rowFirst[y]! && x < rowLast[y]!) continue;
      result[target] = red; result[target + 1] = green; result[target + 2] = blue; result[target + 3] = planes[index + 3]!;
    }
  }
  return result;
}
