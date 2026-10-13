import { getRoomBounds, getRoomFacing, getRoomFootprint, getRoomPosition, getShelterFrontier, getShelterSites, type GameState, type ShelterSite } from "./game/engine";
import { getShelterLandscape } from "./shelter-landscape";
import type { ShelterPoint } from "./shelter-motion";

type BoundarySide = "north" | "south" | "east" | "west";
export interface TerritoryPlanExpansion {
	site: ShelterSite;
	point: ShelterPoint;
	side: BoundarySide;
	label: string;
	progress: number | null;
}
const key = (site: ShelterSite) => `${site.column}:${site.row}`;
const sideLabel: Record<BoundarySide, string> = { west: "Слева", east: "Справа", south: "В глубину", north: "У въезда" };

/** Each continuous edge has one expansion entrance, rather than a row of lot buttons. */
function expansionEntrances(state: GameState): TerritoryPlanExpansion[] {
	const sites = getShelterSites(state.shelter), owned = new Set(sites.map(key));
	const groups = new Map<string, { site: ShelterSite; side: BoundarySide; tangent: number }[]>();
	for (const site of getShelterFrontier(state.shelter)) {
		const touching = [
			{ side: "west" as const, neighbour: { column: site.column + 1, row: site.row } },
			{ side: "east" as const, neighbour: { column: site.column - 1, row: site.row } },
			{ side: "south" as const, neighbour: { column: site.column, row: site.row - 1 } },
			{ side: "north" as const, neighbour: { column: site.column, row: site.row + 1 } },
		].filter(({ neighbour }) => owned.has(key(neighbour)));
		const side = touching[0]?.side;
		if (!side) continue;
		const vertical = side === "west" || side === "east", tangent = vertical ? site.row : site.column;
		const id = `${side}:${vertical ? site.column : site.row}`;
		const group = groups.get(id) ?? [];
		group.push({ site, side, tangent }); groups.set(id, group);
	}
	const result: TerritoryPlanExpansion[] = [];
	const entrance = (site: ShelterSite, side: BoundarySide, progress: number | null) => {
		const x = 30 + site.column * 192, y = 132 + site.row * 132;
		const point = side === "west" ? { x: x + 156, y: y + 66 }
			: side === "east" ? { x: x + 36, y: y + 66 }
			: side === "north" ? { x: x + 96, y: y + 100 }
			: { x: x + 96, y: y + 32 };
		result.push({ site: { ...site }, point, side, label: sideLabel[side], progress });
	};
	for (const group of groups.values()) {
		group.sort((a, b) => a.tangent - b.tangent);
		let run: typeof group = [];
		const finish = () => { const middle = run[Math.floor((run.length - 1) / 2)]; if (middle) entrance(middle.site, middle.side, null); run = []; };
		for (const item of group) {
			if (run.length && item.tangent > run.at(-1)!.tangent + 1) finish();
			run.push(item);
		}
		finish();
	}
	for (const expansion of state.shelter.expansions) {
		const side: BoundarySide = owned.has(key({ column: expansion.column + 1, row: expansion.row })) ? "west"
			: owned.has(key({ column: expansion.column - 1, row: expansion.row })) ? "east"
			: owned.has(key({ column: expansion.column, row: expansion.row - 1 })) ? "south" : "north";
		entrance(expansion, side, Math.max(0, Math.min(100, Math.floor(expansion.workDone / expansion.workRequired * 100))));
	}
	return result;
}

/** The map and hit surface share one continuous coordinate space, including fractional placements. */
export function getTerritoryPlanLayout(state: GameState) {
	const sites = getShelterSites(state.shelter);
	const buildings = state.shelter.rooms.map(room => ({ ...room, ...getRoomFootprint(room), position: getRoomPosition(room), facing: getRoomFacing(room) }));
	const landscape = getShelterLandscape(sites, buildings, state.shelter.expansions);
	const expansions = expansionEntrances(state);
	const rects = [...landscape.lots, ...state.shelter.rooms.map(getRoomBounds)];
	const left = Math.min(...rects.map(rect => rect.x), ...expansions.map(item => item.point.x)) - 82;
	const top = Math.min(...rects.map(rect => rect.y), ...expansions.map(item => item.point.y)) - 70;
	const right = Math.max(...rects.map(rect => rect.x + rect.width), ...expansions.map(item => item.point.x)) + 82;
	const bottom = Math.max(...rects.map(rect => rect.y + rect.height), ...expansions.map(item => item.point.y)) + 72;
	return { bounds: { x: left, y: top, width: right - left, height: bottom - top }, landscape, expansions };
}
