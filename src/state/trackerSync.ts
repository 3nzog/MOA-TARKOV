// TarkovTracker sync rules. Pure, so they are tested without the network; the
// hook in app/useTracker.ts does the I/O.
//
// Direction of each piece of data:
//   quests      pull: a separate layer in LocalProgress (remote*Ids), below the
//               logs. push: only live log events and the player's own manual
//               changes, never a bulk re-send of old log history (after a wipe
//               that would refill a fresh TarkovTracker with last wipe's
//               quests). Bulk sending is a separate, explicit button.
//   objectives  pull: three-way merge against the last pulled copy, so only
//               changes made on TarkovTracker since then move a tick. push: the
//               player's ticks.
//   hideout     pull only (the API has no hideout write). Only raises levels.
//   level       max of both sides. faction: pulled while the player has not
//               set one here (the API has no faction write).
import type { Station } from '../progression/types';
import {
  effectiveStatus,
  setPlayerLevel,
  type Faction,
  type LocalProgress,
  type QuestOverride,
  type QuestOverrideStatus,
} from './localProgress';

export type TaskState = 'completed' | 'uncompleted' | 'failed';
export type ObjectiveState = 'completed' | 'uncompleted';

export interface TrackerRemote {
  completed: string[];
  failed: string[];
  objectives: string[];
  hideoutModules: string[];
  playerLevel: number | null;
  faction: Faction | null;
  displayName: string;
}

export type OutboxItem =
  | { kind: 'task'; id: string; state: TaskState }
  | { kind: 'objective'; id: string; state: ObjectiveState }
  | { kind: 'level'; level: number };

export interface TaskUpdate {
  id: string;
  state: TaskState;
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const rows = (d: Row, k: string): Row[] => (Array.isArray(d[k]) ? (d[k] as unknown[]).filter(isRow) : []);
const ids = (list: Row[], keep: (r: Row) => boolean): string[] =>
  list.filter(keep).map((r) => r.id).filter((id): id is string => typeof id === 'string' && id.length > 0);

/** The `data` object of GET /progress, read defensively. null = not a progress payload. */
export function parseRemote(data: unknown): TrackerRemote | null {
  if (!isRow(data) || !Array.isArray(data.tasksProgress)) return null;
  const tasks = rows(data, 'tasksProgress').filter((r) => r.invalid !== true);
  const level = data.playerLevel;
  return {
    // A failed quest may also carry complete: true; failed wins.
    failed: ids(tasks, (r) => r.failed === true),
    completed: ids(tasks, (r) => r.complete === true && r.failed !== true),
    objectives: ids(rows(data, 'taskObjectivesProgress'), (r) => r.complete === true && r.invalid !== true),
    hideoutModules: ids(rows(data, 'hideoutModulesProgress'), (r) => r.complete === true),
    playerLevel: typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 79 ? level : null,
    faction: data.pmcFaction === 'USEC' || data.pmcFaction === 'BEAR' ? data.pmcFaction : null,
    displayName: typeof data.displayName === 'string' ? data.displayName.slice(0, 64) : '',
  };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Lay the pulled quest state, level and faction over local progress. */
export function applyRemoteTasks(p: LocalProgress, r: TrackerRemote): LocalProgress {
  let next = p;
  if (!sameList(p.remoteCompletedIds, r.completed) || !sameList(p.remoteFailedIds, r.failed)) {
    next = { ...next, remoteCompletedIds: r.completed, remoteFailedIds: r.failed };
  }
  if (r.playerLevel !== null && (!next.levelSet || r.playerLevel > next.playerLevel)) {
    next = setPlayerLevel(next, r.playerLevel);
  }
  if (r.faction && !next.factionSet) next = { ...next, faction: r.faction, factionSet: true };
  return next;
}

/**
 * Objective ticks after a pull. Only what changed on TarkovTracker since the
 * last pull (`prevSeen`) moves a tick; ticks waiting to be sent are left alone.
 * First pull (`prevSeen` null): add remote ticks, remove nothing.
 */
export function mergeObjectives(
  checked: string[],
  prevSeen: string[] | null,
  remote: string[],
  pending: ReadonlySet<string>,
): string[] {
  const seen = new Set(prevSeen ?? []);
  const now = new Set(remote);
  const out = new Set(checked);
  for (const id of now) if (!seen.has(id) && !pending.has(id)) out.add(id);
  if (prevSeen) for (const id of seen) if (!now.has(id) && !pending.has(id)) out.delete(id);
  if (out.size === checked.length && checked.every((id) => out.has(id))) return checked;
  return [...out];
}

/** Built hideout levels after a pull: newly built remote levels raise a station, never lower it. */
export function mergeHideout(
  levels: Record<string, number>,
  stations: Station[],
  prevSeen: string[] | null,
  remote: string[],
): Record<string, number> {
  const seen = new Set(prevSeen ?? []);
  const fresh = new Set(remote.filter((id) => !seen.has(id)));
  if (fresh.size === 0) return levels;
  let next = levels;
  for (const s of stations) {
    for (const l of s.levels) {
      if (l.id && fresh.has(l.id) && l.level > (next[s.id] ?? 0)) {
        next = { ...next, [s.id]: l.level };
      }
    }
  }
  return next;
}

export const overrideToState = (s: QuestOverrideStatus): TaskState =>
  s === 'complete' ? 'completed' : s === 'failed' ? 'failed' : 'uncompleted';

/** Overrides the player set or changed between two progress snapshots. */
export function changedOverrides(
  prev: Record<string, QuestOverride>,
  cur: Record<string, QuestOverride>,
): TaskUpdate[] {
  const out: TaskUpdate[] = [];
  for (const [id, o] of Object.entries(cur)) {
    const before = prev[id];
    if (!before || before.status !== o.status || before.at !== o.at) out.push({ id, state: overrideToState(o.status) });
  }
  return out;
}

export function liveQuestState(status: string): TaskState | null {
  if (status === 'Finished') return 'completed';
  if (status === 'Failed') return 'failed';
  return null;
}

/**
 * What MoA knows (logs + manual) that TarkovTracker does not. For the explicit
 * "send differences" button; never sent on its own.
 */
export function pendingDiff(p: LocalProgress): TaskUpdate[] {
  const local = { ...p, remoteCompletedIds: [], remoteFailedIds: [] };
  const rc = new Set(p.remoteCompletedIds);
  const rf = new Set(p.remoteFailedIds);
  const candidates = new Set([...p.completedQuestIds, ...p.failedQuestIds, ...Object.keys(p.overrides)]);
  const out: TaskUpdate[] = [];
  for (const id of candidates) {
    const s = effectiveStatus(local, id);
    if (s === 'complete' && !rc.has(id)) out.push({ id, state: 'completed' });
    else if (s === 'failed' && !rf.has(id)) out.push({ id, state: 'failed' });
    else if ((s === 'active' || s === 'none') && (rc.has(id) || rf.has(id))) out.push({ id, state: 'uncompleted' });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** After a successful task write, make the remote layer match what was sent. */
export function applyPushedTasks(p: LocalProgress, sent: TaskUpdate[]): LocalProgress {
  if (sent.length === 0) return p;
  const rc = new Set(p.remoteCompletedIds);
  const rf = new Set(p.remoteFailedIds);
  for (const u of sent) {
    rc.delete(u.id);
    rf.delete(u.id);
    if (u.state === 'completed') rc.add(u.id);
    if (u.state === 'failed') rf.add(u.id);
  }
  return { ...p, remoteCompletedIds: [...rc], remoteFailedIds: [...rf] };
}

const keyOf = (i: OutboxItem): string => (i.kind === 'level' ? 'level' : `${i.kind}:${i.id}`);

/** Add items to the outbox; a newer item for the same task/objective/level replaces the older one. */
export function enqueue(box: OutboxItem[], items: OutboxItem[]): OutboxItem[] {
  if (items.length === 0) return box;
  const map = new Map(box.map((i) => [keyOf(i), i] as const));
  for (const i of items) {
    map.delete(keyOf(i));
    map.set(keyOf(i), i);
  }
  return [...map.values()];
}

/** Remove exactly these items (by identity of key and value) from the outbox. */
export function dequeue(box: OutboxItem[], done: OutboxItem[]): OutboxItem[] {
  const gone = new Set(done.map((i) => JSON.stringify(i)));
  return box.filter((i) => !gone.has(JSON.stringify(i)));
}

// ---- persisted, non-secret sync state ----------------------------------------

const STORAGE_KEY = 'tc_tracker_v1';

export interface TrackerCache {
  remote: TrackerRemote | null;
  etag: string | null;
  seenObjectives: string[] | null;
  seenModules: string[] | null;
  outbox: OutboxItem[];
  autoPush: boolean;
  lastSync: number | null;
}

export const EMPTY_TRACKER_CACHE: TrackerCache = {
  remote: null,
  etag: null,
  seenObjectives: null,
  seenModules: null,
  outbox: [],
  autoPush: true,
  lastSync: null,
};

const strs = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;

function parseOutbox(v: unknown): OutboxItem[] {
  if (!Array.isArray(v)) return [];
  const out: OutboxItem[] = [];
  for (const i of v) {
    if (!isRow(i)) continue;
    if (i.kind === 'level' && typeof i.level === 'number' && i.level >= 1 && i.level <= 79) out.push({ kind: 'level', level: i.level });
    else if (i.kind === 'task' && typeof i.id === 'string' && (i.state === 'completed' || i.state === 'uncompleted' || i.state === 'failed'))
      out.push({ kind: 'task', id: i.id, state: i.state });
    else if (i.kind === 'objective' && typeof i.id === 'string' && (i.state === 'completed' || i.state === 'uncompleted'))
      out.push({ kind: 'objective', id: i.id, state: i.state });
  }
  return out;
}

export function parseTrackerCache(raw: string | null): TrackerCache {
  if (!raw) return { ...EMPTY_TRACKER_CACHE };
  try {
    const c = JSON.parse(raw) as Row;
    const remote = isRow(c.remote) ? c.remote : null;
    return {
      remote: remote
        ? {
            completed: strs(remote.completed) ?? [],
            failed: strs(remote.failed) ?? [],
            objectives: strs(remote.objectives) ?? [],
            hideoutModules: strs(remote.hideoutModules) ?? [],
            playerLevel: typeof remote.playerLevel === 'number' ? remote.playerLevel : null,
            faction: remote.faction === 'USEC' || remote.faction === 'BEAR' ? remote.faction : null,
            displayName: typeof remote.displayName === 'string' ? remote.displayName : '',
          }
        : null,
      etag: typeof c.etag === 'string' ? c.etag : null,
      seenObjectives: strs(c.seenObjectives),
      seenModules: strs(c.seenModules),
      outbox: parseOutbox(c.outbox),
      autoPush: c.autoPush !== false,
      lastSync: typeof c.lastSync === 'number' ? c.lastSync : null,
    };
  } catch {
    return { ...EMPTY_TRACKER_CACHE };
  }
}

export function loadTrackerCache(): TrackerCache {
  try {
    return parseTrackerCache(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...EMPTY_TRACKER_CACHE };
  }
}

export function saveTrackerCache(c: TrackerCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // quota — sync state is rebuilt by the next pull
  }
}
