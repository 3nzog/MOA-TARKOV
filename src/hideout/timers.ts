// Hideout timers: a craft or an upgrade the player started, and when it is
// done. The game's logs do not say what was started (only that something
// changed), so the player taps "started" in Planner → Hideout; the length
// comes from the game data, and can be corrected (skills and bonuses shorten
// it). When one ends: the "hideout ready" sound and a message; an upgrade
// also raises the station's built level.
import { useEffect, useSyncExternalStore } from 'react';
import { playSound } from '../sound/sounds';

const KEY = 'tc_hideout_timers_v1';
const MAX_TIMERS = 40;

export interface HideoutTimer {
  id: string;
  kind: 'craft' | 'upgrade';
  stationId: string;
  /** The craft's id (crafts). */
  craftId?: string;
  /** The level being built (upgrades). */
  level?: number;
  /** What it is, in the language of the moment it started. */
  label: string;
  startedAt: number;
  endsAt: number;
}

export function parseTimers(raw: string | null): HideoutTimer[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (t): t is HideoutTimer =>
          !!t &&
          typeof t.id === 'string' &&
          (t.kind === 'craft' || t.kind === 'upgrade') &&
          typeof t.stationId === 'string' &&
          typeof t.label === 'string' &&
          Number.isFinite(t.startedAt) &&
          Number.isFinite(t.endsAt),
      )
      .slice(-MAX_TIMERS);
  } catch {
    return [];
  }
}

let current: HideoutTimer[] = (() => {
  try {
    return parseTimers(localStorage.getItem(KEY));
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

function save(next: HideoutTimer[]): void {
  current = next.slice(-MAX_TIMERS);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function useHideoutTimers(): HideoutTimer[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Starts a timer (a craft already running at the same station is replaced: a station makes one thing at a time). */
export function startTimer(t: Omit<HideoutTimer, 'id' | 'startedAt' | 'endsAt'>, seconds: number, now = Date.now()): HideoutTimer {
  const timer: HideoutTimer = { ...t, id: newId(), startedAt: now, endsAt: now + Math.max(1, seconds) * 1000 };
  save([...current.filter((x) => !(x.stationId === t.stationId && x.kind === t.kind)), timer]);
  return timer;
}

export function removeTimer(id: string): void {
  save(current.filter((x) => x.id !== id));
}

/** Sets how much is left (the game shows it; skills and bonuses make it shorter than the data says). */
export function setTimeLeft(id: string, leftMs: number, now = Date.now()): void {
  save(current.map((x) => (x.id === id ? { ...x, endsAt: now + Math.max(0, leftMs) } : x)));
}

/** "1:30" → 90 min, "45" → 45 min, "2:05:00" → 2 h 5 min; null when it is not a time. */
export function parseLeft(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim());
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  const [h, m, s] = n.length === 3 ? n : n.length === 2 ? [n[0], n[1], 0] : [0, n[0], 0];
  return ((h * 60 + m) * 60 + s) * 1000;
}

/**
 * Rings for each timer as it ends (while the app is open, or at once when it
 * ended while closed, within the last 12 hours), then lets it go. An upgrade
 * also raises the built level.
 */
export function useHideoutAlarms(onDone: (t: HideoutTimer) => void): void {
  const timers = useHideoutTimers();
  useEffect(() => {
    const ids = timers.map((t) => {
      const wait = t.endsAt - Date.now();
      return window.setTimeout(() => {
        removeTimer(t.id);
        if (wait > -12 * 3600_000) {
          playSound('hideout');
          onDone(t);
        }
      }, Math.max(0, wait));
    });
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [timers, onDone]);
}
