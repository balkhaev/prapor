import type { LiveEntity, LivePoint } from './game/live';
import { PixelRaster, PIXEL_PALETTE as P } from './pixel-art';
import { pixelBearing, type PixelActorFrame } from './pixel-animation';
import { paintPixelWeapon, pixelWeaponAnchors, PIXEL_WEAPON_PROFILES, type PixelWeaponId } from './pixel-weapons';

export type PixelActorGear = { profile: 'light' | 'assault' | 'scout'; helmet?: boolean; armor?: boolean; backpack?: boolean };
type ActorIdentity = Pick<LiveEntity, 'appearance' | 'faction' | 'bossId' | 'role' | 'limping'>;
export type PixelActorSprite = { image: HTMLCanvasElement; anchor: LivePoint; muzzle?: LivePoint; ejection?: LivePoint };
export const PIXEL_ACTOR_CACHE_BYTES = 24 * 1024 * 1024;
export const PIXEL_ACTOR_FRAMES = { idle: 4, walk: 8, aim: 2, fire: 3, hit: 2, downed: 1 } as const;
export const PIXEL_ACTOR_ANCHOR = { x: 96, y: 176 } as const;
export const PIXEL_ACTOR_NATIVE_SIZE = { width: 192, height: 208 } as const;
const coats = [['#67745c', '#3e5041', '#8c9576'], ['#897654', '#62543e', '#b19b72'], ['#657c87', '#40535e', '#98aaa8'], ['#8b6d60', '#604f46', '#b29b81']] as const;
const skins = [['#c6a484', '#957257', '#e0bf94'], ['#ad8767', '#795a42', '#c9a57e'], ['#d1b38b', '#a08765', '#ead0a3'], ['#a87755', '#75543e', '#c0956c']] as const;
const point = (x: number, y: number): LivePoint => ({ x: Math.round(x), y: Math.round(y) });
const frameIndex = (frame: PixelActorFrame): number => ((Number.isFinite(frame.frame) ? Math.trunc(frame.frame) : 0) % PIXEL_ACTOR_FRAMES[frame.mode] + PIXEL_ACTOR_FRAMES[frame.mode]) % PIXEL_ACTOR_FRAMES[frame.mode];

export interface PixelActorRig {
  anchor: LivePoint; grip: LivePoint; leftShoulder: LivePoint; rightShoulder: LivePoint;
  leftKnee: LivePoint; rightKnee: LivePoint; leftHeel: LivePoint; rightHeel: LivePoint; leftToe: LivePoint; rightToe: LivePoint;
  bob: number; lean: number; leftStride: number; rightStride: number; leftLift: number; rightLift: number;
}

/** A planted origin and articulated heel/toe cycle. The scene supplies distance
 * frames; the art never advances gameplay positions or its own animation clock. */
export function pixelActorRig(animation: PixelActorFrame, limping = false): PixelActorRig {
  const frame = frameIndex(animation), bearing = pixelBearing(animation.facing), lateral = { x: -bearing.y * 2, y: bearing.x * .5 };
  const walk = animation.mode === 'walk', angle = frame / 8 * Math.PI * 2;
  const leftStride = walk ? Math.round(Math.sin(angle) * (limping ? 6 : 20)) : -2, rightStride = walk ? Math.round(-Math.sin(angle) * (limping ? 10 : 20)) : 3;
  const leftLift = walk ? Math.round(Math.max(0, -Math.cos(angle)) * (limping ? 3 : 8)) : 0, rightLift = walk ? Math.round(Math.max(0, Math.cos(angle)) * 8) : 0;
  const bob = walk ? (limping ? [0, 1, 2, 1, 0, 0, 1, 0] : [0, 2, 3, 2, 0, 2, 3, 2])[frame]! : animation.mode === 'idle' ? [0, 1, 0, -1][frame]! : animation.mode === 'aim' ? frame : animation.mode === 'hit' ? -1 - frame : 0;
  const lean = animation.mode === 'hit' ? frame === 0 ? -4 : -1 : animation.mode === 'aim' || animation.mode === 'fire' ? 2 : walk ? 1 : 0;
  const p = (side: number, forward: number, z: number) => point(96 + lateral.x * side + bearing.x * forward, 176 + lateral.y * side + bearing.y * forward - z);
  const handZ = animation.mode === 'aim' || animation.mode === 'fire' ? 91 : animation.mode === 'hit' ? 77 : 79;
  // Keep the stock beside the firing shoulder, rather than in the centre of the chest.
  return { anchor: { ...PIXEL_ACTOR_ANCHOR }, grip: p(15, 17 + lean, handZ + bob), leftShoulder: p(-20, lean, 108 + bob), rightShoulder: p(20, lean, 108 + bob),
    leftKnee: p(-8, leftStride * .58 + leftLift * .25, 32 + bob * .4 + leftLift * .3 + (limping ? 5 : 0)), rightKnee: p(8, rightStride * .58 + rightLift * .25, 32 + bob * .4 + rightLift * .3),
    leftHeel: p(-8, leftStride - 4, leftLift + 2), rightHeel: p(8, rightStride - 4, rightLift + 2),
    leftToe: p(-8, leftStride + 8, leftLift + (walk && leftStride < -9 ? 3 : 1)), rightToe: p(8, rightStride + 8, rightLift + (walk && rightStride < -9 ? 3 : 1)),
    bob, lean, leftStride, rightStride, leftLift, rightLift };
}

/** Bounds follow every primitive, including the separately authored weapon. */
class ActorRaster extends PixelRaster {
  left = 192; top = 208; right = 0; bottom = 0;
  private bounds(x: number, y: number, width: number, height: number): void {
    this.left = Math.min(this.left, Math.max(0, Math.floor(x))); this.top = Math.min(this.top, Math.max(0, Math.floor(y)));
    this.right = Math.max(this.right, Math.min(192, Math.ceil(x + width))); this.bottom = Math.max(this.bottom, Math.min(208, Math.ceil(y + height)));
  }
  override rect(x: number, y: number, width: number, height: number, color: string): void { super.rect(x, y, width, height, color); if (width > 0 && height > 0) this.bounds(x, y, width, height); }
  override line(x0: number, y0: number, x1: number, y1: number, color: string, width = 1): void {
    super.line(x0, y0, x1, y1, color, width); const half = Math.ceil(width / 2); this.bounds(Math.min(x0, x1) - half, Math.min(y0, y1) - half, Math.abs(x1 - x0) + half * 2 + 1, Math.abs(y1 - y0) + half * 2 + 1);
  }
  override polygon(points: readonly LivePoint[], color: string): void {
    super.polygon(points, color); const xs = points.map(p => p.x), ys = points.map(p => p.y);
    this.bounds(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1);
  }
  override ellipse(cx: number, cy: number, rx: number, ry: number, color: string): void { super.ellipse(cx, cy, rx, ry, color); this.bounds(cx - rx, cy - ry, rx * 2 + 1, ry * 2 + 1); }
}

type PaintedActor = { muzzle?: LivePoint; ejection?: LivePoint };
function paintModel(r: PixelRaster, entity: ActorIdentity, animation: PixelActorFrame, weaponId: PixelWeaponId, gear?: PixelActorGear): PaintedActor {
  const look = Number.isFinite(entity.appearance) ? Math.abs(Math.trunc(entity.appearance)) % 32 : 0, frame = frameIndex(animation);
  const bearing = pixelBearing(animation.facing), lateral = { x: -bearing.y * 2, y: bearing.x * .5 }, rear = bearing.y < -.1;
  const rig = pixelActorRig(animation, entity.limping), boss = entity.bossId;
  const profile = gear?.profile ?? (entity.faction === 'raiders' ? 'assault' : entity.role === 'marksman' ? 'scout' : 'light');
  const coatSet = boss === 'lesnik' ? ['#66774b', '#3c533b', '#8e9c69'] : boss === 'komendant' ? ['#5c7480', '#374c59', '#91a3a5']
    : boss === 'liteyshchik' ? ['#917b5c', '#5b5c48', '#bca884'] : boss === 'bugor' ? ['#76734f', '#494e37', '#a29e6b']
      : entity.faction === 'raiders' ? look & 4 ? ['#5f6f65', '#33483d', '#899786'] : ['#6d7460', '#3c483b', '#96a084'] : coats[look % 4]!;
  const [coat, shade, light] = coatSet as readonly [string, string, string], [skin, skinShade, skinLight] = skins[Math.floor(look / 8)]!;
  const trousers = look & 4 ? '#50645a' : '#635f4b', trouserLight = look & 4 ? '#829180' : '#938a6c';
  const hair = look % 4 === 0 ? '#74573f' : look % 4 === 1 ? '#3e3931' : look % 4 === 2 ? '#918570' : '#946249';
  const torsoHalf = (boss === 'bugor' || boss === 'liteyshchik' ? 25 : boss === 'lesnik' ? 19 : boss === 'komendant' ? 23 : 21) + (animation.mode === 'idle' && frame === 2 ? 1 : 0);
  const helmet = gear?.helmet ?? (entity.faction === 'raiders' || profile === 'assault'), armor = gear?.armor ?? (profile === 'assault' || !!boss);
  const backpack = gear?.backpack ?? (profile !== 'light' || look % 3 !== 1);
  const cosmeticHat = gear?.helmet === false && Math.floor(look / 8) === 3 ? 1 : Math.floor(look / 8);
  // Explicit equipment wins over both a saved cosmetic helmet and a boss's default.
  const hat = gear?.helmet !== undefined ? helmet ? 3 : cosmeticHat
    : boss === 'lesnik' ? 2 : boss === 'komendant' ? 1 : helmet || boss === 'liteyshchik' ? 3 : cosmeticHat;
  const p = (side: number, forward: number, z = 0): LivePoint => point(96 + lateral.x * side + bearing.x * forward, 176 + lateral.y * side + bearing.y * forward - z);
  const b = (side: number, forward: number, z: number): LivePoint => p(side, forward + rig.lean, z + rig.bob);
  const line = (a: LivePoint, c: LivePoint, color: string, width = 1) => r.line(a.x, a.y, c.x, c.y, color, width);
  const outline = (vertices: LivePoint[], fill: string, ink: string = P.ink) => { r.polygon(vertices, fill); vertices.forEach((a, i) => line(a, vertices[(i + 1) % vertices.length]!, ink)); };
  const limb = (from: LivePoint, to: LivePoint, width: number, color: string, highlight?: string) => {
    line(from, to, P.ink, width + 3); line(from, to, color, width); r.ellipse(from.x, from.y, Math.floor(width / 2), Math.floor(width / 2), color);
    if (highlight) line(point(from.x - 2, from.y), point(to.x - 2, to.y - 1), highlight, 2);
  };
  const volume = (side: number, forward: number, halfW: number, halfD: number, low: number, high: number, colors: readonly string[]) => {
    const s = lateral.y >= 0 ? 1 : -1, f = bearing.y >= 0 ? 1 : -1;
    outline([b(side - halfW, forward + f * halfD, low), b(side + halfW, forward + f * halfD, low), b(side + halfW, forward + f * halfD, high), b(side - halfW, forward + f * halfD, high)], colors[0]!);
    outline([b(side + s * halfW, forward - halfD, low), b(side + s * halfW, forward + halfD, low), b(side + s * halfW, forward + halfD, high), b(side + s * halfW, forward - halfD, high)], colors[1]!);
    outline([b(side - halfW, forward - halfD, high), b(side + halfW, forward - halfD, high), b(side + halfW, forward + halfD, high), b(side - halfW, forward + halfD, high)], colors[2]!);
  };
  if (animation.mode === 'downed') {
    limb(p(-8, -42, 7), p(-10, -17, 13), 13, trousers, trouserLight); limb(p(8, -48, 8), p(8, -17, 12), 13, trousers);
    limb(p(-9, -49, 5), p(-9, -37, 5), 12, P.rubber); limb(p(9, -54, 5), p(9, -42, 5), 12, P.rubber);
    if (backpack) {
      // A fallen pack rests under the upper body; its sides and cargo pocket stay visible.
      outline([p(-23, -6, 9), p(23, -6, 9), p(23, 22, 14), p(-23, 22, 14)], '#768067');
      outline([p(-26, 0, 13), p(-20, 0, 13), p(-20, 17, 17), p(-26, 17, 17)], '#52664d');
      line(p(-23, -4, 11), p(-23, 20, 16), '#97a080', 3);
    }
    outline([p(-18, -20, 12), p(18, -20, 12), p(20, 18, 20), p(-17, 20, 20)], coat); line(p(-12, -15, 21), p(-12, 14, 22), light, 3);
    if (armor) {
      outline([p(-13, -10, 24), p(13, -10, 24), p(13, 16, 29), p(-13, 16, 29)], '#5f7263');
      line(p(-10, -8, 26), p(10, -8, 26), '#92a184', 2); line(p(-10, 12, 29), p(10, 12, 29), '#384e43', 3);
    }
    r.ellipse(p(0, 33, 18).x, p(0, 33, 18).y, 13, 9, skinShade);
    const head = p(0, 35, 22);
    r.ellipse(head.x, head.y, 13, 7, hat === 3 ? '#64795e' : hat === 2 ? '#817856' : hat === 1 ? '#79745e' : hair);
    if (hat === 3) { r.ellipse(head.x - 2, head.y - 2, 8, 3, '#99a187'); line(point(head.x - 12, head.y + 4), point(head.x + 12, head.y + 4), '#3a553f', 2); }
    else if (hat === 2) for (const side of [-1, 1]) r.ellipse(head.x + side * 11, head.y + 3, 4, 5, '#595b48');
    else if (hat === 1) line(point(head.x - 10, head.y + 5), point(head.x + 10, head.y + 5), '#3e514c', 3);
    limb(p(-18, 10, 18), p(-25, 23, 9), 10, shade); limb(p(17, 10, 18), p(21, 28, 8), 10, coat);
    paintPixelWeapon(r, weaponId, p(20, 9, 10), animation.facing); return {};
  }
  const foot = (side: number, stride: number, lift: number) => {
    const heel = stride - 4, toe = stride + 8, toeZ = lift + (animation.mode === 'walk' && stride < -9 ? 3 : 1);
    outline([p(side - 5, heel, lift + 2), p(side + 5, heel, lift + 2), p(side + 5, toe, toeZ), p(side - 5, toe + 2, toeZ)], P.rubber);
    outline([p(side - 5, heel, lift + 2), p(side + 5, heel, lift + 2), p(side + 5, heel + 4, lift + 11), p(side - 5, heel + 4, lift + 11)], '#39453d');
    line(p(side - 4, toe, toeZ + 2), p(side + 4, toe, toeZ + 2), '#8a8d76', 2);
    for (let lace = 0; lace < 3; lace++) line(p(side - 3, heel + 5 + lace * 2, lift + 9 - lace), p(side + 3, heel + 5 + lace * 2, lift + 9 - lace), '#a09879');
  };
  const leg = (side: number, stride: number, lift: number, near: boolean) => {
    const knee = p(side, stride * .58 + lift * .25, 32 + rig.bob * .4 + lift * .3 + (entity.limping && side < 0 ? 5 : 0));
    limb(b(side, 0, 57), knee, 14, near ? trousers : '#435248', near ? trouserLight : undefined); limb(knee, p(side, stride, 9 + lift), 11, trousers, near ? trouserLight : undefined);
    r.ellipse(knee.x, knee.y, 7, 5, '#3b4b40'); line(point(knee.x - 4, knee.y - 2), point(knee.x + 3, knee.y - 2), '#87917a', 2); foot(side, stride, lift);
  };
  const nearSign = lateral.y >= 0 ? 1 : -1;
  leg(-nearSign * 8, nearSign > 0 ? rig.leftStride : rig.rightStride, nearSign > 0 ? rig.leftLift : rig.rightLift, false);
  leg(nearSign * 8, nearSign > 0 ? rig.rightStride : rig.leftStride, nearSign > 0 ? rig.rightLift : rig.leftLift, true);
  const pack = () => {
    if (!backpack) return;
    volume(0, -16, profile === 'scout' || boss === 'lesnik' ? 16 : 13, 7, 65, 106, ['#768067', '#465941', '#97a080']);
    outline([b(-10, -23, 73), b(10, -23, 73), b(10, -23, 88), b(-10, -23, 88)], '#52664d');
    line(b(-10, -23, 90), b(10, -23, 90), '#b3ae82', 3); line(b(0, -23, 71), b(0, -23, 105), '#374c37', 3);
    volume(-16, -16, 3, 4, 70, 92, ['#949877', '#5b6b51', '#bab798']);
    if (profile === 'scout' || boss === 'lesnik') volume(0, -16, 17, 5, 107, 113, ['#929674', '#647653', '#b5b496']);
  };
  if (!rear) pack();
  const kick = animation.mode === 'fire' ? [0, 4, 2][frame]! : 0, weapon = pixelWeaponAnchors(weaponId, rig.grip, animation.facing, kick);
  const twoHanded = PIXEL_WEAPON_PROFILES[weaponId].twoHanded;
  const leftHand = twoHanded ? weapon.forehand : b(-19, -rig.leftStride * .6, animation.mode === 'aim' || animation.mode === 'fire' ? 72 : 57), rightHand = rig.grip;
  const arm = (side: number, hand: LivePoint, far: boolean) => {
    const shoulder = b(side * torsoHalf, 1, 105), elbow = point(shoulder.x * .42 + hand.x * .58 - bearing.x * (far ? 6 : 3), shoulder.y * .48 + hand.y * .52 + 10);
    limb(shoulder, elbow, 12, far ? shade : coat, far ? undefined : light); limb(elbow, hand, 9, coat, far ? undefined : light);
    r.ellipse(elbow.x, elbow.y, 6, 5, shade); line(point(elbow.x - 3, elbow.y - 1), point(elbow.x + 3, elbow.y + 1), light, 2);
    line(point(elbow.x * .22 + hand.x * .78, elbow.y * .22 + hand.y * .78), hand, '#3f4c3d', 10);
  };
  const farHand = nearSign > 0 ? leftHand : rightHand, nearHand = nearSign > 0 ? rightHand : leftHand;
  const hand = (at: LivePoint) => { r.ellipse(at.x, at.y, 5, 4, '#3a4e3d'); r.rect(at.x - 3, at.y - 2, 5, 3, profile === 'light' ? skin : '#82917a'); r.rect(at.x + 1, at.y, 2, 2, '#c0ad85'); };
  arm(-nearSign, farHand, true);
  if (rear) {
    // Both forearms reach around the front of the torso. Painting their hands last
    // would make them show through the back plate and the backpack.
    arm(nearSign, nearHand, false);
    paintPixelWeapon(r, weaponId, rig.grip, animation.facing, kick); hand(farHand); hand(nearHand);
  }
  outline([b(-torsoHalf, -8, 109), b(torsoHalf, -8, 109), b(torsoHalf - 5, 10, 58), b(-torsoHalf + 5, 10, 58)], shade);
  volume(0, 1, torsoHalf - 2, 11, 61, 105, [rear ? shade : coat, shade, light]);
  outline([b(-torsoHalf, 4, 106), b(-torsoHalf + 6, 12, 112), b(torsoHalf - 6, 12, 112), b(torsoHalf, 4, 106), b(torsoHalf - 4, 12, 91), b(-torsoHalf + 4, 12, 91)], coat);
  line(b(-torsoHalf + 3, 12, 91), b(-torsoHalf + 4, 12, 64), light, 3); line(b(0, 12, 101), b(0, 12, 62), '#b9aa7f', 2);
  volume(0, 1, 17, 10, 54, 62, ['#55624e', '#354a39', '#9c9970']); const buckle = b(0, 12, 59); r.rect(buckle.x - 3, buckle.y - 2, 6, 4, '#c9b27e');
  if (rear) {
    if (armor) {
      volume(0, -12, torsoHalf - 6, 3, 70, 103, ['#5f7263', '#384e43', '#92a184']);
      line(b(-torsoHalf + 7, -16, 96), b(torsoHalf - 7, -16, 96), '#a6ad8c', 2);
    }
    pack();
  }
  else {
    if (armor) { volume(0, 14, torsoHalf - 6, 3, 70, 103, ['#5f7263', '#384e43', '#92a184']); line(b(-torsoHalf + 7, 18, 96), b(torsoHalf - 7, 18, 96), '#a6ad8c', 2); }
    for (const side of [-10, 2]) volume(side, 18, 4, 3, 66, 82, [profile === 'light' ? '#93896b' : '#7e8a6c', '#4b5f46', '#b4b492']);
    line(b(-13, 13, 110), b(-11, 17, 65), '#394c39', 4); line(b(13, 13, 110), b(11, 17, 65), '#394c39', 4);
  }
  for (let mark = 0; mark < 9; mark++) { const spot = b(-15 + (mark * 11 + look * 3) % 30, rear ? -11 : 12, 70 + (mark * 7 + look) % 26); r.rect(spot.x, spot.y, 2 + mark % 3, 2, mark % 2 ? shade : light); }
  const band = b(nearSign * torsoHalf, 2, 92); r.rect(band.x - 3, band.y, 6, 5, look & 16 ? '#9d7854' : '#9ea380');
  if (boss === 'lesnik') {
    for (let i = 0; i < 9; i++) outline([b(-torsoHalf - 1 + i * 5, -8, 104), b(-torsoHalf + 4 + i * 5, -10, 77), b(-torsoHalf + i * 5, -10, 66)], i % 2 ? '#697d4a' : '#4d673f');
  } else if (boss === 'liteyshchik') {
    for (const side of [-25, 25]) volume(side, 1, 7, 8, 102, 113, ['#92957b', '#596c59', '#c1b998']);
    if (!rear) outline([b(-17, 19, 91), b(17, 19, 91), b(14, 19, 44), b(-13, 19, 44)], '#846b47');
  } else if (boss === 'komendant') {
    for (const u of [-22, 22]) { const ep = b(u, 1, 113); r.rect(ep.x - 5, ep.y, 10, 4, '#bdb694'); r.rect(ep.x - 3, ep.y + 1, 2, 2, '#e0d7ae'); }
    const radio = b(-17, rear ? -14 : 18, 94); r.rect(radio.x - 3, radio.y - 5, 6, 13, '#303e39'); r.line(radio.x, radio.y - 5, radio.x, radio.y - 17, '#a9b4a0', 2);
  } else if (boss === 'bugor') { outline([b(-16, 9, 116), b(15, 9, 116), b(14, 16, 105), b(-12, 16, 108)], '#a36550'); line(b(-12, 14, 112), b(12, 14, 111), '#d4976c', 3); }
  volume(0, 1, 7, 7, 111, 123, [skinShade, skinShade, skin]);
  const head = b(0, 1, 135), headW = 13 + Math.round(Math.abs(bearing.x) * 2);
  outline([point(head.x - 8, head.y - 15), point(head.x + 7, head.y - 15), point(head.x + headW, head.y - 8), point(head.x + headW, head.y + 5),
    point(head.x + 8, head.y + 14), point(head.x - 6, head.y + 15), point(head.x - headW, head.y + 6), point(head.x - headW, head.y - 8)], rear ? hair : skin);
  r.polygon([point(head.x + 6, head.y - 14), point(head.x + headW - 1, head.y - 7), point(head.x + headW - 1, head.y + 5), point(head.x + 7, head.y + 13), point(head.x + 3, head.y + 6)], rear ? '#655645' : skinShade);
  const ear = b(nearSign * 13, 1, 132); r.ellipse(ear.x, ear.y, 4, 6, skinShade); r.rect(ear.x - 1, ear.y - 2, 2, 4, skinLight);
  if (!rear) {
    for (const u of bearing.y > .18 && Math.abs(bearing.x) < .5 ? [-6, 6] : [bearing.x >= 0 ? -5 : 5]) { const eye = b(u, 12, 136); r.rect(eye.x - 2, eye.y - 2, 5, 2, hair); r.rect(eye.x, eye.y + 1, 2, 2, '#263631'); r.rect(eye.x - 1, eye.y + 1, 1, 1, '#e3d0a9'); }
    const nose = b(0, 16, 130), root = b(0, 11, 135); outline([point(root.x - 1, root.y), nose, point(nose.x - 2, nose.y + 3), b(0, 11, 128)], skinLight, skinShade); line(b(-4, 12, 124), b(5, 12, 124), '#876247', 2);
    if (look % 4 !== 3 || boss === 'lesnik' || boss === 'bugor') { outline([b(-10, 11, 127), b(-6, 14, 123), b(7, 14, 123), b(11, 10, 127), b(8, 12, boss === 'lesnik' ? 111 : 118), b(-7, 12, 118)], boss === 'lesnik' ? '#a49b82' : hair); line(b(-4, 14, 124), b(5, 14, 124), '#7c6450', 2); }
  }
  const hatY = head.y - 12;
  if (hat === 3) {
    r.ellipse(head.x, hatY, headW + 2, 11, P.ink); r.ellipse(head.x, hatY - 1, headW + 1, 10, boss === 'liteyshchik' ? '#7f8977' : '#64795e');
    r.polygon([point(head.x - headW + 2, hatY - 1), point(head.x - 9, hatY - 7), point(head.x - 2, hatY - 10), point(head.x + 7, hatY - 8), point(head.x + 11, hatY - 3)], '#99a187');
    line(point(head.x - headW - 1, hatY + 7), point(head.x + headW + 1, hatY + 7), '#3a553f', 3); line(b(nearSign * 12, 7, 141), b(nearSign * 11, 8, 119), '#364c38', 2);
    if (profile === 'assault') { const ear = b(nearSign * 15, 0, 135); r.ellipse(ear.x, ear.y, 5, 7, '#35483e'); r.ellipse(ear.x, ear.y, 2, 4, '#83917e'); }
    if (boss === 'liteyshchik' && !rear) { const visor = b(0, 14, 140), vw = Math.abs(bearing.x) > .8 ? 7 : 11;
      outline([point(visor.x - vw, visor.y - 6), point(visor.x + vw, visor.y - 6), point(visor.x + vw - 2, visor.y + 13), point(visor.x - vw + 2, visor.y + 13)], '#707a70');
      r.rect(visor.x - vw + 3, visor.y - 2, vw * 2 - 6, 5, '#345252'); r.rect(visor.x - vw + 4, visor.y - 1, vw * 2 - 9, 1, '#99b1a5'); }
  } else if (hat === 2) {
    r.ellipse(head.x, hatY, headW + 2, 10, P.ink); r.ellipse(head.x, hatY - 1, headW + 1, 9, boss === 'lesnik' ? '#817856' : '#6f6754');
    for (const side of [-1, 1]) { r.ellipse(head.x + side * (headW - 1), head.y - 1, 5, 12, '#595b48'); r.ellipse(head.x + side * (headW - 1), head.y - 3, 4, 10, '#a79a76'); }
    line(point(head.x - headW + 1, hatY + 6), point(head.x + headW - 1, hatY + 6), '#b1a489', 4);
    for (let stitch = 0; stitch < 7; stitch++) r.rect(head.x - 12 + stitch * 4, hatY - 3 + stitch % 2, 2, 2, '#b7aa88');
  } else if (hat === 1) {
    r.ellipse(head.x, hatY - 1, headW + 1, 9, P.ink); r.ellipse(head.x, hatY - 2, headW, 8, boss === 'komendant' ? '#607983' : '#79745e');
    line(point(head.x - headW + 2, hatY + 4), point(head.x + headW - 2, hatY + 4), '#3e514c', 3);
    outline([b(-12, 9, 143), b(12, 9, 143), b(12, 19, 142), b(-12, 19, 142)], boss === 'komendant' ? '#283e45' : '#6c6e58');
    if (boss === 'komendant') { const badge = b(0, 12, 149); r.rect(badge.x - 2, badge.y - 2, 4, 4, '#d3c17f'); }
  } else { r.ellipse(head.x, head.y - 9, headW - 1, 8, hair); r.polygon([point(head.x - headW + 2, head.y - 7), point(head.x - 8, head.y - 15), point(head.x + 5, head.y - 15), point(head.x + 9, head.y - 9)], look % 4 === 2 ? '#b0a18a' : '#927757'); line(b(nearSign * 9, 9, 143), b(nearSign * 11, 8, 136), hair, 4); }
  if (!rear) {
    paintPixelWeapon(r, weaponId, rig.grip, animation.facing, kick);
    arm(nearSign, nearHand, false); hand(farHand); hand(nearHand);
  }
  return { muzzle: weapon.muzzle, ejection: weapon.ejection };
}

/** Native render entry point for offline art previews. */
export function paintPixelActor(context: CanvasRenderingContext2D, entity: ActorIdentity, animation: PixelActorFrame, weaponId: PixelWeaponId = 'unknown', gear?: PixelActorGear): PaintedActor {
  return paintModel(new PixelRaster(context, 192, 208), entity, animation, weaponId, gear);
}

/** Tight opaque crops keep complete visible walking cycles within 24MiB. */
export class PixelActorArt {
  private sprites = new Map<string, PixelActorSprite>(); private bytes = 0;
  get retainedBytes(): number { return this.bytes; }
  clear(): void { for (const { image } of this.sprites.values()) { image.width = 1; image.height = 1; } this.sprites.clear(); this.bytes = 0; }
  get(entity: ActorIdentity, animation: PixelActorFrame, weaponId: PixelWeaponId = 'unknown', gear?: PixelActorGear): PixelActorSprite {
    const look = Number.isFinite(entity.appearance) ? Math.abs(Math.trunc(entity.appearance)) % 32 : 0, normalized = { ...animation, frame: frameIndex(animation) };
    const key = `${look}:${entity.faction}:${entity.bossId ?? ''}:${entity.role ?? ''}:${entity.limping ?? false}:${normalized.facing}:${normalized.mode}:${normalized.frame}:${weaponId}:${gear?.profile ?? ''}:${gear?.helmet ?? ''}:${gear?.armor ?? ''}:${gear?.backpack ?? ''}`;
    const old = this.sprites.get(key); if (old) { this.sprites.delete(key); this.sprites.set(key, old); return old; }
    const native = document.createElement('canvas'); native.width = 192; native.height = 208;
    const context = native.getContext('2d'); let left = 0, top = 0, width = 192, height = 208, metadata: PaintedActor = {};
    if (context) { const raster = new ActorRaster(context, 192, 208); metadata = paintModel(raster, entity, normalized, weaponId, gear); left = Math.max(0, raster.left - 2); top = Math.max(0, raster.top - 2); width = Math.min(192 - left, raster.right - left + 2); height = Math.min(208 - top, raster.bottom - top + 2); }
    const image = document.createElement('canvas'); image.width = width; image.height = height;
    const cropped = image.getContext('2d'); if (cropped) { cropped.imageSmoothingEnabled = false; cropped.drawImage(native, left, top, width, height, 0, 0, width, height); }
    native.width = 1; native.height = 1;
    const shifted = (p: LivePoint | undefined) => p ? point(p.x - left, p.y - top) : undefined;
    const sprite = { image, anchor: point(96 - left, 176 - top), muzzle: shifted(metadata.muzzle), ejection: shifted(metadata.ejection) }, bytes = width * height * 4;
    while (this.bytes + bytes > PIXEL_ACTOR_CACHE_BYTES && this.sprites.size) { const first = this.sprites.keys().next().value!, removed = this.sprites.get(first)!; this.bytes -= removed.image.width * removed.image.height * 4; this.sprites.delete(first); removed.image.width = 1; removed.image.height = 1; }
    this.sprites.set(key, sprite); this.bytes += bytes; return sprite;
  }
}
