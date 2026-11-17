import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeRoutes, rehydrate, type ComputeInput } from './compute';
import type { HeatSource } from './heat';
import { lootForMap, type LootSnapshot } from './lootData';
import { ROUTE_STYLES, type RouteExit, type RouteStop } from './plan';
import { lootStops, type ItemPrice } from './targets';
import { computeInBackground } from './routeClient';

function area(x0: number, z0: number, x1: number, z1: number, step = 20) {
  const out: { x: number; z: number }[] = [];
  for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) out.push({ x, z });
  return out;
}

const exits: RouteExit[] = [{ id: 'e', label: 'Exit', x: 290, z: 80, penalty: 0 }];
const base = (extra: Partial<ComputeInput> = {}): ComputeInput => ({
  terrainKey: `test|${Math.random()}`,
  // A boss area right between the start and the stops.
  sources: [{ kind: 'boss', x: 150, z: 80, r: 45, w: 1 } as HeatSource],
  known: area(0, 0, 300, 160),
  start: { x: 10, z: 80 },
  stops: [
    { id: 'a', x: 200, y: 0, z: 80, work: 10, value: 1 },
    { id: 'b', x: 250, y: 0, z: 100, work: 10, value: 1 },
  ],
  exits,
  budget: 1800,
  elapsed: 0,
  raid: 2400,
  preferCar: false,
  styles: [...ROUTE_STYLES],
  ...extra,
});

describe('computeRoutes', () => {
  it('plans every style; the direct one walks straight, the others draw their ways', () => {
    const plans = computeRoutes(base());
    expect(plans.map((p) => p.style)).toEqual([...ROUTE_STYLES]);
    for (const p of plans) {
      expect(p.stopIds.sort()).toEqual(['a', 'b']);
      expect(p.exitId).toBe('e');
      expect(p.total).toBeLessThanOrEqual(1800 + 1);
    }
    const byStyle = Object.fromEntries(plans.map((p) => [p.style, p]));
    expect(byStyle.direct.paths).toBeUndefined();
    expect(byStyle.stealth.paths).toHaveLength(3);
    // Around the boss area: less time in hot places than walking straight through it.
    expect(byStyle.stealth.hot).toBeLessThan(byStyle.direct.hot);
    expect(byStyle.aggressive.hot).toBeGreaterThanOrEqual(byStyle.stealth.hot);
  });

  it('trims the route when walking around the heat no longer fits in the time', () => {
    const direct = computeRoutes(base({ styles: ['direct'] }))[0];
    // Just enough time for the straight route: the discreet detour does not fit with both stops.
    const tight = computeRoutes(base({ budget: direct.total + 2, styles: ['stealth'] }))[0];
    expect(tight.total).toBeLessThanOrEqual(direct.total + 3);
    expect(tight.stopIds.length + tight.leftIds.length).toBe(2);
  });

  it('gives plans back with the caller\'s own stops and exits', () => {
    const plan = computeRoutes(base({ styles: ['balanced'] }))[0];
    const stops = new Map<string, RouteStop>([
      ['a', { id: 'a', x: 200, y: 0, z: 80, items: [], who: [], work: 10 }],
      ['b', { id: 'b', x: 250, y: 0, z: 100, items: [], who: [], work: 10 }],
    ]);
    const full = rehydrate(plan, stops, new Map(exits.map((e) => [e.id, e])));
    expect(full.stops.every((s) => stops.get(s.id) === s)).toBe(true);
    expect(full.exit).toBe(exits[0]);
  });

  it('without a worker (tests), the client computes right here', async () => {
    const plans = await computeInBackground(base({ styles: ['direct'] }));
    expect(plans[0].stopIds).toHaveLength(2);
  });
});

describe('a loot route on the real Customs data', () => {
  const snap = JSON.parse(readFileSync('data/snapshot/loot.json', 'utf8')) as LootSnapshot;
  const prices = (JSON.parse(readFileSync('data/snapshot/prices.json', 'utf8')) as { items: Record<string, ItemPrice> }).items;
  const loot = lootForMap(snap, '56f40101d2720b2a4d8b45d6');

  it('plans all four styles from a spawn in well under two seconds, at most 10 stops each, inside the time', () => {
    const stops = lootStops('money', { loot, prices }, []);
    const known = [...loot.loose, ...loot.containers].map((p) => ({ x: p.x, z: p.z }));
    const sources: HeatSource[] = [];
    const t0 = performance.now();
    const plans = computeRoutes({
      terrainKey: 'customs-test',
      sources,
      known,
      start: { x: 400, z: -100 },
      stops: stops.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, work: s.work, value: s.value ?? 1 })),
      exits: [{ id: 'x', label: 'Exit', x: -300, z: -120, penalty: 0 }],
      budget: 35 * 60,
      elapsed: 0,
      raid: 40 * 60,
      preferCar: false,
      maxStops: 10,
      styles: [...ROUTE_STYLES],
    });
    expect(performance.now() - t0).toBeLessThan(2000);
    for (const p of plans) {
      expect(p.stopIds.length).toBeGreaterThan(0);
      expect(p.stopIds.length).toBeLessThanOrEqual(10);
      expect(p.total).toBeLessThanOrEqual(35 * 60 + 1);
      expect(p.value).toBeGreaterThan(0);
    }
  });
});
