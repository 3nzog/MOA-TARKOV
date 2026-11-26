// Quest status for the whole task list: what is done, what is in progress, what
// can be picked up now, and — for the rest — exactly why not.
//
// Inputs are only what we actually know:
//   - the log-driven quest sets + the player's manual overrides (effectiveStatus)
//   - the prerequisite graph and gates from tarkov.dev (TaskMeta)
//   - the level / faction the PLAYER entered, if any (null = unknown → no gate)
//
// One inference is made, and it is flagged wherever it is shown: if the player
// has accepted or completed a quest, every prerequisite that had to be
// COMPLETE for it to unlock must be complete. That recovers completions the
// logs missed (the app was closed, the logs were rotated) without guessing.
import type { TarkovTask } from '../api/types';
import type { Faction, ReqStatus, TaskMeta } from './types';

export type BaseStatus = 'active' | 'complete' | 'failed' | 'none';
export type QuestStatus = 'complete' | 'failed' | 'active' | 'available' | 'locked';

export type LockReason =
  | { kind: 'prereq'; taskId: string; need: ReqStatus[] }
  | { kind: 'level'; need: number }
  | { kind: 'faction'; need: Faction };

export interface QuestInfo {
  status: QuestStatus;
  /** 'complete' was inferred from a later quest, not seen in the logs. */
  inferred: boolean;
  /** The status comes from a manual override. */
  manual: boolean;
  /** The logs still say active, but a later quest proves it is complete. */
  staleActive: boolean;
  lockReasons: LockReason[];
}

export interface ProfileFacts {
  level: number | null;
  faction: Faction | null;
}

export interface StatusInput {
  tasks: TarkovTask[];
  meta: Record<string, TaskMeta>;
  baseStatus: (taskId: string) => BaseStatus;
  isManual: (taskId: string) => boolean;
  profile: ProfileFacts;
}

/** Only requirements that demand COMPLETE (and nothing else) prove completion. */
function provesComplete(need: ReqStatus[]): boolean {
  return need.length === 1 && need[0] === 'complete';
}

export function computeQuestStatuses(input: StatusInput): Map<string, QuestInfo> {
  const { tasks, meta, baseStatus, isManual, profile } = input;
  const known = new Set(tasks.map((t) => t.id));

  // 1. Inference: walk prerequisites up from every quest the player has taken.
  const inferredComplete = new Set<string>();
  const stack: string[] = [];
  for (const t of tasks) {
    const b = baseStatus(t.id);
    if (b === 'active' || b === 'complete') stack.push(t.id);
  }
  const visited = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const req of meta[id]?.requires ?? []) {
      if (!known.has(req.taskId) || !provesComplete(req.status)) continue;
      // Never override something the player set by hand, or a recorded failure.
      const b = baseStatus(req.taskId);
      if (b === 'failed' || isManual(req.taskId)) continue;
      if (b !== 'complete') inferredComplete.add(req.taskId);
      stack.push(req.taskId);
    }
  }

  // 2. Resolved status of quests that have a known state.
  const resolved = new Map<string, 'active' | 'complete' | 'failed' | 'none'>();
  for (const t of tasks) {
    const b = baseStatus(t.id);
    resolved.set(t.id, inferredComplete.has(t.id) ? 'complete' : b);
  }

  // 3. Everything not yet taken: available or locked, with reasons.
  const out = new Map<string, QuestInfo>();
  for (const t of tasks) {
    const r = resolved.get(t.id)!;
    const manual = isManual(t.id);
    const inferred = inferredComplete.has(t.id);
    const staleActive = inferred && baseStatus(t.id) === 'active';
    if (r !== 'none') {
      out.set(t.id, { status: r, inferred, manual, staleActive, lockReasons: [] });
      continue;
    }
    const m = meta[t.id];
    const reasons: LockReason[] = [];
    for (const req of m?.requires ?? []) {
      if (!known.has(req.taskId)) continue; // unknown upstream id — cannot judge, do not block
      const s = resolved.get(req.taskId)!;
      if (!req.status.includes(s as ReqStatus)) {
        reasons.push({ kind: 'prereq', taskId: req.taskId, need: req.status });
      }
    }
    if (m && profile.level !== null && m.minLevel > profile.level) {
      reasons.push({ kind: 'level', need: m.minLevel });
    }
    if (m?.faction && profile.faction !== null && m.faction !== profile.faction) {
      reasons.push({ kind: 'faction', need: m.faction });
    }
    out.set(t.id, {
      status: reasons.length ? 'locked' : 'available',
      inferred: false,
      manual,
      staleActive: false,
      lockReasons: reasons,
    });
  }
  return out;
}

/**
 * The player's side, told by the quests they took: only BEAR gets the BEAR
 * copy of a quest (and USEC the USEC one). null when no such quest was taken,
 * or both sides' were (manual marks gone wrong — no guess then).
 */
export function inferFaction(
  tasks: TarkovTask[],
  meta: Record<string, TaskMeta>,
  baseStatus: (taskId: string) => BaseStatus,
): Faction | null {
  const sides = new Set<Faction>();
  for (const t of tasks) {
    const f = meta[t.id]?.faction;
    if (f && baseStatus(t.id) !== 'none') sides.add(f);
  }
  return sides.size === 1 ? [...sides][0] : null;
}

/** Reverse edges: quest id → quests that list it as a prerequisite. */
export function buildUnlocks(meta: Record<string, TaskMeta>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, m] of Object.entries(meta)) {
    for (const req of m.requires) {
      const list = out.get(req.taskId) ?? [];
      list.push(id);
      out.set(req.taskId, list);
    }
  }
  return out;
}

/** Number of distinct quests reachable downstream of `id` (its whole unlock subtree). */
export function countDownstream(id: string, unlocks: Map<string, string[]>): number {
  const seen = new Set<string>();
  const stack = [...(unlocks.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(unlocks.get(next) ?? []));
  }
  return seen.size;
}

export interface Suggestion {
  taskId: string;
  downstream: number;
  kappa: boolean;
}

/**
 * Available quests ranked by how much they open up: downstream unlocks first,
 * Kappa-required as the tie-break. A transparent heuristic, labelled as such in
 * the UI — the game gives no "best next quest" signal.
 */
export function suggestNext(
  statuses: Map<string, QuestInfo>,
  meta: Record<string, TaskMeta>,
  limit = 5,
): Suggestion[] {
  const unlocks = buildUnlocks(meta);
  const out: Suggestion[] = [];
  for (const [id, info] of statuses) {
    if (info.status !== 'available') continue;
    out.push({ taskId: id, downstream: countDownstream(id, unlocks), kappa: meta[id]?.kappa ?? false });
  }
  out.sort((a, b) => b.downstream - a.downstream || Number(b.kappa) - Number(a.kappa));
  return out.slice(0, limit);
}

export interface RequirementNode {
  taskId: string;
  need: ReqStatus[];
  children: RequirementNode[];
  /** Already shown higher up in this tree (shared prerequisite) — not expanded again. */
  repeated: boolean;
}

/** Prerequisite tree above `id`, depth-limited and de-duplicated so diamonds stay readable. */
export function requirementTree(
  id: string,
  meta: Record<string, TaskMeta>,
  maxDepth = 6,
): RequirementNode[] {
  const seen = new Set<string>([id]);
  const walk = (taskId: string, depth: number): RequirementNode[] =>
    (meta[taskId]?.requires ?? []).map((req) => {
      const repeated = seen.has(req.taskId);
      seen.add(req.taskId);
      return {
        taskId: req.taskId,
        need: req.status,
        repeated,
        children: repeated || depth >= maxDepth ? [] : walk(req.taskId, depth + 1),
      };
    });
  return walk(id, 1);
}
