import { sampleSceneWeather, type SceneWeatherInput, type SceneWeatherFrame } from './scene-weather';

/** One bounded frame, sampled at 20 Hz from the shared visual clock. Camera
 * movement never adds particles, and a resized display immediately resamples. */
export class SceneWeatherCache {
  private signature = '';
  private frame: SceneWeatherFrame | null = null;
  get(input: SceneWeatherInput): SceneWeatherFrame {
    const timeMs = Math.floor(Math.max(0, Number.isFinite(input.timeMs) ? input.timeMs : 0) / 50) * 50;
    const signature = `${input.width}:${input.height}:${timeMs}:${Boolean(input.reducedMotion)}`;
    if (!this.frame || signature !== this.signature) {
      this.frame = sampleSceneWeather({ ...input, timeMs }); this.signature = signature;
    }
    return this.frame;
  }
  clear(): void { this.frame = null; this.signature = ''; }
}
