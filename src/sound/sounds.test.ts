import { describe, expect, it } from 'vitest';
import { dueClockSound, dueHotSound, groupOf, parseSoundPrefs, type SoundKind } from './sounds';

const MIN = 60_000;

describe('dueClockSound', () => {
  it('sounds each threshold once, right after the clock passes it', () => {
    const played = new Set<SoundKind>();
    expect(dueClockSound(11 * MIN, played)).toBeNull();
    expect(dueClockSound(10 * MIN - 1000, played)).toBe('time10');
    played.add('time10');
    expect(dueClockSound(9.5 * MIN, played)).toBeNull();
    expect(dueClockSound(5 * MIN - 5000, played)).toBe('time5');
    played.add('time5');
    expect(dueClockSound(2 * MIN - 1, played)).toBe('time2');
  });

  it('does not play old thresholds when the app opens late in the raid', () => {
    expect(dueClockSound(7 * MIN, new Set())).toBeNull();
    expect(dueClockSound(30 * 1000, new Set())).toBeNull();
  });
});

describe('sound preferences', () => {
  it('defaults on, keeps what is valid and ignores the rest', () => {
    expect(parseSoundPrefs(null)).toMatchObject({ on: true, groups: { raidTime: true, extract: true, stop: true, quest: true } });
    const p = parseSoundPrefs(JSON.stringify({ on: false, volume: 3, groups: { stop: false, bogus: true } }));
    expect(p.on).toBe(false);
    expect(p.volume).toBe(0.6);
    expect(p.groups.stop).toBe(false);
    expect(p.groups.quest).toBe(true);
    expect(parseSoundPrefs('{not json')).toMatchObject({ on: true });
  });

  it('the three raid-clock sounds share one switch', () => {
    expect(groupOf('time10')).toBe('raidTime');
    expect(groupOf('time2')).toBe('raidTime');
    expect(groupOf('extract')).toBe('extract');
  });
});

describe('the hot place sound', () => {
  it('sounds once per place, again only after two minutes', () => {
    const last = new Map<string, number>();
    expect(dueHotSound('spawn:1:2', 0, last)).toBe(true);
    expect(dueHotSound('spawn:1:2', 60_000, last)).toBe(false);
    expect(dueHotSound('boss:5:5', 60_000, last)).toBe(true);
    expect(dueHotSound('spawn:1:2', 2 * MIN + 1, last)).toBe(true);
  });

  it('has its own switch, on by default', () => {
    expect(groupOf('hot')).toBe('hot');
    expect(parseSoundPrefs(null).groups.hot).toBe(true);
    expect(parseSoundPrefs(JSON.stringify({ groups: { hot: false } })).groups.hot).toBe(false);
  });
});
