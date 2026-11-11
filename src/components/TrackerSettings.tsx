import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrackerApi } from '../app/useTracker';
import { Button, Toggle } from '../ui';

// Settings → TarkovTracker. The key itself is never shown or typed here: it is
// entered in a separate console window and kept in Windows Credential Manager.
export default function TrackerSettings({ tracker }: { tracker: TrackerApi }) {
  const { t, i18n } = useTranslation();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDiff, setConfirmDiff] = useState(false);

  if (!tracker.available) return <p className="muted">{t('settings.tracker.desktopOnly')}</p>;

  const timeFmt = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short', dateStyle: 'short' });
  const err = tracker.error;
  const errText = err
    ? t(`settings.tracker.err.${err.code}`, {
        defaultValue: t('settings.tracker.err.unexpected'),
        minutes: Math.max(1, Math.round((err.retryAfter ?? 60) / 60)),
      })
    : null;

  if (tracker.hasKey === null) return <p className="muted">{t('settings.tracker.checking')}</p>;

  if (!tracker.hasKey) {
    return (
      <>
        <p className="settings-row__hint">{t('settings.tracker.hint')}</p>
        <div className="settings-row">
          <div className="settings-row__text">
            <span>{t('settings.tracker.noKey')}</span>
            <span className="settings-row__hint">{t('settings.tracker.noKeyHint')}</span>
          </div>
          <div className="settings-row__control">
            <Button onClick={() => void tracker.openKeyWindow()}>{t('settings.tracker.setKey')}</Button>
          </div>
        </div>
        <Button variant="ghost" onClick={() => void tracker.recheck()}>{t('settings.tracker.recheck')}</Button>
        {errText && err?.code !== 'not_configured' && <p className="settings-err">{errText}</p>}
      </>
    );
  }

  const perms = tracker.info?.permissions ?? [];
  const mode = tracker.info ? t(`settings.tracker.mode.${tracker.info.gameMode}`, { defaultValue: tracker.info.gameMode }) : '—';

  return (
    <>
      <p className="settings-row__hint">{t('settings.tracker.hint')}</p>
      <p className="settings-ok">
        {t('settings.tracker.connected', { mode })}
        {tracker.displayName ? ` · ${tracker.displayName}` : ''}
      </p>
      {tracker.info && (
        <p className="settings-row__hint">
          {t('settings.tracker.perms', {
            list: perms.map((p) => t(`settings.tracker.perm.${p}`)).join(', ') || '—',
          })}
        </p>
      )}
      <p className="settings-row__hint">{t('settings.tracker.modeNote')}</p>

      <div className="settings-row">
        <div className="settings-row__text">
          <span>
            {tracker.syncing
              ? t('settings.tracker.syncing')
              : tracker.lastSync
                ? t('settings.tracker.lastSync', { time: timeFmt.format(tracker.lastSync) })
                : t('settings.tracker.neverSynced')}
          </span>
          {tracker.outboxCount > 0 && (
            <span className="settings-row__hint">{t('settings.tracker.outbox', { count: tracker.outboxCount })}</span>
          )}
        </div>
        <div className="settings-row__control">
          <Button onClick={() => void tracker.syncNow()} disabled={tracker.syncing}>
            {t('settings.tracker.syncNow')}
          </Button>
        </div>
      </div>
      {errText && <p className="settings-err">{errText}</p>}

      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('settings.tracker.autoPush')}</span>
          <span className="settings-row__hint">
            {tracker.canWrite ? t('settings.tracker.autoPushHint') : t('settings.tracker.noWrite')}
          </span>
        </div>
        <Toggle
          checked={tracker.autoPush && tracker.canWrite}
          onChange={tracker.setAutoPush}
          label={t('settings.tracker.autoPush')}
          disabled={!tracker.canWrite}
        />
      </div>

      {tracker.canWrite && tracker.diffCount > 0 && (
        <div className="settings-row">
          <div className="settings-row__text">
            <span>{t('settings.tracker.diff', { count: tracker.diffCount })}</span>
            <span className="settings-row__hint">{t('settings.tracker.diffHint')}</span>
          </div>
          <div className="settings-row__control">
            {confirmDiff ? (
              <Button
                variant="primary"
                onClick={() => {
                  tracker.sendDiff();
                  setConfirmDiff(false);
                }}
              >
                {t('settings.tracker.diffConfirm', { count: tracker.diffCount })}
              </Button>
            ) : (
              <Button onClick={() => setConfirmDiff(true)}>{t('settings.tracker.diffSend')}</Button>
            )}
          </div>
        </div>
      )}

      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('settings.tracker.keyStored')}</span>
        </div>
        <div className="settings-row__control">
          <Button variant="ghost" onClick={() => void tracker.openKeyWindow()}>{t('settings.tracker.changeKey')}</Button>
          {confirmRemove ? (
            <Button
              variant="danger"
              onClick={() => {
                void tracker.removeKey();
                setConfirmRemove(false);
              }}
            >
              {t('settings.tracker.removeConfirm')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmRemove(true)}>{t('settings.tracker.removeKey')}</Button>
          )}
        </div>
      </div>
    </>
  );
}
