import { describe, expect, it } from 'vitest';
import { arcPoints, conePoints, estimateAim, sniperSpots } from './sniper';
import type { Poi } from './types';

const M = 'm';
const zone = (id: string, x: number, z: number, outline = [{ x: x - 10, z: z - 10 }, { x: x + 10, z: z - 10 }, { x: x, z: z + 10 }]): Poi => ({
  id, category: 'sniper', subtype: 'zone', mapId: M, position: { x, y: 0, z }, label: 'Sniper Scav', source: 'tarkov-dev', meta: { outline },
});
const spawn = (id: string, x: number, z: number): Poi => ({
  id, category: 'sniper', subtype: 'spawn', mapId: M, position: { x, y: 0, z }, label: 'Sniper Scav', source: 'tarkov-dev',
});

describe('sniper spots', () => {
  it('one spot per post: spawns next to a zone join it, nearby spawns merge', () => {
    const spots = sniperSpots([
      zone('z1', 0, 0),
      spawn('s1', 20, 5), // inside the zone's post
      spawn('s2', 300, 300),
      spawn('s3', 310, 300), // same post as s2
      spawn('s4', -400, 0), // alone
      { id: 'x', category: 'extract', mapId: M, position: { x: 0, y: 0, z: 0 }, label: 'E', source: 'tarkov-dev' },
    ]);
    expect(spots).toHaveLength(3);
    expect(spots[0]).toMatchObject({ id: 'z1', center: { x: 0, z: 0 } });
    expect(spots[0].outline).toHaveLength(3);
    expect(spots[1].center).toEqual({ x: 305, z: 300 });
    expect(spots[1].outline).toBeNull();
    expect(spots[2].center).toEqual({ x: -400, z: 0 });
  });

  it('a zone with fewer than 3 corners has no outline', () => {
    expect(sniperSpots([zone('z', 0, 0, [{ x: 1, z: 1 }])])[0].outline).toBeNull();
  });
});

describe('ring and cone geometry', () => {
  it('a 360° ring is a closed circle of the given radius', () => {
    const pts = arcPoints({ x: 10, z: -5 }, 100);
    expect(pts).toHaveLength(49);
    for (const p of pts) expect(Math.hypot(p.x - 10, p.z + 5)).toBeCloseTo(100, 6);
    expect(pts[0].x).toBeCloseTo(pts[48].x, 6);
  });

  it('the cone starts and ends at the post and spans 70°', () => {
    const c = conePoints({ x: 0, z: 0 }, 0, 100);
    expect(c[0]).toEqual({ x: 0, z: 0 });
    expect(c[c.length - 1]).toEqual({ x: 0, z: 0 });
    const ends = [c[1], c[c.length - 2]].map((p) => (Math.atan2(p.z, p.x) * 180) / Math.PI);
    expect(ends[0]).toBeCloseTo(-35, 6);
    expect(ends[1]).toBeCloseTo(35, 6);
  });
});

describe('estimated aim', () => {
  it('points where the things around are', () => {
    const around = [{ x: 100, z: 10 }, { x: 120, z: -10 }, { x: 90, z: 0 }, { x: 110, z: 30 }];
    const a = estimateAim({ x: 0, z: 0 }, around, 150)!;
    expect(Math.abs(a.angle)).toBeLessThan(0.3);
    expect(a.confidence).toBeGreaterThan(0.9);
  });

  it('no cone when things are all around, too few, too close or too far', () => {
    const ring = [0, 1, 2, 3, 4, 5].map((i) => ({ x: Math.cos((i * Math.PI) / 3) * 100, z: Math.sin((i * Math.PI) / 3) * 100 }));
    expect(estimateAim({ x: 0, z: 0 }, ring, 150)).toBeNull();
    expect(estimateAim({ x: 0, z: 0 }, [{ x: 100, z: 0 }, { x: 110, z: 0 }], 150)).toBeNull();
    expect(estimateAim({ x: 0, z: 0 }, [{ x: 5, z: 0 }, { x: 10, z: 0 }, { x: 900, z: 0 }, { x: 1000, z: 0 }], 150)).toBeNull();
  });
});
