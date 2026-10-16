import { describe, expect, test } from 'bun:test';
import { CameraGesture, panIsometricCamera } from '../src/camera-gesture';

const pointer = (x: number, y: number, pointerId = 1) => ({ pointerId, clientX: x, clientY: y });

describe('camera pan and tap ownership', () => {
	test('small hand motion keeps an inspect or explicit-placement tap without moving the camera', () => {
		for (const target of ['worker', 'building', 'empty plot', 'placement preview']) {
			const gesture = new CameraGesture<string>();
			expect(gesture.begin(pointer(100, 100), target)).toBe(true);
			expect(gesture.move(pointer(103, 102))).toBeNull();
			expect(gesture.finish(pointer(104, 103))).toEqual({ target, tapped: true, dragged: false });
		}
	});

	test('drag works from every inspect target and includes the distance before crossing its threshold', () => {
		for (const target of ['worker', 'building', 'empty plot', 'placement preview']) {
			const gesture = new CameraGesture<string>();
			gesture.begin(pointer(100, 100), target);
			gesture.move(pointer(103, 102));
			expect(gesture.move(pointer(108, 106))).toEqual({ dx: 8, dy: 6, started: true });
			expect(gesture.move(pointer(111, 110))).toEqual({ dx: 3, dy: 4, started: false });
			// Returning to the press location cannot turn a completed pan into a click.
			gesture.move(pointer(100, 100));
			expect(gesture.finish(pointer(100, 100))).toEqual({ target, tapped: false, dragged: true });
		}
	});

	test('another pointer cannot replace, finish or cancel the active camera gesture', () => {
		const gesture = new CameraGesture<string>();
		gesture.begin(pointer(0, 0), 'building');
		expect(gesture.begin(pointer(50, 50, 2), 'worker')).toBe(false);
		expect(gesture.move(pointer(80, 80, 2))).toBeNull();
		expect(gesture.finish(pointer(80, 80, 2))).toBeNull();
		expect(gesture.cancel(2)).toBeNull();
		expect(gesture.finish(pointer(0, 0))).toMatchObject({ target: 'building', tapped: true });
	});

	test('cancelled gestures never inspect on a later release and the next gesture works normally', () => {
		const gesture = new CameraGesture<string>();
		gesture.begin(pointer(0, 0), 'worker');
		gesture.move(pointer(25, 0));
		expect(gesture.cancel(1)).toBe(1);
		expect(gesture.finish(pointer(25, 0))).toBeNull();
		expect(gesture.begin(pointer(50, 50), 'building')).toBe(true);
		expect(gesture.finish(pointer(50, 50))).toMatchObject({ target: 'building', tapped: true });
	});

	test('a far-away release without intermediate moves is never treated as a tap', () => {
		const gesture = new CameraGesture<string>();
		gesture.begin(pointer(0, 0), 'placement preview');
		expect(gesture.finish(pointer(20, 20))?.tapped).toBe(false);
	});

	test('isometric drag follows the mouse at each scale and does not depend on event partitioning', () => {
		for (const tile of [.5, 32, 64, 128]) {
			const camera = { x: 100, y: 100 };
			const project = (point: { x: number; y: number }) => ({ x: ((120 - point.x) - (115 - point.y)) * tile / 2, y: ((120 - point.x) + (115 - point.y)) * tile / 4 });
			const before = project(camera), whole = panIsometricCamera(camera, 40, 25, tile), after = project(whole);
			expect(after.x - before.x).toBeCloseTo(40, 8);
			expect(after.y - before.y).toBeCloseTo(25, 8);
			let split = camera;
			for (let step = 0; step < 5; step++) split = panIsometricCamera(split, 8, 5, tile);
			expect(split.x).toBeCloseTo(whole.x, 8); expect(split.y).toBeCloseTo(whole.y, 8);
		}
	});
});
