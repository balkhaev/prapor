import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveService, type LiveService } from "../server/live";
import { createHealth, createMedicalInventory, healthPercent, isAlive, type HealthState } from "../src/game/health";
import type { LiveSnapshot } from "../src/game/live";

const ORIGIN = "https://game.delopusk.ru";
interface Session { cookie: string; id: string }
let folder: string, dbPath: string, service: LiveService, time: number;
const options = () => ({ dbPath, secureCookies: true, allowedOrigins: [ORIGIN], now: () => time, random: () => 0, automaticTicks: false });
async function call(path: string, session?: Session, body?: unknown): Promise<Response> {
  const method = ["state", "status"].includes(path) ? "GET" : "POST";
  return (await service.fetch(new Request(`${ORIGIN}/api/live/${path}`, { method, headers: {
    ...(session ? { cookie: session.cookie, "x-prapor-live": session.id } : {}),
    ...(method === "POST" ? { origin: ORIGIN, "content-type": "application/json" } : {}),
  }, ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) }), "192.0.2.18"))!;
}
async function enter(session?: Session): Promise<{ session: Session; state: LiveSnapshot }> {
  const reply = await call("join", session); expect(reply.status).toBe(200);
  const state = await reply.json() as LiveSnapshot;
  return { session: session ?? { id: state.selfId, cookie: reply.headers.get("set-cookie")!.split(";")[0]! }, state };
}
async function state(session: Session): Promise<LiveSnapshot> {
  const reply = await call("state", session); expect(reply.status).toBe(200); return reply.json() as Promise<LiveSnapshot>;
}
async function act(session: Session, command: unknown): Promise<LiveSnapshot> {
  const reply = await call("action", session, command); expect(reply.status).toBe(200); return reply.json() as Promise<LiveSnapshot>;
}
async function advance(ms: number, sessions: Session[] = []): Promise<void> {
  for (let step = 0; step < ms; step += 250) {
    time += Math.min(250, ms - step); service.tick();
    if (step % 1000 === 0) for (const session of sessions) await state(session);
  }
}
function editStorage(edit: (db: Database) => void): void {
  service.close(); const db = new Database(dbPath); edit(db); db.close(); service = createLiveService(options());
}
function setBody(session: Session, body: HealthState, medicine = createMedicalInventory(), x = 0): void {
  editStorage(db => {
    const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => JSON.parse(row.state).id === session.id)!;
    const player = JSON.parse(row.state);
    Object.assign(player, { x, y: 0, safeUntil: 0, body, medicine, health: isAlive(body) ? healthPercent(body) : 0, healthAt: time, nextAttack: 0 });
    db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(player), row.identity);
  });
}
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "prapor-health-")); dbPath = join(folder, "live.sqlite"); time = 1_800_000_000_000;
  service = createLiveService(options());
  editStorage(db => db.query("UPDATE live_world SET state=? WHERE id=1").run(JSON.stringify({ startedAt: time, events: [],
    scavs: [{ id: "scav-0", kind: "scav", name: "Косой", appearance: 0, x: 31, y: 23, health: 100, action: "idle", safeUntil: 0, respawnAt: 0, nextMove: time + 1_000_000, nextAttack: time + 1_000_000 }],
    drops: Array.from({ length: 10 }, (_, index) => ({ id: `drop-${index}`, x: 30, y: 20, amount: 10, expiresAt: time + 1_000_000 })),
  })));
});
afterEach(async () => { service.close(); await rm(folder, { recursive: true, force: true }); });

describe("authoritative live injuries", () => {
  test("validates exact medical and aimed commands; bodies and supplies are private", async () => {
    const owner = await enter(), observer = await enter();
    for (const command of [
      { type: "treat", medicine: "medkit", part: "neck" }, { type: "treat", medicine: "__proto__", part: "head" },
      { type: "treat", medicine: "bandage", part: "chest", endsAt: time }, { type: "treat", medicine: "splint", part: {} },
      { type: "cancelTreatment", medicine: "medkit" }, { type: "attack", targetId: observer.session.id, aimed: "true" },
    ]) expect((await call("action", owner.session, command)).status).toBe(400);
    expect((await call("action", owner.session, { type: "treat", medicine: "medkit", part: "head" })).status).toBe(409);
    const visible = (await state(observer.session)).entities.find(entity => entity.id === owner.session.id)!;
    expect(visible.health).toBe(100); expect("body" in visible).toBe(false); expect("medicine" in visible).toBe(false); expect("treatment" in visible).toBe(false);
    expect((await state(owner.session)).self.medicine).toEqual(createMedicalInventory()); expect(service.healthy()).toBe(true);
  });

  test("medicine effects and resources commit together only after an uninterrupted timer", async () => {
    const player = (await enter()).session, body = createHealth(); body.parts.chest.hp = 40;
    setBody(player, body); await enter(player);
    const started = await act(player, { type: "treat", medicine: "medkit", part: "chest" });
    expect(started.self.treatment?.endsAt).toBe(time + 5000); expect(started.self.medicine.medkit).toBe(120);
    await advance(4750, [player]); expect((await state(player)).self.body.parts.chest.hp).toBe(40);
    await act(player, { type: "move", x: 1, y: 0 }); await advance(250, [player]);
    expect((await state(player)).self.treatment).toBeNull(); expect((await state(player)).self.medicine.medkit).toBe(120);
    await act(player, { type: "heal" }); await act(player, { type: "cancelTreatment" });
    expect((await state(player)).self.treatment).toBeNull(); expect((await state(player)).self.medicine.medkit).toBe(120);
    await act(player, { type: "heal" }); await advance(5000, [player]);
    const treated = await state(player); expect(treated.self.body.parts.chest.hp).toBe(80); expect(treated.self.medicine.medkit).toBe(80); expect(treated.self.treatment).toBeNull();
    await advance(1000, [player]); expect((await state(player)).self.medicine.medkit).toBe(80);
  });

  test("blood loss runs on the server, tourniquets stabilize one zone, and surgery reduces its maximum", async () => {
    const player = (await enter()).session, body = createHealth(); body.parts.leftLeg.hp = 0; body.parts.leftLeg.bleeding = "heavy";
    setBody(player, body); await enter(player);
    expect((await call("action", player, { type: "treat", medicine: "bandage", part: "leftLeg" })).status).toBe(409);
    expect((await call("action", player, { type: "treat", medicine: "surgery", part: "leftLeg" })).status).toBe(409);
    await act(player, { type: "treat", medicine: "tourniquet", part: "leftLeg" }); await advance(4000, [player]);
    const stable = await state(player); expect(stable.self.body.parts.head.hp).toBe(34); expect(stable.self.body.parts.leftLeg.bleeding).toBe("none"); expect(stable.self.medicine.tourniquet).toBe(0);
    await act(player, { type: "treat", medicine: "surgery", part: "leftLeg" }); await advance(15000, [player]);
    const repaired = await state(player); expect(repaired.self.body.parts.leftLeg.hp).toBe(1); expect(repaired.self.body.parts.leftLeg.maxHp).toBe(42.25); expect(repaired.self.medicine.surgery).toBe(0);
    expect((await call("action", player, { type: "treat", medicine: "surgery", part: "leftLeg" })).status).toBe(409);
  });

  test("a delayed tick resolves treatment at its deadline before the remaining blood loss", async () => {
    const run = async (delayed: boolean, type: "tourniquet" | "painkiller") => {
      const player = (await enter()).session, body = createHealth();
      if (type === "tourniquet") { body.parts.head.hp = 1.5; body.parts.chest.bleeding = "heavy"; }
      else body.parts.leftLeg.fracture = true;
      setBody(player, body); await enter(player);
      const startedAt = time;
      await act(player, { type: "treat", medicine: type, part: type === "tourniquet" ? "chest" : "head" });
      if (delayed) { time += 10000; service.tick(); }
      else await advance(10000, [player]);
      const completed = await state(player);
      expect(completed.self.respawnAt).toBe(0); expect(completed.self.treatment).toBeNull();
      const result = { body: structuredClone(completed.self.body), medicine: completed.self.medicine };
      if (result.body.painUntil) result.body.painUntil -= startedAt;
      return result;
    };
    const split = await run(false, "tourniquet"), delayed = await run(true, "tourniquet");
    expect(delayed).toEqual(split); expect(delayed.body.parts.head.hp).toBe(.5); expect(delayed.medicine.tourniquet).toBe(0);
    const splitPain = await run(false, "painkiller"), delayedPain = await run(true, "painkiller");
    expect(delayedPain).toEqual(splitPain); expect(delayedPain.body.painUntil).toBe(93000);
  });

  test("shots report localized armour and injuries, interrupt surgery, and headshots require a cancellable windup", async () => {
    const attacker = (await enter()).session, target = (await enter()).session;
    setBody(attacker, createHealth(), createMedicalInventory(), 0);
    const injured = createHealth(); injured.parts.leftLeg.hp = 0;
    setBody(target, injured, createMedicalInventory(), 1); await enter(attacker); await enter(target);
    await act(target, { type: "treat", medicine: "surgery", part: "leftLeg" });
    const shot = await act(attacker, { type: "attack", targetId: target.id });
    const hurt = await state(target); expect(hurt.self.body.parts.head.hp).toBe(35); expect(hurt.self.body.parts.chest.hp).toBe(53); expect(hurt.self.treatment).toBeNull(); expect(hurt.self.medicine.surgery).toBe(1);
    expect(shot.events.some(event => event.text.includes("Грудь") && event.text.includes("броня остановила 8"))).toBe(true);
    await advance(1000, [attacker, target]);
    const aimed = await act(attacker, { type: "attack", targetId: target.id, aimed: true });
    expect(aimed.entities.find(entity => entity.id === attacker.id)?.aimTargetId).toBe(target.id); expect(aimed.self.ammo).toBe(59);
    await act(attacker, { type: "move", x: 0, y: 1 }); await advance(2000, [attacker, target]);
    expect((await state(attacker)).self.ammo).toBe(59); expect((await state(target)).self.body.parts.head.hp).toBeGreaterThan(34);
    await advance(2000, [attacker, target]); await act(attacker, { type: "attack", targetId: target.id, aimed: true }); await advance(2000, [attacker, target]);
    expect((await state(target)).self.body.parts.head.hp).toBe(0); expect((await state(target)).self.respawnAt).toBeGreaterThan(time);
  });

  test("combat leave takes five seconds and persisted blood loss can kill an offline body; respawn restores a separate kit", async () => {
    const player = (await enter()).session, body = createHealth(); body.parts.head.hp = 1.5; body.parts.chest.bleeding = "heavy";
    setBody(player, body); await enter(player);
    const leave = await call("leave", player); expect(leave.status).toBe(200); expect((await leave.json() as { leaveAt: number }).leaveAt).toBe(time + 5000);
    await advance(4750); expect((await state(player)).self.body.parts.head.hp).toBeGreaterThan(0);
    await advance(1250); expect((await call("state", player)).status).toBe(401);
    const dead = (await enter(player)).state; expect(dead.self.body.parts.head.hp).toBe(0); expect(dead.entities.find(entity => entity.id === player.id)?.action).toBe("downed");
    await advance(10000, [player]); const fresh = await act(player, { type: "respawn" });
    expect(fresh.self.body).toEqual(createHealth()); expect(fresh.self.medicine).toEqual(createMedicalInventory()); expect(fresh.self.ammo).toBe(60); expect(fresh.self.respawnAt).toBe(0);
  });

  test("a disconnected body remains visible for thirty seconds without accepting commands", async () => {
    const disconnected = (await enter()).session;
    await advance(15000);
    const viewer = await enter(); expect(viewer.state.server.online).toBe(1); expect(viewer.state.entities.some(entity => entity.id === disconnected.id)).toBe(true);
    expect((await call("action", disconnected, { type: "heal" })).status).toBe(401);
    await advance(30000, [viewer.session]); expect((await state(viewer.session)).entities.some(entity => entity.id === disconnected.id)).toBe(false);
    expect((await enter(disconnected)).state.selfId).toBe(disconnected.id);
  });

  test("legacy health and spent medicines survive restart without resetting wounds or granting a treatment", async () => {
    const player = (await enter()).session;
    editStorage(db => {
      const row = db.query<{ identity: string; state: string }, []>("SELECT identity,state FROM live_players").all().find(row => JSON.parse(row.state).id === player.id)!;
      const saved = JSON.parse(row.state); delete saved.body; delete saved.medicine; saved.health = 50; saved.medkits = 1;
      db.query("UPDATE live_players SET state=? WHERE identity=?").run(JSON.stringify(saved), row.identity);
    });
    const migrated = (await enter(player)).state; expect(migrated.self.body.parts.head.hp).toBe(17.5); expect(migrated.self.body.parts.chest.hp).toBe(42.5); expect(migrated.self.medicine.medkit).toBe(40);
    await act(player, { type: "treat", medicine: "medkit", part: "chest" });
    service.close(); service = createLiveService(options());
    const restored = (await enter(player)).state; expect(restored.self.treatment).toBeNull(); expect(restored.self.body).toEqual(migrated.self.body); expect(restored.self.medicine).toEqual(migrated.self.medicine);
  });
});
