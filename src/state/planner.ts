// Planner state: everything the player tells the app that the game will not.
// Objective ticks, built hideout levels, item counts collected, keys owned.
//
// Kept apart from LocalProgress on purpose: a LocalProgress change re-derives
// the whole quest state, and a tick on a checklist should not cost that.
import type { NeedScope } from '../progression/needs';

const STORAGE_KEY = 'tc_planner_v1';

export interface PlannerState {
  checkedObjectives: string[];
  stationLevels: Record<string, number>;
  /** ItemNeed.key → how many the player has set aside. */
  collected: Record<string, number>;
  /** Key item ids the player marked as owned. */
  keysOwned: string[];
  needsScope: NeedScope;
  includeHideout: boolean;
  /** Start of the current wipe (ms) — filters raid stats. null = all history. */
  wipeStart: number | null;
}

export const EMPTY_PLANNER: PlannerState = {
  checkedObjectives: [],
  stationLevels: {},
  collected: {},
  keysOwned: [],
  needsScope: 'available',
  includeHideout: true,
  wipeStart: null,
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function numbers(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
  }
  return out;
}

export function parsePlanner(raw: string | null): PlannerState {
  if (!raw) return { ...EMPTY_PLANNER };
  try {
    const p = JSON.parse(raw) as Partial<PlannerState>;
    return {
      checkedObjectives: strings(p.checkedObjectives),
      stationLevels: numbers(p.stationLevels),
      collected: numbers(p.collected),
      keysOwned: strings(p.keysOwned),
      needsScope: p.needsScope === 'active' || p.needsScope === 'all' ? p.needsScope : 'available',
      includeHideout: p.includeHideout !== false,
      wipeStart: typeof p.wipeStart === 'number' ? p.wipeStart : null,
    };
  } catch {
    return { ...EMPTY_PLANNER };
  }
}

export function loadPlanner(): PlannerState {
  try {
    return parsePlanner(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...EMPTY_PLANNER };
  }
}

export function savePlanner(p: PlannerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // quota — the planner is a convenience, never fatal
  }
}

export function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function setCount(map: Record<string, number>, key: string, n: number): Record<string, number> {
  const next = { ...map };
  if (n > 0) next[key] = Math.floor(n);
  else delete next[key];
  return next;
}
