type FieldPanel = "dock" | "crew" | "routes";
type FieldState = { view: "base" | "map" | "raid" | "live"; context: string; status: string };

/** The scene stays mounted while the player's field panels open and close. */
export function mountFieldInterface(options: {
	root: HTMLElement;
	icon: (name: string, size?: number) => string;
	getState: () => FieldState;
	closeContext: () => void;
	/** Visibility changes must not change the selected object or world view. */
	onVisibilityChange?: () => void;
	onError: (message: string) => void;
}) {
	const { root, icon } = options;
	const body = document.body;
	const dock = root.querySelector<HTMLElement>("#command-dock")!;
	const main = root.querySelector<HTMLElement>(".command-main")!;
	const shade = root.querySelector<HTMLElement>("#context-shade")!;
	// Keep the mobile scrim and the room panel in the same stacking context.
	main.append(shade);
	let lastContext = "";
	let destroyed = false;
	body.classList.add("immersive-game");
	main.insertAdjacentHTML("beforeend", `<div class="field-location"><span class="eyebrow">УБЕЖИЩЕ 07</span><strong>Своя территория</strong><small>База на связи</small></div><button class="field-launch" data-open-live>${icon("raids", 19)}<span>Подготовить выход</span>${icon("arrow", 16)}</button><div class="field-controls" role="group" aria-label="Полевые панели"><button data-field-panel="crew" aria-controls="command-crew" aria-expanded="false" title="Люди и назначение на работу">${icon("people", 18)}<span>Люди</span></button><button data-field-panel="routes" aria-controls="command-routes" aria-expanded="false" title="Точки входа в Периметр">${icon("raids", 18)}<span>Маршруты</span></button><button data-field-panel="dock" aria-controls="command-dock" aria-expanded="false" title="Сводка и управление">${icon("contracts", 18)}<span>Сводка</span></button><button data-action="toggle-fullscreen" aria-label="Развернуть игру на весь экран" aria-pressed="false" title="На весь экран"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 9V3h6m6 0h6v6m0 6v6h-6M9 21H3v-6"/></svg></button></div>`);
	function dockVisible() {
		return !body.classList.contains("field-dock-collapsed") && (body.classList.contains("field-dock-open") || dock.matches(".context-open, .raid-dock, .live-dock"));
	}
	function isPanelOpen(panel: FieldPanel) {
		return panel === "dock" ? dockVisible() && !dock.classList.contains("live-entry-dock") : body.classList.contains(`field-${panel}-open`);
	}
	function sync() {
		if (destroyed) return;
		const state = options.getState();
		const identity = `${state.view}:${state.context}`;
		if (identity !== lastContext) {
			lastContext = identity;
			body.classList.remove("field-dock-collapsed");
			if (state.view === "live" || state.view === "raid") body.classList.remove("field-crew-open", "field-routes-open");
		}
		const location = root.querySelector<HTMLElement>(".field-location")!;
		location.querySelector(".eyebrow")!.textContent = state.view === "live" ? "ОБЩИЙ ПЕРИМЕТР" : state.view === "base" ? "УБЕЖИЩЕ 07" : "ОПЕРАЦИИ ОТРЯДА";
		location.querySelector("strong")!.textContent = state.view === "live" ? "Периметр 01" : state.view === "base" ? "Своя территория" : state.view === "map" ? "Карта вылазок" : "На связи с отрядом";
		location.querySelector("small")!.textContent = state.status;
		if (!dock.querySelector(".field-panel-head, .command-context-head, .live-dock-head")) {
			dock.insertAdjacentHTML("afterbegin", '<header class="field-panel-head"><strong>Полевая сводка</strong><button class="icon-button" data-field-close="dock" data-focus-key="field-close-dock" aria-label="Свернуть сводку">×</button></header>');
		}
		for (const panel of ["dock", "crew", "routes"] as const) {
			const open = isPanelOpen(panel);
			for (const button of root.querySelectorAll<HTMLButtonElement>(`[data-field-panel="${panel}"]`)) {
				button.setAttribute("aria-expanded", String(open));
				button.setAttribute("aria-label", panel === "dock" ? "Сводка" : panel === "crew" ? "Люди" : "Маршруты");
				button.disabled = dock.classList.contains("live-entry-dock") && panel === "dock";
			}
		}
		if (!isPanelOpen("dock")) shade.hidden = true;
	}
	function closePanel(panel: FieldPanel) {
		if (panel === "dock") {
			body.classList.remove("field-dock-open");
			body.classList.add("field-dock-collapsed");
		} else body.classList.remove(`field-${panel}-open`);
		sync();
		options.onVisibilityChange?.();
		root.querySelector<HTMLButtonElement>(`[data-field-panel="${panel}"]`)?.focus({ preventScroll: true });
	}
	function dismiss() {
		for (const panel of ["routes", "crew", "dock"] as const) {
			if (isPanelOpen(panel)) { closePanel(panel); return true; }
		}
		return false;
	}
	function closePanels() {
		body.classList.remove("field-dock-open", "field-crew-open", "field-routes-open");
		body.classList.add("field-dock-collapsed");
		sync();
		options.onVisibilityChange?.();
	}
	function updateFullscreen() {
		const active = document.fullscreenElement !== null;
		const button = root.querySelector<HTMLButtonElement>('[data-action="toggle-fullscreen"]')!;
		button.setAttribute("aria-pressed", String(active));
		button.setAttribute("aria-label", active ? "Выйти из полноэкранного режима" : "Развернуть игру на весь экран");
		button.title = active ? "Выйти из полного экрана" : "На весь экран";
	}
	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
			else options.onError("В этом браузере игра уже занимает всё доступное окно. Полный экран можно включить в меню браузера.");
		} catch { options.onError("Браузер не разрешил полный экран. Игра продолжает занимать всё окно."); }
		updateFullscreen();
	}
	function click(event: MouseEvent) {
		const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
		if (!target) return;
		const panel = target.dataset.fieldPanel as FieldPanel | undefined;
		if (panel) {
			event.stopPropagation();
			const open = isPanelOpen(panel);
			if (open) { closePanel(panel); return; }
			body.classList.remove("field-crew-open", "field-routes-open");
			if (panel !== "dock" && window.innerWidth <= 640) {
				body.classList.remove("field-dock-open");
				body.classList.add("field-dock-collapsed");
			}
			body.classList.add(`field-${panel}-open`);
			if (panel === "dock") body.classList.remove("field-dock-collapsed");
			sync();
			options.onVisibilityChange?.();
			root.querySelector<HTMLElement>(`#command-${panel} button`)?.focus({ preventScroll: true });
		} else if (target.dataset.fieldClose) { event.stopPropagation(); closePanel(target.dataset.fieldClose as FieldPanel); }
		else if (target.dataset.action === "toggle-fullscreen") { event.stopPropagation(); void toggleFullscreen(); }
	}
	const observer = new MutationObserver(sync);
	observer.observe(dock, { attributes: true, attributeFilter: ["class"], childList: true });
	root.addEventListener("click", click);
	document.addEventListener("fullscreenchange", updateFullscreen);
	sync();
	updateFullscreen();
	return { sync, dismiss, closePanels, closePanel, isPanelOpen, destroy() {
		destroyed = true;
		observer.disconnect();
		root.removeEventListener("click", click);
		document.removeEventListener("fullscreenchange", updateFullscreen);
	} };
}
