// Settings → General: how long the game makes you wait after a Scav raid.
import { useTranslation } from 'react-i18next';
import { HelpTip, SectionLabel, Slider } from '../ui';
import { SCAV_MAX, SCAV_MIN, setScavPrefs, useScavPrefs } from './scavTimer';

export default function ScavSettings() {
  const { t } = useTranslation();
  const { minutes } = useScavPrefs();
  return (
    <>
      <SectionLabel>{t('scav.title')}</SectionLabel>
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('scav.minutes')}</span>
          <HelpTip>{t('scav.minutesHint')}</HelpTip>
        </div>
        <div className="settings-row__control">
          <Slider
            label={t('scav.minutes')}
            min={SCAV_MIN}
            max={SCAV_MAX}
            step={1}
            value={minutes}
            onChange={(m) => setScavPrefs({ minutes: m })}
            valueText={`${minutes} min`}
          />
        </div>
      </div>
    </>
  );
}
