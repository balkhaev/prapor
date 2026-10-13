import { projectRaidFieldPoint } from "./raid-field";
import type { ShelterRect } from "./shelter-camera";
import type { ShelterPoint } from "./shelter-motion";

export const SHELTER_ROOM_WIDTH = 172;
export const SHELTER_ROOM_HEIGHT = 100;
export const SHELTER_COLUMN_STRIDE = 192;
export const SHELTER_ROW_STRIDE = 132;
const ORIGIN_X = 307;
const ORIGIN_Y = 57;
const DEPTH_ORIGIN = 100;
const HORIZONTAL_SCALE = .53;
const DEPTH_SCALE = .65;

/** Saved rooms and worker routes retain their logical coordinates; only their presentation changes. */
export function projectShelterPoint(point: ShelterPoint): ShelterPoint {
	return projectRaidFieldPoint({ x: point.x * HORIZONTAL_SCALE, y: (point.y - DEPTH_ORIGIN) * DEPTH_SCALE }, {
		originX: ORIGIN_X, originY: ORIGIN_Y, tileWidth: 2, tileHeight: 1,
	});
}

/** Inverse of the ground projection, used after removing the viewport's zoom and pan. */
export function unprojectShelterPoint(point: ShelterPoint): ShelterPoint {
	const horizontal = point.x - ORIGIN_X;
	const depth = (point.y - ORIGIN_Y) * 2;
	return { x: (horizontal + depth) / (2 * HORIZONTAL_SCALE), y: DEPTH_ORIGIN + (depth - horizontal) / (2 * DEPTH_SCALE) };
}

function projectRect(rect: ShelterRect): ShelterPoint[] {
	return [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y + rect.height },
		{ x: rect.x, y: rect.y + rect.height },
	].map(projectShelterPoint);
}

/** A camera/overlay rectangle encloses the diamond; pointer hits still use its inverse projection. */
export function projectShelterBounds(rect: ShelterRect): ShelterRect {
	const corners = projectRect(rect);
	const left = Math.min(...corners.map((point) => point.x));
	const top = Math.min(...corners.map((point) => point.y));
	return { x: left, y: top, width: Math.max(...corners.map((point) => point.x)) - left, height: Math.max(...corners.map((point) => point.y)) - top };
}

export function shelterRoomPosition(column: number, row: number): ShelterPoint {
	return { x: 40 + column * SHELTER_COLUMN_STRIDE, y: 148 + row * SHELTER_ROW_STRIDE };
}

/** Ground corners run clockwise from the room's rear corner, in absolute projected world pixels. */
export function shelterRoomPolygon(column: number, row: number): ShelterPoint[] {
	return projectRect({ ...shelterRoomPosition(column, row), width: SHELTER_ROOM_WIDTH, height: SHELTER_ROOM_HEIGHT });
}
