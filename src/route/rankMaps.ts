// "Which map pays off today?" for the route's goal: on each map, the route in
// the balanced style from a few PMC spawns spread over it (you cannot pick
// your spawn), averaged. Quests count per squadmate too. Planned in the route
// worker, one map after another, so the list fills in without freezing the
// app.
import { useEffect, useMemo, useState } from 'react';
import type { DerivedQuestState } from '../quests/derive';
import type { Poi } from '../poi/types';
import { raidMinutes } from '../map/raidDuration';
import { SUPPORTED_MAP_NAMES } from '../map/mapDefs';
import { canonicalMapId } from '../map/canonicalMap';
import { heatSources } from './heat';
import { itemKinds, lootForMap } from './lootData';
import { buildStops, type Point, type RouteStop, type RouteWho } from './plan';
import { lootStops, scavStops, type RouteGoal, type WeaponKind } from './targets';
import { pmcExits } from './exits';
import { loadRouteData, type RouteData } from './routeData';
import { computeInBackground } from './routeClient';
import { MAX_STOPS } from './useRaidRoute';

/** Spawns tried per map. */
const SPAWNS_PER_MAP = 4;
const MARGIN_S = 90;

export interface MapRank {
  mapId: string;
  name: string;
  /** Average worth of the route (the goal's unit: objectives, roubles, areas, Scav spawns). */
  value: number;
  /** Average minutes. */
  minutes: number;
  /** Average share of the time in hot places, 0–100. */
  hotShare: number;
  /** Quests: average stops per person (the ones each of you needs). */
  byWho: { who: RouteWho; n: number }[];
}

/**
 * Up to `k` points spread over the set: the first, then each time the one
 * farthest from those already taken (deterministic).
 */
export function spreadPoints(points: Point[], k: number): Point[] {
  if (points.length <= k) return [...points];
  const out: Point[] = [points[0]];
  while (out.length < k) {
    let best = points[0];
    let bestD = -1;
    for (const p of points) {
      const d = Math.min(...out.map((q) => Math.hypot(p.x - q.x, p.z - q.z)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    out.push(best);
  }
  return out;
}

/** The goal's stops on one map. */
export function stopsForMap(
  goal: RouteGoal,
  mapId: string,
  pois: Poi[],
  people: { who: RouteWho; state: DerivedQuestState | null | undefined }[],
  data: RouteData | null,
  hideoutNeeds: ReadonlySet<string> | undefined,
  weaponKinds: WeaponKind[],
): RouteStop[] {
  if (goal === 'quests') {
    return buildStops(
      mapId,
      people.map((p) => ({ who: p.who, objectives: p.state?.availableObjectivesByMap[mapId] ?? [] })),
    );
  }
  const me = people.slice(0, 1).map((p) => p.who);
  if (goal === 'scavs') return scavStops(pois, me);
  if (!data?.loot) return [];
  return lootStops(goal, { loot: lootForMap(data.loot, mapId), prices: data.prices, itemKinds: itemKinds(data.loot), hideoutNeeds, weaponKinds }, me);
}

interface Options {
  enabled: boolean;
  goal: RouteGoal;
  /** You first, then the squadmates whose quests count (party on). */
  people: { who: RouteWho; state: DerivedQuestState | null | undefined }[];
  poisByMapId: Record<string, Poi[]>;
  hideoutNeeds?: ReadonlySet<string>;
  weaponKinds: WeaponKind[];
}

export function useMapRanking(o: Options): { ranks: MapRank[] | null; computing: boolean } {
  const [data, setData] = useState<RouteData | null>(null);
  useEffect(() => {
    if (!o.enabled || data) return;
    let alive = true;
    void loadRouteData().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [o.enabled, data]);

  const { enabled, goal, people, poisByMapId, hideoutNeeds, weaponKinds } = o;
  const runKey = useMemo(
    () => `${goal}|${people.map((p) => p.who.id).join(',')}|${Object.keys(poisByMapId).length}|${hideoutNeeds?.size ?? 0}|${weaponKinds.join(',')}|${!!data}`,
    [goal, people, poisByMapId, hideoutNeeds, weaponKinds, data],
  );
  const [result, setResult] = useState<{ key: string; ranks: MapRank[]; done: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const maps = Object.keys(SUPPORTED_MAP_NAMES).filter((id) => (poisByMapId[id] ?? []).length > 0);
    void (async () => {
      const ranks: MapRank[] = [];
      for (const mapId of maps) {
        if (!alive) return;
        const pois = poisByMapId[mapId] ?? [];
        const stops = stopsForMap(goal, mapId, pois, people, data, hideoutNeeds, weaponKinds);
        const exits = pmcExits(pois);
        const spawns = spreadPoints(
          pois.filter((p) => p.category === 'spawn' && (p.subtype === 'pmc' || p.subtype === 'all')).map((p) => ({ x: p.position.x, z: p.position.z })),
          SPAWNS_PER_MAP,
        );
        if (stops.length === 0 || spawns.length === 0) continue;
        const raid = (raidMinutes(mapId) ?? 40) * 60;
        const containers = data?.loot ? lootForMap(data.loot, mapId).containers : [];
        const sources = heatSources(pois, containers);
        const known: Point[] = [
          ...pois.filter((p) => p.category !== 'custom').map((p) => ({ x: p.position.x, z: p.position.z })),
          ...stops.map((s) => ({ x: s.x, z: s.z })),
        ];
        const byId = new Map(stops.map((s) => [s.id, s]));
        let value = 0;
        let seconds = 0;
        let hot = 0;
        const perWho = new Map<string, number>();
        for (const start of spawns) {
          try {
            const [plan] = await computeInBackground({
              terrainKey: `rank|${mapId}|${raid}|${sources.length}|${known.length}`,
              sources,
              known,
              start,
              stops: stops.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, work: s.work, value: s.value ?? 1 })),
              exits,
              budget: raid - MARGIN_S,
              elapsed: 0,
              raid,
              preferCar: false,
              maxStops: MAX_STOPS[goal],
              styles: ['balanced'],
            });
            value += goal === 'quests' ? plan.stopIds.reduce((n, id) => n + Math.max(1, byId.get(id)?.items.length ?? 1), 0) : plan.value;
            seconds += plan.total;
            hot += plan.total > 0 ? Math.min(plan.hot, plan.total) / plan.total : 0;
            // Per person: the stops of the route they need.
            for (const id of plan.stopIds) for (const w of byId.get(id)?.who ?? []) perWho.set(w.id, (perWho.get(w.id) ?? 0) + 1);
          } catch {
            /* this spawn could not be planned: skip it */
          }
        }
        const n = spawns.length;
        ranks.push({
          mapId,
          name: SUPPORTED_MAP_NAMES[canonicalMapId(mapId)] ?? mapId,
          value: value / n,
          minutes: seconds / n / 60,
          hotShare: Math.round((100 * hot) / n),
          byWho: people.map((p) => ({ who: p.who, n: (perWho.get(p.who.id) ?? 0) / n })),
        });
        if (alive) setResult({ key: runKey, ranks: [...ranks].sort((a, b) => b.value - a.value), done: false });
      }
      if (alive) setResult({ key: runKey, ranks: [...ranks].sort((a, b) => b.value - a.value), done: true });
    })();
    return () => {
      alive = false;
    };
    // people/poisByMapId changes are summed up in runKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, runKey]);

  const current = result?.key === runKey ? result : null;
  return { ranks: current?.ranks ?? null, computing: enabled && !current?.done };
}
