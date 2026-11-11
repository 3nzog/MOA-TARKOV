import { useTranslation } from 'react-i18next';
import type { MinimapApi } from '../app/useMinimapWindow';
import { MINIMAP_SIZES } from '../minimap/protocol';
import { Button, Segmented, Slider, Toggle } from '../ui';

// Settings → Minimap overlay.
export default function MinimapSettings({ minimap }: { minimap: MinimapApi }) {
  const { t } = useTranslation();
  const { settings, update } = minimap;

  return (
    <>
      <p className="settings-row__hint">{t('settings.minimapHint')}</p>
      {!minimap.available && <p className="muted">{t('settings.minimapDesktopOnly')}</p>}
      {minimap.error && <p className="settings-err">{t('settings.minimapOpenFailed', { error: minimap.error })}</p>}

      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('settings.minimapShow')}</span>
        </div>
        <Toggle checked={settings.enabled} onChange={(v) => update({ enabled: v })} label={t('settings.minimapShow')} disabled={!minimap.available} />
      </div>
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('settings.minimapOnlyInRaid')}</span>
          <span className="settings-row__hint">{t('settings.minimapOnlyInRaidHint')}</span>
        </div>
        <Toggle checked={settings.onlyInRaid} onChange={(v) => update({ onlyInRaid: v })} label={t('settings.minimapOnlyInRaid')} />
      </div>
      {minimap.waitingForRaid && <p className="settings-row__hint">{t('settings.minimapWaitingRaid')}</p>}
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('settings.minimapLocked')}</span>
          <span className="settings-row__hint">{t('settings.minimapLockedHint')}</span>
        </div>
        <Toggle checked={settings.locked} onChange={(v) => update({ locked: v })} label={t('settings.minimapLocked')} />
      </div>
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('settings.minimapHeadingUp')}</span>
          <span className="settings-row__hint">{t('settings.minimapHeadingUpHint')}</span>
        </div>
        <Toggle checked={settings.headingUp} onChange={(v) => update({ headingUp: v })} label={t('settings.minimapHeadingUp')} />
      </div>
      <Segmented
        fullWidth
        value={String(settings.size)}
        onChange={(v) => update({ size: Number(v) })}
        options={MINIMAP_SIZES.map((s, i) => ({ id: String(s), label: t(`settings.minimapSize${i}`) }))}
      />
      <Segmented
        fullWidth
        value={settings.shape}
        onChange={(v) => update({ shape: v as 'circle' | 'square' })}
        options={[
          { id: 'circle', label: t('settings.minimapCircle') },
          { id: 'square', label: t('settings.minimapSquare') },
        ]}
      />
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('settings.minimapZoom')}</span>
        </div>
        <div className="settings-row__control">
          <Slider
            label={t('settings.minimapZoom')}
            min={-1}
            max={5}
            step={0.25}
            value={settings.zoom}
            onChange={(v) => update({ zoom: v })}
            valueText={settings.zoom.toFixed(2)}
          />
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__text">
          <span>{t('settings.minimapOpacity')}</span>
        </div>
        <div className="settings-row__control">
          <Slider
            label={t('settings.minimapOpacity')}
            min={0.3}
            max={1}
            step={0.05}
            value={settings.opacity}
            onChange={(v) => update({ opacity: v })}
            valueText={`${Math.round(settings.opacity * 100)}%`}
          />
        </div>
      </div>
      <div className="modal-actions">
        <Button size="sm" variant="tertiary" onClick={() => void minimap.resetPosition()} disabled={!minimap.available}>
          {t('settings.minimapReset')}
        </Button>
      </div>
      <p className="settings-row__hint">{t('settings.minimapLimits')}</p>
    </>
  );
}
