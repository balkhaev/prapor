import type { LiveWorldProp } from './game/live';
import { PIXEL_PALETTE as C } from './pixel-art';

export type DistantStreetPropSurface = { points: { x: number; y: number; z: number }[]; color: string };

/** Broad native model volumes survive street-map zoom without a detail atlas.
 * Every plane stays inside its public footprint, including rotated vehicles. */
export function distantStreetPropSurfaces(prop: LiveWorldProp): DistantStreetPropSurface[] {
  if (!['car', 'van', 'truck', 'bus', 'bus-stop', 'bench', 'playground', 'fence'].includes(prop.kind)) return [];
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
  // Open furniture keeps its real gaps at map scale. A narrow ribbon stands
  // for a rail or chain; it never becomes the old opaque ground rectangle.
  const rail = (a: [number, number, number], b: [number, number, number], thickness: number, color: string) => {
    if (a[0] === b[0] && a[1] === b[1]) {
      const half = Math.max(.004, thickness / 256);
      face([[a[0] - half, a[1], a[2]], [a[0] + half, a[1], a[2]], [b[0] + half, b[1], b[2]], [b[0] - half, b[1], b[2]]], color);
      return;
    }
    face([a, b, [b[0], b[1], b[2] + thickness], [a[0], a[1], a[2] + thickness]], color);
  };
  if (prop.kind === 'bench') {
    const timber = prop.variant === 2 ? C.green : prop.variant === 1 ? C.blue : C.woodLight;
    for (const u of [.16, .82]) box(u, .2, u + .045, .8, 0, 28, C.steel, C.steelShade, C.steelLight);
    box(.03, .08, .97, .94, 27, 33, timber, C.woodShade, timber);
    if (prop.variant !== 3) {
      for (const u of [.15, .83]) rail([u, .12, 28], [u, .12, 52], 2, C.steelShade);
      for (const z of prop.variant === 1 ? [36, 43, 50] : [38, 48]) rail([.02, .12, z], [.98, .12, z], 5, timber);
    }
    if (prop.variant === 3) face([[.56,.32,35],[.78,.32,35],[.78,.72,35],[.56,.72,35]], C.cream);
    return result;
  }
  if (prop.kind === 'fence') {
    const timber = prop.variant === 2;
    if (prop.variant === 3) box(.02,.3,.98,.7,0,14,C.brick,C.brickShade,C.plasterShade);
    for (const u of [.04, .49, .94]) rail([u, .5, 0], [u, .5, 67], 3, timber ? C.woodShade : C.steelShade);
    for (const z of [13, 61]) rail([.03,.5,z],[.97,.5,z],3,timber ? C.wood : C.steel);
    if (timber) for (const u of [.16,.3,.63,.78]) face([[u,.5,7],[u+.04,.5,7],[u+.04,.5,64],[u,.5,64]], C.plasterShade);
    else if (prop.variant === 1) for (const u of [.08,.28,.48,.68]) {
      rail([u,.5,14],[u+.18,.5,60],1,C.panelShade);
      rail([u,.5,60],[u+.18,.5,14],1,C.steelShade);
    }
    else for (const u of [.16,.3,.64,.78]) rail([u,.5,prop.variant === 3 ? 21 : 13],[u,.5,61],2,C.steel);
    return result;
  }
  if (prop.kind === 'playground') {
    const paint = prop.variant === 1 ? C.blue : C.red;
    if (prop.variant === 0) {
      for (const u of [.08,.92]) {
        rail([u,.1,0],[u,.5,121],4,C.steelShade);
        rail([u,.9,0],[u,.5,121],4,C.steel);
      }
      rail([.07,.5,121],[.93,.5,121],3,paint);
      for (const u of [.3,.68]) {
        for (const side of [-1,1]) rail([u+side*.06,.5,24],[u+side*.06,.5,117],1,C.ink);
        box(u-.08,.36,u+.08,.65,23,27,C.wood,C.woodShade,C.woodLight);
      }
    } else if (prop.variant === 1) {
      for (const [u,v] of [[.12,.23],[.12,.7],[.4,.23],[.4,.7]]) rail([u!,v!,0],[u!,v!,108],3,paint);
      box(.09,.19,.43,.75,76,82,C.yellow,C.woodShade,C.wood);
      face([[.43,.25,82],[.43,.68,82],[.95,.68,7],[.95,.25,7]],C.steelLight);
      for (const v of [.25,.68]) {
        rail([.12,v,105],[.4,v,105],3,paint);
        rail([.43,v,86],[.96,v,13],3,paint);
      }
      for (const z of [18,36,54,72]) rail([.08,.22,z],[.08,.72,z],3,C.yellow);
    } else if (prop.variant === 2) {
      box(.07,.07,.93,.93,0,10,C.wood,C.woodShade,C.terraShade);
      face([[.115,.115,11],[.885,.115,11],[.885,.885,11],[.115,.885,11]],C.sand);
      box(.48,.48,.52,.52,10,127,C.wood,C.woodShade,C.woodLight);
      face([[.09,.09,108],[.91,.09,108],[.5,.5,131]],C.red);
      face([[.91,.09,108],[.91,.91,108],[.5,.5,131]],C.terraShade);
      face([[.91,.91,108],[.09,.91,108],[.5,.5,131]],C.terra);
      face([[.09,.91,108],[.09,.09,108],[.5,.5,131]],C.woodLight);
    } else {
      const circle = (radius: number, z: number, color: string) => face(Array.from({length:8},(_,i):[number,number,number]=>[.5+Math.cos(i*Math.PI/4)*radius,.5+Math.sin(i*Math.PI/4)*radius,z]),color);
      circle(.42,14,C.steelShade); circle(.4,19,C.blue);
      box(.48,.48,.52,.52,19,56,C.red,C.rustShade,C.red);
      for (let i=0;i<4;i++) {
        const a=i*Math.PI/2,u=.5+Math.cos(a)*.29,v=.5+Math.sin(a)*.29,nx=-Math.sin(a)*.13,ny=Math.cos(a)*.13;
        rail([u,v,20],[u,v,48],3,C.yellow);
        rail([u+nx,v+ny,48],[u-nx,v-ny,48],3,C.yellow);
        rail([u,v,48],[.5,.5,48],3,C.red);
      }
    }
    return result;
  }
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
