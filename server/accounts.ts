import { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { readResendSender, type MailSender } from "./mail";
import { createGoogleExchange, GOOGLE_CALLBACK_PATH, readGoogleOptions, type GoogleOptions, type GoogleProfile } from "./google";

export interface AccountUser { id: string; username: string; email: string | null; emailVerified: boolean; pendingEmail: string | null; googleLinked: boolean; passwordEnabled: boolean }
export interface AccountService {
  fetch(request: Request, clientAddress?: string): Promise<Response | null>;
  resolveLiveIdentity(request: Request): { id: string; name: string } | null;
  healthy(): boolean;
  close(): void;
}
export interface AccountOptions {
  dbPath: string;
  secureCookies?: boolean;
  allowedOrigins?: string[];
  now?: () => number;
  maxHashingConcurrency?: number;
  sendMail?: MailSender | null;
  publicBaseUrl?: string;
  google?: GoogleOptions | null;
}
interface UserRow {
  id: string; username: string; password_hash: string; recovery_hash: string; credential_version: number;
  email: string | null; email_verified_at: number | null; pending_email: string | null;
  email_version: number; email_sent_at: number | null; reset_sent_at: number | null;
  password_enabled: number; google_linked?: number;
}
interface GoogleAttempt { state_hash: string; verifier: string; nonce: string; redirect_uri: string; intent: "login" | "link"; user_id: string | null; credential_version: number | null; session_hash: string | null; expires_at: number }
interface EmailTicket { token_hash: string; ticket_id: string; user_id: string; purpose: "verify" | "reset"; email: string; credential_version: number; email_version: number; expires_at: number }
interface SaveRow { revision: number; saved_at: number | null; save: string | null }
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const AUTH_BODY_BYTES = 4096;
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const publicUser = (user: UserRow): AccountUser => ({ id: user.id, username: user.username, email: user.email ?? user.pending_email, emailVerified: user.email !== null && user.email_verified_at !== null, pendingEmail: user.pending_email, googleLinked: Boolean(user.google_linked), passwordEnabled: user.password_enabled === 1 });
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validUsername = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{3,24}$/.test(value);
const validPassword = (value: unknown): value is string => typeof value === "string" && value.length >= 12 && value.length <= 128;
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  const parts = email.split("@"), local = parts[0], domain = parts[1];
  if (parts.length !== 2 || !local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || !domain || !domain.includes(".") || domain.length > 253) return null;
  if (domain.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return email;
}

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
    sendMail: readResendSender(env),
    google: readGoogleOptions(env),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "https://game.balkhaev.com",
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
  const publicBase = new URL(options.publicBaseUrl ?? "https://game.balkhaev.com");
  if (publicBase.username || publicBase.password || publicBase.search || publicBase.hash || publicBase.pathname !== "/" || !["https:", "http:"].includes(publicBase.protocol) || secure && publicBase.protocol !== "https:") throw new Error("PUBLIC_BASE_URL must be a trusted application origin");
  const sendMail = options.sendMail ?? null;
  const google = options.google ?? null;
  const googleCallbacks = new Map<string, string>();
  if (google) {
    if (!google.clientId.trim() || !google.clientSecret.trim() || !google.redirectUris.length) throw new Error("Incomplete Google OAuth configuration");
    for (const uri of google.redirectUris) {
      const callback = new URL(uri);
      if (!origins.has(callback.origin) || callback.pathname !== GOOGLE_CALLBACK_PATH || callback.search || callback.hash || callback.username || callback.password || callback.href !== uri) throw new Error("Google callbacks must be exact permitted application URLs");
      googleCallbacks.set(callback.origin, uri);
    }
  }
  const exchangeGoogle = google ? google.exchange ?? createGoogleExchange(google) : null;
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
  const columns = new Set(db.query<{ name: string }, []>("PRAGMA table_info(users)").all().map(column => column.name));
  for (const [column, definition] of Object.entries({ email: "TEXT", email_verified_at: "INTEGER", pending_email: "TEXT", email_version: "INTEGER NOT NULL DEFAULT 1", email_sent_at: "INTEGER", reset_sent_at: "INTEGER", password_enabled: "INTEGER NOT NULL DEFAULT 1" })) {
    if (!columns.has(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS verified_email_owner ON users(email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS email_tickets (
      token_hash TEXT PRIMARY KEY, ticket_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
      email TEXT NOT NULL, credential_version INTEGER NOT NULL, email_version INTEGER NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS email_ticket_user ON email_tickets(user_id,purpose);
    CREATE TABLE IF NOT EXISTS mail_recipient_limits (recipient_hash TEXT PRIMARY KEY,last_sent_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS google_identities (subject TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS google_attempts (state_hash TEXT PRIMARY KEY,verifier TEXT NOT NULL,nonce TEXT NOT NULL,redirect_uri TEXT NOT NULL,intent TEXT NOT NULL CHECK(intent IN ('login','link')),user_id TEXT,credential_version INTEGER,session_hash TEXT,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS google_attempt_expiry ON google_attempts(expires_at);`);
  const userProjection = "u.*, EXISTS(SELECT 1 FROM google_identities g WHERE g.user_id=u.id) AS google_linked";
  const findUser = db.query<UserRow, [string]>(`SELECT ${userProjection} FROM users u WHERE username_key=?`);
  const findUserById = db.query<UserRow, [string]>(`SELECT ${userProjection} FROM users u WHERE id=?`);
  const findSession = db.query<UserRow, [string, number]>(`SELECT ${userProjection} FROM sessions s JOIN users u ON u.id=s.user_id
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
      db.query("DELETE FROM email_tickets WHERE expires_at<=?").run(time);
      db.query("DELETE FROM google_attempts WHERE expires_at<=?").run(time);
      db.query("DELETE FROM mail_recipient_limits WHERE last_sent_at<?").run(time - 60 * 60_000);
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
  const googleCookieName = secure ? "__Host-prapor_google" : "prapor_google";
  const googleCookie = (state: string, maxAge = 600): string => `${googleCookieName}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  const googleStateFrom = (request: Request): string | null => {
    const cookies = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${googleCookieName}=`));
    if (cookies.length !== 1) return null;
    const state = cookies[0]!.slice(googleCookieName.length + 1);
    return /^[a-zA-Z0-9_-]{43}$/.test(state) ? state : null;
  };
  const googleRedirect = (outcome: string, session?: string): Response => {
    const result = response(null, 303, { Location: `/#account-google=${outcome}` });
    result.headers.append("Set-Cookie", googleCookie("", 0));
    if (session) result.headers.append("Set-Cookie", cookie(session));
    return result;
  };
  const currentUser = (request: Request): UserRow | null => {
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
  const authenticatedAccount = (request: Request): UserRow => {
    const user = currentUser(request);
    if (!user) throw new ApiError(401, "unauthorized");
    if (request.headers.get("x-prapor-account") !== user.id) throw new ApiError(401, "account-changed");
    return user;
  };
  const checkGoogleSession = (attempt: GoogleAttempt, request: Request): UserRow | null => {
    const user = currentUser(request), token = tokenFrom(request);
    if (attempt.session_hash !== (token ? hashToken(token) : null) || attempt.user_id !== (user?.id ?? null)
      || attempt.credential_version !== (user?.credential_version ?? null)) throw new ApiError(401, "session-changed");
    return user;
  };
  const googleAccount = (profile: GoogleProfile, attempt: GoogleAttempt, request: Request): UserRow => {
    const current = checkGoogleSession(attempt, request);
    if (typeof profile.subject !== "string" || !/^[\x21-\x7e]{1,255}$/.test(profile.subject)) throw new ApiError(400, "failed");
    const identity = db.query<{ user_id: string }, [string]>("SELECT user_id FROM google_identities WHERE subject=?").get(profile.subject);
    if (attempt.intent === "link") {
      if (!current) throw new ApiError(401, "session-changed");
      if (identity && identity.user_id !== current.id || current.google_linked && !identity) throw new ApiError(409, "already-linked");
      if (!identity) db.query("INSERT INTO google_identities(subject,user_id,created_at) VALUES(?,?,?)").run(profile.subject, current.id, now());
      return findUserById.get(current.id)!;
    }
    if (identity) return findUserById.get(identity.user_id)!;
    const email = normalizeEmail(profile.email);
    if (!email) throw new ApiError(400, "failed");
    // Matching email is never proof of ownership of a pre-existing game account.
    if (db.query("SELECT 1 FROM users WHERE email=?").get(email)) throw new ApiError(409, "email-in-use");
    const id = randomUUID(), username = `Scav_${randomBytes(8).toString("hex")}`;
    // No secret password or recovery code exists for a Google-only account.
    db.query(`INSERT INTO users(id,username,username_key,password_hash,recovery_hash,created_at,password_enabled,email,email_verified_at,pending_email)
      VALUES(?,?,?,?,?,?,0,?,?,?)`).run(id, username, username.toLowerCase(), dummyHash, hashToken(randomBytes(32).toString("hex")), now(), profile.emailAuthoritative ? email : null, profile.emailAuthoritative ? now() : null, profile.emailAuthoritative ? null : email);
    db.query("INSERT INTO saves(user_id) VALUES(?)").run(id);
    db.query("INSERT INTO google_identities(subject,user_id,created_at) VALUES(?,?,?)").run(profile.subject, id, now());
    return findUserById.get(id)!;
  };
  async function googleCallback(request: Request, url: URL, clientAddress: string): Promise<Response> {
    if (request.method !== "GET") return response({ code: "method_not_allowed" }, 405, { Allow: "GET" });
    try {
      if (closed || !exchangeGoogle) return googleRedirect("unavailable");
      limit(`google-callback:${hashToken(clientAddress)}`, 60, 60_000);
      const state = url.searchParams.get("state"), browserState = googleStateFrom(request);
      if (!state || state !== browserState || url.searchParams.getAll("state").length !== 1 || url.search.length > 8192) throw new ApiError(400, "failed");
      const attempt = db.transaction(() => {
        const value = db.query<GoogleAttempt, [string]>("SELECT * FROM google_attempts WHERE state_hash=?").get(hashToken(state));
        if (!value || value.expires_at <= now() || new URL(value.redirect_uri).host !== url.host) throw new ApiError(400, "failed");
        db.query("DELETE FROM google_attempts WHERE state_hash=?").run(value.state_hash);
        return value;
      })();
      checkGoogleSession(attempt, request);
      if (url.searchParams.has("error")) return googleRedirect(url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096 || url.searchParams.getAll("code").length !== 1) throw new ApiError(400, "failed");
      const profile = await exchangeGoogle({ code, redirectUri: attempt.redirect_uri, verifier: attempt.verifier, nonce: attempt.nonce });
      if (closed) return googleRedirect("unavailable");
      const session = db.transaction(() => newSession(googleAccount(profile, attempt, request), request))();
      return googleRedirect(attempt.intent === "link" ? "linked" : "success", session);
    } catch (error) {
      const outcome = error instanceof ApiError && ["session-changed", "email-in-use", "already-linked"].includes(error.code) ? error.code : "failed";
      return googleRedirect(outcome);
    }
  }
  const assertCurrentCredentials = (snapshot: UserRow, request?: Request): UserRow => {
    const fresh = findUserById.get(snapshot.id);
    if (!fresh || fresh.credential_version !== snapshot.credential_version || request && currentUser(request)?.id !== snapshot.id) throw new ApiError(401, "unauthorized");
    return fresh;
  };
  const issueEmailTicket = (snapshot: UserRow, purpose: "verify" | "reset", email: string, request?: Request, changeEmail = false): { message: Parameters<MailSender>[0]; user: UserRow } => db.transaction(() => {
    const fresh = assertCurrentCredentials(snapshot, request);
    const time = now(), previousSend = purpose === "verify" ? fresh.email_sent_at : fresh.reset_sent_at;
    if (previousSend !== null && time - previousSend < 60_000) throw new ApiError(429, "rate-limited", Math.max(1, Math.ceil((60_000 - (time - previousSend)) / 1000)));
    const recipientKey = hashToken(email);
    const recipient = db.query<{ last_sent_at: number }, [string]>("SELECT last_sent_at FROM mail_recipient_limits WHERE recipient_hash=?").get(recipientKey);
    if (recipient && time - recipient.last_sent_at < 60_000) throw new ApiError(429, "rate-limited", Math.max(1, Math.ceil((60_000 - (time - recipient.last_sent_at)) / 1000)));
    db.query("INSERT INTO mail_recipient_limits(recipient_hash,last_sent_at) VALUES(?,?) ON CONFLICT(recipient_hash) DO UPDATE SET last_sent_at=excluded.last_sent_at").run(recipientKey, time);
    if (purpose === "verify") {
      if (changeEmail) {
        db.query("UPDATE users SET pending_email=?, email_version=email_version+1 WHERE id=?").run(email, fresh.id);
        db.query("DELETE FROM email_tickets WHERE user_id=?").run(fresh.id);
      } else if (fresh.pending_email !== email) throw new ApiError(400, "email-already-verified");
      db.query("UPDATE users SET email_sent_at=? WHERE id=?").run(time, fresh.id);
    } else {
      if (fresh.email !== email || fresh.email_verified_at === null) throw new ApiError(400, "invalid-token");
      db.query("UPDATE users SET reset_sent_at=? WHERE id=?").run(time, fresh.id);
    }
    const user = findUserById.get(fresh.id)!;
    const token = randomBytes(32).toString("base64url"), ticketId = randomUUID();
    db.query("DELETE FROM email_tickets WHERE user_id=? AND purpose=?").run(user.id, purpose);
    db.query("INSERT INTO email_tickets(token_hash,ticket_id,user_id,purpose,email,credential_version,email_version,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)").run(hashToken(token), ticketId, user.id, purpose, email, user.credential_version, user.email_version, time, time + (purpose === "verify" ? 24 * 60 : 30) * 60_000);
    const link = new URL(publicBase.href);
    link.hash = `${purpose === "verify" ? "account-verify" : "account-reset"}=${token}`;
    return { user, message: { to: email, username: user.username, purpose, url: link.href, ticketId } };
  })();
  const deliverEmail = async (ticket: ReturnType<typeof issueEmailTicket>): Promise<"sent" | "failed"> => {
    try {
      if (!sendMail) throw new Error("Mail disabled");
      await sendMail(ticket.message);
      if (closed || !db.query("SELECT ticket_id FROM email_tickets WHERE ticket_id=?").get(ticket.message.ticketId)) return "failed";
      return "sent";
    } catch {
      try { if (!closed) db.query("DELETE FROM email_tickets WHERE ticket_id=?").run(ticket.message.ticketId); } catch { /* A closed/unavailable database cannot expose mail diagnostics. */ }
      return "failed";
    }
  };
  const readTicket = (token: unknown, purpose: "verify" | "reset"): { ticket: EmailTicket; user: UserRow } => {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(400, "invalid-token");
    const ticket = db.query<EmailTicket, [string, string, number]>("SELECT * FROM email_tickets WHERE token_hash=? AND purpose=? AND expires_at>?").get(hashToken(token), purpose, now());
    const user = ticket ? findUserById.get(ticket.user_id) : null;
    if (!ticket || !user || ticket.credential_version !== user.credential_version || ticket.email_version !== user.email_version
      || purpose === "verify" && ticket.email !== user.pending_email || purpose === "reset" && (ticket.email !== user.email || user.email_verified_at === null)) throw new ApiError(400, "invalid-token");
    return { ticket, user };
  };

  async function fetchApi(request: Request, clientAddress = "unknown"): Promise<Response | null> {
    const url = new URL(request.url), path = url.pathname;
    if (path === GOOGLE_CALLBACK_PATH) {
      if (!hosts.has(url.host)) return response({ code: "host_not_allowed" }, 403);
      return googleCallback(request, url, clientAddress);
    }
    if (path !== "/api" && !path.startsWith("/api/")) return null;
    try {
      if (closed) throw new ApiError(503, "service-unavailable");
      if (!hosts.has(url.host)) throw new ApiError(403, "host-not-allowed");
      const method = path === "/api/auth/session" ? "GET" : path === "/api/save" ? "GET, PUT" : ["/api/auth/google", "/api/auth/register", "/api/auth/login", "/api/auth/recover", "/api/auth/logout", "/api/auth/email", "/api/auth/email/resend", "/api/auth/email/verify", "/api/auth/password/forgot", "/api/auth/password/reset"].includes(path) ? "POST" : null;
      if (!method) return response({ code: "not_found" }, 404);
      if (!method.split(", ").includes(request.method)) return response({ code: "method_not_allowed" }, 405, { Allow: method });
      const ipKey = hashToken(clientAddress);
      limit(`api:${ipKey}`, 300, 60_000);
      if (request.method !== "GET") {
        if (!origins.has(request.headers.get("origin") ?? "") || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "origin-not-allowed");
      }
      if (path === "/api/auth/session") {
        const user = currentUser(request);
        return response({ user: user ? publicUser(user) : null, emailEnabled: Boolean(sendMail), googleEnabled: [...googleCallbacks.keys()].some(origin => new URL(origin).host === url.host) }, 200, !user && tokenFrom(request) ? { "Set-Cookie": cookie("", 0) } : {});
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
        // Cookies can change in another tab or while a previous account request is in flight.
        if (request.headers.get("x-prapor-account") !== user.id) throw new ApiError(401, "account-changed");
        const current = readSave.get(user.id);
        if (!current) throw new ApiError(503, "service-unavailable");
        if (request.method === "GET") return response({ revision: current.revision, savedAt: current.saved_at, save: current.save });
        // Old client-authored documents remain exportable, but can never become trusted game state.
        return response({ code: "server_authoritative" }, 410);
      }
      limit(`auth-ip:${ipKey}`, 120, 15 * 60_000);
      if (path === "/api/auth/google") {
        if (!google) throw new ApiError(503, "google-disabled");
        const body = await readJson(request, AUTH_BODY_BYTES);
        if (!exactKeys(body, ["intent"]) || !["login", "link"].includes(String(body.intent))) throw new ApiError(400, "invalid-request");
        const origin = request.headers.get("origin")!, redirectUri = googleCallbacks.get(origin);
        if (!redirectUri || new URL(origin).host !== url.host) throw new ApiError(503, "google-unavailable");
        limit(`google-start:${ipKey}`, 20, 60_000);
        const user = body.intent === "link" ? authenticatedAccount(request) : currentUser(request);
        if (Number(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM google_attempts").get()?.count) >= 10_000) throw new ApiError(429, "server-busy", 60);
        const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url"), token = tokenFrom(request);
        const previous = googleStateFrom(request);
        db.transaction(() => {
          if (previous) db.query("DELETE FROM google_attempts WHERE state_hash=?").run(hashToken(previous));
          db.query("INSERT INTO google_attempts(state_hash,verifier,nonce,redirect_uri,intent,user_id,credential_version,session_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?)").run(hashToken(state), verifier, nonce, redirectUri, String(body.intent), user?.id ?? null, user?.credential_version ?? null, token ? hashToken(token) : null, now() + 600_000);
        })();
        const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authorization.search = new URLSearchParams({ client_id: google.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email", state, nonce,
          code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", prompt: "select_account" }).toString();
        return response({ url: authorization.href }, 200, { "Set-Cookie": googleCookie(state) });
      }
      if (path === "/api/auth/email" || path === "/api/auth/email/resend") {
        const user = authenticatedAccount(request);
        if (!sendMail) throw new ApiError(503, "email-disabled");
        const body = await readJson(request, AUTH_BODY_BYTES);
        const attaching = path === "/api/auth/email";
        if (!exactKeys(body, attaching ? ["email", "password"] : [])) throw new ApiError(400, "invalid-request");
        const email = attaching ? normalizeEmail(body.email) : user.pending_email;
        if (!email) throw new ApiError(400, attaching ? "invalid-email" : "email-already-verified");
        if (attaching) {
          if (!user.password_enabled) throw new ApiError(400, "password-required");
          if (!validPassword(body.password)) throw new ApiError(400, "invalid-request");
          limit(`auth-user:${hashToken(user.username.toLowerCase())}`, 8, 15 * 60_000);
          const matches = await withHash(() => Bun.password.verify(body.password as string, user.password_hash));
          if (!matches) throw new ApiError(401, "invalid-credentials");
          if (email === user.email) throw new ApiError(400, "email-already-verified");
        }
        const ticket = issueEmailTicket(user, "verify", email, request, attaching);
        const emailDelivery = await deliverEmail(ticket);
        const fresh = assertCurrentCredentials(ticket.user, request);
        return response({ user: publicUser(fresh), emailDelivery });
      }
      if (path === "/api/auth/password/forgot") {
        const body = await readJson(request, AUTH_BODY_BYTES);
        const email = normalizeEmail(body.email);
        if (!exactKeys(body, ["email"]) || !email) throw new ApiError(400, "invalid-email");
        // Rate limiting and delivery outcomes do not reveal which verified addresses belong to accounts.
        try {
          limit(`forgot-ip:${ipKey}`, 20, 60 * 60_000);
          limit(`forgot-email:${hashToken(email)}`, 1, 60_000);
          const user = db.query<UserRow, [string]>("SELECT * FROM users WHERE email=? AND email_verified_at IS NOT NULL").get(email);
          if (user && sendMail) void deliverEmail(issueEmailTicket(user, "reset", email));
        } catch { /* The public response is identical for absent, throttled, disabled and failed mail. */ }
        return response({ ok: true });
      }
      if (path === "/api/auth/email/verify") {
        const body = await readJson(request, AUTH_BODY_BYTES);
        if (!exactKeys(body, ["token"])) throw new ApiError(400, "invalid-token");
        limit(`email-token:${ipKey}`, 30, 15 * 60_000);
        const user = db.transaction(() => {
          const { ticket, user } = readTicket(body.token, "verify");
          const existing = db.query<{ id: string }, [string]>("SELECT id FROM users WHERE email=?").get(ticket.email);
          if (existing && existing.id !== user.id) throw new ApiError(409, "email-taken");
          db.query("UPDATE users SET email=?,email_verified_at=?,pending_email=NULL,email_version=email_version+1 WHERE id=?").run(ticket.email, now(), user.id);
          db.query("DELETE FROM email_tickets WHERE user_id=?").run(user.id);
          return findUserById.get(user.id)!;
        })();
        return response({ ok: true, user: publicUser(user) });
      }
      if (path === "/api/auth/password/reset") {
        const body = await readJson(request, AUTH_BODY_BYTES);
        if (!exactKeys(body, ["token", "password"]) || !validPassword(body.password)) throw new ApiError(400, "invalid-request");
        limit(`email-token:${ipKey}`, 30, 15 * 60_000);
        const proof = readTicket(body.token, "reset");
        limit(`auth-user:${hashToken(proof.user.username.toLowerCase())}`, 8, 15 * 60_000);
        const passwordHash = await withHash(() => Bun.password.hash(body.password as string, { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 }));
        const nextCode = recoveryCode();
        db.transaction(() => {
          readTicket(body.token, "reset");
          db.query("UPDATE users SET password_hash=?,recovery_hash=?,password_enabled=1,credential_version=credential_version+1 WHERE id=?").run(passwordHash, hashRecovery(nextCode), proof.user.id);
          db.query("DELETE FROM sessions WHERE user_id=?").run(proof.user.id);
          db.query("DELETE FROM email_tickets WHERE user_id=?").run(proof.user.id);
        })();
        return response({ recoveryCode: nextCode }, 200, { "Set-Cookie": cookie("", 0) });
      }
      if (path === "/api/auth/register") limit(`register:${ipKey}`, 60, 60 * 60_000);
      const body = await readJson(request, AUTH_BODY_BYTES);
      const keys = path === "/api/auth/recover" ? ["username", "password", "recoveryCode"] : path === "/api/auth/register" && Object.hasOwn(body, "email") ? ["username", "password", "email"] : ["username", "password"];
      if (!exactKeys(body, keys) || !validUsername(body.username) || !validPassword(body.password)) throw new ApiError(400, "invalid-request");
      const username = body.username, password = body.password, usernameKey = username.toLowerCase();
      limit(`auth-user:${hashToken(usernameKey)}`, 8, 15 * 60_000);
      if (path === "/api/auth/register") {
        const email = Object.hasOwn(body, "email") ? normalizeEmail(body.email) : null;
        if (Object.hasOwn(body, "email") && !email) throw new ApiError(400, "invalid-email");
        const passwordHash = await withHash(() => Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 }));
        const id = randomUUID(), code = recoveryCode();
        const user: UserRow = { id, username, password_hash: passwordHash, recovery_hash: hashRecovery(code), credential_version: 1, email: null, email_verified_at: null, pending_email: email, email_version: 1, email_sent_at: null, reset_sent_at: null, password_enabled: 1 };
        const token = db.transaction(() => {
          if (findUser.get(usernameKey)) throw new ApiError(409, "username-taken");
          db.query("INSERT INTO users(id,username,username_key,password_hash,recovery_hash,created_at,pending_email) VALUES(?,?,?,?,?,?,?)").run(id, username, usernameKey, passwordHash, user.recovery_hash, now(), email);
          db.query("INSERT INTO saves(user_id) VALUES(?)").run(id);
          return newSession(user, request);
        })();
        let emailDelivery: "sent" | "failed" | "disabled" | "none" = email ? "disabled" : "none";
        if (email && sendMail) {
          try { emailDelivery = await deliverEmail(issueEmailTicket(user, "verify", email)); }
          catch { emailDelivery = "failed"; }
        }
        return response({ user: publicUser(findUserById.get(id)!), recoveryCode: code, emailDelivery }, 201, { "Set-Cookie": cookie(token) });
      }
      const user = findUser.get(usernameKey);
      if (path === "/api/auth/login") {
        const matches = await withHash(() => Bun.password.verify(password, user?.password_enabled ? user.password_hash : dummyHash));
        if (!matches || !user || !user.password_enabled) throw new ApiError(401, "invalid-credentials");
        const token = db.transaction(() => newSession(user, request))();
        return response({ user: publicUser(user) }, 200, { "Set-Cookie": cookie(token) });
      }
      const code = normalizeRecovery(body.recoveryCode);
      const candidate = hashRecovery(code ?? "invalid"), expected = user?.recovery_hash ?? hashToken("unknown");
      if (!timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex")) || !code || !user || !user.password_enabled) throw new ApiError(401, "invalid-recovery");
      const passwordHash = await withHash(() => Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 }));
      const nextCode = recoveryCode();
      db.transaction(() => {
        const changed = db.query("UPDATE users SET password_hash=?, recovery_hash=?, credential_version=credential_version+1 WHERE id=? AND recovery_hash=? AND credential_version=?").run(passwordHash, hashRecovery(nextCode), user.id, user.recovery_hash, user.credential_version);
        if (changed.changes !== 1) throw new ApiError(401, "invalid-recovery");
        db.query("DELETE FROM sessions WHERE user_id=?").run(user.id);
        db.query("DELETE FROM email_tickets WHERE user_id=?").run(user.id);
      })();
      return response({ recoveryCode: nextCode }, 200, { "Set-Cookie": cookie("", 0) });
    } catch (error) {
      if (error instanceof ApiError) return response({ code: error.code.replaceAll("-", "_") }, error.status, error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
      return response({ code: "service_unavailable" }, 503);
    }
  }
  return { fetch: fetchApi, resolveLiveIdentity: request => {
    if (closed) throw new Error("Account service unavailable");
    const user = currentUser(request);
    return user ? { id: user.id, name: user.username } : null;
  }, healthy: () => { try { return !closed && Boolean(db.query("SELECT 1 AS ready").get()); } catch { return false; } }, close: () => { if (!closed) { closed = true; db.close(); } } };
}
