import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { AccountApiError, accountApi, isAccountGoogleFragment, readAccountGoogleResult } from "../src/account-client";

let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => { fetchMock?.mockRestore(); fetchMock = undefined; });

function respond(body: unknown) {
	fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json(body), { preconnect: globalThis.fetch.preconnect }));
	return fetchMock;
}

describe("Google account client", () => {
	test("only known callback results are accepted and malformed fragments can be removed", () => {
		for (const result of ["success", "linked", "cancelled", "unavailable", "failed", "email-in-use", "already-linked", "session-changed"] as const) expect(readAccountGoogleResult(`#account-google=${result}`)).toBe(result);
		for (const hash of ["", "#help", "#account-google=success&next=evil", "#account-google=%73uccess", "#account-google=", "#account-google=unknown"]) expect(readAccountGoogleResult(hash)).toBeNull();
		expect(isAccountGoogleFragment("#account-google=bad")).toBe(true);
		expect(isAccountGoogleFragment("#account-google")).toBe(true);
		expect(isAccountGoogleFragment("#account-google-notes")).toBe(false);
		expect(isAccountGoogleFragment("#account-reset=bad")).toBe(false);
	});

	test("starts a login without credentials and binds explicit linking to its account", async () => {
		const url = "https://accounts.google.com/o/oauth2/v2/auth?state=test";
		const mocked = respond({ url });
		expect(await accountApi.beginGoogle("login")).toEqual({ url });
		let [path, settings] = mocked.mock.calls[0]!;
		expect(path).toBe("/api/auth/google");
		expect(settings?.method).toBe("POST");
		expect(settings?.credentials).toBe("same-origin");
		expect(settings?.body).toBe('{"intent":"login"}');
		expect(new Headers(settings?.headers).has("X-Prapor-Account")).toBe(false);
		await accountApi.beginGoogle("link", "account-id");
		[path, settings] = mocked.mock.calls[1]!;
		expect(path).toBe("/api/auth/google");
		expect(settings?.body).toBe('{"intent":"link"}');
		expect(new Headers(settings?.headers).get("X-Prapor-Account")).toBe("account-id");
		await expect(accountApi.beginGoogle("link")).rejects.toMatchObject({ status: 401, code: "unauthorized" });
		expect(mocked.mock.calls.length).toBe(2);
	});

	test("rejects unsafe or unexpected redirect targets", async () => {
		const mocked = respond({ url: "https://accounts.google.com/o/oauth2/v2/auth" });
		for (const url of ["javascript:alert(1)", "https://evil.invalid/o/oauth2/v2/auth", "https://accounts.google.com.evil.invalid/o/oauth2/v2/auth", "http://accounts.google.com/o/oauth2/v2/auth", "https://user@accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com:444/o/oauth2/v2/auth", "https://accounts.google.com/o/oauth2/v2/auth#secret", "https://accounts.google.com/other", "/api/auth/google"]) {
			mocked.mockResolvedValue(Response.json({ url }));
			await expect(accountApi.beginGoogle("login")).rejects.toMatchObject({ code: "invalid_response" });
		}
	});

	test("reads authentication availability and Google-only account access accurately", async () => {
		const mocked = respond({ user: { id: "id", username: "Scav_123", email: "scav@example.com", emailVerified: true, pendingEmail: null, googleLinked: true, passwordEnabled: false }, googleEnabled: true, emailEnabled: true });
		expect(await accountApi.session()).toMatchObject({ googleEnabled: true, emailEnabled: true, user: { googleLinked: true, passwordEnabled: false } });
		mocked.mockResolvedValue(Response.json({ user: { id: "id", username: "Scav_123" } }));
		expect(await accountApi.session()).toMatchObject({ googleEnabled: false, emailEnabled: false, user: { googleLinked: false, passwordEnabled: true } });
		mocked.mockResolvedValue(Response.json({ user: { id: "id", username: "Scav_123", googleLinked: "true" } }));
		await expect(accountApi.session()).rejects.toMatchObject({ code: "invalid_response" });
	});

	test("Google unavailability has a useful public message", () => {
		for (const code of ["google_disabled", "google_unavailable"]) expect(new AccountApiError(503, code).message).toContain("Вход через Google сейчас недоступен");
	});
});
