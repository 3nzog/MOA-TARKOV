// The game PC's app state, shared with a linked extra screen (src-tauri/src/link.rs,
// "link-state"). The game PC's window publishes each piece when it changes;
// the extra screen replaces its own copy with it. One way only: the extra
// screen never sends anything back, so neither can undo the other.
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useLink } from './useLink';

/** Must match STATE_KEYS in src-tauri/src/link.rs. */
export type LinkStateKey = 'progress' | 'history' | 'squad' | 'markers' | 'planner' | 'profile' | 'raid' | 'traders' | 'presets';

export const linkPublish = (key: LinkStateKey, value: unknown) => invoke<boolean>('link_publish', { key, value });

/**
 * On the game PC (this PC lets others link and is not itself showing another
 * PC): publish `value` whenever it changes, a moment after (bursts merge).
 */
export function usePublishState(key: LinkStateKey, value: unknown): void {
  const link = useLink();
  const on = link.available && !!link.host?.hosting && link.client?.state !== 'linked';
  useEffect(() => {
    if (!on || value === undefined) return;
    const timer = window.setTimeout(() => void linkPublish(key, value).catch(() => undefined), 300);
    return () => window.clearTimeout(timer);
  }, [on, key, value]);
}

/**
 * On the extra screen: hand every value the game PC publishes for `key` to
 * `apply`, after `parse` checked it (null = ignore).
 */
export function useMirroredState<T>(key: LinkStateKey, parse: (raw: unknown) => T | null, apply: (v: T) => void): void {
  const link = useLink();
  const ref = useRef({ parse, apply });
  useEffect(() => {
    ref.current = { parse, apply };
  });
  useEffect(() => {
    if (!link.available) return;
    let un: (() => void) | undefined;
    let alive = true;
    void listen<{ key: string; value: unknown }>('link-state', (e) => {
      if (e.payload?.key !== key) return;
      const v = ref.current.parse(e.payload.value);
      if (v !== null) ref.current.apply(v);
    }).then((u) => {
      if (alive) un = u;
      else u();
    });
    return () => {
      alive = false;
      un?.();
    };
  }, [link.available, key]);
}
