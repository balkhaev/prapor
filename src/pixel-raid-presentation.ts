import type { RaidFieldBuilding, RaidFieldFrame, RaidFieldPlan, RaidFieldProp } from './raid-field';
import type { LiveCityBuilding, LiveWorldProp } from './game/live';
import type { PixelActorFrame, PixelFacing } from './pixel-animation';
import { PIXEL_ACTOR_CYCLE_MS, PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_LIMP_CYCLE_SCALE, PIXEL_ACTOR_WALK_CYCLE_DISTANCE, pixelActorTimedFrame } from './pixel-actor-config';

/** Sample the paid route analytically. Render frequency never creates steps. */
export function raidPixelDistance(plan: RaidFieldPlan, frame: Pick<RaidFieldFrame, 'segmentIndex' | 'segmentProgress'>): number {
  let distance = 0;
  for (let index = 0; index <= frame.segmentIndex && index < plan.segments.length; index++) {
    const path = plan.segments[index]!.path;
    const span = path.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - path[i]!.x, point.y - path[i]!.y), 0);
    distance += span * (index === frame.segmentIndex ? Math.max(0, Math.min(1, frame.segmentProgress)) : 1);
  }
  return distance;
}

type RaidPixelPresentation = {
  facing: PixelFacing; appearance: number; hostile?: boolean; downed?: boolean; limping?: boolean;
  reducedMotion?: boolean; shotAge?: number; displayHeight?: number;
};
export function raidPixelFrame(plan: RaidFieldPlan, frame: RaidFieldFrame, input: RaidPixelPresentation): PixelActorFrame {
  const facing = input.facing;
  if (input.downed) return { mode: 'downed', frame: 0, facing };
  if (!input.reducedMotion && !frame.paused && input.shotAge !== undefined && input.shotAge >= 0 && input.shotAge < PIXEL_ACTOR_CYCLE_MS.fire) return { mode: 'fire', frame: pixelActorTimedFrame('fire', input.shotAge, false), facing };
  if (frame.walking && !frame.paused && !input.hostile) {
    if (input.reducedMotion) return { mode: 'idle', frame: 0, facing };
    // Phaser's shared adapter uses height/160; the live compositor uses .32.
    const height = Number.isFinite(input.displayHeight) && input.displayHeight! > 0 ? input.displayHeight! : 48;
    const distance = raidPixelDistance(plan, frame), cycle = PIXEL_ACTOR_WALK_CYCLE_DISTANCE * height / (160 * .32) * (input.limping ? PIXEL_ACTOR_LIMP_CYCLE_SCALE : 1);
    return { mode: 'walk', frame: Math.floor(distance / cycle * PIXEL_ACTOR_FRAMES.walk) % PIXEL_ACTOR_FRAMES.walk, facing };
  }
  const mode = frame.action === 'skirmish' || frame.action === 'cover' ? 'aim' : 'idle';
  return { mode, frame: input.reducedMotion || frame.paused ? 0 : pixelActorTimedFrame(mode, frame.weatherPhase * 1000 + input.appearance * 173), facing };
}

/** Existing paid geometry is reused verbatim; this conversion only selects art. */
export function raidPixelBuilding(building: RaidFieldBuilding): LiveCityBuilding {
  return { id: building.id, name: building.kind, x: building.x, y: building.y, width: building.width, height: building.height, entrances: [],
    kind: building.kind === 'apartments' ? 'apartment' : building.kind === 'garage' || building.kind === 'bunker' ? 'garage' : building.kind === 'cabin' ? 'service' : 'workshop',
    floors: building.kind === 'apartments' ? 2 : 1,
    facade: building.kind === 'apartments' ? 'plaster' : building.kind === 'cabin' ? 'panel' : building.kind === 'factory' ? 'brick' : 'metal',
    roof: building.kind === 'factory' ? 'sawtooth' : building.kind === 'bunker' ? 'flat' : 'gable' };
}

export function raidPixelProp(prop: RaidFieldProp): LiveWorldProp {
  const kind = prop.kind === 'barrier' || prop.kind === 'sandbags' ? 'fence' : prop.kind;
  const size = prop.kind === 'car' ? [1.35, .65] : prop.kind === 'tree' ? [1, 1] : prop.kind === 'lamp' ? [.25, .25] : prop.kind === 'barrier' || prop.kind === 'sandbags' ? [1.4, .3] : [.55, .55];
  return { id: prop.id, kind, x: prop.x, y: prop.y, width: size[0]!, height: size[1]!, orientation: 'x', variant: 0, blocking: prop.blocking };
}
