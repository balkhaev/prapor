import { expect, test } from 'bun:test';
import { createLiveService } from '../server/live';
import { getLiveMap } from '../src/game/live-maps';
import { readLiveSnapshot, readLiveStatus } from '../src/live-client';

test('the lobby previews published routes while cached state updates omit static recommendations', async () => {
  const origin = 'https://game.delopusk.ru', world = getLiveMap('perimeter');
  const service = createLiveService({ dbPath: ':memory:', allowedOrigins: [origin], secureCookies: true, automaticTicks: false });
  try {
    const response = await service.fetch(new Request(`${origin}/api/live/status`));
    const status = readLiveStatus(await response!.json());
    expect(status.maps[0]!.city).toEqual(world.city);
    expect(status.districts.map(district => district.labelPoint)).toEqual(world.districts.map(district => district.labelPoint));
    expect(status.routes).toHaveLength(16);
    expect(status.routes).toEqual(world.routes!.map(route => ({ id: route.id, name: route.name, description: route.description,
      districtId: route.districtId, purpose: route.purpose, stops: route.poiIds.map(id => world.pois.find(poi => poi.id === id)!.name) })));
    const join = await service.fetch(new Request(`${origin}/api/live/join`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' }));
    const full = readLiveSnapshot(await join!.json()), cookie = join!.headers.get('set-cookie')!.split(';')[0]!;
    expect(full.server.routes).toBeUndefined(); expect(full.world.routes).toEqual(world.routes);
    expect(full.server.maps[0]!.city).toBeUndefined(); expect(full.world.city).toEqual(world.city);
    expect(full.world.citySites).toEqual(world.citySites);
    const update = await service.fetch(new Request(`${origin}/api/live/state`, { headers: { cookie, 'x-prapor-live': full.selfId, 'x-prapor-world-version': full.worldVersion } }));
    const wire = await update!.json() as Record<string, unknown>;
    expect(wire.world).toBeUndefined();
    const decoded = readLiveSnapshot(wire, full.world);
    expect(decoded.server.routes).toBeUndefined(); expect(decoded.world).toBe(full.world);
    expect(decoded.world.city).toBe(full.world.city);
    expect(decoded.world.citySites).toBe(full.world.citySites);
  } finally { service.close(); }
});
