import { afterEach, expect, test } from 'bun:test';
import { LIVE_PROP_KINDS, type LiveWorldProp } from '../src/game/live';
import { PIXEL_PALETTE } from '../src/pixel-art';
import { PixelPropArt, PIXEL_PROP_CACHE_BYTES, pixelPropHeight } from '../src/pixel-props';

type RasterRecord = { calls:number; digest:number; colors:Set<string>; left:number;top:number;right:number;bottom:number };
let restoreDocument:(()=>void)|undefined;
afterEach(()=>{restoreDocument?.();restoreDocument=undefined;});
function canvases() {
  const records=new Map<HTMLCanvasElement,RasterRecord>();let created=0;
  const old=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(tag:string){
    if(tag!=='canvas')throw new Error('Unexpected pixel DOM allocation');created++;
    const record:RasterRecord={calls:0,digest:2166136261,colors:new Set(),left:Infinity,top:Infinity,right:0,bottom:0};
    const canvas={width:0,height:0,getContext:()=>context};
    const context={setTransform(){},fillStyle:'',imageSmoothingEnabled:true,globalAlpha:0,globalCompositeOperation:'',
      fillRect(x:number,y:number,w:number,h:number){
        if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||w<=0||h<=0||x+w>canvas.width||y+h>canvas.height)throw new Error('Noninteger/unclipped prop raster span');
        record.calls++;record.colors.add(context.fillStyle);
        record.left=Math.min(record.left,x);record.top=Math.min(record.top,y);record.right=Math.max(record.right,x+w);record.bottom=Math.max(record.bottom,y+h);
        for(const n of [x,y,w,h])record.digest=Math.imul(record.digest^n,16777619)>>>0;
        for(let i=0;i<context.fillStyle.length;i++)record.digest=Math.imul(record.digest^context.fillStyle.charCodeAt(i),16777619)>>>0;
      },
    };
    records.set(canvas as unknown as HTMLCanvasElement,record);return canvas;
  }}});
  restoreDocument=()=>{if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');};
  return {records,get created(){return created;}};
}
const dimensions:Record<LiveWorldProp['kind'],readonly[number,number]>={
  car:[3,1],van:[3,2],truck:[4,2],bus:[5,2],railcar:[6,2],shed:[3,3],kiosk:[2,2],dumpster:[2,1],
  pallet:[1,1],crate:[1,1],barrel:[.7,.7],tree:[1.8,1.8],shrub:[1,1],bench:[1.5,.6],workbench:[1.5,.6],
  lamp:[.35,.35],'power-pole':[.4,.4],bollard:[.3,.3],hydrant:[.35,.35],sign:[.5,.5],garden:[2.5,1.5],
  playground:[2,2],'market-stall':[2,1.5],logs:[2,1],fence:[2,.2],planter:[1,1],transformer:[2,2],
};
function prop(kind:LiveWorldProp['kind'],orientation:'x'|'y'='x',variant=0):LiveWorldProp {
  const [long,cross]=dimensions[kind];return{id:kind,kind,x:15,y:17,width:orientation==='x'?long:cross,height:orientation==='x'?cross:long,orientation,variant,blocking:false};
}

test('all public models have unclipped opaque pixel detail, in both directions and four variants',()=>{
  const fake=canvases(),palette=new Set<string>(Object.values(PIXEL_PALETTE));
  const cache=new PixelPropArt();
  for(const kind of LIVE_PROP_KINDS)for(const orientation of ['x','y'] as const)for(let variant=0;variant<4;variant++) {
    const item=prop(kind,orientation,variant),before=structuredClone(item),sprite=cache.get(item),record=fake.records.get(sprite.image)!;
    expect(record.calls).toBeGreaterThan(10);expect(record.calls).toBeLessThan(20_000);
    expect(record.colors.size).toBeGreaterThan(2);expect([...record.colors].every(color=>palette.has(color))).toBe(true);
    // A silhouette touching an image edge would be silently chopped by the rasterizer.
    expect(record.left).toBeGreaterThan(0);expect(record.top).toBeGreaterThan(0);
    expect(record.right).toBeLessThan(sprite.image.width);expect(record.bottom).toBeLessThan(sprite.image.height);
    expect(Number.isInteger(sprite.anchor.x)&&Number.isInteger(sprite.anchor.y)).toBe(true);
    expect(item).toEqual(before);expect(cache.cacheBytes).toBeLessThanOrEqual(PIXEL_PROP_CACHE_BYTES);
  }
});

test('manufactured props reuse art across positions and IDs, while their authored geometry stays distinct',()=>{
  const fake=canvases(),cache=new PixelPropArt(),item=prop('car');
  const first=cache.get(item),again=cache.get({...item,id:'elsewhere',x:420,y:500,blocking:true});
  expect(again.image).toBe(first.image);expect(again.anchor).toEqual(first.anchor);expect(fake.created).toBe(1);
  for(const changed of [prop('car','y'),prop('car','x',1),{...item,width:4}])expect(cache.get(changed).image).not.toBe(first.image);
  const digest=fake.records.get(first.image)!.digest;
  cache.clear();expect(cache.cacheSize).toBe(0);expect(cache.cacheBytes).toBe(0);expect(first.image.width*first.image.height).toBe(1);
  const replay=cache.get(item);expect(fake.records.get(replay.image)!.digest).toBe(digest);
});

test('groves have four stable ID-seeded canopies per authored species without per-ID allocations',()=>{
  const fake=canvases(),cache=new PixelPropArt();
  for(const kind of ['tree','shrub'] as const)for(let variant=0;variant<4;variant++) {
    const images=new Set<HTMLCanvasElement>(),digests=new Set<number>();
    for(let i=0;i<80;i++) {
      const item={...prop(kind,'x',variant),id:`grove-${i}`},sprite=cache.get(item);
      images.add(sprite.image);digests.add(fake.records.get(sprite.image)!.digest);
      expect(cache.get({...item,x:i*9,y:i*3,blocking:true}).image).toBe(sprite.image);
      expect(sprite.anchor.y).toBe(pixelPropHeight(kind)+12);
    }
    expect(images.size).toBe(4);expect(digests.size).toBe(4);
    expect(cache.cacheBytes).toBeLessThanOrEqual(PIXEL_PROP_CACHE_BYTES);
  }
  expect(fake.created).toBe(32);
});

test('all authored prop variants remain identifiable and retain their existing native envelopes',()=>{
  const fake=canvases(),cache=new PixelPropArt();
  for(const kind of LIVE_PROP_KINDS) {
    const digests=new Set<number>(),sizes=new Set<string>();
    for(let variant=0;variant<4;variant++) {
      const sprite=cache.get(prop(kind,'x',variant));digests.add(fake.records.get(sprite.image)!.digest);
      sizes.add(`${sprite.image.width}:${sprite.image.height}:${sprite.anchor.x}:${sprite.anchor.y}`);
      expect(pixelPropHeight(kind)).toBeGreaterThan(0);expect(pixelPropHeight(kind)).toBeLessThanOrEqual(246);
    }
    expect(digests.size).toBe(4);expect(sizes.size).toBe(1);
  }
});

test('LRU budget frees old canvas buffers and invalid public dimensions allocate nothing',()=>{
  const fake=canvases(),cache=new PixelPropArt(),first=cache.get({...prop('shed'),width:10,height:10});
  for(let i=0;i<14;i++)cache.get({...prop('shed','x',i%4),width:9+i/100,height:9});
  expect(cache.cacheBytes).toBeLessThanOrEqual(PIXEL_PROP_CACHE_BYTES);expect(cache.cacheSize).toBeLessThan(15);
  expect(first.image.width*first.image.height).toBe(1);
  const created=fake.created;
  for(const changed of [{width:Infinity},{width:10000},{height:0},{variant:12}])expect(()=>cache.get({...prop('car'),...changed})).toThrow(RangeError);
  expect(fake.created).toBe(created);
});
