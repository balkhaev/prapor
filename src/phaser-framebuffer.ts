import type Phaser from 'phaser';
import { DEFAULT_SHELTER_VIEWPORT, type ShelterViewport } from './shelter-camera';

export const PHASER_FRAMEBUFFER_MAX_PIXELS = 6_000_000;
export const PHASER_FRAMEBUFFER_MAX_SIDE = 4096;

export interface PhaserFramebuffer {
  width: number;
  height: number;
  scale: number;
  scrollX: number;
  scrollY: number;
}

/** FIT may enlarge the logical yard on a desktop. Allocate those missing display
 * pixels, retaining the existing mobile supersampling and a bounded GPU surface.
 * Keep the raw dimensions proportional: Phaser accepts fractional game sizes and
 * the canvas allocation truncates by less than one device pixel, without changing
 * the FIT aspect or the game's logical viewport. */
export function planPhaserFramebuffer(logical: ShelterViewport, display: ShelterViewport, deviceRatio: number): PhaserFramebuffer {
  const valid = (value: number) => Number.isFinite(value) && value > 0;
  const viewport = valid(logical.width) && valid(logical.height) ? logical : DEFAULT_SHELTER_VIEWPORT;
  const density = Math.max(1, Math.min(Number.isFinite(deviceRatio) ? deviceRatio : 1, 2));
  const displayScale = valid(display.width) && valid(display.height)
    ? Math.min(display.width / viewport.width, display.height / viewport.height) : 1;
  const requested = Math.max(1, displayScale * density);
  const limit = Math.min(PHASER_FRAMEBUFFER_MAX_SIDE / viewport.width, PHASER_FRAMEBUFFER_MAX_SIDE / viewport.height,
    Math.sqrt(PHASER_FRAMEBUFFER_MAX_PIXELS / viewport.width / viewport.height));
  const scale = Math.min(requested, limit), width = viewport.width * scale, height = viewport.height * scale;
  // Camera.preRender rounds its center even with roundPixels disabled. Include
  // that half-pixel translation so pointer inversion and sprite projection agree.
  return { width, height, scale, scrollX: Math.round(width / 2) / scale - width / 2,
    scrollY: Math.round(height / 2) / scale - height / 2 };
}

/** This camera only maps logical scene pixels to the framebuffer. The shelter
 * and raid cameras, hit areas, saved zoom and client/world projection stay intact. */
export function applyPhaserFramebuffer(camera: Pick<Phaser.Cameras.Scene2D.Camera, 'setSize' | 'setOrigin' | 'setZoom' | 'setScroll' | 'setRoundPixels'>, framebuffer: PhaserFramebuffer): void {
  camera.setSize(framebuffer.width, framebuffer.height);
  camera.setOrigin(.5, .5);
  camera.setZoom(framebuffer.scale);
  camera.setRoundPixels(false);
  camera.setScroll(framebuffer.scrollX, framebuffer.scrollY);
}
