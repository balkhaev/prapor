import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveService, getLiveLootPool, type LiveService } from "../server/live";
import { LiveEconomyError, type EconomyLoot, type LiveDelivery, type LiveEconomy, type LiveSupplyReceipt, type LiveSupplyRequest } from "../server/live-economy";
import { LIVE_LOOT_CAPACITY, LIVE_LOOT_WEIGHT, type LiveCommand, type LiveSnapshot } from "../src/game/live";
import { getLiveMap, isLiveWalkable, LIVE_MAPS } from "../src/game/live-maps";
import { LOOT_MODELS } from "../src/game/loot";
import { createHealth, createMedicalInventory, type MedicalInventory } from "../src/game/health";
import { readLiveSnapshot } from "../src/live-client";
import { getBoss } from "../src/game/bosses";
import { getLiveBossArena } from "../src/game/live-boss-arenas";

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
function editPlayers(values: Array<{ session: Session; x?: number; y?: number; ammo?: number; medkits?: number; medicine?: Partial<MedicalInventory>; health?: number; cargo?: number; stash?: number; lootItems?: EconomyLoot[]; lastCombatAt?: number }>, drops?: EconomyLoot[][]): void {
  restart(db => {
    for (const value of values) {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => JSON.parse(row.state).id === value.session.id)!;
      const { session: _session, ...fields } = value;
      const player = { ...JSON.parse(row.state), ...getLiveMap("perimeter").extracts[0]!, safeUntil: 0, lastCombatAt: 0, ...fields };
      if (value.health !== undefined) { player.body = createHealth(value.health); if (value.health <= 0) player.body.parts.head.hp = 0; }
      if (value.medkits !== undefined) player.medicine = createMedicalInventory({ ...player.medicine, medkit: value.medkits * 40 });
      if (value.medicine) player.medicine = createMedicalInventory({ ...player.medicine, ...value.medicine });
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
    }
    const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!, world = JSON.parse(row.state);
    for (const scav of world.scavs) { scav.health = 0; scav.body = createHealth(); scav.body.parts.head.hp = 0; scav.respawnAt = time + 1_000_000; }
    if (drops) world.drops = drops.map(items => ({ id: randomUUID(), mapId: "perimeter", ...getLiveMap("perimeter").extracts[0]!, amount: 0, items, expiresAt: time + 1_000_000, source: "body" }));
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
  test("all ordinary trophy and junk models occur in authored pools, boss trophies require a defeat, and drops carry private source UUIDs", async () => {
    const models = new Set(LIVE_MAPS.flatMap(map => map.lootSpawns.flatMap(point => getLiveLootPool(map.id, point).map(entry => entry.model.id))));
    expect([...models].sort()).toEqual(LOOT_MODELS.filter(model => !model.bossId).map(model => model.id).sort());
    for (const model of LOOT_MODELS.filter(model => model.bossId)) expect(models.has(model.id)).toBe(false);
    expect(getLiveLootPool("perimeter", { x: 0, y: 0 }).every(entry => entry.model.minDepth === 1)).toBe(true);
    const contested = getLiveMap("perimeter").pois.find(poi => poi.danger === 3 && poi.districtId === "depot")!;
    expect(getLiveLootPool("perimeter", { x: contested.x + 10, y: contested.y + 10 }).some(entry => entry.model.id === "secure-drive")).toBe(true);
    expect(getLiveLootPool("perimeter", { x: contested.x + 10, y: contested.y + 10 }).filter(entry => entry.model.rarity === "legendary")).toHaveLength(2);
    const first = await enter();
    expect(first.state.self.gameId).toBe(first.session.gameId);
    expect(first.state.drops.every(drop => drop.amount === 0 && drop.items === undefined)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    const stored = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state) as { drops: Array<{ items?: EconomyLoot[] }> }; db.close();
    expect(stored.drops.every(drop => drop.items && drop.items.length >= 1 && drop.items.length <= 2)).toBe(true);
    const ids = stored.drops.flatMap(drop => drop.items!.map(item => item.id));
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
    expect(bound.state.entities.find(item => item.id === owner.id)!.health).toBeCloseTo(87);
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

  test.each(["perimeter-g1-legacy-fixture", "perimeter-g2-a827381f", "perimeter-g3-b38b4b0d"])("geometry %s expands exact and fallback container slots without rerolling contents, cargo or medical supplies", async geometryVersion => {
    const first = await enter(), second = await enter(), map = getLiveMap("perimeter");
    const [exact, fallback] = map.containers, inBag = trophy("coffee"), inExact = trophy("gold-ring"), inFallback = trophy("old-watch"), retiredItem = trophy("bandage-roll"), bodyItem = trophy("coffee"), pendingItem = trophy("local-map");
    const fallbackId = fallback!.id.replace(/-[a-z]+-(\d+)$/, "-retired-$1");
    const body = createHealth(73); body.parts.leftLeg.fracture = true; body.parts.rightArm.maxHp = 48; body.parts.rightArm.hp = 35;
    const medicine = createMedicalInventory({ medkit: 27, bandage: 1, tourniquet: 0, splint: 1, painkiller: 0, surgery: 0 });
    const parcel: LiveDelivery = { id: randomUUID(), owner: first.session.owner, gameId: first.session.gameId, createdAt: time - 5000, items: [pendingItem], money: 11 };
    let existingCycles: Array<{ id: string; containerId: string; amount: number; items?: EconomyLoot[]; expiresAt: number }> = [];
    blocked = true;
    restart(db => {
      const saved = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state);
      saved.geometryVersion = geometryVersion;
      if (geometryVersion.startsWith("perimeter-g2-")) saved.drops = saved.drops.filter((drop: { containerId?: string }) => /^poi-[0-3]-[0-3]-/.test(drop.containerId ?? ""));
      if (geometryVersion.startsWith("perimeter-g3-")) saved.drops = saved.drops.filter((drop: { containerId?: string }) => /^poi-[0-7]-[0-3]-/.test(drop.containerId ?? ""));
      saved.drops = saved.drops.filter((drop: { containerId?: string }) => ![exact!.id, fallback!.id].includes(drop.containerId ?? ""));
      // Old global supply positions must follow their logical anchors into the outer ring.
      for (const drop of saved.drops) if (drop.containerId) { drop.x = 117; drop.y = 115; }
      existingCycles = saved.drops.filter((drop: { containerId?: string }) => drop.containerId).map(({ id, containerId, amount, items, expiresAt }: typeof existingCycles[number]) => structuredClone({ id, containerId, amount, items, expiresAt }));
      saved.drops.push(
        { id: "old-searched-container", mapId: "perimeter", x: 0, y: 0, source: "supply", amount: 13, items: [inExact], containerId: exact!.id, containerKind: exact!.kind, expiresAt: time + 123_456 },
        { id: "old-unsearched-container", mapId: "perimeter", x: 1, y: 0, source: "supply", amount: 0, items: [inFallback], containerId: fallbackId, containerKind: "crate", expiresAt: Number.MAX_SAFE_INTEGER },
        { id: "retired-supply", mapId: "perimeter", x: 0, y: 0, source: "supply", amount: 17, items: [retiredItem], containerId: "retired-poi-crate-0", containerKind: "crate", expiresAt: time + 98_765 },
        { id: "old-body", mapId: "perimeter", x: map.obstacles[0]!.x, y: map.obstacles[0]!.y, source: "body", amount: 23, items: [bodyItem], expiresAt: time + 120_000 },
      );
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(saved));
      for (const row of db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all()) {
        const player = JSON.parse(row.state);
        Object.assign(player, { x: exact!.x, y: exact!.y, safeUntil: time + 120_000, healthAt: time, searchedDropIds: player.id === first.session.id ? ["old-searched-container"] : [] });
        if (player.id === first.session.id) Object.assign(player, { ammo: 17, cargo: 25, stash: 7, kills: 4, lootItems: [inBag], body, medicine, treatment: { type: "splint", part: "leftLeg", startedAt: time - 1000, endsAt: time + 3000 } });
        db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
      }
      db.query("INSERT INTO live_economy_outbox(id,identity,kind,payload,message) VALUES(?,?,'delivery',?,'Ожидает места')").run(parcel.id, first.session.owner, JSON.stringify(parcel));
    });
    const readDrops = () => {
      const db = new Database(dbPath, { readonly: true });
      const saved = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state) as { geometryVersion: string; drops: Array<{ id: string; x: number; y: number; amount: number; items?: EconomyLoot[]; source: string; expiresAt: number; containerId?: string; containerKind?: string }> }; db.close(); return saved;
    };
    const initial = readDrops();
    expect(initial.geometryVersion).toBe(map.version);
    if (geometryVersion.startsWith("perimeter-g3-")) {
      expect(existingCycles).toHaveLength(126);
      expect(initial.drops.filter(drop => /^poi-(?:8|9|10|11)-[0-3]-/.test(drop.containerId ?? ""))).toHaveLength(64);
    }
    const itemIds = initial.drops.flatMap(drop => drop.items?.map(item => item.id) ?? []);
    expect(new Set(itemIds).size).toBe(itemIds.length);
    for (const cycle of existingCycles) {
      const anchor = map.containers.find(anchor => anchor.id === cycle.containerId)!;
      expect(initial.drops.find(drop => drop.id === cycle.id)).toMatchObject({ ...cycle, x: anchor.x, y: anchor.y });
      expect(initial.drops.filter(drop => drop.containerId === cycle.containerId)).toHaveLength(1);
    }
    expect(initial.drops.find(drop => drop.id === "old-searched-container")).toMatchObject({ x: exact!.x, y: exact!.y, items: [inExact], amount: 13, containerId: exact!.id, containerKind: exact!.kind, expiresAt: time + 123_456 });
    expect(initial.drops.find(drop => drop.id === "old-unsearched-container")).toMatchObject({ x: fallback!.x, y: fallback!.y, items: [inFallback], amount: 0, containerId: fallback!.id, containerKind: fallback!.kind, expiresAt: Number.MAX_SAFE_INTEGER });
    expect(initial.drops.filter(drop => drop.containerId === exact!.id)).toHaveLength(1);
    expect(initial.drops.filter(drop => drop.containerId === fallback!.id)).toHaveLength(1);
    const retired = initial.drops.find(drop => drop.id === "retired-supply")!;
    expect(retired).toMatchObject({ source: "body", items: [retiredItem], amount: 17, expiresAt: time + 98_765 }); expect(retired.containerId).toBeUndefined(); expect(isLiveWalkable(map, retired)).toBe(true);
    const bodyDrop = initial.drops.find(drop => drop.id === "old-body")!;
    expect(bodyDrop).toMatchObject({ items: [bodyItem], amount: 23, expiresAt: time + 120_000 }); expect(isLiveWalkable(map, bodyDrop)).toBe(true);
    expect(pending()).toBe(1); expect(delivered).toEqual([]);
    const restored = (await enter(first.session)).state; await enter(second.session);
    expect(restored.self).toMatchObject({ ammo: 17, cargo: 25, stash: 7, kills: 4, lootItems: [inBag], body, medicine, treatment: null });
    expect(restored.self.pendingDelivery).toEqual([{ items: [pendingItem], money: 11, message: "Освободите место на складе убежища." }]);
    expect(restored.drops.find(drop => drop.id === "old-searched-container")).toMatchObject({ searched: true, items: [inExact], amount: 13 });
    const hidden = (await state(second.session)).drops.find(drop => drop.id === "old-searched-container")!;
    expect(hidden).toMatchObject({ searched: false, amount: 0 }); expect(hidden.items).toBeUndefined();
    const beforeRestart = readDrops().drops;
    restart(); expect(readDrops().drops).toEqual(beforeRestart);
    const again = (await enter(first.session)).state;
    expect(again.self.body).toEqual(body); expect(again.self.medicine).toEqual(medicine); expect(again.self.lootItems).toEqual([inBag]);
    expect(again.drops.find(drop => drop.id === "old-searched-container")?.items).toEqual([inExact]);
    const picked = await act(first.session, { type: "loot", id: "old-searched-container" }); expect(picked.self.lootItems).toEqual([inBag, inExact]); expect(picked.self.cargo).toBe(38);
    expect((await call("action", { type: "loot", id: "old-searched-container" }, first.session)).status).toBe(409);
    editPlayers([{ session: first.session }]); await enter(first.session);
    blocked = false; time += 1000; service.tick();
    await act(first.session, { type: "extract" });
    expect(delivered.map(item => item.id).sort()).toEqual([pendingItem.id, inBag.id, inExact.id].sort()); expect(credited).toBe(56); expect(deliveries.size).toBe(2); expect(pending()).toBe(0);
    restart(); await enter(first.session); await act(first.session, { type: "extract" });
    expect(delivered).toHaveLength(3); expect(credited).toBe(56); expect(deliveries.size).toBe(2);
  });

  test.each(["perimeter-g1-legacy-fixture", "perimeter-g2-a827381f", "perimeter-g3-b38b4b0d"])("geometry %s depleted container cooldowns merge by logical slot and survive two restarts before one private refill", async geometryVersion => {
    const first = await enter(), map = getLiveMap("perimeter"), anchor = map.containers[2]!, deadline = time + 30_000;
    const legacyId = anchor.id.replace(/-[a-z]+-(\d+)$/, "-retired-$1");
    restart(db => {
      const row = db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!, saved = JSON.parse(row.state);
      saved.geometryVersion = geometryVersion;
      if (geometryVersion.startsWith("perimeter-g2-")) saved.drops = saved.drops.filter((drop: { containerId?: string }) => /^poi-[0-3]-[0-3]-/.test(drop.containerId ?? ""));
      if (geometryVersion.startsWith("perimeter-g3-")) saved.drops = saved.drops.filter((drop: { containerId?: string }) => /^poi-[0-7]-[0-3]-/.test(drop.containerId ?? ""));
      saved.drops = saved.drops.filter((drop: { containerId?: string }) => drop.containerId !== anchor.id);
      saved.lootCooldowns = [[`container:${anchor.id}`, time + 1000], [`container:${legacyId}`, deadline], ["perimeter:0:0", deadline]];
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(saved));
      for (const row of db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all()) {
        const player = JSON.parse(row.state); Object.assign(player, { x: anchor.x, y: anchor.y, safeUntil: time + 120_000 });
        db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
      }
    });
    const readWorld = () => {
      const db = new Database(dbPath, { readonly: true });
      const saved = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state) as { drops: Array<{ id: string; containerId?: string; items?: EconomyLoot[] }>; lootCooldowns: Array<[string, number]> }; db.close(); return saved;
    };
    for (let retry = 0; retry < 2; retry++) {
      expect(readWorld().drops.some(drop => drop.containerId === anchor.id)).toBe(false);
      expect(readWorld().lootCooldowns).toContainEqual([`container:${anchor.id}`, deadline]);
      expect(readWorld().lootCooldowns).toContainEqual(["perimeter:0:0", deadline]); restart();
    }
    time = deadline - 1; await enter(first.session); service.tick(); expect(readWorld().drops.some(drop => drop.containerId === anchor.id)).toBe(false);
    time = deadline + 249; await enter(first.session); service.tick();
    const refill = readWorld().drops.filter(drop => drop.containerId === anchor.id); expect(refill).toHaveLength(1); expect(refill[0]!.items?.length).toBeGreaterThan(0);
    const hidden = (await state(first.session)).drops.find(drop => drop.id === refill[0]!.id)!;
    expect(hidden).toMatchObject({ searched: false, amount: 0 }); expect(hidden.items).toBeUndefined();
    expect((await call("action", { type: "loot", id: hidden.id }, first.session)).status).toBe(409);
    restart(); await enter(first.session);
    expect(readWorld().drops.filter(drop => drop.containerId === anchor.id)).toEqual(refill);
  });

  test("a crowded city projects a bounded loot window without leaking unsearched contents or discarding overflow cargo", async () => {
    const first = await enter(), map = getLiveMap("perimeter"), anchor = map.containers.find(anchor => /^poi-(?:8|9|10|11)-/.test(anchor.id))!;
    expect(anchor).toBeDefined();
    const secret = trophy("secure-drive"), corpses = Array.from({ length: 520 }, (_, index) => ({ id: `city-body-${index.toString().padStart(4, "0")}`, mapId: "perimeter", x: anchor.x, y: anchor.y, source: "body", amount: 0, items: [trophy(index % 2 ? "coffee" : "gold-ring")], expiresAt: time + 120_000 }));
    editPlayers([{ session: first.session, x: anchor.x, y: anchor.y }]);
    restart(db => {
      const saved = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state);
      const supply = saved.drops.find((drop: { containerId?: string }) => drop.containerId === anchor.id);
      supply.items = [secret]; supply.amount = 77;
      saved.drops.push(...corpses);
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(saved));
    });
    const stored = (): Array<{ id: string; containerId?: string; items?: EconomyLoot[] }> => {
      const db = new Database(dbPath, { readonly: true });
      const rows = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state).drops; db.close(); return rows;
    };
    const crowded = (await enter(first.session)).state;
    expect(crowded.drops.length).toBeLessThanOrEqual(512); expect(crowded.drops.length).toBeGreaterThan(0);
    expect(readLiveSnapshot(crowded)).toEqual(crowded);
    expect(JSON.stringify(crowded).includes(secret.id)).toBe(false);
    const visibleSupply = crowded.drops.find(drop => drop.containerId === anchor.id);
    if (visibleSupply) { expect(visibleSupply).toMatchObject({ searched: false, amount: 0 }); expect(visibleSupply.items).toBeUndefined(); }
    expect(stored().filter(drop => drop.id.startsWith("city-body-"))).toHaveLength(520);
    const allIds = stored().flatMap(drop => drop.items?.map(item => item.id) ?? []); expect(new Set(allIds).size).toBe(allIds.length);
    const picked = crowded.drops.find(drop => drop.id.startsWith("city-body-"))!;
    expect(picked).toBeDefined();
    const response = await act(first.session, { type: "loot", id: picked.id });
    expect(response.self.lootItems).toEqual(picked.items); expect(response.drops.some(drop => drop.id === picked.id)).toBe(false);
    expect(response.drops.some(drop => drop.id.startsWith("city-body-") && !crowded.drops.some(old => old.id === drop.id))).toBe(true);
    expect((await call("action", { type: "loot", id: picked.id }, first.session)).status).toBe(409);
    const remaining = stored().filter(drop => drop.id.startsWith("city-body-")); expect(remaining).toHaveLength(519);
    for (let retry = 0; retry < 2; retry++) {
      restart(); const restored = (await enter(first.session)).state;
      expect(readLiveSnapshot(restored)).toEqual(restored); expect(restored.self.lootItems).toEqual(picked.items);
      expect(stored().filter(drop => drop.id.startsWith("city-body-"))).toEqual(remaining);
      expect(JSON.stringify(restored).includes(secret.id)).toBe(false);
    }
  });

  test("G3 boss bodies relocate without healing, restarting a defeated cycle or duplicating its trophy and headquarters receipt", async () => {
    const first = await enter(), map = getLiveMap("perimeter"), woundedBody = createHealth(64), deadBody = createHealth();
    woundedBody.parts.leftLeg.fracture = true; woundedBody.parts.rightArm.maxHp = 48; woundedBody.parts.rightArm.hp = 31; deadBody.parts.head.hp = 0;
    const trophyItem = trophy(getBoss("komendant")!.trophyModelId), waitingItem = trophy(getBoss("lesnik")!.trophyModelId), deadline = time + 90_000, corpseExpiry = time + 120_000;
    const parcel: LiveDelivery = { id: randomUUID(), owner: first.session.owner, gameId: first.session.gameId, createdAt: time - 5000, items: [waitingItem], money: 5 };
    const medicine = createMedicalInventory({ medkit: 27, bandage: 0, tourniquet: 0, splint: 1, painkiller: 0, surgery: 0 });
    blocked = true;
    restart(db => {
      const saved = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state);
      saved.geometryVersion = "perimeter-g3-b38b4b0d";
      saved.drops = saved.drops.filter((drop: { containerId?: string }) => /^poi-[0-7]-[0-3]-/.test(drop.containerId ?? ""));
      saved.drops.push({ id: "g3-boss-corpse", bossId: "komendant", source: "body", mapId: "perimeter", x: 0, y: 0, amount: 350, items: [trophyItem], expiresAt: corpseExpiry });
      db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify(saved));
      for (const row of db.query<{ boss_id: string; state: string }, []>("SELECT boss_id,state FROM live_bosses").all()) {
        const boss = JSON.parse(row.state); Object.assign(boss, { x: 0, y: 0, home: { x: 0, y: 0 }, route: [{ x: 0, y: 0 }], nextMove: time + 1_000_000, nextAttack: time + 1_000_000, healthAt: time });
        if (row.boss_id === "lesnik") Object.assign(boss, { body: woundedBody, health: 64, bossCycle: 7, bossDeathSettled: false, respawnAt: 0 });
        if (row.boss_id === "komendant") Object.assign(boss, { body: deadBody, health: 0, bossCycle: 9, bossDeathSettled: true, respawnAt: deadline });
        db.query("UPDATE live_bosses SET state=? WHERE boss_id=?").run(JSON.stringify(boss), row.boss_id);
      }
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").get()!, player = JSON.parse(row.state);
      Object.assign(player, { x: 0, y: 0, ammo: 17, medicine, cargo: 0, stash: 0, kills: 4, bossKills: 1, lastCombatAt: 0, safeUntil: time + 120_000 });
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
      db.query("INSERT INTO live_boss_kill_credits(boss_id,cycle,identity,player_id,created_at) VALUES(?,?,?,?,?)").run("komendant", 9, first.session.owner, first.session.id!, time - 5000);
      db.query("INSERT INTO live_economy_outbox(id,identity,kind,payload,message) VALUES(?,?,'delivery',?,'Ожидает места')").run(parcel.id, first.session.owner, JSON.stringify(parcel));
    });
    const durable = () => {
      const db = new Database(dbPath, { readonly: true });
      const bosses = db.query<{ boss_id: string; state: string }, []>("SELECT boss_id,state FROM live_bosses").all().map(row => ({ id: row.boss_id, state: JSON.parse(row.state) }));
      const world = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state), credits = db.query<{ count: number }, []>("SELECT count(*) AS count FROM live_boss_kill_credits WHERE boss_id='komendant' AND cycle=9").get()!.count;
      db.close(); return { bosses, world, credits };
    };
    for (let retry = 0; retry < 3; retry++) {
      if (retry) restart(); const restored = (await enter(first.session)).state, saved = durable();
      const wounded = saved.bosses.find(boss => boss.id === "lesnik")!.state, defeated = saved.bosses.find(boss => boss.id === "komendant")!.state;
      const arena = getLiveBossArena(map, "lesnik");
      expect(wounded).toMatchObject({ body: woundedBody, bossCycle: 7, bossDeathSettled: false, respawnAt: 0 });
      expect(wounded.x >= arena.area.x && wounded.y >= arena.area.y && wounded.x < arena.area.x + arena.area.width && wounded.y < arena.area.y + arena.area.height).toBe(true);
      expect(isLiveWalkable(map, wounded)).toBe(true); expect(wounded.health).toBeGreaterThan(0); expect(wounded.health).toBeLessThan(100);
      expect(defeated).toMatchObject({ body: deadBody, health: 0, bossCycle: 9, bossDeathSettled: true, respawnAt: deadline });
      expect(saved.world.drops.filter((drop: { bossId?: string }) => drop.bossId === "komendant")).toEqual([{ id: "g3-boss-corpse", bossId: "komendant", source: "body", mapId: "perimeter", x: 0, y: 0, amount: 350, items: [trophyItem], expiresAt: corpseExpiry }]);
      expect(saved.credits).toBe(1); expect(restored.self).toMatchObject({ ammo: 17, medicine, kills: 4, bossKills: 1 });
      expect(pending()).toBe(1); expect(delivered).toEqual([]);
    }
    time = deadline - 1; await enter(first.session); service.tick(); expect(durable().bosses.find(boss => boss.id === "komendant")!.state).toMatchObject({ health: 0, bossCycle: 9, respawnAt: deadline });
    time = deadline + 249; await enter(first.session); service.tick(); expect(durable().bosses.find(boss => boss.id === "komendant")!.state).toMatchObject({ health: 100, bossCycle: 10, bossDeathSettled: false });
    expect(durable().credits).toBe(1); expect(durable().world.drops.filter((drop: { bossId?: string }) => drop.bossId === "komendant")).toHaveLength(1);
    const picked = await act(first.session, { type: "loot", id: "g3-boss-corpse" }); expect(picked.self.lootItems).toEqual([trophyItem]); expect(picked.self.cargo).toBe(350);
    expect((await call("action", { type: "loot", id: "g3-boss-corpse" }, first.session)).status).toBe(409);
    editPlayers([{ session: first.session }]); await enter(first.session); blocked = false; time += 1000; service.tick(); await act(first.session, { type: "extract" });
    expect(delivered.map(item => item.id).sort()).toEqual([waitingItem.id, trophyItem.id].sort()); expect(credited).toBe(355); expect(deliveries.size).toBe(2); expect(pending()).toBe(0);
    restart(); const again = (await enter(first.session)).state; await act(first.session, { type: "extract" });
    expect(again.self.bossKills).toBe(1); expect(durable().credits).toBe(1); expect(deliveries.size).toBe(2); expect(delivered).toHaveLength(2); expect(credited).toBe(355);
    expect(durable().world.drops.some((drop: { id: string }) => drop.id === "g3-boss-corpse")).toBe(false);
  });

  test("one shared named drop has one winner, weight and item count are hard limits, and trophy price is not a cash capacity", async () => {
    const first = await enter(), second = await enter(), expensive = trophy("secure-drive");
    editPlayers([{ session: first.session, cargo: 499 }, { session: second.session, x: 7 }], [[expensive]]);
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
    editPlayers([{ session: first.session, x: 5, y: 6 }, { session: second.session, x: 6, y: 6, ammo: 17, medkits: 1, cargo: 40, lootItems: carried }], []);
    await enter(first.session); await enter(second.session);
    for (let hit = 0; hit < 3; hit++) { time += 1000; await act(first.session, { type: "attack", targetId: second.session.id! }); }
    const dead = await state(second.session), body = dead.drops.find(drop => drop.items?.some(item => item.id === carried[0]!.id))!;
    expect(dead.self.lootItems).toEqual([]); expect(dead.self.cargo).toBe(0); expect(body.items).toEqual(carried); expect(body.amount).toBe(40);
    const recovered = await act(first.session, { type: "loot", id: body.id }); expect(recovered.self.lootItems).toEqual(carried); expect(recovered.self.cargo).toBe(40);
    expect((await call("action", { type: "loot", id: body.id }, first.session)).status).toBe(409);
    time += 10_000; const respawned = await act(second.session, { type: "respawn" });
    expect(respawned.self.lootItems).toEqual([]); expect(respawned.self.ammo).toBe(17); expect(respawned.self.medkits).toBe(1);
    await act(first.session, { type: "extract" }); expect(delivered).toEqual(carried); expect(credited).toBe(40);
    expect((await state(second.session)).self.lootItems).toEqual([]);
  });

  test("extract and resupply cannot erase a body during combat, and obsolete travel cannot teleport into a district", async () => {
    const first = await enter(), second = await enter(), item = trophy();
    editPlayers([{ session: first.session, x: 5, y: 6, ammo: 40, lootItems: [item] }, { session: second.session, x: 6, y: 6 }], []);
    await enter(first.session); await enter(second.session); await act(first.session, { type: "attack", targetId: second.session.id! });
    for (const command of [{ type: "extract" }, { type: "resupply" }]) {
      const reply = await call("action", command, first.session); expect(reply.status).toBe(409); expect(await reply.json()).toEqual({ code: "in_combat" });
    }
    expect((await state(first.session)).self.lootItems).toEqual([item]); expect(pending()).toBe(0); expect(deliveries.size).toBe(0);
    expect((await call("action", { type: "travel", mapId: "depot" }, first.session)).status).toBe(400);
    time += 8001; const extracted = await act(first.session, { type: "extract" });
    expect(extracted.world.id).toBe("perimeter"); expect(extracted.self.lootItems).toEqual([]); expect(delivered).toEqual([item]); expect(extracted.self.ammo).toBe(39);
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

  test("startup delivery acknowledgement atomically persists a bleeding offline owner's remaining physical death drop", async () => {
    const first = await enter(), parcelItem = trophy("gold-ring"), remainingItem = trophy("coffee");
    editPlayers([{ session: first.session, cargo: 50, lootItems: [parcelItem] }], []); await enter(first.session);
    blocked = true; await act(first.session, { type: "extract" }); expect(pending()).toBe(1); expect(delivered).toEqual([]);
    restart(db => {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => JSON.parse(row.state).id === first.session.id)!;
      const player = JSON.parse(row.state);
      player.body = createHealth(); player.body.parts.head.hp = 1.5; player.body.parts.chest.bleeding = "heavy";
      player.healthAt = time; player.cargo = 25; player.lootItems = [remainingItem];
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
      blocked = false; time += 10_000;
    });
    // Inspect durable state before any tick, rejoin or close can incidentally save the new drop.
    const db = new Database(dbPath, { readonly: true });
    try {
      const world = JSON.parse(db.query<{ state: string }, []>("SELECT state FROM live_world WHERE id=1").get()!.state) as { drops: Array<{ amount: number; items?: EconomyLoot[] }> };
      const corpse = world.drops.filter(drop => drop.items?.some(item => item.id === remainingItem.id));
      expect(corpse).toHaveLength(1); expect(corpse[0]).toMatchObject({ amount: 25, items: [remainingItem] });
      const saved = db.query<{ state: string }, []>("SELECT state FROM live_players").all().map(row => JSON.parse(row.state)).find(player => player.id === first.session.id)!;
      expect(saved.cargo).toBe(0); expect(saved.lootItems).toEqual([]); expect(saved.body.parts.head.hp).toBe(0);
    } finally { db.close(); }
    expect(delivered).toEqual([parcelItem]); expect(credited).toBe(50); expect(pending()).toBe(0); expect(deliveries.size).toBe(1);
    restart(); const restored = (await enter(first.session)).state;
    expect(restored.self.lootItems).toEqual([]); expect(restored.drops.filter(drop => drop.items?.some(item => item.id === remainingItem.id))).toHaveLength(1);
    expect(delivered).toEqual([parcelItem]); expect(credited).toBe(50);
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

  test("spent splints require a paid medical bundle even with a full medkit, and a lost acknowledgement refills only once", async () => {
    const first = await enter();
    expect(first.state.self.medicine).toEqual({ medkit: 80, bandage: 2, tourniquet: 1, splint: 1, painkiller: 1, surgery: 1 });
    editPlayers([{ session: first.session }], []);
    restart(db => {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => JSON.parse(row.state).id === first.session.id)!;
      const player = JSON.parse(row.state); player.body.parts.leftLeg.fracture = true;
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
    });
    await enter(first.session);
    const treating = await act(first.session, { type: "treat", medicine: "splint", part: "leftLeg" });
    expect(treating.self.medicine.splint).toBe(1);
    time = treating.self.treatment!.endsAt; service.tick();
    const treated = await state(first.session);
    expect(treated.self.body.parts.leftLeg.fracture).toBe(false);
    expect(treated.self.medicine.splint).toBe(0); expect(treated.self.medicine.medkit).toBe(80);
    const extracted = await act(first.session, { type: "extract" });
    expect(extracted.self.medicine).toEqual(treated.self.medicine);
    expect(stocks.get(first.session.owner)).toEqual({ ammo: 100, medkits: 10 });
    throwAfterSupply = true;
    const waiting = await act(first.session, { type: "resupply" });
    expect(waiting.self.medicine.splint).toBe(0); expect(waiting.self.medicine.medkit).toBe(80);
    expect([...supplyRequests.values()][0]).toMatchObject({ ammo: 0, medkits: 1 });
    expect(stocks.get(first.session.owner)).toEqual({ ammo: 100, medkits: 9 }); expect(pending()).toBe(1);
    restart(); const restored = await enter(first.session);
    expect(restored.state.self.medicine).toEqual(first.state.self.medicine);
    expect(stocks.get(first.session.owner)).toEqual({ ammo: 100, medkits: 9 }); expect(pending()).toBe(0);
    restart(); expect((await enter(first.session)).state.self.medicine).toEqual(first.state.self.medicine);
    expect(supplyReceipts.size).toBe(1);
    expect((await call("action", { type: "resupply" }, first.session)).status).toBe(409);
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
