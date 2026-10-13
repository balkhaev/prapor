import type { LiveContainerAnchor, LiveWorld } from '../src/game/live';

/** Content slots survive prefab changes even when the bag type has changed. */
function containerSlot(id: string): string | undefined {
  const match = /^(poi-\d+-\d+)-[a-z]+-(\d+)$/.exec(id);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

export function migratedContainerAnchor(world: LiveWorld, previousId: string): LiveContainerAnchor | undefined {
  const exact = world.containers.find(anchor => anchor.id === previousId);
  if (exact) return exact;
  const slot = containerSlot(previousId);
  return slot ? world.containers.find(anchor => containerSlot(anchor.id) === slot) : undefined;
}

export function migratedLootCooldownKey(world: LiveWorld, previousKey: string): string | undefined {
  if (!previousKey.startsWith('container:')) return previousKey;
  const anchor = migratedContainerAnchor(world, previousKey.slice('container:'.length));
  return anchor ? `container:${anchor.id}` : undefined;
}
