import { afterEach, expect, test } from 'bun:test';
import { PIXEL_FACINGS, pixelBearing, type PixelActorFrame } from '../src/pixel-animation';
import { PixelActorArt, PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_CACHE_BYTES, PIXEL_ACTOR_FRAMES, PIXEL_ACTOR_NATIVE_SIZE, paintPixelActor, pixelActorRig } from '../src/pixel-actors';
import { PIXEL_WEAPON_IDS, paintPixelWeapon, pixelWeaponProfile, pixelWeaponAnchors, type PixelWeaponInput } from '../src/pixel-weapons';
import { PixelRaster } from '../src/pixel-art';
import type { LiveEntity } from '../src/game/live';
import { WEAPONS } from '../src/game/data';
import { MODULE_BY_ID, type ModuleSlot } from '../src/game/modules';
import { createWeaponShowcaseBuild } from '../src/weapon-showcase';

const colors: string[] = [''];
const colorIds = new Map<string, number>();
function colorId(color: string): number { let id = colorIds.get(color); if (id === undefined) { id = colors.length; colors.push(color); colorIds.set(color, id); } return id; }
const W = PIXEL_ACTOR_NATIVE_SIZE.width, H = PIXEL_ACTOR_NATIVE_SIZE.height;
function surface(width: number = W, height: number = H) {
  const pixels = new Uint32Array(width * height); let valid = true, calls = 0;
  const context = { fillStyle: '', setTransform() {}, fillRect(x: number, y: number, w: number, h: number) {
    calls++; valid &&= [x,y,w,h].every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height && /^#[\da-f]{6}$/i.test(context.fillStyle);
    for (let row = y; row < y + h; row++) pixels.fill(colorId(context.fillStyle), row * width + x, row * width + x + w);
  } };
  return { context: context as unknown as CanvasRenderingContext2D, pixels, get valid() { return valid; }, get calls() { return calls; } };
}
function digest(pixels: Uint32Array): number { let hash = 2166136261; for (const pixel of pixels) hash = Math.imul(hash ^ pixel, 16777619); return hash >>> 0; }
function hasPadding(pixels: Uint32Array): boolean {
  return pixels.slice(0, W).every(pixel => pixel === 0) && pixels.slice((H - 1) * W).every(pixel => pixel === 0)
    && pixels.every((pixel, index) => index % W !== 0 && index % W !== W - 1 || pixel === 0);
}
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
      const states = new Set<number>(), poses: Uint32Array[] = [];
      for (let frame = 0; frame < frames; frame++) {
        const s = surface(); paintPixelActor(s.context, { ...scav, appearance: 19 }, { mode, frame, facing } as PixelActorFrame, 'sks'); expect(s.valid).toBe(true); expect(s.calls).toBeGreaterThan(200); states.add(digest(s.pixels)); poses.push(s.pixels);
        // No raster clipping can silently amputate a boot or weapon at the frame edge.
        expect(s.pixels.slice(0, W).every(pixel => pixel === 0)).toBe(true);
        expect(s.pixels.slice((H - 1) * W).every(pixel => pixel === 0)).toBe(true);
        expect(s.pixels.every((pixel, index) => index % W !== 0 && index % W !== W - 1 || pixel === 0)).toBe(true);
      }
      expect(states.size).toBeGreaterThanOrEqual(mode === 'walk' ? 8 : mode === 'idle' ? 3 : mode === 'aim' ? 2 : mode === 'fire' ? 4 : mode === 'hit' ? 3 : 1);
      if (mode === 'idle' || mode === 'aim') for (let frame = 0; frame < frames; frame++) {
        const a = poses[frame]!, c = poses[(frame + 1) % frames]!;
        let changed = 0, occupied = 0;
        for (let i = 0; i < a.length; i++) { if (a[i] || c[i]) occupied++; if (a[i] !== c[i]) changed++; }
        expect(changed / occupied).toBeLessThan(.55);
      }
    }
  }
  expect(directions.size).toBe(8);
});

test('walking articulates both knees and heel/toe contacts without changing the planted origin; limping is asymmetric', () => {
  for (const facing of PIXEL_FACINGS) {
    const feet = new Set<string>(), limp = new Set<string>();
    for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.walk; frame++) {
      const rig = pixelActorRig({ mode: 'walk', frame, facing }), injured = pixelActorRig({ mode: 'walk', frame, facing }, true);
      expect(rig.anchor).toEqual(PIXEL_ACTOR_ANCHOR); expect(injured.anchor).toEqual(PIXEL_ACTOR_ANCHOR);
      expect(rig.leftContact || rig.rightContact).toBe(true); expect(rig.leftLift === 0 || rig.rightLift === 0).toBe(true);
      expect(Math.abs(injured.leftStride)).toBeLessThanOrEqual(12); expect(Math.abs(injured.rightStride)).toBeLessThanOrEqual(20);
      feet.add(JSON.stringify([rig.leftKnee,rig.rightKnee,rig.leftHeel,rig.rightHeel,rig.leftToe,rig.rightToe])); limp.add(JSON.stringify(injured));
    }
    expect(feet.size).toBe(PIXEL_ACTOR_FRAMES.walk); expect(limp.size).toBe(PIXEL_ACTOR_FRAMES.walk);
  }
});

test('the unarmored rear silhouette narrows from chest to waist and breathing keeps boots planted', () => {
  const empty: PixelWeaponInput = { weaponId: 'akm', durability: 100, modules: {} };
  const bare = { profile: 'light' as const, helmet: false, armor: false, backpack: false }, s = surface();
  paintPixelActor(s.context, scav, { mode: 'idle', frame: 0, facing: 'n' }, empty, bare);
  const coat = new Set(['#67745c', '#3e5041', '#8c9576']);
  const band = (top: number, bottom: number) => {
    let left = W, right = 0;
    for (let y = top; y <= bottom; y++) for (let x = PIXEL_ACTOR_ANCHOR.x - 20; x <= PIXEL_ACTOR_ANCHOR.x + 20; x++) {
      if (coat.has(colors[s.pixels[y * W + x]!]!)) { left = Math.min(left, x); right = Math.max(right, x); }
    }
    return right - left;
  };
  expect(band(90, 99)).toBeGreaterThan(band(119, 125) + 4);
  for (const facing of PIXEL_FACINGS) {
    const feet = new Set<number>();
    for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.idle; frame++) {
      const idle = surface(); paintPixelActor(idle.context, scav, { mode: 'idle', frame, facing }, empty, bare);
      feet.add(digest(idle.pixels.slice((PIXEL_ACTOR_ANCHOR.y - 30) * W)));
    }
    expect(feet.size).toBe(1);
  }
});

test('cropped muzzle/ejection remain registered to the mounted trigger and support hands in all bearings', () => {
  const canvases = mockCanvases(), art = new PixelActorArt();
  for (const facing of PIXEL_FACINGS) for (const weapon of PIXEL_WEAPON_IDS) for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.fire; frame++) {
    const animation = { mode: 'fire' as const, frame, facing }, rig = pixelActorRig(animation), expected = pixelWeaponAnchors(weapon, rig.grip, facing, rig.weaponKick);
    const sprite = art.get(scav, animation, weapon);
    expect(sprite.muzzle).toEqual({ x: expected.muzzle.x - PIXEL_ACTOR_ANCHOR.x + sprite.anchor.x, y: expected.muzzle.y - PIXEL_ACTOR_ANCHOR.y + sprite.anchor.y });
    expect(sprite.ejection).toEqual({ x: expected.ejection.x - PIXEL_ACTOR_ANCHOR.x + sprite.anchor.x, y: expected.ejection.y - PIXEL_ACTOR_ANCHOR.y + sprite.anchor.y });
    const trigger = { x: rig.grip.x - PIXEL_ACTOR_ANCHOR.x + sprite.anchor.x, y: rig.grip.y - PIXEL_ACTOR_ANCHOR.y + sprite.anchor.y };
    // Rear hands can be hidden by a real torso/pack; sockets still exist underneath.
    if (pixelBearing(facing).y >= -.1) {
      // Compact two-handed builds can bring the support glove over the trigger glove.
      expect(['#c6a484', '#3a4e3d', '#c0ad85']).toContain(canvases.colorAt(sprite.image, trigger.x, trigger.y) ?? '');
      if (pixelWeaponProfile(weapon).twoHanded) { const support = { x: expected.forehand.x - PIXEL_ACTOR_ANCHOR.x + sprite.anchor.x, y: expected.forehand.y - PIXEL_ACTOR_ANCHOR.y + sprite.anchor.y }; expect(['#c6a484', '#3a4e3d', '#c0ad85']).toContain(canvases.colorAt(sprite.image, support.x, support.y) ?? ''); }
    }
    expect(sprite.image.width).toBeLessThan(W); expect(sprite.image.height).toBeLessThan(H);
  }
}, 30_000);

test('rear-facing hands and forearms stay behind the torso and backpack', () => {
  const handColors = new Set(['#c6a484', '#82917a', '#c0ad85', '#3a4e3d']);
  for (const weapon of PIXEL_WEAPON_IDS) for (const backpack of [false, true]) for (const mode of ['idle', 'aim', 'fire'] as const) {
    const animation = { mode, frame: 0, facing: 'n' as const }, rig = pixelActorRig(animation), s = surface();
    paintPixelActor(s.context, scav, animation, weapon, { profile: 'light', helmet: false, armor: false, backpack });
    // Low-ready hands stay behind the body. A shouldered firing hand can rise
    // above its shoulder silhouette, while the back itself remains an occluder.
    if (mode === 'idle') expect(handColors.has(colors[s.pixels[rig.grip.y * W + rig.grip.x]!]!)).toBe(false);
    const spine = { x: PIXEL_ACTOR_ANCHOR.x, y: PIXEL_ACTOR_ANCHOR.y - 90 };
    expect(handColors.has(colors[s.pixels[spine.y * W + spine.x]!]!)).toBe(false);
    expect(s.valid).toBe(true);
  }
}, 30_000);

test('all39 real factory and field builds retain their parts through every bearing and representative live/fallen poses', () => {
  expect(WEAPONS).toHaveLength(39);
  for (const definition of WEAPONS) {
    const builds = [createWeaponShowcaseBuild(definition.id, 'factory'), createWeaponShowcaseBuild(definition.id, 'field')];
    const before = structuredClone(builds), changed = new Set<PixelActorFrame['mode']>();
    for (const mode of ['idle', 'fire', 'downed'] as const) for (const [facingIndex, facing] of PIXEL_FACINGS.entries()) {
      const hashes = builds.map(build => {
        const s = surface(), animation = { mode, frame: facingIndex % PIXEL_ACTOR_FRAMES[mode], facing };
        const sockets = paintPixelActor(s.context, scav, animation, build, { profile: 'light', helmet: false, armor: false, backpack: false });
        expect(s.valid, `${definition.id} ${mode} ${facing}`).toBe(true);
        expect(hasPadding(s.pixels), `${definition.id} ${mode} ${facing} touches native edge`).toBe(true);
        expect(s.pixels.some(Boolean)).toBe(true);
        if (mode === 'downed') { expect(sockets.muzzle).toBeUndefined(); expect(sockets.ejection).toBeUndefined(); }
        return digest(s.pixels);
      });
      if (hashes[0] !== hashes[1]) changed.add(mode);
    }
    // A field optic, barrel and magazine must remain visible when its owner falls,
    // as well as while holding the same physical build during a live animation.
    expect([...changed].sort(), definition.id).toEqual(['downed', 'fire', 'idle']);
    expect(builds).toEqual(before);
  }
}, 120_000);

test('long suppressed barrels, large scopes and bipods stay inside native/cropped frames in every animated pose', () => {
  const canvases = mockCanvases(), art = new PixelActorArt();
  for (const id of ['awm', 'trg42', 'pkp']) {
    const build = createWeaponShowcaseBuild(id, 'field');
    expect(MODULE_BY_ID[build.modules.foregrip!.modelId]!.appearance).toBe('bipod');
    if (id !== 'pkp') {
      expect(MODULE_BY_ID[build.modules.barrel!.modelId]!.appearance).toBe('long');
      expect(MODULE_BY_ID[build.modules.optic!.modelId]!.appearance).toBe('longscope');
      expect(MODULE_BY_ID[build.modules.muzzle!.modelId]!.appearance).toContain('suppressor');
    }
    for (const facing of PIXEL_FACINGS) for (const [mode, frames] of Object.entries(PIXEL_ACTOR_FRAMES)) for (let frame = 0; frame < frames; frame++) {
      const animation = { mode, frame, facing } as PixelActorFrame, native = surface(), metadata = paintPixelActor(native.context, scav, animation, build);
      expect(hasPadding(native.pixels), `${id} ${facing} ${mode} ${frame}`).toBe(true);
      const sprite = art.get(scav, animation, build), crop = { x: PIXEL_ACTOR_ANCHOR.x - sprite.anchor.x, y: PIXEL_ACTOR_ANCHOR.y - sprite.anchor.y };
      expect(sprite.image.width).toBeLessThan(W); expect(sprite.image.height).toBeLessThan(H);
      for (const socket of ['muzzle', 'ejection'] as const) {
        const nativeSocket = metadata[socket], local = sprite[socket];
        if (!nativeSocket) { expect(local).toBeUndefined(); continue; }
        expect(local).toEqual({ x: nativeSocket.x - crop.x, y: nativeSocket.y - crop.y });
        expect(local!.x).toBeGreaterThanOrEqual(0); expect(local!.x).toBeLessThan(sprite.image.width);
        expect(local!.y).toBeGreaterThanOrEqual(0); expect(local!.y).toBeLessThan(sprite.image.height);
      }
      if (mode !== 'downed') {
        const rig = pixelActorRig(animation), recoil = rig.weaponKick;
        const expected = pixelWeaponAnchors(build, rig.grip, facing, recoil);
        expect(metadata).toEqual({ muzzle: expected.muzzle, ejection: expected.ejection });
        if (pixelBearing(facing).y >= -.1) {
          const support = { x: expected.forehand.x - crop.x, y: expected.forehand.y - crop.y };
          expect(['#c6a484', '#3a4e3d', '#c0ad85']).toContain(canvases.colorAt(sprite.image, support.x, support.y) ?? '');
        }
      }
      expect(art.retainedBytes).toBeLessThanOrEqual(PIXEL_ACTOR_CACHE_BYTES);
    }
  }
  art.clear();
}, 120_000);

test('same-instance part removal, replacement and wear invalidate actor caches without restoring absent modules', () => {
  mockCanvases(); const art = new PixelActorArt(), animation = { mode: 'aim' as const, frame: 0, facing: 'se' as const };
  const build = createWeaponShowcaseBuild('awm', 'field'), original = structuredClone(build), complete = art.get(scav, animation, build);
  expect(art.get(scav, animation, structuredClone(build))).toBe(complete);
  for (const slot of ['muzzle', 'optic', 'foregrip', 'stock', 'magazine', 'barrel', 'receiver'] as ModuleSlot[]) {
    const previous = build.modules[slot]; expect(previous).toBeDefined();
    delete build.modules[slot];
    const removed = art.get(scav, animation, build); expect(removed).not.toBe(complete);
    expect(build.modules[slot]).toBeUndefined();
    if (slot === 'barrel') expect(removed.muzzle).toBeUndefined();
    if (slot === 'receiver') expect(removed.ejection).toBeUndefined();
    build.modules[slot] = previous; expect(art.get(scav, animation, build)).toBe(complete);
  }
  const factoryBarrel = createWeaponShowcaseBuild('awm', 'factory').modules.barrel!;
  build.modules.barrel = factoryBarrel; expect(art.get(scav, animation, build)).not.toBe(complete);
  build.modules.barrel = original.modules.barrel; expect(art.get(scav, animation, build)).toBe(complete);
  build.durability = 1; expect(art.get(scav, animation, build)).not.toBe(complete); build.durability = original.durability;
  const barrelCondition = build.modules.barrel!.durability;
  build.modules.barrel!.durability = 1; expect(art.get(scav, animation, build)).not.toBe(complete); build.modules.barrel!.durability = barrelCondition;
  expect(art.get(scav, animation, build)).toBe(complete);
  const empty: PixelWeaponInput = { weaponId: build.weaponId, durability: 100, modules: {} }, emptySprite = art.get(scav, animation, empty);
  expect(emptySprite.muzzle).toBeUndefined(); expect(emptySprite.ejection).toBeUndefined();
  expect(art.get(scav, animation, 'unknown').muzzle).toBeDefined(); expect(art.get(scav, animation, 'private-unrecognized-model').muzzle).toBeDefined();
  art.clear();
});

test('the support glove follows an installed foregrip rather than the factory handguard socket', () => {
  const canvases = mockCanvases(), art = new PixelActorArt(), build = createWeaponShowcaseBuild('m4a1', 'field');
  const withoutGrip = structuredClone(build); delete withoutGrip.modules.foregrip;
  for (const facing of ['s', 'se', 'e', 'sw', 'w'] as const) {
    const animation = { mode: 'aim' as const, frame: 0, facing }, rig = pixelActorRig(animation);
    const equipped = pixelWeaponAnchors(build, rig.grip, facing), unequipped = pixelWeaponAnchors(withoutGrip, rig.grip, facing);
    expect(equipped.forehand).not.toEqual(unequipped.forehand);
    for (const input of [build, withoutGrip]) {
      const sprite = art.get(scav, animation, input), socket = pixelWeaponAnchors(input, rig.grip, facing).forehand;
      const local = { x: socket.x - PIXEL_ACTOR_ANCHOR.x + sprite.anchor.x, y: socket.y - PIXEL_ACTOR_ANCHOR.y + sprite.anchor.y };
      expect(['#c6a484', '#3a4e3d', '#c0ad85']).toContain(canvases.colorAt(sprite.image, local.x, local.y) ?? '');
    }
  }
  art.clear();
});

test('a changing arsenal stays within24MiB and evicts old full-build frames without invalidating returned socket coordinates', () => {
  mockCanvases(); const art = new PixelActorArt(), animation = { mode: 'aim' as const, frame: 0, facing: 'se' as const };
  const first = art.get(scav, animation, createWeaponShowcaseBuild('awm', 'field')), firstAnchor = { ...first.anchor }, firstMuzzle = { ...first.muzzle! };
  for (const definition of WEAPONS) for (const preset of ['factory', 'field'] as const) for (const facing of PIXEL_FACINGS) {
    art.get({ ...scav, appearance: 4 }, { mode: 'walk', frame: 3, facing }, createWeaponShowcaseBuild(definition.id, preset));
    expect(art.retainedBytes).toBeLessThanOrEqual(PIXEL_ACTOR_CACHE_BYTES);
  }
  expect(first.image.width).toBe(1); expect(first.image.height).toBe(1);
  expect(first.anchor).toEqual(firstAnchor); expect(first.muzzle).toEqual(firstMuzzle);
  art.clear(); expect(art.retainedBytes).toBe(0);
}, 120_000);

test('two-handed native stock volumes reach the firing shoulder envelope across all eight bearings', () => {
  for (const facing of PIXEL_FACINGS) for (const weapon of PIXEL_WEAPON_IDS) {
    const profile = pixelWeaponProfile(weapon); if (!profile.twoHanded) continue;
    const rig = pixelActorRig({ mode: 'aim', frame: 0, facing }), s = surface();
    paintPixelWeapon(new PixelRaster(s.context, W, H), weapon, rig.grip, facing);
    let nearest = Infinity;
    // Native bullpup and hunting stocks have different butt heights. Check the
    // painted volume beside the shoulder instead of inventing a butt at bore height.
    for (const [index, pixel] of s.pixels.entries()) if (pixel) nearest = Math.min(nearest, Math.hypot(index % W - rig.rightShoulder.x, Math.floor(index / W) - rig.rightShoulder.y));
    expect(nearest, `${weapon} ${facing}`).toBeLessThan(18);
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
    expect(s.pixels.slice((H - 1) * W).every(pixel => pixel === 0)).toBe(true);
    expect(s.pixels.every((pixel, index) => index % W !== 0 && index % W !== W - 1 || pixel === 0)).toBe(true);
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
  for (const [index, entity] of crowd.entries()) for (let frame = 0; frame < PIXEL_ACTOR_FRAMES.walk; frame++) art.get(entity, { mode: 'walk', frame, facing: PIXEL_FACINGS[index % 8]! }, 'akm');
  expect(art.retainedBytes).toBeLessThanOrEqual(PIXEL_ACTOR_CACHE_BYTES);
  const visibleFrame = crowd.map((entity, index) => art.get(entity, { mode: 'walk', frame: 3, facing: PIXEL_FACINGS[index % 8]! }, 'akm')), created = canvases.created;
  for (const [index, entity] of crowd.entries()) expect(art.get(entity, { mode: 'walk', frame: 3, facing: PIXEL_FACINGS[index % 8]! }, 'akm')).toBe(visibleFrame[index]!);
  expect(canvases.created).toBe(created);
  const base = art.get(scav, { mode: 'idle', frame: 0, facing: 's' }); expect(art.get(scav, { mode: 'idle', frame: 400, facing: 's' })).toBe(base);
  expect(art.get({ ...scav, limping: true }, { mode: 'idle', frame: 0, facing: 's' })).not.toBe(base);
  art.clear(); expect(art.retainedBytes).toBe(0);
});
