import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService } from '../server/live';
import { getLiveMap } from '../src/game/live-maps';
import type { LiveEntity, LiveEvent, LivePoint } from '../src/game/live';

interface Actor extends LiveEntity {
  role: 'patrol' | 'guard' | 'marksman'; home: LivePoint;
  alife?: { phase: string };
}
interface SavedWorld { scavs: Actor[]; events: LiveEvent[] }
interface RoleStats { population: number; moved: number; steps: number; visitedCells: number; greatestDistance: number }

/** Runs the production simulation against disposable storage, without a server or debug endpoint. */
export function runAlifeBalance(seconds = 900, probeProductionCadence = false) {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('Choose 1–3600 simulated seconds');
  const world = getLiveMap('perimeter'), directory = mkdtempSync(join(tmpdir(), 'prapor-alife-balance-'));
  const blocked = new Uint8Array(world.width * world.height);
  for (const wall of world.obstacles) for (let y = wall.y; y < wall.y + wall.height; y++) for (let x = wall.x; x < wall.x + wall.width; x++) blocked[y * world.width + x] = 1;
  if (world.terrainRows) for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) if (world.terrainRows[y]?.[x] === 'w') blocked[y * world.width + x] = 1;
  let time = 1_800_000_000_000;
  const path = join(directory, 'live.sqlite'), live = createLiveService({ dbPath: path, now: () => time, random: () => .5, automaticTicks: false });
  const db = new Database(path, { readonly: true });
  const query = db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1');
  const read = (): SavedWorld => JSON.parse(query.get()!.state);
  const initial = read(), actors = new Map(initial.scavs.map(actor => [actor.id, {
    last: actor, cells: new Set([`${actor.x},${actor.y}`]), steps: 0, greatestDistance: 0,
  }]));
  const metrics = {
    seconds, population: actors.size, minimumAlive: actors.size, finalAlive: actors.size,
    deaths: 0, respawns: 0, shots: 0, totalSteps: 0, collisions: 0, illegalCells: 0,
    jumps: 0, identityChanges: 0, spontaneousHealing: 0, healthy: true,
    activities: {} as Record<string, number>,
    roles: Object.fromEntries(['patrol', 'guard', 'marksman'].map(role => [role, { population: 0, moved: 0, steps: 0, visitedCells: 0, greatestDistance: 0 }])) as Record<Actor['role'], RoleStats>,
    districts: {} as Record<string, { population: number; moved: number; steps: number }>,
    minutes: [] as Array<{ minute: number; moving: number; steps: number; alive: number }>,
    elapsedMs: 0,
    tickTimingMs: { p50: 0, p95: 0, max: 0 },
    productionCadence: null as null | { seconds: number; ticks: number; p50: number; p95: number; max: number },
  };
  const seenEvents = new Set<string>(), minuteMovers = new Set<string>(); let minuteSteps = 0;
  const timings: number[] = [];
  const distribution = (values: number[]) => {
    values.sort((a, b) => a - b);
    const rounded = (value: number) => Math.round(value * 100) / 100;
    return { p50: rounded(values[Math.floor(values.length * .5)]!), p95: rounded(values[Math.floor(values.length * .95)]!), max: rounded(values.at(-1)!) };
  };
  const began = performance.now();
  try {
    for (let tick = 1; tick <= seconds; tick++) {
      time += 1000; const tickStarted = performance.now(); live.tick(); timings.push(performance.now() - tickStarted);
      const saved = read(), occupied = new Set<number>();
      metrics.healthy &&= live.healthy();
      if (saved.scavs.length !== actors.size) metrics.identityChanges++;
      metrics.finalAlive = saved.scavs.filter(actor => actor.health > 0).length;
      metrics.minimumAlive = Math.min(metrics.minimumAlive, metrics.finalAlive);
      for (const event of saved.events) if (!seenEvents.has(event.id)) {
        seenEvents.add(event.id); if (event.kind === 'combat' && event.from && event.to && event.damage !== undefined) metrics.shots++;
      }
      for (const actor of saved.scavs) {
        const stat = actors.get(actor.id); if (!stat) { metrics.identityChanges++; continue; }
        const previous = stat.last;
        if (previous.health > 0 && actor.health <= 0) metrics.deaths++;
        if (previous.health <= 0 && actor.health > 0) metrics.respawns++;
        if (actor.health > 0) {
          const cell = actor.y * world.width + actor.x;
          if (!Number.isInteger(actor.x) || !Number.isInteger(actor.y) || actor.x < 0 || actor.y < 0 || actor.x >= world.width || actor.y >= world.height || blocked[cell]) metrics.illegalCells++;
          if (occupied.has(cell)) metrics.collisions++; occupied.add(cell);
          const activity = actor.alife?.phase ?? 'legacy'; metrics.activities[activity] = (metrics.activities[activity] ?? 0) + 1;
          if (previous.health > 0) {
            const step = Math.abs(actor.x - previous.x) + Math.abs(actor.y - previous.y);
            if (step > 1) metrics.jumps++;
            if (actor.health > previous.health) metrics.spontaneousHealing++;
            stat.steps += step; metrics.totalSteps += step; minuteSteps += step;
            if (step) minuteMovers.add(actor.id);
          }
          stat.cells.add(`${actor.x},${actor.y}`);
          stat.greatestDistance = Math.max(stat.greatestDistance, Math.hypot(actor.x - actor.home.x, actor.y - actor.home.y));
        }
        stat.last = actor;
      }
      if (tick % 60 === 0 || tick === seconds) {
        metrics.minutes.push({ minute: Math.ceil(tick / 60), moving: minuteMovers.size, steps: minuteSteps, alive: metrics.finalAlive });
        minuteMovers.clear(); minuteSteps = 0;
      }
    }
    for (const { last: actor, steps, cells, greatestDistance } of actors.values()) {
      const role = metrics.roles[actor.role]; role.population++; role.moved += Number(steps > 0); role.steps += steps; role.visitedCells += cells.size; role.greatestDistance = Math.max(role.greatestDistance, greatestDistance);
      const district = world.districts.find(area => actor.home.x >= area.x && actor.home.x < area.x + area.width && actor.home.y >= area.y && actor.home.y < area.y + area.height)!.id;
      const local = metrics.districts[district] ??= { population: 0, moved: 0, steps: 0 }; local.population++; local.moved += Number(steps > 0); local.steps += steps;
    }
    metrics.tickTimingMs = distribution(timings);
    if (probeProductionCadence) {
      // SQL persistence samples once a second. This separate probe measures the
      // real 20 Hz workload without pretending those samples capture every step.
      const fineTimings: number[] = [];
      for (let tick = 0; tick < 600; tick++) {
        time += 50; const tickStarted = performance.now(); live.tick(); fineTimings.push(performance.now() - tickStarted);
      }
      metrics.healthy &&= live.healthy();
      metrics.productionCadence = { seconds: 30, ticks: fineTimings.length, ...distribution(fineTimings) };
    }
    metrics.elapsedMs = Math.round(performance.now() - began); return metrics;
  } finally { db.close(); live.close(); rmSync(directory, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const metrics = runAlifeBalance(Number(Bun.argv[2]) || 900, true);
  console.log(JSON.stringify(metrics, null, 2));
  if (!metrics.healthy || metrics.collisions || metrics.illegalCells || metrics.jumps || metrics.identityChanges || metrics.spontaneousHealing) process.exitCode = 1;
}
