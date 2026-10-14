import { describe, expect, test } from 'bun:test';
import { PixelRaster } from '../src/pixel-art';
import { PIXEL_FACINGS, pixelBearing } from '../src/pixel-animation';
import { PIXEL_WEAPON_IDS, PIXEL_WEAPON_PALETTE, PIXEL_WEAPON_PROFILES, paintPixelWeapon, pixelWeaponAnchors } from '../src/pixel-weapons';

function surface() {
  const pixels=new Map<string,string>(); let calls=0;
  const context={setTransform(){},fillStyle:'',fillRect(x:number,y:number,w:number,h:number){
    if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||x+w>192||y+h>192)throw new Error('Invalid weapon pixels');
    calls++;
    for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels.set(`${col},${row}`,context.fillStyle);
  }};
  return{raster:new PixelRaster(context as unknown as CanvasRenderingContext2D,192,192),pixels,get calls(){return calls;}};
}

describe('native pixel weapon models',()=>{
  test('every model retains a visible silhouette and correctly anchored muzzle in eight bearings',()=>{
    const palette=new Set<string>(Object.values(PIXEL_WEAPON_PALETTE));
    for(const facing of PIXEL_FACINGS) {
      const bearing=pixelBearing(facing),grip={x:Math.round(96+bearing.x*20),y:Math.round(176+bearing.y*20-85)};
      const silhouettes=new Set<string>();
      for(const id of PIXEL_WEAPON_IDS)for(const kick of [0,2,4]) {
        const original={...grip},s=surface(),anchors=paintPixelWeapon(s.raster,id,grip,facing,kick);
        expect(anchors).toEqual(pixelWeaponAnchors(id,grip,facing,kick));expect(grip).toEqual(original);
        expect(s.pixels.size).toBeGreaterThan(25);expect(s.calls).toBeLessThan(3000);
        expect(s.pixels.get(`${anchors.muzzle.x},${anchors.muzzle.y}`)).toBe(PIXEL_WEAPON_PALETTE.outline);
        for(const point of Object.values(anchors)) {
          expect(Number.isInteger(point.x)&&Number.isInteger(point.y)).toBe(true);
          expect(point.x).toBeGreaterThan(2);expect(point.x).toBeLessThan(190);expect(point.y).toBeGreaterThan(2);expect(point.y).toBeLessThan(174);
        }
        // Native actor frames have breathing room; no scanline clipping may hide a barrel or magazine.
        for(const [key,color] of s.pixels) {
          const [x,y]=key.split(',').map(Number);
          expect(x!>2&&x!<190&&y!>2&&y!<174).toBe(true);expect(palette.has(color)).toBe(true);
        }
        if(kick===0)silhouettes.add(JSON.stringify([...s.pixels].sort(([a],[b])=>a.localeCompare(b))));
      }
      expect(silhouettes.size).toBe(PIXEL_WEAPON_IDS.length);
    }
  });

  test('recoil pivots at the supplied trigger grip and raises the muzzle without a positional drift',()=>{
    const grip={x:96.3,y:99.7},before={...grip};
    for(const facing of PIXEL_FACINGS)for(const id of PIXEL_WEAPON_IDS) {
      const neutral=pixelWeaponAnchors(id,grip,facing),recoil=pixelWeaponAnchors(id,grip,facing,4);
      expect(recoil.muzzle.x).toBe(neutral.muzzle.x);expect(recoil.muzzle.y).toBe(neutral.muzzle.y-4);
      expect(recoil.forehand.x).toBe(neutral.forehand.x);
      expect(recoil.forehand.y).toBeLessThanOrEqual(neutral.forehand.y);
      expect(recoil.forehand.y).toBeGreaterThanOrEqual(neutral.forehand.y-4);
      expect(pixelWeaponAnchors(id,grip,facing,Infinity)).toEqual(neutral);
      expect(pixelWeaponAnchors(id,grip,facing,-10)).toEqual(neutral);
      expect(pixelWeaponAnchors(id,grip,facing,100)).toEqual(recoil);
    }
    expect(grip).toEqual(before);
  });

  test('model dimensions and appropriate public features are explicit, with a neutral unknown rifle',()=>{
    expect(PIXEL_WEAPON_PROFILES.pm.twoHanded).toBe(false);
    expect(PIXEL_WEAPON_PROFILES.pm.length).toBeLessThan(25);
    expect(PIXEL_WEAPON_PROFILES.pp91.length).toBeLessThan(PIXEL_WEAPON_PROFILES.akm.length);
    expect(PIXEL_WEAPON_PROFILES.mosin.length).toBeGreaterThan(PIXEL_WEAPON_PROFILES.akm.length);
    expect(PIXEL_WEAPON_IDS.filter(id=>PIXEL_WEAPON_PROFILES[id].scoped)).toEqual(['svd']);
    for(const id of PIXEL_WEAPON_IDS) {
      const profile=PIXEL_WEAPON_PROFILES[id];expect(Number(profile.length)).toBe(profile.forward+profile.rear);
      expect(profile.forward).toBeLessThanOrEqual(53);expect(profile.support).toBeLessThan(profile.forward);
      expect(profile.twoHanded).toBe(id!=='pm');
    }
    expect(PIXEL_WEAPON_PROFILES.unknown.scoped).toBe(false);
  });

  test('the same weapon pose is deterministic; no time, identity or inventory affects its pixels',()=>{
    for(const id of PIXEL_WEAPON_IDS) {
      const a=surface(),b=surface(),grip={x:96,y:100};
      paintPixelWeapon(a.raster,id,grip,'se',2);paintPixelWeapon(b.raster,id,grip,'se',2);
      expect([...a.pixels]).toEqual([...b.pixels]);
    }
  });
});
