// The raid route's choices, kept per PC: on or off, the party's quests in or
// not, the goal, the style, and the extras. A small store (like the sound
// settings) so the app can read the goal before the route hook runs: the
// hideout goal needs the planner's data loaded.
import { useSyncExternalStore } from 'react';
import { ROUTE_STYLES, type RouteStyle } from './plan';
import { ROUTE_GOALS, WEAPON_KINDS, type RouteGoal, type WeaponKind } from './targets';

export interface RoutePrefs {
  on: boolean;
  party: boolean;
  goal: RouteGoal;
  /** The weapons goal: which of guns, ammo and parts count. */
  weaponKinds: WeaponKind[];
  style: RouteStyle;
  /** Show the hot zones on the map. */
  heat: boolean;
  /** Quests goal: show the loot worth a short detour. */
  lootOnWay: boolean;
  /** End at a car exit when it fits (Fence reputation). */
  preferCar: boolean;
}

const KEY = 'tc_route_v1';
export const DEFAULT_ROUTE_PREFS: RoutePrefs = {
  on: false,
  party: true,
  goal: 'quests',
  weaponKinds: [...WEAPON_KINDS],
  style: 'direct',
  heat: false,
  lootOnWay: false,
  preferCar: false,
};

export function parseRoutePrefs(raw: string | null): RoutePrefs {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<RoutePrefs> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT_ROUTE_PREFS };
    const kinds = Array.isArray(v.weaponKinds) ? v.weaponKinds.filter((k): k is WeaponKind => WEAPON_KINDS.includes(k as WeaponKind)) : null;
    return {
      on: v.on === true,
      party: v.party !== false,
      goal: ROUTE_GOALS.includes(v.goal as RouteGoal) ? (v.goal as RouteGoal) : 'quests',
      weaponKinds: kinds && kinds.length > 0 ? kinds : [...WEAPON_KINDS],
      style: ROUTE_STYLES.includes(v.style as RouteStyle) ? (v.style as RouteStyle) : 'direct',
      heat: v.heat === true,
      lootOnWay: v.lootOnWay === true,
      preferCar: v.preferCar === true,
    };
  } catch {
    return { ...DEFAULT_ROUTE_PREFS };
  }
}

let current: RoutePrefs = (() => {
  try {
    return parseRoutePrefs(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_ROUTE_PREFS };
  }
})();
const listeners = new Set<() => void>();

export function setRoutePrefs(patch: Partial<RoutePrefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function useRoutePrefs(): RoutePrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
