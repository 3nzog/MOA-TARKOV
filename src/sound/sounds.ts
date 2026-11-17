// Sound alerts: short tones made on the spot with the Web Audio API (no audio
// files, no voice). Each alert has its own pattern so it can be told apart
// without looking: the raid clock, "time to head for the exit", a route stop
// done, a quest done, a hot place. Preferences live per PC.
import { useSyncExternalStore } from 'react';

export type SoundKind = 'time10' | 'time5' | 'time2' | 'extract' | 'stop' | 'quest' | 'hot';
/** The switches in Settings (the three raid-clock sounds share one). */
export type SoundGroup = 'raidTime' | 'extract' | 'stop' | 'quest' | 'hot';
export const SOUND_GROUPS: readonly SoundGroup[] = ['raidTime', 'extract', 'stop', 'quest', 'hot'];

export const groupOf = (k: SoundKind): SoundGroup =>
  k === 'time10' || k === 'time5' || k === 'time2' ? 'raidTime' : k;

export interface SoundPrefs {
  on: boolean;
  /** 0–1 */
  volume: number;
  groups: Record<SoundGroup, boolean>;
}

const KEY = 'tc_sounds_v1';
const DEFAULTS: SoundPrefs = { on: true, volume: 0.6, groups: { raidTime: true, extract: true, stop: true, quest: true, hot: true } };

export function parseSoundPrefs(raw: string | null): SoundPrefs {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<SoundPrefs> | null;
    if (!v || typeof v !== 'object') return DEFAULTS;
    const volume = typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : DEFAULTS.volume;
    const groups = { ...DEFAULTS.groups };
    for (const g of SOUND_GROUPS) if (typeof v.groups?.[g] === 'boolean') groups[g] = v.groups[g];
    return { on: typeof v.on === 'boolean' ? v.on : DEFAULTS.on, volume, groups };
  } catch {
    return DEFAULTS;
  }
}

let current: SoundPrefs = (() => {
  try {
    return parseSoundPrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULTS;
  }
})();
const listeners = new Set<() => void>();

export function setSoundPrefs(patch: Partial<SoundPrefs>): void {
  current = { ...current, ...patch, groups: { ...current.groups, ...(patch.groups ?? {}) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** [frequency Hz, start s, length s] per note. */
type Note = [number, number, number];
const PATTERNS: Record<SoundKind, { notes: Note[]; wave: OscillatorType }> = {
  // Raid clock: 2, 3 and then 4 quick beeps, higher as time runs out.
  time10: { wave: 'sine', notes: [[660, 0, 0.12], [660, 0.2, 0.12]] },
  time5: { wave: 'sine', notes: [[780, 0, 0.12], [780, 0.18, 0.12], [780, 0.36, 0.12]] },
  time2: { wave: 'triangle', notes: [[920, 0, 0.1], [920, 0.14, 0.1], [920, 0.28, 0.1], [1240, 0.42, 0.22]] },
  // Head for the exit: low-high, three times.
  extract: { wave: 'square', notes: [[440, 0, 0.14], [880, 0.16, 0.14], [440, 0.4, 0.14], [880, 0.56, 0.14], [440, 0.8, 0.14], [880, 0.96, 0.2]] },
  // Route stop done: two notes up.
  stop: { wave: 'sine', notes: [[880, 0, 0.1], [1320, 0.11, 0.16]] },
  // Quest done: a major arpeggio.
  quest: { wave: 'triangle', notes: [[523, 0, 0.14], [659, 0.12, 0.14], [784, 0.24, 0.14], [1047, 0.36, 0.3]] },
  // A hot place: two low, rough notes going down.
  hot: { wave: 'sawtooth', notes: [[392, 0, 0.16], [294, 0.2, 0.3]] },
};

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

// The webview only lets sound start after the first click or key press.
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Plays one alert (respecting the switches unless `force`, for the test buttons). */
export function playSound(kind: SoundKind, force = false): void {
  const p = current;
  if (!force && (!p.on || !p.groups[groupOf(kind)])) return;
  const ac = audio();
  if (!ac || p.volume <= 0) return;
  const { notes, wave } = PATTERNS[kind];
  const t0 = ac.currentTime + 0.02;
  // Square and sawtooth waves are much louder to the ear.
  const peak = p.volume * (wave === 'square' || wave === 'sawtooth' ? 0.12 : 0.3);
  for (const [freq, at, len] of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0 + at);
    gain.gain.linearRampToValueAtTime(peak, t0 + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + len + 0.02);
  }
}

/**
 * Which raid-clock sound is due: the last threshold (10, 5, 2 min left) the
 * clock passed that has not sounded yet in this raid. Only within a minute of
 * the threshold, so opening the app late in a raid does not play stale ones.
 */
export function dueClockSound(leftMs: number, played: ReadonlySet<SoundKind>): SoundKind | null {
  const steps: [SoundKind, number][] = [
    ['time2', 2],
    ['time5', 5],
    ['time10', 10],
  ];
  for (const [kind, min] of steps) {
    const at = min * 60_000;
    if (leftMs <= at && leftMs > at - 60_000 && !played.has(kind)) return kind;
  }
  return null;
}

/** Walking into the same hot place again sounds only after this long. */
export const HOT_COOLDOWN_MS = 2 * 60_000;

/**
 * Whether entering the hot place `key` should sound now: not if it sounded
 * for that place less than HOT_COOLDOWN_MS ago (`last` remembers when).
 */
export function dueHotSound(key: string, now: number, last: Map<string, number>): boolean {
  const at = last.get(key);
  if (at !== undefined && now - at < HOT_COOLDOWN_MS) return false;
  last.set(key, now);
  return true;
}
