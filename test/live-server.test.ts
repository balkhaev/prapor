import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveService, readLiveOptions, type LiveService } from "../server/live";
import { createHealth, createMedicalInventory } from "../src/game/health";
import { createAccountService, type AccountService } from "../server/accounts";
import { createHandler } from "../server/handler";
import type { LiveCommand, LiveDistrictId, LivePurpose, LiveSnapshot, LiveStatus } from "../src/game/live";
import { getLiveMap, hasLiveLineOfSight, isLiveWalkable } from "../src/game/live-maps";
import { LIVE_GENERATOR_VERSION, LIVE_WORLD_OFFSET, LIVE_WORLD_SIZE } from "../src/game/world-generation";
import { LIVE_CAPACITY } from '../src/game/live';

const ORIGIN = "https://game.delopusk.ru";
let directory: string, dbPath: string, service: LiveService, accounts: AccountService | undefined;
let time = 1_800_000_000_000;
let cachedWorld: LiveSnapshot["world"] | undefined;
interface Session { cookie: string; id: string; accountId?: string }
const options = () => ({ dbPath, secureCookies: true, allowedOrigins: [ORIGIN], now: () => time, random: () => 0, automaticTicks: false, accounts });
function request(path: string, method = "GET", body?: unknown, session?: Session, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method, headers: {
    ...(path === "action" && cachedWorld ? { "x-prapor-world-version": cachedWorld.version } : {}),
    ...(method !== "GET" ? { origin: ORIGIN, "content-type": "application/json" } : {}),
    ...(session ? { cookie: session.cookie, "x-prapor-live": session.id } : {}),
    ...(session?.accountId ? { "x-prapor-account": session.accountId } : {}), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(path: string, method = "GET", body?: unknown, session?: Session, headers?: Record<string, string>, ip = "192.0.2.1"): Promise<Response> {
  const result = await service.fetch(request(`/api/live/${path}`, method, body, session, headers), ip);
  if (!result) throw new Error("Missing API response");
  return result;
}
async function enter(session?: Session, ip?: string, districtId?: LiveDistrictId, purpose: LivePurpose = "pvp"): Promise<{ session: Session; state: LiveSnapshot }> {
  const reply = await call("join", "POST", districtId ? { districtId, purpose } : {}, session, undefined, ip);
  expect(reply.status).toBe(200);
  const state = await reply.json() as LiveSnapshot; cachedWorld = state.world;
  return { session: session ?? { cookie: reply.headers.get("set-cookie")!.split(";")[0]!, id: state.selfId }, state };
}
async function state(session: Session): Promise<LiveSnapshot> {
  // Reuse public geometry as the real client does; repeated 4 MB packets obscure simulation checks.
  const result = await call("state", "GET", undefined, session, cachedWorld ? { "x-prapor-world-version": cachedWorld.version } : {});
  expect(result.status).toBe(200);
  const snapshot = await result.json() as LiveSnapshot;
  if (snapshot.world) cachedWorld = snapshot.world;
  return { ...snapshot, world: snapshot.world ?? cachedWorld! };
}
async function act(session: Session, command: LiveCommand): Promise<LiveSnapshot> {
  const reply = await call("action", "POST", command, session);
  expect(reply.status).toBe(200);
  const snapshot = await reply.json() as LiveSnapshot;
  return { ...snapshot, world: snapshot.world ?? cachedWorld! };
}
async function advance(ms: number, sessions: Session[] = []): Promise<void> {
  for (let step = 0; step < ms; step += 250) {
    time += 250; service.tick();
    if (step % 1000 === 0) for (const session of sessions) await state(session);
  }
}
function editStorage(edit: (db: Database) => void): void {
  service.close();
  const db = new Database(dbPath);
  edit(db); db.close();
  service = createLiveService(options());
}
function placePlayers(placements: Array<{ session: Session; x: number; y: number; health?: number; cargo?: number; ammo?: number; medkits?: number; stash?: number; respawnAt?: number; districtId?: LiveDistrictId }>): void {
  editStorage(db => {
    for (const placement of placements) {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => (JSON.parse(row.state) as { id: string }).id === placement.session.id)!;
      const player = JSON.parse(row.state) as Record<string, unknown>;
      const { session: _session, ...fields } = placement;
      Object.assign(player, fields, { safeUntil: 0 });
      if (placement.health !== undefined) { const body = createHealth(placement.health); if (placement.health <= 0) body.parts.head.hp = 0; player.body = body; }
      if (placement.medkits !== undefined) player.medicine = createMedicalInventory({ ...(player.medicine as ReturnType<typeof createMedicalInventory>), medkit: placement.medkits * 40 });
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
    }
  });
}
function blockedPair(corner = false): [{ x: number; y: number }, { x: number; y: number }] {
  const world = getLiveMap("perimeter");
  for (const wall of world.obstacles.filter(obstacle => obstacle.kind !== "water")) {
    const a = corner ? { x: wall.x - 1, y: wall.y } : { x: wall.x, y: wall.y - 1 };
    const b = corner ? { x: wall.x, y: wall.y - 1 } : { x: wall.x, y: wall.y + wall.height };
    if (isLiveWalkable(world, a) && isLiveWalkable(world, b) && Math.hypot(a.x - b.x, a.y - b.y) <= 7 && !hasLiveLineOfSight(world, a, b)) return [a, b];
  }
  throw new Error("No fixture cover pair");
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "prapor-live-")); dbPath = join(directory, "live.sqlite");
  time = 1_800_000_000_000; accounts = undefined; cachedWorld = undefined;
  service = createLiveService(options());
  // Deterministic fixtures keep unrelated NPC combat out of movement/PvP assertions.
  editStorage(db => db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify({ version: 3, geometryVersion: getLiveMap("perimeter").version, startedAt: time, events: [],
    scavs: [{ id: "scav-0", mapId: "perimeter", kind: "scav", name: "Косой", appearance: 0, faction: "scavs", role: "patrol", home: { x: 127, y: 0 }, route: [{ x: 127, y: 0 }], routeIndex: 0, x: 127, y: 0, health: 100, action: "idle", safeUntil: 0, respawnAt: 0, nextMove: time + 1_000_000, nextAttack: time + 1_000_000 }],
    drops: Array.from({ length: 10 }, (_, index) => ({ id: `drop-${index}`, mapId: "perimeter", x: index === 0 ? 0 : 125, y: 0, amount: 35, source: "body", expiresAt: time + 1_000_000 })),
  })));
});
afterEach(async () => { service.close(); accounts?.close(); await rm(directory, { recursive: true, force: true }); });

describe("shared endless live server", () => {
  test('simulation work does not shift the next scheduled tick beyond its start deadline', async () => {
    const fighter = await enter();
    service.close();
    let slowTick = false;
    service = createLiveService({ ...options(), now: () => { const current = time; if (slowTick) { slowTick = false; time += 10; } return current; } });
    await enter(fighter.session);
    time += 50; slowTick = true; service.tick();
    time += 40; service.tick();
    service.close();
    const db = new Database(dbPath, { readonly: true });
    try {
      const fighterState = db.query<{ state: string }, []>('SELECT state FROM live_players').all().map(row => JSON.parse(row.state)).find(player => player.id === fighter.session.id)!;
      expect(fighterState.healthAt).toBe(time);
    } finally { db.close(); }
  });

  test('20 Hz responds on the next tick without accelerating walking or repeating same-time steps', async () => {
    const fighter = await enter();
    placePlayers([{ session: fighter.session, x: 0, y: 0 }]);
    await enter(fighter.session);
    await act(fighter.session, { type: 'move', x: 5, y: 0 });
    time += 49; service.tick();
    expect((await state(fighter.session)).entities.find(entity => entity.id === fighter.session.id)!.x).toBe(0);
    time += 1; service.tick();
    const moved = (await state(fighter.session)).entities.find(entity => entity.id === fighter.session.id)!;
    expect(moved.x).toBe(1); expect(moved.moveIntervalMs).toBe(500);
    for (let frame = 0; frame < 9; frame++) { time += 50; service.tick(); }
    expect((await state(fighter.session)).entities.find(entity => entity.id === fighter.session.id)!.x).toBe(1);
    time += 50; service.tick();
    expect((await state(fighter.session)).entities.find(entity => entity.id === fighter.session.id)!.x).toBe(2);
    for (let repeat = 0; repeat < 10; repeat++) service.tick();
    expect((await state(fighter.session)).entities.find(entity => entity.id === fighter.session.id)!.x).toBe(2);
  });

  test("independent guests meet in one world, cannot impersonate each other, and only command a server-paced path", async () => {
    const first = await enter(), second = await enter();
    expect(first.session.id).not.toBe(second.session.id);
    // Exercise a short, visible movement independently of the expanded spawn frame.
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 1, y: 0 }]);
    await enter(first.session); await enter(second.session);
    const shared = await state(first.session);
    expect(shared.server.online).toBe(2);
    expect(shared.entities.filter(entity => entity.kind === "player").map(entity => entity.id).sort()).toEqual([first.session.id, second.session.id].sort());
    expect(shared.world).toEqual(second.state.world);
    expect((await call("state", "GET", undefined, first.session, { "x-prapor-live": second.session.id })).status).toBe(401);
    const origin = shared.entities.find(entity => entity.id === first.session.id)!;
    const commanded = await act(first.session, { type: "move", x: 12, y: 5 });
    expect(commanded.entities.find(entity => entity.id === first.session.id)!.x).toBe(origin.x);
    await advance(250, [first.session, second.session]);
    const moved = (await state(second.session)).entities.find(entity => entity.id === first.session.id)!;
    expect(Math.abs(moved.x - origin.x) + Math.abs(moved.y - origin.y)).toBe(1);
    await advance(15_000, [first.session, second.session]);
    const arrived = (await state(second.session)).entities.find(entity => entity.id === first.session.id)!;
    expect({ x: arrived.x, y: arrived.y }).toEqual({ x: 12, y: 5 });
  });

  test("commands cannot inject coordinates, rewards or health; malformed type objects cannot disable the world", async () => {
    const guest = await enter();
    const before = await state(guest.session);
    for (const body of [
      { type: "move", x: getLiveMap("perimeter").obstacles[0]!.x, y: getLiveMap("perimeter").obstacles[0]!.y }, { type: "move", x: getLiveMap("perimeter").width, y: 0 }, { type: "move", x: 0.5, y: 1 },
      { type: "move", x: 3, y: 3, health: 999 }, { type: "heal", cargo: 500 }, { type: "loot", id: "drop-0", amount: 999 },
      { type: { toString: null } }, { type: ["heal"] }, {}, { type: "patrol", enabled: "true" },
    ]) expect((await call("action", "POST", body, guest.session)).status).toBe(400);
    expect(service.healthy()).toBe(true);
    expect((await state(guest.session)).self).toEqual(before.self);
    expect((await call("action", "POST", { type: "move", x: 1, y: 0 }, guest.session)).status).toBe(200);
  });

  test("PvP uses line of sight, distance, spawn protection and cooldown, then transfers dropped cargo once", async () => {
    const first = await enter(), second = await enter();
    expect((await call("action", "POST", { type: "attack", targetId: second.session.id }, first.session)).status).toBe(409);
    const [blockedFirst, blockedSecond] = blockedPair();
    placePlayers([{ session: first.session, ...blockedFirst }, { session: second.session, ...blockedSecond, cargo: 70 }]);
    await enter(first.session); await enter(second.session);
    const blocked = await call("action", "POST", { type: "attack", targetId: second.session.id }, first.session);
    expect(blocked.status).toBe(409); expect(await blocked.json()).toEqual({ code: "target_out_of_range" });
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 9, y: 0 }]);
    await enter(first.session); await enter(second.session);
    expect((await call("action", "POST", { type: "attack", targetId: second.session.id }, first.session)).status).toBe(409);
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 1, y: 0 }]);
    await enter(first.session); await enter(second.session);
    await act(first.session, { type: "attack", targetId: second.session.id });
    expect((await call("action", "POST", { type: "attack", targetId: second.session.id }, first.session)).status).toBe(429);
    const hurt = await state(second.session);
    expect(hurt.self.body.parts.chest.hp).toBe(53);
    expect(hurt.entities.find(entity => entity.id === second.session.id)!.health).toBeCloseTo(408 / 440 * 100);
    await act(second.session, { type: "treat", medicine: "tourniquet", part: "chest" }); await advance(4000, [first.session, second.session]);
    await act(second.session, { type: "heal" });
    expect((await state(second.session)).self.treatment?.type).toBe("medkit"); expect((await state(second.session)).self.medicine.medkit).toBe(120);
    await advance(5000, [first.session, second.session]); expect((await state(second.session)).self.medicine.medkit).toBeLessThan(120);
    for (let hit = 0; hit < 6 && (await state(second.session)).self.respawnAt === 0; hit++) { await advance(1000, [first.session, second.session]); await act(first.session, { type: "attack", targetId: second.session.id }); }
    const dead = await state(second.session);
    expect(dead.entities.find(entity => entity.id === second.session.id)!.action).toBe("downed");
    expect(dead.self.cargo).toBe(0); expect(dead.self.respawnAt).toBe(time + 10_000);
    const drop = dead.drops.find(drop => drop.amount === 70)!;
    expect((await act(first.session, { type: "loot", id: drop.id })).self.cargo).toBe(70);
    expect((await call("action", "POST", { type: "loot", id: drop.id }, first.session)).status).toBe(409);
    expect((await call("action", "POST", { type: "move", x: 5, y: 0 }, second.session)).status).toBe(409);
    expect((await call("action", "POST", { type: "respawn" }, second.session)).status).toBe(409);
    await advance(10_000, [first.session, second.session]);
    const respawned = await act(second.session, { type: "respawn" });
    expect(respawned.entities.find(entity => entity.id === second.session.id)!.health).toBe(100);
    expect(respawned.self.respawnAt).toBe(0); expect(respawned.self.ammo).toBe(60); expect(respawned.self.cargo).toBe(0);
    expect((await state(first.session)).self.kills).toBe(1);
  });

  test("loot and extraction are shared, range checked, and persist across reconnect and process restart", async () => {
    const first = await enter(), second = await enter();
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 1, y: 0 }]);
    await enter(first.session); await enter(second.session);
    expect((await call("action", "POST", { type: "loot", id: "drop-1" }, first.session)).status).toBe(409);
    expect((await act(first.session, { type: "loot", id: "drop-0" })).self.cargo).toBe(35);
    expect((await state(second.session)).drops.some(drop => drop.id === "drop-0")).toBe(false);
    expect((await call("action", "POST", { type: "extract" }, first.session)).status).toBe(409);
    const exit = first.state.world.extracts[0]!;
    // Start nearby: the outer origin is now hundreds of steps from this preserved exit.
    placePlayers([{ session: first.session, x: exit.x - 3, y: exit.y }]); await enter(first.session); await enter(second.session);
    await act(first.session, { type: "move", ...exit }); await advance(12_000, [first.session, second.session]);
    const banked = await act(first.session, { type: "extract" });
    expect(banked.self.stash).toBe(35); expect(banked.self.cargo).toBe(0);
    expect((await call("leave", "POST", {}, first.session)).status).toBe(200);
    expect((await state(second.session)).server.online).toBe(1);
    const rejoined = await enter(first.session);
    expect(rejoined.state.selfId).toBe(first.session.id); expect(rejoined.state.self.stash).toBe(35);
    service.close(); service = createLiveService(options());
    expect((await call("state", "GET", undefined, first.session)).status).toBe(401);
    const restored = (await enter(first.session)).state;
    expect(restored.self.stash).toBe(35); expect(restored.selfId).toBe(first.session.id);
    const body = restored.entities.find(entity => entity.id === first.session.id)!;
    expect({ x: body.x, y: body.y }).toEqual(exit);
    expect(restored.server.startedAt).toBe(banked.server.startedAt);
  });

  test("heartbeat disconnects cancel patrol without losing the body or its inventory", async () => {
    const first = await enter();
    placePlayers([{ session: first.session, x: 0, y: 0 }]); await enter(first.session);
    await act(first.session, { type: "loot", id: "drop-0" });
    await act(first.session, { type: "patrol", enabled: true });
    await advance(15_000);
    expect(((await call("status")).json() as Promise<LiveStatus>).then(status => status.online)).resolves.toBe(0);
    expect((await call("state", "GET", undefined, first.session)).status).toBe(401);
    const restored = (await enter(first.session)).state;
    expect(restored.selfId).toBe(first.session.id); expect(restored.self.cargo).toBeGreaterThanOrEqual(35); expect(restored.self.patrol).toBe(false);
  });

  test("NPCs attack online players but stay dead during their encounter; patrol never automatically shoots another player", async () => {
    const first = await enter(), second = await enter();
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 1, y: 0 }]);
    editStorage(db => {
      const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!;
      const world = JSON.parse(row.state) as { scavs: Array<Record<string, unknown>> };
      Object.assign(world.scavs[0]!, { x: 3, y: 0, home: { x: 3, y: 0 }, route: [{ x: 3, y: 0 }], health: 25, body: createHealth(25), nextAttack: 0 });
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(world));
    });
    await enter(first.session); await enter(second.session);
    await advance(6500, [first.session, second.session]);
    const underFire = await state(first.session);
    expect(underFire.entities.filter(entity => entity.kind === "player").some(entity => entity.health < 100)).toBe(true);
    await act(first.session, { type: "attack", targetId: "scav-0" }); await act(first.session, { type: "patrol", enabled: true }); await advance(250, [first.session, second.session]);
    expect((await state(first.session)).self.kills).toBe(1);
    const before = (await state(second.session)).self.body.parts.chest.hp;
    await advance(2000, [first.session, second.session]);
    const after = await state(second.session); expect(after.self.body.parts.chest.hp).toBeCloseTo(before - .5);
    expect(after.events.some(event => event.actorId === first.session.id && event.targetId === second.session.id)).toBe(false);
    await act(first.session, { type: "cancelTreatment" });
    await act(first.session, { type: "patrol", enabled: false }); await advance(8500, [first.session, second.session]);
    const db = new Database(dbPath, { readonly: true });
    try { const stored = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state) as { scavs: Array<{ id: string; health: number }> }; expect(stored.scavs.find(entity => entity.id === "scav-0")!.health).toBe(0); }
    finally { db.close(); }
  });

  test("capacity counts online identities, rejoining uses the same body, and leave immediately releases a slot", async () => {
    const sessions: Session[] = [];
    for (let index = 0; index < 32; index++) sessions.push((await enter(undefined, `192.0.2.${index + 1}`)).session);
    const full = await call("join", "POST", {}, undefined, undefined, "198.51.100.1");
    expect(full.status).toBe(503); expect(await full.json()).toEqual({ code: "server_full" });
    expect((await enter(sessions[0])).state.server.online).toBe(32);
    await call("leave", "POST", {}, sessions[0]);
    expect((await enter(undefined, "198.51.100.1")).state.server.online).toBe(32);
  });



  test("server controlled sustained fire consumes one round per hit, stops on movement or death and cannot fire through a corner", async () => {
    const first = await enter(), second = await enter();
    const [cornerFirst, cornerSecond] = blockedPair(true);
    placePlayers([{ session: first.session, ...cornerFirst }, { session: second.session, ...cornerSecond }]);
    await enter(first.session); await enter(second.session);
    expect((await call("action", "POST", { type: "attack", targetId: second.session.id }, first.session)).status).toBe(409);
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 1, y: 0 }]);
    await enter(first.session); await enter(second.session);
    const locked = await act(first.session, { type: "engage", targetId: second.session.id });
    expect(locked.self.targetId).toBe(second.session.id);
    await advance(1000, [first.session, second.session]);
    const moving = await act(first.session, { type: "move", x: 0, y: 1 });
    expect(moving.self.targetId).toBeNull();
    const chestAfterMove = (await state(second.session)).self.body.parts.chest.hp, ammoAfterMove = moving.self.ammo;
    await advance(2000, [first.session, second.session]);
    expect((await state(second.session)).self.body.parts.chest.hp).toBeCloseTo(chestAfterMove - .5); expect((await state(first.session)).self.ammo).toBe(ammoAfterMove);
    await act(first.session, { type: "engage", targetId: second.session.id });
    await advance(4000, [first.session, second.session]);
    const killed = await state(first.session);
    expect(killed.self).toMatchObject({ targetId: null, ammo: 57, kills: 1 });
    expect((await state(second.session)).entities.find(entity => entity.id === second.session.id)!.health).toBe(0);
    const shot = killed.events.find(event => event.kind === "combat" && event.damage === 32)!;
    expect(shot.from).toBeDefined(); expect(shot.to).toBeDefined();
    await advance(2000, [first.session, second.session]);
    expect((await state(first.session)).self.ammo).toBe(57);
  });


  test("leaving during combat keeps a visible vulnerable body for eight seconds, and rejoining cancels the departure", async () => {
    const first = await enter(), second = await enter();
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 1, y: 0, cargo: 70 }]);
    await enter(first.session); await enter(second.session);
    await act(first.session, { type: "attack", targetId: second.session.id });
    await act(second.session, { type: "engage", targetId: first.session.id });
    expect((await call("leave", "POST", {}, second.session)).status).toBe(200);
    expect((await state(second.session)).self.leaveAt).toBe(time + 8000);
    expect((await state(first.session)).server.online).toBe(2);
    await advance(1000, [first.session]);
    const waiting = await state(first.session);
    expect(waiting.entities.find(entity => entity.id === second.session.id)).toMatchObject({ x: 1, y: 0 }); expect(waiting.self.body.parts.chest.hp).toBeCloseTo(52.75);
    const rejoined = (await enter(second.session)).state;
    expect(rejoined.selfId).toBe(second.session.id);
    expect(rejoined.self).toMatchObject({ cargo: 70, ammo: 59, targetId: null, patrol: false });
    expect(rejoined.entities.find(entity => entity.id === second.session.id)).toMatchObject({ x: 1, y: 0 }); expect(rejoined.self.body.parts.chest.hp).toBeCloseTo(52.75); expect(rejoined.self.leaveAt).toBe(0);
    expect((await call("state", "GET", undefined, second.session)).status).toBe(200);
    await call("leave", "POST", {}, second.session);
    await advance(7750, [first.session]);
    expect((await state(first.session)).entities.some(entity => entity.id === second.session.id)).toBe(true);
    await advance(250, [first.session]);
    const departed = await state(first.session);
    expect(departed.server.online).toBe(1); expect(departed.entities.some(entity => entity.id === second.session.id)).toBe(false);
    expect((await call("state", "GET", undefined, second.session)).status).toBe(401);
  });

  test("combat departure cannot erase a death or duplicate the cargo dropped during its vulnerable grace", async () => {
    const first = await enter(), second = await enter();
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 1, y: 0, cargo: 70 }]);
    await enter(first.session); await enter(second.session);
    await act(first.session, { type: "attack", targetId: second.session.id });
    await call("leave", "POST", {}, second.session);
    for (let hit = 0; hit < 2; hit++) {
      await advance(1000, [first.session]);
      await act(first.session, { type: "attack", targetId: second.session.id });
    }
    const killed = await state(first.session);
    expect(killed.entities.find(entity => entity.id === second.session.id)).toMatchObject({ health: 0, action: "downed" });
    expect(killed.self).toMatchObject({ ammo: 57, kills: 1 });
    const bodyDrop = killed.drops.find(drop => drop.amount === 70)!;
    expect(bodyDrop).toBeDefined(); expect((await act(first.session, { type: "loot", id: bodyDrop.id })).self.cargo).toBe(70);
    expect((await call("action", "POST", { type: "loot", id: bodyDrop.id }, first.session)).status).toBe(409);
    service.close(); service = createLiveService(options());
    const restored = (await enter(second.session)).state;
    expect(restored.selfId).toBe(second.session.id); expect(restored.self.cargo).toBe(0);
    expect(restored.entities.find(entity => entity.id === second.session.id)).toMatchObject({ health: 0, action: "downed", x: 1, y: 0 });
    expect(restored.self.respawnAt).toBe(time + 10_000);
    expect((await enter(first.session)).state.self.cargo).toBe(70);
    expect(service.healthy()).toBe(true);
  });


  test("rival NPC groups fight each other inside their shared map without a player issuing an attack", async () => {
    const guest = await enter();
    placePlayers([{ session: guest.session, x: 0, y: 0 }]);
    editStorage(db => {
      const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!;
      const world = JSON.parse(row.state) as { scavs: Array<Record<string, unknown>> };
      const template = world.scavs[0]!;
      world.scavs = [];
      for (const [index, faction] of ["scavs", "raiders"].entries()) {
        const point = { x: 10 + index, y: 0 };
        world.scavs.push({ ...template, id: `rival-${index}`, ...point, home: point, route: [point], faction, role: "guard", health: 100, respawnAt: 0, nextAttack: 0, nextMove: time + 1_000_000 });
      }
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(world));
    });
    await enter(guest.session); await advance(1500, [guest.session]);
    const battle = await state(guest.session);
    const rivals = battle.entities.filter(entity => entity.id.startsWith("rival-"));
    expect(rivals).toHaveLength(2); expect(rivals.every(entity => entity.health < 100)).toBe(true);
    expect(battle.events.some(event => event.actorId === "rival-0" && event.targetId === "rival-1")).toBe(true);
    expect(battle.self.kills).toBe(0); expect(battle.self.ammo).toBe(60); expect(service.healthy()).toBe(true);
  });





  test("districts are spawn choices inside one shared world and explicit purpose changes cannot teleport or alter the kit", async () => {
    const first = await enter(undefined, undefined, "customs", "quests"), second = await enter(undefined, undefined, "customs", "loot"), far = await enter(undefined, undefined, "depot", "pve");
    const shared = await state(first.session), remote = await state(far.session);
    expect(shared.world).toEqual(remote.world); expect(shared.world.id).toBe("perimeter"); expect(shared.server.maps).toHaveLength(1);
    expect(shared.server.online).toBe(3); expect(shared.server.districts.find(district => district.id === "customs")!.online).toBe(2);
    expect(shared.entities.some(entity => entity.id === second.session.id)).toBe(true); expect(shared.entities.some(entity => entity.id === far.session.id)).toBe(false);
    const body = shared.entities.find(entity => entity.id === first.session.id)!;
    const rejoined = (await enter(first.session, undefined, "village", "pvp")).state;
    expect(rejoined.self).toMatchObject({ districtId: "customs", purpose: "pvp", ammo: shared.self.ammo, medkits: shared.self.medkits, cargo: shared.self.cargo, stash: shared.self.stash });
    expect(rejoined.entities.find(entity => entity.id === first.session.id)).toMatchObject({ x: body.x, y: body.y });
    expect((await enter(first.session)).state.self.purpose).toBe("pvp");
    for (const payload of [{ districtId: "client-region", purpose: "pvp" }, { districtId: "customs", purpose: "immune" }, { districtId: "customs", purpose: "loot", x: 100, y: 100 }, { seed: "chosen-by-browser" }]) expect((await call("join", "POST", payload, first.session)).status).toBe(400);
  });

  test("choosing loot or quests does not grant PvP immunity and walking crosses district boundaries without another instance", async () => {
    const first = await enter(undefined, undefined, "customs", "loot"), second = await enter(undefined, undefined, "customs", "quests");
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 1, y: 0 }]); await enter(first.session); await enter(second.session);
    await act(first.session, { type: "attack", targetId: second.session.id });
    expect((await state(second.session)).self.body.parts.chest.hp).toBe(53);
    const boundary = getLiveMap("perimeter").districts.find(district => district.id === "sawmill")!.x;
    // The dormant NPC fixture occupies (127,0); use a clear parallel border lane.
    const y = 2;
    expect([boundary - 1, boundary, boundary + 1].every(x => isLiveWalkable(getLiveMap("perimeter"), { x, y }))).toBe(true);
    placePlayers([{ session: first.session, x: boundary - 1, y }]); await enter(first.session); await enter(second.session);
    await act(first.session, { type: "move", x: boundary + 1, y }); await advance(1250, [first.session, second.session]);
    const crossed = await state(first.session);
    expect(crossed.world.id).toBe("perimeter"); expect(crossed.self.purpose).toBe("loot"); expect(crossed.self.districtId).toBe("sawmill");
    expect(crossed.entities.find(entity => entity.id === first.session.id)).toMatchObject({ x: boundary + 1, y });
    expect((await call("action", "POST", { type: "travel", mapId: "depot" }, first.session)).status).toBe(400);
  });

  test("respawn applies district and purpose choices only after server death recovery and preserves the verified stash", async () => {
    const guest = await enter(undefined, undefined, "customs", "loot");
    expect((await call("action", "POST", { type: "respawn", districtId: "village", purpose: "quests" }, guest.session)).status).toBe(409);
    placePlayers([{ session: guest.session, x: 0, y: 0, health: 0, cargo: 0, stash: 120, respawnAt: time + 10_000 }]); await enter(guest.session);
    for (const fake of [{ type: "respawn", districtId: "unknown" }, { type: "respawn", purpose: "immune" }, { type: "respawn", districtId: "village", x: 100, y: 100 }, { type: "respawn", respawnAt: time }]) expect((await call("action", "POST", fake, guest.session)).status).toBe(400);
    expect((await call("action", "POST", { type: "respawn", districtId: "village", purpose: "quests" }, guest.session)).status).toBe(409);
    await advance(10_000, [guest.session]);
    const returned = await act(guest.session, { type: "respawn", districtId: "village", purpose: "quests" });
    expect(returned.selfId).toBe(guest.session.id); expect(returned.world.id).toBe("perimeter");
    expect(returned.self).toMatchObject({ districtId: "village", purpose: "quests", ammo: 60, medkits: 3, cargo: 0, stash: 120, respawnAt: 0 });
    const body = returned.entities.find(entity => entity.id === guest.session.id)!, district = returned.world.districts.find(district => district.id === "village")!;
    expect(body.health).toBe(100); expect(body.x >= district.x && body.y >= district.y).toBe(true);
    expect(district.spawns.some(anchor => Math.hypot(anchor.x - body.x, anchor.y - body.y) <= 4)).toBe(true);
  });

  test("visibility omits distant and occluded bodies and exact combat events while versioned state reuses static geometry", async () => {
    const first = await enter(), second = await enter(), third = await enter();
    const [hiddenFirst, hiddenSecond] = blockedPair();
    placePlayers([{ session: first.session, ...hiddenFirst }, { session: second.session, ...hiddenSecond }, { session: third.session, x: 125, y: 0 }]);
    await enter(first.session); await enter(second.session); await enter(third.session);
    const hidden = await state(first.session);
    expect(hidden.entities.some(entity => entity.id === second.session.id || entity.id === third.session.id)).toBe(false);
    for (const targetId of [second.session.id, third.session.id, "guessed-invisible-id"]) {
      const denied = await call("action", "POST", { type: "engage", targetId }, first.session);
      expect(denied.status).toBe(409); expect(await denied.json()).toEqual({ code: "target_unavailable" });
    }
    expect((await state(first.session)).self).toMatchObject({ targetId: null, ammo: hidden.self.ammo });
    const cached = await call("state", "GET", undefined, first.session, { "x-prapor-world-version": hidden.worldVersion });
    const delta = await cached.json() as Record<string, unknown>;
    expect(delta.world).toBeUndefined(); expect(delta.worldVersion).toBe(hidden.worldVersion); expect(delta.visibleChunks).toBeDefined();
    const wrong = await call("state", "GET", undefined, first.session, { "x-prapor-world-version": "forged" }); expect((await wrong.json() as LiveSnapshot).world).toBeDefined();
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 120, y: 0 }, { session: third.session, x: 121, y: 0 }]);
    await enter(first.session); await enter(second.session); await enter(third.session);
    await act(second.session, { type: "attack", targetId: third.session.id });
    const outside = await state(first.session);
    expect(outside.events.some(event => event.actorId === second.session.id && event.targetId === third.session.id)).toBe(false);
    expect((await call("action", "POST", { type: "attack", targetId: third.session.id }, first.session)).status).toBe(409);
  });

  test("a cached route replans around a newly occupied tile instead of overlapping another living body", async () => {
    const first = await enter(), second = await enter();
    placePlayers([{ session: first.session, x: 0, y: 0 }, { session: second.session, x: 3, y: 2 }]); await enter(first.session); await enter(second.session);
    await act(first.session, { type: "move", x: 5, y: 0 }); await advance(250, [first.session, second.session]);
    await act(second.session, { type: "move", x: 3, y: 0 });
    await advance(1000, [first.session, second.session]);
    const middle = await state(first.session), bodies = middle.entities.filter(entity => entity.kind === "player");
    expect(new Set(bodies.map(entity => `${entity.x}:${entity.y}`)).size).toBe(bodies.length);
    await advance(4000, [first.session, second.session]);
    const final = await state(first.session); expect(final.entities.find(entity => entity.id === first.session.id)).toMatchObject({ x: 5, y: 0 });
    expect(service.healthy()).toBe(true);
  });

  test("old district coordinates migrate into the shared world without losing verified inventory or death drops", async () => {
    const guest = await enter();
    placePlayers([{ session: guest.session, x: 0, y: 0, ammo: 17, medkits: 1, cargo: 65, stash: 120 }]);
    editStorage(db => {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").get()!, player = JSON.parse(row.state) as Record<string, unknown>;
      player.mapId = "depot"; delete player.districtId; delete player.purpose; delete player.searching; delete player.searchedDropIds;
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify({ version: 2, startedAt: time, scavs: [], events: [], drops: [{ id: "legacy-body", mapId: "depot", x: 1, y: 0, amount: 73, source: "body", expiresAt: time + 120_000 }] }));
    });
    const restored = (await enter(guest.session)).state;
    expect(restored.selfId).toBe(guest.session.id); expect(restored.self).toMatchObject({ ammo: 17, medkits: 1, cargo: 65, stash: 120, districtId: "depot" });
    const district = getLiveMap("perimeter").districts.find(district => district.id === "depot")!;
    expect(restored.entities.find(entity => entity.id === guest.session.id)).toMatchObject({ x: LIVE_WORLD_OFFSET, y: district.y });
    expect(restored.drops.find(drop => drop.id === "legacy-body")).toMatchObject({ x: LIVE_WORLD_OFFSET + 1, y: district.y, amount: 73 });
    expect(restored.server.bosses).toHaveLength(4);
    const db = new Database(dbPath, { readonly: true });
    try {
      const saved = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state) as { scavs: Array<{ health: number; home: { x: number; y: number }; route: Array<{ x: number; y: number }> }> };
      expect(saved.scavs).toHaveLength(getLiveMap("perimeter").npcSpawns.length);
      expect(restored.server.maps[0]!.npcs).toBe(saved.scavs.filter(npc => npc.health > 0).length + restored.server.bosses!.filter(boss => boss.state === 'alive').length);
      // A geometry rebuild keeps the full roster, but defers posts around the saved live body.
      const deferred = saved.scavs.filter(npc => npc.health <= 0); expect(deferred.length).toBeGreaterThan(0);
      for (const npc of deferred) expect([npc.home, ...npc.route].some(point => Math.hypot(point.x - LIVE_WORLD_OFFSET, point.y - district.y) <= 40)).toBe(true);
    } finally { db.close(); }
    expect(service.healthy()).toBe(true);
  });
  test.each(["perimeter-g2-a827381f", "perimeter-g3-b38b4b0d", "perimeter-g6-shipped", "perimeter-g7-shipped", "perimeter-g8-shipped", "perimeter-g9-shipped"])("expanding saved geometry %s preserves translated body positions, private kit and durable loose cargo across two restarts", async geometryVersion => {
    const guest = await enter(), map = getLiveMap("perimeter"), previousOffset = geometryVersion.startsWith("perimeter-g9-") ? 128 : geometryVersion.startsWith("perimeter-g8-") ? 96 : geometryVersion.startsWith("perimeter-g7-") ? 32 : 0, point = { x: previousOffset, y: previousOffset };
    expect(isLiveWalkable(map, { x: LIVE_WORLD_OFFSET, y: LIVE_WORLD_OFFSET })).toBe(true);
    placePlayers([{ session: guest.session, ...point, health: 71, ammo: 17, medkits: 1, cargo: 65, stash: 120 }]);
    editStorage(db => {
      const saved = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state);
      saved.geometryVersion = geometryVersion; saved.drops = [{ id: "legacy-loose-cargo", mapId: "perimeter", x: point.x + 1, y: point.y, source: "body", amount: 73, expiresAt: time + 120_000 }];
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(saved));
    });
    const restored = (await enter(guest.session)).state;
    expect({ width: restored.world.width, height: restored.world.height, generatorVersion: restored.world.generatorVersion })
      .toEqual({ width: LIVE_WORLD_SIZE, height: LIVE_WORLD_SIZE, generatorVersion: LIVE_GENERATOR_VERSION });
    expect(restored.world.version).toBe(map.version); expect(restored.worldVersion).toBe(map.version);
    expect(restored.self).toMatchObject({ ammo: 17, medkits: 1, cargo: 65, stash: 120 });
    const translated = { x: point.x + LIVE_WORLD_OFFSET - previousOffset, y: point.y + LIVE_WORLD_OFFSET - previousOffset };
    expect(restored.entities.find(entity => entity.id === guest.session.id)).toMatchObject(translated);
    expect(restored.entities.find(entity => entity.id === guest.session.id)!.health).toBeCloseTo(71);
    expect(restored.drops.find(drop => drop.id === "legacy-loose-cargo")).toMatchObject({ x: LIVE_WORLD_OFFSET + 1, y: LIVE_WORLD_OFFSET, amount: 73 });
    editStorage(() => {});
    const again = (await enter(guest.session)).state;
    expect(again.self.body).toEqual(restored.self.body); expect(again.self.medicine).toEqual(restored.self.medicine);
    expect(again.self).toMatchObject({ ammo: 17, cargo: 65, stash: 120 }); expect(again.entities.find(entity => entity.id === guest.session.id)).toMatchObject(translated);
    expect(again.drops.filter(drop => drop.id === "legacy-loose-cargo")).toHaveLength(1);
  });

  test("a saved body in the new dense city stays nearby while its spent medicine, wounds and cargo survive two restarts", async () => {
    const guest = await enter(), world = getLiveMap("perimeter"), savedPoint = { x: 117, y: 115 };
    const body = createHealth(71); body.parts.leftLeg.fracture = true; body.parts.rightArm.maxHp = 48; body.parts.rightArm.hp = 32;
    const medicine = createMedicalInventory({ medkit: 27, bandage: 0, tourniquet: 0, splint: 1, surgery: 0, painkiller: 0 });
    editStorage(db => {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").get()!, player = JSON.parse(row.state);
      Object.assign(player, savedPoint, { body, medicine, healthAt: time, ammo: 17, cargo: 65, stash: 120, safeUntil: time + 120_000 });
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
      const saved = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state);
      saved.geometryVersion = "perimeter-g3-b38b4b0d"; saved.drops = [{ id: "city-migration-cargo", mapId: "perimeter", ...savedPoint, amount: 73, source: "body", expiresAt: time + 120_000 }];
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(saved));
    });
    const first = (await enter(guest.session)).state, relocated = first.entities.find(entity => entity.id === guest.session.id)!;
    const translated = { x: savedPoint.x + LIVE_WORLD_OFFSET, y: savedPoint.y + LIVE_WORLD_OFFSET };
    expect(isLiveWalkable(world, relocated)).toBe(true);
    expect(Math.max(Math.abs(relocated.x - translated.x), Math.abs(relocated.y - translated.y))).toBeLessThanOrEqual(16);
    if (isLiveWalkable(world, translated) && !world.npcSpawns.some(spawn => spawn.point.x === translated.x && spawn.point.y === translated.y)) expect(relocated).toMatchObject(translated);
    expect(first.self).toMatchObject({ body, medicine, ammo: 17, cargo: 65, stash: 120 });
    const cargo = first.drops.find(drop => drop.id === "city-migration-cargo")!; expect(cargo).toBeDefined(); expect(cargo.amount).toBe(73); expect(isLiveWalkable(world, cargo)).toBe(true);
    for (let retry = 0; retry < 2; retry++) {
      editStorage(() => {}); const again = (await enter(guest.session)).state;
      expect(again.entities.find(entity => entity.id === guest.session.id)).toMatchObject({ x: relocated.x, y: relocated.y });
      expect(again.self).toMatchObject({ body, medicine, ammo: 17, cargo: 65, stash: 120 });
      expect(again.drops.filter(drop => drop.id === cargo.id)).toEqual([cargo]);
    }
  });

  test.each([6, 7, 8, 9])('G%s offline fighters migrate before the new world is saved and can join later without a second coordinate shift', async previousVersion => {
    const active = await enter(), offline = await enter(), body = createHealth(71), previousOffset = previousVersion === 9 ? 128 : previousVersion === 8 ? 96 : previousVersion === 7 ? 32 : 0; body.parts.leftLeg.fracture = true;
    editStorage(db => {
      for (const row of db.query<{ identity: string; state: string }, []>('SELECT identity,state FROM live_players').all()) {
        const fighter = JSON.parse(row.state); Object.assign(fighter, { x: previousOffset + (fighter.id === active.session.id ? 0 : 1), y: previousOffset, ammo: 17, cargo: 65, stash: 120, body, healthAt: time, safeUntil: time + 120_000 });
        db.query('UPDATE live_players SET state=? WHERE identity=?').run(JSON.stringify(fighter), row.identity);
      }
      const saved = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world').get()!.state); saved.geometryVersion = `perimeter-g${previousVersion}-offline-fighter`;
      db.query('UPDATE live_world SET state=?').run(JSON.stringify(saved));
    });
    const first = (await enter(active.session)).state;
    expect(first.entities.find(entity => entity.id === active.session.id)).toMatchObject({ x: LIVE_WORLD_OFFSET, y: LIVE_WORLD_OFFSET });
    const db = new Database(dbPath, { readonly: true });
    try {
      const savedWorld = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world').get()!.state); expect(savedWorld.geometryVersion).toBe(first.worldVersion);
      const savedOffline = db.query<{ state: string }, []>('SELECT state FROM live_players').all().map(row => JSON.parse(row.state)).find(fighter => fighter.id === offline.session.id)!;
      expect(savedOffline).toMatchObject({ x: LIVE_WORLD_OFFSET + 1, y: LIVE_WORLD_OFFSET, ammo: 17, cargo: 65, stash: 120, body });
    } finally { db.close(); }
    // This fighter was not loaded by the application during either new startup.
    editStorage(() => {}); editStorage(() => {});
    const late = (await enter(offline.session)).state;
    expect(late.entities.find(entity => entity.id === offline.session.id)).toMatchObject({ x: LIVE_WORLD_OFFSET + 1, y: LIVE_WORLD_OFFSET });
    expect(late.self).toMatchObject({ body, ammo: 17, cargo: 65, stash: 120 });
  });

  test("container search uses a server deadline, survives confirmed discovery across restart and permits only one shared pickup", async () => {
    const first = await enter(), second = await enter(), world = getLiveMap("perimeter"), anchor = world.containers[0]!;
    const near = [{ x: anchor.x + 1, y: anchor.y }, { x: anchor.x - 1, y: anchor.y }, { x: anchor.x, y: anchor.y + 1 }].find(point => isLiveWalkable(world, point) && hasLiveLineOfSight(world, anchor, point))!;
    editStorage(db => {
      const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!, stored = JSON.parse(row.state) as { drops: Array<Record<string, unknown>> };
      stored.drops = stored.drops.filter(drop => drop.containerId !== anchor.id);
      stored.drops.push({ id: "searchable", mapId: "perimeter", x: anchor.x, y: anchor.y, source: "supply", amount: 35, containerId: anchor.id, containerKind: anchor.kind, expiresAt: time + 120_000 });
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(stored));
    });
    placePlayers([{ session: first.session, x: anchor.x, y: anchor.y }, { session: second.session, ...near }]); await enter(first.session); await enter(second.session);
    expect((await state(first.session)).drops.find(drop => drop.id === "searchable")).toMatchObject({ amount: 0, searched: false, containerId: anchor.id, containerKind: anchor.kind });
    expect((await call("action", "POST", { type: "loot", id: "searchable" }, first.session)).status).toBe(409);
    for (const fake of [{ type: "search", id: "searchable", readyAt: time }, { type: "search", id: "searchable", amount: 999 }, { type: "loot", id: "searchable", searched: true }]) expect((await call("action", "POST", fake, first.session)).status).toBe(400);
    const scheduled = await act(first.session, { type: "search", id: "searchable" }); await act(second.session, { type: "search", id: "searchable" });
    expect(scheduled.self.searching).toEqual({ id: "searchable", readyAt: time + anchor.searchMs });
    await advance(anchor.searchMs - 250, [first.session, second.session]); expect((await state(first.session)).drops.find(drop => drop.id === "searchable")!.amount).toBe(0);
    expect((await call("action", "POST", { type: "loot", id: "searchable" }, first.session)).status).toBe(409);
    await advance(250, [first.session, second.session]);
    expect((await state(first.session)).self.searching).toBeNull(); expect((await state(first.session)).drops.find(drop => drop.id === "searchable")!.amount).toBe(35);
    service.close(); service = createLiveService(options()); await enter(first.session); await enter(second.session);
    const raced = await Promise.all([call("action", "POST", { type: "loot", id: "searchable" }, first.session), call("action", "POST", { type: "loot", id: "searchable" }, second.session)]);
    expect(raced.map(reply => reply.status).sort()).toEqual([200, 409]);
    expect((await state(first.session)).self.cargo + (await state(second.session)).self.cargo).toBe(35);
    expect((await state(first.session)).drops.some(drop => drop.containerId === anchor.id)).toBe(false);
    service.close(); service = createLiveService(options()); await enter(first.session); await enter(second.session);
    await advance(29_750, [first.session, second.session]); expect((await state(first.session)).drops.some(drop => drop.containerId === anchor.id)).toBe(false);
    await advance(250, [first.session, second.session]);
    const replenished = (await state(first.session)).drops.find(drop => drop.containerId === anchor.id)!;
    expect(replenished).toBeDefined(); expect(replenished.id).not.toBe("searchable"); expect(replenished).toMatchObject({ searched: false, amount: 0 });
  }, 15_000);

  test("search progress cancels on movement, incoming damage and leaving, so a browser cannot finish an interrupted search", async () => {
    const first = await enter(), second = await enter(), world = getLiveMap("perimeter"), anchor = world.containers[0]!;
    const near = [{ x: anchor.x + 1, y: anchor.y }, { x: anchor.x - 1, y: anchor.y }, { x: anchor.x, y: anchor.y + 1 }].find(point => isLiveWalkable(world, point) && hasLiveLineOfSight(world, anchor, point))!;
    editStorage(db => {
      const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!, stored = JSON.parse(row.state) as { drops: Array<Record<string, unknown>> };
      stored.drops = stored.drops.filter(drop => drop.containerId !== anchor.id);
      stored.drops.push({ id: "interrupted", mapId: "perimeter", x: anchor.x, y: anchor.y, source: "supply", amount: 35, containerId: anchor.id, containerKind: anchor.kind, expiresAt: time + 120_000 });
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(stored));
    });
    placePlayers([{ session: first.session, x: anchor.x, y: anchor.y }, { session: second.session, ...near }]); await enter(first.session); await enter(second.session);
    await act(first.session, { type: "search", id: "interrupted" }); expect((await act(first.session, { type: "move", x: anchor.x, y: anchor.y })).self.searching).toBeNull();
    await advance(anchor.searchMs, [first.session, second.session]); expect((await state(first.session)).drops.find(drop => drop.id === "interrupted")!.amount).toBe(0);
    await act(first.session, { type: "search", id: "interrupted" }); await act(second.session, { type: "attack", targetId: first.session.id });
    expect((await state(first.session)).self.searching).toBeNull();
    await advance(anchor.searchMs, [first.session, second.session]); expect((await state(first.session)).drops.find(drop => drop.id === "interrupted")!.amount).toBe(0);
    await act(first.session, { type: "search", id: "interrupted" }); await call("leave", "POST", {}, first.session);
    const restored = (await enter(first.session)).state; expect(restored.self.searching).toBeNull();
    await advance(anchor.searchMs, [first.session, second.session]); expect((await call("action", "POST", { type: "loot", id: "interrupted" }, first.session)).status).toBe(409);
  });
});

describe("live API security and account ownership", () => {
  test("host, origin, method, cookie format and JSON size guards fail closed without corrupting the world", async () => {
    const guest = await enter();
    for (const origin of ["https://evil.example", "null", ""]) expect((await call("action", "POST", { type: "heal" }, guest.session, { origin })).status).toBe(403);
    expect((await call("join", "POST", {}, undefined, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await call("join", "POST", {}, undefined, { "content-type": "text/plain" })).status).toBe(415);
    expect((await call("join", "POST", { filler: "x".repeat(1100) })).status).toBe(413);
    expect((await call("join", "POST", {}, undefined, { "content-length": "invalid" })).status).toBe(413);
    const aborted = new Request(`${ORIGIN}/api/live/join`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: new ReadableStream({ pull(controller) { controller.error(new Error("Client disconnected")); } }) });
    expect((await service.fetch(aborted, "192.0.2.1"))!.status).toBe(400);
    expect((await service.fetch(new Request("https://evil.example/api/live/status")))!.status).toBe(403);
    expect((await call("state", "POST", {}, guest.session)).status).toBe(405);
    expect((await call("missing")).status).toBe(404);
    expect((await call("state", "GET", undefined, { ...guest.session, cookie: `${guest.session.cookie}; ${guest.session.cookie}` })).status).toBe(401);
    expect((await call("state", "GET", undefined, { ...guest.session, cookie: "__Host-prapor_live=forged" })).status).toBe(401);
    const joinReply = await call("join", "POST", {}, undefined, undefined, "198.51.100.3");
    const cookie = joinReply.headers.get("set-cookie")!;
    for (const flag of ["__Host-prapor_live=", "HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(flag);
    expect(cookie).not.toContain("Domain=");
    expect(joinReply.headers.get("cache-control")).toBe("no-store");
    const db = new Database(dbPath, { readonly: true });
    for (const row of db.query<{ token_hash: string }, []>("SELECT token_hash FROM live_guests").all()) expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    db.close();
    expect(service.healthy()).toBe(true); expect((await state(guest.session)).selfId).toBe(guest.session.id);
  });

  test("guest creation and action floods are bounded while existing sessions keep working", async () => {
    const first = await enter();
    for (let index = 1; index < 12; index++) await enter();
    expect((await call("join", "POST", {})).status).toBe(429);
    for (let index = 0; index < 180; index++) expect((await call("action", "POST", { type: "patrol", enabled: false }, first.session)).status).toBe(200);
    expect((await call("action", "POST", { type: "patrol", enabled: false }, first.session)).status).toBe(429);
    expect((await state(first.session)).selfId).toBe(first.session.id);
  }, 15_000);

  test('aggregate IP allowance supports a full shared network but still rejects requests beyond its bound', async () => {
    for (let index = 0; index < LIVE_CAPACITY * 600; index++) {
      const reply = await call('state', 'GET', undefined, undefined, undefined, '192.0.2.250');
      expect(reply.status).toBe(401);
    }
    expect((await call('state', 'GET', undefined, undefined, undefined, '192.0.2.250')).status).toBe(429);
    const fighter = await enter();
    for (let index = 0; index < 600; index++) expect((await call('state', 'GET', undefined, fighter.session, { 'x-prapor-world-version': cachedWorld!.version })).status).toBe(200);
    expect((await call('state', 'GET', undefined, fighter.session)).status).toBe(429);
  }, 15_000);

  test("logged-in account identity is stable across sessions, guest/account changes are bound, and logout revokes commands", async () => {
    accounts = createAccountService({ dbPath: join(directory, "accounts.sqlite"), secureCookies: true, allowedOrigins: [ORIGIN], now: () => time });
    service.close(); service = createLiveService(options());
    const registration = (await accounts.fetch(request("/api/auth/register", "POST", { username: "OnlineScav", password: "strong password 123" }), "192.0.2.1"))!;
    expect(registration.status).toBe(201);
    const user = await registration.json() as { user: { id: string } };
    const accountSession = { cookie: registration.headers.get("set-cookie")!.split(";")[0]!, id: "", accountId: user.user.id };
    const joined = await enter(accountSession); accountSession.id = joined.state.selfId;
    expect(joined.state.entities.find(entity => entity.id === joined.state.selfId)!.name).toBe("OnlineScav");
    expect((await call("join", "POST", {}, accountSession, { "x-prapor-account": "another-account" })).status).toBe(401);
    const login = (await accounts.fetch(request("/api/auth/login", "POST", { username: "OnlineScav", password: "strong password 123" }), "192.0.2.2"))!;
    const second = { ...accountSession, cookie: login.headers.get("set-cookie")!.split(";")[0]! };
    expect((await enter(second)).state.selfId).toBe(accountSession.id);
    expect((await state(second)).server.online).toBe(1);
    const guest = await enter();
    expect((await call("action", "POST", { type: "heal" }, second, { "x-prapor-live": guest.session.id })).status).toBe(401);
    await accounts.fetch(request("/api/auth/logout", "POST", {}, second), "192.0.2.2");
    expect((await call("state", "GET", undefined, second)).status).toBe(401);
    expect((await state(accountSession)).selfId).toBe(accountSession.id);
    const handler = createHandler(directory, accounts, service);
    expect((await handler(request("/api/live/status"))).status).toBe(200);
    expect((await handler(request("/health"))).status).toBe(200);
    service.close();
    expect((await handler(request("/health"))).status).toBe(503);
  });

  test("production options use persistent app data and ignore DevHub settings", () => {
    const prod = readLiveOptions({ NODE_ENV: "production", DEVHUB_ROOT: "unrelated", DEVHUB_PORT: "1234" });
    expect(prod.dbPath).toBe("/app/data/live.sqlite"); expect(prod.secureCookies).toBe(true);
    expect(readLiveOptions({ NODE_ENV: "development", LIVE_DB_PATH: "chosen.sqlite", APP_ORIGINS: ORIGIN }).dbPath).toBe("chosen.sqlite");
    expect(() => createLiveService({ ...options(), allowedOrigins: ["http://evil.example"] })).toThrow();
  });
});
