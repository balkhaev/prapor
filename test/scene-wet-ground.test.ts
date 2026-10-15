import { describe, expect, test } from 'bun:test';
import { wetGroundCandidates, raidWetGround, WetGroundFrameCache, WET_GROUND_CANDIDATE_LIMIT } from '../src/scene-wet-ground';
import { sampleWetSurfaces } from '../src/scene-wet-surfaces';
import { pixelIso } from '../src/pixel-art';
import { createGame, dispatchRaid } from '../src/game/engine';
import { getRaidFieldPlan } from '../src/raid-field';
import { MAPS } from '../src/game/data';
import type { LiveTerrain } from '../src/game/live';

const fixture = (width = 14, height = 12) => ({ width, height, seed: 'wet-ground-check',
  terrain: Array<LiveTerrain>(width * height).fill('road'), walkable: new Uint8Array(width * height).fill(1) });
function insideCell(patch: { x: number; y: number; width: number; height: number }, x: number, y: number): void {
  for (const dx of [-patch.width / 2, patch.width / 2]) for (const dy of [-patch.height / 2, patch.height / 2]) {
    const u = ((patch.x + dx) / 64 + (patch.y + dy) / 32) / 2, v = ((patch.y + dy) / 32 - (patch.x + dx) / 64) / 2;
    expect(u).toBeGreaterThanOrEqual(x); expect(u).toBeLessThanOrEqual(x + 1);
    expect(v).toBeGreaterThanOrEqual(y); expect(v).toBeLessThanOrEqual(y + 1);
  }
}

describe('world wet ground selection', () => {
  test('whole puddles fit safe cells and exclude water, rail, rooms, colliders and fractional props', () => {
    const input = fixture(), indoor = new Uint8Array(input.width * input.height);
    for (let x = 0; x < input.width; x++) input.terrain[x] = 'water';
    for (let y = 0; y < input.height; y++) {
      input.walkable[y * input.width + 1] = 0; indoor[y * input.width + 2] = 1;
      input.terrain[y * input.width + 3] = 'rail'; input.terrain[y * input.width + 4] = 'yard';
    }
    const blocked = [{ x: 7.4, y: 3.6, width: 2.2, height: 2.1 }], original = structuredClone(input);
    const first = wetGroundCandidates({ ...input, indoor, blocked });
    expect(first.length).toBeGreaterThan(10); expect(first).toEqual(wetGroundCandidates({ ...input, indoor, blocked }));
    for (const candidate of first) {
      const cell = candidate.y * input.width + candidate.x;
      expect(input.walkable[cell]).toBe(1); expect(indoor[cell]).toBe(0);
      expect(['water', 'rail']).not.toContain(input.terrain[cell]!);
      expect(candidate.x + 1 <= 7.4 || candidate.x >= 9.6 || candidate.y + 1 <= 3.6 || candidate.y >= 5.7).toBe(true);
      insideCell(candidate.patch, candidate.x, candidate.y);
    }
    expect(input).toEqual(original);
    expect(wetGroundCandidates({ ...input, indoor, blocked: [{ x: -10, y: 0, width: 2, height: 10 }] })).toEqual(wetGroundCandidates({ ...input, indoor }));
  });

  test('a large world stays bounded while sampling every distant region with stable anchors', () => {
    const input = fixture(512, 512), points = wetGroundCandidates(input);
    expect(points.length).toBeLessThanOrEqual(WET_GROUND_CANDIDATE_LIMIT); expect(points.length).toBeGreaterThan(10000);
    expect(points.some(p => p.x < 20 && p.y < 20)).toBe(true);
    expect(points.some(p => p.x > 490 && p.y > 490)).toBe(true);
    expect(points).toEqual(wetGroundCandidates(input));
  });

  test('an actual lamp can reflect only in a nearby safe puddle aligned to its real ground column', () => {
    const input = fixture(), lamps = [{ x: 37, y: 256, headY: 57, radius: 145 }];
    const candidates = wetGroundCandidates({ ...input, lamps });
    const aligned = candidates.find(candidate => Math.abs(candidate.patch.x - lamps[0]!.x) < candidate.patch.width / 2
      && candidate.patch.y > lamps[0]!.y && candidate.patch.y < lamps[0]!.y + lamps[0]!.radius * .5)!;
    expect(aligned).toBeDefined(); insideCell(aligned.patch, aligned.x, aligned.y);
    const frame = sampleWetSurfaces({ patches: [aligned.patch], lamps, timeMs: 1000, wetness: 1, rain: .5, lights: 1.5 });
    const reflections = frame.marks.filter(mark => mark.kind === 'reflection');
    expect(reflections.length).toBeGreaterThan(0);
    expect(reflections.every(mark => Math.abs(mark.x + mark.width / 2 - lamps[0]!.x) <= 4)).toBe(true);
    expect(sampleWetSurfaces({ patches: [aligned.patch], lamps: [], timeMs: 1000, wetness: 1, rain: .5, lights: 1.5 }).marks.some(mark => mark.kind === 'reflection')).toBe(false);
    const covered = new Uint8Array(input.width * input.height).fill(1);
    expect(wetGroundCandidates({ ...input, indoor: covered, lamps })).toEqual([]);
  });

  test('paid plans preserve their real lamp origins and never wet their buildings or underground bunker', () => {
    const now = 1_792_000_000_000;
    for (const map of MAPS) {
      const state = createGame(now); state.level = 9; state.money = 5000; state.supplies = { ammo: 200, medicine: 6, scrap: 40, intel: 100 };
      expect(dispatchRaid(state, state.scavs[0]!.id, map.id, now).ok).toBe(true);
      const plan = getRaidFieldPlan(state.raids[0]!), before = structuredClone(plan), wet = raidWetGround(plan);
      if (map.id === 'bunker') expect(wet).toEqual({ patches: [], lamps: [] });
      else {
        expect(wet.patches.length).toBeGreaterThan(0); expect(wet.lamps.length).toBe(plan.props.filter(prop => prop.kind === 'lamp').length);
        for (const patch of wet.patches) {
          const x = Math.floor((patch.x / 64 + patch.y / 32) / 2), y = Math.floor((patch.y / 32 - patch.x / 64) / 2);
          expect(plan.walkable[y * plan.width + x]).toBe(true);
          expect(plan.buildings.some(building => x < building.x + building.width && x + 1 > building.x && y < building.y + building.height && y + 1 > building.y)).toBe(false);
        }
        const lamp = plan.props.find(prop => prop.kind === 'lamp')!, center = pixelIso(lamp.x, lamp.y);
        expect(wet.lamps[0]).toMatchObject({ x: center.x + 37, y: center.y, headY: center.y - 199, radius: 145 });
      }
      expect(plan).toEqual(before);
    }
  });

  test('native frames survive camera transforms, reuse a 20Hz sample and reset after a world change', () => {
    const patch = wetGroundCandidates(fixture())[0]!.patch, cache = new WetGroundFrameCache();
    const input = { patches: [patch], lamps: [], timeMs: 1000, wetness: .8, rain: .6, lights: 1.2 };
    const first = cache.get(input);
    expect(cache.get({ ...input, timeMs: 1049 })).toBe(first); expect(cache.get({ ...input, timeMs: 1050 })).not.toBe(first);
    expect(cache.get({ ...input, patches: [{ ...patch, seed: patch.seed + 1 }] })).not.toBe(first);
    cache.clear(); const reloaded = cache.get(input); expect(reloaded).not.toBe(first); expect(reloaded).toEqual(first);
  });
});
