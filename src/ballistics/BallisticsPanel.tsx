// Ballistics: search a gun (or a caliber, or a cartridge) and see every
// cartridge it fires — damage, penetration, armor damage, fragmentation,
// speed, how it does against each armor class, and the flea price — plus a
// penetration × damage chart. A screenshot of the flea market's ammo list
// opens it on the cartridges that were on screen.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Crown, CurrencyCircleDollar, MagnifyingGlass, Trash, X } from '@phosphor-icons/react';
import { Button, HelpTip, IconButton, Input, Segmented, Spinner, Toggle } from '../ui';
import { loadLocale, loadPrices, type Price } from '../prices/usePriceScan';
import { itemIcon } from '../gunsmith/data';
import { useTraderLevels } from '../gunsmith/availability';
import { ammoFor, bestValue, caliberLabel, classEffect, loadAmmoData, rankOwned, roundPrice, search, type ValuePick, type AmmoData, type AmmoStats, type Names, type SearchHit } from './data';
import '../gunsmith/gunsmith.css';
import './ballistics.css';

type SortKey = 'name' | 'd' | 'p' | 'a' | 'f' | 'v' | 'price';

const CLASSES = [1, 2, 3, 4, 5, 6] as const;
const EFFECT_COLORS = ['#7a2b2b', '#b5542a', '#c9a227', '#7fae3c', '#3e9b4f'];

const totalDamage = (a: AmmoStats) => (a.d ?? 0) * (a.n ?? 1);

export interface BallisticsPanelProps {
  onClose: () => void;
  /** Cartridges read from the last screenshot (flea market ammo list). */
  fromScreen?: string[] | null;
  /** Forgets the cartridges read from screenshots. */
  onClearScreen?: () => void;
}

export default function BallisticsPanel({ onClose, fromScreen, onClearScreen }: BallisticsPanelProps) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AmmoData | null>(null);
  const [names, setNames] = useState<Names | null>(null);
  const [prices, setPrices] = useState<Record<string, Price>>({});
  const [traders, setTraders] = useState<Record<string, string>>({});
  // Your loyalty levels, when you set them (Gunsmith / planner); else all open.
  const saved = useTraderLevels();
  const levels = saved.set ? saved.levels : null;
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<SearchHit | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'p', desc: true });
  const [hideTracers, setHideTracers] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  /** Armor class of the target, for the best-value pick. */
  const [target, setTarget] = useState(4);

  useEffect(() => {
    let alive = true;
    const lang = i18n.language.split('-')[0];
    void Promise.all([loadAmmoData(), loadLocale(lang), loadPrices()]).then(([d, l, p]) => {
      if (!alive) return;
      setData(d);
      setNames(l.items as Names);
      setTraders(l.traders);
      setPrices(p);
    });
    return () => {
      alive = false;
    };
  }, [i18n.language]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A screenshot picks its caliber (the one most of its cartridges share).
  const seen = useMemo(() => new Set(fromScreen ?? []), [fromScreen]);
  useEffect(() => {
    if (!data || !names || !fromScreen?.length) return;
    const counts = new Map<string, number>();
    for (const id of fromScreen) {
      const c = data.ammo[id]?.c;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const cal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (cal) setPick({ kind: 'caliber', id: cal, label: caliberLabel(cal, data, names) });
  }, [data, names, fromScreen]);

  const hits = useMemo(() => (data && names ? search(query, data, names) : []), [query, data, names]);

  const name = (id: string) => names?.[id]?.[0] ?? id;
  const short = (id: string) => names?.[id]?.[1] ?? name(id);
  const priceInfo = (id: string) => roundPrice(prices[id], levels);

  const rows = useMemo(() => {
    if (!data || !pick) return [];
    const list = ammoFor(pick, data).filter((id) => !hideTracers || !data.ammo[id].t);
    const val = (id: string): number | string => {
      const a = data.ammo[id];
      switch (sort.key) {
        case 'name':
          return names?.[id]?.[0] ?? id;
        case 'd':
          return totalDamage(a);
        case 'price':
          return roundPrice(prices[id], levels).price;
        default:
          return a[sort.key] ?? 0;
      }
    };
    return list.sort((x, y) => {
      const a = val(x);
      const b = val(y);
      const c = typeof a === 'string' ? a.localeCompare(String(b)) : a - (b as number);
      return sort.desc ? -c : c;
    });
  }, [data, pick, sort, hideTracers, names, prices, levels]);

  // Best value against the target's armor: among the list, and among the
  // cartridges on the market screenshot when there is one.
  const value = useMemo(() => {
    if (!data) return null;
    // Only what you can buy now counts.
    const priceOf = (id: string) => {
      const r = roundPrice(prices[id], levels);
      return r.locked ? 0 : r.price;
    };
    const onScreen = rows.filter((id) => seen.has(id));
    return {
      all: bestValue(rows, data, priceOf, target),
      screen: onScreen.length > 0 ? bestValue(onScreen, data, priceOf, target).through : null,
    };
  }, [data, rows, prices, target, seen, levels]);
  const bestId = value?.all.through?.id ?? null;
  // The cartridges you have (your screenshots), best first against the target's armour.
  const owned = useMemo(() => (data && fromScreen?.length ? rankOwned(fromScreen, data, target) : []), [data, fromScreen, target]);

  const choose = (h: SearchHit) => {
    setPick(h);
    setQuery('');
  };

  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }));
  const th = (key: SortKey, label: string, title?: string) => (
    <th
      className={`bl-sort${sort.key === key ? ' is-on' : ''}`}
      onClick={() => sortBy(key)}
      title={title}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      {label}
      {sort.key === key && (sort.desc ? ' ▾' : ' ▴')}
    </th>
  );

  const weapon = pick?.kind === 'weapon' ? pick.id : null;
  const caliber = data && pick ? (pick.kind === 'caliber' ? pick.id : pick.kind === 'weapon' ? data.weapons[pick.id]?.c : data.ammo[pick.id]?.c) : null;

  return (
    <div className="gs bl" role="dialog" aria-label={t('ballistics.title')}>
      <header className="gs-top">
        <div className="gs-title">
          <h2>{t('ballistics.title')}</h2>
          <span className="gs-sub">{t('ballistics.subtitle')}</span>
        </div>
        <div className="bl-search">
          <Input
            uiSize="sm"
            autoFocus
            value={query}
            placeholder={t('ballistics.search')}
            aria-label={t('ballistics.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && hits[0] && choose(hits[0])}
            icon={<MagnifyingGlass />}
          />
          {query && hits.length > 0 && (
            <ul className="bl-hits" role="listbox">
              {hits.map((h) => (
                <li key={`${h.kind}:${h.id}`}>
                  <button type="button" onClick={() => choose(h)}>
                    {h.kind !== 'caliber' ? <img className="gs-img" src={itemIcon(h.id)} alt="" loading="lazy" /> : <span className="bl-cal-badge">{h.label}</span>}
                    <span className="bl-hit-name">{h.kind === 'caliber' ? t('ballistics.allOfCaliber') : h.label}</span>
                    <span className="bl-hit-kind">{t(`ballistics.kind.${h.kind}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query && data && hits.length === 0 && <div className="bl-hits bl-hits--empty">{t('ballistics.noHits')}</div>}
        </div>
        <IconButton size="sm" icon={<X />} label={t('common.close')} onClick={onClose} />
      </header>

      {!data || !names ? (
        <div className="gs-loading">
          <Spinner />
        </div>
      ) : !pick ? (
        <div className="bl-empty">
          <MagnifyingGlass size={36} />
          <p>{t('ballistics.empty')}</p>
          <p className="gs-hint">
            <Camera /> {t('ballistics.screenHint')}
          </p>
        </div>
      ) : (
        <div className="bl-body">
          <div className="bl-head">
            {weapon && <img className="gs-img gs-img--big bl-weapon" src={itemIcon(weapon)} alt="" />}
            <div>
              <div className="bl-pick">{pick.kind === 'weapon' ? pick.label : caliber ? caliberLabel(caliber, data, names) : pick.label}</div>
              <div className="gs-sub">
                {caliber && pick.kind === 'weapon' && <>{caliberLabel(caliber, data, names)} · </>}
                {t('ballistics.count', { count: rows.length })}
                {seen.size > 0 && rows.some((id) => seen.has(id)) && (
                  <span className="bl-seen-note">
                    {' · '}
                    <Camera /> {t('ballistics.fromScreen', { count: rows.filter((id) => seen.has(id)).length })}
                  </span>
                )}
              </div>
            </div>
            <label className="bl-toggle">
              <Toggle checked={hideTracers} onChange={setHideTracers} size="sm" label={t('ballistics.hideTracers')} />
              {t('ballistics.hideTracers')}
            </label>
          </div>

          {value && (
            <div className="bl-value">
              <span className="bl-value__label">
                <CurrencyCircleDollar weight="fill" /> {t('ballistics.value.title')}
              </span>
              <Segmented
                options={VALUE_CLASSES.map((c) => ({ id: String(c), label: String(c) }))}
                value={String(target)}
                onChange={(id) => setTarget(Number(id))}
              />
              <HelpTip>{t('ballistics.value.help')}</HelpTip>
              <div className="bl-value__picks">
                {value.all.through ? (
                  <ValueLine label={t('ballistics.value.through')} pick={value.all.through} name={name} onHover={setHover} />
                ) : (
                  <span className="bl-value__none">{t('ballistics.value.none', { n: target })}</span>
                )}
                {value.all.easily && <ValueLine label={t('ballistics.value.easily')} pick={value.all.easily} name={name} onHover={setHover} />}
                {value.screen && <ValueLine label={t('ballistics.value.onScreen')} pick={value.screen} name={name} onHover={setHover} screen />}
              </div>
            </div>
          )}

          {owned.length > 0 && (
            <section className="bl-owned" aria-label={t('ballistics.owned.title', { n: target })}>
              <header className="bl-owned__head">
                <Camera weight="fill" />
                <strong>{t('ballistics.owned.title', { n: target })}</strong>
                <HelpTip>{t('ballistics.owned.help')}</HelpTip>
                {onClearScreen && (
                  <Button size="sm" variant="tertiary" icon={<Trash />} onClick={onClearScreen}>
                    {t('ballistics.owned.clear')}
                  </Button>
                )}
              </header>
              {owned.map((g) => (
                <div key={g.caliber} className={`bl-owned__group${g.caliber === caliber ? ' is-on' : ''}`}>
                  <button
                    type="button"
                    className="bl-owned__cal"
                    onClick={() => setPick({ kind: 'caliber', id: g.caliber, label: caliberLabel(g.caliber, data, names) })}
                  >
                    {caliberLabel(g.caliber, data, names)}
                  </button>
                  <ol className="bl-owned__list">
                    {g.ids.map((id, i) => {
                      const a = data.ammo[id];
                      const e = classEffect(a.p, target);
                      return (
                        <li
                          key={id}
                          className={`${i === 0 ? 'is-best' : ''}${hover === id ? ' is-hover' : ''}`}
                          title={`${name(id)} · ${t(`ballistics.effect.${e}`)}`}
                          onMouseEnter={() => setHover(id)}
                          onMouseLeave={() => setHover(null)}
                        >
                          {i === 0 && <Crown weight="fill" className="bl-owned__crown" aria-label={t('ballistics.owned.best')} />}
                          <img className="gs-img" src={itemIcon(id)} alt="" loading="lazy" />
                          <span className="bl-owned__name">{short(id)}</span>
                          <span className="bl-owned__pen">{a.p ?? 0}</span>
                          <span className="bl-owned__eff" style={{ background: EFFECT_COLORS[e] }}>
                            {e}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </section>
          )}

          <PenChart data={data} ids={rows} short={short} hover={hover} onHover={setHover} seen={seen} />

          <div className="bl-table-wrap">
            <table className="bl-table">
              <thead>
                <tr>
                  {th('name', t('ballistics.col.name'))}
                  {th('d', t('ballistics.col.damage'))}
                  {th('p', t('ballistics.col.pen'))}
                  {th('a', t('ballistics.col.armor'), t('ballistics.col.armorHint'))}
                  {th('f', t('ballistics.col.frag'))}
                  {th('v', t('ballistics.col.speed'))}
                  {CLASSES.map((c) => (
                    <th key={c} className="bl-class-h" title={t('ballistics.classHint', { n: c })}>
                      {c}
                    </th>
                  ))}
                  {th('price', t('ballistics.col.price'))}
                </tr>
              </thead>
              <tbody>
                {rows.map((id) => {
                  const a = data.ammo[id];
                  const p = priceInfo(id);
                  return (
                    <tr
                      key={id}
                      className={`${hover === id ? 'is-hover' : ''}${seen.has(id) ? ' is-seen' : ''}`}
                      onMouseEnter={() => setHover(id)}
                      onMouseLeave={() => setHover(null)}
                    >
                      <td className="bl-name">
                        <img className="gs-img" src={itemIcon(id)} alt="" loading="lazy" />
                        <span>
                          {name(id)}
                          {a.t && <span className="bl-tag">{t('ballistics.tracer')}</span>}
                          {id === bestId && <span className="bl-tag bl-tag--value">{t('ballistics.value.tag')}</span>}
                          {seen.has(id) && (
                            <span className="bl-tag bl-tag--seen">
                              <Camera />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="bl-num">{a.n ? `${a.d ?? 0}×${a.n}` : (a.d ?? '—')}</td>
                      <td className="bl-num bl-pen">{a.p ?? 0}</td>
                      <td className="bl-num">{a.a ?? 0}%</td>
                      <td className="bl-num">{Math.round((a.f ?? 0) * 100)}%</td>
                      <td className="bl-num">{a.v ? `${a.v}` : '—'}</td>
                      {CLASSES.map((c) => {
                        const e = classEffect(a.p, c);
                        return (
                          <td key={c} className="bl-class" title={t(`ballistics.effect.${e}`)}>
                            <span style={{ background: EFFECT_COLORS[e] }}>{e}</span>
                          </td>
                        );
                      })}
                      <td className={`bl-num bl-price${p.locked ? ' is-locked' : ''}`}>
                        {p.price > 0 ? `${p.price.toLocaleString(i18n.language)} ₽` : '—'}
                        {p.source && (
                          <small>
                            {p.source === 'flea' ? t('ballistics.flea') : `${traders[p.trader ?? ''] ?? ''} ${t('ballistics.ll', { n: p.level ?? 1 })}`}
                          </small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="gs-hint bl-foot">
            {t('ballistics.legend')}{' '}
            {[4, 3, 2, 1, 0].map((e) => (
              <span key={e} className="bl-legend">
                <span style={{ background: EFFECT_COLORS[e] }}>{e}</span> {t(`ballistics.effect.${e}`)}
              </span>
            ))}
            <br />
            {t('ballistics.source', { date: new Date(data.generatedAt).toLocaleDateString(i18n.language) })}
          </p>
        </div>
      )}
    </div>
  );
}

const VALUE_CLASSES = [2, 3, 4, 5, 6] as const;

/** One best-value pick: what it is for, the cartridge and its price per round. */
function ValueLine({
  label,
  pick,
  name,
  onHover,
  screen,
}: {
  label: string;
  pick: ValuePick;
  name: (id: string) => string;
  onHover: (id: string | null) => void;
  screen?: boolean;
}) {
  const { i18n } = useTranslation();
  return (
    <span className="bl-value__pick" onMouseEnter={() => onHover(pick.id)} onMouseLeave={() => onHover(null)}>
      <small>
        {screen && <Camera />} {label}
      </small>
      <strong>{name(pick.id)}</strong>
      <span className="bl-price">{pick.price.toLocaleString(i18n.language)} ₽</span>
    </span>
  );
}

/** Penetration (x) against damage (y), with the armor classes as bands. */
function PenChart({
  data,
  ids,
  short,
  hover,
  onHover,
  seen,
}: {
  data: AmmoData;
  ids: string[];
  short: (id: string) => string;
  hover: string | null;
  onHover: (id: string | null) => void;
  seen: Set<string>;
}) {
  const { t } = useTranslation();
  if (ids.length === 0) return null;
  const W = 640;
  const H = 240;
  const L = 40;
  const B = 28;
  const T = 26;
  const maxP = Math.max(70, ...ids.map((id) => (data.ammo[id].p ?? 0) + 4));
  const maxD = Math.max(60, ...ids.map((id) => totalDamage(data.ammo[id]) * 1.1));
  const x = (p: number) => L + (p / maxP) * (W - L - 10);
  const y = (d: number) => H - B - (d / maxD) * (H - B - T);
  return (
    <svg className="bl-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('ballistics.chart')}>
      {CLASSES.map((c) => (
        <g key={c}>
          <rect x={x((c - 1) * 10)} y={T} width={x(c * 10) - x((c - 1) * 10)} height={H - B - T} className={c % 2 ? 'bl-band' : 'bl-band bl-band--alt'} />
          <text x={(x((c - 1) * 10) + x(c * 10)) / 2} y={T - 6} className="bl-band-label">
            {t('ballistics.classShort', { n: c })}
          </text>
        </g>
      ))}
      <line x1={L} y1={H - B} x2={W - 10} y2={H - B} className="bl-axis" />
      <line x1={L} y1={T} x2={L} y2={H - B} className="bl-axis" />
      {[0, 10, 20, 30, 40, 50, 60, 70].filter((v) => v <= maxP).map((v) => (
        <text key={v} x={x(v)} y={H - B + 14} className="bl-tick">
          {v}
        </text>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={L - 6} y={y(maxD * f) + 3} className="bl-tick bl-tick--y">
          {Math.round(maxD * f)}
        </text>
      ))}
      <text x={W - 12} y={H - 4} className="bl-axis-label" textAnchor="end">
        {t('ballistics.col.pen')} →
      </text>
      <text x={4} y={T - 6} className="bl-axis-label">
        {t('ballistics.col.damage')}
      </text>
      {ids.map((id) => {
        const a = data.ammo[id];
        const cx = x(a.p ?? 0);
        const cy = y(totalDamage(a));
        const on = hover === id;
        return (
          <g key={id} className={`bl-dot${on ? ' is-on' : ''}${seen.has(id) ? ' is-seen' : ''}`} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}>
            <circle cx={cx} cy={cy} r={on ? 6 : 4} />
            <text x={cx + 7} y={cy - 5}>
              {short(id)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
