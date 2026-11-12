import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowsClockwise, ArrowsOutSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import './App.css';
import './shell/shell.css';
import { resolveMapName } from './quests/mapNames';
import MapView from './map/MapView';
import MarkerLayer from './map/MarkerLayer';
import PlayerMarker from './map/PlayerMarker';
import FloorSwitcher from './map/FloorSwitcher';
import MapPicker from './components/MapPicker';
import { buildMapRows } from './components/mapRows';
import MapEmptyState from './components/MapEmptyState';
import QuestSidebar from './components/QuestSidebar';
import { Toast, IconButton, Spinner } from './ui';
import Spine, { type RailSection } from './shell/Spine';
import RailResizer from './shell/RailResizer';
import { useRelativeTime } from './hooks/useRelativeTime';
import SettingsModal from './components/SettingsModal';
import Onboarding, { ONBOARDED_KEY } from './onboarding/Onboarding';
import PatchNotesModal from './components/PatchNotesModal';
import FeedbackModal from './feedback/FeedbackModal';
import SquadSection from './squad/SquadSection';
import SquadmateLayer from './map/SquadmateLayer';
import { useSquad } from './squad/useSquad';
import PoiLayer from './map/PoiLayer';
import PoiFilterPanel from './map/PoiFilterPanel';
import GridOverlay from './map/GridOverlay';
import CustomMarkerLayer, { MapClickPlacer } from './map/CustomMarkerLayer';
import SquadMarkerLayer from './map/SquadMarkerLayer';
import DrawLayer from './map/DrawLayer';
import MapToolsDock from './map/MapToolsDock';
import FollowCamera from './map/FollowCamera';
import SquadQuestLayer from './map/SquadQuestLayer';
import SquadQuestSummary from './components/SquadQuestSummary';
import { useSettings } from './app/useSettings';
import { useRailWidth } from './app/useRailWidth';
import { useQuestSelection } from './app/useQuestSelection';
import { useQuestData } from './app/useQuestData';
import { useSelectedMap } from './app/useSelectedMap';
import { useGameEvents, useLogReplay } from './app/useGameEvents';
import { useFloors } from './app/useFloors';
import { usePois } from './app/usePois';
import { useDrawing } from './app/useDrawing';
import { useSquadSync } from './app/useSquadSync';
import { useAppUpdate } from './app/useAppUpdate';
import { usePlanner, useRaidHistory } from './app/usePlanner';
import { useTracker } from './app/useTracker';
import { useProgressionData, useQuestStatuses } from './app/useProgression';
import { useHotkeys, type HotkeyAction } from './app/useHotkeys';
import { useCompactMode } from './app/useCompactMode';
import { useMinimapWindow } from './app/useMinimapWindow';
import { minimapPoints } from './minimap/protocol';
import { exitsForSide, findPanelMap, matchExtractPanel, type ExitAliases } from './poi/extractPanel';
import { getExitAliases } from './api/tarkov-dev';
import type { Poi } from './poi/types';
import { canonicalMapId } from './map/canonicalMap';
import { mapIdFromLogLocation } from './map/logLocationMap';
import { currentRaid, learnSides, raidSide, setManualSide, type RaidSide } from './state/raidHistory';
import PlannerPanel, { type PlannerTab } from './planner/PlannerPanel';
import { useAppearance } from './appearance/useAppearance';
import GlassIntro from './intro/GlassIntro';
import TitleBar from './shell/TitleBar';
import PlaceLabelLayer from './map/PlaceLabelLayer';
import { collectObjectiveMaps } from './quests/derive';
import type { TarkovTask, TaskObjective } from './api/types';
import { effectiveStatus } from './state/localProgress';

// The weapon bench and its ~2 MB of data load only when it is first opened.
const GunsmithBench = lazy(() => import('./gunsmith/GunsmithBench'));
import { knownSymbol, useSelfSymbol } from './squad/symbols';
import { hexForColorId } from '../shared/squadProtocol';

// Stable empty array for the `objectives` prop fallback. A fresh `[]` literal
// would change identity every render, invalidating MarkerLayer's classified/
// counts memos and re-firing its onCounts effect → setFloorCounts → re-render
// → infinite loop. A shared frozen constant keeps the prop reference stable
// when the selected map has no objectives entry.
const EMPTY_OBJECTIVES: never[] = [];

// The shell: composes the app's state (src/app/use*.ts, one concern each) and
// lays out the rail, the map stage and the modals. Behavior lives in the hooks.
function App() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<string | null>(null);
  const [railSection, setRailSection] = useState<RailSection | null>('quests');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Onboarding wizard: auto-opens on first run only (tc_onboarded_v1); the
  // spine's Help button reopens it as the how-to guide.
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => !localStorage.getItem(ONBOARDED_KEY),
  );
  const [patchNotesOpen, setPatchNotesOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [gunsmithOpen, setGunsmithOpen] = useState(false);
  const [plannerTab, setPlannerTab] = useState<PlannerTab>('summary');
  const appearance = useAppearance();
  // The glass logo reveal plays once per launch (Settings → Appearance turns it off).
  const [showIntro, setShowIntro] = useState(() => appearance.intro);
  const selfSymbol = useSelfSymbol();

  const squad = useSquad();
  // Your marker colour: the squad seat colour, else your saved pick, else the live green.
  const selfColorId = squad.selfColorId ?? squad.identity.colorId;
  const selfColor = selfColorId ? hexForColorId(selfColorId) : undefined;
  const settings = useSettings();
  const railWidth = useRailWidth();
  const selection = useQuestSelection();
  const quests = useQuestData({
    onDerived: selection.pruneStaleSelections,
    onRefreshError: setToast,
  });
  const { questState, loading, error } = quests;
  const { selectedMapId, setSelectedMapId, selectedMapDef } = useSelectedMap(questState);
  const raidHistory = useRaidHistory();
  const planner = usePlanner();
  const compact = useCompactMode();
  // Progression data loads the first time the planner opens (lazy, ~2 MB).
  // Also needed on the map: which quests the player can take now (upcoming pins).
  const progressionLoad = useProgressionData(railSection === 'planner' || appearance.upcomingQuests);
  const tracker = useTracker({
    progress: quests.progress,
    setProgress: quests.setProgress,
    checkedObjectives: planner.planner.checkedObjectives,
    updatePlanner: planner.update,
    stations: progressionLoad.state === 'ready' ? progressionLoad.data.stations : null,
  });
  // O+O screenshot → the exits open to you this raid. The handler is assigned
  // further down, once the map's POIs and the live raid are known.
  const extractPanelHandler = useRef<((lines: string[], missingLanguage: string | null) => void) | null>(null);
  // Every exit's name in all six languages, so the list is read whatever
  // language the game runs in. Loaded once in the background (cached a week).
  const [exitAliases, setExitAliases] = useState<ExitAliases>({});
  useEffect(() => {
    let alive = true;
    getExitAliases()
      .then((a) => alive && setExitAliases(a))
      .catch((e) => console.warn('[extract panel] exit names in other languages unavailable:', e));
    return () => {
      alive = false;
    };
  }, []);
  const [extractPanel, setExtractPanel] = useState<{
    lines: string[];
    mapId: string | null;
    raidStartedAt: number | null;
  } | null>(null);
  const playerPos = useGameEvents({
    setProgress: quests.setProgress,
    setSelectedMapId,
    setHistory: raidHistory.setHistory,
    onLiveQuestEvent: tracker.onLiveQuest,
    onExtractPanel: (lines, missingLanguage) => extractPanelHandler.current?.(lines, missingLanguage),
  });
  const logReplay = useLogReplay(setToast);
  const floors = useFloors({
    selectedMapId,
    selectedMapDef,
    playerPos,
    setFloorLock: settings.setFloorLock,
  });
  const pois = usePois({ selectedMapId, squad, notify: setToast });
  const drawing = useDrawing({ selectedMapId, squad, notify: setToast });
  const squadSync = useSquadSync({
    squad,
    tasks: quests.tasks,
    questState,
    playerPos,
    selectedMapId,
  });
  const update = useAppUpdate(setToast);
  const questStatuses = useQuestStatuses(
    quests.tasks,
    progressionLoad.state === 'ready' ? progressionLoad.data : null,
    quests.progress,
  );
  // PMC or Scav: learned from the raid's profile fingerprint (see raidHistory).
  const sideKnowledge = useMemo(() => learnSides(raidHistory.history), [raidHistory.history]);
  // Re-checked every minute too, so a raid whose end never reached the logs
  // (game crash) stops counting as live once it is too old.
  const [raidClock, setRaidClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setRaidClock(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const liveRaid = useMemo(() => currentRaid(raidHistory.history, raidClock), [raidHistory.history, raidClock]);
  const liveRaidSide = liveRaid ? raidSide(liveRaid, sideKnowledge) : null;
  const liveRaidSideSource =
    liveRaid?.profileKey ? sideKnowledge.source.get(liveRaid.profileKey) ?? null : null;
  const { setHistory } = raidHistory;
  const setLiveRaidSide = useCallback(
    (side: RaidSide | null) => {
      const key = liveRaid?.profileKey;
      if (key) setHistory((h) => setManualSide(h, key, side));
    },
    [liveRaid, setHistory],
  );

  // The O+O list counts only for the raid and map it was read on.
  const panelMatch = useMemo(() => {
    if (!extractPanel || !selectedMapId || !extractPanel.mapId) return null;
    if (extractPanel.raidStartedAt !== (liveRaid?.startedAt ?? null)) return null;
    if (canonicalMapId(extractPanel.mapId) !== canonicalMapId(selectedMapId)) return null;
    return matchExtractPanel(extractPanel.lines, exitsForSide(pois.currentPois, liveRaidSide), exitAliases);
  }, [extractPanel, selectedMapId, liveRaid, liveRaidSide, pois.currentPois, exitAliases]);
  const panelExitIds = panelMatch?.ids ?? null;
  useEffect(() => {
    // A map's display name: the transits that lead to it carry it, localized.
    const mapLabel = (id: string): string => {
      for (const list of Object.values(pois.poisByMapId)) {
        for (const p of list) {
          const m = p.meta as { destMapId?: string; destMapName?: string } | undefined;
          if (p.category === 'transit' && m?.destMapId && m.destMapName && canonicalMapId(m.destMapId) === canonicalMapId(id)) {
            return m.destMapName;
          }
        }
      }
      return questState ? resolveMapName(id, questState.availableTasksByMap, questState.availableObjectivesByMap) : id;
    };
    extractPanelHandler.current = (lines, missingLanguage) => {
      // Try every map: the list itself says where you are. Ties go to the raid's map, then the one shown.
      const raidMap = liveRaid?.location ? mapIdFromLogLocation(liveRaid.location) ?? null : null;
      const sidePois = Object.fromEntries(
        Object.entries(pois.poisByMapId).map(([id, list]) => [id, exitsForSide(list, liveRaidSide)]),
      );
      const found = findPanelMap(lines, sidePois, exitAliases, raidMap ?? selectedMapId);
      if (!found) {
        // Three or more lines look like the list; say so instead of failing silently.
        if (missingLanguage) setToast(t('extractPanel.missingOcrLanguage', { lang: missingLanguage }));
        else if (lines.length >= 3) setToast(t('extractPanel.notMatched'));
        return;
      }
      setExtractPanel({ lines, mapId: found.mapId, raidStartedAt: liveRaid?.startedAt ?? null });
      const switching = !selectedMapId || canonicalMapId(found.mapId) !== canonicalMapId(selectedMapId);
      if (switching) setSelectedMapId(found.mapId);
      // Name what was read, so a wrong pick shows at once.
      const names = (pois.poisByMapId[found.mapId] ?? [])
        .filter((p) => found.match.ids.has(p.id))
        .map((p) => {
          const dest = (p.meta as { destMapName?: string } | undefined)?.destMapName;
          return p.category === 'transit' && dest ? `→ ${dest}` : p.label;
        });
      const head = switching
        ? t('extractPanel.readSwitched', { count: found.match.ids.size, map: mapLabel(found.mapId) })
        : t('extractPanel.read', { count: found.match.ids.size });
      setToast(`${head} ${names.join(' · ')}`);
    };
  });
  const panelExitNames = useMemo(
    () => (panelExitIds ? pois.currentPois.filter((p) => panelExitIds.has(p.id)).map((p) => p.label) : null),
    [panelExitIds, pois.currentPois],
  );
  // On the map, exits not in the O+O list are hidden while it applies.
  const { poiVisible } = pois;
  const isPoiVisible = useCallback(
    (p: Poi) =>
      poiVisible(p) && (!panelExitIds || (p.category !== 'extract' && p.category !== 'transit') || panelExitIds.has(p.id)),
    [poiVisible, panelExitIds],
  );

  // Minimap overlay window: fed the map, the last position fix, the floor and
  // a few points (active objectives, the extracts of your side) on this map.
  const minimapFeedPoints = useMemo(
    () =>
      selectedMapId && questState
        ? minimapPoints(
            selectedMapId,
            questState.availableObjectivesByMap[selectedMapId] ?? [],
            pois.currentPois,
            60,
            panelExitIds,
          )
        : [],
    [selectedMapId, questState, pois.currentPois, panelExitIds],
  );
  const minimapSelf = useMemo(() => ({ symbol: selfSymbol, color: selfColor }), [selfSymbol, selfColor]);
  const minimapMates = useMemo(
    () =>
      squad.members.flatMap((m) => {
        const p = squad.positions[m.id];
        if (m.id === squad.selfId || !p || p.payload.mapId !== selectedMapId) return [];
        return [{
          id: m.id,
          name: m.name,
          color: hexForColorId(m.colorId),
          symbol: knownSymbol(p.payload.symbol),
          x: p.payload.x,
          z: p.payload.z,
          rotation: p.payload.rotation,
          ts: p.ts,
        }];
      }),
    [squad.members, squad.positions, squad.selfId, selectedMapId],
  );
  const minimap = useMinimapWindow({
    mapId: selectedMapId,
    pos: playerPos,
    activeFloorId: floors.activeFloorId ?? null,
    points: minimapFeedPoints,
    self: minimapSelf,
    mates: minimapMates,
    inRaid: !!liveRaid,
  });
  // Quests the player can take now (prerequisites and level met) but the logs
  // never saw accepted: pinned dimmer on the map, so the places of "my" quests
  // show even before the game says they were picked up.
  const questTasks = quests.tasks;
  const upcomingObjectives = useMemo(() => {
    if (!selectedMapId || !questState) return [];
    const target = canonicalMapId(selectedMapId);
    const active = new Set(questState.available.map((x) => x.id));
    const out: { task: TarkovTask; objective: TaskObjective }[] = [];
    for (const task of questTasks) {
      if (active.has(task.id) || questStatuses.get(task.id)?.status !== 'available') continue;
      for (const objective of task.objectives ?? []) {
        const positioned =
          (objective.zones?.some((z) => z.position) ?? false) ||
          (objective.possibleLocations?.some((l) => l.positions && l.positions.length > 0) ?? false);
        if (positioned && collectObjectiveMaps(objective).some((m) => canonicalMapId(m) === target)) out.push({ task, objective });
      }
    }
    return out;
  }, [selectedMapId, questState, questTasks, questStatuses]);
  const relativeSynced = useRelativeTime(quests.lastSynced);
  // Quest-unlocked trader offers in the weapon bench open once the quest is done.
  const questProgress = quests.progress;
  const taskDone = useCallback((id: string) => effectiveStatus(questProgress, id) === 'complete', [questProgress]);
  const relativeStale = useRelativeTime(quests.staleSince);

  // Hover belongs to the map it happened on.
  const { clearHover } = selection;
  useEffect(() => {
    clearHover();
  }, [selectedMapId, clearHover]);

  // Spine section clicks toggle the rail panel section (click the active
  // icon again to collapse the panel and give the map the full width).
  const handleToggleSection = useCallback((s: RailSection) => {
    setRailSection((cur) => (cur === s ? null : s));
  }, []);

  const { setFollowCenter } = settings;
  const { toggleGrid } = pois;
  const { toggle: toggleCompact, setCompact } = compact;
  const hotkeyHandlers = useMemo<Record<HotkeyAction, () => void>>(
    () => ({
      quests: () => {
        setCompact(false);
        handleToggleSection('quests');
      },
      intel: () => {
        setCompact(false);
        handleToggleSection('intel');
      },
      squad: () => {
        setCompact(false);
        handleToggleSection('squad');
      },
      planner: () => {
        setCompact(false);
        handleToggleSection('planner');
      },
      raidPrep: () => {
        setCompact(false);
        setPlannerTab('raid');
        setRailSection('planner');
      },
      compact: toggleCompact,
      minimap: minimap.toggle,
      follow: () => setFollowCenter((v) => !v),
      grid: toggleGrid,
    }),
    [handleToggleSection, setCompact, toggleCompact, minimap.toggle, setFollowCenter, toggleGrid],
  );
  const hotkeys = useHotkeys(hotkeyHandlers);

  // Name of the map the live raid is on, for the "in raid" pill.
  const liveRaidMapName = useMemo(() => {
    const id = liveRaid?.location ? mapIdFromLogLocation(liveRaid.location) : null;
    if (!id) return liveRaid?.location ?? '';
    return questState ? resolveMapName(id, questState.availableTasksByMap, questState.availableObjectivesByMap) : id;
  }, [liveRaid, questState]);
  const selectedMapName = useMemo(() => {
    if (!questState || !selectedMapId) return '';
    return resolveMapName(
      selectedMapId,
      questState.availableTasksByMap,
      questState.availableObjectivesByMap,
    );
  }, [questState, selectedMapId]);

  // Rows for the pinned map picker + the deployment-board empty state.
  const mapRows = useMemo(
    () =>
      questState
        ? buildMapRows(questState.availableObjectivesByMap, questState.availableTasksByMap)
        : [],
    [questState],
  );

  // How much of the map the floating spine + rail cover (padding 10 + spine 64 +
  // gap 10, plus the rail and its gap). The docked layout puts them beside the
  // map instead, so nothing is covered.
  const chromeWidth =
    appearance.layout !== 'floating' || compact.compact
      ? 0
      : 10 + 64 + 10 + (railSection ? railWidth.width + 10 : 0);

  return (
    <div className="app-container">
      <TitleBar />
      {showIntro && <GlassIntro onDone={() => setShowIntro(false)} />}
      <Toast message={toast} onDismiss={() => setToast(null)} />
      <div
        className={`shell shell--${settings.railSide}${compact.compact ? ' shell--compact' : ''}`}
        style={{ '--chrome-w': `${chromeWidth}px` } as CSSProperties}
      >
        {!compact.compact && (
        <Spine
          side={settings.railSide}
          activeSection={railSection}
          onToggleSection={handleToggleSection}
          squadCount={squad.inSquad ? squad.members.length : undefined}
          questCount={
            questState && selectedMapId
              ? questState.availableTasksByMap[selectedMapId]?.length ?? 0
              : 0
          }
          updateVersion={update.availableUpdate?.version ?? null}
          updating={update.updating}
          onUpdate={update.apply}
          onSyncLogs={logReplay.replay}
          syncingLogs={logReplay.replaying}
          onFeedback={() => setFeedbackOpen(true)}
          onHowTo={() => setOnboardingOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onGunsmith={() => setGunsmithOpen(true)}
          onCompact={toggleCompact}
          hints={{
            quests: hotkeys.map.quests,
            intel: hotkeys.map.intel,
            squad: hotkeys.map.squad,
            planner: hotkeys.map.planner,
            compact: hotkeys.map.compact,
          }}
        />
        )}

        {railSection && !compact.compact && (
          <aside
            className="rail-panel"
            style={{ '--rail-w': `${railWidth.width}px` } as CSSProperties}
          >
            <RailResizer
              side={settings.railSide}
              width={railWidth.width}
              onResize={railWidth.setWidth}
              onReset={railWidth.reset}
            />
            {/* The map is the top-level selection — it's universal across every
                section, so it sits ABOVE the section title, divided from it. */}
            {questState && (
              <div className="rail-panel__map">
                <MapPicker
                  availableObjectivesByMap={questState.availableObjectivesByMap}
                  availableTasksByMap={questState.availableTasksByMap}
                  selectedMapId={selectedMapId}
                  onSelect={setSelectedMapId}
                />
                {liveRaid && (
                  <div className={`raid-pill raid-pill--${liveRaidSide ?? 'unknown'}`} role="status">
                    <span className="raid-pill__dot" aria-hidden="true" />
                    <span className="raid-pill__text">
                      {t('raidPill.live', { map: liveRaidMapName })}
                    </span>
                    {liveRaid.profileKey ? (
                      // Wrong side? One click flips it, and the app remembers it for this profile.
                      <button
                        type="button"
                        className="raid-pill__side raid-pill__side--btn"
                        title={t('raidPill.fix')}
                        onClick={() => setLiveRaidSide(liveRaidSide === 'scav' ? 'pmc' : 'scav')}
                      >
                        {t(`raidPill.${liveRaidSide ?? 'unknown'}`)}
                      </button>
                    ) : (
                      <span className="raid-pill__side">{t(`raidPill.${liveRaidSide ?? 'unknown'}`)}</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="rail-panel__header">
              <h2 className="rail-panel__title">
                {railSection === 'quests'
                  ? t('rail.quests')
                  : railSection === 'intel'
                    ? t('rail.intel')
                    : railSection === 'planner'
                      ? t('rail.plannerTitle')
                      : t('rail.squad')}
              </h2>
              {railSection === 'quests' && (
                <IconButton
                  icon={loading ? <Spinner size="sm" /> : <ArrowsClockwise weight="bold" />}
                  label={t('rail.refreshQuests')}
                  size="sm"
                  onClick={quests.refresh}
                  disabled={loading}
                />
              )}
            </div>
            <div className="rail-panel__body">
              {railSection === 'planner' ? (
                <PlannerPanel
                  load={progressionLoad}
                  tasks={quests.tasks}
                  statuses={questStatuses}
                  progress={quests.progress}
                  setProgress={quests.setProgress}
                  planner={planner}
                  history={raidHistory.history}
                  onClearHistory={raidHistory.clear}
                  questState={questState}
                  selectedMapId={selectedMapId}
                  selectedMapName={selectedMapName}
                  mapPois={pois.currentPois}
                  squadQuestStates={squadSync.squadQuestStates}
                  raidSide={liveRaidSide}
                  raidSideSource={liveRaidSideSource}
                  raidInProgress={!!liveRaid}
                  canSetRaidSide={!!liveRaid?.profileKey}
                  onSetRaidSide={setLiveRaidSide}
                  panelExits={panelExitNames}
                  tab={plannerTab}
                  onTab={setPlannerTab}
                />
              ) : railSection === 'squad' ? (
                <>
                  <SquadSection sharedQuestNames={squadSync.sharedQuestNames} />
                  <SquadQuestSummary
                    selfQuestState={questState}
                    questStates={squadSync.squadQuestStates}
                    onSelect={setSelectedMapId}
                  />
                </>
              ) : !questState ? (
                <p className="muted">{loading ? t('common.loadingQuestData') : t('common.noQuestData')}</p>
              ) : railSection === 'quests' ? (
                <QuestSidebar
                  selectedMapId={selectedMapId}
                  availableTasksByMap={questState.availableTasksByMap}
                  availableObjectivesByMap={questState.availableObjectivesByMap}
                  anyLocation={questState.anyLocation}
                  locked={questState.locked}
                  hoveredTaskId={selection.hoveredTaskId}
                  onHoverTask={selection.setHoveredTaskId}
                  hoveredObjectiveId={selection.hoveredObjectiveId}
                  onHoverObjective={selection.setHoveredObjectiveId}
                  pinned={selection.pinned}
                  onTogglePin={selection.togglePin}
                />
              ) : (
                <PoiFilterPanel
                  pois={pois.panelPois}
                  state={pois.filterState}
                  onToggleFacet={pois.toggleFacet}
                  onSetAllFacets={pois.setAllFacets}
                  onHideAll={pois.clearPoiSelection}
                  onToggleGrid={pois.toggleGrid}
                  onSaveDefault={pois.saveDefault}
                />
              )}
            </div>
            <div className="rail-panel__footer">
              <button
                className="rail-panel__version mono"
                onClick={() => setPatchNotesOpen(true)}
                title={t('rail.whatsNew')}
              >
                {update.appVersion ? `v${update.appVersion}` : 'dev'}
              </button>
              {relativeSynced && <span>· {t('common.synced', { time: relativeSynced })}</span>}
              {/* Attribution (tarkov.dev · Leaflet BSD-2 · Phosphor MIT) lives in
                  Settings → About, so the footer stays a single clean line. */}
            </div>
          </aside>
        )}

        <section className="map-stage map-area">
              {compact.compact && (
                <div className="compact-exit">
                  <IconButton
                    variant="secondary"
                    size="sm"
                    icon={<ArrowsOutSimple weight="bold" />}
                    label={t('rail.exitCompact')}
                    onClick={toggleCompact}
                  />
                </div>
              )}
              {error && <div className="shell-error">{error}</div>}
              {!error && relativeStale && (
                <div className="shell-warn">{t('common.staleData', { time: relativeStale })}</div>
              )}
              {selectedMapId && questState ? (
                <>
                  <MapView mapId={selectedMapId} mapName={selectedMapName} activeFloorId={floors.activeFloorId}>
                    {squadSync.showOwnOnMap && (
                      <MarkerLayer
                        mapId={selectedMapId}
                        objectives={questState.availableObjectivesByMap[selectedMapId] ?? EMPTY_OBJECTIVES}
                        highlightedTaskId={selection.hoveredTaskId ?? (selection.pinned?.kind === 'task' ? selection.pinned.id : null)}
                        highlightedObjectiveId={selection.hoveredObjectiveId ?? (selection.pinned?.kind === 'objective' ? selection.pinned.id : null)}
                        floors={selectedMapDef?.floors}
                        activeFloorId={floors.activeFloorId}
                        onCounts={floors.setFloorCounts}
                        onHoverObjective={selection.setHoveredObjectiveId}
                        onTogglePin={selection.togglePin}
                        sharedQuestIds={squadSync.sharedQuestIds}
                        upcoming={appearance.upcomingQuests ? upcomingObjectives : undefined}
                        showNames={appearance.questNames}
                      />
                    )}
                    <PlaceLabelLayer mapId={selectedMapId} visible={appearance.placeLabels} />
                    <SquadQuestLayer
                      mapId={selectedMapId}
                      questStates={squadSync.squadQuestStates}
                      sharedQuestIds={squadSync.sharedQuestIds}
                    />
                    <PlayerMarker
                      position={playerPos}
                      mapId={selectedMapId}
                      symbol={selfSymbol}
                      color={selfColor}
                    />
                    <FollowCamera
                      mapId={selectedMapId}
                      pos={playerPos}
                      zoom={settings.followZoom}
                      enabled={settings.followCenter}
                    />
                    <SquadmateLayer mapId={selectedMapId} />
                    <PoiLayer
                      mapId={selectedMapId}
                      pois={pois.currentPois}
                      isVisible={isPoiVisible}
                      selectedPoiIds={pois.selectedPoiIds}
                      floors={selectedMapDef?.floors}
                      activeFloorId={floors.activeFloorId}
                      onSelect={pois.togglePoi}
                    />
                    <GridOverlay mapId={selectedMapId} visible={pois.filterState.gridVisible} />
                    {drawing.drawTool === null && (
                      <MapClickPlacer mapId={selectedMapId} onAdd={pois.addCustom} />
                    )}
                    {pois.customEnabled && squadSync.showOwnOnMap && (
                      <CustomMarkerLayer
                        mapId={selectedMapId}
                        pois={pois.currentCustomPois}
                        onRemove={pois.removeCustom}
                      />
                    )}
                    <SquadMarkerLayer mapId={selectedMapId} />
                    <DrawLayer
                      mapId={selectedMapId}
                      tool={drawing.drawTool}
                      color={drawing.myDrawHex}
                      ownDraws={drawing.ownDraws}
                      onCommit={drawing.commitStroke}
                    />
                  </MapView>
                  {!settings.floorLock && selectedMapDef?.floors && selectedMapDef.floors.length > 0 && (
                    <FloorSwitcher
                      floors={selectedMapDef.floors}
                      activeFloorId={floors.activeFloorId}
                      counts={floors.floorCounts}
                      autoFollow={floors.autoFollowFloor}
                      onSelect={floors.selectFloor}
                      onAuto={floors.enableAutoFloor}
                    />
                  )}
                  <MapToolsDock
                    tool={drawing.drawTool}
                    onTool={drawing.setDrawTool}
                    color={drawing.myDrawHex}
                    canClear={drawing.canClear}
                    onClear={drawing.clearOwnDraws}
                  />
                </>
              ) : !questState ? (
                <div className="map-placeholder">
                  {loading ? <Spinner size="lg" /> : t('common.noQuestDataCheckConnection')}
                </div>
              ) : (
                <MapEmptyState
                  rows={mapRows}
                  squadCounts={squadSync.squadMapCounts}
                  onSelect={setSelectedMapId}
                />
              )}
        </section>
      </div>
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          railSide={settings.railSide}
          onRailSideChange={settings.setRailSide}
          followCenter={settings.followCenter}
          onFollowCenterChange={settings.setFollowCenter}
          followZoom={settings.followZoom}
          onFollowZoomChange={settings.setFollowZoom}
          floorLock={settings.floorLock}
          onFloorLockChange={floors.changeFloorLock}
          hotkeys={hotkeys}
          compactOnTopOk={compact.onTopOk}
          minimap={minimap}
          tracker={tracker}
          onReplayIntro={() => {
            setSettingsOpen(false);
            setShowIntro(true);
          }}
        />
      )}
      {onboardingOpen && (
        <Onboarding
          onClose={() => setOnboardingOpen(false)}
          railSide={settings.railSide}
          onRailSideChange={settings.setRailSide}
          onSyncLogs={logReplay.replay}
          syncingLogs={logReplay.replaying}
          followCenter={settings.followCenter}
          onFollowCenterChange={settings.setFollowCenter}
          followZoom={settings.followZoom}
          onFollowZoomChange={settings.setFollowZoom}
        />
      )}
      {gunsmithOpen && (
        <Suspense fallback={null}>
          <GunsmithBench
            onClose={() => setGunsmithOpen(false)}
            playerLevel={quests.progress.levelSet ? quests.progress.playerLevel : null}
            taskDone={taskDone}
          />
        </Suspense>
      )}
      {patchNotesOpen && (
        <PatchNotesModal onClose={() => setPatchNotesOpen(false)} />
      )}
      {feedbackOpen && (
        <FeedbackModal
          onClose={() => setFeedbackOpen(false)}
          appVersion={update.appVersion}
          activeMapId={selectedMapId}
          squadActive={squad.inSquad}
        />
      )}
    </div>
  );
}

export default App;
