import { MODULE_BY_ID, MODULE_SLOT_LABELS, type ModuleSlot } from "./game/modules";
import { RESOURCE_RECIPE_BY_ID, ROOM_DEFINITIONS, type RoomInstance, type ShelterRoomType } from "./game/shelter";
import { FIELD_KITS } from "./game/shelter-logistics";

export interface ProductionSnapshot {
	progress: number;
	remainingSeconds: number | null;
	rate: number;
	status: string;
	reason: string | null;
}
export type ProductionStage = "idle" | "preparation" | "assembly" | "inspection" | "complete" | "construction";
export type ProductionProductKind = "module" | "ammo" | "scrap" | "medicine" | "intel" | "field-kit" | null;
export const SHELTER_PRODUCTION_STAGES = [
	{ id: "preparation", label: "Подготовка", start: 0, end: .22 },
	{ id: "assembly", label: "Сборка", start: .22, end: .84 },
	{ id: "inspection", label: "Проверка", start: .84, end: 1 },
] as const;

export interface ProductionPresentation {
	jobId: string | null;
	modelId: string | null;
	moduleSlot: ModuleSlot | null;
	productName: string;
	productKind: ProductionProductKind;
	quantity: number;
	progress: number;
	stage: ProductionStage;
	stageLabel: string;
	stageProgress: number;
	active: boolean;
	paused: boolean;
	completed: boolean;
	reason: string | null;
}

const normalizedWork = (workDone: number, workRequired: number): number => Number.isFinite(workDone) && Number.isFinite(workRequired) && workRequired > 0
	? Math.max(0, Math.min(1, workDone / workRequired)) : 0;
const RESOURCE_NAMES = { ammo: "Партия патронов", scrap: "Детали из утиля", medicine: "Медицинские наборы", intel: "Сводка разведки" };
const PROCESS_LABELS = {
	workshop: ["Подготовка", "Сборка", "Проверка"],
	ammo: ["Подготовка гильз", "Снаряжение", "Проверка партии"],
	recycler: ["Сортировка", "Разборка", "Контроль деталей"],
	medbay: ["Подготовка", "Изготовление", "Контроль качества"],
	radio: ["Поиск сигнала", "Расшифровка", "Сверка данных"],
	storage: ["Подготовка", "Размещение", "Проверка"],
	dormitory: ["Подготовка", "Размещение", "Проверка"],
	hangar: ["Подготовка", "Размещение", "Проверка"],
} as const;

export function getShelterProductionStages(roomType: ShelterRoomType) {
	return SHELTER_PRODUCTION_STAGES.map((stage, index) => ({ ...stage, label: PROCESS_LABELS[roomType][index]! }));
}

/** A read-only view of the engine's head job. The animation never owns its progress. */
export function getShelterProductionPresentation(room: RoomInstance, production: ProductionSnapshot | null = null): ProductionPresentation {
	const empty: ProductionPresentation = {
		jobId: null, modelId: null, moduleSlot: null, productName: "Нет заказа", productKind: null, quantity: 0,
		progress: 0, stage: "idle", stageLabel: "Нет заказа", stageProgress: 0,
		active: false, paused: false, completed: false, reason: production?.reason ?? null,
	};
	if (room.status !== "ready") {
		const construction = room.construction;
		const progress = construction ? normalizedWork(construction.workDone, construction.workRequired) : 0;
		return { ...empty, productName: ROOM_DEFINITIONS[room.type].label, progress, stage: "construction",
			stageLabel: room.status === "building" ? "Строительство" : "Улучшение", stageProgress: progress };
	}
	if (!ROOM_DEFINITIONS[room.type].production) return {
		...empty, productName: ROOM_DEFINITIONS[room.type].label, stageLabel: "Работает без персонала", reason: null,
	};
	const job = room.queue[0];
	if (!job) return { ...empty, stageLabel: production?.reason ? "Ожидание" : production?.status ?? "Нет заказа" };
	const modelId = job.kind === "module" ? job.modelId ?? job.output.moduleModelId : null;
	const model = modelId && Object.hasOwn(MODULE_BY_ID, modelId) ? MODULE_BY_ID[modelId] : null;
	const recipe = Object.hasOwn(RESOURCE_RECIPE_BY_ID, job.recipeId) ? RESOURCE_RECIPE_BY_ID[job.recipeId] : null;
	let kind: ProductionProductKind = model ? "module" : null;
	let quantity = model ? 1 : 0;
	if (job.kind === "resource") {
		if (job.output.fieldKit) { kind = "field-kit"; quantity = 1; }
		for (const resource of ["ammo", "scrap", "medicine", "intel"] as const) {
			if (job.output.supplies[resource] > 0) { kind = resource; quantity = job.output.supplies[resource]; break; }
		}
	}
	const progress = normalizedWork(job.workDone, job.workRequired);
	const completed = progress >= 1;
	const phase = progress < .22 ? 0 : progress < .84 ? 1 : 2;
	const stage = SHELTER_PRODUCTION_STAGES[phase];
	const validWork = Number.isFinite(job.workDone) && job.workDone >= 0 && Number.isFinite(job.workRequired) && job.workRequired > 0;
	const active = validWork && !completed && room.workerIds.length > 0 && Boolean(production && Number.isFinite(production.rate) && production.rate > 0 && !production.reason);
	const reason = production?.reason ?? (!completed && !active ? "Производство на паузе" : null);
	return {
		jobId: job.id, modelId: model?.id ?? null, moduleSlot: model?.slot ?? null,
		productName: model?.label ?? recipe?.label ?? (job.output.fieldKit ? FIELD_KITS[job.output.fieldKit].label : kind && kind !== "module" && kind !== "field-kit" ? RESOURCE_NAMES[kind] : "Производственный заказ"),
		productKind: kind, quantity, progress, stage: completed ? "complete" : stage.id,
		stageLabel: completed ? "Готово" : PROCESS_LABELS[room.type][phase],
		stageProgress: completed ? 1 : Math.max(0, Math.min(1, (progress - stage.start) / (stage.end - stage.start))),
		active, paused: !active && (!completed || Boolean(reason)), completed, reason,
	};
}

export const getShelterProduction = getShelterProductionPresentation;

export function getProductionProductCaption(presentation: ProductionPresentation): string {
	if (!presentation.jobId) return presentation.productName;
	return presentation.moduleSlot ? `${MODULE_SLOT_LABELS[presentation.moduleSlot]} · ${Math.round(presentation.progress * 100)}%`
		: `${presentation.productName} ×${presentation.quantity} · ${Math.round(presentation.progress * 100)}%`;
}

/** Only the machine's visual cycle advances. Simulation work remains entirely in the engine. */
export function advanceShelterStationClock(clockMs: number, deltaMs: number, presentation: Pick<ProductionPresentation, "active">, reducedMotion = false): number {
	const clock = Number.isFinite(clockMs) && clockMs >= 0 ? clockMs : 0;
	return presentation.active && !reducedMotion && Number.isFinite(deltaMs) && deltaMs > 0 ? clock + Math.min(deltaMs, 100) : clock;
}
