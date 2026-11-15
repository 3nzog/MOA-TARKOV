// Bridge to the Rust TarkovTracker client (src-tauri/src/tracker.rs).
//
// The API key never reaches this side: it is entered in a separate console
// window, kept in the Windows Credential Manager, and attached to requests by
// the Rust core. Nothing here can read it.
import { invoke } from '@tauri-apps/api/core';
import type { TaskUpdate } from '../state/trackerSync';

export type TrackerPermission = 'GP' | 'TP' | 'WP';
export type TrackerGameMode = 'pvp' | 'pve' | 'seasonal' | string;

export interface TrackerTokenInfo {
  permissions: TrackerPermission[];
  gameMode: TrackerGameMode;
  note: string;
}

export interface TrackerProgressResult {
  notModified: boolean;
  etag: string | null;
  data: unknown;
  gameMode: TrackerGameMode | null;
}

export type TrackerErrorCode =
  | 'not_configured'
  | 'bad_key'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable'
  | 'bad_request'
  | 'network'
  | 'storage'
  | 'unexpected';

export interface TrackerError {
  code: TrackerErrorCode;
  message: string;
  retryAfter: number | null;
}

export const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Normalise anything thrown by invoke into a TrackerError. */
export function asTrackerError(e: unknown): TrackerError {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as TrackerError).code === 'string') {
    const t = e as Partial<TrackerError>;
    return { code: t.code as TrackerErrorCode, message: String(t.message ?? ''), retryAfter: t.retryAfter ?? null };
  }
  return { code: 'unexpected', message: e instanceof Error ? e.message : String(e), retryAfter: null };
}

export const trackerHasKey = () => invoke<boolean>('tracker_has_key');
export const trackerTokenInfo = () => invoke<TrackerTokenInfo>('tracker_token_info');
export const trackerGetProgress = (etag: string | null) =>
  invoke<TrackerProgressResult>('tracker_get_progress', { etag });
export const trackerUpdateTasks = (updates: TaskUpdate[]) => invoke<string[]>('tracker_update_tasks', { updates });
export const trackerSetLevel = (level: number) => invoke<void>('tracker_set_level', { level });
export const trackerUpdateObjective = (id: string, state: 'completed' | 'uncompleted') =>
  invoke<void>('tracker_update_objective', { id, state });
export const trackerOpenKeyWindow = (remove = false) => invoke<void>('tracker_open_key_window', { remove });
/** Checks the key with TarkovTracker, then stores it in Windows Credential Manager. */
export const trackerSetKey = (key: string) => invoke<TrackerTokenInfo>('tracker_set_key', { key });
export const trackerRemoveKey = () => invoke<void>('tracker_remove_key');
