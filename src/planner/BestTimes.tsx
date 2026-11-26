// Planner → Market → "Best time to sell": for each watched item, its typical
// lowest flea offer at each hour of the day (this PC's clock) and on each day
// of the week, from the app's own records (src/prices/priceLog.ts). Higher =
// better to sell then. Until there are a few days of records it says so.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { IconButton, Input } from '../ui';
import { formatRub } from '../progression/economy';
import { profile, READY_DAYS, unwatchItem, usePriceLog, watchItem, type Profile } from '../prices/priceLog';
import type { PlannerCtx } from './PlannerPanel';

export default function BestTimes({ ctx }: { ctx: PlannerCtx }) {
  const { t, i18n } = useTranslation();
  const log = usePriceLog();
  const { data, names } = ctx;
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: string[] = [];
    for (const [id, n] of Object.entries(data.names.items)) {
      if (log.watch.includes(id)) continue;
      if (n.name.toLowerCase().includes(q) || n.short.toLowerCase().includes(q)) out.push(id);
      if (out.length >= 8) break;
    }
    return out;
  }, [query, data, log.watch]);
  const timeFmt = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' });

  return (
    <>
      <p className="planner-hint">
        {t('planner.times.intro', { days: READY_DAYS })}
        {log.lastCheck !== null && <> {t('planner.times.lastCheck', { time: timeFmt.format(log.lastCheck) })}</>}
      </p>
      <Input
        uiSize="sm"
        icon={<MagnifyingGlass />}
        placeholder={t('planner.times.add')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="times-add">
          {results.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  watchItem(id);
                  setQuery('');
                }}
              >
                <Plus weight="bold" /> {names.item(id)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {log.watch.length === 0 ? (
        <p className="muted">{t('planner.times.none')}</p>
      ) : (
        log.watch.map((id) => <ItemTimes key={id} name={names.item(id)} id={id} samples={log.samples[id] ?? []} />)
      )}
    </>
  );
}

function ItemTimes({ id, name, samples }: { id: string; name: string; samples: Parameters<typeof profile>[0] }) {
  const { t } = useTranslation();
  const p = useMemo(() => profile(samples), [samples]);
  return (
    <section className="times-card">
      <header className="times-card__head">
        <strong>{name}</strong>
        <span className="muted">{t('planner.times.records', { count: p.samples, days: p.days.toFixed(1) })}</span>
        <IconButton size="sm" icon={<X />} label={t('planner.times.remove')} onClick={() => unwatchItem(id)} />
      </header>
      {p.samples === 0 ? (
        <p className="muted">{t('planner.times.waiting')}</p>
      ) : (
        <>
          <Bars p={p} />
          <p className={p.ready ? 'times-verdict' : 'muted'}>{verdict(p, t)}</p>
        </>
      )}
    </section>
  );
}

function verdict(p: Profile, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!p.ready) return t('planner.times.collecting', { days: Math.max(1, Math.ceil(READY_DAYS - p.days)) });
  const pct = (v: number | null) => `${v !== null && v > 0 ? '+' : ''}${v ?? 0}%`;
  const best = p.best.map((s) => `${s.k}h (${pct(s.vs)})`).join(', ');
  const day = [...p.weekdays].filter((d) => d.n >= 4 && d.vs !== null).sort((a, b) => b.vs! - a.vs!)[0];
  return [
    t('planner.times.best', { hours: best }),
    p.worst ? t('planner.times.worst', { hour: `${p.worst.k}h (${pct(p.worst.vs)})` }) : '',
    day && p.days >= 7 ? t('planner.times.bestDay', { day: t(`planner.times.day${day.k}`), pct: pct(day.vs) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 24 bars, one per hour: how high the lowest offer typically is then. */
function Bars({ p }: { p: Profile }) {
  const meds = p.hours.map((h) => h.med).filter((m): m is number => m !== null);
  const lo = Math.min(...meds);
  const hi = Math.max(...meds);
  const bestKs = new Set(p.ready ? p.best.map((b) => b.k) : []);
  return (
    <div className="times-bars" role="img" aria-label="">
      {p.hours.map((h) => {
        const frac = h.med === null ? 0 : hi > lo ? 0.15 + (0.85 * (h.med - lo)) / (hi - lo) : 0.6;
        const cls = bestKs.has(h.k) ? ' is-best' : p.ready && p.worst?.k === h.k ? ' is-worst' : '';
        return (
          <div key={h.k} className="times-bar" title={h.med === null ? `${h.k}h` : `${h.k}h · ${formatRub(h.med)} · ${h.n}×`}>
            <span className={`times-bar__fill${cls}`} style={{ height: `${Math.round(frac * 100)}%` }} />
            {h.k % 3 === 0 && <span className="times-bar__h">{h.k}</span>}
          </div>
        );
      })}
    </div>
  );
}
