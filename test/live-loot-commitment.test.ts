import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService, type LiveService } from '../server/live';
import { createLiveSortie, LIVE_LOOT_COMMITMENT_MS, type LiveSortiePlan } from '../server/live-autobattle';
import { createLiveNavigation } from '../server/live-navigation';
import { getLiveMap } from '../src/game/live-maps';
import { createHealth } from '../src/game/health';
import type { LiveCommand, LiveDrop, LivePlayer, LivePoint, LiveSnapshot } from '../src/game/live';

const ORIGIN = 'https://loot-commitment.test', NOW = 1_800_000_000_000;
const world = getLiveMap('perimeter'), navigation = createLiveNavigation(world);
const START = { x: 729, y: 168 }, OCCLUDED = { x: 728, y: 168 };
const FIRST = world.containers.find(anchor => anchor.x === 722 && anchor.y === 166)!;
const SECOND = world.containers.find(anchor => anchor.x === 730 && anchor.y === 153)!;
interface Session { id: string; cookie: string }
interface SavedPlayer extends LivePlayer, LivePoint { identity: string; nextMove: number; sortie: LiveSortiePlan }
interface SavedDrop extends LiveDrop { mapId: string; expiresAt: number; source: string }
interface SavedWorld { scavs: Array<Record<string, unknown>>; drops: SavedDrop[]; lootCooldowns: Array<[string, number]> }
const fixtures: Array<{ close(): void }> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.close(); });

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'prapor-loot-commitment-')), dbPath = join(directory, 'live.sqlite');
  let time = NOW;
  const options = { dbPath, now: () => time, random: () => .5, automaticTicks: false, allowedOrigins: [ORIGIN] };
  let service: LiveService = createLiveService(options);
  async function request(path: string, session?: Session, body?: object) {
    const response = await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method: body ? 'POST' : 'GET', headers: {
      'x-prapor-world-version': world.version,
      ...(body ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
      ...(session ? { cookie: session.cookie, 'x-prapor-live': session.id } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    expect(response).not.toBeNull(); return response!;
  }
  async function state(session: Session): Promise<LiveSnapshot> {
    const response = await request('state', session); expect(response.status).toBe(200); return response.json() as Promise<LiveSnapshot>;
  }
  async function enter(session?: Session) {
    const response = await request('join', session, {}); expect(response.status).toBe(200);
    const snapshot = await response.json() as LiveSnapshot;
    return session ?? { id: snapshot.selfId, cookie: response.headers.get('set-cookie')!.split(';')[0]! };
  }
  const session = await enter();
  function readPlayer(db: Database): SavedPlayer {
    return db.query<{ state: string }, []>('SELECT state FROM live_players').all().map(row => JSON.parse(row.state) as SavedPlayer).find(player => player.id === session.id)!;
  }
  function stored() {
    const db = new Database(dbPath, { readonly: true });
    try { return readPlayer(db); } finally { db.close(); }
  }
  function restart(edit?: (player: SavedPlayer, value: SavedWorld) => void) {
    service.close(); const db = new Database(dbPath);
    try {
      const player = readPlayer(db), value = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state) as SavedWorld;
      edit?.(player, value);
      db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(player), player.identity);
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(value));
      for (const row of db.query<{ boss_id: string; state: string }, []>('SELECT boss_id,state FROM live_bosses').all()) {
        const boss = JSON.parse(row.state); Object.assign(boss, { nextMove: time + 1_000_000, nextAttack: time + 1_000_000 });
        db.query('UPDATE live_bosses SET state=? WHERE boss_id=?').run(JSON.stringify(boss), row.boss_id);
      }
    } finally { db.close(); }
    service = createLiveService(options);
  }
  restart((player, value) => {
    const plan = createLiveSortie(world, 'sawmill', 'loot', time);
    plan.sortie.poiIds = [FIRST.poiId]; plan.sortie.enteredStop = 0; plan.automation.stopCount = 1;
    Object.assign(player, START, plan, { purpose: 'loot', districtId: 'sawmill', body: createHealth(), health: 100,
      healthAt: time, nextMove: time, safeUntil: 0, dangerUntil: 0, lastCombatAt: 0, ammo: 60, cargo: 0, lootItems: [] });
    const dead = createHealth(); dead.parts.head.hp = 0;
    value.scavs = value.scavs.slice(0, 1).map(actor => ({ ...actor, body: dead, health: 0, respawnAt: time + 1_000_000, respawnQuietSince: null }));
    value.drops = value.drops.filter(drop => drop.containerId === FIRST.id || drop.containerId === SECOND.id);
    expect(value.drops).toHaveLength(2);
    for (const drop of value.drops) { drop.amount = drop.containerId === FIRST.id ? 37 : 11; drop.items = []; }
    value.lootCooldowns = world.containers.filter(anchor => anchor.id !== FIRST.id && anchor.id !== SECOND.id).map(anchor => [`container:${anchor.id}`, time + 1_000_000]);
  });
  await enter(session);
  async function tick() { time += 1000; service.tick(); expect(service.healthy()).toBe(true); return state(session); }
  function close() { service.close(); rmSync(directory, { recursive: true, force: true }); }
  fixtures.push({ close });
  return { session, state: () => state(session), stored, restart, enter: () => enter(session), tick, now: () => time,
    act: (command: LiveCommand) => request('action', session, command), close };
}
function self(snapshot: LiveSnapshot): LivePoint { return snapshot.entities.find(entity => entity.id === snapshot.selfId)!; }

describe('observed static loot remains a finite navigation commitment', () => {
  test('the reported city corner does not alternate between two containers when one disappears behind cover', async () => {
    expect(FIRST.poiId).toBe(SECOND.poiId);
    expect(navigation.hasLineOfSight(START, FIRST)).toBe(true); expect(navigation.hasLineOfSight(OCCLUDED, FIRST)).toBe(false);
    expect(navigation.hasLineOfSight(OCCLUDED, SECOND)).toBe(true);
    const f = await fixture(), initial = await f.state();
    const firstId = initial.drops.find(drop => drop.containerId === FIRST.id)!.id;
    expect(initial.drops.find(drop => drop.id === firstId)).toMatchObject({ amount: 0, searched: false });
    expect(initial.drops.find(drop => drop.id === firstId)!.items).toBeUndefined();
    const hidden = await f.tick(); expect(self(hidden)).toMatchObject(OCCLUDED);
    expect(hidden.drops.some(drop => drop.id === firstId)).toBe(false);
    expect(hidden.self.automation?.targetId).toBeNull(); expect(hidden.self.automation?.target).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain('lootCommitment'); expect(hidden.self.cargo).toBe(0);
    const committed = f.stored().sortie.lootCommitment!;
    expect(committed).toMatchObject({ containerId: FIRST.id, dropId: firstId, point: { x: FIRST.x, y: FIRST.y } });
    const remote = await f.act({ type: 'loot', id: firstId }); expect(remote.status).toBe(409);
    expect(await remote.json()).toEqual({ code: 'loot_out_of_range' });
    let previous = self(hidden), collected = false;
    for (let tick = 0; tick < 30 && !collected; tick++) {
      const snapshot = await f.tick(), point = self(snapshot);
      expect(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)).toBeLessThanOrEqual(1);
      expect(navigation.walkable(point)).toBe(true);
      if (tick === 0) expect(point).toMatchObject({ x: 727, y: 168 });
      if (!snapshot.self.searching && snapshot.self.cargo === 0) expect(f.stored().sortie.lootCommitment?.until).toBe(committed.until);
      if (snapshot.self.cargo) {
        expect(snapshot.self.cargo).toBe(37); expect(Math.hypot(point.x - FIRST.x, point.y - FIRST.y)).toBeLessThanOrEqual(1.5);
        expect(navigation.hasLineOfSight(point, FIRST)).toBe(true); collected = true;
      }
      previous = point;
    }
    expect(collected).toBe(true); expect(f.stored().sortie.visitedContainerIds).toContain(FIRST.id);
  });

  test('a restart preserves the observed point and absolute deadline while the chosen container is occluded', async () => {
    const f = await fixture(); await f.tick(); const commitment = f.stored().sortie.lootCommitment;
    expect(commitment).toBeDefined(); f.restart(); await f.enter();
    expect(f.stored().sortie.lootCommitment).toEqual(commitment);
    const snapshot = await f.tick(); expect(self(snapshot)).toMatchObject({ x: 727, y: 168 });
    expect(f.stored().sortie.lootCommitment).toEqual(commitment); expect(snapshot.self.cargo).toBe(0);
  });

  test('a hidden emptied container is checked only when seen again, without remote pickup or knowledge of its depletion', async () => {
    const f = await fixture(); await f.tick(); const commitment = f.stored().sortie.lootCommitment!;
    f.restart((_, value) => {
      value.drops = value.drops.filter(drop => drop.id !== commitment.dropId);
      value.lootCooldowns.push([`container:${FIRST.id}`, f.now() + 1_000_000]);
    });
    await f.enter(); expect(f.stored().sortie.lootCommitment).toEqual(commitment);
    let seenAgain = false;
    for (let tick = 0; tick < 15 && !seenAgain; tick++) {
      const before = await f.state(), visibleBeforeTick = navigation.hasLineOfSight(self(before), FIRST);
      const snapshot = await f.tick(); expect(snapshot.self.cargo).toBe(0);
      if (!visibleBeforeTick) {
        expect(f.stored().sortie.lootCommitment).toEqual(commitment);
        expect(f.stored().sortie.visitedContainerIds).not.toContain(FIRST.id);
      } else {
        expect(f.stored().sortie.lootCommitment?.dropId).not.toBe(commitment.dropId);
        expect(f.stored().sortie.visitedContainerIds).toContain(FIRST.id); seenAgain = true;
      }
    }
    expect(seenAgain).toBe(true);
  });

  test('continual sightings cannot refresh the deadline of an uncompleted commitment', async () => {
    const f = await fixture(); f.restart(player => { player.nextMove = NOW + 1_000_000; }); await f.enter();
    await f.tick(); const commitment = f.stored().sortie.lootCommitment!;
    expect(commitment.until).toBe(f.now() + LIVE_LOOT_COMMITMENT_MS);
    while (f.now() + 1000 < commitment.until) { await f.tick(); expect(f.stored().sortie.lootCommitment?.until).toBe(commitment.until); }
    await f.tick(); const plan = f.stored().sortie;
    expect(plan.lootCommitment?.dropId).not.toBe(commitment.dropId);
    expect(plan.visitedContainerIds).toContain(FIRST.id); expect(plan.skippedDropIds).toContain(commitment.dropId);
    expect((await f.state()).self.cargo).toBe(0);
  });

  test('an actual occupied doorway gives up after the bounded blocked-path interval', async () => {
    const f = await fixture(); await f.tick(); const commitment = f.stored().sortie.lootCommitment!;
    f.restart((_, value) => {
      const template = value.scavs[0]!;
      const neighbors = [{ x: OCCLUDED.x - 1, y: OCCLUDED.y }, { x: OCCLUDED.x + 1, y: OCCLUDED.y },
        { x: OCCLUDED.x, y: OCCLUDED.y - 1 }, { x: OCCLUDED.x, y: OCCLUDED.y + 1 }].filter(navigation.walkable);
      expect(neighbors.length).toBeGreaterThan(0);
      value.scavs = neighbors.map((point, index) => ({ ...template, ...point, id: `door-blocker-${index}`, home: point, route: [point],
        health: 100, body: createHealth(), respawnAt: 0, safeUntil: NOW + 1_000_000, nextMove: NOW + 1_000_000, nextAttack: NOW + 1_000_000 }));
    });
    await f.enter();
    for (let tick = 0; tick < 9; tick++) {
      const snapshot = await f.tick(); expect(self(snapshot)).toMatchObject(OCCLUDED); expect(snapshot.self.cargo).toBe(0);
    }
    const plan = f.stored().sortie;
    expect(plan.lootCommitment).toBeUndefined(); expect(plan.skippedDropIds).toContain(commitment.dropId);
    expect(plan.visitedContainerIds).toContain(FIRST.id); expect(f.now()).toBeLessThan(commitment.until);
  });

  test('a real search that starts near the navigation deadline finishes and transfers its find once', async () => {
    const f = await fixture(); await f.tick();
    const deadline = f.now() + 2000;
    f.restart(player => {
      Object.assign(player, { x: FIRST.x, y: FIRST.y + 1, nextMove: f.now() });
      player.sortie.lootCommitment!.until = deadline;
    });
    await f.enter(); const searching = await f.tick();
    expect(searching.self.searching).toBeDefined(); expect(searching.self.cargo).toBe(0);
    const readyAt = searching.self.searching!.readyAt;
    expect(readyAt).toBe(f.now() + FIRST.searchMs); expect(readyAt).toBeGreaterThan(deadline);
    expect(f.stored().sortie.lootCommitment).toBeUndefined();
    while (f.now() + 1000 < readyAt) expect((await f.tick()).self.cargo).toBe(0);
    const collected = await f.tick(); expect(collected.self.cargo).toBe(37);
    expect(f.stored().sortie.visitedContainerIds).toContain(FIRST.id);
    const duplicate = await f.act({ type: 'loot', id: searching.self.searching!.id }); expect(duplicate.status).toBe(409);
    expect((await f.state()).self.cargo).toBe(37);
  });

  test.each([{ type: 'automation', enabled: false } as const, { type: 'recall' } as const])('an explicit %p order cancels an old loot commitment immediately', async command => {
    const f = await fixture(); await f.tick(); expect(f.stored().sortie.lootCommitment).toBeDefined();
    const response = await f.act(command); expect(response.status).toBe(200);
    expect(f.stored().sortie.lootCommitment).toBeUndefined();
  });
});
