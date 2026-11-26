// Crafts with estimated profit, and a price lookup. Every figure comes from the
// prices snapshot (pricesAt) and is labelled an estimate: flea prices move by
// the minute and flea fees / trader loyalty are not modelled.
import { useMemo, useState } from 'react';
import type { ScannedItems } from './scanned';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { estimateCraft, fleaPrice, formatRub, valuePerSlot } from '../progression/economy';
import { Button, HelpTip, Input, Segmented, Select, Toggle } from '../ui';
import { formatSeconds } from './names';
import type { PlannerCtx } from './PlannerPanel';
import BestTimes from './BestTimes';

const PAGE = 40;

export default function MarketTab({
  ctx,
  scanned,
  onClearScan,
}: {
  ctx: PlannerCtx;
  /** Items from the last screenshot taken while this tab was open. */
  scanned?: ScannedItems | null;
  onClearScan?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<'crafts' | 'prices' | 'times'>(scanned ? 'prices' : 'crafts');
  // A new screenshot of the inventory turns this tab into its price list.
  const [seenScan, setSeenScan] = useState(scanned);
  if (scanned !== seenScan) {
    setSeenScan(scanned);
    if (scanned) setMode('prices');
  }
  const { data } = ctx;
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  // Read once per mount: "how old are these prices" does not need to tick.
  const [openedAt] = useState(() => Date.now());

  if (data.pricesAt === null) {
    return <p className="muted">{t('planner.market.noPrices')}</p>;
  }
  const ageDays = (openedAt - data.pricesAt) / 86_400_000;

  return (
    <div className="planner-stack">
      <Segmented
        fullWidth
        value={mode}
        onChange={(v) => setMode(v as 'crafts' | 'prices' | 'times')}
        options={[
          { id: 'crafts', label: t('planner.market.crafts') },
          { id: 'prices', label: t('planner.market.prices') },
          { id: 'times', label: t('planner.times.tab') },
        ]}
      />
      <p className={ageDays > 3 ? 'shell-warn planner-age' : 'planner-hint'}>
        {t('planner.market.estimate', { date: dateFmt.format(data.pricesAt) })}
        {mode === 'crafts' && (
          <>
            {' '}
            <HelpTip>{t('planner.market.craftNote')}</HelpTip>
          </>
        )}
      </p>
      {mode === 'crafts' ? (
        <Crafts ctx={ctx} />
      ) : mode === 'times' ? (
        <BestTimes ctx={ctx} />
      ) : (
        <Prices ctx={ctx} scanned={scanned ?? null} onClearScan={onClearScan} />
      )}
    </div>
  );
}

function Crafts({ ctx }: { ctx: PlannerCtx }) {
  const { t } = useTranslation();
  const { data, names, planner } = ctx;
  const [station, setStation] = useState('');
  const [onlyBuilt, setOnlyBuilt] = useState(false);
  const [sort, setSort] = useState<'hour' | 'total'>('hour');
  const [limit, setLimit] = useState(PAGE);
  const levels = planner.planner.stationLevels;

  const stationIds = useMemo(
    () => Array.from(new Set(data.crafts.map((c) => c.stationId))).sort((a, b) => names.station(a).localeCompare(names.station(b))),
    [data, names],
  );

  const rows = useMemo(() => {
    const list = data.crafts
      .filter((c) => !station || c.stationId === station)
      .filter((c) => !onlyBuilt || (levels[c.stationId] ?? 0) >= c.level)
      .map((c) => estimateCraft(c, data.prices));
    const key = (e: (typeof list)[number]) => (sort === 'hour' ? e.profitPerHour : e.profit);
    return list.sort((a, b) => (key(b) ?? -Infinity) - (key(a) ?? -Infinity));
  }, [data, station, onlyBuilt, levels, sort]);

  return (
    <>
      <Select aria-label={t('planner.market.station')} value={station} onChange={(e) => setStation(e.target.value)}>
        <option value="">{t('planner.market.allStations')}</option>
        {stationIds.map((id) => (
          <option key={id} value={id}>{names.station(id)}</option>
        ))}
      </Select>
      <div className="planner-row">
        <span className="planner-row__label">{t('planner.market.onlyBuilt')}</span>
        <Toggle size="sm" checked={onlyBuilt} onChange={setOnlyBuilt} label={t('planner.market.onlyBuilt')} />
      </div>
      <Segmented
        fullWidth
        value={sort}
        onChange={(v) => setSort(v as 'hour' | 'total')}
        options={[
          { id: 'hour', label: t('planner.market.perHour') },
          { id: 'total', label: t('planner.market.perCraft') },
        ]}
      />
      {rows.length === 0 ? (
        <p className="muted">{t('planner.market.noCrafts')}</p>
      ) : (
        <ul className="planner-quests">
          {rows.slice(0, limit).map((e) => (
            <li key={e.craft.id} className="planner-craft">
              <div className="planner-need__main">
                <span>
                  {e.craft.output.count > 1 && `${e.craft.output.count}× `}
                  {names.item(e.craft.output.itemId)}
                  <span className="planner-item-line">
                    {names.station(e.craft.stationId)} {e.craft.level} · {formatSeconds(e.craft.duration)}
                  </span>
                </span>
                <span className={`mono planner-profit${e.profit !== null && e.profit < 0 ? ' planner-profit--neg' : ''}`}>
                  {formatRub(sort === 'hour' ? e.profitPerHour : e.profit)}
                  {sort === 'hour' && e.profitPerHour !== null && '/h'}
                </span>
              </div>
              <p className="planner-hint">
                {e.craft.inputs.map((i) => `${i.count}× ${names.itemShort(i.itemId)}${i.tool ? ` (${t('planner.market.tool')})` : ''}`).join(', ')}
              </p>
              <p className="planner-hint mono">
                {t('planner.market.costValue', { cost: formatRub(e.cost), value: formatRub(e.value) })}
                {e.missingPrices.length > 0 && ` · ${t('planner.market.missing', { count: e.missingPrices.length })}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit && (
        <Button size="sm" variant="tertiary" onClick={() => setLimit((l) => l + PAGE)}>
          {t('planner.showMore', { count: rows.length - limit })}
        </Button>
      )}
    </>
  );
}

function Prices({ ctx, scanned, onClearScan }: { ctx: PlannerCtx; scanned: ScannedItems | null; onClearScan?: () => void }) {
  const { t } = useTranslation();
  const { data } = ctx;
  const [query, setQuery] = useState('');
  // Items from the screenshot, most valuable first; a shared name lists every candidate.
  const fromShot = useMemo(() => {
    if (!scanned) return [];
    const count = new Map<string, number>();
    const unsure = new Set<string>();
    for (const s of scanned) {
      for (const id of s.ids) {
        count.set(id, (count.get(id) ?? 0) + s.count);
        if (s.ids.length > 1) unsure.add(id);
      }
    }
    return [...count.entries()]
      .map(([id, n]) => ({ id, n, unsure: unsure.has(id), v: valuePerSlot(data.prices[id]) ?? 0 }))
      .sort((a, b) => Number(a.unsure) - Number(b.unsure) || b.v * b.n - a.v * a.n);
  }, [scanned, data]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: string[] = [];
    for (const [id, n] of Object.entries(data.names.items)) {
      if (n.name.toLowerCase().includes(q) || n.short.toLowerCase().includes(q)) out.push(id);
      if (out.length >= 40) break;
    }
    return out;
  }, [query, data]);

  return (
    <>
      <Input
        uiSize="sm"
        icon={<MagnifyingGlass />}
        placeholder={t('planner.market.searchItem')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {query.trim().length < 2 && fromShot.length > 0 ? (
        <>
          <div className="planner-row">
            <span className="planner-row__label">{t('planner.market.fromShot', { count: fromShot.length })}</span>
            {onClearScan && (
              <Button size="sm" variant="tertiary" onClick={onClearScan}>
                {t('planner.market.clearShot')}
              </Button>
            )}
          </div>
          <ul className="planner-quests">
            {fromShot.map(({ id, n, unsure }) => (
              <PriceRow key={id} ctx={ctx} id={id} count={n} unsure={unsure} />
            ))}
          </ul>
        </>
      ) : query.trim().length < 2 ? (
        <p className="muted">{t('planner.market.typeToSearch')}</p>
      ) : results.length === 0 ? (
        <p className="muted">{t('planner.market.noResults')}</p>
      ) : (
        <ul className="planner-quests">
          {results.map((id) => (
            <PriceRow key={id} ctx={ctx} id={id} />
          ))}
        </ul>
      )}
    </>
  );
}

function PriceRow({ ctx, id, count, unsure }: { ctx: PlannerCtx; id: string; count?: number; unsure?: boolean }) {
  const { t } = useTranslation();
  const { data, names } = ctx;
  const p = data.prices[id];
  return (
    <li className={`planner-craft${unsure ? ' planner-craft--unsure' : ''}`}>
      <div className="planner-need__main">
        <span>
          {count && count > 1 ? `${count}× ` : ''}
          {names.item(id)}
          <span className="planner-item-line">
            {names.itemShort(id)}
            {unsure ? ` · ${t('prices.uncertain')}` : ''}
          </span>
        </span>
        <span className="mono">{formatRub(valuePerSlot(p))}/{t('planner.market.slot')}</span>
      </div>
      {p ? (
        <dl className="planner-prices">
          <dt>{t('planner.market.flea24h')}</dt>
          <dd className="mono">{p.noFlea ? t('planner.market.noFlea') : formatRub(fleaPrice(p))}</dd>
          <dt>{t('planner.market.fleaLow')}</dt>
          <dd className="mono">{p.noFlea ? '—' : formatRub(p.lastLow)}</dd>
          <dt>{t('planner.market.traderSell')}</dt>
          <dd className="mono">{formatRub(p.sellPrice)} {p.sellTraderId && `· ${names.trader(p.sellTraderId)}`}</dd>
          <dt>{t('planner.market.traderBuy')}</dt>
          <dd className="mono">
            {formatRub(p.buyPrice)}
            {p.buyTraderId && ` · ${names.trader(p.buyTraderId)}${p.buyLevel ? ` LL${p.buyLevel}` : ''}`}
          </dd>
        </dl>
      ) : (
        <p className="planner-hint">{t('planner.market.noPriceItem')}</p>
      )}
    </li>
  );
}
