import { afterEach, expect, test } from 'bun:test';
import type { LiveWorldProp } from '../src/game/live';
import { PIXEL_PALETTE as C } from '../src/pixel-art';
import { PixelPropArt, PIXEL_PROP_CACHE_BYTES, pixelPropHeight } from '../src/pixel-props';

type Surface = { image: HTMLCanvasElement; pixels: Uint16Array; colors: string[] };
let restoreDocument: (() => void) | undefined;
afterEach(() => { restoreDocument?.(); restoreDocument = undefined; });
function raster() {
  const old = Object.getOwnPropertyDescriptor(globalThis,'document'), surfaces: Surface[] = [];
  Object.defineProperty(globalThis,'document',{ configurable: true, value: { createElement() {
    const surface = { pixels: new Uint16Array(), colors: [''] } as Surface;
    const image = { width: 0, height: 0 }, indices = new Map<string,number>();
    const context = { fillStyle: '', setTransform() {}, fillRect(x:number,y:number,w:number,h:number) {
      if (![x,y,w,h].every(Number.isInteger) || x<0 || y<0 || w<1 || h<1 || x+w>image.width || y+h>image.height) throw new Error('Invalid courtyard pixel span');
      if (!surface.pixels.length) surface.pixels = new Uint16Array(image.width*image.height);
      let color = indices.get(this.fillStyle);
      if (!color) { color = surface.colors.length; indices.set(this.fillStyle,color); surface.colors.push(this.fillStyle); }
      for (let row=y;row<y+h;row++) surface.pixels.fill(color,row*image.width+x,row*image.width+x+w);
    } };
    surface.image = { ...image, getContext: () => context } as unknown as HTMLCanvasElement;
    // Dimensions belong to the same object used by the raster painter.
    Object.defineProperties(surface.image,{ width: { get: () => image.width, set: (n:number) => { image.width=n; } }, height: { get: () => image.height, set: (n:number) => { image.height=n; } } });
    surfaces.push(surface); return surface.image;
  } } });
  restoreDocument = () => { if (old) Object.defineProperty(globalThis,'document',old); else Reflect.deleteProperty(globalThis,'document'); };
  return surfaces;
}
function prop(kind: LiveWorldProp['kind'], variant:number, orientation:'x'|'y'='x'):LiveWorldProp {
  const sizes = { bench:[1.5,.6], playground:[2,2], garden:[2.5,1.5], planter:[1,1], fence:[2,.2] } as const;
  const [long,cross] = sizes[kind as keyof typeof sizes];
  return { id:`yard-${kind}`,kind,x:20,y:30,width:orientation==='x'?long:cross,height:orientation==='x'?cross:long,orientation,variant,blocking:false };
}
function silhouette(surface:Surface, level:number) {
  let top=Infinity,upper=0;
  for (let y=0;y<surface.image.height;y++) for (let x=0;x<surface.image.width;x++) if (surface.pixels[y*surface.image.width+x]) {
    top=Math.min(top,y); if (y<level) upper++;
  }
  return { top,upper };
}

test('playgrounds have open swings, a sloped slide, a solid shade roof and a low carousel under either rotation', () => {
  const surfaces=raster(),art=new PixelPropArt();
  for (const orientation of ['x','y'] as const) {
    const shapes = Array.from({length:4},(_,variant) => {
      const sprite=art.get(prop('playground',variant,orientation));
      return silhouette(surfaces.at(-1)!,sprite.anchor.y+25);
    });
    expect(shapes[2]!.upper).toBeGreaterThan(shapes[0]!.upper*2);
    expect(shapes[1]!.upper).toBeGreaterThan(shapes[0]!.upper*1.5);
    expect(shapes[3]!.upper).toBeLessThan(shapes[2]!.upper*.3);
    expect(shapes[3]!.top).toBeGreaterThan(Math.max(shapes[0]!.top,shapes[1]!.top,shapes[2]!.top)+45);
  }
});

test('backless courtyard seats keep a low silhouette instead of sharing every bench back', () => {
  const surfaces=raster(),art=new PixelPropArt();
  for (const orientation of ['x','y'] as const) {
    const tops=Array.from({length:4},(_,variant) => {
      const sprite=art.get(prop('bench',variant,orientation)); return silhouette(surfaces.at(-1)!,sprite.anchor.y).top;
    });
    expect(tops[3]!).toBeGreaterThan(Math.max(...tops.slice(0,3))+12);
  }
});

test('cultivated courtyard art keeps public anchors and reuses one atlas entry across all map positions without baked shadow paint', () => {
  const surfaces=raster(),art=new PixelPropArt(),kinds=['bench','playground','garden','planter','fence'] as const;
  for (const kind of kinds) for (const orientation of ['x','y'] as const) for (let variant=0;variant<4;variant++) {
    const item=prop(kind,variant,orientation),before=structuredClone(item),sprite=art.get(item),surface=surfaces.at(-1)!;
    expect(sprite.anchor.y).toBe(pixelPropHeight(kind)+12);
    expect(surface.colors).not.toContain(C.shadow);
    for (const id of ['a','b','c']) expect(art.get({...item,id,x:512,y:800,blocking:true})).toBe(sprite);
    if (kind==='garden'||kind==='planter') {
      const visible=new Set(Array.from(surface.pixels).map(index=>surface.colors[index]));
      expect(visible.has(C.soil)).toBe(true);
      expect([C.leaf,C.leafShade,C.leafLight,C.grass].some(color=>visible.has(color))).toBe(true);
      if (variant===1) expect(visible.has(C.terra)||visible.has(C.cream)).toBe(true);
    }
    expect(item).toEqual(before); expect(art.cacheBytes).toBeLessThanOrEqual(PIXEL_PROP_CACHE_BYTES);
  }
  expect(surfaces).toHaveLength(40);
  art.clear(); expect(art.cacheBytes).toBe(0); expect(surfaces.every(surface=>surface.image.width*surface.image.height===1)).toBe(true);
});
