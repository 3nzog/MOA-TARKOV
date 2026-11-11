import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type { UnlistenFn };

export interface RaidStartedPayload {
  // BSG location token (e.g. "Sandbox", "TarkovStreets") parsed from the
  // profileStatus trace that precedes GameStarted; null when the watcher
  // didn't see one. Map to a tarkov.dev id via mapIdFromLogLocation().
  location?: string | null;
  /** Timestamp of the log line ("YYYY-MM-DD HH:MM:SS.mmm", local time). Absent from older watchers. */
  logTime?: string | null;
  /** Fingerprint of the profile entering the raid (PMC and Scav differ). */
  profileKey?: string | null;
}
export interface GroupRaidSidePayload {
  side: 'pmc' | 'scav';
  logTime?: string | null;
}
export interface RaidEndedPayload {
  location: string;
  shortId: string;
  logTime?: string | null;
}
export interface QuestEventPayload {
  status: 'Started' | 'Failed' | 'Finished';
  templateId: string;
  logTime?: string | null;
}

/**
 * Parse an EFT log timestamp ("2026-11-09 22:23:59.829") as LOCAL time — the
 * game writes wall-clock time without a zone. null for anything else.
 */
/**
 * Whether a log event is happening NOW rather than being replayed from an old
 * log ("Sync past logs"). Events without a timestamp come from an older
 * watcher, which only ever emitted live lines — so they count as live.
 */
export const LIVE_EVENT_WINDOW_MS = 10 * 60 * 1000;
export function isLiveEvent(at: number | null, now: number = Date.now()): boolean {
  return at === null || Math.abs(now - at) <= LIVE_EVENT_WINDOW_MS;
}

export function parseLogTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m.map(Number);
  const t = new Date(y, mo - 1, d, h, mi, s, ms).getTime();
  return Number.isNaN(t) ? null : t;
}

export interface PlayerPositionPayload {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

export function subscribeRaidStarted(cb: (e: RaidStartedPayload) => void): Promise<UnlistenFn> {
  return listen<RaidStartedPayload>('raid-started', (ev) => cb(ev.payload));
}
export function subscribeGroupRaidSide(cb: (e: GroupRaidSidePayload) => void): Promise<UnlistenFn> {
  return listen<GroupRaidSidePayload>('group-raid-side', (ev) => cb(ev.payload));
}
/** Text lines OCR read from the O+O extract list in a screenshot (src-tauri/src/extract_panel.rs). */
export interface ExtractPanelPayload {
  lines: string[];
  /** The game's language when Windows has no OCR recognizer for it. */
  missingLanguage?: string | null;
}
export function subscribeExtractPanel(cb: (e: ExtractPanelPayload) => void): Promise<UnlistenFn> {
  return listen<ExtractPanelPayload>('extract-panel', (ev) => cb(ev.payload));
}
export function subscribeRaidEnded(cb: (e: RaidEndedPayload) => void): Promise<UnlistenFn> {
  return listen<RaidEndedPayload>('raid-ended', (ev) => cb(ev.payload));
}
export function subscribeQuestEvent(cb: (e: QuestEventPayload) => void): Promise<UnlistenFn> {
  return listen<QuestEventPayload>('quest-event', (ev) => cb(ev.payload));
}
export function subscribePlayerPosition(cb: (e: PlayerPositionPayload) => void): Promise<UnlistenFn> {
  return listen<PlayerPositionPayload>('player-position', (ev) => cb(ev.payload));
}

import { invoke } from '@tauri-apps/api/core';

export async function replayPastLogs(): Promise<number> {
  return await invoke<number>('replay_past_logs_cmd');
}

/** Raid starts (with profile fingerprint), squad sides and raid ends from every log on disk. */
export interface SideScanPayload {
  raids: { location: string | null; profileKey: string; logTime: string | null }[];
  groups: { side: string; logTime: string | null }[];
  ends: { location: string | null; logTime: string | null }[];
}
export async function scanRaidSides(): Promise<SideScanPayload> {
  return await invoke<SideScanPayload>('scan_raid_sides');
}
