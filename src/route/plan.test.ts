import { describe, expect, it } from 'vitest';
import type { TarkovTask, TaskObjective } from '../api/types';
import { buildStops, centroid, planRoute, routeStart, travelSeconds, type RouteExit, type RouteStop } from './plan';

const MAP = '56f40101d2720b2a4d8b45d6'; // Customs

function obj(id: string, x: number, z: number, type = 'visit'): TaskObjective {
  return { id, type, zones: [{ id: `z-${id}`, map: { id: MAP, name: 'Customs' }, position: { x, y: 0, z } }] } as TaskObjective;
}
const task = (id: string, objectives: TaskObjective[]): TarkovTask => ({ id, name: `Quest ${id}`, objectives });
const me = { id: 'me', name: 'Eu', color: '#fff' };
const mate = { id: 'mate', name: 'Amigo', color: '#f00' };

function stop(id: string, x: number, z: number, work = 0): RouteStop {
  return { id, x, y: 0, z, items: [], who: [me], work };
}
const exit = (id: string, x: number, z: number, penalty = 0): RouteExit => ({ id, label: id, x, z, penalty });

describe('buildStops', () => {
  it('one stop for an objective two squadmates both need, with both of them', () => {
    const a = obj('a', 0, 0);
    const t = task('t1', [a]);
    const stops = buildStops(MAP, [
      { who: me, objectives: [{ task: t, objective: a }] },
      { who: mate, objectives: [{ task: t, objective: a }] },
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0].who.map((w) => w.id)).toEqual(['me', 'mate']);
  });

  it('merges objectives a few meters apart and skips ones without a place on this map', () => {
    const a = obj('a', 0, 0, 'mark');
    const b = obj('b', 5, 5, 'plantItem');
    const far = obj('c', 300, 0);
    const nowhere: TaskObjective = { id: 'd', type: 'visit' };
    const t = task('t1', [a, b, far, nowhere]);
    const stops = buildStops(MAP, [{ who: me, objectives: t.objectives!.map((objective) => ({ task: t, objective })) }]);
    expect(stops).toHaveLength(2);
    const merged = stops.find((s) => s.items.length === 2)!;
    expect(merged.work).toBe(40 + 30 / 2);
  });

  it('gives the same list whatever order the objectives came in', () => {
    const objs = [obj('c', 100, 0), obj('a', 0, 100), obj('b', 50, 50)];
    const t = task('t', objs);
    const one = buildStops(MAP, [{ who: me, objectives: objs.map((objective) => ({ task: t, objective })) }]);
    const two = buildStops(MAP, [{ who: me, objectives: [...objs].reverse().map((objective) => ({ task: t, objective })) }]);
    expect(one.map((s) => s.id)).toEqual(two.map((s) => s.id));
  });
});

describe('planRoute', () => {
  it('walks a line of stops in order and ends at the nearest exit', () => {
    const stops = [stop('c', 300, 0), stop('a', 100, 0), stop('b', 200, 0)];
    const plan = planRoute({ x: 0, z: 0 }, stops, [exit('far', -500, 0), exit('near', 400, 0)], 3600);
    expect(plan.stops.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(plan.exit?.id).toBe('near');
    expect(plan.left).toHaveLength(0);
    expect(plan.legs).toHaveLength(4);
    expect(plan.total).toBeCloseTo(travelSeconds({ x: 0, z: 0 }, { x: 400, z: 0 }));
  });

  it('leaves out what does not fit in the time and still reaches an exit', () => {
    // 2 close stops, 1 very far one; the budget covers only the close ones.
    const stops = [stop('a', 50, 0), stop('b', 60, 40), stop('far', 3000, 0)];
    const ex = [exit('e', 0, 50)];
    const plan = planRoute({ x: 0, z: 0 }, stops, ex, 200);
    expect(plan.stops.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(plan.left.map((s) => s.id)).toEqual(['far']);
    expect(plan.total).toBeLessThanOrEqual(200);
  });

  it('prefers more stops over one stop that is closer to the start', () => {
    // A cluster of 3 to the east vs a single stop to the west, budget for one side only.
    const stops = [stop('w', -120, 0), stop('e1', 150, 0), stop('e2', 160, 10), stop('e3', 170, -10)];
    const plan = planRoute({ x: 0, z: 0 }, stops, [exit('ex', 180, 0)], travelSeconds({ x: 0, z: 0 }, { x: 180, z: 0 }) + 20);
    expect(plan.stops.map((s) => s.id).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('counts the extra time of an exit with a condition', () => {
    const plan = planRoute({ x: 0, z: 0 }, [], [exit('paid', 100, 0, 600), exit('free', 300, 0)], 3600);
    expect(plan.exit?.id).toBe('free');
  });

  it('nothing fits: no stops, still the exit', () => {
    const plan = planRoute({ x: 0, z: 0 }, [stop('a', 5000, 0)], [exit('e', 10, 0)], 60);
    expect(plan.stops).toHaveLength(0);
    expect(plan.exit?.id).toBe('e');
  });

  it('is quick for a busy map', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 800 - 400;
    const stops = Array.from({ length: 60 }, (_, i) => stop(`s${i}`, rnd(), rnd(), 20));
    const exits = Array.from({ length: 10 }, (_, i) => exit(`e${i}`, rnd(), rnd()));
    const t0 = performance.now();
    const plan = planRoute({ x: 0, z: 0 }, stops, exits, 35 * 60);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(plan.stops.length).toBeGreaterThan(10);
    expect(plan.total).toBeLessThanOrEqual(35 * 60);
  });
});

describe('centroid', () => {
  it('is the middle of the squad, or null without anyone', () => {
    expect(centroid([{ x: 0, z: 0 }, { x: 10, z: 20 }])).toEqual({ x: 5, z: 10 });
    expect(centroid([])).toBeNull();
  });
});

describe('routeStart', () => {
  const me = { x: 10, z: 20, ts: 2_000 };
  const spawn = { at: { x: -300, z: 50 }, ts: 1_000 };
  const party = [{ x: 0, z: 0 }, { x: 100, z: 0 }];

  it('always leaves from where you are, over the party and an older pick', () => {
    expect(routeStart(me, null, party)).toEqual({ point: { x: 10, z: 20 }, source: 'self', ts: 2_000 });
    expect(routeStart(me, spawn, party)?.source).toBe('self');
  });

  it('uses a spawn picked after your last screenshot until a newer one', () => {
    expect(routeStart(me, { ...spawn, ts: 3_000 }, party)).toEqual({ point: spawn.at, source: 'picked', ts: 3_000 });
    expect(routeStart({ ...me, ts: 4_000 }, { ...spawn, ts: 3_000 }, party)?.source).toBe('self');
  });

  it("falls back to the party's position, then to nothing", () => {
    expect(routeStart(null, null, party)).toEqual({ point: { x: 50, z: 0 }, source: 'party', ts: null });
    expect(routeStart(null, null, [])).toBeNull();
  });
});
