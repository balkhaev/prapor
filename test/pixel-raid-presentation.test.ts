import { describe, expect, test } from 'bun:test';
import { createGame, dispatchRaid, type Raid } from '../src/game/engine';
import { MAPS } from '../src/game/data';
import { getRaidFieldFrame, getRaidFieldPlan } from '../src/raid-field';
import { PIXEL_ACTOR_CYCLE_MS, PIXEL_ACTOR_FRAMES } from '../src/pixel-actor-config';
import { pixelActorRig } from '../src/pixel-actor-rig';
import { raidPixelBuilding, raidPixelDistance, raidPixelFrame, raidPixelProp } from '../src/pixel-raid-presentation';

const NOW = 1_792_000_000_000;
function fixture(map = 'courtyard'): Raid {
  const game = createGame(NOW); game.level = 9; game.money = 5000;
  game.supplies = { ammo: 200, medicine: 6, scrap: 40, intel: 100 };
  expect(dispatchRaid(game, game.scavs[0]!.id, map, NOW).ok).toBe(true);
  return game.raids[0]!;
}

describe('paid raid pixel presentation', () => {
  test('a corner preserves the distance walked instead of restarting the gait or measuring a shortcut', () => {
    const raid = fixture(), plan = getRaidFieldPlan(raid), before = structuredClone(plan);
    plan.segments = [{ ...plan.segments[0]!, path: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }] },
      { ...plan.segments[1]!, path: [{ x: 3, y: 4 }, { x: 5, y: 4 }] }];
    expect(raidPixelDistance(plan, { segmentIndex: 0, segmentProgress: .5 })).toBe(3.5);
    expect(raidPixelDistance(plan, { segmentIndex: 0, segmentProgress: 1 })).toBe(7);
    expect(raidPixelDistance(plan, { segmentIndex: 1, segmentProgress: 0 })).toBe(7);
    expect(raidPixelDistance(plan, { segmentIndex: 1, segmentProgress: .5 })).toBe(8);
    expect(raidPixelDistance(plan, { segmentIndex: 1, segmentProgress: 2 })).toBe(9);
    expect(getRaidFieldPlan(raid)).toEqual(before);
  });

  test('the existing native support foot remains planted at multiple Phaser display scales', () => {
    const raid = fixture(), plan = getRaidFieldPlan(raid), source = getRaidFieldFrame(raid, NOW, plan);
    plan.segments = [{ ...plan.segments[0]!, path: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }];
    for (const displayHeight of [40, 48, 64]) {
      const scale = displayHeight / 160, positions = [];
      // A six-frame support stroke moves the body by the leg's native stride.
      for (let phase = 0; phase < 6; phase++) {
        const distance = (56 / .6 / Math.SQRT2 * scale / 32) * (phase + .01) / 12;
        const animation = raidPixelFrame(plan, { ...source, walking: true, segmentIndex: 0, segmentProgress: distance / 10 }, { facing: 'se', appearance: 0, displayHeight });
        expect(animation).toMatchObject({ mode: 'walk', frame: phase });
        const rig = pixelActorRig(animation);
        positions.push({ x: distance * 32 + (rig.leftHeel.x - rig.anchor.x) * scale, y: distance * 16 + (rig.leftHeel.y - rig.anchor.y) * scale });
      }
      expect(Math.max(...positions.map(p => p.x)) - Math.min(...positions.map(p => p.x))).toBeLessThan(.4);
      expect(Math.max(...positions.map(p => p.y)) - Math.min(...positions.map(p => p.y))).toBeLessThan(.4);
    }
  });

  test('aiming never invents a discharge; an observed cue has one finite recoil and recovery', () => {
    const raid = fixture(), plan = getRaidFieldPlan(raid), source = { ...getRaidFieldFrame(raid, NOW, plan), walking: false, action: 'skirmish' as const };
    const input = { facing: 'e' as const, appearance: 7 };
    expect(raidPixelFrame(plan, source, input).mode).toBe('aim');
    for (const shotAge of [0, 44, 88, 132, 176]) expect(raidPixelFrame(plan, source, { ...input, shotAge })).toMatchObject({ mode: 'fire', frame: shotAge / 44 });
    for (const shotAge of [-1, NaN, Infinity, PIXEL_ACTOR_CYCLE_MS.fire, 10000]) expect(raidPixelFrame(plan, source, { ...input, shotAge }).mode).toBe('aim');
    expect(raidPixelFrame(plan, { ...source, paused: true }, { ...input, shotAge: 0 })).toMatchObject({ mode: 'aim', frame: 0 });
    expect(raidPixelFrame(plan, source, { ...input, shotAge: 0, reducedMotion: true })).toMatchObject({ mode: 'aim', frame: 0 });
    expect(raidPixelFrame(plan, source, { ...input, shotAge: 0, downed: true })).toMatchObject({ mode: 'downed', frame: 0 });
    expect(raidPixelFrame(plan, { ...source, walking: true }, { ...input, reducedMotion: true })).toMatchObject({ mode: 'idle', frame: 0 });
  });

  test('all six public routes sample bounded identical poses after reload at any render frequency', () => {
    for (const map of MAPS) {
      const raid = fixture(map.id), plan = getRaidFieldPlan(raid), original = structuredClone(raid), end = NOW + (raid.endsAt - NOW) * .625;
      const sample = (now: number) => raidPixelFrame(plan, getRaidFieldFrame(raid, now, plan), { facing: 'nw', appearance: 5 });
      const expected = sample(end);
      for (const step of [1000 / 30, 1000 / 120]) {
        for (let now = end - 1000; now < end; now += step) {
          const pose = sample(now); expect(pose.frame).toBeGreaterThanOrEqual(0); expect(pose.frame).toBeLessThan(PIXEL_ACTOR_FRAMES[pose.mode]);
        }
        expect(sample(end)).toEqual(expected);
      }
      const reloaded = structuredClone(raid), reloadPlan = getRaidFieldPlan(reloaded);
      expect(raidPixelFrame(reloadPlan, getRaidFieldFrame(reloaded, end, reloadPlan), { facing: 'nw', appearance: 5 })).toEqual(expected);
      expect(raid).toEqual(original);
    }
  });

  test('pixel scenery conversion retains every authored location, footprint and blocking flag', () => {
    for (const map of MAPS) {
      const plan = getRaidFieldPlan(fixture(map.id)), before = structuredClone(plan);
      for (const building of plan.buildings) expect(raidPixelBuilding(building)).toMatchObject({ id: building.id, x: building.x, y: building.y, width: building.width, height: building.height });
      for (const prop of plan.props) expect(raidPixelProp(prop)).toMatchObject({ id: prop.id, x: prop.x, y: prop.y, blocking: prop.blocking });
      expect(plan).toEqual(before);
    }
  });
});
