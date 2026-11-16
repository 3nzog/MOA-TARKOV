// Where a part can come from for THIS player: trader cash offers and barters
// gated by loyalty level (and by a quest when the offer is a quest unlock),
// hideout crafts, and the flea market from its unlock level.
import { useSyncExternalStore } from 'react';
import type { WeaponData } from './data';

export interface Access {
  /** Loyalty level per trader id; 0 = not unlocked yet. */
  traderLevels: Record<string, number>;
  /** Flea market open for this player. */
  flea: boolean;
  /** Whether a quest is done (offers unlocked by a quest). */
  taskDone: (taskId: string) => boolean;
}

export type Source =
  | { kind: 'trader'; trader: string; level: number; price: number; task: string | null }
  | { kind: 'barter'; trader: string; level: number; items: [string, number][]; task: string | null }
  | { kind: 'craft'; station: string; level: number }
  | { kind: 'flea'; price: number };

export type LockReason = { why: 'level'; need: number; have: number } | { why: 'task'; task: string } | { why: 'flea' };

export interface Availability {
  /** What this player can use now: cash offers cheapest first, then barters, flea and crafts. */
  open: Source[];
  /** What exists but is still locked, and why. */
  locked: { source: Source; reason: LockReason }[];
  /** Cheapest way to pay cash now (trader or flea), RUB. */
  cash: number | null;
}

export function availability(data: WeaponData, itemId: string, access: Access): Availability {
  const s = data.src[itemId] ?? {};
  const open: Source[] = [];
  const locked: Availability['locked'] = [];
  const gate = (trader: string, level: number, task: string | 0): LockReason | null => {
    const have = access.traderLevels[trader] ?? 0;
    if (have < level) return { why: 'level', need: level, have };
    if (task && !access.taskDone(task)) return { why: 'task', task };
    return null;
  };
  for (const [trader, level, price, task] of s.o ?? []) {
    const src: Source = { kind: 'trader', trader, level, price, task: task || null };
    const reason = gate(trader, level, task);
    if (reason) locked.push({ source: src, reason });
    else open.push(src);
  }
  open.sort((a, b) => (a.kind === 'trader' && b.kind === 'trader' ? a.price - b.price : 0));
  for (const [trader, level, items, task] of s.b ?? []) {
    const src: Source = { kind: 'barter', trader, level, items, task: task || null };
    const reason = gate(trader, level, task);
    if (reason) locked.push({ source: src, reason });
    else open.push(src);
  }
  if (s.f) {
    const src: Source = { kind: 'flea', price: s.f };
    if (access.flea) open.push(src);
    else locked.push({ source: src, reason: { why: 'flea' } });
  }
  for (const [station, level] of s.c ?? []) open.push({ kind: 'craft', station, level });
  const prices = open.flatMap((o) => (o.kind === 'trader' || o.kind === 'flea' ? [o.price] : []));
  return { open, locked, cash: prices.length ? Math.min(...prices) : null };
}

/** availability(), memoised per item for one data + access pair. */
export function availabilityLookup(data: WeaponData, access: Access): (itemId: string) => Availability {
  const cache = new Map<string, Availability>();
  return (id) => {
    let a = cache.get(id);
    if (!a) cache.set(id, (a = availability(data, id, access)));
    return a;
  };
}

/** Can this player get the part at all right now (cash, barter, flea or craft)? */
export const isObtainable = (a: Availability) => a.open.length > 0;

/** Traders that sell or barter weapon parts, in a stable order. */
export function partTraders(data: WeaponData): WeaponData['traders'] {
  const used = new Set<string>();
  for (const s of Object.values(data.src)) {
    for (const o of s.o ?? []) used.add(o[0]);
    for (const b of s.b ?? []) used.add(b[0]);
  }
  return data.traders.filter((t) => used.has(t.id));
}

/** Highest loyalty level a player of this level could have (reputation and spend aside). */
export function maxLevelFor(trader: WeaponData['traders'][number], playerLevel: number): number {
  let best = 0;
  for (const [level, needed] of trader.levels) if (playerLevel >= needed && level > best) best = level;
  return best;
}

// ---- the player's trader levels (per PC) -----------------------------------
// The game never writes loyalty levels where a passive reader can see them, so
// the player sets them once (the bench offers an estimate from their level).
const KEY = 'tc_trader_levels_v1';

export interface TraderLevels {
  levels: Record<string, number>;
  /** null = follow the player level (flea opens at its unlock level). */
  flea: boolean | null;
  /** Set by the player at least once. */
  set: boolean;
}

const EMPTY: TraderLevels = { levels: {}, flea: null, set: false };

function load(): TraderLevels {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    return normalizeTraderLevels(JSON.parse(raw));
  } catch {
    return EMPTY;
  }
}

/** Any value (saved, or sent by a linked game PC) as well-formed trader levels. */
export function normalizeTraderLevels(raw: unknown): TraderLevels {
  try {
    if (!raw || typeof raw !== 'object') return EMPTY;
    const p = raw as Partial<TraderLevels>;
    const levels: Record<string, number> = {};
    for (const [k, v] of Object.entries(p.levels ?? {})) {
      if (typeof v === 'number' && v >= 0 && v <= 4) levels[k] = Math.round(v);
    }
    return { levels, flea: typeof p.flea === 'boolean' ? p.flea : null, set: p.set === true };
  } catch {
    return EMPTY;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function setTraderLevels(next: TraderLevels): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function useTraderLevels(): TraderLevels {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** The levels to use: the player's own where set, else the estimate from their level. */
export function effectiveAccess(
  data: WeaponData,
  saved: TraderLevels,
  playerLevel: number | null,
  taskDone: (id: string) => boolean,
): Access {
  const traderLevels: Record<string, number> = {};
  for (const t of partTraders(data)) {
    traderLevels[t.id] = saved.levels[t.id] ?? (playerLevel !== null ? maxLevelFor(t, playerLevel) : 4);
  }
  const flea = saved.flea ?? (playerLevel !== null ? playerLevel >= data.fleaMinLevel : true);
  return { traderLevels, flea, taskDone };
}
