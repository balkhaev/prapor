import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountService, getClientAddress, readAccountOptions, type AccountService } from "../server/accounts";
import { createHandler } from "../server/handler";
import { createGame, saveGame } from "../src/game/engine";
import { exportGameSave } from "../src/game-save";

const ORIGIN = "https://game.delopusk.ru";
const PASSWORD = "strong password 123";
let folder: string, dbPath: string, service: AccountService;
let time = 1_800_000_000_000;
const options = () => ({ dbPath, secureCookies: true, allowedOrigins: [ORIGIN, "https://game.balkhaev.com"], now: () => time });
function request(path: string, method = "GET", body?: unknown, cookie?: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method, headers: {
    ...(method !== "GET" ? { origin: ORIGIN, "content-type": "application/json" } : {}),
    ...(cookie ? { cookie } : {}), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(path: string, method = "GET", body?: unknown, cookie?: string, headers?: Record<string, string>): Promise<Response> {
  const result = await service.fetch(request(path, method, body, cookie, headers), "192.0.2.7");
  if (!result) throw new Error("Expected API response");
  return result;
}
async function register(username = "Scav_1"): Promise<{ cookie: string; recoveryCode: string; id: string }> {
  const result = await call("/api/auth/register", "POST", { username, password: PASSWORD });
  expect(result.status).toBe(201);
  const body = await result.json() as { user: { id: string }; recoveryCode: string };
  return { cookie: result.headers.get("set-cookie")!.split(";")[0]!, recoveryCode: body.recoveryCode, id: body.user.id };
}
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "prapor-account-test-"));
  dbPath = join(folder, "accounts.sqlite");
  time = 1_800_000_000_000;
  service = createAccountService(options());
});
afterEach(async () => { service.close(); await rm(folder, { recursive: true, force: true }); });

describe("account authentication security", () => {
  test("register and case-insensitive login use host-only secure cookies and hashed secrets", async () => {
    const registered = await register();
    const login = await call("/api/auth/login", "POST", { username: "sCAV_1", password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    expect(cookie).toContain("__Host-prapor_session=");
    for (const flag of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"]) expect(cookie).toContain(flag);
    expect(cookie).not.toContain("Domain=");
    expect(login.headers.get("cache-control")).toBe("no-store");
    expect(login.headers.get("access-control-allow-origin")).toBeNull();
    expect(await (await call("/api/auth/session", "GET", undefined, cookie.split(";")[0])).json()).toEqual({ user: { id: registered.id, username: "Scav_1" } });
    const db = new Database(dbPath, { readonly: true });
    const user = db.query<{ password_hash: string; recovery_hash: string }, []>("SELECT password_hash,recovery_hash FROM users").get()!;
    const sessions = db.query<{ token_hash: string }, []>("SELECT token_hash FROM sessions").all();
    expect(user.password_hash).toStartWith("$argon2id$");
    expect(user.password_hash).not.toContain(PASSWORD);
    expect(user.recovery_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(user.recovery_hash).not.toBe(registered.recoveryCode.replaceAll("-", ""));
    for (const session of sessions) expect(session.token_hash).toMatch(/^[a-f0-9]{64}$/);
    db.close();
    const taken = await call("/api/auth/register", "POST", { username: "scav_1", password: PASSWORD });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ code: "username_taken" });
    const incorrect = await call("/api/auth/login", "POST", { username: "Scav_1", password: "wrong password 12" });
    expect(incorrect.status).toBe(401);
    expect(await incorrect.json()).toEqual({ code: "invalid_credentials" });
  });

  test("writes reject foreign or missing origin, hostile host, cross-site fetch, non-JSON and oversized bodies", async () => {
    const credentials = { username: "Scav_1", password: PASSWORD };
    for (const origin of ["https://evil.example", "null", ""]) expect((await call("/api/auth/register", "POST", credentials, undefined, { origin })).status).toBe(403);
    expect((await call("/api/auth/register", "POST", credentials, undefined, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await call("/api/auth/register", "POST", credentials, undefined, { "content-type": "text/plain" })).status).toBe(415);
    const hostile = new Request("https://evil.example/api/auth/register", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(credentials) });
    expect((await service.fetch(hostile))!.status).toBe(403);
    const hostileSession = (await service.fetch(new Request("https://evil.example/api/auth/session")))!;
    expect(hostileSession.status).toBe(403);
    expect(hostileSession.headers.get("cache-control")).toBe("no-store");
    expect(hostileSession.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await call("/api/auth/register", "POST", { ...credentials, filler: "x".repeat(5000) })).status).toBe(413);
    expect((await call("/api/auth/register", "POST", credentials, undefined, { origin: "https://game.balkhaev.com" })).status).toBe(201);
  });

  test("invalid credentials and unsupported methods never create an account", async () => {
    for (const username of ["абв", "aa", "x".repeat(25), "a b", "<script>"]) expect((await call("/api/auth/register", "POST", { username, password: PASSWORD })).status).toBe(400);
    for (const password of ["12345678901", "x".repeat(129)]) expect((await call("/api/auth/register", "POST", { username: "Valid", password })).status).toBe(400);
    expect((await call("/api/auth/register", "GET")).status).toBe(405);
    expect((await call("/api/auth/session", "POST", {})).status).toBe(405);
    expect((await call("/api/auth/unknown")).status).toBe(404);
    expect((await call("/api")).status).toBe(404);
    expect(await (await call("/api/auth/session")).json()).toEqual({ user: null });
    expect((await call("/api/save")).status).toBe(401);
    expect((await createHandler(folder, service)(new Request(`${ORIGIN}/api/missing`, { headers: { accept: "text/html" } }))).headers.get("content-type")).toContain("application/json");
  });

  test("logout revokes the token, expiry fails closed, and recovery rotates code and revokes every session", async () => {
    const account = await register();
    const second = await call("/api/auth/login", "POST", { username: "scav_1", password: PASSWORD });
    const secondCookie = second.headers.get("set-cookie")!.split(";")[0]!;
    const recovery = await call("/api/auth/recover", "POST", { username: "scav_1", recoveryCode: account.recoveryCode, password: "new password 123" }, account.cookie);
    expect(recovery.status).toBe(200);
    const recovered = await recovery.json() as { recoveryCode: string; user?: unknown };
    expect(recovered.user).toBeUndefined();
    expect(recovered.recoveryCode).not.toBe(account.recoveryCode);
    for (const cookie of [account.cookie, secondCookie]) {
      expect(await (await call("/api/auth/session", "GET", undefined, cookie)).json()).toEqual({ user: null });
      expect((await call("/api/save", "GET", undefined, cookie)).status).toBe(401);
    }
    const reusedCode = await call("/api/auth/recover", "POST", { username: "scav_1", recoveryCode: account.recoveryCode, password: PASSWORD });
    expect(reusedCode.status).toBe(401);
    expect(await reusedCode.json()).toEqual({ code: "invalid_recovery" });
    expect((await call("/api/auth/login", "POST", { username: "scav_1", password: PASSWORD })).status).toBe(401);
    const login = await call("/api/auth/login", "POST", { username: "scav_1", password: "new password 123" });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect((await call("/api/auth/logout", "POST", {}, cookie)).headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await (await call("/api/auth/session", "GET", undefined, cookie)).json()).toEqual({ user: null });
    time += 15 * 60_000 + 1000;
    const fresh = await call("/api/auth/login", "POST", { username: "Scav_1", password: "new password 123" });
    time += 31 * 24 * 60 * 60_000;
    expect(await (await call("/api/auth/session", "GET", undefined, fresh.headers.get("set-cookie")!.split(";")[0])).json()).toEqual({ user: null });
  });

  test("username throttling applies across client IPs and resets after the window", async () => {
    for (let i = 0; i < 8; i++) expect((await service.fetch(request("/api/auth/login", "POST", { username: "Absent", password: PASSWORD }), `192.0.2.${i}`))!.status).toBe(401);
    const denied = (await service.fetch(request("/api/auth/login", "POST", { username: "ABSENT", password: PASSWORD }), "198.51.100.5"))!;
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
    time += 15 * 60_000 + 1000;
    expect((await call("/api/auth/login", "POST", { username: "Absent", password: PASSWORD })).status).toBe(401);
  });

  test("hashing work is bounded while independent auth requests run concurrently", async () => {
    service.close();
    service = createAccountService({ ...options(), maxHashingConcurrency: 1 });
    const replies = await Promise.all([1, 2, 3].map(index => call("/api/auth/register", "POST", { username: `Scav_${index}`, password: PASSWORD })));
    expect(replies.filter(reply => reply.status === 201).length).toBe(1);
    expect(replies.filter(reply => reply.status === 429).length).toBe(2);
  });

  test("IP throttling also bounds malformed auth attempts and resets after its window", async () => {
    for (let i = 0; i < 120; i++) expect((await call("/api/auth/login", "POST", { username: null, password: PASSWORD })).status).toBe(400);
    const denied = await call("/api/auth/login", "POST", { username: "FreshAccount", password: PASSWORD });
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ code: "rate_limited" });
    time += 15 * 60_000 + 1000;
    expect((await call("/api/auth/login", "POST", { username: "FreshAccount", password: PASSWORD })).status).toBe(401);
  });
});

describe("account save ownership and durability", () => {
  test("strict game validation, compare-and-swap and per-account isolation survive a restart", async () => {
    const first = await register("First"), second = await register("Second");
    expect(await (await call("/api/save", "GET", undefined, first.cookie)).json()).toEqual({ revision: 0, savedAt: null, save: null });
    const state = createGame(time), save = exportGameSave(state, { version: 1 });
    for (const invalid of ["{}", JSON.stringify({ ...state, schemaVersion: 100 }), save.replace(/"checksum":"[a-f0-9]+"/, '"checksum":"00000000"')]) {
      expect((await call("/api/save", "PUT", { revision: 0, save: invalid }, first.cookie)).status).toBe(400);
    }
    const writers = await Promise.all([save, saveGame(state)].map(save => call("/api/save", "PUT", { revision: 0, save }, first.cookie)));
    expect(writers.map(reply => reply.status).sort()).toEqual([200, 409]);
    const current = await (await call("/api/save", "GET", undefined, first.cookie)).json() as { revision: number; save: string; savedAt: number };
    expect(current).toEqual({ revision: 1, savedAt: time, save });
    const conflict = await call("/api/save", "PUT", { revision: 0, save: saveGame(state) }, first.cookie);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ code: "save_conflict", revision: 1 });
    expect(await (await call("/api/save", "GET", undefined, second.cookie)).json()).toEqual({ revision: 0, savedAt: null, save: null });
    service.close();
    service = createAccountService(options());
    expect(await (await call("/api/save", "GET", undefined, first.cookie)).json()).toEqual(current);
    expect(service.healthy()).toBe(true);
    service.close();
    expect(service.healthy()).toBe(false);
    expect((await call("/api/save", "GET", undefined, first.cookie)).status).toBe(503);
  });

  test("a password recovery while a save request is being read prevents that stale session from writing", async () => {
    const account = await register();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const pending = service.fetch(new Request(`${ORIGIN}/api/save`, { method: "PUT", headers: { origin: ORIGIN, "content-type": "application/json", cookie: account.cookie }, body }), "192.0.2.8");
    const recovered = await call("/api/auth/recover", "POST", { username: "Scav_1", recoveryCode: account.recoveryCode, password: "another password 123" });
    expect(recovered.status).toBe(200);
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ revision: 0, save: saveGame(createGame(time)) })));
    controller.close();
    expect((await pending)!.status).toBe(401);
    const db = new Database(dbPath, { readonly: true });
    expect(db.query<{ revision: number }, []>("SELECT revision FROM saves").get()!.revision).toBe(0);
    db.close();
  });
});

test("forwarded client IP requires a configured direct proxy and ignores injected leftmost hops", () => {
  const forwarded = new Request(`${ORIGIN}/`, { headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.20, 10.0.0.2" } });
  expect(getClientAddress(forwarded, "10.0.0.3")).toBe("10.0.0.3");
  expect(getClientAddress(forwarded, "10.0.0.3", ["10.0.0.3", "10.0.0.2"])).toBe("198.51.100.20");
  expect(getClientAddress(forwarded, "::ffff:10.0.0.3", ["10.0.0.3", "10.0.0.2"])).toBe("198.51.100.20");
  expect(getClientAddress(new Request(`${ORIGIN}/`, { headers: { "x-forwarded-for": "invalid" } }), "10.0.0.3", ["10.0.0.3"])).toBe("10.0.0.3");
  expect(readAccountOptions({ NODE_ENV: "production", DEVHUB_ORIGIN: "http://evil" }).allowedOrigins).toEqual([ORIGIN, "https://game.balkhaev.com"]);
});
