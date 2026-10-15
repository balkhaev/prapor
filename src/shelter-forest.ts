import type { ShelterRect } from "./shelter-camera";
import type { ShelterLandscapeDecoration } from "./shelter-landscape";
import type { ShelterPoint } from "./shelter-motion";
import { SHELTER_ACCESS_ROAD } from "./shelter-road";

export interface ShelterForestSample {
	/** Canopy coverage; the same field shades the ground and places the trees. */
	density: number;
	/** Broad damp hollows favour spruce, ferns and moss. */
	moisture: number;
	/** Zero on the inhabited clearing, one inside the mature woodland. */
	edge: number;
	/** Sunlit meadow openings have a softer, irregular perimeter. */
	clearing: number;
}

export const SHELTER_FOREST_CELL = 76;
const hash = (x: number, y: number, salt = 0): number => {
	let value = Math.imul(x + 1357, 73856093) ^ Math.imul(y + 2461, 19349663) ^ Math.imul(salt + 17, 83492791);
	value = Math.imul(value ^ value >>> 16, 0x7feb352d);
	value = Math.imul(value ^ value >>> 15, 0x846ca68b);
	return (value ^ value >>> 16) >>> 0;
};
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (from: number, to: number, value: number): number => { const t = clamp((value - from) / (to - from)); return t * t * (3 - 2 * t); };
const unit = (seed: number): number => seed / 4294967296;
const finiteRect = (rect: ShelterRect): boolean => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width >= 0 && rect.height >= 0;

/** Continuous world-space noise has no relationship to lots, camera or texture tiles. */
function noise(point: ShelterPoint, scale: number, salt: number): number {
	const x = point.x / scale, y = point.y / scale, ix = Math.floor(x), iy = Math.floor(y);
	const u = smooth(0, 1, x - ix), v = smooth(0, 1, y - iy);
	const top = unit(hash(ix, iy, salt)) * (1 - u) + unit(hash(ix + 1, iy, salt)) * u;
	const bottom = unit(hash(ix, iy + 1, salt)) * (1 - u) + unit(hash(ix + 1, iy + 1, salt)) * u;
	return top * (1 - v) + bottom * v;
}

function distanceToLots(point: ShelterPoint, lots: readonly ShelterRect[]): number {
	let closest = Infinity;
	for (const lot of lots) {
		const dx = Math.max(lot.x - point.x, 0, point.x - lot.x - lot.width);
		const dy = Math.max(lot.y - point.y, 0, point.y - lot.y - lot.height);
		closest = Math.min(closest, Math.hypot(dx, dy));
	}
	return closest;
}

export function isShelterForestPointInBounds(point: ShelterPoint, bounds: ShelterRect): boolean {
	return point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

/** The nearby props and distant painted wood share an exact, half-open partition. */
export function getShelterForestNearBounds(lots: readonly ShelterRect[]): ShelterRect {
	const valid = lots.filter(finiteRect);
	if (!valid.length) return { x: -256, y: -256, width: 512, height: 512 };
	const left = Math.min(...valid.map(lot => lot.x)), top = Math.min(...valid.map(lot => lot.y));
	const right = Math.max(...valid.map(lot => lot.x + lot.width)), bottom = Math.max(...valid.map(lot => lot.y + lot.height));
	return { x: left - 272, y: top - 320, width: right - left + 544, height: bottom - top + 592 };
}

export function sampleShelterForest(point: ShelterPoint, lots: readonly ShelterRect[] = [], reservedLots: readonly ShelterRect[] = []): ShelterForestSample {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { density: 0, moisture: 0, edge: 0, clearing: 1 };
	const distance = Math.min(distanceToLots(point, lots), distanceToLots(point, reservedLots));
	const scallop = 56 + noise(point, 187, 71) * 100;
	const yardEdge = smooth(scallop, scallop + 136, distance);
	const roadDistance = Math.max(SHELTER_ACCESS_ROAD.top - point.y, point.y - SHELTER_ACCESS_ROAD.bottom, 0);
	const roadEdge = smooth(78, 178, roadDistance);
	const grove = noise({ x: point.x + noise(point, 270, 83) * 94, y: point.y }, 320, 89) * .68 + noise(point, 139, 97) * .32;
	const clearing = smooth(.58, .78, noise(point, 410, 101));
	const edge = yardEdge * roadEdge;
	return { density: clamp((.28 + smooth(.27, .65, grove) * .72) * (1 - clearing * .86) * edge),
		moisture: noise(point, 238, 107), edge, clearing: 1 - edge * (1 - clearing) };
}

/** A tree's entire crown stays away from the road, including the upward
 * isometric silhouette; trunk-only checks let southern trees cover the road. */
export function isShelterForestClear(point: ShelterPoint, radius: number, lots: readonly ShelterRect[] = [], reservedLots: readonly ShelterRect[] = [], canopyHeight = 0): boolean {
	if (![point.x, point.y, radius, canopyHeight].every(Number.isFinite) || radius < 0 || canopyHeight < 0) return false;
	const northReach = radius + canopyHeight / .65, southReach = radius;
	if (!(point.y + southReach < SHELTER_ACCESS_ROAD.top - 66 || point.y - northReach > SHELTER_ACCESS_ROAD.bottom + 66)) return false;
	return distanceToLots(point, lots) > radius + 31 && distanceToLots(point, reservedLots) > radius + 31;
}

/** Absolute jittered cells form connected groves rather than rows around the
 * fence. Query clipping never changes a candidate's position, species or size. */
export function getShelterForestDecorations(bounds: ShelterRect, lots: readonly ShelterRect[] = [], reservedLots: readonly ShelterRect[] = [], maxCount = 320): ShelterLandscapeDecoration[] {
	if (!finiteRect(bounds) || !Number.isFinite(maxCount) || maxCount <= 0) return [];
	const minColumn = Math.floor(bounds.x / SHELTER_FOREST_CELL) - 1, maxColumn = Math.ceil((bounds.x + bounds.width) / SHELTER_FOREST_CELL) + 1;
	const minRow = Math.floor(bounds.y / SHELTER_FOREST_CELL) - 1, maxRow = Math.ceil((bounds.y + bounds.height) / SHELTER_FOREST_CELL) + 1;
	// Normal camera coverage is far below this budget. Malformed giant queries
	// cannot create an unbounded cosmetic loop or alter any game state.
	if ((maxColumn - minColumn + 1) * (maxRow - minRow + 1) > 65536) return [];
	const decorations: ShelterLandscapeDecoration[] = [];
	for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
		const seed = hash(column, row, 113), point = { x: column * SHELTER_FOREST_CELL + 13 + seed % 51, y: row * SHELTER_FOREST_CELL + 13 + (seed >>> 9) % 51 };
		const field = sampleShelterForest(point, lots, reservedLots), chance = unit(hash(column, row, 127));
		if (field.density < .06 || chance > field.density + .13) continue;
		const isTree = chance < field.density * .83;
		if (isTree) {
			const scale = .65 + field.edge * .2 + unit(hash(column, row, 131)) * .23, radius = 25 + scale * 9;
			if (!isShelterForestClear(point, radius, lots, reservedLots, 128 * scale)) continue;
			const speciesChance = seed % 100;
			const species = field.moisture > .53 && speciesChance < 65 ? "spruce" : speciesChance < 37 ? "pine" : speciesChance < 73 ? "birch" : "deciduous";
			if (isShelterForestPointInBounds(point, bounds)) decorations.push({ kind: "tree", point, radius, seed, owned: false, species, scale });
			// Low plants sit in the same grove, with their own irregular gaps.
			if ((seed >>> 16) % 3 === 0) {
				const under = { x: point.x + 28 + seed % 17, y: point.y + 28 - (seed >>> 7) % 41 };
				if (isShelterForestPointInBounds(under, bounds) && isShelterForestClear(under, 12, lots, reservedLots))
					decorations.push({ kind: field.moisture > .44 ? "fern" : "bush", point: under, radius: 12, seed: (seed ^ 0x374761) >>> 0, owned: false, scale: .8 + field.density * .35 });
			}
		} else {
			const kind = seed % 11 === 0 ? "logs" : seed % 7 === 0 ? "rock" : seed % 5 === 0 ? "stump" : field.moisture > .58 ? "fern" : "bush", radius = kind === "logs" ? 16 : kind === "bush" ? 13 : 9;
			if (isShelterForestPointInBounds(point, bounds) && isShelterForestClear(point, radius, lots, reservedLots)) decorations.push({ kind, point, radius, seed, owned: false, scale: .76 + field.density * .28 });
		}
	}
	return decorations.sort((a, b) => a.seed - b.seed).slice(0, Math.min(4096, Math.floor(maxCount)));
}
