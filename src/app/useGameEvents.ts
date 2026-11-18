import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  subscribeRaidEnded,
  subscribeQuestEvent,
  subscribeRaidStarted,
  subscribeGroupRaidSide,
  subscribeExtractPanel,
  scanRaidSides,
  subscribePlayerPosition,
  subscribeLinkSideScan,
  type SideScanPayload,
  replayPastLogs,
  parseLogTime,
  isLiveEvent,
  type UnlistenFn,
} from '../services/tauriEvents';
import { mapIdFromLogLocation } from '../map/logLocationMap';
import {
  expireOverrideByEvent,
  markQuestAccepted,
  markQuestComplete,
  markQuestFailed,
  type LocalProgress,
} from '../state/localProgress';
import {
  mergeSideScan,
  recordQuestEvent,
  recordRaidEnd,
  recordRaidStart,
  recordGroupSide,
  type RaidHistory,
} from '../state/raidHistory';

export type PlayerPos = { x: number; y: number; z: number; rotation: number; ts: number; seq?: number };

interface Options {
  setProgress: Dispatch<SetStateAction<LocalProgress>>;
  setSelectedMapId: Dispatch<SetStateAction<string | null>>;
  /** Raid / quest-event history (stats). Optional so callers can opt out. */
  setHistory?: Dispatch<SetStateAction<RaidHistory>>;
  /** A quest event happening now (not a replay of old logs). */
  onLiveQuestEvent?: (templateId: string, status: string) => void;
  /** The O+O extract list read from a screenshot (raw OCR lines). */
  onExtractPanel?: (lines: string[], missingLanguage: string | null) => void;
}

// Live state from the game, via the Rust log/screenshot watchers: quest
// accepted/finished/failed, raid start/end, and the player's position. Returns
// the latest position (null between raids).
export function useGameEvents({ setProgress, setSelectedMapId, setHistory, onLiveQuestEvent, onExtractPanel }: Options) {
  const [playerPos, setPlayerPos] = useState<PlayerPos | null>(null);
  // Map of the raid currently being played, from the raid-started log event.
  // A ref because the position subscription (bound once) needs the live value.
  const liveRaidMapIdRef = useRef<string | null>(null);
  // A ref so a new callback does not re-subscribe every listener.
  const onLiveQuestRef = useRef(onLiveQuestEvent);
  useEffect(() => {
    onLiveQuestRef.current = onLiveQuestEvent;
  }, [onLiveQuestEvent]);
  const onExtractPanelRef = useRef(onExtractPanel);
  useEffect(() => {
    onExtractPanelRef.current = onExtractPanel;
  }, [onExtractPanel]);

  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    let cancelled = false;

    void (async () => {
      try {
        const u1 = await subscribeQuestEvent((ev) => {
          const at = parseLogTime(ev.logTime);
          setProgress((cur) => {
            // A log event newer than a manual override means the game moved on.
            const base = expireOverrideByEvent(cur, ev.templateId, at);
            switch (ev.status) {
              case 'Started':
                return markQuestAccepted(base, ev.templateId);
              case 'Finished':
                return markQuestComplete(base, ev.templateId);
              case 'Failed':
                return markQuestFailed(base, ev.templateId);
              default:
                return base;
            }
          });
          setHistory?.((h) =>
            recordQuestEvent(h, { templateId: ev.templateId, status: ev.status, at: at ?? Date.now() }),
          );
          if (at !== null && isLiveEvent(at)) onLiveQuestRef.current?.(ev.templateId, ev.status);
        });
        const u2 = await subscribeRaidEnded((ev) => {
          const target = mapIdFromLogLocation(ev.location);
          if (target) setSelectedMapId(target);
          const at = parseLogTime(ev.logTime) ?? Date.now();
          setHistory?.((h) => recordRaidEnd(h, ev.location || null, at));
        });
        const u3 = await subscribeRaidStarted((ev) => {
          const logAt = parseLogTime(ev.logTime);
          const at = logAt ?? Date.now();
          setHistory?.((h) => recordRaidStart(h, ev.location ?? null, at, ev.profileKey ?? null));
          setPlayerPos(null);
          liveRaidMapIdRef.current = ev.location
            ? mapIdFromLogLocation(ev.location) ?? null
            : null;
          // Spawning in: switch to the raid's map right away, before any
          // screenshot. Only for a live raid — a "Sync past logs" replay
          // re-emits every old GameStarted, and flipping through each old
          // raid's map would be wrong.
          const raidMap = liveRaidMapIdRef.current;
          if (raidMap && isLiveEvent(logAt)) {
            setSelectedMapId((cur) => (cur === raidMap ? cur : raidMap));
          }
        });
        const u4 = await subscribePlayerPosition((ev) => {
          setPlayerPos({ ...ev, ts: Date.now() });
          // Screenshot → make sure we're LOOKING at the raid's map. The
          // follow-cam (FollowCamera) then centers if the user kept that on.
          const liveMap = liveRaidMapIdRef.current;
          if (liveMap) setSelectedMapId((cur) => (cur === liveMap ? cur : liveMap));
        });
        const u5 = await subscribeGroupRaidSide((ev) => {
          if (ev.side !== 'pmc' && ev.side !== 'scav') return;
          const at = parseLogTime(ev.logTime) ?? Date.now();
          setHistory?.((h) => recordGroupSide(h, ev.side, at));
        });
        const u6 = await subscribeExtractPanel((ev) => {
          if (Array.isArray(ev.lines)) {
            onExtractPanelRef.current?.(
              ev.lines.filter((l) => typeof l === 'string'),
              typeof ev.missingLanguage === 'string' ? ev.missingLanguage : null,
            );
          }
        });
        // Learn which profile is the Scav from every log on disk (about a
        // megabyte), so a fresh install or a new season knows it at once. An
        // extra screen (linked PC) gets the game PC's scan instead.
        const applyScan = (scan: SideScanPayload) => {
              if (cancelled || !setHistory) return;
              const at = (t: string | null) => parseLogTime(t);
              // Opened in the middle of a raid: its GameStarted was written
              // before the app was listening, so take the raid's map from the
              // scan (the latest start with no end after it, under 3 h old).
              const starts = scan.raids
                .map((r) => ({ location: r.location, at: at(r.logTime) }))
                .filter((r): r is { location: string | null; at: number } => r.at !== null)
                .sort((a, b) => b.at - a.at);
              const last = starts[0];
              const endedAfter = last && scan.ends.some((e) => (at(e.logTime) ?? 0) >= last.at);
              if (last && !endedAfter && Date.now() - last.at < 3 * 60 * 60 * 1000 && !liveRaidMapIdRef.current) {
                const raidMap = last.location ? mapIdFromLogLocation(last.location) ?? null : null;
                if (raidMap) {
                  liveRaidMapIdRef.current = raidMap;
                  setSelectedMapId((cur) => (cur === raidMap ? cur : raidMap));
                }
              }
              setHistory((h) =>
                mergeSideScan(h, {
                  raids: scan.raids.map((r) => ({ location: r.location, profileKey: r.profileKey, at: at(r.logTime) })),
                  groups: scan.groups.map((g) => ({ side: g.side, at: at(g.logTime) })),
                  ends: scan.ends.map((e) => ({ location: e.location, at: at(e.logTime) })),
                }),
              );
        };
        if (setHistory) {
          scanRaidSides()
            .then(applyScan)
            .catch((e) => console.warn('[tauriEvents] side scan failed:', e));
        }
        const u7 = await subscribeLinkSideScan(applyScan);
        if (cancelled) {
          u1(); u2(); u3(); u4(); u5(); u6(); u7();
        } else {
          unlistens.push(u1, u2, u3, u4, u5, u6, u7);
        }
      } catch (e) {
        // Running outside Tauri (e.g. plain `vite dev`) — listen() throws. Swallow.
        console.warn('[tauriEvents] subscribe failed (running outside Tauri?):', e);
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unlistens) u();
    };
  }, [setProgress, setSelectedMapId, setHistory]);

  return playerPos;
}

// "Sync past logs": replays every log file on disk through the watcher, for
// a first launch or after the app was closed during a raid.
export function useLogReplay(notify: (message: string) => void) {
  const { t } = useTranslation();
  const [replaying, setReplaying] = useState(false);

  const replay = async () => {
    setReplaying(true);
    try {
      const count = await replayPastLogs();
      notify(t('rail.replayedLogs', { count }));
    } catch (err) {
      notify(err instanceof Error ? err.message : t('errors.replayFailed'));
    } finally {
      setReplaying(false);
    }
  };

  return { replaying, replay };
}
