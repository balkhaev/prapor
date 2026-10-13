import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveService, readLiveOptions, type LiveService } from "../server/live";
import { createHealth } from "../src/game/health";
import { createAccountService, type AccountService } from "../server/accounts";
import { createHandler } from "../server/handler";
import type { LiveCommand, LiveSnapshot, LiveStatus } from "../src/game/live";

const ORIGIN = "https://game.delopusk.ru";
let directory: string, dbPath: string, service: LiveService, accounts: AccountService | undefined;
let time = 1_800_000_000_000;
interface Session { cookie: string; id: string; accountId?: string }
const options = () => ({ dbPath, secureCookies: true, allowedOrigins: [ORIGIN], now: () => time, random: () => 0, automaticTicks: false, accounts });
function request(path: string, method = "GET", body?: unknown, session?: Session, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method, headers: {
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
async function enter(session?: Session, ip?: string): Promise<{ session: Session; state: LiveSnapshot }> {
  const reply = await call("join", "POST", {}, session, undefined, ip);
  expect(reply.status).toBe(200);
  const state = await reply.json() as LiveSnapshot;
  return { session: session ?? { cookie: reply.headers.get("set-cookie")!.split(";")[0]!, id: state.selfId }, state };
}
async function state(session: Session): Promise<LiveSnapshot> {
  const result = await call("state", "GET", undefined, session);
  expect(result.status).toBe(200);
  return result.json() as Promise<LiveSnapshot>;
}
async function act(session: Session, command: LiveCommand): Promise<LiveSnapshot> {
  const reply = await call("action", "POST", command, session);
  expect(reply.status).toBe(200);
  return reply.json() as Promise<LiveSnapshot>;
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
function placePlayers(placements: Array<{ session: Session; x: number; y: number; health?: number; cargo?: number }>): void {
  editStorage(db => {
    for (const placement of placements) {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => (JSON.parse(row.state) as { id: string }).id === placement.session.id)!;
      const player = JSON.parse(row.state) as Record<string, unknown>;
      Object.assign(player, { x: placement.x, y: placement.y, safeUntil: 0 }, placement.health === undefined ? {} : { health: placement.health }, placement.cargo === undefined ? {} : { cargo: placement.cargo });
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
    }
  });
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "prapor-live-")); dbPath = join(directory, "live.sqlite");
  time = 1_800_000_000_000; accounts = undefined;
  service = createLiveService(options());
  // Deterministic fixtures keep unrelated NPC combat out of movement/PvP assertions.
  editStorage(db => db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify({ startedAt: time, events: [],
    scavs: [{ id: "scav-0", kind: "scav", name: "Косой", appearance: 0, x: 31, y: 23, health: 100, action: "idle", safeUntil: 0, respawnAt: 0, nextMove: time + 1_000_000, nextAttack: time + 1_000_000 }],
    drops: Array.from({ length: 10 }, (_, index) => ({ id: `drop-${index}`, x: index === 0 ? 0 : 30, y: index === 0 ? 0 : 20, amount: 35, expiresAt: time + 1_000_000 })),
  })));
});
afterEach(async () => { service.close(); accounts?.close(); await rm(directory, { recursive: true, force: true }); });

describe("shared endless live server", () => {
  test("independent guests meet in one world, cannot impersonate each other, and only command a server-paced path", async () => {
    const first = await enter(), second = await enter();
    expect(first.session.id).not.toBe(second.session.id);
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
      { type: "move", x: 7, y: 4 }, { type: "move", x: 99, y: 0 }, { type: "move", x: 0.5, y: 1 },
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
    placePlayers([{ session: first.session, x: 6, y: 5 }, { session: second.session, x: 11, y: 5, cargo: 70 }]);
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
    await act(second.session, { type: "treat", medicine: "tourniquet", part: "chest" });
    await advance(4000, [first.session, second.session]);
    await act(second.session, { type: "heal" });
    expect((await state(second.session)).self.treatment?.type).toBe("medkit");
    expect((await state(second.session)).self.medicine.medkit).toBe(120);
    await advance(5000, [first.session, second.session]);
    expect((await state(second.session)).self.medicine.medkit).toBeLessThan(120);
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
    expect((await call("action", "POST", { type: "loot", id: "drop-1" }, first.session)).status).toBe(409);
    expect((await act(first.session, { type: "loot", id: "drop-0" })).self.cargo).toBe(35);
    expect((await state(second.session)).drops.some(drop => drop.id === "drop-0")).toBe(false);
    expect((await call("action", "POST", { type: "extract" }, first.session)).status).toBe(409);
    await act(first.session, { type: "move", x: 2, y: 2 }); await advance(3500, [first.session, second.session]);
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
    expect({ x: body.x, y: body.y }).toEqual({ x: 2, y: 2 });
    expect(restored.server.startedAt).toBe(banked.server.startedAt);
  });

  test("heartbeat disconnects cancel patrol without losing the body or its inventory", async () => {
    const first = await enter();
    await act(first.session, { type: "loot", id: "drop-0" });
    await act(first.session, { type: "patrol", enabled: true });
    await advance(15_000);
    expect(((await call("status")).json() as Promise<LiveStatus>).then(status => status.online)).resolves.toBe(0);
    expect((await call("state", "GET", undefined, first.session)).status).toBe(401);
    const restored = (await enter(first.session)).state;
    expect(restored.selfId).toBe(first.session.id); expect(restored.self.cargo).toBeGreaterThanOrEqual(35); expect(restored.self.patrol).toBe(false);
  });

  test("NPCs attack online players and respawn indefinitely; patrol never automatically shoots another player", async () => {
    const first = await enter(), second = await enter();
    editStorage(db => {
      const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!;
      const world = JSON.parse(row.state) as { scavs: Array<Record<string, unknown>> };
      Object.assign(world.scavs[0]!, { x: 3, y: 0, health: 25, body: createHealth(25), nextAttack: 0 });
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(world));
    });
    await enter(first.session); await enter(second.session);
    await advance(6500, [first.session, second.session]);
    const underFire = await state(first.session);
    expect(underFire.entities.filter(entity => entity.kind === "player").some(entity => entity.health < 100)).toBe(true);
    await act(first.session, { type: "attack", targetId: "scav-0" });
    await act(first.session, { type: "patrol", enabled: true }); await advance(250, [first.session, second.session]);
    expect((await state(first.session)).self.kills).toBe(1);
    const before = (await state(second.session)).self.body.parts.chest.hp;
    await advance(2000, [first.session, second.session]);
    const after = await state(second.session);
    expect(after.self.body.parts.chest.hp).toBeCloseTo(before - .5);
    expect(after.events.some(event => event.actorId === first.session.id && event.targetId === second.session.id)).toBe(false);
    await act(first.session, { type: "cancelTreatment" });
    await act(first.session, { type: "patrol", enabled: false }); await advance(8500, [first.session, second.session]);
    expect((await state(first.session)).entities.find(entity => entity.id === "scav-0")!.health).toBe(100);
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
  });

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
