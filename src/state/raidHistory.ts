// Raid history from the log watcher's raid-started / raid-ended events.
//
// What the logs actually carry, and therefore all this can know: the map, and
// when the raid started and ended. Survival, kills, loot value and XP are not in
// any log a passive reader can see — so they are not here, and the UI does not
// pretend otherwise.
//
// Events from "Sync past logs" replay arrive again with their ORIGINAL log
// timestamp (logTime), which is what makes them de-duplicable. Events without a
// timestamp (an older watcher) are recorded with the time they arrived.

const STORAGE_KEY = 'tc_raid_history_v1';
const MAX_RAIDS = 2000;
const MAX_QUEST_EVENTS = 4000;

export type RaidSide = 'pmc' | 'scav';

export interface RaidRecord {
  /** BSG location token from the logs, e.g. "Sandbox". null = not seen. */
  location: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /**
   * Fingerprint of the profile that entered the raid (computed in the Rust
   * core; the profile id itself never reaches the UI). A PMC and its Scav are
   * two profiles, so this is what tells the two kinds of raid apart.
   */
  profileKey?: string | null;
}

/** "My squad entered as Scav / PMC" — from a group-ready notification. */
export interface GroupSideRecord {
  side: RaidSide;
  at: number;
}

export interface QuestEventRecord {
  templateId: string;
  status: 'Started' | 'Failed' | 'Finished';
  at: number;
}

export interface RaidHistory {
  raids: RaidRecord[];
  questEvents: QuestEventRecord[];
  groupSides?: GroupSideRecord[];
  /** Fingerprint → side, set by the player; wins over anything inferred. */
  manualSides?: Record<string, RaidSide>;
  /** Fingerprint → side proven by an O+O list (PMC-only or Scav-only exits in it). */
  panelSides?: Record<string, RaidSide>;
}

export const EMPTY_HISTORY: RaidHistory = { raids: [], questEvents: [] };
const MAX_GROUP_SIDES = 500;
// A group-ready notification belongs to the raid that starts within this time.
const GROUP_TO_RAID_MS = 15 * 60 * 1000;

// A start and an end further apart than this are not the same raid.
const MAX_RAID_MS = 3 * 60 * 60 * 1000;

export function recordRaidStart(
  h: RaidHistory,
  location: string | null,
  at: number,
  profileKey: string | null = null,
): RaidHistory {
  const existing = h.raids.findIndex((r) => r.startedAt === at);
  if (existing >= 0) {
    // Replayed. Recorded before the watcher sent fingerprints? Fill it in.
    if (!profileKey || h.raids[existing].profileKey) return h;
    const raids = [...h.raids];
    raids[existing] = { ...raids[existing], profileKey };
    return { ...h, raids };
  }
  const raids = [...h.raids, { location, startedAt: at, endedAt: null, profileKey }];
  raids.sort((a, b) => (a.startedAt ?? a.endedAt ?? 0) - (b.startedAt ?? b.endedAt ?? 0));
  return { ...h, raids: raids.slice(-MAX_RAIDS) };
}

export function recordRaidEnd(h: RaidHistory, location: string | null, at: number): RaidHistory {
  if (h.raids.some((r) => r.endedAt === at)) return h; // replayed
  // Close the latest open raid that started before this end, on the same map
  // when both sides know it.
  let idx = -1;
  for (let i = h.raids.length - 1; i >= 0; i--) {
    const r = h.raids[i];
    if (r.endedAt !== null || r.startedAt === null) continue;
    if (r.startedAt > at || at - r.startedAt > MAX_RAID_MS) continue;
    if (location && r.location && r.location.toLowerCase() !== location.toLowerCase()) continue;
    idx = i;
    break;
  }
  const raids = [...h.raids];
  if (idx >= 0) {
    raids[idx] = { ...raids[idx], endedAt: at, location: raids[idx].location ?? location };
  } else {
    raids.push({ location, startedAt: null, endedAt: at });
    raids.sort((a, b) => (a.startedAt ?? a.endedAt ?? 0) - (b.startedAt ?? b.endedAt ?? 0));
  }
  return { ...h, raids: raids.slice(-MAX_RAIDS) };
}

export function recordQuestEvent(h: RaidHistory, ev: QuestEventRecord): RaidHistory {
  if (h.questEvents.some((e) => e.at === ev.at && e.templateId === ev.templateId && e.status === ev.status)) {
    return h;
  }
  return { ...h, questEvents: [...h.questEvents, ev].slice(-MAX_QUEST_EVENTS) };
}

/** A log scan, timestamps already parsed (ms; null = unknown, skipped). */
export interface ParsedSideScan {
  raids: { location: string | null; profileKey: string; at: number | null }[];
  groups: { side: string; at: number | null }[];
  ends: { location: string | null; at: number | null }[];
}

/**
 * Fold a scan of the logs on disk into the history, so PMC vs Scav is learned
 * without the player first running "Sync past logs". Starts go in before ends
 * (an end closes the start before it), and every step de-duplicates, so the
 * scan can run on every launch.
 */
export function mergeSideScan(h: RaidHistory, scan: ParsedSideScan): RaidHistory {
  const byTime = <T extends { at: number | null }>(list: T[]) =>
    list.filter((x): x is T & { at: number } => x.at !== null).sort((a, b) => a.at - b.at);
  let next = h;
  for (const r of byTime(scan.raids)) next = recordRaidStart(next, r.location, r.at, r.profileKey);
  for (const g of byTime(scan.groups)) {
    if (g.side === 'pmc' || g.side === 'scav') next = recordGroupSide(next, g.side, g.at);
  }
  for (const e of byTime(scan.ends)) next = recordRaidEnd(next, e.location, e.at);
  return next;
}

export function recordGroupSide(h: RaidHistory, side: RaidSide, at: number): RaidHistory {
  const list = h.groupSides ?? [];
  if (list.some((g) => g.at === at && g.side === side)) return h; // replayed
  return { ...h, groupSides: [...list, { side, at }].slice(-MAX_GROUP_SIDES) };
}

export function setManualSide(h: RaidHistory, profileKey: string, side: RaidSide | null): RaidHistory {
  const next = { ...(h.manualSides ?? {}) };
  if (side) next[profileKey] = side;
  else delete next[profileKey];
  // "Detect on its own" forgets what the O+O list said too.
  const panel = { ...(h.panelSides ?? {}) };
  if (!side) delete panel[profileKey];
  return { ...h, manualSides: next, panelSides: panel };
}

/**
 * The O+O list proved this profile's side. It is fresh evidence, so it
 * replaces an older manual mark for the same profile (a later manual mark
 * replaces it in turn: the last word wins).
 */
export function setPanelSide(h: RaidHistory, profileKey: string, side: RaidSide): RaidHistory {
  const panel = { ...(h.panelSides ?? {}), [profileKey]: side };
  const manual = { ...(h.manualSides ?? {}) };
  delete manual[profileKey];
  return { ...h, panelSides: panel, manualSides: manual };
}

export type SideSource = 'manual' | 'panel' | 'group' | 'elimination';

export interface SideKnowledge {
  /** Fingerprint → side. */
  sides: Map<string, RaidSide>;
  /** How each entry was learned. */
  source: Map<string, SideSource>;
}

/**
 * Which profile fingerprint is the PMC and which the Scav.
 *
 *  1. The player said so (manual), or an O+O list proved it (panel); the
 *     newer of the two is kept (setPanelSide / setManualSide).
 *  2. A group-ready notification said the squad goes in as Scav / PMC, and a
 *     raid started shortly after: that raid's fingerprint is that side. Votes
 *     are counted, so one odd pairing cannot flip a well-established answer.
 *  3. Elimination: an account has exactly one PMC and one Scav profile, so if
 *     only two fingerprints were ever seen and one is known, so is the other.
 */
export function learnSides(h: RaidHistory): SideKnowledge {
  const sides = new Map<string, RaidSide>();
  const source = new Map<string, SideSource>();
  for (const [key, side] of Object.entries(h.manualSides ?? {})) {
    sides.set(key, side);
    source.set(key, 'manual');
  }
  for (const [key, side] of Object.entries(h.panelSides ?? {})) {
    if (sides.has(key)) continue;
    sides.set(key, side);
    source.set(key, 'panel');
  }

  const votes = new Map<string, { pmc: number; scav: number }>();
  const starts = h.raids
    .filter((r): r is RaidRecord & { startedAt: number; profileKey: string } => r.startedAt !== null && !!r.profileKey)
    .sort((a, b) => a.startedAt - b.startedAt);
  for (const g of h.groupSides ?? []) {
    const raid = starts.find((r) => r.startedAt > g.at && r.startedAt - g.at <= GROUP_TO_RAID_MS);
    if (!raid) continue;
    const v = votes.get(raid.profileKey) ?? { pmc: 0, scav: 0 };
    v[g.side] += 1;
    votes.set(raid.profileKey, v);
  }
  for (const [key, v] of votes) {
    if (sides.has(key) || v.pmc === v.scav) continue;
    sides.set(key, v.scav > v.pmc ? 'scav' : 'pmc');
    source.set(key, 'group');
  }

  const seen = Array.from(new Set(starts.map((r) => r.profileKey)));
  if (seen.length === 2) {
    const [a, b] = seen;
    const other = (s: RaidSide): RaidSide => (s === 'pmc' ? 'scav' : 'pmc');
    if (sides.has(a) && !sides.has(b)) {
      sides.set(b, other(sides.get(a)!));
      source.set(b, 'elimination');
    } else if (sides.has(b) && !sides.has(a)) {
      sides.set(a, other(sides.get(b)!));
      source.set(a, 'elimination');
    }
  }
  return { sides, source };
}

export function raidSide(r: RaidRecord, k: SideKnowledge): RaidSide | null {
  return r.profileKey ? k.sides.get(r.profileKey) ?? null : null;
}

/** The raid in progress: the latest start with no end, if it is recent. */
export function currentRaid(h: RaidHistory, now: number = Date.now()): RaidRecord | null {
  const last = h.raids[h.raids.length - 1];
  if (!last || last.startedAt === null || last.endedAt !== null) return null;
  return now - last.startedAt <= MAX_RAID_MS ? last : null;
}

export interface RaidStats {
  raids: number;
  finished: number;
  totalMs: number;
  avgMs: number | null;
  byLocation: { location: string; raids: number; totalMs: number }[];
  questsCompleted: number;
  questsStarted: number;
  lastRaid: RaidRecord | null;
  /** Raids per side; 'unknown' = no fingerprint, or not learned yet. */
  bySide: { pmc: number; scav: number; unknown: number };
}

export function raidDuration(r: RaidRecord): number | null {
  if (r.startedAt === null || r.endedAt === null) return null;
  const d = r.endedAt - r.startedAt;
  return d > 0 && d <= MAX_RAID_MS ? d : null;
}

export function computeStats(h: RaidHistory, since: number | null): RaidStats {
  const when = (r: RaidRecord) => r.startedAt ?? r.endedAt ?? 0;
  const raids = h.raids.filter((r) => since === null || when(r) >= since);
  const byLoc = new Map<string, { raids: number; totalMs: number }>();
  let totalMs = 0;
  let finished = 0;
  for (const r of raids) {
    const d = raidDuration(r);
    if (d !== null) {
      totalMs += d;
      finished += 1;
    }
    const key = r.location ?? '?';
    const cur = byLoc.get(key) ?? { raids: 0, totalMs: 0 };
    cur.raids += 1;
    cur.totalMs += d ?? 0;
    byLoc.set(key, cur);
  }
  const knowledge = learnSides(h);
  const bySide = { pmc: 0, scav: 0, unknown: 0 };
  for (const r of raids) bySide[raidSide(r, knowledge) ?? 'unknown'] += 1;
  const events = h.questEvents.filter((e) => since === null || e.at >= since);
  const distinct = (status: QuestEventRecord['status']) =>
    new Set(events.filter((e) => e.status === status).map((e) => e.templateId)).size;
  return {
    raids: raids.length,
    finished,
    totalMs,
    avgMs: finished ? totalMs / finished : null,
    byLocation: Array.from(byLoc.entries())
      .map(([location, v]) => ({ location, ...v }))
      .sort((a, b) => b.raids - a.raids),
    questsCompleted: distinct('Finished'),
    questsStarted: distinct('Started'),
    lastRaid: raids.length ? raids[raids.length - 1] : null,
    bySide,
  };
}

export function parseHistory(raw: string | null): RaidHistory {
  if (!raw) return { raids: [], questEvents: [] };
  try {
    const p = JSON.parse(raw) as Partial<RaidHistory>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      raids: (Array.isArray(p.raids) ? p.raids : []).map((r) => ({
        location: typeof r?.location === 'string' ? r.location : null,
        startedAt: num(r?.startedAt),
        endedAt: num(r?.endedAt),
        profileKey: typeof r?.profileKey === 'string' && /^[0-9a-f]{16}$/.test(r.profileKey) ? r.profileKey : null,
      })),
      groupSides: (Array.isArray(p.groupSides) ? p.groupSides : []).filter(
        (g): g is GroupSideRecord => (g?.side === 'pmc' || g?.side === 'scav') && typeof g?.at === 'number',
      ),
      manualSides: Object.fromEntries(
        Object.entries(p.manualSides && typeof p.manualSides === 'object' ? p.manualSides : {}).filter(
          ([k, v]) => /^[0-9a-f]{16}$/.test(k) && (v === 'pmc' || v === 'scav'),
        ),
      ) as Record<string, RaidSide>,
      panelSides: Object.fromEntries(
        Object.entries(p.panelSides && typeof p.panelSides === 'object' ? p.panelSides : {}).filter(
          ([k, v]) => /^[0-9a-f]{16}$/.test(k) && (v === 'pmc' || v === 'scav'),
        ),
      ) as Record<string, RaidSide>,
      questEvents: (Array.isArray(p.questEvents) ? p.questEvents : []).filter(
        (e): e is QuestEventRecord =>
          typeof e?.templateId === 'string' && typeof e?.at === 'number' && typeof e?.status === 'string',
      ),
    };
  } catch {
    return { raids: [], questEvents: [] };
  }
}

export function loadHistory(): RaidHistory {
  try {
    return parseHistory(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { raids: [], questEvents: [] };
  }
}

export function saveHistory(h: RaidHistory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
  } catch {
    // quota — history is a convenience
  }
}
