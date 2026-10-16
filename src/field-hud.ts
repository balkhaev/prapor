export interface FieldHudBox { x: number; y: number; width: number; height: number }
export interface FieldHudSize { width: number; height: number }

const HUD_SELECTORS = '.command-hud > *, .command-tools, .field-more-panel, .field-location, .field-launch, .field-controls, .field-input-hint, .command-dock, .command-crew, .command-routes, .world-head > *, .world-bottom, .live-field-hud, .live-field-legend, .live-auto-world-status, .live-camera, .field-raid-status, .field-object-card';
export const fieldHudOverlaps = (a: FieldHudBox, b: FieldHudBox): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Only painted HUD islands reserve space; their transparent fullscreen wrappers do not. */
export function readFieldHudBounds(canvas: HTMLElement): FieldHudBox[] {
  const viewport = canvas.getBoundingClientRect();
  if (viewport.width <= 0 || viewport.height <= 0) return [];
  const root = canvas.closest?.('#app') ?? canvas.closest?.('.command-shell') ?? canvas.parentElement ?? canvas;
  return [...root.querySelectorAll<HTMLElement>(HUD_SELECTORS)].flatMap(element => {
    if (element.hidden) return [];
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left - viewport.left - 6), top = Math.max(0, rect.top - viewport.top - 6);
    const right = Math.min(viewport.width, rect.right - viewport.left + 6), bottom = Math.min(viewport.height, rect.bottom - viewport.top + 6);
    return rect.width > 0 && rect.height > 0 && right > left && bottom > top ? [{ x: left, y: top, width: right - left, height: bottom - top }] : [];
  });
}

/** Keep the world at full resolution, using the largest clear island only for camera framing. */
export function clearFieldHudRect(size: FieldHudSize, obstacles: readonly FieldHudBox[]): FieldHudBox {
  const viewport = { x: 0, y: 0, ...size };
  let spaces = [viewport];
  for (const obstacle of obstacles) {
    const next = spaces.flatMap(space => {
      if (!fieldHudOverlaps(space, obstacle)) return [space];
      const right = space.x + space.width, bottom = space.y + space.height;
      return [
        { x: space.x, y: space.y, width: space.width, height: Math.max(0, obstacle.y - space.y) },
        { x: space.x, y: obstacle.y + obstacle.height, width: space.width, height: Math.max(0, bottom - obstacle.y - obstacle.height) },
        { x: space.x, y: space.y, width: Math.max(0, obstacle.x - space.x), height: space.height },
        { x: obstacle.x + obstacle.width, y: space.y, width: Math.max(0, right - obstacle.x - obstacle.width), height: space.height },
      ].filter(rect => rect.width > 0 && rect.height > 0);
    });
    spaces = next.filter((rect, index) => !next.some((other, otherIndex) => otherIndex !== index && other.x <= rect.x && other.y <= rect.y
      && other.x + other.width >= rect.x + rect.width && other.y + other.height >= rect.y + rect.height
      && (other.width * other.height > rect.width * rect.height || otherIndex < index)));
  }
  return spaces.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? viewport;
}

/** Prefer the established corner, moving the complete HUD card to the nearest unoccupied space. */
export function placeFieldHudBox(size: FieldHudSize, box: FieldHudSize, obstacles: readonly FieldHudBox[], preferred: { x: number; y: number }, margin = 8): FieldHudBox | null {
  const maxX = size.width - box.width - margin, maxY = size.height - box.height - margin;
  if (maxX < margin || maxY < margin) return null;
  const x = (value: number) => Math.max(margin, Math.min(maxX, value));
  const y = (value: number) => Math.max(margin, Math.min(maxY, value));
  const xs = [...new Set([x(preferred.x), margin, maxX, ...obstacles.flatMap(item => [x(item.x - box.width), x(item.x + item.width)])])];
  const ys = [...new Set([y(preferred.y), margin, maxY, ...obstacles.flatMap(item => [y(item.y - box.height), y(item.y + item.height)])])];
  let best: FieldHudBox | null = null, distance = Infinity;
  for (const left of xs) for (const top of ys) {
    const candidate = { x: left, y: top, ...box };
    if (obstacles.some(obstacle => fieldHudOverlaps(candidate, obstacle))) continue;
    const nextDistance = (left - preferred.x) ** 2 + (top - preferred.y) ** 2;
    if (nextDistance < distance) { best = candidate; distance = nextDistance; }
  }
  return best;
}
