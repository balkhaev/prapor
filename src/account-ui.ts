import "./account.css";
import { AccountApiError, accountApi, accountErrorMessage, type AccountEmailDelivery, type AccountSavedAt, type AccountUser } from "./account-client";

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
	onAuthRevoked?: () => void;
	onUserChanged?: (user: AccountUser) => void;
	onEmailVerified?: (user: AccountUser | null) => void | Promise<void>;
}

export interface AccountUI {
	setUser: (user: AccountUser | null) => void;
	setStatus: (text: string, tone?: AccountStatusTone) => void;
	setEmailEnabled: (enabled: boolean) => void;
	handleEmailLink: (kind: "verify" | "reset", token: string) => void;
	open: () => void;
	chooseProgress: (options: ProgressChoiceOptions) => Promise<ProgressChoice>;
	destroy: () => void;
}

type FormMode = "login" | "register" | "recover" | "forgot" | "email" | "reset";
type DialogMode = FormMode | "dashboard" | "recovery-code" | "progress" | "verify";

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
	let status = "Гостевая игра · прогресс на сервере";
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
	let emailEnabled = false;
	let emailNotice = "";
	let resendUntil = 0;
	let forgotUntil = 0;
	let resendTimer: ReturnType<typeof setInterval> | null = null;
	let linkToken = "";
	let deferredLink: { kind: "verify" | "reset"; token: string } | null = null;

	function setEmailEnabled(enabled: boolean) {
		emailEnabled = enabled;
		if (mode === "dashboard" && dialog.open && !busy) renderDashboard();
	}

	function deliveryNotice(delivery: AccountEmailDelivery): string {
		if (delivery === "sent") return "Письмо отправлено. Открой ссылку, чтобы подтвердить почту. Если письма нет, проверь папку «Спам».";
		if (delivery === "failed") return "Адрес сохранён, но письмо отправить не удалось. Попробуй отправить его ещё раз через минуту.";
		if (delivery === "disabled") return "Адрес сохранён. Отправка писем сейчас недоступна; подтвердить почту можно будет позже.";
		return "";
	}

	function stopResendTimer() {
		if (resendTimer !== null) clearInterval(resendTimer);
		resendTimer = null;
	}

	function updateResendButton() {
		const button = body.querySelector<HTMLButtonElement>("[data-resend-email], [data-forgot-submit]");
		if (!button || !dialog.open) { stopResendTimer(); return; }
		const forgottenPassword = button.hasAttribute("data-forgot-submit");
		const seconds = Math.max(0, Math.ceil(((forgottenPassword ? forgotUntil : resendUntil) - Date.now()) / 1000));
		button.disabled = busy || !emailEnabled || seconds > 0;
		button.textContent = seconds > 0 ? `Повторить через ${seconds} сек.` : forgottenPassword ? "Отправить ссылку" : "Отправить письмо ещё раз";
		if (seconds > 0 && resendTimer === null) resendTimer = setInterval(updateResendButton, 1000);
		if (seconds === 0) stopResendTimer();
	}

	function rememberDelivery(delivery: AccountEmailDelivery) {
		emailNotice = deliveryNotice(delivery);
		if (delivery === "sent" || delivery === "failed") resendUntil = Date.now() + 60_000;
	}

	function validEmail(email: string): boolean {
		return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
	}

	function emailField(value = "", required = true): string {
		return `<label class="account-field" for="account-email">Почта${required ? "" : " · необязательно"}<input id="account-email" name="email" value="${e(value)}" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" ${required ? "required" : ""} data-lock ${required ? "autofocus" : ""} aria-describedby="account-email-hint" placeholder="name@example.com"></label><p class="account-field-hint" id="account-email-hint">Для подтверждения адреса и восстановления доступа. Письма придут от noreply@ggpick.club.</p>`;
	}

	function passwordFields(repeat: boolean, current: boolean): string {
		return `<label class="account-field" for="account-password">${current ? "Текущий пароль" : "Новый пароль"}<span class="account-password-field"><input id="account-password" name="password" type="password" autocomplete="${current ? "current-password" : "new-password"}" minlength="12" maxlength="128" required data-lock aria-describedby="account-password-hint"><button type="button" class="account-password-toggle" data-show-password="account-password" data-lock aria-pressed="false" aria-label="Показать пароль">Показать</button></span></label><p class="account-field-hint" id="account-password-hint">12–128 символов. Подойдёт длинная фраза; сохрани пароль в менеджере паролей.</p>${repeat ? `<label class="account-field" for="account-password-repeat">Повтори новый пароль<span class="account-password-field"><input id="account-password-repeat" name="passwordRepeat" type="password" autocomplete="new-password" minlength="12" maxlength="128" required data-lock><button type="button" class="account-password-toggle" data-show-password="account-password-repeat" data-lock aria-pressed="false" aria-label="Показать повтор пароля">Показать</button></span></label>` : ""}`;
	}

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
		if (user?.id !== next?.id) { emailNotice = ""; resendUntil = 0; }
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
		updateResendButton();
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
		linkToken = "";
		stopResendTimer();
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
		updateResendButton();
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

	function renderEmailForm(next: "forgot" | "email" | "reset", notice?: string) {
		if (next === "email" && !user) { renderForm("login"); return; }
		if (next !== "reset") linkToken = "";
		mode = next; busy = false; dialog.setAttribute("aria-busy", "false"); close.disabled = false;
		title.textContent = next === "forgot" ? "Восстановить по почте" : next === "reset" ? "Задать новый пароль" : user?.email ? "Изменить почту" : "Добавить почту";
		const intro = next === "forgot" ? "Введи почту, которую подтвердил в аккаунте. Если адрес подходит, на него придёт ссылка для смены пароля." : next === "reset" ? "Задай новый пароль. Все старые сессии будут завершены. После смены мы покажем новый код восстановления." : user?.emailVerified ? "Новая почта заменит текущую только после подтверждения. До этого восстановление работает через прежний подтверждённый адрес." : "Подтверди адрес по ссылке из письма, чтобы использовать почту для восстановления пароля. Для изменения нужен текущий пароль.";
		body.innerHTML = `<p id="account-description" class="account-intro">${e(intro)}</p>${notice ? `<p class="account-notice">${e(notice)}</p>` : ""}<form class="account-form">${next === "reset" ? passwordFields(true, false) : emailField(next === "email" ? user?.pendingEmail ?? user?.email ?? "" : "")}${next === "email" ? passwordFields(false, true) : ""}${errorMarkup}<button type="submit" class="account-button account-primary" data-submit data-lock ${next === "forgot" ? "data-forgot-submit" : ""}>${next === "forgot" ? "Отправить ссылку" : next === "reset" ? "Изменить пароль" : "Сохранить адрес и отправить письмо"}</button></form><div class="account-form-footer">${next === "email" ? `<button type="button" class="account-text-button" data-dashboard data-lock>Назад в аккаунт</button>` : `<button type="button" class="account-text-button" data-mode="recover" data-lock>Восстановить по коду</button><button type="button" class="account-text-button" data-mode="login" data-lock>Назад ко входу</button>`}</div>`;
		updateResendButton();
		focusFirst();
	}

	function handleEmailLink(kind: "verify" | "reset", token: string) {
		if (disposed) return;
		if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
			if (!busy && !recoveryCode && !pendingChoice) { renderForm(emailEnabled ? "forgot" : "recover", "Ссылка повреждена. Запроси новое письмо или восстанови доступ по коду."); showDialog(); }
			return;
		}
		if (busy || pendingChoice || recoveryCode) { deferredLink = { kind, token }; return; }
		linkToken = token;
		if (kind === "reset") renderEmailForm("reset");
		else {
			mode = "verify"; busy = false; dialog.setAttribute("aria-busy", "false"); close.disabled = false;
			title.textContent = "Подтвердить почту";
			body.innerHTML = `<p id="account-description" class="account-intro">Нажми кнопку, чтобы подтвердить адрес из письма. Подтверждение позволит восстанавливать пароль через эту почту.</p>${errorMarkup}<button type="button" class="account-button account-primary" data-verify-email data-lock>Подтвердить почту</button><button type="button" class="account-text-button" data-close data-lock>Закрыть</button>`;
		}
		showDialog(); focusFirst();
	}

	function openDeferredLink() {
		if (!deferredLink || busy || workflowDepth > 0 || recoveryCode || pendingChoice) return;
		const link = deferredLink; deferredLink = null;
		handleEmailLink(link.kind, link.token);
	}

	function renderForm(next: FormMode, notice?: string) {
		if (next === "email" || next === "forgot" || next === "reset") { renderEmailForm(next, notice); return; }
		linkToken = "";
		mode = next;
		busy = false;
		dialog.setAttribute("aria-busy", "false");
		close.disabled = false;
		const recovering = next === "recover";
		const registering = next === "register";
		const passwordLabel = recovering ? "Новый пароль" : "Пароль";
		title.textContent = registering ? "Создать аккаунт" : recovering ? "Вернуть доступ" : "Войти в аккаунт";
		body.innerHTML = `<p id="account-description" class="account-intro">${registering ? "Закрепи позывной и сохрани убежище в аккаунте. Можно продолжать играть без регистрации." : recovering ? "Введи свой позывной и сохранённый код. Все старые сессии будут завершены; после смены пароля войди заново." : "Продолжи свою игру на другом устройстве. Гостевой прогресс остаётся в этом браузере."}</p>${!recovering ? `<div class="account-tabs" role="group" aria-label="Регистрация и вход"><button type="button" data-mode="login" data-lock aria-pressed="${!registering}">Вход</button><button type="button" data-mode="register" data-lock aria-pressed="${registering}">Регистрация</button></div>` : ""}${notice ? `<p class="account-notice">${e(notice)}</p>` : ""}<form class="account-form"><label class="account-field" for="account-username">Позывной<input id="account-username" name="username" value="${e(rememberedUsername)}" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="24" pattern="[A-Za-z0-9_-]{3,24}" required data-lock autofocus aria-describedby="account-username-hint"></label><p class="account-field-hint" id="account-username-hint">3–24 символа: латинские буквы, цифры, _ и -. Регистр букв не важен.</p>${recovering ? `<label class="account-field" for="account-recovery">Код восстановления<input id="account-recovery" name="recoveryCode" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="128" required data-lock placeholder="Код из сохранённого личного дела"></label>` : ""}<label class="account-field" for="account-password">${passwordLabel}<span class="account-password-field"><input id="account-password" name="password" type="password" autocomplete="${registering || recovering ? "new-password" : "current-password"}" minlength="12" maxlength="128" required data-lock aria-describedby="account-password-hint"><button type="button" class="account-password-toggle" data-show-password="account-password" data-lock aria-pressed="false" aria-label="Показать пароль">Показать</button></span></label><p class="account-field-hint" id="account-password-hint">12–128 символов. Подойдёт длинная фраза; сохрани пароль в менеджере паролей.</p>${registering || recovering ? `<label class="account-field" for="account-password-repeat">Повтори ${recovering ? "новый " : ""}пароль<span class="account-password-field"><input id="account-password-repeat" name="passwordRepeat" type="password" autocomplete="new-password" minlength="12" maxlength="128" required data-lock><button type="button" class="account-password-toggle" data-show-password="account-password-repeat" data-lock aria-pressed="false" aria-label="Показать повтор пароля">Показать</button></span></label>` : ""}${registering ? `<p class="account-footnote">Почта и телефон не нужны. После регистрации мы один раз покажем код восстановления — сохрани его отдельно от пароля.</p>` : ""}${errorMarkup}<button type="submit" class="account-button account-primary" data-submit data-lock>${registering ? "Создать аккаунт" : recovering ? "Изменить пароль" : "Войти"}</button></form><div class="account-form-footer"><button type="button" class="account-text-button" data-mode="${recovering ? "login" : "recover"}" data-lock>${recovering ? "Назад ко входу" : "Забыл пароль"}</button><button type="button" class="account-text-button" data-close data-lock>Продолжить без аккаунта</button></div>`;
		if (registering && emailEnabled) {
			body.querySelector("#account-username-hint")!.insertAdjacentHTML("afterend", emailField("", false));
			body.querySelector<HTMLElement>(".account-footnote")!.textContent = "Почта необязательна. После регистрации подтверди её по письму. Код восстановления всё равно понадобится — мы покажем его один раз.";
		}
		if (!recovering && emailEnabled) body.querySelector<HTMLButtonElement>('[data-mode="recover"]')!.dataset.mode = "forgot";
		if (recovering && emailEnabled) body.querySelector(".account-form-footer")!.insertAdjacentHTML("afterbegin", `<button type="button" class="account-text-button" data-mode="forgot" data-lock>Восстановить по почте</button>`);
		focusFirst();
	}

	function emailCard(): string {
		if (!user) return "";
		const verified = Boolean(user.emailVerified && user.email);
		const pending = user.pendingEmail ?? (!verified ? user.email : null);
		const primaryAddress = verified ? user.email : pending;
		return `<section class="account-email-card" aria-label="Почта для восстановления"><div class="account-email-head"><span class="account-eyebrow">Почта для восстановления</span><span class="account-email-badge ${verified ? "is-verified" : ""}">${verified ? "Подтверждена" : primaryAddress ? "Не подтверждена" : "Не добавлена"}</span></div>${primaryAddress ? `<strong class="account-email-address">${e(primaryAddress)}</strong>` : `<p>Добавь почту, чтобы восстановить доступ, если забудешь пароль и потеряешь код.</p>`}${verified && pending && pending !== user.email ? `<p class="account-email-pending">Ожидает подтверждения: <strong>${e(pending)}</strong>. Прежний адрес продолжает работать до подтверждения нового.</p>` : pending ? `<p>Открой письмо и подтверди адрес по ссылке. До этого для восстановления доступен код.</p>` : ""}${emailNotice ? `<p class="account-email-notice" role="status">${e(emailNotice)}</p>` : ""}${emailEnabled ? `<div class="account-email-actions"><button type="button" class="account-text-button" data-mode="email" data-lock>${primaryAddress ? "Изменить почту" : "Добавить почту"}</button>${pending ? `<button type="button" class="account-text-button" data-resend-email data-lock>Отправить письмо ещё раз</button>` : ""}</div>` : `<p class="account-field-hint">Отправка писем временно недоступна. Восстановление по коду работает.</p>`}</section>`;
	}

	function renderDashboard() {
		if (!user) { renderForm("login"); return; }
		mode = "dashboard";
		busy = false;
		dialog.setAttribute("aria-busy", "false");
		close.disabled = false;
		title.textContent = user.username;
		body.innerHTML = `<p id="account-description" class="account-intro">Личное дело доступно на других устройствах. Подключи убежище к аккаунту, чтобы продолжить игру после входа.</p><div class="account-summary"><span class="account-eyebrow">Связь с аккаунтом</span><p class="account-sync-status" data-account-status data-tone="${statusTone}" role="status">${e(status)}</p></div>${errorMarkup}<div class="account-actions">${options.onSync ? `<button type="button" class="account-button account-primary" data-sync data-lock>Синхронизировать</button>` : ""}${options.onReconnect ? `<button type="button" class="account-button" data-reconnect data-lock>Подключить убежище</button>` : ""}<button type="button" class="account-button" data-close data-lock>Вернуться в штаб</button></div><p class="account-footnote">После выхода сохранение остаётся в этом браузере. На другом устройстве для доступа к нему понадобится вход.</p><button type="button" class="account-text-button account-logout" data-logout data-lock>Выйти из аккаунта</button>`;
		body.querySelector(".account-summary")!.insertAdjacentHTML("afterend", emailCard());
		updateResendButton();
		focusFirst();
	}

	function open() {
		if (disposed) return;
		if (!dialog.open) { user ? renderDashboard() : renderForm("login"); showDialog(); focusFirst(); }
	}

	function renderRecoveryCode(code: string, continuation: () => Promise<void>, afterRecovery: boolean, notice = "") {
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
		if (notice) body.querySelector(".account-intro")!.insertAdjacentHTML("afterend", `<p class="account-notice">${e(notice)}</p>`);
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
			openDeferredLink();
		}
	}

	async function submitForm(form: HTMLFormElement) {
		if (mode === "forgot" || mode === "email" || mode === "reset") { await submitEmailForm(form, mode); return; }
		if (busy || !["login", "register", "recover"].includes(mode)) return;
		clearError();
		if (!form.reportValidity()) return;
		const data = new FormData(form);
		const username = String(data.get("username") ?? "").trim();
		const password = String(data.get("password") ?? "");
		const repeat = String(data.get("passwordRepeat") ?? "");
		const email = String(data.get("email") ?? "").trim();
		if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) { showError("Позывной: 3–24 латинских символа, цифры, _ или -."); return; }
		if (password.length < 12 || password.length > 128) { showError("Пароль должен содержать от 12 до 128 символов."); return; }
		if (mode !== "login" && password !== repeat) { showError("Пароли не совпадают. Введи одинаковый пароль в обоих полях."); form.querySelector<HTMLInputElement>("#account-password-repeat")?.focus(); return; }
		if (email && !validEmail(email)) { showError("Введи полный адрес почты, например name@example.com."); form.querySelector<HTMLInputElement>("#account-email")?.focus(); return; }
		rememberedUsername = username;
		const submittedMode = mode;
		setBusy(true, submittedMode === "register" ? "Создаём аккаунт…" : submittedMode === "recover" ? "Меняем пароль…" : "Входим…");
		try {
			if (submittedMode === "register") {
				const result = await accountApi.register(username, password, email || undefined);
				if (disposed) return;
				setUser(result.user);
				setStatus("Аккаунт создан · сохрани код восстановления", "neutral");
				rememberDelivery(result.emailDelivery);
				renderRecoveryCode(result.recoveryCode, () => authenticate(result.user, "register"), false, emailNotice);
			} else if (submittedMode === "recover") {
				const code = String(data.get("recoveryCode") ?? "").trim();
				const result = await accountApi.recover(username, code, password);
				if (disposed) return;
				setUser(null);
				setStatus("Пароль изменён. Войди с новым паролем.");
				renderRecoveryCode(result.recoveryCode, async () => { renderForm("login", "Пароль изменён. Войди с новым паролем."); }, true);
				options.onAuthRevoked?.();
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

	async function submitEmailForm(form: HTMLFormElement, submittedMode: "forgot" | "email" | "reset") {
		if (busy || submittedMode === "forgot" && forgotUntil > Date.now()) return;
		clearError();
		if (!form.reportValidity()) return;
		const data = new FormData(form);
		const email = String(data.get("email") ?? "").trim();
		const password = String(data.get("password") ?? "");
		const repeat = String(data.get("passwordRepeat") ?? "");
		if (submittedMode !== "reset" && !validEmail(email)) { showError("Введи полный адрес почты, например name@example.com."); return; }
		if (submittedMode !== "forgot" && (password.length < 12 || password.length > 128)) { showError("Пароль должен содержать от 12 до 128 символов."); return; }
		if (submittedMode === "reset" && password !== repeat) { showError("Пароли не совпадают. Введи одинаковый пароль в обоих полях."); form.querySelector<HTMLInputElement>("#account-password-repeat")?.focus(); return; }
		if (submittedMode === "reset" && !linkToken) { showError("Ссылка недействительна. Запроси новое письмо."); return; }
		setBusy(true, submittedMode === "reset" ? "Меняем пароль…" : "Отправляем письмо…");
		try {
			if (submittedMode === "forgot") {
				await accountApi.forgotPassword(email);
				if (disposed) return;
				forgotUntil = Date.now() + 60_000;
				renderEmailForm("forgot", "Если у аккаунта есть этот подтверждённый адрес, на него придёт ссылка для смены пароля. Проверь почту и папку «Спам».");
				body.querySelector<HTMLInputElement>("#account-email")!.value = email;
			} else if (submittedMode === "email") {
				if (!user) throw new AccountApiError(401, "unauthorized");
				const expectedId = user.id;
				const result = await accountApi.setEmail(expectedId, email, password);
				if (disposed) return;
				if (!acceptEmailProfile(expectedId, result.user)) return;
				setUser(result.user); options.onUserChanged?.(result.user);
				rememberDelivery(result.emailDelivery); renderDashboard();
			} else {
				const result = await accountApi.resetPassword(linkToken, password);
				if (disposed) return;
				linkToken = ""; setUser(null); setStatus("Пароль изменён. Войди с новым паролем.");
				renderRecoveryCode(result.recoveryCode, async () => { renderForm("login", "Пароль изменён. Войди с новым паролем."); }, true);
				options.onAuthRevoked?.();
			}
		} catch (error) {
			if (!disposed) {
				if (error instanceof AccountApiError && error.status === 429 && submittedMode === "forgot") forgotUntil = Date.now() + Math.max(error.retryAfter ?? 60, 1) * 1000;
				showError(accountErrorMessage(error));
			}
		} finally { if (!disposed && mode !== "recovery-code") setBusy(false); openDeferredLink(); }
	}

	function acceptEmailProfile(expectedId: string, profile: AccountUser): boolean {
		if (user?.id === expectedId && profile.id === expectedId) return true;
		if (!user) renderForm("login", "Сессия завершилась во время запроса. Войди заново, чтобы проверить почту аккаунта.");
		else { renderDashboard(); showError("Сессия изменилась во время запроса. Показан текущий аккаунт; для проверки другого аккаунта войди в него."); }
		return false;
	}

	async function resendEmail() {
		if (busy || !user || !emailEnabled || resendUntil > Date.now()) return;
		const expectedId = user.id;
		setBusy(true); clearError();
		try {
			const result = await accountApi.resendEmail(expectedId);
			if (disposed) return;
			if (!acceptEmailProfile(expectedId, result.user)) return;
			setUser(result.user); options.onUserChanged?.(result.user);
			rememberDelivery(result.emailDelivery); renderDashboard();
		} catch (error) {
			if (!disposed) {
				if (error instanceof AccountApiError && error.status === 429) resendUntil = Date.now() + Math.max(error.retryAfter ?? 60, 1) * 1000;
				showError(accountErrorMessage(error));
			}
		} finally { if (!disposed) setBusy(false); openDeferredLink(); }
	}

	async function verifyEmail() {
		if (busy || !linkToken) return;
		setBusy(true); clearError();
		try {
			const result = await accountApi.verifyEmail(linkToken);
			if (disposed) return;
			linkToken = "";
			if (user && result.user?.id === user.id) { setUser(result.user); options.onUserChanged?.(result.user); }
			let refreshFailed = false;
			try { await options.onEmailVerified?.(result.user); } catch { refreshFailed = true; }
			if (disposed) return;
			const matchesCurrentAccount = Boolean(user && result.user?.id === user.id);
			if (matchesCurrentAccount) emailNotice = "Почта подтверждена. Теперь её можно использовать для восстановления доступа.";
			mode = "verify"; title.textContent = "Почта подтверждена";
			body.innerHTML = `<p id="account-description" class="account-intro">${matchesCurrentAccount ? "Почта этого аккаунта подтверждена. Теперь через неё можно восстановить доступ." : "Адрес из письма подтверждён. Чтобы продолжить, войди в соответствующий аккаунт."}</p>${refreshFailed ? `<p class="account-notice">Не удалось проверить текущий вход. Обнови страницу, если статус аккаунта не изменился.</p>` : ""}<button type="button" class="account-button account-primary" ${user ? "data-dashboard" : 'data-mode="login"'} data-lock>${user ? matchesCurrentAccount ? "Вернуться в аккаунт" : "Вернуться в текущий аккаунт" : "Перейти ко входу"}</button>${user && !matchesCurrentAccount ? `<button type="button" class="account-text-button" data-mode="login" data-lock>Войти в другой аккаунт</button>` : ""}`;
			focusFirst();
		} catch (error) { if (!disposed) showError(accountErrorMessage(error)); }
		finally { if (!disposed) setBusy(false); openDeferredLink(); }
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
		} finally { workflowDepth--; if (!disposed) setBusy(false); openDeferredLink(); }
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
			setStatus("Гостевая игра · прогресс на сервере", "neutral");
			await options.onLogout();
			if (!disposed) renderForm("login", "Ты вышел из аккаунта. Убежище аккаунта сохранено на сервере.");
		} catch (error) { if (!disposed) showError(accountErrorMessage(error)); }
		finally { workflowDepth--; if (!disposed) setBusy(false); openDeferredLink(); }
	}

	async function handleClick(event: MouseEvent) {
		const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
		if (!target || target.disabled) return;
		if (target === close || target.hasAttribute("data-close")) { attemptClose(); return; }
		if (target.hasAttribute("data-dashboard") && !busy) { linkToken = ""; renderDashboard(); return; }
		if (target.hasAttribute("data-resend-email")) { await resendEmail(); return; }
		if (target.hasAttribute("data-verify-email")) { await verifyEmail(); return; }
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
			openDeferredLink();
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
		setEmailEnabled,
		handleEmailLink,
		open,
		chooseProgress,
		destroy() {
			if (mode === "recovery-code" && recoveryCode && !recoveryAcknowledged) return;
			disposed = true;
			pendingChoice?.resolve("cancel");
			pendingChoice = null;
			recoveryCode = "";
			linkToken = "";
			deferredLink = null;
			stopResendTimer();
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
