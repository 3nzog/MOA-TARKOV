import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Poi } from '../poi/types';
import { useRaidRoute, type RaidRoute } from './useRaidRoute';
import { DEFAULT_ROUTE_PREFS, setRoutePrefs } from './routePrefs';

// With the route off, nothing of it may run: no "stop done" and no hot-zone
// sound in a raid (both start on in the sound settings), whatever the map says.

const poi = (id: string, subtype: string, meta?: Record<string, unknown>): Poi => ({
  id,
  category: 'spawn',
  subtype,
  mapId: 'bigmap',
  position: { x: 0, y: 0, z: 0 },
  label: id,
  source: 'tarkov-dev',
  meta,
});
// A PMC spawn (hot at the start of a raid) and a Scav spawn (a stop of the
// Scavs goal), both right where the player stands.
const POIS = [poi('pmc', 'pmc'), poi('scav', 'scav', { categories: ['Bot'] })];
const SQUAD = { inSquad: false, selfId: null, members: [], positions: {}, hiddenQuests: {} };

const last: { route: RaidRoute | null } = { route: null };
function Probe({ startedAt }: { startedAt: number }) {
  const route = useRaidRoute({
    mapId: 'bigmap',
    own: null,
    mateStates: {},
    squad: SQUAD,
    selfName: 'Eu',
    selfColor: '#ffffff',
    playerPos: { x: 0, y: 0, z: 0, rotation: 0, ts: startedAt + 20_000 },
    raid: { startedAt, endsAt: null },
    pois: POIS,
    tierOf: () => 'mine',
  });
  useEffect(() => {
    last.route = route;
  });
  return null;
}
const seen = () => last.route;

describe('useRaidRoute with the route off', () => {
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    last.route = null;
    root = createRoot(document.createElement('div'));
  });
  afterEach(() => {
    act(() => root.unmount());
    setRoutePrefs({ ...DEFAULT_ROUTE_PREFS });
  });

  it('is quiet when off: no hot place, no stop reached', () => {
    setRoutePrefs({ on: false, goal: 'scavs' });
    act(() => root.render(<Probe startedAt={Date.now() - 30_000} />));
    expect(seen()?.on).toBe(false);
    expect(seen()?.selfHeat).toBeNull();
    expect(seen()?.doneCount).toBe(0);
  });

  it('when on, the same raid is a hot place and the stop counts as reached', () => {
    setRoutePrefs({ on: true, goal: 'scavs' });
    act(() => root.render(<Probe startedAt={Date.now() - 30_000} />));
    expect(seen()?.selfHeat?.kind).toBe('spawn');
    expect(seen()?.doneCount).toBe(1);
  });

  it('turning it off silences it at once, and on again does not count the stop twice', () => {
    setRoutePrefs({ on: true, goal: 'scavs' });
    const startedAt = Date.now() - 30_000;
    act(() => root.render(<Probe startedAt={startedAt} />));
    expect(seen()?.doneCount).toBe(1);
    act(() => seen()?.setOn(false));
    expect(seen()?.on).toBe(false);
    expect(seen()?.selfHeat).toBeNull();
    act(() => seen()?.setOn(true));
    expect(seen()?.doneCount).toBe(1);
  });
});
