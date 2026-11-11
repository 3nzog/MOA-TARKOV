// Local progress store — replaces TarkovTracker as the source of truth in v0.3.
// Populated by the EFT log watcher, not by user UI. v0.3 hardcodes faction to
// USEC; faction picker comes later.
//
// v0.3.5: the store now tracks THREE quest states, all sourced from EFT
// push-notification events (`quest-event` Tauri events):
//   - accepted   ← type 10 "description"        (player picked up the quest)
//   - completed  ← type 12 "successMessageText"  (player finished the quest)
//   - failed     ← type 11                       (player failed the quest)
//
// "Active" quests (sidebar + map markers) = accepted AND not completed/failed.
// Previously we only tracked completions and inferred "available" from quest
// prerequisites, which surfaced quests the player had never actually accepted.
import type { TarkovTrackerProgress, TaskProgress } from '../api/types';

const STORAGE_KEY = 'tc_local_progress_v1';

export type Faction = 'USEC' | 'BEAR';

// A status the player set by hand. 'none' = "I have not taken this quest".
// Overrides sit ON TOP of the grow-only log sets instead of editing them, so a
// manual correction is always reversible and never poisons replay convergence.
export type QuestOverrideStatus = 'active' | 'complete' | 'failed' | 'none';
export interface QuestOverride {
  status: QuestOverrideStatus;
  /** When the player set it (ms). A log event newer than this clears it. */
  at: number;
}

export interface LocalProgress {
  acceptedQuestIds: string[];
  completedQuestIds: string[];
  failedQuestIds: string[];
  playerLevel: number;
  faction: Faction;
  // The game never tells a passive reader its level or faction. These flags
  // record whether the PLAYER told us — until then, nothing is gated on them
  // (see the note in quests/derive.ts about why a guessed gate is worse).
  levelSet: boolean;
  factionSet: boolean;
  overrides: Record<string, QuestOverride>;
  // Last copy of the player's TarkovTracker progress (see state/trackerSync).
  // A separate layer, replaced on every pull: the log sets stay what the game
  // said, and the layer only fills in quests the logs never saw finish.
  remoteCompletedIds: string[];
  remoteFailedIds: string[];
}

const EMPTY: LocalProgress = {
  acceptedQuestIds: [],
  completedQuestIds: [],
  failedQuestIds: [],
  playerLevel: 1,
  faction: 'USEC',
  levelSet: false,
  factionSet: false,
  overrides: {},
  remoteCompletedIds: [],
  remoteFailedIds: [],
};

const OVERRIDE_STATUSES: ReadonlySet<string> = new Set(['active', 'complete', 'failed', 'none']);

function parseOverrides(raw: unknown): Record<string, QuestOverride> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, QuestOverride> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as Partial<QuestOverride> | null;
    if (o && typeof o.status === 'string' && OVERRIDE_STATUSES.has(o.status) && typeof o.at === 'number') {
      out[id] = { status: o.status as QuestOverrideStatus, at: o.at };
    }
  }
  return out;
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function loadProgress(): LocalProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<LocalProgress>;
    return {
      acceptedQuestIds: Array.isArray(parsed.acceptedQuestIds) ? parsed.acceptedQuestIds : [],
      completedQuestIds: Array.isArray(parsed.completedQuestIds) ? parsed.completedQuestIds : [],
      failedQuestIds: Array.isArray(parsed.failedQuestIds) ? parsed.failedQuestIds : [],
      playerLevel: typeof parsed.playerLevel === 'number' ? parsed.playerLevel : 1,
      faction: parsed.faction === 'BEAR' ? 'BEAR' : 'USEC',
      levelSet: parsed.levelSet === true,
      factionSet: parsed.factionSet === true,
      overrides: parseOverrides(parsed.overrides),
      remoteCompletedIds: stringList(parsed.remoteCompletedIds),
      remoteFailedIds: stringList(parsed.remoteFailedIds),
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveProgress(p: LocalProgress): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function addId(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id];
}

function removeId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : list;
}

// The three quest-state sets are purely ADDITIVE. "Active" is derived as
// accepted AND NOT completed AND NOT failed (see derive.ts / toTrackerProgress).
// Making them grow-only keeps replay order-independent: EFT re-logs old
// "description" (type-10) notifications for already-finished quests in later
// sessions, so if accept could un-complete a quest, replay file order would
// decide whether a finished quest wrongly reappears. Completion/failure always
// win. (Trade-off: repeatable quests re-accepted after completion won't
// reappear — acceptable for now.)
export function markQuestAccepted(p: LocalProgress, id: string): LocalProgress {
  const acceptedQuestIds = addId(p.acceptedQuestIds, id);
  if (acceptedQuestIds === p.acceptedQuestIds) return p;
  return { ...p, acceptedQuestIds };
}

export function markQuestComplete(p: LocalProgress, id: string): LocalProgress {
  const completedQuestIds = addId(p.completedQuestIds, id);
  if (completedQuestIds === p.completedQuestIds) return p;
  return { ...p, completedQuestIds };
}

export function markQuestFailed(p: LocalProgress, id: string): LocalProgress {
  const failedQuestIds = addId(p.failedQuestIds, id);
  if (failedQuestIds === p.failedQuestIds) return p;
  return { ...p, failedQuestIds };
}

export function markQuestIncomplete(p: LocalProgress, id: string): LocalProgress {
  return { ...p, completedQuestIds: removeId(p.completedQuestIds, id) };
}

export function setPlayerLevel(p: LocalProgress, level: number): LocalProgress {
  const clamped = Math.max(1, Math.min(79, Math.round(level)));
  if (p.playerLevel === clamped && p.levelSet) return p;
  return { ...p, playerLevel: clamped, levelSet: true };
}

export function clearPlayerLevel(p: LocalProgress): LocalProgress {
  return p.levelSet ? { ...p, levelSet: false } : p;
}

export function setFaction(p: LocalProgress, faction: Faction | null): LocalProgress {
  if (faction === null) return p.factionSet ? { ...p, factionSet: false } : p;
  if (p.faction === faction && p.factionSet) return p;
  return { ...p, faction, factionSet: true };
}

/** Set (or with `null`, clear) a manual status for one quest. */
export function setQuestOverride(
  p: LocalProgress,
  id: string,
  status: QuestOverrideStatus | null,
  now: number = Date.now(),
): LocalProgress {
  if (status === null) {
    if (!(id in p.overrides)) return p;
    const next = { ...p.overrides };
    delete next[id];
    return { ...p, overrides: next };
  }
  return { ...p, overrides: { ...p.overrides, [id]: { status, at: now } } };
}

/**
 * A log event about `id` that happened at `eventAt` (ms). A manual override
 * older than the event is stale — the game has moved on since the player set it
 * — so it is dropped and the log state shows through again. Events with no
 * timestamp (older builds of the watcher) never clear an override: a replay of
 * old logs must not undo a correction the player made after those logs.
 */
export function expireOverrideByEvent(
  p: LocalProgress,
  id: string,
  eventAt: number | null,
): LocalProgress {
  const o = p.overrides[id];
  if (!o || eventAt === null || eventAt <= o.at) return p;
  return setQuestOverride(p, id, null);
}

/** Effective per-quest status after overrides — the single reading every view uses. */
export function effectiveStatus(
  p: LocalProgress,
  id: string,
): 'active' | 'complete' | 'failed' | 'none' {
  const o = p.overrides[id];
  if (o) return o.status;
  if (p.failedQuestIds.includes(id)) return 'failed';
  if (p.completedQuestIds.includes(id)) return 'complete';
  // TarkovTracker knows finishes the logs never showed (older wipes of logs,
  // another PC). It ranks below the logs and above a mere "accepted".
  if (p.remoteFailedIds.includes(id)) return 'failed';
  if (p.remoteCompletedIds.includes(id)) return 'complete';
  if (p.acceptedQuestIds.includes(id)) return 'active';
  return 'none';
}

// Bridge into the shape deriveQuestState consumes. Lets us drop the
// TarkovTracker dependency without touching the derive consumer contract.
// Entries are merged by id so a quest that was accepted *and* later completed
// becomes a single TaskProgress carrying both flags.
export function toTrackerProgress(p: LocalProgress): TarkovTrackerProgress {
  const byId = new Map<string, TaskProgress>();
  const entry = (id: string): TaskProgress => {
    let e = byId.get(id);
    if (!e) {
      e = { id, complete: false, failed: false, invalid: false, accepted: false };
      byId.set(id, e);
    }
    return e;
  };
  for (const id of p.acceptedQuestIds) entry(id).accepted = true;
  for (const id of p.completedQuestIds) entry(id).complete = true;
  for (const id of p.failedQuestIds) entry(id).failed = true;
  for (const id of p.remoteCompletedIds) {
    const e = entry(id);
    if (!e.failed) e.complete = true;
  }
  for (const id of p.remoteFailedIds) {
    const e = entry(id);
    if (!e.complete) e.failed = true;
  }
  // Manual overrides replace whatever the logs said for that quest.
  for (const [id, o] of Object.entries(p.overrides ?? {})) {
    const e = entry(id);
    e.accepted = o.status === 'active';
    e.complete = o.status === 'complete';
    e.failed = o.status === 'failed';
  }

  return {
    playerLevel: p.playerLevel,
    pmcFaction: p.faction,
    tasksProgress: Array.from(byId.values()),
  };
}
