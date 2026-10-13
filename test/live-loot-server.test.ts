import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveService, getLiveLootPool, type LiveService } from "../server/live";
import { LiveEconomyError, type EconomyLoot, type LiveDelivery, type LiveEconomy, type LiveSupplyReceipt, type LiveSupplyRequest } from "../server/live-economy";
import { LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT, type LiveCommand, type LiveSnapshot } from "../src/game/live";
import { LIVE_MAPS } from "../src/game/live-maps";
import { LOOT_MODELS } from "../src/game/loot";

const ORIGIN = "https://game.delopusk.ru";
interface Session { cookie: string; gameId: string; owner: string; id?: string }
let directory: string, dbPath: string, service: LiveService, time: number;
let economy: LiveEconomy | undefined, blocked: boolean, throwAfterDelivery: boolean, throwAfterSupply: boolean;
let deliveries: Map<string, LiveDelivery>, supplyRequests: Map<string, LiveSupplyRequest>, supplyReceipts: Map<string, LiveSupplyReceipt>;
let delivered: EconomyLoot[], credited: number, stocks: Map<string, { ammo: number; medkits: number }>;
let onDelivery: (() => void) | undefined, onSupply: (() => void) | undefined;
let blockedOwners: Set<string>;
const profiles = new Map<string, Session>();
const options = () => ({ dbPath, secureCookies: true, allowedOrigins: [ORIGIN], now: () => time, random: () => 0, automaticTicks: false, economy });
function fakeEconomy(): LiveEconomy {
  return {
    resolve(request) {
      const profile = profiles.get(request.headers.get("x-prapor-game") ?? "");
      if (!profile || !(request.headers.get("cookie") ?? "").split("; ").includes(`hq=${profile.owner}`)) throw new LiveEconomyError(401, "game_identity_changed");
      return { key: profile.owner, gameId: profile.gameId, name: `Дикий ${profile.gameId.slice(0, 4)}` };
    },
    deliver(parcel) {
      const previous = deliveries.get(parcel.id);
      if (previous) { expect(parcel).toEqual(previous); return { ok: true, message: "Груз доставлен в убежище." }; }
      if (blocked || blockedOwners.has(parcel.owner)) return { ok: false, message: "Освободите место на складе убежища." };
      deliveries.set(parcel.id, structuredClone(parcel)); delivered.push(...structuredClone(parcel.items)); credited += parcel.money;
      onDelivery?.();
      if (throwAfterDelivery) { throwAfterDelivery = false; throw new Error("Interrupted after headquarters commit"); }
      return { ok: true, message: "Груз доставлен в убежище." };
    },
    supply(request) {
      const previous = supplyReceipts.get(request.id);
      if (previous) { expect(request).toEqual(supplyRequests.get(request.id)!); return previous; }
      const stock = stocks.get(request.owner)!;
      const receipt = { ammo: Math.min(stock.ammo, request.ammo), medkits: Math.min(stock.medkits, request.medkits), message: "Запасы получены из убежища." };
      stock.ammo -= receipt.ammo; stock.medkits -= receipt.medkits;
      supplyRequests.set(request.id, structuredClone(request)); supplyReceipts.set(request.id, receipt);
      onSupply?.();
      if (throwAfterSupply) { throwAfterSupply = false; throw new Error("Interrupted after headquarters debit"); }
      return receipt;
    },
  };
}
function profile(): Session {
  const owner = `guest:${randomUUID()}`, gameId = randomUUID(), value = { cookie: `hq=${owner}`, gameId, owner };
  profiles.set(gameId, value); stocks.set(owner, { ammo: 100, medkits: 10 }); return value;
}
function trophy(modelId = "coffee"): EconomyLoot { return { id: randomUUID(), modelId, foundAt: time }; }
function request(path: string, body: unknown | undefined, session?: Session, extra: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/live/${path}`, { method: body === undefined ? "GET" : "POST", headers: {
    ...(body === undefined ? {} : { origin: ORIGIN, "content-type": "application/json" }),
    ...(session ? { cookie: session.cookie, "x-prapor-game": session.gameId, ...(session.id ? { "x-prapor-live": session.id } : {}) } : {}), ...extra,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(path: string, body: unknown | undefined, session?: Session, extra?: Record<string, string>): Promise<Response> {
  return (await service.fetch(request(path, body, session, extra), "192.0.2.42"))!;
}
async function enter(session = profile()): Promise<{ session: Session; state: LiveSnapshot }> {
  const reply = await call("join", {}, session); expect(reply.status).toBe(200);
  const state = await reply.json() as LiveSnapshot; session.id = state.selfId; return { session, state };
}
async function state(session: Session): Promise<LiveSnapshot> {
  const reply = await call("state", undefined, session); expect(reply.status).toBe(200); return reply.json() as Promise<LiveSnapshot>;
}
async function act(session: Session, command: LiveCommand): Promise<LiveSnapshot> {
  const reply = await call("action", command, session); expect(reply.status).toBe(200); return reply.json() as Promise<LiveSnapshot>;
}
function restart(edit?: (db: Database) => void): void {
  service.close();
  if (edit) { const db = new Database(dbPath); edit(db); db.close(); }
  service = createLiveService(options());
}
function editPlayers(values: Array<{ session: Session; x?: number; y?: number; ammo?: number; medkits?: number; health?: number; cargo?: number; stash?: number; lootItems?: EconomyLoot[]; lastCombatAt?: number }>, drops?: EconomyLoot[][]): void {
  restart(db => {
    for (const value of values) {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => JSON.parse(row.state).id === value.session.id)!;
      const { session: _session, ...fields } = value;
      const player = { ...JSON.parse(row.state), x: 2, y: 2, safeUntil: 0, lastCombatAt: 0, ...fields };
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
    }
    const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!, world = JSON.parse(row.state);
    for (const scav of world.scavs) { scav.health = 0; scav.respawnAt = time + 1_000_000; }
    if (drops) world.drops = drops.map(items => ({ id: randomUUID(), mapId: "customs", x: 2, y: 2, amount: 0, items, expiresAt: time + 1_000_000, source: "body" }));
    db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(world));
  });
}
function pending(): number {
  const db = new Database(dbPath); const count = db.query<{ count: number }, []>("SELECT count(*) AS count FROM live_economy_outbox WHERE acknowledged=0").get()!.count; db.close(); return count;
}
function failAcknowledgement(): void {
  const db = new Database(dbPath);
  db.exec("CREATE TRIGGER reject_economy_ack BEFORE UPDATE OF acknowledged ON live_economy_outbox WHEN NEW.acknowledged=1 BEGIN SELECT RAISE(ABORT,'injected acknowledgement storage failure'); END");
  db.close();
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "prapor-live-loot-")); dbPath = join(directory, "live.sqlite"); time = 1_800_000_000_000;
  profiles.clear(); deliveries = new Map(); supplyRequests = new Map(); supplyReceipts = new Map(); stocks = new Map(); delivered = []; credited = 0;
  blocked = false; throwAfterDelivery = false; throwAfterSupply = false; onDelivery = undefined; onSupply = undefined;
  blockedOwners = new Set();
  economy = fakeEconomy(); service = createLiveService(options());
});
afterEach(async () => { service.close(); await rm(directory, { recursive: true, force: true }); });

describe("multiplayer loot and durable headquarters economy", () => {
  test("all 24 trophies occur in authored map pools, rare finds follow danger, and drops carry private source UUIDs", async () => {
    const models = new Set(LIVE_MAPS.flatMap(map => map.lootSpawns.flatMap(point => getLiveLootPool(map.id, point).map(entry => entry.model.id))));
    expect([...models].sort()).toEqual(LOOT_MODELS.map(model => model.id).sort());
    expect(getLiveLootPool("depot", { x: 2, y: 2 }).every(entry => entry.model.minDepth === 1)).toBe(true);
    expect(getLiveLootPool("depot", { x: 33, y: 11 }).some(entry => entry.model.id === "secure-drive")).toBe(true);
    const first = await enter();
    expect(first.state.self.gameId).toBe(first.session.gameId);
    expect(first.state.drops.every(drop => drop.amount === 0 && drop.items && drop.items.length >= 1 && drop.items.length <= 2)).toBe(true);
    const ids = first.state.drops.flatMap(drop => drop.items!.map(item => item.id));
    expect(new Set(ids).size).toBe(ids.length); expect(ids.every(id => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    expect(JSON.stringify(first.state)).not.toContain(first.session.owner);
  });

  test("one headquarters identity has one persistent body across cookies and cannot change game or borrow a live ID", async () => {
    const first = await enter(), second = await enter();
    const sameProfile = { ...first.session, id: undefined };
    expect((await enter(sameProfile)).session.id).toBe(first.session.id);
    expect((await state(first.session)).server.online).toBe(2);
    expect((await call("join", {}, undefined)).status).toBe(401);
    expect((await call("state", undefined, first.session, { "x-prapor-live": second.session.id! })).status).toBe(401);
    expect((await call("action", { type: "extract" }, first.session, { "x-prapor-game": second.session.gameId })).status).toBe(401);
    expect((await call("join", {}, first.session, { "x-prapor-game": randomUUID() })).status).toBe(401);
    const before = await state(first.session); expect(before.self.lootItems).toEqual([]); expect(pending()).toBe(0);
    restart(); expect((await enter(first.session)).session.id).toBe(first.session.id);
  });

  test("legacy guest body and verified bank bind once, migrate through the outbox, and are never reset by another profile", async () => {
    economy = undefined; restart();
    const reply = await call("join", {}); expect(reply.status).toBe(200);
    const legacy = await reply.json() as LiveSnapshot, liveCookie = reply.headers.get("set-cookie")!.split(";")[0]!;
    const owner = profile(); owner.cookie += `; ${liveCookie}`; owner.id = legacy.selfId;
    editPlayers([{ session: owner, health: 87, ammo: 11, medkits: 1, cargo: 70, stash: 100 }]);
    economy = fakeEconomy(); restart();
    const bound = await enter(owner); expect(bound.state.self.id).toBe(legacy.selfId);
    expect(bound.state.entities.find(item => item.id === owner.id)!.health).toBe(87);
    const extracted = await act(owner, { type: "extract" });
    expect(extracted.self.cargo).toBe(0); expect(extracted.self.stash).toBe(0); expect(credited).toBe(170);
    expect(extracted.self.ammo).toBe(11); expect(extracted.self.medkits).toBe(1);
    const other = profile(); other.cookie += `; ${liveCookie}`;
    expect((await call("join", {}, other)).status).toBe(401);
    restart(); await enter(owner); await act(owner, { type: "extract" }); expect(credited).toBe(170); expect(deliveries.size).toBe(1);
    // Losing the old live token still resolves the linked headquarters body.
    const withoutLiveCookie = { ...owner, cookie: `hq=${owner.owner}`, id: undefined };
    expect((await enter(withoutLiveCookie)).state.self.id).toBe(legacy.selfId);
  });

  test("one shared named drop has one winner, weight and item count are hard limits, and trophy price is not a cash capacity", async () => {
    const first = await enter(), second = await enter(), expensive = trophy("secure-drive");
    editPlayers([{ session: first.session, cargo: 499 }, { session: second.session, x: 3 }], [[expensive]]);
    await enter(first.session); await enter(second.session);
    const drop = (await state(first.session)).drops.find(drop => drop.items?.some(item => item.id === expensive.id))!;
    const replies = await Promise.all([call("action", { type: "loot", id: drop.id }, first.session), call("action", { type: "loot", id: drop.id }, second.session)]);
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409]);
    const cargo = await state(first.session); expect(cargo.self.cargo).toBe(499); expect(cargo.self.lootItems).toEqual([expensive]);
    expect((await state(second.session)).self.lootItems).toEqual([]);
    const heavy = Array.from({ length: 4 }, () => trophy("tool-case"));
    editPlayers([{ session: first.session, cargo: 0, lootItems: heavy }], [[trophy("coffee")]]); await enter(first.session);
    const beforeHeavy = await state(first.session), heavyDrop = beforeHeavy.drops.find(drop => drop.items?.length === 1)!;
    expect(heavy.length * 3).toBe(LIVE_LOOT_WEIGHT);
    expect((await call("action", { type: "loot", id: heavyDrop.id }, first.session)).status).toBe(409);
    expect((await state(first.session)).self.lootItems).toEqual(heavy); expect((await state(first.session)).drops.some(drop => drop.id === heavyDrop.id)).toBe(true);
    const small = Array.from({ length: LIVE_LOOT_CAPACITY }, () => trophy("local-map"));
    editPlayers([{ session: first.session, lootItems: small }], [[trophy("coffee")]]); await enter(first.session);
    const smallDrop = (await state(first.session)).drops.find(drop => drop.items?.length === 1)!;
    expect((await call("action", { type: "loot", id: smallDrop.id }, first.session)).status).toBe(409);
  });

  test("PvP death transfers exact named cargo once and respawn produces neither duplicate trophies nor free supplies", async () => {
    const first = await enter(), second = await enter(), carried = [trophy("gold-ring"), trophy("bandage-roll")];
    editPlayers([{ session: first.session, x: 1, y: 2 }, { session: second.session, x: 2, y: 2, ammo: 17, medkits: 1, cargo: 40, lootItems: carried }], []);
    await enter(first.session); await enter(second.session);
    for (let hit = 0; hit < 4; hit++) { time += 1000; await act(first.session, { type: "attack", targetId: second.session.id! }); }
    const dead = await state(second.session), body = dead.drops.find(drop => drop.items?.some(item => item.id === carried[0]!.id))!;
    expect(dead.self.lootItems).toEqual([]); expect(dead.self.cargo).toBe(0); expect(body.items).toEqual(carried); expect(body.amount).toBe(40);
    const recovered = await act(first.session, { type: "loot", id: body.id }); expect(recovered.self.lootItems).toEqual(carried); expect(recovered.self.cargo).toBe(40);
    expect((await call("action", { type: "loot", id: body.id }, first.session)).status).toBe(409);
    time += 10_000; const respawned = await act(second.session, { type: "respawn" });
    expect(respawned.self.lootItems).toEqual([]); expect(respawned.self.ammo).toBe(17); expect(respawned.self.medkits).toBe(1);
    await act(first.session, { type: "extract" }); expect(delivered).toEqual(carried); expect(credited).toBe(40);
    expect((await state(second.session)).self.lootItems).toEqual([]);
  });

  test("extract, travel and resupply cannot erase a body during the eight second combat lock", async () => {
    const first = await enter(), second = await enter(), item = trophy();
    editPlayers([{ session: first.session, x: 1, y: 2, ammo: 40, lootItems: [item] }, { session: second.session, x: 2, y: 2 }], []);
    await enter(first.session); await enter(second.session); await act(first.session, { type: "attack", targetId: second.session.id! });
    for (const command of [{ type: "extract" }, { type: "travel", mapId: "depot" }, { type: "resupply" }]) {
      const reply = await call("action", command, first.session); expect(reply.status).toBe(409); expect(await reply.json()).toEqual({ code: "in_combat" });
    }
    expect((await state(first.session)).self.lootItems).toEqual([item]); expect(pending()).toBe(0); expect(deliveries.size).toBe(0);
    time += 8001; const moved = await act(first.session, { type: "travel", mapId: "depot" });
    expect(moved.world.id).toBe("depot"); expect(moved.self.lootItems).toEqual([]); expect(delivered).toEqual([item]); expect(moved.self.ammo).toBe(39);
  });

  test("a full headquarters preserves a visible parcel across restart and later delivers its unchanged contents once", async () => {
    const first = await enter(), items = [trophy("old-watch"), trophy("coffee")];
    editPlayers([{ session: first.session, cargo: 30, stash: 70, lootItems: items, ammo: 7, medkits: 0 }], []); await enter(first.session);
    blocked = true; const waiting = await act(first.session, { type: "extract" });
    expect(waiting.self.lootItems).toEqual([]); expect(waiting.self.cargo).toBe(0); expect(waiting.self.stash).toBe(0);
    expect(waiting.self.pendingDelivery).toEqual([{ items, money: 100, message: "Освободите место на складе убежища." }]); expect(pending()).toBe(1);
    expect(waiting.self.ammo).toBe(7); expect(waiting.self.medkits).toBe(0); expect(delivered).toEqual([]);
    restart(); const afterRestart = await enter(first.session); expect(afterRestart.state.self.pendingDelivery?.[0]?.items).toEqual(items);
    blocked = false; time += 1000; service.tick(); const received = await state(first.session);
    expect(received.self.pendingDelivery).toEqual([]); expect(delivered).toEqual(items); expect(credited).toBe(100); expect(pending()).toBe(0);
    await act(first.session, { type: "extract" }); restart(); await enter(first.session); expect(deliveries.size).toBe(1); expect(credited).toBe(100);
  });

  test("an interruption after a game delivery commits leaves a durable retry without crediting or recreating the item twice", async () => {
    const first = await enter(), item = trophy("gold-ring");
    editPlayers([{ session: first.session, cargo: 50, lootItems: [item] }], []); await enter(first.session);
    throwAfterDelivery = true; const waiting = await act(first.session, { type: "extract" });
    expect(waiting.self.pendingDelivery).toHaveLength(1); expect(waiting.self.lootItems).toEqual([]); expect(delivered).toEqual([item]); expect(credited).toBe(50);
    restart(); const restored = await enter(first.session); expect(restored.state.self.pendingDelivery).toEqual([]);
    expect(delivered).toEqual([item]); expect(credited).toBe(50); expect(deliveries.size).toBe(1); expect(pending()).toBe(0);
  });

  test("a slow command body uses the current body after eviction and same-identity rejoin, withdrawing cargo once", async () => {
    const first = await enter(), item = trophy("gold-ring");
    editPlayers([{ session: first.session, cargo: 50, lootItems: [item] }], []); await enter(first.session);
    let release!: () => void;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "extract" }))); controller.close(); };
    } });
    const pendingReply = service.fetch(new Request(`${ORIGIN}/api/live/action`, { method: "POST", body: stream, headers: {
      origin: ORIGIN, "content-type": "application/json", cookie: first.session.cookie,
      "x-prapor-game": first.session.gameId, "x-prapor-live": first.session.id!,
    } }), "192.0.2.42");
    await Promise.resolve();
    time += 61_000; service.tick();
    const rejoined = await enter(first.session); expect(rejoined.state.self.id).toBe(first.session.id!);
    expect(rejoined.state.self.cargo).toBe(50); expect(rejoined.state.self.lootItems).toEqual([item]);
    release(); const reply = (await pendingReply)!; expect(reply.status).toBe(200);
    const result = await reply.json() as LiveSnapshot; expect(result.self.cargo).toBe(0); expect(result.self.lootItems).toEqual([]);
    const actual = await state(first.session); expect(actual.self.cargo).toBe(0); expect(actual.self.lootItems).toEqual([]);
    expect(credited).toBe(50); expect(delivered).toEqual([item]); expect(deliveries.size).toBe(1);
    await act(first.session, { type: "extract" }); expect(credited).toBe(50); expect(delivered).toEqual([item]); expect(deliveries.size).toBe(1);
    restart(); const restored = await enter(first.session); expect(restored.state.self.cargo).toBe(0); expect(restored.state.self.lootItems).toEqual([]);
  });

  test("more than 64 full warehouses' parcels rotate durably instead of starving a later player's delivery", async () => {
    const waiting = [await enter(), await enter(), await enter()], ready = await enter();
    waiting.forEach(player => blockedOwners.add(player.session.owner));
    restart(db => {
      for (const player of waiting) for (let index = 0; index < 32; index++) {
        const parcel: LiveDelivery = { id: randomUUID(), owner: player.session.owner, gameId: player.session.gameId, createdAt: time, money: 1, items: [] };
        db.query("INSERT INTO live_economy_outbox(id,identity,kind,payload,message) VALUES(?,?,'delivery',?,'Ожидает места')").run(parcel.id, player.session.owner, JSON.stringify(parcel));
      }
      const parcel: LiveDelivery = { id: randomUUID(), owner: ready.session.owner, gameId: ready.session.gameId, createdAt: time, money: 7, items: [] };
      db.query("INSERT INTO live_economy_outbox(id,identity,kind,payload,message) VALUES(?,?,'delivery',?,'Ожидает места')").run(parcel.id, ready.session.owner, JSON.stringify(parcel));
    });
    expect(pending()).toBe(97); expect(credited).toBe(0);
    time += 1000; service.tick(); expect(pending()).toBe(96); expect(credited).toBe(7);
    expect(deliveries.size).toBe(1); expect([...deliveries.values()][0]!.owner).toBe(ready.session.owner);
    restart(); expect(pending()).toBe(96); expect(credited).toBe(7);
    expect((await enter(waiting[0]!.session)).state.self.pendingDelivery).toHaveLength(32);
  });

  test("supply debit is prepared durably, applied from an exact receipt once, and cannot be repeated while pending", async () => {
    const first = await enter(); editPlayers([{ session: first.session, ammo: 50, medkits: 1 }], []); await enter(first.session);
    throwAfterSupply = true; const waiting = await act(first.session, { type: "resupply" });
    expect(waiting.self.ammo).toBe(50); expect(waiting.self.medkits).toBe(1); expect(stocks.get(first.session.owner)).toEqual({ ammo: 90, medkits: 9 }); expect(pending()).toBe(1);
    const duplicate = await call("action", { type: "resupply" }, first.session); expect(duplicate.status).toBe(409); expect(await duplicate.json()).toEqual({ code: "supply_pending" });
    restart(); const restored = await enter(first.session); expect(restored.state.self.ammo).toBe(60); expect(restored.state.self.medkits).toBe(2);
    expect(stocks.get(first.session.owner)).toEqual({ ammo: 90, medkits: 9 }); expect(supplyReceipts.size).toBe(1); expect(pending()).toBe(0);
    expect((await call("action", { type: "resupply" }, first.session)).status).toBe(409);
    await act(first.session, { type: "extract" }); expect(stocks.get(first.session.owner)).toEqual({ ammo: 90, medkits: 9 });
  });

  test("partial headquarters stocks yield exact visible supply counts and stock exhaustion never grants free rounds", async () => {
    const first = await enter(); editPlayers([{ session: first.session, ammo: 50, medkits: 0 }], []); await enter(first.session);
    stocks.set(first.session.owner, { ammo: 4, medkits: 1 }); const supplied = await act(first.session, { type: "resupply" });
    expect(supplied.self.ammo).toBe(54); expect(supplied.self.medkits).toBe(1); expect(stocks.get(first.session.owner)).toEqual({ ammo: 0, medkits: 0 });
    const empty = await act(first.session, { type: "resupply" }); expect(empty.self.ammo).toBe(54); expect(empty.self.medkits).toBe(1);
    expect(pending()).toBe(0); expect(supplyReceipts.size).toBe(2);
  });

  test("failed live acknowledgement stops the service and recovery retries a committed delivery instead of restoring cargo", async () => {
    const first = await enter(), item = trophy(); editPlayers([{ session: first.session, lootItems: [item] }], []); await enter(first.session);
    onDelivery = failAcknowledgement;
    expect((await call("action", { type: "extract" }, first.session)).status).toBe(503); expect(service.healthy()).toBe(false); expect(pending()).toBe(1);
    expect(delivered).toEqual([item]); onDelivery = undefined;
    restart(db => db.exec("DROP TRIGGER reject_economy_ack")); const recovered = await enter(first.session);
    expect(recovered.state.self.lootItems).toEqual([]); expect(recovered.state.self.pendingDelivery).toEqual([]); expect(delivered).toEqual([item]); expect(deliveries.size).toBe(1);
  });

  test("an uncommitted outbox withdrawal neither calls headquarters nor destroys persisted cargo", async () => {
    const first = await enter(), item = trophy("old-watch");
    editPlayers([{ session: first.session, cargo: 15, lootItems: [item] }], []); await enter(first.session);
    const db = new Database(dbPath);
    db.exec("CREATE TRIGGER reject_parcel_preparation BEFORE INSERT ON live_economy_outbox BEGIN SELECT RAISE(ABORT,'injected parcel preparation storage failure'); END"); db.close();
    expect((await call("action", { type: "extract" }, first.session)).status).toBe(503); expect(service.healthy()).toBe(false);
    expect(deliveries.size).toBe(0); expect(credited).toBe(0); expect(pending()).toBe(0);
    restart(db => db.exec("DROP TRIGGER reject_parcel_preparation")); const recovered = await enter(first.session);
    expect(recovered.state.self.lootItems).toEqual([item]); expect(recovered.state.self.cargo).toBe(15);
    await act(first.session, { type: "extract" }); expect(delivered).toEqual([item]); expect(credited).toBe(15);
  });

  test("failed live supply acknowledgement recovers exact debited rounds without losing or applying them twice", async () => {
    const first = await enter(); editPlayers([{ session: first.session, ammo: 50, medkits: 1 }], []); await enter(first.session);
    onSupply = failAcknowledgement;
    expect((await call("action", { type: "resupply" }, first.session)).status).toBe(503); expect(service.healthy()).toBe(false);
    expect(stocks.get(first.session.owner)).toEqual({ ammo: 90, medkits: 9 }); expect(pending()).toBe(1); onSupply = undefined;
    restart(db => db.exec("DROP TRIGGER reject_economy_ack")); const recovered = await enter(first.session);
    expect(recovered.state.self.ammo).toBe(60); expect(recovered.state.self.medkits).toBe(2); expect(stocks.get(first.session.owner)).toEqual({ ammo: 90, medkits: 9 });
    expect(supplyReceipts.size).toBe(1); expect(pending()).toBe(0); restart(); expect((await enter(first.session)).state.self.ammo).toBe(60);
  });
});
