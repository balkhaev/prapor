import { CONTRACTS } from "./game/data";
import { getContractProgress, type GameState } from "./game/engine";
import { GAMEPLAY_BEATS, getGameplayGuidance, type GameplayGuidance } from "./gameplay-guidance";

const e = (value: unknown) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const n = (value: number) => Math.floor(value).toLocaleString("ru-RU");
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
