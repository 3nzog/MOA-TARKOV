// Starting with Windows (hidden, in the tray) and showing up when the game
// starts (src-tauri/src/startup.rs). The game starting is seen in its logs on
// the game PC, and a linked second PC is told too: both screens open together.
import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const startupGet = (): Promise<boolean> => (inTauri() ? invoke<boolean>('startup_get') : Promise.resolve(false));
export const startupSet = (on: boolean): Promise<boolean> => invoke<boolean>('startup_set', { on });
export const mainShow = (): Promise<void> => invoke<void>('main_show');

const KEY = 'tc_startup_v1';
export interface StartupPrefs {
  /** The window comes up when the game starts (here, or on the linked game PC). */
  showOnGame: boolean;
}
const DEFAULTS: StartupPrefs = { showOnGame: true };

export function parseStartupPrefs(raw: string | null): StartupPrefs {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<StartupPrefs> | null;
    return { showOnGame: v?.showOnGame !== false };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: StartupPrefs = (() => {
  try {
    return parseStartupPrefs(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULTS };
  }
})();
const listeners = new Set<() => void>();

export function setStartupPrefs(patch: Partial<StartupPrefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function useStartupPrefs(): StartupPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** The game started: bring the window up (when that is on). */
export function useShowOnGameLaunch(notify: (message: string) => void, text: string): void {
  useEffect(() => {
    if (!inTauri()) return;
    let off: (() => void) | null = null;
    let alive = true;
    void listen('game-launched', () => {
      if (!current.showOnGame) return;
      void mainShow().catch(() => undefined);
      notify(text);
    }).then((u) => {
      if (alive) off = u;
      else u();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [notify, text]);
}
