import type { LiveEntity, LivePoint } from './game/live';
import type { ScavDirection, ScavPose } from './scav-isometric';
import { PixelRaster } from './pixel-art';
import type { PixelSprite } from './pixel-renderer';

const coats = [
  ['#526452', '#35483e', '#78816a'], ['#837357', '#5d5543', '#a09070'],
  ['#536976', '#3a4c5a', '#7c8b8c'], ['#7b665b', '#534a43', '#a19077'],
] as const;

/** A deterministic appearance and directional pose, rendered independently of combat randomness. */
export function paintPixelActor(c: CanvasRenderingContext2D, entity: Pick<LiveEntity, 'appearance' | 'faction' | 'bossId'>, direction: ScavDirection, pose: ScavPose | 'downed', rifle = true): void {
  const r = new PixelRaster(c, 112, 112), look = Math.abs(Math.trunc(entity.appearance)) % 32;
  const rear = direction[0] === 'n', right = direction[1] === 'e', facing = right ? 1 : -1;
  const [coat, shade, light] = entity.faction === 'raiders' ? ['#62695b', '#353f39', '#87907a'] : coats[look % coats.length]!;
  const step = pose === 'walk-a' ? 4 : pose === 'walk-b' ? -4 : 0, lift = pose === 'walk-b' ? 1 : 0;
  const p = (x: number, y: number): LivePoint => ({ x: 54 + x * facing, y: y + lift });
  const line = (a: LivePoint, b: LivePoint, color: string, width = 1) => r.line(a.x, a.y, b.x, b.y, color, width);
  const poly = (points: number[][], fill: string, outline?: string) => {
    const vertices = points.map(([x, y]) => p(x!, y!)); r.polygon(vertices, fill);
    if (outline) vertices.forEach((a, i) => line(a, vertices[(i + 1) % vertices.length]!, outline));
  };
  if (pose === 'downed') {
    r.ellipse(55, 102, 30, 6, '#20312b');
    r.polygon([{ x: 20, y: 99 }, { x: 24, y: 91 }, { x: 42, y: 93 }, { x: 47, y: 99 }, { x: 68, y: 90 }, { x: 89, y: 96 }, { x: 90, y: 103 }, { x: 56, y: 105 }], coat);
    r.rect(27, 91, 11, 7, '#b09172'); r.rect(81, 97, 16, 6, '#292e2c');
    line({ x: 45, y: 103 }, { x: 74, y: 97 }, '#9b8a61', 2); return;
  }
  r.ellipse(54, 103, 21, 7, '#20332e');
  // Rear leg, boot, backpack and far arm remain behind the torso.
  poly([[-9, 66], [0, 65], [2, 86 - step], [-4, 98 - step], [-12, 95 - step], [-11, 80]], '#3c4944', '#1d2c28');
  poly([[-12, 94 - step], [-4, 94 - step], [0, 100 - step], [-1, 104 - step], [-16, 104 - step], [-17, 100 - step]], '#2a302e', '#18221e');
  poly([[-19, 34], [-10, 28], [1, 34], [0, 65], [-16, 66], [-23, 57]], '#6c6d51', '#2e3b31');
  poly([[-18, 37], [-11, 34], [-10, 56], [-18, 60]], '#909077');
  poly([[-15, 36], [-5, 38], [-2, 51], [10, 54], [8, 61], [-9, 58], [-18, 48]], shade, '#23332d');
  poly([[1, 65], [14, 64], [13, 81], [7, 99 + step], [0, 99 + step], [2, 81]], '#526056', '#25392f');
  poly([[0, 96 + step], [9, 96 + step], [14, 101 + step], [13, 105 + step], [-2, 105 + step], [-4, 102 + step]], '#353a34', '#18241f');
  line(p(4, 76), p(4, 91 + step), '#738071', 2);
  poly([[-12, 31], [5, 29], [17, 37], [17, 64], [9, 72], [-10, 68], [-14, 50]], coat, '#23352e');
  poly([[7, 35], [15, 38], [15, 61], [8, 66]], shade);
  poly([[-10, 33], [-5, 33], [-5, 59], [-9, 63]], light);
  line(p(-11, 64), p(13, 66), '#29362c', 3);
  r.rect(p(0, 65).x - 2, 64 + lift, 4, 3, '#b9a47c');
  if (rear) {
    poly([[-8, 34], [6, 35], [11, 46], [10, 64], [-7, 61], [-13, 46]], '#62694e', '#2c3d30');
    line(p(-9, 43), p(9, 45), '#a29e78', 2);
    poly([[-5, 53], [6, 54], [6, 62], [-5, 60]], '#4b5842');
  } else {
    poly([[-5, 37], [10, 38], [12, 61], [-6, 60]], '#444e3d');
    for (const x of [-4, 3]) { poly([[x, 48], [x + 5, 48], [x + 5, 58], [x, 58]], '#778065', '#2b3b30'); }
    line(p(0, 36), p(0, 47), '#b0a380', 1);
  }
  for (let mark = 0; mark < 7; mark++) {
    const x = -7 + (mark * 7 + look) % 18, y = 36 + (mark * 5 + look * 3) % 22;
    r.rect(p(x, y).x, y + lift, 2 + mark % 3, 2, mark % 2 ? shade : light);
  }
  // Neck, face, ear and hair/helmet share the saved model's palette.
  poly([[-3, 25], [7, 24], [7, 32], [-3, 32]], '#ad8e70');
  poly([[-9, 12], [4, 9], [14, 14], [15, 24], [8, 30], [-3, 28], [-9, 23]], rear ? '#6e6252' : '#c0a07e', '#3b3c30');
  poly([[6, 14], [14, 15], [14, 24], [8, 28]], '#957458');
  const hair = look % 4 === 1 ? '#8d583e' : look % 5 === 0 ? '#766c58' : '#463e34';
  const helmet = entity.faction === 'raiders' || !!entity.bossId || look % 3 === 0;
  if (helmet) {
    poly([[-11, 12], [-6, 5], [4, 4], [13, 9], [16, 17], [5, 19], [-10, 18]], '#596852', '#263a2e');
    line(p(-7, 9), p(8, 9), '#8b9476', 2); line(p(-10, 18), p(12, 19), '#2c3a2c', 2);
  } else {
    poly([[-10, 13], [-7, 7], [3, 6], [12, 11], [13, 16], [4, 13], [-8, 18]], hair);
    if (look % 4 === 3) line(p(-10, 15), p(12, 15), '#b7b79c', 3);
  }
  if (!rear) {
    r.rect(p(10, 19).x, 19 + lift, 2, 2, '#272f29');
    line(p(12, 23), p(7, 24), '#dfba93', 1);
    if (look % 4 === 0) poly([[-2, 24], [7, 24], [10, 27], [5, 30], [-3, 27]], '#665441');
  }
  // Elbow and gloved hand point in the same bearing as the confirmed movement/fire.
  const aiming = pose === 'work', handY = aiming ? 44 : 54;
  poly([[10, 36], [19, 37], [23, 49], [30, handY], [31, handY + 5], [17, 56], [12, 49]], coat, '#28392f');
  line(p(16, 40), p(20, 49), light, 2);
  poly([[26, handY], [33, handY], [35, handY + 5], [28, handY + 7]], '#a88c6d', '#364038');
  const gunY = handY + 2;
  line(p(10, gunY + 4), p(rifle ? 42 : 37, gunY - (rear ? 9 : -4)), '#202b29', rifle ? 5 : 4);
  line(p(12, gunY + 2), p(26, gunY - (rear ? 4 : -1)), '#806b4e', 3);
  line(p(23, gunY + 4), p(21, gunY + 11), '#27322e', 4);
  if (rifle) line(p(30, gunY - (rear ? 5 : -2)), p(43, gunY - (rear ? 9 : -4)), '#778179', 1);
  if (entity.bossId) { r.rect(p(3, 38).x, 38 + lift, 5, 4, '#cbb679'); }
}

export class PixelActorArt {
  private sprites = new Map<string, PixelSprite>();
  clear(): void { this.sprites.clear(); }
  get(entity: Pick<LiveEntity, 'appearance' | 'faction' | 'bossId'>, direction: ScavDirection, pose: ScavPose | 'downed', rifle = true): PixelSprite {
    const key = `${entity.appearance}:${entity.faction}:${entity.bossId ?? ''}:${direction}:${pose}:${rifle}`;
    const old = this.sprites.get(key); if (old) { this.sprites.delete(key); this.sprites.set(key, old); return old; }
    const image = document.createElement('canvas'); image.width = 112; image.height = 112;
    const c = image.getContext('2d'); if (c) paintPixelActor(c, entity, direction, pose, rifle);
    const sprite = { image, anchor: { x: 54, y: 103 } }; this.sprites.set(key, sprite);
    if (this.sprites.size > 192) this.sprites.delete(this.sprites.keys().next().value!);
    return sprite;
  }
}
