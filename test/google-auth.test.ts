import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountService, type AccountService } from "../server/accounts";
import { GOOGLE_CALLBACK_PATH, readGoogleOptions, type GoogleOptions, type GoogleProfile, type GoogleProof } from "../server/google";
import { createHandler } from "../server/handler";
import type { AccountMail } from "../server/mail";

const ORIGINS = ["https://game.delopusk.ru", "https://game.balkhaev.com"];
const ORIGIN = ORIGINS[0]!;
const PASSWORD = "strong password 123";
let service: AccountService, folder: string, dbPath: string, time: number;
let profile: GoogleProfile, proofs: GoogleProof[], exchange: (proof: GoogleProof) => Promise<GoogleProfile>;
const options = (): GoogleOptions => ({ clientId: "test.apps.googleusercontent.com", clientSecret: "test-server-secret", redirectUris: ORIGINS.map(origin => origin + GOOGLE_CALLBACK_PATH), exchange: async proof => { proofs.push(proof); return exchange(proof); } });
const request = (path: string, method = "GET", body?: unknown, cookie = "", origin = ORIGIN, headers: Record<string, string> = {}) => new Request(origin + path, {
  method, headers: { ...(method !== "GET" ? { "content-type": "application/json", origin } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function call(path: string, method = "GET", body?: unknown, cookie = "", origin = ORIGIN, headers: Record<string, string> = {}) {
  const result = await service.fetch(request(path, method, body, cookie, origin, headers), "192.0.2.10");
  if (!result) throw new Error("Expected account route");
  return result;
}
type Attempt = { authorization: URL; cookie: string; origin: string; session: string };
async function start(origin = ORIGIN, session = "", intent = "login", accountId?: string): Promise<Attempt> {
  const result = await call("/api/auth/google", "POST", { intent }, session, origin, accountId ? { "x-prapor-account": accountId } : {});
  expect(result.status).toBe(200);
  return { authorization: new URL((await result.json()).url), cookie: result.headers.getSetCookie()[0]!.split(";")[0]!, origin, session };
}
async function finish(attempt: Attempt, params: Record<string, string> = {}, cookie = [attempt.cookie, attempt.session].filter(Boolean).join("; "), origin = attempt.origin) {
  return call(GOOGLE_CALLBACK_PATH + "?" + new URLSearchParams({ state: attempt.authorization.searchParams.get("state")!, code: "test-code", ...params }), "GET", undefined, cookie, origin);
}
const sessionCookie = (result: Response): string => result.headers.getSetCookie().find(value => value.startsWith("__Host-prapor_session="))!.split(";")[0]!;
async function session(cookie: string, origin = ORIGIN) { return (await call("/api/auth/session", "GET", undefined, cookie, origin)).json(); }
async function register(name: string) {
  const result = await call("/api/auth/register", "POST", { username: name, password: PASSWORD });
  expect(result.status).toBe(201);
  return { cookie: sessionCookie(result), user: (await result.json()).user };
}
function count(table: string) { const db = new Database(dbPath, { readonly: true }); try { return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n; } finally { db.close(); } }
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "prapor-google-")); dbPath = join(folder, "accounts.sqlite"); time = 1_800_000_000_000;
  profile = { subject: "google-subject-123", email: "scav@gmail.com", emailAuthoritative: true }; proofs = []; exchange = async () => profile;
  service = createAccountService({ dbPath, now: () => time, secureCookies: true, allowedOrigins: ORIGINS, google: options() });
});
afterEach(async () => { service.close(); await rm(folder, { recursive: true, force: true }); });

test("both callback domains use state cookie, nonce, S256 and basic identity scopes", async () => {
  for (const origin of ORIGINS) {
    const attempt = await start(origin);
    const query = attempt.authorization.searchParams;
    expect(attempt.authorization.origin).toBe("https://accounts.google.com");
    expect(query.get("redirect_uri")).toBe(origin + GOOGLE_CALLBACK_PATH);
    expect(query.get("scope")).toBe("openid email");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.has("client_secret")).toBe(false);
    expect(attempt.cookie).toBe("__Host-prapor_google=" + query.get("state"));
    const result = await finish(attempt);
    expect(result.status).toBe(303); expect(result.headers.get("location")).toBe("/#account-google=success");
    for (const flag of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"]) expect(result.headers.getSetCookie().find(value => value.startsWith("__Host-prapor_session="))).toContain(flag);
    expect(result.headers.get("cache-control")).toBe("no-store"); expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    const proof = proofs.at(-1)!;
    expect(proof.redirectUri).toBe(query.get("redirect_uri")!); expect(proof.nonce).toBe(query.get("nonce")!);
    expect(createHash("sha256").update(proof.verifier).digest("base64url")).toBe(query.get("code_challenge")!);
    const user = (await session(sessionCookie(result), origin)).user;
    expect(user).toMatchObject({ email: profile.email, emailVerified: true, googleLinked: true, passwordEnabled: false });
    expect(user.username).toMatch(/^[A-Za-z0-9_-]{3,24}$/);
  }
  expect(count("users")).toBe(1); expect(count("google_identities")).toBe(1);
});

test("missing, duplicate, mismatched, expired and cross-domain callbacks cannot authenticate", async () => {
  const attempt = await start();
  expect((await finish(attempt, {}, "")).headers.get("location")).toBe("/#account-google=failed");
  expect((await finish(attempt, { state: "bad-state" })).headers.get("location")).toBe("/#account-google=failed");
  expect((await finish(attempt, {}, attempt.cookie + "; " + attempt.cookie)).headers.get("location")).toBe("/#account-google=failed");
  expect((await finish(attempt, {}, attempt.cookie, ORIGINS[1])).headers.get("location")).toBe("/#account-google=failed");
  const duplicate = await call(GOOGLE_CALLBACK_PATH + "?" + new URLSearchParams({ state: attempt.authorization.searchParams.get("state")!, code: "code" }) + "&state=other", "GET", undefined, attempt.cookie);
  expect(duplicate.headers.get("location")).toBe("/#account-google=failed");
  time += 600_001;
  expect((await finish(attempt)).headers.get("location")).toBe("/#account-google=failed");
  expect(proofs).toHaveLength(0); expect(count("users")).toBe(0);
});

test("challenge survives restart and is single-use before the provider responds", async () => {
  const attempt = await start(); service.close();
  service = createAccountService({ dbPath, now: () => time, secureCookies: true, allowedOrigins: ORIGINS, google: options() });
  let resolve!: (value: GoogleProfile) => void;
  exchange = () => new Promise(done => { resolve = done; });
  const pending = finish(attempt);
  expect((await finish(attempt)).headers.get("location")).toBe("/#account-google=failed");
  resolve(profile);
  expect((await pending).headers.get("location")).toBe("/#account-google=success");
  expect((await finish(attempt)).headers.get("location")).toBe("/#account-google=failed");
  expect(proofs).toHaveLength(1);
});

test("explicit Google linking preserves account id, password and saved data", async () => {
  const account = await register("Veteran");
  const db = new Database(dbPath); db.query("UPDATE saves SET revision=4,save='legacy-data' WHERE user_id=?").run(account.user.id); db.close();
  const attempt = await start(ORIGIN, account.cookie, "link", account.user.id);
  const linked = await finish(attempt);
  expect(linked.headers.get("location")).toBe("/#account-google=linked");
  expect((await session(sessionCookie(linked))).user).toMatchObject({ id: account.user.id, username: "Veteran", googleLinked: true, passwordEnabled: true, email: null });
  const save = await call("/api/save", "GET", undefined, sessionCookie(linked), ORIGIN, { "x-prapor-account": account.user.id });
  expect(await save.json()).toMatchObject({ revision: 4, save: "legacy-data" });
  const passwordLogin = await call("/api/auth/login", "POST", { username: "Veteran", password: PASSWORD }); expect(passwordLogin.status).toBe(200);
  const returning = await finish(await start(ORIGINS[1]));
  expect((await session(sessionCookie(returning), ORIGINS[1])).user.id).toBe(account.user.id);
});

test("email alone never takes ownership of an existing account", async () => {
  const account = await register("EmailOwner"); const db = new Database(dbPath);
  db.query("UPDATE users SET email=?,email_verified_at=? WHERE id=?").run(profile.email, time, account.user.id); db.close();
  const result = await finish(await start()); expect(result.headers.get("location")).toBe("/#account-google=email-in-use");
  expect(result.headers.getSetCookie().some(value => value.startsWith("__Host-prapor_session="))).toBe(false);
  expect(count("users")).toBe(1); expect(count("google_identities")).toBe(0);
});

test("unverified pending addresses cannot prevent the real Google owner from registering", async () => {
  const result = await call("/api/auth/register", "POST", { username: "Unverified", password: PASSWORD, email: profile.email }); expect(result.status).toBe(201);
  expect((await finish(await start())).headers.get("location")).toBe("/#account-google=success");
  expect(count("users")).toBe(2);
});

test("one Google identity cannot be linked to a second game account", async () => {
  const first = await finish(await start()); const firstId = (await session(sessionCookie(first))).user.id;
  const second = await register("Second");
  const result = await finish(await start(ORIGIN, second.cookie, "link", second.user.id));
  expect(result.headers.get("location")).toBe("/#account-google=already-linked");
  expect((await session(second.cookie)).user.googleLinked).toBe(false);
  expect((await session(sessionCookie(first))).user.id).toBe(firstId);
});

test("session switching and logout during Google exchange prevent linking", async () => {
  const account = await register("SessionOwner"); const other = await register("OtherOwner");
  const attempt = await start(ORIGIN, account.cookie, "link", account.user.id);
  expect((await finish(attempt, {}, attempt.cookie + "; " + other.cookie)).headers.get("location")).toBe("/#account-google=session-changed");
  let resolve!: (value: GoogleProfile) => void; exchange = () => new Promise(done => { resolve = done; });
  const pending = finish(await start(ORIGIN, account.cookie, "link", account.user.id));
  await call("/api/auth/logout", "POST", {}, account.cookie); resolve(profile);
  expect((await pending).headers.get("location")).toBe("/#account-google=session-changed"); expect(count("google_identities")).toBe(0);
});

test("provider cancellation and failure return vetted fragments without tokens", async () => {
  const cancel = await finish(await start(), { error: "access_denied" }); expect(cancel.headers.get("location")).toBe("/#account-google=cancelled");
  exchange = async () => { throw new Error("sensitive provider details"); };
  const failure = await finish(await start()); expect(failure.headers.get("location")).toBe("/#account-google=failed");
  expect(await failure.text()).not.toContain("sensitive provider details"); expect(count("users")).toBe(0);
});

test("non-authoritative external Google mail remains pending for independent verification", async () => {
  profile = { subject: "external-google", email: "scav@external.example", emailAuthoritative: false };
  const user = (await session(sessionCookie(await finish(await start())))).user;
  expect(user).toMatchObject({ email: profile.email, pendingEmail: profile.email, emailVerified: false, passwordEnabled: false });
  const password = await call("/api/auth/login", "POST", { username: user.username, password: PASSWORD }); expect(password.status).toBe(401);
});

test("Google-only account can set a password by verified mail and keep its Google identity", async () => {
  const messages: AccountMail[] = [];
  service.close(); service = createAccountService({ dbPath, now: () => time, secureCookies: true, allowedOrigins: ORIGINS, google: options(), sendMail: async message => { messages.push(message); } });
  const original = await finish(await start()), originalCookie = sessionCookie(original);
  const user = (await session(originalCookie)).user;
  expect((await call("/api/auth/login", "POST", { username: user.username, password: PASSWORD })).status).toBe(401);
  expect((await call("/api/auth/password/forgot", "POST", { email: profile.email })).status).toBe(200);
  expect(messages).toHaveLength(1);
  const token = new URL(messages[0]!.url).hash.split("=")[1]!;
  const reset = await call("/api/auth/password/reset", "POST", { token, password: PASSWORD }); expect(reset.status).toBe(200);
  expect((await reset.json()).recoveryCode).toMatch(/^[a-f0-9-]{53}$/);
  expect((await session(originalCookie)).user).toBeNull();
  const password = await call("/api/auth/login", "POST", { username: user.username, password: PASSWORD }); expect(password.status).toBe(200);
  expect((await session(sessionCookie(password))).user).toMatchObject({ id: user.id, passwordEnabled: true, googleLinked: true });
  expect((await session(sessionCookie(await finish(await start())))).user.id).toBe(user.id);
});

test("start requires same-origin POST and explicit current account for linking", async () => {
  expect((await call("/api/auth/google")).status).toBe(405);
  expect((await call("/api/auth/google", "POST", { intent: "login" }, "", ORIGIN, { origin: "https://evil.example" })).status).toBe(403);
  expect((await call("/api/auth/google", "POST", { intent: "login", returnTo: "https://evil.example" })).status).toBe(400);
  expect((await call("/api/auth/google", "POST", { intent: "link" })).status).toBe(401);
  const account = await register("HeaderOwner");
  expect((await call("/api/auth/google", "POST", { intent: "link" }, account.cookie)).status).toBe(401);
  const handler = createHandler(folder, service);
  const callback = await handler(request(GOOGLE_CALLBACK_PATH)); expect(callback.status).toBe(303); expect(callback.headers.get("location")).toBe("/#account-google=failed");
});

test("unconfigured Google is disabled and partial or untrusted config fails startup", async () => {
  expect(readGoogleOptions({})).toBeNull();
  expect(() => readGoogleOptions({ GOOGLE_CLIENT_ID: "id" })).toThrow("Incomplete");
  expect(() => readGoogleOptions({ GOOGLE_CLIENT_SECRET_FILE: join(folder, "missing") })).toThrow("Cannot read");
  expect(() => createAccountService({ dbPath: ":memory:", google: { ...options(), redirectUris: ["https://evil.example/callback/auth/google"] } })).toThrow("exact permitted");
  service.close(); service = createAccountService({ dbPath, allowedOrigins: ORIGINS });
  expect((await session("")).googleEnabled).toBe(false);
  expect((await call("/api/auth/google", "POST", { intent: "login" })).status).toBe(503);
});
