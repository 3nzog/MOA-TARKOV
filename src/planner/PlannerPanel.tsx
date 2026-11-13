// The planner: progression and raid prep in one rail section. Tabs share one
// context object; each tab is a pure view over it.
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { TarkovTask } from '../api/types';
import type { ProgressionLoad } from '../app/useProgression';
import type { PlannerApi } from '../app/usePlanner';
import type { DerivedQuestState } from '../quests/derive';
import type { QuestInfo } from '../progression/status';
import type { ProgressionData } from '../progression/types';
import type { LocalProgress } from '../state/localProgress';
import type { RaidHistory, RaidSide } from '../state/raidHistory';
import type { Poi } from '../poi/types';
import { Spinner, Tabs } from '../ui';
import { makeNames, type Names } from './names';
import SummaryTab from './SummaryTab';
import QuestBoard from './QuestBoard';
import NeedsTab from './NeedsTab';
import HideoutTab from './HideoutTab';
import RaidPrepTab from './RaidPrepTab';
import MarketTab from './MarketTab';
import type { ScannedItems } from './scanned';
import './planner.css';

export type PlannerTab = 'summary' | 'quests' | 'items' | 'hideout' | 'raid' | 'market';

export interface PlannerCtx {
  data: ProgressionData;
  names: Names;
  tasks: TarkovTask[];
  statuses: Map<string, QuestInfo>;
  progress: LocalProgress;
  setProgress: Dispatch<SetStateAction<LocalProgress>>;
  planner: PlannerApi;
}

interface Props {
  /** Items from an inventory screenshot, shown on the market tab. */
  scanned?: ScannedItems | null;
  onClearScan?: () => void;
  load: ProgressionLoad;
  tasks: TarkovTask[];
  statuses: Map<string, QuestInfo>;
  progress: LocalProgress;
  setProgress: Dispatch<SetStateAction<LocalProgress>>;
  planner: PlannerApi;
  history: RaidHistory;
  onClearHistory: () => void;
  questState: DerivedQuestState | null;
  selectedMapId: string | null;
  selectedMapName: string;
  mapPois: Poi[];
  squadQuestStates: Record<string, DerivedQuestState>;
  raidSide: RaidSide | null;
  raidSideSource: 'manual' | 'group' | 'elimination' | null;
  raidInProgress: boolean;
  canSetRaidSide: boolean;
  onSetRaidSide: (side: RaidSide | null) => void;
  /** Exit names read from the O+O list this raid; null = not read. */
  panelExits: string[] | null;
  tab: PlannerTab;
  onTab: (tab: PlannerTab) => void;
}

export default function PlannerPanel(props: Props) {
  const { t, i18n } = useTranslation();
  const { load, tasks, tab, onTab } = props;
  // A quest to open on the quests tab (from a suggestion or a raid-prep link).
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const data = load.state === 'ready' ? load.data : null;
  const names = useMemo(() => makeNames(data, tasks, t('planner.unknown')), [data, tasks, t]);

  if (load.state === 'idle' || load.state === 'loading') {
    return (
      <div className="planner-state">
        <Spinner size="md" />
        <span>{t('planner.loading')}</span>
      </div>
    );
  }
  if (load.state === 'error' || !data) {
    return <p className="settings-err">{t('planner.loadError')}</p>;
  }
  if (tasks.length === 0) {
    return <p className="muted">{t('common.noQuestData')}</p>;
  }

  const ctx: PlannerCtx = {
    data,
    names,
    tasks,
    statuses: props.statuses,
    progress: props.progress,
    setProgress: props.setProgress,
    planner: props.planner,
  };

  const openQuest = (id: string) => {
    setFocusTaskId(id);
    onTab('quests');
  };

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <div className="planner">
      <Tabs
        className="planner-tabs"
        value={tab}
        onChange={(id) => onTab(id as PlannerTab)}
        items={[
          { id: 'summary', label: t('planner.tabs.summary') },
          { id: 'quests', label: t('planner.tabs.quests') },
          { id: 'items', label: t('planner.tabs.items') },
          { id: 'hideout', label: t('planner.tabs.hideout') },
          { id: 'raid', label: t('planner.tabs.raid') },
          { id: 'market', label: t('planner.tabs.market') },
        ]}
      />
      <div className="planner-body">
        {tab === 'summary' && (
          <SummaryTab ctx={ctx} history={props.history} onClearHistory={props.onClearHistory} onOpenQuest={openQuest} />
        )}
        {tab === 'quests' && (
          <QuestBoard ctx={ctx} selectedMapId={props.selectedMapId} focusTaskId={focusTaskId} onFocusHandled={() => setFocusTaskId(null)} />
        )}
        {tab === 'items' && <NeedsTab ctx={ctx} onOpenQuest={openQuest} />}
        {tab === 'hideout' && <HideoutTab ctx={ctx} />}
        {tab === 'raid' && (
          <RaidPrepTab
            ctx={ctx}
            questState={props.questState}
            selectedMapId={props.selectedMapId}
            selectedMapName={props.selectedMapName}
            mapPois={props.mapPois}
            squadQuestStates={props.squadQuestStates}
            raidSide={props.raidSide}
            raidSideSource={props.raidSideSource}
            raidInProgress={props.raidInProgress}
            canSetRaidSide={props.canSetRaidSide}
            onSetRaidSide={props.onSetRaidSide}
            panelExits={props.panelExits}
            onOpenQuest={openQuest}
          />
        )}
        {tab === 'market' && <MarketTab ctx={ctx} scanned={props.scanned} onClearScan={props.onClearScan} />}
      </div>
      <p className="planner-source">
        {t(data.source === 'remote' ? 'planner.sourceRemote' : 'planner.sourceBundled', {
          date: data.generatedAt ? dateFmt.format(data.generatedAt) : '—',
        })}
      </p>
    </div>
  );
}
