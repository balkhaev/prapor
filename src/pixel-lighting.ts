import type { LiveWorldProp } from './game/live';
import { pixelIso } from './pixel-art';
import { readSceneLightMode, sceneLightProfile, type SceneClimate, type SceneLightMode } from './scene-climate';
export { readSceneLightMode, sceneLightProfile, parseSceneLightMode, setSceneLightMode, type SceneLightMode } from './scene-climate';

export interface SceneLamp { x: number; y: number; headY: number; radius: number }
/** Native sprite coordinates, shared by the live and paid raid adapters. */
export function propLampSources(prop: LiveWorldProp): SceneLamp[] {
  if (prop.kind !== 'lamp') return [];
  const center = pixelIso(prop.width / 2, prop.height / 2), side = prop.orientation === 'x' ? 1 : -1;
  return (prop.variant === 1 ? [side, -side] : [side]).map(direction => ({ x: center.x + direction * 37, y: center.y, headY: center.y - 199, radius: 145 }));
}
export function visibleSceneLamps(lamps: readonly SceneLamp[], width: number, height: number): SceneLamp[] {
  return lamps.filter(light => [light.x, light.y, light.headY, light.radius].every(Number.isFinite) && light.radius > 0 && light.x + light.radius >= 0 && light.x - light.radius <= width && light.y + light.radius >= 0 && light.headY - light.radius <= height)
    .sort((a, b) => Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2)).slice(0, 32);
}

/** A single bounded, reusable light mask. Low resolution keeps soft illumination
 * in the same pixel scale as the art; it never edits textures or game state. */
export class SceneLightBuffer {
  private surface: HTMLCanvasElement | null = null;
  private signature = '';
  get canvas(): HTMLCanvasElement { return this.surface ??= document.createElement('canvas'); }
  paint(width: number, height: number, lamps: readonly SceneLamp[], mode: SceneLightMode = readSceneLightMode(), climate?: Pick<SceneClimate, 'profile'>): boolean {
    const w = Math.max(1, Math.min(640, Math.ceil(width / 3))), h = Math.max(1, Math.min(480, Math.ceil(height / 3)));
    const profile = climate?.profile ?? sceneLightProfile(mode);
    const lightKey = `${profile.ambient}:${Math.round(profile.ambientAlpha * 2048)}:${Math.round(profile.lights * 1024)}`;
    const lights = visibleSceneLamps(lamps, width, height), signature = `${w}:${h}:${width}:${height}:${mode}:${lightKey}:${lights.map(light => [light.x, light.y, light.headY, light.radius].map(n => Math.round(n * 2) / 2).join(',')).join(';')}`;
    if (signature === this.signature) return false;
    const canvas = this.canvas; canvas.width = w; canvas.height = h;
    const c = canvas.getContext('2d'); if (!c) return false;
    c.clearRect(0, 0, w, h); c.fillStyle = profile.ambient; c.globalAlpha = profile.ambientAlpha; c.fillRect(0, 0, w, h); c.globalAlpha = 1;
    c.scale(w / width, h / height);
    const halo = (x: number, y: number, rx: number, ry: number, color: string, alpha: number, operation: GlobalCompositeOperation) => {
      c.save(); c.globalCompositeOperation = operation; c.globalAlpha = alpha; c.translate(x, y); c.scale(rx, ry);
      const gradient = c.createRadialGradient(0, 0, 0, 0, 0, 1); gradient.addColorStop(0, color); gradient.addColorStop(.38, color); gradient.addColorStop(1, 'transparent');
      c.fillStyle = gradient; c.fillRect(-1, -1, 2, 2); c.restore();
    };
    for (const light of lights) {
      const r = light.radius;
      halo(light.x, light.y - r * .08, r, r * .48, '#000', Math.min(.9, profile.lights * .62), 'destination-out');
      halo(light.x, light.y - r * .08, r, r * .48, '#eac98a', profile.lights * .085, 'source-over');
      halo(light.x, light.headY, r * .15, r * .15, '#f6dda2', profile.lights * .19, 'source-over');
    }
    this.signature = signature; return true;
  }
  clear(): void { if (this.surface) { this.surface.width = 1; this.surface.height = 1; } this.surface = null; this.signature = ''; }
}
