// Items still owed to quests and hideout upgrades, with a per-item counter of
// how many the player has set aside. The game exposes no stash to a passive
// reader, so the counter is the player's own bookkeeping.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, Minus, Plus } from '@phosphor-icons/react';
import { aggregateNeeds, type ItemNeed, type NeedScope } from '../progression/needs';
import { fleaPrice, formatRub } from '../progression/economy';
import { Button, IconButton, Input, Segmented, Toggle } from '../ui';
import type { PlannerCtx } from './PlannerPanel';

const PAGE = 60;

export default function NeedsTab({ ctx, onOpenQuest }: { ctx: PlannerCtx; onOpenQuest: (id: string) => void }) {
  const { t } = useTranslation();
  const { data, tasks, statuses, planner, names } = ctx;
  const { needsScope, includeHideout, stationLevels, collected } = planner.planner;
  const [query, setQuery] = useState('');
  const [firOnly, setFirOnly] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showMoney, setShowMoney] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const needs = useMemo(
    () =>
      aggregateNeeds({
        tasks,
        meta: data.tasks,
        statuses,
        scope: needsScope,
        checkedObjectives: planner.checkedObjectives,
        includeHideout,
        stations: data.stations,
        stationLevels,
      }),
    [tasks, data, statuses, needsScope, planner.checkedObjectives, includeHideout, stationLevels],
  );

  const label = (n: ItemNeed) =>
    n.itemId ? names.item(n.itemId) : n.label ?? t('planner.items.anyOf', { count: n.alternatives.length });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return needs.filter((n) => {
      if (n.currency && !showMoney) return false;
      if (firOnly && !n.fir) return false;
      if (!showDone && (collected[n.key] ?? 0) >= n.count) return false;
      if (q) {
        const hay = n.itemId
          ? `${names.item(n.itemId)} ${names.itemShort(n.itemId)}`
          : `${n.label ?? ''} ${n.alternatives.map(names.item).join(' ')}`;
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [needs, query, firOnly, showDone, showMoney, collected, names]);

  const firCount = needs.filter((n) => n.fir && !n.currency).length;

  return (
    <div className="planner-stack">
      <Segmented
        fullWidth
        value={needsScope}
        onChange={(v) => planner.setNeedsScope(v as NeedScope)}
        options={[
          { id: 'active', label: t('planner.items.scopeActive') },
          { id: 'available', label: t('planner.items.scopeAvailable') },
          { id: 'all', label: t('planner.items.scopeAll') },
        ]}
      />
      <div className="planner-row">
        <span className="planner-row__label">{t('planner.items.includeHideout')}</span>
        <Toggle size="sm" checked={includeHideout} onChange={planner.setIncludeHideout} label={t('planner.items.includeHideout')} />
      </div>
      <div className="planner-row">
        <span className="planner-row__label">{t('planner.items.firOnly')}</span>
        <Toggle size="sm" checked={firOnly} onChange={setFirOnly} label={t('planner.items.firOnly')} />
      </div>
      <div className="planner-row">
        <span className="planner-row__label">{t('planner.items.showDone')}</span>
        <Toggle size="sm" checked={showDone} onChange={setShowDone} label={t('planner.items.showDone')} />
      </div>
      <div className="planner-row">
        <span className="planner-row__label">{t('planner.items.showMoney')}</span>
        <Toggle size="sm" checked={showMoney} onChange={setShowMoney} label={t('planner.items.showMoney')} />
      </div>
      <Input
        uiSize="sm"
        icon={<MagnifyingGlass />}
        placeholder={t('planner.items.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="planner-hint">
        {t('planner.items.summary', { count: needs.filter((n) => !n.currency).length, fir: firCount })}{' '}
        {t('planner.items.counterNote')}
      </p>

      {visible.length === 0 ? (
        <p className="muted">{t('planner.items.empty')}</p>
      ) : (
        <ul className="planner-needs">
          {visible.slice(0, limit).map((n) => {
            const have = collected[n.key] ?? 0;
            const done = have >= n.count;
            const unit = n.itemId ? fleaPrice(data.prices[n.itemId]) : null;
            return (
              <li key={n.key} className={done ? 'planner-need--done' : undefined}>
                <div className="planner-need__main">
                  <button type="button" className="planner-need__name" onClick={() => setOpen((c) => (c === n.key ? null : n.key))}>
                    {label(n)}
                    {n.fir && <span className="planner-fir">FIR</span>}
                  </button>
                  <div className="planner-counter">
                    <IconButton size="sm" icon={<Minus />} label={t('planner.items.less')} disabled={have <= 0} onClick={() => planner.setCollected(n.key, have - 1)} />
                    <span className="mono">{have}/{n.count}</span>
                    <IconButton size="sm" icon={<Plus />} label={t('planner.items.more')} onClick={() => planner.setCollected(n.key, have + 1)} />
                  </div>
                </div>
                {open === n.key && (
                  <div className="planner-need__detail">
                    {n.alternatives.length > 0 && (
                      <p className="planner-hint">{n.alternatives.map(names.itemShort).join(', ')}</p>
                    )}
                    <ul className="planner-list planner-list--dense">
                      {n.sources.map((s, i) => (
                        <li key={i}>
                          {s.kind === 'quest' ? (
                            <button type="button" className="planner-link" onClick={() => onOpenQuest(s.taskId)}>
                              {names.task(s.taskId)}
                            </button>
                          ) : (
                            <span>{t('planner.hideout.stationLevel', { station: names.station(s.stationId), level: s.level })}</span>
                          )}
                          <span className="planner-meta mono">×{s.count}</span>
                        </li>
                      ))}
                    </ul>
                    {unit !== null && (
                      <p className="planner-hint">
                        {t('planner.market.fleaEach', { price: formatRub(unit) })}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {visible.length > limit && (
        <Button size="sm" variant="tertiary" onClick={() => setLimit((l) => l + PAGE)}>
          {t('planner.showMore', { count: visible.length - limit })}
        </Button>
      )}
    </div>
  );
}
