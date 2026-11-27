// The Scav's waiting time: a Scav raid that ends starts it (the logs say when
// a raid ends; which profile is the Scav is already learned, raidHistory.ts),
// and a sound says when the Scav can go in again. The length depends on
// Fence's reputation and the hideout, which no log tells, so the player sets
// it once.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { raidSide, type RaidHistory, type SideKnowledge } from '../state/raidHistory';
import { playSound } from '../sound/sounds';

const KEY = 'tc_scav_v1';
export const SCAV_MIN = 5;
export const SCAV_MAX = 60;
/** "Ready" stays on screen this long after the wait is over. */
export const READY_SHOWN_MS = 15 * 60_000;

export interface ScavPrefs {
  /** The wait after a Scav raid, minutes. */
  minutes: number;
}
const DEFAULTS: ScavPrefs = { minutes: 25 };

export function parseScavPrefs(raw: string | null): ScavPrefs {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<ScavPrefs> | null;
    const m = typeof v?.minutes === 'number' && Number.isFinite(v.minutes) ? Math.round(v.minutes) : DEFAULTS.minutes;
    return { minutes: Math.min(SCAV_MAX, Math.max(SCAV_MIN, m)) };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: ScavPrefs = (() => {
  try {
    return parseScavPrefs(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULTS };
  }
})();
const listeners = new Set<() => void>();

export function setScavPrefs(patch: Partial<ScavPrefs>): void {
  current = parseScavPrefs(JSON.stringify({ ...current, ...patch }));
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function useScavPrefs(): ScavPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** When the last Scav raid ended (null: none known). */
export function lastScavEnd(h: RaidHistory, k: SideKnowledge): number | null {
  for (let i = h.raids.length - 1; i >= 0; i--) {
    const r = h.raids[i];
    if (r.endedAt !== null && raidSide(r, k) === 'scav') return r.endedAt;
  }
  return null;
}

export type ScavState = { kind: 'none' } | { kind: 'waiting'; leftMs: number; readyAt: number } | { kind: 'ready'; readyAt: number };

export function scavState(endedAt: number | null, minutes: number, now: number): ScavState {
  if (endedAt === null) return { kind: 'none' };
  const readyAt = endedAt + minutes * 60_000;
  if (now < readyAt) return { kind: 'waiting', leftMs: readyAt - now, readyAt };
  return now - readyAt <= READY_SHOWN_MS ? { kind: 'ready', readyAt } : { kind: 'none' };
}

/** What the Scav's wait is counted from. */
export interface ScavWait {
  endedAt: number | null;
  minutes: number;
}

/**
 * The Scav's wait: the sound and a message when it is over. It does not tick:
 * the chip on the map counts down on its own (ScavChip), so the whole app is
 * not drawn again every second while the wait runs.
 */
export function useScavTimer(h: RaidHistory, k: SideKnowledge, notify: (m: string) => void, readyText: string): ScavWait {
  const { minutes } = useScavPrefs();
  const endedAt = lastScavEnd(h, k);
  // Said once per wait, and only when it ends while the app is open (not on a
  // late start, long after it was over).
  const readyAt = endedAt === null ? null : endedAt + minutes * 60_000;
  useEffect(() => {
    if (readyAt === null) return;
    const wait = readyAt - Date.now();
    if (wait < -60_000) return;
    const id = window.setTimeout(() => {
      playSound('scav');
      notify(readyText);
    }, Math.max(0, wait));
    return () => window.clearTimeout(id);
  }, [readyAt, notify, readyText]);
  return useMemo(() => ({ endedAt, minutes }), [endedAt, minutes]);
}

/** The wait at this moment, ticking every second while it shows (for the chip). */
export function useScavState(w: ScavWait): ScavState {
  const [now, setNow] = useState(() => Date.now());
  const state = scavState(w.endedAt, w.minutes, now);
  const showing = state.kind !== 'none' || (w.endedAt !== null && now < w.endedAt + w.minutes * 60_000 + READY_SHOWN_MS);
  useEffect(() => {
    if (!showing) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [showing]);
  return state;
}
