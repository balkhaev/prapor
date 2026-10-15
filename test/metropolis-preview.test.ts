import { describe, expect, test } from 'bun:test';
import type { LiveCitySite, LiveWorld } from '../src/game/live';
import { cityPreviewFocus, createCityPreviewSnapshot } from '../src/metropolis-preview';

const site = (id: string, x: number, y: number): LiveCitySite => ({ id, poiId: id, quarterId: id, name: id, kind: 'courtyard', x, y, width: 40, height: 40,
  courtyard: { x: x + 10, y: y + 10, width: 12, height: 8 }, buildings: [], passages: [] });
const world: LiveWorld & { npcSpawns: unknown[]; lootSpawns: unknown[] } = {
  id: 'perimeter', name: 'Периметр', description: 'Город', theme: 'mixed', width: 1024, height: 1024, version: 'g10', seed: 'preview-fixture', generatorVersion: 10, chunkSize: 32,
  obstacles: [], extracts: [], zones: [], districts: [], pois: [], containers: [{ id: 'private-loot-anchor' }] as LiveWorld['containers'],
  city: { name: 'Ольховск', x: 128, y: 128, width: 768, height: 768, quarters: [
    { id: 'west', name: 'Западный район', x: 128, y: 368, width: 240, height: 144 },
    { id: 'east', name: 'Восточный район', x: 656, y: 368, width: 240, height: 144 }] },
  citySites: [site('far-west', 130, 375), site('near-west', 220, 410), site('east', 740, 410)],
  terrainRows: ['g'], props: [], npcSpawns: [{ hidden: 'spawn' }], lootSpawns: [{ hidden: 'loot' }],
};

describe('public city gallery', () => {
  test('observer snapshot exposes static scenery without a session, live actors or authored loot/spawn data', () => {
    const before = structuredClone(world), snapshot = createCityPreviewSnapshot(world, 12345);
    expect(snapshot.world.width).toBe(1024); expect(snapshot.world.city?.quarters).toEqual(world.city!.quarters);
    expect(snapshot.world.citySites).toBe(world.citySites);
    expect(snapshot.entities).toEqual([]); expect(snapshot.drops).toEqual([]); expect(snapshot.events).toEqual([]);
    expect(snapshot.world.containers).toEqual([]); expect(snapshot.world.routes).toBeUndefined();
    expect('npcSpawns' in snapshot.world).toBe(false); expect('lootSpawns' in snapshot.world).toBe(false);
    expect(snapshot.selfId).toBe(snapshot.self.id); expect(snapshot.self.gameId).toBeUndefined(); expect(snapshot.self.loadout).toBeUndefined();
    expect(snapshot.self.ammo).toBe(0); expect(snapshot.server.online).toBe(0); expect(snapshot.server.capacity).toBe(0);
    expect(snapshot.now).toBe(12345); expect(world).toEqual(before);
  });
  test('quarter focus finds a real local courtyard and never takes a similarly named distant site', () => {
    expect(cityPreviewFocus(world, 'west')).toEqual({ x: 236, y: 424 });
    expect(cityPreviewFocus(world, 'east')).toEqual({ x: 756, y: 424 });
    const empty = { ...world, citySites: [] };
    expect(cityPreviewFocus(empty, 'west')).toEqual({ x: 248, y: 440 });
    expect(cityPreviewFocus(empty, 'unknown')).toEqual({ x: 512, y: 512 });
    expect(cityPreviewFocus({ ...empty, city: undefined })).toEqual({ x: 512, y: 512 });
  });
});
