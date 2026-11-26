// "When is the best time to sell?" from the app's own records. tarkov.dev's
// price history lives only in its API, which can be down for hours; its public
// items file (json.tarkov.dev/regular/items) keeps updating. So the app reads
// that file every half hour — only when it changed — and writes down, for the
// items the player watches, the lowest flea offer, the 24 h average and the
// number of offers. After a few days those records say at what hour of the day
// (this PC's clock) and on what day of the week an item sells highest.
// Kept in this PC's storage, at most MAX_DAYS of it.
import { useEffect, useSyncExternalStore } from 'react';
import { appFetch } from '../api/http';

export const ITEMS_URL = 'https://json.tarkov.dev/regular/items';
const KEY = 'tc_price_log_v1';
const EVERY_MS = 30 * 60_000;
const FIRST_AFTER_MS = 45_000;
export const MAX_DAYS = 35;
/** Days of records before "the best hour" is worth saying. */
export const READY_DAYS = 3;

/** One record: when tarkov.dev scanned it (ms), lowest offer, 24 h average, offers. */
export type Sample = [t: number, low: number, avg: number, offers: number];

export interface PriceLog {
  watch: string[];
  samples: Record<string, Sample[]>;
  /** The items file's ETag at the last read: unchanged files are not read again. */
  etag: string | null;
  lastCheck: number | null;
}

/** Salewa and the AK-74 60-round magazine (the crafts asked about first). */
export const DEFAULT_WATCH = ['544fb45d4bdc2dee738b4568', '55d482194bdc2d1d4e8b456b'];

const empty = (): PriceLog => ({ watch: [...DEFAULT_WATCH], samples: {}, etag: null, lastCheck: null });

export function parsePriceLog(raw: string | null): PriceLog {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<PriceLog> | null;
    if (!v || typeof v !== 'object') return empty();
    const watch = Array.isArray(v.watch) ? v.watch.filter((x): x is string => typeof x === 'string').slice(0, 40) : [...DEFAULT_WATCH];
    const samples: Record<string, Sample[]> = {};
    for (const [id, list] of Object.entries(v.samples ?? {})) {
      if (!Array.isArray(list)) continue;
      samples[id] = list.filter(
        (s): s is Sample => Array.isArray(s) && s.length === 4 && s.every((n) => typeof n === 'number' && Number.isFinite(n)),
      );
    }
    return { watch, samples, etag: typeof v.etag === 'string' ? v.etag : null, lastCheck: typeof v.lastCheck === 'number' ? v.lastCheck : null };
  } catch {
    return empty();
  }
}

interface ExportItem {
  lastLowPrice?: number | null;
  avg24hPrice?: number | null;
  lastOfferCount?: number | null;
  lastScan?: string | null;
}

/** Adds what the items file says about the watched items (a scan already written is skipped). */
export function record(log: PriceLog, items: Record<string, ExportItem>, now: number): PriceLog {
  const cut = now - MAX_DAYS * 86_400_000;
  const samples: Record<string, Sample[]> = {};
  for (const id of log.watch) {
    const list = (log.samples[id] ?? []).filter((s) => s[0] >= cut);
    const it = items[id];
    const t = it?.lastScan ? Date.parse(it.lastScan) : NaN;
    if (it && it.lastLowPrice && Number.isFinite(t) && !list.some((s) => s[0] === t)) {
      list.push([t, it.lastLowPrice, it.avg24hPrice ?? 0, it.lastOfferCount ?? 0]);
    }
    samples[id] = list;
  }
  return { ...log, samples };
}

const median = (a: number[]): number | null => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Slot {
  /** Hour 0-23 (or day 0-6, Sunday first). */
  k: number;
  n: number;
  /** Typical lowest offer then. */
  med: number | null;
  /** Percent above (+) or below (-) the item's typical lowest offer. */
  vs: number | null;
}

export interface Profile {
  samples: number;
  days: number;
  overall: number | null;
  hours: Slot[];
  weekdays: Slot[];
  /** The hours that sell highest (enough records each), best first. */
  best: Slot[];
  worst: Slot | null;
  ready: boolean;
}

/** When an item sells highest, in this PC's clock (`hourOf`/`dayOf` are swappable for tests). */
export function profile(
  list: Sample[],
  hourOf: (t: number) => number = (t) => new Date(t).getHours(),
  dayOf: (t: number) => number = (t) => new Date(t).getDay(),
): Profile {
  const overall = median(list.map((s) => s[1]));
  const slots = (count: number, keyOf: (t: number) => number): Slot[] =>
    Array.from({ length: count }, (_, k) => {
      const prices = list.filter((s) => keyOf(s[0]) === k).map((s) => s[1]);
      const med = median(prices);
      return { k, n: prices.length, med, vs: med !== null && overall ? Math.round((med / overall - 1) * 1000) / 10 : null };
    });
  const hours = slots(24, hourOf);
  const weekdays = slots(7, dayOf);
  const days = list.length > 1 ? (list[list.length - 1][0] - list[0][0]) / 86_400_000 : 0;
  const solid = hours.filter((h) => h.n >= 2 && h.vs !== null);
  const best = [...solid].sort((a, b) => b.vs! - a.vs!).slice(0, 3);
  const worst = [...solid].sort((a, b) => a.vs! - b.vs!)[0] ?? null;
  return { samples: list.length, days, overall, hours, weekdays, best, worst, ready: days >= READY_DAYS && solid.length >= 12 };
}

// ---- the store and the background reader ----------------------------------

let current: PriceLog = (() => {
  try {
    return parsePriceLog(localStorage.getItem(KEY));
  } catch {
    return empty();
  }
})();
const listeners = new Set<() => void>();

function save(next: PriceLog) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: kept for this session */
  }
  for (const l of listeners) l();
}

export function usePriceLog(): PriceLog {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function watchItem(id: string) {
  if (current.watch.includes(id)) return;
  save({ ...current, watch: [...current.watch, id].slice(-40), etag: null });
}

export function unwatchItem(id: string) {
  const samples = { ...current.samples };
  delete samples[id];
  save({ ...current, watch: current.watch.filter((x) => x !== id), samples });
}

/** Reads the items file when it changed and writes the watched items down. */
export async function checkPrices(now = Date.now()): Promise<void> {
  const headers: Record<string, string> = {};
  if (current.etag) headers['If-None-Match'] = current.etag;
  const res = await appFetch(ITEMS_URL, { headers, cache: 'no-store' });
  if (res.status === 304) {
    save({ ...current, lastCheck: now });
    return;
  }
  if (!res.ok) throw new Error(`items ${res.status}`);
  const doc = (await res.json()) as { data?: { items?: Record<string, ExportItem> } };
  const items = doc.data?.items;
  if (!items) throw new Error('items: unexpected shape');
  save({ ...record(current, items, now), etag: res.headers.get('etag'), lastCheck: now });
}

/** Runs the reader while the app is open (also hidden in the tray). */
export function usePriceRecorder(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const run = () => {
      if (busy) return;
      busy = true;
      void checkPrices()
        .catch((e) => console.warn('[price log]', e))
        .finally(() => {
          busy = false;
        });
    };
    const first = window.setTimeout(run, FIRST_AFTER_MS);
    const id = window.setInterval(run, EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [enabled]);
}
