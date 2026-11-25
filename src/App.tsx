import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowsClockwise, ArrowsOutSimple, X } from '@phosphor-icons/react';
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
import { isPageSection } from './shell/sections';
import RailResizer from './shell/RailResizer';
import { useRelativeTime } from './hooks/useRelativeTime';
import Onboarding, { ONBOARDED_KEY } from './onboarding/Onboarding';
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
import { setRoutePrefs, useRoutePrefs } from './route/routePrefs';
import { hideoutNeedIds } from './route/routeData';
import { aggregateNeeds } from './progression/needs';
import { countInventory, type SeenItems } from './progression/inventoryCount';
import { makeNames } from './planner/names';
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
import { useShowOnGameLaunch } from './app/startup';
import { useScavTimer } from './scav/scavTimer';
import ScavChip from './scav/ScavChip';
import RaidSideAsk from './scav/RaidSideAsk';
import { reqLabels, useExitReqs } from './map/extractReqs';
import { exitBadges, exitBadgesHtml } from './map/exitBadges';
import { bossList } from './route/describe';
import { useHideoutAlarms, type HideoutTimer } from './hideout/timers';
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
import { ART_MAPS, TILE_STYLES } from './map/mapStyles';
import { sniperSpots } from './poi/sniper';
import type { PlannerTab } from './planner/PlannerPanel';
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
import { buildItemUses } from './prices/itemUses';
import { usePriceScan } from './prices/usePriceScan';
import PlaceLabelLayer from './map/PlaceLabelLayer';
import { clock, raidMinutes } from './map/raidDuration';
import { collectObjectiveMaps } from './quests/derive';
import type { TarkovTask, TaskObjective } from './api/types';
import type { MapCard } from './map/MapInfoCard';
import { usePhoneShare } from './phone/usePhoneShare';
import type { PhoneState } from './phone/phoneApi';
import { slimObjective, type PhoneLayers, type PhoneObjective } from './phone/phoneLayers';
import { effectiveStatus } from './state/localProgress';

// The weapon bench and its ~2 MB of data load only when it is first opened.
/**
 * The raid pill's clock: time left (PMC) or time in raid. It ticks on its own
 * every second, so the rest of the app does not re-render with it.
 */
function RaidPillClock({ startedAt, endsAt }: { startedAt: number; endsAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{endsAt ? clock(endsAt - now) : `+${clock(now - startedAt)}`}</>;
}

// Opened on demand: each loads the first time it is opened, so the app starts lighter.
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const PatchNotesModal = lazy(() => import('./components/PatchNotesModal'));
const FeedbackModal = lazy(() => import('./feedback/FeedbackModal'));
const ArtMapViewer = lazy(() => import('./map/ArtMapViewer'));
const PlannerPanel = lazy(() => import('./planner/PlannerPanel'));
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
  const [phoneOpen, setPhoneOpen] = useState(false);
  // The card over the map for a clicked quest pin or extraction.
  const [mapCard, setMapCard] = useState<MapCard | null>(null);
  // Where the pointer last went down on the map (screen pixels): the card of a
  // clicked marker opens next to it.
  const mapPointer = useRef<{ x: number; y: number } | null>(null);
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
  const routePanel = routePrefs.panel;
  // Items read from an inventory screenshot, waiting to be counted toward the needs.
  const [stashSeen, setStashSeen] = useState<SeenItems | null>(null);
  // A price card was shown: it tells what each item is still good for (quests,
  // hideout, crafts), which takes the progression data.
  const [priceCardSeen, setPriceCardSeen] = useState(false);
  const progressionLoad = useProgressionData(
    railSection === 'planner' ||
      appearance.upcomingQuests ||
      (routePrefs.on && routePrefs.goal === 'hideout') ||
      stashSeen !== null ||
      priceCardSeen,
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
  // Ammo on a screenshot: on the ammo page, any cartridge named there is put
  // in the table and ranked; elsewhere a list of 3+ (the flea market's) opens
  // the ammo page on them.
  const onAmmoPage = useRef(false);
  useEffect(() => {
    onAmmoPage.current = railSection === 'ballistics';
  }, [railSection]);
  useEffect(() => {
    let un: (() => void) | undefined;
    let alive = true;
    subscribeScreenText((text) => {
      const onPage = onAmmoPage.current;
      void import('./ballistics/screenAmmo')
        .then((m) => m.ammoOnScreen(text, onPage))
        .then((ids) => {
          if (!alive || ids.length < (onPage ? 1 : 3)) return;
          // On the ammo page the prints add up (one per stash page); a market
          // list seen elsewhere starts afresh.
          setScreenAmmo((cur) => (onPage && cur ? [...cur, ...ids.filter((id) => !cur.includes(id))] : ids));
          setRailSection('ballistics');
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
  // The game started (here or on the linked game PC): the window comes up.
  useShowOnGameLaunch(setToast, t('startup.gameLaunched'));
  const questStatuses = useQuestStatuses(
    quests.tasks,
    progressionLoad.state === 'ready' ? progressionLoad.data : null,
    quests.progress,
  );
  // PMC or Scav: learned from the raid's profile fingerprint (see raidHistory).
  const sideKnowledge = useMemo(() => learnSides(raidHistory.history), [raidHistory.history]);
  // The Scav's wait after a Scav raid, and the sound when it is over.
  const scav = useScavTimer(raidHistory.history, sideKnowledge, setToast, t('scav.readyToast'));
  // A hideout craft or upgrade the player started is done: the sound, a
  // message, and an upgrade raises the station's built level.
  const { setStationLevel } = planner;
  const onHideoutDone = useCallback(
    (x: HideoutTimer) => {
      setToast(t('hideoutTimers.done', { label: x.label }));
      if (x.kind === 'upgrade' && x.level) setStationLevel(x.stationId, x.level);
    },
    [setStationLevel, t],
  );
  useHideoutAlarms(onHideoutDone);
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
  // An inventory screenshot counts toward what quests and the hideout still
  // need (Planner → Items): the counters only go up, to what was seen.
  const scanResult = priceScan.result;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (scanResult?.mode === 'inventory') setStashSeen(scanResult.items);
  }, [scanResult]);
  // Out of a raid, an inventory screenshot opens where it belongs: mostly
  // cartridges → the ammo page (ranked); anything else → Planner → Items, where
  // it was just counted. On the ammo page its own reader handles the print; in
  // a raid nothing moves.
  const screenRouting = useRef({ inRaid: false, section: railSection as RailSection | null, compact: false });
  useEffect(() => {
    screenRouting.current = { inRaid: !!liveRaid, section: railSection, compact: compact.compact };
  }, [liveRaid, railSection, compact.compact]);
  useEffect(() => {
    const r = screenRouting.current;
    if (scanResult?.mode !== 'inventory' || r.inRaid || r.compact || r.section === 'ballistics') return;
    let alive = true;
    void import('./ballistics/data')
      .then(async (m) => ({ m, data: await m.loadAmmoData() }))
      .then(({ m, data }) => {
        if (!alive) return;
        const found = m.ammoInScan(scanResult.items, data);
        if (m.mostlyAmmo(found, scanResult.items.length) && found.ids.length > 0) {
          setScreenAmmo(found.ids);
          setRailSection('ballistics');
        } else {
          setPlannerTab('items');
          setRailSection('planner');
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [scanResult]);
  const { update: updatePlanner, checkedObjectives: plannerChecked } = planner;
  const { needsScope, stationLevels, collected } = planner.planner;
  // The price card's "still good for": quests and hideout still asking for the
  // item (left after Planner → Items' counters) and the crafts that use it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (scanResult) setPriceCardSeen(true);
  }, [scanResult]);
  const itemUses = useMemo(() => {
    if (!progressionData || !scanResult) return null;
    const needs = aggregateNeeds({
      tasks: quests.tasks,
      meta: progressionData.tasks,
      statuses: questStatuses,
      scope: needsScope,
      checkedObjectives: plannerChecked,
      includeHideout: true,
      stations: progressionData.stations,
      stationLevels,
    });
    return {
      byItem: buildItemUses(needs, progressionData.crafts, collected, stationLevels),
      names: makeNames(progressionData, quests.tasks, '?'),
    };
  }, [progressionData, scanResult, quests.tasks, questStatuses, needsScope, plannerChecked, stationLevels, collected]);
  useEffect(() => {
    if (!stashSeen || !progressionData) return;
    const needs = aggregateNeeds({
      tasks: quests.tasks,
      meta: progressionData.tasks,
      statuses: questStatuses,
      scope: needsScope,
      checkedObjectives: plannerChecked,
      includeHideout: true,
      stations: progressionData.stations,
      stationLevels,
    });
    const { updates, lines } = countInventory(needs, stashSeen, collected);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStashSeen(null);
    if (lines.length === 0) return;
    updatePlanner((p) => ({ ...p, collected: { ...p.collected, ...updates } }));
    const names = makeNames(progressionData, quests.tasks, '?');
    const list = lines
      .slice(0, 3)
      .map((l) => `${l.itemId ? names.item(l.itemId) : '…'} ${l.have}/${l.need}`)
      .join(', ');
    setToast(t('planner.items.counted', { count: lines.length, list }));
  }, [stashSeen, progressionData, quests.tasks, questStatuses, needsScope, plannerChecked, stationLevels, collected, updatePlanner, t]);
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
  // "Which map pays off" in Planner → Raid: the route's goal, you and (party on) the squad.
  const rankSelf = useMemo(
    () => ({ id: squad.selfId ?? 'self', name: squad.members.find((m) => m.id === squad.selfId)?.name ?? t('route.you'), color: selfColor ?? '#4fd1ff' }),
    [squad.selfId, squad.members, selfColor, t],
  );
  const rankPeople = useMemo(
    () => [{ who: rankSelf, state: questState }, ...route.mates.map((m) => ({ who: m, state: squadSync.squadQuestStates[m.id] }))],
    [rankSelf, questState, route.mates, squadSync.squadQuestStates],
  );
  const mapRanking = useMemo(
    () => ({
      goal: route.goal,
      people: rankPeople,
      poisByMapId: pois.poisByMapId,
      hideoutNeeds: routeHideoutNeeds,
      weaponKinds: route.weaponKinds,
      onPickMap: setSelectedMapId,
    }),
    [route.goal, rankPeople, pois.poisByMapId, routeHideoutNeeds, route.weaponKinds, setSelectedMapId],
  );
  // The route's objectives on this map, for "only what the route needs" (quests goal).
  const routeObjectives = useMemo(
    () =>
      route.on && route.goal === 'quests' && route.plan
        ? new Set(route.plan.stops.flatMap((s) => s.items.map((it) => it.objective.id)))
        : null,
    [route.on, route.goal, route.plan],
  );
  // Item names for the loot route's stops (loaded once a loot goal or "loot on the way" is on).
  const routeItemNames = useItemNames(route.on && (route.goal !== 'quests' || route.lootOnWay));
  useSoundAlerts({ raid: minimapRaid, toExit: route.toExit, routeDone: route.doneCount, hotKey: route.selfHeat?.key ?? null });
  const minimapMates = useMemo(
    () =>
      squad.members.flatMap((m) => {
        const p = squad.positions[m.id];
        // Same map in any spelling ("bigmap" / "customs").
        if (m.id === squad.selfId || !p || !selectedMapId || canonicalMapId(p.payload.mapId) !== canonicalMapId(selectedMapId)) return [];
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
  // Everything else the map draws goes to the phone too, as a map only: no
  // location pictures, no wiki links. Sent apart from the state above, and only
  // when it changes (the party's positions already go in the state, as mates).
  // What each exit asks for (paracord, flare, a code note…), from the wiki's table.
  const exitReqsOf = useExitReqs(selectedMapId);
  const describePoi = useMemo(
    () =>
      exitReqsOf
        ? (p: Poi) => {
            if (p.category === 'boss') {
              const here = (p.meta as { here?: { name: string; chance: number }[] } | undefined)?.here ?? [];
              return here.length > 0 ? t('route.bosses.here', { list: bossList(here) }) : null;
            }
            if (p.category !== 'extract') return null;
            const faction = typeof p.meta?.faction === 'string' ? t(`mapCard.faction.${p.meta.faction}`, { defaultValue: '' }) : '';
            const reqs = exitReqsOf([...(exitAliases[p.id] ?? []), p.label]);
            // No wiki row for it: the data's own note stays.
            if (!reqs) return null;
            return [faction, ...reqLabels(reqs, t)].filter(Boolean).join(' · ');
          }
        : undefined,
    [exitReqsOf, exitAliases, t],
  );
  // The same requirements as small pictures next to each exit's name.
  const exitBadgesOf = useMemo(
    () =>
      exitReqsOf
        ? (p: Poi) =>
            p.category === 'extract'
              ? exitBadgesHtml(exitBadges(exitReqsOf([...(exitAliases[p.id] ?? []), p.label])), (tag, arg) => t(`exitReq.${tag}`, { arg }))
              : null
        : undefined,
    [exitReqsOf, exitAliases, t],
  );
  const currentPois = pois.currentPois;
  const routeExitNote = useCallback(
    (id: string) => {
      const p = currentPois.find((x) => x.id === id);
      return p && describePoi ? describePoi(p) : null;
    },
    [currentPois, describePoi],
  );
  const heatOn = route.on && route.heat.on;
  const { sources: heatSources, phase: heatPhase } = route.heat;
  const raidLength = route.raidSeconds;
  const phoneLayers = useMemo<PhoneLayers | null>(() => {
    if (!selectedMapId) return null;
    const slim = (list: { task: TarkovTask; objective: TaskObjective }[]) => list.map((o) => slimObjective(o.task, o.objective, selectedMapId));
    const showOwn = squadSync.showOwnOnMap;
    const squadQuests: Record<string, PhoneObjective[]> = {};
    for (const [id, qs] of Object.entries(squadSync.squadQuestStates)) {
      const list = qs.availableObjectivesByMap[selectedMapId];
      if (list?.length) squadQuests[id] = slim(list);
    }
    return {
      mapId: selectedMapId,
      mapStyle: appearance.mapStyle === 'relief' ? 'relief' : 'vector',
      pois: pois.currentPois.filter(isPoiVisible),
      dimmed: pois.currentPois.filter((p) => isPoiVisible(p) && isPoiDimmed(p)).map((p) => p.id),
      selected: [...pois.selectedPoiIds],
      sniperRange: appearance.sniperRange,
      sniperCone: appearance.sniperCone,
      objectives: showOwn && questState ? slim(questState.availableObjectivesByMap[selectedMapId] ?? []) : [],
      upcoming: showOwn && appearance.upcomingQuests ? slim(upcomingObjectives) : null,
      shared: [...squadSync.sharedQuestIds],
      questNames: appearance.questNames,
      placeLabels: appearance.placeLabels,
      grid: pois.filterState.gridVisible,
      custom: pois.customEnabled && showOwn ? pois.currentCustomPois : [],
      ownDraws: drawing.ownDraws.filter((d) => d.mapId === selectedMapId),
      drawHex: drawing.myDrawHex,
      squad: squad.inSquad
        ? { selfId: squad.selfId, members: squad.members, positions: {}, markers: squad.markers, draws: squad.draws, hiddenQuests: squad.hiddenQuests }
        : null,
      squadQuests,
      heat: heatOn ? { sources: heatSources, phase: heatPhase, raid: raidLength } : null,
      exitReqs: Object.fromEntries(
        pois.currentPois
          .filter(isPoiVisible)
          .map((p) => [p.id, describePoi?.(p) ?? null] as const)
          .filter((e): e is readonly [string, string] => !!e[1]),
      ),
    };
  }, [
    selectedMapId,
    squadSync.showOwnOnMap,
    squadSync.squadQuestStates,
    squadSync.sharedQuestIds,
    pois.currentPois,
    pois.selectedPoiIds,
    pois.filterState.gridVisible,
    pois.customEnabled,
    pois.currentCustomPois,
    isPoiVisible,
    isPoiDimmed,
    appearance.sniperRange,
    appearance.sniperCone,
    appearance.upcomingQuests,
    appearance.questNames,
    appearance.placeLabels,
    appearance.mapStyle,
    questState,
    upcomingObjectives,
    drawing.ownDraws,
    drawing.myDrawHex,
    squad.inSquad,
    squad.selfId,
    squad.members,
    squad.markers,
    squad.draws,
    squad.hiddenQuests,
    heatOn,
    heatSources,
    heatPhase,
    raidLength,
    describePoi,
  ]);
  const phone = usePhoneShare(phoneState, phoneLayers);
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
  // A page (planner, weapon bench, ammo) clicked again goes back to the side
  // panel that was open before it, instead of an empty map.
  const lastPanel = useRef<RailSection | null>('quests');
  useEffect(() => {
    if (!isPageSection(railSection)) lastPanel.current = railSection;
  }, [railSection]);
  const handleToggleSection = useCallback((s: RailSection) => {
    setRailSection((cur) => (cur === s ? (isPageSection(s) ? lastPanel.current : null) : s));
  }, []);
  const closePage = useCallback(() => {
    setRailSection(lastPanel.current);
    setScreenAmmo(null);
  }, []);
  const pageOpen = isPageSection(railSection) && !compact.compact;

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
      : 10 + 64 + 10 + (railSection && !pageOpen ? railWidth.width + 10 : 0);

  return (
    <div className="app-container">
      <TitleBar
        update={update.label ? { label: update.label, updating: update.updating, onUpdate: () => void update.apply() } : null}
        onOpenLink={() => {
          setSettingsTab('devices');
          setSettingsOpen(true);
        }}
      />
      <LinkRequestDialog />
      {showIntro && <GlassIntro onDone={() => setShowIntro(false)} />}
      <Toast message={toast} onDismiss={() => setToast(null)} />
      {priceScan.result && !onMarketTab && <PriceScanCard result={priceScan.result} onClose={priceScan.clear} uses={itemUses} />}
      <div
        className={`shell shell--${settings.railSide}${compact.compact ? ' shell--compact' : ''}${pageOpen ? ' shell--page' : ''}`}
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

        {railSection && !pageOpen && !compact.compact && (
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
                        <RaidPillClock startedAt={minimapRaid.startedAt} endsAt={minimapRaid.endsAt} />
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
              {railSection === 'squad' ? (
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

        {pageOpen && (
          <main className={`page-view page-view--${railSection}`}>
            {railSection === 'planner' ? (
              <div className="page-view__planner">
                <header className="page-view__head">
                  <h2>{t('rail.plannerTitle')}</h2>
                  {questState && (
                    <div className="page-view__map">
                      <MapPicker
                        availableObjectivesByMap={questState.availableObjectivesByMap}
                        availableTasksByMap={questState.availableTasksByMap}
                        selectedMapId={selectedMapId}
                        onSelect={setSelectedMapId}
                      />
                    </div>
                  )}
                  <IconButton size="sm" icon={<X weight="bold" />} label={t('common.close')} onClick={closePage} />
                </header>
                <div className="page-view__body">
                  <Suspense fallback={<Spinner size="md" />}>
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
                      ranking={mapRanking}
                      routeObjectives={routeObjectives}
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
                  </Suspense>
                </div>
              </div>
            ) : railSection === 'gunsmith' ? (
              <Suspense fallback={<Spinner size="md" />}>
                <GunsmithBench
                  onClose={closePage}
                  playerLevel={quests.progress.levelSet ? quests.progress.playerLevel : null}
                  taskDone={taskDone}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<Spinner size="md" />}>
                <BallisticsPanel onClose={closePage} fromScreen={screenAmmo} onClearScreen={() => setScreenAmmo(null)} />
              </Suspense>
            )}
          </main>
        )}

        <section
          className="map-stage map-area"
          onPointerDownCapture={(e) => {
            mapPointer.current = { x: e.clientX, y: e.clientY };
          }}
        >
          <ScavChip state={scav} />
          {liveRaid?.profileKey && !liveRaidSide && <RaidSideAsk onPick={setLiveRaidSide} />}
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
                          setMapCard((c) =>
                            c?.kind === 'quest' && c.objective.id === objective.id
                              ? null
                              : { kind: 'quest', task, objective, at: mapPointer.current ?? undefined },
                          )
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
                      describe={describePoi}
                      badges={exitBadgesOf}
                      onSelect={(poi) => {
                        pois.togglePoi(poi);
                        if (poi.category === 'extract') {
                          setMapCard((c) =>
                            c?.kind === 'extract' && c.poi.id === poi.id
                              ? null
                              : { kind: 'extract', poi, names: [...(exitAliases[poi.id] ?? []), poi.label], at: mapPointer.current ?? undefined },
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
                    route={routePanel}
                    onRoute={(open) => setRoutePrefs({ panel: open })}
                  />
                  {routePanel && <RoutePanel route={route} inSquad={squad.inSquad} names={routeItemNames} exitNote={routeExitNote} />}
                  {artOpen && ART_MAPS[canonicalMapId(selectedMapId)] && (
                    <Suspense fallback={null}>
                      <ArtMapViewer
                        maps={ART_MAPS[canonicalMapId(selectedMapId)]}
                        mapId={canonicalMapId(selectedMapId)}
                        refs={artRefs}
                        mapName={selectedMapName}
                        onClose={() => setArtOpen(false)}
                      />
                    </Suspense>
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
        <Suspense fallback={null}>
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
        </Suspense>
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
      {phoneOpen && (
        <Suspense fallback={null}>
          <PhoneModal share={phone} onClose={() => setPhoneOpen(false)} />
        </Suspense>
      )}
      {patchNotesOpen && (
        <Suspense fallback={null}>
          <PatchNotesModal onClose={() => setPatchNotesOpen(false)} />
        </Suspense>
      )}
      {feedbackOpen && (
        <Suspense fallback={null}>
          <FeedbackModal
            onClose={() => setFeedbackOpen(false)}
            appVersion={update.appVersion}
            activeMapId={selectedMapId}
            squadActive={squad.inSquad}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
