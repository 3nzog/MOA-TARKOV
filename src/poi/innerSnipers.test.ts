import { describe, expect, it } from 'vitest';
import { markInnerSnipers } from './fromTarkovDev';
import { facetKeyOf } from './facets';
import type { Poi } from './types';

const M = 'm';
const at = (id: string, category: Poi['category'], x: number, z: number, subtype?: string): Poi => ({
  id, category, subtype, mapId: M, position: { x, y: 0, z }, label: id, source: 'tarkov-dev',
});

describe('inside or on the edge of the map', () => {
  it('a marksman zone among loot is inside; one past the edge is not', () => {
    const loot = Array.from({ length: 15 }, (_, i) => at(`l${i}`, 'loot', 10 + i, 10));
    const inner = at('z1', 'sniper', 0, 0, 'zone');
    const edge = at('z2', 'sniper', 900, 900, 'zone');
    const pois = [...loot, inner, edge];
    markInnerSnipers(pois);
    expect(facetKeyOf(inner)).toBe('sniper');
    expect(facetKeyOf(edge)).toBe('sniper:edge');
  });

  it('a sniper spawn point is always inside', () => {
    const spawn = at('s', 'sniper', 900, 900, 'spawn');
    markInnerSnipers([spawn]);
    expect(facetKeyOf(spawn)).toBe('sniper');
  });

  it('many things a little further away also count (big open areas)', () => {
    const spread = Array.from({ length: 85 }, (_, i) => at(`p${i}`, 'spawn', 60 + (i % 30), (i % 3) * 5, i % 2 ? 'pmc' : 'scav'));
    const z = at('z', 'sniper', 0, 0, 'zone');
    markInnerSnipers([...spread, z]);
    expect(facetKeyOf(z)).toBe('sniper');
  });
});
