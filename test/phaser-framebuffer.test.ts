import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { planPhaserFramebuffer, PHASER_FRAMEBUFFER_MAX_PIXELS, PHASER_FRAMEBUFFER_MAX_SIDE } from '../src/phaser-framebuffer';
import { shelterViewportForSize } from '../src/shelter-camera';

describe('bounded Phaser display framebuffer', () => {
  test('desktop FIT gains real display pixels while mobile retains its existing supersampling', () => {
    const desktop = { width: 1440, height: 900 }, logical = shelterViewportForSize(desktop.width, desktop.height);
    const standard = planPhaserFramebuffer(logical, desktop, 1);
    expect(standard.width).toBeCloseTo(desktop.width, 7);
    expect(standard.height).toBeCloseTo(desktop.height, 7);
    expect(standard.scale).toBeGreaterThan(1);
    for (const ratio of [1, 1.25, 2]) {
      const mobile = { width: 390, height: 844 }, viewport = shelterViewportForSize(mobile.width, mobile.height);
      const framebuffer = planPhaserFramebuffer(viewport, mobile, ratio);
      expect(framebuffer.width).toBe(viewport.width);
      expect(framebuffer.height).toBe(viewport.height);
      expect(framebuffer.scale).toBe(1);
    }
    expect(planPhaserFramebuffer(logical, desktop, 3)).toEqual(planPhaserFramebuffer(logical, desktop, 2));
  });

  test('all display sizes share one scale and stay inside the pixel and texture-side budgets', () => {
    for (const display of [{ width: 1920, height: 1080 }, { width: 3840, height: 2160 }, { width: 5120, height: 1440 },
      { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 4000 }]) {
      const logical = shelterViewportForSize(display.width, display.height);
      for (const ratio of [1, 1.25, 2, 4, NaN, Infinity]) {
        const framebuffer = planPhaserFramebuffer(logical, display, ratio);
        expect(framebuffer.width).toBeGreaterThan(0);
        expect(framebuffer.height).toBeGreaterThan(0);
        expect(framebuffer.width).toBeLessThanOrEqual(PHASER_FRAMEBUFFER_MAX_SIDE + 1e-8);
        expect(framebuffer.height).toBeLessThanOrEqual(PHASER_FRAMEBUFFER_MAX_SIDE + 1e-8);
        expect(framebuffer.width * framebuffer.height).toBeLessThanOrEqual(PHASER_FRAMEBUFFER_MAX_PIXELS + 1e-7);
        expect(framebuffer.width / framebuffer.height).toBeCloseTo(logical.width / logical.height, 10);
      }
    }
    const fallback = planPhaserFramebuffer({ width: NaN, height: 0 }, { width: 0, height: Infinity }, NaN);
    expect(fallback).toEqual({ width: 840, height: 520, scale: 1, scrollX: 0, scrollY: 0 });
  });

  test('the installed Phaser camera preserves world projection, native hit testing and visible world bounds', () => {
    // Phaser's device detection is worker-safe. Keep that environment in its own
    // process so importing the real camera never changes other tests' DOM setup.
    const script = `
      globalThis.importScripts = () => {};
      const assert = require('node:assert/strict');
      const Camera = require('phaser/src/cameras/2d/Camera.js');
      const { planPhaserFramebuffer, applyPhaserFramebuffer } = await import(${JSON.stringify(new URL('../src/phaser-framebuffer.ts', import.meta.url).href)});
      const { shelterViewportForSize, shelterToViewport, viewportToShelter } = await import(${JSON.stringify(new URL('../src/shelter-camera.ts', import.meta.url).href)});
      const close = (a, b, message) => assert(Math.abs(a - b) < .002, message + ': ' + a + ' vs ' + b);
      for (const display of [{width:1440,height:900},{width:1920,height:1080},{width:390,height:844},{width:844,height:390},{width:1365,height:769},{width:3840,height:2160}]) {
        const logical = shelterViewportForSize(display.width, display.height);
        const yardCamera = { zoom: 2, x: 100, y: 70 }, bounds = {x:0,y:0,width:4000,height:4000};
        for (const density of [1, 1.25, 2, 3]) {
          const framebuffer = planPhaserFramebuffer(logical, display, density);
          const camera = new Camera(0, 0, logical.width, logical.height);
          camera.setRoundPixels(true);
          applyPhaserFramebuffer(camera, framebuffer);
          camera.preRender();
          assert.equal(camera.roundPixels, false);
          assert.equal(camera.zoomX, camera.zoomY);
          for (const fraction of [0, .13, .5, .91, 1]) {
            const viewportPoint = { x: logical.width * fraction, y: logical.height * (1 - fraction) };
            const world = viewportToShelter(viewportPoint, yardCamera, logical, bounds);
            const scene = shelterToViewport(world, yardCamera, logical, bounds);
            const rendered = camera.matrix.transformPoint(scene.x - camera.scrollX, scene.y - camera.scrollY);
            const css = { x: rendered.x / framebuffer.width * display.width, y: rendered.y / framebuffer.height * display.height };
            close(css.x, viewportPoint.x / logical.width * display.width, 'CSS projection X');
            close(css.y, viewportPoint.y / logical.height * display.height, 'CSS projection Y');
            const hit = camera.getWorldPoint(rendered.x, rendered.y);
            close(hit.x, scene.x, 'Phaser hit X'); close(hit.y, scene.y, 'Phaser hit Y');
            const recovered = viewportToShelter(hit, yardCamera, logical, bounds);
            close(recovered.x, world.x, 'world hit X'); close(recovered.y, world.y, 'world hit Y');
          }
          // Camera culling rounds its world rectangle to logical pixels.
          assert(Math.abs(camera.worldView.x) <= 1 && Math.abs(camera.worldView.y) <= 1);
          assert(Math.abs(camera.worldView.width - logical.width) <= 1);
          assert(Math.abs(camera.worldView.height - logical.height) <= 1);
          assert.deepEqual(yardCamera, {zoom:2,x:100,y:70});
        }
      }
    `;
    const result = spawnSync(process.execPath, ['--eval', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
    expect(result.status).toBe(0);
  });
});
