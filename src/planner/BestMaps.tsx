// "Which map pays off today?" — the maps ranked by what the raid route gets
// done on each for its goal (src/route/rankMaps.ts). Clicking one opens it.
import { useTranslation } from 'react-i18next';
import { HelpTip, Spinner } from '../ui';
import { shortNumber } from '../route/describe';
import type { MapRank } from '../route/rankMaps';
import type { RouteGoal } from '../route/targets';

export interface BestMapsProps {
  ranks: MapRank[] | null;
  computing: boolean;
  goal: RouteGoal;
  selectedMapId: string | null;
  onPick: (mapId: string) => void;
}

export default function BestMaps({ ranks, computing, goal, selectedMapId, onPick }: BestMapsProps) {
  const { t, i18n } = useTranslation();
  const top = ranks?.[0]?.value ?? 0;
  const worth = (r: MapRank) =>
    goal === 'quests'
      ? t('route.worth.quests', { count: Math.round(r.value) })
      : goal === 'money'
        ? t('route.worth.money', { value: shortNumber(r.value, i18n.language) })
        : goal === 'scavs'
          ? t('route.worth.scavs', { count: Math.round(r.value) })
          : goal === 'bosses'
            ? t('route.worth.bossChance', { pct: Math.round(r.value) })
          : `${Math.round((100 * r.value) / (top || 1))}%`;

  return (
    <section className="best-maps" aria-label={t('planner.raid.best.title')}>
      <div className="planner-row">
        <strong>{t('planner.raid.best.title')}</strong>
        <span className="best-maps__goal">
          {t(`route.goal.${goal}`)}
          <HelpTip>{t('planner.raid.best.help')}</HelpTip>
        </span>
      </div>
      {computing && (!ranks || ranks.length === 0) && (
        <p className="planner-hint best-maps__busy">
          <Spinner size="sm" /> {t('planner.raid.best.computing')}
        </p>
      )}
      {ranks && ranks.length === 0 && !computing && <p className="planner-hint">{t('planner.raid.best.none')}</p>}
      {ranks && ranks.length > 0 && (
        <ol className="best-maps__list">
          {ranks.map((r, i) => (
            <li key={r.mapId}>
              <button
                type="button"
                className={`best-maps__row${r.mapId === selectedMapId ? ' best-maps__row--on' : ''}`}
                onClick={() => onPick(r.mapId)}
              >
                <span className="best-maps__n">{i + 1}</span>
                <span className="best-maps__text">
                  <strong>{r.name}</strong>
                  <small>
                    ~{Math.max(1, Math.round(r.minutes))} min · {t('route.hotShare', { pct: r.hotShare })}
                    {goal === 'quests' && r.byWho.length > 1 && (
                      <> · {r.byWho.map((w) => `${w.who.name} ${Math.round(w.n * 10) / 10}`).join(' · ')}</>
                    )}
                  </small>
                  <span className="best-maps__bar" style={{ width: `${Math.max(6, (100 * r.value) / (top || 1))}%` }} />
                </span>
                <span className="best-maps__worth mono">{worth(r)}</span>
              </button>
            </li>
          ))}
          {computing && (
            <li className="planner-hint best-maps__busy">
              <Spinner size="sm" /> {t('planner.raid.best.computing')}
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
