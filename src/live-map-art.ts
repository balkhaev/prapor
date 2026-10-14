import type { LiveCityBuilding, LivePoint, LiveWorld, LiveWorldProp } from './game/live';
import { legacyHallEnvelopes } from './game/world-building-envelope';

export type SceneryBounds = LivePoint & { width: number; height: number };

/** Public static scenery is indexed once, rather than scanning the whole perimeter per frame. */
export class SceneryIndex<T extends SceneryBounds> {
  private chunks = new Map<string, T[]>();
  constructor(items: readonly T[], private size = 16) {
    for (const item of items) {
      for (let y = Math.floor(item.y / size); y <= Math.floor((item.y + item.height) / size); y++) {
        for (let x = Math.floor(item.x / size); x <= Math.floor((item.x + item.width) / size); x++) {
          const key = `${x}:${y}`, chunk = this.chunks.get(key) ?? [];
          chunk.push(item); this.chunks.set(key, chunk);
        }
      }
    }
  }
  visible(bounds: SceneryBounds): T[] {
    const found = new Set<T>();
    for (let y = Math.floor(bounds.y / this.size); y <= Math.floor((bounds.y + bounds.height) / this.size); y++) {
      for (let x = Math.floor(bounds.x / this.size); x <= Math.floor((bounds.x + bounds.width) / this.size); x++) {
        for (const item of this.chunks.get(`${x}:${y}`) ?? []) {
          if (item.x <= bounds.x + bounds.width && item.y <= bounds.y + bounds.height && item.x + item.width >= bounds.x && item.y + item.height >= bounds.y) found.add(item);
        }
      }
    }
    return [...found];
  }
}

/** Only an occupied interior or a real doorway threshold opens a roof; pavement stays outside. */
export function buildingNeedsCutaway(building: SceneryBounds & { entrances?: readonly LivePoint[] }, visiblePoints: readonly LivePoint[]): boolean {
  return visiblePoints.some(point => {
    if (point.x >= building.x - .45 && point.y >= building.y - .45 && point.x < building.x + building.width - .55 && point.y < building.y + building.height - .55) return true;
    return building.entrances?.some(door => {
      const horizontal = door.y === building.y || door.y === building.y + building.height - 1;
      return horizontal ? Math.abs(point.x - door.x - .5) <= .65 && Math.abs(point.y - door.y) <= 1.05
        : Math.abs(point.y - door.y - .5) <= .65 && Math.abs(point.x - door.x) <= 1.05;
    }) ?? false;
  });
}

export function buildingWallHeight(building: LiveCityBuilding): number {
  const floors = building.floors ?? (building.kind === 'apartment' ? 2 : 1);
  return (building.kind === 'workshop' ? .28 : .18) + floors * .57;
}

export function buildingFacadeCadence(building: LiveCityBuilding, length: number): { columns: number; width: number; height: number; industrial: boolean } {
  const industrial = building.kind === 'workshop' || building.kind === 'garage';
  return { columns: Math.max(1, Math.floor((length - 1.4) / (industrial ? 4.8 : building.kind === 'shop' ? 3.9 : 2.9))), width: industrial ? 1.15 : building.kind === 'shop' ? 1.25 : .63, height: industrial ? .13 : building.kind === 'shop' ? .27 : .2, industrial };
}

/** Closed colliders and exact six-wall halls give old landmarks an architectural silhouette.
 * A courtyard/POI box alone is never sufficient evidence for a roof. */
export function sceneBuildings(world: LiveWorld): LiveCityBuilding[] {
  const result = [...world.citySites?.flatMap(site => site.buildings) ?? []];
  const styles = (template: string): Pick<LiveCityBuilding, 'kind' | 'floors' | 'facade' | 'roof'> =>
    ['workshop', 'sawmill', 'depot', 'city-tram', 'greenhouse'].includes(template) ? { kind: 'workshop', floors: 1, facade: 'metal', roof: template === 'sawmill' ? 'sawtooth' : 'gable' }
      : template === 'apartments' ? { kind: 'apartment', floors: 2, facade: 'plaster', roof: 'gable' }
        : ['clinic', 'city-hospital', 'city-police', 'school', 'archive', 'office'].includes(template) ? { kind: 'service', floors: 2, facade: 'brick', roof: template === 'city-hospital' ? 'flat' : 'gable' }
          : ['city-mall', 'market'].includes(template) ? { kind: 'shop', floors: 1, facade: 'plaster', roof: 'gable' }
            : { kind: 'garage', floors: 1, facade: 'plaster', roof: 'gable' };
  for (const [index, obstacle] of world.obstacles.entries()) {
    if (obstacle.kind !== 'building' || obstacle.propId) continue;
    const poi = world.pois.find(poi => obstacle.x >= poi.x && obstacle.y >= poi.y && obstacle.x + obstacle.width <= poi.x + poi.width && obstacle.y + obstacle.height <= poi.y + poi.height);
    const frontage = /^(Жилой дом|Дом лесных рабочих|Угловая лавка|Служебная мастерская|Ремонтный бокс) · /.exec(obstacle.label ?? '');
    const inferred = frontage ? frontage[1] === 'Угловая лавка' ? { kind: 'shop' as const, floors: 1 as const, facade: 'plaster' as const, roof: 'gable' as const }
      : frontage[1] === 'Служебная мастерская' || frontage[1] === 'Ремонтный бокс' ? { kind: 'workshop' as const, floors: 1 as const, facade: 'metal' as const, roof: 'gable' as const }
        : { kind: 'apartment' as const, floors: 1 as const, facade: 'plaster' as const, roof: 'gable' as const } : styles(poi?.templateId ?? '');
    result.push({ ...obstacle, id: `solid-${index}`, name: obstacle.label ?? poi?.name ?? 'Корпус', ...inferred, roofAxis: obstacle.width >= obstacle.height ? 'x' : 'y', entrances: [] });
  }
  result.push(...legacyHallEnvelopes(world).map(hall => ({ ...hall, ...styles(hall.templateId) })));
  return result;
}

export function buildingPalette(building: LiveCityBuilding): readonly [string, string, string] {
  const palettes = {
    brick: ['#9c7963', '#715647', '#a9a092'],
    plaster: ['#c3b397', '#938570', '#8c8e7a'],
    panel: ['#a3aaa1', '#768379', '#808c84'],
    metal: ['#889a9b', '#586e71', '#93a3a2'],
  } as const;
  return palettes[building.facade ?? (building.kind === 'workshop' || building.kind === 'garage' ? 'metal' : building.kind === 'apartment' ? 'plaster' : 'brick')];
}

type PropSprite = { image: HTMLCanvasElement; anchor: LivePoint };

/** Each model is painted only once at the native 54px tile size; frames scale cached sprites. */
export class PropArtCache {
  private sprites = new Map<string, PropSprite>();
  clear(): void { this.sprites.clear(); }
  get(prop: LiveWorldProp): PropSprite {
    const key = `${prop.kind}:${prop.orientation}:${prop.width}:${prop.height}:${prop.variant}`;
    const old = this.sprites.get(key); if (old) return old;
    const w = prop.width, h = prop.height, anchor = { x: h * 27 + 22, y: 116 };
    const image = document.createElement('canvas'); image.width = Math.ceil((w + h) * 27 + 44); image.height = Math.ceil((w + h) * 13.5 + 134);
    const c = image.getContext('2d');
    if (c) paintPropModel(c, prop, anchor);
    const sprite = { image, anchor }; this.sprites.set(key, sprite); return sprite;
  }
}

/** Material wear is cached separately from roofs/cutaways, so camera motion adds no texture work. */
export class BuildingMaterialArt {
  private images = new Map<string, HTMLCanvasElement>();
  clear(): void { this.images.clear(); }
  facade(building: LiveCityBuilding, length: number): HTMLCanvasElement {
    const floors = building.floors ?? (building.kind === 'apartment' ? 2 : 1);
    return this.get(building, 'facade', Math.ceil(length * 24), Math.ceil(((building.kind === 'workshop' ? .28 : .18) + floors * .57) * 54));
  }
  roof(building: LiveCityBuilding, width: number, height: number): HTMLCanvasElement {
    return this.get(building, 'roof', Math.ceil(width * 24), Math.ceil(height * 24));
  }
  private get(building: LiveCityBuilding, surface: 'facade' | 'roof', width: number, height: number): HTMLCanvasElement {
    const key = `${building.id}:${building.facade}:${building.roof}:${surface}:${width}:${height}`, existing = this.images.get(key);
    if (existing) return existing;
    const image = document.createElement('canvas'); image.width = Math.max(1, width); image.height = Math.max(1, height);
    const c = image.getContext('2d');
    if (c) {
      let seed = [...building.id].reduce((value, char) => Math.imul(value, 31) + char.charCodeAt(0), 17) >>> 0;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
      const line = (ax: number, ay: number, bx: number, by: number, color: string, thickness = .7) => { c.strokeStyle = color; c.lineWidth = thickness; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); };
      if (surface === 'facade') {
        const material = building.facade ?? (building.kind === 'workshop' ? 'metal' : 'plaster');
        if (material === 'brick') {
          for (let y = 0, row = 0; y < height; y += 5.8, row++) {
            line(0, y, width, y, '#e0c6a629');
            for (let x = row % 2 * 7; x < width; x += 14) {
              line(x, y, x, y + 5.8, '#362e282e', .6);
              if (random() < .22) { c.fillStyle = random() < .5 ? '#d7b38915' : '#493e351a'; c.fillRect(x + 1, y + .8, 12, 4.5); }
            }
          }
        } else if (material === 'metal') {
          for (let x = 0; x < width; x += 8) { line(x, 0, x, height, '#dce2ca25'); line(x + 2, 0, x + 2, height, '#233d382e'); }
          for (let i = 0; i < 7; i++) { const x = random() * width, y = height * (.25 + random() * .7); c.fillStyle = '#8e69462b'; c.fillRect(x, y, 1.3 + random() * 2, height - y); }
        } else if (material === 'panel') {
          for (let x = 0; x < width; x += 48) { line(x, 0, x, height, '#283f3545', 1.2); line(x + 1.6, 0, x + 1.6, height, '#dae0c229'); }
          for (let y = height - 5; y > 0; y -= 29) line(0, y, width, y, '#334a3940', 1.1);
        } else {
          for (let i = 0; i < 7; i++) {
            const x = random() * width, y = random() * height;
            c.fillStyle = '#d2c7a814'; c.beginPath(); c.ellipse(x, y, 4 + random() * 9, 3 + random() * 6, .3, 0, Math.PI * 2); c.fill();
          }
          const x = width * (.15 + random() * .6), y = height * .4;
          line(x, y, x + 3, y + 9, '#4153492b'); line(x + 3, y + 9, x - 1, y + 17, '#4153492b');
        }
        const wash = c.createLinearGradient(0, height * .7, 0, height); wash.addColorStop(0, '#243b2e00'); wash.addColorStop(1, '#34473250'); c.fillStyle = wash; c.fillRect(0, height * .7, width, height * .3);
        for (let i = 0; i < 5; i++) { const x = random() * width, length = 8 + random() * height * .25; c.fillStyle = '#2e403622'; c.fillRect(x, 2, 1.5 + random() * 2.5, length); }
      } else {
        const pitched = building.roof === 'gable' || building.roof === 'sawtooth';
        for (let x = 0; x < width; x += pitched ? 11 : 57.6) {
          line(x, 0, x, height, pitched ? '#152f2b3b' : '#263c3344', pitched ? .8 : 1.2);
          line(x + 1.5, 0, x + 1.5, height, '#d6dec224');
        }
        if (!pitched) for (let y = 0; y < height; y += 57.6) line(0, y, width, y, '#354b3b4a', 1.1);
        for (let i = 0; i < 7; i++) {
          const x = random() * width, y = random() * height;
          c.fillStyle = pitched ? '#9b785323' : '#273f3736'; c.beginPath(); c.ellipse(x, y, 3 + random() * 8, 4 + random() * 12, .2, 0, Math.PI * 2); c.fill();
        }
        for (let x = 4; x < width; x += 37) for (let y = 7; y < height; y += 42) { c.fillStyle = '#223d2b77'; c.fillRect(x, y, 1.3, 1.3); }
      }
    }
    this.images.set(key, image); return image;
  }
}

/** All silhouettes use the published footprint; this does not invent cover or loot. */
export function paintPropModel(c: CanvasRenderingContext2D, prop: LiveWorldProp, anchor: LivePoint): void {
  const w = prop.width, h = prop.height, variant = prop.variant;
  const p = (x: number, y: number, z = 0): LivePoint => ({ x: anchor.x + (x - y) * 27, y: anchor.y + (x + y) * 13.5 - z });
  const polygon = (points: LivePoint[], fill: string, stroke = '#192b2855') => {
    c.beginPath(); points.forEach((point, index) => index ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y)); c.closePath(); c.fillStyle = fill; c.fill(); c.lineWidth = .65; c.strokeStyle = stroke; c.stroke();
  };
  const line = (from: LivePoint, to: LivePoint, color: string, width = 1) => { c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.strokeStyle = color; c.lineWidth = width; c.stroke(); };
  const quad = (x: number, y: number, width: number, height: number, z: number, color: string) => polygon([p(x, y, z), p(x + width, y, z), p(x + width, y + height, z), p(x, y + height, z)], color);
  const box = (x: number, y: number, width: number, height: number, z: number, colors: readonly string[], bottom = 0) => {
    const a = p(x, y, z), b = p(x + width, y, z), d = p(x, y + height, z), e = p(x + width, y + height, z);
    polygon([p(x + width, y, bottom), p(x + width, y + height, bottom), e, b], colors[0]!);
    polygon([p(x, y + height, bottom), p(x + width, y + height, bottom), e, d], colors[1]!);
    polygon([a, b, e, d], colors[2]!);
    if (width > .3 && height > .3 && z > 9) {
      // Small cached patches give large painted/wooden surfaces dust and wear without new silhouettes.
      c.save(); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(e.x, e.y); c.lineTo(d.x, d.y); c.closePath(); c.clip();
      for (let mark = 0; mark < 6; mark++) {
        const u = ((mark * 37 + variant * 13) % 89 + 5) / 100, v = ((mark * 23 + variant * 19) % 87 + 6) / 100, at = p(x + width * u, y + height * v, z);
        c.fillStyle = mark % 2 ? '#d7d5b525' : '#233b3427'; c.beginPath(); c.ellipse(at.x, at.y, 1.6 + mark % 3, .7 + mark % 2 * .35, -.3, 0, Math.PI * 2); c.fill();
      }
      c.restore();
      polygon([p(x, y + height, bottom), p(x + width, y + height, bottom), p(x + width, y + height, bottom + (z - bottom) * .16), p(x, y + height, bottom + (z - bottom) * .16)], '#283b3028', '#283b3000');
    }
  };
  const ellipse = (point: LivePoint, rx: number, ry: number, color: string) => { c.beginPath(); c.ellipse(point.x, point.y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill(); };
  const uv = (u: number, v: number): LivePoint => prop.orientation === 'x' ? { x: w * u, y: h * v } : { x: w * v, y: h * u };
  const uvBox = (u: number, v: number, du: number, dv: number, z: number, colors: readonly string[], bottom = 0) => { const a = uv(u, v), b = uv(u + du, v + dv); box(a.x, a.y, b.x - a.x, b.y - a.y, z, colors, bottom); };
  const uvQuad = (u: number, v: number, du: number, dv: number, z: number, color: string) => { const a = uv(u, v), b = uv(u + du, v + dv); quad(a.x, a.y, b.x - a.x, b.y - a.y, z, color); };
  const kind = prop.kind;
  quad(.08, .08, Math.max(.08, w - .04), Math.max(.08, h - .04), 0, '#10231c35');

  if (['car', 'van', 'truck', 'bus', 'railcar'].includes(kind)) {
    const colors = [['#748786', '#495f60', '#9aa9a0'], ['#ae9b78', '#7c7056', '#c2b498'], ['#866b5e', '#5d4c43', '#a48c7b'], ['#84916f', '#59634c', '#a6ae8c']][variant]!;
    const big = kind !== 'car', height = kind === 'railcar' ? 37 : kind === 'bus' ? 34 : kind === 'truck' ? 26 : kind === 'van' ? 27 : 15;
    for (const u of [.2, .76]) for (const v of [.05, .84]) uvBox(u, v, .13, .11, 8, ['#172521', '#111e1b', '#3c4540']);
    uvBox(.06, .09, .88, .82, height, colors, 7);
    if (kind === 'car') {
      uvBox(.28, .14, .42, .72, 26, colors, height);
      uvQuad(.32, .17, .07, .66, 26.7, '#384d4d'); uvQuad(.6, .17, .075, .66, 26.7, '#4c6560');
      uvQuad(.42, .22, .15, .56, 27, colors[2]!);
    } else if (kind === 'truck') {
      uvBox(.08, .1, .22, .8, height + 6, colors, height);
      uvBox(.34, .1, .57, .8, height + (variant === 1 ? 15 : 2), ['#6c756b', '#46564e', '#929782'], height);
      uvQuad(.12, .13, .06, .73, height + 7, '#354d50');
      if (variant !== 1) for (let u = .39; u < .91; u += .11) uvBox(u, .16, .08, .26 + (u % .2), height + 15, ['#947b56', '#675c40', '#b09c6c'], height + 3);
    } else {
      uvQuad(.1, .18, .07, .64, height + .6, '#3c595c');
      const start = kind === 'railcar' ? .12 : .22;
      for (let u = start; u < .87; u += .145) {
        const a = uv(u, .91), b = uv(u + .09, .91);
        polygon([p(a.x, a.y, height - 5), p(b.x, b.y, height - 5), p(b.x, b.y, height - 15), p(a.x, a.y, height - 15)], variant === 2 ? '#344841' : '#506865', '#b7b99b80');
        if (kind === 'railcar') { const aa = uv(u, .13), bb = uv(u, .86); line(p(aa.x, aa.y, height + 1), p(bb.x, bb.y, height + 1), '#c3b8a244'); }
      }
      if (kind === 'bus' || kind === 'railcar') uvBox(.45, .3, .2, .4, height + 3, ['#697970', '#4b5e52', '#a7af9a'], height);
    }
    const a = uv(.94, .17), b = uv(.94, .8); ellipse(p(a.x, a.y, 11), 2.5, 2, '#ddd3a6'); ellipse(p(b.x, b.y, 11), 2.5, 2, '#c8bd90');
    const rust = uv(.69, .89); ellipse(p(rust.x, rust.y, big ? height * .5 : 10), 4, 2.2, '#a0714c66');
    return;
  }

  if (kind === 'lamp' || kind === 'power-pole' || kind === 'sign' || kind === 'hydrant' || kind === 'bollard') {
    const center = p(w * .5, h * .5), height = kind === 'power-pole' ? 99 : kind === 'lamp' ? 81 : kind === 'sign' ? 35 : kind === 'hydrant' ? 15 : 10;
    ellipse(center, 5, 2.4, '#132b2760'); line(center, { x: center.x, y: center.y - height }, kind === 'power-pole' ? '#766650' : '#73867f', kind === 'power-pole' ? 4 : kind === 'hydrant' ? 5 : 2.2);
    if (kind === 'lamp') {
      line({ x: center.x, y: center.y - height }, { x: center.x + 12, y: center.y - height + 2 }, '#9da89b', 2);
      ellipse({ x: center.x + 13, y: center.y - height + 3 }, 6, 3.2, '#c9c8a0');
      ellipse({ x: center.x + 13, y: center.y - height + 5 }, 3.5, 1.8, '#e3ddb044');
    } else if (kind === 'power-pole') {
      line({ x: center.x - 16, y: center.y - height + 8 }, { x: center.x + 16, y: center.y - height + 14 }, '#8b8065', 3);
      for (const dx of [-12, 0, 12]) { c.fillStyle = '#b3bda9'; c.fillRect(center.x + dx - 2, center.y - height + 3 + dx * .17, 4, 7); }
    } else if (kind === 'sign') {
      polygon([{ x: center.x - 13, y: center.y - height }, { x: center.x + 14, y: center.y - height + 3 }, { x: center.x + 14, y: center.y - height + 13 }, { x: center.x - 13, y: center.y - height + 10 }], variant % 2 ? '#486b5d' : '#b2bbaa', '#d4d3b566');
      line({ x: center.x - 7, y: center.y - height + 5 }, { x: center.x + 8, y: center.y - height + 6 }, variant % 2 ? '#d0d8be' : '#344f44', 1.2);
    } else if (kind === 'hydrant') { ellipse({ x: center.x, y: center.y - 15 }, 4, 2.5, '#a57958'); line({ x: center.x - 5, y: center.y - 8 }, { x: center.x + 5, y: center.y - 8 }, '#c39d6e', 3); }
    else { c.fillStyle = '#d6cba5'; c.fillRect(center.x - 1.2, center.y - 8, 2.4, 2); }
    return;
  }

  if (kind === 'tree' || kind === 'shrub' || kind === 'planter' || kind === 'garden') {
    if (kind === 'planter') box(.04, .04, w - .08, h - .08, 9, ['#8d9581', '#637262', '#b0b39a']);
    if (kind === 'garden') {
      quad(.04, .04, w - .08, h - .08, 1, '#615d42');
      for (let x = .2; x < w; x += .55) { line(p(x, .12, 2), p(x, h - .12, 2), '#ad9d6b', 2); for (let y = .2; y < h; y += .48) ellipse(p(x, y, 3), 3.8, 2.5, ['#698156', '#8d9260', '#708047'][variant % 3]!); }
      return;
    }
    const center = p(w * .5, h * .5), height = kind === 'tree' ? 58 + variant * 7 : kind === 'planter' ? 13 : 16;
    if (kind === 'tree') line(center, { x: center.x, y: center.y - height * .8 }, variant % 2 ? '#a89e7f' : '#706a4f', 3);
    const radius = Math.min(34, (w + h) * (kind === 'tree' ? 10 : 8));
    ellipse({ x: center.x - radius * .28, y: center.y - height * .7 }, radius * .72, radius * .5, '#435e3f');
    ellipse({ x: center.x + radius * .29, y: center.y - height * .82 }, radius * .7, radius * .52, '#587346');
    ellipse({ x: center.x, y: center.y - height }, radius * .69, radius * .49, ['#788c58', '#668354', '#829466', '#698251'][variant]!);
    for (let i = 0; i < 9; i++) ellipse({ x: center.x + (i % 3 - 1) * radius * .34, y: center.y - height + Math.floor(i / 3) * 4 }, 3.2, 1.8, '#c7cf842c');
    return;
  }

  if (kind === 'fence') {
    const a = uv(.03, .5), b = uv(.97, .5);
    for (const z of [11, 25]) line(p(a.x, a.y, z), p(b.x, b.y, z), '#718375', 1.4);
    const count = Math.max(2, Math.ceil(Math.max(w, h) * 2));
    for (let i = 0; i <= count; i++) { const at = uv(.03 + .94 * i / count, .5); line(p(at.x, at.y), p(at.x, at.y, 31), '#8e9980', i % 4 === 0 ? 2.6 : 1); }
    return;
  }

  if (kind === 'bench' || kind === 'workbench' || kind === 'market-stall') {
    for (const u of [.14, .78]) for (const v of [.18, .76]) uvBox(u, v, .06, .07, kind === 'workbench' ? 19 : 11, ['#535e51', '#394c41', '#80907b']);
    uvBox(.05, .12, .9, .76, kind === 'workbench' ? 21 : 13, ['#8e7e59', '#625d42', '#aa9b71'], kind === 'workbench' ? 18 : 10);
    for (let u = .08; u < .94; u += .16) { const a = uv(u, .13), b = uv(u, .88); line(p(a.x, a.y, kind === 'workbench' ? 21.5 : 13.5), p(b.x, b.y, kind === 'workbench' ? 21.5 : 13.5), '#62584088'); }
    if (kind === 'bench') uvBox(.05, .1, .9, .08, 24, ['#8e7e59', '#625d42', '#aa9b71'], 15);
    else if (kind === 'market-stall') {
      for (const u of [.08, .9]) { const at = uv(u, .18); line(p(at.x, at.y, 12), p(at.x, at.y, 48), '#8d8f76', 1.8); }
      for (let u = .03; u < .95; u += .15) uvQuad(u, .05, .15, .9, 48, Math.floor(u * 7) % 2 ? '#a59367' : '#65795d');
      for (const u of [.16, .4, .65]) uvBox(u, .23, .16, .47, 21, ['#82774f', '#5e603e', '#9b9862'], 13);
    } else { uvBox(.1, .2, .2, .2, 25, ['#647d78', '#425f58', '#92a197'], 21); }
    return;
  }

  if (kind === 'shed' || kind === 'kiosk' || kind === 'transformer') {
    const height = kind === 'transformer' ? 30 : 46, colors = kind === 'kiosk' ? ['#798f80', '#4c6f60', '#9ba995'] : ['#8c9388', '#606f65', '#b0b19b'];
    box(.04, .04, w - .08, h - .08, height, colors);
    if (kind === 'shed') {
      const a = p(.03, h * .5, height + 14), b = p(w - .03, h * .5, height + 14);
      polygon([p(.02, .02, height), p(w - .02, .02, height), b, a], '#919e94'); polygon([a, b, p(w - .02, h - .02, height), p(.02, h - .02, height)], '#596f63');
    } else box(.01, .01, w - .02, h - .02, height + 3, ['#455c52', '#334d41', '#a5ae9c'], height);
    for (let x = .2; x < w; x += .32) line(p(x, h, 2), p(x, h, height - 2), '#263c3640', .6);
    const a = p(w * .28, h, height * .74), b = p(w * .76, h, height * .74);
    polygon([a, b, p(w * .76, h, height * .3), p(w * .28, h, height * .3)], kind === 'kiosk' ? '#365749' : '#5b7064', '#c9c9ab66');
    if (kind === 'transformer') { const at = p(w * .5, h, 16); polygon([{ x: at.x, y: at.y - 5 }, { x: at.x + 5, y: at.y + 5 }, { x: at.x - 5, y: at.y + 5 }], '#d7bd6c'); }
    return;
  }

  if (kind === 'playground') {
    quad(.03, .03, w - .06, h - .06, 0, '#b5a37488');
    for (const x of [w * .1, w * .9]) { line(p(x, h * .2), p(x, h * .48, 40), '#aa8262', 2.5); line(p(x, h * .8), p(x, h * .48, 40), '#aa8262', 2.5); }
    line(p(w * .1, h * .48, 40), p(w * .9, h * .48, 40), '#74928a', 3);
    for (const x of [w * .35, w * .65]) { line(p(x, h * .48, 39), p(x, h * .48, 9), '#4a6258', 1); box(x - .12, h * .4, .24, h * .2, 9, ['#8b8062', '#675e48', '#b2a482'], 7); }
    return;
  }

  if (kind === 'barrel') {
    const center = p(w * .5, h * .5), radius = Math.min(w, h) * 12;
    c.fillStyle = ['#927351', '#68847a', '#899070', '#9c806c'][variant]!; c.fillRect(center.x - radius, center.y - 19, radius * 2, 18);
    ellipse(center, radius, radius * .45, '#415447'); ellipse({ x: center.x, y: center.y - 19 }, radius, radius * .45, '#ada38a');
    line({ x: center.x - radius, y: center.y - 12 }, { x: center.x + radius, y: center.y - 12 }, '#3b55487a', 1.6);
    ellipse({ x: center.x + 2, y: center.y - 19 }, 1.4, .9, '#435b4b'); return;
  }
  if (kind === 'logs') {
    for (let row = 0; row < 2; row++) for (let v = .16 + row * .08; v < .89; v += .23) {
      uvBox(.04, v, .92, .19, 9 + row * 8, ['#867450', '#594c35', '#a89665'], row * 8);
      const end = uv(.97, v + .1); ellipse(p(end.x, end.y, 5 + row * 8), 3.5, 4, '#c4ac77'); ellipse(p(end.x, end.y, 5 + row * 8), 1.6, 2, '#92774e');
    }
    return;
  }
  if (kind === 'pallet') {
    box(.03, .03, w - .06, h - .06, 6, ['#95805c', '#665a40', '#b4a076']);
    for (let x = .08; x < w; x += .27) quad(x, .04, Math.min(.18, w - x), h - .08, 6.5, '#c4b183');
    if (variant % 2) box(.16, .16, w * .58, h * .62, 21, ['#9e8967', '#6c6349', '#bcab83'], 7);
    return;
  }
  const dumpster = kind === 'dumpster', height = dumpster ? 23 : 18;
  box(.04, .04, w - .08, h - .08, height, dumpster ? ['#697d68', '#435b48', '#93a184'] : ['#9e8b63', '#6c6143', '#b8a878']);
  if (dumpster) { box(.01, .01, w - .02, h - .02, height + 3, ['#344a37', '#253e2d', '#65816b'], height); line(p(w * .1, h, height - 4), p(w * .9, h, height - 4), '#b1b293', 1.5); }
  else { line(p(.05, h, 2), p(w - .05, h, height - 2), '#d1ba88', 1.5); line(p(w - .05, h, 2), p(.05, h, height - 2), '#d1ba88', 1.5); }
}
