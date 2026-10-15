import { describe, expect, test } from 'bun:test';
import { fitMinimap, minimapPoint, minimapViewport, raidMinimapTrail } from '../src/minimap-presentation';
import type { RaidFieldPlan } from '../src/raid-field';

describe('minimap geometry and confirmed trail', () => {
  test('rectangular worlds retain one uniform scale and centre inside the available frame', () => {
    const layout = fitMinimap({ width: 24, height: 20 }, { x: 9, y: 21, width: 130, height: 78 });
    expect(layout.scale).toBe(3.9);
    expect(layout.width / 24).toBe(layout.height / 20);
    expect(layout.x + layout.width / 2).toBe(74);
    expect(layout.y + layout.height).toBe(99);
    expect(minimapPoint(layout, { x: 0, y: 0 })).toEqual({ x: layout.x, y: layout.y });
    expect(minimapPoint(layout, { x: 24, y: 20 })).toEqual({ x: layout.x + layout.width, y: 99 });
  });

  test('camera clipping preserves diagonal edges and does not pin an off-world camera to the border', () => {
    const world = { width: 10, height: 10 }, layout = fitMinimap(world, { x: 0, y: 0, width: 100, height: 100 });
    const corners = [{ x: 5, y: -5 }, { x: 15, y: 5 }, { x: 5, y: 15 }, { x: -5, y: 5 }], before = structuredClone(corners);
    const result = minimapViewport(world, corners, layout);
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result.every(p => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100)).toBe(true);
    const small = minimapViewport(world, [{ x: 2, y: 1 }, { x: 4, y: 3 }, { x: 2, y: 5 }, { x: 0, y: 3 }], layout);
    expect(small).toEqual([{ x: 20, y: 10 }, { x: 40, y: 30 }, { x: 20, y: 50 }, { x: 0, y: 30 }]);
    expect(minimapViewport(world, corners.map(p => ({ x: p.x + 50, y: p.y + 50 })), layout)).toEqual([]);
    expect(corners).toEqual(before);
  });

  test('the travelled trail handles unequal corner lengths and reveals no future path or segment', () => {
    const plan = { segments: [{ path: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }] },
      { path: [{ x: 3, y: 4 }, { x: 9, y: 9 }] }] } as RaidFieldPlan;
    const before = structuredClone(plan);
    expect(raidMinimapTrail(plan, { segmentIndex: 0, segmentProgress: .5, position: { x: 3, y: .5 } })).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: .5 }]);
    expect(raidMinimapTrail(plan, { segmentIndex: 1, segmentProgress: 0, position: { x: 3, y: 4 } })).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);
    expect(plan).toEqual(before);
  });
});
