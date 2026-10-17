/** A cleared encounter stays cleared while fighters occupy it. The shared world
 * replenishes only after a separate NPC cooldown and an unobserved quiet period. */
export const NPC_RESPAWN_MS = 3 * 60_000;
export const NPC_RESPAWN_QUIET_MS = 30_000;
export const NPC_RESPAWN_CLEAR_RADIUS = 40;
export const NPC_RESPAWN_CHECK_MS = 1000;
/** A location receives individual arrivals, never a simultaneous reset of its garrison. */
export const NPC_SITE_REPLENISH_MS = 18_000;
