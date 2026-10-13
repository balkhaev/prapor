import { readFileSync } from "node:fs";

export interface AccountMail {
  to: string;
  username: string;
  purpose: "verify" | "reset";
  url: string;
  ticketId: string;
}
export type MailSender = (message: AccountMail) => Promise<void>;
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);

/** Provider diagnostics and account tokens never appear in thrown errors or application logs. */
export function createResendSender(options: { apiKey: string; from?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }): MailSender {
  const transport = options.fetch ?? globalThis.fetch;
  const timeout = options.timeoutMs ?? 10_000;
  if (!options.apiKey.trim() || /[\r\n]/.test(options.apiKey) || !Number.isInteger(timeout) || timeout < 1 || timeout > 30_000) throw new Error("Invalid mail configuration");
  const from = options.from ?? "ggpick <noreply@ggpick.club>";
  if (!from || /[\r\n]/.test(from)) throw new Error("Invalid mail sender");
  return async message => {
    const verification = message.purpose === "verify";
    const subject = verification ? "GGPick / Прапор — подтверди почту" : "GGPick / Прапор — восстановление пароля";
    const action = verification ? "Подтвердить почту" : "Изменить пароль";
    const duration = verification ? "24 часа" : "30 минут";
    const text = `GGPick / Прапор\n\nПривет, ${message.username}!\n\n${verification ? "Подтверди почту для своего игрового аккаунта." : "Мы получили запрос на изменение пароля твоего игрового аккаунта."}\n\n${action}: ${message.url}\n\nСсылка действует ${duration} и используется один раз. Открытие письма не выполняет действие — подтверди его на странице игры. Если ты не отправлял запрос, просто проигнорируй это письмо.\n`;
    const html = `<html lang="ru"><body style="font-family:Arial,sans-serif;color:#243526;line-height:1.6;max-width:560px;margin:32px auto;padding:24px"><p style="font-size:12px;letter-spacing:2px">GGPICK / ПРАПОР</p><h1 style="font-size:24px">${escapeHtml(action)}</h1><p>Привет, ${escapeHtml(message.username)}!</p><p>${verification ? "Подтверди почту для своего игрового аккаунта." : "Мы получили запрос на изменение пароля твоего игрового аккаунта."}</p><p><a href="${escapeHtml(message.url)}" style="display:inline-block;background:#314b35;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px">${escapeHtml(action)}</a></p><p>Ссылка действует ${duration} и используется один раз. На странице игры нужно подтвердить действие.</p><p style="font-size:13px">Если кнопка не открывается, скопируй ссылку:<br><a href="${escapeHtml(message.url)}">${escapeHtml(message.url)}</a></p><p style="font-size:13px;color:#586c59">Если ты не отправлял запрос, просто проигнорируй это письмо.</p></body></html>`;
    try {
      const result = await transport("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(timeout),
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.ticketId },
        body: JSON.stringify({ from, to: [message.to], subject, text, html }),
      });
      if (!result.ok) { await result.body?.cancel(); throw new Error("Mail delivery failed"); }
      const body: unknown = await result.json();
      if (!body || typeof body !== "object" || !("id" in body) || typeof body.id !== "string" || !body.id) throw new Error("Mail delivery failed");
    } catch { throw new Error("Mail delivery failed"); }
  };
}

/** Called only on the server. File-backed keys stay outside the repository and browser bundle. */
export function readResendSender(env: Record<string, string | undefined>): MailSender | null {
  let apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey && env.RESEND_API_KEY_FILE) {
    try { apiKey = readFileSync(env.RESEND_API_KEY_FILE, "utf8").trim(); }
    catch { throw new Error("Cannot read configured mail key file"); }
  }
  return apiKey ? createResendSender({ apiKey, from: env.RESEND_FROM }) : null;
}
