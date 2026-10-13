import { LIVE_TERRAIN_CODES, type LiveCommand, type LiveDrop, type LiveEntity, type LiveEvent, type LiveLandscapePath, type LiveObstacle, type LivePoint, type LiveSnapshot, type LiveTerrain, type LiveWorld } from './game/live';
import { scavDirection, type ScavDirection } from './scav-isometric';
import { liveDropLabel, liveLootTotals } from './live-loot-ui';

type AtlasFrame = { frame: { x: number; y: number; w: number; h: number }; spriteSourceSize: { x: number; y: number; w: number; h: number }; sourceSize: { w: number; h: number } };
type Atlas = { image: HTMLImageElement; frames: Record<string, AtlasFrame> };
type Motion = { from: LivePoint; to: LivePoint; at: number; direction: ScavDirection };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A presentation only: interpolation ends at the last confirmed server position. */
export class LiveScene {
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private snapshot: LiveSnapshot | null = null;
  private motions = new Map<string, Motion>();
  private atlases = new Map<number, Atlas | null>();
  private frame = 0;
  private paintedAt = 0;
  private active = false;
  private width = 800;
  private height = 520;
  private tile = 48;
  private origin = { x: 400, y: 260 };
  private camera: LivePoint = { x: 16, y: 12 };
  private zoom = 1;
  private selected: string | null = null;
  private routePoiIds: string[] = [];
  private waypointTargets: Array<{ point: LivePoint; x: number; y: number }> = [];
  private hitTargets: { entity: LiveEntity; x: number; y: number }[] = [];
  private controls = document.createElement('div');
  private following = true;
  private overview = false;
  private dragging: { id: number; startX: number; startY: number; camera: LivePoint; moved: boolean } | null = null;
  private ignoreClickUntil = 0;
  private effects: { event: LiveEvent; at: number }[] = [];
  private seenEvents = new Set<string>();
  private terrain: LiveTerrain[] = [];
  private overviewTerrain: HTMLCanvasElement | null = null;
  private terrainTexture: HTMLCanvasElement | null = null;
  private terrainColor: Record<LiveTerrain, readonly [number, number, number]> = { road: [80, 86, 78], concrete: [96, 103, 87], forest: [49, 70, 47], water: [43, 73, 76], yard: [91, 97, 68], grass: [75, 91, 53], path: [128, 121, 84], rail: [89, 91, 81], sand: [139, 136, 98] };

  constructor(private host: HTMLElement, private command: (command: LiveCommand) => void, private select: (id: string) => void) {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    this.context = context;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Общая карта. Нажми на землю для движения или выбери бойца. Потяни карту для обзора. Стрелки и WASD перемещают тебя.');
    this.canvas.setAttribute('role', 'application');
    this.controls.className = 'live-camera';
    this.controls.innerHTML = '<button data-live-zoom="out" aria-label="Отдалить карту">−</button><button data-live-zoom="follow" aria-label="Следовать за своим бойцом">За мной</button><button data-live-zoom="overview" aria-label="Показать всю карту">Вся карта</button><button data-live-zoom="in" aria-label="Приблизить карту">+</button>';
    host.append(this.canvas, this.controls);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.canvas.addEventListener('click', this.click);
    this.canvas.addEventListener('pointerdown', this.pointerDown);
    this.canvas.addEventListener('pointermove', this.pointerMove);
    this.canvas.addEventListener('pointerup', this.pointerUp);
    this.canvas.addEventListener('pointercancel', this.pointerCancel);
    this.controls.addEventListener('click', this.zoomClick);
    this.resize();
  }

  show(): void { if (this.active) return; this.active = true; this.resize(); this.animate(); }
  hide(): void { this.active = false; cancelAnimationFrame(this.frame); this.frame = 0; }
  clear(): void { this.snapshot = null; this.motions.clear(); this.selected = null; this.routePoiIds = []; this.waypointTargets = []; this.hitTargets = []; this.effects = []; this.seenEvents.clear(); this.paint(); }
  setSelected(id: string | null): void { this.selected = id; }
  setRoute(poiIds: readonly string[]): void {
    if (poiIds.length === this.routePoiIds.length && poiIds.every((id, index) => id === this.routePoiIds[index])) return;
    this.routePoiIds = [...poiIds]; this.waypointTargets = [];
  }
  update(snapshot: LiveSnapshot): void {
    const at = performance.now();
    if (this.snapshot?.worldVersion !== snapshot.worldVersion) { this.motions.clear(); this.effects = []; this.seenEvents.clear(); this.selected = null; this.routePoiIds = []; this.waypointTargets = []; this.hitTargets = []; this.following = true; this.overview = false; this.zoom = 1; this.dragging = null; this.canvas.classList.remove('is-dragging'); this.cacheTerrain(snapshot.world); }
    for (const entity of snapshot.entities) {
      const existing = this.motions.get(entity.id);
      const from = existing && Math.hypot(entity.x - existing.to.x, entity.y - existing.to.y) <= 4 ? this.interpolated(existing, at) : { x: entity.x, y: entity.y };
      const shot = entity.action === 'combat' ? [...snapshot.events].reverse().find(event => event.actorId === entity.id && event.from && event.to && snapshot.now - event.at < 1500) : null;
      const facing = shot?.from && shot.to ? { x: shot.to.x - shot.from.x, y: shot.to.y - shot.from.y } : { x: entity.x - from.x, y: entity.y - from.y };
      const dx = facing.x - facing.y, dy = facing.x + facing.y;
      this.motions.set(entity.id, { from, to: { x: entity.x, y: entity.y }, at, direction: scavDirection(dx, dy, existing?.direction) });
      this.loadAtlas(entity.appearance);
    }
    for (const id of this.motions.keys()) if (!snapshot.entities.some(entity => entity.id === id)) this.motions.delete(id);
    for (const event of snapshot.events) {
      if (!this.seenEvents.has(event.id) && event.kind === 'combat' && event.from && event.to && snapshot.now - event.at <= 1500) this.effects.push({ event, at });
      this.seenEvents.add(event.id);
    }
    if (this.seenEvents.size > 512) this.seenEvents = new Set(snapshot.events.map(event => event.id));
    this.snapshot = snapshot;
    if (!this.active) this.paint();
  }
  destroy(): void { this.hide(); this.observer.disconnect(); this.canvas.removeEventListener('click', this.click); this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('pointerup', this.pointerUp); this.canvas.removeEventListener('pointercancel', this.pointerCancel); this.controls.removeEventListener('click', this.zoomClick); this.canvas.remove(); this.controls.remove(); }

  private resize(): void {
    const box = this.host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    this.width = box.width; this.height = box.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * ratio); this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.paint();
  }
  private zoomClick = (event: MouseEvent): void => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-live-zoom]')?.dataset.liveZoom;
    if (!action) return;
    if (action === 'follow') { this.following = true; this.overview = false; this.zoom = 1; }
    else if (action === 'overview') { this.following = false; this.overview = true; }
    else { this.overview = false; this.zoom = clamp(this.zoom * (action === 'in' ? 1.25 : .8), .06, 1.8); }
    this.controls.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.liveZoom === (this.overview ? 'overview' : this.following ? 'follow' : ''))));
    this.canvas.focus({ preventScroll: true });
  };
  private click = (event: MouseEvent): void => {
    if (!this.snapshot || !this.active || performance.now() < this.ignoreClickUntil) return;
    this.canvas.focus({ preventScroll: true });
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const mini = this.minimapBounds(this.snapshot);
    if (x >= mini.x - 8 && x <= mini.x + mini.width + 8 && y >= mini.y - 8 && y <= mini.y + mini.height + 21) {
      if (x >= mini.x && x <= mini.x + mini.width && y >= mini.y && y <= mini.y + mini.height) this.command({ type: 'move', x: clamp(Math.round((x - mini.x) / mini.scale), 0, this.snapshot.world.width - 1), y: clamp(Math.round((y - mini.y) / mini.scale), 0, this.snapshot.world.height - 1) });
      return;
    }
    const target = [...this.hitTargets].reverse().find(target => this.tile < 28 ? Math.hypot(target.x - x, target.y - y) < 9 : Math.abs(target.x - x) < Math.max(14, 18 * this.zoom) && y >= target.y - Math.max(38, 62 * this.zoom) && y <= target.y + 10 * this.zoom);
    if (target && target.entity.id !== this.snapshot.selfId) { this.selected = target.entity.id; this.select(target.entity.id); return; }
    const self = this.snapshot.entities.find(entity => entity.id === this.snapshot?.selfId);
    const drop = this.snapshot.drops.find(drop => { const p = this.project(drop); return Math.hypot(x - p.x, y - p.y) < 18; });
    if (drop && self) {
      if (Math.hypot(drop.x - self.x, drop.y - self.y) <= 1.5) this.command({ type: drop.containerId && !drop.searched ? 'search' : 'loot', id: drop.id });
      else this.command({ type: 'move', x: drop.x, y: drop.y });
      return;
    }
    const waypoint = this.waypointTargets.find(target => Math.hypot(target.x - x, target.y - y) < 12);
    if (waypoint) { this.command({ type: 'move', ...waypoint.point }); return; }
    const dx = (x - this.origin.x) / (this.tile / 2), dy = (y - this.origin.y) / (this.tile / 4);
    const destination = { x: Math.round((dx + dy) / 2 + this.camera.x), y: Math.round((dy - dx) / 2 + this.camera.y) };
    if (destination.x >= 0 && destination.y >= 0 && destination.x < this.snapshot.world.width && destination.y < this.snapshot.world.height) this.command({ type: 'move', ...destination });
  };
  private pointerDown = (event: PointerEvent): void => {
    if (!this.active || !this.snapshot || event.button !== 0) return;
    this.dragging = { id: event.pointerId, startX: event.clientX, startY: event.clientY, camera: { ...this.camera }, moved: false };
    this.canvas.setPointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent): void => {
    const drag = this.dragging;
    if (!drag || drag.id !== event.pointerId || !this.snapshot) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 7) return;
    drag.moved = true; this.following = false;
    // Keep the same scale while leaving overview, so a drag never jumps the map.
    if (this.overview) { this.zoom = this.tile / (this.width < 480 ? 44 : 54); this.overview = false; }
    this.camera = { x: clamp(drag.camera.x - (dx / (this.tile / 2) + dy / (this.tile / 4)) / 2, 0, this.snapshot.world.width - 1), y: clamp(drag.camera.y - (dy / (this.tile / 4) - dx / (this.tile / 2)) / 2, 0, this.snapshot.world.height - 1) };
    this.canvas.classList.add('is-dragging');
  };
  private pointerUp = (event: PointerEvent): void => {
    if (this.dragging?.id !== event.pointerId) return;
    if (this.dragging.moved) this.ignoreClickUntil = performance.now() + 200;
    this.dragging = null; this.canvas.classList.remove('is-dragging');
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  };
  private pointerCancel = (): void => { this.dragging = null; this.canvas.classList.remove('is-dragging'); this.ignoreClickUntil = performance.now() + 200; };
  private animate = (at = performance.now()): void => { if (!this.active) return; if (at - this.paintedAt >= 1000 / 30) { this.paint(); this.paintedAt = at; } this.frame = requestAnimationFrame(this.animate); };
  private interpolated(motion: Motion, at: number): LivePoint { const amount = clamp((at - motion.at) / 350, 0, 1); return { x: motion.from.x + (motion.to.x - motion.from.x) * amount, y: motion.from.y + (motion.to.y - motion.from.y) * amount }; }
  private project(point: LivePoint, elevation = 0): LivePoint { return { x: this.origin.x + ((point.x - this.camera.x) - (point.y - this.camera.y)) * this.tile / 2, y: this.origin.y + ((point.x - this.camera.x) + (point.y - this.camera.y)) * this.tile / 4 - elevation }; }
  private polygon(points: LivePoint[], color: string, stroke?: string): void { const c = this.context; c.beginPath(); points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.fillStyle = color; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = .7; c.stroke(); } }
  private quad(x: number, y: number, width = 1, height = 1, elevation = 0): LivePoint[] { return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }].map(p => this.project(p, elevation)); }
  private label(text: string, x: number, y: number, color: string, size = 10): void { const c = this.context; c.font = `600 ${size}px Manrope, sans-serif`; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#101c18'; c.strokeText(text, x, y); c.fillStyle = color; c.fillText(text, x, y); }
  private unproject(x: number, y: number): LivePoint {
    const dx = (x - this.origin.x) / (this.tile / 2), dy = (y - this.origin.y) / (this.tile / 4);
    return { x: (dx + dy) / 2 + this.camera.x, y: (dy - dx) / 2 + this.camera.y };
  }
  private cacheTerrain(world: LiveWorld): void {
    const zones = [...world.zones].reverse();
    this.terrain = [];
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const code = world.terrainRows?.[y]?.[x] as keyof typeof LIVE_TERRAIN_CODES | undefined;
      if (code) { this.terrain.push(LIVE_TERRAIN_CODES[code]); continue; }
      const zone = zones.find(zone => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height);
      const district = world.districts.find(district => x >= district.x && x < district.x + district.width && y >= district.y && y < district.y + district.height);
      this.terrain.push(zone?.terrain ?? (district?.theme === 'forest' ? 'forest' : district?.theme === 'industrial' ? 'yard' : 'concrete'));
    }
    const texture = document.createElement('canvas'), resolution = 8;
    texture.width = world.width * resolution; texture.height = world.height * resolution;
    const ground = texture.getContext('2d');
    if (ground) {
      const pixels = ground.createImageData(texture.width, texture.height);
      const phase = [...world.seed].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) | 0, 0) / 65536;
      const borderBlend = (fraction: number) => {
        const t = clamp((.4 - Math.min(fraction, 1 - fraction)) / .4, 0, 1);
        return t * t * (3 - 2 * t) * .5;
      };
      const colorAt = (x: number, y: number) => this.terrainColor[this.terrain[clamp(y, 0, world.height - 1) * world.width + clamp(x, 0, world.width - 1)]!];
      for (let y = 0; y < texture.height; y++) for (let x = 0; x < texture.width; x++) {
        const wx = (x + .5) / resolution, wy = (y + .5) / resolution, cellX = Math.floor(wx), cellY = Math.floor(wy);
        const terrain = this.terrain[cellY * world.width + cellX]!, rgb = this.terrainColor[terrain];
        const fx = wx - cellX, fy = wy - cellY, blendX = borderBlend(fx), blendY = borderBlend(fy);
        const neighborX = cellX + (fx < .5 ? -1 : 1), neighborY = cellY + (fy < .5 ? -1 : 1);
        const edgeX = colorAt(neighborX, cellY), edgeY = colorAt(cellX, neighborY), corner = colorAt(neighborX, neighborY);
        const field = Math.sin(wx * .13 + wy * .04 + phase) * 4 + Math.sin(wy * .16 - wx * .06 + phase * 2) * 3;
        const grain = ((Math.imul(x + 31, 19349663) ^ Math.imul(y + 77, 73856093)) >>> 0) % 11 - 5;
        const shade = terrain === 'water' ? Math.sin(wx * .48 - wy * .25 + phase) * 3 + grain * .2 : field + grain * (terrain === 'concrete' || terrain === 'road' ? .4 : .65);
        const index = (y * texture.width + x) * 4;
        for (let channel = 0; channel < 3; channel++) pixels.data[index + channel] = (rgb[channel]! * (1 - blendX) + edgeX[channel]! * blendX) * (1 - blendY)
          + (edgeY[channel]! * (1 - blendX) + corner[channel]! * blendX) * blendY + shade;
        const edge = clamp(Math.min(wx, wy, world.width - wx, world.height - wy) / .4, 0, 1);
        pixels.data[index + 3] = 255 * edge * edge * (3 - 2 * edge);
      }
      ground.putImageData(pixels, 0, 0);
      ground.save(); ground.scale(resolution, resolution);
      // Flat flecks and short blades add undergrowth texture without collision scenery.
      for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
        const terrain = this.terrain[y * world.width + x]!;
        if (!['grass', 'forest', 'yard'].includes(terrain)) continue;
        const hash = (Math.imul(x + 59, 73856093) ^ Math.imul(y + 83, 19349663)) >>> 0;
        if (hash % 3) continue;
        const px = x + .2 + (hash % 101) / 170, py = y + .2 + ((hash >>> 9) % 101) / 170;
        ground.strokeStyle = terrain === 'forest' ? '#91a26e33' : '#b3bb7d33'; ground.lineWidth = .04;
        ground.beginPath(); ground.moveTo(px - .11, py + .09); ground.lineTo(px - .04, py - .05); ground.moveTo(px + .03, py + .1); ground.lineTo(px + .04, py - .09); ground.moveTo(px + .09, py + .1); ground.lineTo(px + .15, py + .02); ground.stroke();
      }
      this.paintLandscape(world, ground); ground.restore();
    }
    this.terrainTexture = texture;
    const overview = document.createElement('canvas'); overview.width = (world.width + world.height) * 4; overview.height = (world.width + world.height) * 2;
    const overviewContext = overview.getContext('2d');
    if (overviewContext) { overviewContext.save(); overviewContext.transform(4, 2, -4, 2, world.height * 4, 0); overviewContext.drawImage(texture, 0, 0, world.width, world.height); overviewContext.restore(); }
    this.overviewTerrain = overview;
  }
  /** Presentation follows the server raster; no scenery changes collision or rewards. */
  private paintLandscape(world: LiveWorld, c: CanvasRenderingContext2D): void {
    const stroke = (path: LiveLandscapePath, color: string, width: number) => {
      c.beginPath(); path.points.forEach((point, index) => index ? c.lineTo(point.x + .5, point.y + .5) : c.moveTo(point.x + .5, point.y + .5)); c.strokeStyle = color; c.lineWidth = width; c.stroke();
    };
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    // Roads may cross a river only on cells the authoritative raster marks as road.
    for (const kind of ['road', 'trail', 'rail', 'river'] as const) {
      const paths = world.paths?.filter(path => path.kind === kind) ?? [];
      if (!paths.length) continue;
      c.save();
      const accepted = kind === 'road' ? ['road', 'concrete'] : kind === 'trail' ? ['path', 'sand', 'yard'] : kind === 'rail' ? ['rail'] : ['water'];
      c.beginPath();
      for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) if (accepted.includes(this.terrain[y * world.width + x]!)) c.rect(x, y, 1, 1);
      c.clip();
      for (const path of paths) {
        if (path.kind === 'road') {
          stroke(path, '#a09b752e', path.width + .6); stroke(path, '#545b52', path.width * .9);
          if (path.width >= 3) { c.setLineDash([1.8, 2.8]); stroke(path, '#c4bd8877', .11); c.setLineDash([]); }
        } else if (path.kind === 'trail') { stroke(path, '#b3a26b55', path.width); stroke(path, '#b7a57555', path.width * .5); }
        else if (path.kind === 'river') { stroke(path, '#37585a77', path.width * .8); stroke(path, '#90b2a62d', path.width * .33); }
        else {
          stroke(path, '#5f6557', path.width); stroke(path, '#a1a294', .98); stroke(path, '#475346', .66);
          for (let index = 1; index < path.points.length; index++) {
            const a = path.points[index - 1]!, b = path.points[index]!, length = Math.hypot(b.x - a.x, b.y - a.y);
            if (!length) continue;
            const nx = (b.y - a.y) / length * .65, ny = -(b.x - a.x) / length * .65;
            for (let offset = .8; offset < length; offset += 1.7) { const x = a.x + .5 + (b.x - a.x) * offset / length, y = a.y + .5 + (b.y - a.y) * offset / length; c.beginPath(); c.moveTo(x - nx, y - ny); c.lineTo(x + nx, y + ny); c.strokeStyle = '#423f31'; c.lineWidth = .16; c.stroke(); }
          }
        }
      }
      c.restore();
    }
    c.restore();
  }
  private paintContainer(drop: LiveDrop): void {
    const p = this.project(drop), c = this.context, scale = this.tile / 54;
    if (p.x < -30 || p.x > this.width + 30 || p.y < -30 || p.y > this.height + 30) return;
    if (this.tile < 12) { c.fillStyle = '#e0c17e'; c.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); return; }
    c.save(); c.translate(p.x, p.y); c.scale(scale, scale);
    c.fillStyle = '#182d2166'; c.beginPath(); c.ellipse(0, 3, 12, 5, 0, 0, Math.PI * 2); c.fill();
    const kind = drop.containerKind;
    if (kind === 'jacket') {
      this.context.fillStyle = '#b1a17a'; c.beginPath(); c.moveTo(-4, -18); c.lineTo(-13, -11); c.lineTo(-9, -6); c.lineTo(-5, -10); c.lineTo(-5, 0); c.lineTo(5, 0); c.lineTo(5, -10); c.lineTo(9, -6); c.lineTo(13, -11); c.lineTo(4, -18); c.closePath(); c.fill(); c.strokeStyle = '#796d52'; c.beginPath(); c.moveTo(0, -14); c.lineTo(0, 0); c.stroke();
    } else if (kind === 'duffel' || kind === 'medbag') {
      c.fillStyle = kind === 'medbag' ? '#d4c8ac' : '#89925e'; c.beginPath(); c.ellipse(0, -4, 11, 7, 0, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#424d36'; c.lineWidth = 2; c.strokeRect(-4, -13, 8, 5);
      if (kind === 'medbag') { c.fillStyle = '#a65f48'; c.fillRect(-2, -9, 4, 10); c.fillRect(-5, -6, 10, 4); }
    } else if (kind === 'cabinet') {
      c.fillStyle = '#778779'; c.fillRect(-7, -24, 14, 26); c.strokeStyle = '#afbaa4'; c.strokeRect(-7, -24, 14, 26); c.strokeStyle = '#3f5042'; for (const y of [-18, -11, -4]) { c.strokeRect(-5, y, 10, 5); c.fillStyle = '#c3bc92'; c.fillRect(-1, y + 2, 2, 1); }
    } else {
      c.fillStyle = kind === 'toolbox' ? '#977455' : '#a18d60'; c.fillRect(-10, -11, 20, 13); c.strokeStyle = '#d1bc86'; c.strokeRect(-10, -11, 20, 13);
      if (kind === 'toolbox') { c.strokeStyle = '#d7c299'; c.lineWidth = 2; c.strokeRect(-4, -16, 8, 4); }
      else { c.strokeStyle = '#665333'; c.beginPath(); c.moveTo(-10, -10); c.lineTo(10, 1); c.moveTo(10, -10); c.lineTo(-10, 1); c.stroke(); }
    }
    c.restore();
    if (scale > .55) {
      const known = !drop.containerId || drop.searched;
      const kindLabels = { duffel: 'СУМКА', jacket: 'КУРТКА', toolbox: 'ИНСТРУМЕНТЫ', medbag: 'МЕДСУМКА', cabinet: 'ШКАФ', crate: 'ЯЩИК' };
      const label = !known ? drop.containerKind ? kindLabels[drop.containerKind] : 'ОБЫСКАТЬ' : drop.amount || drop.items?.length ? liveDropLabel(drop) : 'ПУСТО';
      this.label(label.length > 35 ? `${label.slice(0, 32)}…` : label, p.x, p.y + 19, '#e6d19a', 8);
      if (known && drop.items?.length && scale > .9) this.label(`≈ ${liveLootTotals(drop.items).guide.toLocaleString('ru-RU')} ₽`, p.x, p.y + 31, '#c6bd9a', 7);
    }
  }
  private obstacle(obstacle: LiveObstacle, index: number): void {
    const c = this.context, kind = obstacle.kind ?? 'building';
    const p = this.project({ x: obstacle.x + obstacle.width / 2 - .5, y: obstacle.y + obstacle.height / 2 - .5 });
    if (kind === 'water') return;
    if (!this.snapshot?.world.terrainRows && this.snapshot?.world.zones.some(zone => zone.terrain === 'water' && obstacle.x >= zone.x && obstacle.y >= zone.y && obstacle.x + obstacle.width <= zone.x + zone.width && obstacle.y + obstacle.height <= zone.y + zone.height)) {
      this.polygon(this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height), '#294c50', '#a2ad8266');
      const center = this.project({ x: obstacle.x + obstacle.width / 2, y: obstacle.y + obstacle.height / 2 });
      this.label('ОЗЕРО', center.x, center.y, '#b6ccc0', this.overview ? 7 : 10); return;
    }
    if (kind === 'tree') {
      const scale = this.tile / 54;
      c.fillStyle = '#10211966'; c.beginPath(); c.ellipse(p.x, p.y, 16 * scale, 8 * scale, 0, 0, Math.PI * 2); c.fill();
      const height = 42 + (obstacle.x * 7 + obstacle.y * 13) % 19;
      c.fillStyle = '#6e6850'; c.fillRect(p.x - 2 * scale, p.y - height * .65 * scale, 4 * scale, height * .65 * scale);
      if ((obstacle.x + obstacle.y * 3) % 5 === 0) {
        for (const [dx, dy, radius] of [[-9, -31, 13], [8, -36, 14], [0, -46, 13]]) { c.fillStyle = dy! < -40 ? '#65804d' : '#49683f'; c.beginPath(); c.ellipse(p.x + dx! * scale, p.y + dy! * scale, radius! * scale, radius! * .75 * scale, 0, 0, Math.PI * 2); c.fill(); }
      } else for (let tier = 0; tier < 3; tier++) { const y = p.y - (height * .32 + tier * height * .23) * scale, w = (20 - tier * 4) * scale; this.polygon([{ x: p.x - w, y }, { x: p.x, y: y - height * .48 * scale }, { x: p.x + w, y }], ['#314d34', '#476743', '#5c7549'][tier]!, '#263c2d'); }
      return;
    }
    const elevation = this.tile * (kind === 'wall' ? .6 : kind === 'barricade' ? .26 : kind === 'container' ? .65 : 1.05);
    const base = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height), top = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height, elevation);
    const localPoi = this.snapshot?.world.pois.find(poi => obstacle.x >= poi.x && obstacle.y >= poi.y && obstacle.x < poi.x + poi.width && obstacle.y < poi.y + poi.height);
    const rural = localPoi?.districtId === 'village' || localPoi?.districtId === 'sawmill';
    const colors = kind === 'container' ? [['#576e6c', '#345354', '#7b9086'], ['#92705b', '#664b3a', '#b59070'], ['#777955', '#4c523c', '#9b9a76']][index % 3]! : kind === 'barricade' ? ['#817452', '#62543d', '#aa9470'] : kind === 'wall' ? rural ? ['#918066', '#6a5b44', '#b1a078'] : ['#81877a', '#596154', '#a0a28b'] : rural ? ['#988c69', '#6e6247', '#787a59'] : ['#707b70', '#4e5e55', '#949684'];
    this.polygon([base[1]!, base[2]!, top[2]!, top[1]!], colors[0]!, '#acaf8644'); this.polygon([base[2]!, base[3]!, top[3]!, top[2]!], colors[1]!, '#84907666'); this.polygon(top, colors[2]!, '#b4b39177');
    if (kind === 'container') {
      c.strokeStyle = '#273c3a88'; c.lineWidth = 1;
      for (let fraction = .15; fraction < 1; fraction += .15) { const a = { x: top[1]!.x + (top[2]!.x - top[1]!.x) * fraction, y: top[1]!.y + (top[2]!.y - top[1]!.y) * fraction }, b = { x: base[1]!.x + (base[2]!.x - base[1]!.x) * fraction, y: base[1]!.y + (base[2]!.y - base[1]!.y) * fraction }; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    } else if (kind === 'building') {
      if (rural || obstacle.width >= obstacle.height * 1.5) {
        const ridgeA = this.project({ x: obstacle.x - .5, y: obstacle.y + obstacle.height / 2 - .5 }, elevation + this.tile * .2), ridgeB = this.project({ x: obstacle.x + obstacle.width - .5, y: obstacle.y + obstacle.height / 2 - .5 }, elevation + this.tile * .2);
        this.polygon([top[0]!, top[1]!, ridgeB, ridgeA], rural ? '#96906d' : '#8c9480', '#aaa98d66');
        this.polygon([ridgeA, ridgeB, top[2]!, top[3]!], rural ? '#6e7553' : '#687463', '#aaa98d66');
      } else {
        c.strokeStyle = '#505a4b88'; c.beginPath(); c.moveTo(top[0]!.x, top[0]!.y); c.lineTo(top[2]!.x, top[2]!.y); c.stroke();
        const vent = this.quad(obstacle.x + obstacle.width * .25, obstacle.y + obstacle.height * .25, .7, .7, elevation + 3); this.polygon(vent, '#697662', '#b1b292');
      }
      if (this.tile > 20) {
        const windows = Math.min(5, Math.max(1, Math.floor(obstacle.width / 2)));
        for (let i = 0; i < windows; i++) {
          const t = (i + 1) / (windows + 1), x = base[3]!.x + (base[2]!.x - base[3]!.x) * t, y = base[3]!.y + (base[2]!.y - base[3]!.y) * t - elevation * .58;
          this.polygon([{ x: x - this.tile * .1, y: y - this.tile * .045 }, { x: x + this.tile * .1, y: y + this.tile * .045 }, { x: x + this.tile * .1, y: y + this.tile * .2 }, { x: x - this.tile * .1, y: y + this.tile * .11 }], '#2a4038', '#a7af9666');
        }
      }
    }
    if (obstacle.label && !this.overview && this.tile > 28) this.label(obstacle.label.toUpperCase(), p.x, p.y - elevation + 3, '#efe1b2', 8);
  }

  private paint(): void {
    const c = this.context, now = performance.now();
    c.clearRect(0, 0, this.width, this.height);
    const gradient = c.createRadialGradient(this.width * .5, this.height * .5, 20, this.width * .5, this.height * .5, this.width * .7);
    gradient.addColorStop(0, '#39443b'); gradient.addColorStop(1, '#101d18'); c.fillStyle = gradient; c.fillRect(0, 0, this.width, this.height);
    if (!this.snapshot) return;
    const snapshot = this.snapshot, self = snapshot.entities.find(entity => entity.id === snapshot.selfId);
    this.tile = this.overview ? Math.min(this.width * 1.8 / (snapshot.world.width + snapshot.world.height), Math.max(120, this.height - 95) * 3.6 / (snapshot.world.width + snapshot.world.height)) : (this.width < 480 ? 44 : 54) * this.zoom;
    this.origin = { x: this.width * .5, y: this.height * (this.overview ? .54 : .58) };
    if (this.overview) this.camera = { x: snapshot.world.width / 2, y: snapshot.world.height / 2 };
    else if (self && this.following) this.camera = this.interpolated(this.motions.get(self.id)!, now);
    const world = snapshot.world;
    const corners = [this.unproject(-this.tile, -this.tile), this.unproject(this.width + this.tile, -this.tile), this.unproject(-this.tile, this.height + this.tile), this.unproject(this.width + this.tile, this.height + this.tile)];
    const minX = clamp(Math.floor(Math.min(...corners.map(point => point.x))), 0, world.width - 1), maxX = clamp(Math.ceil(Math.max(...corners.map(point => point.x))), 0, world.width - 1);
    const minY = clamp(Math.floor(Math.min(...corners.map(point => point.y))), 0, world.height - 1), maxY = clamp(Math.ceil(Math.max(...corners.map(point => point.y))), 0, world.height - 1);
    if (this.overviewTerrain && (this.overview || this.tile < 16)) {
      const anchor = this.project({ x: -.5, y: -.5 });
      c.drawImage(this.overviewTerrain, anchor.x - world.height * this.tile / 2, anchor.y, (world.width + world.height) * this.tile / 2, (world.width + world.height) * this.tile / 4);
    } else if (this.terrainTexture) {
      const anchor = this.project({ x: -.5, y: -.5 }), chunkSize = world.chunkSize;
      c.save(); c.transform(this.tile / 2, this.tile / 4, -this.tile / 2, this.tile / 4, anchor.x, anchor.y);
      const resolution = this.terrainTexture.width / world.width;
      for (let y = Math.floor(minY / chunkSize) * chunkSize; y <= maxY; y += chunkSize) for (let x = Math.floor(minX / chunkSize) * chunkSize; x <= maxX; x += chunkSize) {
        const width = Math.min(chunkSize, world.width - x), height = Math.min(chunkSize, world.height - y);
        c.drawImage(this.terrainTexture, x * resolution, y * resolution, width * resolution, height * resolution, x, y, width, height);
      }
      c.restore();
    }
    for (const [index, extract] of world.extracts.entries()) {
      const p = this.project(extract); this.polygon(this.quad(extract.x - .7, extract.y - .7, 1.4, 1.4), '#5b8d5655', '#a4cf76');
      const flagHeight = this.overview ? 12 : 40;
      c.strokeStyle = '#c3d991'; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - flagHeight); c.stroke();
      this.polygon([{ x: p.x, y: p.y - flagHeight }, { x: p.x + flagHeight * .6, y: p.y - flagHeight * .87 }, { x: p.x, y: p.y - flagHeight * .72 }], '#b2ce7e'); this.label(`ВЫХОД ${index + 1}`, p.x, p.y + (this.overview ? 12 : 21), '#cce5a2', this.overview ? 7 : 10);
    }
    const objects: { depth: number; paint: () => void }[] = [];
    for (const [index, obstacle] of world.obstacles.entries()) {
      if (obstacle.x + obstacle.width < minX || obstacle.x > maxX || obstacle.y + obstacle.height < minY || obstacle.y > maxY) continue;
      objects.push({ depth: obstacle.x + obstacle.y + (obstacle.width + obstacle.height) / 2, paint: () => this.obstacle(obstacle, index) });
    }
    for (const drop of snapshot.drops) objects.push({ depth: drop.x + drop.y, paint: () => this.paintContainer(drop) });
    this.hitTargets = [];
    for (const entity of snapshot.entities) objects.push({ depth: entity.x + entity.y + .1, paint: () => this.paintEntity(entity, now) });
    objects.sort((a, b) => a.depth - b.depth).forEach(object => object.paint());
    this.paintLandmarks(world);
    this.paintWaypoints(world);
    this.paintCombat(now);
    this.minimap(snapshot);
  }
  private paintLandmarks(world: LiveWorld): void {
    const c = this.context, small = this.overview || this.tile < 12;
    const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
    const placeLabel = (name: string, point: LivePoint, size: number, color: string): void => {
      c.font = `600 ${size}px Manrope, sans-serif`;
      const width = c.measureText(name).width + 10, height = size + 8;
      for (const offset of [0, -14, 15, -29, 30]) {
        const box = { x: point.x - width / 2, y: point.y + offset - size - 4, width, height };
        if (box.x < 5 || box.x + width > this.width - 5 || box.y < 45 || box.y + height > this.height - 35 || boxes.some(other => box.x < other.x + other.width && box.x + width > other.x && box.y < other.y + other.height && box.y + height > other.y)) continue;
        boxes.push(box); this.label(name, point.x, point.y + offset, color, size); return;
      }
    };
    if (small) for (const district of world.districts) {
      const p = this.project({ x: district.x + district.width / 2, y: district.y + district.height / 2 });
      placeLabel(district.name.toUpperCase(), { x: p.x, y: p.y - 24 }, this.width < 480 ? 11 : 14, '#e5e8c2');
    }
    const pois = [...world.pois].sort((a, b) => Number(this.routePoiIds.includes(b.id)) - Number(this.routePoiIds.includes(a.id)) || b.danger - a.danger || b.width * b.height - a.width * a.height);
    let labelCount = 0;
    for (const poi of pois) {
      const p = this.project({ x: poi.x + poi.width / 2, y: poi.y + poi.height / 2 }), chosen = this.routePoiIds.includes(poi.id);
      if (p.x < -60 || p.x > this.width + 60 || p.y < -30 || p.y > this.height + 30) continue;
      if (small) {
        c.fillStyle = chosen ? '#f2d596' : poi.danger === 3 ? '#d6a17c' : '#c2ca95'; c.fillRect(p.x - 2, p.y - 2, 4, 4);
        if (chosen || this.width >= 480 && labelCount < 12) { placeLabel(poi.name, { x: p.x, y: p.y + 13 }, chosen ? 10 : 8, chosen ? '#f2dfb1' : '#c5d3b0'); labelCount++; }
      } else if (this.tile > 30) placeLabel(poi.name, p, chosen ? 11 : 9, chosen ? '#f2dfb1' : '#d6d3ac');
    }
  }
  private paintWaypoints(world: LiveWorld): void {
    const c = this.context; this.waypointTargets = [];
    for (const [index, id] of this.routePoiIds.entries()) {
      const point = world.pois.find(poi => poi.id === id)?.entrances[0];
      if (!point) continue;
      const p = this.project(point);
      if (p.x < -20 || p.x > this.width + 20 || p.y < -20 || p.y > this.height + 20) continue;
      c.beginPath(); c.arc(p.x, p.y, this.overview ? 9 : 11, 0, Math.PI * 2); c.fillStyle = '#e8ce90'; c.fill(); c.strokeStyle = '#2a3a24'; c.lineWidth = 2; c.stroke();
      c.font = '800 10px Manrope, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#23331f'; c.fillText(String(index + 1), p.x, p.y + 3.5);
      this.waypointTargets.push({ point, x: p.x, y: p.y });
    }
  }
  private paintCombat(now: number): void {
    this.effects = this.effects.filter(effect => now - effect.at < 850);
    const c = this.context;
    for (const { event, at } of this.effects) {
      if (!event.from || !event.to) continue;
      const age = now - at, from = this.project(event.from, this.overview ? 3 : 27 * this.zoom), to = this.project(event.to, this.overview ? 3 : 27 * this.zoom);
      c.save(); c.globalAlpha = Math.max(0, 1 - age / 850);
      if (age < 280) { c.strokeStyle = event.actorId === this.snapshot?.selfId ? '#ffe3a6' : '#e9b878'; c.lineWidth = this.overview ? 1 : 2; c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(to.x, to.y); c.stroke(); }
      c.fillStyle = '#f0b876'; c.beginPath(); c.arc(to.x, to.y, this.overview ? 2 : 4, 0, Math.PI * 2); c.fill();
      if (!this.overview && event.damage) this.label(`−${Math.round(event.damage)}`, to.x, to.y - 15 - age / 55, '#f4c497', 12);
      c.restore();
    }
  }
  private paintEntity(entity: LiveEntity, now: number): void {
    const snapshot = this.snapshot!, motion = this.motions.get(entity.id)!, point = this.interpolated(motion, now), p = this.project(point), c = this.context;
    if (p.x < -40 || p.x > this.width + 40 || p.y < -50 || p.y > this.height + 100) return;
    const own = entity.id === snapshot.selfId, selected = entity.id === this.selected, color = own ? '#f2d49a' : entity.kind === 'player' ? '#8dd5e4' : entity.faction === 'raiders' ? '#e48971' : '#d2a082';
    if (this.overview || this.tile < 28) {
      c.fillStyle = color; c.strokeStyle = '#15241a'; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, own || selected ? 4.5 : 2.8, 0, Math.PI * 2); c.fill(); c.stroke();
      if (entity.aimUntil && entity.aimUntil > snapshot.now && entity.aimTargetId === snapshot.selfId) this.label('ЦЕЛИТСЯ В ТЕБЯ', p.x, p.y - 14, '#fac09b', 8);
      if (own || selected) this.label(own ? 'ТЫ' : entity.name, p.x, p.y - 10, color, 9);
      this.hitTargets.push({ entity, x: p.x, y: p.y }); return;
    }
    const zoom = this.tile / (this.width < 480 ? 44 : 54);
    c.beginPath(); c.ellipse(p.x, p.y, 13 * zoom, 6 * zoom, 0, 0, Math.PI * 2); c.fillStyle = '#0005'; c.fill();
    if (own || selected) { c.strokeStyle = color; c.lineWidth = 2; c.stroke(); }
    const atlas = this.atlases.get(entity.appearance) ?? this.atlases.get(entity.appearance % 4);
    const walking = entity.action === 'moving' && now - motion.at < 650;
    const pose = walking ? Math.floor(now / 190) % 2 ? 'walk-a' : 'walk-b' : entity.action === 'combat' ? 'work' : 'idle';
    const frame = atlas?.frames[`${pose}-${motion.direction}`] ?? atlas?.frames['idle-se'];
    const scale = 66 * zoom / 360;
    c.save(); if (entity.health <= 0) { c.globalAlpha = .45; c.translate(p.x, p.y); c.rotate(-Math.PI / 2); c.translate(-p.x, -p.y); }
    if (atlas && frame) c.drawImage(atlas.image, frame.frame.x, frame.frame.y, frame.frame.w, frame.frame.h, p.x + (frame.spriteSourceSize.x - frame.sourceSize.w * .5) * scale, p.y + (frame.spriteSourceSize.y - 480) * scale, frame.frame.w * scale, frame.frame.h * scale);
    else { c.fillStyle = color; c.fillRect(p.x - 7, p.y - 34, 14, 27); c.beginPath(); c.arc(p.x, p.y - 39, 6, 0, Math.PI * 2); c.fill(); }
    c.restore();
    const top = p.y - 70 * zoom;
    this.label(own ? `ТЫ · ${entity.name}` : entity.name, p.x, top, color, own ? 11 : 10);
    this.label(entity.kind === 'player' ? own ? 'ТВОЙ БОЕЦ' : 'ИГРОК' : entity.faction === 'raiders' ? 'РЕЙДЕР · NPC' : 'ДИКИЙ · NPC', p.x, top + 13, own ? '#e8d8b6' : entity.kind === 'player' ? '#90c4ce' : '#ad9b88', 7);
    c.fillStyle = '#14271a'; c.fillRect(p.x - 17, top + 18, 34, 3); c.fillStyle = entity.health > 35 ? '#b6cc85' : '#e09d82'; c.fillRect(p.x - 17, top + 18, 34 * entity.health / 100, 3);
    if (entity.safeUntil > snapshot.now) this.label('ЗАЩИТА', p.x, p.y + 20, '#bddbb7', 8);
    if (entity.aimUntil && entity.aimUntil > snapshot.now) {
      c.strokeStyle = '#f2a07f'; c.lineWidth = 2; c.beginPath(); c.ellipse(p.x, p.y, 18 * zoom, 9 * zoom, 0, 0, Math.PI * 2); c.stroke();
      this.label(entity.aimTargetId === snapshot.selfId ? 'ЦЕЛИТСЯ В ТЕБЯ' : 'ПРИЦЕЛИВАЕТСЯ', p.x, p.y + 22, '#fac09b', 8);
    } else if (entity.bleeding || entity.limping) this.label(entity.bleeding ? 'КРОВОТЕЧЕНИЕ' : 'ХРОМАЕТ', p.x, p.y + 22, '#e4b19a', 7);
    // A firing cue is brief and tied to a confirmed combat update.
    if (entity.action === 'combat' && now - motion.at < 300) { c.fillStyle = '#f2bc72'; c.beginPath(); c.arc(p.x + 16, p.y - 30, 2 + Math.sin(now / 65) * 1.5, 0, Math.PI * 2); c.fill(); }
    this.hitTargets.push({ entity, x: p.x, y: p.y });
  }
  private minimapBounds(snapshot: LiveSnapshot): { x: number; y: number; width: number; height: number; scale: number } {
    const scale = Math.min(this.width < 480 ? 2.1 : 2.5, (this.width * .28) / snapshot.world.width, (this.height * .22) / snapshot.world.height);
    const width = snapshot.world.width * scale, height = snapshot.world.height * scale;
    return { x: this.width - width - 16, y: 62, width, height, scale };
  }
  private minimap(snapshot: LiveSnapshot): void {
    const c = this.context, { x, y, scale, width, height } = this.minimapBounds(snapshot);
    c.fillStyle = '#14241fe6'; c.fillRect(x - 8, y - 8, width + 16, height + 29); c.strokeStyle = '#7c8c6166'; c.strokeRect(x - 8, y - 8, width + 16, height + 29);
    if (this.terrainTexture) c.drawImage(this.terrainTexture, x, y, width, height);
    for (const obstacle of snapshot.world.obstacles) { if (obstacle.kind === 'water' || obstacle.kind === 'tree') continue; c.fillStyle = obstacle.kind === 'building' ? '#bab7a088' : '#9b9e7c88'; c.fillRect(x + obstacle.x * scale, y + obstacle.y * scale, obstacle.width * scale, obstacle.height * scale); }
    for (const extract of snapshot.world.extracts) { c.fillStyle = '#a9d380'; c.fillRect(x + extract.x * scale - 2, y + extract.y * scale - 2, 4, 4); }
    for (const poi of snapshot.world.pois) { c.fillStyle = poi.danger === 3 ? '#b78665' : '#a6af84'; c.fillRect(x + (poi.x + poi.width / 2) * scale - 1, y + (poi.y + poi.height / 2) * scale - 1, 2, 2); }
    for (const [index, id] of this.routePoiIds.entries()) {
      const point = snapshot.world.pois.find(poi => poi.id === id)?.entrances[0];
      if (!point) continue;
      const px = x + point.x * scale, py = y + point.y * scale;
      c.fillStyle = '#e8ce90'; c.beginPath(); c.arc(px, py, 3.5, 0, Math.PI * 2); c.fill(); c.fillStyle = '#24321f'; c.textAlign = 'center'; c.font = '700 6px Manrope, sans-serif'; c.fillText(String(index + 1), px, py + 2);
    }
    for (const entity of snapshot.entities) { c.fillStyle = entity.id === snapshot.selfId ? '#ffe0a4' : entity.kind === 'player' ? '#81d0e3' : entity.faction === 'raiders' ? '#e48971' : '#ce9778'; c.beginPath(); c.arc(x + entity.x * scale, y + entity.y * scale, entity.id === snapshot.selfId ? 2.8 : 1.6, 0, Math.PI * 2); c.fill(); }
    this.label(snapshot.world.name.toUpperCase(), x + width / 2, y + height + 14, '#a9b596', 8);
  }
  private loadAtlas(appearance: number): void {
    if (this.atlases.has(appearance)) return;
    this.atlases.set(appearance, null);
    const image = new Image();
    const ready = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = `/art/scav-isometric-${appearance}.png`; });
    void Promise.all([ready, fetch(`/art/scav-isometric-${appearance}.json`).then(response => { if (!response.ok) throw new Error('Atlas unavailable'); return response.json() as Promise<{ frames: Record<string, AtlasFrame> }>; })]).then(([, value]) => { this.atlases.set(appearance, { image, frames: value.frames }); }).catch(() => { if (appearance >= 4) this.loadAtlas(appearance % 4); });
  }
}
