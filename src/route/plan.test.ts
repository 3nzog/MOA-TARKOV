import { describe, expect, it } from 'vitest';
import type { TarkovTask, TaskObjective } from '../api/types';
import { buildStops, centroid, planRoute, routeStart, STRAIGHT, travelSeconds, type LegModel, type RouteExit, type RouteStop } from './plan';

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

describe('planRoute — goals, styles and the raid clock', () => {
  const start = { x: 0, z: 0 };
  const valued = (id: string, x: number, z: number, value: number, work = 0): RouteStop => ({ ...stop(id, x, z, work), value });

  it('with a budget for one of two stops, takes the one worth more', () => {
    // Opposite ways from the start: time for one of them only.
    const stops = [valued('small', -60, 0, 1), valued('big', 120, 0, 10)];
    const budget = travelSeconds(start, { x: 120, z: 0 }) * 2 + 5;
    const plan = planRoute(start, stops, [exit('home', 0, 0)], budget);
    expect(plan.stops.map((s) => s.id)).toEqual(['big']);
    expect(plan.value).toBe(10);
  });

  it('stops at maxStops, the best ones first', () => {
    const stops = [valued('a', 50, 0, 1), valued('b', 60, 0, 5), valued('c', 70, 0, 3), valued('d', 80, 0, 4)];
    const plan = planRoute(start, stops, [exit('e', 100, 0)], 3600, { maxStops: 2 });
    expect(plan.stops.map((s) => s.id).sort()).toEqual(['b', 'd']);
  });

  it('ends at the car when asked and it fits, else at the nearest exit', () => {
    const exits: RouteExit[] = [exit('gate', 50, 0), { ...exit('car', 250, 0, 60), car: true, price: 20000 }];
    expect(planRoute(start, [], exits, 3600).exit?.id).toBe('gate');
    expect(planRoute(start, [], exits, 3600, { preferCar: true }).exit?.id).toBe('car');
    // Not enough time for the car: the gate after all.
    const tight = travelSeconds(start, { x: 250, z: 0 }) + 30;
    expect(planRoute(start, [], exits, tight, { preferCar: true }).exit?.id).toBe('gate');
  });

  // A place busy at the start of the raid (a spawn) and one busy at its end (an exit).
  const SPAWNISH = 'spawnish';
  const EXITISH = 'exitish';
  const model: LegModel = {
    leg: STRAIGHT.leg,
    heatAt: (p, phase) => {
      if (p.x > 50) return { traffic: phase === 0 ? 1 : 0, hazard: 0 };
      if (p.x < -50) return { traffic: phase === 2 ? 1 : 0, hazard: 0 };
      return { traffic: 0, hazard: 0 };
    },
  };
  const both = [stop(SPAWNISH, 100, 0, 100), stop(EXITISH, -100, 0, 100)];
  const RAID = 600;

  it('the discreet style goes where it is quiet first and to the spawn once everyone has left it', () => {
    const plan = planRoute(start, both, [exit('home', 0, 0)], 3600, { style: 'stealth', model, raid: RAID });
    expect(plan.stops.map((s) => s.id)).toEqual([EXITISH, SPAWNISH]);
    expect(plan.stopHeat.every((h) => h < 0.5)).toBe(true);
  });

  it('the aggressive style goes where the players are while they are there', () => {
    const plan = planRoute(start, both, [exit('home', 0, 0)], 3600, { style: 'aggressive', model, raid: RAID });
    expect(plan.stops[0].id).toBe(SPAWNISH);
    expect(plan.hot).toBeGreaterThan(0);
  });

  it('the discreet style leaves out a stop that is very hot whenever it would get there', () => {
    const boiling: LegModel = { leg: STRAIGHT.leg, heatAt: (p) => ({ traffic: p.x > 50 ? 1.2 : 0, hazard: 0 }) };
    const stops = [stop('quiet', -100, 0), stop('boiling', 100, 0)];
    const discreet = planRoute(start, stops, [exit('home', 0, 0)], 3600, { style: 'stealth', model: boiling, raid: RAID });
    expect(discreet.stops.map((s) => s.id)).toEqual(['quiet']);
    expect(discreet.leftHot).toEqual(['boiling']);
    const direct = planRoute(start, stops, [exit('home', 0, 0)], 3600, { style: 'direct', model: boiling, raid: RAID });
    expect(direct.stops).toHaveLength(2);
    expect(direct.leftHot).toEqual([]);
  });

  it('counts the seconds spent in hot places and when each stop is reached', () => {
    const plan = planRoute(start, both, [exit('home', 0, 0)], 3600, { style: 'direct', model, raid: RAID, elapsed: 30 });
    expect(plan.arrivals).toHaveLength(2);
    expect(plan.arrivals[0]).toBeGreaterThan(30);
    expect(plan.arrivals[1]).toBeGreaterThan(plan.arrivals[0]);
    expect(plan.hot).toBeGreaterThanOrEqual(0);
  });
});
