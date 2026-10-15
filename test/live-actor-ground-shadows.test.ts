import { expect, test } from 'bun:test';
import { actorGroundShadowOutline, paintActorGroundShadows } from '../src/live-actor-ground-shadows';
import type { LiveTerrain } from '../src/game/live';

test('body shadows follow sun direction continuously, disappear without sunlight and do not alter actor state', () => {
  const actor = { x: 8, y: 6, health: 100 }, before = structuredClone(actor);
  const sun = { direction: { x: .7, y: .72 }, intensity: 1 }, shape = actorGroundShadowOutline(actor, sun);
  expect(shape).toHaveLength(8);
  const tip = shape[3]!, dx = tip.x - actor.x - .5, dy = tip.y - actor.y - .5;
  // Projection of the cast vector agrees with the screen-space sunlight.
  expect((dx - dy) / ((dx + dy) / 2)).toBeCloseTo(sun.direction.x / sun.direction.y);
  expect(actorGroundShadowOutline(actor, { ...sun, intensity: 0 })).toEqual([]);
  expect(actorGroundShadowOutline({ ...actor, health: 0 }, sun)).toEqual([]);
  expect(actor).toEqual(before);
});

test('visible body shadows clip away interiors and water, batch overlaps once and restore canvas state', () => {
  const terrain = Array<LiveTerrain>(16 * 16).fill('concrete'), indoor = new Uint8Array(terrain.length);
  for (let y = 0; y < 16; y++) { terrain[y * 16 + 9] = 'water'; indoor[y * 16 + 10] = 1; }
  let saves = 0, fills = 0, clipped = false;
  const c = { save() { saves++; }, restore() { saves--; }, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    rect(x: number, y: number) { expect(terrain[y * 16 + x]).not.toBe('water'); expect(indoor[y * 16 + x]).toBe(0); },
    clip() { clipped = true; }, fill() { expect(clipped).toBe(true); fills++; },
  } as unknown as CanvasRenderingContext2D;
  paintActorGroundShadows(c, [{ x: 8, y: 6, health: 100 }, { x: 8.1, y: 6.1, health: 100 }, { x: 10, y: 6, health: 100 }], { direction: { x: .7, y: .72 }, intensity: 1 }, { width: 16, height: 16, terrain, indoor });
  expect(saves).toBe(0); expect(fills).toBe(1);
});
