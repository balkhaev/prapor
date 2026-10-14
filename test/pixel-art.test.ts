import { describe, expect, test } from 'bun:test';
import { PIXEL_TILE, PixelRaster, pixelIso, pixelRandom, pixelSeed } from '../src/pixel-art';

function surface(width=24,height=24) {
  const pixels=new Set<string>();let calls=0;
  const context={
    setTransform() {}, fillStyle:'', imageSmoothingEnabled:true, globalAlpha:0,globalCompositeOperation:'',
    fillRect(x:number,y:number,w:number,h:number) {
      if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||w<=0||h<=0||x+w>width||y+h>height) throw new Error('Noninteger/unclipped raster span');
      calls++;
      for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels.add(`${col},${row}`);
    },
  };
  return {raster:new PixelRaster(context as unknown as CanvasRenderingContext2D,width,height),pixels,context,get calls(){return calls;}};
}

describe('pixel raster safety and coverage',()=>{
  test('native isometric projection rounds at the same 128x64 grid',()=>{
    expect(PIXEL_TILE).toBe(128);
    expect(pixelIso(1,0)).toEqual({x:64,y:32});
    expect(pixelIso(0,1)).toEqual({x:-64,y:32});
    expect(pixelIso(.15,.25,8,{x:40,y:90})).toEqual({x:34,y:95});
  });

  test('rectangle clipping and context state never create fractional or alpha edge pixels',()=>{
    const s=surface(8,8);s.raster.rect(-3.1,2.2,6.3,2,'#123456');
    expect([...s.pixels].sort()).toEqual(['0,2','0,3','1,2','1,3','2,2','2,3']);
    expect(s.context.imageSmoothingEnabled).toBe(false);expect(s.context.globalAlpha).toBe(1);
    expect(s.context.globalCompositeOperation).toBe('source-over');
    s.raster.rect(0,0,-1,3,'red');s.raster.pixel(NaN,1,'red');expect(s.calls).toBe(1);
  });

  test('Bresenham is connected in both directions and clips extremely distant endpoints first',()=>{
    const a=surface(),b=surface();a.raster.line(1,3,21,14,'ink');b.raster.line(21,14,1,3,'ink');
    expect([...a.pixels].sort()).toEqual([...b.pixels].sort());
    expect(a.pixels.has('1,3')).toBe(true);expect(a.pixels.has('21,14')).toBe(true);
    expect(a.pixels.size).toBe(21);
    const clipped=surface(8,8);clipped.raster.line(-100_000_000,3,100_000_000,3,'ink');
    expect(clipped.pixels.size).toBe(8);expect(clipped.calls).toBe(8);
    clipped.raster.line(-100_000_000,-20,100_000_000,-20,'ink');expect(clipped.calls).toBe(8);
  });

  test('concave scanlines retain the notch, with identical coverage under reversed winding',()=>{
    const points=[{x:1,y:1},{x:7,y:1},{x:7,y:3},{x:3,y:3},{x:3,y:7},{x:1,y:7}];
    const a=surface(8,8),b=surface(8,8);a.raster.polygon(points,'ink');b.raster.polygon([...points].reverse(),'ink');
    expect([...a.pixels].sort()).toEqual([...b.pixels].sort());expect(a.pixels.size).toBe(20);
    expect(a.pixels.has('6,2')).toBe(true);expect(a.pixels.has('2,6')).toBe(true);expect(a.pixels.has('4,4')).toBe(false);
    const huge=surface(8,8);huge.raster.polygon([{x:-100_000,y:-100_000},{x:100_000,y:-100_000},{x:100_000,y:100_000},{x:-100_000,y:100_000}],'ink');
    expect(huge.pixels.size).toBe(64);expect(huge.calls).toBe(8);
  });

  test('integer ellipses are symmetric and invalid geometry is bounded',()=>{
    const s=surface();s.raster.ellipse(12,12,7,4,'ink');
    for(const key of s.pixels){const [x,y]=key.split(',').map(Number);expect(s.pixels.has(`${24-x!},${24-y!}`)).toBe(true);}
    expect(s.pixels.has('12,8')).toBe(true);expect(s.pixels.has('5,12')).toBe(true);expect(s.pixels.has('5,8')).toBe(false);
    const count=s.calls;s.raster.ellipse(10,10,-4,5,'ink');s.raster.line(Infinity,0,0,0,'ink');
    s.raster.polygon([{x:0,y:0},{x:1,y:NaN},{x:3,y:4}],'ink');expect(s.calls).toBe(count);
    expect(()=>surface(4097,8)).toThrow(RangeError);expect(()=>surface(8,0)).toThrow(RangeError);
  });
});

test('visual seeds replay exactly and supply independent bounded sequences',()=>{
  const a=pixelRandom(pixelSeed('car:x:2')),b=pixelRandom(pixelSeed('car:x:2')),c=pixelRandom(pixelSeed('car:y:2'));
  const values=Array.from({length:64},()=>a());
  expect(values).toEqual(Array.from({length:64},()=>b()));
  expect(values).not.toEqual(Array.from({length:64},()=>c()));
  expect(values.every(value=>value>=0&&value<1)).toBe(true);
});
