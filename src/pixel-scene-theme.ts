import { PIXEL_PALETTE as P } from './pixel-art';

/** The same material pigments identify actors, routes and loot in every map. */
export const PIXEL_SCENE_THEME = {
  background: P.ink, panel: P.black, border: P.shadow, text: P.cream, muted: P.panelShade,
  self: P.yellow, ally: P.blue, hostile: P.red, boss: P.rust, loot: P.woodLight, extract: P.leafLight,
  route: P.steelLight, healthy: P.leafLight, injured: P.terra, flash: P.cream, tracer: P.yellow,
} as const;
export const pixelSceneTint = (value: string): number => Number.parseInt(value.slice(1), 16);
