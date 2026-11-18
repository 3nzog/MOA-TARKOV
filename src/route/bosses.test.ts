import { describe, expect, it } from 'vitest';
import { mapDataToPois } from '../poi/fromTarkovDev';
import type { MapPoiData } from '../api/types';
import { bossStops, mapBosses } from './targets';
import { bossList } from './describe';

// Customs-like: Reshala (60%) at the dorms, the gas station or the Scav base;
// the Goons (20%) only at the Scav base; an event mob with no place.
const map = {
  id: 'customs',
  spawns: [
    { zoneName: 'ZoneDormitory', position: { x: 0, y: 0, z: 0 }, categories: ['boss'] },
    { zoneName: 'ZoneDormitory', position: { x: 10, y: 0, z: 5 }, categories: ['boss'] },
    { zoneName: 'ZoneScavBase', position: { x: 400, y: 0, z: 0 }, categories: ['boss'] },
    { zoneName: 'ZoneCrossRoad', position: { x: -400, y: 0, z: 0 }, categories: ['boss'] },
  ],
  bosses: [
    {
      boss: { name: 'Reshala', normalizedName: 'reshala' },
      spawnChance: 0.6,
      spawnLocations: [
        { name: 'ZoneDormitory', chance: 0.33 },
        { name: 'ZoneGasStation', chance: 0.33 },
        { name: 'ZoneScavBase', chance: 0.33 },
      ],
    },
    { boss: { name: 'Goons', normalizedName: 'goons' }, spawnChance: 0.2, spawnLocations: [{ name: 'ZoneScavBase', chance: 1 }] },
    { boss: { name: 'Screamer', normalizedName: 'infected-screamer' }, spawnChance: 1 },
  ],
} as unknown as MapPoiData;

describe('hunting bosses', () => {
  const pois = mapDataToPois(map);

  it("each boss's chance is its own, not its zone's (a zone at 100% does not make it certain)", () => {
    expect(mapBosses(pois)).toEqual([
      { name: 'Reshala', chance: 0.6 },
      { name: 'Goons', chance: 0.2 },
    ]);
  });

  it('each spot says who can be there and how likely', () => {
    const base = pois.find((p) => p.category === 'boss' && p.position.x === 400)!;
    expect(bossList((base.meta as { here: { name: string; chance: number }[] }).here)).toBe('Goons 20% · Reshala 20%');
    const cross = pois.find((p) => p.category === 'boss' && p.position.x === -400)!;
    expect((cross.meta as { here: unknown[] }).here).toEqual([]);
  });

  it('the stops are the places where a boss can be, worth the chance of meeting one', () => {
    const stops = bossStops(pois, []);
    expect(stops.map((s): [number, number] => [Math.round(s.x), s.value ?? 0]).sort((a, b) => a[0] - b[0])).toEqual([
      [5, 20],
      [400, 36],
    ]);
    expect(stops.every((s) => s.info?.kind === 'bosses')).toBe(true);
  });
});
