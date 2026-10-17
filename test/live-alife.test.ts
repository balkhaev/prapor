import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService, type LiveService } from '../server/live';
import { createLiveNavigation } from '../server/live-navigation';
import { NPC_RESPAWN_QUIET_MS, NPC_SITE_REPLENISH_MS } from '../server/live-spawning';
import { NPC_CONTACT_MEMORY_MS, NPC_NOISE_COOLDOWN_MS, NPC_NOISE_MEMORY_MS, NPC_NOISE_RESPONDERS, type NpcLifeState } from '../server/live-alife';
import { createHealth, type HealthState } from '../src/game/health';
import { getLiveMap } from '../src/game/live-maps';
import type { LiveCommand, LiveDrop, LiveEntity, LiveEvent, LivePoint, LiveSnapshot } from '../src/game/live';
import { runAlifeBalance } from '../scripts/alife-balance';

const ORIGIN = 'http://alife.test', NOW = 1_800_000_000_000, world = getLiveMap('perimeter'), nav = createLiveNavigation(world);
interface Actor extends LiveEntity {
  faction: 'scavs' | 'raiders'; role: 'patrol' | 'guard' | 'marksman'; home: LivePoint; route: LivePoint[];
  spawnIndex: number; body: HealthState; healthAt: number; nextMove: number; nextAttack: number;
  alife?: NpcLifeState; respawnAt: number; respawnQuietSince?: number | null;
}
interface SavedWorld { scavs: Actor[]; drops: LiveDrop[]; events: LiveEvent[]; npcReplenishments?: Array<[string, number]>; noiseIncidents?: unknown[] }
interface Session { id: string; cookie: string }
const fixtures: Array<{ close(): void }> = [];
const durableIntent = (state: NpcLifeState | undefined) => state && (({ nextThinkAt: _, ...intent }) => intent)(state);
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.close(); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'prapor-alife-')), dbPath = join(directory, 'live.sqlite');
  let time = NOW, version = world.version;
  const options = { dbPath, now: () => time, random: () => .5, automaticTicks: false, secureCookies: false, allowedOrigins: [ORIGIN] };
  let live: LiveService = createLiveService(options), db = new Database(dbPath, { readonly: true });
  function saved(): SavedWorld { return JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state); }
  function restart(edit?: (value: SavedWorld, db: Database) => void) {
    db.close(); live.close(); const writer = new Database(dbPath);
    try { const value: SavedWorld = JSON.parse(writer.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state); edit?.(value, writer); writer.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(value)); }
    finally { writer.close(); }
    live = createLiveService(options); db = new Database(dbPath, { readonly: true });
  }
  async function call(path: string, session?: Session, command?: object): Promise<LiveSnapshot> {
    const response = await live.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method: command ? 'POST' : 'GET', headers: {
      'x-prapor-world-version': version,
      ...(command ? { origin: ORIGIN, 'content-type': 'application/json' } : {}),
      ...(session ? { cookie: session.cookie, 'x-prapor-live': session.id } : {}),
    }, ...(command ? { body: JSON.stringify(command) } : {}) }));
    expect(response).not.toBeNull(); expect(response!.status).toBe(200);
    const result = await response!.json() as LiveSnapshot; version = result.worldVersion;
    return Object.assign(result, { cookie: response!.headers.get('set-cookie')?.split(';')[0] });
  }
  async function enter(session?: Session) {
    const snapshot = await call('join', session, {});
    return session ?? { id: snapshot.selfId, cookie: (snapshot as LiveSnapshot & { cookie: string }).cookie };
  }
  function player(writer: Database, session: Session, point: LivePoint) {
    const row = writer.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all().find(row => JSON.parse(row.state).id === session.id)!;
    const value = JSON.parse(row.state);
    Object.assign(value, point, { body: createHealth(), health: 100, healthAt: time, safeUntil: 0, dangerUntil: 0, graceUntil: 0,
      nextAttack: 0, destination: null, targetId: null, patrol: false, automation: undefined, aim: null, ammo: 60, leaveAt: 0 });
    writer.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(value), row.identity);
  }
  function configure(actor: Actor, point: LivePoint, role: Actor['role'] = 'guard') {
    Object.assign(actor, point, { role, home: { ...point }, route: [{ ...point }], body: createHealth(), health: 100,
      healthAt: time, nextMove: time + 1_000_000, nextAttack: time + 1_000_000, alife: undefined, aim: null });
  }
  async function advance(ms: number, sessions: Session[] = []) {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      time += Math.min(1000, ms - elapsed); live.tick();
      if (elapsed % 5000 === 0) for (const session of sessions) await call('state', session);
    }
    expect(live.healthy()).toBe(true);
  }
  const close = () => { db.close(); live.close(); rmSync(directory, { recursive: true, force: true }); };
  fixtures.push({ close });
  return { saved, restart, enter, player, configure, advance, now: () => time,
    state: (session: Session) => call('state', session), act: (session: Session, command: LiveCommand) => call('action', session, command) };
}

function wallPair(): { actor: LivePoint; hidden: LivePoint; visible: LivePoint } {
  for (const wall of world.obstacles) {
    if (wall.kind === 'water' || wall.width > 4 && wall.height > 4) continue;
    const pairs = [
      [{ x: wall.x - 1, y: wall.y }, { x: wall.x + wall.width, y: wall.y }],
      [{ x: wall.x, y: wall.y - 1 }, { x: wall.x, y: wall.y + wall.height }],
    ];
    for (const pair of pairs) {
      const actor = pair[0]!, hidden = pair[1]!;
      if (!nav.walkable(actor) || !nav.walkable(hidden) || Math.hypot(actor.x - hidden.x, actor.y - hidden.y) > 7 || nav.hasLineOfSight(actor, hidden)) continue;
      const visible = [{ x: actor.x + 1, y: actor.y }, { x: actor.x - 1, y: actor.y }, { x: actor.x, y: actor.y + 1 }, { x: actor.x, y: actor.y - 1 }]
        .find(point => nav.walkable(point) && nav.hasLineOfSight(actor, point));
      if (visible) return { actor, hidden, visible };
    }
  }
  throw new Error('Expected real cover with both visible and occluded approaches');
}

describe('persistent ordinary NPC life', () => {
  test('a quiet populated world keeps moving in every district, with finite population and legal physical steps', () => {
    const result = runAlifeBalance(180);
    expect(result.healthy).toBe(true); expect(result.population).toBe(world.npcSpawns.length);
    expect(result.identityChanges).toBe(0); expect(result.illegalCells).toBe(0); expect(result.collisions).toBe(0); expect(result.jumps).toBe(0);
    expect(result.spontaneousHealing).toBe(0); expect(result.minimumAlive).toBeGreaterThan(result.population * .7);
    for (const role of Object.values(result.roles)) expect(role.moved).toBeGreaterThan(role.population / 2);
    for (const local of Object.values(result.districts)) expect(local.moved).toBeGreaterThan(local.population / 2);
    for (const minute of result.minutes) { expect(minute.moving).toBeGreaterThan(120); expect(minute.steps).toBeGreaterThan(1000); }
    expect(result.activities.travel).toBeGreaterThan(0); expect(result.activities.inspect).toBeGreaterThan(0); expect(result.activities.rest).toBeGreaterThan(0);
  }, 30_000);

  test('a hidden nearby player is never acquired through a real wall', async () => {
    const f = fixture(), session = await f.enter(), pair = wallPair();
    f.restart((value, db) => {
      value.scavs = [value.scavs[0]!]; f.configure(value.scavs[0]!, pair.actor); f.player(db, session, pair.hidden);
    });
    await f.enter(session); await f.advance(5000, [session]);
    const actor = f.saved().scavs[0]!;
    expect(actor.alife?.targetId).toBeNull(); expect(actor.alife?.lastSeen).toBeNull();
    expect(actor.alife?.phase).not.toBe('combat'); expect(actor.alife?.phase).not.toBe('investigate');
    expect(actor.health).toBe(100);
  });

  test('lost contact remembers a fixed last seen point across restart and expires instead of tracking through cover', async () => {
    const f = fixture(), session = await f.enter(), pair = wallPair();
    f.restart((value, db) => {
      value.scavs = [value.scavs[0]!]; f.configure(value.scavs[0]!, pair.actor); f.player(db, session, pair.visible);
    });
    await f.enter(session); await f.advance(1000, [session]);
    const seen = f.saved().scavs[0]!.alife!;
    expect(seen.targetId).toBe(session.id); expect(seen.lastSeen).toEqual(pair.visible);
    expect(seen.lastSeenUntil).toBe(f.now() + NPC_CONTACT_MEMORY_MS);
    f.restart((_, db) => f.player(db, session, pair.hidden));
    expect(f.saved().scavs[0]!.alife?.lastSeen).toEqual(pair.visible);
    expect(f.saved().scavs[0]!.alife?.lastSeenUntil).toBe(seen.lastSeenUntil);
    await f.enter(session); await f.advance(2000, [session]);
    expect(f.saved().scavs[0]!.alife?.lastSeen).toEqual(pair.visible);
    expect(f.saved().scavs[0]!.alife?.lastSeenUntil).toBe(seen.lastSeenUntil);
    await f.advance(NPC_CONTACT_MEMORY_MS, [session]);
    const ended = f.saved().scavs[0]!.alife!;
    expect(ended.targetId).toBeNull(); expect(ended.phase).not.toBe('combat'); expect(ended.phase).not.toBe('investigate');
    expect(f.saved().events.filter(event => event.damage !== undefined)).toHaveLength(0);
  });

  test('real gunfire recruits only two nearby patrols per fight and their investigation and cooldown survive restart', async () => {
    const f = fixture(), first = await f.enter(), second = await f.enter();
    const shooter = { x: 0, y: 0 }, victim = { x: 1, y: 0 }, points = [12, 14, 16, 18].map(x => ({ x, y: 0 }));
    expect([shooter, victim, ...points].every(point => nav.walkable(point))).toBe(true);
    f.restart((value, db) => {
      value.scavs = value.scavs.slice(0, 4);
      value.scavs.forEach((actor, index) => {
        f.configure(actor, points[index]!, 'patrol'); actor.faction = 'scavs';
        actor.home = { ...shooter }; actor.route = [shooter, points[index]!];
      });
      f.player(db, first, shooter); f.player(db, second, victim); value.events = [];
    });
    await f.enter(first); await f.enter(second);
    await f.act(first, { type: 'attack', targetId: second.id });
    await f.advance(1000, [first, second]);
    const responses = f.saved().scavs.filter(actor => actor.alife?.phase === 'investigate');
    expect(responses).toHaveLength(NPC_NOISE_RESPONDERS);
    const ids = responses.map(actor => actor.id).sort();
    for (const actor of responses) {
      expect(actor.alife!.targetId).toBeNull(); expect(actor.alife!.destination).toEqual(shooter);
      expect(actor.alife!.investigateUntil).toBeGreaterThan(f.now()); expect(actor.alife!.respondAfter).toBeGreaterThanOrEqual(f.now() + NPC_NOISE_COOLDOWN_MS - 1000);
    }
    // A different shooter in the same fight cannot summon another pair.
    await f.act(second, { type: 'attack', targetId: first.id }); await f.advance(1000, [first, second]);
    expect(f.saved().scavs.filter(actor => actor.alife?.phase === 'investigate').map(actor => actor.id).sort()).toEqual(ids);
    const persisted = f.saved().scavs.map(actor => ({ id: actor.id, alife: durableIntent(actor.alife) })), incidents = f.saved().noiseIncidents; f.restart();
    expect(f.saved().scavs.map(actor => ({ id: actor.id, alife: durableIntent(actor.alife) }))).toEqual(persisted);
    expect(f.saved().noiseIncidents).toEqual(incidents);
    await f.enter(first); await f.enter(second);
    await f.act(first, { type: 'attack', targetId: second.id }); await f.advance(1000, [first, second]);
    expect(f.saved().scavs.filter(actor => actor.alife?.phase === 'investigate').map(actor => actor.id).sort()).toEqual(ids);
    await f.advance(NPC_NOISE_MEMORY_MS + 1000, [first, second]);
    expect(f.saved().scavs.some(actor => actor.alife?.phase === 'investigate')).toBe(false);
    for (const actor of f.saved().scavs.filter(actor => ids.includes(actor.id))) expect(actor.alife!.respondAfter).toBeGreaterThan(f.now());
  });

  test('ordinary inspections and rests preserve wounds and exact loot identities across a restart', async () => {
    const f = fixture();
    f.restart(value => {
      value.scavs = [value.scavs[0]!]; const actor = value.scavs[0]!;
      actor.body = createHealth(63); actor.health = 63; actor.nextAttack = NOW + 1_000_000;
      actor.faction = 'scavs';
    });
    await f.advance(15_000);
    const before = f.saved(), actor = before.scavs[0]!;
    expect(actor.alife).toBeDefined(); const alife = structuredClone(actor.alife), body = structuredClone(actor.body);
    const loot = before.drops.map(drop => ({ id: drop.id, amount: drop.amount, items: drop.items })).sort((a, b) => a.id.localeCompare(b.id));
    f.restart(); const restored = f.saved().scavs[0]!;
    expect(durableIntent(restored.alife)).toEqual(durableIntent(alife)); expect(restored.body).toEqual(body);
    await f.advance(60_000);
    expect(f.saved().scavs[0]!.body).toEqual(body);
    expect(f.saved().drops.map(drop => ({ id: drop.id, amount: drop.amount, items: drop.items })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(loot);
  });

  test('a cleared sawmill post receives separate physical arrivals, with the site cooldown preserved after restart', async () => {
    const f = fixture();
    f.restart(value => {
      value.scavs = value.scavs.filter(actor => [166, 167].includes(actor.spawnIndex));
      expect(value.scavs).toHaveLength(2);
      for (const actor of value.scavs) {
        actor.body = createHealth(); actor.body.parts.head.hp = 0; actor.health = 0;
        actor.respawnAt = NOW; actor.respawnQuietSince = null;
      }
    });
    await f.advance(NPC_RESPAWN_QUIET_MS + 1000);
    const arrived = f.saved().scavs.filter(actor => actor.health > 0);
    expect(arrived).toHaveLength(1); expect(f.saved().events.filter(event => event.kind === 'respawn')).toHaveLength(1);
    const first = arrived[0]!, originalPosition = { x: first.x, y: first.y };
    expect(Math.hypot(first.x - first.home.x, first.y - first.home.y)).toBeGreaterThanOrEqual(8);
    expect(first.alife?.phase).toBe('return');
    const distanceHome = nav.findPath(first, first.home)!.length;
    await f.advance(1000);
    const walking = f.saved().scavs.find(actor => actor.id === first.id)!;
    expect(Math.abs(walking.x - originalPosition.x) + Math.abs(walking.y - originalPosition.y)).toBe(1);
    expect(nav.findPath(walking, walking.home)!.length).toBe(distanceHome - 1);
    const deadlines = f.saved().npcReplenishments; expect(deadlines).toHaveLength(1); f.restart();
    expect(f.saved().npcReplenishments).toEqual(deadlines);
    await f.advance(NPC_SITE_REPLENISH_MS - 2000);
    expect(f.saved().scavs.filter(actor => actor.health > 0)).toHaveLength(1);
    await f.advance(1000);
    expect(f.saved().scavs.filter(actor => actor.health > 0)).toHaveLength(2);
    expect(f.saved().events.filter(event => event.kind === 'respawn')).toHaveLength(2);
  });
});
