import type { LiveWorldProp } from './game/live';
import { PIXEL_PALETTE as C } from './pixel-art';

export type DistantStreetPropSurface = { points: { x: number; y: number; z: number }[]; color: string };

/** Broad native model volumes survive street-map zoom without a detail atlas.
 * Every plane stays inside its public footprint, including rotated vehicles. */
export function distantStreetPropSurfaces(prop: LiveWorldProp): DistantStreetPropSurface[] {
  if (!['car', 'van', 'truck', 'bus', 'bus-stop'].includes(prop.kind)) return [];
  if (![prop.x, prop.y, prop.width, prop.height].every(Number.isFinite) || prop.width <= 0 || prop.height <= 0 || prop.width > 10 || prop.height > 10
    || !Number.isInteger(prop.variant) || prop.variant < 0 || prop.variant > 3) return [];
  const result: DistantStreetPropSurface[] = [], paint = [C.green, C.blue, C.cream, C.red][prop.variant]!;
  const shade = prop.variant === 2 ? C.plasterShade : prop.variant === 3 ? C.rustShade : C.steelShade;
  const p = (u: number, v: number, z: number) => ({ x: prop.x - .5 + prop.width * (prop.orientation === 'x' ? u : v),
    y: prop.y - .5 + prop.height * (prop.orientation === 'x' ? v : u), z: z / 128 });
  const face = (points: [number, number, number][], color: string) => result.push({ points: points.map(([u, v, z]) => p(u, v, z)), color });
  const box = (u0: number, v0: number, u1: number, v1: number, bottom: number, top: number, light: string, dark: string, roof: string) => {
    face([[u1, v0, bottom], [u1, v1, bottom], [u1, v1, top], [u1, v0, top]], light);
    face([[u0, v1, bottom], [u1, v1, bottom], [u1, v1, top], [u0, v1, top]], dark);
    face([[u0, v0, top], [u1, v0, top], [u1, v1, top], [u0, v1, top]], roof);
  };
  if (prop.kind === 'bus-stop') {
    const roof = [C.green, C.blue, C.red, C.steel][prop.variant]!;
    box(.04, .12, .96, .88, 0, 5, C.concrete, C.concreteShade, C.sand);
    box(.08, .13, .92, .22, 5, 44, C.steel, C.steelShade, C.steelLight);
    face([[.1, .225, 47], [.9, .225, 47], [.9, .225, 120], [.1, .225, 120]], C.glass);
    for (const u of [.09, .42, .91]) box(u, .2, u + .022, .235, 5, 128, C.steel, C.steelShade, C.steelLight);
    box(.18, .31, .74, .61, 31, 37, C.wood, C.woodShade, C.woodLight);
    face([[.91, .25, 50], [.91, .7, 50], [.91, .7, 115], [.91, .25, 115]], C.cream);
    face([[.025, .035, 141], [.975, .035, 141], [.975, .95, 132], [.025, .95, 132]], roof);
    face([[.025, .95, 124], [.975, .95, 124], [.975, .95, 132], [.025, .95, 132]], C.steelShade);
    face([[.975, .035, 133], [.975, .95, 124], [.975, .95, 132], [.975, .035, 141]], C.steelShade);
    face([[.79, .96, 128], [.94, .96, 128], [.94, .96, 157], [.79, .96, 157]], C.blue);
    face([[.81, .965, 136], [.92, .965, 136], [.92, .965, 150], [.81, .965, 150]], C.cream);
    return result;
  }
  const bodyTop = prop.kind === 'bus' ? 76 : prop.kind === 'van' ? 59 : prop.kind === 'truck' ? 43 : 37;
  for (const u of [.18, .73]) box(u, .84, u + .12, .94, 2, 24, C.rubber, C.ink, C.rubber);
  box(.035, .12, .965, .88, 15, bodyTop, paint, shade, C.panelShade);
  if (prop.kind === 'car') {
    face([[.23, .19, 37], [.71, .19, 37], [.64, .27, 68], [.34, .27, 68]], shade);
    face([[.23, .81, 37], [.71, .81, 37], [.64, .73, 68], [.34, .73, 68]], paint);
    face([[.71, .19, 37], [.71, .81, 37], [.64, .73, 68], [.64, .27, 68]], C.glass);
    face([[.29, .815, 42], [.66, .815, 42], [.63, .74, 63], [.355, .74, 63]], C.glass);
    face([[.34, .27, 68], [.64, .27, 68], [.64, .73, 68], [.34, .73, 68]], paint);
  } else if (prop.kind === 'truck') {
    box(.05, .16, .67, .84, 43, 79, C.wood, C.woodShade, C.woodLight);
    box(.71, .17, .94, .83, 43, 80, paint, shade, C.panelShade);
    face([[.94, .21, 52], [.94, .79, 52], [.88, .79, 77], [.88, .21, 77]], C.glass);
  } else {
    const roof = prop.kind === 'bus' ? 102 : 84;
    box(.08, .18, .9, .82, bodyTop, roof, paint, shade, C.panelShade);
    face([[.96, .2, 52], [.96, .8, 52], [.9, .8, roof - 4], [.9, .2, roof - 4]], C.glass);
    const windows = prop.kind === 'bus' ? 5 : 1;
    for (let i = 0; i < windows; i++) {
      const u = prop.kind === 'bus' ? .13 + i * .14 : .67, width = prop.kind === 'bus' ? .1 : .2;
      face([[u, .89, 53], [u + width, .89, 53], [u + width, .89, roof - 6], [u, .89, roof - 6]], C.glass);
    }
  }
  face([[.97, .22, 28], [.97, .77, 28], [.97, .77, 36], [.97, .22, 36]], C.cream);
  return result;
}
