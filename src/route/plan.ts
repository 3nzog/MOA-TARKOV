// The raid route: from where you spawned, the order of quest objectives on
// this map that gets the most of them done before the raid ends, finishing at
// one of your exits. With a squad, everyone's objectives count; one spot two
// players both need is a single stop.
//
// Distances are straight lines in game meters (x, z), stretched by DETOUR for
// walls, buildings and taking cover. There is no walkable-path data, so times
// are estimates and the budget keeps a margin.
//
// The search is a "cheapest insertion" for the orienteering problem: keep
// adding the stop that costs the least extra time wherever it fits best,
// while the route still ends at an exit inside the time left; then untangle
// the order (2-opt) and try to fit more. Fast for the 5–60 stops of a map and
// deterministic, so two squadmates with the same data see the same route.
import type { TarkovTask, TaskObjective } from '../api/types';
import { canonicalMapId } from '../map/canonicalMap';

export interface Point {
  x: number;
  z: number;
}

/** Who needs a stop: a squad member (or you). */
export interface RouteWho {
  id: string;
  name: string;
  color: string;
}

export interface RouteObjective {
  task: TarkovTask;
  objective: TaskObjective;
}

export interface RouteStop extends Point {
  /** Stable id: the objective's (merged objectives keep the first). */
  id: string;
  /** Floor height, for the floor switcher. */
  y: number;
  items: RouteObjective[];
  who: RouteWho[];
  /** Seconds spent there (marking, planting, searching…). */
  work: number;
}

export interface RouteExit extends Point {
  id: string;
  label: string;
  /** Extra seconds counted for exits with a condition (switch, payment, car). */
  penalty: number;
  note?: string;
}

export interface RoutePlan {
  stops: RouteStop[];
  exit: RouteExit | null;
  /** Estimated seconds for each leg: start→stop1, stop1→stop2, …, last→exit. */
  legs: number[];
  /** Estimated total seconds (walking + work at the stops). */
  total: number;
  /** Stops that did not fit in the time. */
  left: RouteStop[];
}

/** Effective speed in m/s along the stretched straight line. */
export const SPEED = 3.2;
/** Straight line × this ≈ the real way around things. */
export const DETOUR = 1.3;
/** Objectives this close together are one stop. */
const MERGE_M = 15;

const WORK_S: Record<string, number> = {
  visit: 10,
  mark: 30,
  plantItem: 40,
  plantQuestItem: 40,
  findQuestItem: 30,
  useItem: 30,
  shoot: 90,
};

export function travelSeconds(a: Point, b: Point): number {
  return (Math.hypot(a.x - b.x, a.z - b.z) * DETOUR) / SPEED;
}

/**
 * Where an objective is on this map: a zone with a position, else the first
 * possible location (the same rule the map's quest pins use).
 */
export function objectivePosition(objective: TaskObjective, mapId: string): { x: number; y: number; z: number } | null {
  const target = canonicalMapId(mapId);
  const onMap = (id: string | undefined) => !!id && canonicalMapId(id) === target;
  const zone = objective.zones?.find((z) => onMap(z.map?.id) && z.position);
  if (zone?.position) return { ...zone.position };
  const loc = objective.possibleLocations?.find((l) => onMap(l.map.id) && l.positions && l.positions.length > 0);
  if (loc?.positions?.[0]) return { ...loc.positions[0] };
  return null;
}

/**
 * The stops: each positioned objective once, objectives a few meters apart
 * merged, with everyone who needs them. Sorted by id so every squadmate's app
 * starts from the same list.
 */
export function buildStops(
  mapId: string,
  lists: { who: RouteWho; objectives: RouteObjective[] }[],
): RouteStop[] {
  const byObjective = new Map<string, RouteStop>();
  for (const { who, objectives } of lists) {
    for (const item of objectives) {
      const pos = objectivePosition(item.objective, mapId);
      if (!pos) continue;
      const hit = byObjective.get(item.objective.id);
      if (hit) {
        if (!hit.who.some((w) => w.id === who.id)) hit.who.push(who);
        continue;
      }
      byObjective.set(item.objective.id, {
        id: item.objective.id,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        items: [item],
        who: [who],
        work: WORK_S[item.objective.type] ?? 30,
      });
    }
  }
  const single = [...byObjective.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: RouteStop[] = [];
  for (const s of single) {
    const near = out.find((o) => Math.hypot(o.x - s.x, o.z - s.z) <= MERGE_M);
    if (!near) {
      out.push({ ...s, items: [...s.items], who: [...s.who] });
      continue;
    }
    near.items.push(...s.items);
    for (const w of s.who) if (!near.who.some((x) => x.id === w.id)) near.who.push(w);
    // Two things in one place: the longer job plus a bit for the other.
    near.work = Math.max(near.work, s.work) + Math.min(near.work, s.work) / 2;
  }
  return out;
}

interface Ctx {
  start: Point;
  stops: RouteStop[];
  exits: RouteExit[];
}

/** Best exit after `last`, and the seconds to it. Null exits: no exit leg. */
function bestExit(ctx: Ctx, last: Point): { exit: RouteExit | null; s: number } {
  let exit: RouteExit | null = null;
  let s = ctx.exits.length ? Infinity : 0;
  for (const e of ctx.exits) {
    const v = travelSeconds(last, e) + e.penalty;
    if (v < s) {
      s = v;
      exit = e;
    }
  }
  return { exit, s };
}

function routeCost(ctx: Ctx, order: number[]): number {
  let t = 0;
  let at: Point = ctx.start;
  for (const i of order) {
    const s = ctx.stops[i];
    t += travelSeconds(at, s) + s.work;
    at = s;
  }
  return t + bestExit(ctx, at).s;
}

/** Untangles the order (reverse segments while that shortens the route). */
function twoOpt(ctx: Ctx, order: number[]): number[] {
  let best = order;
  let bestCost = routeCost(ctx, best);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const next = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const c = routeCost(ctx, next);
        if (c + 1e-6 < bestCost) {
          best = next;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** Adds stops, cheapest first, while the route still fits in `budget` seconds. */
function insertAll(ctx: Ctx, order: number[], budget: number): number[] {
  const route = [...order];
  const used = new Set(route);
  // Exit leg from each stop and from the start, computed once.
  const exitFrom = ctx.stops.map((s) => bestExit(ctx, s).s);
  const exitFromStart = bestExit(ctx, ctx.start).s;
  const pointAt = (i: number): Point => (i < 0 ? ctx.start : ctx.stops[route[i]]);
  const exitAt = (i: number): number => (i < 0 ? exitFromStart : exitFrom[route[i]]);
  for (;;) {
    const current = routeCost(ctx, route);
    let pick: { stop: number; at: number; delta: number } | null = null;
    for (let s = 0; s < ctx.stops.length; s++) {
      if (used.has(s)) continue;
      const stop = ctx.stops[s];
      for (let at = 0; at <= route.length; at++) {
        const prev = pointAt(at - 1);
        const delta =
          at < route.length
            ? travelSeconds(prev, stop) + stop.work + travelSeconds(stop, pointAt(at)) - travelSeconds(prev, pointAt(at))
            : travelSeconds(prev, stop) + stop.work + exitFrom[s] - exitAt(at - 1);
        if (current + delta > budget + 1e-9) continue;
        if (!pick || delta < pick.delta - 1e-9) pick = { stop: s, at, delta };
      }
    }
    if (!pick) return route;
    route.splice(pick.at, 0, pick.stop);
    used.add(pick.stop);
  }
}

/**
 * The route from `start` through as many `stops` as fit in `budget` seconds,
 * ending at the nearest of `exits` (none: the route just ends).
 */
export function planRoute(start: Point, stops: RouteStop[], exits: RouteExit[], budget: number): RoutePlan {
  const ctx: Ctx = { start, stops, exits };
  let order: number[] = [];
  for (let round = 0; round < 4; round++) {
    const grown = insertAll(ctx, order, budget);
    const tidy = twoOpt(ctx, grown);
    const done = tidy.length === order.length && tidy.every((v, i) => v === order[i]);
    order = tidy;
    if (done) break;
  }
  const picked = order.map((i) => stops[i]);
  const legs: number[] = [];
  let at: Point = start;
  for (const s of picked) {
    legs.push(travelSeconds(at, s));
    at = s;
  }
  const { exit } = bestExit(ctx, at);
  if (exit) legs.push(travelSeconds(at, exit));
  const used = new Set(order);
  return {
    stops: picked,
    exit,
    legs,
    total: routeCost(ctx, order),
    left: stops.filter((_, i) => !used.has(i)),
  };
}

/** The middle of the squad's positions: where a squad that spawned together starts. */
export function centroid(points: Point[]): Point | null {
  if (points.length === 0) return null;
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const z = points.reduce((s, p) => s + p.z, 0) / points.length;
  return { x, z };
}
