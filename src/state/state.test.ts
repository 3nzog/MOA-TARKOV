import { describe, expect, it } from 'vitest';
import {
  effectiveStatus,
  expireOverrideByEvent,
  loadProgress,
  markQuestAccepted,
  markQuestComplete,
  setFaction,
  setPlayerLevel,
  setQuestOverride,
  toTrackerProgress,
  type LocalProgress,
} from './localProgress';
import { computeStats, parseHistory, recordQuestEvent, recordRaidEnd, recordRaidStart, EMPTY_HISTORY } from './raidHistory';
import { parsePlanner } from './planner';
import { isLiveEvent, parseLogTime } from '../services/tauriEvents';
import { mapIdFromLogLocation } from '../map/logLocationMap';

const fresh = (): LocalProgress => ({
  acceptedQuestIds: [],
  completedQuestIds: [],
  failedQuestIds: [],
  playerLevel: 1,
  faction: 'USEC',
  levelSet: false,
  factionSet: false,
  overrides: {},
  remoteCompletedIds: [],
  remoteFailedIds: [],
});

describe('localProgress overrides', () => {
  it('loads an old (pre-override) stored shape', () => {
    localStorage.setItem(
      'tc_local_progress_v1',
      JSON.stringify({ acceptedQuestIds: ['a'], completedQuestIds: [], failedQuestIds: [], playerLevel: 1, faction: 'USEC' }),
    );
    const p = loadProgress();
    expect(p.acceptedQuestIds).toEqual(['a']);
    expect(p.overrides).toEqual({});
    expect(p.levelSet).toBe(false);
    localStorage.removeItem('tc_local_progress_v1');
  });

  it('an override replaces the log state and can be cleared', () => {
    let p = markQuestComplete(markQuestAccepted(fresh(), 'a'), 'a');
    expect(effectiveStatus(p, 'a')).toBe('complete');
    p = setQuestOverride(p, 'a', 'active', 1000);
    expect(effectiveStatus(p, 'a')).toBe('active');
    expect(toTrackerProgress(p).tasksProgress.find((t) => t.id === 'a')).toMatchObject({
      accepted: true,
      complete: false,
      failed: false,
    });
    p = setQuestOverride(p, 'a', null);
    expect(effectiveStatus(p, 'a')).toBe('complete');
  });

  it('only a NEWER, timestamped log event expires an override', () => {
    const p = setQuestOverride(fresh(), 'a', 'none', 5000);
    expect(expireOverrideByEvent(p, 'a', null)).toBe(p); // old watcher, no time
    expect(expireOverrideByEvent(p, 'a', 4000)).toBe(p); // replay of older logs
    expect(expireOverrideByEvent(p, 'a', 6000).overrides).toEqual({});
  });

  it('level and faction setters flag that the player chose them', () => {
    const p = setFaction(setPlayerLevel(fresh(), 120), 'BEAR');
    expect(p).toMatchObject({ playerLevel: 79, levelSet: true, faction: 'BEAR', factionSet: true });
    expect(setFaction(p, null).factionSet).toBe(false);
  });
});

describe('raidHistory', () => {
  it('pairs start and end, ignores replays, and computes stats', () => {
    let h = recordRaidStart(EMPTY_HISTORY, 'Sandbox', 1_000_000);
    h = recordRaidEnd(h, 'Sandbox', 1_000_000 + 30 * 60_000);
    // replay of the same two lines
    h = recordRaidStart(h, 'Sandbox', 1_000_000);
    h = recordRaidEnd(h, 'Sandbox', 1_000_000 + 30 * 60_000);
    h = recordRaidStart(h, 'bigmap', 5_000_000);
    h = recordQuestEvent(h, { templateId: 'q', status: 'Finished', at: 10 });
    h = recordQuestEvent(h, { templateId: 'q', status: 'Finished', at: 10 });
    expect(h.raids).toHaveLength(2);
    expect(h.questEvents).toHaveLength(1);
    const s = computeStats(h, null);
    expect(s).toMatchObject({ raids: 2, finished: 1, totalMs: 30 * 60_000, questsCompleted: 1 });
    expect(s.byLocation.map((l) => l.location).sort()).toEqual(['Sandbox', 'bigmap']);
    expect(computeStats(h, 2_000_000).raids).toBe(1);
  });

  it('does not close a raid on a different map', () => {
    let h = recordRaidStart(EMPTY_HISTORY, 'Woods', 0);
    h = recordRaidEnd(h, 'Sandbox', 60_000);
    expect(h.raids).toHaveLength(2);
    expect(h.raids[0].endedAt).toBeNull();
  });

  it('survives garbage in storage', () => {
    expect(parseHistory('not json')).toEqual({ raids: [], questEvents: [] });
    expect(parsePlanner('{"stationLevels":{"a":2,"b":-1},"needsScope":"weird"}')).toMatchObject({
      stationLevels: { a: 2 },
      needsScope: 'available',
    });
  });
});

describe('raid-start map switch', () => {
  it('treats recent or untimestamped events as live, replays as not', () => {
    const now = new Date(2026, 10, 10, 20, 0, 0).getTime();
    expect(isLiveEvent(null, now)).toBe(true);
    expect(isLiveEvent(now - 60_000, now)).toBe(true);
    expect(isLiveEvent(now - 2 * 60 * 60 * 1000, now)).toBe(false);
  });

  it('maps every location token seen in real 1.3 logs', () => {
    for (const token of ['Interchange', 'Sandbox', 'Sandbox_high', 'TarkovStreets', 'bigmap']) {
      expect(mapIdFromLogLocation(token), token).toBeTruthy();
    }
  });
});

describe('parseLogTime', () => {
  it('reads the EFT log prefix as local time', () => {
    const t = parseLogTime('2026-11-09 22:23:59.829');
    expect(t).toBe(new Date(2026, 10, 9, 22, 23, 59, 829).getTime());
    expect(parseLogTime('2026-11-09T22:23:59Z')).toBeNull();
    expect(parseLogTime(null)).toBeNull();
  });
});
