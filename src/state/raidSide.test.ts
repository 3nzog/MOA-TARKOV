import { describe, expect, it } from 'vitest';
import {
  computeStats,
  currentRaid,
  EMPTY_HISTORY,
  learnSides,
  mergeSideScan,
  parseHistory,
  raidSide,
  recordGroupSide,
  recordRaidEnd,
  recordRaidStart,
  setManualSide,
  setPanelSide,
  type RaidHistory,
} from './raidHistory';

const PMC = 'aaaaaaaaaaaaaaaa';
const SCAV = 'bbbbbbbbbbbbbbbb';
const MIN = 60_000;

function history(): RaidHistory {
  let h = EMPTY_HISTORY;
  // Group raid as Scav: the squad notification lands a minute before the start.
  h = recordGroupSide(h, 'scav', 0);
  h = recordRaidStart(h, 'Interchange', 1 * MIN, SCAV);
  h = recordRaidEnd(h, 'Interchange', 30 * MIN);
  // Solo PMC raid: no notification at all.
  h = recordRaidStart(h, 'bigmap', 60 * MIN, PMC);
  h = recordRaidEnd(h, 'bigmap', 90 * MIN);
  return h;
}

describe('PMC / Scav detection', () => {
  it('learns the Scav profile from a group notification and the PMC one by elimination', () => {
    const k = learnSides(history());
    expect(k.sides.get(SCAV)).toBe('scav');
    expect(k.source.get(SCAV)).toBe('group');
    expect(k.sides.get(PMC)).toBe('pmc');
    expect(k.source.get(PMC)).toBe('elimination');
  });

  it('does not depend on the order events are replayed in', () => {
    let h = EMPTY_HISTORY;
    h = recordRaidStart(h, 'bigmap', 60 * MIN, PMC);
    h = recordRaidStart(h, 'Interchange', 1 * MIN, SCAV);
    h = recordGroupSide(h, 'scav', 0);
    expect(learnSides(h).sides.get(SCAV)).toBe('scav');
  });

  it('lets the player override, and counts raids per side', () => {
    const h = setManualSide(history(), SCAV, 'pmc');
    const k = learnSides(h);
    expect(k.sides.get(SCAV)).toBe('pmc');
    expect(k.source.get(SCAV)).toBe('manual');
    expect(computeStats(history(), null).bySide).toEqual({ pmc: 1, scav: 1, unknown: 0 });
  });

  it('ignores a notification too far from any raid start', () => {
    let h = recordGroupSide(EMPTY_HISTORY, 'scav', 0);
    h = recordRaidStart(h, 'Woods', 3 * 60 * MIN, SCAV);
    expect(learnSides(h).sides.size).toBe(0);
  });

  it('backfills the fingerprint when an old start is replayed by a newer watcher', () => {
    let h = recordRaidStart(EMPTY_HISTORY, 'Woods', 5 * MIN);
    h = recordRaidStart(h, 'Woods', 5 * MIN, PMC);
    expect(h.raids).toHaveLength(1);
    expect(h.raids[0].profileKey).toBe(PMC);
  });

  it('knows the raid in progress and its side', () => {
    let h = history();
    h = recordRaidStart(h, 'Woods', 200 * MIN, SCAV);
    const live = currentRaid(h, 210 * MIN)!;
    expect(raidSide(live, learnSides(h))).toBe('scav');
    expect(currentRaid(history(), 100 * MIN)).toBeNull();
  });

  it('drops malformed fingerprints and sides from storage', () => {
    const h = parseHistory(
      JSON.stringify({
        raids: [{ location: 'x', startedAt: 1, endedAt: null, profileKey: 'not-a-key' }],
        groupSides: [{ side: 'scav', at: 1 }, { side: 'boss', at: 2 }],
        manualSides: { [PMC]: 'pmc', nope: 'scav', [SCAV]: 'boss' },
      }),
    );
    expect(h.raids[0].profileKey).toBeNull();
    expect(h.groupSides).toEqual([{ side: 'scav', at: 1 }]);
    expect(h.manualSides).toEqual({ [PMC]: 'pmc' });
  });
});

describe('learning sides from a scan of the logs on disk', () => {
  const scan = {
    raids: [
      { location: 'factory4_day', profileKey: PMC, at: 10 * MIN },
      { location: 'Interchange', profileKey: SCAV, at: 60 * MIN },
    ],
    groups: [{ side: 'scav', at: 59 * MIN }],
    ends: [
      { location: 'Interchange', at: 90 * MIN },
      { location: 'factory4_day', at: 30 * MIN },
    ],
  };
  it('learns both profiles on a fresh install and closes old raids', () => {
    const h = mergeSideScan(EMPTY_HISTORY, scan);
    const k = learnSides(h);
    expect(k.sides.get(SCAV)).toBe('scav');
    expect(k.sides.get(PMC)).toBe('pmc');
    expect(currentRaid(h, 100 * MIN)).toBeNull();
    expect(h.raids.every((r) => r.endedAt !== null)).toBe(true);
  });
  it('is idempotent, so it can run on every launch', () => {
    const once = mergeSideScan(EMPTY_HISTORY, scan);
    expect(mergeSideScan(once, scan)).toEqual(once);
  });
  it('keeps a raid that is still running open', () => {
    const live = { ...scan, raids: [...scan.raids, { location: 'Woods', profileKey: SCAV, at: 120 * MIN }] };
    const h = mergeSideScan(EMPTY_HISTORY, live);
    expect(raidSide(currentRaid(h, 125 * MIN)!, learnSides(h))).toBe('scav');
  });
});

describe('side proven by the O+O list', () => {
  // A solo player: no group notification ever, two profiles seen.
  function solo(): RaidHistory {
    let h = EMPTY_HISTORY;
    h = recordRaidStart(h, 'bigmap', 0, PMC);
    h = recordRaidEnd(h, 'bigmap', 30 * MIN);
    h = recordRaidStart(h, 'Woods', 60 * MIN, SCAV);
    return h;
  }

  it('teaches both profiles from one list (the other by elimination)', () => {
    const before = learnSides(solo());
    expect(before.sides.size).toBe(0);
    const k = learnSides(setPanelSide(solo(), SCAV, 'scav'));
    expect(k.sides.get(SCAV)).toBe('scav');
    expect(k.source.get(SCAV)).toBe('panel');
    expect(k.sides.get(PMC)).toBe('pmc');
    expect(k.source.get(PMC)).toBe('elimination');
  });

  it('corrects an older wrong manual mark, and a newer manual mark wins again', () => {
    let h = setManualSide(solo(), SCAV, 'pmc');
    h = setPanelSide(h, SCAV, 'scav');
    expect(learnSides(h).sides.get(SCAV)).toBe('scav');
    h = setManualSide(h, SCAV, 'pmc');
    expect(learnSides(h).sides.get(SCAV)).toBe('pmc');
    // "Detect on its own" forgets both.
    h = setManualSide(h, SCAV, null);
    expect(learnSides(h).sides.has(SCAV)).toBe(false);
  });

  it('survives saving and loading', () => {
    const h = setPanelSide(solo(), SCAV, 'scav');
    const back = parseHistory(JSON.stringify(h));
    expect(back.panelSides).toEqual({ [SCAV]: 'scav' });
    expect(parseHistory(JSON.stringify({ ...h, panelSides: { nothex: 'scav', [PMC]: 'boss' } })).panelSides).toEqual({});
  });
});
