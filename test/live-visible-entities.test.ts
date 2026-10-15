import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveService, type LiveService } from '../server/live';
import { createLiveNavigation } from '../server/live-navigation';
import { readLiveSnapshot } from '../src/live-client';
import { getLiveMap } from '../src/game/live-maps';
import type { LivePoint, LiveSnapshot } from '../src/game/live';

test('a dense legal encounter keeps self and nearest visible fighters inside the client cap without exposing hidden NPC state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prapor-visible-cap-')), dbPath = join(directory, 'live.sqlite');
  const now = 1_800_000_000_000, origin = 'https://game.delopusk.ru';
  const options = { dbPath, now: () => now, random: () => 0, automaticTicks: false, allowedOrigins: [origin] };
  let service: LiveService | null = null;
  try {
    service = createLiveService(options);
    const first = await service.fetch(new Request(`${origin}/api/live/join`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' }), '192.0.2.166');
    expect(first?.status).toBe(200);
    const cookie = first!.headers.get('set-cookie')!.split(';')[0]!, initial = await first!.json() as LiveSnapshot;
    const self = initial.entities.find(entity => entity.id === initial.selfId)!;
    const map = getLiveMap('perimeter'), nav = createLiveNavigation(map), visible: LivePoint[] = [], hidden: LivePoint[] = [];
    for (let y = Math.max(0, self.y - 24); y <= Math.min(map.height - 1, self.y + 24); y++) for (let x = Math.max(0, self.x - 24); x <= Math.min(map.width - 1, self.x + 24); x++) {
      const point = { x, y };
      if (x === self.x && y === self.y || Math.hypot(x - self.x, y - self.y) > 24 || !nav.walkable(point)) continue;
      (nav.hasLineOfSight(self, point) ? visible : hidden).push(point);
    }
    expect(visible.length).toBeGreaterThan(300);
    visible.sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y) || a.y - b.y || a.x - b.x);
    const encounter = visible.slice(0, 300).map((point, i) => ({ ...point, id: `crowd-${String(299 - i).padStart(3, '0')}` }));
    service.close(); service = null;
    const db = new Database(dbPath);
    try {
      const saved = JSON.parse(db.query<{ state: string }, []>('SELECT state FROM live_world WHERE id=1').get()!.state);
      const authored = saved.scavs[0];
      const privatePoints = [hidden[0], map.districts.at(-1)!.spawns[0]].filter((point): point is LivePoint => Boolean(point));
      saved.scavs = [...encounter, ...privatePoints.map((point, i) => ({ ...point, id: `hidden-${i}` }))].map((point, i) => ({ ...authored,
        ...point, home: { x: point.x, y: point.y }, route: [{ x: point.x, y: point.y }], routeIndex: 0, spawnIndex: i,
        nextMove: now + 1_000_000, nextAttack: now + 1_000_000, privateDiagnostic: 'never-public' }));
      db.query('UPDATE live_world SET state=? WHERE id=1').run(JSON.stringify(saved));
    } finally { db.close(); }
    service = createLiveService(options);
    const response = await service.fetch(new Request(`${origin}/api/live/join`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'x-prapor-live': initial.selfId }, body: '{}' }), '192.0.2.166');
    expect(response?.status).toBe(200);
    const packet = await response!.json() as LiveSnapshot, parsed = readLiveSnapshot(packet);
    expect(parsed.entities).toHaveLength(256); expect(parsed.entities[0]!.id).toBe(initial.selfId);
    const expected = encounter.sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 255).map(entity => entity.id);
    expect(parsed.entities.slice(1).map(entity => entity.id)).toEqual(expected);
    expect(parsed.entities.some(entity => entity.id.startsWith('hidden-'))).toBe(false);
    expect(JSON.stringify(parsed.entities)).not.toContain('never-public');
    expect(parsed.entities.every(entity => !Object.hasOwn(entity, 'body') && !Object.hasOwn(entity, 'home') && !Object.hasOwn(entity, 'route'))).toBe(true);
    const again = await service.fetch(new Request(`${origin}/api/live/state`, { headers: { cookie, 'x-prapor-live': initial.selfId, 'x-prapor-world-version': map.version } }), '192.0.2.166');
    expect(readLiveSnapshot(await again!.json(), parsed.world).entities).toEqual(parsed.entities);
  } finally { service?.close(); await rm(directory, { recursive: true, force: true }); }
});
