// Settings → General: start with Windows (hidden, waiting for the game) and
// come up when the game starts.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpTip, SectionLabel, Toggle } from '../ui';
import { setStartupPrefs, startupGet, startupSet, useStartupPrefs } from '../app/startup';

export default function StartupSettings() {
  const { t } = useTranslation();
  const { showOnGame } = useStartupPrefs();
  const [withWindows, setWithWindows] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void startupGet().then((on) => alive && setWithWindows(on));
    return () => {
      alive = false;
    };
  }, []);
  const change = (on: boolean) => {
    setError(null);
    startupSet(on)
      .then(setWithWindows)
      .catch((e) => setError(String(e)));
  };
  return (
    <>
      <SectionLabel>{t('startup.title')}</SectionLabel>
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('startup.withWindows')}</span>
          <HelpTip>{t('startup.withWindowsHint')}</HelpTip>
        </div>
        <Toggle checked={withWindows === true} disabled={withWindows === null} onChange={change} label={t('startup.withWindows')} />
      </div>
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('startup.showOnGame')}</span>
          <HelpTip>{t('startup.showOnGameHint')}</HelpTip>
        </div>
        <Toggle checked={showOnGame} onChange={(on) => setStartupPrefs({ showOnGame: on })} label={t('startup.showOnGame')} />
      </div>
      {error && <p className="settings-err">{t('startup.failed', { error })}</p>}
    </>
  );
}
