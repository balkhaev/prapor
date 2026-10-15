import { expect, test } from 'bun:test';
import type { LiveTerrain, LiveWorld } from '../src/game/live';
import { paintStreetGroundDetail, streetGroundDetails } from '../src/live-street-details';

function fixture() {
  const world = { width: 32, height: 24, citySites: [{ buildings: [{ id: 'house', x: 10, y: 10, width: 5, height: 5,
    entrances: [{ x: 12, y: 10 }, { x: 14, y: 12 }] }] }], props: [
    { id: 'tree', kind: 'tree', x: 3, y: 3, width: 1, height: 1, orientation: 'x' },
    { id: 'lamp', kind: 'lamp', x: 6, y: 3, width: 1, height: 1, orientation: 'y' },
    { id: 'car', kind: 'car', x: 20, y: 3, width: 3, height: 2, orientation: 'x' },
    { id: 'bench', kind: 'bench', x: 19, y: 19, width: 2, height: 1, orientation: 'x' },
  ] } as unknown as LiveWorld;
  const terrain = Array<LiveTerrain>(768).fill('concrete'), walkable = new Uint8Array(768).fill(1), indoor = new Uint8Array(768);
  for (let y = 10; y < 15; y++) for (let x = 10; x < 15; x++) { indoor[y * 32 + x] = 1; walkable[y * 32 + x] = 0; }
  return { world, terrain, walkable, indoor };
}

test('signs of street life follow real entrances and furnishings without changing their geometry', () => {
  const f = fixture(), before = structuredClone(f), details = streetGroundDetails(f.world, f.terrain, f.walkable, f.indoor);
  expect(details.filter(detail => detail.kind === 'doorstep')).toHaveLength(2);
  expect(details.some(detail => detail.kind === 'tree-bed' && detail.paved)).toBe(true);
  expect(details.some(detail => detail.kind === 'lamp-base')).toBe(true);
  expect(details.some(detail => detail.kind === 'vehicle-wear')).toBe(true);
  expect(streetGroundDetails(f.world, f.terrain, f.walkable, f.indoor)).toEqual(details);
  expect(f).toEqual(before);
  for (const detail of details) for (let y = Math.floor(detail.y); y < Math.ceil(detail.y + detail.height); y++) for (let x = Math.floor(detail.x); x < Math.ceil(detail.x + detail.width); x++) {
    expect(f.indoor[y * 32 + x]).toBe(0); expect(f.terrain[y * 32 + x]).toBe('concrete');
  }
});

test('water, interior and blocked doorway thresholds never receive misleading street details', () => {
  const f = fixture(); f.walkable[9 * 32 + 12] = 0; f.indoor[12 * 32 + 15] = 1;
  for (let y = 2; y < 5; y++) for (let x = 2; x < 8; x++) f.terrain[y * 32 + x] = 'water';
  const details = streetGroundDetails(f.world, f.terrain, f.walkable, f.indoor);
  expect(details.some(detail => detail.kind === 'doorstep')).toBe(false);
  expect(details.some(detail => detail.kind === 'tree-bed' || detail.kind === 'lamp-base')).toBe(false);
  expect(streetGroundDetails({ ...f.world, citySites: [], props: [] }, f.terrain, f.walkable, f.indoor)).toEqual([]);
});

test('native street accents stay inside their indexed bounds at every seed and orientation', () => {
  const f = fixture(), details = streetGroundDetails(f.world, f.terrain, f.walkable, f.indoor);
  const kinds = ['doorstep', 'tree-bed', 'lamp-base', 'vehicle-wear', 'work-wear', 'litter'] as const;
  for (const kind of kinds) for (const axis of ['x', 'y'] as const) for (const seed of [0, 12, 0xffffffff]) {
    const detail = { ...details[0]!, kind, axis, seed };
    const context = { fillStyle: '', fillRect(x: number, y: number, width: number, height: number) {
      expect(x).toBeGreaterThanOrEqual(detail.x); expect(y).toBeGreaterThanOrEqual(detail.y);
      expect(x + width).toBeLessThanOrEqual(detail.x + detail.width + 1e-8);
      expect(y + height).toBeLessThanOrEqual(detail.y + detail.height + 1e-8);
      expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0);
    } } as unknown as CanvasRenderingContext2D;
    paintStreetGroundDetail(context, detail);
  }
});
