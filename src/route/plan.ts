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
import { HOT, VERY_HOT, phaseOf, type RaidPhase } from './heat';

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
  /** What the stop is worth to the raid's goal (a quest stop: 1). */
  value?: number;
  /** A loot or Scav stop: what is there (quest stops have their objectives in `items`). */
  info?: StopInfo;
}

/** What a loot or Scav stop holds, for the list and the map. */
export interface StopInfo {
  kind: 'loot' | 'scavs';
  /** Containers by kind ("safe": 2, …). */
  containers?: Record<string, number>;
  /** Loose-loot spots. */
  loose?: number;
  /** The items worth the most to the goal that can be there (ids). */
  items?: string[];
  /** Scav spawn points (the Scav goal). */
  spawns?: number;
  /** A locked door close by: the key's name. */
  key?: string;
  /** The named place it is in or near ("Dorms", "Crackhouse"…). */
  place?: string;
  /** Estimated roubles there (loot). */
  roubles?: number;
  /** A boss can spawn there (Scav goal). */
  boss?: boolean;
}

export interface RouteExit extends Point {
  id: string;
  label: string;
  /** Extra seconds counted for exits with a condition (switch, payment, car). */
  penalty: number;
  note?: string;
  /** A paid car exit (Fence reputation). */
  car?: boolean;
  /** What it costs to use, in roubles. */
  price?: number;
}

export interface RoutePlan {
  style: RouteStyle;
  stops: RouteStop[];
  exit: RouteExit | null;
  /** Estimated seconds for each leg: start→stop1, stop1→stop2, …, last→exit. */
  legs: number[];
  /** Estimated total seconds (walking + work at the stops + the exit's condition). */
  total: number;
  /** Stops that did not fit in the time. */
  left: RouteStop[];
  /** Of those, the ones the discreet style left out because they were too hot (ids). */
  leftHot: string[];
  /** What the route is worth to the goal (quests: how many stops). */
  value: number;
  /** Seconds spent in hot places. */
  hot: number;
  /** Seconds into the raid when each stop is reached. */
  arrivals: number[];
  /** How hot each stop is when it is reached. */
  stopHeat: number[];
  /** The way drawn for each leg, when it bends (not straight). */
  paths?: Point[][];
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

/** The four ways of walking the same raid. */
export type RouteStyle = 'direct' | 'balanced' | 'stealth' | 'aggressive';
export const ROUTE_STYLES: readonly RouteStyle[] = ['direct', 'balanced', 'stealth', 'aggressive'];

/** What walking a leg means. */
export interface LegEval {
  /** Seconds. */
  s: number;
  /** Heat × seconds met on the way where players go. */
  traffic: number;
  /** Heat × seconds met on the way from fixed dangers. */
  hazard: number;
  /** Seconds spent in hot places. */
  hot: number;
}

/** How legs and places are judged in each phase of the raid. */
export interface LegModel {
  leg(a: Point, b: Point, phase: RaidPhase): LegEval;
  /** How hot a place is in a phase: where players go, and fixed dangers. */
  heatAt(p: Point, phase: RaidPhase): { traffic: number; hazard: number };
}

/** Straight lines and no heat: the route as it always was. */
export const STRAIGHT: LegModel = {
  leg: (a, b) => ({ s: travelSeconds(a, b), traffic: 0, hazard: 0, hot: 0 }),
  heatAt: () => ({ traffic: 0, hazard: 0 }),
};

/**
 * How much a second in heat counts against a style (negative: for it). The
 * aggressive style is drawn to where players go and still keeps out of mines
 * and sniper sights.
 */
export const STYLE_WEIGHTS: Record<RouteStyle, { traffic: number; hazard: number }> = {
  direct: { traffic: 0, hazard: 0 },
  balanced: { traffic: 1, hazard: 1 },
  stealth: { traffic: 4, hazard: 4 },
  aggressive: { traffic: -0.8, hazard: 4 },
};

/** Ending at a car exit (Fence reputation) is worth up to this many seconds of extra walking. */
export const CAR_BONUS_S = 240;
const DEFAULT_RAID_S = 40 * 60;

export interface PlanOptions {
  style?: RouteStyle;
  /** Heat and leg costs; straight lines without heat if not given. */
  model?: LegModel;
  /** Seconds into the raid when the route starts (which phase each leg is in). */
  elapsed?: number;
  /** The raid's length, seconds. */
  raid?: number;
  /** End at a car exit when it fits in the time. */
  preferCar?: boolean;
  /** At most this many stops (a loot run fills the bag long before the time runs out). */
  maxStops?: number;
}

interface Ctx {
  start: Point;
  stops: RouteStop[];
  exits: RouteExit[];
  model: LegModel;
  w: { traffic: number; hazard: number };
  elapsed: number;
  raid: number;
  preferCar: boolean;
  /** The discreet style leaves out stops that are very hot when it would get there. */
  skipHot: boolean;
  budget: number;
}

/** Where a route stands after walking part of it. */
interface Walk {
  /** Seconds into the raid. */
  t: number;
  /** Seconds walked and worked since the start. */
  time: number;
  /** What the style minimises. */
  obj: number;
  /** Seconds in hot places. */
  hot: number;
  at: Point;
}

/** A leg's cost the style's way (never below a third of its time: walking is never free). */
function legObj(ctx: Ctx, e: LegEval): number {
  return Math.max(0.3 * e.s, e.s + ctx.w.traffic * e.traffic + ctx.w.hazard * e.hazard);
}

/** Walking to a stop and doing its work there. */
function step(ctx: Ctx, w: Walk, s: RouteStop): Walk {
  const e = ctx.model.leg(w.at, s, phaseOf(w.t, ctx.raid));
  const arrive = w.t + e.s;
  const h = ctx.model.heatAt(s, phaseOf(arrive, ctx.raid));
  const workObj = Math.max(0.3 * s.work, s.work * (1 + ctx.w.traffic * h.traffic + ctx.w.hazard * h.hazard));
  return {
    t: arrive + s.work,
    time: w.time + e.s + s.work,
    obj: w.obj + legObj(ctx, e) + workObj,
    hot: w.hot + e.hot + (h.traffic + h.hazard >= HOT ? s.work : 0),
    at: s,
  };
}

interface Finish {
  exit: RouteExit | null;
  /** Seconds of the last leg (to the exit). */
  leg: number;
  time: number;
  obj: number;
  hot: number;
}

/** The exit to end at: the best the style's way among those that fit in the time (else the quickest). */
function finish(ctx: Ctx, w: Walk): Finish {
  if (ctx.exits.length === 0) return { exit: null, leg: 0, time: w.time, obj: w.obj, hot: w.hot };
  const phase = phaseOf(w.t, ctx.raid);
  let best: Finish | null = null;
  let quickest: Finish | null = null;
  for (const exit of ctx.exits) {
    const e = ctx.model.leg(w.at, exit, phase);
    const time = w.time + e.s + exit.penalty;
    const obj = w.obj + legObj(ctx, e) + exit.penalty - (ctx.preferCar && exit.car ? CAR_BONUS_S : 0);
    const f: Finish = { exit, leg: e.s, time, obj, hot: w.hot + e.hot };
    if (time <= ctx.budget + 1e-9 && (!best || obj < best.obj - 1e-9)) best = f;
    if (!quickest || time < quickest.time - 1e-9) quickest = f;
  }
  return best ?? quickest!;
}

function startWalk(ctx: Ctx): Walk {
  return { t: ctx.elapsed, time: 0, obj: 0, hot: 0, at: ctx.start };
}

function evaluate(ctx: Ctx, order: number[]): Finish {
  let w = startWalk(ctx);
  for (const i of order) w = step(ctx, w, ctx.stops[i]);
  return finish(ctx, w);
}

/** The exit quickest to reach from `from` (its condition's extra time counted), and the seconds. */
export function nearestExit(from: Point, exits: RouteExit[]): { exit: RouteExit | null; s: number } {
  let exit: RouteExit | null = null;
  let s = exits.length ? Infinity : 0;
  for (const e of exits) {
    const v = travelSeconds(from, e) + e.penalty;
    if (v < s) {
      s = v;
      exit = e;
    }
  }
  return { exit, s };
}

/** Untangles the order (reverses stretches while that makes the route better and it still fits). */
function twoOpt(ctx: Ctx, order: number[]): number[] {
  let best = order;
  let bestEnd = evaluate(ctx, best);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const next = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const end = evaluate(ctx, next);
        if (end.obj + 1e-6 < bestEnd.obj && end.time <= ctx.budget + 1e-9) {
          best = next;
          bestEnd = end;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Adds stops while the route still fits in the time: each time the one worth
 * the most for what it costs (its value / the extra cost), wherever it fits
 * best. Stops the discreet style found too hot are noted in `tooHot`.
 */
function insertAll(ctx: Ctx, order: number[], maxStops: number, tooHot: Set<number>): number[] {
  const route = [...order];
  const used = new Set(route);
  for (;;) {
    if (route.length >= maxStops) return route;
    // Where the route stands after each of its stops, computed once per round.
    const pre: Walk[] = [startWalk(ctx)];
    for (const i of route) pre.push(step(ctx, pre[pre.length - 1], ctx.stops[i]));
    const current = finish(ctx, pre[route.length]).obj;
    let pick: { stop: number; at: number; score: number; delta: number } | null = null;
    for (let s = 0; s < ctx.stops.length; s++) {
      if (used.has(s)) continue;
      const stop = ctx.stops[s];
      const value = stop.value ?? 1;
      for (let at = 0; at <= route.length; at++) {
        let w = step(ctx, pre[at], stop);
        if (ctx.skipHot) {
          const h = ctx.model.heatAt(stop, phaseOf(w.t - stop.work, ctx.raid));
          if (h.traffic + h.hazard >= VERY_HOT) {
            tooHot.add(s);
            continue;
          }
        }
        for (let k = at; k < route.length; k++) w = step(ctx, w, ctx.stops[route[k]]);
        const end = finish(ctx, w);
        if (end.time > ctx.budget + 1e-9) continue;
        const delta = end.obj - current;
        const score = value / Math.max(1, delta);
        if (!pick || score > pick.score * (1 + 1e-9) || (score >= pick.score * (1 - 1e-9) && delta < pick.delta - 1e-9)) {
          pick = { stop: s, at, score, delta };
        }
      }
    }
    if (!pick) return route;
    route.splice(pick.at, 0, pick.stop);
    used.add(pick.stop);
  }
}

/**
 * The route from `start` through the stops worth the most that fit in
 * `budget` seconds, ending at one of `exits` (none: the route just ends).
 * Without options: straight lines, no heat, every stop worth the same.
 */
export function planRoute(start: Point, stops: RouteStop[], exits: RouteExit[], budget: number, opts: PlanOptions = {}): RoutePlan {
  const style = opts.style ?? 'direct';
  const ctx: Ctx = {
    start,
    stops,
    exits,
    model: opts.model ?? STRAIGHT,
    w: STYLE_WEIGHTS[style],
    elapsed: opts.elapsed ?? 0,
    raid: opts.raid ?? DEFAULT_RAID_S,
    preferCar: opts.preferCar === true,
    skipHot: style === 'stealth',
    budget,
  };
  const tooHot = new Set<number>();
  let order: number[] = [];
  for (let round = 0; round < 4; round++) {
    const grown = insertAll(ctx, order, opts.maxStops ?? Infinity, tooHot);
    const tidy = twoOpt(ctx, grown);
    const done = tidy.length === order.length && tidy.every((v, i) => v === order[i]);
    order = tidy;
    if (done) break;
  }

  // Walk the chosen order once more for what the list and the map show.
  const picked = order.map((i) => stops[i]);
  const legs: number[] = [];
  const arrivals: number[] = [];
  const stopHeat: number[] = [];
  let w = startWalk(ctx);
  for (const s of picked) {
    const e = ctx.model.leg(w.at, s, phaseOf(w.t, ctx.raid));
    legs.push(e.s);
    arrivals.push(w.t + e.s);
    const h = ctx.model.heatAt(s, phaseOf(w.t + e.s, ctx.raid));
    stopHeat.push(h.traffic + h.hazard);
    w = step(ctx, w, s);
  }
  const end = finish(ctx, w);
  if (end.exit) legs.push(end.leg);
  const used = new Set(order);
  return {
    style,
    stops: picked,
    exit: end.exit,
    legs,
    total: end.time,
    left: stops.filter((_, i) => !used.has(i)),
    leftHot: stops.filter((_, i) => !used.has(i) && tooHot.has(i)).map((s) => s.id),
    value: picked.reduce((sum, s) => sum + (s.value ?? 1), 0),
    hot: end.hot,
    arrivals,
    stopHeat,
  };
}

/** The middle of the squad's positions: where a squad that spawned together starts. */
export function centroid(points: Point[]): Point | null {
  if (points.length === 0) return null;
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const z = points.reduce((s, p) => s + p.z, 0) / points.length;
  return { x, z };
}

export type RouteStartSource = 'picked' | 'self' | 'party';

/**
 * Where the route leaves from: always where you are now, your latest
 * position. A spawn picked on the map stands in for it until a newer position
 * comes; with neither, the party's (they are likely next to you).
 */
export function routeStart(
  own: (Point & { ts: number }) | null,
  picked: { at: Point; ts: number } | null,
  party: Point[],
): { point: Point; source: RouteStartSource; ts: number | null } | null {
  if (own && (!picked || own.ts > picked.ts)) return { point: { x: own.x, z: own.z }, source: 'self', ts: own.ts };
  if (picked) return { point: picked.at, source: 'picked', ts: picked.ts };
  const mid = centroid(party);
  return mid ? { point: mid, source: 'party', ts: null } : null;
}
