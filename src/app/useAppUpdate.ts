import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getVersion } from '@tauri-apps/api/app';
import { checkForUpdate, applyUpdate, type AvailableUpdate } from '../services/updater';

/** Checked again while the app stays open, so a long session still learns of a new version. */
const RECHECK_MS = 60 * 60_000;

/** What the "update" button says: the release number, or how many changes wait on GitHub. */
export function updateLabel(u: AvailableUpdate, t: (key: string, opts?: Record<string, unknown>) => string): string {
  return u.kind === 'release' ? t('rail.updateTo', { version: u.version }) : t('rail.updateSource', { count: u.count });
}

// The running version and the self-update. Both no-op outside Tauri.
export function useAppUpdate(notify: (message: string) => void) {
  const { t } = useTranslation();
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updating, setUpdating] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const told = useRef(false);

  // On launch and then every hour. No-ops outside Tauri / when offline.
  useEffect(() => {
    let alive = true;
    const run = () =>
      void checkForUpdate().then((u) => {
        if (!alive || !u) return;
        setAvailableUpdate(u);
        // Said once: the button stays on the side bar.
        if (!told.current) {
          told.current = true;
          notify(u.kind === 'source' ? t('settings.sourceUpdateFound', { count: u.count }) : t('settings.updateAvailable', { version: u.version }));
        }
      });
    run();
    const id = window.setInterval(run, RECHECK_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [notify, t]);

  // App version for the footer badge. No-ops outside Tauri.
  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const apply = useCallback(async () => {
    if (!availableUpdate) return;
    setUpdating(true);
    notify(
      availableUpdate.kind === 'source'
        ? t('settings.sourceUpdating')
        : t('settings.downloadingUpdate', { version: availableUpdate.version }),
    );
    try {
      await applyUpdate(availableUpdate, ({ downloaded, total }) => {
        if (total && availableUpdate.kind === 'release') {
          const pct = Math.round((downloaded / total) * 100);
          notify(t('settings.downloadingUpdateProgress', { version: availableUpdate.version, pct }));
        }
      });
      // The app restarts (or closes for the .bat); code below only runs on failure.
    } catch (err) {
      notify(err instanceof Error ? err.message : t('errors.updateFailed'));
      setUpdating(false);
    }
  }, [availableUpdate, notify, t]);

  const label = availableUpdate ? updateLabel(availableUpdate, t) : null;
  return { availableUpdate, updating, appVersion, apply, label };
}
