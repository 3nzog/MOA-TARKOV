import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadPlanner, savePlanner, setCount, toggleIn, type PlannerState } from '../state/planner';
import { loadHistory, saveHistory, type RaidHistory } from '../state/raidHistory';
import type { NeedScope } from '../progression/needs';

// The player's own planning state (objective ticks, hideout, collected items,
// keys) — persisted on every change.
export function usePlanner() {
  const [planner, setPlanner] = useState<PlannerState>(() => loadPlanner());

  useEffect(() => {
    savePlanner(planner);
  }, [planner]);

  const toggleObjective = useCallback(
    (id: string) => setPlanner((p) => ({ ...p, checkedObjectives: toggleIn(p.checkedObjectives, id) })),
    [],
  );
  const setStationLevel = useCallback(
    (stationId: string, level: number) =>
      setPlanner((p) => ({ ...p, stationLevels: setCount(p.stationLevels, stationId, level) })),
    [],
  );
  const setCollected = useCallback(
    (key: string, n: number) => setPlanner((p) => ({ ...p, collected: setCount(p.collected, key, n) })),
    [],
  );
  const toggleKeyOwned = useCallback(
    (itemId: string) => setPlanner((p) => ({ ...p, keysOwned: toggleIn(p.keysOwned, itemId) })),
    [],
  );
  const setNeedsScope = useCallback((needsScope: NeedScope) => setPlanner((p) => ({ ...p, needsScope })), []);
  const setIncludeHideout = useCallback(
    (includeHideout: boolean) => setPlanner((p) => ({ ...p, includeHideout })),
    [],
  );
  const setWipeStart = useCallback((wipeStart: number | null) => setPlanner((p) => ({ ...p, wipeStart })), []);

  const checkedObjectives = useMemo(() => new Set(planner.checkedObjectives), [planner.checkedObjectives]);
  const keysOwned = useMemo(() => new Set(planner.keysOwned), [planner.keysOwned]);

  return {
    planner,
    /** Raw updater, for sync code that merges outside data in. */
    update: setPlanner,
    checkedObjectives,
    keysOwned,
    toggleObjective,
    setStationLevel,
    setCollected,
    toggleKeyOwned,
    setNeedsScope,
    setIncludeHideout,
    setWipeStart,
  };
}

export type PlannerApi = ReturnType<typeof usePlanner>;

// Raid + quest-event history, fed by useGameEvents.
export function useRaidHistory() {
  const [history, setHistory] = useState<RaidHistory>(() => loadHistory());
  useEffect(() => {
    saveHistory(history);
  }, [history]);
  const clear = useCallback(() => setHistory({ raids: [], questEvents: [] }), []);
  return { history, setHistory, clear };
}
