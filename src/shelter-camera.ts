export interface ShelterCamera { zoom: number; x: number; y: number }
export interface ShelterRect { x: number; y: number; width: number; height: number }
export interface ClientRect { left: number; top: number; width: number; height: number }
export interface ShelterViewport { width: number; height: number }
export const SHELTER_VIEW_WIDTH = 840;
export const SHELTER_VIEW_HEIGHT = 520;
export const DEFAULT_SHELTER_VIEWPORT: Readonly<ShelterViewport> = { width: SHELTER_VIEW_WIDTH, height: SHELTER_VIEW_HEIGHT };
export const MIN_SHELTER_ZOOM = 1;
export const MAX_SHELTER_ZOOM = 4;
const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const usableViewport = (viewport: ShelterViewport): ShelterViewport => ({ width: Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : SHELTER_VIEW_WIDTH, height: Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : SHELTER_VIEW_HEIGHT });
const boundedAxis = (position: number, world: number, visible: number) => visible >= world ? (world - visible) / 2 : clamp(finite(position), 0, world - visible);

/** The logical viewport follows the stage aspect; the shelter keeps its original world geometry. */
export function shelterViewportForSize(width: number, height: number): ShelterViewport {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ...DEFAULT_SHELTER_VIEWPORT };
	const aspect = width / height;
	return aspect >= SHELTER_VIEW_WIDTH / SHELTER_VIEW_HEIGHT ? { width: SHELTER_VIEW_HEIGHT * aspect, height: SHELTER_VIEW_HEIGHT } : { width: SHELTER_VIEW_WIDTH, height: SHELTER_VIEW_WIDTH / aspect };
}

export function clampShelterCamera(camera: ShelterCamera, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT): ShelterCamera {
	const view = usableViewport(viewport);
	const zoom = clamp(finite(camera.zoom, 1), MIN_SHELTER_ZOOM, MAX_SHELTER_ZOOM);
	return { zoom, x: boundedAxis(camera.x, SHELTER_VIEW_WIDTH, view.width / zoom), y: boundedAxis(camera.y, SHELTER_VIEW_HEIGHT, view.height / zoom) };
}

export function viewportToShelter(point: { x: number; y: number }, camera: ShelterCamera, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT): { x: number; y: number } {
	const bounded = clampShelterCamera(camera, viewport);
	return { x: finite(point.x) / bounded.zoom + bounded.x, y: finite(point.y) / bounded.zoom + bounded.y };
}

export function shelterToViewport(point: { x: number; y: number }, camera: ShelterCamera, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT): { x: number; y: number } {
	const bounded = clampShelterCamera(camera, viewport);
	return { x: (finite(point.x) - bounded.x) * bounded.zoom, y: (finite(point.y) - bounded.y) * bounded.zoom };
}

/** Keeping the same world point under the pointer makes a wheel zoom feel attached to the scene. */
export function zoomShelterCamera(camera: ShelterCamera, zoom: number, anchor?: { x: number; y: number }, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT): ShelterCamera {
	const view = usableViewport(viewport), at = anchor ?? { x: view.width / 2, y: view.height / 2 };
	const world = viewportToShelter(at, camera, view);
	const nextZoom = clampShelterCamera({ zoom, x: 0, y: 0 }, view).zoom;
	return clampShelterCamera({ zoom: nextZoom, x: world.x - finite(at.x) / nextZoom, y: world.y - finite(at.y) / nextZoom }, view);
}

export function panShelterCamera(camera: ShelterCamera, dx: number, dy: number, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT): ShelterCamera {
	const bounded = clampShelterCamera(camera, viewport);
	return clampShelterCamera({ ...bounded, x: bounded.x + finite(dx) / bounded.zoom, y: bounded.y + finite(dy) / bounded.zoom }, viewport);
}

export function focusShelterRect(camera: ShelterCamera, rect: ShelterRect, zoom = 2.4, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT): ShelterCamera {
	const view = usableViewport(viewport), nextZoom = clampShelterCamera({ ...camera, zoom }, view).zoom;
	return clampShelterCamera({ zoom: nextZoom, x: finite(rect.x) + finite(rect.width) / 2 - view.width / nextZoom / 2, y: finite(rect.y) + finite(rect.height) / 2 - view.height / nextZoom / 2 }, view);
}

/** Resize keeps the same viewed world center whenever the new world bounds allow it. */
export function resizeShelterCamera(camera: ShelterCamera, previousViewport: ShelterViewport, nextViewport: ShelterViewport): ShelterCamera {
	const oldView = usableViewport(previousViewport), view = usableViewport(nextViewport), bounded = clampShelterCamera(camera, oldView);
	return clampShelterCamera({ ...bounded, x: bounded.x + (oldView.width - view.width) / (2 * bounded.zoom), y: bounded.y + (oldView.height - view.height) / (2 * bounded.zoom) }, view);
}

/** Full projected geometry is retained offscreen so a keyboard target can focus and reveal itself. */
export function projectShelterRect(rect: ShelterRect, camera: ShelterCamera, canvas: ClientRect, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT): (ClientRect & { visible: boolean }) | null {
	if (![rect.x, rect.y, rect.width, rect.height, canvas.left, canvas.top, canvas.width, canvas.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) return null;
	const view = usableViewport(viewport), bounded = clampShelterCamera(camera, view), point = shelterToViewport(rect, bounded, view);
	const left = canvas.left + point.x * canvas.width / view.width;
	const top = canvas.top + point.y * canvas.height / view.height;
	const width = rect.width * bounded.zoom * canvas.width / view.width;
	const height = rect.height * bounded.zoom * canvas.height / view.height;
	return { left, top, width, height, visible: left < canvas.left + canvas.width && left + width > canvas.left && top < canvas.top + canvas.height && top + height > canvas.top };
}
