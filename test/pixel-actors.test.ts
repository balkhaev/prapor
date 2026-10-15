import { afterEach, expect, test } from 'bun:test';
import { PIXEL_FACINGS, pixelBearing, type PixelActorFrame } from '../src/pixel-animation';
import { PixelActorArt, PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_CACHE_BYTES, PIXEL_ACTOR_FRAMES, paintPixelActor, pixelActorRig } from '../src/pixel-actors';
import { PIXEL_WEAPON_IDS, PIXEL_WEAPON_PROFILES, pixelWeaponAnchors } from '../src/pixel-weapons';
import type { LiveEntity } from '../src/game/live';

const colors: string[] = [''];
const colorIds = new Map<string, number>();
function colorId(color: string): number { let id = colorIds.get(color); if (id === undefined) { id = colors.length; colors.push(color); colorIds.set(color, id); } return id; }
function surface(width = 192, height = 208) {
  const pixels = new Uint32Array(width * height); let valid = true, calls = 0;
  const context = { fillStyle: '', setTransform() {}, fillRect(x: number, y: number, w: number, h: number) {
    calls++; valid &&= [x,y,w,h].every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height && /^#[\da-f]{6}$/i.test(context.fillStyle);
    for (let row = y; row < y + h; row++) pixels.fill(colorId(context.fillStyle), row * width + x, row * width + x + w);
  } };
  return { context: context as unknown as CanvasRenderingContext2D, pixels, get valid() { return valid; }, get calls() { return calls; } };
}
function digest(pixels: Uint32Array): number { let hash = 2166136261; for (const pixel of pixels) hash = Math.imul(hash ^ pixel, 16777619); return hash >>> 0; }
const scav = { appearance: 0, faction: 'scavs' as const, role: 'patrol' as const };
let restoreDocument: (() => void) | undefined;
afterEach(() => { restoreDocument?.(); restoreDocument = undefined; });

function mockCanvases() {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document'); let created = 0;
  type MockCanvas = HTMLCanvasElement & { pixels: Uint32Array };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
    created++; const image = { width: 0, height: 0 } as MockCanvas;
    image.getContext = (() => {
      const s = surface(image.width, image.height); image.pixels = s.pixels;
      const context = s.context as CanvasRenderingContext2D & { drawImage: (...args: unknown[]) => void };
      context.drawImage = (...args: unknown[]) => {
        const [source, sx, sy, sw, sh] = args as [MockCanvas, number, number, number, number];
        for (let row = 0; row < sh; row++) for (let col = 0; col < sw; col++) image.pixels[row * image.width + col] = source.pixels[(row + sy) * source.width + col + sx]!;
      };
      return context;
    }) as unknown as HTMLCanvasElement['getContext']; return image;
  } } });
  restoreDocument = () => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); };
  return { get created() { return created; }, colorAt(image: HTMLCanvasElement, x: number, y: number) { return colors[(image as MockCanvas).pixels[y * image.width + x]!]; } };
}

test('all32 identities,8 bearings and articulated states render opaque bounded integer art', () => {
  const identities = new Set<number>(), directions = new Set<number>();
  for (let look = 0; look < 32; look++) {
    const s = surface(), entity = { ...scav, appearance: look }, before = { ...entity };
    paintPixelActor(s.context, entity, { mode: 'idle', frame: 0, facing: 'se' }, 'sks');
    identities.add(digest(s.pixels)); expect(s.valid).toBe(true); expect(s.pixels.filter(Boolean).length).toBeGreaterThan(3200); expect(entity).toEqual(before);
  }
  expect(identities.size).toBe(32);
  for (const facing of PIXEL_FACINGS) {
    const idle = surface(); paintPixelActor(idle.context, scav, { mode: 'idle', frame: 0, facing }, 'sks'); directions.add(digest(idle.pixels));
    for (const [mode, frames] of Object.entries(PIXEL_ACTOR_FRAMES)) {
      const states = new Set<number>();
      for (let frame = 0; frame < frames; frame++) {
        const s = surface(); paintPixelActor(s.context, { ...scav, appearance: 19 }, { mode, frame, facing } as PixelActorFrame, 'sks'); expect(s.valid).toBe(true); expect(s.calls).toBeGreaterThan(200); states.add(digest(s.pixels));
        // No raster clipping can silently amputate a boot or weapon at the frame edge.
        expect(s.pixels.slice(0, 192).every(pixel => pixel === 0)).toBe(true);
        expect(s.pixels.slice(207 * 192).every(pixel => pixel === 0)).toBe(true);
        expect(s.pixels.every((pixel, index) => index % 192 !== 0 && index % 192 !== 191 || pixel === 0)).toBe(true);
      }
      expect(states.size).toBe(frames);
    }
  }
  expect(directions.size).toBe(8);
});

test('walking articulates both knees and heel/toe contacts without changing the planted origin; limping is asymmetric', () => {
  for (const facing of PIXEL_FACINGS) {
    const feet = new Set<string>(), limp = new Set<string>();
    for (let frame = 0; frame < 8; frame++) {
      const rig = pixelActorRig({ mode: 'walk', frame, facing }), injured = pixelActorRig({ mode: 'walk', frame, facing }, true);
      expect(rig.anchor).toEqual(PIXEL_ACTOR_ANCHOR); expect(injured.anchor).toEqual(PIXEL_ACTOR_ANCHOR);
      expect(rig.leftStride).toBe(-rig.rightStride); expect(rig.leftLift === 0 || rig.rightLift === 0).toBe(true);
      expect(Math.abs(injured.leftStride)).toBeLessThanOrEqual(6); expect(Math.abs(injured.rightStride)).toBeLessThanOrEqual(10);
      feet.add(JSON.stringify([rig.leftKnee,rig.rightKnee,rig.leftHeel,rig.rightHeel,rig.leftToe,rig.rightToe])); limp.add(JSON.stringify(injured));
    }
    expect(feet.size).toBe(8); expect(limp.size).toBe(8);
  }
});

test('cropped muzzle/ejection remain registered to the mounted trigger and support hands in all bearings', () => {
  const canvases = mockCanvases(), art = new PixelActorArt();
  for (const facing of PIXEL_FACINGS) for (const weapon of PIXEL_WEAPON_IDS) for (let frame = 0; frame < 3; frame++) {
    const animation = { mode: 'fire' as const, frame, facing }, rig = pixelActorRig(animation), expected = pixelWeaponAnchors(weapon, rig.grip, facing, [0,4,2][frame]);
    const sprite = art.get(scav, animation, weapon);
    expect(sprite.muzzle).toEqual({ x: expected.muzzle.x - 96 + sprite.anchor.x, y: expected.muzzle.y - 176 + sprite.anchor.y });
    expect(sprite.ejection).toEqual({ x: expected.ejection.x - 96 + sprite.anchor.x, y: expected.ejection.y - 176 + sprite.anchor.y });
    const trigger = { x: rig.grip.x - 96 + sprite.anchor.x, y: rig.grip.y - 176 + sprite.anchor.y };
    // Rear hands can be hidden by a real torso/pack; sockets still exist underneath.
    if (pixelBearing(facing).y >= -.1) {
      expect(canvases.colorAt(sprite.image, trigger.x, trigger.y)).toBe('#c6a484');
      if (weapon !== 'pm') { const support = { x: expected.forehand.x - 96 + sprite.anchor.x, y: expected.forehand.y - 176 + sprite.anchor.y }; expect(['#c6a484', '#3a4e3d', '#c0ad85']).toContain(canvases.colorAt(sprite.image, support.x, support.y) ?? ''); }
    }
    expect(sprite.image.width).toBeLessThan(192); expect(sprite.image.height).toBeLessThan(192);
  }
});

test('rear-facing hands and forearms stay behind the torso and backpack', () => {
  const handColors = new Set(['#c6a484', '#82917a', '#c0ad85', '#3a4e3d']);
  for (const weapon of PIXEL_WEAPON_IDS) for (const backpack of [false, true]) for (const mode of ['idle', 'aim', 'fire'] as const) {
    const animation = { mode, frame: 0, facing: 'n' as const }, rig = pixelActorRig(animation), s = surface();
    paintPixelActor(s.context, scav, animation, weapon, { profile: 'light', helmet: false, armor: false, backpack });
    // The trigger hand is physically on the front of the body. It must not be
    // painted over the coat/pack just because its socket is still available.
    expect(handColors.has(colors[s.pixels[rig.grip.y * 192 + rig.grip.x]!]!)).toBe(false);
    expect(s.valid).toBe(true);
  }
});

test('two-handed stocks seat beside the firing shoulder across all eight bearings', () => {
  for (const facing of PIXEL_FACINGS) for (const weapon of PIXEL_WEAPON_IDS) {
    const profile = PIXEL_WEAPON_PROFILES[weapon]; if (!profile.twoHanded) continue;
    const rig = pixelActorRig({ mode: 'aim', frame: 0, facing }), bearing = pixelBearing(facing);
    const stock = { x: rig.grip.x - bearing.x * profile.rear, y: rig.grip.y - bearing.y * profile.rear - profile.boreHeight };
    expect(Math.hypot(stock.x - rig.rightShoulder.x, stock.y - rig.rightShoulder.y)).toBeLessThan(18);
  }
});

test('fallen models retain each visible equipment item and leave no live firing sockets', () => {
  for (const facing of PIXEL_FACINGS) for (const helmet of [false, true]) for (const armor of [false, true]) for (const backpack of [false, true]) {
    const s = surface(), metadata = paintPixelActor(s.context, { ...scav, appearance: 24 }, { mode: 'downed', frame: 0, facing }, 'sks', { profile: 'light', helmet, armor, backpack });
    const palette = new Set([...s.pixels].map(id => colors[id]));
    expect(palette.has('#64795e')).toBe(helmet);
    expect(palette.has('#5f7263')).toBe(armor);
    expect(['#768067', '#52664d', '#97a080'].some(color => palette.has(color))).toBe(backpack);
    expect(metadata.muzzle).toBeUndefined(); expect(metadata.ejection).toBeUndefined(); expect(s.valid).toBe(true);
    expect(s.pixels.slice(207 * 192).every(pixel => pixel === 0)).toBe(true);
    expect(s.pixels.every((pixel, index) => index % 192 !== 0 && index % 192 !== 191 || pixel === 0)).toBe(true);
  }
});

test('armor has a visible rear plate when the back is not covered by a pack', () => {
  for (const facing of ['ne', 'n', 'nw'] as const) for (const armor of [false, true]) {
    const s = surface(); paintPixelActor(s.context, scav, { mode: 'idle', frame: 0, facing }, 'sks', { profile: 'light', helmet: false, armor, backpack: false });
    expect(s.pixels.some(id => colors[id] === '#5f7263')).toBe(armor);
  }
});

test('an explicitly absent helmet overrides cosmetic and boss helmets in live and fallen models', () => {
  for (const appearance of [0, 24, 31]) for (const bossId of [undefined, 'liteyshchik'] as const) for (const mode of ['idle', 'downed'] as const) {
    const s = surface(); paintPixelActor(s.context, { ...scav, appearance, bossId }, { mode, frame: 0, facing: 'se' }, 'sks', { profile: 'assault', helmet: false, armor: false, backpack: false });
    const palette = new Set([...s.pixels].map(id => colors[id]));
    for (const helmetColor of ['#64795e', '#7f8977', '#99a187', '#3a553f', '#345252']) expect(palette.has(helmetColor)).toBe(false);
  }
});

test('an explicit helmet also replaces a boss cosmetic cap', () => {
  for (const bossId of ['lesnik', 'komendant'] as const) for (const mode of ['idle', 'downed'] as const) {
    const s = surface(); paintPixelActor(s.context, { ...scav, bossId }, { mode, frame: 0, facing: 'se' }, 'sks', { profile: 'light', helmet: true, armor: false, backpack: false });
    expect(s.pixels.some(id => colors[id] === '#64795e')).toBe(true);
  }
});

test('boss and field-kit silhouettes are distinct, and complete crowded walking cycles stay cached within24MiB', () => {
  const bossShapes = new Set<number>();
  for (const bossId of ['bugor','lesnik','liteyshchik','komendant'] as const) { const s = surface(); paintPixelActor(s.context, { ...scav, bossId }, { mode: 'aim', frame: 0, facing: 'se' }, 'akm'); bossShapes.add(digest(s.pixels)); }
  expect(bossShapes.size).toBe(4);
  const gearShapes = new Set<number>();
  for (const profile of ['light','assault','scout'] as const) { const s = surface(); paintPixelActor(s.context, { appearance: 3 }, { mode: 'idle', frame: 0, facing: 'sw' }, 'unknown', { profile }); gearShapes.add(digest(s.pixels)); }
  expect(gearShapes.size).toBe(3);
  const canvases = mockCanvases(), art = new PixelActorArt(), crowd: Array<Pick<LiveEntity,'appearance'|'faction'>> = Array.from({ length: 32 }, (_, appearance) => ({ appearance, faction: appearance % 2 ? 'scavs' : 'raiders' }));
  const firstCycle = crowd.map((entity, index) => Array.from({ length: 8 }, (_, frame) => art.get(entity, { mode: 'walk', frame, facing: PIXEL_FACINGS[index % 8]! }, 'akm')));
  expect(art.retainedBytes).toBeLessThanOrEqual(PIXEL_ACTOR_CACHE_BYTES); const created = canvases.created;
  for (let frame = 0; frame < 8; frame++) for (const [index, entity] of crowd.entries()) expect(art.get(entity, { mode: 'walk', frame, facing: PIXEL_FACINGS[index % 8]! }, 'akm')).toBe(firstCycle[index]![frame]!);
  expect(canvases.created).toBe(created);
  const base = art.get(scav, { mode: 'idle', frame: 0, facing: 's' }); expect(art.get(scav, { mode: 'idle', frame: 400, facing: 's' })).toBe(base);
  expect(art.get({ ...scav, limping: true }, { mode: 'idle', frame: 0, facing: 's' })).not.toBe(base);
  art.clear(); expect(art.retainedBytes).toBe(0);
});
