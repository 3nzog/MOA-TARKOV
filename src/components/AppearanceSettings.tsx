// Settings → Appearance: theme, accent, the glass material, sizes, motion, and
// the marker the player is drawn with (symbol + colour), with a live preview.
import { useTranslation } from 'react-i18next';
import { Button, SectionLabel, Segmented, Slider, Toggle } from '../ui';
import { setAppearance, useAppearance } from '../appearance/useAppearance';
import { ACCENTS, DEFAULT_APPEARANCE, GLASS_PRESETS, type Density } from '../appearance/appearance';
import { ARROW_SYMBOL, PLAYER_SYMBOLS, markerHtml, setSelfSymbol, useSelfSymbol } from '../squad/symbols';
import { SQUAD_COLORS, hexForColorId } from '../../shared/squadProtocol';
import { useSquad } from '../squad/useSquad';

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <span>{label}</span>
        {hint && <span className="settings-row__hint">{hint}</span>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

export default function AppearanceSettings({ onReplayIntro }: { onReplayIntro?: () => void }) {
  const { t } = useTranslation();
  const a = useAppearance();
  const symbol = useSelfSymbol();
  const squad = useSquad();
  const colorId = squad.selfColorId ?? squad.identity.colorId;
  const color = colorId ? hexForColorId(colorId) : '#3ddc97';
  const preset = GLASS_PRESETS.find(
    (p) =>
      p.glass.blur === a.glass.blur &&
      p.glass.opacity === a.glass.opacity &&
      p.glass.saturation === a.glass.saturation &&
      p.glass.edge === a.glass.edge,
  )?.id;

  return (
    <div className="settings-body">
      <SectionLabel>{t('settings.appearance.marker')}</SectionLabel>
      <div className="appearance-marker">
        <div className="appearance-marker__preview" aria-hidden="true">
          <div
            className="appearance-marker__mk"
            dangerouslySetInnerHTML={{ __html: markerHtml(symbol, color, { ping: '' }) }}
          />
        </div>
        <div className="appearance-marker__pick">
          <div className="symbol-grid" role="radiogroup" aria-label={t('settings.appearance.symbol')}>
            {[{ id: ARROW_SYMBOL, svg: '' }, ...PLAYER_SYMBOLS].map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={symbol === s.id}
                className={`symbol-grid__btn${symbol === s.id ? ' is-on' : ''}`}
                title={t(`settings.appearance.symbols.${s.id}`)}
                aria-label={t(`settings.appearance.symbols.${s.id}`)}
                onClick={() => setSelfSymbol(s.id)}
              >
                {s.id === ARROW_SYMBOL ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2 20.8 21.2 12 16.4 3.2 21.2Z" fill="currentColor" /></svg>
                ) : (
                  <span dangerouslySetInnerHTML={{ __html: s.svg }} />
                )}
              </button>
            ))}
          </div>
          <div className="swatches" role="radiogroup" aria-label={t('settings.appearance.markerColor')}>
            {SQUAD_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={colorId === c.id}
                aria-label={c.name}
                title={c.name}
                className={`swatch${colorId === c.id ? ' is-on' : ''}`}
                style={{ background: c.hex }}
                onClick={() => squad.saveProfile(squad.identity.name, c.id)}
              />
            ))}
          </div>
          <span className="settings-row__hint">{t('settings.appearance.markerHint')}</span>
        </div>
      </div>
      <Row label={t('settings.appearance.markerSize')}>
        <Slider label={t('settings.appearance.markerSize')} min={0.6} max={1.8} step={0.05} value={a.markerScale}
          onChange={(v) => setAppearance({ markerScale: v })} valueText={pct(a.markerScale)} />
      </Row>
      <Row label={t('settings.appearance.viewCone')} hint={t('settings.appearance.viewConeHint')}>
        <Toggle checked={a.viewCone} onChange={(v) => setAppearance({ viewCone: v })} label={t('settings.appearance.viewCone')} />
      </Row>
      <Row label={t('settings.appearance.labelSize')}>
        <Slider label={t('settings.appearance.labelSize')} min={0.8} max={1.6} step={0.05} value={a.labelScale}
          onChange={(v) => setAppearance({ labelScale: v })} valueText={pct(a.labelScale)} />
      </Row>
      <Row label={t('settings.appearance.mapBrightness')} hint={t('settings.appearance.mapBrightnessHint')}>
        <Slider label={t('settings.appearance.mapBrightness')} min={0.4} max={1.2} step={0.05} value={a.mapBrightness}
          onChange={(v) => setAppearance({ mapBrightness: v })} valueText={pct(a.mapBrightness)} />
      </Row>

      <SectionLabel>{t('settings.appearance.theme')}</SectionLabel>
      <Segmented
        fullWidth
        value={a.theme}
        onChange={(v) => setAppearance({ theme: v as 'dark' | 'light' })}
        options={[
          { id: 'dark', label: t('settings.appearance.dark') },
          { id: 'light', label: t('settings.appearance.light') },
        ]}
      />
      <Row label={t('settings.appearance.layout')} hint={t('settings.appearance.layoutHint')}>
        <Segmented
          fullWidth
          value={a.layout}
          onChange={(v) => setAppearance({ layout: v as 'floating' | 'docked' })}
          options={[
            { id: 'floating', label: t('settings.appearance.floating') },
            { id: 'docked', label: t('settings.appearance.docked') },
          ]}
        />
      </Row>
      <Row label={t('settings.appearance.accent')}>
        <div className="swatches">
          {ACCENTS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={t(`settings.appearance.accents.${c.id}`)}
              title={t(`settings.appearance.accents.${c.id}`)}
              aria-pressed={a.accent === c.hex}
              className={`swatch${a.accent === c.hex ? ' is-on' : ''}`}
              style={{ background: c.hex }}
              onClick={() => setAppearance({ accent: c.hex })}
            />
          ))}
          <label className="swatch swatch--custom" title={t('settings.appearance.customColor')}>
            <input
              type="color"
              aria-label={t('settings.appearance.customColor')}
              value={a.accent}
              onChange={(e) => setAppearance({ accent: e.target.value })}
            />
          </label>
        </div>
      </Row>

      <SectionLabel>{t('settings.appearance.glass')}</SectionLabel>
      <div className="glass-sample" aria-hidden="true">
        <span>{t('settings.appearance.glassPreview')}</span>
      </div>
      <Segmented
        fullWidth
        value={preset ?? 'custom'}
        onChange={(id) => {
          const p = GLASS_PRESETS.find((x) => x.id === id);
          if (p) setAppearance({ glass: { ...p.glass, tint: a.glass.tint } });
        }}
        options={[
          ...GLASS_PRESETS.map((p) => ({ id: p.id, label: t(`settings.appearance.presets.${p.id}`) })),
          ...(preset ? [] : [{ id: 'custom', label: t('settings.appearance.presets.custom') }]),
        ]}
      />
      <Row label={t('settings.appearance.blur')}>
        <Slider label={t('settings.appearance.blur')} min={0} max={40} step={1} value={a.glass.blur}
          onChange={(v) => setAppearance({ glass: { ...a.glass, blur: v } })} valueText={`${a.glass.blur} px`} />
      </Row>
      <Row label={t('settings.appearance.opacity')}>
        <Slider label={t('settings.appearance.opacity')} min={0.15} max={1} step={0.01} value={a.glass.opacity}
          onChange={(v) => setAppearance({ glass: { ...a.glass, opacity: v } })} valueText={pct(a.glass.opacity)} />
      </Row>
      <Row label={t('settings.appearance.saturation')}>
        <Slider label={t('settings.appearance.saturation')} min={0.5} max={2} step={0.05} value={a.glass.saturation}
          onChange={(v) => setAppearance({ glass: { ...a.glass, saturation: v } })} valueText={pct(a.glass.saturation)} />
      </Row>
      <Row label={t('settings.appearance.edge')}>
        <Slider label={t('settings.appearance.edge')} min={0} max={1} step={0.05} value={a.glass.edge}
          onChange={(v) => setAppearance({ glass: { ...a.glass, edge: v } })} valueText={pct(a.glass.edge)} />
      </Row>
      <Row label={t('settings.appearance.tint')}>
        <label className="swatch swatch--custom swatch--wide" style={{ background: a.glass.tint }}>
          <input
            type="color"
            aria-label={t('settings.appearance.tint')}
            value={a.glass.tint}
            onChange={(e) => setAppearance({ glass: { ...a.glass, tint: e.target.value } })}
          />
        </label>
      </Row>

      <SectionLabel>{t('settings.appearance.text')}</SectionLabel>
      <Row label={t('settings.appearance.fontSize')}>
        <Slider label={t('settings.appearance.fontSize')} min={0.85} max={1.3} step={0.05} value={a.fontScale}
          onChange={(v) => setAppearance({ fontScale: v })} valueText={pct(a.fontScale)} />
      </Row>
      <Row label={t('settings.appearance.density')}>
        <Segmented
          fullWidth
          value={a.density}
          onChange={(v) => setAppearance({ density: v as Density })}
          options={[
            { id: 'compact', label: t('settings.appearance.densities.compact') },
            { id: 'normal', label: t('settings.appearance.densities.normal') },
            { id: 'roomy', label: t('settings.appearance.densities.roomy') },
          ]}
        />
      </Row>
      <Row label={t('settings.appearance.corners')}>
        <Slider label={t('settings.appearance.corners')} min={0} max={2} step={0.1} value={a.radius}
          onChange={(v) => setAppearance({ radius: v })} valueText={pct(a.radius)} />
      </Row>

      <SectionLabel>{t('settings.appearance.motion')}</SectionLabel>
      <Row label={t('settings.appearance.animations')} hint={t('settings.appearance.animationsHint')}>
        <Toggle checked={a.animations} onChange={(v) => setAppearance({ animations: v })} label={t('settings.appearance.animations')} />
      </Row>
      <Row label={t('settings.appearance.intro')} hint={t('settings.appearance.introHint')}>
        <Toggle checked={a.intro} onChange={(v) => setAppearance({ intro: v })} label={t('settings.appearance.intro')} />
      </Row>
      <div className="modal-actions">
        {onReplayIntro && <Button variant="tertiary" onClick={onReplayIntro}>{t('settings.appearance.replayIntro')}</Button>}
        <Button
          variant="tertiary"
          onClick={() => setAppearance({ ...DEFAULT_APPEARANCE, glass: { ...DEFAULT_APPEARANCE.glass } })}
        >
          {t('settings.appearance.reset')}
        </Button>
      </div>
    </div>
  );
}
