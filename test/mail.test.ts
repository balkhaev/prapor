import { describe, expect, test } from "bun:test";
import { createResendSender, readResendSender, type AccountMail } from "../server/mail";

const message: AccountMail = { to: "recipient@example.com", username: '<img src=x onerror="secret">', purpose: "verify", url: "https://game.balkhaev.com/#account-verify=opaque-token", ticketId: "a8ca7735-fbde-4a29-b5aa-9b8bcb68ec17" };
describe("Resend account mail", () => {
  test("uses server-only authorization, a stable idempotency key and escaped HTML plus plain text", async () => {
    let endpoint: string | null = null, captured: RequestInit | undefined;
    const fetcher = (async (url, init) => { endpoint = String(url); captured = init; return Response.json({ id: "provider-message-id" }); }) as typeof fetch;
    await createResendSender({ apiKey: "fake-private-key", fetch: fetcher })(message);
    expect(String(endpoint)).toBe("https://api.resend.com/emails");
    const headers = new Headers(captured!.headers);
    expect(headers.get("authorization")).toBe("Bearer fake-private-key");
    expect(headers.get("idempotency-key")).toBe(message.ticketId);
    const body = JSON.parse(String(captured!.body)) as { from: string; to: string[]; subject: string; text: string; html: string };
    expect(body.from).toBe("ggpick <noreply@ggpick.club>");
    expect(body.to).toEqual([message.to]);
    expect(body.subject).toContain("Прапор");
    expect(body.text).toContain(message.url);
    expect(body.html).toContain("&lt;img src=x onerror=&quot;secret&quot;&gt;");
    expect(body.html).not.toContain(message.username);
    expect(body.html).toContain(message.url);
    expect(body.text).not.toContain("fake-private-key");
    expect(body.html).not.toContain("fake-private-key");
  });
  test("provider failures and thrown network diagnostics are sanitized", async () => {
    for (const fetcher of [(async () => Response.json({ error: "secret provider diagnostics" }, { status: 401 })) as unknown as typeof fetch, (async () => { throw new Error("fake-private-key opaque-token"); }) as unknown as typeof fetch]) {
      await expect(createResendSender({ apiKey: "fake-private-key", fetch: fetcher })(message)).rejects.toThrow("Mail delivery failed");
    }
    expect(readResendSender({})).toBeNull();
    expect(() => createResendSender({ apiKey: "bad\r\nheader" })).toThrow("Invalid mail configuration");
    expect(() => createResendSender({ apiKey: "fake", from: "bad\nfrom" })).toThrow("Invalid mail sender");
  });
  test("the request has a finite timeout and resets have their own actionable wording", async () => {
    let text = "";
    const fetcher = (async (_url, init) => {
      text = (JSON.parse(String(init?.body)) as { text: string }).text;
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    }) as typeof fetch;
    await expect(createResendSender({ apiKey: "fake", timeoutMs: 20, fetch: fetcher })({ ...message, purpose: "reset" })).rejects.toThrow("Mail delivery failed");
    expect(text).toContain("30 минут");
    expect(text).toContain("Изменить пароль");
  });
});
