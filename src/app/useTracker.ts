// TarkovTracker sync: pulls the player's progress every few minutes (ETag, so
// an unchanged poll is a 304) and pushes what changes here — live quest events
// from the logs, manual quest status, objective ticks, level. Rules live in
// state/trackerSync.ts; the key stays in the Rust core (services/tracker.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Station } from '../progression/types';
import type { LocalProgress } from '../state/localProgress';
import type { PlannerState } from '../state/planner';
import {
  applyPushedTasks,
  applyRemoteTasks,
  changedOverrides,
  dequeue,
  EMPTY_TRACKER_CACHE,
  enqueue,
  liveQuestState,
  loadTrackerCache,
  mergeHideout,
  mergeObjectives,
  parseRemote,
  pendingDiff,
  saveTrackerCache,
  type OutboxItem,
  type TrackerCache,
  type TrackerRemote,
} from '../state/trackerSync';
import {
  asTrackerError,
  inTauri,
  trackerGetProgress,
  trackerHasKey,
  trackerOpenKeyWindow,
  trackerRemoveKey,
  trackerSetLevel,
  trackerTokenInfo,
  trackerUpdateObjective,
  trackerUpdateTasks,
  type TrackerError,
  type TrackerTokenInfo,
} from '../services/tracker';

// The API asks for >= 60 s between polls; the free tier allows 1000 reads/day.
const POLL_MS = 5 * 60_000;
// Coming back to the window re-pulls only if the last pull is older than this.
const FOCUS_PULL_MS = 2 * 60_000;
const FLUSH_DELAY_MS = 3_000;
// Objective writes have no batch endpoint and the free tier allows 100
// writes/day, so one flush sends at most this many.
const MAX_OBJECTIVES_PER_FLUSH = 20;

interface Options {
  progress: LocalProgress;
  setProgress: Dispatch<SetStateAction<LocalProgress>>;
  checkedObjectives: string[];
  updatePlanner: (fn: (p: PlannerState) => PlannerState) => void;
  /** Hideout stations with level ids; null until progression data loads. */
  stations: Station[] | null;
}

const keyOf = (i: OutboxItem): string => (i.kind === 'level' ? 'level' : `${i.kind}:${i.id}`);

/** Queue `item`, or drop a queued item for the same target when TarkovTracker already matches. */
function reconcile(box: OutboxItem[], item: OutboxItem, matchesRemote: boolean): OutboxItem[] {
  if (!matchesRemote) return enqueue(box, [item]);
  const k = keyOf(item);
  return box.some((i) => keyOf(i) === k) ? box.filter((i) => keyOf(i) !== k) : box;
}

export function useTracker(o: Options) {
  const available = inTauri();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [info, setInfo] = useState<TrackerTokenInfo | null>(null);
  const [cache, setCache] = useState<TrackerCache>(() => loadTrackerCache());
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<TrackerError | null>(null);

  const cacheRef = useRef(cache);
  const optsRef = useRef(o);
  const blockedUntil = useRef(0);
  const pulling = useRef(false);
  const flushing = useRef(false);
  const hasKeyRef = useRef(hasKey);
  useEffect(() => {
    hasKeyRef.current = hasKey;
  }, [hasKey]);

  useEffect(() => {
    optsRef.current = o;
  });
  useEffect(() => {
    saveTrackerCache(cache);
  }, [cache]);

  // Every cache write goes through here, so callbacks always see the latest.
  const writeCache = useCallback((fn: (c: TrackerCache) => TrackerCache) => {
    const next = fn(cacheRef.current);
    if (next === cacheRef.current) return;
    cacheRef.current = next;
    setCache(next);
  }, []);

  const handleError = useCallback((e: TrackerError) => {
    const now = Date.now();
    if (e.code === 'rate_limited') blockedUntil.current = now + (e.retryAfter ?? 900) * 1000;
    else if (e.code === 'unavailable') blockedUntil.current = now + (e.retryAfter ?? 60) * 1000;
    if (e.code === 'not_configured') setHasKey(false);
    setError(e);
  }, []);

  const applyRemote = useCallback(
    (remote: TrackerRemote, etag: string | null, now: number) => {
      const { setProgress, updatePlanner, stations } = optsRef.current;
      const before = cacheRef.current;
      const pending = new Set(before.outbox.filter((i) => i.kind === 'objective').map((i) => (i.kind === 'objective' ? i.id : '')));
      writeCache((c) => ({
        ...c,
        remote,
        etag,
        lastSync: now,
        seenObjectives: remote.objectives,
        seenModules: stations ? remote.hideoutModules : c.seenModules,
      }));
      setProgress((p) => applyRemoteTasks(p, remote));
      updatePlanner((pl) => {
        const checkedObjectives = mergeObjectives(pl.checkedObjectives, before.seenObjectives, remote.objectives, pending);
        const stationLevels = stations
          ? mergeHideout(pl.stationLevels, stations, before.seenModules, remote.hideoutModules)
          : pl.stationLevels;
        return checkedObjectives === pl.checkedObjectives && stationLevels === pl.stationLevels
          ? pl
          : { ...pl, checkedObjectives, stationLevels };
      });
    },
    [writeCache],
  );

  const pull = useCallback(async () => {
    if (!inTauri() || pulling.current || Date.now() < blockedUntil.current) return;
    pulling.current = true;
    setSyncing(true);
    try {
      const c = cacheRef.current;
      const res = await trackerGetProgress(c.remote ? c.etag : null);
      const now = Date.now();
      if (res.notModified) {
        writeCache((x) => ({ ...x, lastSync: now }));
      } else {
        const remote = parseRemote(res.data);
        if (!remote) throw { code: 'unexpected', message: 'unexpected progress payload', retryAfter: null };
        applyRemote(remote, res.etag, now);
      }
      setError(null);
    } catch (e) {
      handleError(asTrackerError(e));
    } finally {
      pulling.current = false;
      setSyncing(false);
    }
  }, [applyRemote, handleError, writeCache]);

  const flush = useCallback(async () => {
    if (!inTauri() || flushing.current || Date.now() < blockedUntil.current) return;
    const box = cacheRef.current.outbox;
    if (box.length === 0) return;
    flushing.current = true;
    const done: OutboxItem[] = [];
    try {
      const tasks = box.filter((i): i is Extract<OutboxItem, { kind: 'task' }> => i.kind === 'task');
      if (tasks.length > 0) {
        const updates = tasks.slice(0, 1000).map(({ id, state }) => ({ id, state }));
        try {
          await trackerUpdateTasks(updates);
        } catch (e) {
          const err = asTrackerError(e);
          // Rejected as invalid (e.g. a quest outside this mode's catalog) or no
          // write permission: retrying would fail the same way, so drop them.
          if (err.code === 'bad_request' || err.code === 'forbidden') done.push(...tasks);
          throw err;
        }
        done.push(...tasks.slice(0, 1000));
        optsRef.current.setProgress((p) => applyPushedTasks(p, updates));
      }
      const level = box.find((i): i is Extract<OutboxItem, { kind: 'level' }> => i.kind === 'level');
      if (level) {
        await trackerSetLevel(level.level);
        done.push(level);
        writeCache((c) => (c.remote ? { ...c, remote: { ...c.remote, playerLevel: level.level } } : c));
      }
      const objectives = box
        .filter((i): i is Extract<OutboxItem, { kind: 'objective' }> => i.kind === 'objective')
        .slice(0, MAX_OBJECTIVES_PER_FLUSH);
      for (const ob of objectives) {
        try {
          await trackerUpdateObjective(ob.id, ob.state);
        } catch (e) {
          const err = asTrackerError(e);
          if (err.code === 'bad_request' || err.code === 'forbidden') done.push(ob);
          throw err;
        }
        done.push(ob);
        writeCache((c) => {
          if (!c.remote) return c;
          const rest = c.remote.objectives.filter((id) => id !== ob.id);
          return { ...c, remote: { ...c.remote, objectives: ob.state === 'completed' ? [...rest, ob.id] : rest } };
        });
      }
      setError(null);
    } catch (e) {
      handleError(asTrackerError(e));
    } finally {
      writeCache((c) => ({ ...c, outbox: dequeue(c.outbox, done) }));
      flushing.current = false;
    }
  }, [handleError, writeCache]);

  const checkKey = useCallback(async () => {
    if (!inTauri()) return;
    try {
      const k = await trackerHasKey();
      setHasKey(k);
      if (!k) {
        setInfo(null);
        return;
      }
      try {
        setInfo(await trackerTokenInfo());
      } catch (e) {
        const err = asTrackerError(e);
        handleError(err);
        if (err.code === 'unauthorized' || err.code === 'bad_key') return;
      }
      await pull();
      await flush();
    } catch (e) {
      handleError(asTrackerError(e));
    }
  }, [flush, handleError, pull]);

  // Startup, polling, and picking the key up when the player comes back from
  // the key window.
  useEffect(() => {
    if (!available) return;
    // Sync with an external system on mount (Credential Manager + the API);
    // checkKey sets state only after its awaits resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkKey();
    const timer = window.setInterval(() => {
      void (async () => {
        if (hasKeyRef.current) {
          await pull();
          await flush();
        }
      })();
    }, POLL_MS);
    const onFocus = () => {
      if (!hasKeyRef.current) void checkKey();
      else if (Date.now() - (cacheRef.current.lastSync ?? 0) > FOCUS_PULL_MS) void pull();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [available, checkKey, flush, pull]);

  // Send queued writes shortly after they are queued.
  const outboxLength = cache.outbox.length;
  useEffect(() => {
    if (!available || !hasKey || outboxLength === 0) return;
    const t = window.setTimeout(() => void flush(), FLUSH_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [available, hasKey, outboxLength, flush]);

  const canWrite = hasKey === true && (info ? info.permissions.includes('WP') : true);
  const pushing = canWrite && cache.autoPush;

  // ---- what to push -----------------------------------------------------------

  // Manual quest status changes.
  const prevOverrides = useRef(o.progress.overrides);
  useEffect(() => {
    const prev = prevOverrides.current;
    prevOverrides.current = o.progress.overrides;
    if (!pushing || prev === o.progress.overrides) return;
    const items = changedOverrides(prev, o.progress.overrides).map((u) => ({ kind: 'task' as const, ...u }));
    if (items.length > 0) writeCache((c) => ({ ...c, outbox: enqueue(c.outbox, items) }));
  }, [o.progress.overrides, pushing, writeCache]);

  // Level entered here. A level that came from a pull equals the remote one, so it is not echoed back.
  const prevLevel = useRef(o.progress.playerLevel);
  useEffect(() => {
    const prev = prevLevel.current;
    prevLevel.current = o.progress.playerLevel;
    if (!pushing || !o.progress.levelSet || prev === o.progress.playerLevel) return;
    const level = o.progress.playerLevel;
    writeCache((c) => ({
      ...c,
      outbox: reconcile(c.outbox, { kind: 'level', level }, c.remote?.playerLevel === level),
    }));
  }, [o.progress.playerLevel, o.progress.levelSet, pushing, writeCache]);

  // Objective ticks. Ticks a pull just applied match the remote copy, so they cancel out.
  const prevChecked = useRef(o.checkedObjectives);
  useEffect(() => {
    const prev = prevChecked.current;
    prevChecked.current = o.checkedObjectives;
    if (!pushing || prev === o.checkedObjectives) return;
    const before = new Set(prev);
    const now = new Set(o.checkedObjectives);
    const toggled = [...new Set([...prev, ...o.checkedObjectives])].filter((id) => before.has(id) !== now.has(id));
    if (toggled.length === 0) return;
    writeCache((c) => {
      const remoteDone = new Set(c.remote?.objectives ?? []);
      let box = c.outbox;
      for (const id of toggled) {
        const checked = now.has(id);
        box = reconcile(box, { kind: 'objective', id, state: checked ? 'completed' : 'uncompleted' }, remoteDone.has(id) === checked);
      }
      return box === c.outbox ? c : { ...c, outbox: box };
    });
  }, [o.checkedObjectives, pushing, writeCache]);

  // Hideout data can arrive after the first pull: apply the levels then.
  const { stations, updatePlanner } = o;
  useEffect(() => {
    const c = cacheRef.current;
    if (!stations || !c.remote || c.seenModules !== null) return;
    const modules = c.remote.hideoutModules;
    updatePlanner((pl) => {
      const stationLevels = mergeHideout(pl.stationLevels, stations, null, modules);
      return stationLevels === pl.stationLevels ? pl : { ...pl, stationLevels };
    });
    writeCache((x) => ({ ...x, seenModules: modules }));
  }, [stations, updatePlanner, writeCache, cache.remote]);

  /** A quest event from the logs that is happening now (not a replay of old logs). */
  const onLiveQuest = useCallback(
    (id: string, status: string) => {
      const state = liveQuestState(status);
      if (!state || !pushing) return;
      writeCache((c) => ({ ...c, outbox: enqueue(c.outbox, [{ kind: 'task', id, state }]) }));
    },
    [pushing, writeCache],
  );

  const diff = useMemo(() => (hasKey && cache.remote ? pendingDiff(o.progress) : []), [hasKey, cache.remote, o.progress]);

  const sendDiff = useCallback(() => {
    if (!canWrite || diff.length === 0) return;
    writeCache((c) => ({ ...c, outbox: enqueue(c.outbox, diff.map((u) => ({ kind: 'task' as const, ...u }))) }));
  }, [canWrite, diff, writeCache]);

  const syncNow = useCallback(async () => {
    // A rate-limit block stays: retrying early only fails again.
    await flush();
    await pull();
  }, [flush, pull]);

  const openKeyWindow = useCallback(async (remove = false) => {
    try {
      await trackerOpenKeyWindow(remove);
    } catch (e) {
      setError(asTrackerError(e));
    }
  }, []);

  const removeKey = useCallback(async () => {
    try {
      await trackerRemoveKey();
      setHasKey(false);
      setInfo(null);
      setError(null);
      writeCache((c) => ({ ...EMPTY_TRACKER_CACHE, autoPush: c.autoPush }));
      optsRef.current.setProgress((p) => ({ ...p, remoteCompletedIds: [], remoteFailedIds: [] }));
    } catch (e) {
      setError(asTrackerError(e));
    }
  }, [writeCache]);

  const setAutoPush = useCallback((on: boolean) => writeCache((c) => ({ ...c, autoPush: on })), [writeCache]);

  return {
    available,
    hasKey,
    info,
    syncing,
    error,
    canWrite,
    lastSync: cache.lastSync,
    displayName: cache.remote?.displayName ?? '',
    autoPush: cache.autoPush,
    setAutoPush,
    outboxCount: cache.outbox.length,
    diffCount: diff.length,
    sendDiff,
    syncNow,
    recheck: checkKey,
    openKeyWindow,
    removeKey,
    onLiveQuest,
  };
}

export type TrackerApi = ReturnType<typeof useTracker>;
