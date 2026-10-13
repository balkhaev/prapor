import { CONTRACTS } from "./game/data";
import { getContractProgress, getScavHealingQuote, type GameState, type Raid, type RaidReport, type Scav } from "./game/engine";
import { BODY_PART_LABELS, BODY_PART_MAX_HP, BODY_PARTS, createHealth, injuryEffects, isAlive, selectTreatment, type HealthState, type MedicalInventory, type TreatmentType } from "./game/health";
import { raidMedicalInventory } from "./game/raid-health";
import { GAMEPLAY_BEATS, getGameplayGuidance, type GameplayGuidance } from "./gameplay-guidance";

const e = (value: unknown) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const n = (value: number) => Math.floor(value).toLocaleString("ru-RU");
const MEDICAL_LABELS: Record<TreatmentType, string> = {
	medkit: "Аптечка", bandage: "Бинт", tourniquet: "Жгут", splint: "Шина", painkiller: "Обезболивающее", surgery: "Хирургический набор",
};

function healthUrgency(body: HealthState): { label: string; detail: string; critical: boolean } {
	if (!isAlive(body)) return { label: "Критическое повреждение", detail: "Голова или грудь полностью повреждены.", critical: true };
	const heavy = BODY_PARTS.filter(part => body.parts[part].bleeding === "heavy");
	if (heavy.length) return { label: "Срочно остановить кровь", detail: `Тяжёлое кровотечение: ${heavy.map(part => BODY_PART_LABELS[part].toLocaleLowerCase("ru")).join(", ")}.`, critical: true };
	const light = BODY_PARTS.filter(part => body.parts[part].bleeding === "light");
	if (light.length) return { label: "Кровотечение", detail: `Теряет здоровье: ${light.map(part => BODY_PART_LABELS[part].toLocaleLowerCase("ru")).join(", ")}.`, critical: true };
	const vital = (body.parts.head.hp / body.parts.head.maxHp < .3) || (body.parts.chest.hp / body.parts.chest.maxHp < .3);
	if (vital) return { label: "Голова или грудь под угрозой", detail: "Следующее попадание в жизненно важную зону может стать смертельным.", critical: true };
	const injuries = BODY_PARTS.some(part => body.parts[part].hp === 0 || body.parts[part].fracture);
	return injuries ? { label: "Нужно восстановить функции", detail: "Переломы и выбитые части тела ограничивают бойца даже при высоком общем здоровье.", critical: false }
		: { label: "Состояние стабильное", detail: "Кровотечений и переломов нет. Потерянное здоровье восстанавливается отдельно для каждой зоны.", critical: false };
}

/** Read-only anatomy view; rendering a legacy scalar never mutates a save. */
export function bodyHealthPanel(body: HealthState, name = "Боец", now = Date.now()): string {
	const urgency = healthUrgency(body), effects = injuryEffects(body, now);
	const hp = BODY_PARTS.reduce((sum, part) => sum + body.parts[part].hp, 0), maximum = BODY_PARTS.reduce((sum, part) => sum + body.parts[part].maxHp, 0);
	const limitations = [effects.movement < .995 ? `Передвижение ${Math.round(effects.movement * 100)}%` : "",
		effects.aim < .995 ? `Точность ${Math.round(effects.aim * 100)}%` : "", effects.reload < .995 ? `Темп перезарядки ${Math.round(effects.reload * 100)}%` : "",
		effects.stamina < .995 ? `Восстановление выносливости ${Math.round(effects.stamina * 100)}%` : "",
		effects.treatment > 1.005 ? `Лечение дольше на ${Math.round((effects.treatment - 1) * 100)}%` : "", !effects.sprint ? "Бег недоступен" : "", effects.pain ? "Боль мешает действовать" : ""].filter(Boolean);
	return `<section class="body-health-panel ${urgency.critical ? "needs-attention" : ""}" aria-label="Состояние тела: ${e(name)}"><div class="body-health-heading"><h3>Состояние тела</h3><strong>${n(hp)} / ${n(maximum)} HP</strong></div><p class="body-health-urgency"><strong>${e(urgency.label)}</strong><span>${e(urgency.detail)}</span></p><ol class="body-health-parts">${BODY_PARTS.map(part => {
		const zone = body.parts[part], vital = part === "head" || part === "chest", destroyed = zone.hp === 0;
		const statuses = [destroyed ? "Выбита" : "", zone.bleeding === "heavy" ? "Тяжёлое кровотечение" : zone.bleeding === "light" ? "Лёгкое кровотечение" : "", zone.fracture ? "Перелом" : "", zone.maxHp < BODY_PART_MAX_HP[part] ? "После хирургии" : ""].filter(Boolean);
		return `<li class="${destroyed ? "destroyed" : zone.bleeding !== "none" ? "bleeding" : zone.fracture ? "fractured" : ""}"><div class="body-part-heading"><span>${e(BODY_PART_LABELS[part])}${vital ? '<small>Жизненно важная</small>' : ""}</span><b>${n(zone.hp)} / ${n(zone.maxHp)}</b></div><div class="body-part-track" role="progressbar" aria-label="${e(BODY_PART_LABELS[part])}: здоровье" aria-valuemin="0" aria-valuemax="${zone.maxHp}" aria-valuenow="${zone.hp}"><i style="width:${Math.max(0, Math.min(100, zone.hp / zone.maxHp * 100))}%"></i></div><small class="body-part-status">${statuses.map(e).join(" · ") || (zone.hp < zone.maxHp ? "Повреждена" : "Без повреждений")}</small></li>`;
	}).join("")}</ol><div class="body-health-effects"><strong>Работоспособность</strong><p>${limitations.length ? limitations.map(e).join(" · ") : "Передвижение, прицеливание и работа руками без ограничений."}</p></div><p class="body-health-rule">Ноль HP у головы или груди смертелен. Выбитую конечность или живот сначала восстанавливают хирургией, затем аптечкой.</p></section>`;
}

export function medicalInventorySummary(inventory: MedicalInventory): string {
	return `<ul class="medical-inventory" aria-label="Медицина в сумке">${(Object.keys(MEDICAL_LABELS) as TreatmentType[]).map(type => `<li class="${inventory[type] <= 0 ? "empty" : ""}"><span>${MEDICAL_LABELS[type]}</span><b>${n(inventory[type])}${type === "medkit" ? " HP" : " шт."}</b></li>`).join("")}</ul>`;
}

/** The existing dispatch option purchases a real, personal medical bag. */
export function medicalPackEditor(state: GameState, scav: Scav): string {
	const busy = state.raids.some(raid => raid.scavId === scav.id) || scav.status === "raiding";
	return `<div class="medical-pack-editor"><label class="loadout-check"><input type="checkbox" data-medkit="${e(scav.id)}" data-focus-key="medkit" ${scav.loadout.medkit ? "checked" : ""} ${busy ? "disabled" : ""}><span>Медсумка в рейд<small>1 медикамент при каждой отправке, включая автовыходы.</small></span></label><details class="medical-pack-contents"><summary>Содержимое и лечение</summary>${medicalInventorySummary(raidMedicalInventory(true))}<p>Бинт останавливает лёгкое кровотечение, жгут — тяжёлое. Шина лечит перелом, обезболивающее временно подавляет боль. Хирургия возвращает выбитую зону к 1 HP и снижает её максимум до конца выхода. Аптечка расходует запас HP.</p><p>Боец лечится автоматически между столкновениями: сначала кровь, затем опасные ранения и подвижность. Каждое действие требует времени и расходует подходящее средство. ${busy ? "Уже взятая сумка остаётся у текущего выхода; настройка ниже относится к следующему." : "Оплата и состав сумки фиксируются при отправке."}</p></details></div>`;
}

/** Base care is a paid course; no field consumables are spent at the shelter. */
export function scavHealthPanel(state: GameState, scav: Scav): string {
	const quote = getScavHealingQuote(state, scav), treatment = scav.medicalTreatment;
	const remaining = treatment ? Math.max(0, Math.ceil((treatment.endsAt - Date.now()) / 1000)) : 0;
	const label = treatment ? `Лечение · осталось ${remaining} сек.` : quote.reason === "Боец уже здоров." ? "Здоров" : `Лечить · ${quote.medicine} мед.`;
	const note = treatment ? "Курс уже оплачен. Боец вернётся к работе и рейдам после лечения."
		: quote.reason ?? `Полное восстановление всех зон и переломов · ${Math.ceil(quote.duration)} сек. Бесплатное восстановление идёт постепенно в медблоке.`;
	return `<div data-body-health="${e(scav.id)}">${bodyHealthPanel(scav.body ?? createHealth(scav.health), scav.name)}<div class="body-health-care"><p data-heal-note="${e(scav.id)}">${e(note)}</p><button class="button ghost small" data-action="heal" data-id="${e(scav.id)}" data-focus-key="heal" ${quote.reason ? "disabled" : ""}>${e(label)}</button></div></div>`;
}

/** Running sorties use their paid bag, never the soldier's next loadout option. */
export function raidHealthPanel(state: GameState, raid: Raid, report: RaidReport | null = null): string {
	const members = raid.squad ? raid.squad.members.map(member => state.raids.find(item => item.id === member.raidId)
		?? (report ? { ...raid, id: member.raidId, scavId: member.scavId, scavName: member.scavName } : null)).filter((item): item is Raid => Boolean(item)) : [raid];
	return `<div class="raid-medical-panel" data-raid-medical="${e(raid.id)}">${members.map(member => {
		const scav = state.scavs.find(item => item.id === member.scavId);
		const receipt = report ? report.raidId === member.id ? report : state.history.find(item => item.raidId === member.id) : null;
		if (report && !receipt?.medical) return `<p class="field-hint">${e(member.scavName)}: состояние тела в этом отчёте не сохранилось.</p>`;
		if (!report && !scav) return "";
		const body = receipt?.medical?.body ?? scav?.body ?? createHealth(scav!.health), inventory = receipt?.medical?.inventory ?? member.expedition?.medical?.inventory;
		const next = inventory ? selectTreatment(body, inventory, Date.now()) : null;
		const cannotStopBlood = BODY_PARTS.some(part => body.parts[part].bleeding === "heavy" && (!inventory || inventory.tourniquet <= 0) || body.parts[part].bleeding === "light" && (!inventory || inventory.bandage <= 0));
		return `<details class="raid-medical-member" data-medical-member="${e(member.scavId)}" ${members.length === 1 ? "open" : ""}><summary>${e(member.scavName)} · тело и медсумка</summary>${bodyHealthPanel(body, member.scavName, receipt?.at ?? Date.now())}<div class="raid-medical-stock"><h4>${report ? "Медицина в конце выхода" : "Осталось в медсумке"}</h4>${inventory ? medicalInventorySummary(inventory) : '<p>В этом выходе нет медсумки.</p>'}<p class="raid-medical-advice">${report ? "Это сохранённое состояние при завершении выхода. Лечение на базе оплачивается отдельно." : cannotStopBlood ? "Кровотечение остаётся: нужных средств в сумке нет. Пора эвакуироваться." : next ? `Следующее лечение: ${e(MEDICAL_LABELS[next.type])} · ${e(BODY_PART_LABELS[next.part])}.` : BODY_PARTS.some(part => body.parts[part].hp === 0 || body.parts[part].fracture) ? "Сохранились тяжёлые ранения. Если в сумке нет подходящего средства, безопаснее эвакуироваться." : "Боец стабилен. Оставшаяся медицина понадобится на следующих этапах."}</p></div></details>`;
	}).join("")}<p class="raid-medical-pause">${report ? "Ранения и потраченные средства сохранены в личном отчёте этого выхода." : raid.expedition?.status === "choice" ? "На контрольной точке время и кровотечения остановлены, пока ты выбираешь приказ." : "Лечение и ранения меняют боеспособность; подтверждённые события появляются в ходе выхода."}</p></div>`;
}

/** Update only body panels as free recovery progresses; preserve keyboard focus. */
export function updateScavHealthPanels(root: ParentNode, state: GameState): void {
	root.querySelectorAll<HTMLElement>("[data-body-health]").forEach(node => {
		const scav = state.scavs.find(item => item.id === node.dataset.bodyHealth);
		if (!scav) return;
		const focus = node.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.focusKey : null;
		const html = scavHealthPanel(state, scav), outer = document.createElement("div");
		outer.innerHTML = html;
		const next = outer.firstElementChild;
		if (!next || node.innerHTML === next.innerHTML) return;
		node.innerHTML = next.innerHTML;
		if (focus) node.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
	});
}
const PHASES = [
	{ id: "prepare", label: "Подготовка" },
	{ id: "raid", label: "Выход" },
	{ id: "decision", label: "Эвакуация" },
	{ id: "invest", label: "Развитие" },
] as const;

export function gameplayFocus(guidance: GameplayGuidance): string {
	const { campaign, action } = guidance;
	const progress = Math.min(campaign.progress, campaign.target);
	return `<section class="gameplay-focus" aria-label="Текущая игровая цель">
		<div class="gameplay-focus-heading"><span class="eyebrow">Путь убежища</span><span>${campaign.completed ? "Пройден" : `${campaign.index} / ${campaign.total}`}</span></div>
		<h2>${e(campaign.title)}</h2><p class="gameplay-purpose">${e(campaign.purpose)}</p>
		${campaign.contractId ? `<div class="gameplay-goal-progress"><span>${n(progress)} / ${n(campaign.target)}</span><span>Награда: ${n(campaign.reward.money)} ₽ · ${n(campaign.reward.xp)} опыта</span></div><div class="progress" role="progressbar" aria-label="Прогресс текущей цели" aria-valuemin="0" aria-valuemax="${campaign.target}" aria-valuenow="${progress}"><i style="width:${campaign.target ? Math.min(100, progress / campaign.target * 100) : 100}%"></i></div>` : ""}
		<ol class="gameplay-cycle" aria-label="Игровой цикл">${PHASES.map(phase => `<li${phase.id === guidance.phase ? ' class="current" aria-current="step"' : ""}>${phase.label}</li>`).join("")}</ol>
		<p class="gameplay-next-detail">${e(action.detail)}</p><button class="button gameplay-next" data-action="gameplay-next" data-focus-key="gameplay-next">${e(action.label)} <span aria-hidden="true">→</span></button>
		<details class="gameplay-explanation"><summary>Как замыкается цикл</summary><ol>${guidance.steps.map(step => `<li><strong>${e(step.label)}</strong><p>${e(step.detail)}</p></li>`).join("")}</ol>${campaign.nextTitle ? `<p>Следующая цель: <strong>${e(campaign.nextTitle)}</strong></p>` : ""}<button class="text-button" data-page="contracts">Весь путь развития →</button></details>
	</section>`;
}

export function gameplayRoadmap(state: GameState): string {
	const guidance = getGameplayGuidance(state);
	return `<section class="gameplay-roadmap" aria-label="Путь развития убежища"><div class="gameplay-roadmap-head"><div><span class="eyebrow">От первого выхода до закрытой зоны</span><h2>Каждый выход — для следующего шага</h2><p>Доставляй добычу, вкладывай её в людей и снабжение, осваивай более опасные сектора. Награды за поручения поддерживают этот путь.</p></div><button class="button secondary" data-action="gameplay-next" data-focus-key="gameplay-next">${e(guidance.action.label)} →</button></div>
		<ol class="gameplay-roadmap-steps">${GAMEPLAY_BEATS.map((beat, index) => {
			const contract = CONTRACTS.find(item => item.id === beat.contractId)!;
			const done = state.claimedContracts.includes(beat.contractId);
			const skipped = !done && beat.contractId === "working-shelter" && GAMEPLAY_BEATS.slice(2).some(later => state.claimedContracts.includes(later.contractId));
			const current = !guidance.campaign.completed && index + 1 === guidance.campaign.index;
			const progress = Math.min(contract.target, getContractProgress(state, contract));
			const target = contract.metric === "mapRaidsWon" ? `Эвакуаций: ${contract.target}` : contract.metric === "productionCycles" ? `Партий: ${contract.target}` : `Прогресс: ${contract.target}`;
			return `<li class="${done ? "done" : current ? "current" : "future"}"${current ? ' aria-current="step"' : ""}><span class="gameplay-beat-number" aria-hidden="true">${done ? "✓" : skipped ? "↪" : String(index + 1).padStart(2, "0")}</span><div><strong>${e(beat.title)}</strong><p>${e(beat.purpose)}</p><small>${done ? "Пройдено" : skipped ? "Можно завершить отдельно" : current ? `Текущая цель · ${n(progress)} / ${contract.target}` : `Уровень ${contract.level} · ${target}`}</small></div></li>`;
		}).join("")}</ol><p class="gameplay-freedom">Глубину выхода выбираешь ты: ранняя эвакуация тоже засчитывает возвращение. Производство помогает готовить следующие рейды; постоянные приказы и коллекция оружия дают дополнительные цели.</p></section>`;
}
