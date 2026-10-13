import "./account.css";
import { accountApi, accountErrorMessage, type AccountSavedAt, type AccountUser } from "./account-client";

export type AccountAuthSource = "login" | "register" | "session";
export type AccountStatusTone = "neutral" | "success" | "warning";
export type ProgressChoice = "server" | "local" | "cancel";

export interface ProgressChoiceOptions {
	serverSavedAt: AccountSavedAt;
	localSavedAt?: AccountSavedAt;
	serverSummary?: string;
	localSummary?: string;
	message?: string;
}

export interface AccountUIOptions {
	root: HTMLElement;
	onAuthenticated: (user: AccountUser, source: AccountAuthSource) => void | Promise<void>;
	onLogout: () => void | Promise<void>;
	onBeforeLogout?: () => boolean | Promise<boolean>;
	onDialogChange?: (open: boolean) => void;
	onSync?: () => void | Promise<void>;
	onReconnect?: () => void | Promise<void>;
}

export interface AccountUI {
	setUser: (user: AccountUser | null) => void;
	setStatus: (text: string, tone?: AccountStatusTone) => void;
	open: () => void;
	chooseProgress: (options: ProgressChoiceOptions) => Promise<ProgressChoice>;
	destroy: () => void;
}

type FormMode = "login" | "register" | "recover";
type DialogMode = FormMode | "dashboard" | "recovery-code" | "progress";

function e(text: string): string {
	return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function dateLabel(value: AccountSavedAt | undefined): string {
	if (value === null || value === undefined) return "Время сохранения неизвестно";
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "Время сохранения неизвестно";
}

/** Account UI is independent of the game state and never stores credentials. */
export function mountAccountUI(options: AccountUIOptions): AccountUI {
	const { root } = options;
	root.classList.add("account-root");
	root.innerHTML = `<button type="button" class="account-launcher" aria-haspopup="dialog"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 4 6v6c0 4.5 3.4 7.3 8 9 4.6-1.7 8-4.5 8-9V6l-8-3Z"/><circle cx="12" cy="10" r="2.5"/><path d="M7.5 17c.5-2.2 2-3.5 4.5-3.5s4 1.3 4.5 3.5"/></svg><span class="account-launcher-label">Аккаунт</span><i aria-hidden="true"></i></button><dialog class="account-dialog" aria-labelledby="account-title" aria-describedby="account-description"><div class="account-dialog-head"><div><span class="account-eyebrow">Личное дело</span><h2 id="account-title"></h2></div><button type="button" class="account-close" aria-label="Закрыть аккаунт">×</button></div><div class="account-dialog-body"></div></dialog>`;
	const launcher = root.querySelector<HTMLButtonElement>(".account-launcher")!;
	const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
	const title = root.querySelector<HTMLElement>("#account-title")!;
	const close = root.querySelector<HTMLButtonElement>(".account-close")!;
	const body = root.querySelector<HTMLElement>(".account-dialog-body")!;
	let user: AccountUser | null = null;
	let status = "Гостевая игра · прогресс на этом устройстве";
	let statusTone: AccountStatusTone = "neutral";
	let mode: DialogMode = "login";
	let busy = false;
	let workflowDepth = 0;
	let origin: HTMLElement | null = null;
	let rememberedUsername = "";
	let recoveryCode = "";
	let recoveryAcknowledged = false;
	let secretContinue: (() => Promise<void>) | null = null;
	let pendingChoice: { promise: Promise<ProgressChoice>; resolve: (choice: ProgressChoice) => void } | null = null;
	let progressOptions: ProgressChoiceOptions | null = null;
	let disposed = false;

	function updateLauncher() {
		launcher.querySelector<HTMLElement>(".account-launcher-label")!.textContent = user?.username ?? "Аккаунт";
		launcher.classList.toggle("account-signed-in", Boolean(user));
		launcher.dataset.tone = statusTone;
		launcher.title = `${user ? `Аккаунт ${user.username}` : "Регистрация и вход"} · ${status}`;
		launcher.setAttribute("aria-label", user ? `Аккаунт ${user.username}. ${status}` : `Аккаунт. ${status}`);
		if (mode === "dashboard" && dialog.open) {
			const note = body.querySelector<HTMLElement>("[data-account-status]");
			if (note) { note.textContent = status; note.dataset.tone = statusTone; }
		}
	}

	function setStatus(text: string, tone: AccountStatusTone = "neutral") {
		status = text;
		statusTone = tone;
		updateLauncher();
	}

	function setUser(next: AccountUser | null) {
		user = next;
		if (next) rememberedUsername = next.username;
		updateLauncher();
		if (mode === "dashboard" && dialog.open && !busy) renderDashboard();
	}

	function showDialog() {
		if (dialog.open || disposed) return;
		origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		options.onDialogChange?.(true);
		dialog.showModal();
		launcher.setAttribute("aria-expanded", "true");
	}

	function focusFirst() {
		queueMicrotask(() => {
			if (!dialog.open || disposed) return;
			body.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), button:not(:disabled)")?.focus({ preventScroll: true });
		});
	}

	function finishClose() {
		if (!dialog.open) return;
		dialog.close();
		launcher.setAttribute("aria-expanded", "false");
		options.onDialogChange?.(false);
		const restore = origin?.isConnected ? origin : launcher;
		restore.focus({ preventScroll: true });
		origin = null;
		body.replaceChildren();
	}

	function attemptClose() {
		if (mode === "recovery-code" && recoveryCode) {
			showError(recoveryAcknowledged ? "Нажми «Сохранено · продолжить», чтобы завершить настройку аккаунта." : "Сохрани код и отметь это ниже. Он больше не будет показан.");
			return;
		}
		if (busy) return;
		if (pendingChoice) {
			const choice = pendingChoice;
			pendingChoice = null;
			progressOptions = null;
			choice.resolve("cancel");
			// The caller may still need to finish authentication or update its status.
			renderDashboard();
			setBusy(workflowDepth > 0);
			return;
		}
		finishClose();
	}

	function setBusy(next: boolean, label?: string) {
		busy = next;
		dialog.setAttribute("aria-busy", String(next));
		close.disabled = next || mode === "recovery-code";
		for (const control of body.querySelectorAll<HTMLButtonElement | HTMLInputElement>("[data-lock]")) control.disabled = next;
		const submit = body.querySelector<HTMLButtonElement>("[data-submit]");
		if (submit) {
			if (next && label) { submit.dataset.idleLabel = submit.textContent ?? ""; submit.textContent = label; }
			else if (submit.dataset.idleLabel) { submit.textContent = submit.dataset.idleLabel; delete submit.dataset.idleLabel; }
		}
	}

	function showError(message: string) {
		const box = body.querySelector<HTMLElement>("[data-account-error]");
		if (box) { box.textContent = message; box.hidden = false; }
	}

	function clearError() {
		const box = body.querySelector<HTMLElement>("[data-account-error]");
		if (box) { box.textContent = ""; box.hidden = true; }
	}

	const errorMarkup = `<p class="account-error" role="alert" data-account-error hidden></p>`;

	function renderForm(next: FormMode, notice?: string) {
		mode = next;
		busy = false;
		dialog.setAttribute("aria-busy", "false");
		close.disabled = false;
		const recovering = next === "recover";
		const registering = next === "register";
		const passwordLabel = recovering ? "Новый пароль" : "Пароль";
		title.textContent = registering ? "Создать аккаунт" : recovering ? "Вернуть доступ" : "Войти в аккаунт";
		body.innerHTML = `<p id="account-description" class="account-intro">${registering ? "Закрепи позывной и сохрани убежище в аккаунте. Можно продолжать играть без регистрации." : recovering ? "Введи свой позывной и сохранённый код. Все старые сессии будут завершены; после смены пароля войди заново." : "Продолжи свою игру на другом устройстве. Гостевой прогресс остаётся в этом браузере."}</p>${!recovering ? `<div class="account-tabs" role="group" aria-label="Регистрация и вход"><button type="button" data-mode="login" data-lock aria-pressed="${!registering}">Вход</button><button type="button" data-mode="register" data-lock aria-pressed="${registering}">Регистрация</button></div>` : ""}${notice ? `<p class="account-notice">${e(notice)}</p>` : ""}<form class="account-form"><label class="account-field" for="account-username">Позывной<input id="account-username" name="username" value="${e(rememberedUsername)}" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="24" pattern="[A-Za-z0-9_-]{3,24}" required data-lock autofocus aria-describedby="account-username-hint"></label><p class="account-field-hint" id="account-username-hint">3–24 символа: латинские буквы, цифры, _ и -. Регистр букв не важен.</p>${recovering ? `<label class="account-field" for="account-recovery">Код восстановления<input id="account-recovery" name="recoveryCode" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="128" required data-lock placeholder="Код из сохранённого личного дела"></label>` : ""}<label class="account-field" for="account-password">${passwordLabel}<span class="account-password-field"><input id="account-password" name="password" type="password" autocomplete="${registering || recovering ? "new-password" : "current-password"}" minlength="12" maxlength="128" required data-lock aria-describedby="account-password-hint"><button type="button" class="account-password-toggle" data-show-password="account-password" data-lock aria-pressed="false" aria-label="Показать пароль">Показать</button></span></label><p class="account-field-hint" id="account-password-hint">12–128 символов. Подойдёт длинная фраза; сохрани пароль в менеджере паролей.</p>${registering || recovering ? `<label class="account-field" for="account-password-repeat">Повтори ${recovering ? "новый " : ""}пароль<span class="account-password-field"><input id="account-password-repeat" name="passwordRepeat" type="password" autocomplete="new-password" minlength="12" maxlength="128" required data-lock><button type="button" class="account-password-toggle" data-show-password="account-password-repeat" data-lock aria-pressed="false" aria-label="Показать повтор пароля">Показать</button></span></label>` : ""}${registering ? `<p class="account-footnote">Почта и телефон не нужны. После регистрации мы один раз покажем код восстановления — сохрани его отдельно от пароля.</p>` : ""}${errorMarkup}<button type="submit" class="account-button account-primary" data-submit data-lock>${registering ? "Создать аккаунт" : recovering ? "Изменить пароль" : "Войти"}</button></form><div class="account-form-footer"><button type="button" class="account-text-button" data-mode="${recovering ? "login" : "recover"}" data-lock>${recovering ? "Назад ко входу" : "Забыл пароль"}</button><button type="button" class="account-text-button" data-close data-lock>Продолжить без аккаунта</button></div>`;
		focusFirst();
	}

	function renderDashboard() {
		if (!user) { renderForm("login"); return; }
		mode = "dashboard";
		busy = false;
		dialog.setAttribute("aria-busy", "false");
		close.disabled = false;
		title.textContent = user.username;
		body.innerHTML = `<p id="account-description" class="account-intro">Личное дело доступно на других устройствах. Подключи убежище к аккаунту, чтобы продолжить игру после входа.</p><div class="account-summary"><span class="account-eyebrow">Связь с аккаунтом</span><p class="account-sync-status" data-account-status data-tone="${statusTone}" role="status">${e(status)}</p></div>${errorMarkup}<div class="account-actions">${options.onSync ? `<button type="button" class="account-button account-primary" data-sync data-lock>Синхронизировать</button>` : ""}${options.onReconnect ? `<button type="button" class="account-button" data-reconnect data-lock>Подключить убежище</button>` : ""}<button type="button" class="account-button" data-close data-lock>Вернуться в штаб</button></div><p class="account-footnote">После выхода сохранение остаётся в этом браузере. На другом устройстве для доступа к нему понадобится вход.</p><button type="button" class="account-text-button account-logout" data-logout data-lock>Выйти из аккаунта</button>`;
		focusFirst();
	}

	function open() {
		if (disposed) return;
		if (!dialog.open) { user ? renderDashboard() : renderForm("login"); showDialog(); focusFirst(); }
	}

	function renderRecoveryCode(code: string, continuation: () => Promise<void>, afterRecovery: boolean) {
		mode = "recovery-code";
		busy = false;
		dialog.setAttribute("aria-busy", "false");
		recoveryCode = code;
		recoveryAcknowledged = false;
		secretContinue = continuation;
		close.disabled = true;
		title.textContent = "Сохрани код восстановления";
		body.innerHTML = `<p id="account-description" class="account-intro">${afterRecovery ? "Пароль изменён. Старый код больше не действует. " : "Аккаунт создан. "}Этот код показывается один раз. Он позволяет сменить пароль и получить доступ к аккаунту.</p><div class="account-code-card"><label for="account-secret" class="account-eyebrow">Твой новый код</label><textarea id="account-secret" class="account-secret" rows="2" readonly spellcheck="false" aria-label="Код восстановления"></textarea><div class="account-code-actions"><button type="button" class="account-button" data-copy-code>Скопировать</button><button type="button" class="account-button" data-download-code>Скачать .txt</button></div><p class="account-field-hint" role="status" data-code-status>Храни его в безопасном месте. Не отправляй другим людям.</p></div><label class="account-acknowledgment"><input type="checkbox" data-code-ack> <span>Я сохранил код и понимаю, что его больше не покажут</span></label>${errorMarkup}<button type="button" class="account-button account-primary" data-code-continue disabled>${afterRecovery ? "Сохранено · перейти ко входу" : "Сохранено · продолжить"}</button>`;
		body.querySelector<HTMLTextAreaElement>("#account-secret")!.value = code;
		focusFirst();
	}

	async function authenticate(account: AccountUser, source: AccountAuthSource) {
		workflowDepth++;
		setUser(account);
		renderDashboard();
		setBusy(true);
		try {
			await options.onAuthenticated(account, source);
			if (!disposed) renderDashboard();
		} catch (error) {
			if (!disposed) { renderDashboard(); showError(accountErrorMessage(error)); setStatus("Вход выполнен; подключение сохранения требует внимания", "warning"); }
		} finally {
			workflowDepth--;
			if (!disposed) setBusy(false);
		}
	}

	async function submitForm(form: HTMLFormElement) {
		if (busy || !["login", "register", "recover"].includes(mode)) return;
		clearError();
		if (!form.reportValidity()) return;
		const data = new FormData(form);
		const username = String(data.get("username") ?? "").trim();
		const password = String(data.get("password") ?? "");
		const repeat = String(data.get("passwordRepeat") ?? "");
		if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) { showError("Позывной: 3–24 латинских символа, цифры, _ или -."); return; }
		if (password.length < 12 || password.length > 128) { showError("Пароль должен содержать от 12 до 128 символов."); return; }
		if (mode !== "login" && password !== repeat) { showError("Пароли не совпадают. Введи одинаковый пароль в обоих полях."); form.querySelector<HTMLInputElement>("#account-password-repeat")?.focus(); return; }
		rememberedUsername = username;
		const submittedMode = mode;
		setBusy(true, submittedMode === "register" ? "Создаём аккаунт…" : submittedMode === "recover" ? "Меняем пароль…" : "Входим…");
		try {
			if (submittedMode === "register") {
				const result = await accountApi.register(username, password);
				if (disposed) return;
				setUser(result.user);
				setStatus("Аккаунт создан · сохрани код восстановления", "neutral");
				renderRecoveryCode(result.recoveryCode, () => authenticate(result.user, "register"), false);
			} else if (submittedMode === "recover") {
				const code = String(data.get("recoveryCode") ?? "").trim();
				const result = await accountApi.recover(username, code, password);
				if (disposed) return;
				setUser(null);
				renderRecoveryCode(result.recoveryCode, async () => { renderForm("login", "Пароль изменён. Войди с новым паролем."); }, true);
			} else {
				const result = await accountApi.login(username, password);
				if (disposed) return;
				await authenticate(result.user, "login");
			}
		} catch (error) {
			if (!disposed) showError(accountErrorMessage(error));
		} finally {
			if (!disposed && mode !== "recovery-code") setBusy(false);
		}
	}

	function renderProgress(settings: ProgressChoiceOptions, replacing?: "server" | "local") {
		mode = "progress";
		busy = false;
		dialog.setAttribute("aria-busy", "false");
		close.disabled = false;
		title.textContent = replacing ? "Заменить сохранение?" : "Какое убежище продолжить?";
		const intro = replacing === "local" ? "Текущее убежище с этого устройства заменит сохранение в аккаунте. Другие устройства получат эту версию при следующем входе." : replacing === "server" ? "Сохранение из аккаунта заменит текущий прогресс в этом браузере. Убежища не объединяются." : settings.message ?? "В аккаунте и на этом устройстве есть прогресс. Выбери, какое убежище продолжить. Убежища не объединяются.";
		body.innerHTML = `<p id="account-description" class="account-intro">${e(intro)}</p><div class="account-progress-grid"><article class="account-progress-card ${replacing === "server" ? "account-selected" : ""}"><span class="account-eyebrow">В аккаунте</span><h3>Убежище ${e(user?.username ?? "в аккаунте")}</h3><p>${e(settings.serverSummary ?? "Сохранённый отряд, постройки и запасы")}</p><small>${e(dateLabel(settings.serverSavedAt))}</small>${!replacing ? `<button type="button" class="account-button account-primary" data-choose="server">Продолжить из аккаунта</button>` : ""}</article><article class="account-progress-card ${replacing === "local" ? "account-selected" : ""}"><span class="account-eyebrow">На этом устройстве</span><h3>Текущее убежище</h3><p>${e(settings.localSummary ?? "Прогресс в этом браузере")}</p><small>${e(dateLabel(settings.localSavedAt))}</small>${!replacing ? `<button type="button" class="account-button" data-choose="local">Сохранить это убежище в аккаунт</button>` : ""}</article></div>${errorMarkup}${replacing ? `<div class="account-actions"><button type="button" class="account-button account-primary" data-confirm-choice="${replacing}">${replacing === "local" ? "Заменить сохранение в аккаунте" : "Заменить прогресс на этом устройстве"}</button><button type="button" class="account-button" data-choice-back>Вернуться к выбору</button></div>` : ""}<button type="button" class="account-text-button" data-cancel-choice>Решить позже · продолжить на этом устройстве</button>`;
		focusFirst();
	}

	function chooseProgress(settings: ProgressChoiceOptions): Promise<ProgressChoice> {
		if (disposed) return Promise.resolve("cancel");
		if (mode === "recovery-code" && recoveryCode) return Promise.reject(new Error("Сначала сохрани код восстановления."));
		if (pendingChoice) return pendingChoice.promise;
		let resolve!: (choice: ProgressChoice) => void;
		const promise = new Promise<ProgressChoice>(done => { resolve = done; });
		pendingChoice = { promise, resolve };
		progressOptions = settings;
		renderProgress(settings);
		showDialog();
		focusFirst();
		return promise;
	}

	function resolveChoice(choice: ProgressChoice) {
		if (!pendingChoice) return;
		const pending = pendingChoice;
		pendingChoice = null;
		progressOptions = null;
		renderDashboard();
		setBusy(workflowDepth > 0);
		pending.resolve(choice);
	}

	async function runSync(reconnect: boolean) {
		if (busy) return;
		workflowDepth++;
		clearError();
		setBusy(true);
		try {
			await (reconnect ? options.onReconnect?.() : options.onSync?.());
			if (!disposed) renderDashboard();
		} catch (error) {
			if (!disposed) { renderDashboard(); showError(accountErrorMessage(error)); }
		} finally { workflowDepth--; if (!disposed) setBusy(false); }
	}

	async function logout() {
		if (busy) return;
		workflowDepth++;
		clearError();
		setBusy(true);
		try {
			if (options.onBeforeLogout && !await options.onBeforeLogout()) return;
			await accountApi.logout();
			setUser(null);
			setStatus("Гостевая игра · прогресс на этом устройстве", "neutral");
			await options.onLogout();
			if (!disposed) renderForm("login", "Ты вышел из аккаунта. Убежище осталось на этом устройстве.");
		} catch (error) { if (!disposed) showError(accountErrorMessage(error)); }
		finally { workflowDepth--; if (!disposed) setBusy(false); }
	}

	async function handleClick(event: MouseEvent) {
		const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
		if (!target || target.disabled) return;
		if (target === close || target.hasAttribute("data-close")) { attemptClose(); return; }
		if (target.dataset.mode && !busy) {
			const usernameInput = body.querySelector<HTMLInputElement>("#account-username");
			if (usernameInput) rememberedUsername = usernameInput.value;
			renderForm(target.dataset.mode as FormMode);
			return;
		}
		if (target.dataset.showPassword) {
			const input = body.querySelector<HTMLInputElement>(`#${target.dataset.showPassword}`);
			if (!input) return;
			const visible = input.type === "password";
			input.type = visible ? "text" : "password";
			target.textContent = visible ? "Скрыть" : "Показать";
			target.setAttribute("aria-pressed", String(visible));
			target.setAttribute("aria-label", `${visible ? "Скрыть" : "Показать"} ${input.id.endsWith("repeat") ? "повтор пароля" : "пароль"}`);
			return;
		}
		if (target.hasAttribute("data-copy-code") && recoveryCode) {
			const note = body.querySelector<HTMLElement>("[data-code-status]")!;
			try { await navigator.clipboard.writeText(recoveryCode); note.textContent = "Код скопирован. Сохрани его в безопасном месте."; }
			catch { const field = body.querySelector<HTMLTextAreaElement>("#account-secret"); field?.focus(); field?.select(); note.textContent = "Автокопирование недоступно. Код выделен — скопируй его вручную."; }
			return;
		}
		if (target.hasAttribute("data-download-code") && recoveryCode) {
			const content = `ПРАПОР — код восстановления\nПозывной: ${rememberedUsername}\nКод: ${recoveryCode}\n\nКод позволяет сменить пароль. Храни его в безопасном месте. Не передавай другим людям.\nПосле восстановления доступа старый код перестаёт действовать.\n`;
			const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
			const link = document.createElement("a"); link.href = url; link.download = `prapor-recovery-${rememberedUsername.replace(/[^A-Za-z0-9_-]/g, "")}.txt`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
			body.querySelector<HTMLElement>("[data-code-status]")!.textContent = "Файл с кодом отправлен на скачивание. Убедись, что он сохранён.";
			return;
		}
		if (target.hasAttribute("data-code-continue") && recoveryAcknowledged && secretContinue) {
			const continuation = secretContinue;
			secretContinue = null;
			recoveryCode = "";
			body.querySelector<HTMLTextAreaElement>("#account-secret")!.value = "";
			setBusy(true);
			await continuation();
			return;
		}
		if (target.dataset.choose && progressOptions) { renderProgress(progressOptions, target.dataset.choose as "server" | "local"); return; }
		if (target.dataset.confirmChoice) { resolveChoice(target.dataset.confirmChoice as "server" | "local"); return; }
		if (target.hasAttribute("data-choice-back") && progressOptions) { renderProgress(progressOptions); return; }
		if (target.hasAttribute("data-cancel-choice")) { resolveChoice("cancel"); return; }
		if (target.hasAttribute("data-sync")) await runSync(false);
		if (target.hasAttribute("data-reconnect")) await runSync(true);
		if (target.hasAttribute("data-logout")) await logout();
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (event.target instanceof HTMLFormElement) void submitForm(event.target);
	}

	function handleChange(event: Event) {
		if (!(event.target instanceof HTMLInputElement) || !event.target.hasAttribute("data-code-ack")) return;
		recoveryAcknowledged = event.target.checked;
		body.querySelector<HTMLButtonElement>("[data-code-continue]")!.disabled = !recoveryAcknowledged;
		if (recoveryAcknowledged) clearError();
	}

	function handleKey(event: KeyboardEvent) {
		if (!dialog.open) return;
		if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); attemptClose(); return; }
		if (event.key !== "Tab") return;
		event.stopPropagation();
		const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(node => !node.hidden && node.getClientRects().length > 0);
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first) { event.preventDefault(); return; }
		if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	}

	function handleCancel(event: Event) { event.preventDefault(); attemptClose(); }
	const clickListener = (event: MouseEvent) => { void handleClick(event); };
	launcher.addEventListener("click", open);
	root.addEventListener("click", clickListener);
	root.addEventListener("submit", handleSubmit);
	root.addEventListener("change", handleChange);
	dialog.addEventListener("keydown", handleKey);
	dialog.addEventListener("cancel", handleCancel);
	updateLauncher();

	return {
		setUser,
		setStatus,
		open,
		chooseProgress,
		destroy() {
			if (mode === "recovery-code" && recoveryCode && !recoveryAcknowledged) return;
			disposed = true;
			pendingChoice?.resolve("cancel");
			pendingChoice = null;
			recoveryCode = "";
			secretContinue = null;
			finishClose();
			root.removeEventListener("click", clickListener);
			launcher.removeEventListener("click", open);
			launcher.remove();
			root.removeEventListener("submit", handleSubmit);
			root.removeEventListener("change", handleChange);
			dialog.removeEventListener("keydown", handleKey);
			dialog.removeEventListener("cancel", handleCancel);
			root.replaceChildren();
		},
	};
}
