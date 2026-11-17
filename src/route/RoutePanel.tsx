// The raid route's card over the map: where it starts, the stops in order
// (whose they are, the walk to each), the exit and what did not fit.
import { useTranslation } from 'react-i18next';
import { ArrowCounterClockwise, Check, MapPin, Path, SignOut, X } from '@phosphor-icons/react';
import { Button, HelpTip, IconButton, Toggle } from '../ui';
import type { RaidRoute } from './useRaidRoute';
import './route.css';

const mins = (s: number) => Math.max(1, Math.round(s / 60));
/** Objectives listed per stop; the rest are on the map pin's tooltip. */
const MAX_ITEMS = 3;

export default function RoutePanel({ route, inSquad }: { route: RaidRoute; inSquad: boolean }) {
  const { t } = useTranslation();
  const { plan } = route;

  return (
    <aside className="route-card" aria-label={t('route.title')}>
      <header className="route-card__head">
        <span className="route-card__icon">
          <Path weight="bold" />
        </span>
        <div className="route-card__title">
          <strong>{t('route.title')}</strong>
          <small>
            {plan
              ? t('route.summary', { count: plan.stops.length, min: mins(plan.total) })
              : t('route.budget', { min: mins(route.budget) })}
          </small>
        </div>
        <HelpTip>{t('route.help')}</HelpTip>
        <IconButton size="sm" icon={<X />} label={t('common.close')} onClick={() => route.setOn(false)} />
      </header>

      <div className="route-card__body">
        {inSquad && (
          <div className="route-card__row">
            <span>{t('route.party')}</span>
            {route.party && route.mates.length > 0 && (
              <span className="route-card__mates">
                {route.mates.map((m) => (
                  <span key={m.id} className="route-who" style={{ background: m.color }} title={m.name} />
                ))}
              </span>
            )}
            <Toggle size="sm" checked={route.party} onChange={route.setParty} label={t('route.party')} />
          </div>
        )}

        <div className="route-card__start">
          <MapPin weight="fill" />
          <span>
            {route.picking
              ? t('route.pickHint')
              : route.startSource
                ? t(`route.from.${route.startSource}`)
                : t('route.noStart')}
          </span>
          <Button size="sm" variant="tertiary" onClick={() => route.setPicking(!route.picking)}>
            {route.picking ? t('common.cancel') : t('route.pickSpawn')}
          </Button>
        </div>

        {plan && (
          <ol className="route-list">
            {plan.stops.map((s, i) => (
              <li key={s.id} className="route-stop">
                <span className="route-stop__n">{i + 1}</span>
                <div className="route-stop__text">
                  {s.items.slice(0, MAX_ITEMS).map((it) => (
                    <div key={it.objective.id} className="route-stop__item">
                      <strong>{it.task.name}</strong>
                      {it.objective.description && <span>{it.objective.description}</span>}
                    </div>
                  ))}
                  {s.items.length > MAX_ITEMS && <small className="route-stop__more">{t('route.more', { count: s.items.length - MAX_ITEMS })}</small>}
                </div>
                <span className="route-stop__meta">
                  <span className="route-stop__who">
                    {s.who.map((w) => (
                      <span key={w.id} className="route-who" style={{ background: w.color }} title={w.name} />
                    ))}
                  </span>
                  <span className="mono">+{mins(plan.legs[i] + s.work)}′</span>
                </span>
                <IconButton size="sm" icon={<Check />} label={t('route.done')} onClick={() => route.skip(s.id)} />
              </li>
            ))}
            {plan.exit && (
              <li className="route-stop route-stop--exit">
                <span className="route-stop__n">
                  <SignOut weight="bold" />
                </span>
                <div className="route-stop__text">
                  <div className="route-stop__item">
                    <strong>{plan.exit.label}</strong>
                    {plan.exit.note && <span>{plan.exit.note}</span>}
                  </div>
                </div>
                <span className="route-stop__meta">
                  <span className="mono">+{mins(plan.legs[plan.legs.length - 1])}′</span>
                </span>
              </li>
            )}
          </ol>
        )}

        {plan && plan.stops.length === 0 && <p className="route-card__muted">{t(plan.left.length > 0 ? 'route.nothing' : 'route.none')}</p>}
        {plan && plan.left.length > 0 && <p className="route-card__muted">{t('route.left', { count: plan.left.length })}</p>}
        {route.doneCount > 0 && (
          <Button size="sm" variant="tertiary" icon={<ArrowCounterClockwise />} onClick={route.reset}>
            {t('route.reset', { count: route.doneCount })}
          </Button>
        )}
      </div>
    </aside>
  );
}
