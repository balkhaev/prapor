/** Simulation and transport clocks are independent of the distance a fighter covers. */
export const LIVE_TICK_MS = 50;
export const LIVE_PLAYER_MOVE_MS = 500;
export const LIVE_NPC_MOVE_MS = 750;
export const LIVE_SNAPSHOT_MS = 125;
export const LIVE_BACKGROUND_SNAPSHOT_MS = 1000;
export const LIVE_RETRY_MS = 2000;

/** Retain the existing 250 ms movement balance, including each injury threshold. */
export function liveMovementInterval(kind: 'player' | 'scav', movement: number): number {
  const multiplier = Math.max(.25, Number.isFinite(movement) ? movement : 1);
  return Math.ceil((kind === 'player' ? 350 : LIVE_NPC_MOVE_MS) / multiplier / 250) * 250;
}

/** Pace reads from their start; slow responses never create concurrent requests or catch-up bursts. */
export function livePollDelay(hasSnapshot: boolean, offline: boolean, hidden: boolean, elapsedMs = 0): number {
  const interval = !hasSnapshot || offline ? LIVE_RETRY_MS : hidden ? LIVE_BACKGROUND_SNAPSHOT_MS : LIVE_SNAPSHOT_MS;
  if (!hasSnapshot || offline) return interval;
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  return Math.max(LIVE_TICK_MS, interval - elapsed);
}
