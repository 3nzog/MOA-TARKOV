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
import RouteLayer from './route/RouteLayer';
import HeatLayer from './route/HeatLayer';
import { useItemNames } from './route/itemNames';
import RoutePanel from './route/RoutePanel';
import { useRaidRoute } from './route/useRaidRoute';
import { questDoneSound, useSoundAlerts } from './sound/useSoundAlerts';
import { useRoutePrefs } from './route/routePrefs';
import { hideoutNeedIds } from './route/routeData';
import { aggregateNeeds } from './progression/needs';
import { useQuestScreen } from './quests/useQuestScreen';
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
import { minimapPoints, minimapRoute } from './minimap/protocol';
import { exitsForSide, findPanelMap, matchExtractPanel, type ExitAliases } from './poi/extractPanel';
import { getExitAliases } from './api/tarkov-dev';
import type { Poi } from './poi/types';
import { canonicalMapId } from './map/canonicalMap';
import { mapIdFromLogLocation } from './map/logLocationMap';
import { currentRaid, learnSides, raidSide, setManualSide, setPanelSide, type RaidSide } from './state/raidHistory';
import { exitTier, sideFromPanel } from './poi/exitTier';
import { facetDefaultOn } from './poi/facets';
import DangerZoneLayer from './map/DangerZoneLayer';
import ArtMapViewer from './map/ArtMapViewer';
import { ART_MAPS, TILE_STYLES } from './map/mapStyles';
import { sniperSpots } from './poi/sniper';
import PlannerPanel, { type PlannerTab } from './planner/PlannerPanel';
import { scannedItems } from './planner/scanned';
import { setAppearance, useAppearance } from './appearance/useAppearance';
import GlassIntro from './intro/GlassIntro';
import TitleBar from './shell/TitleBar';
import { SUPPORTED_MAP_NAMES } from './map/mapDefs';
import LinkRequestDialog from './link/LinkRequestDialog';
import { useMirroredState, usePublishState } from './link/linkState';
import { normalizeTraderLevels, setTraderLevels, useTraderLevels } from './gunsmith/availability';
import { replacePresets, usePresets } from './gunsmith/presets';
import { normalizeProgress } from './state/localProgress';
import { subscribeScreenText } from './services/tauriEvents';
import { parseHistory } from './state/raidHistory';
import { parsePlanner } from './state/planner';
import { normalizeCustomPois } from './poi/customPoi';
import type { SettingsTab } from './components/SettingsModal';
import PriceScanCard from './prices/PriceScan';
import { usePriceScan } from './prices/usePriceScan';
import PlaceLabelLayer from './map/PlaceLabelLayer';
import { clock, raidMinutes } from './map/raidDuration';
import { collectObjectiveMaps } from './quests/derive';
import type { TarkovTask, TaskObjective } from './api/types';
import type { MapCard } from './map/MapInfoCard';
import { usePhoneShare } from './phone/usePhoneShare';
import type { PhoneState } from './phone/phoneApi';
import { effectiveStatus } from './state/localProgress';

// The weapon bench and its ~2 MB of data load only when it is first opened.
const GunsmithBench = lazy(() => import('./gunsmith/GunsmithBench'));
const BallisticsPanel = lazy(() => import('./ballistics/BallisticsPanel'));
const MapInfoCard = lazy(() => import('./map/MapInfoCard'));
const PhoneModal = lazy(() => import('./phone/PhoneModal'));
import { knownSymbol, setSelfSymbol, useSelfSymbol } from './squad/symbols';
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
  const [artOpen, setArtOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  // Onboarding wizard: auto-opens on first run only (tc_onboarded_v1); the
  // spine's Help button reopens it as the how-to guide.
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => !localStorage.getItem(ONBOARDED_KEY),
  );
  const [patchNotesOpen, setPatchNotesOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [gunsmithOpen, setGunsmithOpen] = useState(false);
  const [ballisticsOpen, setBallisticsOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  // The card over the map for a clicked quest pin or extraction.
  const [mapCard, setMapCard] = useState<MapCard | null>(null);
  // Cartridges read from the last flea-market screenshot; opening on them.
  const [screenAmmo, setScreenAmmo] = useState<string[] | null>(null);
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
  // A map change closes the card of the previous map.
  const [cardMapId, setCardMapId] = useState(selectedMapId);
  if (cardMapId !== selectedMapId) {
    setCardMapId(selectedMapId);
    setMapCard(null);
  }
  const raidHistory = useRaidHistory();
  const planner = usePlanner();
  const compact = useCompactMode();
  // Progression data loads the first time the planner opens (lazy, ~2 MB).
  // Also needed on the map: which quests the player can take now (upcoming pins).
  // The raid route's hideout goal needs it too (what the hideout still misses).
  const routePrefs = useRoutePrefs();
  const progressionLoad = useProgressionData(
    railSection === 'planner' || appearance.upcomingQuests || (routePrefs.on && routePrefs.goal === 'hideout'),
  );
  const tracker = useTracker({
    progress: quests.progress,
    setProgress: quests.setProgress,
    checkedObjectives: planner.planner.checkedObjectives,
    updatePlanner: planner.update,
    stations: progressionLoad.state === 'ready' ? progressionLoad.data.stations : null,
  });
  // O+O screenshot → the exits open to you this raid. The handler is assigned
  // further down, once the map's POIs and the live raid are known.
  // Until when a screenshot's text is an O+O list, not something to price.
  const extractSkipUntil = useRef(0);
  // An O+O warning waits a moment: if the screenshot was an inventory instead, it is dropped.
  const panelToastTimer = useRef<number | undefined>(undefined);
  // A screenshot of the game's Tasks screen marks the listed active quests the logs missed.
  useQuestScreen({ tasks: quests.tasks, progress: quests.progress, setProgress: quests.setProgress, notify: setToast });
  const priceScan = usePriceScan(
    () => extractSkipUntil.current,
    () => window.clearTimeout(panelToastTimer.current),
  );
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
  // A screenshot of the flea market's ammo list (3+ cartridges named) opens
  // the ballistics table on them.
  useEffect(() => {
    let un: (() => void) | undefined;
    let alive = true;
    subscribeScreenText((text) => {
      void import('./ballistics/screenAmmo')
        .then((m) => m.ammoOnScreen(text))
        .then((ids) => {
          if (!alive || ids.length < 3) return;
          setScreenAmmo(ids);
          setBallisticsOpen(true);
        })
        .catch(() => undefined);
    })
      .then((u) => {
        if (alive) un = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      un?.();
    };
  }, []);

  // A linked extra screen gets this app's state (src/link/linkState.ts):
  // published here on the game PC, applied there. One way only.
  usePublishState('progress', quests.progress);
  usePublishState('history', raidHistory.history);
  usePublishState('planner', planner.planner);
  usePublishState('profile', useMemo(() => ({ symbol: selfSymbol }), [selfSymbol]));
  usePublishState('raid', useMemo(() => ({ extractPanel }), [extractPanel]));
  usePublishState('traders', useTraderLevels());
  usePublishState('presets', usePresets());
  useMirroredState('traders', normalizeTraderLevels, setTraderLevels);
  useMirroredState('presets', (v) => (Array.isArray(v) ? v : null), replacePresets);
  useMirroredState('progress', normalizeProgress, quests.setProgress);
  useMirroredState('history', (v) => parseHistory(JSON.stringify(v)), raidHistory.setHistory);
  useMirroredState('planner', (v) => parsePlanner(JSON.stringify(v)), planner.update);
  useMirroredState(
    'profile',
    (v) => knownSymbol((v as { symbol?: unknown } | null)?.symbol),
    setSelfSymbol,
  );
  useMirroredState(
    'raid',
    (v) => {
      const p = (v as { extractPanel?: unknown } | null)?.extractPanel as
        | { lines?: unknown; mapId?: unknown; raidStartedAt?: unknown }
        | null
        | undefined;
      if (p === null) return { panel: null };
      if (!p || !Array.isArray(p.lines)) return null;
      return {
        panel: {
          lines: p.lines.filter((l): l is string => typeof l === 'string'),
          mapId: typeof p.mapId === 'string' ? p.mapId : null,
          raidStartedAt: typeof p.raidStartedAt === 'number' ? p.raidStartedAt : null,
        },
      };
    },
    (r) => setExtractPanel(r.panel),
  );
  const playerPos = useGameEvents({
    setProgress: quests.setProgress,
    setSelectedMapId,
    setHistory: raidHistory.setHistory,
    onLiveQuestEvent: (id, status) => {
      tracker.onLiveQuest(id, status);
      questDoneSound(status);
    },
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
  // The player's own markers go to a linked extra screen too (see above).
  usePublishState('markers', pois.customPois);
  useMirroredState('markers', normalizeCustomPois, pois.setCustomPois);
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
      const prefer = raidMap ?? selectedMapId;
      // First against every exit: PMC-only or Scav-only exits in the list
      // prove the side, which then sticks to this profile for later raids
      // (and corrects a wrong guess).
      const anySide = findPanelMap(lines, pois.poisByMapId, exitAliases, prefer);
      const proven = anySide ? sideFromPanel(anySide.match.ids, pois.poisByMapId[anySide.mapId] ?? [], exitAliases) : null;
      const side = proven ?? liveRaidSide;
      const sidePois = Object.fromEntries(
        Object.entries(pois.poisByMapId).map(([id, list]) => [id, exitsForSide(list, side)]),
      );
      const found = findPanelMap(lines, sidePois, exitAliases, prefer) ?? anySide;
      const key = liveRaid?.profileKey;
      if (proven && key && sideKnowledge.sides.get(key) !== proven) {
        setHistory((h) => setPanelSide(h, key, proven));
      }
      if (!found) {
        // Three or more lines may be the list; say so instead of failing
        // silently, unless the same screenshot turns out to be an inventory
        // (its item names fill that corner too) — then the price card shows.
        const msg = missingLanguage
          ? t('extractPanel.missingOcrLanguage', { lang: missingLanguage })
          : lines.length >= 3
            ? t('extractPanel.notMatched')
            : null;
        if (msg) {
          window.clearTimeout(panelToastTimer.current);
          panelToastTimer.current = window.setTimeout(() => setToast(msg), 1500);
        }
        return;
      }
      // The same screenshot's text arrives next for the price check: an O+O list is not an inventory.
      extractSkipUntil.current = Date.now() + 3000;
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
      const sideNote = proven && proven !== liveRaidSide ? ` ${t(proven === 'scav' ? 'extractPanel.provedScav' : 'extractPanel.provedPmc')}` : '';
      setToast(`${head} ${names.join(' · ')}${sideNote}`);
    };
  });
  const panelExitNames = useMemo(
    () => (panelExitIds ? pois.currentPois.filter((p) => panelExitIds.has(p.id)).map((p) => p.label) : null),
    [panelExitIds, pois.currentPois],
  );
  // Exits that are not the player's this raid (src/poi/exitTier.ts) fade on
  // the map and the minimap, or are hidden if the player turned them off.
  const { poiVisible } = pois;
  const inRaid = !!liveRaid;
  const tierOf = useCallback((p: Poi) => exitTier(p, liveRaidSide, panelExitIds, inRaid), [liveRaidSide, panelExitIds, inRaid]);
  const showOtherExits = appearance.otherExits;
  // In a raid the side decides which exits are shown, not the PMC / Scav
  // filter chips (Scav exits are off there by default, which would hide a
  // Scav's own exits). Both chips off still means "no exits".
  const facetEnabled = pois.filterState.enabled;
  const extractsOn =
    (facetEnabled['extract:pmc'] ?? facetDefaultOn('extract:pmc')) ||
    (facetEnabled['extract:scav'] ?? facetDefaultOn('extract:scav'));
  const isPoiVisible = useCallback(
    (p: Poi) => {
      const tier = tierOf(p);
      if (inRaid && tier && p.category === 'extract') return extractsOn && (tier === 'mine' || showOtherExits);
      return poiVisible(p) && (showOtherExits || tier !== 'other');
    },
    [poiVisible, showOtherExits, tierOf, inRaid, extractsOn],
  );
  const isPoiDimmed = useCallback((p: Poi) => tierOf(p) === 'other', [tierOf]);

  // Exits to calibrate a hand-made map with (their names are on the pictures).
  const artRefs = useMemo(
    () =>
      pois.currentPois
        // Exits only: transits are newer than most of the pictures.
        .filter((p) => p.category === 'extract')
        .map((p) => {
          const own = p.label;
          // The pictures are in English: show that name too when it differs
          // (the alias list starts with English; see getExitAliases).
          const en = exitAliases[p.id]?.[0];
          return { label: en && en !== own ? `${own} — ${en}` : own, x: p.position.x, z: p.position.z };
        }),
    [pois.currentPois, exitAliases],
  );

  // Scav sniper posts for the minimap (when the Sniper Scav filter is on).
  const minimapSnipers = useMemo(
    () => sniperSpots(pois.currentPois.filter(isPoiVisible)).map((s) => s.center),
    [pois.currentPois, isPoiVisible],
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
            tierOf,
            showOtherExits,
            minimapSnipers,
          )
        : [],
    [selectedMapId, questState, pois.currentPois, tierOf, showOtherExits, minimapSnipers],
  );
  const minimapSelf = useMemo(() => ({ symbol: selfSymbol, color: selfColor }), [selfSymbol, selfColor]);
  // Raid clock: time left for a PMC (map length from the raid's start), time in raid otherwise.
  const liveRaidMapId = liveRaid?.location ? mapIdFromLogLocation(liveRaid.location) ?? null : null;
  const minimapRaid = useMemo(() => {
    if (!liveRaid?.startedAt) return null;
    const minutes = raidMinutes(liveRaidMapId);
    return {
      startedAt: liveRaid.startedAt,
      endsAt: liveRaidSide === 'pmc' && minutes ? liveRaid.startedAt + minutes * 60_000 : null,
    };
  }, [liveRaid, liveRaidMapId, liveRaidSide]);
  // The raid route: the most objectives (yours, and the squad's with party on)
  // from the spawn to an exit before the raid ends.
  // The items the hideout still needs, for the route's hideout goal.
  const progressionData = progressionLoad.state === 'ready' ? progressionLoad.data : null;
  const routeHideoutNeeds = useMemo(() => {
    if (!routePrefs.on || routePrefs.goal !== 'hideout' || !progressionData) return undefined;
    const needs = aggregateNeeds({
      tasks: quests.tasks,
      meta: progressionData.tasks,
      statuses: questStatuses,
      scope: 'active',
      checkedObjectives: planner.checkedObjectives,
      includeHideout: true,
      stations: progressionData.stations,
      stationLevels: planner.planner.stationLevels,
    });
    return hideoutNeedIds(needs, planner.planner.collected);
  }, [routePrefs.on, routePrefs.goal, progressionData, quests.tasks, questStatuses, planner.checkedObjectives, planner.planner]);
  const route = useRaidRoute({
    mapId: selectedMapId,
    own: questState,
    mateStates: squadSync.squadQuestStates,
    squad,
    selfName: squad.members.find((m) => m.id === squad.selfId)?.name ?? t('route.you'),
    selfColor: selfColor ?? '#4fd1ff',
    playerPos,
    raid: minimapRaid,
    pois: pois.currentPois,
    tierOf,
    hideoutNeeds: routeHideoutNeeds,
  });
  // Item names for the loot route's stops (loaded once a loot goal or "loot on the way" is on).
  const routeItemNames = useItemNames(route.on && (route.goal !== 'quests' || route.lootOnWay));
  useSoundAlerts({ raid: minimapRaid, toExit: route.toExit, routeDone: route.doneCount, hotKey: route.selfHeat?.key ?? null });
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (!liveRaid) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [liveRaid]);
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
  // The raid route on the small maps: its line, its stops, and the next stop as a
  // named point (rim arrow and distance, like the exits).
  const smallRoute = useMemo(() => {
    const plan = route.plan;
    if (!route.on || !plan || !route.start) return null;
    const first = plan.stops[0];
    const title = first
      ? `1 · ${first.info?.place ?? first.items[0]?.task.name ?? ''}`
      : plan.exit
        ? plan.exit.label
        : null;
    return minimapRoute(route.start, plan.stops, plan.exit, plan.paths, title);
  }, [route.on, route.plan, route.start]);
  const smallMapPoints = useMemo(
    () => (smallRoute?.next ? [...minimapFeedPoints, smallRoute.next] : minimapFeedPoints),
    [minimapFeedPoints, smallRoute],
  );
  const minimap = useMinimapWindow({
    mapId: selectedMapId,
    pos: playerPos,
    activeFloorId: floors.activeFloorId ?? null,
    points: smallMapPoints,
    route: smallRoute?.route ?? null,
    self: minimapSelf,
    mates: minimapMates,
    inRaid: !!liveRaid,
    raidClock: minimapRaid,
  });
  // The same map state goes to a phone on the home Wi-Fi (QR code), when on.
  const phoneState = useMemo<PhoneState>(
    () => ({
      mapId: selectedMapId,
      mapName: selectedMapId ? (SUPPORTED_MAP_NAMES[canonicalMapId(selectedMapId)] ?? null) : null,
      pos: playerPos,
      activeFloorId: floors.activeFloorId ?? null,
      points: smallMapPoints,
      self: minimapSelf,
      mates: minimapMates,
      raidClock: minimapRaid,
      route: smallRoute?.route ?? null,
      sentAt: 0,
    }),
    [selectedMapId, playerPos, floors.activeFloorId, smallMapPoints, minimapSelf, minimapMates, minimapRaid, smallRoute],
  );
  const phone = usePhoneShare(phoneState);
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
  // On the planner's market tab, an inventory screenshot fills that tab's price list instead of the card.
  const onMarketTab = railSection === 'planner' && plannerTab === 'market' && !compact.compact;
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

  // Name of the map the live raid is on, for the "in raid" pill. The fixed
  // list first (as the map picker does): the quest data only names maps that
  // have an active quest, and "Unknown map" helps nobody.
  const liveRaidMapName = useMemo(() => {
    const id = liveRaid?.location ? mapIdFromLogLocation(liveRaid.location) : null;
    if (!id) return liveRaid?.location ?? '';
    if (SUPPORTED_MAP_NAMES[id]) return SUPPORTED_MAP_NAMES[id];
    const n = questState ? resolveMapName(id, questState.availableTasksByMap, questState.availableObjectivesByMap) : id;
    return n === 'Unknown map' ? id : n;
  }, [liveRaid, questState]);
  const selectedMapName = useMemo(() => {
    if (!selectedMapId) return '';
    if (SUPPORTED_MAP_NAMES[selectedMapId]) return SUPPORTED_MAP_NAMES[selectedMapId];
    if (!questState) return '';
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
      <TitleBar
        onOpenLink={() => {
          setSettingsTab('devices');
          setSettingsOpen(true);
        }}
      />
      <LinkRequestDialog />
      {showIntro && <GlassIntro onDone={() => setShowIntro(false)} />}
      <Toast message={toast} onDismiss={() => setToast(null)} />
      {priceScan.result && !onMarketTab && <PriceScanCard result={priceScan.result} onClose={priceScan.clear} />}
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
          updateLabel={update.label}
          updating={update.updating}
          onUpdate={update.apply}
          onSyncLogs={logReplay.replay}
          syncingLogs={logReplay.replaying}
          onFeedback={() => setFeedbackOpen(true)}
          onHowTo={() => setOnboardingOpen(true)}
          onSettings={() => {
            setSettingsTab('general');
            setSettingsOpen(true);
          }}
          onGunsmith={() => setGunsmithOpen(true)}
          onBallistics={() => setBallisticsOpen(true)}
          onPhone={phone.available ? () => setPhoneOpen(true) : undefined}
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
                    {minimapRaid && (
                      <span className="raid-pill__clock mono" title={t(minimapRaid.endsAt ? 'raidPill.leftHint' : 'raidPill.elapsedHint')}>
                        {minimapRaid.endsAt ? clock(minimapRaid.endsAt - clockNow) : `+${clock(clockNow - minimapRaid.startedAt)}`}
                      </span>
                    )}
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
                  scanned={onMarketTab ? scannedItems(priceScan.result) : null}
                  onClearScan={priceScan.clear}
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
              {mapCard && selectedMapId && (
                <Suspense fallback={null}>
                  <MapInfoCard card={mapCard} onClose={() => setMapCard(null)} />
                </Suspense>
              )}
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
                  <MapView
                    mapId={selectedMapId}
                    mapName={selectedMapName}
                    activeFloorId={floors.activeFloorId}
                    mapStyle={appearance.mapStyle}
                  >
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
                        onOpenObjective={(task, objective) =>
                          setMapCard((c) => (c?.kind === 'quest' && c.objective.id === objective.id ? null : { kind: 'quest', task, objective }))
                        }
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
                    <DangerZoneLayer
                      mapId={selectedMapId}
                      pois={pois.currentPois}
                      isVisible={isPoiVisible}
                      sniperRange={appearance.sniperRange}
                      sniperCone={appearance.sniperCone}
                    />
                    <PoiLayer
                      mapId={selectedMapId}
                      pois={pois.currentPois}
                      isVisible={isPoiVisible}
                      isDimmed={isPoiDimmed}
                      selectedPoiIds={pois.selectedPoiIds}
                      floors={selectedMapDef?.floors}
                      activeFloorId={floors.activeFloorId}
                      onSelect={(poi) => {
                        pois.togglePoi(poi);
                        if (poi.category === 'extract') {
                          setMapCard((c) =>
                            c?.kind === 'extract' && c.poi.id === poi.id
                              ? null
                              : { kind: 'extract', poi, names: [...(exitAliases[poi.id] ?? []), poi.label] },
                          );
                        }
                      }}
                    />
                    <GridOverlay mapId={selectedMapId} visible={pois.filterState.gridVisible} />
                    {route.on && route.heat.on && (
                      <HeatLayer mapId={selectedMapId} sources={route.heat.sources} phase={route.heat.phase} raid={route.raidSeconds} />
                    )}
                    {route.on && <RouteLayer mapId={selectedMapId} route={route} names={routeItemNames} />}
                    {drawing.drawTool === null && !(route.on && route.picking) && (
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
                    reliefAvailable={!!TILE_STYLES[canonicalMapId(selectedMapId)]}
                    relief={appearance.mapStyle === 'relief'}
                    onRelief={(on) => setAppearance({ mapStyle: on ? 'relief' : 'vector' })}
                    artCount={ART_MAPS[canonicalMapId(selectedMapId)]?.length ?? 0}
                    onArt={() => setArtOpen(true)}
                    route={route.on}
                    onRoute={route.setOn}
                  />
                  {route.on && <RoutePanel route={route} inSquad={squad.inSquad} names={routeItemNames} />}
                  {artOpen && ART_MAPS[canonicalMapId(selectedMapId)] && (
                    <ArtMapViewer
                      maps={ART_MAPS[canonicalMapId(selectedMapId)]}
                      mapId={canonicalMapId(selectedMapId)}
                      refs={artRefs}
                      mapName={selectedMapName}
                      onClose={() => setArtOpen(false)}
                    />
                  )}
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
          initialTab={settingsTab}
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
      {ballisticsOpen && (
        <Suspense fallback={null}>
          <BallisticsPanel
            onClose={() => {
              setBallisticsOpen(false);
              setScreenAmmo(null);
            }}
            fromScreen={screenAmmo}
          />
        </Suspense>
      )}
      {phoneOpen && (
        <Suspense fallback={null}>
          <PhoneModal share={phone} onClose={() => setPhoneOpen(false)} />
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
