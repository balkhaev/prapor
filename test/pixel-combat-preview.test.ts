import { expect, test } from 'bun:test';
import { createPixelCombatPreview, PIXEL_COMBAT_PREVIEW_FRAME_MS, PIXEL_COMBAT_PREVIEW_FRAMES } from '../src/pixel-combat-preview';

test('the workshop sequence uses both confirmed shots and continues walking after lowering the weapon', () => {
  const frames = createPixelCombatPreview();
  const at = (time: number) => frames[time / PIXEL_COMBAT_PREVIEW_FRAME_MS]!;
  expect(frames).toHaveLength(PIXEL_COMBAT_PREVIEW_FRAMES);
  expect(at(800).mode).toBe('walk');
  expect(at(1580).pose!.move).toBeGreaterThan(0);
  expect(at(1580).pose!.aim).toBeGreaterThan(0);
  expect(at(2000).pose).toMatchObject({ move: 0, aim: 1 });
  expect(at(2200).mode).toBe('fire');
  expect(at(2800).mode).toBe('fire');
  expect(at(2600).mode).toBe('aim');
  expect(at(3400).pose!.aim).toBeGreaterThan(0);
  expect(at(3800).pose).toMatchObject({ move: 0, aim: 0 });
  expect(at(4500).mode).toBe('walk');
  expect(at(5900).pose).toMatchObject({ move: 0, aim: 0 });
  expect(frames.filter(frame => frame.mode === 'fire')).toHaveLength(22);
});

test('seeking and rebuilding the sequence preserve its timestamps and limp gait', () => {
  const frames = createPixelCombatPreview(), repeated = createPixelCombatPreview();
  for (let index = frames.length - 1; index >= 0; index--) expect(frames[index]).toEqual(repeated[index]);
  const limp = createPixelCombatPreview(true);
  expect(limp[40]!.pose!.walkFrame).not.toBe(frames[40]!.pose!.walkFrame);
  for (const frame of [...frames, ...limp]) {
    expect(frame.pose!.move).toBeGreaterThanOrEqual(0); expect(frame.pose!.move).toBeLessThanOrEqual(1);
    expect(frame.pose!.aim).toBeGreaterThanOrEqual(0); expect(frame.pose!.aim).toBeLessThanOrEqual(1);
  }
});
