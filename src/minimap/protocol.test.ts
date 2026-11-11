import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINIMAP,
  defaultCorner,
  distanceLabel,
  edgeMarker,
  fitInMonitor,
  headingAngle,
  layoutLabels,
  minimapPoints,
  parseMinimapSettings,
  rotateOffset,
  shortExitLabel,
} from './protocol';
import type { Poi } from '../poi/types';

const GZ = '653e6760052c01c1c805532f';
const GZ_HIGH = '65b8d6f5cdde2479cb2a3125';

describe('minimap protocol', () => {
  it('parses settings defensively and clamps ranges', () => {
    expect(parseMinimapSettings(null)).toEqual(DEFAULT_MINIMAP);
    expect(parseMinimapSettings('{oops')).toEqual(DEFAULT_MINIMAP);
    const s = parseMinimapSettings(JSON.stringify({ enabled: true, size: 9999, opacity: 0, shape: 'hex', pos: { x: 10.4, y: 'a' } }));
    expect(s).toMatchObject({ enabled: true, size: 480, opacity: 0.3, shape: 'circle', pos: null, locked: true });
  });

  it('defaults to the top-right corner of the monitor, clear of the centered hotbar', () => {
    expect(defaultCorner({ x: 0, y: 0, width: 1920, height: 1080 }, 260)).toEqual({ x: 1636, y: 24 });
    // A monitor to the right of the primary one.
    expect(defaultCorner({ x: 1920, y: 0, width: 2560, height: 1440 }, 200, 10)).toEqual({ x: 4270, y: 10 });
  });

  it('uses the same heading as the main map arrow, so heading-up undoes it exactly', () => {
    expect(headingAngle(90, 180)).toBe(270);
  });

  it('collects objective positions (map variants included) and PMC extracts only', () => {
    const pois: Poi[] = [
      { id: 'a', category: 'extract', mapId: GZ, position: { x: 1, y: 0, z: 2 }, label: 'PMC', source: 'tarkov-dev', meta: { faction: 'pmc' } },
      { id: 'b', category: 'extract', mapId: GZ, position: { x: 3, y: 0, z: 4 }, label: 'Scav', source: 'tarkov-dev', meta: { faction: 'scav' } },
      { id: 'c', category: 'loot', mapId: GZ, position: { x: 5, y: 0, z: 6 }, label: 'Safe', source: 'tarkov-dev' },
    ];
    const points = minimapPoints(
      GZ,
      [
        { objective: { id: 'o1', type: 'visit', zones: [{ id: 'z', map: { id: GZ_HIGH, name: '' }, position: { x: 7, y: 0, z: 8 } }] } },
        { objective: { id: 'o2', type: 'visit' } },
      ],
      pois,
    );
    expect(points).toEqual([
      { x: 7, z: 8, kind: 'quest' },
      { x: 1, z: 2, kind: 'extract' },
    ]);
    // On a Scav raid the Scav exit replaces the PMC one.
    expect(minimapPoints(GZ, [], pois, 60, 'scav')).toEqual([{ x: 3, z: 4, kind: 'extract' }]);
  });
});

describe('minimap placement after a size change', () => {
  const mon = { x: 0, y: 0, width: 1920, height: 1080 };
  it('grows a top-right overlay to the left so it stays on screen', () => {
    // Saved for the medium size (260) at the default corner, then switched to large (340).
    expect(fitInMonitor({ x: 1636, y: 24 }, 340, mon, 260)).toEqual({ x: 1556, y: 24 });
  });
  it('keeps the left edge on the left half and clamps anything off-screen', () => {
    expect(fitInMonitor({ x: 40, y: 40 }, 340, mon, 200)).toEqual({ x: 40, y: 40 });
    expect(fitInMonitor({ x: 1636, y: 24 }, 340, mon)).toEqual({ x: 1580, y: 24 });
    expect(fitInMonitor({ x: -50, y: 2000 }, 200, mon)).toEqual({ x: 0, y: 880 });
  });
});

describe('minimap exits read from O+O', () => {
  it('shows exactly the listed exits, transits included, whatever the side', () => {
    const GZ = '653e6760052c01c1c805532f';
    const pois: Poi[] = [
      { id: 'extract:a', category: 'extract', mapId: GZ, position: { x: 1, y: 0, z: 2 }, label: 'A', source: 'tarkov-dev', meta: { faction: 'pmc' } },
      { id: 'extract:b', category: 'extract', mapId: GZ, position: { x: 3, y: 0, z: 4 }, label: 'B', source: 'tarkov-dev', meta: { faction: 'scav' } },
      { id: 'transit:t', category: 'transit', mapId: GZ, position: { x: 5, y: 0, z: 6 }, label: 'T', source: 'tarkov-dev' },
    ];
    expect(minimapPoints(GZ, [], pois, 60, 'pmc', new Set(['extract:b', 'transit:t']))).toEqual([
      { x: 3, z: 4, kind: 'extract', label: 'B' },
      { x: 5, z: 6, kind: 'transit', label: 'T' },
    ]);
  });
});

describe('edge arrows for exits outside the minimap', () => {
  it('leaves a point inside the disc to the map', () => {
    expect(edgeMarker(10, -10, 260)).toBeNull();
  });
  it('puts an off-screen exit on the rim, pointing its way', () => {
    // Straight up (ahead), far away.
    const up = edgeMarker(0, -900, 260)!;
    expect(up.angle).toBe(0);
    expect(Math.round(up.x)).toBe(130);
    expect(Math.round(up.y)).toBe(14);
    expect(up.align).toBe('middle');
    // To the right: label anchored to the end so it reads inward.
    const right = edgeMarker(900, 0, 260)!;
    expect(right.angle).toBe(90);
    expect(right.align).toBe('end');
    expect(edgeMarker(-900, 0, 260)!.angle).toBe(270);
  });
  it('turns with the heading-up rotation', () => {
    // A point ahead on a north-up map, when the map is turned 90° clockwise, sits to the right.
    const r = rotateOffset(0, -100, 90);
    expect(Math.round(r.dx)).toBe(100);
    expect(r.dy).toBeCloseTo(0);
  });
  it('shortens labels and rounds distances', () => {
    expect(shortExitLabel('Scav Checkpoint (Co-op)')).toBe('Scav Checkpoint');
    expect(shortExitLabel('Cardinal Apartment Complex Parking')).toBe('Cardinal Apartmen…');
    expect(distanceLabel({ x: 0, z: 0 }, { x: 228, z: 30 })).toBe('230 m');
    expect(distanceLabel(null, { x: 1, z: 1 })).toBeNull();
  });
});

describe('label layout', () => {
  it('moves a label that would sit on another one', () => {
    const ys = layoutLabels(
      [
        { x: 60, y: 260, text: 'Catacumbas · 580 m', align: 'start' },
        { x: 70, y: 262, text: 'Ground Zero · 630 m', align: 'start' },
        { x: 250, y: 100, text: 'Interchange · 130 m', align: 'end' },
      ],
      330,
    );
    expect(ys[0]).toBe(260);
    expect(Math.abs(ys[1] - ys[0])).toBeGreaterThanOrEqual(13);
    expect(ys[2]).toBe(100);
  });
});
