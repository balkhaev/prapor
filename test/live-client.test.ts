import { describe, expect, test } from 'bun:test';
import { LiveApiError, liveRequest, readLiveSnapshot, readLiveStatus, shouldRejoinLivePresence } from '../src/live-client';
import { LIVE_NPC_ACTIVITIES, LIVE_TERRAIN_CODES, type LiveSnapshot } from '../src/game/live';
import { getLiveMap } from '../src/game/live-maps';
import { createHealth, createMedicalInventory } from '../src/game/health';
import { FACTORY_KITS } from '../src/game/modules';
import { LIVE_WORLD_LIMITS } from '../src/game/live-world-limits';

const fixture = (): LiveSnapshot => {
  const { npcSpawns, lootSpawns: _loot, ...world } = structuredClone(getLiveMap('perimeter'));
  return {
  server: { id: 'perimeter-1', name: 'Периметр 01', online: 1, capacity: 32, startedAt: 1000,
    maps: [{ id: world.id, name: world.name, description: world.description, theme: world.theme, width: world.width, height: world.height, online: 1, npcs: npcSpawns.length }],
    districts: world.districts.map((district, index) => ({ ...district, online: index === 0 ? 1 : 0, npcs: npcSpawns.filter(spawn => spawn.point.x >= district.x && spawn.point.x < district.x + district.width && spawn.point.y >= district.y && spawn.point.y < district.y + district.height).length })),
  }, now: 2000, world, worldVersion: world.version, visibleChunks: [{ x: 0, y: 0 }], selfId: 'player-1',
  self: { id: 'player-1', ammo: 30, medkits: 3, cargo: 0, stash: 12, kills: 0, respawnAt: 0, patrol: false, targetId: null, travelReadyAt: 0, districtId: 'customs', purpose: 'loot', searching: null, body: createHealth(), medicine: createMedicalInventory(), treatment: null, leaveAt: 0 },
  entities: [{ id: 'player-1', kind: 'player', name: 'Гость 01', appearance: 31, x: 2, y: 2, health: 100, action: 'idle', safeUntil: 7000 }, { id: 'scav-1', kind: 'scav', name: 'Косой', appearance: 0, x: 4, y: 6, health: 75, action: 'moving', safeUntil: 0, faction: 'raiders', role: 'guard' }],
  drops: [{ id: 'drop-1', x: 3, y: 2, amount: 25 }], events: [{ id: 'event-1', at: 2000, kind: 'join', text: 'Гость 01 вошёл', actorId: 'player-1' }],
}; };

describe('live wire parser', () => {
  test('keeps only bounded observed NPC activity and accepts legacy snapshots', () => {
    const packet = fixture();
    expect(readLiveSnapshot(packet).entities[1]!.npcActivity).toBeUndefined();
    for (const activity of LIVE_NPC_ACTIVITIES) {
      packet.entities[1]!.npcActivity = activity;
      Object.assign(packet.entities[1]!, { alife: { targetId: 'hidden', goal: { x: 99, y: 99 } } });
      const observed = readLiveSnapshot(packet).entities[1]!;
      expect(observed.npcActivity).toBe(activity);
      expect(observed).not.toHaveProperty('alife');
    }
    const { world: _world, ...cached } = packet;
    expect(readLiveSnapshot(cached, packet.world).entities[1]!.npcActivity).toBe(LIVE_NPC_ACTIVITIES.at(-1));
    for (const invalid of [null, {}, [], 'teleport', 'constructor', 0]) {
      Object.assign(packet.entities[1]!, { npcActivity: invalid });
      expect(() => readLiveSnapshot(packet)).toThrow(LiveApiError);
    }
    delete packet.entities[1]!.npcActivity;
    Object.assign(packet.entities[0]!, { npcActivity: 'patrol' });
    expect(() => readLiveSnapshot(packet)).toThrow(LiveApiError);
  });
  test('copies only visible squad affiliation for ordinary NPCs in full and cached snapshots', () => {
    const source = fixture(), member = source.entities[1]!;
    expect(readLiveSnapshot(source).entities[1]!.npcSquad).toBeUndefined();
    for (const district of ['customs', 'sawmill', 'depot', 'village']) {
      for (const faction of ['scavs', 'raiders'] as const) {
        member.faction = faction;
        member.npcSquad = { id: `squad-${district}-${faction}-9`, leader: faction === 'scavs' };
        const parsed = readLiveSnapshot(source);
        expect(parsed.entities[1]!.npcSquad).toEqual(member.npcSquad);
        expect(parsed.entities[1]!.npcSquad).not.toBe(member.npcSquad);
        const { world: _world, ...cached } = source;
        expect(readLiveSnapshot(cached, parsed.world).entities[1]!.npcSquad).toEqual(member.npcSquad);
      }
    }
  });
  test('defense activity never imports private alarm, destination or reinforcement state', () => {
    const source = fixture();
    for (const npcActivity of ['defend', 'reinforce', 'retake'] as const) {
      Object.assign(source.entities[1]!, { npcActivity, alarmId: 'base-private-1', responseTarget: { id: 'hidden-site', x: 99, y: 88 }, incomingCount: 3 });
      const parsed = readLiveSnapshot(source), actor = parsed.entities[1]!;
      expect(actor.npcActivity).toBe(npcActivity);
      for (const key of ['alarmId', 'responseTarget', 'incomingCount']) expect(actor).not.toHaveProperty(key);
      const { world: _world, ...cached } = source;
      expect(readLiveSnapshot(cached, parsed.world).entities[1]).toEqual(actor);
    }
    const poi = source.world.pois[0]!, site = { id: poi.id, x: poi.x, y: poi.y, kind: 'base', owner: 'raiders', contested: true };
    for (const extra of [{ alarmId: 'private-alarm' }, { incomingCount: 3 }, { target: { x: 99, y: 88 } }])
      expect(() => readLiveSnapshot({ ...source, factionSites: [{ ...site, ...extra }] })).toThrow(LiveApiError);
  });
  test('rejects invented squad identity, private orders and non-NPC membership', () => {
    const squad = { id: 'squad-sawmill-raiders-0', leader: true };
    for (const bad of [null, [], {}, { ...squad, id: 'squad-sawmill-raiders-10' }, { ...squad, id: 'squad-city-raiders-0' },
      { ...squad, id: 'squad-sawmill-scavs-0' }, { ...squad, id: 'squad-sawmill-raiders-0-hidden' },
      { ...squad, leader: 1 }, { ...squad, members: ['hidden-1'] }, { ...squad, target: { x: 10, y: 10 } }]) {
      const source = fixture(); Object.assign(source.entities[1]!, { npcSquad: bad });
      expect(() => readLiveSnapshot(source)).toThrow(LiveApiError);
    }
    for (const change of [{ kind: 'player' }, { bossId: 'lesnik' }, { faction: undefined }]) {
      const source = fixture(); Object.assign(source.entities[1]!, { npcSquad: squad }, change);
      expect(() => readLiveSnapshot(source)).toThrow(LiveApiError);
    }
  });
  test('local faction observations remain optional, copied and replaced in cached-world updates', () => {
    const source = fixture();
    expect(readLiveSnapshot(source).factionSites).toBeUndefined();
    source.factionSites = source.world.pois.slice(0, 3).map((poi, index) => ({ id: poi.id, x: poi.x, y: poi.y,
      kind: index ? 'control' : 'base', owner: index === 0 ? 'scavs' : index === 1 ? 'raiders' : null, contested: index === 2 }));
    const parsed = readLiveSnapshot(source);
    expect(parsed.factionSites).toEqual(source.factionSites);
    expect(parsed.factionSites).not.toBe(source.factionSites);
    expect(parsed.factionSites![0]).not.toBe(source.factionSites[0]);
    const { world: _world, ...cached } = source;
    expect(readLiveSnapshot(cached, parsed.world).factionSites).toEqual(source.factionSites);
    expect(readLiveSnapshot({ ...cached, factionSites: [] }, parsed.world).factionSites).toEqual([]);
    delete cached.factionSites;
    expect(readLiveSnapshot(cached, parsed.world).factionSites).toBeUndefined();
  });
  test('rejects unbounded faction observations, unknown places and hidden capture state', () => {
    const source = fixture(), poi = source.world.pois[0]!;
    const site = { id: poi.id, x: poi.x, y: poi.y, kind: 'control', owner: null, contested: false };
    for (const sites of [null, {}, [site, site], Array.from({ length: 65 }, () => site),
      [{ ...site, id: 'squad-customs-scavs-0' }], [{ ...site, id: 'unknown-poi' }],
      [{ ...site, x: -1 }], [{ ...site, x: source.world.width }], [{ ...site, y: source.world.height }], [{ ...site, x: .5 }],
      [{ ...site, kind: 'supply' }], [{ ...site, owner: 'players' }], [{ ...site, owner: undefined }],
      [{ ...site, contested: 1 }], [{ ...site, members: ['hidden-npc'] }], [{ ...site, progress: 50 }]]) {
      expect(() => readLiveSnapshot({ ...source, factionSites: sites })).toThrow(LiveApiError);
    }
  });
  test('physical base cache metadata preserves its real loot and exact instance identity', () => {
    const source = fixture(), poi = source.world.pois[0]!, drop = source.drops[0]!;
    drop.items = [{ id: crypto.randomUUID(), modelId: 'gold-ring', foundAt: 1000 }];
    for (const faction of ['scavs', 'raiders'] as const) {
      drop.npcBase = { id: poi.id, faction };
      const parsed = readLiveSnapshot(source);
      expect(parsed.drops[0]).toEqual(drop);
      expect(parsed.drops[0]!.npcBase).not.toBe(drop.npcBase);
      expect(parsed.drops[0]!.items![0]!.id).toBe(drop.items[0]!.id);
      const { world: _world, ...cached } = source;
      expect(readLiveSnapshot(cached, parsed.world).drops[0]).toEqual(drop);
    }
  });
  test('rejects invented base caches, private inventories and ambiguous container or boss identity', () => {
    const source = fixture(), base = { id: source.world.pois[0]!.id, faction: 'scavs' };
    for (const bad of [null, [], {}, { ...base, id: 'unknown-poi' }, { ...base, id: 'squad-sawmill-scavs-0' },
      { ...base, faction: 'players' }, { ...base, members: [] }, { ...base, cargo: 20 }]) {
      expect(() => readLiveSnapshot({ ...source, drops: [{ ...source.drops[0]!, npcBase: bad }] })).toThrow(LiveApiError);
    }
    for (const extra of [{ bossId: 'lesnik' }, { containerId: 'box-1', containerKind: 'crate', searched: false }]) {
      expect(() => readLiveSnapshot({ ...source, drops: [{ ...source.drops[0]!, npcBase: base, ...extra }] })).toThrow(LiveApiError);
    }
  });
  test('accepts only bounded public walking pace and remains compatible with older snapshots', () => {
    const source = fixture();
    expect(readLiveSnapshot(source).entities[0]!.moveIntervalMs).toBeUndefined();
    source.entities[0]!.moveIntervalMs = 500;
    expect(readLiveSnapshot(source).entities[0]!.moveIntervalMs).toBe(500);
    for (const value of [0, -1, 99, 4001, Infinity, NaN, '500', null]) {
      Object.assign(source.entities[0]!, { moveIntervalMs: value });
      expect(() => readLiveSnapshot(source)).toThrow(LiveApiError);
    }
  });
  test('public installed model IDs survive parsing and reject invalid slots or private instance data', () => {
    const packet = fixture(), modules = { ...FACTORY_KITS.ak74! };
    packet.entities[1]!.visualLoadout = { weaponId: 'ak74', modules, profile: 'assault', helmet: true, armor: true, backpack: false };
    const visible = readLiveSnapshot(packet).entities[1]!.visualLoadout!;
    expect(visible.modules).toEqual(modules); expect(visible.modules).not.toBe(modules);
    const { world: _world, ...cached } = packet;
    expect(readLiveSnapshot(cached, packet.world).entities[1]!.visualLoadout?.modules).toEqual(modules);
    packet.entities[1]!.visualLoadout!.modules = {};
    expect(readLiveSnapshot(packet).entities[1]!.visualLoadout?.modules).toEqual({});
    for (const bad of [null, [], { receiver: 'no-model' }, { optic: modules.receiver }, { ammo: 30 }, { receiver: { modelId: modules.receiver, id: 'private' } }, { constructor: 'constructor' }]) {
      Object.assign(packet.entities[1]!.visualLoadout!, { modules: bad });
      expect(() => readLiveSnapshot(packet)).toThrow(LiveApiError);
    }
    Object.assign(packet.entities[1]!.visualLoadout!, { weaponId: undefined, modules: {} });
    expect(() => readLiveSnapshot(packet)).toThrow(LiveApiError);
  });
  test('preserves validated public equipment through full and cached snapshots without aliasing the packet', () => {
    const source = fixture(), visualLoadout = { profile: 'scout' as const, weaponId: 'mosin', helmet: false, armor: true, backpack: false };
    source.entities[1]!.visualLoadout = visualLoadout;
    const parsed = readLiveSnapshot(source);
    expect(parsed.entities[1]!.visualLoadout).toEqual(visualLoadout);
    expect(parsed.entities[1]!.visualLoadout).not.toBe(visualLoadout);
    const { world: _world, ...cached } = source;
    expect(readLiveSnapshot(cached, parsed.world).entities[1]!.visualLoadout).toEqual(visualLoadout);
    for (const bad of [null, [], { ...visualLoadout, profile: 'heavy' }, { ...visualLoadout, helmet: 1 }, { ...visualLoadout, backpack: undefined }, { ...visualLoadout, weaponId: '' }, { ...visualLoadout, weaponId: 'x'.repeat(65) }, { ...visualLoadout, ammo: 30 }]) {
      const packet = fixture(); Object.assign(packet.entities[1]!, { visualLoadout: bad });
      expect(() => readLiveSnapshot(packet)).toThrow(LiveApiError);
    }
  });
  test('preserves server time, identity, kit and NPC distinction without advancing them', () => {
    const source = fixture(), snapshot = readLiveSnapshot(source);
    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(snapshot.entities[1]?.kind).toBe('scav');
  });
  test('rejects a different self and duplicate entities', () => {
    const wrongSelf = fixture(); wrongSelf.self.id = 'other';
    expect(() => readLiveSnapshot(wrongSelf)).toThrow(LiveApiError);
    const duplicated = fixture(); duplicated.entities.push({ ...duplicated.entities[0]! });
    expect(() => readLiveSnapshot(duplicated)).toThrow(LiveApiError);
  });
  test('rejects off-map positions, unbounded world and invalid kit', () => {
    const offMap = fixture(); offMap.entities[0]!.x = offMap.world.width;
    expect(() => readLiveSnapshot(offMap)).toThrow(LiveApiError);
    const world = fixture(); world.world.obstacles[0]!.width = world.world.width + 1;
    expect(() => readLiveSnapshot(world)).toThrow(LiveApiError);
    const kit = fixture(); kit.self.ammo = -1;
    expect(() => readLiveSnapshot(kit)).toThrow(LiveApiError);
    expect(() => readLiveStatus({ ...fixture().server, online: 33 })).toThrow(LiveApiError);
  });
  test('keeps names as data for the escaped renderer and rejects malformed events', () => {
    const source = fixture(); source.entities[0]!.name = '<img src=x onerror=alert(1)>';
    expect(readLiveSnapshot(source).entities[0]?.name).toBe(source.entities[0]!.name);
    expect(() => readLiveSnapshot({ ...source, events: [{ ...source.events[0], text: { html: 'bad' } }] })).toThrow(LiveApiError);
  });
  test('rejects unsupported or duplicate map identities and invalid map geometry', () => {
    const unknown = fixture(); Object.assign(unknown.world, { id: 'client-map' });
    expect(() => readLiveSnapshot(unknown)).toThrow(LiveApiError);
    const duplicate = fixture(); duplicate.server.maps.push({ ...duplicate.server.maps[0]! });
    expect(() => readLiveStatus(duplicate.server)).toThrow(LiveApiError);
    const zone = fixture(); zone.world.zones[0]!.width = zone.world.width + 1;
    expect(() => readLiveSnapshot(zone)).toThrow(LiveApiError);
    const role = fixture(); Object.assign(role.entities[1]!, { role: 'admin' });
    expect(() => readLiveSnapshot(role)).toThrow(LiveApiError);
    const faction = fixture(); Object.assign(faction.entities[1]!, { faction: 'friendly-client' });
    expect(() => readLiveSnapshot(faction)).toThrow(LiveApiError);
  });
  test('preserves confirmed target, map travel and shot geometry while rejecting malformed combat data', () => {
    const source = fixture(); source.self.targetId = 'scav-1'; source.self.travelReadyAt = 30_000;
    source.events.push({ id: 'shot-1', at: 2000, kind: 'combat', text: 'Попадание', actorId: 'player-1', targetId: 'scav-1', from: { x: 2, y: 2 }, to: { x: 4, y: 6 }, damage: 25 });
    expect(readLiveSnapshot(source)).toEqual(source);
    const target = fixture(); Object.assign(target.self, { targetId: 123 });
    expect(() => readLiveSnapshot(target)).toThrow(LiveApiError);
    const travel = fixture(); travel.self.travelReadyAt = -1;
    expect(() => readLiveSnapshot(travel)).toThrow(LiveApiError);
    for (const edit of [{ from: { x: -1, y: 2 } }, { to: { x: source.world.width, y: 2 } }, { damage: -5 }, { damage: 200 }]) {
      const shot = fixture(); shot.events = [{ ...source.events[1]!, ...edit }];
      expect(() => readLiveSnapshot(shot)).toThrow(LiveApiError);
    }
  });
  test('accepts geometry omitted from versioned updates only with an exactly matching cached world', () => {
    const full = fixture(), { world: _world, ...update } = full;
    expect(readLiveSnapshot(update, full.world)).toEqual(full);
    expect(() => readLiveSnapshot(update)).toThrow(LiveApiError);
    expect(() => readLiveSnapshot(update, { ...full.world, version: 'stale' })).toThrow(LiveApiError);
    expect(() => readLiveSnapshot({ ...full, worldVersion: 'different' })).toThrow(LiveApiError);
    const revision = structuredClone(full); revision.world.version = revision.worldVersion = 'perimeter-g2-new-geometry';
    expect(readLiveSnapshot(revision, full.world).world.version).toBe(revision.worldVersion);
    const { world: _revisionWorld, ...revisionDelta } = revision;
    expect(() => readLiveSnapshot(revisionDelta, full.world)).toThrow(LiveApiError);
  });
  test('preserves organic terrain and path geometry in full and cached snapshots while accepting legacy worlds', () => {
    const full = fixture();
    full.world.terrainRows = Array.from({ length: full.world.height }, (_, y) => Array.from({ length: full.world.width }, (_, x) => Object.keys(LIVE_TERRAIN_CODES)[(x + y) % 9]).join(''));
    full.world.paths = [
      { id: 'road', name: 'Тракт', kind: 'road', width: 4, points: [{ x: 6, y: 6 }, { x: 29, y: 24 }, { x: 89, y: 58 }] },
      { id: 'trail', name: 'Лесная тропа', kind: 'trail', width: 1.5, points: [{ x: 29, y: 24 }, { x: 95, y: 18 }] },
      { id: 'rail', name: 'Ветка депо', kind: 'rail', width: 2, points: [{ x: 6, y: 121 }, { x: 53, y: 71 }] },
      { id: 'river', name: 'Река', kind: 'river', width: 5, points: [{ x: 113, y: 0 }, { x: 87, y: 45 }] },
    ];
    full.world.obstacles.push({ x: 111, y: 1, width: 2, height: 3, kind: 'water' });
    full.world.zones.push({ x: 0, y: 0, width: 3, height: 3, name: 'Берег', terrain: 'sand', danger: 1 });
    const parsed = readLiveSnapshot(full);
    expect(parsed).toEqual(full); expect(parsed.world.terrainRows).not.toBe(full.world.terrainRows);
    const { world: _world, ...update } = full;
    expect(readLiveSnapshot(update, parsed.world)).toEqual(full);
    const legacy = fixture(); delete legacy.world.terrainRows; delete legacy.world.paths;
    expect(readLiveSnapshot(legacy)).toEqual(legacy);
  });
  test('rejects malformed terrain rasters and unbounded or duplicate organic paths', () => {
    const edits: Array<(value: LiveSnapshot) => void> = [
      value => { value.world.terrainRows!.pop(); },
      value => { value.world.terrainRows![0] = 'g'.repeat(value.world.width - 1); },
      value => { value.world.terrainRows![0] = '?'.repeat(value.world.width); },
      value => { Object.assign(value.world, { terrainRows: Array.from({ length: value.world.height }, () => Array(value.world.width).fill('g')) }); },
      value => { value.world.paths!.push({ ...value.world.paths![0]! }); },
      value => { Object.assign(value.world.paths![0]!, { kind: 'teleport' }); },
      value => { value.world.paths![0]!.width = 0; },
      value => { value.world.paths![0]!.width = Number.POSITIVE_INFINITY; },
      value => { value.world.paths![0]!.points = [{ x: 1, y: 1 }]; },
      value => { value.world.paths![0]!.points[0]!.x = value.world.width; },
      value => { value.world.paths![0]!.points[0]!.y = -1; },
      value => { value.world.paths![0]!.points = Array.from({ length: 257 }, () => ({ x: 1, y: 1 })); },
      value => { value.world.paths = Array.from({ length: LIVE_WORLD_LIMITS.paths + 1 }, (_, index) => ({ ...value.world.paths![0]!, id: `path-${index}` })); },
      value => { Object.assign(value.world.obstacles[0]!, { kind: 'lava' }); },
      value => { Object.assign(value.world.zones[0]!, { terrain: 'private-loot' }); },
    ];
    for (const edit of edits) {
      const value = fixture();
      value.world.terrainRows = Array.from({ length: value.world.height }, () => 'g'.repeat(value.world.width));
      value.world.paths = [{ id: 'road', name: 'Тракт', kind: 'road', width: 3, points: [{ x: 1, y: 1 }, { x: 60, y: 45 }] }];
      edit(value); expect(() => readLiveSnapshot(value)).toThrow(LiveApiError);
    }
  });
  test('validates districts, purpose, visibility chunks and server search deadlines', () => {
    const full = fixture(); full.self.searching = { id: 'drop-1', readyAt: 5000 };
    expect(readLiveSnapshot(full)).toEqual(full);
    for (const self of [{ ...full.self, purpose: 'immune' }, { ...full.self, districtId: 'client-region' }, { ...full.self, searching: { id: 'drop-1', readyAt: -1 } }]) expect(() => readLiveSnapshot({ ...full, self })).toThrow(LiveApiError);
    expect(() => readLiveSnapshot({ ...full, visibleChunks: [{ x: Math.ceil(full.world.width / full.world.chunkSize), y: 0 }] })).toThrow(LiveApiError);
    const duplicate = fixture(); duplicate.server.districts[1]!.id = 'customs'; expect(() => readLiveStatus(duplicate.server)).toThrow(LiveApiError);
  });
  test('expanded worlds accept their outer bounds, all streaming columns and 384 bounded landscape paths', () => {
    const value = fixture(); value.entities[0]!.x = value.world.width - 1; value.entities[0]!.y = value.world.height - 1;
    value.visibleChunks = [{ x: Math.ceil(value.world.width/value.world.chunkSize)-1, y: Math.ceil(value.world.height/value.world.chunkSize)-1 }];
    value.world.paths = Array.from({ length: 384 }, (_, index) => ({ id: `road-${index}`, name: 'Дорога', kind: 'road', width: 3, points: [{ x: 0, y: 0 }, { x: value.world.width-1, y: value.world.height-1 }] }));
    expect(readLiveSnapshot(value)).toEqual(value);
  });
  test('city quarters and outer labels survive full and cached geometry while rejecting malformed public regions', () => {
    const full=fixture(), side=Math.floor(full.world.width/4), x=side,y=side;
    delete full.world.citySites; // This fixture authors another region, without V5 site geometry.
    full.world.city={name:'Ольховск',x,y,width:side*2,height:side*2,quarters:[
      {id:'old-center',name:'Старый центр',x,y,width:side,height:side},
      {id:'industrial',name:'Промышленный квартал',x:x+side,y,width:side,height:side},
      {id:'station',name:'Привокзальный квартал',x,y:y+side,width:side,height:side},
      {id:'residential',name:'Жилой квартал',x:x+side,y:y+side,width:side,height:side},
    ]};
    full.world.districts[0]!.labelPoint={x:12,y:12};
    full.server.maps[0]!.city=structuredClone(full.world.city);
    full.server.districts[0]!.labelPoint={x:12,y:12};
    const parsed=readLiveSnapshot(full);expect(parsed).toEqual(full);
    const {world:_world,...withoutWorld}=full,delta={...withoutWorld,server:structuredClone(full.server)};delete delta.server.maps[0]!.city;
    expect(readLiveSnapshot(delta,parsed.world).world.city).toEqual(full.world.city);
    expect(readLiveSnapshot(delta,parsed.world).world.districts[0]!.labelPoint).toEqual({x:12,y:12});
    const legacy=fixture();delete legacy.world.city;delete legacy.world.citySites;delete legacy.server.maps[0]!.city;
    for(const district of [...legacy.world.districts,...legacy.server.districts])delete district.labelPoint;
    expect(readLiveSnapshot(legacy)).toEqual(legacy);
    const edits:Array<(value:LiveSnapshot)=>void>=[
      value=>{value.world.city!.x=-1;},
      value=>{value.world.city!.width=value.world.width;},
      value=>{value.world.city!.name='x'.repeat(81);},
      value=>{value.world.city!.quarters.pop();},
      value=>{value.world.city!.quarters[1]!.id=value.world.city!.quarters[0]!.id;},
      value=>{value.world.city!.quarters[0]!.x=value.world.city!.x-1;},
      value=>{Object.assign(value.world.city!,{immunity:true});},
      value=>{Object.assign(value.world.city!.quarters[0]!,{reward:999});},
      value=>{value.world.districts[0]!.labelPoint={x:value.world.width,y:12};},
      value=>{value.world.districts[0]!.labelPoint={x:Number.NaN,y:12};},
      value=>{value.server.districts[0]!.labelPoint={x:12,y:-1};},
    ];
    for(const edit of edits){const value=structuredClone(full);edit(value);expect(()=>readLiveSnapshot(value)).toThrow(LiveApiError);}
    const mismatch=structuredClone(full);mismatch.server.maps[0]!.city!.name='Другой город';
    expect(()=>readLiveSnapshot(mismatch)).toThrow(LiveApiError);
  });
  test('purpose routes preserve ordered known places without granting immunity or accepting foreign references', () => {
    const full = fixture();
    full.world.routes = full.world.districts.flatMap(district => (['pvp', 'pve', 'loot', 'quests'] as const).map(purpose => ({
      id: `${district.id}-${purpose}`, name: 'Маршрут', description: 'Посетить отмеченные места и вернуться.', districtId: district.id, purpose,
      poiIds: full.world.pois.filter(poi => poi.districtId === district.id).slice(0, 2).map(poi => poi.id),
    })));
    expect(readLiveSnapshot(full)).toEqual(full);
    const crossDistrict = structuredClone(full);
    crossDistrict.world.routes![0]!.poiIds[0] = crossDistrict.world.pois.find(poi => poi.districtId !== crossDistrict.world.routes![0]!.districtId)!.id;
    expect(readLiveSnapshot(crossDistrict)).toEqual(crossDistrict);
    const { world: _world, ...update } = full; expect(readLiveSnapshot(update, full.world)).toEqual(full);
    const legacy = fixture(); delete legacy.world.routes; expect(readLiveSnapshot(legacy)).toEqual(legacy);
    const edits: Array<(value: LiveSnapshot) => void> = [
      value => { value.world.routes!.push({ ...value.world.routes![0]! }); },
      value => { Object.assign(value.world.routes![0]!, { purpose: 'immune' }); },
      value => { Object.assign(value.world.routes![0]!, { districtId: 'other-server' }); },
      value => { value.world.routes![0]!.poiIds[0] = 'client-secret-room'; },
      value => { value.world.routes![0]!.poiIds.push(value.world.routes![0]!.poiIds[0]!); },
      value => { value.world.routes![0]!.poiIds = []; },
      value => { Object.assign(value.world.routes![0]!, { poiIds: 'poi-0-0' }); },
      value => { Object.assign(value.world.routes![0]!, { description: { reward: 999999 } }); },
    ];
    for (const edit of edits) { const value = structuredClone(full); edit(value); expect(() => readLiveSnapshot(value)).toThrow(LiveApiError); }
  });
  test('route summaries keep real stop order and reject duplicate intents, oversize text and hidden command fields', () => {
    const source = fixture().server;
    const route = { id: 'customs-loot', name: 'Северная доставка', description: 'Осмотри склады, затем вернись к выходу.', districtId: 'customs' as const, purpose: 'loot' as const, stops: ['Складской терминал', 'Грузовой двор'] };
    expect(readLiveStatus({ ...source, routes: [route] }).routes).toEqual([route]);
    expect(readLiveStatus(source).routes).toBeUndefined();
    for (const routes of [
      [route, { ...route, id: 'second-route' }],
      [{ ...route, stops: ['Склад'] }],
      [{ ...route, stops: ['Склад', 'a'.repeat(121)] }],
      [{ ...route, description: 'a'.repeat(241) }],
      [{ ...route, name: 'a'.repeat(81) }],
      [{ ...route, immunity: true }],
    ]) expect(() => readLiveStatus({ ...source, routes })).toThrow(LiveApiError);
    const value = fixture();
    value.world.routes = [{ ...route, poiIds: value.world.pois.filter(poi => poi.districtId === 'customs').slice(0, 2).map(poi => poi.id) }];
    // A separate id cannot smuggle a second route for the same district and goal.
    value.world.routes.push({ ...value.world.routes[0]!, id: 'second-route' });
    expect(() => readLiveSnapshot(value)).toThrow(LiveApiError);
  });
  test('keeps unopened container contents concealed and rejects unsupported container kinds', () => {
    const full = fixture(), anchor = full.world.containers[0]!;
    full.drops = [{ id: 'drop-1', x: anchor.x, y: anchor.y, amount: 0, containerId: anchor.id, containerKind: anchor.kind, searched: false }];
    expect(readLiveSnapshot(full)).toEqual(full);
    const malformed = { ...full, drops: [{ ...full.drops[0], containerKind: 'admin-wallet' }] };
    expect(() => readLiveSnapshot(malformed)).toThrow(LiveApiError);
    const leaked = { ...full, drops: [{ ...full.drops[0], items: [{ id: '532cfa7a-5ca1-4742-a07c-ffefdc785d01', modelId: 'coffee', foundAt: 1000 }] }] };
    expect(() => readLiveSnapshot(leaked)).toThrow(LiveApiError);
  });
  test('vetted server error codes provide useful localized feedback', () => {
    expect(new LiveApiError(409, 'target_out_of_range').message).toContain('укрытием');
    expect(new LiveApiError(409, 'spawn_protection').message).toContain('защитой');
    expect(new LiveApiError(409, 'cargo_full').message).toContain('Груз заполнен');
    expect(new LiveApiError(409, '<script>private error</script>').message).not.toContain('script');
  });
  test('rejoins only lost presence for the unchanged identity after a server restart', () => {
    const missing = new LiveApiError(401, 'join_required');
    expect(missing.message).toContain('Связь с сервером восстановлена');
    expect(missing.message).not.toContain('аккаунт');
    expect(shouldRejoinLivePresence(missing, null, null)).toBe(true);
    expect(shouldRejoinLivePresence(missing, 'account-a', 'account-a')).toBe(true);
    expect(shouldRejoinLivePresence(missing, 'account-a', 'account-b')).toBe(false);
    expect(shouldRejoinLivePresence(new LiveApiError(401, 'account_changed'), 'account-a', 'account-a')).toBe(false);
    expect(shouldRejoinLivePresence(new LiveApiError(401, 'live_identity_changed'), null, null)).toBe(false);
    expect(shouldRejoinLivePresence(new LiveApiError(409, 'join_required'), null, null)).toBe(false);
    expect(shouldRejoinLivePresence(missing, null, null, 'game-a', 'game-a')).toBe(true);
    expect(shouldRejoinLivePresence(missing, null, null, 'game-a', 'game-b')).toBe(false);
  });
  test('preserves physical catalog loot and extracted parcels while rejecting forged, overweight or private loot data', () => {
    const source = fixture();
    source.self.gameId = 'cba21a6d-2936-4590-9433-dfa2b58c8dc8';
    source.self.lootItems = [{id:'532cfa7a-5ca1-4742-a07c-ffefdc785d2e',modelId:'gold-ring',foundAt:1000}];
    source.self.pendingDelivery = [{items:[{id:'66092524-eafc-4f2b-8d74-6906d3a00205',modelId:'circuit-board',foundAt:1000}],money:15,message:'Освободи место на складе'}];
    source.self.economyMessage = 'Груз доставлен';
    source.drops = [{id:'named-only',x:3,y:2,amount:0,items:[{id:'9a3db3ca-42c6-4ac2-9e6f-c275c740134b',modelId:'tool-case',foundAt:1000}]}];
    expect(readLiveSnapshot(source)).toEqual(source);
    const edits: ((copy: LiveSnapshot)=>void)[] = [
      copy=>{copy.self.lootItems![0]!.modelId='admin-gold';},
      copy=>{copy.self.lootItems![0]!.id='loot-client';},
      copy=>{copy.self.lootItems![0]!.foundAt=1e15+1;},
      copy=>{Object.assign(copy.self.lootItems![0]!,{guidePrice:999999});},
      copy=>{Object.assign(copy.self,{economyOwner:'account-private'});},
      copy=>{Object.assign(copy.drops[0]!,{owner:'player-2'});},
      copy=>{copy.self.pendingDelivery![0]!.items[0]!.id=copy.self.lootItems![0]!.id;},
      copy=>{copy.self.lootItems=Array.from({length:5},(_,i)=>({id:`532cfa7a-5ca1-4742-a07c-ffefdc785d2${i}`,modelId:'tool-case',foundAt:1000}));},
      copy=>{copy.self.pendingDelivery=Array.from({length:33},()=>({items:[],money:1,message:'Ожидание'}));},
    ];
    for(const edit of edits){const copy=structuredClone(source);edit(copy);expect(()=>readLiveSnapshot(copy)).toThrow(LiveApiError);}
    const rolledBack=structuredClone(source);rolledBack.self.lootItems![0]!.foundAt=rolledBack.now+1000;
    expect(readLiveSnapshot(rolledBack).self.lootItems![0]!.foundAt).toBe(rolledBack.now+1000);
  });
  test('sends the captured shelter, account and live identity on reads and mutations without retrying failed commands', async () => {
    const calls:{url:string;init:RequestInit}[]=[];
    const transport=(async (url:string,init:RequestInit)=>{
      calls.push({url,init});
      return url.endsWith('/action')?new Response(JSON.stringify({error:'game_identity_changed'}),{status:401}):new Response(JSON.stringify(fixture()));
    }) as unknown as typeof fetch;
    const identity={accountId:'account-a',gameId:'game-a',playerId:'player-1'};
    await liveRequest('state',identity,readLiveSnapshot,undefined,undefined,undefined,transport);
    await expect(liveRequest('action',identity,readLiveSnapshot,{type:'resupply'},undefined,undefined,transport)).rejects.toThrow('сессия изменилась');
    expect(calls).toHaveLength(2);
    for(const call of calls)expect(call.init.headers).toMatchObject({'x-prapor-account':'account-a','x-prapor-game':'game-a','x-prapor-live':'player-1'});
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({type:'resupply'});
  });
});
