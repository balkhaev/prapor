import { LIVE_PROP_KINDS, type LivePoint, type LiveWorldProp } from './game/live';
import { PIXEL_PALETTE as C, PIXEL_TILE, PixelRaster, pixelIso, pixelRandom, pixelSeed, type PixelColor } from './pixel-art';
import { TREE_ART_HEIGHT, TREE_ART_MARGIN, treeCrownProfile } from './pixel-plant-form';

export { PIXEL_TILE } from './pixel-art';
export const PIXEL_PROP_CACHE_BYTES = 24 * 1024 * 1024;
type Sprite = { image: HTMLCanvasElement; anchor: LivePoint };
type Entry = Sprite & { bytes: number };
type Colors = readonly [PixelColor, PixelColor, PixelColor];
const HEIGHT: Record<LiveWorldProp['kind'], number> = {
  car: 82, van: 108, truck: 132, bus: 128, railcar: 144,
  tree: TREE_ART_HEIGHT, shrub: 62, lamp: 236, 'power-pole': 246, sign: 110,
  shed: 156, kiosk: 132, 'bus-stop': 160, 'market-stall': 118, transformer: 126,
  fence: 86, dumpster: 66, pallet: 30, crate: 56, barrel: 66,
  bench: 62, planter: 68, logs: 48, playground: 142, garden: 36,
  workbench: 56, hydrant: 64, bollard: 54,
};
const METAL: Colors = [C.steel, C.steelShade, C.panelShade];
const WOOD: Colors = [C.woodLight, C.woodShade, C.wood];
const CONCRETE: Colors = [C.concrete, C.concreteShade, C.panelShade];
export function pixelPropHeight(kind: LiveWorldProp['kind']): number { return HEIGHT[kind]; }

/** Prop-local coordinates. u follows the authored long axis, v its cross axis. */
class Model {
  readonly random: () => number;
  constructor(readonly raster: PixelRaster, readonly prop: LiveWorldProp, readonly origin: LivePoint, seed: string) {
    this.random = pixelRandom(pixelSeed(seed));
  }
  point(u: number, v: number, z = 0): LivePoint {
    const { width: w, height: h, orientation } = this.prop;
    return pixelIso(orientation === 'x' ? u * w : v * w, orientation === 'x' ? v * h : u * h, z, this.origin);
  }
  poly(vertices: readonly (readonly [number, number, number])[], color: PixelColor): void {
    this.raster.polygon(vertices.map(([u, v, z]) => this.point(u, v, z)), color);
  }
  line(a: readonly [number, number, number], b: readonly [number, number, number], color: PixelColor, width = 1): void {
    const p = this.point(...a), q = this.point(...b); this.raster.line(p.x, p.y, q.x, q.y, color, width);
  }
  slab(u0: number, v0: number, u1: number, v1: number, z: number, color: PixelColor): void {
    this.poly([[u0,v0,z],[u1,v0,z],[u1,v1,z],[u0,v1,z]], color);
  }
  box(u0: number, v0: number, u1: number, v1: number, z: number, height: number, colors: Colors, edge = true): void {
    const a = this.point(u0,v0,z), b = this.point(u1,v0,z), c = this.point(u1,v1,z), d = this.point(u0,v1,z);
    const points = [a,b,c,d].sort((p,q) => p.x - q.x);
    const left = points[0]!, right = points[3]!;
    const front = [a,b,c,d].reduce((p,q) => p.y > q.y ? p : q);
    const top = (p: LivePoint): LivePoint => ({ x:p.x, y:p.y-height });
    this.raster.polygon([left,front,top(front),top(left)], colors[1]);
    this.raster.polygon([front,right,top(right),top(front)], colors[2]);
    this.raster.polygon([top(a),top(b),top(c),top(d)], colors[0]);
    if (edge) {
      for (const [p,q] of [[left,front],[front,right],[top(a),top(b)],[top(b),top(c)],[top(c),top(d)],[top(d),top(a)]]) {
        this.raster.line(p!.x,p!.y,q!.x,q!.y,C.ink);
      }
      for (const p of [left,front,right]) this.raster.line(p.x,p.y,p.x,p.y-height,C.ink);
    }
  }
  wear(u0: number, v0: number, u1: number, v1: number, z: number, count: number, color: PixelColor = C.rust): void {
    for (let i=0; i<count; i++) {
      const p=this.point(u0+(u1-u0)*this.random(),v0+(v1-v0)*this.random(),z);
      this.raster.rect(p.x,p.y,2+Math.floor(this.random()*4),1+Math.floor(this.random()*2),color);
    }
  }
  post(u: number,v: number,z: number,height: number,color: PixelColor,width=4): void {
    this.line([u,v,z],[u,v,z+height],C.ink,width+2);
    this.line([u,v,z],[u,v,z+height],color,width);
    const p=this.point(u,v,z+height); this.raster.rect(p.x-1,p.y,1,height,color===C.wood ? C.woodLight:C.steelLight);
  }
  wheel(u: number,v: number,z=17): void {
    const p=this.point(u,v,z);
    this.raster.ellipse(p.x,p.y,11,14,C.ink); this.raster.ellipse(p.x,p.y,8,11,C.rubber);
    this.raster.line(p.x-7,p.y-7,p.x-8,p.y+5,C.black,2);
    for (const side of [-1,1]) for (const y of [-7,-2,3,8]) this.raster.line(p.x+side*7,p.y+y,p.x+side*9,p.y+y+1,C.steelShade);
    this.raster.ellipse(p.x,p.y,5,7,C.steelShade); this.raster.ellipse(p.x-1,p.y-1,3,4,C.panelShade);
    for(const [x,y] of [[-2,-3],[2,-2],[2,3],[-2,3]]) this.raster.pixel(p.x+x!,p.y+y!,C.steelLight);
    this.raster.ellipse(p.x,p.y,1,2,C.ink); this.raster.pixel(p.x-1,p.y-5,C.white);
  }
  bolt(u:number,v:number,z:number):void {
    const p=this.point(u,v,z);this.raster.rect(p.x-1,p.y-1,3,3,C.ink);this.raster.pixel(p.x-1,p.y-1,C.steelLight);
  }
  grain(u0:number,v:number,u1:number,z:number,count=5):void {
    for(let i=0;i<count;i++) {
      const u=u0+(u1-u0)*this.random(), length=.03+this.random()*.11;
      this.line([u,v,z],[Math.min(u1,u+length),v,z],i%3===0?C.woodLight:C.woodShade);
    }
  }
  glazing(u0:number,u1:number,v:number,bottom:number,top:number):void {
    this.poly([[u0,v,bottom],[u1,v,bottom],[u1,v,top],[u0,v,top]],C.glass);
    const width=u1-u0, mid=(u0+u1)/2;
    // Seats, headrests and a dark sill remain behind a restrained reflection.
    this.poly([[u0+width*.16,v,bottom+2],[u0+width*.45,v,bottom+2],[u0+width*.45,v,bottom+(top-bottom)*.48],[u0+width*.2,v,bottom+(top-bottom)*.48]],C.steelShade);
    this.line([mid,v,bottom+4],[mid,v,top-9],C.ink,3);
    this.line([mid-width*.13,v,top-10],[mid+width*.13,v,top-10],C.rubber,3);
    this.line([u0+width*.08,v,top-2],[u1-width*.08,v,top-2],C.glassLight);
    this.line([u0+width*.15,v,bottom+5],[u0+width*.55,v,top-5],C.glassLight);
    this.line([u0,v,bottom],[u1,v,bottom],C.ink,2);
  }
}

/** Small clumps belong to the authored footprint; no extra world objects or colliders. */
function groundGrowth(m:Model,count:number):void {
  for(let i=0;i<count;i++) {
    const u=.1+m.random()*.8,v=.1+m.random()*.8,p=m.point(u,v,1), height=3+Math.floor(m.random()*7);
    const color=i%3===0?C.grass:C.leafShade;
    m.raster.line(p.x,p.y,p.x-3,p.y-height+2,color);
    m.raster.line(p.x,p.y,p.x+1,p.y-height,color);
    m.raster.line(p.x,p.y,p.x+4,p.y-height+3,C.leaf);
    if(i%4===0)m.raster.pixel(p.x+1,p.y-height,C.woodLight);
  }
}

function vehicle(m: Model): void {
  const { kind, variant }=m.prop;
  const paints=[C.green,C.blue,C.cream,C.red] as const;
  const paint=paints[variant]!, shade=variant===2?C.plasterShade:variant===3?C.rustShade:C.steelShade;
  const bus=kind==='bus', truck=kind==='truck', van=kind==='van', rail=kind==='railcar';
  const bodyTop=bus?76:van?59:truck?43:rail?94:37;
  m.line([.12,.13,12],[.88,.13,12],C.ink,5);m.line([.12,.87,12],[.88,.87,12],C.ink,5);
  // Rear wheels precede the body; near wheels remain legible in either rotation.
  for (const u of rail?[.18,.32,.72,.86]:[.22,.77]) m.wheel(u,.1,15);
  m.box(.035,.12,.965,.88,15,bodyTop-15,[paint,shade,C.panelShade]);
  if (truck) {
    m.box(.05,.16,.67,.84,bodyTop,36,[C.wood,C.woodShade,C.terraShade]);
    for (const u of [.18,.32,.46,.60]) {
      m.line([u,.84,43],[u,.84,77],C.steelShade,2);
      m.line([u,.16,79],[u,.84,79],C.woodLight);
    }
    for (const z of [51,62,73]) m.line([.05,.84,z],[.67,.84,z],C.woodLight);
    m.box(.71,.17,.94,.83,bodyTop,37,[paint,shade,C.panelShade]);
    m.poly([[.94,.21,52],[.94,.79,52],[.88,.79,77],[.88,.21,77]],C.glass);
    m.glazing(.73,.88,.84,52,74);
    m.line([.945,.28,56],[.906,.39,73],C.glassLight);
    m.line([.74,.84,48],[.9,.84,48],C.steelLight);
    m.post(.9,.98,53,14,C.steelShade,2);
    m.line([.88,.84,46],[.88,.84,22],shade);m.bolt(.77,.855,49);
    m.poly([[.92,.98,58],[.97,.98,58],[.97,.98,69],[.92,.98,69]],C.ink);
    m.line([.92,.985,67],[.96,.985,67],C.glassLight);
    for(const u of [.12,.33,.55]) {m.bolt(u,.845,49);m.bolt(u,.845,73);}
    m.line([.12,.18,81],[.59,.18,81],C.woodShade,2);m.grain(.09,.85,.64,57,9);
    m.box(.23,.24,.52,.63,79,9,[C.woodLight,C.woodShade,C.wood]);
    for(const v of [.32,.48,.6])m.line([.24,v,89],[.5,v,89],C.woodShade);
  } else if (rail) {
    m.box(.07,.16,.93,.84,bodyTop,13,[C.terra,C.terraShade,C.rustShade]);
    for (let i=1;i<11;i++) {
      const u=.07+i*.078;
      m.line([u,.88,23],[u,.88,91],C.rustShade,2);
      m.line([u,.16,109],[u,.84,109],C.woodShade);
    }
    m.poly([[.44,.89,26],[.68,.89,26],[.68,.89,85],[.44,.89,85]],C.terraShade);
    m.line([.44,.89,26],[.44,.89,85],C.steelLight,2);
    m.line([.54,.89,32],[.54,.89,80],C.rust,2);
    m.line([.55,.895,45],[.59,.895,45],C.ink,2);
    m.line([.42,.9,23],[.7,.9,23],C.steelLight,3);
    for(const u of [.12,.87])for(const z of [31,51,73])m.bolt(u,.89,z);
    for(const z of [23,34,45,56,67,78])m.line([.91,.89,z],[.96,.89,z],C.steelLight,2);
    m.line([.91,.89,20],[.91,.89,88],C.steelShade,3);
    m.poly([[.14,.895,53],[.28,.895,53],[.28,.895,65],[.14,.895,65]],C.plasterShade);
    for(let i=0;i<5;i++)m.line([.16+i*.023,.898,56],[.16+i*.023,.898,62],C.ink);
    for(const u of [.25,.68])m.box(u,.3,u+.13,.7,107,4,[C.terra,C.rustShade,C.terraShade]);
    m.line([.95,.38,16],[1,.38,16],C.ink,5);
    m.line([.01,.38,16],[.05,.38,16],C.ink,5);
  } else if (bus || van) {
    const roof=bus?102:84;
    m.box(.08,.18,.9,.82,bodyTop,roof-bodyTop,[paint,shade,C.panelShade]);
    if (bus) {
      for (let i=0;i<7;i++) {
        const u=.105+i*.105;
        m.glazing(u,u+.084,.885,53,86);
        m.line([u,.885,51],[u+.084,.885,51],C.steelLight);
        if(i===2&&variant===3) {
          m.line([u,.889,59],[u+.083,.889,77],C.woodShade,3);m.line([u,.889,77],[u+.083,.889,59],C.wood,3);
        } else if(i===4&&variant===2) {
          m.line([u+.05,.89,76],[u+.03,.89,66],C.steelLight);m.line([u+.03,.89,66],[u+.07,.89,62],C.steelLight);
        }
      }
      m.poly([[.80,.89,20],[.93,.89,20],[.93,.89,88],[.80,.89,88]],C.ink);
      m.poly([[.81,.89,52],[.855,.89,52],[.855,.89,84],[.81,.89,84]],C.glass);
      m.poly([[.87,.89,52],[.917,.89,52],[.917,.89,84],[.87,.89,84]],C.glass);
      m.line([.862,.9,25],[.862,.9,86],C.steelLight);
      for(const z of [25,31,37])m.line([.815,.901,z],[.92,.901,z],C.steelShade,2);
      m.line([.05,.895,43],[.77,.895,43],C.cream,2);
      for(const u of [.14,.37,.6])m.bolt(u,.896,34);
      m.line([.1,.25,104],[.79,.25,104],C.steelLight);
      for(const u of [.26,.52,.72])m.line([u,.3,104],[u,.69,104],shade,2);
    } else {
      m.glazing(.67,.87,.89,50,78);
      m.line([.65,.895,23],[.65,.895,80],C.steelShade);
      m.line([.72,.895,44],[.79,.895,44],C.ink,2);
      m.line([.17,.885,28],[.17,.885,72],shade);
      m.line([.45,.885,28],[.45,.885,72],shade);
      m.wear(.12,.2,.57,.8,86,14,C.plasterShade);
      m.line([.12,.895,45],[.56,.895,45],C.plasterShade,3);
      m.poly([[.28,.898,48],[.43,.898,48],[.43,.898,58],[.28,.898,58]],variant===1?C.plaster:C.panelShade);
      for(let i=0;i<4;i++)m.line([.3+i*.027,.9,50],[.3+i*.027,.9,56],shade);
      for(const u of [.17,.45]) {m.bolt(u,.897,29);m.bolt(u,.897,68);}
      m.line([.13,.2,86],[.58,.2,86],C.steelLight);
    }
    const windTop=bus?90:80;
    m.poly([[.96,.2,52],[.96,.8,52],[.90,.8,windTop],[.90,.2,windTop]],C.glass);
    m.line([.947,.22,58],[.923,.48,69],C.ink);
    m.line([.947,.78,58],[.923,.52,69],C.ink);
    m.line([.946,.24,63],[.917,.4,windTop-5],C.glassLight);
    m.line([.96,.49,52],[.9,.49,windTop-1],C.ink,2);
    m.box(.38,.36,.53,.64,roof,4,METAL);
  } else {
    // Three volumes give an unmistakable bonnet, cabin and boot silhouette.
    m.poly([[.23,.19,37],[.71,.19,37],[.64,.27,68],[.34,.27,68]],shade);
    m.poly([[.23,.81,37],[.71,.81,37],[.64,.73,68],[.34,.73,68]],paint);
    m.poly([[.23,.19,37],[.23,.81,37],[.34,.73,68],[.34,.27,68]],C.glass);
    m.poly([[.71,.19,37],[.71,.81,37],[.64,.73,68],[.64,.27,68]],C.glass);
    m.slab(.34,.27,.64,.73,68,paint);
    m.poly([[.29,.815,42],[.49,.78,43],[.49,.735,63],[.355,.74,63]],C.glass);
    m.poly([[.52,.78,43],[.66,.815,42],[.63,.74,63],[.52,.735,63]],C.glass);
    m.line([.51,.82,18],[.51,.76,64],shade);
    m.line([.37,.89,30],[.43,.89,30],C.ink,2);
    m.line([.58,.89,30],[.63,.89,30],C.ink,2);
    for(const u of [.39,.58]) {
      const head=m.point(u,.77,57);m.raster.rect(head.x-2,head.y-2,5,4,C.rubber);
      m.line([u-.04,.795,45],[u+.04,.795,51],C.steelShade,3);
    }
    m.line([.3,.808,46],[.44,.752,61],C.glassLight);
    m.line([.55,.77,49],[.61,.75,60],C.glassLight);
    m.line([.72,.25,42],[.66,.41,61],C.glassLight);
    m.line([.71,.36,39],[.68,.52,47],C.ink);
    m.line([.71,.68,39],[.68,.57,47],C.ink);
    m.line([.28,.83,21],[.68,.83,21],shade);
    m.line([.34,.28,69],[.61,.28,69],C.steelLight);
    m.line([.77,.28,39],[.91,.28,39],paint,3);
    for(const v of [.4,.49,.58])m.line([.78,v,39],[.85,v,39],shade);
    const mirror=m.point(.68,.94,45);m.raster.line(mirror.x-4,mirror.y+1,mirror.x+2,mirror.y-2,C.ink,3);m.raster.rect(mirror.x-3,mirror.y-3,5,3,C.steelLight);
    m.line([.76,.19,39],[.94,.19,39],C.steelLight);
    m.line([.08,.81,39],[.20,.81,39],shade);
  }
  if (!rail) {
    m.line([.97,.2,25],[.97,.8,25],C.ink,5);
    m.line([.025,.2,23],[.025,.8,23],C.steelShade,4);
    m.line([.975,.23,34],[.975,.36,34],C.yellow,4);
    m.line([.975,.64,34],[.975,.77,34],C.yellow,4);
    for(const v of [.25,.66]) {
      m.line([.977,v,35],[.977,v+.08,35],C.cream,2);
      m.line([.979,v+.015,32],[.979,v+.07,32],C.steelLight);
    }
    for(let i=0;i<5;i++)m.line([.979,.4+i*.045,28],[.979,.4+i*.045,34],C.ink);
    m.line([.02,.23,32],[.02,.34,32],C.red,3);
    m.line([.02,.66,32],[.02,.77,32],C.red,3);
    m.line([.975,.43,24],[.975,.57,24],C.cream,2);
    m.line([.98,.45,24],[.98,.48,24],C.ink);m.line([.98,.52,24],[.98,.55,24],C.ink);
    m.line([.1,.9,17],[.88,.9,17],C.rustShade,2);
    for(let i=0;i<7;i++) {
      const u=.1+m.random()*.78,z=20+m.random()*14;
      m.line([u,.891,z],[u+.018,.891,z-4],i%2?C.rust:C.steelLight);
    }
  }
  for (const u of rail?[.18,.32,.72,.86]:[.22,.77]) m.wheel(u,.9,15);
  m.wear(.07,.22,.91,.78,bodyTop+1,rail?19:10,C.rust);
}

function foliage(m: Model): void {
  const tree=m.prop.kind==='tree',variant=m.prop.variant,birch=tree&&variant===2;
  groundGrowth(m,tree?9:12);
  const center=m.point(.5,.5),span=Math.max(12,(m.prop.width+m.prop.height)*30);
  // A mature urban tree has a broad crown above a legible bare trunk. The
  // immutable footprint and trunk anchor stay exactly where the server put it.
  const profile=treeCrownProfile(variant),lean=tree?(m.random()-.5)*span*.17:0;
  const trunk=birch?C.cream:C.wood,trunkShade=birch?C.plasterShade:C.woodShade;
  if(tree) {
    for(const [u,v] of [[.25,.4],[.68,.26],[.76,.71],[.36,.78]]) {
      m.line([.5,.5,7],[u!,v!,1],C.woodShade,6);m.line([.5,.5,7],[u!,v!,2],C.wood,2);
    }
    m.box(.465,.465,.535,.535,0,profile.trunk,[trunk,trunkShade,trunk]);
    for(let z=7;z<profile.trunk-8;z+=15) {
      m.line([.48,.54,z],[.48,.54,z+7],birch?C.woodShade:C.woodLight,birch?2:1);
      m.line([.53,.54,z+3],[.54,.54,z+8],trunkShade,2);
    }
    for(const [u,v,z] of [[.18,.44,profile.trunk+7],[.76,.69,profile.trunk+31],[.42,.22,profile.trunk+48],[.74,.38,profile.trunk+67]]) {
      m.line([.5,.5,z!-61],[u!,v!,z!],trunkShade,7);m.line([.49,.5,z!-60],[u!,v!,z!+1],trunk,3);
      m.line([u!,v!,z!],[u!-.05,v!+.09,z!+15],trunkShade,2);
    }
  } else {
    for(let i=0;i<6;i++)m.line([.5,.5,2],[.15+m.random()*.7,.15+m.random()*.7,27+m.random()*12],C.woodShade,2);
  }
  if(tree&&variant===3) {
    for(let level=0;level<4;level++) {
      const cy=center.y-profile.center-level*74,radius=span*(profile.spread-level*.23),vertices:LivePoint[]=[{x:center.x+lean,y:cy-104}];
      for(let side=0;side<2;side++)for(let tier=0;tier<5;tier++) {
        const t=side===0?tier:4-tier,sign=side===0?1:-1,width=radius*(.28+t*.18),y=cy-72+t*24;
        vertices.push({x:center.x+lean+sign*width,y},{x:center.x+lean+sign*(width-9),y:y+7});
      }
      m.raster.polygon(vertices,C.leafShade);
      m.raster.polygon([{x:center.x+lean,y:cy-100},{x:center.x+lean-radius*.77,y:cy+19},{x:center.x+lean-radius*.16,y:cy+24},{x:center.x+lean+radius*.15,y:cy-8}],C.leaf);
      for(let tier=0;tier<4;tier++) {
        const y=cy-57+tier*25,width=radius*(.25+tier*.17);
        m.raster.line(center.x-width,y,center.x-3,y+6,C.leafLight);
        for(let i=0;i<4;i++) {
          const x=center.x-width+m.random()*width*1.5;
          m.raster.line(x,y+2,x-3,y+6,i%3?C.leaf:C.leafLight);
        }
      }
    }
    return;
  }
  const rx=Math.min(span*(tree?profile.spread:1.06),m.raster.width/2-Math.abs(lean)-16),ry=tree?profile.radiusY:24,cy=center.y-(tree?profile.center:25);
  const crownX=center.x+lean;
  const silhouette:LivePoint[]=[];
  for(let i=0;i<32;i++) {
    const angle=i*Math.PI/16,rough=.86+m.random()*.14,lobe=1+Math.sin(angle*5+variant)*.045;
    silhouette.push({x:crownX+Math.cos(angle)*rx*rough*lobe,y:cy+Math.sin(angle)*ry*rough*lobe});
  }
  m.raster.polygon(silhouette,C.leafShade);
  // A dark underside, middle leaf masses and the lit upper-left crown read as volume.
  const count=tree?19:14;
  for(let i=0;i<count;i++) {
    const angle=i*2.399,radius=Math.sqrt((i+1)/(count+1));
    const x=crownX+Math.cos(angle)*rx*.71*radius,y=cy+Math.sin(angle)*ry*.69*radius;
    const size=(tree?32:8)+m.random()*(tree?23:10),mass:LivePoint[]=[];
    for(let lobe=0;lobe<12;lobe++) {
      const theta=lobe*Math.PI/6,rough=.78+m.random()*.22;
      mass.push({x:x+Math.cos(theta)*size*rough,y:y+Math.sin(theta)*Math.min(size*.67,ry*.38)*rough});
    }
    const lit=x<crownX+rx*.2&&y<cy+ry*.14,color=lit?(birch?C.leafLight:C.leaf):C.leafShade;
    m.raster.polygon(mass,color);
    if(lit)m.raster.line(x-size*.45,y-3,x+size*.25,y-5,birch?C.grass:C.leafLight,2);
    for(let j=0;j<5;j++) {
      const px=x-size*.4+m.random()*size*.8,py=y-size*.25+m.random()*size*.5;
      m.raster.rect(px,py,2+Math.floor(m.random()*3),1,lit?C.leafLight:C.leaf);
      if(j%2===0)m.raster.pixel(px-1,py+2,C.leafShade);
    }
  }
  if(birch)for(let i=0;i<7;i++) {
    const x=crownX-rx*.55+m.random()*rx*1.1,y=cy+ry*.35+m.random()*ry*.38;
    m.raster.line(x,y,x-5,y+22,C.leafShade);m.raster.line(x-3,y+5,x-9,y+17,C.leaf);
  }
  if(!tree&&variant===2)for(let i=0;i<7;i++) {
    const p=m.point(.2+m.random()*.6,.2+m.random()*.6,30+m.random()*12);m.raster.rect(p.x,p.y,2,2,i%2?C.terra:C.yellow);
  }
}

function container(m: Model): void {
  const kind=m.prop.kind;
  if(kind==='dumpster') {
    m.box(.08,.12,.92,.88,6,41,[C.green,C.steelShade,C.panelShade]);
    m.box(.025,.06,.975,.94,47,5,[C.panelShade,C.ink,C.steelShade]);
    m.line([.12,.22,54],[.88,.22,54],C.steelLight,2);
    m.line([.12,.55,54],[.88,.55,54],C.steelShade,2);
    for(const u of [.23,.47,.71]) m.line([u,.9,13],[u,.9,38],C.steelLight);
    m.line([.4,.94,31],[.6,.94,31],C.ink,4);
    m.line([.4,.965,34],[.6,.965,34],C.steelLight,2);
    for(const u of [.17,.83]) {m.box(u,.075,u+.045,.13,51,4,METAL,false);m.bolt(u,.91,34);}
    if(m.prop.variant===3) {
      m.slab(.08,.12,.92,.88,53,C.black);
      m.poly([[.08,.1,54],[.92,.1,54],[.92,.55,63],[.08,.55,63]],C.steelShade);
      m.line([.08,.55,64],[.92,.55,64],C.steelLight,2);
      m.slab(.27,.61,.46,.78,54,C.plaster);m.slab(.57,.58,.77,.79,54,C.woodShade);
    }
    m.poly([[.27,.942,21],[.36,.942,21],[.36,.942,34],[.27,.942,34]],C.plasterShade);
    m.line([.29,.945,24],[.34,.945,30],C.ink);m.line([.29,.945,30],[.34,.945,24],C.ink);
    for(let i=0;i<5;i++) {const u=.13+i*.16;m.line([u,.89,15],[u+.02,.89,6],C.rust);}
    m.wear(.12,.15,.87,.86,54,13);
    // The bags and folded cartons sit in the bin's own loading lip. They
    // cannot become a new silhouette of cover on the surrounding pavement.
    if(m.prop.variant===1||m.prop.variant===3) {
      for(const [u,v,size] of [[.3,.65,8],[.68,.73,7]]) {
        const p=m.point(u!,v!,55);
        m.raster.ellipse(p.x,p.y-size!*.35,size!,size!*.67,C.rubber);
        m.raster.line(p.x-2,p.y-size!+1,p.x+2,p.y-size!+1,C.steelShade,2);
        m.raster.line(p.x-4,p.y-size!*.2,p.x-2,p.y-size!*.6,C.steelShade);
      }
    } else if(m.prop.variant===2) {
      m.box(.15,.23,.45,.58,53,8,[C.sand,C.woodShade,C.woodLight],false);
      m.line([.3,.25,62],[.3,.55,62],C.cream,2);
      m.line([.17,.58,57],[.43,.58,57],C.woodShade);
    }
    for(const u of [.17,.83]) {const p=m.point(u,.85,5);m.raster.ellipse(p.x,p.y,5,6,C.ink);}
  } else if(kind==='crate') {
    m.box(.06,.06,.94,.94,0,43,WOOD);
    for(const t of [.28,.52,.76]) {
      m.line([.06,t,44],[.94,t,44],C.woodShade);
      m.line([t,.94,3],[t,.94,41],C.woodShade);
    }
    m.line([.15,.95,7],[.84,.95,36],C.woodLight,4);
    m.line([.95,.15,6],[.95,.84,37],C.woodShade,4);
    if(m.prop.variant===1) {
      m.poly([[.33,.951,14],[.65,.951,14],[.65,.951,29],[.33,.951,29]],C.cream);
      m.line([.4,.952,18],[.4,.952,25],C.ink,2);m.line([.53,.952,18],[.53,.952,25],C.ink,2);
    }
    for(const u of [.12,.88]) m.line([u,.05,45],[u,.95,45],C.woodLight,4);
    for(const v of [.1,.3,.57,.83])m.grain(.13,v,.87,46,3);
    for(const u of [.14,.85])for(const z of [10,35])m.bolt(u,.953,z);
    for(const v of [.14,.84])m.bolt(.953,v,12);
    if(m.prop.variant===2)for(const u of [.22,.78]) {
      m.line([u,.04,47],[u,.96,47],C.steelShade,3);m.line([u,.951,2],[u,.951,44],C.steelShade,3);
      m.bolt(u,.956,24);
    }
    if(m.prop.variant===3) {m.line([.48,.951,6],[.52,.951,26],C.ink);m.line([.52,.951,26],[.48,.951,36],C.ink);}
    m.wear(.1,.1,.9,.9,46,9,C.woodShade);
  } else if(kind==='pallet') {
    for(const v of [.12,.48,.84]) m.box(.05,v,.95,v+.07,0,10,WOOD,false);
    for(let i=0;i<6;i++) {
      const u=.02+i*.165;m.box(u,.025,u+.135,.975,10,5,WOOD,false);
      for(const v of [.27,.54,.73])m.grain(u+.01,v,u+.12,16,1);
      for(const v of [.15,.82]) {const p=m.point(u+.065,v,16);m.raster.pixel(p.x,p.y,C.ink);}
    }
    if(m.prop.variant===2) m.box(.3,.22,.77,.71,15,8,WOOD);
    if(m.prop.variant===1) {
      // A taped delivery carton stays below the existing pallet art envelope.
      m.box(.2,.22,.76,.78,15,12,[C.sand,C.woodShade,C.woodLight]);
      m.line([.48,.24,28],[.48,.76,28],C.cream,3);
      m.poly([[.32,.785,18],[.58,.785,18],[.58,.785,24],[.32,.785,24]],C.cream);
      for(const u of [.37,.43,.49])m.line([u,.79,19],[u,.79,23],C.steelShade);
    }
    if(m.prop.variant===3) {m.slab(.36,.45,.46,.62,16,C.woodShade);m.line([.36,.45,17],[.46,.6,17],C.ink);}
  } else {
    const center=m.point(.5,.5), rx=(m.prop.width+m.prop.height)*27, ry=rx*.48;
    const body=m.prop.variant%2?C.blue:C.rust;
    m.raster.rect(center.x-rx,center.y-ry-43,rx*2,43,C.rustShade);
    m.raster.ellipse(center.x,center.y-43,rx,ry,body);
    m.raster.ellipse(center.x,center.y,rx,ry,C.rustShade);
    m.raster.rect(center.x-rx*.68,center.y-43,rx*.46,37,body);
    for(const z of [9,32]) {
      m.raster.ellipse(center.x,center.y-z,rx,ry,C.ink);
      m.raster.ellipse(center.x,center.y-z-2,rx,ry,C.steelShade);
      m.raster.rect(center.x-rx+1,center.y-z-ry-1,rx*2-2,Math.max(1,ry*1.6),body);
    }
    m.raster.ellipse(center.x,center.y-44,rx-2,ry-2,C.steelShade);
    m.raster.ellipse(center.x+rx*.4,center.y-45,3,2,C.ink);
    m.raster.ellipse(center.x-rx*.3,center.y-44,2,2,C.ink);
    m.raster.line(center.x-rx*.55,center.y-45,center.x+rx*.1,center.y-48,C.steelLight);
    m.raster.line(center.x-rx*.65,center.y-34,center.x-rx*.65,center.y-14,C.rust,2);
    m.raster.line(center.x+rx*.78,center.y-31,center.x+rx*.78,center.y-8,C.ink);
    for(let i=0;i<11;i++) {
      const x=center.x-rx*.7+m.random()*rx*1.35,y=center.y-35+m.random()*25;
      m.raster.rect(x,y,1+Math.floor(m.random()*3),2+m.random()*3,i%3?C.rust:C.steelLight);
    }
    if(m.prop.variant===2) {
      m.raster.rect(center.x-6,center.y-28,13,15,C.plasterShade);m.raster.line(center.x-4,center.y-17,center.x+4,center.y-25,C.yellow,3);
      m.raster.line(center.x-3,center.y-25,center.x+3,center.y-17,C.ink);
    }
  }
}

/** Soft cloth and flat paper never imitate an unopened loot container. */
function courtyardBench(m:Model):void {
  const variant=m.prop.variant,paint=variant===1?C.blue:variant===2?C.green:C.wood;
  const finish:Colors=[paint,variant===1?C.steelShade:C.woodShade,variant===2?C.steelShade:C.wood];
  for(const u of [.14,.86]) {
    if(variant===3)m.box(u-.045,.14,u+.045,.86,0,26,CONCRETE,false);
    else for(const v of [.18,.78])m.post(u,v,0,27,variant===1?C.steelShade:C.woodShade,3);
    m.line([u,.17,6],[u,.8,6],C.steelShade,3);
  }
  for(let plank=0;plank<4;plank++) {
    const v=.035+plank*.24;m.box(.025,v,.975,v+.2,27,5,finish,false);
    m.line([.04,v+.025,33],[.96,v+.025,33],variant===2?C.leafLight:C.woodLight);
    m.grain(.06,v+.11,.94,34,4);for(const u of [.14,.86])m.bolt(u,v+.12,34);
  }
  if(variant!==3) {
    for(const u of [.15,.85])m.post(u,.11,28,27,C.steelShade,3);
    if(variant===2)for(const z of [39,50]) {
      m.poly([[.035,.12,z],[.965,.12,z],[.965,.035,z+7],[.035,.035,z+7]],C.green);
      m.line([.05,.035,z+7],[.95,.035,z+7],C.leafLight);
    } else for(const z of variant===1?[38,45,52]:[39,50]) {
      m.line([.025,.11,z],[.975,.11,z],paint,variant===1?5:8);
      m.line([.035,.11,z+2],[.965,.11,z+2],variant===1?C.steelLight:C.woodLight);
    }
    for(const u of [.12,.88]) {
      m.line([u,.12,36],[u,.4,45],C.steelShade,3);m.line([u,.4,45],[u,.86,37],C.steelShade,3);
      if(variant===1)m.line([u,.2,42],[u,.4,47],C.steel,2);
    }
    for(const [a,b,z]of [[.17,.26,40],[.59,.68,51],[.8,.84,40]])m.line([a!,.115,z!],[b!,.115,z!],C.woodShade,2);
  }
  if(variant===0) {
    m.poly([[.65,.34,35],[.83,.34,35],[.85,.63,36],[.82,.6,49],[.68,.6,50]],C.sand);
    m.poly([[.65,.34,35],[.68,.6,50],[.65,.4,48]],C.woodShade);
    m.line([.7,.48,49],[.7,.48,55],C.woodLight,2);m.line([.7,.48,55],[.79,.48,55],C.woodLight,2);
    m.line([.79,.48,55],[.79,.48,49],C.woodLight,2);m.line([.72,.6,37],[.75,.6,47],C.woodLight);
  } else if(variant===1) {
    m.slab(.61,.2,.86,.91,35,C.cream);m.poly([[.61,.92,35],[.86,.92,35],[.86,.92,19],[.61,.92,22]],C.plasterShade);
    for(const u of [.66,.77,.83]){m.line([u,.23,36],[u,.91,36],C.blue,2);m.line([u,.925,23],[u,.925,34],C.blue);}
    for(const v of [.33,.54,.77])m.line([.615,v,36],[.855,v,36],C.red);
    for(const u of [.64,.72,.8])m.line([u,.925,20],[u+.015,.925,17],C.woodLight);
  } else if(variant===2) {
    m.line([.18,.35,34],[.34,.35,34],C.woodShade,2);m.line([.57,.82,34],[.69,.82,34],C.woodLight,2);
  } else {
    m.slab(.54,.25,.81,.76,35,C.cream);m.line([.675,.26,36],[.675,.75,36],C.plasterShade);
    for(const v of [.34,.43,.52,.64])m.line([.57,v,36],[.65,v,36],C.steelShade);
    m.slab(.71,.34,.78,.49,36,C.steelShade);m.line([.1,.7,34],[.26,.7,34],C.woodLight,2);
  }
}

/** Cultivated leaves, flowers, stakes and herbs share a small stable grammar. */
function bedPlant(m:Model,u:number,v:number,z:number,kind:number,size:number):void {
  if(kind===0) {
    const p=m.point(u,v,z+size*.4);m.raster.ellipse(p.x,p.y,Math.max(4,size*.68),Math.max(3,size*.43),C.leafShade);
    m.raster.ellipse(p.x-1,p.y-2,Math.max(3,size*.43),Math.max(2,size*.3),C.leaf);
    m.line([u-.035,v,z+2],[u+.03,v,z+size],C.leaf,3);m.line([u,v-.035,z+2],[u,v+.035,z+size*.7],C.leafLight,2);
    m.line([u-.025,v+.02,z+size*.35],[u+.025,v-.02,z+size*.35],C.grass);
  } else if(kind===1) {
    m.line([u,v,z],[u,v,z+size],C.leafShade,2);m.line([u,v,z+size*.4],[u-.045,v-.025,z+size*.65],C.leaf,3);
    m.line([u,v,z+size*.58],[u+.04,v+.025,z+size*.78],C.leafLight,2);
    const leaf=m.point(u+.02,v,z+size*.55);m.raster.ellipse(leaf.x,leaf.y,Math.max(3,size*.21),2,C.leaf);
    const p=m.point(u,v,z+size);m.raster.ellipse(p.x,p.y,4,3,Math.floor(u*100+v*80)%3?C.terra:C.cream);m.raster.pixel(p.x,p.y-1,C.yellow);
  } else if(kind===2) {
    m.line([u,v,z],[u,v,z+size],C.woodLight,2);
    for(const t of [.3,.55,.78]) {
      m.line([u,v,z+size*t],[u-.045,v+.03,z+size*(t+.1)],C.leaf,3);
      m.line([u,v,z+size*t],[u+.04,v-.03,z+size*(t+.13)],C.leafLight,2);
      const p=m.point(u+.025,v,z+size*t);m.raster.ellipse(p.x,p.y,2,2,C.terra);
    }
  } else {
    const p=m.point(u,v,z+3);m.raster.ellipse(p.x,p.y,Math.max(4,size*.33),3,C.leafShade);
    for(const [du,dv,scale]of [[-.06,.025,.66],[-.035,-.02,.88],[0,-.035,1],[.03,.02,.91],[.055,-.01,.72]]) {
      m.line([u,v,z],[u+du!,v+dv!,z+size*scale!],C.grass,2);
      m.line([u+du!,v+dv!,z+size*scale!],[u+du!+.015,v+dv!,z+size*scale!+2],C.leafLight);
    }
  }
}

function courtyardPlanter(m:Model):void {
  const variant=m.prop.variant,soil=variant===2?33:29;
  if(variant===1||variant===3) {
    const outer=Array.from({length:8},(_,i)=>{const a=Math.PI/4*i;return [.5+Math.cos(a)*.44,.5+Math.sin(a)*.44] as const;});
    const base=outer.map(([u,v])=>[.5+(u-.5)*.76,.5+(v-.5)*.76] as const);
    for(let i=0;i<8;i++){const a=outer[i]!,b=outer[(i+1)%8]!,aa=base[i]!,bb=base[(i+1)%8]!;
      m.poly([[aa[0],aa[1],0],[bb[0],bb[1],0],[b[0],b[1],28],[a[0],a[1],28]],variant===1?(i%3?C.terra:C.terraShade):(i%3?C.concrete:C.concreteShade));}
    m.poly(outer.map(([u,v])=>[u,v,29] as const),variant===1?C.woodLight:C.plasterShade);
    m.poly(outer.map(([u,v])=>[.5+(u-.5)*.8,.5+(v-.5)*.8,30] as const),C.soil);
  } else {
    m.box(.055,.055,.945,.945,0,variant===2?32:28,variant===2?WOOD:CONCRETE);
    m.box(.035,.035,.965,.965,variant===2?29:25,5,variant===2?[C.woodLight,C.woodShade,C.wood]:CONCRETE,false);
    m.slab(.09,.09,.91,.91,soil+1,C.soil);
    if(variant===2){for(const u of [.18,.35,.52,.69,.86])m.line([u,.95,4],[u,.95,29],C.woodShade);
      for(const z of [8,25])m.line([.06,.955,z],[.94,.955,z],C.steelShade,2);for(const u of [.14,.84])for(const z of [8,25])m.bolt(u,.96,z);
    } else {m.line([.08,.95,12],[.92,.95,12],C.plasterShade);m.line([.1,.96,4],[.13,.96,10],C.concreteShade);m.line([.13,.96,10],[.21,.96,15],C.concreteShade);}
  }
  const plants=variant===1?[[.32,.3],[.65,.28],[.5,.52],[.28,.67],[.72,.65]]:variant===2?[[.3,.32],[.67,.3],[.5,.6]]:[[.3,.3],[.67,.28],[.48,.56],[.24,.68],[.74,.67]];
  for(const [u,v]of plants)bedPlant(m,u!,v!,soil+2,variant===2?3:variant===0?0:1,variant===2?23:variant===1?19:14);
}

function courtyardFence(m:Model):void {
  const variant=m.prop.variant;
  if(variant===2) {
    for(const z of [21,53])m.line([.04,.5,z],[.96,.5,z],C.woodShade,5);
    for(let i=0;i<12;i++){const u=.04+i*.081,top=68+(i%3===1?5:0);
      m.poly([[u,.5,2],[u+.045,.5,2],[u+.045,.5,top-4],[u+.023,.5,top],[u,.5,top-4]],i%4===0?C.woodLight:C.plasterShade);
      m.line([u+.005,.505,8],[u+.005,.505,top-5],C.woodLight);if(i%3===0)m.line([u+.01,.51,31],[u+.03,.51,47],C.woodShade,2);
      for(const z of [21,53])m.bolt(u+.023,.51,z);}
  } else if(variant===1) {
    for(const u of [.04,.49,.95])m.post(u,.5,0,68,C.steelShade,4);for(const z of [12,62])m.line([.04,.5,z],[.96,.5,z],C.steel,3);
    for(let i=0;i<13;i++){const u=.04+i*.071;m.line([u,.5,12],[Math.min(.96,u+.12),.5,62],C.panelShade);m.line([u,.5,62],[Math.min(.96,u+.12),.5,12],C.steelShade);}
    for(const u of [.18,.59,.82])m.line([u,.505,58],[u+.025,.505,38],C.rust,2);
  } else {
    if(variant===3){m.box(.02,.2,.98,.8,0,13,[C.brick,C.brickShade,C.terraShade],false);m.line([.03,.81,7],[.97,.81,7],C.woodLight);
      for(const u of [.17,.35,.53,.71,.89])m.line([u,.81,1],[u,.81,12],C.woodShade);m.slab(.02,.2,.98,.8,14,C.plasterShade);}
    const base=variant===3?14:3;for(const u of [.04,.5,.96])m.post(u,.5,base,variant===3?62:70,variant===3?C.steelShade:C.green,4);
    for(const z of [base+10,base+47])m.line([.04,.5,z],[.96,.5,z],variant===3?C.steelShade:C.green,3);
    for(let i=0;i<11;i++){const u=.08+i*.084,top=base+51+(variant===0?Math.sin(i*Math.PI/10)*9:0);
      m.line([u,.5,base+4],[u,.5,top],C.steelShade,2);m.line([u-.012,.5,top-3],[u,.5,top+2],variant===0?C.green:C.steel,2);
      m.line([u,.5,top+2],[u+.012,.5,top-3],variant===0?C.green:C.steel,2);}
    if(variant===0)for(const u of [.24,.75]){m.line([u-.045,.5,30],[u,.5,38],C.green,2);m.line([u,.5,38],[u+.045,.5,30],C.green,2);}
  }
  groundGrowth(m,3);
}

function furniture(m: Model): void {
  const kind=m.prop.kind;
  if(kind==='bench')courtyardBench(m);
  else if(kind==='workbench') {
    for(const u of [.16,.82])for(const v of [.17,.8])m.post(u,v,0,27,C.wood,3);m.box(.02,.02,.98,.98,27,5,WOOD,false);
    for(const v of [.25,.5,.75])m.line([.025,v,33],[.975,v,33],C.woodShade);for(const v of [.16,.38,.65,.87])m.grain(.04,v,.95,34,4);
    for(const u of [.16,.82])for(const v of [.15,.82])m.bolt(u,v,34);
      m.box(.13,.15,.37,.45,33,8,METAL);
      m.line([.63,.28,34],[.89,.67,34],C.ink,3);
      m.line([.73,.68,34],[.73,.92,34],C.wood,3);
      m.box(.57,.55,.71,.7,34,7,METAL);
      if(m.prop.variant===2)m.box(.35,.72,.49,.94,33,10,[C.red,C.rustShade,C.terraShade]);
      m.line([.19,.31,43],[.34,.31,43],C.ink,2);m.line([.26,.2,42],[.26,.47,42],C.steelLight,2);
      m.line([.18,.5,19],[.4,.5,19],C.woodShade,3);m.box(.15,.58,.32,.85,10,5,WOOD,false);
      m.line([.43,.35,35],[.56,.48,35],C.steel,2);m.line([.43,.35,35],[.39,.35,35],C.steelLight,3);
      if(m.prop.variant===1)m.slab(.59,.17,.79,.35,35,C.cream);
      if(m.prop.variant===3) {m.line([.78,.6,35],[.88,.6,35],C.wood,3);m.line([.83,.55,35],[.83,.66,35],C.steelShade,4);}

  } else if(kind==='planter')courtyardPlanter(m);
  else if(kind==='logs') {
    for(let row=0;row<2;row++) for(let i=0;i<3-row;i++) {
      const v=.16+i*.27+row*.135, z=9+row*15;
      m.line([.08,v,z],[.92,v,z],C.woodShade,15);
      m.line([.08,v,z+3],[.92,v,z+3],C.wood,8);
      const p=m.point(.94,v,z);
      m.raster.ellipse(p.x,p.y,8,7,C.woodLight);m.raster.ellipse(p.x,p.y,5,4,C.wood);
      m.raster.ellipse(p.x,p.y,2,2,C.woodShade);
      m.line([.93,v,z],[.94,v+.02,z+6],C.woodShade);
      m.grain(.12,v,.88,z+6,7);m.line([.95,v,z-3],[.95,v+.025,z+3],C.woodShade);
    }
    for(const u of [.24,.76]) m.line([u,.02,8],[u,.96,9],C.steelShade,3);

  } else if(kind==='fence')courtyardFence(m);
}

function utility(m: Model): void {
  const kind=m.prop.kind, center=m.point(.5,.5);
  groundGrowth(m,kind==='transformer'?5:3);
  if(kind==='transformer') {
    m.box(.08,.08,.92,.92,0,13,CONCRETE);
    m.box(.14,.14,.86,.86,13,77,METAL);
    m.box(.10,.1,.90,.90,90,7,[C.steelLight,C.steelShade,C.panelShade]);
    for(let i=0;i<7;i++) m.line([.28,.865,29+i*6],[.72,.865,29+i*6],C.ink,2);
    m.line([.19,.87,21],[.19,.87,85],C.steelLight);m.line([.81,.87,21],[.81,.87,85],C.steelShade);
    for(const z of [31,68])m.box(.77,.865,.82,.905,z,6,METAL,false);
    m.line([.71,.88,52],[.71,.88,60],C.ink,3);m.bolt(.71,.89,55);
    m.poly([[.23,.875,75],[.34,.875,75],[.34,.875,84],[.23,.875,84]],C.cream);
    for(let i=0;i<3;i++)m.line([.25+i*.025,.88,77],[.25+i*.025,.88,81],C.ink);
    m.poly([[.38,.87,77],[.61,.87,77],[.5,.87,57]],C.yellow);
    m.line([.5,.88,75],[.45,.88,67],C.ink,2);m.line([.45,.88,67],[.53,.88,66],C.ink,2);
    m.line([.53,.88,66],[.49,.88,61],C.ink,2);
    for(const u of [.3,.7]) {
      m.post(u,.37,97,15,C.woodShade,6);
      const p=m.point(u,.37,108);m.raster.rect(p.x-5,p.y,11,2,C.cream);m.raster.rect(p.x-5,p.y-4,11,2,C.cream);
    }
    m.wear(.2,.2,.8,.8,99,8);
    m.line([.1,.93,7],[.23,.93,10],C.concreteShade);m.line([.23,.93,10],[.28,.93,4],C.ink);
    if(m.prop.variant===1)m.line([.24,.87,24],[.31,.87,50],C.rust,2);
    if(m.prop.variant===2)m.box(.25,.22,.52,.49,98,9,[C.steelShade,C.ink,C.steel]);
    if(m.prop.variant===3) {m.line([.87,.2,61],[.87,.2,25],C.ink,3);m.line([.87,.2,25],[.94,.34,5],C.ink,3);}
  } else if(kind==='lamp') {
    m.box(.18,.18,.82,.82,0,8,CONCRETE,false);
    m.post(.5,.5,6,177,C.steelShade,5);
    m.line([.5,.5,183],[.5,.5,196],C.steel,4);
    const direction=m.prop.orientation==='x'?1:-1;
    const arm=(side:number):void=>{
      m.raster.line(center.x,center.y-196,center.x+side*24,center.y-207,C.ink,5);
      m.raster.line(center.x+side*24,center.y-207,center.x+side*39,center.y-207,C.steel,4);
      const left=center.x+(side===1?24:-51);
      m.raster.rect(left,center.y-208,27,8,C.ink);
      m.raster.rect(left+2,center.y-206,23,4,C.steelLight);
      m.raster.rect(left+5,center.y-200,18,2,C.cream);
      for(let slit=0;slit<4;slit++)m.raster.rect(left+5+slit*5,center.y-207,2,1,C.steelShade);
      m.raster.rect(left+3,center.y-205,4,2,C.white);
      if(m.prop.variant===3)m.raster.line(left+9,center.y-201,left+20,center.y-201,C.ink,2);
    };
    arm(direction);if(m.prop.variant===1)arm(-direction);
    m.raster.rect(center.x-4,center.y-33,8,12,C.steel);
    m.raster.rect(center.x-2,center.y-30,3,2,C.ink);
    m.raster.pixel(center.x+2,center.y-22,C.steelLight);
    for(const z of [66,111,157]) {m.raster.rect(center.x-3,center.y-z,6,2,C.ink);m.raster.pixel(center.x-2,center.y-z,C.steelLight);}
    m.raster.line(center.x-2,center.y-167,center.x-2,center.y-128,C.steel);
    if(m.prop.variant===2)m.raster.rect(center.x-2,center.y-62,4,9,C.rust);
  } else if(kind==='power-pole') {
    m.post(.5,.5,0,205,C.wood,8);
    m.raster.line(center.x-31,center.y-189,center.x+31,center.y-217,C.woodShade,6);
    m.raster.line(center.x-31,center.y-191,center.x+31,center.y-219,C.woodLight,2);
    for(let i=0;i<3;i++) {
      const x=center.x-24+i*23,y=center.y-191-i*10;
      m.raster.rect(x-3,y-11,7,10,C.cream);m.raster.rect(x-5,y-8,11,2,C.steelLight);
      m.raster.rect(x-5,y-3,11,2,C.panelShade);
    }
    for(const z of [75,105,135,165]) m.raster.rect(center.x-4,center.y-z,8,2,C.steelShade);
    m.raster.line(center.x-2,center.y-12,center.x-2,center.y-173,C.woodLight);
    for(let i=0;i<8;i++) {const z=15+i*20;m.raster.rect(center.x+2,center.y-z,2,7,C.woodShade);}
    m.raster.line(center.x-16,center.y-177,center.x-6,center.y-145,C.steelShade,2);
    m.raster.line(center.x-17,center.y-177,center.x+17,center.y-192,C.steelShade,2);
    if(m.prop.variant===1) {m.raster.rect(center.x+5,center.y-110,12,17,C.steelShade);m.raster.rect(center.x+6,center.y-109,9,13,C.steel);}
    if(m.prop.variant===2)for(const z of [31,67,123])m.raster.rect(center.x-3,center.y-z,4,7,C.plasterShade);
    if(m.prop.variant===3) {m.raster.line(center.x+3,center.y-160,center.x+9,center.y-154,C.ink,2);m.raster.line(center.x+9,center.y-154,center.x+9,center.y-76,C.ink,2);}
  } else if(kind==='sign') {
    m.post(.5,.5,0,76,C.steelShade,3);
    const y=center.y-80, variant=m.prop.variant;
    if(variant===0) {
      m.raster.polygon([{x:center.x-16,y:y+8},{x:center.x,y:y-18},{x:center.x+16,y:y+8}],C.cream);
      m.raster.line(center.x-16,y+8,center.x,y-18,C.red,3);m.raster.line(center.x,y-18,center.x+16,y+8,C.red,3);
      m.raster.line(center.x+16,y+8,center.x-16,y+8,C.red,3);m.raster.rect(center.x-1,y-4,3,7,C.ink);m.raster.pixel(center.x,y+5,C.ink);
    } else if(variant===1) {
      m.raster.ellipse(center.x,y,15,15,C.cream);m.raster.ellipse(center.x,y,12,12,C.red);
      m.raster.rect(center.x-9,y-2,19,5,C.cream);
    } else if(variant===2) {
      m.raster.rect(center.x-17,y-14,35,27,C.ink);m.raster.rect(center.x-15,y-12,31,23,C.blue);
      m.raster.rect(center.x-2,y-7,3,14,C.cream);m.raster.rect(center.x+1,y-7,6,3,C.cream);m.raster.rect(center.x+5,y-4,3,4,C.cream);
    } else {
      m.raster.rect(center.x-20,y-13,41,26,C.ink);m.raster.rect(center.x-18,y-11,37,22,C.cream);
      m.raster.line(center.x-11,y,center.x+11,y,C.blue,3);
      m.raster.line(center.x+6,y-5,center.x+12,y,C.blue,2);m.raster.line(center.x+12,y,center.x+6,y+5,C.blue,2);
    }
    m.raster.rect(center.x-1,y+8,2,2,C.steelLight);m.raster.rect(center.x-1,y-8,2,2,C.steelLight);
    m.raster.rect(center.x-1,center.y-38,2,9,C.rust);
  } else if(kind==='hydrant') {
    m.box(.16,.16,.84,.84,0,6,CONCRETE,false);
    m.post(.5,.5,5,30,[C.rust,C.red,C.green,C.steel][m.prop.variant]!,10);
    m.raster.ellipse(center.x,center.y-37,9,6,C.red);
    m.raster.rect(center.x-3,center.y-45,6,5,C.steelShade);
    m.raster.line(center.x-14,center.y-23,center.x+14,center.y-23,C.rustShade,7);
    m.raster.ellipse(center.x+14,center.y-23,4,5,C.steelShade);
    m.raster.ellipse(center.x-14,center.y-23,4,5,C.steelShade);
    m.raster.rect(center.x-4,center.y-31,2,14,C.red);
    for(const y of [19,28])m.raster.line(center.x-6,center.y-y,center.x+6,center.y-y,C.rustShade,2);
    for(let i=0;i<6;i++)m.raster.pixel(center.x-12+i*2,center.y-18+(i<3?i:6-i),C.steelLight);
    m.raster.line(center.x-3,center.y-43,center.x+2,center.y-43,C.steelLight);
  } else {
    m.box(.16,.16,.84,.84,0,6,CONCRETE,false);
    m.post(.5,.5,4,33,C.steelShade,9);
    m.raster.ellipse(center.x,center.y-38,5,3,C.steelLight);
    m.raster.rect(center.x-4,center.y-27,9,5,C.cream);
    if(m.prop.variant===1)m.raster.rect(center.x-4,center.y-17,9,3,C.red);
    if(m.prop.variant===2)m.raster.line(center.x-3,center.y-11,center.x+2,center.y-21,C.rust,2);
    if(m.prop.variant===3)m.raster.rect(center.x-4,center.y-27,9,5,C.yellow);
    m.raster.line(center.x-3,center.y-34,center.x-3,center.y-7,C.steel);
    for(const [x,y] of [[-4,3],[4,3]]) {m.raster.rect(center.x+x!-1,center.y+y!-1,3,2,C.ink);m.raster.pixel(center.x+x!,center.y+y!-1,C.steelLight);}
  }
}

function busStop(m: Model): void {
  const variant=m.prop.variant,paint=[C.green,C.blue,C.red,C.steel][variant]!,trim=variant===2?C.rustShade:C.steelShade;
  m.box(.055,.08,.945,.92,0,5,CONCRETE,false);
  // A compact shelter occupies its published stopping pocket. Its back panel,
  // seat and timetable make the blocked area a fixture, rather than an alley.
  m.box(.08,.13,.92,.22,5,39,[paint,trim,C.panelShade]);
  m.poly([[.1,.225,47],[.9,.225,47],[.9,.225,120],[.1,.225,120]],C.glass);
  m.poly([[.11,.23,56],[.39,.23,56],[.39,.23,119],[.11,.23,119]],C.panelShade);
  m.poly([[.43,.23,58],[.88,.23,58],[.88,.23,119],[.43,.23,119]],C.steelShade);
  m.line([.12,.235,114],[.37,.235,114],C.glassLight,2);
  m.line([.46,.235,111],[.72,.235,111],C.glassLight,2);
  m.line([.19,.236,60],[.31,.236,113],C.steel,2);
  m.line([.65,.236,58],[.8,.236,106],C.steel,2);
  for(const u of [.09,.42,.91])m.post(u,.2,6,122,trim,4);
  // The bench is framed separately from the dark rear glazing.
  for(const u of [.24,.66])m.post(u,.48,5,28,C.steelShade,3);
  m.box(.18,.31,.74,.61,31,6,WOOD);
  for(const v of [.38,.49])m.line([.19,v,38],[.73,v,38],C.woodLight,2);
  m.line([.19,.3,49],[.73,.3,49],C.woodShade,6);
  m.line([.19,.3,51],[.73,.3,51],C.woodLight,2);
  // A side notice/timetable board and a narrow bin are contained by the slab.
  m.poly([[.91,.25,50],[.91,.7,50],[.91,.7,115],[.91,.25,115]],trim);
  m.poly([[.915,.3,61],[.915,.65,61],[.915,.65,108],[.915,.3,108]],C.cream);
  m.poly([[.918,.32,96],[.918,.63,96],[.918,.63,106],[.918,.32,106]],paint);
  for(const z of [68,75,82,89]) {
    m.line([.92,.33,z],[.92,.6,z],C.steelShade);
    m.line([.921,.43,z-1],[.921,.43,z+1],C.terraShade,2);
  }
  m.box(.8,.55,.89,.78,6,28,[C.steel,C.steelShade,C.panelShade]);
  m.slab(.81,.57,.88,.75,35,C.ink);
  m.line([.805,.79,30],[.885,.79,30],C.steelLight);
  if(variant===1) {
    m.poly([[.51,.235,62],[.64,.235,62],[.64,.235,92],[.51,.235,92]],C.plasterShade);
    for(const z of [68,73,78])m.line([.53,.24,z],[.62,.24,z],C.steelShade);
    m.poly([[.55,.24,82],[.62,.24,82],[.62,.24,89],[.55,.24,89]],C.terra);
  }
  if(variant===3) {
    m.line([.5,.236,61],[.56,.236,89],C.ink);
    m.line([.56,.236,89],[.53,.236,112],C.ink);
    m.line([.56,.236,89],[.69,.236,96],C.ink);
  }
  m.wear(.12,.16,.87,.2,44,4+variant,C.rust);
  // Shallow roof folds and a colored fascia read at street-map distance.
  m.poly([[.025,.035,141],[.975,.035,141],[.975,.95,132],[.025,.95,132]],paint);
  m.poly([[.025,.95,132],[.975,.95,132],[.975,.95,124],[.025,.95,124]],trim);
  m.poly([[.025,.035,141],[.025,.95,132],[.025,.95,124],[.025,.035,133]],trim);
  m.line([.025,.04,142],[.975,.04,142],C.steelLight,2);
  m.line([.03,.95,133],[.97,.95,133],C.cream,2);
  for(const u of [.18,.38,.58,.78])m.line([u,.05,142],[u,.92,133],C.steelShade);
  // Bus pictogram belongs to the roof end, with no pole on the footpath.
  m.poly([[.79,.96,128],[.94,.96,128],[.94,.96,157],[.79,.96,157]],C.cream);
  m.poly([[.8,.965,130],[.93,.965,130],[.93,.965,155],[.8,.965,155]],C.blue);
  m.poly([[.82,.97,135],[.91,.97,135],[.91,.97,151],[.82,.97,151]],C.cream);
  m.poly([[.83,.975,142],[.9,.975,142],[.9,.975,149],[.83,.975,149]],C.blue);
  for(const u of [.835,.895])m.line([u,.98,132],[u,.98,135],C.ink,2);
  m.line([.04,.955,127],[.32,.955,127],C.cream,2);
  for(const u of [.4,.52,.64])m.line([u,.956,127],[u+.045,.956,127],C.woodLight);
}

function smallBuilding(m: Model): void {
  const kind=m.prop.kind, shed=kind==='shed', variant=m.prop.variant;
  const height=shed?94:78;
  groundGrowth(m,5);
  m.box(.04,.04,.96,.96,0,8,CONCRETE);
  m.box(.07,.07,.93,.93,8,height,[C.steel,C.steelShade,variant%2?C.plasterShade:C.panelShade]);
  if(shed) {
    // A sloping corrugated roof is a real silhouette rather than a flat box.
    m.poly([[.015,.015,height+10],[.985,.015,height+10],[.985,.5,height+41],[.015,.5,height+41]],C.steelShade);
    m.poly([[.015,.5,height+41],[.985,.5,height+41],[.985,.985,height+10],[.015,.985,height+10]],C.steel);
    for(let i=0;i<18;i++) {
      const u=.015+i*.056;
      m.line([u,.02,height+11],[u,.5,height+41],C.ink);
      m.line([u,.5,height+41],[u,.98,height+11],C.steelLight);
    }
    m.line([.015,.5,height+42],[.985,.5,height+42],C.steelLight,2);
    m.poly([[.13,.935,9],[.68,.935,9],[.68,.935,82],[.13,.935,82]],C.woodShade);
    for(let i=0;i<6;i++) m.line([.15+i*.085,.938,13],[.15+i*.085,.938,80],C.wood,2);
    m.line([.15,.94,16],[.66,.94,75],C.woodLight,3);
    m.line([.15,.94,75],[.66,.94,16],C.woodLight,3);
    m.line([.51,.945,45],[.59,.945,45],C.ink,2);
    for(const z of [25,65]) {m.line([.14,.948,z],[.22,.948,z],C.steelShade,3);m.bolt(.16,.951,z);}
    m.bolt(.59,.952,45);m.line([.59,.952,45],[.59,.952,39],C.steelLight);
    for(const z of [28,48,69])m.grain(.17,.94,.64,z,4);
    m.poly([[.76,.935,43],[.87,.935,43],[.87,.935,68],[.76,.935,68]],C.glass);
    m.line([.815,.94,43],[.815,.94,68],C.steelLight);
    m.line([.77,.94,55],[.87,.94,55],C.woodShade);m.line([.78,.941,60],[.81,.941,65],C.glassLight);
    for(let i=0;i<11;i++) m.line([.935,.1+i*.075,16],[.935,.1+i*.075,94],C.steelShade);
    m.line([.02,.985,height+9],[.98,.985,height+9],C.ink,3);
    m.line([.96,.95,12],[.96,.95,95],C.steelShade,3);
    if(variant===1)m.poly([[.25,.62,height+33],[.5,.62,height+33],[.5,.8,height+22],[.25,.8,height+22]],C.roofShade);
    if(variant===2)for(const v of [.25,.42,.59,.76])m.line([.94,v,21],[.94,v,43],C.rust);
    if(variant===3)m.line([.16,.948,36],[.2,.948,58],C.ink);
  } else {
    const roofPaint=variant===0?C.green:variant===1?C.terra:variant===2?C.blue:C.steel;
    const roofShade=variant===1?C.terraShade:C.steelShade;
    // The same real kiosk envelope supports four recognisable roof profiles:
    // a folded ridge, a sloping canopy, a capped flat roof and a low hip.
    // Window awnings stay inside the authored footprint rather than making
    // another apparent obstacle on the pavement.
    if(variant===0) {
      m.poly([[.015,.015,91],[.985,.015,91],[.985,.5,116],[.015,.5,116]],roofShade);
      m.poly([[.015,.5,116],[.985,.5,116],[.985,.985,91],[.015,.985,91]],roofPaint);
      m.line([.015,.5,117],[.985,.5,117],C.steelLight,2);
      for(const u of [.16,.38,.6,.82])m.line([u,.51,116],[u,.98,92],C.steelShade);
    } else if(variant===1) {
      m.poly([[.015,.015,116],[.985,.015,116],[.985,.985,94],[.015,.985,94]],roofPaint);
      m.poly([[.015,.015,116],[.015,.985,94],[.015,.985,87],[.015,.015,92]],roofShade);
      for(const u of [.13,.31,.49,.67,.85])m.line([u,.025,117],[u,.97,96],C.terraShade);
      m.line([.02,.015,118],[.98,.015,118],C.woodLight,2);
    } else if(variant===2) {
      m.box(.015,.015,.985,.985,86,10,[roofPaint,roofShade,C.panelShade]);
      m.box(.09,.08,.91,.85,97,9,[C.steelLight,C.steelShade,C.panelShade],false);
      m.line([.02,.98,97],[.98,.98,97],C.cream,2);
    } else {
      m.poly([[.015,.015,91],[.985,.015,91],[.77,.3,113],[.22,.3,113]],roofShade);
      m.poly([[.015,.985,91],[.985,.985,91],[.77,.3,113],[.22,.3,113]],roofPaint);
      m.poly([[.015,.015,91],[.015,.985,91],[.22,.3,113]],C.steelShade);
      m.poly([[.985,.015,91],[.985,.985,91],[.77,.3,113]],C.panelShade);
      m.line([.22,.3,114],[.77,.3,114],C.steelLight,2);
    }
    m.poly([[.14,.94,36],[.73,.94,36],[.73,.94,73],[.14,.94,73]],C.ink);
    m.poly([[.16,.945,39],[.7,.945,39],[.7,.945,70],[.16,.945,70]],C.glass);
    m.line([.43,.95,38],[.43,.95,70],C.steelLight,2);
    for(const z of [45,57])m.line([.18,.946,z],[.68,.946,z],C.woodShade,2);
    for(let i=0;i<6;i++) {const u=.2+i*.073;m.box(u,.947,u+.03,.957,40,7,[i%2?C.woodLight:C.terra,C.steelShade,C.woodShade],false);}
    m.line([.18,.95,63],[.29,.95,69],C.glassLight);
    m.box(.10,.91,.78,1,30,5,WOOD);
    m.poly([[.80,.94,9],[.91,.94,9],[.91,.94,73],[.80,.94,73]],C.steelShade);
    m.line([.85,.948,35],[.9,.948,35],C.cream,2);
    m.line([.15,.95,82],[.72,.95,82],C.cream,6);
    for(let i=0;i<6;i++) m.line([.2+i*.085,.955,81],[.2+i*.085,.955,83],C.red,2);
    m.line([.08,.07,16],[.08,.92,16],C.terraShade);
    m.poly([[.23,.952,13],[.51,.952,13],[.51,.952,25],[.23,.952,25]],C.plasterShade);
    for(const z of [17,21])m.line([.26,.955,z],[.47,.955,z],C.ink);
    const eave=variant===2?97:variant===1?94:91;
    m.line([.03,.98,eave],[.97,.98,eave],C.steelLight,2);
    m.poly([[.11,.75,81],[.76,.75,81],[.76,.99,74],[.11,.99,74]],variant%2?C.cream:roofPaint);
    for(let i=0;i<5;i++) {
      const u=.11+i*.13;
      m.poly([[u,.99,74],[u+.1,.99,74],[u+.1,.99,70],[u,.99,70]],variant%2?roofPaint:C.cream);
    }
    // Weathered posters and a service board use the existing side wall. Broad
    // colour blocks remain art, while small rules suggest print at close range.
    m.poly([[.937,.22,28],[.937,.54,28],[.937,.54,65],[.937,.22,65]],C.plasterShade);
    m.poly([[.94,.24,31],[.94,.51,31],[.94,.51,62],[.94,.24,62]],C.cream);
    m.poly([[.942,.27,49],[.942,.48,49],[.942,.48,58],[.942,.27,58]],variant%2?C.red:C.blue);
    for(const z of [37,41,45])m.line([.944,.28,z],[.944,.47,z],C.steelShade);
    m.poly([[.94,.63,22],[.94,.83,22],[.94,.83,47],[.94,.63,47]],C.terraShade);
    m.line([.943,.66,42],[.943,.8,42],C.cream,2);
    m.line([.943,.66,36],[.943,.77,36],C.plasterShade);
    if(variant===1) {
      // A hanging window box occupies the kiosk's own sill.
      m.box(.13,.87,.31,.99,31,8,[C.terra,C.rustShade,C.terraShade],false);
      for(const u of [.16,.24,.29]) {
        const p=m.point(u,.93,43);m.raster.ellipse(p.x,p.y,7,5,C.leafShade);
        m.raster.rect(p.x-3,p.y-5,5,4,C.leaf);m.raster.pixel(p.x,p.y-5,C.terra);
      }
    }
    if(variant===1)m.box(.54,.89,.69,.99,36,8,[C.terra,C.rustShade,C.terraShade]);
    if(variant===2)m.poly([[.16,.949,41],[.4,.949,41],[.4,.949,69],[.16,.949,69]],C.woodShade);
    if(variant===3)m.line([.6,.95,42],[.66,.95,62],C.ink,2);
  }
  if(shed)m.wear(.1,.1,.9,.9,height+18,12,C.rust);
}

function courtyardGarden(m:Model):void {
  const variant=m.prop.variant;
  const bed=(u0:number,v0:number,u1:number,v1:number,flower=false):void=>{
    m.box(u0,v0,u1,v1,0,8,flower?[C.terra,C.terraShade,C.woodShade]:WOOD,false);
    m.slab(u0+.025,v0+.035,u1-.025,v1-.035,9,C.soil);
    m.line([u0,v1,8],[u1,v1,8],C.woodLight,2);
    for(const u of [u0+.025,u1-.025])m.bolt(u,v1,5);
  };
  if(variant===0) {
    for(const v of [.06,.37,.68]) {
      bed(.04,v,.96,v+.25);
      m.line([.1,v+.13,10],[.9,v+.13,10],C.woodShade,2);
      for(let col=0;col<6;col++)bedPlant(m,.13+col*.145,v+.125,10,0,10+col%2*2);
    }
  } else if(variant===1) {
    bed(.04,.05,.96,.95,true);
    for(let row=0;row<3;row++)for(let col=0;col<6;col++)bedPlant(m,.14+col*.145,.2+row*.3,10,1,10+(col+row)%3*4);
    for(const v of [.1,.9])m.line([.08,v,10],[.92,v,10],C.sand);
  } else if(variant===2) {
    for(const v of [.09,.57]) {
      bed(.04,v,.96,v+.34);
      for(const u of [.16,.5,.84])m.post(u,v+.17,8,23,C.woodLight,2);
      m.line([.16,v+.17,29],[.84,v+.17,29],C.wood,2);
      for(const u of [.2,.39,.6,.79])bedPlant(m,u,v+.15,10,2,18);
    }
  } else {
    bed(.04,.07,.52,.94);bed(.61,.07,.96,.94);
    for(const v of [.2,.43,.68,.84])for(const u of [.16,.35])bedPlant(m,u,v,10,3,13+(Math.floor(v*10)%2)*3);
    for(const v of [.24,.5,.77])bedPlant(m,.79,v,10,0,14);
    for(const v of [.25,.5,.75]){const p=m.point(.79,v,10);m.raster.ellipse(p.x,p.y,3,2,C.terra);}
  }
  // Hose and plant labels sit below the borders, inside the same authored plot.
  m.line([.06,.975,2],[.63,.975,2],C.rubber,2);m.line([.63,.975,2],[.88,.85,2],C.rubber,2);
  if(variant!==1)for(const u of [.18,.77]){m.line([u,.13,8],[u,.13,18],C.woodLight);m.slab(u-.025,.11,u+.025,.16,18,C.cream);}
}

function courtyardPlayground(m:Model):void {
  const variant=m.prop.variant;groundGrowth(m,4);
  if(variant===0) {
    for(const u of [.08,.92]) {
      m.line([u,.1,0],[u,.5,121],C.steelShade,5);m.line([u,.9,0],[u,.5,121],C.steel,5);
      m.line([u,.25,42],[u,.75,42],C.steelShade,3);
    }
    m.line([.07,.5,121],[.93,.5,121],C.red,6);
    for(const u of [.3,.68]) {
      for(const side of [-1,1])m.line([u+side*.06,.5,117],[u+side*.06,.5,23],C.ink,2);
      m.box(u-.08,.36,u+.08,.65,23,3,WOOD,false);m.line([u-.07,.36,27],[u+.07,.36,27],C.woodLight);
      for(let link=0;link<8;link++)for(const side of [-1,1]){const p=m.point(u+side*.06,.5,29+link*11);m.raster.rect(p.x,p.y,1,3,C.steelLight);}
    }
    for(const u of [.16,.67,.87])m.line([u,.5,124],[u+.035,.5,124],C.steelLight,2);
  } else if(variant===1) {
    for(const [u,v]of [[.12,.23],[.12,.7],[.4,.23],[.4,.7]])m.post(u!,v!,0,105,C.blue,4);
    m.box(.09,.19,.43,.75,77,6,[C.yellow,C.woodShade,C.wood]);
    m.poly([[.43,.25,82],[.43,.68,82],[.95,.68,7],[.95,.25,7]],C.steelLight);
    for(const v of [.25,.68])m.line([.43,v,89],[.96,v,13],C.blue,4);
    for(let rung=0;rung<8;rung++)m.line([.08,.22,8+rung*9],[.08,.72,8+rung*9],C.yellow,3);
    for(const v of [.2,.75])m.line([.12,v,107],[.42,v,107],C.blue,3);
    m.line([.46,.3,80],[.91,.3,14],C.cream);m.line([.51,.6,67],[.82,.6,23],C.panelShade,2);
    for(const v of [.2,.72])m.bolt(.4,v,80);
    m.line([.13,.23,109],[.2,.23,109],C.woodLight,2);
  } else if(variant===2) {
    m.box(.07,.07,.93,.93,0,10,[C.wood,C.woodShade,C.terraShade]);
    m.slab(.115,.115,.885,.885,11,C.sand);
    for(const [u,v]of [[.08,.08],[.78,.08],[.78,.78],[.08,.78]])m.slab(u!,v!,u!+.14,v!+.14,12,C.red);
    for(const [u,v]of [[.25,.24],[.38,.7],[.71,.52]]){const p=m.point(u!,v!,12);m.raster.line(p.x-2,p.y,p.x+6,p.y+1,C.woodLight);}
    m.post(.5,.5,10,117,C.wood,5);
    m.poly([[.09,.09,108],[.91,.09,108],[.5,.5,131]],C.red);
    m.poly([[.91,.09,108],[.91,.91,108],[.5,.5,131]],C.terraShade);
    m.poly([[.91,.91,108],[.09,.91,108],[.5,.5,131]],C.terra);
    m.poly([[.09,.91,108],[.09,.09,108],[.5,.5,131]],C.woodLight);
    for(const [u,v]of [[.09,.09],[.91,.09],[.91,.91],[.09,.91]])m.line([.5,.5,132],[u!,v!,109],C.cream);
    m.line([.09,.91,108],[.91,.91,108],C.woodShade,3);
  } else {
    const ring=Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return [.5+Math.cos(a)*.4,.5+Math.sin(a)*.4] as const;});
    for(let i=0;i<12;i++){const a=ring[i]!,b=ring[(i+1)%12]!;m.poly([[a[0],a[1],11],[b[0],b[1],11],[b[0],b[1],18],[a[0],a[1],18]],C.steelShade);}
    m.poly(ring.map(([u,v])=>[u,v,19] as const),C.blue);
    for(let i=0;i<12;i++){const a=ring[i]!;m.line([.5,.5,20],[a[0],a[1],20],i%3===0?C.woodLight:C.steelShade);}
    m.post(.5,.5,19,35,C.red,6);
    for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
      const u=.5+Math.cos(angle)*.29,v=.5+Math.sin(angle)*.29;
      const nx=-Math.sin(angle)*.13,ny=Math.cos(angle)*.13;
      m.line([u,v,20],[u,v,48],C.yellow,4);
      m.line([u+nx,v+ny,48],[u-nx,v-ny,48],C.yellow,3);
      m.line([u,v,48],[.5,.5,48],C.red,3);
      m.line([u+nx,v+ny,23],[u-nx,v-ny,23],C.woodLight,7);
    }
    m.line([.48,.48,55],[.52,.52,55],C.steelLight,3);
  }
}

function yard(m: Model): void {
  const kind=m.prop.kind;
  if(kind==='garden')courtyardGarden(m);
  else if(kind==='market-stall') {
    for(const u of [.1,.9]) for(const v of [.1,.9]) m.post(u,v,0,91,C.wood,4);
    m.box(.08,.2,.92,.85,0,38,WOOD);
    m.box(.03,.12,.97,.92,38,5,WOOD);
    for(let i=0;i<4;i++) {
      const u=.1+i*.215;
      m.box(u,.24,u+.18,.68,43,9,[C.wood,C.woodShade,C.wood]);
      for(let j=0;j<6;j++) {
        const p=m.point(u+.025+m.random()*.13,.29+m.random()*.32,57);
        m.raster.ellipse(p.x,p.y,3,2,i%2?C.leafLight:C.terra);
      }
    }
    const crest=m.prop.variant===2?108:m.prop.variant===3?111:99;
    m.poly([[.01,.01,95],[.99,.01,95],[.99,.48,crest],[.01,.48,crest]],C.plasterShade);
    m.poly([[.01,.48,crest],[.99,.48,crest],[.99,.99,95],[.01,.99,95]],C.cream);
    for(let i=0;i<8;i++) {
      const u=i/8;
      m.poly([[u,.01,96],[u+.063,.01,96],[u+.063,.48,crest+1],[u,.48,crest+1]],m.prop.variant%2?C.blue:C.red);
      m.poly([[u,.48,crest+1],[u+.063,.48,crest+1],[u+.063,.99,96],[u,.99,96]],m.prop.variant%2?C.blue:C.red);
      m.poly([[u,.99,96],[u+.063,.99,96],[u+.063,.99,85],[u,.99,85]],m.prop.variant%2?C.steelShade:C.rustShade);
    }
    m.line([.01,.99,84],[.99,.99,84],C.ink);
    for(let i=0;i<8;i++) {
      const u=.025+i*.122;m.line([u,.05,97],[u,.48,crest+2],i%2?C.woodLight:C.plasterShade);
      m.line([u,.48,crest+2],[u,.96,97],i%2?C.woodLight:C.plasterShade);
      m.line([u,.99,88],[u+.04,.99,85],C.plasterShade);
    }
    m.line([.09,.1,73],[.91,.1,73],C.woodShade,3);
    m.line([.09,.9,72],[.91,.9,72],C.wood,3);
    m.slab(.43,.79,.61,.94,44,C.cream);m.line([.46,.84,45],[.56,.84,45],C.ink);
    // Small hanging price cards and a cloth edge frame the actual counter;
    // produce remains visibly contained by the existing trays.
    for(const u of [.22,.47,.72]) {
      m.line([u,.89,83],[u,.89,72],C.woodShade);
      m.poly([[u-.055,.895,61],[u+.055,.895,61],[u+.055,.895,73],[u-.055,.895,73]],C.cream);
      m.line([u-.03,.9,66],[u+.025,.9,66],C.steelShade,2);
    }
    m.box(.74,.72,.87,.87,44,9,METAL,false);m.slab(.7,.68,.9,.89,54,C.steelLight);
    m.grain(.08,.93,.91,44,7);
  } else courtyardPlayground(m);
}

function paintModel(model: Model): void {
  switch(model.prop.kind) {
    case 'car': case 'van': case 'truck': case 'bus': case 'railcar': vehicle(model);break;
    case 'tree': case 'shrub': foliage(model);break;
    case 'dumpster': case 'crate': case 'pallet': case 'barrel': container(model);break;
    case 'bench': case 'workbench': case 'planter': case 'logs': case 'fence': furniture(model);break;
    case 'transformer': case 'lamp': case 'power-pole': case 'sign': case 'hydrant': case 'bollard': utility(model);break;
    case 'shed': case 'kiosk': smallBuilding(model);break;
    case 'bus-stop': busStop(model);break;
    case 'garden': case 'playground': case 'market-stall': yard(model);break;
  }
}

/** Shared sprites are position independent. LRU bounds native RGBA allocation. */
export class PixelPropArt {
  private readonly sprites=new Map<string,Entry>();
  private bytes=0;
  get cacheBytes(): number { return this.bytes; }
  get cacheSize(): number { return this.sprites.size; }
  clear(): void {
    for(const {image} of this.sprites.values()) {image.width=1;image.height=1;}
    this.sprites.clear();this.bytes=0;
  }
  get(prop: LiveWorldProp): Sprite {
    if(!LIVE_PROP_KINDS.includes(prop.kind)||!Number.isFinite(prop.width)||!Number.isFinite(prop.height)
      ||prop.width<.15||prop.height<.15||prop.width>10||prop.height>10
      ||!Number.isInteger(prop.variant)||prop.variant<0||prop.variant>3||!['x','y'].includes(prop.orientation)) {
      throw new RangeError('Invalid pixel prop footprint or variant');
    }
    // Four stable canopy shapes per authored tree/shrub type, never one texture per ID.
    const canopy=prop.kind==='tree'||prop.kind==='shrub'?pixelSeed(prop.id)%4:0;
    const key=`${prop.kind}:${prop.width}:${prop.height}:${prop.orientation}:${prop.variant}:${canopy}`;
    const cached=this.sprites.get(key);
    if(cached) {this.sprites.delete(key);this.sprites.set(key,cached);return cached;}
    // The footprint is authoritative; only elevated silhouettes receive a little padding.
    const margin=prop.kind==='lamp'?56:prop.kind==='tree'?TREE_ART_MARGIN:prop.kind==='power-pole'?38:12;
    const elevation=pixelPropHeight(prop.kind);
    const image=document.createElement('canvas');
    image.width=Math.ceil((prop.width+prop.height)*PIXEL_TILE/2)+margin*2+1;
    image.height=Math.ceil((prop.width+prop.height)*PIXEL_TILE/4)+elevation+25;
    const anchor={x:Math.ceil(prop.height*PIXEL_TILE/2)+margin,y:elevation+12};
    const context=image.getContext('2d');
    if(!context) throw new Error('Pixel props require a Canvas 2D context');
    paintModel(new Model(new PixelRaster(context,image.width,image.height),prop,anchor,key));
    const entry={image,anchor,bytes:image.width*image.height*4};
    while(this.bytes+entry.bytes>PIXEL_PROP_CACHE_BYTES&&this.sprites.size) {
      const oldest=this.sprites.keys().next().value!;
      const previous=this.sprites.get(oldest)!;
      this.sprites.delete(oldest);this.bytes-=previous.bytes;
      previous.image.width=1;previous.image.height=1;
    }
    this.sprites.set(key,entry);this.bytes+=entry.bytes;
    return entry;
  }
}
