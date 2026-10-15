const level = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
/** Rain fills small hollows faster than exposed ground dries. These are visual seconds,
 * independent of raid progress, simulation ticks and saved inventories. */
export const SURFACE_FILL_MS = 30_000;
export const SURFACE_DRY_MS = 150_000;
export function settledSurfaceWetness(rain: number): number {
  const r = level(rain), fill = r / SURFACE_FILL_MS, dry = (1 - r) / SURFACE_DRY_MS;
  return fill / (fill + dry);
}
/** Exact response for constant rain; splitting frames cannot change the result. */
export function advanceSurfaceWetness(initial: number, rain: number, elapsedMs: number): number {
  const r = level(rain), elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (elapsed === 0) return level(initial);
  const rate = r / SURFACE_FILL_MS + (1 - r) / SURFACE_DRY_MS, target = settledSurfaceWetness(r);
  return level(target + (level(initial) - target) * Math.exp(-rate * elapsed));
}
/** Two weather periods of causal history establish the same damp ground on scene
 * entry and after reload. Fixed midpoint samples keep work bounded and continuous. */
export function sampleRainHistoryWetness(timeMs: number, rainAt: (timeMs: number) => number, anchor?: { timeMs: number; wetness: number }): number {
  const time = Number.isFinite(timeMs) ? Math.max(-1e15, Math.min(1e15, timeMs)) : 0;
  const samples = 144, memory = samples * 15_000;
  const anchored = anchor && Number.isFinite(anchor.timeMs) && anchor.timeMs >= time - memory;
  const from = anchored ? Math.min(time, anchor.timeMs) : time - memory, step = (time - from) / samples;
  let wetness = anchored ? level(anchor.wetness) : 0;
  if (step === 0) return wetness;
  for (let i = 0; i < samples; i++) wetness = advanceSurfaceWetness(wetness, rainAt(time - (samples - i - .5) * step), step);
  return wetness;
}
