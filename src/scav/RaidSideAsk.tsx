// A raid is on and the app does not know yet whether this profile is the PMC
// or the Scav (the logs only tell two profiles apart): it asks once, on the
// map. The answer is kept per profile, and an account has only those two, so
// the other one is known too from then on.
import { useTranslation } from 'react-i18next';
import type { RaidSide } from '../state/raidHistory';
import './scav.css';

export default function RaidSideAsk({ onPick }: { onPick: (side: RaidSide) => void }) {
  const { t } = useTranslation();
  return (
    <div className="raid-side-ask" role="group" aria-label={t('raidSideAsk.question')}>
      <span title={t('raidSideAsk.hint')}>{t('raidSideAsk.question')}</span>
      <button type="button" onClick={() => onPick('pmc')}>
        PMC
      </button>
      <button type="button" onClick={() => onPick('scav')}>
        Scav
      </button>
    </div>
  );
}
