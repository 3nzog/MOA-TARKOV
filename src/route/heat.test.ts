import { describe, expect, it } from 'vitest';
import type { Poi } from '../poi/types';
import { HOT, MAX_HEAT, heatAt, heatSources, hotReason, phaseOf, phaseTime, timeFactor } from './heat';

const RAID = 40 * 60;

function poi(id: string, category: Poi['category'], x: number, z: number, extra: Partial<Poi> = {}): Poi {
  return { id, category, mapId: 'm', position: { x, y: 0, z }, label: id, source: 'tarkov-dev', ...extra };
}

describe('timeFactor', () => {
  it('PMC spawns are busy at the start and empty after ~8 minutes', () => {
    expect(timeFactor('spawn', 60, RAID)).toBe(1);
    expect(timeFactor('spawn', 330, RAID)).toBeCloseTo(0.5, 5);
    expect(timeFactor('spawn', 600, RAID)).toBe(0);
  });

  it('exits are quiet early and busy in the last third', () => {
    expect(timeFactor('extract', 0.1 * RAID, RAID)).toBe(0.2);
    expect(timeFactor('extract', 0.8 * RAID, RAID)).toBe(1);
    expect(timeFactor('extract', 0.55 * RAID, RAID)).toBeCloseTo(0.6, 5);
  });

  it('loot hubs peak from the first minute to ~15 and calm down after', () => {
    expect(timeFactor('loot', 300, RAID)).toBe(1);
    expect(timeFactor('loot', 1600, RAID)).toBe(0.35);
    expect(timeFactor('boss', 1600, RAID)).toBe(1);
  });
});

describe('heatSources and heatAt', () => {
  const pois: Poi[] = [
    // Three spawns of one group.
    poi('s1', 'spawn', 0, 0, { subtype: 'pmc' }),
    poi('s2', 'spawn', 20, 0, { subtype: 'pmc' }),
    poi('s3', 'spawn', 0, 20, { subtype: 'pmc' }),
    poi('scav', 'spawn', 500, 500, { subtype: 'scav' }),
    poi('x1', 'extract', 400, 0, { meta: { faction: 'pmc' } }),
    poi(
      'mine',
      'minefield',
      0,
      400,
      { meta: { outline: [{ x: -20, z: 380 }, { x: 20, z: 380 }, { x: 20, z: 420 }, { x: -20, z: 420 }] } },
    ),
  ];
  const sources = heatSources(pois);

  it('makes one source per spawn group and none for Scav spawns', () => {
    expect(sources.filter((s) => s.kind === 'spawn')).toHaveLength(1);
    expect(heatAt(sources, { x: 500, z: 500 }, 60, RAID)).toBe(0);
  });

  it('a spawn group is hot at the start of the raid and cold later', () => {
    expect(heatAt(sources, { x: 5, z: 5 }, 60, RAID)).toBeGreaterThanOrEqual(HOT);
    expect(heatAt(sources, { x: 5, z: 5 }, 900, RAID)).toBe(0);
  });

  it('an exit gets hot at the end of the raid', () => {
    expect(heatAt(sources, { x: 400, z: 5 }, 120, RAID)).toBeLessThan(HOT);
    expect(heatAt(sources, { x: 400, z: 5 }, 0.9 * RAID, RAID)).toBeGreaterThanOrEqual(HOT);
    expect(hotReason(sources, { x: 400, z: 5 }, 0.9 * RAID, RAID)?.kind).toBe('extract');
    expect(hotReason(sources, { x: 400, z: 5 }, 120, RAID)).toBeNull();
  });

  it('inside a minefield is the worst, at any time; just outside it fades', () => {
    expect(heatAt(sources, { x: 0, z: 400 }, 60, RAID)).toBe(MAX_HEAT);
    expect(heatAt(sources, { x: 0, z: 400 }, 0.9 * RAID, RAID)).toBe(MAX_HEAT);
    const near = heatAt(sources, { x: 0, z: 427 }, 60, RAID);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(MAX_HEAT);
    expect(hotReason(sources, { x: 0, z: 400 }, 60, RAID)?.kind).toBe('mine');
  });

  it('rich container clusters are loot hubs; a lone drawer is not', () => {
    const containers = [
      { x: 1000, z: 1000, y: 0, kind: 'safe' },
      { x: 1005, z: 1000, y: 0, kind: 'safe' },
      { x: 1000, z: 1008, y: 0, kind: 'pc-block' },
      { x: 1010, z: 1004, y: 0, kind: 'weapon-box' },
      { x: 3000, z: 3000, y: 0, kind: 'drawer' },
    ];
    const withLoot = heatSources([], containers);
    expect(withLoot.filter((s) => s.kind === 'loot')).toHaveLength(1);
    expect(heatAt(withLoot, { x: 1004, z: 1003 }, 300, RAID)).toBeGreaterThanOrEqual(HOT);
    expect(heatAt(withLoot, { x: 3000, z: 3000 }, 300, RAID)).toBe(0);
  });
});

describe('raid phases', () => {
  it('splits the raid in start, middle and end', () => {
    expect(phaseOf(0.1 * RAID, RAID)).toBe(0);
    expect(phaseOf(0.5 * RAID, RAID)).toBe(1);
    expect(phaseOf(0.9 * RAID, RAID)).toBe(2);
    for (const p of [0, 1, 2] as const) expect(phaseOf(phaseTime(p, RAID), RAID)).toBe(p);
  });
});
