// When to play the sound alerts (sounds.ts says how they sound):
//  - the raid clock passing 10, 5 and 2 minutes left (PMC raids, whose end is known);
//  - time to head for the exit: what is left barely covers the walk from your
//    latest position to the nearest exit of your side (plus a minute);
//  - a stop of the raid route done (walked up to, or ticked off);
//  - a quest done (the game's log says so): see questDoneSound;
//  - your screenshot puts you in a hot place right now (once per place every 2 min).
// Each plays once per raid.
import { useEffect, useRef } from 'react';
import { dueClockSound, dueHotSound, playSound, type SoundKind } from './sounds';

/** Kept on top of the walk to the exit before "head for the exit" sounds. */
const EXIT_MARGIN_S = 60;

interface Options {
  raid: { startedAt: number; endsAt: number | null } | null;
  /** Seconds from your latest position to the nearest exit (null: unknown). */
  toExit: number | null;
  /** Route stops done this raid. */
  routeDone: number;
  /** The hot place your latest position is in (null: none). */
  hotKey?: string | null;
}

export function useSoundAlerts({ raid, toExit, routeDone, hotKey = null }: Options): void {
  const played = useRef<{ raid: number | null; kinds: Set<SoundKind> }>({ raid: null, kinds: new Set() });
  const toExitRef = useRef(toExit);
  useEffect(() => {
    toExitRef.current = toExit;
  }, [toExit]);

  const startedAt = raid?.startedAt ?? null;
  const endsAt = raid?.endsAt ?? null;

  // Raid clock and "head for the exit", checked every second while a raid with a known end runs.
  useEffect(() => {
    if (played.current.raid !== startedAt) played.current = { raid: startedAt, kinds: new Set() };
    if (startedAt === null || endsAt === null) return;
    const tick = () => {
      const left = endsAt - Date.now();
      if (left <= 0) return;
      const kinds = played.current.kinds;
      const clock = dueClockSound(left, kinds);
      if (clock) {
        kinds.add(clock);
        playSound(clock);
        return;
      }
      const walk = toExitRef.current;
      if (walk !== null && !kinds.has('extract') && left / 1000 <= walk + EXIT_MARGIN_S) {
        kinds.add('extract');
        playSound('extract');
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, endsAt]);

  // A route stop done: the count going up within the same raid.
  const lastDone = useRef({ raid: startedAt, n: routeDone });
  useEffect(() => {
    const prev = lastDone.current;
    if (prev.raid === startedAt && routeDone > prev.n) playSound('stop');
    lastDone.current = { raid: startedAt, n: routeDone };
  }, [routeDone, startedAt]);

  // Walking into a hot place (a new screenshot there), in a raid.
  const hotPlayed = useRef(new Map<string, number>());
  useEffect(() => {
    if (!hotKey || startedAt === null) return;
    if (dueHotSound(hotKey, Date.now(), hotPlayed.current)) playSound('hot');
  }, [hotKey, startedAt]);
}

/** A quest event from the game's log: "Finished" sounds. */
export function questDoneSound(status: string): void {
  if (status === 'Finished') playSound('quest');
}
