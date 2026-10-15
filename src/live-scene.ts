import { LIVE_TERRAIN_CODES, type LiveCityBuilding, type LiveCommand, type LiveDrop, type LiveEntity, type LiveLandscapePath, type LiveObstacle, type LivePoint, type LiveSnapshot, type LiveTerrain, type LiveWorld, type LiveWorldProp } from './game/live';
import { PixelCombatAnimation, pixelFacing, samplePixelMotion, stopPixelMotion, updatePixelMotion, type PixelMotion } from './pixel-animation';
import { liveDropLabel, liveLootTotals } from './live-loot-ui';
import { getBoss } from './game/bosses';
import { WEAPON_BY_ID } from './game/data';
import { buildingNeedsCutaway, buildingPalette, sceneBuildings, SceneryIndex } from './live-map-art';
import { PixelRaidRenderer, pixelSpriteRect, type PixelDetail } from './pixel-renderer';
import { PixelContainerArt } from './pixel-containers';
import { PixelActorArt, PIXEL_ACTOR_ANCHOR, PIXEL_ACTOR_NATIVE_SIZE } from './pixel-actors';
import { pixelActorWalkCycleDistance } from './pixel-actor-config';
import { pixelActorLoadout } from './pixel-loadout';
import { PixelBuildingArt, pixelBuildingSpriteBytes, pixelBuildingWallHeight } from './pixel-buildings';
import { PixelPropArt } from './pixel-props';
import { PixelObstacleArt } from './pixel-obstacles';
import { PIXEL_TILE, PIXEL_PALETTE as P } from './pixel-art';
import { PIXEL_SCENE_THEME as T } from './pixel-scene-theme';
import { buildSurfaceMasks, paintRoadSurface, paintTerrainTexture, terrainTextureResolution, type SurfaceMasks } from './live-ground-art';

type Motion = PixelMotion;
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
  private renderer: PixelRaidRenderer;
  private actorArt = new PixelActorArt();
  private containerArt = new PixelContainerArt();
  private obstacleArt = new PixelObstacleArt();
  private frame = 0;
  private paintedAt = 0;
  private active = false;
  private width = 800;
  private height = 520;
  private tile = 64;
  private origin = { x: 400, y: 260 };
  private camera: LivePoint = { x: 16, y: 12 };
  private zoom = 1;
  private selected: string | null = null;
  private routePoiIds: string[] = [];
  private waypointTargets: Array<{ point: LivePoint; x: number; y: number }> = [];
  private hitTargets: { entity: LiveEntity; x: number; y: number; bounds?: LabelBox }[] = [];
  private controls = document.createElement('div');
  private following = true;
  private overview = false;
  private cityOverview = false;
  private dragging: { id: number; startX: number; startY: number; camera: LivePoint; moved: boolean } | null = null;
  private ignoreClickUntil = 0;
  private combatAnimation = new PixelCombatAnimation();
  private snapshotAt = 0;
  private weaponMounts = new Map<string, { point: LivePoint; muzzle: LivePoint; ejection: LivePoint; offset: LivePoint; ejectOffset: LivePoint }>();
  private shotRigs = new Map<string, { point: LivePoint; target: LivePoint; offset: LivePoint; ejectOffset: LivePoint }>();
  private terrain: LiveTerrain[] = [];
  private overviewTerrain: HTMLCanvasElement | null = null;
  private minimapTerrain: HTMLCanvasElement | null = null;
  private terrainTexture: HTMLCanvasElement | null = null;
  private walkableGround = new Uint8Array();
  private buildingForObstacle = new Map<number, LiveCityBuilding>();
  private buildingWalls = new Map<string, LiveObstacle[]>();
  private scenery = new SceneryIndex<StaticScenery>([]);
  private propArt = new PixelPropArt();
  private buildingArt = new PixelBuildingArt();
  private buildingDetail: PixelDetail = 64;
  private cutawayBuildings = new Set<string>();
  private surfaceMasks: SurfaceMasks = { road: new Uint8Array(), indoor: new Uint8Array(), roadRuns: [] };

  constructor(private host: HTMLElement, _command: (command: LiveCommand) => void, private select: (id: string) => void) {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    this.context = context;
    this.renderer = new PixelRaidRenderer(context);
    this.canvas.setAttribute('data-renderer', 'pixel-isometric');
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
  clear(): void { this.snapshot = null; this.motions.clear(); this.selected = null; this.routePoiIds = []; this.waypointTargets = []; this.hitTargets = []; this.combatAnimation.clear(); this.weaponMounts.clear(); this.shotRigs.clear(); this.paint(); }
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
    if (this.snapshot?.worldVersion !== snapshot.worldVersion) { this.motions.clear(); this.combatAnimation.clear(); this.weaponMounts.clear(); this.shotRigs.clear(); this.selected = null; this.routePoiIds = []; this.waypointTargets = []; this.hitTargets = []; this.following = true; this.overview = false; this.cityOverview = false; this.zoom = 1; this.dragging = null; this.canvas.classList.remove('is-dragging'); this.cacheTerrain(snapshot.world); }
    const cityButton = this.controls.querySelector<HTMLButtonElement>('[data-live-zoom=city]');
    if (cityButton) cityButton.hidden = !snapshot.world.city;
    for (const entity of snapshot.entities) {
      const existing = this.motions.get(entity.id);
      const shot = [...snapshot.events].reverse().find(event => event.kind === 'combat' && event.actorId === entity.id && event.from && event.to && typeof event.damage === 'number' && snapshot.now - event.at >= 0 && snapshot.now - event.at < 200);
      const target = entity.aimUntil && entity.aimUntil > snapshot.now ? snapshot.entities.find(target => target.id === entity.aimTargetId) : null;
      const bearing = shot?.from && shot.to ? { x: shot.to.x - shot.from.x, y: shot.to.y - shot.from.y }
        : target ? { x: target.x - entity.x, y: target.y - entity.y }
          : existing ? { x: entity.x - existing.to.x, y: entity.y - existing.to.y } : { x: 0, y: 0 };
      const facing = pixelFacing(bearing.x - bearing.y, (bearing.x + bearing.y) / 2, existing?.facing);
      this.motions.set(entity.id, entity.health <= 0 ? stopPixelMotion(existing, entity, at) : updatePixelMotion(existing, entity, at, facing));
    }
    for (const id of this.motions.keys()) if (!snapshot.entities.some(entity => entity.id === id)) this.motions.delete(id);
    this.combatAnimation.update(snapshot.events, snapshot.now, at);
    this.snapshotAt = at;
    this.snapshot = snapshot;
    if (!this.active) this.paint();
  }
  destroy(): void { this.hide(); this.observer.disconnect(); this.overlayObserver.disconnect(); this.canvas.removeEventListener('click', this.click); this.canvas.removeEventListener('pointerdown', this.pointerDown); this.canvas.removeEventListener('pointermove', this.pointerMove); this.canvas.removeEventListener('pointerup', this.pointerUp); this.canvas.removeEventListener('pointercancel', this.pointerCancel); this.canvas.removeEventListener('wheel', this.wheel); this.controls.removeEventListener('click', this.zoomClick); this.canvas.remove(); this.controls.remove(); }

  private resize(): void {
    const box = this.host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    this.width = box.width; this.height = box.height;
    this.renderer.resize(this.width, this.height, window.devicePixelRatio || 1);
    this.overlayBoundsDirty = true;
    this.paint();
  }
  private zoomClick = (event: MouseEvent): void => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-live-zoom]')?.dataset.liveZoom;
    if (!action) return;
    if (action === 'follow') { this.following = true; this.overview = false; this.cityOverview = false; this.zoom = 1; }
    else if (action === 'overview' || action === 'city' && this.snapshot?.world.city) { this.following = false; this.overview = true; this.cityOverview = action === 'city'; }
    else {
      const scale = this.overview && this.snapshot ? this.viewTile(this.snapshot.world) / (this.width < 480 ? 48 : 64) : this.zoom;
      if (this.overview && this.snapshot) { const frame = this.viewFrame(this.snapshot.world); this.camera = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }; }
      this.overview = false; this.cityOverview = false; this.zoom = clamp(scale * (action === 'in' ? 1.25 : .8), .02, this.width < 480 ? 2.2 : 2.8);
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
    return this.overview ? Math.min(this.width * 1.8 / (frame.width + frame.height), Math.max(120, this.height - 95) * 3.6 / (frame.width + frame.height)) : (this.width < 480 ? 48 : 64) * this.zoom;
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
    const target = [...this.hitTargets].reverse().find(target => target.bounds
      ? x >= target.bounds.x - 4 && x <= target.bounds.x + target.bounds.width + 4 && y >= target.bounds.y - 4 && y <= target.bounds.y + target.bounds.height + 4
      : Math.hypot(target.x - x, target.y - y) < 9);
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
    const base = this.width < 480 ? 48 : 64;
    this.zoom = clamp(this.viewTile(this.snapshot.world) / base * Math.exp(-clamp(event.deltaY, -120, 120) * .002), .02, this.width < 480 ? 2.2 : 2.8);
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
    if (this.overview) { this.zoom = this.tile / (this.width < 480 ? 48 : 64); this.overview = false; this.cityOverview = false; }
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
  private animate = (at = performance.now()): void => {
    if (!this.active) return;
    const interval = 1000 / 60, elapsed = at - this.paintedAt;
    if (elapsed >= interval - .5) { this.paint(); this.paintedAt += Math.max(1, Math.floor(elapsed / interval)) * interval; }
    this.frame = requestAnimationFrame(this.animate);
  };
  private interpolated(motion: Motion, at: number): LivePoint { return samplePixelMotion(motion, at).point; }
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
    this.buildingForObstacle.clear(); this.buildingWalls.clear();
    const buildings = sceneBuildings(world);
    for (const [index, obstacle] of world.obstacles.entries()) {
      for (let y = obstacle.y; y < obstacle.y + obstacle.height; y++) for (let x = obstacle.x; x < obstacle.x + obstacle.width; x++) this.walkableGround[y * world.width + x] = 0;
      const cx = obstacle.x + obstacle.width / 2, cy = obstacle.y + obstacle.height / 2;
      const building = buildings.find(building => cx >= building.x && cy >= building.y && cx < building.x + building.width && cy < building.y + building.height
        && obstacle.x >= building.x && obstacle.y >= building.y && obstacle.x + obstacle.width <= building.x + building.width && obstacle.y + obstacle.height <= building.y + building.height);
      if (building) {
        this.buildingForObstacle.set(index, building);
        if (obstacle.kind === 'wall') { const walls = this.buildingWalls.get(building.id) ?? []; walls.push(obstacle); this.buildingWalls.set(building.id, walls); }
      }
    }
    const scenery: StaticScenery[] = [];
    for (const [index, obstacle] of world.obstacles.entries()) {
      if (obstacle.propId) continue;
      scenery.push({ ...obstacle, type: 'obstacle', index, obstacle, depth: obstacle.x + obstacle.y + (obstacle.width + obstacle.height) / 2 });
    }
    for (const prop of world.props ?? []) scenery.push({ ...prop, type: 'prop', prop, depth: prop.x + prop.y + (prop.width + prop.height) / 2 });
    for (const building of buildings) scenery.push({ ...building, type: 'architecture', building, depth: building.x + building.y + building.width + building.height - 1.1 });
    this.scenery = new SceneryIndex(scenery, world.chunkSize); this.propArt.clear(); this.buildingArt.clear(); this.obstacleArt.clear(); this.actorArt.clear(); this.containerArt.clear(); this.cutawayBuildings.clear();
    this.surfaceMasks = buildSurfaceMasks(world, this.terrain, this.walkableGround, buildings);
    const texture = document.createElement('canvas'), resolution = terrainTextureResolution(world.width, world.height);
    texture.width = world.width * resolution; texture.height = world.height * resolution;
    const ground = texture.getContext('2d');
    if (ground) {
      paintTerrainTexture(ground, world, this.terrain, resolution);
      ground.save(); ground.scale(resolution, resolution);
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
    if (this.tile < 14) {
      if (!prop.blocking && !['tree', 'shrub', 'garden', 'playground'].includes(prop.kind)) return;
      this.polygon(this.quad(prop.x - .5, prop.y - .5, prop.width, prop.height), ['tree', 'shrub', 'garden'].includes(prop.kind) ? P.leafShade : P.panelShade); return;
    }
    const anchor = this.project({ x: prop.x - .5, y: prop.y - .5 });
    const extent = (prop.width + prop.height) * this.tile / 2;
    if (anchor.x + prop.width * this.tile / 2 < -8 || anchor.x - prop.height * this.tile / 2 > this.width + 8 || anchor.y + extent / 2 < -8 || anchor.y - this.tile * 2.5 > this.height + 8) return;
    this.renderer.sprite(this.propArt.get(prop), anchor, this.tile / PIXEL_TILE, this.width, this.height);
  }
  /** Cached pixel facades share the authoritative footprint and real cutaway doorways. */
  private paintBuilding(building: LiveCityBuilding): void {
    const x = building.x - .5, y = building.y - .5, w = building.width, h = building.height;
    const height = this.tile * pixelBuildingWallHeight(building), base = this.quad(x, y, w, h), top = this.quad(x, y, w, h, height);
    if (!this.buildingVisible(building)) return;
    const cutaway = this.cutawayBuildings.has(building.id);
    if (this.tile < 14) {
      if (cutaway) return;
      const colors = buildingPalette(building);
      this.polygon([base[1]!, base[2]!, top[2]!, top[1]!], colors[0]);
      this.polygon([base[2]!, base[3]!, top[3]!, top[2]!], colors[1]);
      this.polygon(top, colors[2]); return;
    }
    const detail = this.buildingDetail;
    this.renderer.sprite(this.buildingArt.get(building, cutaway, detail, this.buildingWalls.get(building.id)), this.project({ x, y }), this.tile / detail, this.width, this.height);
  }
  private buildingVisible(building: LiveCityBuilding): boolean {
    const base = this.quad(building.x - .5, building.y - .5, building.width, building.height), height = this.tile * pixelBuildingWallHeight(building);
    return Math.max(...base.map(p => p.x)) >= -4 && Math.min(...base.map(p => p.x)) <= this.width + 4 && Math.max(...base.map(p => p.y)) >= -4 && Math.min(...base.map(p => p.y)) - height - this.tile * .65 <= this.height + 4;
  }
  private paintLandscape(world: LiveWorld, c: CanvasRenderingContext2D): void {
    const stroke = (path: LiveLandscapePath, color: string, width: number) => {
      c.beginPath(); path.points.forEach((point, index) => index ? c.lineTo(point.x + .5, point.y + .5) : c.moveTo(point.x + .5, point.y + .5)); c.strokeStyle = color; c.lineWidth = width; c.stroke();
    };
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    paintRoadSurface(c, world, this.surfaceMasks);
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
    const p = this.project(drop), c = this.context, scale = this.tile / 64;
    if (p.x < -30 || p.x > this.width + 30 || p.y < -30 || p.y > this.height + 112 * scale) return;
    if (this.tile < 12) { c.fillStyle = T.loot; c.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); return; }
    this.renderer.sprite(this.containerArt.get(drop), p, scale * .55, this.width, this.height);
    if (scale > .55) {
      const known = !drop.containerId || drop.searched;
      const kindLabels = { duffel: 'СУМКА', jacket: 'КУРТКА', toolbox: 'ИНСТРУМЕНТЫ', medbag: 'МЕДСУМКА', cabinet: 'ШКАФ', crate: 'ЯЩИК' };
      const label = !known ? drop.containerKind ? kindLabels[drop.containerKind] : 'ОБЫСКАТЬ' : drop.amount || drop.items?.length ? liveDropLabel(drop) : 'ПУСТО';
      this.label(label.length > 35 ? `${label.slice(0, 32)}…` : label, p.x, p.y + 19, T.loot, 8);
      if (known && drop.items?.length && scale > .9) this.label(`≈ ${liveLootTotals(drop.items).guide.toLocaleString('ru-RU')} ₽`, p.x, p.y + 31, T.muted, 7);
    }
  }
  private obstacle(obstacle: LiveObstacle, index: number): void {
    const kind = obstacle.kind ?? 'building';
    if (kind === 'water') return;
    if (this.buildingForObstacle.has(index) && (kind === 'building' || kind === 'wall')) return;
    if (kind === 'tree') {
      this.paintProp({ ...obstacle, id: `tree-${index}`, kind: 'tree', orientation: 'x', variant: (index % 4) as 0 | 1 | 2 | 3, blocking: true }); return;
    }
    const anchor = this.project({ x: obstacle.x - .5, y: obstacle.y - .5 });
    if (this.tile < 14) { this.polygon(this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height), kind === 'container' ? P.steel : P.concreteShade); return; }
    const corners = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height);
    if (Math.max(...corners.map(p => p.x)) < -8 || Math.min(...corners.map(p => p.x)) > this.width + 8 || Math.max(...corners.map(p => p.y)) < -8 || Math.min(...corners.map(p => p.y)) - this.tile > this.height + 8) return;
    const sprite = this.obstacleArt.get(obstacle, index, this.renderer.detail(this.tile));
    this.renderer.sprite(sprite, anchor, this.tile / sprite.nativeTile, this.width, this.height);
  }

  private paint(): void {
    const c = this.context, now = performance.now();
    c.clearRect(0, 0, this.width, this.height);
    c.fillStyle = T.background; c.fillRect(0, 0, this.width, this.height);
    c.imageSmoothingEnabled = false;
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
      const p = this.project(extract); this.polygon(this.quad(extract.x - .7, extract.y - .7, 1.4, 1.4), `${T.extract}55`, T.extract);
      const flagHeight = this.overview ? 12 : 40;
      c.strokeStyle = T.extract; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - flagHeight); c.stroke();
      this.polygon([{ x: p.x, y: p.y - flagHeight }, { x: p.x + flagHeight * .6, y: p.y - flagHeight * .87 }, { x: p.x, y: p.y - flagHeight * .72 }], T.extract); this.label(`ВЫХОД ${index + 1}`, p.x, p.y + (this.overview ? 12 : 21), T.text, this.overview ? 7 : 10);
    }
    const objects: { depth: number; paint: () => void }[] = [];
    const visible = this.scenery.visible({ x: minX - 7, y: minY - 7, width: maxX - minX + 14, height: maxY - minY + 14 });
    const activity: LivePoint[] = [...snapshot.drops];
    for (const entity of snapshot.entities) {
      activity.push(entity);
      const motion = this.motions.get(entity.id);
      if (motion) activity.push(this.interpolated(motion, now));
    }
    this.cutawayBuildings.clear();
    for (const item of visible) if (item.type === 'architecture' && buildingNeedsCutaway(item.building, activity)) this.cutawayBuildings.add(item.building.id);
    // A coherent viewport level prevents cycling large facades through the bounded LRU every frame.
    const buildingsInView = visible.filter((item): item is Extract<StaticScenery, { type: 'architecture' }> => item.type === 'architecture' && this.buildingVisible(item.building));
    this.buildingDetail = this.renderer.detail(this.tile);
    while (this.buildingDetail > 32 && buildingsInView.reduce((bytes, item) => bytes + pixelBuildingSpriteBytes(item.building, this.cutawayBuildings.has(item.building.id), this.buildingDetail), 0) > 24 * 1024 * 1024) this.buildingDetail = this.buildingDetail === 128 ? 64 : 32;
    // Open floors precede furniture and confirmed activity; closed roofs retain their depth order.
    for (const item of visible) if (item.type === 'architecture' && this.cutawayBuildings.has(item.building.id)) this.paintBuilding(item.building);
    for (const item of visible) objects.push({ depth: item.depth, paint: () => {
      if (item.type === 'obstacle') this.obstacle(item.obstacle, item.index);
      else if (item.type === 'prop') this.paintProp(item.prop);
      else if (!this.cutawayBuildings.has(item.building.id)) this.paintBuilding(item.building);
    } });
    // Overview dots are navigation markers: roofs must never cover confirmed activity.
    const activityDepth = this.overview || this.tile < 14 ? world.width + world.height + 1 : 0;
    for (const drop of snapshot.drops) objects.push({ depth: drop.x + drop.y + activityDepth, paint: () => this.paintContainer(drop) });
    this.hitTargets = []; this.weaponMounts.clear();
    for (const entity of snapshot.entities) {
      const motion = this.motions.get(entity.id), point = motion ? this.interpolated(motion, now) : entity;
      objects.push({ depth: point.x + point.y + activityDepth + .1, paint: () => this.paintEntity(entity, now) });
    }
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
        const scale = this.tile / (this.width < 480 ? 48 : 64);
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
      placeLabel(world.city.name.toUpperCase(), { x: p.x, y: p.y - 25 }, this.width < 480 ? 15 : 18, T.text, true);
    }
    if (small) for (const district of world.districts) {
      const p = this.project(district.labelPoint ?? { x: district.x + district.width / 2, y: district.y + district.height / 2 });
      placeLabel(district.name.toUpperCase(), { x: p.x, y: p.y - 24 }, this.width < 480 ? 11 : 14, T.text, true);
    }
    if (small && this.cityOverview && world.city) for (const quarter of world.city.quarters) {
      const p = this.project({ x: quarter.x + quarter.width / 2, y: quarter.y + quarter.height / 2 });
      placeLabel(quarter.name, { x: p.x, y: p.y - 16 }, this.width < 480 ? 9 : 11, T.text, true);
    }
    const sitePoiIds = new Set<string>();
    if (!this.overview && this.tile >= 12) for (const site of world.citySites ?? []) {
      const p = this.project({ x: site.courtyard.x + site.courtyard.width / 2, y: site.courtyard.y + site.courtyard.height / 2 });
      if (p.x < -50 || p.x > this.width + 50 || p.y < -30 || p.y > this.height + 30) continue;
      sitePoiIds.add(site.poiId);
      if (this.tile < 24) { placeLabel(site.name, p, 9, T.text); continue; }
      placeLabel(`${siteKinds[site.kind]} · ${site.name}`, p, 10, T.text);
      for (const building of site.buildings) {
        const center = this.project({ x: building.x + building.width / 2, y: building.y + building.height / 2 });
        if (center.x >= 0 && center.x <= this.width && center.y >= 45 && center.y <= this.height - 35) placeLabel(building.name, center, 8, T.muted);
      }
    }
    const pois = [...world.pois].sort((a, b) => Number(this.routePoiIds.includes(b.id)) - Number(this.routePoiIds.includes(a.id)) || b.danger - a.danger || b.width * b.height - a.width * a.height);
    let labelCount = 0;
    for (const poi of pois) {
      const p = this.project({ x: poi.x + poi.width / 2, y: poi.y + poi.height / 2 }), chosen = this.routePoiIds.includes(poi.id);
      if (p.x < -60 || p.x > this.width + 60 || p.y < -30 || p.y > this.height + 30) continue;
      if (small) {
        c.fillStyle = chosen ? T.self : poi.danger === 3 ? T.hostile : T.loot; c.fillRect(p.x - 2, p.y - 2, 4, 4);
        if ((chosen || this.width >= 480 && labelCount < 12) && placeLabel(poi.name, { x: p.x, y: p.y + 13 }, chosen ? 10 : 8, chosen ? T.text : T.muted)) labelCount++;
      } else if (this.tile > 30 && !sitePoiIds.has(poi.id)) placeLabel(poi.name, p, chosen ? 11 : 9, chosen ? T.text : T.text);
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
      c.beginPath(); c.arc(p.x, p.y, this.overview ? 9 : 11, 0, Math.PI * 2); c.fillStyle = done ? T.healthy : T.self; c.fill(); c.strokeStyle = T.panel; c.lineWidth = 2; c.stroke();
      c.font = '800 10px Manrope, sans-serif'; c.textAlign = 'center'; c.fillStyle = done ? T.text : T.panel; c.fillText(done ? '✓' : String(index + 1), p.x, p.y + 3.5);
      this.waypointTargets.push({ point, x: p.x, y: p.y });
    }
  }
  private paintIntent(snapshot: LiveSnapshot, now: number): void {
    const c = this.context, self = snapshot.entities.find(entity => entity.id === snapshot.selfId);
    if (self) {
      const motion = this.motions.get(self.id), point = this.project(motion ? this.interpolated(motion, now) : self), radius = Math.max(9, this.tile * .3);
      if (point.x > 0 && point.x < this.width && point.y > 0 && point.y < this.height) {
        c.save(); c.strokeStyle = T.self; c.lineWidth = 1.3; c.setLineDash([3, 4]); c.beginPath(); c.ellipse(point.x, point.y + 2, radius, radius * .48, 0, 0, Math.PI * 2); c.stroke(); c.restore();
      }
    }
    const auto = snapshot.self.automation;
    if (!auto?.enabled || !auto.target || auto.stage === 'complete' || auto.stage === 'downed') return;
    const p = this.project(auto.target), radius = Math.max(this.overview ? 7 : 11, this.tile * .25), color = auto.stage === 'extract' ? T.extract : auto.stage === 'combat' ? T.hostile : T.loot;
    if (p.x < -30 || p.x > this.width + 30 || p.y < -30 || p.y > this.height + 30) return;
    c.save(); c.strokeStyle = color; c.lineWidth = 1.7; c.globalAlpha = .7 + Math.sin(now / 450) * .17;
    c.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.moveTo(p.x + sx! * radius, p.y + sy! * radius * .65 - sy! * 5); c.lineTo(p.x + sx! * radius, p.y + sy! * radius * .65); c.lineTo(p.x + sx! * (radius - 5), p.y + sy! * radius * .65); }
    c.stroke(); c.restore();
    if (!this.overview && this.tile >= 20) this.label(auto.stage === 'extract' ? 'ЭВАКУАЦИЯ' : auto.stage === 'combat' ? 'КОНТАКТ' : 'ТЕКУЩАЯ ЦЕЛЬ', p.x, p.y - radius - 8, color, 8);
  }
  private paintCombat(now: number): void {
    const c = this.context, scale = this.tile / (this.width < 480 ? 48 : 64), small = this.overview || this.tile < 28;
    const activeShots = this.combatAnimation.active(now), activeIds = new Set(activeShots.map(shot => shot.event.id));
    for (const id of this.shotRigs.keys()) if (!activeIds.has(id)) this.shotRigs.delete(id);
    for (const { event, at } of activeShots) {
      const age = now - at;
      if (!event.from || !event.to) continue;
      const mount = event.actorId ? this.weaponMounts.get(event.actorId) : undefined;
      let rig = this.shotRigs.get(event.id);
      if (!rig) {
        const targetBody = event.targetId ? this.weaponMounts.get(event.targetId) : undefined;
        rig = { point: mount?.point ?? event.from, target: targetBody?.point ?? event.to, offset: mount?.offset ?? { x: 0, y: -27 }, ejectOffset: mount?.ejectOffset ?? { x: 0, y: -27 } };
        this.shotRigs.set(event.id, rig);
      }
      const ground = this.project(small ? event.from : rig.point), target = this.project(small ? event.to : rig.target, small ? 3 : 27 * scale);
      const from = small ? this.project(event.from, 3) : { x: ground.x + rig.offset.x * scale, y: ground.y + rig.offset.y * scale };
      const flash = mount && !small && age < 85 ? mount.muzzle : from;
      const eject = small ? from : { x: ground.x + rig.ejectOffset.x * scale, y: ground.y + rig.ejectOffset.y * scale };
      const seed = [...event.id].reduce((value, char) => Math.imul(value, 31) + char.charCodeAt(0), 17) >>> 0;
      c.save();
      if (age < 115) {
        const head = Math.min(1, .18 + age / 75), tail = Math.max(0, head - .36), dx = target.x - from.x, dy = target.y - from.y;
        c.globalAlpha = Math.max(.15, 1 - age / 140); c.strokeStyle = event.actorId === this.snapshot?.selfId ? T.tracer : P.woodLight; c.lineWidth = small ? 1 : Math.max(1, scale * .9);
        c.beginPath(); c.moveTo(Math.round(from.x + dx * tail), Math.round(from.y + dy * tail)); c.lineTo(Math.round(from.x + dx * head), Math.round(from.y + dy * head)); c.stroke();
      }
      if (!small && age < 85) {
        const dx = target.x - from.x, dy = target.y - from.y, length = Math.hypot(dx, dy) || 1, size = Math.max(2, Math.round(scale * (age < 35 ? 5 : 3)));
        const mx = Math.round(flash.x), my = Math.round(flash.y);
        c.globalAlpha = 1; c.fillStyle = P.yellow; c.fillRect(mx - size, my - 1, size * 2 + 1, 3); c.fillRect(mx - 1, my - size, 3, size * 2 + 1);
        c.fillStyle = T.flash; c.fillRect(mx - 1, my - 1, 3, 3);
        c.fillStyle = P.cream; c.fillRect(Math.round(mx + dx / length * size * 1.5), Math.round(my + dy / length * size * 1.5), Math.max(1, Math.round(scale)), Math.max(1, Math.round(scale)));
      }
      if (!small && age < 620) {
        const t = age / 480, side = seed % 2 ? 1 : -1, ex = Math.round(eject.x + side * (9 + seed % 5) * scale * t), ey = Math.round(eject.y - 12 * scale * t + 18 * scale * t * t);
        c.globalAlpha = Math.min(1, (620 - age) / 140); c.fillStyle = P.woodLight; c.fillRect(ex, ey, Math.max(1, Math.round(2 * scale)), Math.max(1, Math.round(scale))); c.fillStyle = P.woodShade; c.fillRect(ex + Math.max(1, Math.round(scale)), ey + Math.max(1, Math.round(scale)), Math.max(1, Math.round(scale)), 1);
      }
      if (age >= 45 && age < 330) {
        const t = (age - 45) / 285, reach = (small ? 3 : 7 * scale) * t;
        c.globalAlpha = 1 - t; c.fillStyle = event.damage! > 0 ? P.sand : P.steelLight;
        for (let spark = 0; spark < (small ? 2 : 5); spark++) {
          const angle = ((seed >>> (spark * 3)) % 360 + spark * 71) * Math.PI / 180;
          c.fillRect(Math.round(target.x + Math.cos(angle) * reach), Math.round(target.y + Math.sin(angle) * reach * .6), small ? 1 : Math.max(1, Math.round(scale * 1.5)), small ? 1 : Math.max(1, Math.round(scale)));
        }
      }
      if (!small && age < 440) {
        const t = age / 440; c.globalAlpha = (1 - t) * .28; c.fillStyle = P.white;
        c.fillRect(Math.round(from.x + (seed % 5 - 2) * scale * t), Math.round(from.y - 11 * scale * t), Math.max(1, Math.round((2 + t * 3) * scale)), Math.max(1, Math.round((1 + t * 2) * scale)));
      }
      if (!small && event.damage! > 0) { c.globalAlpha = Math.max(0, 1 - age / 850); this.label(`−${Math.round(event.damage!)}`, target.x, target.y - 15 - age / 55, T.injured, 12); }
      c.restore();
    }
  }
  private paintEntity(entity: LiveEntity, now: number): void {
    const snapshot = this.snapshot!, motion = this.motions.get(entity.id)!, point = this.interpolated(motion, now), p = this.project(point), c = this.context;
    // The widest rifle, body and labels must enter the viewport together at any
    // zoom. A fixed ground-point margin clipped magnified actors at its edges.
    const zoom = this.tile / (this.width < 480 ? 48 : 64), scale = .32 * zoom;
    const horizontal = Math.max(PIXEL_ACTOR_ANCHOR.x, PIXEL_ACTOR_NATIVE_SIZE.width - PIXEL_ACTOR_ANCHOR.x) * scale;
    if (p.x < -horizontal || p.x > this.width + horizontal || p.y < -(PIXEL_ACTOR_NATIVE_SIZE.height - PIXEL_ACTOR_ANCHOR.y) * scale - 40
      || p.y > this.height + PIXEL_ACTOR_ANCHOR.y * scale + 40) return;
    const boss=entity.bossId?getBoss(entity.bossId):null;
    const own = entity.id === snapshot.selfId, selected = entity.id === this.selected, color = own ? T.self : boss ? T.boss : entity.kind === 'player' ? T.ally : entity.faction === 'raiders' ? T.hostile : T.scav;
    if (this.overview || this.tile < 28) {
      c.fillStyle = color; c.strokeStyle = T.panel; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, own || selected ? 4.5 : 2.8, 0, Math.PI * 2); c.fill(); c.stroke();
      if (entity.aimUntil && entity.aimUntil > snapshot.now && entity.aimTargetId === snapshot.selfId) this.label('ЦЕЛИТСЯ В ТЕБЯ', p.x, p.y - 14, T.injured, 8);
      if (own || selected || boss) this.label(own ? 'ТЫ' : boss?`БОСС · ${boss.name}`:entity.name, p.x, p.y - 10, color, 9);
      this.hitTargets.push({ entity, x: p.x, y: p.y }); return;
    }
    c.beginPath(); c.ellipse(p.x, p.y, 13 * zoom, 6 * zoom, 0, 0, Math.PI * 2); c.fillStyle = '#0005'; c.fill();
    if (own || selected) { c.strokeStyle = color; c.lineWidth = 2; c.stroke(); }
    const animation = this.combatAnimation.frame(entity, motion, now, snapshot.now + now - this.snapshotAt, pixelActorWalkCycleDistance(this.width < 480 ? 48 : 64));
    const { weapon, gear } = pixelActorLoadout(entity, snapshot.self);
    const sprite = this.actorArt.get(entity, animation, weapon, gear), actorScale = .32 * zoom;
    const bounds = pixelSpriteRect(sprite, p, actorScale, this.renderer.deviceRatio);
    this.renderer.sprite(sprite, p, actorScale, this.width, this.height);
    if (sprite.muzzle && sprite.ejection) {
      const muzzle = this.renderer.spritePoint(sprite, p, actorScale, sprite.muzzle), ejection = this.renderer.spritePoint(sprite, p, actorScale, sprite.ejection);
      this.weaponMounts.set(entity.id, { point, muzzle, ejection, offset: { x: (muzzle.x - p.x) / zoom, y: (muzzle.y - p.y) / zoom }, ejectOffset: { x: (ejection.x - p.x) / zoom, y: (ejection.y - p.y) / zoom } });
    }
    const top = bounds.y - 37;
    this.label(own ? `ТЫ · ${entity.name}` : entity.name, p.x, top, color, own ? 11 : 10);
    const role = boss ? 'БОСС' : entity.kind === 'player' ? own ? 'ТВОЙ БОЕЦ' : 'ИГРОК' : entity.faction === 'raiders' ? 'РЕЙДЕР' : 'ДИКИЙ';
    const weaponName = WEAPON_BY_ID[typeof weapon === 'string' ? weapon : weapon.weaponId]?.name;
    this.label(`${role}${weaponName ? ` · ${weaponName}` : ''}`, p.x, top + 13, boss?T.boss:own ? T.text : entity.kind === 'player' ? T.ally : T.muted, 7);
    c.fillStyle = T.panel; c.fillRect(p.x - 17, top + 18, 34, 3); c.fillStyle = entity.health > 35 ? T.healthy : T.injured; c.fillRect(p.x - 17, top + 18, 34 * entity.health / 100, 3);
    if (entity.safeUntil > snapshot.now) this.label('ЗАЩИТА', p.x, p.y + 20, T.extract, 8);
    if (entity.aimUntil && entity.aimUntil > snapshot.now) {
      c.strokeStyle = T.hostile; c.lineWidth = 2; c.beginPath(); c.ellipse(p.x, p.y, 18 * zoom, 9 * zoom, 0, 0, Math.PI * 2); c.stroke();
      this.label(entity.aimTargetId === snapshot.selfId ? 'ЦЕЛИТСЯ В ТЕБЯ' : 'ПРИЦЕЛИВАЕТСЯ', p.x, p.y + 22, T.injured, 8);
    } else if (entity.bleeding || entity.limping) this.label(entity.bleeding ? 'КРОВОТЕЧЕНИЕ' : 'ХРОМАЕТ', p.x, p.y + 22, T.injured, 7);
    this.hitTargets.push({ entity, x: p.x, y: p.y, bounds });
  }
  private minimapBounds(snapshot: LiveSnapshot): { x: number; y: number; width: number; height: number; scale: number } {
    const scale = Math.min(this.width < 480 ? 2.1 : 2.5, (this.width * .28) / snapshot.world.width, (this.height * .22) / snapshot.world.height);
    const width = snapshot.world.width * scale, height = snapshot.world.height * scale;
    return { x: this.width - width - 16, y: 62, width, height, scale };
  }
  private minimap(snapshot: LiveSnapshot): void {
    const c = this.context, { x, y, scale, width, height } = this.minimapBounds(snapshot);
    c.fillStyle = `${T.panel}e6`; c.fillRect(x - 8, y - 8, width + 16, height + 29); c.strokeStyle = `${T.border}66`; c.strokeRect(x - 8, y - 8, width + 16, height + 29);
    if (this.minimapTerrain ?? this.terrainTexture) c.drawImage((this.minimapTerrain ?? this.terrainTexture)!, x, y, width, height);
    for (const extract of snapshot.world.extracts) { c.fillStyle = T.extract; c.fillRect(x + extract.x * scale - 2, y + extract.y * scale - 2, 4, 4); }
    for (const poi of snapshot.world.pois) { c.fillStyle = poi.danger === 3 ? T.hostile : T.loot; c.fillRect(x + (poi.x + poi.width / 2) * scale - 1, y + (poi.y + poi.height / 2) * scale - 1, 2, 2); }
    for (const [index, id] of this.routePoiIds.entries()) {
      const point = snapshot.world.pois.find(poi => poi.id === id)?.entrances[0];
      if (!point) continue;
      const px = x + point.x * scale, py = y + point.y * scale;
      c.fillStyle = T.self; c.beginPath(); c.arc(px, py, 3.5, 0, Math.PI * 2); c.fill(); c.fillStyle = T.panel; c.textAlign = 'center'; c.font = '700 6px Manrope, sans-serif'; c.fillText(String(index + 1), px, py + 2);
    }
    c.save(); c.beginPath(); c.rect(x, y, width, height); c.clip();
    const corners = [this.unproject(0, 0), this.unproject(this.width, 0), this.unproject(this.width, this.height), this.unproject(0, this.height)];
    c.beginPath(); corners.forEach((point, index) => index ? c.lineTo(x + point.x * scale, y + point.y * scale) : c.moveTo(x + point.x * scale, y + point.y * scale)); c.closePath(); c.fillStyle = `${T.text}0f`; c.fill(); c.strokeStyle = `${T.text}aa`; c.lineWidth = .8; c.stroke();
    const target = snapshot.self.automation?.target;
    if (target) { c.strokeStyle = snapshot.self.automation?.stage === 'extract' ? T.extract : T.self; c.lineWidth = 1; c.strokeRect(x + target.x * scale - 3, y + target.y * scale - 3, 6, 6); }
    c.restore();
    for (const entity of snapshot.entities) { c.fillStyle = entity.id === snapshot.selfId ? T.self : entity.bossId?T.boss:entity.kind === 'player' ? T.ally : entity.faction === 'raiders' ? T.hostile : T.scav; c.beginPath(); const px=x+entity.x*scale,py=y+entity.y*scale;if(entity.bossId){c.moveTo(px,py-3);c.lineTo(px+3,py);c.lineTo(px,py+3);c.lineTo(px-3,py);c.closePath();}else c.arc(px,py,entity.id===snapshot.selfId?2.8:1.6,0,Math.PI*2);c.fill(); }
    this.label(snapshot.world.name.toUpperCase(), x + width / 2, y + height + 14, T.muted, 8);
    c.font = '600 8px "IBM Plex Mono", monospace'; c.textAlign = 'right'; c.fillStyle = T.text; c.fillText('С ↑', x + width - 3, y + 10);
  }
}
