// The game PC with an extra screen linked: it only passes the game's
// information on (logs, screenshots, raid, quests) — the panel is on the
// other PC. So this window stays hidden in the tray and, when opened, shows
// this light page instead of the map and its layers: nothing heavy runs next
// to the game.
import { useTranslation } from 'react-i18next';
import { Broadcast } from '@phosphor-icons/react';
import { Button } from '../ui';
import './link.css';

export default function RelayScreen({ screens, onShowHere, onUnlink }: { screens: string[]; onShowHere: () => void; onUnlink: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="relay-screen">
      <Broadcast size={44} weight="duotone" className="relay-screen__icon" />
      <h2>{t('link.relay.title')}</h2>
      <p>{t('link.relay.body', { names: screens.join(', ') })}</p>
      <p className="muted">{t('link.relay.light')}</p>
      <div className="relay-screen__actions">
        <Button onClick={onShowHere}>{t('link.relay.showHere')}</Button>
        <Button variant="tertiary" onClick={onUnlink}>
          {t('link.relay.unlink')}
        </Button>
      </div>
    </div>
  );
}
