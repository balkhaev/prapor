import { LIVE_PROP_KINDS, type LivePoint, type LiveWorldProp } from './game/live';
import { PIXEL_PALETTE as C, PIXEL_TILE, PixelRaster, pixelIso, pixelRandom, pixelSeed, type PixelColor } from './pixel-art';

export { PIXEL_TILE } from './pixel-art';
export const PIXEL_PROP_CACHE_BYTES = 24 * 1024 * 1024;
type Sprite = { image: HTMLCanvasElement; anchor: LivePoint };
type Entry = Sprite & { bytes: number };
type Colors = readonly [PixelColor, PixelColor, PixelColor];
const HEIGHT: Record<LiveWorldProp['kind'], number> = {
  car: 82, van: 108, truck: 132, bus: 128, railcar: 144,
  tree: 240, shrub: 62, lamp: 236, 'power-pole': 246, sign: 110,
  shed: 156, kiosk: 132, 'market-stall': 118, transformer: 126,
  fence: 86, dumpster: 66, pallet: 30, crate: 56, barrel: 66,
  bench: 62, planter: 68, logs: 48, playground: 142, garden: 36,
  workbench: 56, hydrant: 64, bollard: 54,
};
const METAL: Colors = [C.steel, C.steelShade, C.panelShade];
const WOOD: Colors = [C.woodLight, C.woodShade, C.wood];
const CONCRETE: Colors = [C.concrete, C.concreteShade, C.panelShade];

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
  shadow(scale = .86): void {
    const center = this.point(.5,.5);
    this.raster.ellipse(center.x,center.y,Math.max(2,Math.round((this.prop.width+this.prop.height)*32*scale)),
      Math.max(1,Math.round((this.prop.width+this.prop.height)*12*scale)),C.shadow);
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
    this.raster.ellipse(p.x,p.y,4,6,C.steelShade); this.raster.pixel(p.x-1,p.y-2,C.steelLight);
  }
}

function vehicle(m: Model): void {
  const { kind, variant }=m.prop;
  const paints=[C.green,C.blue,C.cream,C.red] as const;
  const paint=paints[variant]!, shade=variant===2?C.plasterShade:variant===3?C.rustShade:C.steelShade;
  const bus=kind==='bus', truck=kind==='truck', van=kind==='van', rail=kind==='railcar';
  const bodyTop=bus?76:van?59:truck?43:rail?94:37;
  m.shadow(.82);
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
    m.poly([[.73,.84,52],[.88,.84,52],[.87,.84,74],[.73,.84,74]],C.glass);
    m.line([.74,.84,48],[.9,.84,48],C.steelLight);
    m.post(.9,.98,53,14,C.steelShade,2);
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
    m.line([.95,.38,16],[1,.38,16],C.ink,5);
    m.line([.01,.38,16],[.05,.38,16],C.ink,5);
  } else if (bus || van) {
    const roof=bus?102:84;
    m.box(.08,.18,.9,.82,bodyTop,roof-bodyTop,[paint,shade,C.panelShade]);
    if (bus) {
      for (let i=0;i<7;i++) {
        const u=.105+i*.105;
        m.poly([[u,.885,53],[u+.084,.885,53],[u+.084,.885,86],[u,.885,86]],C.glass);
        m.line([u,.885,84],[u+.084,.885,84],C.glassLight);
        m.line([u,.885,51],[u+.084,.885,51],C.steelLight);
      }
      m.poly([[.80,.89,20],[.93,.89,20],[.93,.89,88],[.80,.89,88]],C.ink);
      m.poly([[.81,.89,52],[.855,.89,52],[.855,.89,84],[.81,.89,84]],C.glass);
      m.poly([[.87,.89,52],[.917,.89,52],[.917,.89,84],[.87,.89,84]],C.glass);
      m.line([.862,.9,25],[.862,.9,86],C.steelLight);
      m.line([.05,.895,43],[.77,.895,43],C.cream,2);
    } else {
      m.poly([[.66,.89,50],[.87,.89,50],[.86,.89,78],[.67,.89,78]],C.glass);
      m.line([.65,.895,23],[.65,.895,80],C.steelShade);
      m.line([.72,.895,44],[.79,.895,44],C.ink,2);
      m.line([.17,.885,28],[.17,.885,72],shade);
      m.line([.45,.885,28],[.45,.885,72],shade);
      m.wear(.12,.2,.57,.8,86,14,C.plasterShade);
    }
    m.poly([[.96,.2,52],[.96,.8,52],[.90,.8,90],[.90,.2,90]],C.glass);
    m.line([.947,.22,58],[.923,.48,69],C.ink);
    m.line([.947,.78,58],[.923,.52,69],C.ink);
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
    m.line([.76,.19,39],[.94,.19,39],C.steelLight);
    m.line([.08,.81,39],[.20,.81,39],shade);
  }
  if (!rail) {
    m.line([.97,.2,25],[.97,.8,25],C.ink,5);
    m.line([.025,.2,23],[.025,.8,23],C.steelShade,4);
    m.line([.975,.23,34],[.975,.36,34],C.yellow,4);
    m.line([.975,.64,34],[.975,.77,34],C.yellow,4);
    m.line([.02,.23,32],[.02,.34,32],C.red,3);
    m.line([.02,.66,32],[.02,.77,32],C.red,3);
    m.line([.975,.43,24],[.975,.57,24],C.cream,2);
  }
  for (const u of rail?[.18,.32,.72,.86]:[.22,.77]) m.wheel(u,.9,15);
  m.wear(.07,.22,.91,.78,bodyTop+1,rail?19:10,C.rust);
}

function foliage(m: Model): void {
  const tree=m.prop.kind==='tree', variant=m.prop.variant;
  m.shadow(tree?.64:.78);
  const center=m.point(.5,.5), span=Math.max(12,(m.prop.width+m.prop.height)*30);
  if (tree) {
    m.box(.46,.46,.54,.54,0,96,[C.wood,C.woodShade,variant===2?C.cream:C.wood]);
    m.line([.5,.5,59],[.15,.5,112],C.woodShade,6);
    m.line([.5,.5,66],[.75,.75,130],C.wood,6);
    if (variant===2) for (const z of [19,35,56,78]) m.line([.48,.54,z],[.54,.54,z],C.woodShade,2);
  }
  if (tree && variant===3) {
    for (let level=0;level<4;level++) {
      const cy=center.y-61-level*38, radius=span*(.92-level*.18);
      m.raster.polygon([{x:center.x-radius,y:cy+21},{x:center.x,y:cy-66},{x:center.x+radius,y:cy+21},
        {x:center.x+radius*.45,y:cy+15},{x:center.x,y:cy+27},{x:center.x-radius*.4,y:cy+15}],C.leafShade);
      m.raster.polygon([{x:center.x-radius*.7,y:cy+11},{x:center.x,y:cy-61},{x:center.x+radius*.22,y:cy+18}],C.leaf);
      for(let i=0;i<9;i++) m.raster.rect(center.x-radius*.38+m.random()*radius*.68,cy-28+m.random()*45,4,2,C.leafLight);
    }
    return;
  }
  const poplar=tree&&variant===1;
  const rx=span*(poplar?.54:.96), ry=tree?(poplar?92:67):24;
  const cy=center.y-(tree?(poplar?134:139):25);
  const silhouette:LivePoint[]=[];
  for(let i=0;i<24;i++) {
    const angle=i*Math.PI/12, rough=.88+m.random()*.12;
    silhouette.push({x:center.x+Math.cos(angle)*rx*rough,y:cy+Math.sin(angle)*ry*rough});
  }
  m.raster.polygon(silhouette,C.leafShade);
  // Overlapping leaf masses, then sparse short clusters, rather than uniform noise.
  for(let i=0;i<17;i++) {
    const angle=i*2.399, radius=Math.sqrt((i+1)/18);
    const x=center.x+Math.cos(angle)*rx*.73*radius, y=cy+Math.sin(angle)*ry*.7*radius;
    const size=12+m.random()*14;
    const mass:LivePoint[]=[];
    for(let lobe=0;lobe<10;lobe++) {
      const theta=lobe*Math.PI/5, rough=.78+m.random()*.22;
      mass.push({x:x+Math.cos(theta)*size*rough,y:y+Math.sin(theta)*Math.min(size*.66,ry*.36)*rough});
    }
    m.raster.polygon(mass,i%4===0?C.leafLight:C.leaf);
    for(let j=0;j<5;j++) m.raster.rect(x-size*.35+m.random()*size*.7,y-size*.3+m.random()*size*.4,3,2,i%4===0?C.leaf:C.leafLight);
  }
  if(tree&&variant===2) for(let i=0;i<8;i++) m.raster.rect(center.x-rx*.5+m.random()*rx,cy+ry*.2+m.random()*ry*.45,2,5,C.leafShade);
}

function container(m: Model): void {
  const kind=m.prop.kind;
  m.shadow(.74);
  if(kind==='dumpster') {
    m.box(.08,.12,.92,.88,6,41,[C.green,C.steelShade,C.panelShade]);
    m.box(.025,.06,.975,.94,47,5,[C.panelShade,C.ink,C.steelShade]);
    m.line([.12,.22,54],[.88,.22,54],C.steelLight,2);
    m.line([.12,.55,54],[.88,.55,54],C.steelShade,2);
    for(const u of [.23,.47,.71]) m.line([u,.9,13],[u,.9,38],C.steelLight);
    m.line([.4,.94,31],[.6,.94,31],C.ink,4);
    m.line([.4,.965,34],[.6,.965,34],C.steelLight,2);
    m.wear(.12,.15,.87,.86,54,13);
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
    m.wear(.1,.1,.9,.9,46,9,C.woodShade);
  } else if(kind==='pallet') {
    for(const v of [.12,.48,.84]) m.box(.05,v,.95,v+.07,0,10,WOOD,false);
    for(let i=0;i<6;i++) {
      const u=.02+i*.165;m.box(u,.025,u+.135,.975,10,5,WOOD,false);
      for(const v of [.15,.82]) {const p=m.point(u+.065,v,16);m.raster.pixel(p.x,p.y,C.ink);}
    }
    if(m.prop.variant===2) m.box(.3,.22,.77,.71,15,8,WOOD);
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
    m.raster.line(center.x-rx*.65,center.y-34,center.x-rx*.65,center.y-14,C.rust,2);
  }
}

function furniture(m: Model): void {
  const kind=m.prop.kind;
  m.shadow(.7);
  if(kind==='bench'||kind==='workbench') {
    for(const u of [.16,.82]) for(const v of [.17,.8]) m.post(u,v,0,27,kind==='bench'?C.steelShade:C.wood,3);
    m.box(.02,.02,.98,.98,27,5,WOOD,false);
    for(const v of [.25,.5,.75]) m.line([.025,v,33],[.975,v,33],C.woodShade);
    if(kind==='bench') {
      for(const u of [.15,.84]) m.post(u,.12,28,24,C.steelShade,3);
      for(const z of [38,48]) {
        m.line([.015,.12,z],[.985,.12,z],C.woodShade,8);
        m.line([.015,.12,z+2],[.985,.12,z+2],C.woodLight,2);
      }
      for(const u of [.12,.88]) m.line([u,.06,36],[u,.91,36],C.steelShade,3);
      m.wear(.04,.1,.96,.9,34,4+m.prop.variant*2,C.woodShade);
    } else {
      m.box(.13,.15,.37,.45,33,8,METAL);
      m.line([.63,.28,34],[.89,.67,34],C.ink,3);
      m.line([.73,.68,34],[.73,.92,34],C.wood,3);
      m.box(.57,.55,.71,.7,34,7,METAL);
      if(m.prop.variant===2)m.box(.35,.72,.49,.94,33,10,[C.red,C.rustShade,C.terraShade]);
    }
  } else if(kind==='planter') {
    m.box(.045,.045,.955,.955,0,28,CONCRETE);
    m.slab(.08,.08,.92,.92,29,C.soil);
    for(const [u,v] of [[.3,.3],[.7,.28],[.5,.63],[.24,.7],[.8,.7]]) {
      const p=m.point(u!,v!,40);
      m.raster.ellipse(p.x,p.y,14,12,C.leafShade);m.raster.ellipse(p.x-3,p.y-4,10,9,C.leaf);
      if(m.prop.variant===1) {m.raster.rect(p.x,p.y-10,3,3,C.terra);m.raster.rect(p.x-6,p.y-4,2,2,C.yellow);}
    }
    m.line([.05,.955,22],[.955,.955,22],C.plasterShade);
  } else if(kind==='logs') {
    for(let row=0;row<2;row++) for(let i=0;i<3-row;i++) {
      const v=.16+i*.27+row*.135, z=9+row*15;
      m.line([.08,v,z],[.92,v,z],C.woodShade,15);
      m.line([.08,v,z+3],[.92,v,z+3],C.wood,8);
      const p=m.point(.94,v,z);
      m.raster.ellipse(p.x,p.y,8,7,C.woodLight);m.raster.ellipse(p.x,p.y,5,4,C.wood);
      m.raster.ellipse(p.x,p.y,2,2,C.woodShade);
      m.line([.93,v,z],[.94,v+.02,z+6],C.woodShade);
    }
    for(const u of [.24,.76]) m.line([u,.02,8],[u,.96,9],C.steelShade,3);
  } else if(kind==='fence') {
    for(const u of [.04,.49,.95]) m.post(u,.5,0,67,C.steelShade,5);
    for(const z of [13,61]) m.line([.03,.5,z],[.97,.5,z],C.steel,3);
    for(let i=0;i<13;i++) {
      const u=.04+i*.072;
      m.line([u,.5,13],[Math.min(.97,u+.12),.5,61],C.panelShade);
      m.line([u,.5,61],[Math.min(.97,u+.12),.5,13],C.steelShade);
    }
    if(m.prop.variant===2) for(let i=0;i<14;i++) {
      const u=i/14;m.line([u,.5,4],[u,.5,62+(i%2)*3],C.wood,7);
      m.line([u,.5,10],[u,.5,61],C.woodLight);
    }
  }
}

function utility(m: Model): void {
  const kind=m.prop.kind, center=m.point(.5,.5);
  m.shadow(kind==='transformer'?.8:.35);
  if(kind==='transformer') {
    m.box(.08,.08,.92,.92,0,13,CONCRETE);
    m.box(.14,.14,.86,.86,13,77,METAL);
    m.box(.10,.1,.90,.90,90,7,[C.steelLight,C.steelShade,C.panelShade]);
    for(let i=0;i<7;i++) m.line([.28,.865,29+i*6],[.72,.865,29+i*6],C.ink,2);
    m.poly([[.38,.87,77],[.61,.87,77],[.5,.87,57]],C.yellow);
    m.line([.5,.88,75],[.45,.88,67],C.ink,2);m.line([.45,.88,67],[.53,.88,66],C.ink,2);
    m.line([.53,.88,66],[.49,.88,61],C.ink,2);
    for(const u of [.3,.7]) {
      m.post(u,.37,97,15,C.woodShade,6);
      const p=m.point(u,.37,108);m.raster.rect(p.x-5,p.y,11,2,C.cream);m.raster.rect(p.x-5,p.y-4,11,2,C.cream);
    }
    m.wear(.2,.2,.8,.8,99,8);
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
    };
    arm(direction);if(m.prop.variant===1)arm(-direction);
    m.raster.rect(center.x-4,center.y-33,8,12,C.steel);
    m.raster.rect(center.x-2,center.y-30,3,2,C.ink);
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
    } else {
      m.raster.rect(center.x-17,y-14,35,27,C.ink);m.raster.rect(center.x-15,y-12,31,23,C.blue);
      m.raster.rect(center.x-2,y-7,3,14,C.cream);m.raster.rect(center.x+1,y-7,6,3,C.cream);m.raster.rect(center.x+5,y-4,3,4,C.cream);
    }
  } else if(kind==='hydrant') {
    m.box(.16,.16,.84,.84,0,6,CONCRETE,false);
    m.post(.5,.5,5,30,C.rust,10);
    m.raster.ellipse(center.x,center.y-37,9,6,C.red);
    m.raster.rect(center.x-3,center.y-45,6,5,C.steelShade);
    m.raster.line(center.x-14,center.y-23,center.x+14,center.y-23,C.rustShade,7);
    m.raster.ellipse(center.x+14,center.y-23,4,5,C.steelShade);
    m.raster.ellipse(center.x-14,center.y-23,4,5,C.steelShade);
    m.raster.rect(center.x-4,center.y-31,2,14,C.red);
  } else {
    m.box(.16,.16,.84,.84,0,6,CONCRETE,false);
    m.post(.5,.5,4,33,C.steelShade,9);
    m.raster.ellipse(center.x,center.y-38,5,3,C.steelLight);
    m.raster.rect(center.x-4,center.y-27,9,5,C.cream);
    if(m.prop.variant===1)m.raster.rect(center.x-4,center.y-17,9,3,C.red);
  }
}

function smallBuilding(m: Model): void {
  const kind=m.prop.kind, shed=kind==='shed', variant=m.prop.variant;
  const height=shed?94:78;
  m.shadow(.95);
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
    m.poly([[.76,.935,43],[.87,.935,43],[.87,.935,68],[.76,.935,68]],C.glass);
    m.line([.815,.94,43],[.815,.94,68],C.steelLight);
    for(let i=0;i<11;i++) m.line([.935,.1+i*.075,16],[.935,.1+i*.075,94],C.steelShade);
  } else {
    m.box(.015,.015,.985,.985,height+8,9,[C.green,C.steelShade,C.panelShade]);
    m.poly([[.14,.94,36],[.73,.94,36],[.73,.94,73],[.14,.94,73]],C.ink);
    m.poly([[.16,.945,39],[.7,.945,39],[.7,.945,70],[.16,.945,70]],C.glass);
    m.line([.43,.95,38],[.43,.95,70],C.steelLight,2);
    m.box(.10,.91,.78,1,30,5,WOOD);
    m.poly([[.80,.94,9],[.91,.94,9],[.91,.94,73],[.80,.94,73]],C.steelShade);
    m.line([.85,.948,35],[.9,.948,35],C.cream,2);
    m.line([.15,.95,82],[.72,.95,82],C.cream,6);
    for(let i=0;i<6;i++) m.line([.2+i*.085,.955,81],[.2+i*.085,.955,83],C.red,2);
    m.line([.08,.07,16],[.08,.92,16],C.terraShade);
  }
  m.wear(.1,.1,.9,.9,height+18,12,C.rust);
}

function yard(m: Model): void {
  const kind=m.prop.kind;
  if(kind==='garden') {
    m.slab(.02,.02,.98,.98,0,C.soil);
    for(let row=0;row<5;row++) {
      const v=.11+row*.18;
      m.line([.04,v,1],[.96,v,1],C.woodShade,5);
      for(let col=0;col<7;col++) {
        const p=m.point(.09+col*.13,v,6+col%3);
        m.raster.ellipse(p.x,p.y,6,4,C.leafShade);m.raster.rect(p.x-3,p.y-4,5,3,C.leaf);
        if(m.prop.variant===2)m.raster.rect(p.x,p.y-2,2,2,C.terra);
      }
    }
    for(const v of [.03,.97])m.line([.02,v,3],[.98,v,3],C.wood,3);
  } else if(kind==='market-stall') {
    m.shadow(.83);
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
    m.slab(.01,.01,.99,.99,95,C.cream);
    for(let i=0;i<8;i++) {
      const u=i/8;
      m.slab(u,.01,u+.063,.99,96,m.prop.variant%2?C.blue:C.red);
      m.poly([[u,.99,96],[u+.063,.99,96],[u+.063,.99,85],[u,.99,85]],m.prop.variant%2?C.steelShade:C.rustShade);
    }
    m.line([.01,.99,84],[.99,.99,84],C.ink);
  } else {
    m.shadow(.7);
    if(m.prop.variant%2===0) {
      // A Soviet swing frame: two A frames and two suspended narrow seats.
      for(const u of [.08,.92]) {
        m.line([u,.1,0],[u,.5,121],C.steelShade,5);
        m.line([u,.9,0],[u,.5,121],C.steel,5);
        m.line([u,.25,42],[u,.75,42],C.steelShade,3);
      }
      m.line([.07,.5,121],[.93,.5,121],C.red,6);
      for(const u of [.3,.68]) {
        m.line([u-.06,.5,117],[u-.06,.5,23],C.ink,2);
        m.line([u+.06,.5,117],[u+.06,.5,23],C.ink,2);
        m.box(u-.08,.36,u+.08,.65,23,3,WOOD,false);
      }
    } else {
      for(const [u,v] of [[.12,.23],[.12,.7],[.4,.23],[.4,.7]])m.post(u!,v!,0,82,C.red,4);
      m.box(.09,.19,.43,.75,59,6,[C.yellow,C.woodShade,C.wood]);
      m.poly([[.43,.25,64],[.43,.68,64],[.95,.68,7],[.95,.25,7]],C.steelLight);
      for(const v of [.25,.68]) m.line([.43,v,70],[.96,v,13],C.red,4);
      for(let i=0;i<6;i++) m.line([.08,.22,8+i*9],[.08,.72,8+i*9],C.yellow,3);
      for(const v of [.2,.75])m.line([.12,v,84],[.42,v,84],C.red,3);
    }
  }
}

function paintModel(model: Model): void {
  switch(model.prop.kind) {
    case 'car': case 'van': case 'truck': case 'bus': case 'railcar': vehicle(model);break;
    case 'tree': case 'shrub': foliage(model);break;
    case 'dumpster': case 'crate': case 'pallet': case 'barrel': container(model);break;
    case 'bench': case 'workbench': case 'planter': case 'logs': case 'fence': furniture(model);break;
    case 'transformer': case 'lamp': case 'power-pole': case 'sign': case 'hydrant': case 'bollard': utility(model);break;
    case 'shed': case 'kiosk': smallBuilding(model);break;
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
    const key=`${prop.kind}:${prop.width}:${prop.height}:${prop.orientation}:${prop.variant}`;
    const cached=this.sprites.get(key);
    if(cached) {this.sprites.delete(key);this.sprites.set(key,cached);return cached;}
    // The footprint is authoritative; only elevated silhouettes receive a little padding.
    const margin=prop.kind==='lamp'?56:prop.kind==='power-pole'?38:12;
    const elevation=HEIGHT[prop.kind];
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
