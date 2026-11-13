// "What do I take into this raid?" for the selected map — plus, in a squad,
// what each teammate's active quests ask for on the same map.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy } from '@phosphor-icons/react';
import type { DerivedQuestState } from '../quests/derive';
import type { Poi } from '../poi/types';
import { aggregateNeeds } from '../progression/needs';
import type { QuestInfo } from '../progression/status';
import type { RaidSide } from '../state/raidHistory';
import { buildRaidPrep, type RaidPrep } from '../progression/raidPrep';
import { useSquad } from '../squad/useSquad';
import { hexForColorId } from '../../shared/squadProtocol';
import { Button, Chip, SectionLabel } from '../ui';
import type { Names } from './names';
import type { PlannerCtx } from './PlannerPanel';

interface Props {
  ctx: PlannerCtx;
  questState: DerivedQuestState | null;
  selectedMapId: string | null;
  selectedMapName: string;
  mapPois: Poi[];
  squadQuestStates: Record<string, DerivedQuestState>;
  raidSide: RaidSide | null;
  raidSideSource: 'manual' | 'panel' | 'group' | 'elimination' | null;
  raidInProgress: boolean;
  canSetRaidSide: boolean;
  onSetRaidSide: (side: RaidSide | null) => void;
  /** Exit names read from the O+O list this raid; null = not read. */
  panelExits: string[] | null;
  onOpenQuest: (id: string) => void;
}

function checklistText(prep: RaidPrep, mapName: string, names: Names, t: (k: string, o?: Record<string, unknown>) => string): string {
  const lines = [`${mapName}`];
  if (prep.keys.length) {
    lines.push('', `${t('planner.raid.keys')}:`);
    for (const k of prep.keys) lines.push(`- ${k.itemIds.map(names.item).join(' / ')}`);
  }
  if (prep.carry.length) {
    lines.push('', `${t('planner.raid.carry')}:`);
    for (const c of prep.carry) lines.push(`- ${c.count}× ${names.item(c.itemId)}`);
  }
  if (prep.pickups.length) {
    lines.push('', `${t('planner.raid.pickups')}:`);
    for (const p of prep.pickups) lines.push(`- ${names.questItem(p.questItemId)}`);
  }
  if (prep.extracts.length) {
    lines.push('', `${t('planner.raid.extracts')}:`);
    for (const e of prep.extracts) lines.push(`- ${e.label}: ${e.note}`);
  }
  return lines.join('\n');
}

export default function RaidPrepTab({
  ctx,
  questState,
  selectedMapId,
  selectedMapName,
  mapPois,
  squadQuestStates,
  raidSide,
  raidSideSource,
  raidInProgress,
  canSetRaidSide,
  onSetRaidSide,
  panelExits,
  onOpenQuest,
}: Props) {
  const { t } = useTranslation();
  const { data, names, planner, tasks, statuses } = ctx;
  const squad = useSquad();
  const [copied, setCopied] = useState(false);

  const mapTasks = useMemo(
    () => (selectedMapId && questState ? questState.availableTasksByMap[selectedMapId] ?? [] : []),
    [questState, selectedMapId],
  );

  const prep = useMemo(
    () =>
      selectedMapId
        ? buildRaidPrep({ mapId: selectedMapId, tasks: mapTasks, meta: data.tasks, checkedObjectives: planner.checkedObjectives, pois: mapPois })
        : null,
    [selectedMapId, mapTasks, data, planner.checkedObjectives, mapPois],
  );

  // FIR hand-ins for ACTIVE quests: what to keep an eye out for in any raid.
  const firWanted = useMemo(
    () =>
      aggregateNeeds({
        tasks,
        meta: data.tasks,
        statuses,
        scope: 'active',
        checkedObjectives: planner.checkedObjectives,
        includeHideout: false,
        stations: [],
        stationLevels: {},
      }).filter((n) => n.fir && (planner.planner.collected[n.key] ?? 0) < n.count),
    [tasks, data, statuses, planner.checkedObjectives, planner.planner.collected],
  );

  const teammates = useMemo(() => {
    if (!squad.inSquad || !selectedMapId) return [];
    return squad.members
      .filter((m) => m.id !== squad.selfId)
      .map((m) => {
        const st = squadQuestStates[m.id];
        const mt = st?.availableTasksByMap[selectedMapId] ?? [];
        // Their FIR hand-ins, from the active quests they share (not map-bound).
        const active = st?.available ?? [];
        const statuses = new Map<string, QuestInfo>(
          active.map((task) => [task.id, { status: 'active', inferred: false, manual: false, staleActive: false, lockReasons: [] }]),
        );
        const fir = aggregateNeeds({
          tasks: active,
          meta: data.tasks,
          statuses,
          scope: 'active',
          checkedObjectives: new Set(),
          includeHideout: false,
          stations: [],
          stationLevels: {},
        }).filter((n) => n.fir);
        return {
          member: m,
          tasks: mt,
          fir,
          prep: buildRaidPrep({ mapId: selectedMapId, tasks: mt, meta: data.tasks, checkedObjectives: new Set(), pois: [] }),
        };
      });
  }, [squad.inSquad, squad.members, squad.selfId, squadQuestStates, selectedMapId, data]);

  if (!selectedMapId || !prep) {
    return <p className="muted">{t('planner.raid.pickMap')}</p>;
  }

  // The shell's resolver only knows maps that have an active quest; the static
  // map list covers the rest.
  const known = names.map(selectedMapId);
  const mapName = known !== t('planner.unknown') ? known : selectedMapName;
  // Only the exits of the side you are on (PMC when unknown); shared ones always.
  const mySide = raidSide === 'scav' ? 'scav' : 'pmc';
  // The O+O list, when read, is the exact answer and replaces the side guess.
  const listed = panelExits ? new Set(panelExits) : null;
  const extracts = prep.extracts.filter((e) =>
    listed ? listed.has(e.label) : e.faction === 'shared' || e.faction === mySide,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(checklistText({ ...prep, extracts }, mapName, names, t));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const nothing = prep.keys.length + prep.carry.length + prep.pickups.length === 0;

  return (
    <div className="planner-stack">
      <div className="planner-row">
        <strong>{mapName}</strong>
        <Button size="sm" variant="tertiary" icon={<Copy />} onClick={() => void copy()}>
          {copied ? t('planner.raid.copied') : t('planner.raid.copy')}
        </Button>
      </div>
      {raidInProgress && (
        <div className="planner-callout planner-callout--info">
          <p>
            {raidSide
              ? t(raidSide === 'scav' ? 'planner.side.scavNow' : 'planner.side.pmcNow')
              : t('planner.side.unknownNow')}
            {raidSide && raidSideSource && (
              <span className="planner-hint"> · {t(`planner.side.source.${raidSideSource}`)}</span>
            )}
          </p>
          {raidSide === 'scav' && <p className="planner-hint">{t('planner.side.scavQuests')}</p>}
          {panelExits ? (
            <p>
              {t('extractPanel.yourExits', { count: panelExits.length })} {panelExits.join(' · ')}
            </p>
          ) : (
            <p className="planner-hint">{t('extractPanel.hint')}</p>
          )}
          {canSetRaidSide && (
            <div className="planner-chips">
              <Chip size="sm" selected={raidSide === 'pmc' && raidSideSource === 'manual'} onClick={() => onSetRaidSide('pmc')}>
                {t('planner.side.markPmc')}
              </Chip>
              <Chip size="sm" selected={raidSide === 'scav' && raidSideSource === 'manual'} onClick={() => onSetRaidSide('scav')}>
                {t('planner.side.markScav')}
              </Chip>
              {raidSideSource === 'manual' && (
                <Chip size="sm" onClick={() => onSetRaidSide(null)}>
                  {t('planner.side.auto')}
                </Chip>
              )}
            </div>
          )}
        </div>
      )}
      <p className="planner-hint">{t('planner.raid.activeHere', { count: mapTasks.length })}</p>
      {mapTasks.length > 0 && (
        <ul className="planner-list planner-list--dense">
          {mapTasks.map((task) => (
            <li key={task.id}>
              <button type="button" className="planner-link" onClick={() => onOpenQuest(task.id)}>{task.name}</button>
              {task.trader && <span className="trader"> — {task.trader.name}</span>}
            </li>
          ))}
        </ul>
      )}

      <SectionLabel>{t('planner.raid.keys')}</SectionLabel>
      {prep.keys.length === 0 ? (
        <p className="muted">{t('planner.raid.noKeys')}</p>
      ) : (
        <ul className="planner-objectives">
          {prep.keys.map((k) => {
            const owned = k.itemIds.some((id) => planner.keysOwned.has(id));
            return (
              <li key={k.itemIds.join('|')} className={owned ? 'planner-objective--done' : undefined}>
                <label>
                  <input type="checkbox" checked={owned} onChange={() => planner.toggleKeyOwned(k.itemIds[0])} />
                  <span>
                    {k.itemIds.map(names.item).join(` ${t('planner.or')} `)}
                    <span className="planner-item-line">{k.taskIds.map(names.task).join(', ')}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <SectionLabel>{t('planner.raid.carry')}</SectionLabel>
      {prep.carry.length === 0 ? (
        <p className="muted">{t('planner.raid.noCarry')}</p>
      ) : (
        <ul className="planner-list planner-list--dense">
          {prep.carry.map((c) => (
            <li key={`${c.objectiveId}-${c.itemId}`}>
              {c.count}× {names.item(c.itemId)}
              <span className="planner-meta planner-hint">{t(`planner.raid.kind.${c.kind}`)} · {names.task(c.taskId)}</span>
            </li>
          ))}
        </ul>
      )}

      {prep.pickups.length > 0 && (
        <>
          <SectionLabel>{t('planner.raid.pickups')}</SectionLabel>
          <ul className="planner-list planner-list--dense">
            {prep.pickups.map((p) => (
              <li key={p.objectiveId}>
                {names.questItem(p.questItemId)}
                <span className="planner-meta planner-hint">{names.task(p.taskId)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionLabel>{t('planner.raid.extracts')}</SectionLabel>
      {mapPois.length === 0 ? (
        <p className="muted">{t('planner.raid.noPois')}</p>
      ) : extracts.length === 0 ? (
        <p className="muted">{t('planner.raid.noGatedExtracts')}</p>
      ) : (
        <ul className="planner-list planner-list--dense">
          {extracts.map((e) => (
            <li key={e.poiId}>
              <span>
                {e.label}
                <span className="planner-item-line">{e.note}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <SectionLabel>{t('planner.raid.firWanted')}</SectionLabel>
      {firWanted.length === 0 ? (
        <p className="muted">{t('planner.raid.noFir')}</p>
      ) : (
        <ul className="planner-list planner-list--dense">
          {firWanted.slice(0, 15).map((n) => (
            <li key={n.key}>
              {n.itemId ? names.item(n.itemId) : n.label}
              <span className="planner-meta mono">
                {planner.planner.collected[n.key] ?? 0}/{n.count}
              </span>
            </li>
          ))}
        </ul>
      )}

      {nothing && mapTasks.length > 0 && <p className="planner-hint">{t('planner.raid.nothingSpecial')}</p>}

      {teammates.length > 0 && (
        <>
          <SectionLabel>{t('planner.raid.squad')}</SectionLabel>
          {teammates.map(({ member, tasks: mt, prep: p, fir }) => (
            <div key={member.id} className="planner-mate">
              <div className="planner-mate__head">
                <span className="planner-mate__dot" style={{ background: hexForColorId(member.colorId) }} />
                <strong>{member.name}</strong>
                <span className="planner-meta planner-hint">{t('planner.raid.activeHere', { count: mt.length })}</span>
              </div>
              {p.keys.length > 0 && (
                <p className="planner-hint">
                  {t('planner.raid.keys')}: {p.keys.map((k) => k.itemIds.map(names.itemShort).join('/')).join(', ')}
                </p>
              )}
              {p.carry.length > 0 && (
                <p className="planner-hint">
                  {t('planner.raid.carry')}: {p.carry.map((c) => `${c.count}× ${names.itemShort(c.itemId)}`).join(', ')}
                </p>
              )}
              {fir.length > 0 && (
                <p className="planner-hint">
                  {t('planner.raid.firWanted')}:{' '}
                  {fir
                    .slice(0, 8)
                    .map((n) => `${n.count}× ${n.itemId ? names.itemShort(n.itemId) : n.label ?? '?'}`)
                    .join(', ')}
                  {fir.length > 8 && ' …'}
                </p>
              )}
            </div>
          ))}
          <p className="planner-hint">{t('planner.raid.squadNote')}</p>
        </>
      )}
    </div>
  );
}
