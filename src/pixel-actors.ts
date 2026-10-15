import type { LiveEntity, LivePoint } from './game/live';
import { PixelRaster, PIXEL_PALETTE as P } from './pixel-art';
import { pixelBearing, type PixelActorFrame } from './pixel-animation';
import { paintPixelWeapon, pixelWeaponAnchors, pixelWeaponProfile, pixelWeaponSignature, type PixelWeaponInput } from './pixel-weapons';
import { pixelActorRig } from './pixel-actor-rig';
import { PIXEL_ACTOR_CACHE_BYTES, PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_NATIVE_SIZE, frameIndex } from './pixel-actor-config';
export { pixelActorRig, type PixelActorRig } from './pixel-actor-rig';
export { PIXEL_ACTOR_CACHE_BYTES, PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_NATIVE_SIZE } from './pixel-actor-config';

export type PixelActorGear = { profile: 'light' | 'assault' | 'scout'; helmet?: boolean; armor?: boolean; backpack?: boolean };
type ActorIdentity = Pick<LiveEntity, 'appearance' | 'faction' | 'bossId' | 'role' | 'limping'>;
export type PixelActorSprite = { image: HTMLCanvasElement; anchor: LivePoint; muzzle?: LivePoint; ejection?: LivePoint };
const coats = [['#67745c', '#3e5041', '#8c9576'], ['#897654', '#62543e', '#b19b72'], ['#657c87', '#40535e', '#98aaa8'], ['#8b6d60', '#604f46', '#b29b81']] as const;
const skins = [['#c6a484', '#957257', '#e0bf94'], ['#ad8767', '#795a42', '#c9a57e'], ['#d1b38b', '#a08765', '#ead0a3'], ['#a87755', '#75543e', '#c0956c']] as const;
const point = (x: number, y: number): LivePoint => ({ x: Math.round(x), y: Math.round(y) });

/** Bounds follow every primitive, including the separately authored weapon. */
class ActorRaster extends PixelRaster {
  left: number = PIXEL_ACTOR_NATIVE_SIZE.width; top: number = PIXEL_ACTOR_NATIVE_SIZE.height; right = 0; bottom = 0;
  private bounds(x: number, y: number, width: number, height: number): void {
    this.left = Math.min(this.left, Math.max(0, Math.floor(x))); this.top = Math.min(this.top, Math.max(0, Math.floor(y)));
    this.right = Math.max(this.right, Math.min(PIXEL_ACTOR_NATIVE_SIZE.width, Math.ceil(x + width))); this.bottom = Math.max(this.bottom, Math.min(PIXEL_ACTOR_NATIVE_SIZE.height, Math.ceil(y + height)));
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
function paintModel(r: PixelRaster, entity: ActorIdentity, animation: PixelActorFrame, weapon: PixelWeaponInput, gear?: PixelActorGear): PaintedActor {
  const look = Number.isFinite(entity.appearance) ? Math.abs(Math.trunc(entity.appearance)) % 32 : 0;
  const bearing = pixelBearing(animation.facing), lateral = { x: -bearing.y * 2, y: bearing.x * .5 }, rear = bearing.y < -.1;
  const rig = pixelActorRig(animation, entity.limping), boss = entity.bossId;
  const profile = gear?.profile ?? (entity.faction === 'raiders' ? 'assault' : entity.role === 'marksman' ? 'scout' : 'light');
  const coatSet = boss === 'lesnik' ? ['#66774b', '#3c533b', '#8e9c69'] : boss === 'komendant' ? ['#5c7480', '#374c59', '#91a3a5']
    : boss === 'liteyshchik' ? ['#917b5c', '#5b5c48', '#bca884'] : boss === 'bugor' ? ['#76734f', '#494e37', '#a29e6b']
      : entity.faction === 'raiders' ? look & 4 ? ['#5f6f65', '#33483d', '#899786'] : ['#6d7460', '#3c483b', '#96a084'] : coats[look % 4]!;
  const [coat, shade, light] = coatSet as readonly [string, string, string], [skin, skinShade, skinLight] = skins[Math.floor(look / 8)]!;
  const trousers = look & 4 ? '#50645a' : '#635f4b', trouserLight = look & 4 ? '#829180' : '#938a6c';
  const hair = look % 4 === 0 ? '#74573f' : look % 4 === 1 ? '#3e3931' : look % 4 === 2 ? '#918570' : '#946249';
  const torsoHalf = boss === 'bugor' || boss === 'liteyshchik' ? 24 : boss === 'lesnik' ? 19 : boss === 'komendant' ? 22 : 21;
  const shouldered = animation.mode === 'aim' || animation.mode === 'fire';
  const helmet = gear?.helmet ?? (entity.faction === 'raiders' || profile === 'assault'), armor = gear?.armor ?? (profile === 'assault' || !!boss);
  const backpack = gear?.backpack ?? (profile !== 'light' || look % 3 !== 1);
  const cosmeticHat = gear?.helmet === false && Math.floor(look / 8) === 3 ? 1 : Math.floor(look / 8);
  // Explicit equipment wins over both a saved cosmetic helmet and a boss's default.
  const hat = gear?.helmet !== undefined ? helmet ? 3 : cosmeticHat
    : boss === 'lesnik' ? 2 : boss === 'komendant' ? 1 : helmet || boss === 'liteyshchik' ? 3 : cosmeticHat;
  const p = (side: number, forward: number, z = 0): LivePoint => point(PIXEL_ACTOR_ANCHOR.x + lateral.x * side + bearing.x * forward, PIXEL_ACTOR_ANCHOR.y + lateral.y * side + bearing.y * forward - z);
  const b = (side: number, forward: number, z: number): LivePoint => {
    const upper = Math.max(0, Math.min(1, (z - 57) / 53));
    return p(side + rig.hipSway * (1 - upper) + rig.sway * upper, forward + rig.lean, z + rig.bob);
  };
  const line = (a: LivePoint, c: LivePoint, color: string, width = 1) => r.line(a.x, a.y, c.x, c.y, color, width);
  const outline = (vertices: LivePoint[], fill: string, ink: string = P.ink) => { r.polygon(vertices, fill); vertices.forEach((a, i) => line(a, vertices[(i + 1) % vertices.length]!, ink)); };
  const limb = (from: LivePoint, to: LivePoint, width: number, color: string, highlight?: string) => {
    const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y)), dx = -(to.y - from.y) / length, dy = (to.x - from.x) / length;
    const half = width / 2, tip = half * .72;
    outline([point(from.x + dx * half, from.y + dy * half), point(to.x + dx * tip, to.y + dy * tip), point(to.x - dx * tip, to.y - dy * tip), point(from.x - dx * half, from.y - dy * half)], color);
    r.ellipse(from.x, from.y, Math.round(half), Math.round(half * .8), color);
    r.ellipse(to.x, to.y, Math.max(2, Math.round(tip)), Math.max(2, Math.round(tip * .8)), color);
    if (highlight) line(point(from.x - 2, from.y + 1), point(to.x - 2, to.y - 2), highlight, 2);
  };
  const volume = (side: number, forward: number, halfW: number, halfD: number, low: number, high: number, colors: readonly string[]) => {
    const s = lateral.y >= 0 ? 1 : -1, f = bearing.y >= 0 ? 1 : -1;
    outline([b(side - halfW, forward + f * halfD, low), b(side + halfW, forward + f * halfD, low), b(side + halfW, forward + f * halfD, high), b(side - halfW, forward + f * halfD, high)], colors[0]!);
    outline([b(side + s * halfW, forward - halfD, low), b(side + s * halfW, forward + halfD, low), b(side + s * halfW, forward + halfD, high), b(side + s * halfW, forward - halfD, high)], colors[1]!);
    outline([b(side - halfW, forward - halfD, high), b(side + halfW, forward - halfD, high), b(side + halfW, forward + halfD, high), b(side - halfW, forward + halfD, high)], colors[2]!);
  };
  /** Rounded cross-sections give shoulders, cloth and bags a continuous silhouette.
   * Their few broad planes stay readable after the raid scales the sprite down. */
  const softVolume = (side: number, forward: number, rings: readonly (readonly [z: number, halfW: number, halfD: number])[], colors: readonly string[]) => {
    const octagon = [[-.7, -1], [.7, -1], [1, -.45], [1, .45], [.7, 1], [-.7, 1], [-1, .45], [-1, -.45]] as const;
    const sections = rings.map(([z, width, depth]) => octagon.map(([x, y]) => ({ screen: b(side + x * width, forward + y * depth, z), depth: lateral.y * x * width + bearing.y * y * depth, light: lateral.x * x + bearing.x * y })));
    const faces = sections.slice(1).flatMap((section, index) => section.map((v, corner) => {
      const next = (corner + 1) % 8, low = sections[index]!;
      return { vertices: [low[corner]!.screen, low[next]!.screen, section[next]!.screen, v.screen], depth: (v.depth + section[next]!.depth) / 2,
        color: (v.light + section[next]!.light) / 2 < -.25 ? colors[2]! : (v.light + section[next]!.light) / 2 > .45 ? colors[1]! : colors[0]! };
    })).sort((a, c) => a.depth - c.depth);
    for (const face of faces) r.polygon(face.vertices, face.color);
    const top = sections.at(-1)!; outline(top.map(v => v.screen), colors[2]!);
    for (let index = 0; index < sections.length - 1; index++) for (const sign of [-1, 1]) {
      const edge = (section: typeof top) => section.reduce((a, c) => a.screen.x * sign > c.screen.x * sign ? a : c).screen;
      line(edge(sections[index]!), edge(sections[index + 1]!), P.ink);
    }
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
    paintPixelWeapon(r, weapon, p(20, 9, 10), animation.facing); return {};
  }
  const foot = (side: number) => {
    const heel = side < 0 ? rig.leftHeel : rig.rightHeel, toe = side < 0 ? rig.leftToe : rig.rightToe;
    const edge = (at: LivePoint, across: number, high = 0, ahead = 0) => point(at.x + lateral.x * across + bearing.x * ahead, at.y + lateral.y * across + bearing.y * ahead - high);
    const sole = [edge(heel, -3, 0, -2), edge(heel, 3, 0, -2), edge(heel, 5, 0, 2), edge(toe, 4), edge(toe, 2, 0, 3), edge(toe, -2, 0, 3), edge(toe, -4), edge(heel, -5, 0, 2)];
    outline(sole, P.rubber);
    outline([edge(heel, -4, 4), edge(heel, 4, 4), edge(heel, 4, 12, 4), edge(heel, -4, 12, 4)], '#39453d');
    outline([edge(heel, -4, 12, 4), edge(heel, 4, 12, 4), edge(toe, 4, 4), edge(toe, 2, 3, 2), edge(toe, -2, 3, 2), edge(toe, -4, 4)], '#4b5549');
    line(edge(toe, -3, 2, 2), edge(toe, 3, 2, 2), '#8a8d76');
    for (let lace = 0; lace < 3; lace++) line(edge(heel, -3, 10 - lace, 5 + lace * 2), edge(heel, 3, 10 - lace, 5 + lace * 2), '#a09879');
    line(edge(heel, -3, 6), edge(heel, -3, 11, 3), '#75806c');
  };
  const leg = (side: number, near: boolean) => {
    const knee = side < 0 ? rig.leftKnee : rig.rightKnee, hip = side < 0 ? rig.leftHip : rig.rightHip, ankle = side < 0 ? rig.leftAnkle : rig.rightAnkle;
    limb(hip, knee, 16, near ? trousers : '#435248', near ? trouserLight : undefined); limb(knee, ankle, 11, trousers, near ? trouserLight : undefined);
    r.ellipse(knee.x, knee.y, 7, 6, '#3b4b40'); r.ellipse(knee.x - 1, knee.y - 1, 5, 4, trousers);
    line(point(knee.x - 4, knee.y - 3), point(knee.x + 2, knee.y - 4), '#87917a', 2);
    if (near) { line(point(hip.x - 4, hip.y + 10), point(hip.x + 3, hip.y + 13), trouserLight, 2); line(point(knee.x + 3, knee.y + 9), point(ankle.x + 3, ankle.y - 4), '#435248', 2); }
    foot(side);
  };
  const nearSign = lateral.y >= 0 ? 1 : -1;
  leg(-nearSign * 8, false);
  leg(nearSign * 8, true);
  const pack = () => {
    if (!backpack) return;
    const wide = profile === 'scout' || boss === 'lesnik' ? 15 : 12;
    softVolume(0, -14, [[66, wide - 3, 5], [72, wide, 8], [97, wide, 8], [105, wide - 2, 6], [108, wide - 6, 4]], ['#768067', '#465941', '#97a080']);
    softVolume(0, -22, [[74, 8, 2], [78, 10, 3], [88, 10, 3], [91, 8, 2]], ['#52664d', '#465941', '#97a080']);
    line(b(-8, -25, 89), b(8, -25, 89), '#b3ae82', 2);
    for (const side of [-7, 7]) { line(b(side, -23, 72), b(side, -23, 103), '#374c37', 2); line(b(side - 1, -24, 84), b(side + 1, -24, 84), '#b3ae82', 2); }
    softVolume(-wide - 2, -14, [[73, 3, 4], [89, 3, 4], [93, 2, 3]], ['#949877', '#5b6b51', '#bab798']);
  };
  if (!rear) pack();
  const kick = rig.weaponKick, sockets = pixelWeaponAnchors(weapon, rig.grip, animation.facing, kick), gunProfile = pixelWeaponProfile(weapon);
  const twoHanded = gunProfile.twoHanded;
  const leftHand = twoHanded ? sockets.forehand : b(-19, -rig.leftStride * .6, animation.mode === 'aim' || animation.mode === 'fire' ? 72 : 57), rightHand = rig.grip;
  const arm = (side: number, hand: LivePoint, far: boolean) => {
    const shoulder = side < 0 ? rig.leftShoulder : rig.rightShoulder;
    const elbow = point(shoulder.x * .48 + hand.x * .52 - bearing.x * (far ? 6 : 3), shoulder.y * .48 + hand.y * .52 + (shouldered ? 12 : 10));
    limb(shoulder, elbow, 14, far ? shade : coat, far ? undefined : light); limb(elbow, hand, 10, coat, far ? undefined : light);
    r.ellipse(elbow.x, elbow.y, 6, 5, shade); line(point(elbow.x - 4, elbow.y - 1), point(elbow.x + 2, elbow.y + 2), light, 2);
    const crease = point(shoulder.x * .45 + elbow.x * .55, shoulder.y * .45 + elbow.y * .55);
    line(point(crease.x - 4, crease.y), point(crease.x + 3, crease.y + 2), shade, 2);
    line(point(elbow.x * .22 + hand.x * .78, elbow.y * .22 + hand.y * .78), hand, '#3f4c3d', 10);
  };
  const farHand = nearSign > 0 ? leftHand : rightHand, nearHand = nearSign > 0 ? rightHand : leftHand;
  const hand = (at: LivePoint) => { r.ellipse(at.x, at.y, 5, 4, '#3a4e3d'); r.rect(at.x - 3, at.y - 2, 5, 3, profile === 'light' ? skin : '#82917a'); r.rect(at.x + 1, at.y, 2, 2, '#c0ad85'); };
  arm(-nearSign, farHand, true);
  if (rear) {
    // Both forearms reach around the front of the torso. Painting their hands last
    // would make them show through the back plate and the backpack.
    arm(nearSign, nearHand, false);
    paintPixelWeapon(r, weapon, rig.grip, animation.facing, kick); hand(farHand); hand(nearHand);
  }
  softVolume(0, 0, [[62, 14, 9], [77, 17, 10], [96, torsoHalf - 1, 12], [106, torsoHalf, 10], [shouldered ? 115 : 112, 12, 8]], [rear ? shade : coat, shade, light]);
  softVolume(0, 1, [[53, 13, 8], [58, 16, 10], [64, 14, 9]], [trousers, '#435248', trouserLight]);
  line(b(-12, 11, 64), b(12, 11, 64), '#354a39', 4);
  const buckle = b(0, 12, 64); r.rect(buckle.x - 3, buckle.y - 2, 6, 4, '#c9b27e');
  for (const side of [-1, 1]) { line(b(side * 15, 11, 91), b(side * 12, 10, 74), shade, 2); line(b(side * 12, 11, 71), b(side * 5, 12, 68), light, 2); }
  if (!rear) { line(b(0, 12, 102), b(0, 10, 68), '#b9aa7f'); for (const side of [-1, 1]) outline([b(side * 2, 8, 118), b(side * 10, 6, 113), b(side * 8, 11, 106), b(side * 2, 12, 111)], coat); }
  if (rear) {
    if (armor) {
      softVolume(0, -11, [[72, 11, 2], [96, torsoHalf - 6, 3], [104, 11, 2]], ['#5f7263', '#384e43', '#92a184']);
      line(b(-torsoHalf + 7, -16, 96), b(torsoHalf - 7, -16, 96), '#a6ad8c', 2);
    }
    pack();
  }
  else {
    if (armor) { softVolume(0, 13, [[72, 10, 2], [92, torsoHalf - 6, 3], [103, 11, 2]], ['#5f7263', '#384e43', '#92a184']); line(b(-torsoHalf + 7, 17, 96), b(torsoHalf - 7, 17, 96), '#a6ad8c', 2); }
    for (const side of [-10, 2]) volume(side, 18, 4, 3, 66, 82, [profile === 'light' ? '#93896b' : '#7e8a6c', '#4b5f46', '#b4b492']);
    line(b(-13, 13, 110), b(-11, 17, 65), '#394c39', 4); line(b(13, 13, 110), b(11, 17, 65), '#394c39', 4);
  }
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
  softVolume(0, 1, [[111, 7, 6], [119, 6, 5], [123, 5, 5]], [skinShade, skinShade, skin]);
  const h = (side: number, forward: number, z: number) => b(side, forward + rig.headForward, z + rig.headBob);
  const head = h(0, 1, 136), headW = 12 + Math.round(Math.abs(bearing.x));
  outline([point(head.x - 8, head.y - 15), point(head.x + 7, head.y - 15), point(head.x + headW, head.y - 8), point(head.x + headW, head.y + 5),
    point(head.x + 8, head.y + 14), point(head.x - 6, head.y + 15), point(head.x - headW, head.y + 6), point(head.x - headW, head.y - 8)], rear ? hair : skin);
  r.polygon([point(head.x + 6, head.y - 14), point(head.x + headW - 1, head.y - 7), point(head.x + headW - 1, head.y + 5), point(head.x + 7, head.y + 13), point(head.x + 3, head.y + 6)], rear ? '#655645' : skinShade);
  const ear = h(nearSign * 12, 1, 133); r.ellipse(ear.x, ear.y, 3, 5, skinShade); r.rect(ear.x - 1, ear.y - 2, 2, 3, skinLight);
  if (!rear) {
    r.polygon([h(-9, 10, 134), h(-3, 14, 132), h(-4, 13, 127), h(-10, 9, 129)], skinLight);
    for (const u of bearing.y > .18 && Math.abs(bearing.x) < .5 ? [-6, 6] : [bearing.x >= 0 ? -5 : 5]) {
      const eye = h(u, 12, 137); r.rect(eye.x - 2, eye.y - 2, 5, 2, hair); r.rect(eye.x - 1, eye.y + 1, 4, 2, skinShade);
      r.rect(eye.x, eye.y + 1, 2, 2, '#263631'); r.rect(eye.x - 1, eye.y + 1, 1, 1, '#e3d0a9');
    }
    const nose = h(0, 16, 131), root = h(0, 11, 136); outline([point(root.x - 1, root.y), nose, point(nose.x - 2, nose.y + 3), h(0, 11, 129)], skinLight, skinShade);
    line(h(-3, 13, 125), h(4, 13, 125), '#876247'); line(h(-2, 12, 122), h(4, 12, 122), skinLight);
    if (look % 4 !== 3 || boss === 'lesnik' || boss === 'bugor') { outline([h(-10, 11, 128), h(-6, 14, 124), h(7, 14, 124), h(11, 10, 128), h(8, 12, boss === 'lesnik' ? 111 : 119), h(-7, 12, 119)], boss === 'lesnik' ? '#a49b82' : hair); line(h(-3, 14, 125), h(4, 14, 125), '#7c6450'); }
  }
  const hatY = head.y - 12;
  if (hat === 3) {
    r.ellipse(head.x, hatY, headW + 2, 11, P.ink); r.ellipse(head.x, hatY - 1, headW + 1, 10, boss === 'liteyshchik' ? '#7f8977' : '#64795e');
    r.polygon([point(head.x - headW + 2, hatY - 1), point(head.x - 9, hatY - 7), point(head.x - 2, hatY - 10), point(head.x + 7, hatY - 8), point(head.x + 11, hatY - 3)], '#99a187');
    line(point(head.x - headW - 1, hatY + 7), point(head.x + headW + 1, hatY + 7), '#3a553f', 3); line(h(nearSign * 12, 7, 142), h(nearSign * 10, 8, 122), '#364c38', 2);
    for (const side of [-1, 1]) { const bolt = h(side * 10, 6, 145); r.rect(bolt.x - 1, bolt.y - 1, 2, 2, '#b3b399'); }
    if (profile === 'assault') { const ear = h(nearSign * 14, 0, 136); r.ellipse(ear.x, ear.y, 5, 7, '#35483e'); r.ellipse(ear.x, ear.y, 2, 4, '#83917e'); }
    if (boss === 'liteyshchik' && !rear) { const visor = h(0, 14, 141), vw = Math.abs(bearing.x) > .8 ? 7 : 11;
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
    outline([h(-12, 9, 144), h(12, 9, 144), h(12, 19, 143), h(-12, 19, 143)], boss === 'komendant' ? '#283e45' : '#6c6e58');
    if (boss === 'komendant') { const badge = h(0, 12, 150); r.rect(badge.x - 2, badge.y - 2, 4, 4, '#d3c17f'); }
  } else { r.ellipse(head.x, head.y - 9, headW - 1, 8, hair); r.polygon([point(head.x - headW + 2, head.y - 7), point(head.x - 8, head.y - 15), point(head.x + 5, head.y - 15), point(head.x + 9, head.y - 9)], look % 4 === 2 ? '#b0a18a' : '#927757'); line(h(nearSign * 9, 9, 144), h(nearSign * 11, 8, 137), hair, 4); }
  if (!rear) {
    paintPixelWeapon(r, weapon, rig.grip, animation.facing, kick);
    arm(nearSign, nearHand, false); hand(farHand); hand(nearHand);
  }
  return { ...(gunProfile.hasMuzzle ? { muzzle: sockets.muzzle } : {}), ...(gunProfile.hasEjection ? { ejection: sockets.ejection } : {}) };
}

/** Native render entry point for offline art previews. */
export function paintPixelActor(context: CanvasRenderingContext2D, entity: ActorIdentity, animation: PixelActorFrame, weapon: PixelWeaponInput = 'unknown', gear?: PixelActorGear): PaintedActor {
  return paintModel(new PixelRaster(context, PIXEL_ACTOR_NATIVE_SIZE.width, PIXEL_ACTOR_NATIVE_SIZE.height), entity, animation, weapon, gear);
}

/** Tight opaque crops keep complete visible walking cycles within 24MiB. */
export class PixelActorArt {
  private sprites = new Map<string, PixelActorSprite>(); private bytes = 0;
  get retainedBytes(): number { return this.bytes; }
  clear(): void { for (const { image } of this.sprites.values()) { image.width = 1; image.height = 1; } this.sprites.clear(); this.bytes = 0; }
  get(entity: ActorIdentity, animation: PixelActorFrame, weapon: PixelWeaponInput = 'unknown', gear?: PixelActorGear): PixelActorSprite {
    const look = Number.isFinite(entity.appearance) ? Math.abs(Math.trunc(entity.appearance)) % 32 : 0, normalized = { ...animation, frame: frameIndex(animation) };
    const key = `${look}:${entity.faction}:${entity.bossId ?? ''}:${entity.role ?? ''}:${entity.limping ?? false}:${normalized.facing}:${normalized.mode}:${normalized.frame}:${pixelWeaponSignature(weapon)}:${gear?.profile ?? ''}:${gear?.helmet ?? ''}:${gear?.armor ?? ''}:${gear?.backpack ?? ''}`;
    const old = this.sprites.get(key); if (old) { this.sprites.delete(key); this.sprites.set(key, old); return old; }
    const native = document.createElement('canvas'); native.width = PIXEL_ACTOR_NATIVE_SIZE.width; native.height = PIXEL_ACTOR_NATIVE_SIZE.height;
    const context = native.getContext('2d'); let left = 0, top = 0, width: number = native.width, height: number = native.height, metadata: PaintedActor = {};
    if (context) { const raster = new ActorRaster(context, native.width, native.height); metadata = paintModel(raster, entity, normalized, weapon, gear); left = Math.max(0, raster.left - 2); top = Math.max(0, raster.top - 2); width = Math.min(native.width - left, raster.right - left + 2); height = Math.min(native.height - top, raster.bottom - top + 2); }
    const image = document.createElement('canvas'); image.width = width; image.height = height;
    const cropped = image.getContext('2d'); if (cropped) { cropped.imageSmoothingEnabled = false; cropped.drawImage(native, left, top, width, height, 0, 0, width, height); }
    native.width = 1; native.height = 1;
    const shifted = (p: LivePoint | undefined) => p ? point(p.x - left, p.y - top) : undefined;
    const sprite = { image, anchor: point(PIXEL_ACTOR_ANCHOR.x - left, PIXEL_ACTOR_ANCHOR.y - top), muzzle: shifted(metadata.muzzle), ejection: shifted(metadata.ejection) }, bytes = width * height * 4;
    while (this.bytes + bytes > PIXEL_ACTOR_CACHE_BYTES && this.sprites.size) { const first = this.sprites.keys().next().value!, removed = this.sprites.get(first)!; this.bytes -= removed.image.width * removed.image.height * 4; this.sprites.delete(first); removed.image.width = 1; removed.image.height = 1; }
    this.sprites.set(key, sprite); this.bytes += bytes; return sprite;
  }
}
