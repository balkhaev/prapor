import { describe, expect, test } from 'bun:test';
import { PixelRaster } from '../src/pixel-art';
import { PIXEL_FACINGS } from '../src/pixel-animation';
import { PIXEL_WEAPON_IDS, PIXEL_WEAPON_PALETTE, PIXEL_WEAPON_MODEL_CACHE_SIZE, PIXEL_WEAPON_IMAGE_CACHE_BYTES, paintPixelWeapon, pixelWeaponAnchors, pixelWeaponProfile, pixelWeaponSignature, pixelWeaponId, clearPixelWeaponCache, pixelWeaponCacheStats, type PixelWeaponInput } from '../src/pixel-weapons';
import { WEAPONS } from '../src/game/data';
import { MODULE_BY_ID, MODULE_MODELS, RECEIVER_INFO } from '../src/game/modules';
import { createWeaponShowcaseBuild } from '../src/weapon-showcase';
import { weaponActorArt, weaponBuildArt, weaponBuildGeometry } from '../src/armory-art';
import { sampleWeaponContours, weaponPathContours } from '../src/pixel-weapon-geometry';

function surface(input:PixelWeaponInput='akm',facing:typeof PIXEL_FACINGS[number]='e',kick=0){
  const pixels=new Map<string,string>();let calls=0;
  const context={setTransform(){},fillStyle:'',fillRect(x:number,y:number,w:number,h:number){
    if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||x+w>256||y+h>240||!/^#[\da-f]{6}$/i.test(context.fillStyle))throw new Error('Invalid native weapon pixel');
    calls++;for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)pixels.set(`${col},${row}`,context.fillStyle);
  }};
  const anchors=paintPixelWeapon(new PixelRaster(context as unknown as CanvasRenderingContext2D,256,240),input,{x:128,y:120},facing,kick);
  return{pixels,anchors,calls,signature:[...pixels].sort(([a],[b])=>a.localeCompare(b)).map(([point,color])=>`${point}:${color}`).join('|')};
}
function install(weapon:ReturnType<typeof createWeaponShowcaseBuild>,id:string){const model=MODULE_BY_ID[id]!;weapon.modules[model.slot]={id,modelId:id,durability:100,foundAt:0};}

describe('complete native arsenal and real installed assemblies',()=>{
  test('all39 catalog weapons and their field assemblies render in eight bearings without clipping',()=>{
    expect(WEAPONS).toHaveLength(39);expect(PIXEL_WEAPON_IDS).toHaveLength(40);
    const silhouettes=new Set<string>();
    for(const definition of WEAPONS)for(const preset of ['factory','field'] as const){
      const weapon=createWeaponShowcaseBuild(definition.id,preset),before=structuredClone(weapon),profile=pixelWeaponProfile(weapon);
      expect(profile.hasMuzzle).toBe(true);expect(profile.hasEjection).toBe(true);expect(profile.twoHanded).toBe(definition.category!=='pistol');
      for(const facing of PIXEL_FACINGS){
        const s=surface(weapon,facing,2);expect(s.pixels.size,`${definition.id}/${preset}/${facing}`).toBeGreaterThan(35);
        expect(s.anchors).toEqual(pixelWeaponAnchors(weapon,{x:128,y:120},facing,2));
        expect(s.pixels.get(`${s.anchors.muzzle.x},${s.anchors.muzzle.y}`)).toBe(PIXEL_WEAPON_PALETTE.outline);
        expect([...s.pixels.keys()].every(point=>{const[x,y]=point.split(',').map(Number);return x!>3&&x!<252&&y!>3&&y!<236;})).toBe(true);
        if(facing==='e'&&preset==='factory')silhouettes.add(s.signature);
      }
      expect(weapon).toEqual(before);expect(surface(definition.id).signature).toBe(surface(createWeaponShowcaseBuild(definition.id)).signature);
    }
    expect(silhouettes.size).toBe(39);
    for(const unknown of [undefined,'private-model','toString','__proto__'])expect(pixelWeaponId(unknown)).toBe('unknown');
    expect(pixelWeaponProfile('unknown').scoped).toBe(false);
  });

  test('north and south have physical width and independent end faces, rather than a flat collapsed profile',()=>{
    for(const id of ['pm','p90','akm','svd','awm'])for(const facing of ['n','s'] as const){
      const s=surface(id,facing),xs=[...s.pixels.keys()].map(point=>Number(point.split(',')[0]));
      expect(Math.max(...xs)-Math.min(...xs)).toBeGreaterThanOrEqual(5);
      expect(new Set(s.pixels.values()).size).toBeGreaterThanOrEqual(2);
      expect(s.signature).not.toBe(surface(id,facing==='n'?'s':'n').signature);
    }
  });

  test('barrels and suppressors grow from the same calibrated trigger and shared canonical muzzle',()=>{
    for(const id of ['pm','ak74','m4a1','p90','mp7','aug','m870','awm','vss']){
      const weapon=createWeaponShowcaseBuild(id),plain=pixelWeaponProfile(weapon),before=weaponBuildGeometry(weapon),art=weaponActorArt(weapon),info=RECEIVER_INFO[id]!;
      install(weapon,`barrel-${info.platform}-${info.caliber}-long`);install(weapon,`muzzle-${info.caliber}-suppressor`);
      const after=weaponBuildGeometry(weapon),longer=pixelWeaponProfile(weapon);
      expect(after.referenceWidth).toBe(before.referenceWidth);expect(weaponActorArt(weapon).referenceWidth).toBe(art.referenceWidth);
      expect(longer.forward, id).toBeGreaterThan(plain.forward);
      expect(longer.forward/plain.forward).toBeCloseTo((after.muzzle.x-after.grip.x)/(before.muzzle.x-before.grip.x),6);
      for(const facing of PIXEL_FACINGS){
        const neutral=pixelWeaponAnchors(weapon,{x:128,y:120},facing),recoil=pixelWeaponAnchors(weapon,{x:128,y:120},facing,4);
        expect(recoil.muzzle.x).toBe(neutral.muzzle.x);expect(recoil.muzzle.y).toBe(neutral.muzzle.y-4);
        expect(recoil.forehand.y).toBeLessThanOrEqual(neutral.forehand.y);expect(recoil.forehand.y).toBeGreaterThanOrEqual(neutral.forehand.y-4);
        expect(pixelWeaponAnchors(weapon,{x:128,y:120},facing,Infinity)).toEqual(neutral);
      }
    }
  });

  test('missing modules disappear and an empty explicit assembly never grows factory ghost parts',()=>{
    for(const definition of WEAPONS){
      const weapon=createWeaponShowcaseBuild(definition.id,'field'),full=surface(weapon).signature;
      for(const slot of ['receiver','barrel','stock','magazine','handguard','optic','muzzle'] as const){
        if(!weapon.modules[slot])continue;const changed=structuredClone(weapon);delete changed.modules[slot];
        expect(pixelWeaponSignature(changed)).not.toBe(pixelWeaponSignature(weapon));
        expect(weaponBuildGeometry(changed).parts.some(part=>part.slot===slot)).toBe(false);
        // A pistol magazine can be entirely inside its grip, and an integral
        // barrel can be covered by its receiver. External furniture must change.
        if(['stock','handguard','optic','muzzle'].includes(slot))expect(surface(changed).signature===full,`${definition.id}/${slot}`).toBe(false);
        if(slot==='barrel')expect(pixelWeaponProfile(changed).hasMuzzle).toBe(false);
        if(slot==='receiver')expect(pixelWeaponProfile(changed).hasEjection).toBe(false);
      }
      weapon.modules={};expect(surface(weapon).pixels.size).toBe(0);expect(pixelWeaponProfile(weapon).hasMuzzle).toBe(false);expect(pixelWeaponProfile(weapon).hasEjection).toBe(false);
    }
  });

  test('shared native assembly retains installed donor identities, exact offsets and bench geometry',()=>{
    for(const id of ['vss','asval']){
      const weapon=createWeaponShowcaseBuild(id);install(weapon,`factory-${id==='vss'?'asval':'vss'}-stock`);
      const resolved=weaponBuildGeometry(weapon),stock=resolved.parts.find(part=>part.slot==='stock')!;
      expect(stock.modelId).toBe(weapon.modules.stock!.modelId);
      expect(weaponBuildArt(weapon)).toContain(stock.shape.outline);expect(weaponActorArt(weapon).svg).toContain(stock.shape.outline);
      expect(surface(weapon).signature).not.toBe(surface(id).signature);
    }
    for(const id of ['p90','aug','ash12','fal']){
      const weapon=createWeaponShowcaseBuild(id,'field'),resolved=weaponBuildGeometry(weapon);
      for(const part of resolved.parts)expect(weaponActorArt(weapon).svg).toContain(part.shape.outline);
      expect(surface(weapon).signature).not.toBe(surface(id).signature);
    }
  });

  test('all module styles produce bounded canonical native paths without DOM or async textures',()=>{
    for(const model of MODULE_MODELS){
      const definition=WEAPONS.find(gun=>{const info=RECEIVER_INFO[gun.id]!;return(model.platforms.includes('*')||model.platforms.includes(info.platform))&&(model.calibers.includes('*')||model.calibers.includes(info.caliber));});
      if(!definition)continue;const weapon=createWeaponShowcaseBuild(definition.id,'field');install(weapon,model.id);
      const geometry=weaponBuildGeometry(weapon),part=geometry.parts.find(part=>part.slot===model.slot)!;
      expect(part.modelId).toBe(model.id);expect(weaponPathContours(part.shape.outline).length,model.id).toBeGreaterThan(0);
      const p=pixelWeaponProfile(weapon);expect([p.length,p.forward,p.rear,p.boreHeight,p.support].every(Number.isFinite)).toBe(true);
    }
  });

  test('full signatures, wear buckets and bounded caches remain deterministic across eviction',()=>{
    const first=createWeaponShowcaseBuild('m4a1','field'),same=structuredClone(first);same.id='another-inventory-id';same.foundAt=55;
    for(const part of Object.values(same.modules)){part.id+='other';part.foundAt=99;part.durability=99;}
    first.durability=81;same.durability=99;
    for(const part of Object.values(first.modules))part.durability=81;
    expect(pixelWeaponSignature(first)).toBe(pixelWeaponSignature(same));
    clearPixelWeaponCache();const original=surface(first).signature;clearPixelWeaponCache();expect(surface(same).signature).toBe(original);
    const pristine=createWeaponShowcaseBuild('m4a1','field');expect(surface(pristine).signature).not.toBe(original);
    for(const definition of WEAPONS)for(const preset of ['factory','field'] as const)for(const condition of [20,40,60]){
      const weapon=createWeaponShowcaseBuild(definition.id,preset);weapon.durability=condition;surface(weapon,'se');
    }
    surface('unknown');expect(pixelWeaponCacheStats().models).toBeLessThanOrEqual(PIXEL_WEAPON_MODEL_CACHE_SIZE);
    expect(pixelWeaponCacheStats().imageBytes).toBeLessThanOrEqual(PIXEL_WEAPON_IMAGE_CACHE_BYTES);expect(surface(first).signature).toBe(original);
  });

  test('native path curves, relative moves and nested holes preserve real open space',()=>{
    const contours=weaponPathContours('M0 0h20v20H0zM5 5h10v10H5z'),points=new Set<string>();
    sampleWeaponContours(contours,'evenodd',(x,y)=>points.add(`${x},${y}`));expect(points.has('2,2')).toBe(true);expect(points.has('9,9')).toBe(false);
    const curved=weaponPathContours('m0 0q10 0 10 10t10 10l0-20z');expect(curved[0]!.at(-1)).toEqual({x:0,y:0});
    expect(weaponPathContours('M0 0A1 1 0 0 0 1 1')).toEqual([]);
  });
});
