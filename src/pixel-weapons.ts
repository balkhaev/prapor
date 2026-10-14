import type { LivePoint } from './game/live';
import { PixelRaster, type PixelColor } from './pixel-art';
import { pixelBearing, type PixelFacing } from './pixel-animation';

export const PIXEL_WEAPON_IDS = ['pm', 'pp91', 'sks', 'mosin', 'akm', 'svd', 'unknown'] as const;
export type PixelWeaponId = typeof PIXEL_WEAPON_IDS[number];

/** Only a public known model selects exact weapon art; absent/private IDs stay neutral. */
export function pixelWeaponId(value: unknown): PixelWeaponId {
  return typeof value === 'string' && (PIXEL_WEAPON_IDS as readonly string[]).includes(value) ? value as PixelWeaponId : 'unknown';
}

export type PixelWeaponAnchors = { muzzle: LivePoint; ejection: LivePoint; forehand: LivePoint };
export type PixelWeaponProfile = {
  /** Native longitudinal dimensions, before the isometric bearing foreshortens them. */
  length: number; forward: number; rear: number; boreHeight: number; support: number;
  twoHanded: boolean; scoped: boolean;
};
export const PIXEL_WEAPON_PROFILES = {
  pm: { length: 22, forward: 17, rear: 5, boreHeight: 8, support: 3, twoHanded: false, scoped: false },
  pp91: { length: 47, forward: 28, rear: 19, boreHeight: 9, support: 13, twoHanded: true, scoped: false },
  sks: { length: 75, forward: 49, rear: 26, boreHeight: 10, support: 25, twoHanded: true, scoped: false },
  mosin: { length: 79, forward: 52, rear: 27, boreHeight: 10, support: 27, twoHanded: true, scoped: false },
  akm: { length: 67, forward: 42, rear: 25, boreHeight: 10, support: 22, twoHanded: true, scoped: false },
  svd: { length: 79, forward: 53, rear: 26, boreHeight: 10, support: 27, twoHanded: true, scoped: true },
  unknown: { length: 66, forward: 42, rear: 24, boreHeight: 10, support: 21, twoHanded: true, scoped: false },
} as const satisfies Record<PixelWeaponId, PixelWeaponProfile>;

/** Shared metal/wood values keep small features readable beside the actor palette. */
export const PIXEL_WEAPON_PALETTE = {
  outline: '#20322e', black: '#2a3a35', metal: '#50685f', metalLight: '#81958a', edge: '#adb49b',
  wood: '#987047', woodShade: '#614b35', woodLight: '#b89160', grip: '#76513b', glass: '#536e68',
} as const;
const C = PIXEL_WEAPON_PALETTE;
type ProfilePoint = readonly [u: number, z: number];

function geometry(id: PixelWeaponId, grip: LivePoint, facing: PixelFacing, kick: number) {
  const profile = PIXEL_WEAPON_PROFILES[id], forward = pixelBearing(facing);
  const sideways = { x: -forward.y * 2, y: forward.x * .5 };
  const recoil = Number.isFinite(kick) ? Math.max(0, Math.min(4, kick)) : 0;
  const origin = { x: Math.round(grip.x), y: Math.round(grip.y) };
  const point = (u: number, z: number, v = 0): LivePoint => ({
    x: Math.round(origin.x + forward.x * u + sideways.x * v),
    y: Math.round(origin.y + forward.y * u + sideways.y * v - z - recoil * u / profile.forward),
  });
  return { profile, forward, point, near: forward.x >= 0 ? 1 : -1 };
}

/** The trigger grip never recoils. Body art can solve arms before painting the weapon. */
export function pixelWeaponAnchors(id: PixelWeaponId, grip: LivePoint, facing: PixelFacing, kick = 0): PixelWeaponAnchors {
  const { profile, point } = geometry(id, grip, facing, kick);
  return {
    muzzle: point(profile.forward, profile.boreHeight),
    ejection: point(id === 'pm' ? 7 : 8, profile.boreHeight + 2, 3),
    forehand: point(profile.support, id === 'pm' ? -1 : profile.boreHeight - 6),
  };
}

/** Weapon models have no inventory or state access; unknown remains an anonymous silhouette. */
export function paintPixelWeapon(r: PixelRaster, id: PixelWeaponId, grip: LivePoint, facing: PixelFacing, kick = 0): PixelWeaponAnchors {
  const { profile, point: p, near } = geometry(id, grip, facing, kick);
  const segment = (a: ProfilePoint, b: ProfilePoint, color: PixelColor, width = 1, v = 0): void => {
    const start = p(a[0], a[1], v), end = p(b[0], b[1], v);
    r.line(start.x, start.y, end.x, end.y, color, width);
  };
  // Extruded profile edges stay visible when the barrel points straight north/south.
  const shape = (points: readonly ProfilePoint[], color: PixelColor, top: PixelColor, depth = 5, shade: PixelColor = C.black): void => {
    const faces = points.map((a, i) => {
      const b = points[(i + 1) % points.length]!;
      const quad = [p(a[0],a[1],-depth/2),p(b[0],b[1],-depth/2),p(b[0],b[1],depth/2),p(a[0],a[1],depth/2)];
      return { quad, y: quad.reduce((sum, v) => sum + v.y, 0) / 4, color: a[1] + b[1] >= profile.boreHeight * 2 ? top : shade };
    }).sort((a,b) => a.y-b.y);
    for (const face of faces) r.polygon(face.quad, face.color);
    const face = points.map(([u,z]) => p(u,z,near*depth/2));
    r.polygon(face,color);
    for (let i=0;i<face.length;i++) {
      const a=face[i]!, b=face[(i+1)%face.length]!;r.line(a.x,a.y,b.x,b.y,C.outline);
    }
  };
  const box = (u0:number,u1:number,z0:number,z1:number,color:PixelColor,top:PixelColor=C.metalLight,depth=5):void => {
    shape([[u0,z0],[u1,z0],[u1,z1],[u0,z1]],color,top,depth);
  };
  const barrel = (from:number,to:number,z:number,thickness=3):void => {
    box(from,to,z-thickness/2,z+thickness/2,C.black,C.metalLight,thickness);
    segment([from,z+thickness/2],[to,z+thickness/2],C.metalLight,1,-near);
  };
  const stock = (rear:number,end:number,wood=true):void => {
    shape([[rear,-5],[rear+3,10],[rear+10,11],[end,7],[end,2],[rear+9,-3]],
      wood?C.wood:C.black,wood?C.woodLight:C.metal,6,wood?C.woodShade:C.black);
    segment([rear+3,7],[end-3,5],wood?C.woodLight:C.metalLight,1,near*3);
    segment([rear+1,-3],[rear+3,8],C.black,2,near*3);
  };
  const pistolGrip = (wood=false):void => {
    shape([[-5,5],[1,3],[-1,-10],[-7,-8]],wood?C.grip:C.black,wood?C.wood:C.metal,4);
    segment([-5,1],[-5,-6],wood?C.woodLight:C.metal,1,near*2);
  };
  const triggerGuard = ():void => {
    segment([0,3],[7,3],C.outline,2,near*2);
    segment([7,3],[6,-2],C.outline,2,near*2);
    segment([6,-2],[0,-2],C.outline,2,near*2);
    segment([2,3],[2,0],C.edge,1,near*2);
  };
  const sights = (rear:number,front:number,z:number):void => {
    box(rear,rear+2,z,z+3,C.black,C.edge,3);
    box(front-2,front,z,z+4,C.black,C.metalLight,3);
  };

  if (id === 'pm') {
    pistolGrip(true);triggerGuard();
    shape([[-5,5],[13,5],[17,7],[17,10],[14,12],[-4,12],[-6,9]],C.metal,C.metalLight,5);
    segment([-3,10],[13,10],C.edge,1,near*2.5);
    for (const u of [-3,-1,1])segment([u,6],[u,9],C.black,1,near*2.5);
    box(5,8,9,11,C.black,C.metal,1);
    sights(-4,15,12);
  } else if (id === 'pp91') {
    // Unfolded wire stock, compact box receiver and straight pistol-calibre magazine.
    segment([-19,8],[-8,8],C.metalLight,2);segment([-19,-4],[-19,8],C.black,3);
    segment([-19,-4],[-8,4],C.metal,2);segment([-8,4],[-7,8],C.black,3);
    pistolGrip();triggerGuard();
    shape([[3,4],[9,4],[10,-14],[5,-15]],C.black,C.metal,4);
    segment([6,0],[7,-12],C.metalLight,1,near*2);
    box(-7,16,5,13,C.black,C.metalLight,6);
    box(11,20,4,9,C.metal,C.metalLight,6);
    for(const u of [12,15,18])segment([u,5],[u,8],C.black,1,near*3);
    barrel(18,28,9,3);sights(-5,22,13);
    segment([1,11],[7,11],C.edge,1,near*3);
  } else if (id === 'sks') {
    stock(-26,-5);
    shape([[-7,2],[14,1],[32,5],[33,9],[-6,9]],C.wood,C.woodLight,6,C.woodShade);
    box(-5,15,8,13,C.black,C.metalLight,5);
    shape([[6,2],[17,3],[15,-3],[8,-5]],C.black,C.metal,4);
    barrel(30,49,10);barrel(15,33,12,2);
    for(const u of [19,28])box(u,u+2,5,12,C.black,C.metalLight,7);
    segment([19,5],[31,6],C.woodLight,1,near*3);
    segment([32,6],[44,7],C.metal,2); // Folded integral bayonet.
    segment([4,13],[7,15],C.metalLight,2,near*3);sights(12,46,12);
  } else if (id === 'mosin') {
    stock(-27,-5);
    shape([[-6,2],[16,3],[35,6],[36,9],[-5,10]],C.wood,C.woodLight,6,C.woodShade);
    barrel(-5,52,10,2);box(-5,13,8,13,C.metal,C.edge,4);
    for(const u of [25,34])box(u,u+2,5,12,C.black,C.metalLight,7);
    segment([10,13],[6,13],C.edge,2,near*2);
    segment([6,13],[6,8],C.metalLight,2,near*6);
    const bolt=p(6,8,near*8);r.ellipse(bolt.x,bolt.y,2,2,C.edge);
    segment([14,7],[31,7],C.woodLight,1,near*3);sights(18,49,11);
  } else if (id === 'akm') {
    stock(-25,-7);pistolGrip(true);triggerGuard();
    shape([[3,4],[10,4],[12,-3],[16,-11],[14,-16],[9,-15],[4,-8],[1,-1]],C.black,C.metal,5);
    for(const u of [4,7,10])segment([u,1],[u+3,-11],C.metalLight,1,near*2.5);
    box(-7,14,5,13,C.black,C.metalLight,6);
    shape([[14,6],[27,6],[29,11],[15,12]],C.wood,C.woodLight,7,C.woodShade);
    for(const u of [17,21,25])segment([u,7],[u,10],C.woodShade,1,near*3.5);
    barrel(25,42,10);barrel(14,35,15,2);box(31,33,9,15,C.black,C.metal,5);
    shape([[40,8],[42,9],[42,12],[40,11]],C.metal,C.edge,4);
    segment([-4,13],[11,13],C.edge,1,near*2);segment([6,10],[11,10],C.metalLight,1,near*3);
    sights(13,38,14);
  } else if (id === 'svd') {
    // Open wooden thumbhole stock and cheek rest; the PSO belongs to this model alone.
    shape([[-26,-6],[-23,11],[-18,12],[-6,8],[-5,4],[-20,5],[-22,-6]],C.wood,C.woodLight,6,C.woodShade);
    segment([-22,-6],[-7,2],C.wood,4);segment([-25,-5],[-24,9],C.black,2);
    box(-22,-9,11,15,C.woodShade,C.woodLight,6);
    shape([[7,5],[14,5],[18,-9],[11,-11],[7,-7]],C.black,C.metal,5);
    segment([10,1],[14,-8],C.metalLight,1,near*2.5);
    box(-5,17,6,14,C.black,C.metalLight,5);
    shape([[17,6],[35,7],[36,12],[18,14]],C.wood,C.woodLight,7,C.woodShade);
    for(const u of [20,24,28,32])box(u,u+2,9,11,C.black,C.woodShade,1);
    barrel(34,53,10);box(47,49,9,17,C.black,C.metal,4);
    box(-1,2,13,19,C.black,C.metal,4);box(11,14,13,19,C.black,C.metal,4);
    barrel(-4,20,22,5);box(-6,-2,19,25,C.black,C.metalLight,7);box(17,23,18,26,C.black,C.metalLight,8);
    const objective=p(23,22);r.ellipse(objective.x,objective.y,2,2,C.glass);
    segment([1,24],[15,24],C.edge);sights(15,49,14);
  } else {
    // Deliberately neutral; remote NPC art must not assert a private loadout or optic.
    stock(-24,-7,false);pistolGrip();triggerGuard();
    box(4,10,-10,4,C.black,C.metal,4);box(-7,14,5,13,C.black,C.metalLight,6);
    box(14,28,6,11,C.metal,C.metalLight,6);barrel(27,42,10);sights(11,37,13);
  }
  // The returned centre is also the visible barrel aperture; effects never drift onto a sight.
  const anchors=pixelWeaponAnchors(id,grip,facing,kick);
  r.pixel(anchors.muzzle.x,anchors.muzzle.y,C.outline);
  return anchors;
}
