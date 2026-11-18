import { describe, expect, it } from 'vitest';
import { learnSides, type RaidHistory } from '../state/raidHistory';
import { lastScavEnd, parseScavPrefs, READY_SHOWN_MS, scavState } from './scavTimer';

const MIN = 60_000;

describe('the Scav wait', () => {
  const h: RaidHistory = {
    raids: [
      { location: 'bigmap', startedAt: 0, endedAt: 30 * MIN, profileKey: 'scavKey' },
      { location: 'woods', startedAt: 40 * MIN, endedAt: 80 * MIN, profileKey: 'pmcKey' },
    ],
    questEvents: [],
    manualSides: { scavKey: 'scav', pmcKey: 'pmc' },
  };

  it('starts when the last Scav raid ended (a PMC raid after it does not count)', () => {
    expect(lastScavEnd(h, learnSides(h))).toBe(30 * MIN);
    expect(lastScavEnd({ raids: [], questEvents: [] }, learnSides(h))).toBeNull();
  });

  it('counts down, then says ready for a while, then goes away', () => {
    expect(scavState(30 * MIN, 25, 40 * MIN)).toEqual({ kind: 'waiting', leftMs: 15 * MIN, readyAt: 55 * MIN });
    expect(scavState(30 * MIN, 25, 56 * MIN)).toEqual({ kind: 'ready', readyAt: 55 * MIN });
    expect(scavState(30 * MIN, 25, 55 * MIN + READY_SHOWN_MS + 1)).toEqual({ kind: 'none' });
    expect(scavState(null, 25, 0)).toEqual({ kind: 'none' });
  });

  it('keeps the length the player set, within reason', () => {
    expect(parseScavPrefs(null).minutes).toBe(25);
    expect(parseScavPrefs('{"minutes":12}').minutes).toBe(12);
    expect(parseScavPrefs('{"minutes":999}').minutes).toBe(60);
    expect(parseScavPrefs('{"minutes":"x"}').minutes).toBe(25);
  });
});
