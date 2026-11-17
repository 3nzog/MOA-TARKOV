import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { itemKinds, lootForMap, type LootSnapshot } from './lootData';

const snap = JSON.parse(readFileSync('data/snapshot/loot.json', 'utf8')) as LootSnapshot;
const CUSTOMS = '56f40101d2720b2a4d8b45d6';
const GROUND_ZERO = '653e6760052c01c1c805532f';
const GROUND_ZERO_21 = '65b8d6f5cdde2479cb2a3125';

describe('the loot snapshot', () => {
  it('has loose spots and containers for the big maps, with positions and items', () => {
    const customs = lootForMap(snap, CUSTOMS);
    expect(customs.loose.length).toBeGreaterThan(100);
    expect(customs.containers.length).toBeGreaterThan(100);
    for (const s of customs.loose) {
      expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true);
      expect(s.items.length).toBeGreaterThan(0);
      expect(s.items.every((id) => /^[0-9a-f]{24}$/.test(id))).toBe(true);
    }
    expect(new Set(customs.containers.map((c) => c.kind))).toContain('safe');
  });

  it('keeps one kind letter per item', () => {
    expect(snap.kinds).toHaveLength(snap.items.length);
    expect(itemKinds(snap).size).toBe(snap.items.length);
  });

  it("finds a map's loot by its own id, and a variant falls back to its map", () => {
    expect(lootForMap(snap, GROUND_ZERO_21).loose.length).toBeGreaterThan(0);
    expect(lootForMap(snap, GROUND_ZERO).loose.length).toBeGreaterThan(0);
    expect(lootForMap(snap, 'no-such-map')).toEqual({ loose: [], containers: [] });
  });
});
