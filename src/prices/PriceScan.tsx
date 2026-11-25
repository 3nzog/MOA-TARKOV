// The price card: after a screenshot, the hovered item's prices, or every item
// read on the inventory with its count and the total. Names come in the game's
// language (what the OCR reads) and are shown in the app's.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hammer, House, Question, Scroll, X } from '@phosphor-icons/react';
import { IconButton } from '../ui';
import type { ScanResult } from './scan';
import type { ItemUse } from './itemUses';
import type { Names } from '../planner/names';
import { best, loadLocale, loadPrices, type Locale, type Price } from './usePriceScan';
import './prices.css';

/** At most this many uses per item; the rest is "+N". */
const MAX_USES = 3;

export default function PriceScanCard({
  result,
  onClose,
  uses,
}: {
  result: NonNullable<ScanResult>;
  onClose: () => void;
  /** What each item is still good for (quests, hideout, crafts); null while loading. */
  uses?: { byItem: Map<string, ItemUse[]>; names: Names } | null;
}) {
  const { t, i18n } = useTranslation();
  const [prices, setPrices] = useState<Record<string, Price> | null>(null);
  const [loc, setLoc] = useState<Locale | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([loadPrices(), loadLocale(i18n.language.slice(0, 2))]).then(([p, l]) => {
      if (!alive) return;
      setPrices(p);
      setLoc(l);
    });
    return () => {
      alive = false;
    };
  }, [i18n.language]);

  const money = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }), [i18n.language]);
  const rub = (v: number) => `₽${money.format(v)}`;
  if (!prices || !loc) return null;

  const name = (id: string) => loc.items[id]?.[0] ?? id;
  const trader = (id?: string) => (id ? loc.traders[id] ?? id : '');
  // A shared name: show every candidate's price as a range.
  const range = (ids: string[], f: (p: Price | undefined) => number) => {
    const vs = ids.map((id) => f(prices[id])).filter((v) => v > 0);
    if (vs.length === 0) return '—';
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return lo === hi ? rub(lo) : `${rub(lo)}–${rub(hi)}`;
  };

  const rows =
    result.mode === 'hovered'
      ? result.items.map((i) => ({ ids: i.ids, count: 1 }))
      : [...result.items].sort((a, b) => best(prices[b.ids[0]]) * b.count - best(prices[a.ids[0]]) * a.count);
  const total =
    result.mode === 'inventory'
      ? result.items.reduce((sum, i) => sum + (i.ids.length === 1 ? best(prices[i.ids[0]]) * i.count : 0), 0)
      : 0;
  const uncertain = rows.filter((r) => r.ids.length > 1).length;

  return (
    <div className={`price-card price-card--${result.mode}`} role="dialog" aria-label={t('prices.title')}>
      <div className="price-card__head">
        <strong>{result.mode === 'hovered' ? t('prices.hovered') : t('prices.inventory', { count: result.total })}</strong>
        <IconButton size="sm" icon={<X />} label={t('prices.close')} onClick={onClose} />
      </div>
      <ul className="price-card__list">
        {rows.map((r) => {
          const p = r.ids.length === 1 ? prices[r.ids[0]] : undefined;
          return (
            <li key={r.ids.join(',')} className={r.ids.length > 1 ? 'is-uncertain' : ''}>
              <img src={`https://assets.tarkov.dev/${r.ids[0]}-icon.webp`} alt="" loading="lazy" />
              <span className="price-card__name">
                <strong>
                  {r.count > 1 && <em>{r.count}× </em>}
                  {r.ids.length > 3
                    ? `${name(r.ids[0])} +${r.ids.length - 1}`
                    : r.ids.length > 1
                      ? [...new Set(r.ids.map(name))].join(' / ')
                      : name(r.ids[0])}
                </strong>
                {r.ids.length > 1 ? (
                  <small className="price-card__unsure">
                    <Question weight="bold" /> {t('prices.uncertain')}
                  </small>
                ) : (
                  <small>
                    {t('prices.flea')} {p?.a ? rub(p.a) : '—'}
                    {p?.sp ? ` · ${trader(p.st)} ${rub(p.sp)}` : ''}
                    {r.count > 1 && best(p) > 0 ? ` · ${t('prices.each', { value: rub(best(p)) })}` : ''}
                  </small>
                )}
                {r.ids.length === 1 && uses && <Uses list={uses.byItem.get(r.ids[0]) ?? []} names={uses.names} />}
              </span>
              <span className="price-card__value">
                {r.ids.length > 1 ? range(r.ids, best) : rub(best(p) * r.count)}
              </span>
            </li>
          );
        })}
      </ul>
      {result.mode === 'inventory' && (
        <div className="price-card__total">
          <span>{t('prices.total')}</span>
          <strong>{rub(total)}</strong>
        </div>
      )}
      <p className="price-card__note">
        {uncertain > 0 ? t('prices.uncertainNote', { count: uncertain }) + ' ' : ''}
        {t('prices.note')}
      </p>
    </div>
  );
}

/** The item's uses as small tags: quests, hideout upgrades, crafts. */
function Uses({ list, names }: { list: ItemUse[]; names: Names }) {
  const { t } = useTranslation();
  if (list.length === 0) return null;
  const shown = list.slice(0, MAX_USES);
  return (
    <span className="price-card__uses">
      {shown.map((u, i) =>
        u.kind === 'quest' ? (
          <span key={i} className="price-use price-use--quest" title={t('prices.use.questHint')}>
            <Scroll weight="fill" /> {names.task(u.taskId)} ×{u.count}
            {u.fir ? ` · ${t('prices.use.fir')}` : ''}
          </span>
        ) : u.kind === 'hideout' ? (
          <span key={i} className="price-use price-use--hideout" title={t('prices.use.hideoutHint')}>
            <House weight="fill" /> {names.station(u.stationId)} {u.level} ×{u.count}
            {u.fir ? ` · ${t('prices.use.fir')}` : ''}
          </span>
        ) : (
          <span key={i} className={`price-use price-use--craft${u.ready ? '' : ' is-locked'}`} title={t(u.ready ? 'prices.use.craftHint' : 'prices.use.craftLocked')}>
            <Hammer weight="fill" /> {names.station(u.stationId)} {u.level} → {names.item(u.outputId)}
          </span>
        ),
      )}
      {list.length > MAX_USES && <span className="price-use price-use--more">{t('prices.use.more', { n: list.length - MAX_USES })}</span>}
    </span>
  );
}
