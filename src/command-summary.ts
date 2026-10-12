import {
	ROOM_DEFINITIONS, RESOURCE_RECIPES, getModuleCapacity, getSupplyCapacity,
	getRoomProductionState, getResourceProductionQuote,
	type GameState, type RoomInstance, type ProductionJob,
} from "./game/engine";

export type CommandRoomTab = "staff" | "production" | "upgrade";
export type RoomCommandKind = "workers" | "order" | "resources" | "capacity" | "building" | "running" | "ready" | "passive";
export interface RoomCommandStatus {
	roomId: string;
	kind: RoomCommandKind;
	tab: CommandRoomTab | null;
	title: string;
	detail: string;
	cta: string | null;
	priority: number;
	progress: number;
	remainingSeconds: number | null;
}
export interface CommandSummary {
	rooms: RoomCommandStatus[];
	attention: RoomCommandStatus[];
	counts: Record<RoomCommandKind, number>;
	queuedJobs: number;
	freeWorkers: number;
}

function outputFull(state: GameState, output: ProductionJob["output"]) {
	if (output.moduleModelId && state.modules.length >= getModuleCapacity(state)) return true;
	const capacity = getSupplyCapacity(state);
	return (Object.keys(output.supplies) as (keyof GameState["supplies"])[]).some((key) => output.supplies[key] > 0 && state.supplies[key] + output.supplies[key] > capacity[key]);
}

function describeRoom(state: GameState, room: RoomInstance): RoomCommandStatus {
	const definition = ROOM_DEFINITIONS[room.type], production = getRoomProductionState(state, room);
	const base = { roomId: room.id, progress: production.progress, remainingSeconds: production.remainingSeconds };
	const result = (kind: RoomCommandKind, title: string, detail: string, tab: CommandRoomTab | null, cta: string | null, priority = 0): RoomCommandStatus => ({ ...base, kind, title, detail, tab, cta, priority });
	if (room.status !== "ready") return result("building", room.status === "building" ? "Строится" : "Улучшается", "Люди и оплаченные заказы сохранятся. Работа продолжится после готовности.", "upgrade", null);
	if (!definition.production) return result("passive", "Работает без персонала", definition.description, "upgrade", null);
	const job = production.job;
	if (job && job.workDone >= job.workRequired) {
		if (outputFull(state, job.output)) return result("capacity", "Готовая партия ждёт места", production.reason ?? "Готовая партия сохранена в очереди. Освободи место или развивай склад.", "production", "Открыть очередь", 100);
		return result("ready", "Партия готова", "Готовая партия поступает на склад; новая работа продолжится по приказу.", "production", null);
	}
	const configured = Boolean(room.recipeId && (room.repeat || room.pending));
	if (production.rate === 0) return result("workers", room.workerIds.length ? "Нужен здоровый работник" : "Ждёт работников", production.reason ?? "Назначь бойца: производство требует здоровья от 25%.", "staff", "Назначить людей", job || configured ? 90 : 45);
	if (job) return result("running", "Производство идёт", production.status, "production", null);
	if (configured && room.recipeId) {
		const quote = getResourceProductionQuote(state, room.id, room.recipeId);
		const recipe = RESOURCE_RECIPES.find((item) => item.id === room.recipeId);
		if (quote.reason) {
			const inputsAvailable = Boolean(recipe && state.money >= recipe.cost.money && (Object.keys(recipe.cost.supplies) as (keyof GameState["supplies"])[]).every((key) => state.supplies[key] >= recipe.cost.supplies[key]));
			const blockedOutput = inputsAvailable && recipe && outputFull(state, { supplies: recipe.output, moduleModelId: null });
			return blockedOutput
				? result("capacity", "Нет места для следующей партии", quote.reason, "production", "Проверить склад", 75)
				: result("resources", "Партия ждёт припасов", quote.reason, "production", "Проверить рецепт", 80);
		}
		return result("ready", "Рецепт выбран", "Следующая партия запустится автоматически.", "production", null);
	}
	return result("order", room.type === "workshop" ? "Выбери модуль для сборки" : "Выбери следующую партию", room.recipeId ? "Предыдущий рецепт сохранён, повтор выключен. Выбери новую партию или включи повтор." : "Работники готовы. Выбери заказ, чтобы комната начала производство.", "production", room.type === "workshop" ? "Заказать модуль" : "Выбрать рецепт", 50);
}

/** Read-only projection; paid output blockages come before optional idle rooms. */
export function getCommandSummary(state: GameState): CommandSummary {
	const physicalRooms = [...state.shelter.rooms].sort((a, b) => a.row - b.row || a.column - b.column || a.id.localeCompare(b.id));
	const rooms = physicalRooms.map((room) => describeRoom(state, room));
	const counts: CommandSummary["counts"] = { workers: 0, order: 0, resources: 0, capacity: 0, building: 0, running: 0, ready: 0, passive: 0 };
	for (const room of rooms) counts[room.kind]++;
	return {
		rooms, counts, attention: rooms.filter((room) => room.cta !== null).sort((a, b) => b.priority - a.priority),
		queuedJobs: state.shelter.rooms.reduce((total, room) => total + room.queue.length, 0),
		freeWorkers: state.scavs.filter((scav) => !scav.assignment && scav.status !== "raiding" && scav.health >= 25).length,
	};
}
