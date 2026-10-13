import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { MAX_GAME_SAVE_LENGTH, isValidGameSave } from "../src/game-save";

export interface AccountUser { id: string; username: string }
export interface AccountService {
  fetch(request: Request, clientAddress?: string): Promise<Response | null>;
  healthy(): boolean;
  close(): void;
}
export interface AccountOptions {
  dbPath: string;
  secureCookies?: boolean;
  allowedOrigins?: string[];
  now?: () => number;
  maxHashingConcurrency?: number;
}
interface UserRow extends AccountUser { password_hash: string; recovery_hash: string; credential_version: number }
interface SaveRow { revision: number; saved_at: number | null; save: string | null }
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const AUTH_BODY_BYTES = 4096;
const SAVE_BODY_BYTES = MAX_GAME_SAVE_LENGTH * 4 + 4096;
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const publicUser = (user: AccountUser): AccountUser => ({ id: user.id, username: user.username });
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validUsername = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{3,24}$/.test(value);
const validPassword = (value: unknown): value is string => typeof value === "string" && value.length >= 12 && value.length <= 128;

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) { super(code); }
}

function response(value: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", ...extra,
  } });
}

async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(415, "json-required");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ApiError(413, "body-too-large");
  if (!request.body) throw new ApiError(400, "invalid-json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new ApiError(413, "body-too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try {
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    if (!isObject(body)) throw new Error("object-required");
    return body;
  } catch { throw new ApiError(400, "invalid-json"); }
}

/** Only an explicitly trusted direct peer may supply a forwarded client address. */
export function getClientAddress(request: Request, peer: string | undefined, trustedProxies: string[] = []): string {
  const normalize = (value: string): string => value.startsWith("::ffff:") && isIP(value.slice(7)) ? value.slice(7) : value;
  const direct = normalize(peer ?? "unknown");
  const trusted = new Set(trustedProxies.map(normalize));
  if (!trusted.has(direct)) return direct;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map(value => normalize(value.trim())) ?? [];
  if (!forwarded.length || forwarded.length > 16 || forwarded.some(value => !isIP(value))) return direct;
  for (let i = forwarded.length - 1; i >= 0; i--) if (!trusted.has(forwarded[i]!)) return forwarded[i]!;
  return direct;
}

export function readAccountOptions(env: Record<string, string | undefined>): AccountOptions {
  const production = env.NODE_ENV === "production";
  return {
    dbPath: env.ACCOUNT_DB_PATH ?? (process.platform === "win32" && !production ? "F:/AI/prapor/accounts.sqlite" : "/app/data/accounts.sqlite"),
    secureCookies: production,
    maxHashingConcurrency: Number(env.AUTH_HASH_CONCURRENCY ?? "2"),
    allowedOrigins: (env.APP_ORIGINS ?? (production ? "https://game.delopusk.ru,https://game.balkhaev.com" : "http://localhost:3020,http://127.0.0.1:3020,http://localhost:3000,http://127.0.0.1:3000")).split(",").map(value => value.trim()).filter(Boolean),
  };
}

export function createAccountService(options: AccountOptions): AccountService {
  const now = options.now ?? Date.now;
  const secure = options.secureCookies ?? true;
  const cookieName = secure ? "__Host-prapor_session" : "prapor_session";
  const origins = new Set(options.allowedOrigins ?? ["https://game.delopusk.ru", "https://game.balkhaev.com"]);
  const hosts = new Set<string>();
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || secure && url.protocol !== "https:") throw new Error("APP_ORIGINS must contain complete permitted origins");
    hosts.add(url.host);
  }
  if (!origins.size) throw new Error("APP_ORIGINS must not be empty");
  const concurrency = options.maxHashingConcurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("Invalid hashing concurrency");
  if (options.dbPath !== ":memory:") mkdirSync(dirname(options.dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(options.dbPath, { create: true, strict: true });
  if (options.dbPath !== ":memory:" && process.platform !== "win32") chmodSync(options.dbPath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, credential_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_version INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS saves (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0, saved_at INTEGER, save TEXT
    );`);
  const findUser = db.query<UserRow, [string]>("SELECT id, username, password_hash, recovery_hash, credential_version FROM users WHERE username_key=?");
  const findSession = db.query<AccountUser, [string, number]>(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND s.credential_version=u.credential_version`);
  const readSave = db.query<SaveRow, [string]>("SELECT revision, saved_at, save FROM saves WHERE user_id=?");
  const dummyHash = Bun.password.hashSync(randomBytes(32).toString("hex"), { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 });
  let hashing = 0;
  let closed = false;
  let lastCleanup = 0;
  const limits = new Map<string, { count: number; expires: number }>();
  const limit = (key: string, maximum: number, windowMs: number): void => {
    const time = now();
    if (time - lastCleanup > 60_000) {
      for (const [key, value] of limits) if (value.expires <= time) limits.delete(key);
      db.query("DELETE FROM sessions WHERE expires_at<=?").run(time);
      lastCleanup = time;
    }
    let bucket = limits.get(key);
    if (!bucket || bucket.expires <= time) {
      if (!bucket && limits.size >= 10_000) throw new ApiError(429, "rate-limited", 60);
      bucket = { count: 0, expires: time + windowMs };
      limits.set(key, bucket);
    }
    if (++bucket.count > maximum) throw new ApiError(429, "rate-limited", Math.max(1, Math.ceil((bucket.expires - time) / 1000)));
  };
  const withHash = async <T>(work: () => Promise<T>): Promise<T> => {
    if (hashing >= concurrency) throw new ApiError(429, "server-busy", 2);
    hashing++;
    try { return await work(); } finally { hashing--; }
  };
  const cookie = (token: string, maxAge = SESSION_SECONDS): string => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const tokenFrom = (request: Request): string | null => {
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
    if (cookies.length !== 1) return null;
    const token = cookies[0]!.slice(cookieName.length + 1);
    return /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : null;
  };
  const currentUser = (request: Request): AccountUser | null => {
    const token = tokenFrom(request);
    return token ? findSession.get(hashToken(token), now()) : null;
  };
  const newSession = (user: UserRow, request: Request): string => {
    const old = tokenFrom(request);
    if (old) db.query("DELETE FROM sessions WHERE token_hash=?").run(hashToken(old));
    const token = randomBytes(32).toString("base64url"), time = now();
    const changed = db.query(`INSERT INTO sessions(token_hash,user_id,credential_version,created_at,expires_at)
      SELECT ?,id,credential_version,?,? FROM users WHERE id=? AND credential_version=?`).run(hashToken(token), time, time + SESSION_SECONDS * 1000, user.id, user.credential_version);
    if (changed.changes !== 1) throw new ApiError(401, "invalid-credentials");
    db.query(`DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN
      (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT 8)`).run(user.id, user.id);
    return token;
  };
  const recoveryCode = (): string => randomBytes(24).toString("hex").match(/.{1,8}/g)!.join("-");
  const normalizeRecovery = (value: unknown): string | null => typeof value === "string" && /^[a-fA-F0-9-]{48,53}$/.test(value) && /^[a-f0-9]{48}$/.test(value.toLowerCase().replaceAll("-", "")) ? value.toLowerCase().replaceAll("-", "") : null;
  const hashRecovery = (value: string): string => hashToken(value.replaceAll("-", ""));

  async function fetchApi(request: Request, clientAddress = "unknown"): Promise<Response | null> {
    const url = new URL(request.url), path = url.pathname;
    if (path !== "/api" && !path.startsWith("/api/")) return null;
    try {
      if (closed) throw new ApiError(503, "service-unavailable");
      if (!hosts.has(url.host)) throw new ApiError(403, "host-not-allowed");
      const method = path === "/api/auth/session" ? "GET" : path === "/api/save" ? "GET, PUT" : ["/api/auth/register", "/api/auth/login", "/api/auth/recover", "/api/auth/logout"].includes(path) ? "POST" : null;
      if (!method) return response({ code: "not_found" }, 404);
      if (!method.split(", ").includes(request.method)) return response({ code: "method_not_allowed" }, 405, { Allow: method });
      const ipKey = hashToken(clientAddress);
      limit(`api:${ipKey}`, 300, 60_000);
      if (request.method !== "GET") {
        if (!origins.has(request.headers.get("origin") ?? "") || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "origin-not-allowed");
      }
      if (path === "/api/auth/session") {
        const user = currentUser(request);
        return response({ user: user ? publicUser(user) : null }, 200, !user && tokenFrom(request) ? { "Set-Cookie": cookie("", 0) } : {});
      }
      if (path === "/api/auth/logout") {
        const body = await readJson(request, AUTH_BODY_BYTES);
        if (!exactKeys(body, [])) throw new ApiError(400, "invalid-request");
        const token = tokenFrom(request);
        if (token) db.query("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token));
        return response({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
      }
      if (path === "/api/save") {
        const user = currentUser(request);
        if (!user) throw new ApiError(401, "unauthorized");
        const current = readSave.get(user.id);
        if (!current) throw new ApiError(503, "service-unavailable");
        if (request.method === "GET") return response({ revision: current.revision, savedAt: current.saved_at, save: current.save });
        limit(`save:${user.id}`, 120, 60_000);
        const body = await readJson(request, SAVE_BODY_BYTES);
        // Validation never advances a client's offline simulation or changes its stored document.
        if (!exactKeys(body, ["revision", "save"]) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0 || typeof body.save !== "string" || body.save.length > MAX_GAME_SAVE_LENGTH || !isValidGameSave(body.save)) throw new ApiError(400, "invalid-save");
        if (currentUser(request)?.id !== user.id) throw new ApiError(401, "unauthorized");
        const savedAt = now();
        const changed = db.query("UPDATE saves SET revision=revision+1, saved_at=?, save=? WHERE user_id=? AND revision=?").run(savedAt, body.save, user.id, body.revision as number);
        if (changed.changes !== 1) return response({ code: "save_conflict", revision: readSave.get(user.id)!.revision }, 409);
        return response({ revision: (body.revision as number) + 1, savedAt });
      }
      limit(`auth-ip:${ipKey}`, 120, 15 * 60_000);
      if (path === "/api/auth/register") limit(`register:${ipKey}`, 60, 60 * 60_000);
      const body = await readJson(request, AUTH_BODY_BYTES);
      const keys = path === "/api/auth/recover" ? ["username", "password", "recoveryCode"] : ["username", "password"];
      if (!exactKeys(body, keys) || !validUsername(body.username) || !validPassword(body.password)) throw new ApiError(400, "invalid-request");
      const username = body.username, password = body.password, usernameKey = username.toLowerCase();
      limit(`auth-user:${hashToken(usernameKey)}`, 8, 15 * 60_000);
      if (path === "/api/auth/register") {
        const passwordHash = await withHash(() => Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 }));
        const id = randomUUID(), code = recoveryCode();
        const user: UserRow = { id, username, password_hash: passwordHash, recovery_hash: hashRecovery(code), credential_version: 1 };
        const token = db.transaction(() => {
          if (findUser.get(usernameKey)) throw new ApiError(409, "username-taken");
          db.query("INSERT INTO users(id,username,username_key,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)").run(id, username, usernameKey, passwordHash, user.recovery_hash, now());
          db.query("INSERT INTO saves(user_id) VALUES(?)").run(id);
          return newSession(user, request);
        })();
        return response({ user: publicUser(user), recoveryCode: code }, 201, { "Set-Cookie": cookie(token) });
      }
      const user = findUser.get(usernameKey);
      if (path === "/api/auth/login") {
        const matches = await withHash(() => Bun.password.verify(password, user?.password_hash ?? dummyHash));
        if (!matches || !user) throw new ApiError(401, "invalid-credentials");
        const token = db.transaction(() => newSession(user, request))();
        return response({ user: publicUser(user) }, 200, { "Set-Cookie": cookie(token) });
      }
      const code = normalizeRecovery(body.recoveryCode);
      const candidate = hashRecovery(code ?? "invalid"), expected = user?.recovery_hash ?? hashToken("unknown");
      if (!timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex")) || !code || !user) throw new ApiError(401, "invalid-recovery");
      const passwordHash = await withHash(() => Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 }));
      const nextCode = recoveryCode();
      db.transaction(() => {
        const changed = db.query("UPDATE users SET password_hash=?, recovery_hash=?, credential_version=credential_version+1 WHERE id=? AND recovery_hash=? AND credential_version=?").run(passwordHash, hashRecovery(nextCode), user.id, user.recovery_hash, user.credential_version);
        if (changed.changes !== 1) throw new ApiError(401, "invalid-recovery");
        db.query("DELETE FROM sessions WHERE user_id=?").run(user.id);
      })();
      return response({ recoveryCode: nextCode }, 200, { "Set-Cookie": cookie("", 0) });
    } catch (error) {
      if (error instanceof ApiError) return response({ code: error.code.replaceAll("-", "_") }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
      return response({ code: "service_unavailable" }, 503);
    }
  }
  return { fetch: fetchApi, healthy: () => { try { return !closed && Boolean(db.query("SELECT 1 AS ready").get()); } catch { return false; } }, close: () => { if (!closed) { closed = true; db.close(); } } };
}
