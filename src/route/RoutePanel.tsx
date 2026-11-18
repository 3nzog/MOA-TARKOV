// The raid route's card over the map: the goal (quests, loot for money /
// hideout items / weapons, Scavs), the four styles side by side (what each is
// worth, how long it takes, how much of it is in hot places), where it starts,
// the stops in order (whose they are, the walk to each, ⚠ when hot), the exit
// and what did not fit; and the extras (hot zones, loot on the way, the car).
import { useTranslation } from 'react-i18next';
import { ArrowCounterClockwise, Check, MapPin, Path, SignOut, Warning, X } from '@phosphor-icons/react';
import { Button, Chip, HelpTip, IconButton, Segmented, Spinner, Toggle } from '../ui';
import type { RaidRoute } from './useRaidRoute';
import { ROUTE_STYLES, type RoutePlan } from './plan';
import { useCountUp } from '../ui/useCountUp';
import { WEAPON_KINDS, type RouteGoal, type WeaponKind } from './targets';
import { hotShare, planWorth, shortNumber, stopDetail, stopHotReason, stopTitle } from './describe';
import './route.css';

const mins = (s: number) => Math.max(1, Math.round(s / 60));
/** Objectives listed per stop; the rest are on the map pin's tooltip. */
const MAX_ITEMS = 3;

type GoalTab = 'quests' | 'loot' | 'scavs';

/** A style card's numbers, counting to their new values when the route changes. */
function StyleNumbers({ plan, goal }: { plan: RoutePlan; goal: RouteGoal }) {
  const { t, i18n } = useTranslation();
  const value = useCountUp(plan.value);
  const minutes = useCountUp(plan.total / 60);
  const hot = useCountUp(hotShare(plan));
  return (
    <>
      <span>{planWorth({ ...plan, value }, goal, t, i18n.language)}</span>
      <small>
        ~{Math.max(1, Math.round(minutes))} min · {t('route.hotShare', { pct: Math.round(hot) })}
      </small>
    </>
  );
}
const tabOf = (g: RouteGoal): GoalTab => (g === 'quests' || g === 'scavs' ? g : 'loot');

export default function RoutePanel({ route, inSquad, names }: { route: RaidRoute; inSquad: boolean; names: Record<string, string> }) {
  const { t, i18n } = useTranslation();
  const { plan, goal } = route;
  const tab = tabOf(goal);
  const lang = i18n.language;

  const toggleKind = (k: WeaponKind) => {
    const has = route.weaponKinds.includes(k);
    const next = has ? route.weaponKinds.filter((x) => x !== k) : [...route.weaponKinds, k];
    if (next.length > 0) route.setWeaponKinds(WEAPON_KINDS.filter((x) => next.includes(x)));
  };

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
              ? `${planWorth(plan, goal, t, lang)} · ~${mins(plan.total)} min`
              : t('route.budget', { min: mins(route.budget) })}
          </small>
        </div>
        <HelpTip>{t('route.help')}</HelpTip>
        <IconButton size="sm" icon={<X />} label={t('route.off')} onClick={() => route.setOn(false)} />
      </header>

      <div className="route-card__body">
        <Segmented
          fullWidth
          value={tab}
          onChange={(id) => route.setGoal(id === 'loot' ? 'money' : (id as RouteGoal))}
          options={[
            { id: 'quests', label: t('route.goal.quests') },
            { id: 'loot', label: t('route.goal.loot') },
            { id: 'scavs', label: t('route.goal.scavs') },
          ]}
        />
        {tab === 'loot' && (
          <Segmented
            fullWidth
            value={goal}
            onChange={(id) => route.setGoal(id as RouteGoal)}
            options={[
              { id: 'money', label: t('route.goal.money') },
              { id: 'hideout', label: t('route.goal.hideout') },
              { id: 'weapons', label: t('route.goal.weapons') },
            ]}
          />
        )}
        {goal === 'weapons' && (
          <div className="route-card__chips">
            {WEAPON_KINDS.map((k) => (
              <Chip key={k} size="sm" selected={route.weaponKinds.includes(k)} onClick={() => toggleKind(k)}>
                {t(`route.weapon.${k}`)}
              </Chip>
            ))}
          </div>
        )}
        {goal === 'hideout' && <p className="route-card__muted">{t('route.hideoutNote')}</p>}

        {/* The four styles side by side: click one to follow it. */}
        <div className="route-styles" role="radiogroup" aria-label={t('route.styleLabel')}>
          {ROUTE_STYLES.map((s) => {
            const p = route.plans[s];
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={route.style === s}
                className={`route-style${route.style === s ? ' route-style--on' : ''}`}
                onClick={() => route.setStyle(s)}
              >
                <strong>{t(`route.style.${s}`)}</strong>
                {p ? (
                  <StyleNumbers plan={p} goal={goal} />
                ) : (
                  <small>{route.computing ? '…' : '—'}</small>
                )}
              </button>
            );
          })}
        </div>

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
        <div className="route-card__row">
          <span>{t('route.heatToggle')}</span>
          <Toggle size="sm" checked={route.heat.on} onChange={route.heat.setOn} label={t('route.heatToggle')} />
        </div>
        {route.heat.on && !route.elapsed && (
          <Segmented
            fullWidth
            value={String(route.heat.phase)}
            onChange={(id) => route.heat.setPreviewPhase(Number(id) as 0 | 1 | 2)}
            options={[
              { id: '0', label: t('route.phase.0') },
              { id: '1', label: t('route.phase.1') },
              { id: '2', label: t('route.phase.2') },
            ]}
          />
        )}
        {goal === 'quests' && (
          <div className="route-card__row">
            <span>{t('route.onWay.toggle')}</span>
            <Toggle size="sm" checked={route.lootOnWay} onChange={route.setLootOnWay} label={t('route.onWay.toggle')} />
          </div>
        )}
        <div className="route-card__row">
          <span>{t('route.car')}</span>
          <Toggle size="sm" checked={route.preferCar} onChange={route.setPreferCar} label={t('route.car')} />
        </div>

        <div className="route-card__start">
          <MapPin weight="fill" />
          <span>
            {route.picking
              ? t('route.pickHint')
              : route.startSource
                ? `${t(`route.from.${route.startSource}`)}${
                    route.startAge === null ? '' : ` · ${route.startAge === 0 ? t('route.ageNow') : t('route.age', { count: route.startAge })}`
                  }`
                : t('route.noStart')}
          </span>
          <Button size="sm" variant="tertiary" onClick={() => route.setPicking(!route.picking)}>
            {route.picking ? t('common.cancel') : t('route.pickSpawn')}
          </Button>
        </div>

        {route.computing && !plan && (
          <p className="route-card__muted route-card__busy">
            <Spinner size="sm" /> {t('route.computing')}
          </p>
        )}

        {plan && (
          <ol className="route-list">
            {plan.stops.map((s, i) => {
              const why = stopHotReason(plan, i, route.heat.sources, route.raidSeconds);
              return (
                <li key={s.id} className="route-stop">
                  <span className="route-stop__n">{i + 1}</span>
                  <div className="route-stop__text">
                    {s.info ? (
                      <div className="route-stop__item">
                        <strong>{stopTitle(s, t)}</strong>
                        <span>{stopDetail(s, t, names)}</span>
                        {s.info.key && <span>{t('route.loot.key', { key: s.info.key })}</span>}
                      </div>
                    ) : (
                      <>
                        {s.items.slice(0, MAX_ITEMS).map((it) => (
                          <div key={it.objective.id} className="route-stop__item">
                            <strong>{it.task.name}</strong>
                            {it.objective.description && <span>{it.objective.description}</span>}
                          </div>
                        ))}
                        {s.items.length > MAX_ITEMS && (
                          <small className="route-stop__more">{t('route.more', { count: s.items.length - MAX_ITEMS })}</small>
                        )}
                      </>
                    )}
                    {why && (
                      <small className="route-stop__hot">
                        <Warning weight="fill" /> {t(`route.hot.${why}`)}
                      </small>
                    )}
                  </div>
                  <span className="route-stop__meta">
                    {s.who.length > 0 && (
                      <span className="route-stop__who">
                        {s.who.map((w) => (
                          <span key={w.id} className="route-who" style={{ background: w.color }} title={w.name} />
                        ))}
                      </span>
                    )}
                    {s.info?.roubles ? <span className="mono">{shortNumber(s.info.roubles, lang)} ₽</span> : null}
                    <span className="mono">+{mins(plan.legs[i] + s.work)}′</span>
                  </span>
                  <IconButton size="sm" icon={<Check />} label={t('route.done')} onClick={() => route.skip(s.id)} />
                </li>
              );
            })}
            {plan.exit && (
              <li className="route-stop route-stop--exit">
                <span className="route-stop__n">
                  <SignOut weight="bold" />
                </span>
                <div className="route-stop__text">
                  <div className="route-stop__item">
                    <strong>{plan.exit.label}</strong>
                    {plan.exit.car && (
                      <span>
                        {t('route.carExit')}
                        {plan.exit.price ? ` · ${shortNumber(plan.exit.price, lang)} ₽` : ''}
                      </span>
                    )}
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

        {plan && plan.stops.length === 0 && (
          <p className="route-card__muted">{t(plan.left.length > 0 ? 'route.nothing' : goal === 'quests' ? 'route.none' : 'route.noneHere')}</p>
        )}
        {plan && plan.left.length - plan.leftHot.length > 0 && goal === 'quests' && (
          <p className="route-card__muted">{t('route.left', { count: plan.left.length - plan.leftHot.length })}</p>
        )}
        {plan && plan.leftHot.length > 0 && <p className="route-card__muted">{t('route.leftHot', { count: plan.leftHot.length })}</p>}
        {route.onWay.length > 0 && <p className="route-card__muted">{t('route.onWay.count', { count: route.onWay.length })}</p>}
        {route.doneCount > 0 && (
          <Button size="sm" variant="tertiary" icon={<ArrowCounterClockwise />} onClick={route.reset}>
            {t('route.reset', { count: route.doneCount })}
          </Button>
        )}
      </div>
    </aside>
  );
}
