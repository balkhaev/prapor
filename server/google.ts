import { readFileSync } from "node:fs";
import { OAuth2Client, type TokenPayload } from "google-auth-library";

export const GOOGLE_CALLBACK_PATH = "/callback/auth/google";
export interface GoogleProof { code: string; redirectUri: string; verifier: string; nonce: string }
export interface GoogleProfile { subject: string; email: string; emailAuthoritative: boolean }
export interface GoogleOptions {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  exchange?: (proof: GoogleProof) => Promise<GoogleProfile>;
}

/** The library checks Google's signature, issuer, audience and token lifetime. */
export function readGoogleClaims(payload: TokenPayload | undefined, nonce: string, now = Date.now()): GoogleProfile {
  if (!payload || (payload as TokenPayload & { nonce?: unknown }).nonce !== nonce
    || typeof payload.sub !== "string" || !/^[\x21-\x7e]{1,255}$/.test(payload.sub)
    || payload.email_verified !== true || typeof payload.email !== "string"
    || !Number.isFinite(payload.exp) || payload.exp * 1000 <= now) throw new Error("Invalid Google identity");
  return { subject: payload.sub, email: payload.email,
    emailAuthoritative: payload.email.toLowerCase().endsWith("@gmail.com") || typeof payload.hd === "string" && Boolean(payload.hd) };
}

export function createGoogleExchange(options: GoogleOptions, client: OAuth2Client = new OAuth2Client({ clientId: options.clientId, clientSecret: options.clientSecret,
  transporterOptions: { timeout: 10_000, retry: false } })): (proof: GoogleProof) => Promise<GoogleProfile> {
  // OAuth2Client enables POST retries per request; override them after defaults merge.
  client.transporter.interceptors.request.add({ resolved: async request => {
    request.retry = false; request.retryConfig = { ...request.retryConfig, retry: 0, noResponseRetries: 0 };
    request.timeout = 10_000; request.maxRedirects = 0;
    return request;
  } });
  return async proof => {
    const { tokens } = await client.getToken({ code: proof.code, codeVerifier: proof.verifier, redirect_uri: proof.redirectUri });
    if (!tokens.id_token) throw new Error("Missing Google identity");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: options.clientId });
    return readGoogleClaims(ticket.getPayload(), proof.nonce);
  };
}

/** Server-only credentials. Partial or unreadable configuration must fail startup. */
export function readGoogleOptions(env: Record<string, string | undefined>): GoogleOptions | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  let clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (env.GOOGLE_CLIENT_SECRET_FILE) {
    if (clientSecret) throw new Error("Configure one Google client secret source");
    try { clientSecret = readFileSync(env.GOOGLE_CLIENT_SECRET_FILE, "utf8").trim(); }
    catch { throw new Error("Cannot read configured Google client secret file"); }
  }
  const redirectUris = (env.GOOGLE_REDIRECT_URIS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (!clientId && !clientSecret && !redirectUris.length) return null;
  if (!clientId || !clientSecret || !redirectUris.length) throw new Error("Incomplete Google OAuth configuration");
  return { clientId, clientSecret, redirectUris };
}
