import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Chip, Input, SectionLabel, Segmented } from '../ui';
import { suggestNext } from '../progression/status';
import { computeStats, raidDuration, type RaidHistory } from '../state/raidHistory';
import {
  clearPlayerLevel,
  setFaction,
  setPlayerLevel,
  setQuestOverride,
  type Faction,
} from '../state/localProgress';
import { formatDuration } from './names';
import type { PlannerCtx } from './PlannerPanel';

interface Props {
  ctx: PlannerCtx;
  history: RaidHistory;
  onClearHistory: () => void;
  onOpenQuest: (id: string) => void;
}

function toDateInput(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function SummaryTab({ ctx, history, onClearHistory, onOpenQuest }: Props) {
  const { t, i18n } = useTranslation();
  const { statuses, data, progress, setProgress, names, planner } = ctx;

  const counts = useMemo(() => {
    const c = { complete: 0, active: 0, available: 0, locked: 0, failed: 0, kappa: 0, kappaDone: 0, stale: [] as string[] };
    for (const [id, info] of statuses) {
      c[info.status] += 1;
      if (data.tasks[id]?.kappa) {
        c.kappa += 1;
        if (info.status === 'complete') c.kappaDone += 1;
      }
      if (info.staleActive) c.stale.push(id);
    }
    return c;
  }, [statuses, data]);

  const suggestions = useMemo(() => suggestNext(statuses, data.tasks, 6), [statuses, data]);
  const stats = useMemo(() => computeStats(history, planner.planner.wipeStart), [history, planner.planner.wipeStart]);
  const recent = useMemo(() => history.raids.slice(-8).reverse(), [history]);
  const dt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  const factionValue = progress.factionSet ? progress.faction : 'unknown';
  // Clearing history cannot be undone — ask for a second click.
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="planner-stack">
      <SectionLabel help={t('planner.profile.hint')}>{t('planner.profile.title')}</SectionLabel>
      <div className="planner-row">
        <label className="planner-row__label" htmlFor="planner-level">{t('planner.profile.level')}</label>
        <Input
          id="planner-level"
          uiSize="sm"
          type="number"
          min={1}
          max={79}
          className="planner-num"
          placeholder={t('planner.profile.unknownShort')}
          value={progress.levelSet ? progress.playerLevel : ''}
          onChange={(e) => {
            const v = Number(e.target.value);
            setProgress((p) => (e.target.value === '' || !Number.isFinite(v) ? clearPlayerLevel(p) : setPlayerLevel(p, v)));
          }}
        />
      </div>
      <Segmented
        fullWidth
        value={factionValue}
        onChange={(v) => setProgress((p) => setFaction(p, v === 'unknown' ? null : (v as Faction)))}
        options={[
          { id: 'unknown', label: t('planner.profile.unknownShort') },
          { id: 'USEC', label: 'USEC' },
          { id: 'BEAR', label: 'BEAR' },
        ]}
      />

      <SectionLabel help={t('planner.summary.trackingNote')}>{t('planner.summary.progress')}</SectionLabel>
      <div className="planner-stats">
        <div><span className="mono">{counts.complete}</span>{t('planner.status.complete')}</div>
        <div><span className="mono">{counts.active}</span>{t('planner.status.active')}</div>
        <div><span className="mono">{counts.available}</span>{t('planner.status.available')}</div>
        <div><span className="mono">{counts.locked}</span>{t('planner.status.locked')}</div>
        <div><span className="mono">{counts.kappaDone}/{counts.kappa}</span>Kappa</div>
      </div>

      {counts.stale.length > 0 && (
        <div className="planner-callout">
          <p>{t('planner.summary.staleActive', { count: counts.stale.length })}</p>
          <Button
            size="sm"
            onClick={() =>
              setProgress((p) => counts.stale.reduce((acc, id) => setQuestOverride(acc, id, 'complete'), p))
            }
          >
            {t('planner.summary.markStaleComplete')}
          </Button>
        </div>
      )}

      <SectionLabel help={t('planner.summary.nextHint')}>{t('planner.summary.next')}</SectionLabel>
      {suggestions.length === 0 ? (
        <p className="muted">{t('planner.summary.noSuggestions')}</p>
      ) : (
        <ul className="planner-list">
          {suggestions.map((s) => {
            const task = ctx.tasks.find((x) => x.id === s.taskId);
            return (
              <li key={s.taskId}>
                <button type="button" className="planner-link" onClick={() => onOpenQuest(s.taskId)}>
                  {names.task(s.taskId)}
                </button>
                {task?.trader && <span className="trader"> — {task.trader.name}</span>}
                <span className="planner-meta">
                  {s.downstream > 0 && <Chip size="sm">{t('planner.summary.unlocks', { count: s.downstream })}</Chip>}
                  {s.kappa && <Chip size="sm">Kappa</Chip>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <SectionLabel help={t('planner.stats.limits')}>{t('planner.stats.title')}</SectionLabel>
      <div className="planner-row">
        <label className="planner-row__label" htmlFor="planner-wipe">{t('planner.stats.wipeStart')}</label>
        <Input
          id="planner-wipe"
          uiSize="sm"
          type="date"
          value={toDateInput(planner.planner.wipeStart)}
          onChange={(e) => {
            const [y, m, d] = e.target.value.split('-').map(Number);
            planner.setWipeStart(e.target.value ? new Date(y, m - 1, d).getTime() : null);
          }}
        />
      </div>
      {stats.raids === 0 ? (
        <p className="muted">{t('planner.stats.empty')}</p>
      ) : (
        <>
          <div className="planner-stats">
            <div><span className="mono">{stats.raids}</span>{t('planner.stats.raids')}</div>
            <div><span className="mono">{formatDuration(stats.totalMs)}</span>{t('planner.stats.inRaid')}</div>
            <div><span className="mono">{stats.avgMs === null ? '—' : formatDuration(stats.avgMs)}</span>{t('planner.stats.avg')}</div>
            <div><span className="mono">{stats.questsCompleted}</span>{t('planner.stats.questsDone')}</div>
            <div><span className="mono">{stats.bySide.pmc}</span>PMC</div>
            <div><span className="mono">{stats.bySide.scav}</span>Scav</div>
          </div>
          <ul className="planner-list planner-list--dense">
            {stats.byLocation.slice(0, 8).map((l) => (
              <li key={l.location}>
                {names.logLocation(l.location === '?' ? null : l.location)}
                <span className="planner-meta mono">
                  {l.raids} · {formatDuration(l.totalMs)}
                </span>
              </li>
            ))}
          </ul>
          <SectionLabel>{t('planner.stats.recent')}</SectionLabel>
          <ul className="planner-list planner-list--dense">
            {recent.map((r, i) => {
              const d = raidDuration(r);
              const when = r.startedAt ?? r.endedAt;
              return (
                <li key={`${when}-${i}`}>
                  {names.logLocation(r.location)}
                  <span className="planner-meta mono">
                    {when ? dt.format(when) : '—'} · {d === null ? t('planner.stats.open') : formatDuration(d)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {history.raids.length > 0 && (
        <Button
          size="sm"
          variant={confirmClear ? 'danger' : 'tertiary'}
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            setConfirmClear(false);
            onClearHistory();
          }}
          onBlur={() => setConfirmClear(false)}
        >
          {confirmClear ? t('planner.stats.confirmClear') : t('planner.stats.clear')}
        </Button>
      )}
    </div>
  );
}
