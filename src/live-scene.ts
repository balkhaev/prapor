import { LIVE_TERRAIN_CODES, type LiveCityBuilding, type LiveCommand, type LiveDrop, type LiveEntity, type LiveEvent, type LiveLandscapePath, type LiveObstacle, type LivePoint, type LiveSnapshot, type LiveTerrain, type LiveWorld, type LiveWorldProp } from './game/live';
import { scavDirection, type ScavDirection } from './scav-isometric';
import { liveDropLabel, liveLootTotals } from './live-loot-ui';
import { getBoss } from './game/bosses';
import { WEAPON_BY_ID } from './game/data';
import { bossWeapon } from './boss-ui';
import { weaponActorArt } from './armory-art';
import { BuildingMaterialArt, buildingNeedsCutaway, buildingPalette, PropArtCache, SceneryIndex } from './live-map-art';
import { buildSurfaceMasks, paintRoadSurface, paintTerrainTexture, terrainTextureResolution, type SurfaceMasks } from './live-ground-art';

type AtlasFrame = { frame: { x: number; y: number; w: number; h: number }; spriteSourceSize: { x: number; y: number; w: number; h: number }; sourceSize: { w: number; h: number } };
type Atlas = { image: HTMLImageElement; frames: Record<string, AtlasFrame> };
type Motion = { from: LivePoint; to: LivePoint; at: number; direction: ScavDirection };
type LabelBox = { x: number; y: number; width: number; height: number };
type StaticScenery = LivePoint & { width: number; height: number; depth: number } & ({ type: 'obstacle'; index: number; obstacle: LiveObstacle } | { type: 'prop'; prop: LiveWorldProp } | { type: 'architecture'; building: LiveCityBuilding });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const siteKinds = { courtyard: 'ДВОР', arcade: 'СКВОЗНОЙ ПРОХОД', workyard: 'МАСТЕРСКИЕ', 'service-yard': 'СЛУЖЕБНЫЙ ДВОР' } as const;

/** A presentation only: interpolation ends at the last confirmed server position. */
export class LiveScene {
  private canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private overlayObserver: MutationObserver;
  private overlayBounds: LabelBox[] = [];
  private overlayBoundsDirty = true;
  private snapshot: LiveSnapshot | null = null;
  private motions = new Map<string, Motion>();
  private atlases = new Map<number, Atlas | null>();
  private bossWeapons = new Map<string, HTMLImageElement | null>();
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
  private cityOverview = false;
  private dragging: { id: number; startX: number; startY: number; camera: LivePoint; moved: boolean } | null = null;
  private ignoreClickUntil = 0;
  private effects: { event: LiveEvent; at: number }[] = [];
  private seenEvents = new Set<string>();
  private terrain: LiveTerrain[] = [];
  private overviewTerrain: HTMLCanvasElement | null = null;
  private minimapTerrain: HTMLCanvasElement | null = null;
  private terrainTexture: HTMLCanvasElement | null = null;
  private walkableGround = new Uint8Array();
  private buildingForObstacle = new Map<number, LiveCityBuilding>();
  private scenery = new SceneryIndex<StaticScenery>([]);
  private propArt = new PropArtCache();
  private buildingArt = new BuildingMaterialArt();
  private cutawayBuildings = new Set<string>();
  private surfaceMasks: SurfaceMasks = { road: new Uint8Array(), indoor: new Uint8Array(), roadRuns: [] };

  constructor(private host: HTMLElement, _command: (command: LiveCommand) => void, private select: (id: string) => void) {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    this.context = context;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Карта рейда. Боец действует автоматически. Выбери бойца для наблюдения, потяни карту для обзора. Колесо мыши меняет масштаб.');
    this.canvas.setAttribute('role', 'application');
    this.controls.className = 'live-camera';
    this.controls.innerHTML = '<button data-live-zoom="out" aria-label="Отдалить карту">−</button><button data-live-zoom="follow" aria-label="Следовать за своим бойцом">Боец</button><button data-live-zoom="overview" aria-label="Показать всю карту">Периметр</button><button data-live-zoom="city" aria-label="Показать город" hidden>Город</button><button data-live-zoom="in" aria-label="Приблизить карту">+</button>';
    host.append(this.canvas, this.controls);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.overlayObserver = new MutationObserver(() => { this.overlayBoundsDirty = true; });
    this.overlayObserver.observe(host, { childList: true, subtree: true, characterData: true });
    this.canvas.addEventListener('click', this.click);
    this.canvas.addEventListener('pointerdown', this.pointerDown);
    this.canvas.addEventListener('pointermove', this.pointerMove);
    this.canvas.addEventListener('pointerup', this.pointerUp);
    this.canvas.addEventListener('pointercancel', this.pointerCancel);
    this.canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.controls.addEventListener('click', this.zoomClick);
    this.resize();
  }

  show(): void { if (this.active) return; this.active = true; this.resize(); this.animate(); }
  hide(): void { this.active = false; cancelAnimationFrame(this.frame); this.frame = 0; }
  clear(): void { this.snapshot = null; this.motions.clear(); this.selected = null; this.routePoiIds = []; this.waypointTargets = []; this.hitTargets = []; this.effects = []; this.seenEvents.clear(); this.paint(); }
  setSelected(id: string | null): void { this.selected = id; }
  /** Inspect public architecture without issuing a movement command. */
  focusPoint(point: LivePoint): void {
    const world = this.snapshot?.world;
    if (!world || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= world.width || point.y >= world.height) return;
    this.camera = { ...point }; this.following = false; this.overview = false; this.cityOverview = false;
    this.zoom = this.width < 480 ? .75 : .85; this.waypointTargets = []; this.hitTargets = [];
    this.updateCameraControls(); this.canvas.focus({ preventScroll: true });
  }
  setRoute(poiIds: readonly string[]): void {
    if (poiIds.length === this.routePoiIds.length && poiIds.every((id, index) => id === this.routePoiIds[index])) return;
    this.routePoiIds = [...poiIds]; this.waypointTargets = [];
  }
  update(snapshot: LiveSnapshot): void {
    const at = performance.now();
    this.overlayBoundsDirty = true;
    if (this.snapshot?.worldVersion !== snapshot.worldVersion) { this.motions.clear(); this.effects = []; this.seenEvents.clear(); this.selected = null; this.routePoiIds = []; this.waypointTargets = []; this.hitTargets = []; this.following = true; this.overview = false; this.cityOverview = false; this.zoom = 1; this.dragging = null; this.canvas.classList.remove('is-dragging'); this.cacheTerrain(snapshot.world); }
    const cityButton = this.controls.querySelector<HTMLButtonElement>('[data-live-zoom=city]');
    if (cityButton) cityButton.hidden = !snapshot.world.city;
    for (const entity of snapshot.entities) {
      const existing = this.motions.get(entity.id);
      const from = existing && Math.hypot(entity.x - existing.to.x, entity.y - existing.to.y) <= 4 ? this.interpolated(existing, at) : { x: entity.x, y: entity.y };
      const shot = entity.action === 'combat' ? [...snapshot.events].reverse().find(event => event.actorId === entity.id && event.from && event.to && snapshot.now - event.at < 1500) : null;
      const facing = shot?.from && shot.to ? { x: shot.to.x - shot.from.x, y: shot.to.y - shot.from.y } : { x: entity.x - from.x, y: entity.y - from.y };
      const dx = facing.x - facing.y, dy = facing.x + facing.y;
      this.motions.set(entity.id, { from, to: { x: entity.x, y: entity.y }, at, direction: scavDirection(dx, dy, existing?.direction) });
      this.loadAtlas(entity.appearance);
      if(entity.bossId)this.loadBossWeapon(entity.bossId);
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
  destroy(): void { this.hide(); this.observer.disconnect(); this.overlayObserver.disconnect(); this.canvas.removeEventListener('click', this.click); this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('pointerup', this.pointerUp); this.canvas.removeEventListener('pointercancel', this.pointerCancel); this.canvas.removeEventListener('wheel', this.wheel); this.controls.removeEventListener('click', this.zoomClick); this.canvas.remove(); this.controls.remove(); }

  private resize(): void {
    const box = this.host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    this.width = box.width; this.height = box.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * ratio); this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.overlayBoundsDirty = true;
    this.paint();
  }
  private zoomClick = (event: MouseEvent): void => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-live-zoom]')?.dataset.liveZoom;
    if (!action) return;
    if (action === 'follow') { this.following = true; this.overview = false; this.cityOverview = false; this.zoom = 1; }
    else if (action === 'overview' || action === 'city' && this.snapshot?.world.city) { this.following = false; this.overview = true; this.cityOverview = action === 'city'; }
    else {
      const scale = this.overview && this.snapshot ? this.viewTile(this.snapshot.world) / (this.width < 480 ? 44 : 54) : this.zoom;
      if (this.overview && this.snapshot) { const frame = this.viewFrame(this.snapshot.world); this.camera = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }; }
      this.overview = false; this.cityOverview = false; this.zoom = clamp(scale * (action === 'in' ? 1.25 : .8), .02, 1.8);
    }
    this.waypointTargets = []; this.hitTargets = []; this.updateCameraControls();
    this.canvas.focus({ preventScroll: true });
  };
  private updateCameraControls(): void {
    this.controls.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.liveZoom === (this.overview ? this.cityOverview ? 'city' : 'overview' : this.following ? 'follow' : ''))));
  }
  private viewFrame(world: LiveWorld): LivePoint & { width: number; height: number } {
    return this.cityOverview && world.city ? world.city : { x: 0, y: 0, width: world.width, height: world.height };
  }
  private viewTile(world: LiveWorld): number {
    const frame = this.viewFrame(world);
    return this.overview ? Math.min(this.width * 1.8 / (frame.width + frame.height), Math.max(120, this.height - 95) * 3.6 / (frame.width + frame.height)) : (this.width < 480 ? 44 : 54) * this.zoom;
  }
  private click = (event: MouseEvent): void => {
    if (!this.snapshot || !this.active || performance.now() < this.ignoreClickUntil) return;
    this.canvas.focus({ preventScroll: true });
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const mini = this.minimapBounds(this.snapshot);
    if (x >= mini.x - 8 && x <= mini.x + mini.width + 8 && y >= mini.y - 8 && y <= mini.y + mini.height + 21) {
      if (x >= mini.x && x <= mini.x + mini.width && y >= mini.y && y <= mini.y + mini.height) this.focusPoint({ x: clamp((x - mini.x) / mini.scale, 0, this.snapshot.world.width - 1), y: clamp((y - mini.y) / mini.scale, 0, this.snapshot.world.height - 1) });
      return;
    }
    const target = [...this.hitTargets].reverse().find(target => this.tile < 28 ? Math.hypot(target.x - x, target.y - y) < 9 : Math.abs(target.x - x) < Math.max(14, 18 * this.zoom) && y >= target.y - Math.max(38, 62 * this.zoom) && y <= target.y + 10 * this.zoom);
    if (target && target.entity.id !== this.snapshot.selfId) { this.selected = target.entity.id; this.select(target.entity.id); return; }
    const waypoint = this.waypointTargets.find(target => Math.hypot(target.x - x, target.y - y) < 12);
    if (waypoint) { this.focusPoint(waypoint.point); return; }
    if (this.overview || this.tile < 16) this.focusPoint(this.unproject(x, y));
  };
  private wheel = (event: WheelEvent): void => {
    if (!this.active || !this.snapshot || !event.deltaY) return;
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const before = this.unproject(x, y);
    const base = this.width < 480 ? 44 : 54;
    this.zoom = clamp(this.viewTile(this.snapshot.world) / base * Math.exp(-clamp(event.deltaY, -120, 120) * .002), .02, 1.8);
    this.overview = false; this.cityOverview = false;
    if (!this.following) {
      this.tile = base * this.zoom;
      const after = this.unproject(x, y);
      this.camera = { x: clamp(this.camera.x + before.x - after.x, 0, this.snapshot.world.width - 1), y: clamp(this.camera.y + before.y - after.y, 0, this.snapshot.world.height - 1) };
    }
    this.waypointTargets = []; this.hitTargets = []; this.updateCameraControls();
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
    if (this.overview) { this.zoom = this.tile / (this.width < 480 ? 44 : 54); this.overview = false; this.cityOverview = false; }
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
    this.walkableGround = Uint8Array.from(this.terrain, terrain => Number(terrain !== 'water'));
    this.buildingForObstacle.clear();
    const buildings = world.citySites?.flatMap(site => site.buildings) ?? [];
    for (const [index, obstacle] of world.obstacles.entries()) {
      for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) this.walkableGround[y * world.width + x] = 0;
      const cx = obstacle.x + obstacle.width / 2, cy = obstacle.y + obstacle.height / 2;
      const building = buildings.find(building => cx >= building.x && cy >= building.y && cx < building.x + building.width && cy < building.y + building.height);
      if (building) this.buildingForObstacle.set(index, building);
    }
    const scenery: StaticScenery[] = [];
    for (const [index, obstacle] of world.obstacles.entries()) {
      if (obstacle.propId) continue;
      scenery.push({ ...obstacle, type: 'obstacle', index, obstacle, depth: obstacle.x + obstacle.y + (obstacle.width + obstacle.height) / 2 });
    }
    for (const prop of world.props ?? []) scenery.push({ ...prop, type: 'prop', prop, depth: prop.x + prop.y + (prop.width + prop.height) / 2 });
    for (const building of buildings) scenery.push({ ...building, type: 'architecture', building, depth: building.x + building.y + building.width + building.height - 1.1 });
    this.scenery = new SceneryIndex(scenery, world.chunkSize); this.propArt.clear(); this.buildingArt.clear(); this.cutawayBuildings.clear();
    this.surfaceMasks = buildSurfaceMasks(world, this.terrain, this.walkableGround);
    const texture = document.createElement('canvas'), resolution = terrainTextureResolution(world.width, world.height);
    texture.width = world.width * resolution; texture.height = world.height * resolution;
    const ground = texture.getContext('2d');
    if (ground) {
      paintTerrainTexture(ground, world, this.terrain, resolution);
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
      this.paintSiteGround(world, ground); this.paintLandscape(world, ground); this.paintGroundDetails(world, ground); ground.restore();
    }
    this.terrainTexture = texture;
    const minimap = document.createElement('canvas'); minimap.width = world.width * 4; minimap.height = world.height * 4;
    const map = minimap.getContext('2d');
    if (map) {
      map.drawImage(texture, 0, 0, minimap.width, minimap.height); map.save(); map.scale(4, 4);
      for (const obstacle of world.obstacles) {
        if (obstacle.kind === 'water' || obstacle.kind === 'tree' || obstacle.propId) continue;
        map.fillStyle = obstacle.kind === 'building' ? '#bab7a0b0' : '#9b9e7c99'; map.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      }
      for (const building of buildings) { map.fillStyle = buildingPalette(building)[2]; map.fillRect(building.x, building.y, building.width, building.height); map.strokeStyle = '#2e4b37bb'; map.lineWidth = .16; map.strokeRect(building.x, building.y, building.width, building.height); }
      for (const prop of world.props ?? []) {
        if (!prop.blocking && !['garden', 'playground', 'planter', 'tree', 'shrub'].includes(prop.kind)) continue;
        map.fillStyle = ['tree', 'shrub', 'garden', 'planter'].includes(prop.kind) ? '#47643a9a' : prop.kind === 'car' || prop.kind === 'van' || prop.kind === 'truck' ? '#a2ada097' : '#747f6aaa';
        map.fillRect(prop.x, prop.y, prop.width, prop.height);
      }
      map.restore();
    }
    this.minimapTerrain = minimap;
    const overview = document.createElement('canvas'); overview.width = (world.width + world.height) * 4; overview.height = (world.width + world.height) * 2;
    const overviewContext = overview.getContext('2d');
    if (overviewContext) { overviewContext.save(); overviewContext.transform(4, 2, -4, 2, world.height * 4, 0); overviewContext.drawImage(texture, 0, 0, world.width, world.height); overviewContext.restore(); }
    this.overviewTerrain = overview;
  }
  /** All surface marks are cached once; free ground remains free ground. */
  private paintGroundDetails(world: LiveWorld, c: CanvasRenderingContext2D): void {
    c.save(); c.lineCap = 'round';
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const material = this.terrain[y * world.width + x]!, hash = (Math.imul(x + 107, 73856093) ^ Math.imul(y + 29, 19349663)) >>> 0;
      const px = x + .15 + (hash % 89) / 130, py = y + .15 + ((hash >>> 10) % 89) / 130;
      if (!this.walkableGround[y * world.width + x] && material !== 'water' || hash % 3) continue;
      c.save(); c.beginPath(); c.rect(x, y, 1, 1); c.clip();
      if (material === 'concrete') {
        if (hash % 13 === 0) {
          c.strokeStyle = '#3c493d55'; c.lineWidth = .055;
          c.beginPath(); c.moveTo(px - .28, py + .31); c.lineTo(px - .03, py + .04); c.lineTo(px - .08, py - .17); c.lineTo(px + .16, py - .32); c.stroke();
        }
        if (hash % 47 === 0) { c.fillStyle = '#35433999'; c.fillRect(px - .19, py - .14, .38, .28); c.strokeStyle = '#c1bba07a'; c.lineWidth = .065; c.strokeRect(px - .19, py - .14, .38, .28); c.strokeStyle = '#71806a'; for (let stripe = -.12; stripe < .15; stripe += .09) { c.beginPath(); c.moveTo(px - .15, py + stripe); c.lineTo(px + .15, py + stripe); c.stroke(); } }
      } else if (material === 'road' && hash % 17 === 0) {
        c.fillStyle = '#20303645'; c.beginPath(); c.ellipse(px, py, .29, .18, (hash % 7) / 5, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#a5a69340'; c.lineWidth = .045; c.stroke();
      } else if (material === 'road' && hash % 31 === 0) {
        c.strokeStyle = '#24343a77'; c.lineWidth = .055; c.beginPath(); c.moveTo(px - .3, py - .3); c.lineTo(px - .05, py - .06); c.lineTo(px + .04, py + .07); c.lineTo(px + .31, py + .19); c.moveTo(px - .05, py - .06); c.lineTo(px + .15, py - .19); c.stroke();
      } else if ((material === 'yard' || material === 'path') && hash % 11 === 0) {
        c.strokeStyle = '#665b3959'; c.lineWidth = .09; c.beginPath(); c.moveTo(px - .3, py - .36); c.quadraticCurveTo(px - .11, py, px + .16, py + .35); c.moveTo(px - .07, py - .36); c.quadraticCurveTo(px + .12, py, px + .39, py + .35); c.stroke();
      } else if (material === 'water' && hash % 3 === 0) {
        c.strokeStyle = '#b5d8cf33'; c.lineWidth = .055; c.beginPath(); c.moveTo(px - .33, py); c.quadraticCurveTo(px, py - .09, px + .33, py); c.stroke();
      } else if (material === 'sand' && hash % 5 === 0) {
        c.fillStyle = '#68683b38'; c.fillRect(px, py, .1, .06); c.fillStyle = '#d3cf9c70'; c.fillRect(px + .15, py - .12, .06, .06);
      } else if ((material === 'grass' || material === 'forest') && hash % 11 === 0) {
        c.fillStyle = material === 'forest' ? '#abc18130' : '#d8d09866'; c.fillRect(px, py, .045, .06); c.fillRect(px + .09, py - .08, .035, .05);
      }
      c.restore();
    }
    // Cast shadows share the authoritative cover's footprint and never add scenery.
    c.fillStyle = '#10271e38';
    for (const obstacle of world.obstacles) {
      if (obstacle.kind === 'water') continue;
      if (obstacle.kind === 'tree') { c.beginPath(); c.ellipse(obstacle.x + .95, obstacle.y + .55, 1.2, .7, -.5, 0, Math.PI * 2); c.fill(); continue; }
      const length = obstacle.kind === 'building' ? 1.8 : .5;
      c.beginPath(); c.moveTo(obstacle.x, obstacle.y); c.lineTo(obstacle.x + obstacle.width, obstacle.y); c.lineTo(obstacle.x + obstacle.width + length, obstacle.y + obstacle.height + length * .3); c.lineTo(obstacle.x + length, obstacle.y + obstacle.height + length * .3); c.closePath(); c.fill();
    }
    c.restore();
  }
  /** The cutaway floor is clipped to the same free cells as the server geometry. */
  private paintSiteGround(world: LiveWorld, c: CanvasRenderingContext2D): void {
    const sites = world.citySites ?? [];
    if (!sites.length) return;
    c.save(); c.beginPath();
    const included = new Set<number>();
    for (const site of sites) for (let y = site.y; y < site.y + site.height; y++) for (let x = site.x; x < site.x + site.width; x++) {
      const index = y * world.width + x;
      if (this.walkableGround[index] && !included.has(index)) { c.rect(x, y, 1, 1); included.add(index); }
    }
    c.clip();
    const floorColors: Record<LiveCityBuilding['kind'], string> = { apartment: '#b8a68eaa', shop: '#a6ae94aa', workshop: '#879ca0b8', garage: '#87908aba', service: '#babda9b8' };
    for (const site of sites) {
      const courtyard = site.courtyard;
      c.fillStyle = site.kind === 'workyard' ? '#91877860' : site.kind === 'service-yard' ? '#a5ad8b50' : '#b6ab8750';
      c.fillRect(courtyard.x, courtyard.y, courtyard.width, courtyard.height);
      c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = '#d3c79855'; c.lineWidth = .65;
      for (const path of site.passages) { c.beginPath(); path.forEach((point, index) => index ? c.lineTo(point.x + .5, point.y + .5) : c.moveTo(point.x + .5, point.y + .5)); c.stroke(); }
      for (const building of site.buildings) {
        c.fillStyle = floorColors[building.kind]; c.fillRect(building.x, building.y, building.width, building.height);
        const inset = .7;
        c.strokeStyle = '#dfd8b246'; c.lineWidth = .06; c.strokeRect(building.x + inset, building.y + inset, building.width - inset * 2, building.height - inset * 2);
        c.strokeStyle = '#35423d27'; c.lineWidth = .045; c.beginPath();
        for (let x = building.x + 2; x < building.x + building.width; x += 2) { c.moveTo(x, building.y); c.lineTo(x, building.y + building.height); }
        for (let y = building.y + 2; y < building.y + building.height; y += 2) { c.moveTo(building.x, y); c.lineTo(building.x + building.width, y); }
        c.stroke();
        c.fillStyle = '#e0ce9299';
        for (const entry of building.entrances) c.fillRect(entry.x + .2, entry.y + .2, .6, .6);
        if (building.kind === 'workshop' || building.kind === 'garage') {
          c.strokeStyle = '#6a746447'; c.lineWidth = .2; c.beginPath(); c.moveTo(building.x + 1.5, building.y + 1); c.lineTo(building.x + 1.5, building.y + building.height - 1); c.moveTo(building.x + building.width - 1.5, building.y + 1); c.lineTo(building.x + building.width - 1.5, building.y + building.height - 1); c.stroke();
        } else {
          c.fillStyle = '#d4c09a35'; c.fillRect(building.x + building.width * .3, building.y + building.height * .3, building.width * .4, building.height * .4);
        }
      }
    }
    c.restore();
  }
  private paintDoorways(world: LiveWorld): void {
    if (this.overview || this.tile < 24) return;
    for (const site of world.citySites ?? []) for (const building of site.buildings) for (const entry of building.entrances) {
      if (!this.walkableGround[entry.y * world.width + entry.x]) continue;
      const point = this.project(entry);
      if (point.x < -10 || point.x > this.width + 10 || point.y < -10 || point.y > this.height + 10) continue;
      this.polygon(this.quad(entry.x - .24, entry.y - .24, .48, .48), '#e5d79b66', '#e9d9a6');
    }
  }
  private paintProp(prop: LiveWorldProp): void {
    if (this.tile < 9 && ['lamp', 'sign', 'hydrant', 'bollard', 'barrel', 'workbench', 'bench', 'crate', 'pallet', 'shrub'].includes(prop.kind)) return;
    const anchor = this.project({ x: prop.x - .5, y: prop.y - .5 }), scale = this.tile / 54;
    const sprite = this.propArt.get(prop);
    this.context.drawImage(sprite.image, anchor.x - sprite.anchor.x * scale, anchor.y - sprite.anchor.y * scale, sprite.image.width * scale, sprite.image.height * scale);
  }
  private paintMaterialFace(image: HTMLCanvasElement, a: LivePoint, b: LivePoint, d: LivePoint): void {
    const c = this.context;
    c.save(); c.transform((b.x - a.x) / image.width, (b.y - a.y) / image.width, (d.x - a.x) / image.height, (d.y - a.y) / image.height, a.x, a.y);
    c.drawImage(image, 0, 0); c.restore();
  }
  /** Exterior silhouettes have real height; confirmed activity opens the roof and front walls. */
  private paintBuilding(building: LiveCityBuilding): void {
    const c = this.context, x = building.x - .5, y = building.y - .5, w = building.width, h = building.height;
    const floors = building.floors ?? (building.kind === 'apartment' ? 2 : 1), colors = buildingPalette(building);
    const height = this.tile * (.62 + floors * .54), base = this.quad(x, y, w, h), top = this.quad(x, y, w, h, height);
    if (this.cutawayBuildings.has(building.id) && this.tile >= 14) {
      // An open roof is a presentation of the existing room, never an extra walkable surface.
      c.strokeStyle = '#d0c6a36b'; c.lineWidth = Math.max(1, this.tile * .025); c.beginPath();
      base.forEach((point, index) => index ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y)); c.closePath(); c.stroke();
      return;
    }
    this.polygon([base[1]!, base[2]!, top[2]!, top[1]!], colors[0], '#263a327a');
    this.polygon([base[2]!, base[3]!, top[3]!, top[2]!], colors[1], '#213c3388');
    this.polygon(top, colors[2], '#c5c4a272');
    if (this.tile < 14) return;
    const seed = [...building.id].reduce((sum, char) => Math.imul(sum, 31) + char.charCodeAt(0), 0) >>> 0;
    for (const [a, b, length] of [[base[3]!, base[2]!, w], [base[2]!, base[1]!, h]] as const) {
      if (this.tile >= 24) this.paintMaterialFace(this.buildingArt.facade(building, length), { x: a.x, y: a.y - height }, { x: b.x, y: b.y - height }, a);
      this.facade(a, b, height, length, floors, seed);
      c.strokeStyle = '#d2cbb158'; c.lineWidth = Math.max(1, this.tile * .03); c.beginPath(); c.moveTo(a.x, a.y - height + 3); c.lineTo(b.x, b.y - height + 3); c.stroke();
      c.strokeStyle = '#33473db3'; c.lineWidth = Math.max(1, this.tile * .065); c.beginPath(); c.moveTo(a.x, a.y - this.tile * .08); c.lineTo(b.x, b.y - this.tile * .08); c.stroke();
    }
    const roof = building.roof ?? (building.kind === 'workshop' ? 'sawtooth' : building.kind === 'apartment' ? 'gable' : 'flat');
    if (roof === 'gable') {
      const ridgeA = this.project({ x, y: y + h / 2 }, height + this.tile * .42), ridgeB = this.project({ x: x + w, y: y + h / 2 }, height + this.tile * .42);
      this.polygon([top[0]!, top[1]!, ridgeB, ridgeA], building.facade === 'brick' ? '#8c8276' : '#909888', '#b7b79b66');
      this.polygon([ridgeA, ridgeB, top[2]!, top[3]!], building.facade === 'brick' ? '#5d6861' : '#5e7468', '#b7b79b66');
      if (this.tile >= 24) { const material = this.buildingArt.roof({ ...building, roof: 'gable' }, w, h / 2); this.paintMaterialFace(material, top[0]!, top[1]!, ridgeA); this.paintMaterialFace(material, ridgeA, ridgeB, top[3]!); }
      this.polygon([top[1]!, top[2]!, ridgeB], colors[0], '#273e3888');
      c.strokeStyle = '#253f367a'; c.lineWidth = .7;
      for (let t = .6 / w; t < 1; t += .65 / w) { const a = { x: ridgeA.x + (ridgeB.x - ridgeA.x) * t, y: ridgeA.y + (ridgeB.y - ridgeA.y) * t }, b = { x: top[3]!.x + (top[2]!.x - top[3]!.x) * t, y: top[3]!.y + (top[2]!.y - top[3]!.y) * t }; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    } else if (roof === 'sawtooth') {
      const count = Math.max(2, Math.round(h / 3)), band = h / count;
      for (let row = 0; row < count; row++) {
        const yy = y + row * band, upper = height + this.tile * .28;
        this.polygon([this.project({ x, y: yy }, upper), this.project({ x: x + w, y: yy }, upper), this.project({ x: x + w, y: yy + band }, height), this.project({ x, y: yy + band }, height)], row % 2 ? '#86998f' : '#a0aaa0', '#284d4155');
        if (this.tile >= 24) this.paintMaterialFace(this.buildingArt.roof({ ...building, roof: 'sawtooth' }, w, band), this.project({ x, y: yy }, upper), this.project({ x: x + w, y: yy }, upper), this.project({ x, y: yy + band }, height));
        this.polygon([this.project({ x, y: yy }, height), this.project({ x: x + w, y: yy }, height), this.project({ x: x + w, y: yy }, upper), this.project({ x, y: yy }, upper)], '#3a605b', '#c0c7ae55');
      }
    } else {
      if (this.tile >= 24) this.paintMaterialFace(this.buildingArt.roof({ ...building, roof: 'flat' }, w, h), top[0]!, top[1]!, top[3]!);
      const trim = this.quad(x + .14, y + .14, w - .28, h - .28, height + 2);
      c.strokeStyle = '#41574bc9'; c.lineWidth = Math.max(1, this.tile * .055); c.beginPath(); trim.forEach((point, index) => index ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y)); c.closePath(); c.stroke();
      for (let xx = x + 1; xx < x + w; xx += 2.4) { const a = this.project({ x: xx, y: y + .2 }, height + 1), b = this.project({ x: xx, y: y + h - .2 }, height + 1); c.strokeStyle = '#cbd0b026'; c.lineWidth = .7; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      const vent = this.quad(x + w * .28, y + h * .32, .8, .8, height + this.tile * .12); this.polygon(vent, '#b1b5a4', '#4d6457');
      const shadow = this.quad(x + w * .28, y + h * .32 + .2, 1.1, .8, height + 1); this.polygon(shadow, '#354d4155');
    }
    if (this.tile > 24) {
      const chimneyX = x + w * .72, chimneyY = y + h * .38, roofLift = roof === 'gable' ? this.tile * .34 : this.tile * .05;
      const lower = this.quad(chimneyX, chimneyY, .43, .43, height + roofLift), cap = this.quad(chimneyX, chimneyY, .43, .43, height + roofLift + this.tile * .3);
      this.polygon([lower[1]!, lower[2]!, cap[2]!, cap[1]!], '#897e66'); this.polygon([lower[2]!, lower[3]!, cap[3]!, cap[2]!], '#5a6150'); this.polygon(cap, '#c1bca4', '#1e392c88');
      for (const entry of building.entrances) {
        const frontY = Math.abs(entry.y - (building.y + h - 1)) < .5, frontX = Math.abs(entry.x - (building.x + w - 1)) < .5;
        if (!frontY && !frontX) continue;
        const a = this.project({ x: frontY ? entry.x - .5 : x + w, y: frontY ? y + h : entry.y - .5 }), b = this.project({ x: frontY ? entry.x + 1.5 : x + w, y: frontY ? y + h : entry.y + 1.5 });
        const doorHeight = this.tile * .73;
        this.polygon([a, b, { x: b.x, y: b.y - doorHeight }, { x: a.x, y: a.y - doorHeight }], '#253e35', '#bcb99888');
        c.strokeStyle = '#d4c4a255'; c.lineWidth = 1; c.beginPath(); c.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2); c.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2 - doorHeight); c.stroke();
        if (frontY) {
          for (let step = 0; step < 2; step++) this.polygon(this.quad(entry.x - .5, y + h + step * .22, 2, .22, (1 - step) * this.tile * .04), step ? '#939782' : '#b9b59a', '#3b554677');
          if (building.kind === 'shop' || building.kind === 'service') {
            const z = doorHeight + this.tile * .09; this.polygon(this.quad(entry.x - .7, y + h, 2.4, .65, z), building.kind === 'shop' ? '#79845f' : '#697e76', '#b7c2a766');
            c.strokeStyle = '#d4c3a290'; c.lineWidth = Math.max(1, this.tile * .025); const awning = this.quad(entry.x - .7, y + h + .65, 2.4, .01, z); c.beginPath(); c.moveTo(awning[0]!.x, awning[0]!.y); c.lineTo(awning[1]!.x, awning[1]!.y); c.stroke();
          }
        }
      }
    }
  }
  /** Presentation follows the server raster; no scenery changes collision or rewards. */
  private paintLandscape(world: LiveWorld, c: CanvasRenderingContext2D): void {
    const stroke = (path: LiveLandscapePath, color: string, width: number) => {
      c.beginPath(); path.points.forEach((point, index) => index ? c.lineTo(point.x + .5, point.y + .5) : c.moveTo(point.x + .5, point.y + .5)); c.strokeStyle = color; c.lineWidth = width; c.stroke();
    };
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    paintRoadSurface(c, world, this.terrain, this.surfaceMasks);
    // Roads may cross a river only on cells the authoritative raster marks as road.
    for (const kind of ['trail', 'rail', 'river'] as const) {
      const paths = world.paths?.filter(path => path.kind === kind) ?? [];
      if (!paths.length) continue;
      c.save();
      const accepted = kind === 'trail' ? ['path', 'sand', 'yard'] : kind === 'rail' ? ['rail'] : ['water'];
      c.beginPath();
      for (let y = 0; y < world.height; y++) {
        let start = -1;
        for (let x = 0; x <= world.width; x++) {
          const cell = y * world.width + x, include = x < world.width && accepted.includes(this.terrain[cell]!) && (kind === 'river' || !!this.walkableGround[cell] && !this.surfaceMasks.indoor[cell]);
          if (include && start < 0) start = x;
          else if (!include && start >= 0) { c.rect(start, y, x - start, 1); start = -1; }
        }
      }
      c.clip();
      for (const path of paths) {
        if (path.kind === 'trail') { stroke(path, '#655b3730', path.width * .9); stroke(path, '#d7bc7e33', path.width * .42); }
        else if (path.kind === 'river') { stroke(path, '#294d5a99', path.width * .82); stroke(path, '#82b9b13a', path.width * .4); }
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
      if (this.tile < 12) { c.fillStyle = index % 3 ? '#314c35' : '#526947'; c.beginPath(); c.ellipse(p.x, p.y - 2 * scale, Math.max(.6, 13 * scale), Math.max(.6, 9 * scale), 0, 0, Math.PI * 2); c.fill(); return; }
      c.fillStyle = '#10211966'; c.beginPath(); c.ellipse(p.x, p.y, 16 * scale, 8 * scale, 0, 0, Math.PI * 2); c.fill();
      const height = 42 + (obstacle.x * 7 + obstacle.y * 13) % 19;
      c.fillStyle = '#6e6850'; c.fillRect(p.x - 2 * scale, p.y - height * .65 * scale, 4 * scale, height * .65 * scale);
      if ((obstacle.x + obstacle.y * 3) % 5 === 0) {
        for (const [dx, dy, radius] of [[-9, -31, 13], [8, -36, 14], [0, -46, 13]]) { c.fillStyle = dy! < -40 ? '#65804d' : '#49683f'; c.beginPath(); c.ellipse(p.x + dx! * scale, p.y + dy! * scale, radius! * scale, radius! * .75 * scale, 0, 0, Math.PI * 2); c.fill(); }
      } else for (let tier = 0; tier < 3; tier++) { const y = p.y - (height * .32 + tier * height * .23) * scale, w = (20 - tier * 4) * scale; this.polygon([{ x: p.x - w, y }, { x: p.x, y: y - height * .48 * scale }, { x: p.x + w, y }], ['#314d34', '#476743', '#5c7549'][tier]!, '#263c2d'); }
      if (this.tile > 28) for (let leaf = 0; leaf < 9; leaf++) {
        const dy = (leaf % 3) * 11 + 20, dx = ((Math.imul(index + leaf, 397) >>> 0) % 21 - 10) * (1 - dy / 90);
        c.fillStyle = leaf % 2 ? '#a3af5e38' : '#243e3370'; c.beginPath(); c.ellipse(p.x + dx * scale, p.y - dy * scale, (2 + leaf % 3) * scale, 1.6 * scale, -.3, 0, Math.PI * 2); c.fill();
      }
      return;
    }
    const city = this.snapshot?.world.city;
    const architecture = this.buildingForObstacle.get(index);
    if (architecture && kind === 'wall' && !this.cutawayBuildings.has(architecture.id)) return;
    const urban = !!city && obstacle.x + obstacle.width / 2 >= city.x && obstacle.y + obstacle.height / 2 >= city.y && obstacle.x + obstacle.width / 2 < city.x + city.width && obstacle.y + obstacle.height / 2 < city.y + city.height;
    const elevation = this.tile * (kind === 'wall' ? architecture ? .58 : .65 : kind === 'barricade' ? .3 : kind === 'container' ? .7 : urban ? 1.4 + (index % 4) * .19 : 1.15);
    const base = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height), top = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height, elevation);
    const localPoi = this.snapshot?.world.pois.find(poi => obstacle.x >= poi.x && obstacle.y >= poi.y && obstacle.x < poi.x + poi.width && obstacle.y < poi.y + poi.height);
    const rural = !urban && (localPoi?.districtId === 'village' || localPoi?.districtId === 'sawmill');
    const colors = kind === 'container' ? [['#576e6c', '#345354', '#7b9086'], ['#92705b', '#664b3a', '#b59070'], ['#777955', '#4c523c', '#9b9a76']][index % 3]! : kind === 'barricade' ? ['#817452', '#62543d', '#aa9470'] : architecture ? buildingPalette(architecture) : kind === 'wall' ? rural ? ['#918066', '#6a5b44', '#b1a078'] : ['#81877a', '#596154', '#a0a28b'] : rural ? ['#988c69', '#6e6247', '#787a59'] : urban ? [['#8b8174', '#60594e', '#ada896'], ['#8c776c', '#665950', '#9d9e95'], ['#a3a08c', '#767967', '#b3b29c']][index % 3]! : ['#707b70', '#4e5e55', '#949684'];
    this.polygon([base[1]!, base[2]!, top[2]!, top[1]!], colors[0]!, '#acaf8644'); this.polygon([base[2]!, base[3]!, top[3]!, top[2]!], colors[1]!, '#84907666'); this.polygon(top, colors[2]!, '#b4b39177');
    if (this.tile < 12) return;
    // Masonry, sills and roof trim follow these exact collision faces.
    c.lineWidth = Math.max(.5, this.tile / 90); c.strokeStyle = '#e1d6ba66';
    c.beginPath(); c.moveTo(top[1]!.x, top[1]!.y + 2); c.lineTo(top[2]!.x, top[2]!.y + 2); c.lineTo(top[3]!.x, top[3]!.y + 2); c.stroke();
    c.strokeStyle = '#263b32aa'; c.beginPath(); c.moveTo(base[1]!.x, base[1]!.y - 3); c.lineTo(base[2]!.x, base[2]!.y - 3); c.lineTo(base[3]!.x, base[3]!.y - 3); c.stroke();
    if (kind === 'container') {
      c.strokeStyle = '#273c3a88'; c.lineWidth = 1;
      for (let fraction = .15; fraction < 1; fraction += .15) { const a = { x: top[1]!.x + (top[2]!.x - top[1]!.x) * fraction, y: top[1]!.y + (top[2]!.y - top[1]!.y) * fraction }, b = { x: base[1]!.x + (base[2]!.x - base[1]!.x) * fraction, y: base[1]!.y + (base[2]!.y - base[1]!.y) * fraction }; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      for (let fraction = .1; fraction < 1; fraction += .1) {
        const a = this.project({ x: obstacle.x - .5 + obstacle.width * fraction, y: obstacle.y - .5 }, elevation), b = this.project({ x: obstacle.x - .5 + obstacle.width * fraction, y: obstacle.y + obstacle.height - .5 }, elevation);
        c.strokeStyle = '#31463c88'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      }
      const a = base[3]!, b = base[2]!, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      c.strokeStyle = '#e0ccb080'; c.beginPath(); c.moveTo(mid.x, mid.y - elevation + 3); c.lineTo(mid.x, mid.y - 3); c.stroke();
      if (this.tile > 24) this.label(index % 3 ? 'ГРУЗ' : 'ОЖД', mid.x, mid.y - elevation * .4, '#d6d3b299', 7);
    } else if (kind === 'barricade') {
      if (obstacle.label?.includes('Верстак')) {
        c.strokeStyle = '#e3c79099'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(top[0]!.x, top[0]!.y); c.lineTo(top[2]!.x, top[2]!.y); c.moveTo(top[1]!.x, top[1]!.y); c.lineTo(top[3]!.x, top[3]!.y); c.stroke();
      } else {
        c.strokeStyle = '#263e3277'; c.lineWidth = Math.max(1, this.tile * .055);
        for (let stripe = .12; stripe < .95; stripe += .23) {
          const a = this.project({ x: obstacle.x - .5 + obstacle.width * stripe, y: obstacle.y + obstacle.height - .5 }, elevation * .9), b = this.project({ x: obstacle.x - .5 + obstacle.width * (stripe + .12), y: obstacle.y + obstacle.height - .5 }, elevation * .1);
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        }
      }
    } else if (kind === 'building') {
      if (rural || obstacle.width >= obstacle.height * 1.5) {
        const ridgeA = this.project({ x: obstacle.x - .5, y: obstacle.y + obstacle.height / 2 - .5 }, elevation + this.tile * .2), ridgeB = this.project({ x: obstacle.x + obstacle.width - .5, y: obstacle.y + obstacle.height / 2 - .5 }, elevation + this.tile * .2);
        this.polygon([top[0]!, top[1]!, ridgeB, ridgeA], rural ? '#96906d' : '#8c9480', '#aaa98d66');
        this.polygon([ridgeA, ridgeB, top[2]!, top[3]!], rural ? '#6e7553' : '#687463', '#aaa98d66');
        c.strokeStyle = '#354c3d99'; c.lineWidth = .8;
        for (let t = .12; t < 1; t += .13) {
          const ridge = { x: ridgeA.x + (ridgeB.x - ridgeA.x) * t, y: ridgeA.y + (ridgeB.y - ridgeA.y) * t }, edge = { x: top[3]!.x + (top[2]!.x - top[3]!.x) * t, y: top[3]!.y + (top[2]!.y - top[3]!.y) * t };
          c.beginPath(); c.moveTo(ridge.x, ridge.y); c.lineTo(edge.x, edge.y); c.stroke();
        }
      } else {
        c.strokeStyle = '#505a4b88'; c.beginPath(); c.moveTo(top[0]!.x, top[0]!.y); c.lineTo(top[2]!.x, top[2]!.y); c.stroke();
        const vent = this.quad(obstacle.x + obstacle.width * .25, obstacle.y + obstacle.height * .25, .7, .7, elevation + 3); this.polygon(vent, '#697662', '#b1b292');
        const inset = this.quad(obstacle.x - .32, obstacle.y - .32, Math.max(.2, obstacle.width - .36), Math.max(.2, obstacle.height - .36), elevation + 1);
        c.strokeStyle = '#44574ba6'; c.lineWidth = Math.max(1, this.tile * .04); c.beginPath(); inset.forEach((point, i) => i ? c.lineTo(point.x, point.y) : c.moveTo(point.x, point.y)); c.closePath(); c.stroke();
      }
      if (this.tile > 20) {
        this.facade(base[3]!, base[2]!, elevation, obstacle.width, urban ? 2 : 1, index);
        this.facade(base[2]!, base[1]!, elevation, obstacle.height, urban ? 2 : 1, index + 3);
        const chimneyX = obstacle.x + obstacle.width * .65, chimneyY = obstacle.y + obstacle.height * .32;
        const chimney = this.quad(chimneyX, chimneyY, .4, .4, elevation + this.tile * .32);
        const chimneyBase = this.quad(chimneyX, chimneyY, .4, .4, elevation + this.tile * .12);
        this.polygon([chimneyBase[1]!, chimneyBase[2]!, chimney[2]!, chimney[1]!], '#71664d'); this.polygon([chimneyBase[2]!, chimneyBase[3]!, chimney[3]!, chimney[2]!], '#524e3d'); this.polygon(chimney, '#b7aa8b', '#d7c7a080');
      }
    }
    if (architecture && kind === 'wall' && this.tile > 20 && obstacle.width >= 3) {
      const count = Math.min(6, Math.max(1, Math.floor(obstacle.width / 2)));
      for (let i = 0; i < count; i++) {
        const t = (i + 1) / (count + 1), x = base[3]!.x + (base[2]!.x - base[3]!.x) * t, y = base[3]!.y + (base[2]!.y - base[3]!.y) * t - elevation * .62;
        const width = this.tile * (architecture.kind === 'workshop' || architecture.kind === 'garage' ? .13 : .08);
        this.polygon([{ x: x - width, y: y - this.tile * .035 }, { x: x + width, y: y + this.tile * .035 }, { x: x + width, y: y + this.tile * .12 }, { x: x - width, y: y + this.tile * .05 }], '#324b438f', '#cbd1b18a');
      }
      if (architecture.kind === 'shop') this.polygon([top[3]!, top[2]!, { x: top[2]!.x, y: top[2]!.y + this.tile * .08 }, { x: top[3]!.x, y: top[3]!.y + this.tile * .08 }], '#73874c', '#c2c49a');
    }
    if (kind === 'wall' && this.tile > 24) {
      const a = base[3]!, b = base[2]!;
      c.strokeStyle = architecture?.kind === 'service' ? '#c8ccac40' : '#b9ac8b44'; c.lineWidth = .55;
      for (let course = 1; course <= 3; course++) {
        const lift = elevation * course / 4;
        c.beginPath(); c.moveTo(a.x, a.y - lift); c.lineTo(b.x, b.y - lift); c.stroke();
        for (let t = .1 + (course % 2) * .05; t < 1; t += .12) { const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t - lift; c.beginPath(); c.moveTo(px, py); c.lineTo(px, py + elevation / 4); c.stroke(); }
      }
      if (index % 4 === 0) {
        c.strokeStyle = '#315136b3'; c.lineWidth = Math.max(1, this.tile * .035); c.beginPath(); c.moveTo(a.x + 3, a.y); c.quadraticCurveTo(a.x + 8, a.y - elevation * .25, a.x + 6, a.y - elevation * .52); c.stroke();
      }
    }
    if (obstacle.label && !architecture && !this.overview && this.tile > 28) this.label(obstacle.label.toUpperCase(), p.x, p.y - elevation + 3, '#efe1b2', 8);
  }

  private facade(a: LivePoint, b: LivePoint, height: number, length: number, floors: number, seed: number): void {
    const c = this.context, columns = Math.min(10, Math.max(1, Math.floor(length / 1.7)));
    for (let floor = 0; floor < floors; floor++) {
      const y = height * (.2 + .6 * (floor + .5) / floors), windowHeight = Math.min(this.tile * .25, height * .43 / floors);
      if (floors > 1 && floor) { c.strokeStyle = '#b6ac9277'; c.lineWidth = 1; c.beginPath(); c.moveTo(a.x, a.y - height * .5); c.lineTo(b.x, b.y - height * .5); c.stroke(); }
      for (let column = 0; column < columns; column++) {
        const t = (column + .5) / columns, half = Math.min(.22 / columns, .1), left = { x: a.x + (b.x - a.x) * (t - half), y: a.y + (b.y - a.y) * (t - half) - y }, right = { x: a.x + (b.x - a.x) * (t + half), y: a.y + (b.y - a.y) * (t + half) - y };
        this.polygon([{ x: left.x, y: left.y - windowHeight / 2 }, { x: right.x, y: right.y - windowHeight / 2 }, { x: right.x, y: right.y + windowHeight / 2 }, { x: left.x, y: left.y + windowHeight / 2 }], (seed + floor * 7 + column) % 9 === 0 ? '#ab9c6480' : '#203d36', '#c5c4a377');
        c.lineWidth = .6; c.strokeStyle = '#aaa98a88'; c.beginPath(); c.moveTo((left.x + right.x) / 2, (left.y + right.y) / 2 - windowHeight / 2); c.lineTo((left.x + right.x) / 2, (left.y + right.y) / 2 + windowHeight / 2); c.stroke();
        if (column % 3 === seed % 3) { c.strokeStyle = '#17372955'; c.lineWidth = Math.max(1, this.tile * .03); c.beginPath(); c.moveTo(left.x - 2, left.y + windowHeight / 2); c.lineTo(left.x - 3, left.y + windowHeight / 2 + height * .15); c.stroke(); }
      }
    }
  }

  private paint(): void {
    const c = this.context, now = performance.now();
    c.clearRect(0, 0, this.width, this.height);
    const gradient = c.createRadialGradient(this.width * .5, this.height * .5, 20, this.width * .5, this.height * .5, this.width * .7);
    gradient.addColorStop(0, '#39443b'); gradient.addColorStop(1, '#101d18'); c.fillStyle = gradient; c.fillRect(0, 0, this.width, this.height);
    if (!this.snapshot) return;
    const snapshot = this.snapshot, self = snapshot.entities.find(entity => entity.id === snapshot.selfId);
    const frame = this.viewFrame(snapshot.world);
    this.tile = this.viewTile(snapshot.world);
    this.origin = { x: this.width * .5, y: this.height * (this.overview ? .54 : .58) };
    if (this.overview) this.camera = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
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
    this.paintDoorways(world);
    for (const [index, extract] of world.extracts.entries()) {
      const p = this.project(extract); this.polygon(this.quad(extract.x - .7, extract.y - .7, 1.4, 1.4), '#5b8d5655', '#a4cf76');
      const flagHeight = this.overview ? 12 : 40;
      c.strokeStyle = '#c3d991'; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - flagHeight); c.stroke();
      this.polygon([{ x: p.x, y: p.y - flagHeight }, { x: p.x + flagHeight * .6, y: p.y - flagHeight * .87 }, { x: p.x, y: p.y - flagHeight * .72 }], '#b2ce7e'); this.label(`ВЫХОД ${index + 1}`, p.x, p.y + (this.overview ? 12 : 21), '#cce5a2', this.overview ? 7 : 10);
    }
    const objects: { depth: number; paint: () => void }[] = [];
    const visible = this.scenery.visible({ x: minX - 7, y: minY - 7, width: maxX - minX + 14, height: maxY - minY + 14 });
    const activity: LivePoint[] = [...snapshot.drops];
    for (const entity of snapshot.entities) {
      activity.push(entity);
      const motion = this.motions.get(entity.id);
      if (motion) activity.push(motion.from, this.interpolated(motion, now));
    }
    this.cutawayBuildings.clear();
    for (const item of visible) if (item.type === 'architecture' && buildingNeedsCutaway(item.building, activity)) this.cutawayBuildings.add(item.building.id);
    for (const item of visible) objects.push({ depth: item.depth, paint: () => {
      if (item.type === 'obstacle') this.obstacle(item.obstacle, item.index);
      else if (item.type === 'prop') this.paintProp(item.prop);
      else this.paintBuilding(item.building);
    } });
    // Overview dots are navigation markers: roofs must never cover confirmed activity.
    const activityDepth = this.overview || this.tile < 14 ? world.width + world.height + 1 : 0;
    for (const drop of snapshot.drops) objects.push({ depth: drop.x + drop.y + activityDepth, paint: () => this.paintContainer(drop) });
    this.hitTargets = [];
    for (const entity of snapshot.entities) objects.push({ depth: entity.x + entity.y + activityDepth + .1, paint: () => this.paintEntity(entity, now) });
    objects.sort((a, b) => a.depth - b.depth).forEach(object => object.paint());
    this.paintIntent(snapshot, now);
    this.paintLandmarks(world);
    this.paintWaypoints(world);
    this.paintCombat(now);
    this.minimap(snapshot);
  }
  private paintLandmarks(world: LiveWorld): void {
    const c = this.context, small = this.overview || this.tile < 12;
    // UI rendering follows the snapshot update. Read its final layout on the next paint,
    // then reuse these bounds until the overlay changes or the viewport is resized.
    if (this.overlayBoundsDirty) {
      const canvas = this.canvas.getBoundingClientRect();
      this.overlayBounds = [...this.host.querySelectorAll<HTMLElement>('.live-field-hud, .live-field-legend, .live-auto-world-status, .live-camera')].flatMap(element => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return [];
        return [{ x: rect.left - canvas.left - 5, y: rect.top - canvas.top - 5, width: rect.width + 10, height: rect.height + 10 }];
      });
      this.overlayBoundsDirty = false;
    }
    const boxes: LabelBox[] = [...this.overlayBounds];
    if (this.snapshot) {
      const mini = this.minimapBounds(this.snapshot);
      boxes.push({ x: mini.x - 12, y: mini.y - 12, width: mini.width + 24, height: mini.height + 37 });
    }
    for (const id of this.routePoiIds) {
      const entrance = world.pois.find(poi => poi.id === id)?.entrances[0];
      if (!entrance) continue;
      const p = this.project(entrance), radius = (this.overview ? 9 : 11) + 4;
      boxes.push({ x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2 });
    }
    for (const target of this.hitTargets) {
      if (this.tile >= 28) {
        const scale = this.tile / (this.width < 480 ? 44 : 54);
        boxes.push({ x: target.x - 65, y: target.y - 82 * scale, width: 130, height: 82 * scale + 20 });
      } else {
        boxes.push({ x: target.x - 8, y: target.y - 8, width: 16, height: 16 });
        if (target.entity.id === this.snapshot?.selfId || target.entity.id === this.selected || target.entity.bossId) boxes.push({ x: target.x - 65, y: target.y - 25, width: 130, height: 19 });
      }
    }
    const placeLabel = (name: string, point: LivePoint, size: number, color: string, district = false): boolean => {
      c.font = `600 ${size}px Manrope, sans-serif`;
      const width = c.measureText(name).width + 10, height = size + 8;
      const offsets: readonly (readonly [number, number])[] = district ? [[0, 0], [0, -18], [0, 18], [0, -36], [0, 36], [0, -54], [0, 54], [-45, 0], [45, 0], [-45, -36], [45, -36], [-45, 36], [45, 36], [0, -72], [0, 72], [-72, 0], [72, 0]] : [[0, 0], [0, -14], [0, 15], [0, -29], [0, 30], [-45, 0], [45, 0]];
      for (const [dx, dy] of offsets) {
        const box = { x: point.x + dx - width / 2, y: point.y + dy - size - 4, width, height };
        if (box.x < 5 || box.x + width > this.width - 5 || box.y < 45 || box.y + height > this.height - 35 || boxes.some(other => box.x < other.x + other.width && box.x + width > other.x && box.y < other.y + other.height && box.y + height > other.y)) continue;
        boxes.push(box); this.label(name, point.x + dx, point.y + dy, color, size); return true;
      }
      return false;
    };
    if (small && world.city) {
      const p = this.project({ x: world.city.x + world.city.width / 2, y: world.city.y + world.city.height / 2 });
      placeLabel(world.city.name.toUpperCase(), { x: p.x, y: p.y - 25 }, this.width < 480 ? 15 : 18, '#f0dab0', true);
    }
    if (small) for (const district of world.districts) {
      const p = this.project(district.labelPoint ?? { x: district.x + district.width / 2, y: district.y + district.height / 2 });
      placeLabel(district.name.toUpperCase(), { x: p.x, y: p.y - 24 }, this.width < 480 ? 11 : 14, '#e5e8c2', true);
    }
    if (small && this.cityOverview && world.city) for (const quarter of world.city.quarters) {
      const p = this.project({ x: quarter.x + quarter.width / 2, y: quarter.y + quarter.height / 2 });
      placeLabel(quarter.name, { x: p.x, y: p.y - 16 }, this.width < 480 ? 9 : 11, '#e3d3b5', true);
    }
    const sitePoiIds = new Set<string>();
    if (!this.overview && this.tile >= 12) for (const site of world.citySites ?? []) {
      const p = this.project({ x: site.courtyard.x + site.courtyard.width / 2, y: site.courtyard.y + site.courtyard.height / 2 });
      if (p.x < -50 || p.x > this.width + 50 || p.y < -30 || p.y > this.height + 30) continue;
      sitePoiIds.add(site.poiId);
      if (this.tile < 24) { placeLabel(site.name, p, 9, '#e2d6b5'); continue; }
      placeLabel(`${siteKinds[site.kind]} · ${site.name}`, p, 10, '#eadcb6');
      for (const building of site.buildings) {
        const center = this.project({ x: building.x + building.width / 2, y: building.y + building.height / 2 });
        if (center.x >= 0 && center.x <= this.width && center.y >= 45 && center.y <= this.height - 35) placeLabel(building.name, center, 8, '#d6d7bd');
      }
    }
    const pois = [...world.pois].sort((a, b) => Number(this.routePoiIds.includes(b.id)) - Number(this.routePoiIds.includes(a.id)) || b.danger - a.danger || b.width * b.height - a.width * a.height);
    let labelCount = 0;
    for (const poi of pois) {
      const p = this.project({ x: poi.x + poi.width / 2, y: poi.y + poi.height / 2 }), chosen = this.routePoiIds.includes(poi.id);
      if (p.x < -60 || p.x > this.width + 60 || p.y < -30 || p.y > this.height + 30) continue;
      if (small) {
        c.fillStyle = chosen ? '#f2d596' : poi.danger === 3 ? '#d6a17c' : '#c2ca95'; c.fillRect(p.x - 2, p.y - 2, 4, 4);
        if ((chosen || this.width >= 480 && labelCount < 12) && placeLabel(poi.name, { x: p.x, y: p.y + 13 }, chosen ? 10 : 8, chosen ? '#f2dfb1' : '#c5d3b0')) labelCount++;
      } else if (this.tile > 30 && !sitePoiIds.has(poi.id)) placeLabel(poi.name, p, chosen ? 11 : 9, chosen ? '#f2dfb1' : '#d6d3ac');
    }
  }
  private paintWaypoints(world: LiveWorld): void {
    const c = this.context; this.waypointTargets = [];
    for (const [index, id] of this.routePoiIds.entries()) {
      const point = world.pois.find(poi => poi.id === id)?.entrances[0];
      if (!point) continue;
      const p = this.project(point);
      if (p.x < -20 || p.x > this.width + 20 || p.y < -20 || p.y > this.height + 20) continue;
      const done = !!this.snapshot?.self.automation?.enabled && index < this.snapshot.self.automation.stopIndex;
      c.beginPath(); c.arc(p.x, p.y, this.overview ? 9 : 11, 0, Math.PI * 2); c.fillStyle = done ? '#658477' : '#e8ce90'; c.fill(); c.strokeStyle = '#193b2f'; c.lineWidth = 2; c.stroke();
      c.font = '800 10px Manrope, sans-serif'; c.textAlign = 'center'; c.fillStyle = done ? '#d9e1c7' : '#23331f'; c.fillText(done ? '✓' : String(index + 1), p.x, p.y + 3.5);
      this.waypointTargets.push({ point, x: p.x, y: p.y });
    }
  }
  private paintIntent(snapshot: LiveSnapshot, now: number): void {
    const c = this.context, self = snapshot.entities.find(entity => entity.id === snapshot.selfId);
    if (self) {
      const motion = this.motions.get(self.id), point = this.project(motion ? this.interpolated(motion, now) : self), radius = Math.max(9, this.tile * .3);
      if (point.x > 0 && point.x < this.width && point.y > 0 && point.y < this.height) {
        c.save(); c.strokeStyle = '#f0d9a8'; c.lineWidth = 1.3; c.setLineDash([3, 4]); c.beginPath(); c.ellipse(point.x, point.y + 2, radius, radius * .48, 0, 0, Math.PI * 2); c.stroke(); c.restore();
      }
    }
    const auto = snapshot.self.automation;
    if (!auto?.enabled || !auto.target || auto.stage === 'complete' || auto.stage === 'downed') return;
    const p = this.project(auto.target), radius = Math.max(this.overview ? 7 : 11, this.tile * .25), color = auto.stage === 'extract' ? '#a9d9a7' : auto.stage === 'combat' ? '#ed997c' : '#e3c989';
    if (p.x < -30 || p.x > this.width + 30 || p.y < -30 || p.y > this.height + 30) return;
    c.save(); c.strokeStyle = color; c.lineWidth = 1.7; c.globalAlpha = .7 + Math.sin(now / 450) * .17;
    c.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(p.x + sx! * radius, p.y + sy! * radius * .65 - sy! * 5); c.lineTo(p.x + sx! * radius, p.y + sy! * radius * .65); c.lineTo(p.x + sx! * (radius - 5), p.y + sy! * radius * .65); }
    c.stroke(); c.restore();
    if (!this.overview && this.tile >= 20) this.label(auto.stage === 'extract' ? 'ЭВАКУАЦИЯ' : auto.stage === 'combat' ? 'КОНТАКТ' : 'ТЕКУЩАЯ ЦЕЛЬ', p.x, p.y - radius - 8, color, 8);
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
    const boss=entity.bossId?getBoss(entity.bossId):null;
    const own = entity.id === snapshot.selfId, selected = entity.id === this.selected, color = own ? '#f2d49a' : boss ? '#f0b267' : entity.kind === 'player' ? '#8dd5e4' : entity.faction === 'raiders' ? '#e48971' : '#d2a082';
    if (this.overview || this.tile < 28) {
      c.fillStyle = color; c.strokeStyle = '#15241a'; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, own || selected ? 4.5 : 2.8, 0, Math.PI * 2); c.fill(); c.stroke();
      if (entity.aimUntil && entity.aimUntil > snapshot.now && entity.aimTargetId === snapshot.selfId) this.label('ЦЕЛИТСЯ В ТЕБЯ', p.x, p.y - 14, '#fac09b', 8);
      if (own || selected || boss) this.label(own ? 'ТЫ' : boss?`БОСС · ${boss.name}`:entity.name, p.x, p.y - 10, color, 9);
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
    const bossGun=boss?this.bossWeapons.get(boss.id):null;
    if(bossGun&&entity.health>0){const gunWidth=38*zoom,gunHeight=gunWidth*bossGun.height/bossGun.width;c.drawImage(bossGun,p.x+3*zoom,p.y-34*zoom,gunWidth,gunHeight);}
    const top = p.y - 70 * zoom;
    this.label(own ? `ТЫ · ${entity.name}` : entity.name, p.x, top, color, own ? 11 : 10);
    this.label(boss?`БОСС · ${WEAPON_BY_ID[boss.weaponId]!.name}`:entity.kind === 'player' ? own ? 'ТВОЙ БОЕЦ' : 'ИГРОК' : entity.faction === 'raiders' ? 'РЕЙДЕР · NPC' : 'ДИКИЙ · NPC', p.x, top + 13, boss?'#e7bc86':own ? '#e8d8b6' : entity.kind === 'player' ? '#90c4ce' : '#ad9b88', 7);
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
    if (this.minimapTerrain ?? this.terrainTexture) c.drawImage((this.minimapTerrain ?? this.terrainTexture)!, x, y, width, height);
    for (const extract of snapshot.world.extracts) { c.fillStyle = '#a9d380'; c.fillRect(x + extract.x * scale - 2, y + extract.y * scale - 2, 4, 4); }
    for (const poi of snapshot.world.pois) { c.fillStyle = poi.danger === 3 ? '#b78665' : '#a6af84'; c.fillRect(x + (poi.x + poi.width / 2) * scale - 1, y + (poi.y + poi.height / 2) * scale - 1, 2, 2); }
    for (const [index, id] of this.routePoiIds.entries()) {
      const point = snapshot.world.pois.find(poi => poi.id === id)?.entrances[0];
      if (!point) continue;
      const px = x + point.x * scale, py = y + point.y * scale;
      c.fillStyle = '#e8ce90'; c.beginPath(); c.arc(px, py, 3.5, 0, Math.PI * 2); c.fill(); c.fillStyle = '#24321f'; c.textAlign = 'center'; c.font = '700 6px Manrope, sans-serif'; c.fillText(String(index + 1), px, py + 2);
    }
    c.save(); c.beginPath(); c.rect(x, y, width, height); c.clip();
    const corners = [this.unproject(0, 0), this.unproject(this.width, 0), this.unproject(this.width, this.height), this.unproject(0, this.height)];
    c.beginPath(); corners.forEach((point, index) => index ? c.lineTo(x + point.x * scale, y + point.y * scale) : c.moveTo(x + point.x * scale, y + point.y * scale)); c.closePath(); c.fillStyle = '#dbe8c20f'; c.fill(); c.strokeStyle = '#e6dcb8aa'; c.lineWidth = .8; c.stroke();
    const target = snapshot.self.automation?.target;
    if (target) { c.strokeStyle = snapshot.self.automation?.stage === 'extract' ? '#b2dca1' : '#f2d18b'; c.lineWidth = 1; c.strokeRect(x + target.x * scale - 3, y + target.y * scale - 3, 6, 6); }
    c.restore();
    for (const entity of snapshot.entities) { c.fillStyle = entity.id === snapshot.selfId ? '#ffe0a4' : entity.bossId?'#f0b267':entity.kind === 'player' ? '#81d0e3' : entity.faction === 'raiders' ? '#e48971' : '#ce9778'; c.beginPath(); const px=x+entity.x*scale,py=y+entity.y*scale;if(entity.bossId){c.moveTo(px,py-3);c.lineTo(px+3,py);c.lineTo(px,py+3);c.lineTo(px-3,py);c.closePath();}else c.arc(px,py,entity.id===snapshot.selfId?2.8:1.6,0,Math.PI*2);c.fill(); }
    this.label(snapshot.world.name.toUpperCase(), x + width / 2, y + height + 14, '#a9b596', 8);
    c.font = '600 8px "IBM Plex Mono", monospace'; c.textAlign = 'right'; c.fillStyle = '#c9d4b6'; c.fillText('С ↑', x + width - 3, y + 10);
  }
  private loadBossWeapon(id:string):void {
    if(this.bossWeapons.has(id))return;
    const boss=getBoss(id);if(!boss)return;
    this.bossWeapons.set(id,null);
    const art=weaponActorArt(bossWeapon(boss)),image=new Image();
    image.onload=()=>{this.bossWeapons.set(id,image);if(!this.active)this.paint();};
    image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(art.svg)}`;
  }
  private loadAtlas(appearance: number): void {
    if (this.atlases.has(appearance)) return;
    this.atlases.set(appearance, null);
    const image = new Image();
    const ready = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = `/art/scav-isometric-${appearance}.png`; });
    void Promise.all([ready, fetch(`/art/scav-isometric-${appearance}.json`).then(response => { if (!response.ok) throw new Error('Atlas unavailable'); return response.json() as Promise<{ frames: Record<string, AtlasFrame> }>; })]).then(([, value]) => { this.atlases.set(appearance, { image, frames: value.frames }); }).catch(() => { if (appearance >= 4) this.loadAtlas(appearance % 4); });
  }
}
