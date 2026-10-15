import { describe, expect, test } from 'bun:test';
import { liveRequest, readLiveSnapshot, readLiveStatus, readLiveWorld, LiveApiError } from '../src/live-client';
import type { LiveCitySite, LiveWorld } from '../src/game/live';
import { LIVE_WORLD_LIMITS as LIMITS } from '../src/game/live-world-limits';
import { createHealth, createMedicalInventory } from '../src/game/health';

function metropolis(): LiveWorld {
  const districtIds = ['customs', 'sawmill', 'depot', 'village'] as const;
  const city = { name: 'Ольховск', x: 128, y: 128, width: 768, height: 768,
    quarters: Array.from({ length: 16 }, (_, i) => ({ id: `quarter-${i}`, name: `Квартал ${i}`, x: 128 + i % 4 * 192, y: 128 + Math.floor(i / 4) * 192, width: 192, height: 192 })) };
  const world: LiveWorld = { id: 'perimeter', name: 'Периметр', description: 'Большой город', theme: 'mixed', width: 1024, height: 1024,
    version: 'metropolis-wire', seed: 'large-wire', generatorVersion: 10, chunkSize: 16, city,
    districts: districtIds.map((id, i) => ({ id, name: id, description: id, theme: 'urban', x: i % 2 * 512, y: Math.floor(i / 2) * 512,
      width: 512, height: 512, spawns: [{ x: i % 2 * 512 + 1, y: Math.floor(i / 2) * 512 + 1 }] })),
    terrainRows: Array<string>(1024).fill('r'.repeat(1024)), obstacles: [], props: [], extracts: [{ x: 1, y: 1 }],
    zones: [], paths: [], pois: [], containers: [], citySites: [] };
  for (let i = 0; i < 200; i++) {
    const quarter = city.quarters[i % 16]!, local = Math.floor(i / 16), x = quarter.x + local % 4 * 40 + 8, y = quarter.y + Math.floor(local / 4) * 40 + 8;
    const site: LiveCitySite = { id: `site-${i}`, poiId: `poi-${i}`, quarterId: quarter.id, name: 'Двор', kind: 'courtyard', x, y, width: 28, height: 28,
      courtyard: { x: x + 10, y: y + 10, width: 8, height: 8 },
      buildings: Array.from({ length: i % 2 ? 4 : 3 }, (_, room) => ({ id: `building-${i}-${room}`, name: 'Дом', kind: 'apartment',
        x: x + 2 + room % 2 * 12, y: y + 2 + Math.floor(room / 2) * 12, width: 8, height: 8,
        entrances: [{ x: x + 2 + room % 2 * 12, y: y + 4 + Math.floor(room / 2) * 12 }, { x: x + 9 + room % 2 * 12, y: y + 4 + Math.floor(room / 2) * 12 }] })),
      passages: [[{ x, y: y + 14 }, { x: x + 27, y: y + 14 }], [{ x: x + 14, y }, { x: x + 14, y: y + 27 }]] };
    world.citySites!.push(site);
    world.pois.push({ id: site.poiId, templateId: 'city', name: site.name, districtId: 'customs', x, y, width: 28, height: 28,
      danger: 1, tags: ['city'], entrances: [{ x, y: y + 14 }] });
    world.zones.push({ x, y, width: 28, height: 28, name: site.name, terrain: 'concrete', danger: 1 });
  }
  for (let i = 0; i < 12000; i++) {
    const prop = { id: `prop-${i}`, kind: 'crate' as const, x: i % 1000, y: Math.floor(i / 1000), width: 1, height: 1,
      orientation: 'x' as const, variant: 0, blocking: i < 10000 };
    world.props!.push(prop);
    if (prop.blocking) world.obstacles.push({ x: prop.x, y: prop.y, width: 1, height: 1, kind: 'container', propId: prop.id });
  }
  world.containers = Array.from({ length: 1200 }, (_, i) => ({ id: `container-${i}`, poiId: world.pois[i % 200]!.id,
    x: world.pois[i % 200]!.x + 1, y: world.pois[i % 200]!.y + 1, kind: 'crate', lootTable: 'mixed', searchMs: 3000 }));
  world.paths = Array.from({ length: 700 }, (_, i) => ({ id: `road-${i}`, name: 'Улица', kind: 'road', width: 2, points: [{ x: 0, y: i }, { x: 1023, y: i }] }));
  return world;
}
function status(world: LiveWorld) {
  return { id: 'perimeter-1', name: 'Периметр', online: 1, capacity: 32, startedAt: 1000,
    maps: [{ id: world.id, name: world.name, description: world.description, theme: world.theme, width: world.width, height: world.height, online: 1, npcs: 384, city: world.city }],
    districts: world.districts.map((district, i) => ({ ...district, online: i ? 0 : 1, npcs: 96 })) };
}

describe('bounded metropolis wire geometry', () => {
  test('a 1024 city accepts 700 buildings, 10k real colliders and 12k props without exposing private generation state', () => {
    const source = metropolis(), parsed = readLiveWorld({ ...source, npcSpawns: [{ point: { x: 9, y: 9 }, privateTarget: 'hidden' }] });
    expect(parsed).toEqual(source); expect(parsed.props).not.toBe(source.props);
    expect(parsed.citySites!.reduce((n, site) => n + site.buildings.length, 0)).toBe(700);
    expect(parsed.obstacles).toHaveLength(10000); expect(parsed.props).toHaveLength(12000);
    expect(readLiveStatus(status(parsed)).maps[0]!.npcs).toBe(384);
    expect(new TextEncoder().encode(JSON.stringify(source)).byteLength).toBeLessThan(8 * 1024 * 1024);
    expect(Object.hasOwn(parsed, 'npcSpawns')).toBe(false);
  });

  test('larger budgets retain exact collider matching, known references, finite coordinates and valid terrain', () => {
    const source = metropolis();
    const edits: Array<(world: LiveWorld) => void> = [
      world => { world.props![9999]!.width = 2; },
      world => { world.obstacles[9999]!.propId = world.obstacles[0]!.propId; },
      world => { world.obstacles[9999]!.propId = 'unknown-prop'; },
      world => { world.props![0]!.blocking = false; },
      world => { world.obstacles.pop(); },
      world => { world.containers[1199]!.poiId = 'hidden-poi'; },
      world => { world.citySites![199]!.buildings[0]!.id = world.citySites![0]!.buildings[0]!.id; },
      world => { world.props![11999]!.x = Number.NaN; },
      world => { world.terrainRows![1023] = 'r'.repeat(1023) + 'x'; },
      world => { Object.assign(world.citySites![0]!, { loot: 'private' }); },
    ];
    for (const edit of edits) { const packet = structuredClone(source); edit(packet); expect(() => readLiveWorld(packet)).toThrow(LiveApiError); }
  });

  test('all geometry collections, total buildings and city partitions keep explicit upper bounds', () => {
    const source = metropolis();
    for (const [field, limit] of [['obstacles', LIMITS.obstacles], ['props', LIMITS.props], ['pois', LIMITS.pois], ['containers', LIMITS.containers], ['zones', LIMITS.zones], ['paths', LIMITS.paths], ['citySites', LIMITS.citySites]] as const) {
      expect(() => readLiveWorld({ ...source, [field]: Array(limit + 1).fill(source[field]![0]) })).toThrow(LiveApiError);
    }
    const buildings = structuredClone(source);
    let count = 700;
    while (count < LIMITS.buildings) for (const site of buildings.citySites!) {
      if (count >= LIMITS.buildings) break;
      site.buildings.push({ ...site.buildings[0]!, id: `extra-${count++}` });
    }
    expect(readLiveWorld(buildings).citySites!.reduce((n, site) => n + site.buildings.length, 0)).toBe(LIMITS.buildings);
    buildings.citySites![0]!.buildings.push({ ...buildings.citySites![0]!.buildings[0]!, id: 'one-too-many' });
    expect(() => readLiveWorld(buildings)).toThrow(LiveApiError);
    for (const mutate of [(world: LiveWorld) => { world.city!.quarters[0]!.x++; },
      (world: LiveWorld) => { world.city!.quarters[0]!.width--; },
      (world: LiveWorld) => { world.city!.quarters.push({ ...world.city!.quarters[0]!, id: 'extra-quarter' }); }]) {
      const packet = structuredClone(source); mutate(packet); expect(() => readLiveWorld(packet)).toThrow(LiveApiError);
    }
    expect(() => readLiveWorld({ ...source, width: 1025 })).toThrow(LiveApiError);
    const tooManyNpcs = status(source); tooManyNpcs.maps[0]!.npcs = LIMITS.npcs + 1;
    expect(() => readLiveStatus(tooManyNpcs)).toThrow(LiveApiError);
  });

  test('cached geometry does not expand the nearby actor or streaming chunk visibility budgets', () => {
    const world = metropolis(), entity = { id: 'self', name: 'Боец', kind: 'player', appearance: 0, x: 1023, y: 1023, health: 100, action: 'idle', safeUntil: 0 };
    const packet = { server: status(world), now: 2000, selfId: 'self', worldVersion: world.version,
      self: { id: 'self', ammo: 30, medkits: 2, cargo: 0, stash: 0, kills: 0, respawnAt: 0, travelReadyAt: 0, leaveAt: 0,
        patrol: false, targetId: null, districtId: 'customs', purpose: 'loot', searching: null, body: createHealth(), medicine: createMedicalInventory(), treatment: null },
      entities: [entity], drops: [], events: [], visibleChunks: [{ x: 63, y: 63 }] };
    expect(readLiveSnapshot(packet, world).world).toBe(world);
    expect(() => readLiveSnapshot({ ...packet, entities: Array.from({ length: 257 }, (_, i) => ({ ...entity, id: i ? `enemy-${i}` : 'self' })) }, world)).toThrow(LiveApiError);
    expect(() => readLiveSnapshot({ ...packet, visibleChunks: Array.from({ length: 257 }, (_, i) => ({ x: i % 64, y: Math.floor(i / 64) })) }, world)).toThrow(LiveApiError);
    expect(() => readLiveSnapshot({ ...packet, visibleChunks: [{ x: 64, y: 63 }] }, world)).toThrow(LiveApiError);
  });
});

describe('bounded live HTTP response', () => {
  const request = (response: Response, read: (value: unknown) => unknown = value => value) => liveRequest('status', { accountId: null }, read,
    undefined, undefined, undefined, (async () => response) as unknown as typeof fetch);
  test('UTF8 characters survive arbitrary byte splits before validation', async () => {
    const payload = { name: 'Улица 雪', value: 5 }, bytes = new TextEncoder().encode(JSON.stringify(payload));
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); else controller.close(); } });
    expect(await request(new Response(body))).toEqual(payload);
  });
  test('declared or chunked oversized bodies are rejected before they reach the parser', async () => {
    let parsed = false, cancelled = false;
    const read = (value: unknown) => { parsed = true; return value; };
    await expect(request(new Response('{}', { headers: { 'content-length': String(LIMITS.wireBytes + 1) } }), read)).rejects.toMatchObject({ code: 'invalid_response' });
    let count = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(++count <= 16 ? 1024 * 1024 : 1)); }, cancel() { cancelled = true; } });
    await expect(request(new Response(body), read)).rejects.toMatchObject({ code: 'invalid_response' });
    expect(parsed).toBe(false); expect(cancelled).toBe(true);
  });
});
