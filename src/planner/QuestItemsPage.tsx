// "Quest items": every item the game will still ask you to hand in, compact —
// "8× Disposable syringe · 3 quests" — with how many you already have. The
// counts are Planner → Items' counters: a stash screenshot fills them on its
// own (they only go up, to what was seen), and +/− fixes one by hand.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass, Minus, Plus, Scroll, House, X, Camera } from '@phosphor-icons/react';
import { aggregateNeeds, type ItemNeed, type NeedScope } from '../progression/needs';
import { IconButton, Input, Segmented, Spinner, Toggle } from '../ui';
import type { TarkovTask } from '../api/types';
import type { QuestInfo } from '../progression/status';
import type { ProgressionLoad } from '../app/useProgression';
import type { PlannerApi } from '../app/usePlanner';
import { makeNames } from './names';
import './questItems.css';

const PREFS = 'tc_quest_items_v1';
interface Prefs {
  scope: NeedScope;
  hideout: boolean;
  showDone: boolean;
}
function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? 'null') as Partial<Prefs> | null;
    const scope = v?.scope === 'active' || v?.scope === 'available' ? v.scope : 'all';
    return { scope, hideout: v?.hideout === true, showDone: v?.showDone === true };
  } catch {
    return { scope: 'all', hideout: false, showDone: false };
  }
}

export default function QuestItemsPage({
  load,
  tasks,
  statuses,
  planner,
  onClose,
}: {
  load: ProgressionLoad;
  tasks: TarkovTask[];
  statuses: Map<string, QuestInfo>;
  planner: PlannerApi;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const data = load.state === 'ready' ? load.data : null;
  const names = useMemo(() => makeNames(data, tasks, '?'), [data, tasks]);
  const { stationLevels, collected } = planner.planner;

  const needs = useMemo(
    () =>
      data
        ? aggregateNeeds({
            tasks,
            meta: data.tasks,
            statuses,
            scope: prefs.scope,
            checkedObjectives: planner.checkedObjectives,
            includeHideout: prefs.hideout,
            stations: data.stations,
            stationLevels,
          }).filter((n) => !n.currency)
        : [],
    [data, tasks, statuses, prefs.scope, prefs.hideout, planner.checkedObjectives, stationLevels],
  );

  const label = (n: ItemNeed) => (n.itemId ? names.item(n.itemId) : n.label ?? t('planner.items.anyOf', { count: n.alternatives.length }));
  const quests = (n: ItemNeed) => new Set(n.sources.filter((s) => s.kind === 'quest').map((s) => (s.kind === 'quest' ? s.taskId : ''))).size;
  const stations = (n: ItemNeed) => n.sources.filter((s) => s.kind === 'hideout').length;
  const left = (n: ItemNeed) => Math.max(0, n.count - (collected[n.key] ?? 0));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return needs
      .filter((n) => prefs.showDone || left(n) > 0)
      .filter((n) => {
        if (!q) return true;
        const hay = n.itemId ? `${names.item(n.itemId)} ${names.itemShort(n.itemId)}` : `${n.label ?? ''} ${n.alternatives.map(names.item).join(' ')}`;
        return hay.toLowerCase().includes(q);
      })
      // Done last; real items before "any item of…" groups; the ones more
      // quests (and hideout levels) ask for first; then the most still missing.
      .sort(
        (a, b) =>
          (left(a) === 0 ? 1 : 0) - (left(b) === 0 ? 1 : 0) ||
          (a.itemId ? 0 : 1) - (b.itemId ? 0 : 1) ||
          quests(b) + stations(b) - (quests(a) + stations(a)) ||
          left(b) - left(a) ||
          label(a).localeCompare(label(b)),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needs, query, prefs.showDone, collected, names]);
  // What the stash already has some of comes first (with how many are still
  // missing), then what it has none of.
  const owned = shown.filter((n) => (collected[n.key] ?? 0) > 0);
  const none = shown.filter((n) => (collected[n.key] ?? 0) === 0);

  const tile = (n: ItemNeed) => {
    const have = collected[n.key] ?? 0;
    const rest = left(n);
    const icon = n.itemId ?? n.alternatives[0];
    const q = quests(n);
    const h = stations(n);
    const isOpen = open === n.key;
    return (
      <li key={n.key} className={`qi-item${rest === 0 ? ' is-done' : ''}${isOpen ? ' is-open' : ''}`}>
        <button type="button" className="qi-item__main" onClick={() => setOpen(isOpen ? null : n.key)} title={label(n)}>
          {icon && <img src={`https://assets.tarkov.dev/${icon}-icon.webp`} alt="" loading="lazy" />}
          <span className="qi-item__need mono">{rest > 0 ? `${rest}×` : '✓'}</span>
          <span className="qi-item__name">{n.itemId ? names.itemShort(n.itemId) : label(n)}</span>
          <span className="qi-item__meta">
            {have > 0 && rest > 0 && <span className="qi-have mono">{t('questItems.have', { count: have })}</span>}
            {n.fir && <span className="qi-fir">FIR</span>}
            {q > 0 && (
              <span className="qi-src">
                <Scroll weight="fill" /> {t('questItems.quests', { count: q })}
              </span>
            )}
            {h > 0 && (
              <span className="qi-src qi-src--hideout">
                <House weight="fill" /> {h}
              </span>
            )}
          </span>
          <span className="qi-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (have / n.count) * 100)}%` }} />
          </span>
        </button>
        {isOpen && (
          <div className="qi-detail">
            <strong>{label(n)}</strong>
            <div className="qi-counter">
              <IconButton size="sm" icon={<Minus />} label={t('planner.items.less')} disabled={have <= 0} onClick={() => planner.setCollected(n.key, have - 1)} />
              <span className="mono">
                {have}/{n.count}
              </span>
              <IconButton size="sm" icon={<Plus />} label={t('planner.items.more')} onClick={() => planner.setCollected(n.key, have + 1)} />
            </div>
            <ul>
              {n.sources.map((s, i) => (
                <li key={i}>
                  {s.kind === 'quest' ? names.task(s.taskId) : t('planner.hideout.stationLevel', { station: names.station(s.stationId), level: s.level })}
                  <span className="mono"> ×{s.count}</span>
                </li>
              ))}
            </ul>
            {n.alternatives.length > 0 && <p className="qi-alt">{n.alternatives.map(names.itemShort).join(', ')}</p>}
          </div>
        )}
      </li>
    );
  };

  const missing = needs.reduce((s, n) => s + left(n), 0);
  const kinds = needs.filter((n) => left(n) > 0).length;

  return (
    <div className="qi">
      <header className="qi-head">
        <div className="qi-title">
          <h2>{t('questItems.title')}</h2>
          <span className="qi-sub">
            {data ? t('questItems.summary', { kinds, missing }) : t('planner.loading')}
          </span>
        </div>
        <Segmented
          value={prefs.scope}
          onChange={(v) => setPrefs({ scope: v as NeedScope })}
          options={[
            { id: 'active', label: t('planner.items.scopeActive') },
            { id: 'available', label: t('planner.items.scopeAvailable') },
            { id: 'all', label: t('questItems.scopeAll') },
          ]}
        />
        <IconButton size="sm" icon={<X weight="bold" />} label={t('common.close')} onClick={onClose} />
      </header>
      <div className="qi-tools">
        <Input uiSize="sm" icon={<MagnifyingGlass />} placeholder={t('planner.items.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="qi-toggle">
          <Toggle size="sm" checked={prefs.hideout} onChange={(v) => setPrefs({ hideout: v })} label={t('questItems.hideout')} />
          {t('questItems.hideout')}
        </label>
        <label className="qi-toggle">
          <Toggle size="sm" checked={prefs.showDone} onChange={(v) => setPrefs({ showDone: v })} label={t('planner.items.showDone')} />
          {t('planner.items.showDone')}
        </label>
        <span className="qi-hint">
          <Camera weight="fill" /> {t('questItems.screenHint')}
        </span>
      </div>

      {!data ? (
        <div className="qi-state">
          {load.state === 'error' ? <p className="settings-err">{t('planner.loadError')}</p> : <Spinner size="md" />}
        </div>
      ) : shown.length === 0 ? (
        <p className="qi-state muted">{t('questItems.empty')}</p>
      ) : (
        <div className="qi-scroll">
          {owned.length > 0 && (
            <section>
              <h3 className="qi-group">
                {t('questItems.owned')} <span className="mono">{owned.length}</span>
              </h3>
              <ul className="qi-grid">{owned.map(tile)}</ul>
            </section>
          )}
          {none.length > 0 && (
            <section>
              <h3 className="qi-group">
                {t('questItems.notOwned')} <span className="mono">{none.length}</span>
              </h3>
              <ul className="qi-grid">{none.map(tile)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
