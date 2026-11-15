import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrackerApi } from '../app/useTracker';
import { Button, Input, Toggle } from '../ui';

/**
 * The key field: a password box (never shown in clear), checked with
 * TarkovTracker before it is kept in Windows Credential Manager, and emptied
 * as soon as it is saved. The separate key window stays as another way.
 */
function KeyField({ tracker, onDone }: { tracker: TrackerApi; onDone?: () => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const code = await tracker.saveKey(key);
    setBusy(false);
    if (code) {
      setErr(code);
      return;
    }
    setKey('');
    onDone?.();
  };
  return (
    <div className="tracker-key">
      <label className="tracker-key__label" htmlFor="tracker-key-input">
        {t('settings.tracker.keyField')}
      </label>
      <div className="squad-join-row">
        <Input
          id="tracker-key-input"
          type="password"
          mono
          value={key}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          placeholder="PVP_…"
          onChange={(e) => {
            setKey(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <Button variant="primary" onClick={() => void save()} loading={busy} disabled={!key.trim()}>
          {t('settings.tracker.saveKey')}
        </Button>
      </div>
      <span className="settings-row__hint">{t('settings.tracker.keyFieldHint')}</span>
      {err && (
        <p className="settings-err">
          {t(`settings.tracker.err.${err}`, { defaultValue: t('settings.tracker.err.unexpected'), minutes: 1 })}
        </p>
      )}
      <Button size="sm" variant="ghost" onClick={() => void tracker.openKeyWindow()}>
        {t('settings.tracker.orWindow')}
      </Button>
    </div>
  );
}

// Settings → TarkovTracker. The key is typed in a password field (or the
// separate key window) and kept in Windows Credential Manager; MoA never shows it.
export default function TrackerSettings({ tracker }: { tracker: TrackerApi }) {
  const { t, i18n } = useTranslation();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDiff, setConfirmDiff] = useState(false);
  const [changing, setChanging] = useState(false);

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
        <KeyField tracker={tracker} />
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
          <Button variant="ghost" onClick={() => setChanging((c) => !c)}>{t('settings.tracker.changeKey')}</Button>
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
      {changing && <KeyField tracker={tracker} onDone={() => setChanging(false)} />}
    </>
  );
}
