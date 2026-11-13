// The app's own title bar: the Windows frame is off (tauri.conf.json
// "decorations": false), so dragging, double-click to maximize and the
// minimize / maximize / close buttons live here, in the app's own look.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopySimple, Crosshair, Minus, Square, X } from '@phosphor-icons/react';
import LinkChip from '../link/LinkChip';

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type Win = Awaited<ReturnType<typeof getWin>>;
async function getWin() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export default function TitleBar({ onOpenLink }: { onOpenLink?: () => void }) {
  const { t } = useTranslation();
  const [win, setWin] = useState<Win | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri()) return;
    let unlisten: (() => void) | undefined;
    let alive = true;
    void getWin().then(async (w) => {
      if (!alive) return;
      setWin(w);
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // In a plain browser (development) there is no window to drive.
  if (!inTauri()) return null;

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar__mark" data-tauri-drag-region>
        <Crosshair weight="duotone" />
      </span>
      <span className="titlebar__name" data-tauri-drag-region>
        Tarkov MoA
      </span>
      <div className="titlebar__spacer" data-tauri-drag-region />
      <LinkChip onOpen={onOpenLink} />
      <button type="button" className="titlebar__btn" aria-label={t('titlebar.minimize')} title={t('titlebar.minimize')} onClick={() => void win?.minimize()}>
        <Minus weight="bold" />
      </button>
      <button
        type="button"
        className="titlebar__btn"
        aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        onClick={() => void win?.toggleMaximize()}
      >
        {maximized ? <CopySimple weight="bold" /> : <Square weight="bold" />}
      </button>
      <button
        type="button"
        className="titlebar__btn titlebar__btn--close"
        aria-label={t('titlebar.close')}
        title={t('titlebar.close')}
        onClick={() => void win?.close()}
      >
        <X weight="bold" />
      </button>
    </header>
  );
}
