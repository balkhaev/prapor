import { expect, test } from 'bun:test';
import { getLiveMap } from '../src/game/live-maps';
import type { LiveCitySite, LiveWorld } from '../src/game/live';
import { LiveApiError, readLiveWorld } from '../src/live-client';

function fixture(): LiveWorld {
  const { npcSpawns: _npcs, lootSpawns: _loot, ...world } = structuredClone(getLiveMap('perimeter'));
  const city = world.city!;
  const poi = world.pois.find(poi => poi.tags.includes('city') && poi.width >= 12 && poi.height >= 12)!;
  const quarter = city.quarters.find(quarter => poi.x >= quarter.x && poi.y >= quarter.y && poi.x + poi.width <= quarter.x + quarter.width && poi.y + poi.height <= quarter.y + quarter.height)!;
  const { x, y, width, height } = poi;
  const site: LiveCitySite = {
    id: 'wire-courtyard', poiId: poi.id, quarterId: quarter.id, name: 'Двор у мастерской', kind: 'courtyard', x, y, width, height,
    courtyard: { x: x + 7, y: y + 2, width: 3, height: 6 },
    buildings: [{ id: 'wire-workshop', name: 'Мастерская', kind: 'workshop', x: x + 1, y: y + 1, width: 5, height: 5,
      entrances: [{ x: x + 1, y: y + 3 }, { x: x + 5, y: y + 3 }] }],
    passages: [[{ x, y: y + 8 }, { x: x + 8, y: y + 8 }], [{ x: x + 8, y: y + 8 }, { x: x + 8, y: y + height - 1 }]],
  };
  world.citySites = [site];
  return world;
}

test('city architecture travels only with immutable geometry and has detached nested arrays', () => {
  const source = fixture(), parsed = readLiveWorld(source);
  expect(parsed.citySites).toEqual(source.citySites);
  parsed.citySites![0]!.buildings[0]!.entrances[0]!.x++;
  parsed.citySites![0]!.passages[0]![0]!.y++;
  expect(parsed.citySites).not.toEqual(source.citySites);
  const legacy = fixture(); delete legacy.citySites;
  expect(readLiveWorld(legacy).citySites).toBeUndefined();
});

test('city parser rejects broken ownership, overlarge geometry and actor or reward metadata', () => {
  const edits: Array<(world: LiveWorld, site: LiveCitySite) => void> = [
    (_world, site) => { site.poiId = 'unknown-city-poi'; },
    (_world, site) => { site.quarterId = 'unknown-quarter'; },
    (_world, site) => { site.x++; },
    (_world, site) => { site.courtyard.width = site.width; },
    (_world, site) => { site.buildings[0]!.x = site.x - 1; },
    (_world, site) => { site.buildings[0]!.entrances[0]!.x = site.x + site.width; },
    (_world, site) => { site.passages[0]![0]!.x = 1.5; },
    (_world, site) => { site.passages[0]![1]!.y++; },
    (_world, site) => { site.passages = [site.passages[0]!]; },
    (_world, site) => { Object.assign(site, { immunity: true }); },
    (_world, site) => { Object.assign(site.buildings[0]!, { lootContents: ['gold-ring'] }); },
    (_world, site) => { Object.assign(site.courtyard, { enemyPositions: [{ x: 3, y: 4 }] }); },
    (world, site) => { world.citySites = Array.from({ length: 65 }, () => structuredClone(site)); },
    (world, site) => { world.citySites!.push(structuredClone(site)); },
    (world) => { delete world.city; },
  ];
  for (const edit of edits) {
    const source = fixture(); edit(source, source.citySites![0]!);
    expect(() => readLiveWorld(source)).toThrow(LiveApiError);
  }
});
