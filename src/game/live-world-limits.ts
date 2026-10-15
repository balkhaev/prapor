/** Public, immutable geometry budgets. Nearby actor/loot visibility has its own
 * tighter limits and does not grow when the static world grows. */
export const LIVE_WORLD_LIMITS = Object.freeze({
  side: 1024,
  citySites: 256,
  cityQuarters: 16,
  buildings: 1024,
  obstacles: 32768,
  props: 16384,
  pois: 512,
  containers: 2048,
  zones: 2048,
  paths: 768,
  npcs: 512,
  wireBytes: 16 * 1024 * 1024,
});
