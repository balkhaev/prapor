export interface AccountUser {
	id: string;
	username: string;
	email: string | null;
	emailVerified: boolean;
	pendingEmail: string | null;
}

export type AccountEmailDelivery = "sent" | "failed" | "disabled" | "none" | null;

export interface AccountEmailResult {
	user: AccountUser;
	emailDelivery: AccountEmailDelivery;
}

export type AccountSavedAt = number | string | null;

export interface AccountSave {
	revision: number;
	savedAt: AccountSavedAt;
	save: string | null;
}

export interface AccountSaveReceipt {
	revision: number;
	savedAt: number | string;
}

/** Only vetted messages reach the UI; arbitrary server diagnostics stay private. */
export class AccountApiError extends Error {
	constructor(public readonly status: number, public readonly code: string, public readonly retryAfter: number | null = null) {
		super(messageForError(status, code, retryAfter));
		this.name = "AccountApiError";
	}
}

function messageForError(status: number, code: string, retryAfter: number | null): string {
	if (code === "timeout") return "Сервер не ответил вовремя. Операция могла завершиться. Проверь подключение и состояние аккаунта; после регистрации или смены пароля попробуй войти.";
	if (code === "network") return "Нет связи с сервером. Игра на этом устройстве доступна; попробуй ещё раз, когда появится интернет.";
	if (code === "invalid_response") return "Сервер прислал неполный ответ. Попробуй ещё раз позже.";
	if (code === "email_disabled") return "Отправка писем сейчас недоступна. Вход и восстановление по коду работают.";
	if (["invalid_email", "email_invalid"].includes(code)) return "Введи полный адрес почты, например name@example.com.";
	if (["email_taken", "email_exists"].includes(code)) return "Этот адрес уже привязан к другому аккаунту. Используй другую почту.";
	if (code === "email_already_verified") return "Почта уже подтверждена. Обнови страницу, чтобы увидеть её статус.";
	if (["invalid_token", "expired_token", "token_expired", "invalid_email_token", "invalid_reset_token"].includes(code)) return "Ссылка недействительна или срок её действия истёк. Запроси новое письмо.";
	if (status === 429) return retryAfter && retryAfter > 0 ? `Слишком много попыток. Подожди ${Math.ceil(retryAfter)} сек. и повтори.` : "Слишком много попыток. Подожди немного и повтори.";
	if (status === 409 && ["username_taken", "username_exists", "account_exists"].includes(code)) return "Этот позывной уже занят. Выбери другой или войди в свой аккаунт.";
	if (status === 409) return "В аккаунте появилось более новое сохранение. Выбери убежище для продолжения, прежде чем сохранять снова.";
	if (status === 401 && ["invalid_credentials", "invalid_login"].includes(code)) return "Позывной или пароль не подошли. Проверь их и попробуй снова.";
	if (status === 401 && ["invalid_recovery", "invalid_recovery_code"].includes(code)) return "Позывной или код восстановления не подошли. Проверь их и попробуй снова.";
	if (status === 401 && code === "account_changed") return "В этом браузере выполнен вход в другой аккаунт. Обнови страницу, чтобы продолжить с правильным сохранением. Локальный прогресс сохранён.";
	if (status === 401) return "Сессия завершилась. Войди в аккаунт ещё раз.";
	if (status === 403) return "Запрос отклонён. Обнови страницу и попробуй снова.";
	if (status === 413) return "Сохранение слишком большое. Твой прогресс остаётся на этом устройстве.";
	if (code === "invalid_save") return "Сохранение не прошло проверку сервера. Прогресс остаётся на этом устройстве; экспортируй его через настройки.";
	if (status === 400 || status === 422) return "Проверь данные: позывной — 3–24 латинских символа, цифры, _ или -, пароль — 12–128 символов.";
	if (status >= 500) return "Сервис аккаунтов временно недоступен. Твой прогресс остаётся на этом устройстве.";
	return "Не удалось выполнить действие. Попробуй ещё раз.";
}

export function accountErrorMessage(error: unknown): string {
	return error instanceof AccountApiError ? error.message : "Не удалось завершить действие. Прогресс на этом устройстве сохранён; попробуй ещё раз.";
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUser(value: unknown): AccountUser {
	if (!record(value) || typeof value.id !== "string" || typeof value.username !== "string" || !value.id || !/^[A-Za-z0-9_-]{3,24}$/.test(value.username)) throw new AccountApiError(0, "invalid_response");
	if (!(value.email === undefined || value.email === null || typeof value.email === "string") || !(value.emailVerified === undefined || typeof value.emailVerified === "boolean") || !(value.pendingEmail === undefined || value.pendingEmail === null || typeof value.pendingEmail === "string")) throw new AccountApiError(0, "invalid_response");
	return { id: value.id, username: value.username, email: typeof value.email === "string" ? value.email : null, emailVerified: value.emailVerified === true, pendingEmail: typeof value.pendingEmail === "string" ? value.pendingEmail : null };
}

function readDelivery(value: unknown): AccountEmailDelivery {
	if (value === undefined || value === null) return null;
	if (value === "sent" || value === "failed" || value === "disabled" || value === "none") return value;
	throw new AccountApiError(0, "invalid_response");
}

function readEmailResult(value: Record<string, unknown>): AccountEmailResult {
	return { user: readUser(value.user), emailDelivery: readDelivery(value.emailDelivery) };
}

function readReceipt(value: unknown): Pick<AccountSave, "revision" | "savedAt"> {
	if (!record(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !(value.savedAt === null || typeof value.savedAt === "number" || typeof value.savedAt === "string")) throw new AccountApiError(0, "invalid_response");
	return { revision: value.revision as number, savedAt: value.savedAt as AccountSavedAt };
}

async function request(path: string, method = "GET", body?: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown>> {
	const controller = new AbortController();
	const timeout = globalThis.setTimeout(() => controller.abort(), 20_000);
	try {
		const response = await fetch(path, {
			method,
			credentials: "same-origin",
			mode: "same-origin",
			cache: "no-store",
			redirect: "error",
			headers: { ...(body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" }), ...extraHeaders },
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});
		const payload: unknown = response.status === 204 ? {} : await response.json().catch(() => null);
		if (!response.ok) {
			const code = record(payload) && typeof payload.code === "string" ? payload.code : "request_failed";
			const retryHeader = response.headers.get("Retry-After");
			const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null;
			throw new AccountApiError(response.status, code, retryAfter);
		}
		if (!record(payload)) throw new AccountApiError(0, "invalid_response");
		return payload;
	} catch (error) {
		if (error instanceof AccountApiError) throw error;
		throw new AccountApiError(0, controller.signal.aborted ? "timeout" : "network");
	} finally {
		globalThis.clearTimeout(timeout);
	}
}

export const accountApi = {
	async session(): Promise<{ user: AccountUser | null; emailEnabled: boolean }> {
		const result = await request("/api/auth/session");
		return { user: result.user === null ? null : readUser(result.user), emailEnabled: result.emailEnabled === true };
	},
	async register(username: string, password: string, email?: string): Promise<{ user: AccountUser; recoveryCode: string; emailDelivery: AccountEmailDelivery }> {
		const result = await request("/api/auth/register", "POST", { username, password, ...(email ? { email } : {}) });
		if (typeof result.recoveryCode !== "string" || !result.recoveryCode) throw new AccountApiError(0, "invalid_response");
		return { user: readUser(result.user), recoveryCode: result.recoveryCode, emailDelivery: readDelivery(result.emailDelivery) };
	},
	async login(username: string, password: string): Promise<{ user: AccountUser }> {
		const result = await request("/api/auth/login", "POST", { username, password });
		return { user: readUser(result.user) };
	},
	async recover(username: string, recoveryCode: string, password: string): Promise<{ recoveryCode: string }> {
		const result = await request("/api/auth/recover", "POST", { username, recoveryCode, password });
		if (typeof result.recoveryCode !== "string" || !result.recoveryCode) throw new AccountApiError(0, "invalid_response");
		return { recoveryCode: result.recoveryCode };
	},
	async setEmail(userId: string, email: string, password: string): Promise<AccountEmailResult> {
		return readEmailResult(await request("/api/auth/email", "POST", { email, password }, { "X-Prapor-Account": userId }));
	},
	async resendEmail(userId: string): Promise<AccountEmailResult> {
		return readEmailResult(await request("/api/auth/email/resend", "POST", {}, { "X-Prapor-Account": userId }));
	},
	async forgotPassword(email: string): Promise<void> {
		await request("/api/auth/password/forgot", "POST", { email });
	},
	async verifyEmail(token: string): Promise<{ user: AccountUser | null }> {
		const result = await request("/api/auth/email/verify", "POST", { token });
		return { user: result.user === undefined || result.user === null ? null : readUser(result.user) };
	},
	async resetPassword(token: string, password: string): Promise<{ recoveryCode: string }> {
		const result = await request("/api/auth/password/reset", "POST", { token, password });
		if (typeof result.recoveryCode !== "string" || !result.recoveryCode) throw new AccountApiError(0, "invalid_response");
		return { recoveryCode: result.recoveryCode };
	},
	async logout(): Promise<void> {
		await request("/api/auth/logout", "POST", {});
	},
	async getSave(userId: string): Promise<AccountSave> {
		const result = await request("/api/save", "GET", undefined, { "X-Prapor-Account": userId });
		if (!(typeof result.save === "string" || result.save === null)) throw new AccountApiError(0, "invalid_response");
		return { ...readReceipt(result), save: result.save };
	},
	async putSave(userId: string, revision: number, save: string): Promise<AccountSaveReceipt> {
		const result = readReceipt(await request("/api/save", "PUT", { revision, save }, { "X-Prapor-Account": userId }));
		if (result.savedAt === null) throw new AccountApiError(0, "invalid_response");
		return { revision: result.revision, savedAt: result.savedAt };
	},
};
