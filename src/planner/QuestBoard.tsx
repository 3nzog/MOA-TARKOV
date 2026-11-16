// Every quest in the game with its status, filterable, each expandable into its
// objectives (tickable), prerequisite tree, unlocks and a manual status control.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlass } from '@phosphor-icons/react';
import type { TarkovTask } from '../api/types';
import { canonicalMapId } from '../map/canonicalMap';
import { collectObjectiveMaps } from '../quests/derive';
import { buildUnlocks, requirementTree, type QuestInfo, type QuestStatus, type RequirementNode } from '../progression/status';
import { setQuestOverride, type QuestOverrideStatus } from '../state/localProgress';
import { Button, Chip, HelpTip, Input, Select, Toggle } from '../ui';
import type { PlannerCtx } from './PlannerPanel';

type StatusFilter = QuestStatus | 'all';
const PAGE = 80;

interface Props {
  ctx: PlannerCtx;
  selectedMapId: string | null;
  focusTaskId: string | null;
  onFocusHandled: () => void;
}

function taskMaps(task: TarkovTask): Set<string> {
  const ids = new Set<string>();
  if (task.map?.id) ids.add(canonicalMapId(task.map.id));
  for (const o of task.objectives ?? []) collectObjectiveMaps(o).forEach((id) => ids.add(canonicalMapId(id)));
  return ids;
}

export default function QuestBoard({ ctx, selectedMapId, focusTaskId, onFocusHandled }: Props) {
  const { t } = useTranslation();
  const { tasks, statuses, data } = ctx;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('available');
  const [trader, setTrader] = useState('');
  const [onlyMap, setOnlyMap] = useState(false);
  const [onlyKappa, setOnlyKappa] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  // A quest opened from elsewhere: show it whatever the filters say.
  useEffect(() => {
    if (!focusTaskId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('all');
    setQuery('');
    setTrader('');
    setOnlyMap(false);
    setOnlyKappa(false);
    setExpanded(focusTaskId);
    setLimit(Infinity);
    onFocusHandled();
  }, [focusTaskId, onFocusHandled]);

  useEffect(() => {
    if (expanded) rowRefs.current.get(expanded)?.scrollIntoView({ block: 'nearest' });
  }, [expanded]);

  const traders = useMemo(
    () => Array.from(new Set(tasks.map((x) => x.trader?.name).filter((n): n is string => !!n))).sort(),
    [tasks],
  );
  const unlocks = useMemo(() => buildUnlocks(data.tasks), [data]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, available: 0, active: 0, locked: 0, complete: 0, failed: 0 };
    for (const info of statuses.values()) {
      c.all += 1;
      c[info.status] += 1;
    }
    return c;
  }, [statuses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        const info = statuses.get(task.id);
        if (!info) return false;
        if (status !== 'all' && info.status !== status) return false;
        if (trader && task.trader?.name !== trader) return false;
        if (onlyKappa && !data.tasks[task.id]?.kappa) return false;
        if (onlyMap && selectedMapId && !taskMaps(task).has(selectedMapId)) return false;
        if (q && !task.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (data.tasks[a.id]?.minLevel ?? 0) - (data.tasks[b.id]?.minLevel ?? 0) || a.name.localeCompare(b.name));
  }, [tasks, statuses, status, trader, onlyKappa, onlyMap, selectedMapId, query, data]);

  const statusOptions: StatusFilter[] = ['available', 'active', 'locked', 'complete', 'failed', 'all'];

  return (
    <div className="planner-stack">
      <Input
        uiSize="sm"
        icon={<MagnifyingGlass />}
        placeholder={t('planner.quests.search')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
      />
      <div className="planner-chips">
        {statusOptions.map((s) => (
          <Chip
            key={s}
            size="sm"
            selected={status === s}
            count={counts[s]}
            onClick={() => {
              setStatus(s);
              setLimit(PAGE);
            }}
          >
            {t(`planner.status.${s}`)}
          </Chip>
        ))}
        {status === 'available' && <HelpTip>{t('planner.quests.availableNote')}</HelpTip>}
      </div>
      <div className="planner-row">
        <Select aria-label={t('planner.quests.trader')} value={trader} onChange={(e) => setTrader(e.target.value)}>
          <option value="">{t('planner.quests.allTraders')}</option>
          {traders.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </Select>
      </div>
      <div className="planner-row">
        <span className="planner-row__label">{t('planner.quests.onlyMap')}</span>
        <Toggle size="sm" checked={onlyMap} onChange={setOnlyMap} label={t('planner.quests.onlyMap')} disabled={!selectedMapId} />
      </div>
      <div className="planner-row">
        <span className="planner-row__label">{t('planner.quests.onlyKappa')}</span>
        <Toggle size="sm" checked={onlyKappa} onChange={setOnlyKappa} label={t('planner.quests.onlyKappa')} />
      </div>

      {filtered.length === 0 ? (
        <p className="muted">{t('planner.quests.empty')}</p>
      ) : (
        <ul className="planner-quests">
          {filtered.slice(0, limit).map((task) => (
            <QuestRow
              key={task.id}
              ctx={ctx}
              task={task}
              info={statuses.get(task.id)!}
              unlocks={unlocks.get(task.id) ?? []}
              open={expanded === task.id}
              onToggle={() => setExpanded((cur) => (cur === task.id ? null : task.id))}
              onOpenQuest={(id) => {
                setStatus('all');
                setExpanded(id);
                setLimit(Infinity);
              }}
              rowRef={(el) => {
                if (el) rowRefs.current.set(task.id, el);
                else rowRefs.current.delete(task.id);
              }}
            />
          ))}
        </ul>
      )}
      {filtered.length > limit && (
        <Button size="sm" variant="tertiary" onClick={() => setLimit((l) => l + PAGE)}>
          {t('planner.showMore', { count: filtered.length - limit })}
        </Button>
      )}
    </div>
  );
}

function StatusBadge({ info }: { info: QuestInfo }) {
  const { t } = useTranslation();
  return (
    <span className={`planner-status planner-status--${info.status}`}>
      {t(`planner.status.${info.status}`)}
      {info.inferred && ` · ${t('planner.quests.inferred')}`}
      {info.manual && ` · ${t('planner.quests.manual')}`}
    </span>
  );
}

interface RowProps {
  ctx: PlannerCtx;
  task: TarkovTask;
  info: QuestInfo;
  unlocks: string[];
  open: boolean;
  onToggle: () => void;
  onOpenQuest: (id: string) => void;
  rowRef: (el: HTMLLIElement | null) => void;
}

function QuestRow({ ctx, task, info, unlocks, open, onToggle, onOpenQuest, rowRef }: RowProps) {
  const { t } = useTranslation();
  const { data, names, statuses, planner, setProgress, progress } = ctx;
  const meta = data.tasks[task.id];
  const manualOptions: { id: QuestOverrideStatus; label: string }[] = [
    { id: 'active', label: t('planner.status.active') },
    { id: 'complete', label: t('planner.status.complete') },
    { id: 'failed', label: t('planner.status.failed') },
    { id: 'none', label: t('planner.quests.notStarted') },
  ];

  return (
    <li ref={rowRef} className={`planner-quest${open ? ' planner-quest--open' : ''}`}>
      <button type="button" className="planner-quest__head" onClick={onToggle} aria-expanded={open}>
        <span className="planner-quest__name">{task.name}</span>
        <span className="planner-meta">
          {task.trader && <span className="trader">{task.trader.name}</span>}
          {meta && meta.minLevel > 0 && <span className="mono">Lv{meta.minLevel}</span>}
          {meta?.kappa && <Chip size="sm">K</Chip>}
          <StatusBadge info={info} />
        </span>
      </button>
      {open && (
        <div className="planner-quest__body">
          {info.lockReasons.length > 0 && (
            <ul className="planner-reasons">
              {info.lockReasons.map((r, i) => (
                <li key={i}>
                  {r.kind === 'prereq' ? (
                    <>
                      {t('planner.quests.needsQuest')}{' '}
                      <button type="button" className="planner-link" onClick={() => onOpenQuest(r.taskId)}>
                        {names.task(r.taskId)}
                      </button>{' '}
                      ({r.need.map((s) => t(`planner.reqStatus.${s}`)).join(' / ')})
                    </>
                  ) : r.kind === 'level' ? (
                    t('planner.quests.needsLevel', { level: r.need })
                  ) : (
                    t('planner.quests.needsFaction', { faction: r.need })
                  )}
                </li>
              ))}
            </ul>
          )}
          {meta && meta.traderReqs.length > 0 && (
            <p className="planner-hint">
              {meta.traderReqs
                .map((r) =>
                  r.type === 'reputation'
                    ? t('planner.quests.traderRep', { trader: names.trader(r.traderId), value: r.value })
                    : t('planner.quests.traderLevel', { trader: names.trader(r.traderId), value: r.value }),
                )
                .join(' · ')}{' '}
              <HelpTip>{t('planner.quests.traderUnknown')}</HelpTip>
            </p>
          )}

          {(task.objectives ?? []).length > 0 && (
            <h4 className="planner-subhead">
              {t('planner.quests.objectivesTitle')} <HelpTip>{t('planner.quests.objectivesManual')}</HelpTip>
            </h4>
          )}
          {(task.objectives ?? []).length > 0 && (
            <ul className="planner-objectives">
              {(task.objectives ?? []).map((obj) => {
                const om = meta?.objectives[obj.id];
                const checked = planner.checkedObjectives.has(obj.id);
                const itemLine =
                  om && om.items.length > 0 && ['giveItem', 'findItem', 'plantItem', 'sellItem'].includes(om.type)
                    ? om.items.length === 1
                      ? `${om.count ?? 1}× ${names.item(om.items[0])}`
                      : t('planner.items.anyOf', { count: om.items.length })
                    : null;
                return (
                  <li key={obj.id} className={checked ? 'planner-objective--done' : undefined}>
                    <label>
                      <input type="checkbox" checked={checked} onChange={() => planner.toggleObjective(obj.id)} />
                      <span>
                        {obj.description ?? obj.type}
                        {om?.optional && <em className="planner-hint"> ({t('planner.quests.optional')})</em>}
                        {itemLine && <span className="planner-item-line">{itemLine}</span>}
                        {om?.fir && <span className="planner-fir">FIR</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {meta && meta.neededKeys.length > 0 && (
            <p className="planner-hint">
              {t('planner.raid.keys')}: {meta.neededKeys.map((k) => k.keys.map(names.itemShort).join(' / ')).join(', ')}
            </p>
          )}

          {meta && meta.requires.length > 0 && (
            <>
              <h4 className="planner-subhead">{t('planner.quests.requires')}</h4>
              <RequirementTree nodes={requirementTree(task.id, data.tasks)} ctx={ctx} onOpenQuest={onOpenQuest} />
            </>
          )}
          {unlocks.length > 0 && (
            <>
              <h4 className="planner-subhead">{t('planner.quests.unlocks')}</h4>
              <ul className="planner-list planner-list--dense">
                {unlocks.map((id) => (
                  <li key={id}>
                    <button type="button" className="planner-link" onClick={() => onOpenQuest(id)}>
                      {names.task(id)}
                    </button>
                    {statuses.get(id) && <StatusBadge info={statuses.get(id)!} />}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4 className="planner-subhead">{t('planner.quests.setStatus')}</h4>
          <div className="planner-chips">
            {manualOptions.map((o) => (
              <Chip
                key={o.id}
                size="sm"
                selected={progress.overrides[task.id]?.status === o.id}
                onClick={() => setProgress((p) => setQuestOverride(p, task.id, o.id))}
              >
                {o.label}
              </Chip>
            ))}
            {task.id in progress.overrides && (
              <Chip size="sm" onClick={() => setProgress((p) => setQuestOverride(p, task.id, null))}>
                {t('planner.quests.useLogs')}
              </Chip>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function RequirementTree({
  nodes,
  ctx,
  onOpenQuest,
}: {
  nodes: RequirementNode[];
  ctx: PlannerCtx;
  onOpenQuest: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul className="planner-tree">
      {nodes.map((n) => {
        const info = ctx.statuses.get(n.taskId);
        return (
          <li key={n.taskId}>
            <button type="button" className="planner-link" onClick={() => onOpenQuest(n.taskId)}>
              {ctx.names.task(n.taskId)}
            </button>
            {info && <StatusBadge info={info} />}
            {n.need.some((s) => s !== 'complete') && (
              <span className="planner-hint"> ({n.need.map((s) => t(`planner.reqStatus.${s}`)).join(' / ')})</span>
            )}
            {n.repeated && <span className="planner-hint"> ↑</span>}
            {n.children.length > 0 && <RequirementTree nodes={n.children} ctx={ctx} onOpenQuest={onOpenQuest} />}
          </li>
        );
      })}
    </ul>
  );
}
