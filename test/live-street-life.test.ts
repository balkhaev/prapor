import { expect, test } from 'bun:test';
import type { LiveCityBuilding } from '../src/game/live';
import { buildingStreetSign, streetSignLettering } from '../src/live-street-life';

test('business boards use only public building purpose and do not advertise homes as stores', () => {
  const boards = new Map<string, string>();
  for (const kind of ['apartment', 'shop', 'service', 'workshop', 'garage'] as const) for (let i = 0; i < 40; i++) {
    const building = { id: `street-${i}`, kind }, sign = buildingStreetSign(building);
    expect(buildingStreetSign({ ...building })).toEqual(sign);
    if (kind === 'apartment' || kind === 'garage') { expect(sign).toBeNull(); continue; }
    expect(sign).not.toBeNull(); boards.set(sign!.label, sign!.board);
    expect(sign!.board).toMatch(/^#[\da-f]{6}$/);
    expect(sign!.lettering).not.toBe(sign!.board);
  }
  expect(boards.size).toBe(7);
  const base: Pick<LiveCityBuilding, 'id' | 'kind'> = { id: 'public-sign', kind: 'shop' };
  expect(buildingStreetSign({ ...base, name: 'Private interior contents' } as LiveCityBuilding)).toEqual(buildingStreetSign(base));
});

test('all authored Cyrillic boards have complete, bounded five-row lettering without browser text', () => {
  const labels = new Set<string>();
  for (let i = 0; i < 40; i++) for (const kind of ['shop', 'service', 'workshop'] as const) labels.add(buildingStreetSign({ id: `street-${i}`, kind })!.label);
  for (const label of labels) {
    const rectangles: number[][] = [];
    streetSignLettering(label, (...rect) => rectangles.push(rect));
    expect(rectangles.length).toBeGreaterThan(label.length * 7);
    for (const [x, y, width, height] of rectangles) {
      expect(x!).toBeGreaterThanOrEqual(0); expect(y!).toBeGreaterThanOrEqual(0);
      expect(x! + width!).toBeLessThanOrEqual(1.000001); expect(y! + height!).toBeLessThanOrEqual(1.000001);
    }
    // Each authored character has real painted strokes, including the last
    // letter; a missing glyph cannot silently leave a hole in a shop name.
    for (let i = 0; i < label.length; i++) {
      const left = i * 4 / (label.length * 4 - 1), right = (i * 4 + 3) / (label.length * 4 - 1);
      expect(rectangles.some(([x]) => x! >= left && x! < right)).toBe(true);
    }
  }
});
