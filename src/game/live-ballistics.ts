import type { LivePoint, LiveWorld } from './live';

/** A missed round stops at the first solid footprint, including the face of an
 * adjacent cover cell. Water stays transparent, as in authoritative sight. */
export function traceLiveBulletImpact(world: Pick<LiveWorld, 'obstacles' | 'width' | 'height' | 'props'>, from: LivePoint, end: LivePoint): {
  impactPoint: LivePoint; impact: 'ground' | 'masonry' | 'metal' | 'wood';
} {
  const dx = end.x - from.x, dy = end.y - from.y;
  let nearest = 1, impact: 'ground' | 'masonry' | 'metal' | 'wood' = 'ground';
  for (const obstacle of world.obstacles) {
    if (obstacle.kind === 'water') continue;
    let enter = 0, leave = 1;
    for (const [origin, direction, low, high] of [[from.x, dx, obstacle.x - .5, obstacle.x + obstacle.width - .5], [from.y, dy, obstacle.y - .5, obstacle.y + obstacle.height - .5]]) {
      if (Math.abs(direction!) < 1e-9) { if (origin! < low! || origin! > high!) { enter = Infinity; break; } }
      else {
        const a = (low! - origin!) / direction!, b = (high! - origin!) / direction!;
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (enter <= leave && enter >= 0 && enter < nearest) {
      nearest = enter;
      const prop = obstacle.propId ? world.props?.find(prop => prop.id === obstacle.propId) : undefined;
      impact = prop && ['car', 'van', 'truck', 'bus', 'dumpster', 'barrel', 'railcar', 'transformer', 'hydrant', 'bollard', 'kiosk', 'shed'].includes(prop.kind)
        ? 'metal' : prop && ['crate', 'pallet', 'logs', 'bench', 'workbench', 'market-stall', 'tree'].includes(prop.kind)
        ? 'wood' : obstacle.kind === 'container' ? 'metal' : obstacle.kind === 'tree' || obstacle.kind === 'barricade' ? 'wood' : 'masonry';
    }
  }
  return { impactPoint: { x: Math.max(0, Math.min(world.width - 1, from.x + dx * nearest)), y: Math.max(0, Math.min(world.height - 1, from.y + dy * nearest)) }, impact };
}
