export interface ShelterCamera { zoom: number; x: number; y: number }
export interface ShelterRect { x: number; y: number; width: number; height: number }
export interface ClientRect { left: number; top: number; width: number; height: number }
export const SHELTER_VIEW_WIDTH = 840;
export const SHELTER_VIEW_HEIGHT = 520;
export const MIN_SHELTER_ZOOM = 1;
export const MAX_SHELTER_ZOOM = 4;
const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export function clampShelterCamera(camera: ShelterCamera): ShelterCamera {
	const zoom = clamp(finite(camera.zoom, 1), MIN_SHELTER_ZOOM, MAX_SHELTER_ZOOM);
	return { zoom, x: clamp(finite(camera.x), 0, SHELTER_VIEW_WIDTH - SHELTER_VIEW_WIDTH / zoom), y: clamp(finite(camera.y), 0, SHELTER_VIEW_HEIGHT - SHELTER_VIEW_HEIGHT / zoom) };
}

export function viewportToShelter(point: { x: number; y: number }, camera: ShelterCamera): { x: number; y: number } {
	const bounded = clampShelterCamera(camera);
	return { x: finite(point.x) / bounded.zoom + bounded.x, y: finite(point.y) / bounded.zoom + bounded.y };
}

export function shelterToViewport(point: { x: number; y: number }, camera: ShelterCamera): { x: number; y: number } {
	const bounded = clampShelterCamera(camera);
	return { x: (finite(point.x) - bounded.x) * bounded.zoom, y: (finite(point.y) - bounded.y) * bounded.zoom };
}

/** Keeping the same world point under the pointer makes a wheel zoom feel attached to the scene. */
export function zoomShelterCamera(camera: ShelterCamera, zoom: number, anchor = { x: 420, y: 260 }): ShelterCamera {
	const world = viewportToShelter(anchor, camera);
	const nextZoom = clampShelterCamera({ zoom, x: 0, y: 0 }).zoom;
	return clampShelterCamera({ zoom: nextZoom, x: world.x - finite(anchor.x) / nextZoom, y: world.y - finite(anchor.y) / nextZoom });
}

export function panShelterCamera(camera: ShelterCamera, dx: number, dy: number): ShelterCamera {
	const bounded = clampShelterCamera(camera);
	return clampShelterCamera({ ...bounded, x: bounded.x + finite(dx) / bounded.zoom, y: bounded.y + finite(dy) / bounded.zoom });
}

export function focusShelterRect(camera: ShelterCamera, rect: ShelterRect, zoom = 2.4): ShelterCamera {
	const nextZoom = clampShelterCamera({ ...camera, zoom }).zoom;
	return clampShelterCamera({ zoom: nextZoom, x: finite(rect.x) + finite(rect.width) / 2 - SHELTER_VIEW_WIDTH / nextZoom / 2, y: finite(rect.y) + finite(rect.height) / 2 - SHELTER_VIEW_HEIGHT / nextZoom / 2 });
}

/** Full projected geometry is retained offscreen so a keyboard target can focus and reveal itself. */
export function projectShelterRect(rect: ShelterRect, camera: ShelterCamera, canvas: ClientRect): (ClientRect & { visible: boolean }) | null {
	if (![rect.x, rect.y, rect.width, rect.height, canvas.left, canvas.top, canvas.width, canvas.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) return null;
	const bounded = clampShelterCamera(camera), point = shelterToViewport(rect, bounded);
	const left = canvas.left + point.x * canvas.width / SHELTER_VIEW_WIDTH;
	const top = canvas.top + point.y * canvas.height / SHELTER_VIEW_HEIGHT;
	const width = rect.width * bounded.zoom * canvas.width / SHELTER_VIEW_WIDTH;
	const height = rect.height * bounded.zoom * canvas.height / SHELTER_VIEW_HEIGHT;
	return { left, top, width, height, visible: left < canvas.left + canvas.width && left + width > canvas.left && top < canvas.top + canvas.height && top + height > canvas.top };
}
