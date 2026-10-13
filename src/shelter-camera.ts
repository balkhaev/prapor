export interface ShelterCamera { zoom: number; x: number; y: number }
export interface ShelterRect { x: number; y: number; width: number; height: number }
export interface ClientRect { left: number; top: number; width: number; height: number }
export interface ShelterViewport { width: number; height: number }
export const SHELTER_VIEW_WIDTH = 840;
export const SHELTER_VIEW_HEIGHT = 520;
export const DEFAULT_SHELTER_VIEWPORT: Readonly<ShelterViewport> = { width: SHELTER_VIEW_WIDTH, height: SHELTER_VIEW_HEIGHT };
export const MIN_SHELTER_ZOOM = 1;
export const MAX_SHELTER_ZOOM = 4;
const DEFAULT_SHELTER_BOUNDS: ShelterRect = { x: 0, y: 0, width: SHELTER_VIEW_WIDTH, height: SHELTER_VIEW_HEIGHT };
const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const usableViewport = (viewport: ShelterViewport): ShelterViewport => ({ width: Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : SHELTER_VIEW_WIDTH, height: Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : SHELTER_VIEW_HEIGHT });
const usableBounds = (bounds: ShelterRect): ShelterRect => ({ x: finite(bounds.x), y: finite(bounds.y), ...usableViewport(bounds) });
const boundedAxis = (position: number, origin: number, world: number, visible: number) => visible >= world ? origin + (world - visible) / 2 : clamp(finite(position, origin), origin, origin + world - visible);

/** The logical viewport follows the stage aspect; the shelter keeps its original world geometry. */
export function shelterViewportForSize(width: number, height: number): ShelterViewport {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ...DEFAULT_SHELTER_VIEWPORT };
	const aspect = width / height;
	return aspect >= SHELTER_VIEW_WIDTH / SHELTER_VIEW_HEIGHT ? { width: SHELTER_VIEW_HEIGHT * aspect, height: SHELTER_VIEW_HEIGHT } : { width: SHELTER_VIEW_WIDTH, height: SHELTER_VIEW_WIDTH / aspect };
}

export function getMinShelterZoom(viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): number {
	const view = usableViewport(viewport), world = usableBounds(bounds);
	return Math.min(MIN_SHELTER_ZOOM, view.width / world.width, view.height / world.height);
}

export function shelterOverviewCamera(viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): ShelterCamera {
	const view = usableViewport(viewport), world = usableBounds(bounds), zoom = getMinShelterZoom(view, world);
	return clampShelterCamera({ zoom, x: world.x + (world.width - view.width / zoom) / 2, y: world.y + (world.height - view.height / zoom) / 2 }, view, world);
}

export function clampShelterCamera(camera: ShelterCamera, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): ShelterCamera {
	const view = usableViewport(viewport), world = usableBounds(bounds);
	const zoom = clamp(finite(camera.zoom, 1), getMinShelterZoom(view, world), MAX_SHELTER_ZOOM);
	return { zoom, x: boundedAxis(camera.x, world.x, world.width, view.width / zoom), y: boundedAxis(camera.y, world.y, world.height, view.height / zoom) };
}

export function viewportToShelter(point: { x: number; y: number }, camera: ShelterCamera, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): { x: number; y: number } {
	const bounded = clampShelterCamera(camera, viewport, bounds);
	return { x: finite(point.x) / bounded.zoom + bounded.x, y: finite(point.y) / bounded.zoom + bounded.y };
}

export function shelterToViewport(point: { x: number; y: number }, camera: ShelterCamera, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): { x: number; y: number } {
	const bounded = clampShelterCamera(camera, viewport, bounds);
	return { x: (finite(point.x) - bounded.x) * bounded.zoom, y: (finite(point.y) - bounded.y) * bounded.zoom };
}

/** Keeping the same world point under the pointer makes a wheel zoom feel attached to the scene. */
export function zoomShelterCamera(camera: ShelterCamera, zoom: number, anchor?: { x: number; y: number }, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): ShelterCamera {
	const view = usableViewport(viewport), at = anchor ?? { x: view.width / 2, y: view.height / 2 };
	const world = viewportToShelter(at, camera, view, bounds);
	const nextZoom = clampShelterCamera({ zoom, x: 0, y: 0 }, view, bounds).zoom;
	return clampShelterCamera({ zoom: nextZoom, x: world.x - finite(at.x) / nextZoom, y: world.y - finite(at.y) / nextZoom }, view, bounds);
}

export function panShelterCamera(camera: ShelterCamera, dx: number, dy: number, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): ShelterCamera {
	const bounded = clampShelterCamera(camera, viewport, bounds);
	return clampShelterCamera({ ...bounded, x: bounded.x + finite(dx) / bounded.zoom, y: bounded.y + finite(dy) / bounded.zoom }, viewport, bounds);
}

export function focusShelterRect(camera: ShelterCamera, rect: ShelterRect, zoom = 2.4, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): ShelterCamera {
	const view = usableViewport(viewport), nextZoom = clampShelterCamera({ ...camera, zoom }, view, bounds).zoom;
	return clampShelterCamera({ zoom: nextZoom, x: finite(rect.x) + finite(rect.width) / 2 - view.width / nextZoom / 2, y: finite(rect.y) + finite(rect.height) / 2 - view.height / nextZoom / 2 }, view, bounds);
}

/** Resize keeps the same viewed world center whenever the new world bounds allow it. */
export function resizeShelterCamera(camera: ShelterCamera, previousViewport: ShelterViewport, nextViewport: ShelterViewport, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): ShelterCamera {
	const oldView = usableViewport(previousViewport), view = usableViewport(nextViewport), bounded = clampShelterCamera(camera, oldView, bounds);
	const zoom = clampShelterCamera(bounded, view, bounds).zoom;
	return clampShelterCamera({ zoom, x: bounded.x + oldView.width / (2 * bounded.zoom) - view.width / (2 * zoom), y: bounded.y + oldView.height / (2 * bounded.zoom) - view.height / (2 * zoom) }, view, bounds);
}

/** Full projected geometry is retained offscreen so a keyboard target can focus and reveal itself. */
export function projectShelterRect(rect: ShelterRect, camera: ShelterCamera, canvas: ClientRect, viewport: ShelterViewport = DEFAULT_SHELTER_VIEWPORT, bounds: ShelterRect = DEFAULT_SHELTER_BOUNDS): (ClientRect & { visible: boolean }) | null {
	if (![rect.x, rect.y, rect.width, rect.height, canvas.left, canvas.top, canvas.width, canvas.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) return null;
	const view = usableViewport(viewport), bounded = clampShelterCamera(camera, view, bounds), point = shelterToViewport(rect, bounded, view, bounds);
	const left = canvas.left + point.x * canvas.width / view.width;
	const top = canvas.top + point.y * canvas.height / view.height;
	const width = rect.width * bounded.zoom * canvas.width / view.width;
	const height = rect.height * bounded.zoom * canvas.height / view.height;
	return { left, top, width, height, visible: left < canvas.left + canvas.width && left + width > canvas.left && top < canvas.top + canvas.height && top + height > canvas.top };
}
