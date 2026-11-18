import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, recordRaidEnd, recordRaidStart, type RaidHistory } from './raidHistory';

const MIN = 60_000;

describe("a raid's end, as the game's logs give it", () => {
  const started = (): RaidHistory => recordRaidStart(EMPTY_HISTORY, 'Woods', 0, '0123456789abcdef');

  it('the backend end closes the raid; the same end from the push-notification log right after is not a second raid', () => {
    let h = recordRaidEnd(started(), null, 12 * MIN);
    h = recordRaidEnd(h, 'Woods', 12 * MIN + 4);
    expect(h.raids).toEqual([{ location: 'Woods', startedAt: 0, endedAt: 12 * MIN, profileKey: '0123456789abcdef' }]);
  });

  it('back in the menus closes a raid nothing else closed (a death the logs said nothing about)', () => {
    const h = recordRaidEnd(started(), null, 20 * MIN, true);
    expect(h.raids[0].endedAt).toBe(20 * MIN);
  });

  it('back in the menus with no raid open (logging in, or after the end was already seen) changes nothing', () => {
    expect(recordRaidEnd(EMPTY_HISTORY, null, 5 * MIN, true)).toBe(EMPTY_HISTORY);
    const ended = recordRaidEnd(started(), null, 12 * MIN);
    expect(recordRaidEnd(ended, null, 13 * MIN, true)).toBe(ended);
  });

  it('an end far from any other, with nothing open, is still kept (a raid whose start was not seen)', () => {
    const h = recordRaidEnd(EMPTY_HISTORY, 'bigmap', 60 * MIN);
    expect(h.raids).toEqual([{ location: 'bigmap', startedAt: null, endedAt: 60 * MIN }]);
  });
});
