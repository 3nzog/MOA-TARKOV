// Title-bar chip: which PC this one shows, or how many PCs show this one.
import { useTranslation } from 'react-i18next';
import { Desktop } from '@phosphor-icons/react';
import { useLink } from './useLink';
import './link.css';

export default function LinkChip({ onOpen }: { onOpen?: () => void }) {
  const { t } = useTranslation();
  const link = useLink();
  const c = link.client;
  let label: string | null = null;
  let tone = 'on';
  if (c && c.state !== 'off' && c.state !== 'refused') {
    const name = c.name ?? link.prefs.target?.name ?? c.host;
    if (c.state === 'linked') label = t('link.chip.showing', { name });
    else if (c.state === 'pending') {
      label = t('link.chip.confirm', { code: c.code });
      tone = 'wait';
    } else {
      label = t('link.chip.reconnecting', { name });
      tone = 'wait';
    }
  } else if (link.host?.hosting && link.host.connected.length > 0) {
    label = t('link.chip.linked', { count: link.host.connected.length });
  }
  if (!label) return null;
  return (
    <button type="button" className={`link-chip link-chip--${tone}`} onClick={onOpen} title={label}>
      <Desktop weight="duotone" />
      <span>{label}</span>
    </button>
  );
}
