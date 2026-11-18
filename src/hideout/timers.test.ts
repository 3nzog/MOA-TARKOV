import { describe, expect, it } from 'vitest';
import { parseLeft, parseTimers, removeTimer, setTimeLeft, startTimer } from './timers';

describe('hideout timers', () => {
  it('reads what the player types as the time left', () => {
    expect(parseLeft('1:30')).toBe(90 * 60_000);
    expect(parseLeft('45')).toBe(45 * 60_000);
    expect(parseLeft('2:05:00')).toBe((2 * 60 + 5) * 60_000);
    expect(parseLeft('abc')).toBeNull();
    expect(parseLeft('1:2:3:4')).toBeNull();
  });

  it('keeps one craft per station: a new one replaces the old', () => {
    const a = startTimer({ kind: 'craft', stationId: 'lav', craftId: 'c1', label: 'A' }, 60, 0);
    const b = startTimer({ kind: 'craft', stationId: 'lav', craftId: 'c2', label: 'B' }, 120, 0);
    const u = startTimer({ kind: 'upgrade', stationId: 'lav', level: 2, label: 'Lav 2' }, 3600, 0);
    const saved = parseTimers(localStorage.getItem('tc_hideout_timers_v1'));
    expect(saved.map((t) => t.id)).toEqual([b.id, u.id]);
    expect(saved[0].endsAt).toBe(120_000);
    setTimeLeft(b.id, 30_000, 1000);
    expect(parseTimers(localStorage.getItem('tc_hideout_timers_v1'))[0].endsAt).toBe(31_000);
    removeTimer(b.id);
    removeTimer(u.id);
    expect(parseTimers(localStorage.getItem('tc_hideout_timers_v1'))).toEqual([]);
    expect(a.id).not.toBe(b.id);
  });

  it('drops broken entries', () => {
    expect(parseTimers('[{"id":"x"},{"id":"y","kind":"craft","stationId":"s","label":"L","startedAt":1,"endsAt":2}]')).toHaveLength(1);
    expect(parseTimers('nope')).toEqual([]);
  });
});
