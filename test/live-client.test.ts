import { describe, expect, test } from 'bun:test';
import { LiveApiError, readLiveSnapshot, readLiveStatus, shouldRejoinLivePresence } from '../src/live-client';
import type { LiveSnapshot } from '../src/game/live';
import { createHealth, createMedicalInventory } from '../src/game/health';

const fixture = (): LiveSnapshot => ({ server: { id: 'perimeter-1', name: 'Периметр 01', online: 1, capacity: 32, startedAt: 1000 }, now: 2000, world: { width: 32, height: 24, obstacles: [{ x: 5, y: 5, width: 2, height: 3 }], extracts: [{ x: 2, y: 2 }] }, selfId: 'player-1', self: { id: 'player-1', ammo: 30, medkits: 2, cargo: 0, stash: 12, kills: 0, respawnAt: 0, patrol: false, body: createHealth(), medicine: createMedicalInventory(), treatment: null, leaveAt: 0 }, entities: [{ id: 'player-1', kind: 'player', name: 'Гость 01', appearance: 31, x: 2, y: 2, health: 100, action: 'idle', safeUntil: 7000 }, { id: 'scav-1', kind: 'scav', name: 'Косой', appearance: 0, x: 4, y: 6, health: 75, action: 'moving', safeUntil: 0 }], drops: [{ id: 'drop-1', x: 3, y: 2, amount: 25 }], events: [{ id: 'event-1', at: 2000, kind: 'join', text: 'Гость 01 вошёл', actorId: 'player-1' }] });

describe('live wire parser', () => {
  test('preserves server time, identity, kit and NPC distinction without advancing them', () => {
    const source = fixture(), snapshot = readLiveSnapshot(source);
    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(snapshot.entities[1]?.kind).toBe('scav');
  });
  test('rejects a different self and duplicate entities', () => {
    const wrongSelf = fixture(); wrongSelf.self.id = 'other';
    expect(() => readLiveSnapshot(wrongSelf)).toThrow(LiveApiError);
    const duplicated = fixture(); duplicated.entities.push({ ...duplicated.entities[0]! });
    expect(() => readLiveSnapshot(duplicated)).toThrow(LiveApiError);
  });
  test('rejects off-map positions, unbounded world and invalid kit', () => {
    const offMap = fixture(); offMap.entities[0]!.x = 32;
    expect(() => readLiveSnapshot(offMap)).toThrow(LiveApiError);
    const world = fixture(); world.world.obstacles[0]!.width = 40;
    expect(() => readLiveSnapshot(world)).toThrow(LiveApiError);
    const kit = fixture(); kit.self.ammo = -1;
    expect(() => readLiveSnapshot(kit)).toThrow(LiveApiError);
    expect(() => readLiveStatus({ ...fixture().server, online: 33 })).toThrow(LiveApiError);
  });
  test('keeps names as data for the escaped renderer and rejects malformed events', () => {
    const source = fixture(); source.entities[0]!.name = '<img src=x onerror=alert(1)>';
    expect(readLiveSnapshot(source).entities[0]?.name).toBe(source.entities[0]!.name);
    expect(() => readLiveSnapshot({ ...source, events: [{ ...source.events[0], text: { html: 'bad' } }] })).toThrow(LiveApiError);
  });
  test('vetted server error codes provide useful localized feedback', () => {
    expect(new LiveApiError(409, 'target_out_of_range').message).toContain('укрытием');
    expect(new LiveApiError(409, 'spawn_protection').message).toContain('защитой');
    expect(new LiveApiError(409, 'cargo_full').message).toContain('Груз заполнен');
    expect(new LiveApiError(409, '<script>private error</script>').message).not.toContain('script');
  });
  test('rejoins only lost presence for the unchanged identity after a server restart', () => {
    const missing = new LiveApiError(401, 'join_required');
    expect(missing.message).toContain('Связь с сервером восстановлена');
    expect(missing.message).not.toContain('аккаунт');
    expect(shouldRejoinLivePresence(missing, null, null)).toBe(true);
    expect(shouldRejoinLivePresence(missing, 'account-a', 'account-a')).toBe(true);
    expect(shouldRejoinLivePresence(missing, 'account-a', 'account-b')).toBe(false);
    expect(shouldRejoinLivePresence(new LiveApiError(401, 'account_changed'), 'account-a', 'account-a')).toBe(false);
    expect(shouldRejoinLivePresence(new LiveApiError(401, 'live_identity_changed'), null, null)).toBe(false);
    expect(shouldRejoinLivePresence(new LiveApiError(409, 'join_required'), null, null)).toBe(false);
  });
});
