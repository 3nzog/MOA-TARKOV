import { useCallback, useEffect, useState } from 'react';
import { useLatest } from '../hooks/useLatest';

// Configurable keyboard shortcuts. IN-APP ONLY: they fire while the MoA window
// has focus. A system-wide hotkey would have to grab keys away from the game
// (RegisterHotKey swallows them), so it is deliberately not offered.

export type HotkeyAction =
  | 'quests'
  | 'intel'
  | 'squad'
  | 'planner'
  | 'raidPrep'
  | 'compact'
  | 'minimap'
  | 'follow'
  | 'grid';

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  'quests',
  'intel',
  'squad',
  'planner',
  'raidPrep',
  'compact',
  'minimap',
  'follow',
  'grid',
];

export type HotkeyMap = Record<HotkeyAction, string | null>;

export const DEFAULT_HOTKEYS: HotkeyMap = {
  quests: 'Alt+1',
  intel: 'Alt+2',
  squad: 'Alt+3',
  planner: 'Alt+4',
  raidPrep: 'Alt+R',
  compact: 'Alt+C',
  minimap: 'Alt+M',
  follow: 'Alt+F',
  grid: 'Alt+G',
};

const STORAGE_KEY = 'tc_hotkeys_v1';
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']);

/** "Ctrl+Alt+K" from a key event; null for a bare modifier press. Layout-independent (uses `code`). */
export function comboFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = `Num${e.code.slice(6)}`;
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else if (e.code) key = e.code;
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...mods, key].join('+');
}

export function parseHotkeys(raw: string | null): HotkeyMap {
  const out: HotkeyMap = { ...DEFAULT_HOTKEYS };
  if (!raw) return out;
  try {
    const p = JSON.parse(raw) as Partial<Record<string, unknown>>;
    for (const a of HOTKEY_ACTIONS) {
      if (p[a] === null) out[a] = null;
      else if (typeof p[a] === 'string') out[a] = p[a] as string;
    }
  } catch {
    /* keep defaults */
  }
  return out;
}

/** Assign `combo` to `action`, unbinding any other action that held it. */
export function assignHotkey(map: HotkeyMap, action: HotkeyAction, combo: string | null): HotkeyMap {
  const next = { ...map };
  if (combo) {
    for (const a of HOTKEY_ACTIONS) if (next[a] === combo) next[a] = null;
  }
  next[action] = combo;
  return next;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export function useHotkeys(handlers: Record<HotkeyAction, () => void>) {
  const [map, setMap] = useState<HotkeyMap>(() => {
    try {
      return parseHotkeys(localStorage.getItem(STORAGE_KEY));
    } catch {
      return { ...DEFAULT_HOTKEYS };
    }
  });
  // While the settings screen is capturing a new combo, shortcuts stay quiet.
  const [capturing, setCapturing] = useState(false);
  const handlersRef = useLatest(handlers);
  const mapRef = useLatest(map);
  const capturingRef = useLatest(capturing);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* quota */
    }
  }, [map]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (capturingRef.current || e.repeat || isTypingTarget(e.target)) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const action = HOTKEY_ACTIONS.find((a) => mapRef.current[a] === combo);
      if (!action) return;
      e.preventDefault();
      handlersRef.current[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capturingRef, mapRef, handlersRef]);

  const assign = useCallback((action: HotkeyAction, combo: string | null) => setMap((m) => assignHotkey(m, action, combo)), []);
  const reset = useCallback(() => setMap({ ...DEFAULT_HOTKEYS }), []);

  return { map, assign, reset, setCapturing };
}

export type HotkeysApi = ReturnType<typeof useHotkeys>;
