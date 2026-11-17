// Plans the raid route in every style at once, for the comparison: picks the
// stops and their order (plan.ts, legs judged as straight lines with the heat
// met on them, in the phase of the raid each happens in), then draws each leg
// of the non-direct styles the way that style walks (paths.ts). If walking
// those ways no longer fits in the time, the stop worth the least goes and the
// route is planned again.
//
// Pure and self-contained, so it runs in a Web Worker (routeWorker.ts): what
// goes in and out is plain data, stops by id. The map's grid and heat fields
// are kept between calls, so a new screenshot only re-plans.
import { HOT, heatAt, isHazard, isTraffic, phaseOf, phaseTime, PHASES, type HeatSource } from './heat';
import { buildGrid, cellOf, fieldsOf, shortestWay, straightCost, type Fields, type Grid, type Weighing } from './paths';
import { DETOUR, SPEED, planRoute, type LegEval, type LegModel, type Point, type RouteExit, type RoutePlan, type RouteStop, type RouteStyle } from './plan';

/** How each style walks a leg (the direct one walks straight). */
export const STYLE_WEIGHING: Record<Exclude<RouteStyle, 'direct'>, Weighing> = {
  balanced: { avoid: 'all', lambda: 1, pull: 0 },
  stealth: { avoid: 'all', lambda: 4, pull: 0 },
  aggressive: { avoid: 'hazard', lambda: 4, pull: 5 },
};

/** A grid way is already a little longer than the straight line it replaces. */
const GRID_DETOUR = DETOUR / 1.04;

/** A stop as the worker needs it. */
export interface StopLite {
  id: string;
  x: number;
  y: number;
  z: number;
  work: number;
  value: number;
}

export interface ComputeInput {
  /** The map and its heat: when it changes, the grid and fields are rebuilt. */
  terrainKey: string;
  sources: HeatSource[];
  /** Points known to be inside the map (what the grid counts as walkable). */
  known: Point[];
  start: Point;
  stops: StopLite[];
  exits: RouteExit[];
  budget: number;
  /** Seconds into the raid now. */
  elapsed: number;
  /** The raid's length, seconds. */
  raid: number;
  preferCar: boolean;
  maxStops?: number;
  styles: RouteStyle[];
}

/** A plan with its stops and exit by id. */
export interface PlanLite extends Omit<RoutePlan, 'stops' | 'exit' | 'left'> {
  stopIds: string[];
  exitId: string | null;
  leftIds: string[];
}

interface Terrain {
  grid: Grid;
  /** Per phase of the raid. */
  fields: Fields[];
}

const terrains = new Map<string, Terrain>();
const MAX_TERRAINS = 4;

/** The map's grid and its heat in each phase (kept for the next call). */
export function terrainFor(key: string, sources: HeatSource[], known: Point[], raid: number): Terrain {
  const hit = terrains.get(key);
  if (hit) return hit;
  const grid = buildGrid(known);
  const fields = PHASES.map((phase) => {
    const t = phaseTime(phase, raid);
    return fieldsOf(
      grid,
      (p) => heatAt(sources, p, t, raid, isTraffic),
      (p) => heatAt(sources, p, t, raid, isHazard),
    );
  });
  const terrain = { grid, fields };
  if (terrains.size >= MAX_TERRAINS) terrains.delete(terrains.keys().next().value!);
  terrains.set(key, terrain);
  return terrain;
}

/** Straight legs with the heat met on them, remembered per pair and phase. */
export function legModel(t: Terrain): LegModel {
  const memo = new Map<Point, Map<Point, (LegEval | undefined)[]>>();
  const k = DETOUR / SPEED;
  return {
    leg(a, b, phase) {
      let row = memo.get(a);
      if (!row) memo.set(a, (row = new Map()));
      let cell = row.get(b);
      if (!cell) row.set(b, (cell = []));
      let e = cell[phase];
      if (!e) {
        const f = t.fields[phase];
        const all = straightCost(t.grid, f.all, a, b);
        e = {
          s: all.len * k,
          traffic: straightCost(t.grid, f.traffic, a, b).heat * k,
          hazard: straightCost(t.grid, f.hazard, a, b).heat * k,
          hot: all.hot * k,
        };
        cell[phase] = e;
      }
      return e;
    },
    heatAt(p, phase) {
      const f = t.fields[phase];
      const c = cellOf(t.grid, p);
      return { traffic: f.traffic[c], hazard: f.hazard[c] };
    },
  };
}

/** The legs walked the style's way: their seconds, ways and the hot time. */
function draw(t: Terrain, plan: RoutePlan, start: Point, input: ComputeInput): RoutePlan {
  if (plan.style === 'direct') return plan;
  const weighing = STYLE_WEIGHING[plan.style];
  const pts: Point[] = [start, ...plan.stops, ...(plan.exit ? [plan.exit] : [])];
  const legs: number[] = [];
  const paths: Point[][] = [];
  const arrivals: number[] = [];
  let clock = input.elapsed;
  let total = 0;
  let hot = 0;
  for (let i = 1; i < pts.length; i++) {
    const way = shortestWay(t.grid, t.fields[phaseOf(clock, input.raid)], weighing, pts[i - 1], pts[i]);
    const s = (way.len * GRID_DETOUR) / SPEED;
    legs.push(s);
    paths.push(way.pts);
    hot += (way.hot * GRID_DETOUR) / SPEED;
    clock += s;
    total += s;
    const stop = plan.stops[i - 1] as RouteStop | undefined;
    if (stop && i <= plan.stops.length) {
      arrivals.push(clock);
      clock += stop.work;
      total += stop.work;
      if ((plan.stopHeat[i - 1] ?? 0) >= HOT) hot += stop.work;
    }
  }
  if (plan.exit) total += plan.exit.penalty;
  return { ...plan, legs, paths, arrivals, hot, total };
}

function lite(plan: RoutePlan, dropped: string[]): PlanLite {
  const { stops, exit, left, ...rest } = plan;
  return { ...rest, stopIds: stops.map((s) => s.id), exitId: exit?.id ?? null, leftIds: [...left.map((s) => s.id), ...dropped] };
}

/** One style's route: planned, drawn, and trimmed until it fits in the time. */
function planStyle(t: Terrain, model: LegModel, input: ComputeInput, style: RouteStyle): PlanLite {
  let stops: RouteStop[] = input.stops.map((s) => ({ ...s, items: [], who: [] }));
  const dropped: string[] = [];
  for (let tries = 0; ; tries++) {
    const planned = planRoute(input.start, stops, input.exits, input.budget, {
      style,
      model,
      elapsed: input.elapsed,
      raid: input.raid,
      preferCar: input.preferCar,
      maxStops: input.maxStops,
    });
    const drawn = draw(t, planned, input.start, input);
    if (drawn.total <= input.budget + 1 || drawn.stops.length === 0 || tries >= 6) return lite(drawn, dropped);
    // The ways around made it too long: leave out the stop worth the least.
    const worst = [...drawn.stops].sort((a, b) => (a.value ?? 1) - (b.value ?? 1))[0];
    dropped.push(worst.id);
    stops = stops.filter((s) => s.id !== worst.id);
  }
}

export function computeRoutes(input: ComputeInput): PlanLite[] {
  const terrain = terrainFor(input.terrainKey, input.sources, input.known, input.raid);
  const model = legModel(terrain);
  return input.styles.map((style) => planStyle(terrain, model, input, style));
}

/** Turns plans by id back into plans with the caller's own stop and exit objects. */
export function rehydrate(p: PlanLite, stops: Map<string, RouteStop>, exits: Map<string, RouteExit>): RoutePlan {
  const { stopIds, exitId, leftIds, ...rest } = p;
  return {
    ...rest,
    stops: stopIds.map((id) => stops.get(id)).filter((s): s is RouteStop => !!s),
    exit: exitId ? exits.get(exitId) ?? null : null,
    left: leftIds.map((id) => stops.get(id)).filter((s): s is RouteStop => !!s),
  };
}
