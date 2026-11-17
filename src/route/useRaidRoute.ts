// The raid route for the map on screen: where it starts (where you are now,
// from your latest screenshot; a spawn picked on the map until one comes; or
// the party's position), the stops for the goal (your objectives, plus your
// squadmates' with "party" on; or loot areas; or where Scavs spawn), the exits
// of your side and the time left. Planned in all four styles at once, off the
// main thread, and again at every new position, so it adjusts as you go;
// stops someone of the party walked up to drop out on their own.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DerivedQuestState } from '../quests/derive';
import type { Poi } from '../poi/types';
import type { ExitTier } from '../poi/exitTier';
import type { PlayerPos } from '../app/useGameEvents';
import { raidMinutes } from '../map/raidDuration';
import { canonicalMapId } from '../map/canonicalMap';
import { hexForColorId } from '../../shared/squadProtocol';
import { heatAt, heatSources, hotReason, phaseOf, HOT, type HeatKind, type HeatSource, type RaidPhase } from './heat';
import { itemKinds, lootForMap } from './lootData';
import {
  buildStops,
  DETOUR,
  nearestExit,
  routeStart,
  ROUTE_STYLES,
  SPEED,
  type Point,
  type RouteExit,
  type RoutePlan,
  type RouteStartSource,
  type RouteStop,
  type RouteStyle,
  type RouteWho,
} from './plan';
import { lootStops, scavStops, type LootContext, type RouteGoal, type WeaponKind } from './targets';
import { loadRouteData, type RouteData } from './routeData';
import { setRoutePrefs, useRoutePrefs } from './routePrefs';
import { exitOf, factionOf } from './exits';
import { computeInBackground } from './routeClient';
import { rehydrate, type ComputeInput } from './compute';

/** Walking up to a stop this close counts as done. */
const REACHED_M = 20;
/** Kept out of the budget for the unknowns (fights, looting, the way back). */
const MARGIN_S = 90;
/** Outside a raid, a position this old is not where you are any more. */
const STALE_OUT_OF_RAID_MS = 15 * 60_000;
/** A loot run fills the bag long before the time runs out; Scav hunts tire too. */
export const MAX_STOPS: Record<RouteGoal, number | undefined> = { quests: undefined, money: 10, hideout: 10, weapons: 10, scavs: 8 };
/** "Loot on the way": worth at most this many extra seconds of walking. */
const ON_WAY_S = 25;
const ON_WAY_MAX = 12;

/** The squad as the route needs it (a subset of the squad context). */
export interface RouteSquad {
  inSquad: boolean;
  selfId: string | null;
  members: { id: string; name: string; colorId: string }[];
  positions: Record<string, { payload: { mapId: string; x: number; z: number }; ts: number }>;
  hiddenQuests: Record<string, boolean>;
}

export type { RouteStartSource };

/** Where you are, when that is a hot place right now. */
export interface SelfHeat {
  level: number;
  kind: HeatKind;
  /** Which source (so a sound plays once per place). */
  key: string;
}

export interface RaidRoute {
  on: boolean;
  setOn: (on: boolean) => void;
  party: boolean;
  setParty: (on: boolean) => void;
  goal: RouteGoal;
  setGoal: (g: RouteGoal) => void;
  weaponKinds: WeaponKind[];
  setWeaponKinds: (k: WeaponKind[]) => void;
  style: RouteStyle;
  setStyle: (s: RouteStyle) => void;
  /** Squadmates whose objectives are in (with party on). */
  mates: RouteWho[];
  /** The route in each style (the comparison); `plan` is the chosen one's. */
  plans: Partial<Record<RouteStyle, RoutePlan>>;
  plan: RoutePlan | null;
  /** Planning (the first time for this map and goal). */
  computing: boolean;
  start: Point | null;
  startSource: RouteStartSource | null;
  /** Minutes since the start position was taken (your screenshot or the pick); null for the party's. */
  startAge: number | null;
  /** Seconds the plan may use. */
  budget: number;
  /** Seconds into the raid now (0 when planning outside one) and the raid's length. */
  elapsed: number;
  raidSeconds: number;
  /** Clicking a spawn on the map sets the start. */
  picking: boolean;
  setPicking: (on: boolean) => void;
  pickStart: (p: Point) => void;
  spawns: Poi[];
  skip: (stopId: string) => void;
  /** Stops reached or skipped this raid (they come back with "reset"). */
  doneCount: number;
  reset: () => void;
  /** Seconds from your latest position this raid to the nearest exit of your side (null: no position). */
  toExit: number | null;
  /** Hot zones: shown or not, their sources, and the phase shown (now in a raid; chosen outside one). */
  heat: {
    on: boolean;
    setOn: (on: boolean) => void;
    sources: HeatSource[];
    known: Point[];
    phase: RaidPhase;
    setPreviewPhase: (p: RaidPhase) => void;
  };
  /** Quests goal: loot worth a short detour from the chosen route. */
  lootOnWay: boolean;
  setLootOnWay: (on: boolean) => void;
  onWay: { stop: RouteStop; extra: number }[];
  preferCar: boolean;
  setPreferCar: (on: boolean) => void;
  /** Where you are, when it is hot right now (in a raid). */
  selfHeat: SelfHeat | null;
  /** The loot data is loaded (loot goals plan once it is). */
  ready: boolean;
}

interface Options {
  mapId: string | null;
  own: DerivedQuestState | null;
  mateStates: Record<string, DerivedQuestState>;
  squad: RouteSquad;
  selfName: string;
  selfColor: string;
  playerPos: PlayerPos | null;
  raid: { startedAt: number; endsAt: number | null } | null;
  pois: Poi[];
  tierOf: (p: Poi) => ExitTier | null;
  /** Item ids the hideout still needs (the hideout goal). */
  hideoutNeeds?: ReadonlySet<string>;
}

interface PerRaid {
  key: string;
  picked: Point | null;
  /** When the spawn was picked: a screenshot after this wins over it. */
  pickedAt: number;
  done: string[];
  picking: boolean;
}
const emptyRaid = (key: string): PerRaid => ({ key, picked: null, pickedAt: 0, done: [], picking: false });

/** Extra seconds to walk via `p` on the way from a to b. */
function detourVia(a: Point, p: Point, b: Point): number {
  return ((Math.hypot(p.x - a.x, p.z - a.z) + Math.hypot(b.x - p.x, b.z - p.z) - Math.hypot(b.x - a.x, b.z - a.z)) * DETOUR) / SPEED;
}

export function useRaidRoute(o: Options): RaidRoute {
  const prefs = useRoutePrefs();

  // Everything picked, reached or skipped belongs to one raid on one map.
  const resetKey = `${o.mapId ?? ''}|${o.raid?.startedAt ?? 'plan'}`;
  const [perRaid, setPerRaid] = useState<PerRaid>(() => emptyRaid(resetKey));
  const current = perRaid.key === resetKey ? perRaid : emptyRaid(resetKey);
  if (current !== perRaid) setPerRaid(current);

  // The clock moves the budget (and how old your position is): re-plan every 30 s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!prefs.on) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [prefs.on]);

  // Loot, prices and place names: loaded the first time the route is on.
  const [data, setData] = useState<RouteData | null>(null);
  useEffect(() => {
    if (!prefs.on || data) return;
    let alive = true;
    void loadRouteData().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [prefs.on, data]);

  const { squad, mapId, pois, tierOf } = o;
  const party = prefs.party && squad.inSquad;
  const mates = useMemo<RouteWho[]>(
    () =>
      party
        ? squad.members
            .filter((m) => m.id !== squad.selfId && !squad.hiddenQuests[m.id] && o.mateStates[m.id])
            .map((m) => ({ id: m.id, name: m.name, color: hexForColorId(m.colorId) }))
        : [],
    [party, squad.members, squad.selfId, squad.hiddenQuests, o.mateStates],
  );
  const self = useMemo<RouteWho>(
    () => ({ id: squad.selfId ?? 'self', name: o.selfName, color: o.selfColor }),
    [squad.selfId, o.selfName, o.selfColor],
  );

  const questStops = useMemo(() => {
    if (!mapId || !o.own) return [];
    const lists = [{ who: self, objectives: o.own.availableObjectivesByMap[mapId] ?? [] }];
    for (const m of mates) lists.push({ who: m, objectives: o.mateStates[m.id]?.availableObjectivesByMap[mapId] ?? [] });
    return buildStops(mapId, lists);
  }, [mapId, o.own, o.mateStates, mates, self]);

  const mapLoot = useMemo(() => (data?.loot && mapId ? lootForMap(data.loot, mapId) : null), [data, mapId]);
  const labels = mapId && data ? data.labels[mapId] ?? data.labels[canonicalMapId(mapId)] : undefined;
  const locks = useMemo(
    () =>
      pois
        .filter((p) => p.category === 'lock' && p.subtype === 'door' && !(p.meta as { labelKey?: string } | undefined)?.labelKey)
        .map((p) => ({ x: p.position.x, z: p.position.z, key: p.label })),
    [pois],
  );
  const kinds = useMemo(() => (data?.loot ? itemKinds(data.loot) : undefined), [data]);
  const lootCtx = useMemo<LootContext | null>(
    () =>
      mapLoot && data
        ? { loot: mapLoot, prices: data.prices, labels, locks, itemKinds: kinds, hideoutNeeds: o.hideoutNeeds, weaponKinds: prefs.weaponKinds }
        : null,
    [mapLoot, data, labels, locks, kinds, o.hideoutNeeds, prefs.weaponKinds],
  );

  const goalStops = useMemo<RouteStop[]>(() => {
    if (prefs.goal === 'quests') return questStops;
    if (prefs.goal === 'scavs') return scavStops(pois, [self], labels);
    return lootCtx ? lootStops(prefs.goal, lootCtx, [self]) : [];
  }, [prefs.goal, questStops, pois, self, labels, lootCtx]);

  // Positions that are from this raid (or recent, when planning).
  const startedAt = o.raid?.startedAt ?? null;
  const fresh = useCallback(
    (ts: number) => (startedAt !== null ? ts >= startedAt - 60_000 : now - ts <= STALE_OUT_OF_RAID_MS),
    [startedAt, now],
  );
  const own = o.playerPos && fresh(o.playerPos.ts) ? o.playerPos : null;
  const mateFixes = useMemo<Point[]>(() => {
    const out: Point[] = [];
    if (party && mapId) {
      for (const m of mates) {
        const p = squad.positions[m.id];
        if (p && canonicalMapId(p.payload.mapId) === canonicalMapId(mapId) && fresh(p.ts)) out.push({ x: p.payload.x, z: p.payload.z });
      }
    }
    return out;
  }, [fresh, party, mapId, mates, squad.positions]);
  const fixes = useMemo<Point[]>(() => (own ? [{ x: own.x, z: own.z }, ...mateFixes] : mateFixes), [own, mateFixes]);

  // Stops someone walked up to count as done for the rest of the raid.
  const reached = goalStops.filter(
    (s) => !current.done.includes(s.id) && fixes.some((f) => Math.hypot(f.x - s.x, f.z - s.z) <= REACHED_M),
  );
  if (reached.length > 0) setPerRaid({ ...current, done: [...current.done, ...reached.map((s) => s.id)] });

  // The route always leaves from where you are now (your latest screenshot).
  const { picked, pickedAt } = current;
  const from = useMemo(() => routeStart(own, picked && { at: picked, ts: pickedAt }, mateFixes), [own, picked, pickedAt, mateFixes]);
  const start = from?.point ?? null;
  const startSource = from?.source ?? null;
  const startTs = from?.ts ?? null;
  const startAge = startTs === null ? null : Math.max(0, Math.floor((now - startTs) / 60_000));

  const inRaid = !!o.raid;
  const exits = useMemo<RouteExit[]>(() => {
    const extracts = pois.filter((p) => p.category === 'extract');
    // Planning outside a raid: a PMC raid (every exit counts as yours on the map then,
    // Scav-only ones included). In a raid, the side and the O+O list decide.
    let mine = extracts.filter((p) => tierOf(p) === 'mine' && (inRaid || factionOf(p) !== 'scav'));
    // In a raid with the side not known yet: a PMC's exits.
    if (mine.length === 0) mine = extracts.filter((p) => factionOf(p) !== 'scav');
    return mine.map(exitOf);
  }, [pois, tierOf, inRaid]);

  const { raid } = o;
  const raidSeconds = (raidMinutes(mapId) ?? 40) * 60;
  const budget = useMemo(() => {
    if (raid?.endsAt) return Math.max(0, (raid.endsAt - now) / 1000 - MARGIN_S);
    if (raid) return Math.max(0, raidSeconds - (now - raid.startedAt) / 1000 - MARGIN_S);
    return raidSeconds - MARGIN_S;
  }, [raidSeconds, raid, now]);
  const elapsed = raid ? Math.max(0, Math.round((now - raid.startedAt) / 1000)) : 0;

  const toExit = useMemo(() => (own && exits.length ? nearestExit(own, exits).s : null), [own, exits]);

  // Hot zones: the map's fixed data, plus its loot hubs once loaded.
  const sources = useMemo(() => heatSources(pois, mapLoot?.containers ?? []), [pois, mapLoot]);
  const known = useMemo<Point[]>(() => {
    const out: Point[] = pois
      .filter((p) => p.category === 'spawn' || p.category === 'extract' || p.category === 'transit' || p.category === 'loot' || p.category === 'switch')
      .map((p) => ({ x: p.position.x, z: p.position.z }));
    for (const s of mapLoot?.loose ?? []) out.push({ x: s.x, z: s.z });
    // Offline (no POIs): the containers of the loot snapshot mark the map too.
    if (!pois.some((p) => p.category === 'loot')) for (const c of mapLoot?.containers ?? []) out.push({ x: c.x, z: c.z });
    for (const s of questStops) out.push({ x: s.x, z: s.z });
    return out;
  }, [pois, mapLoot, questStops]);

  // Plan every style off the main thread; keep showing the last plans meanwhile.
  const planKey = `${mapId ?? ''}|${prefs.goal}`;
  const [result, setResult] = useState<{ key: string; plans: Partial<Record<RouteStyle, RoutePlan>> } | null>(null);
  const open = useMemo(() => goalStops.filter((s) => !current.done.includes(s.id)), [goalStops, current.done]);
  const budgetStep = Math.round(budget / 15);
  useEffect(() => {
    if (!prefs.on || !start || !mapId) return;
    let alive = true;
    const input: ComputeInput = {
      terrainKey: `${mapId}|${raidSeconds}|${sources.length}|${known.length}`,
      sources,
      known,
      start,
      stops: open.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, work: s.work, value: s.value ?? 1 })),
      exits,
      budget: budgetStep * 15,
      elapsed,
      raid: raidSeconds,
      preferCar: prefs.preferCar,
      maxStops: MAX_STOPS[prefs.goal],
      styles: [...ROUTE_STYLES],
    };
    computeInBackground(input)
      .then((plans) => {
        if (!alive) return;
        const stopsById = new Map(open.map((s) => [s.id, s]));
        const exitsById = new Map(exits.map((e) => [e.id, e]));
        const out: Partial<Record<RouteStyle, RoutePlan>> = {};
        for (const p of plans) out[p.style] = rehydrate(p, stopsById, exitsById);
        setResult({ key: planKey, plans: out });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [prefs.on, prefs.preferCar, prefs.goal, start, mapId, open, exits, budgetStep, elapsed, raidSeconds, sources, known, planKey]);

  const plans = prefs.on && start && result?.key === planKey ? result.plans : {};
  const plan = plans[prefs.style] ?? null;

  // Loot worth a short detour from the quest route.
  const onWay = useMemo(() => {
    if (prefs.goal !== 'quests' || !prefs.lootOnWay || !plan || !start || !lootCtx) return [];
    const line: Point[] = plan.paths ? plan.paths.flat() : [start, ...plan.stops, ...(plan.exit ? [plan.exit] : [])];
    if (line.length < 2) return [];
    const areas = lootStops('money', lootCtx, [self], 300);
    const out: { stop: RouteStop; extra: number }[] = [];
    for (const a of areas) {
      let extra = Infinity;
      for (let i = 1; i < line.length; i++) extra = Math.min(extra, detourVia(line[i - 1], a, line[i]));
      if (extra <= ON_WAY_S) out.push({ stop: a, extra });
    }
    return out.sort((p, q) => (q.stop.value ?? 0) - (p.stop.value ?? 0)).slice(0, ON_WAY_MAX);
  }, [prefs.goal, prefs.lootOnWay, plan, start, lootCtx, self]);

  // Where you are, when it is hot right now.
  const selfHeat = useMemo<SelfHeat | null>(() => {
    if (!own || !raid) return null;
    const why = hotReason(sources, own, elapsed, raidSeconds);
    if (!why) return null;
    const src = sources.find((s) => s.kind === why.kind && heatAt([s], own, elapsed, raidSeconds) > 0);
    return { level: why.level, kind: why.kind, key: src ? `${src.kind}:${Math.round(src.x)}:${Math.round(src.z)}` : why.kind };
  }, [own, raid, sources, elapsed, raidSeconds]);

  const [previewPhase, setPreviewPhase] = useState<RaidPhase>(0);
  const phase: RaidPhase = raid ? phaseOf(elapsed, raidSeconds) : previewPhase;

  const spawns = useMemo(() => pois.filter((p) => p.category === 'spawn' && (p.subtype === 'pmc' || p.subtype === 'all')), [pois]);

  return {
    on: prefs.on,
    setOn: (on) => setRoutePrefs({ on }),
    party: prefs.party,
    setParty: (on) => setRoutePrefs({ party: on }),
    goal: prefs.goal,
    setGoal: (goal) => setRoutePrefs({ goal }),
    weaponKinds: prefs.weaponKinds,
    setWeaponKinds: (weaponKinds) => setRoutePrefs({ weaponKinds }),
    style: prefs.style,
    setStyle: (style) => setRoutePrefs({ style }),
    mates,
    plans,
    plan,
    computing: prefs.on && !!start && result?.key !== planKey,
    start,
    startSource,
    startAge,
    budget,
    elapsed,
    raidSeconds,
    picking: current.picking,
    setPicking: (on) => setPerRaid({ ...current, picking: on }),
    pickStart: (p) => setPerRaid({ ...current, picked: p, pickedAt: Date.now(), picking: false }),
    spawns,
    skip: (id) => setPerRaid({ ...current, done: [...current.done, id] }),
    doneCount: current.done.length,
    reset: () => setPerRaid(emptyRaid(resetKey)),
    toExit,
    heat: { on: prefs.heat, setOn: (on) => setRoutePrefs({ heat: on }), sources, known, phase, setPreviewPhase },
    lootOnWay: prefs.lootOnWay,
    setLootOnWay: (on) => setRoutePrefs({ lootOnWay: on }),
    onWay,
    preferCar: prefs.preferCar,
    setPreferCar: (on) => setRoutePrefs({ preferCar: on }),
    selfHeat: selfHeat && selfHeat.level >= HOT ? selfHeat : null,
    ready: !!data,
  };
}
