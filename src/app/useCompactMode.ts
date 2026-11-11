import { useCallback, useEffect, useRef, useState } from 'react';

// Compact mode: the map alone in a small window kept above other windows, for
// players who run the game borderless on one monitor. It is an ordinary OS
// window flag (Tauri's setAlwaysOnTop) — no overlay, no hook, nothing touches
// the game. In exclusive fullscreen the game owns the screen and nothing can be
// drawn over it; that limit is stated in the UI.
const KEY = 'tc_compact_v1';

const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function setOnTop(on: boolean): Promise<boolean> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setAlwaysOnTop(on);
    return true;
  } catch {
    return false; // the permission is missing, or the window is gone
  }
}

export function useCompactMode() {
  const [compact, setCompact] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  // Result of the last "keep on top" request while compact. null = not tried
  // (compact is off, or this is not the desktop app).
  const [onTopOk, setOnTopOk] = useState<boolean | null>(null);
  const appliedRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, compact ? '1' : '0');
    } catch {
      /* quota */
    }
    if (!inTauri()) return;
    // Only touch the window flag when there is something to change: never
    // un-pin a window we did not pin.
    if (!compact && !appliedRef.current) return;
    let cancelled = false;
    void setOnTop(compact).then((ok) => {
      appliedRef.current = compact && ok;
      if (!cancelled) setOnTopOk(compact ? ok : null);
    });
    return () => {
      cancelled = true;
    };
  }, [compact]);

  const toggle = useCallback(() => setCompact((c) => !c), []);
  return { compact, toggle, setCompact, onTopOk };
}
