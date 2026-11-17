// Settings → General: the sound alerts (on/off, volume, which ones), each with a test button.
import { useTranslation } from 'react-i18next';
import { SpeakerHigh } from '@phosphor-icons/react';
import { HelpTip, IconButton, Slider, Toggle } from '../ui';
import { playSound, setSoundPrefs, SOUND_GROUPS, useSoundPrefs, type SoundGroup, type SoundKind } from './sounds';

const SAMPLE: Record<SoundGroup, SoundKind> = { raidTime: 'time5', extract: 'extract', stop: 'stop', quest: 'quest', hot: 'hot' };

export default function SoundSettings() {
  const { t } = useTranslation();
  const prefs = useSoundPrefs();
  return (
    <>
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('sounds.on')}</span>
          <HelpTip>{t('sounds.help')}</HelpTip>
        </div>
        <Toggle checked={prefs.on} onChange={(on) => setSoundPrefs({ on })} label={t('sounds.on')} />
      </div>
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('sounds.volume')}</span>
        </div>
        <div className="settings-row__control">
          <Slider
            label={t('sounds.volume')}
            min={0}
            max={1}
            step={0.05}
            value={prefs.volume}
            disabled={!prefs.on}
            onChange={(volume) => setSoundPrefs({ volume })}
            valueText={`${Math.round(prefs.volume * 100)}%`}
          />
        </div>
      </div>
      {SOUND_GROUPS.map((g) => (
        <div key={g} className="settings-row">
          <div className="settings-row__text">
            <span>{t(`sounds.group.${g}`)}</span>
            <HelpTip>{t(`sounds.groupHelp.${g}`)}</HelpTip>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <IconButton size="sm" icon={<SpeakerHigh />} label={t('sounds.test')} disabled={!prefs.on} onClick={() => playSound(SAMPLE[g], true)} />
            <Toggle
              checked={prefs.groups[g]}
              disabled={!prefs.on}
              onChange={(v) => setSoundPrefs({ groups: { ...prefs.groups, [g]: v } })}
              label={t(`sounds.group.${g}`)}
            />
          </span>
        </div>
      ))}
    </>
  );
}
