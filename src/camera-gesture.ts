export interface CameraPointer {
	pointerId: number;
	clientX: number;
	clientY: number;
}

interface CameraGestureSession<T> {
	pointerId: number;
	start: { x: number; y: number };
	last: { x: number; y: number };
	dragged: boolean;
	target: T;
}

/** One camera gesture owns the pointer until release or cancellation. */
export class CameraGesture<T> {
	private session: CameraGestureSession<T> | null = null;
	constructor(private readonly threshold = 7) {}
	get active(): Readonly<CameraGestureSession<T>> | null { return this.session; }

	begin(pointer: CameraPointer, target: T): boolean {
		if (this.session) return false;
		const point = { x: pointer.clientX, y: pointer.clientY };
		this.session = { pointerId: pointer.pointerId, start: point, last: point, dragged: false, target };
		return true;
	}

	move(pointer: CameraPointer): { dx: number; dy: number; started: boolean } | null {
		const session = this.session;
		if (!session || pointer.pointerId !== session.pointerId) return null;
		const started = !session.dragged;
		if (started && Math.hypot(pointer.clientX - session.start.x, pointer.clientY - session.start.y) < this.threshold) return null;
		const delta = { dx: pointer.clientX - session.last.x, dy: pointer.clientY - session.last.y, started };
		session.last = { x: pointer.clientX, y: pointer.clientY };
		session.dragged = true;
		return delta;
	}

	finish(pointer: CameraPointer): { target: T; tapped: boolean; dragged: boolean } | null {
		const session = this.session;
		if (!session || pointer.pointerId !== session.pointerId) return null;
		this.session = null;
		return { target: session.target, tapped: !session.dragged && Math.hypot(pointer.clientX - session.start.x, pointer.clientY - session.start.y) < this.threshold, dragged: session.dragged };
	}

	/** A different finger losing capture must not cancel the owned pointer. */
	cancel(pointerId?: number): number | null {
		if (!this.session || pointerId !== undefined && pointerId !== this.session.pointerId) return null;
		const id = this.session.pointerId;
		this.session = null;
		return id;
	}
}

/** Convert a screen drag to the ground plane without changing its scale. */
export function panIsometricCamera(camera: { x: number; y: number }, dx: number, dy: number, tile: number): { x: number; y: number } {
	return { x: camera.x - (dx / (tile / 2) + dy / (tile / 4)) / 2, y: camera.y - (dy / (tile / 4) - dx / (tile / 2)) / 2 };
}
