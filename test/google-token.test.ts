import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import type { GaxiosOptionsPrepared, GaxiosResponse } from "gaxios";
import { createGoogleExchange, readGoogleClaims, type GoogleProof } from "../server/google";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const NONCE = "n".repeat(43);
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const foreignKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = key.publicKey.export({ type: "spki", format: "pem" }).toString();
const publicJwk = { ...key.publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const proof: GoogleProof = { code: "authorization-code", redirectUri: "https://game.balkhaev.com/callback/auth/google", verifier: "v".repeat(43), nonce: NONCE };
const options = { clientId: CLIENT_ID, clientSecret: "test-only-client-secret", redirectUris: [proof.redirectUri] };

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1234567890", iat: now - 30, exp: now + 3600,
    nonce: NONCE, email: "player@gmail.com", email_verified: true, ...overrides };
}

function signedToken(payload: Record<string, unknown>, privateKey: KeyObject = key.privateKey, kid = "test-key"): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}

function fixture(token: string | null, status = 200) {
  const requests: GaxiosOptionsPrepared[] = [];
  const client = new OAuth2Client({ clientId: CLIENT_ID, clientSecret: options.clientSecret, transporterOptions: {
    timeout: 10_000, retry: false, retryConfig: { retryDelay: 0 },
    adapter: async <T>(config: GaxiosOptionsPrepared): Promise<GaxiosResponse<T>> => {
      requests.push(config);
      const url = config.url.toString();
      let data: unknown;
      if (url === "https://oauth2.googleapis.com/token") data = token ? { id_token: token, access_token: "unused-access-token" } : {};
      else if (url === "https://www.googleapis.com/oauth2/v1/certs") data = { "test-key": publicPem };
      else if (url === "https://www.googleapis.com/oauth2/v3/certs") data = { keys: [publicJwk] };
      else throw new Error(`Unexpected offline OAuth URL: ${url}`);
      return Object.assign(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "max-age=3600" } }), { data: data as T, config });
    },
  } });
  return { exchange: createGoogleExchange(options, client), requests };
}

describe("Google ID token cryptographic verification", () => {
  test("exchanges PKCE proof and verifies an RSA-signed Google token through the official library", async () => {
    const { exchange, requests } = fixture(signedToken(claims()));
    expect(await exchange(proof)).toEqual({ subject: "1234567890", email: "player@gmail.com", emailAuthoritative: true });
    expect(requests.length).toBe(2);
    const tokenRequest = requests[0]!;
    expect(tokenRequest.method).toBe("POST");
    expect(tokenRequest.url.toString()).toBe("https://oauth2.googleapis.com/token");
    const form = tokenRequest.data as URLSearchParams;
    expect(form.get("client_id")).toBe(CLIENT_ID);
    expect(form.get("code")).toBe(proof.code);
    expect(form.get("code_verifier")).toBe(proof.verifier);
    expect(form.get("redirect_uri")).toBe(proof.redirectUri);
    expect(form.get("grant_type")).toBe("authorization_code");
  });

  test("rejects a foreign RSA signature and an unknown signing key", async () => {
    for (const token of [signedToken(claims(), foreignKey.privateKey), signedToken(claims(), key.privateKey, "unknown-key")]) {
      await expect(fixture(token).exchange(proof)).rejects.toThrow();
    }
  });

  test("rejects signed tokens for another issuer or OAuth audience", async () => {
    for (const override of [{ iss: "https://attacker.invalid" }, { aud: "another-client.apps.googleusercontent.com" }]) {
      await expect(fixture(signedToken(claims(override))).exchange(proof)).rejects.toThrow();
    }
  });

  test("rejects expired tokens even inside the library's clock tolerance, and tokens used too early", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const override of [{ exp: now - 1 }, { exp: now - 600 }, { iat: now + 600 }, { exp: now + 100_000 }, { exp: String(now + 3600) }]) {
      await expect(fixture(signedToken(claims(override))).exchange(proof)).rejects.toThrow();
    }
  });

  test("rejects nonce, subject and verified-email claim failures after signature verification", async () => {
    for (const override of [{ nonce: "another-attempt" }, { nonce: undefined }, { sub: "" }, { sub: "x".repeat(256) },
      { email_verified: false }, { email_verified: "true" }, { email: undefined }]) {
      await expect(fixture(signedToken(claims(override))).exchange(proof)).rejects.toThrow();
    }
  });

  test("rejects token responses without an ID token", async () => {
    const { exchange, requests } = fixture(null);
    await expect(exchange(proof)).rejects.toThrow("Missing Google identity");
    expect(requests.length).toBe(1);
  });

  test("does not retry an uncertain authorization-code exchange", async () => {
    const { exchange, requests } = fixture(null, 503);
    await expect(exchange(proof)).rejects.toThrow();
    expect(requests.length).toBe(1);
  });
});

describe("Google recovery-email authority", () => {
  test("only Gmail and hosted-domain claims give Google authority over recovery email", () => {
    const read = (overrides: Record<string, unknown>) => readGoogleClaims(claims(overrides) as unknown as TokenPayload, NONCE);
    expect(read({ email: "Player@GMAIL.COM" }).emailAuthoritative).toBe(true);
    expect(read({ email: "player@company.test", hd: "company.test" }).emailAuthoritative).toBe(true);
    expect(read({ email: "player@third-party.test" }).emailAuthoritative).toBe(false);
    expect(read({ email: "player@third-party.test", hd: "" }).emailAuthoritative).toBe(false);
    expect(read({ email: "player@gmail.com.attacker.test" }).emailAuthoritative).toBe(false);
  });
});
