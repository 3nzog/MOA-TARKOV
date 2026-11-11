import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLatest } from '../hooks/useLatest';
import {
  defaultCorner,
  fitInMonitor,
  type Rect,
  EV_LOCK,
  EV_READY,
  EV_STATE,
  MINIMAP_LABEL,
  parseMinimapSettings,
  type MinimapPoint,
  type MinimapSettings,
  type MinimapState,
} from '../minimap/protocol';
import type { PlayerPos } from './useGameEvents';

const KEY = 'tc_minimap_v1';

const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface Feed {
  mapId: string | null;
  pos: PlayerPos | null;
  activeFloorId: string | null;
  points: MinimapPoint[];
}

type WinLike = {
  close: () => Promise<void>;
  setIgnoreCursorEvents: (ignore: boolean) => Promise<void>;
  setSize: (size: unknown) => Promise<void>;
  setPosition: (pos: unknown) => Promise<void>;
  outerPosition: () => Promise<{ x: number; y: number }>;
  scaleFactor: () => Promise<number>;
};

type MonitorLike = { position: { x: number; y: number }; size: { width: number; height: number }; scaleFactor: number };

/** A monitor's bounds in logical px. */
const logicalRect = (m: MonitorLike): Rect => {
  const s = m.scaleFactor || 1;
  return { x: m.position.x / s, y: m.position.y / s, width: m.size.width / s, height: m.size.height / s };
};

/** The monitor holding a point (logical px), else the primary one. */
async function monitorAt(x: number, y: number): Promise<Rect | null> {
  try {
    const { availableMonitors, primaryMonitor } = await import('@tauri-apps/api/window');
    const all = (await availableMonitors()).map(logicalRect);
    const hit = all.find((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    if (hit) return hit;
    const p = await primaryMonitor();
    return p ? logicalRect(p) : (all[0] ?? null);
  } catch {
    return null;
  }
}

async function getOverlay(): Promise<WinLike | null> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  return (await WebviewWindow.getByLabel(MINIMAP_LABEL)) as unknown as WinLike | null;
}

/** Top-right of the primary monitor (where the game normally runs), in logical px. */
async function defaultPosition(size: number): Promise<{ x: number; y: number }> {
  try {
    const { primaryMonitor } = await import('@tauri-apps/api/window');
    const m = await primaryMonitor();
    if (m) {
      const s = m.scaleFactor || 1;
      return defaultCorner(
        { x: m.position.x / s, y: m.position.y / s, width: m.size.width / s, height: m.size.height / s },
        size,
      );
    }
  } catch {
    /* fall through */
  }
  return { x: 40, y: 40 };
}

// The minimap overlay window, driven from the main window: open/close it, keep
// it click-through when locked, and push it the map/position state it draws.
export function useMinimapWindow(feed: Feed) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MinimapSettings>(() => {
    try {
      return parseMinimapSettings(localStorage.getItem(KEY));
    } catch {
      return parseMinimapSettings(null);
    }
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useLatest(settings);
  const lastPayload = useRef<MinimapState | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* quota */
    }
  }, [settings]);

  // ---- open / close --------------------------------------------------------
  useEffect(() => {
    if (!inTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const existing = await getOverlay();
        if (!settings.enabled) {
          if (existing) await existing.close();
          if (!cancelled) setOpen(false);
          return;
        }
        if (existing) {
          if (!cancelled) setOpen(true);
          return;
        }
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const s = settingsRef.current;
        let at = s.pos ?? (await defaultPosition(s.size));
        // A saved spot from another monitor layout or size must not put it off-screen.
        const mon = await monitorAt(at.x + s.size / 2, at.y + s.size / 2);
        if (mon) at = fitInMonitor(at, s.size, mon);
        const win = new WebviewWindow(MINIMAP_LABEL, {
          url: 'index.html?view=minimap',
          title: 'Tarkov MoA — minimap',
          width: s.size,
          height: s.size,
          x: at.x,
          y: at.y,
          decorations: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          resizable: false,
          shadow: false,
          // Never take focus: stealing it from a borderless game would drop
          // keyboard input mid-raid.
          focus: false,
        });
        await new Promise<void>((resolve, reject) => {
          void win.once('tauri://created', () => resolve());
          void win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
        });
        await win.setIgnoreCursorEvents(s.locked);
        if (!cancelled) {
          setOpen(true);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setOpen(false);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.enabled, settingsRef]);

  // ---- lock (click-through) and size follow the settings --------------------
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const win = await getOverlay();
        if (!win) return;
        await win.setIgnoreCursorEvents(settings.locked);
        if (settings.locked) {
          // Remember where the player dragged it.
          const phys = await win.outerPosition();
          const scale = await win.scaleFactor();
          const pos = { x: Math.round(phys.x / scale), y: Math.round(phys.y / scale) };
          setSettings((cur) => (cur.pos?.x === pos.x && cur.pos?.y === pos.y ? cur : { ...cur, pos }));
        }
      } catch {
        /* window closing */
      }
    })();
  }, [open, settings.locked]);

  // Size changes keep the overlay on screen: a right-side overlay grows to the
  // left (keeping its right edge), and nothing ends up past a monitor edge.
  const shownSize = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const size = settings.size;
    void (async () => {
      try {
        const win = await getOverlay();
        if (!win) return;
        const { LogicalSize, LogicalPosition } = await import('@tauri-apps/api/dpi');
        const phys = await win.outerPosition();
        const scale = await win.scaleFactor();
        const cur = { x: phys.x / scale, y: phys.y / scale };
        // The size the window has on screen before this change (first run: assume the saved pos was for this size).
        const prev = shownSize.current ?? size;
        const mon = await monitorAt(cur.x + prev / 2, cur.y + prev / 2);
        await win.setSize(new LogicalSize(size, size));
        shownSize.current = size;
        if (!mon) return;
        const next = fitInMonitor(cur, size, mon, prev);
        if (Math.round(cur.x) !== next.x || Math.round(cur.y) !== next.y) {
          await win.setPosition(new LogicalPosition(next.x, next.y));
          if (settingsRef.current.pos) setSettings((s) => ({ ...s, pos: next }));
        }
      } catch {
        /* window closing */
      }
    })();
  }, [open, settings.size, settingsRef]);

  // ---- state feed --------------------------------------------------------------
  const buildPayload = useCallback(
    (): MinimapState => ({
      mapId: feed.mapId,
      pos: feed.pos,
      activeFloorId: feed.activeFloorId,
      points: feed.points,
      settings: {
        locked: settings.locked,
        headingUp: settings.headingUp,
        zoom: settings.zoom,
        opacity: settings.opacity,
        shape: settings.shape,
      },
      text: {
        waitingRaid: t('minimap.waitingRaid'),
        dragHint: t('minimap.dragHint'),
        lock: t('minimap.lock'),
        ago: t('minimap.ago', { min: '{{min}}' }),
      },
    }),
    [feed.mapId, feed.pos, feed.activeFloorId, feed.points, settings, t],
  );

  useEffect(() => {
    const payload = buildPayload();
    lastPayload.current = payload;
    if (!open) return;
    void (async () => {
      try {
        const { emitTo } = await import('@tauri-apps/api/event');
        await emitTo(MINIMAP_LABEL, EV_STATE, payload);
      } catch {
        /* window closing */
      }
    })();
  }, [open, buildPayload]);

  // The overlay asks for state when it loads; it can also lock itself.
  useEffect(() => {
    if (!inTauri()) return;
    const unlistens: Array<() => void> = [];
    let cancelled = false;
    void (async () => {
      try {
        const { listen, emitTo } = await import('@tauri-apps/api/event');
        const u1 = await listen(EV_READY, () => {
          if (lastPayload.current) void emitTo(MINIMAP_LABEL, EV_STATE, lastPayload.current);
        });
        const u2 = await listen(EV_LOCK, () => setSettings((s) => ({ ...s, locked: true })));
        if (cancelled) {
          u1();
          u2();
        } else unlistens.push(u1, u2);
      } catch {
        /* outside Tauri */
      }
    })();
    return () => {
      cancelled = true;
      unlistens.forEach((u) => u());
    };
  }, []);

  const update = useCallback((patch: Partial<MinimapSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const toggle = useCallback(() => setSettings((s) => ({ ...s, enabled: !s.enabled })), []);

  const resetPosition = useCallback(async () => {
    const at = await defaultPosition(settingsRef.current.size);
    setSettings((s) => ({ ...s, pos: at }));
    try {
      const win = await getOverlay();
      const { LogicalPosition } = await import('@tauri-apps/api/dpi');
      await win?.setPosition(new LogicalPosition(at.x, at.y));
    } catch {
      /* not open */
    }
  }, [settingsRef]);

  return { settings, update, toggle, open, error, available: inTauri(), resetPosition };
}

export type MinimapApi = ReturnType<typeof useMinimapWindow>;
