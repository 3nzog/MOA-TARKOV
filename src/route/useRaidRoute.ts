// The raid route for the map on screen: where it starts (where you are now,
// from your latest screenshot; a spawn picked on the map until one comes; or
// the party's position), the stops
// (your objectives, plus your squadmates' with "party" on), the exits of your
// side and the time left. Re-planned at every new position, so it adjusts as
// you go; stops someone of the party walked up to drop out on their own.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DerivedQuestState } from '../quests/derive';
import type { Poi } from '../poi/types';
import type { ExitTier } from '../poi/exitTier';
import type { PlayerPos } from '../app/useGameEvents';
import { raidMinutes } from '../map/raidDuration';
import { canonicalMapId } from '../map/canonicalMap';
import { hexForColorId } from '../../shared/squadProtocol';
import { buildStops, nearestExit, planRoute, routeStart, type Point, type RouteExit, type RoutePlan, type RouteStartSource, type RouteWho } from './plan';

const KEY = 'tc_route_v1';
/** Walking up to a stop this close counts as done. */
const REACHED_M = 20;
/** Kept out of the budget for the unknowns (fights, looting, the way back). */
const MARGIN_S = 90;
/** Outside a raid, a position this old is not where you are any more. */
const STALE_OUT_OF_RAID_MS = 15 * 60_000;

interface Prefs {
  on: boolean;
  party: boolean;
}

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return { on: v.on === true, party: v.party !== false };
  } catch {
    return { on: false, party: true };
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

/** The squad as the route needs it (a subset of the squad context). */
export interface RouteSquad {
  inSquad: boolean;
  selfId: string | null;
  members: { id: string; name: string; colorId: string }[];
  positions: Record<string, { payload: { mapId: string; x: number; z: number }; ts: number }>;
  hiddenQuests: Record<string, boolean>;
}

export type { RouteStartSource };

export interface RaidRoute {
  on: boolean;
  setOn: (on: boolean) => void;
  party: boolean;
  setParty: (on: boolean) => void;
  /** Squadmates whose objectives are in (with party on). */
  mates: RouteWho[];
  plan: RoutePlan | null;
  start: Point | null;
  startSource: RouteStartSource | null;
  /** Minutes since the start position was taken (your screenshot or the pick); null for the party's. */
  startAge: number | null;
  /** Seconds the plan may use. */
  budget: number;
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

const exitPenalty = (p: Poi): number => {
  const m = (p.meta ?? {}) as { isCar?: boolean; requiresSwitch?: boolean; requiresItem?: boolean };
  return m.isCar ? 120 : m.requiresSwitch ? 90 : m.requiresItem ? 60 : 0;
};

export function useRaidRoute(o: Options): RaidRoute {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

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

  const { squad, mapId } = o;
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

  const allStops = useMemo(() => {
    if (!mapId || !o.own) return [];
    const self: RouteWho = { id: squad.selfId ?? 'self', name: o.selfName, color: o.selfColor };
    const lists = [{ who: self, objectives: o.own.availableObjectivesByMap[mapId] ?? [] }];
    for (const m of mates) lists.push({ who: m, objectives: o.mateStates[m.id]?.availableObjectivesByMap[mapId] ?? [] });
    return buildStops(mapId, lists);
  }, [mapId, o.own, o.mateStates, mates, squad.selfId, o.selfName, o.selfColor]);

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
  const reached = allStops.filter(
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

  const { pois, tierOf } = o;
  const exits = useMemo<RouteExit[]>(() => {
    const extracts = pois.filter((p) => p.category === 'extract');
    let mine = extracts.filter((p) => tierOf(p) === 'mine');
    // In a raid with the side not known yet: a PMC's exits.
    if (mine.length === 0) {
      mine = extracts.filter((p) => {
        const f = String((p.meta as { faction?: string } | undefined)?.faction ?? 'shared').toLowerCase();
        return f !== 'scav';
      });
    }
    return mine.map((p) => ({ id: p.id, label: p.label, x: p.position.x, z: p.position.z, penalty: exitPenalty(p), note: p.note }));
  }, [pois, tierOf]);

  const { raid } = o;
  const budget = useMemo(() => {
    const minutes = raidMinutes(mapId) ?? 40;
    if (raid?.endsAt) return Math.max(0, (raid.endsAt - now) / 1000 - MARGIN_S);
    if (raid) return Math.max(0, minutes * 60 - (now - raid.startedAt) / 1000 - MARGIN_S);
    return minutes * 60 - MARGIN_S;
  }, [mapId, raid, now]);

  const toExit = useMemo(() => (own && exits.length ? nearestExit(own, exits).s : null), [own, exits]);

  const plan = useMemo(() => {
    if (!prefs.on || !start) return null;
    const open = allStops.filter((s) => !current.done.includes(s.id));
    return planRoute(start, open, exits, budget);
  }, [prefs.on, start, allStops, current.done, exits, budget]);

  const spawns = useMemo(
    () => o.pois.filter((p) => p.category === 'spawn' && (p.subtype === 'pmc' || p.subtype === 'all')),
    [o.pois],
  );

  return {
    on: prefs.on,
    setOn: (on) => update({ on }),
    party: prefs.party,
    setParty: (on) => update({ party: on }),
    mates,
    plan,
    start,
    startSource,
    startAge,
    budget,
    picking: current.picking,
    setPicking: (on) => setPerRaid({ ...current, picking: on }),
    pickStart: (p) => setPerRaid({ ...current, picked: p, pickedAt: Date.now(), picking: false }),
    spawns,
    skip: (id) => setPerRaid({ ...current, done: [...current.done, id] }),
    doneCount: current.done.length,
    reset: () => setPerRaid(emptyRaid(resetKey)),
    toExit,
  };
}
