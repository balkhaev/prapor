import type { LiveCommand, LiveEntity, LiveEvent, LiveObstacle, LivePoint, LiveSnapshot, LiveTerrain } from './game/live';
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
  private hitTargets: { entity: LiveEntity; x: number; y: number }[] = [];
  private controls = document.createElement('div');
  private following = true;
  private overview = false;
  private dragging: { id: number; startX: number; startY: number; camera: LivePoint; moved: boolean } | null = null;
  private ignoreClickUntil = 0;
  private effects: { event: LiveEvent; at: number }[] = [];
  private seenEvents = new Set<string>();

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
  clear(): void { this.snapshot = null; this.motions.clear(); this.selected = null; this.effects = []; this.seenEvents.clear(); this.paint(); }
  setSelected(id: string | null): void { this.selected = id; }
  update(snapshot: LiveSnapshot): void {
    const at = performance.now();
    if (this.snapshot?.world.id !== snapshot.world.id) { this.motions.clear(); this.effects = []; this.seenEvents.clear(); this.selected = null; this.following = true; this.overview = false; this.dragging = null; }
    for (const entity of snapshot.entities) {
      const existing = this.motions.get(entity.id);
      const from = existing ? this.interpolated(existing, at) : { x: entity.x, y: entity.y };
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
    else { this.overview = false; this.zoom = clamp(this.zoom * (action === 'in' ? 1.25 : .8), .35, 1.8); }
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
    if (drop && self && Math.hypot(drop.x - self.x, drop.y - self.y) <= 1.5) { this.command({ type: 'loot', id: drop.id }); return; }
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
  private ground(terrain: LiveTerrain, shade: number): string {
    const palettes: Record<LiveTerrain, string[]> = { road: ['#55584e', '#505447', '#55594e', '#4e554b', '#575b50'], concrete: ['#707365', '#6b7062', '#686e61', '#6e7365', '#707568'], forest: ['#334937', '#354d36', '#3b5037', '#3a4b32', '#405139'], water: ['#3b5b5d', '#355153', '#3c5757', '#3b5351', '#3e5a58'], yard: ['#5f6247', '#5a6145', '#5c6649', '#626a4b', '#64694c'] };
    return palettes[terrain][shade]!;
  }
  private obstacle(obstacle: LiveObstacle, index: number): void {
    const c = this.context, kind = obstacle.kind ?? 'building';
    const p = this.project({ x: obstacle.x + obstacle.width / 2 - .5, y: obstacle.y + obstacle.height / 2 - .5 });
    if (this.snapshot?.world.zones.some(zone => zone.terrain === 'water' && obstacle.x >= zone.x && obstacle.y >= zone.y && obstacle.x + obstacle.width <= zone.x + zone.width && obstacle.y + obstacle.height <= zone.y + zone.height)) {
      this.polygon(this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height), '#294c50', '#a2ad8266');
      const center = this.project({ x: obstacle.x + obstacle.width / 2, y: obstacle.y + obstacle.height / 2 });
      this.label('ОЗЕРО', center.x, center.y, '#b6ccc0', this.overview ? 7 : 10); return;
    }
    if (kind === 'tree') {
      const scale = this.tile / 54;
      c.fillStyle = '#10211966'; c.beginPath(); c.ellipse(p.x, p.y, 16 * scale, 8 * scale, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#6e6850'; c.fillRect(p.x - 2 * scale, p.y - 28 * scale, 4 * scale, 28 * scale);
      for (let tier = 0; tier < 3; tier++) { const y = p.y - (18 + tier * 14) * scale, w = (20 - tier * 4) * scale; this.polygon([{ x: p.x - w, y }, { x: p.x, y: y - 27 * scale }, { x: p.x + w, y }], ['#324f36', '#476443', '#60704b'][tier]!, '#263c2d'); }
      return;
    }
    const elevation = this.tile * (kind === 'wall' ? .6 : kind === 'barricade' ? .26 : kind === 'container' ? .65 : 1.05);
    const base = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height), top = this.quad(obstacle.x - .5, obstacle.y - .5, obstacle.width, obstacle.height, elevation);
    const colors = kind === 'container' ? index % 2 ? ['#576465', '#344e51', '#6d7974'] : ['#76634b', '#584c37', '#9a8058'] : kind === 'barricade' ? ['#817452', '#62543d', '#aa9470'] : kind === 'wall' ? ['#81877a', '#596154', '#a0a28b'] : ['#707762', '#4b584c', '#92937b'];
    this.polygon([base[1]!, base[2]!, top[2]!, top[1]!], colors[0]!, '#acaf8644'); this.polygon([base[2]!, base[3]!, top[3]!, top[2]!], colors[1]!, '#84907666'); this.polygon(top, colors[2]!, '#b4b39177');
    if (kind === 'container') {
      c.strokeStyle = '#273c3a88'; c.lineWidth = 1;
      for (let fraction = .15; fraction < 1; fraction += .15) { const a = { x: top[1]!.x + (top[2]!.x - top[1]!.x) * fraction, y: top[1]!.y + (top[2]!.y - top[1]!.y) * fraction }, b = { x: base[1]!.x + (base[2]!.x - base[1]!.x) * fraction, y: base[1]!.y + (base[2]!.y - base[1]!.y) * fraction }; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    } else if (kind === 'building') {
      c.strokeStyle = '#505a4b88'; c.beginPath(); c.moveTo(top[0]!.x, top[0]!.y); c.lineTo(top[2]!.x, top[2]!.y); c.stroke();
      const vent = this.quad(obstacle.x + obstacle.width * .25, obstacle.y + obstacle.height * .25, .7, .7, elevation + 3); this.polygon(vent, '#697662', '#b1b292');
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
    const zones = [...world.zones].reverse();
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const p = this.project({ x, y }); if (p.x < -this.tile || p.x > this.width + this.tile || p.y < -this.tile || p.y > this.height + this.tile) continue;
      const zone = zones.find(zone => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height);
      const terrain = zone?.terrain ?? (world.theme === 'forest' ? 'forest' : 'concrete');
      const shade = (x * 17 + y * 29) % 5;
      this.polygon(this.quad(x - .5, y - .5), this.ground(terrain, shade), '#90916c18');
      if (terrain === 'road' && (x + y) % 4 === 0) { c.strokeStyle = '#d9d19b55'; const a = this.project({ x: x - .25, y }), b = this.project({ x: x + .25, y }); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      if (world.theme === 'urban' && terrain === 'yard') { c.strokeStyle = '#353f38aa'; c.lineWidth = Math.max(.5, this.tile / 40); for (const offset of [-.22, .22]) { const a = this.project({ x: x + offset, y: y - .5 }), b = this.project({ x: x + offset, y: y + .5 }); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); } }
      if (terrain === 'water' && (x + y) % 3 === 0) { const a = this.project({ x, y }); c.strokeStyle = '#b5c6a744'; c.beginPath(); c.moveTo(a.x - this.tile * .15, a.y); c.lineTo(a.x + this.tile * .1, a.y); c.stroke(); }
    }
    for (const zone of world.zones.slice(1)) { const p = this.project({ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }); if (this.overview || this.tile < 28) this.label(zone.name.toUpperCase(), p.x, p.y, '#d5dab5', this.overview ? 8 : 10); }
    for (const [index, extract] of world.extracts.entries()) {
      const p = this.project(extract); this.polygon(this.quad(extract.x - .7, extract.y - .7, 1.4, 1.4), '#5b8d5655', '#a4cf76');
      const flagHeight = this.overview ? 12 : 40;
      c.strokeStyle = '#c3d991'; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - flagHeight); c.stroke();
      this.polygon([{ x: p.x, y: p.y - flagHeight }, { x: p.x + flagHeight * .6, y: p.y - flagHeight * .87 }, { x: p.x, y: p.y - flagHeight * .72 }], '#b2ce7e'); this.label(`ВЫХОД ${index + 1}`, p.x, p.y + (this.overview ? 12 : 21), '#cce5a2', this.overview ? 7 : 10);
    }
    const objects: { depth: number; paint: () => void }[] = [];
    for (const [index, obstacle] of world.obstacles.entries()) objects.push({ depth: obstacle.x + obstacle.y + (obstacle.width + obstacle.height) / 2, paint: () => this.obstacle(obstacle, index) });
    for (const drop of snapshot.drops) objects.push({ depth: drop.x + drop.y, paint: () => {
      const p = this.project(drop), size = this.overview ? 3 : 8;
      const valuable = (drop.items?.length ?? 0) > 0;
      this.polygon([{ x: p.x - size, y: p.y - size / 2 }, { x: p.x, y: p.y - size }, { x: p.x + size, y: p.y - size / 2 }, { x: p.x, y: p.y + 1 }], valuable ? '#cfa155' : '#d2a662', '#efd49a');
      if (!this.overview) {
        c.fillStyle = '#9b753e'; c.fillRect(p.x - 6, p.y - 3, 12, 8);
        const label = liveDropLabel(drop);
        this.label(label.length > 35 ? `${label.slice(0, 32)}…` : label, p.x, p.y + 22, '#ebc98d', 9);
        if (valuable) this.label(`≈ ${liveLootTotals(drop.items!).guide.toLocaleString('ru-RU')} ₽`, p.x, p.y + 35, '#c6bd9a', 8);
      }
    } });
    this.hitTargets = [];
    for (const entity of snapshot.entities) objects.push({ depth: entity.x + entity.y + .1, paint: () => this.paintEntity(entity, now) });
    objects.sort((a, b) => a.depth - b.depth).forEach(object => object.paint());
    this.paintCombat(now);
    this.minimap(snapshot);
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
      if (!this.overview && event.damage) this.label(`−${event.damage}`, to.x, to.y - 15 - age / 55, '#f4c497', 12);
      c.restore();
    }
  }
  private paintEntity(entity: LiveEntity, now: number): void {
    const snapshot = this.snapshot!, motion = this.motions.get(entity.id)!, point = this.interpolated(motion, now), p = this.project(point), c = this.context;
    if (p.x < -40 || p.x > this.width + 40 || p.y < -50 || p.y > this.height + 100) return;
    const own = entity.id === snapshot.selfId, selected = entity.id === this.selected, color = own ? '#f2d49a' : entity.kind === 'player' ? '#8dd5e4' : entity.faction === 'raiders' ? '#e48971' : '#d2a082';
    if (this.overview || this.tile < 28) {
      c.fillStyle = color; c.strokeStyle = '#15241a'; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, own || selected ? 4.5 : 2.8, 0, Math.PI * 2); c.fill(); c.stroke();
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
    for (const obstacle of snapshot.world.obstacles) { c.fillStyle = '#63715b'; c.fillRect(x + obstacle.x * scale, y + obstacle.y * scale, obstacle.width * scale, obstacle.height * scale); }
    for (const extract of snapshot.world.extracts) { c.fillStyle = '#a9d380'; c.fillRect(x + extract.x * scale - 2, y + extract.y * scale - 2, 4, 4); }
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
