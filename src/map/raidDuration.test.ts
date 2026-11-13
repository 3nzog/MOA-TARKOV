import { describe, expect, it } from 'vitest';
import { clock, raidClock, raidMinutes } from './raidDuration';

const CUSTOMS = '56f40101d2720b2a4d8b45d6';

describe('raid clock', () => {
  it('knows map lengths', () => {
    expect(raidMinutes(CUSTOMS)).toBe(35);
    expect(raidMinutes('unknown')).toBeNull();
  });
  it('counts down for a PMC and up otherwise', () => {
    const start = 1_000_000;
    expect(raidClock(start, CUSTOMS, 'pmc', start + 5 * 60_000)).toEqual({ kind: 'left', ms: 30 * 60_000 });
    expect(raidClock(start, CUSTOMS, 'scav', start + 5 * 60_000)).toEqual({ kind: 'elapsed', ms: 5 * 60_000 });
    expect(raidClock(start, null, 'pmc', start + 1000)).toEqual({ kind: 'elapsed', ms: 1000 });
  });
  it('formats', () => {
    expect(clock(30 * 60_000)).toBe('30:00');
    expect(clock(61_500)).toBe('1:01');
    expect(clock(-5)).toBe('0:00');
    expect(clock(3_725_000)).toBe('1:02:05');
  });
});
