import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Poi } from '../poi/types';
import { itemKinds, lootForMap, type LootSnapshot } from './lootData';
import { lootStops, scavStops, type ItemPrice, type LootContext, type PlaceLabel } from './targets';

const snap = JSON.parse(readFileSync('data/snapshot/loot.json', 'utf8')) as LootSnapshot;
const prices = (JSON.parse(readFileSync('data/snapshot/prices.json', 'utf8')) as { items: Record<string, ItemPrice> }).items;
const labelsByMap = JSON.parse(readFileSync('data/snapshot/map-labels.json', 'utf8')) as Record<string, PlaceLabel[]>;
const CUSTOMS = '56f40101d2720b2a4d8b45d6';
const RESERVE = '5704e5fad2720bc05b8b4567';
const me = [{ id: 'me', name: 'Eu', color: '#fff' }];

const ctxOf = (mapId: string, extra: Partial<LootContext> = {}): LootContext => ({
  loot: lootForMap(snap, mapId),
  prices,
  labels: labelsByMap[mapId],
  itemKinds: itemKinds(snap),
  ...extra,
});
const best = (stops: ReturnType<typeof lootStops>) => [...stops].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

describe('loot areas for money', () => {
  it("on Customs, the dorms are the richest area (as players say)", () => {
    const stops = best(lootStops('money', ctxOf(CUSTOMS), me));
    expect(stops[0].info?.place).toBe('Dorms');
    expect(stops[0].info?.roubles).toBeGreaterThan(100_000);
    expect(stops[0].info?.items?.length).toBeGreaterThan(0);
  });

  it("on Reserve, the base's buildings lead", () => {
    const top = best(lootStops('money', ctxOf(RESERVE), me)).slice(0, 5).map((s) => s.info?.place);
    expect(top.some((p) => /King|Bishop|Knight|Pawn|Dome/.test(p ?? ''))).toBe(true);
  });

  it('gives the same stops in the same order on every run, capped, each with a bounded search time', () => {
    const one = lootStops('money', ctxOf(CUSTOMS), me, 40);
    const two = lootStops('money', ctxOf(CUSTOMS), me, 40);
    expect(one.map((s) => s.id)).toEqual(two.map((s) => s.id));
    expect(one).toHaveLength(40);
    expect(one.every((s) => s.work > 0 && s.work <= 120)).toBe(true);
    expect(one.every((s) => s.info?.kind === 'loot')).toBe(true);
  });
});

describe('loot areas for the hideout', () => {
  // An item that can spawn loose on Customs, as if the hideout needed it.
  const counts = new Map<string, number>();
  for (const s of lootForMap(snap, CUSTOMS).loose) for (const id of s.items) counts.set(id, (counts.get(id) ?? 0) + 1);
  const wanted = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  it('leads with areas where the missing items can spawn, and names them', () => {
    const stops = best(lootStops('hideout', ctxOf(CUSTOMS, { hideoutNeeds: new Set([wanted]) }), me));
    expect(stops[0].info?.items).toContain(wanted);
  });

  it('without anything missing, still counts the containers that hold hideout materials', () => {
    const stops = lootStops('hideout', ctxOf(CUSTOMS, { hideoutNeeds: new Set() }), me);
    expect(stops.length).toBeGreaterThan(0);
    const kinds = new Set(stops.flatMap((s) => Object.keys(s.info?.containers ?? {})));
    expect(kinds.has('toolbox') || kinds.has('technical-supply-crate') || kinds.has('pc-block')).toBe(true);
    expect(kinds.has('weapon-box')).toBe(false);
  });
});

describe('loot areas for weapons', () => {
  it('ammo only: areas with ammo boxes, not with PCs', () => {
    const stops = lootStops('weapons', ctxOf(CUSTOMS, { weaponKinds: ['ammo'] }), me);
    const kinds = new Set(stops.flatMap((s) => Object.keys(s.info?.containers ?? {})));
    expect(kinds.has('wooden-ammo-box')).toBe(true);
    expect(kinds.has('pc-block')).toBe(false);
  });

  it('guns: the weapon boxes lead', () => {
    const top = best(lootStops('weapons', ctxOf(CUSTOMS, { weaponKinds: ['guns'] }), me))[0];
    expect(top.info?.containers?.['weapon-box']).toBeGreaterThan(0);
  });
});

describe('Scav areas', () => {
  const spawn = (id: string, x: number, z: number, categories: string[], category: Poi['category'] = 'spawn'): Poi => ({
    id,
    category,
    subtype: 'scav',
    mapId: 'm',
    position: { x, y: 0, z },
    label: id,
    source: 'tarkov-dev',
    meta: { categories },
  });

  it('groups bot spawns, the busiest first, without Scav snipers or player-only spawns', () => {
    const stops = scavStops(
      [
        spawn('a1', 0, 0, ['bot', 'player']),
        spawn('a2', 10, 5, ['bot']),
        spawn('a3', 5, 15, ['boss', 'bot', 'player'], 'boss'),
        spawn('b1', 300, 0, ['bot']),
        spawn('sn', 600, 0, ['bot', 'sniper']),
        spawn('pl', 900, 0, ['player']),
      ],
      me,
    );
    expect(stops).toHaveLength(2);
    const big = stops.find((s) => s.value === 3)!;
    expect(big.info).toMatchObject({ kind: 'scavs', spawns: 3, boss: true });
    expect(stops.find((s) => s.value === 1)?.info?.boss).toBe(false);
  });
});
