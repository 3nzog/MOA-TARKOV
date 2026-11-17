import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';

/**
 * A newer version: a signed release (installer download), or new commits on
 * GitHub for a folder built from the code by "Abrir Tarkov MoA.bat" (the .bat
 * downloads them, rebuilds and reopens the app).
 */
export type AvailableUpdate =
  | { kind: 'release'; version: string; notes: string | null; update: Update }
  | { kind: 'source'; count: number; subject: string };

const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** New commits on GitHub for this folder, or null (up to date, offline, not a source folder). */
export async function checkForSourceUpdate(): Promise<AvailableUpdate | null> {
  if (!inTauri()) return null;
  try {
    const u = await invoke<{ count: number; subject: string } | null>('source_update_check');
    return u && u.count > 0 ? { kind: 'source', count: u.count, subject: u.subject } : null;
  } catch {
    return null;
  }
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

/**
 * New commits on GitHub (folders the .bat keeps up to date) first, else ask
 * the configured updater endpoint whether a newer signed build exists.
 * Returns null when up to date, when running outside Tauri (plain `vite dev`),
 * or on any network/endpoint error — never throws, so callers can fire-and-forget.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const source = await checkForSourceUpdate();
  if (source) return source;
  try {
    const update = await check();
    if (!update) return null;
    return { kind: 'release', version: update.version, notes: update.body ?? null, update };
  } catch (e) {
    // Outside Tauri, offline, or endpoint not reachable — surface nothing.
    console.warn('[updater] check failed (running outside Tauri or offline?):', e);
    return null;
  }
}

/**
 * Download + install the update (Tauri verifies its signature against the
 * baked-in public key), then relaunch into the new version. The relaunch
 * terminates the current process, so code after this call only runs on failure.
 */
export async function applyUpdate(
  available: AvailableUpdate,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (available.kind === 'source') {
    // The .bat opens in its own window; the app closes and comes back updated.
    await invoke('source_update_apply');
    return;
  }
  const { update } = available;
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? null;
        onProgress?.({ downloaded, total });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case 'Finished':
        onProgress?.({ downloaded, total });
        break;
    }
  });

  await relaunch();
}
