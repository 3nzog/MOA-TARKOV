// Loads the progression + economy snapshot (scripts/fetch-progression.mjs).
//
// Two sources, best first:
//   1. the repo's committed snapshot over GitHub's CDN — refreshed by CI, so
//      prices are at most about a day old;
//   2. the copy compiled into the binary — always there, but as old as the build.
//
// Deliberately NOT cached in localStorage: the bundled tier is always present,
// so a cache would only add quota pressure next to the task and POI caches. The
// remote tier is a nice-to-have; until the files exist upstream it 404s and the
// bundled copy is used without a fuss.
import { appFetch } from './http';
import type { ApiLang } from './tarkov-dev';
import type {
  Craft,
  Faction,
  ItemPrice,
  ObjectiveMeta,
  ProgressionData,
  ProgressionNames,
  ReqStatus,
  Station,
  TaskMeta,
} from '../progression/types';

const BASE_URL = 'https://raw.githubusercontent.com/mopocop/Tarkov-moa/main/data/snapshot';
const FETCH_TIMEOUT_MS = 8000;

// ---- raw shapes (as written by scripts/fetch-progression.mjs) ---------------

interface RawObjective {
  type?: string;
  count?: number;
  items?: string[];
  fir?: boolean;
  keys?: string[][];
  questItem?: string;
  marker?: string;
  optional?: boolean;
}

interface RawTask {
  lvl?: number;
  req?: [string, string[]][];
  trReq?: [string, string, number][];
  fac?: string;
  kappa?: boolean;
  lk?: boolean;
  keys?: [string | null, string[]][];
  xp?: number;
  obj?: Record<string, RawObjective>;
}

interface RawStation {
  id: string;
  levels?: {
    id?: string;
    level: number;
    time?: number;
    items?: [string, number, number][];
    stations?: [string, number][];
    traders?: [string, number][];
    skills?: [string, number][];
  }[];
}

interface RawCraft {
  id: string;
  station: string;
  level?: number;
  duration?: number;
  in?: [string, number, number][];
  out: [string, number];
}

export interface RawProgression {
  generatedAt?: string | null;
  tasks?: Record<string, RawTask>;
  hideout?: RawStation[];
  crafts?: RawCraft[];
}

interface RawPrice {
  b?: number;
  a?: number;
  l?: number;
  st?: string;
  sp?: number;
  bt?: string;
  bp?: number;
  bl?: number;
  w?: number;
  h?: number;
  nf?: boolean;
}

export interface RawPrices {
  generatedAt?: string | null;
  items?: Record<string, RawPrice>;
}

export interface RawProgressionLocale {
  items?: Record<string, string[]>;
  questItems?: Record<string, string>;
  stations?: Record<string, string>;
  traders?: Record<string, string>;
}

// ---- adapters (exported for tests) ------------------------------------------

const REQ_STATUSES: ReadonlySet<string> = new Set(['complete', 'active', 'failed']);
const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function adaptObjective(o: RawObjective): ObjectiveMeta {
  return {
    type: o.type ?? 'unknown',
    count: typeof o.count === 'number' ? o.count : undefined,
    items: list(o.items),
    fir: o.fir === true,
    keys: list(o.keys).filter((g) => Array.isArray(g) && g.length > 0),
    questItem: o.questItem,
    marker: o.marker,
    optional: o.optional === true,
  };
}

export function adaptTaskMeta(raw: RawTask): TaskMeta {
  const objectives: Record<string, ObjectiveMeta> = {};
  for (const [id, o] of Object.entries(raw.obj ?? {})) objectives[id] = adaptObjective(o);
  const faction: Faction | null = raw.fac === 'USEC' || raw.fac === 'BEAR' ? raw.fac : null;
  return {
    minLevel: typeof raw.lvl === 'number' ? raw.lvl : 0,
    requires: list(raw.req)
      .filter((r) => Array.isArray(r) && typeof r[0] === 'string')
      .map(([taskId, status]) => ({
        taskId,
        status: list(status).filter((s): s is ReqStatus => REQ_STATUSES.has(s)),
      })),
    traderReqs: list(raw.trReq)
      .filter((r) => Array.isArray(r) && typeof r[0] === 'string')
      .map(([traderId, type, value]) => ({ traderId, type: type ?? 'level', value: value ?? 0 })),
    faction,
    kappa: raw.kappa === true,
    lightkeeper: raw.lk === true,
    neededKeys: list(raw.keys)
      .filter((k) => Array.isArray(k) && Array.isArray(k[1]) && k[1].length > 0)
      .map(([mapId, keys]) => ({ mapId: mapId ?? null, keys })),
    xp: typeof raw.xp === 'number' ? raw.xp : null,
    objectives,
  };
}

function adaptStation(raw: RawStation): Station {
  return {
    id: raw.id,
    levels: list(raw.levels)
      .map((l) => ({
        ...(typeof l.id === 'string' ? { id: l.id } : {}),
        level: l.level,
        time: l.time ?? 0,
        items: list(l.items).map(([itemId, count, fir]) => ({ itemId, count, fir: fir === 1 })),
        stations: list(l.stations).map(([stationId, level]) => ({ stationId, level })),
        traders: list(l.traders).map(([traderId, level]) => ({ traderId, level })),
        skills: list(l.skills).map(([skill, level]) => ({ skill, level })),
      }))
      .sort((a, b) => a.level - b.level),
  };
}

function adaptCraft(raw: RawCraft): Craft | null {
  if (!raw?.out || typeof raw.out[0] !== 'string' || typeof raw.station !== 'string') return null;
  return {
    id: raw.id,
    stationId: raw.station,
    level: raw.level ?? 1,
    duration: raw.duration ?? 0,
    inputs: list(raw.in).map(([itemId, count, tool]) => ({ itemId, count, tool: tool === 1 })),
    output: { itemId: raw.out[0], count: raw.out[1] ?? 1 },
  };
}

function adaptPrice(raw: RawPrice): ItemPrice {
  const n = (v: number | undefined): number | null => (typeof v === 'number' && v > 0 ? v : null);
  return {
    base: n(raw.b),
    avg24h: n(raw.a),
    lastLow: n(raw.l),
    sellTraderId: raw.st ?? null,
    sellPrice: n(raw.sp),
    buyTraderId: raw.bt ?? null,
    buyPrice: n(raw.bp),
    buyLevel: typeof raw.bl === 'number' ? raw.bl : null,
    width: raw.w ?? 1,
    height: raw.h ?? 1,
    noFlea: raw.nf === true,
  };
}

export function adaptNames(raw: RawProgressionLocale | null): ProgressionNames {
  const items: ProgressionNames['items'] = {};
  for (const [id, pair] of Object.entries(raw?.items ?? {})) {
    if (!Array.isArray(pair) || !pair[0]) continue;
    items[id] = { name: pair[0], short: pair[1] ?? pair[0] };
  }
  return {
    items,
    questItems: raw?.questItems ?? {},
    stations: raw?.stations ?? {},
    traders: raw?.traders ?? {},
  };
}

/**
 * Join the three documents. Returns null when the progression document is
 * missing or empty — the caller shows "no data" rather than an empty planner
 * that looks like the game has no quests.
 */
export function adaptProgression(
  prog: RawProgression | null,
  prices: RawPrices | null,
  locale: RawProgressionLocale | null,
  source: ProgressionData['source'],
): ProgressionData | null {
  if (!prog?.tasks || Object.keys(prog.tasks).length === 0) return null;
  const tasks: Record<string, TaskMeta> = {};
  for (const [id, raw] of Object.entries(prog.tasks)) tasks[id] = adaptTaskMeta(raw);
  const priceMap: Record<string, ItemPrice> = {};
  for (const [id, raw] of Object.entries(prices?.items ?? {})) priceMap[id] = adaptPrice(raw);
  return {
    generatedAt: parseTime(prog.generatedAt),
    pricesAt: prices?.items ? parseTime(prices.generatedAt) : null,
    source,
    tasks,
    stations: list(prog.hideout).filter((s) => s?.id).map(adaptStation),
    crafts: list(prog.crafts).map(adaptCraft).filter((c): c is Craft => c !== null),
    prices: priceMap,
    names: adaptNames(locale),
  };
}

// ---- sources -----------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await appFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function remoteProgression(lang: ApiLang): Promise<ProgressionData | null> {
  const [prog, prices, locale] = await Promise.all([
    fetchJson<RawProgression>(`${BASE_URL}/progression.json`),
    fetchJson<RawPrices>(`${BASE_URL}/prices.json`),
    fetchJson<RawProgressionLocale>(`${BASE_URL}/progression-${lang}.json`),
  ]);
  // Names are required for a usable planner; without them every item is an id.
  if (!locale) return null;
  return adaptProgression(prog, prices, locale, 'remote');
}

// Lazy chunks, like the quest snapshot's bundled tier: ~0.6 MB + 0.7 MB + one
// ~0.4 MB locale are only parsed when the planner is first opened.
const localeModules = import.meta.glob<{ default: RawProgressionLocale }>(
  '../../data/snapshot/progression-*.json',
);

async function bundledProgression(lang: ApiLang): Promise<ProgressionData | null> {
  try {
    const key =
      Object.keys(localeModules).find((k) => k.endsWith(`progression-${lang}.json`)) ??
      Object.keys(localeModules).find((k) => k.endsWith('progression-en.json'));
    const [progMod, pricesMod, localeMod] = await Promise.all([
      import('../../data/snapshot/progression.json'),
      import('../../data/snapshot/prices.json').catch(() => null),
      key ? localeModules[key]() : Promise.resolve(null),
    ]);
    return adaptProgression(
      (progMod as unknown as { default: RawProgression }).default,
      pricesMod ? (pricesMod as unknown as { default: RawPrices }).default : null,
      localeMod ? localeMod.default : null,
      'bundled',
    );
  } catch {
    return null;
  }
}

/**
 * Best available progression data for `lang`. The remote copy wins only when it
 * is at least as new as the bundled one, so a stale CDN edge can never roll the
 * app back behind what it shipped with.
 */
export async function loadProgression(lang: ApiLang): Promise<ProgressionData | null> {
  const [remote, bundled] = await Promise.all([remoteProgression(lang), bundledProgression(lang)]);
  if (remote && (!bundled || (remote.generatedAt ?? 0) >= (bundled.generatedAt ?? 0))) return remote;
  return bundled ?? remote;
}
