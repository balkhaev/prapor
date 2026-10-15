import { afterEach, expect, test } from 'bun:test';
import type { LiveCityBuilding, LiveObstacle } from '../src/game/live';
import { PIXEL_BUILDING_CACHE_BYTES, PixelBuildingArt, pixelBuildingSpriteBytes, pixelBuildingVentAnchor } from '../src/pixel-buildings';
import { pixelIso, PIXEL_PALETTE as P } from '../src/pixel-art';
import { generatePerimeterCore } from '../src/game/world-generation';
import { buildingExteriorStyle, buildingRoofDormer, sceneBuildings } from '../src/live-map-art';
import { buildingArchitecture, buildingArchitectureHeightAt } from '../src/building-architecture';

type CanvasRecord = HTMLCanvasElement & { paints: number; integerBounds: boolean; colors: Set<string>; spans: Array<[number, number, number, number, string]> };
let restoreDocument: (() => void) | undefined;
afterEach(() => { restoreDocument?.(); restoreDocument = undefined; });

function canvases(recordSpans = false): CanvasRecord[] {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document'), images: CanvasRecord[] = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
    const image = { width: 0, height: 0, paints: 0, integerBounds: true, colors: new Set<string>(), spans: [] } as unknown as CanvasRecord;
    const context = { fillStyle: '', setTransform() {}, fillRect(x: number, y: number, width: number, height: number) {
      image.paints++; image.colors.add(this.fillStyle);
      image.integerBounds &&= [x, y, width, height].every(Number.isInteger) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= image.width && y + height <= image.height;
      if (recordSpans) image.spans.push([x, y, width, height, this.fillStyle]);
    } };
    image.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    images.push(image); return image;
  } } });
  restoreDocument = () => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); };
  return images;
}

const building: LiveCityBuilding = { id: 'brick-home', name: 'Дом', x: 10, y: 20, width: 8, height: 8, kind: 'apartment',
  floors: 2, facade: 'brick', roof: 'gable', roofAxis: 'x', entrances: [{ x: 13, y: 20 }, { x: 13, y: 27 }] };

test('all facade and roof combinations use bounded integer surfaces at all three pixel levels', () => {
  const images = canvases(), original = structuredClone(building), art = new PixelBuildingArt();
  for (const facade of ['brick', 'plaster', 'panel', 'metal'] as const) for (const roof of ['flat', 'gable', 'sawtooth'] as const) for (const tile of [32, 64, 128] as const) {
    const house = { ...building, id: `${facade}-${roof}`, facade, roof, roofAxis: roof === 'sawtooth' ? 'y' as const : 'x' as const };
    const sprite = art.get(house, false, tile);
    expect(Number.isInteger(sprite.anchor.x) && Number.isInteger(sprite.anchor.y)).toBe(true);
    expect(sprite.image.width).toBeLessThanOrEqual(4096); expect(sprite.image.height).toBeLessThanOrEqual(4096);
    expect(pixelBuildingSpriteBytes(house, false, tile)).toBe(sprite.image.width * sprite.image.height * 4);
    expect(art.retainedBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  }
  expect(images.every(image => image.integerBounds && image.paints > 100 && image.colors.size >= 15)).toBe(true);
  expect(building).toEqual(original);
});

test('hips, mansards, cross gables and stepped blocks have unclipped native silhouettes at 32 and 64 pixels', () => {
  const images = canvases(true), art = new PixelBuildingArt();
  const houses = Array.from({ length: 64 }, (_, index) => ({ ...building, id: `native-roof-${index}`, width: 14 }));
  const selected = ['gable', 'hip', 'half-hip', 'mansard', 'cross-gable'].map(roof => houses.find(house => buildingArchitecture(house).roof === roof)!);
  selected.push({ ...building, id: 'panel-block-1', width: 23, floors: 3, facade: 'panel', roof: 'flat', entrances: [] });
  for (const house of selected) for (const native of [32, 64] as const) {
    const sprite = art.get(house, false, native), image = images.at(-1)!;
    expect(image.integerBounds).toBe(true);
    expect(Math.min(...image.spans.map(span => span[1]))).toBeGreaterThan(4);
    expect(image.colors.has(buildingExteriorStyle(house).roof[0])).toBe(true);
    expect(image.colors.has(buildingExteriorStyle(house).roof[1])).toBe(true);
    expect(pixelBuildingSpriteBytes(house, false, native)).toBe(sprite.image.width * sprite.image.height * 4);
    expect(art.retainedBytes).toBeLessThanOrEqual(PIXEL_BUILDING_CACHE_BYTES);
  }
});

test('cutaway keeps real doorway gaps transparent and removes the roof while preserving the room floor', () => {
  const images = canvases(true), art = new PixelBuildingArt(), open = art.get(building, true, 128);
  const image = images[0]!, pixelAt = (x: number, y: number): string | undefined => [...image.spans].reverse().find(span => x >= span[0] && y >= span[1] && x < span[0] + span[2] && y < span[1] + span[3])?.[4];
  expect(pixelBuildingSpriteBytes(building, true, 128)).toBe(image.width * image.height * 4);
  const interior = pixelIso(4, 4, 0, open.anchor), door = pixelIso(4, .5, 9, open.anchor), wall = pixelIso(2, .5, 9, open.anchor);
  expect(pixelAt(interior.x, interior.y)).toBeDefined();
  expect(pixelAt(door.x, door.y)).toBeUndefined();
  expect(pixelAt(wall.x, wall.y)).toBeDefined();
  const roofColor = buildingExteriorStyle(building).roof[0];
  expect(image.colors.has(roofColor)).toBe(false);
  const closed = art.get(building, false, 128);
  expect(closed).not.toBe(open); expect(closed.image.height).toBeGreaterThan(open.image.height);
  expect(images[1]!.colors.has(roofColor)).toBe(true);
});

test('legacy cutaway uses the supplied perimeter pieces rather than assuming a two-cell doorway', () => {
  const images = canvases(true), art = new PixelBuildingArt(), hall = { ...building, id: 'hall-wide-doors', entrances: [{ x: 13.5, y: 20 }, { x: 13.5, y: 27 }] };
  const walls: LiveObstacle[] = [
    { x: 10, y: 20, width: 2, height: 1, kind: 'wall' }, { x: 16, y: 20, width: 2, height: 1, kind: 'wall' },
    { x: 10, y: 27, width: 2, height: 1, kind: 'wall' }, { x: 16, y: 27, width: 2, height: 1, kind: 'wall' },
    { x: 10, y: 21, width: 1, height: 6, kind: 'wall' }, { x: 17, y: 21, width: 1, height: 6, kind: 'wall' },
  ];
  const original = structuredClone(walls), sprite = art.get(hall, true, 128, walls), image = images[0]!;
  const pixelAt = (x: number, y: number) => [...image.spans].reverse().find(span => x >= span[0] && y >= span[1] && x < span[0] + span[2] && y < span[1] + span[3]);
  for (const x of [2.5, 3.5, 4.5, 5.5]) { const at = pixelIso(x, .5, 9, sprite.anchor); expect(pixelAt(at.x, at.y)).toBeUndefined(); }
  const actualWall = pixelIso(1.5, .5, 9, sprite.anchor); expect(pixelAt(actualWall.x, actualWall.y)).toBeDefined();
  expect(walls).toEqual(original);
});

test('generated legacy hall cutaways preserve every actual free doorway cell and perimeter wall', () => {
  // Legacy hall geometry belongs to the preserved core; its G10 translation is covered by world-metropolis tests.
  const images = canvases(true), art = new PixelBuildingArt(), world = generatePerimeterCore('pixel-door-geometry');
  const halls = sceneBuildings(world).filter(building => building.id.startsWith('hall-')).slice(0, 8);
  expect(halls.length).toBeGreaterThan(3);
  for (const hall of halls) {
    const walls = world.obstacles.filter(wall => wall.kind === 'wall' && wall.x >= hall.x && wall.y >= hall.y
      && wall.x + wall.width <= hall.x + hall.width && wall.y + wall.height <= hall.y + hall.height);
    const sprite = art.get(hall, true, 64, walls), image = images[images.length - 1]!;
    const points = [...Array.from({ length: hall.width }, (_, x) => ({ x, y: 0 })), ...Array.from({ length: hall.width }, (_, x) => ({ x, y: hall.height - 1 })),
      ...Array.from({ length: hall.height - 2 }, (_, y) => ({ x: 0, y: y + 1 })), ...Array.from({ length: hall.height - 2 }, (_, y) => ({ x: hall.width - 1, y: y + 1 }))];
    for (const point of points) {
      const wallCell = walls.some(wall => point.x + hall.x >= wall.x && point.y + hall.y >= wall.y && point.x + hall.x < wall.x + wall.width && point.y + hall.y < wall.y + wall.height);
      const at = pixelIso((point.x + .5) / 2, (point.y + .5) / 2, 4.5, sprite.anchor);
      const painted = image.spans.some(span => at.x >= span[0] && at.y >= span[1] && at.x < span[0] + span[2] && at.y < span[1] + span[3]);
      expect(painted).toBe(wallCell);
    }
  }
}, 15_000);

test('building cache is lazy, reuses sprites, separates levels and evicts the least recently used surface', () => {
  const images = canvases(), art = new PixelBuildingArt();
  expect(images).toHaveLength(0);
  const large = { ...building, width: 23, height: 9, floors: 3 as const, entrances: [] }, first = art.get(large, false);
  expect(art.get(large, false)).toBe(first);
  expect(art.get({ ...large, x: 100, y: 200 }, false)).toBe(first);
  expect(art.get(large, false, 64)).not.toBe(first);
  for (let index = 0; index < 5; index++) { art.get({ ...large, id: `large-${index}` }, false); expect(art.retainedBytes).toBeLessThanOrEqual(32 * 1024 * 1024); }
  expect(art.get(large, false)).not.toBe(first);
  art.clear(); expect(art.retainedBytes).toBe(0);
  expect(art.get(large, false)).not.toBe(first);
});

test('a viewport budget lowers the whole frame level so five large houses remain cached between frames', () => {
  const images = canvases(), art = new PixelBuildingArt();
  const visible = Array.from({ length: 5 }, (_, index) => ({ ...building, id: `viewport-house-${index}`, width: 23, height: 9, floors: 3 as const, entrances: [] }));
  const budget = PIXEL_BUILDING_CACHE_BYTES - 8 * 1024 * 1024;
  const sum = (tile: 32 | 64 | 128) => visible.reduce((bytes, house) => bytes + pixelBuildingSpriteBytes(house, false, tile), 0);
  expect(sum(128)).toBeGreaterThan(PIXEL_BUILDING_CACHE_BYTES);
  const detail = ([128, 64, 32] as const).find(tile => sum(tile) <= budget)!;
  expect(detail).toBe(64);
  const firstFrame = visible.map(house => art.get(house, false, detail));
  expect(images).toHaveLength(5); expect(art.retainedBytes).toBe(sum(detail));
  for (let frame = 0; frame < 3; frame++) expect(visible.map(house => art.get(house, false, detail))).toEqual(firstFrame);
  expect(images).toHaveLength(5);
});

test('ambient outlet sits inside the actual chimney opening at every roof plane, axis and native level', () => {
  const images = canvases(true), art = new PixelBuildingArt();
  for (const roof of ['flat', 'gable', 'sawtooth'] as const) for (const roofAxis of ['x', 'y'] as const) for (const native of [32, 64, 128] as const) {
    const factory = { ...building, id: `outlet-${roof}-${roofAxis}`, kind: 'workshop' as const, width: 9, height: 7, floors: 1 as const, roof, roofAxis, entrances: [] };
    const sprite = art.get(factory, false, native), outlet = pixelBuildingVentAnchor(factory)!;
    const scale = native / 128, at = pixelIso(outlet.x * scale, outlet.y * scale, outlet.z * scale, sprite.anchor);
    const image = images.at(-1)!;
    const pixel = [...image.spans].reverse().find(span => at.x >= span[0] && at.y >= span[1] && at.x < span[0] + span[2] && at.y < span[1] + span[3]);
    expect(pixel?.[4]).toBe(P.ink);
    expect(outlet.x).toBeGreaterThan(0); expect(outlet.x).toBeLessThan(factory.width);
    expect(outlet.y).toBeGreaterThan(0); expect(outlet.y).toBeLessThan(factory.height);
    expect(outlet.z).toBeGreaterThan(0);
    expect(pixelBuildingVentAnchor({ ...factory, x: 100, y: 200 })).toEqual(outlet);
  }
  expect(pixelBuildingVentAnchor({ ...building, kind: 'shop' })).toBeNull();
  expect(pixelBuildingVentAnchor({ ...building, kind: 'garage' })).toBeNull();
  const residential = Array.from({ length: 20 }, (_, i) => pixelBuildingVentAnchor({ ...building, id: `residential-${i}` }));
  expect(residential.some(Boolean)).toBe(true); expect(residential.some(anchor => anchor === null)).toBe(true);
});

test('an ambient outlet follows same-object public architecture edits while world translation stays model-local', () => {
  const factory: LiveCityBuilding = { ...building, id: 'mutable-workshop', kind: 'workshop', floors: 1, facade: 'metal', roof: 'flat', entrances: [] };
  const before = pixelBuildingVentAnchor(factory)!;
  for (const edit of [{ roof: 'gable' as const }, { floors: 3 as const }, { roofAxis: 'y' as const, height: 11 }, { width: 17, roof: 'sawtooth' as const }, { id: 'another-workshop', facade: 'brick' as const }]) {
    Object.assign(factory, edit);
    expect(pixelBuildingVentAnchor(factory)).toEqual(pixelBuildingVentAnchor({ ...factory }));
  }
  expect(pixelBuildingVentAnchor(factory)!.z).not.toBe(before.z);
  const local = pixelBuildingVentAnchor(factory);
  factory.x += 400; factory.y += 700;
  expect(pixelBuildingVentAnchor(factory)).toEqual(local);
});

test('a shop entrance retains real glass on either side, with dark recesses and reflected panes', () => {
  const images = canvases(true), art = new PixelBuildingArt();
  const shop = { ...building, id: 'public-shop', kind: 'shop' as const, floors: 1 as const, facade: 'plaster' as const, entrances: [{ x: 13, y: 27 }] };
  const sprite = art.get(shop, false, 128), image = images[0]!;
  const colorAt = (u: number, z: number) => {
    const at = pixelIso(u, 8, z * 1.7, sprite.anchor);
    return [...image.spans].reverse().find(span => at.x >= span[0] && at.y >= span[1] && at.x < span[0] + span[2] && at.y < span[1] + span[3])?.[4];
  };
  // Two display windows survive the real central doorway; their interior is blue.
  for (const center of [8 / 3, 16 / 3]) {
    const glass = [center - .3, center + .3].map(u => colorAt(u, 38));
    expect(glass.some(color => color === '#334f55' || color === P.glassLight || color === P.steelShade)).toBe(true);
  }
  expect(image.colors.has(P.glassLight)).toBe(true);
  expect(image.colors.has(buildingExteriorStyle(shop).accent)).toBe(true); // public shop sign and matching awning
  expect(image.integerBounds).toBe(true);
});

test('distant houses preserve their large roof, masonry, corner and glass shapes without close-up texture noise', () => {
  const images = canvases(), art = new PixelBuildingArt();
  for (const kind of ['apartment', 'shop', 'workshop', 'garage', 'service'] as const) {
    const house = { ...building, id: `street-identity-${kind}`, kind, roof: 'gable' as const, facade: 'plaster' as const };
    const style = buildingExteriorStyle(house);
    art.get(house, false, 32); const distant = images.at(-1)!;
    art.get(house, false, 128); const close = images.at(-1)!;
    for (const color of [style.roof[0], style.roof[1], style.light, style.dark, style.trim, P.ink]) expect(distant.colors.has(color)).toBe(true);
    expect(['#334f55', '#557b81', P.wood].some(color => distant.colors.has(color))).toBe(true);
    expect(distant.integerBounds).toBe(true);
    // A distant sprite paints fewer strokes per native square cell as well as
    // fewer pixels; dense mortar grids cannot compete with an actor silhouette.
    expect(distant.paints).toBeLessThan(close.paints / 3);
  }
});

test('old roof windows sit on the same fitted dormer at every sprite level and roof direction', () => {
  const images = canvases(true), art = new PixelBuildingArt();
  const id = Array.from({ length: 12 }, (_, index) => `old-house-${index}`).find(id => buildingRoofDormer({ ...building, id }))!;
  expect(id).toBeDefined();
  for (const roofAxis of ['x', 'y'] as const) for (const native of [32, 64, 128] as const) {
    const house = { ...building, id, roofAxis }, dormer = buildingRoofDormer(house)!;
    const original = structuredClone(house), sprite = art.get(house, false, native), image = images.at(-1)!;
    const frontX = dormer.x + dormer.width, frontY = dormer.y + dormer.height;
    const base = buildingArchitectureHeightAt(buildingArchitecture(house), frontX, frontY) * 128;
    const scale = native / 128;
    const glass = [.28, .72].map(u => {
      const x = dormer.side === 'y' ? dormer.x + dormer.width * u : frontX, y = dormer.side === 'x' ? dormer.y + dormer.height * u : frontY;
      const at = pixelIso(x * scale, y * scale, (base + 9) * scale * 1.7, sprite.anchor);
      return [...image.spans].reverse().find(span => at.x >= span[0] && at.y >= span[1] && at.x < span[0] + span[2] && at.y < span[1] + span[3])?.[4];
    });
    expect(glass.some(color => color === '#334f55')).toBe(true);
    expect(image.integerBounds).toBe(true); expect(house).toEqual(original);
  }
});
