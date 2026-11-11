import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { comboFromEvent, HOTKEY_ACTIONS, type HotkeyAction, type HotkeysApi } from '../app/useHotkeys';
import { Button, Kbd } from '../ui';

// Rebind the in-app shortcuts. "Change" listens for the next key combination;
// Esc cancels, Backspace clears.
export default function HotkeySettings({ hotkeys }: { hotkeys: HotkeysApi }) {
  const { t } = useTranslation();
  const [capture, setCapture] = useState<HotkeyAction | null>(null);
  const { setCapturing, assign } = hotkeys;

  useEffect(() => {
    setCapturing(capture !== null);
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      // The modal closes on Esc in the capture phase too — stop it here.
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapture(null);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        assign(capture, null);
        setCapture(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      assign(capture, combo);
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setCapturing(false);
    };
  }, [capture, setCapturing, assign]);

  return (
    <>
      <p className="settings-row__hint">{t('settings.hotkeysHint')}</p>
      <ul className="hotkey-list">
        {HOTKEY_ACTIONS.map((a) => (
          <li key={a}>
            <span>{t(`settings.hotkeyAction.${a}`)}</span>
            <span className="hotkey-actions">
              {capture === a ? (
                <span className="muted">{t('settings.hotkeyPress')}</span>
              ) : hotkeys.map[a] ? (
                <Kbd>{hotkeys.map[a]}</Kbd>
              ) : (
                <span className="muted">—</span>
              )}
              <Button size="sm" variant="tertiary" onClick={() => setCapture((c) => (c === a ? null : a))}>
                {capture === a ? t('common.cancel') : t('settings.hotkeyChange')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <Button size="sm" variant="tertiary" onClick={hotkeys.reset}>
          {t('settings.hotkeyReset')}
        </Button>
      </div>
    </>
  );
}
