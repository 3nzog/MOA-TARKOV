// The Scav's wait on the map: counting down after a Scav raid, then "ready"
// for a while.
import { useTranslation } from 'react-i18next';
import { Skull } from '@phosphor-icons/react';
import { clock } from '../map/raidDuration';
import type { ScavState } from './scavTimer';
import './scav.css';

export default function ScavChip({ state }: { state: ScavState }) {
  const { t } = useTranslation();
  if (state.kind === 'none') return null;
  const ready = state.kind === 'ready';
  return (
    <div className={`scav-chip${ready ? ' is-ready' : ''}`} role="status" title={t('scav.minutesHint')}>
      <Skull weight="bold" />
      <span className="mono">{ready ? t('scav.ready') : t('scav.left', { time: clock(state.leftMs) })}</span>
    </div>
  );
}
