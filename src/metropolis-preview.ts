import type { LiveSnapshot, LiveWorld } from './game/live';
import { createHealth, createMedicalInventory } from './game/health';

/** A local observer, never a session/player. Only public static geometry enters the gallery. */
export function createCityPreviewSnapshot(source: LiveWorld, now = Date.now()): LiveSnapshot {
  const world: LiveWorld = {
    id: source.id, name: source.name, description: source.description, theme: source.theme,
    width: source.width, height: source.height, version: source.version, seed: source.seed,
    generatorVersion: source.generatorVersion, chunkSize: source.chunkSize,
    obstacles: source.obstacles, extracts: source.extracts, zones: source.zones, districts: source.districts,
    pois: source.pois, containers: [], terrainRows: source.terrainRows, paths: source.paths,
    city: source.city, citySites: source.citySites, props: source.props,
  };
  const id = 'city-gallery-observer';
  return {
    now, world, worldVersion: `gallery:${world.version}`, selfId: id,
    server: { id: 'city-gallery', name: `${world.city?.name ?? world.name} · обзор`, online: 0, capacity: 0, startedAt: now,
      maps: [{ id: world.id, name: world.name, description: world.description, theme: world.theme,
        width: world.width, height: world.height, city: world.city, online: 0, npcs: 0 }],
      districts: world.districts.map(district => ({ ...district, online: 0, npcs: 0 })) },
    self: { id, ammo: 0, medkits: 0, cargo: 0, stash: 0, kills: 0, respawnAt: 0, patrol: false,
      body: createHealth(), medicine: createMedicalInventory(false), treatment: null, leaveAt: 0, targetId: null,
      travelReadyAt: 0, districtId: world.districts[0]?.id ?? 'customs', purpose: 'pve', searching: null },
    entities: [], drops: [], events: [], visibleChunks: [],
  };
}

/** Prefer a real courtyard in the selected quarter, so zooming reveals architecture rather than a roof centre. */
export function cityPreviewFocus(world: LiveWorld, quarterId?: string): { x: number; y: number } {
  const area = world.city?.quarters.find(quarter => quarter.id === quarterId) ?? world.city ?? { x: 0, y: 0, width: world.width, height: world.height };
  const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const sites = (world.citySites ?? []).filter(site => site.courtyard.x >= area.x && site.courtyard.y >= area.y
    && site.courtyard.x < area.x + area.width && site.courtyard.y < area.y + area.height);
  const nearest = sites.reduce<NonNullable<LiveWorld['citySites']>[number] | undefined>((best, site) => {
    const distance = (item: typeof site) => Math.hypot(item.courtyard.x + item.courtyard.width / 2 - center.x, item.courtyard.y + item.courtyard.height / 2 - center.y);
    return !best || distance(site) < distance(best) ? site : best;
  }, undefined);
  return nearest ? { x: nearest.courtyard.x + nearest.courtyard.width / 2, y: nearest.courtyard.y + nearest.courtyard.height / 2 } : center;
}
