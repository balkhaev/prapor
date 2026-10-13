import { describe, expect, test } from 'bun:test';
import { createGame, dispatchSquadRaid, setGameOutcomeSeedSource } from '../src/game/engine';
import type { GameSnapshot } from '../src/game/commands';
import { createAuthoritativeClient, readAuthoritativeSnapshot } from '../src/authoritative-client';

const NOW = 1_792_000_000_000;
const snapshot = (revision = 1, id = 'guest-1', kind: 'guest' | 'account' = 'guest'): GameSnapshot => ({ state: createGame(NOW), revision, serverNow: NOW + 100_000, identity: { id, kind, name: kind === 'guest' ? 'Гость 01' : 'Игрок' } });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const transport = (run: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch => run as unknown as typeof fetch;
const tick = () => new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));

describe('authoritative shelter transport', () => {
  test('validation preserves server state without applying elapsed time or client advancement', () => {
    const value = snapshot(), before = JSON.stringify(value.state);
    const parsed = readAuthoritativeSnapshot(value);
    expect(parsed.state.lastUpdated).toBe(NOW);
    expect(JSON.stringify(parsed.state)).toBe(before);
    expect(() => readAuthoritativeSnapshot({ ...value, revision: -1 })).toThrow();
    expect(() => readAuthoritativeSnapshot({ ...value, state: { schemaVersion: 11 } })).toThrow();
  });
  test('validates a squad snapshot with private outcome seeds withheld and preserves its exact public wire state', () => {
    const value = snapshot();
    value.state.money = 30_000;
    value.state.supplies = { ammo: 500, medicine: 50, scrap: 1000, intel: 100 };
    setGameOutcomeSeedSource(value.state, () => 0x1234abcd);
    expect(dispatchSquadRaid(value.state, value.state.scavs.slice(0, 2).map(scav => scav.id), 'courtyard', NOW).ok).toBe(true);
    expect(value.state.raids.some(raid => raid.outcomeSeed !== undefined)).toBe(true);
    const publicValue = JSON.parse(JSON.stringify(value, (key, item: unknown) => key === 'outcomeSeed' ? undefined : item)) as GameSnapshot;
    publicValue.state.rng = 1;
    const before = JSON.stringify(publicValue.state);
    const parsed = readAuthoritativeSnapshot(publicValue);
    expect(parsed.state).toBe(publicValue.state);
    expect(parsed.state.rng).toBe(1);
    expect(JSON.stringify(parsed.state)).toBe(before);
    expect(parsed.state.lastUpdated).toBe(NOW);
  });
  test('coalesces joins and sends intent without a client state or clock', async () => {
    let requests = 0; const received: RequestInit[] = [];
    const client = createAuthoritativeClient({ getAccountId: () => null, onSnapshot: () => {}, fetch: transport(async (_url, init) => { requests++; received.push(init!); return response(snapshot()); }) });
    const a = client.join(), b = client.join();
    expect(a).toBe(b); await Promise.all([a, b]);
    expect(requests).toBe(1); expect(JSON.parse(received[0]!.body as string)).toEqual({});
    expect(client.isReady()).toBe(true); client.destroy();
  });
  test('serializes a command behind a poll and rejects a second pending click', async () => {
    let release!: (response: Response) => void;
    const requests: { url: string; init: RequestInit }[] = [];
    const client = createAuthoritativeClient({ getAccountId: () => null, onSnapshot: () => {}, fetch: transport(async (url, init) => {
      requests.push({ url, init: init! });
      if (url.endsWith('/join')) return response(snapshot());
      if (url.endsWith('/state')) return new Promise<Response>(resolve => { release = resolve; });
      return response({ ...snapshot(3), result: { ok: true, message: 'Готово' } });
    }) });
    await client.join(); const poll = client.poll(); await tick();
    const first = client.action({ type: 'refreshRecruitment', args: [] });
    expect(client.isBusy()).toBe(true);
    expect((await client.action({ type: 'refreshRecruitment', args: [] })).ok).toBe(false);
    expect(requests).toHaveLength(2);
    release(response(snapshot(2))); await poll; expect((await first).ok).toBe(true);
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[2]!.init.body as string)).toEqual({ revision: 2, command: { type: 'refreshRecruitment', args: [] } });
    expect(requests[2]!.init.headers).toMatchObject({ 'x-prapor-game': 'guest-1' });
    expect(client.isBusy()).toBe(false); client.destroy();
  });
  test('a revision conflict installs the server snapshot and never replays the command', async () => {
    let actions = 0;
    const applied: number[] = [];
    const client = createAuthoritativeClient({ getAccountId: () => null, onSnapshot: next => applied.push(next.revision), fetch: transport(async url => {
      if (url.endsWith('/action')) { actions++; return response({ code: 'revision_conflict', snapshot: snapshot(5) }, 409); }
      return response(snapshot());
    }) });
    await client.join(); const result = await client.action({ type: 'refreshRecruitment', args: [] });
    expect(result.ok).toBe(false); expect(actions).toBe(1); expect(applied).toEqual([1, 5]);
    expect(client.getSnapshot()?.revision).toBe(5); expect(client.isReady()).toBe(true); client.destroy();
  });
  test('uncertain network outcomes do not replay spending actions', async () => {
    let actions = 0;
    const client = createAuthoritativeClient({ getAccountId: () => null, onSnapshot: () => {}, fetch: transport(async url => {
      if (url.endsWith('/action')) { actions++; throw new TypeError('network'); }
      return response(snapshot());
    }) });
    await client.join(); const result = await client.action({ type: 'buySupplies', args: ['ammo'] });
    expect(result.ok).toBe(false); expect(result.message).toContain('мог выполниться'); expect(actions).toBe(1);
    expect(client.isReady()).toBe(false);
    expect((await client.action({ type: 'buySupplies', args: ['ammo'] })).ok).toBe(false);
    expect(actions).toBe(1);
    await client.poll(); expect(client.isReady()).toBe(true);
    client.destroy();
  });
  test('rejects a conflict snapshot belonging to another player', async () => {
    const applied: string[] = [];
    const client = createAuthoritativeClient({ getAccountId: () => null, onSnapshot: next => applied.push(next.identity.id), fetch: transport(async url => url.endsWith('/action') ? response({ code: 'revision_conflict', snapshot: snapshot(9, 'guest-other') }, 409) : response(snapshot())) });
    await client.join(); const result = await client.action({ type: 'refreshRecruitment', args: [] });
    expect(result.ok).toBe(false); expect(applied).toEqual(['guest-1']); expect(client.isReady()).toBe(false);
    client.destroy();
  });
  test('an old account response cannot overwrite a changed identity', async () => {
    let account: string | null = null, release!: (response: Response) => void;
    const applied: string[] = [];
    const client = createAuthoritativeClient({ getAccountId: () => account, onSnapshot: next => applied.push(next.identity.id), fetch: transport(async url => {
      if (url.endsWith('/state')) return new Promise<Response>(resolve => { release = resolve; });
      return response(account ? snapshot(1, 'account-new', 'account') : snapshot());
    }) });
    await client.join(); const oldPoll = client.poll().catch(() => null); await tick();
    account = 'account-user-id'; client.resetIdentity(); const nextJoin = client.join();
    release(response(snapshot(2))); await oldPoll; await nextJoin;
    expect(applied).toEqual(['guest-1', 'account-new']); expect(client.getSnapshot()?.identity.kind).toBe('account');
    client.destroy();
  });
});
