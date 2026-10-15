import { describe, expect, test } from 'bun:test';
import { METROPOLIS_CORE, METROPOLIS_QUARTERS, metropolisParcelPlan, metropolisStreetPlan } from '../src/game/world-metropolis-plan';
import { generateMetropolisSites } from '../src/game/world-metropolis-sites';
import type { LivePoint } from '../src/game/live';

type Rect = LivePoint & { width: number; height: number };
const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (rect: Rect, point: LivePoint): boolean => point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
const distanceTo = (point: LivePoint, rect: Rect): number => Math.hypot(Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width), Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height));

describe('organic metropolis plan', () => {
  test('retains durable address identities and counts across seeds', () => {
    const expectedSites = METROPOLIS_QUARTERS.flatMap(quarter => Array.from({ length: 8 }, (_, slot) => ({ id: `${quarter.id}-block-${slot}`, buildings: quarter.buildings })));
    for (const seed of ['perimeter', 'seed-9', 'seed-99']) {
      const generated = generateMetropolisSites(seed);
      expect(generated.sites.map(site => site.id)).toEqual(expectedSites.map(site => site.id));
      expect(generated.pois.map(poi => poi.id)).toEqual(expectedSites.map(site => site.id));
      expect(generated.sites.flatMap(site => site.buildings.map(building => building.id))).toEqual(expectedSites.flatMap(site => Array.from({ length: site.buildings }, (_, address) => `${site.id}-building-${address}`)));
      expect(generated.containers.map(anchor => anchor.id)).toEqual(expectedSites.flatMap(site => [...Array.from({ length: site.buildings }, (_, address) => `${site.id}-address-${address}-search`), `${site.id}-courtyard-search`]));
      expect(generated.sites.flatMap(site => site.buildings)).toHaveLength(576);
      expect(generated.containers).toHaveLength(672);
    }
  });

  test('uses unequal real plots and varied circulation rather than repeated rings and courts', () => {
    const plots = metropolisParcelPlan(), streets = metropolisStreetPlan(), generated = generateMetropolisSites('organic-layout');
    expect(metropolisParcelPlan()).toEqual(plots);
    expect(metropolisStreetPlan()).toEqual(streets);
    expect(new Set(plots.map(plot => `${plot.rect.width}x${plot.rect.height}`)).size).toBeGreaterThan(40);
    expect(new Set(plots.map(plot => plot.layout))).toEqual(new Set(['lane', 'court', 'yard', 'garden']));
    const signatures = generated.sites.map(site => JSON.stringify({
      courtyard: { x: site.courtyard.x - site.x, y: site.courtyard.y - site.y, width: site.courtyard.width, height: site.courtyard.height },
      buildings: site.buildings.map(building => [building.x - site.x, building.y - site.y, building.width, building.height]),
      passages: site.passages[0]!.map(point => [point.x - site.x, point.y - site.y]),
    }));
    expect(new Set(signatures).size).toBeGreaterThan(80);
    expect(generated.sites.filter(site => site.passages[0]!.length > 2).length).toBeGreaterThan(50);
    expect(streets.every(street => street.points[0]!.x !== street.points.at(-1)!.x || street.points[0]!.y !== street.points.at(-1)!.y)).toBe(true);
    expect(streets.flatMap(street => street.points.slice(1).filter((b, index) => b.x !== street.points[index]!.x && b.y !== street.points[index]!.y)).length).toBeGreaterThan(30);
    for (const plot of plots) {
      expect(intersects(plot.rect, METROPOLIS_CORE)).toBe(false);
      const others = plots.filter(other => other.id !== plot.id);
      expect(others.some(other => intersects(other.rect, plot.rect))).toBe(false);
    }
  });

  test('shares every actual street access and keeps complete building footprints clear of carriageways', () => {
    const plots = metropolisParcelPlan(), streets = metropolisStreetPlan();
    const generated = generateMetropolisSites('organic-layout'), buildings = generated.sites.flatMap(site => site.buildings);
    const intrusions: string[] = [];
    for (const plot of plots) {
      const site = generated.sites.find(site => site.id === plot.id)!, poi = generated.pois.find(poi => poi.id === plot.id)!;
      const street = streets.find(street => street.id === `metro-access-${plot.id}`)!;
      expect(street.points.at(-1)).toEqual(plot.access[0]);
      expect(poi.entrances).toEqual(plot.access);
      expect(site).toMatchObject(plot.rect);
      expect(plot.access.every(point => contains(plot.rect, point))).toBe(true);
    }
    // Test full rectangles, including walkable interiors. Checking collision
    // walls alone would allow a diagonal road to enter through an open door.
    for (const street of streets) for (let segment = 1; segment < street.points.length; segment++) {
      const a = street.points[segment - 1]!, b = street.points[segment]!, steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
      const nearby = buildings.filter(building => intersects(building, { x: Math.min(a.x, b.x) - street.width, y: Math.min(a.y, b.y) - street.width, width: Math.abs(b.x - a.x) + street.width * 2, height: Math.abs(b.y - a.y) + street.width * 2 }));
      for (let step = 0; step <= steps; step++) {
        const point = { x: a.x + (b.x - a.x) * step / steps, y: a.y + (b.y - a.y) * step / steps };
        for (const building of nearby) if (distanceTo(point, building) < street.width / 2 - .01) intrusions.push(`${street.id} / ${building.id}`);
      }
    }
    expect([...new Set(intrusions)]).toEqual([]);
  });

  test('keeps cardinal passages and both doors clear even in the smallest seeded rooms', () => {
    for (const seed of ['perimeter', 'seed-9', 'seed-99']) {
      const generated = generateMetropolisSites(seed), blocked = new Set<string>();
      for (const wall of generated.obstacles) for (let y = wall.y; y < wall.y + wall.height; y++) for (let x = wall.x; x < wall.x + wall.width; x++) blocked.add(`${x}:${y}`);
      for (const site of generated.sites) {
        for (const building of site.buildings) {
          expect(Math.min(building.width, building.height)).toBeGreaterThanOrEqual(5);
          expect(building.entrances).toHaveLength(2);
          expect(building.entrances.every(door => !blocked.has(`${door.x}:${door.y}`))).toBe(true);
        }
        for (const path of site.passages) for (let index = 1; index < path.length; index++) {
          const a = path[index - 1]!, b = path[index]!, dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
          expect(Boolean(dx && dy)).toBe(false);
          for (let step = 0; step <= Math.abs(b.x - a.x) + Math.abs(b.y - a.y); step++) expect(blocked.has(`${a.x + dx * step}:${a.y + dy * step}`)).toBe(false);
        }
      }
    }
  });
});
