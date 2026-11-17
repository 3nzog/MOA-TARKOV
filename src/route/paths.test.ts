import { describe, expect, it } from 'vitest';
import type { XZ } from './cluster';
import { heatAt, isHazard, isTraffic, type HeatSource } from './heat';
import { buildGrid, cellOf, dijkstra, fieldsOf, heatField, pathTo, plainFields, shortestWay, smoothPath, straightCost, type Fields, type Weighing } from './paths';

const DIRECT: Weighing = { avoid: 'all', lambda: 0, pull: 0 };
const DISCREET: Weighing = { avoid: 'all', lambda: 4, pull: 0 };
const AGGRESSIVE: Weighing = { avoid: 'hazard', lambda: 4, pull: 5 };

/** The smoothed way from a to b. */
function way(grid: ReturnType<typeof buildGrid>, f: Fields, w: Weighing, a: XZ, b: XZ): XZ[] {
  return smoothPath(grid, f, w, pathTo(grid, dijkstra(grid, f, w, a), b));
}

const RAID = 40 * 60;

/** Known points every `step` metres over a rectangle. */
function area(x0: number, z0: number, x1: number, z1: number, step = 20): XZ[] {
  const out: XZ[] = [];
  for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) out.push({ x, z });
  return out;
}

/** Heat × metres and metres walked along a polyline, on the grid's field. */
function walk(field: Float32Array, grid: ReturnType<typeof buildGrid>, pts: XZ[]) {
  let heat = 0;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const s = straightCost(grid, field, pts[i - 1], pts[i]);
    heat += s.heat;
    len += s.len;
  }
  return { heat, len };
}

describe('the way around a hot zone', () => {
  const grid = buildGrid(area(0, 0, 300, 160));
  // A busy spot right on the straight line from A to B.
  const sources: HeatSource[] = [{ kind: 'boss', x: 150, z: 80, r: 45, w: 1 }];
  const field = heatField(grid, (p) => heatAt(sources, p, 120, RAID));
  const fields = plainFields(field);
  const A = { x: 10, z: 80 };
  const B = { x: 290, z: 80 };
  const straight = straightCost(grid, field, A, B);

  it('the direct way goes straight through it', () => {
    const w = walk(field, grid, way(grid, fields, DIRECT, A, B));
    expect(w.heat).toBeGreaterThan(0.6 * straight.heat);
    expect(w.len).toBeLessThan(1.05 * straight.len);
  });

  it('the discreet way bends around it, for a modest detour', () => {
    const pts = way(grid, fields, DISCREET, A, B);
    const w = walk(field, grid, pts);
    expect(w.heat).toBeLessThan(0.3 * straight.heat);
    expect(w.len).toBeGreaterThan(straight.len);
    expect(w.len).toBeLessThan(1.6 * straight.len);
    // Drawn as a few bends, not a staircase of cells.
    expect(pts.length).toBeLessThan(pathTo(grid, dijkstra(grid, fields, DISCREET, A), B).length / 3);
    expect(pts[0]).toEqual(A);
    expect(pts[pts.length - 1]).toEqual(B);
  });

  it('the aggressive way goes through a busy spot near its way', () => {
    // 25 m off the line: the straight way only grazes it.
    const offLine: HeatSource[] = [{ kind: 'spawn', x: 150, z: 105, r: 45, w: 1 }];
    const f = heatField(grid, (p) => heatAt(offLine, p, 60, RAID));
    const pf = plainFields(f);
    const direct = walk(f, grid, way(grid, pf, DIRECT, A, B));
    const seek = walk(f, grid, way(grid, pf, AGGRESSIVE, A, B));
    expect(direct.heat).toBeGreaterThan(0);
    expect(seek.heat).toBeGreaterThan(direct.heat * 1.2);
  });

  it('keeps the tree\'s metres, heat and hot metres for the planner', () => {
    const t = dijkstra(grid, fields, DIRECT, A);
    const end = cellOf(grid, B);
    expect(t.len[end]).toBeGreaterThan(270);
    expect(t.heat[end]).toBeGreaterThan(0);
    expect(t.hot[end]).toBeGreaterThan(0);
    expect(t.hot[end]).toBeLessThanOrEqual(t.len[end]);
  });
});

describe('the way stays on the known map', () => {
  // An L: a bar along the bottom and one up the right side. Nothing known in
  // the corner between them (open water, say).
  const grid = buildGrid([...area(0, 0, 200, 20), ...area(180, 0, 200, 200)]);
  const field = new Float32Array(grid.w * grid.h);
  const fields = plainFields(field);
  const A = { x: 10, z: 10 };
  const B = { x: 190, z: 190 };

  it('goes around the corner instead of across it, and the drawing does not cut it either', () => {
    const pts = way(grid, fields, DIRECT, A, B);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      for (let k = 0; k <= 20; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / 20, z: a.z + ((b.z - a.z) * k) / 20 };
        expect(grid.walk[cellOf(grid, p)], `(${p.x.toFixed(0)}, ${p.z.toFixed(0)})`).toBe(1);
      }
    }
    // Longer than the straight line across the empty corner (254 m).
    expect(walk(field, grid, pts).len).toBeGreaterThan(1.05 * Math.hypot(B.x - A.x, B.z - A.z));
  });
});

describe('the aggressive way and the fixed dangers', () => {
  it('is drawn to where players go but still keeps out of a minefield', () => {
    const grid = buildGrid(area(0, 0, 300, 160));
    const A = { x: 10, z: 80 };
    const B = { x: 290, z: 80 };
    // Players near the line on one side, a minefield on the other.
    const sources: HeatSource[] = [
      { kind: 'spawn', x: 150, z: 105, r: 45, w: 1 },
      { kind: 'mine', x: 150, z: 60, r: 15, w: 2, outline: [{ x: 120, z: 72 }, { x: 180, z: 72 }, { x: 180, z: 40 }, { x: 120, z: 40 }] },
    ];
    const f = fieldsOfSources(grid, sources);
    const pts = way(grid, f, AGGRESSIVE, A, B);
    for (let i = 1; i < pts.length; i++) {
      for (let k = 0; k <= 20; k++) {
        const p = { x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / 20, z: pts[i - 1].z + ((pts[i].z - pts[i - 1].z) * k) / 20 };
        expect(f.hazard[cellOf(grid, p)]).toBeLessThan(1);
      }
    }
  });
});

function fieldsOfSources(grid: ReturnType<typeof buildGrid>, sources: HeatSource[]): Fields {
  return fieldsOf(
    grid,
    (p) => heatAt(sources, p, 60, RAID, isTraffic),
    (p) => heatAt(sources, p, 60, RAID, isHazard),
  );
}

describe('shortestWay (one leg, A*)', () => {
  const grid = buildGrid(area(0, 0, 300, 160));
  const sources: HeatSource[] = [{ kind: 'boss', x: 150, z: 80, r: 45, w: 1 }];
  const f = fieldsOfSources(grid, sources);
  const A = { x: 10, z: 80 };
  const B = { x: 290, z: 80 };

  it('finds the same way as the full search, and measures it', () => {
    for (const w of [DIRECT, DISCREET, AGGRESSIVE]) {
      const leg = shortestWay(grid, f, w, A, B);
      const full = way(grid, f, w, A, B);
      expect(leg.pts[0]).toEqual(A);
      expect(leg.pts[leg.pts.length - 1]).toEqual(B);
      expect(leg.len).toBeCloseTo(walk(f.all, grid, full).len, 0);
      expect(leg.hot).toBeLessThanOrEqual(leg.len);
    }
    expect(shortestWay(grid, f, DISCREET, A, B).heat).toBeLessThan(shortestWay(grid, f, DIRECT, A, B).heat);
  });

  it('is a straight line between two points in the same cell', () => {
    const leg = shortestWay(grid, f, DISCREET, { x: 51, z: 51 }, { x: 53, z: 52 });
    expect(leg.pts).toHaveLength(2);
    expect(leg.len).toBeCloseTo(Math.hypot(2, 1), 5);
  });
});
