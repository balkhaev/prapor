import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountService, getClientAddress, readAccountOptions, type AccountService } from "../server/accounts";
import { createHandler } from "../server/handler";
import { createGame, saveGame } from "../src/game/engine";
import type { AccountMail } from "../server/mail";

const ORIGIN = "https://game.delopusk.ru";
const PASSWORD = "strong password 123";
let folder: string, dbPath: string, service: AccountService;
const accountIds = new Map<string, string>();
let time = 1_800_000_000_000;
const options = () => ({ dbPath, secureCookies: true, allowedOrigins: [ORIGIN, "https://game.balkhaev.com"], now: () => time });
function request(path: string, method = "GET", body?: unknown, cookie?: string, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method, headers: {
    ...(method !== "GET" ? { origin: ORIGIN, "content-type": "application/json" } : {}),
    ...(["/api/save", "/api/auth/email", "/api/auth/email/resend"].includes(path) && cookie && accountIds.has(cookie) ? { "x-prapor-account": accountIds.get(cookie)! } : {}),
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
  const cookie = result.headers.get("set-cookie")!.split(";")[0]!;
  accountIds.set(cookie, body.user.id);
  return { cookie, recoveryCode: body.recoveryCode, id: body.user.id };
}
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "prapor-account-test-"));
  dbPath = join(folder, "accounts.sqlite");
  time = 1_800_000_000_000;
  accountIds.clear();
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
    expect(await (await call("/api/auth/session", "GET", undefined, cookie.split(";")[0])).json()).toEqual({ user: { id: registered.id, username: "Scav_1", email: null, emailVerified: false, pendingEmail: null }, emailEnabled: false });
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
    expect(await (await call("/api/auth/session")).json()).toEqual({ user: null, emailEnabled: false });
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
      expect(await (await call("/api/auth/session", "GET", undefined, cookie)).json()).toEqual({ user: null, emailEnabled: false });
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
    expect(await (await call("/api/auth/session", "GET", undefined, cookie)).json()).toEqual({ user: null, emailEnabled: false });
    time += 15 * 60_000 + 1000;
    const fresh = await call("/api/auth/login", "POST", { username: "Scav_1", password: "new password 123" });
    time += 31 * 24 * 60 * 60_000;
    expect(await (await call("/api/auth/session", "GET", undefined, fresh.headers.get("set-cookie")!.split(";")[0])).json()).toEqual({ user: null, emailEnabled: false });
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

describe("read-only legacy save archives", () => {
  test("an old account request cannot access the account selected by a changed cookie", async () => {
    const first = await register("First"), second = await register("Second");
    const save = saveGame(createGame(time));
    expect((await call("/api/save", "PUT", { revision: 0, save }, second.cookie)).status).toBe(410);
    for (const expectedId of [first.id, ""]) {
      const get = await call("/api/save", "GET", undefined, second.cookie, { "x-prapor-account": expectedId });
      expect(get.status).toBe(401);
      expect(await get.json()).toEqual({ code: "account_changed" });
      const put = await call("/api/save", "PUT", { revision: 1, save }, second.cookie, { "x-prapor-account": expectedId });
      expect(put.status).toBe(401);
      expect(await put.json()).toEqual({ code: "account_changed" });
    }
    expect(await (await call("/api/save", "GET", undefined, second.cookie)).json()).toEqual({ revision: 0, savedAt: null, save: null });
    expect(await (await call("/api/save", "GET", undefined, first.cookie)).json()).toEqual({ revision: 0, savedAt: null, save: null });
  });

  test("forged and arbitrary snapshots are rejected without altering archived saves, including after restart", async () => {
    const first = await register("First"), second = await register("Second");
    expect(await (await call("/api/save", "GET", undefined, first.cookie)).json()).toEqual({ revision: 0, savedAt: null, save: null });
    const save = saveGame(createGame(time));
    const db = new Database(dbPath);
    db.query("UPDATE saves SET revision=7,saved_at=?,save=? WHERE user_id=?").run(time, save, first.id); db.close();
    const current = { revision: 7, savedAt: time, save };
    for (const forged of [save, "{}", JSON.stringify({ credits: 1_000_000_000, lastTick: time + 1_000_000_000 }), "arbitrary data"]) {
      const denied = await call("/api/save", "PUT", { revision: 7, save: forged }, first.cookie);
      expect(denied.status).toBe(410); expect(await denied.json()).toEqual({ code: "server_authoritative" });
    }
    expect(await (await call("/api/save", "GET", undefined, first.cookie)).json()).toEqual(current);
    expect(await (await call("/api/save", "GET", undefined, second.cookie)).json()).toEqual({ revision: 0, savedAt: null, save: null });
    service.close();
    service = createAccountService(options());
    expect(await (await call("/api/save", "GET", undefined, first.cookie)).json()).toEqual(current);
    expect(service.healthy()).toBe(true);
    service.close();
    expect(service.healthy()).toBe(false);
    expect((await call("/api/save", "GET", undefined, first.cookie)).status).toBe(503);
  });

  test("legacy uploads are rejected before reading a streaming body and never change archive revisions", async () => {
    const account = await register();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const pending = service.fetch(new Request(`${ORIGIN}/api/save`, { method: "PUT", headers: { origin: ORIGIN, "content-type": "application/json", cookie: account.cookie, "x-prapor-account": account.id }, body }), "192.0.2.8");
    expect((await pending)!.status).toBe(410);
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ revision: 0, save: saveGame(createGame(time)) })));
    controller.close();
    const db = new Database(dbPath, { readonly: true });
    expect(db.query<{ revision: number }, []>("SELECT revision FROM saves").get()!.revision).toBe(0);
    db.close();
  });
});

describe("optional account email and password mail", () => {
  let mails: AccountMail[];
  const tokenOf = (message: AccountMail): string => new URL(message.url).hash.split("=")[1]!;
  const enableMail = (sender?: (message: AccountMail) => Promise<void>) => {
    service.close(); mails = [];
    service = createAccountService({ ...options(), sendMail: sender ?? (async message => { mails.push(message); }) });
  };
  const registerEmail = async (email: string, username = "MailScav") => {
    const result = await call("/api/auth/register", "POST", { username, password: PASSWORD, email });
    expect(result.status).toBe(201);
    const body = await result.json() as { user: { id: string; email: string; pendingEmail: string | null; emailVerified: boolean }; recoveryCode: string; emailDelivery: string };
    const cookie = result.headers.get("set-cookie")!.split(";")[0]!;
    accountIds.set(cookie, body.user.id);
    return { ...body, cookie };
  };

  test("registration normalizes email and stores only token hashes; explicit verification is one use and never logs in", async () => {
    enableMail();
    const account = await registerEmail("Mail.User+game@Example.COM");
    expect(account.user).toMatchObject({ email: "mail.user+game@example.com", pendingEmail: "mail.user+game@example.com", emailVerified: false });
    expect(account.emailDelivery).toBe("sent");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe("mail.user+game@example.com");
    expect(mails[0]!.url).toStartWith("https://game.balkhaev.com/#account-verify=");
    const token = tokenOf(mails[0]!);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const db = new Database(dbPath, { readonly: true });
    const ticket = db.query<{ token_hash: string; purpose: string }, []>("SELECT token_hash,purpose FROM email_tickets").get()!;
    expect(ticket.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(ticket)).not.toContain(token);
    db.close();
    expect((await call("/api/auth/email/verify", "GET")).status).toBe(405);
    expect((await call("/api/auth/password/reset", "POST", { token, password: "new long password" })).status).toBe(400);
    const verified = await call("/api/auth/email/verify", "POST", { token });
    expect(verified.status).toBe(200);
    expect(verified.headers.get("set-cookie")).toBeNull();
    expect(await verified.json()).toMatchObject({ ok: true, user: { id: account.user.id, email: "mail.user+game@example.com", emailVerified: true, pendingEmail: null } });
    expect((await call("/api/auth/email/verify", "POST", { token })).status).toBe(400);
    expect(await (await call("/api/auth/session")).json()).toEqual({ user: null, emailEnabled: true });
    expect(await (await call("/api/auth/session", "GET", undefined, account.cookie)).json()).toMatchObject({ emailEnabled: true, user: { emailVerified: true } });
  });

  test("forgot responses are identical and prompt even while real delivery is unresolved; reset is atomic and revokes credentials", async () => {
    enableMail();
    const account = await registerEmail("owner@example.com");
    await call("/api/auth/email/verify", "POST", { token: tokenOf(mails[0]!) });
    time += 61_000;
    let finish!: () => void;
    service.close();
    service = createAccountService({ ...options(), sendMail: async message => { mails.push(message); await new Promise<void>(resolve => { finish = resolve; }); } });
    const absent = await call("/api/auth/password/forgot", "POST", { email: "absent@example.com" });
    const known = await Promise.race([call("/api/auth/password/forgot", "POST", { email: "OWNER@example.com" }), new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Forgot waited for transport")), 100))]);
    expect(known.status).toBe(absent.status);
    expect(await known.json()).toEqual(await absent.json());
    expect(mails).toHaveLength(2);
    expect(mails[1]!.purpose).toBe("reset");
    finish(); await Promise.resolve();
    const token = tokenOf(mails[1]!);
    const replies = await Promise.all([1, 2].map(() => call("/api/auth/password/reset", "POST", { token, password: "new account password 123" })));
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 400]);
    const changed = await replies.find(reply => reply.status === 200)!.json() as { recoveryCode: string };
    expect(changed.recoveryCode).not.toBe(account.recoveryCode);
    expect(await (await call("/api/auth/session", "GET", undefined, account.cookie)).json()).toEqual({ user: null, emailEnabled: true });
    expect((await call("/api/auth/recover", "POST", { username: "MailScav", recoveryCode: account.recoveryCode, password: PASSWORD })).status).toBe(401);
    expect((await call("/api/auth/login", "POST", { username: "MailScav", password: PASSWORD })).status).toBe(401);
    expect((await call("/api/auth/login", "POST", { username: "MailScav", password: "new account password 123" })).status).toBe(200);
    expect((await call("/api/auth/email/verify", "POST", { token })).status).toBe(400);
  });

  test("changing email preserves the verified address until proof, while resends and ownership are bounded", async () => {
    enableMail();
    const first = await registerEmail("first@example.com", "First");
    await call("/api/auth/email/verify", "POST", { token: tokenOf(mails[0]!) });
    time += 61_000;
    expect((await call("/api/auth/email", "POST", { email: "next@example.com", password: "wrong password 123" }, first.cookie)).status).toBe(401);
    expect((await call("/api/auth/email", "POST", { email: "next@example.com", password: PASSWORD }, first.cookie, { "x-prapor-account": "wrong-account" })).status).toBe(401);
    const update = await call("/api/auth/email", "POST", { email: "next@example.com", password: PASSWORD }, first.cookie);
    expect(await update.json()).toMatchObject({ user: { email: "first@example.com", emailVerified: true, pendingEmail: "next@example.com" }, emailDelivery: "sent" });
    const stale = tokenOf(mails[1]!);
    const early = await call("/api/auth/email/resend", "POST", {}, first.cookie);
    expect(early.status).toBe(429);
    expect(early.headers.get("retry-after")).toBe("60");
    time += 61_000;
    expect((await call("/api/auth/email/resend", "POST", {}, first.cookie)).status).toBe(200);
    expect((await call("/api/auth/email/verify", "POST", { token: stale })).status).toBe(400);
    expect((await call("/api/auth/email/verify", "POST", { token: tokenOf(mails[2]!) })).status).toBe(200);
    time += 61_000;
    const other = await registerEmail("NEXT@example.com", "Other");
    const denied = await call("/api/auth/email/verify", "POST", { token: tokenOf(mails[3]!) });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ code: "email_taken" });
    expect(await (await call("/api/auth/session", "GET", undefined, other.cookie)).json()).toMatchObject({ user: { emailVerified: false } });
  });

  test("a pending replacement cannot recover the account; the verified current address still can, and reset links expire", async () => {
    enableMail();
    const account = await registerEmail("original@example.com");
    await call("/api/auth/email/verify", "POST", { token: tokenOf(mails[0]!) });
    time += 61_000;
    await call("/api/auth/email", "POST", { email: "replacement@example.com", password: PASSWORD }, account.cookie);
    await call("/api/auth/password/forgot", "POST", { email: "replacement@example.com" });
    expect(mails).toHaveLength(2);
    await call("/api/auth/password/forgot", "POST", { email: "original@example.com" });
    expect(mails).toHaveLength(3);
    expect(mails[2]!.to).toBe("original@example.com");
    const reset = tokenOf(mails[2]!);
    time += 30 * 60_000 + 1;
    expect((await call("/api/auth/password/reset", "POST", { token: reset, password: "replacement password" })).status).toBe(400);
    expect((await call("/api/auth/login", "POST", { username: "MailScav", password: PASSWORD })).status).toBe(200);
  });

  test("mail failure preserves account and save; recipient cooldown survives restart and disabled mail stays optional", async () => {
    enableMail(async message => { mails.push(message); throw new Error("private provider failure"); });
    const account = await registerEmail("shared@example.com");
    expect(account.emailDelivery).toBe("failed");
    expect((await call("/api/save", "PUT", { revision: 0, save: saveGame(createGame(time)) }, account.cookie)).status).toBe(410);
    expect(await (await call("/api/save", "GET", undefined, account.cookie)).json()).toEqual({ revision: 0, savedAt: null, save: null });
    expect((await call("/api/auth/email/verify", "POST", { token: tokenOf(mails[0]!) })).status).toBe(400);
    service.close();
    service = createAccountService({ ...options(), sendMail: async message => { mails.push(message); } });
    const another = await registerEmail("SHARED@example.com", "Second");
    expect(another.emailDelivery).toBe("failed");
    expect(mails).toHaveLength(1);
    expect((await call("/api/auth/email/resend", "POST", {}, account.cookie)).status).toBe(429);
    time += 61_000;
    expect((await call("/api/auth/email/resend", "POST", {}, account.cookie)).status).toBe(200);
    service.close(); service = createAccountService(options());
    const disabled = await registerEmail("third@example.com", "Third");
    expect(disabled.emailDelivery).toBe("disabled");
    expect((await call("/api/auth/email/resend", "POST", {}, disabled.cookie)).status).toBe(503);
    expect(await (await call("/api/auth/password/forgot", "POST", { email: "third@example.com" })).json()).toEqual({ ok: true });
  });

  test("expiring tokens and credential recovery invalidate unfinished email operations", async () => {
    enableMail();
    const account = await register();
    let finish!: () => void;
    service.close();
    service = createAccountService({ ...options(), sendMail: async message => { mails.push(message); await new Promise<void>(resolve => { finish = resolve; }); } });
    const pending = call("/api/auth/email", "POST", { email: "pending@example.com", password: PASSWORD }, account.cookie);
    while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
    expect((await call("/api/auth/recover", "POST", { username: "Scav_1", recoveryCode: account.recoveryCode, password: "replacement password" })).status).toBe(200);
    finish();
    expect((await pending).status).toBe(401);
    expect((await call("/api/auth/email/verify", "POST", { token: tokenOf(mails[0]!) })).status).toBe(400);
    service.close(); service = createAccountService({ ...options(), sendMail: async message => { mails.push(message); } });
    const expiring = await registerEmail("expires@example.com", "Expiry");
    time += 24 * 60 * 60_000 + 1;
    expect((await call("/api/auth/email/verify", "POST", { token: tokenOf(mails[1]!) })).status).toBe(400);
    expect(await (await call("/api/auth/session", "GET", undefined, expiring.cookie)).json()).toMatchObject({ user: { emailVerified: false } });
  });

  test("the pre-email database migrates in place without losing credentials or a cloud save", async () => {
    const account = await register("Legacy");
    const currentDb = new Database(dbPath, { readonly: true });
    const credentials = currentDb.query<{ password_hash: string; recovery_hash: string }, []>("SELECT password_hash,recovery_hash FROM users").get()!;
    currentDb.close();
    const legacyPath = join(folder, "legacy.sqlite"), legacyDb = new Database(legacyPath, { create: true });
    legacyDb.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,recovery_hash TEXT NOT NULL,credential_version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
      CREATE TABLE saves(user_id TEXT PRIMARY KEY REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 0,saved_at INTEGER,save TEXT);`);
    legacyDb.query("INSERT INTO users(id,username,username_key,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)").run(account.id, "Legacy", "legacy", credentials.password_hash, credentials.recovery_hash, time);
    const save = saveGame(createGame(time));
    legacyDb.query("INSERT INTO saves(user_id,revision,saved_at,save) VALUES(?,?,?,?)").run(account.id, 7, time, save);
    legacyDb.close(); service.close();
    service = createAccountService({ ...options(), dbPath: legacyPath });
    const login = await call("/api/auth/login", "POST", { username: "Legacy", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ user: { id: account.id, email: null, pendingEmail: null, emailVerified: false } });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    accountIds.set(cookie, account.id);
    expect(await (await call("/api/save", "GET", undefined, cookie)).json()).toEqual({ revision: 7, savedAt: time, save });
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
