import { describe, expect, test } from 'bun:test';
import { LIVE_TICK_MS, LIVE_PLAYER_MOVE_MS, LIVE_NPC_MOVE_MS, LIVE_SNAPSHOT_MS, liveMovementInterval, livePollDelay } from '../src/game/live-timing';

describe('independent live clocks', () => {
  test('higher tick rate retains the previous healthy and injured walking cadence', () => {
    expect(LIVE_TICK_MS).toBe(50);
    expect(liveMovementInterval('player', 1)).toBe(LIVE_PLAYER_MOVE_MS);
    expect(liveMovementInterval('scav', 1)).toBe(LIVE_NPC_MOVE_MS);
    for (const [movement, player, scav] of [[1, 500, 750], [.8, 500, 1000], [.55, 750, 1500], [.35, 1250, 2250], [.25, 1500, 3000]]) {
      expect(liveMovementInterval('player', movement!)).toBe(player!);
      expect(liveMovementInterval('scav', movement!)).toBe(scav!);
    }
  });

  test('foreground pacing includes response time while retaining room for actions in the player quota', () => {
    expect(livePollDelay(true, false, false, 30) + 30).toBe(LIVE_SNAPSHOT_MS);
    expect(livePollDelay(true, false, false, 500)).toBeGreaterThanOrEqual(LIVE_TICK_MS);
    expect(60_000 / LIVE_SNAPSHOT_MS).toBeLessThan(600);
    expect(livePollDelay(true, false, true, 100)).toBe(900);
  });

  test('preparation and failure retries wait a full two seconds even after a slow timeout', () => {
    expect(livePollDelay(false, false, false, 12_000)).toBe(2000);
    expect(livePollDelay(true, true, false, 12_000)).toBe(2000);
    expect(livePollDelay(true, false, false, NaN)).toBe(LIVE_SNAPSHOT_MS);
  });
});
