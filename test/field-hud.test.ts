import { describe, expect, test } from 'bun:test';
import { clearFieldHudRect, fieldHudOverlaps, placeFieldHudBox, readFieldHudBounds } from '../src/field-hud';

describe('fullscreen game HUD geometry', () => {
  test('camera framing uses open world space around a right dock without resizing the world', () => {
    const viewport = { width: 1440, height: 900 };
    const obstacles = [
      { x: 20, y: 20, width: 1400, height: 66 },
      { x: 1080, y: 110, width: 340, height: 670 },
      { x: 370, y: 826, width: 700, height: 54 },
    ];
    const field = clearFieldHudRect(viewport, obstacles);
    expect(field).toEqual({ x: 0, y: 86, width: 1080, height: 740 });
    expect(obstacles.some(box => fieldHudOverlaps(field, box))).toBe(false);
    expect(viewport).toEqual({ width: 1440, height: 900 });
  });

  test('the whole minimap moves beside a visible dock and returns to its corner after it closes', () => {
    const viewport = { width: 1440, height: 900 }, map = { width: 180, height: 178 };
    const corner = { x: 1236, y: 60 };
    const dock = { x: 1080, y: 24, width: 340, height: 756 };
    const placed = placeFieldHudBox(viewport, map, [dock], corner)!;
    expect(placed).toEqual({ x: 900, y: 60, ...map });
    expect(fieldHudOverlaps(placed, dock)).toBe(false);
    expect(placeFieldHudBox(viewport, map, [], corner)).toEqual({ ...corner, ...map });
  });

  test('mobile bottom sheets keep camera focus in the upper world and hide a minimap if no card fits', () => {
    const viewport = { width: 390, height: 844 };
    const obstacles = [
      { x: 0, y: 0, width: 390, height: 145 },
      { x: 0, y: 360, width: 390, height: 484 },
    ];
    expect(clearFieldHudRect(viewport, obstacles)).toEqual({ x: 0, y: 145, width: 390, height: 215 });
    expect(placeFieldHudBox(viewport, { width: 128, height: 256 }, obstacles, { x: 246, y: 78 })).toBeNull();
  });

  test('DOM bounds ignore collapsed and offscreen controls and exclude transparent wrappers', () => {
    const element = (x: number, y: number, width: number, height: number, hidden = false) => ({ hidden,
      getBoundingClientRect: () => ({ left: x, top: y, width, height, right: x + width, bottom: y + height }) });
    let selector = '';
    const controls = [element(110, 70, 300, 50), element(450, 70, 0, 0), element(110, 70, 300, 50, true), element(900, 900, 100, 100)];
    const canvas = { ...element(100, 50, 800, 600), closest: () => ({ querySelectorAll: (value: string) => { selector = value; return controls; } }) };
    expect(readFieldHudBounds(canvas as unknown as HTMLElement)).toEqual([{ x: 4, y: 14, width: 312, height: 62 }]);
    expect(selector).toContain('.command-hud > *');
    expect(selector).not.toContain('.command-shell,');
  });
});
