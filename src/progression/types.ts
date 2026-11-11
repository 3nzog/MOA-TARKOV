// Domain types for progression planning: quest prerequisites and gates, the
// items each objective asks for, hideout station levels, crafts and prices.
//
// Source: data/snapshot/progression*.json and prices.json, written by
// scripts/fetch-progression.mjs from tarkov.dev. None of it comes from the game:
// the game exposes no level, stash, hideout or price data to a passive reader,
// so anything "owned" or "built" in this module is what the player told us.

export type ReqStatus = 'complete' | 'active' | 'failed';
export type Faction = 'USEC' | 'BEAR';

export interface ObjectiveMeta {
  type: string;
  count?: number;
  /** Item ids. More than one = "any of these" (e.g. hand over 3 of any food). */
  items: string[];
  /** Found-in-raid required. */
  fir: boolean;
  /** Key alternatives: each inner list is one key slot, any of its ids opens it. */
  keys: string[][];
  questItem?: string;
  /** Marker item to place (MS2000 etc). */
  marker?: string;
  optional: boolean;
}

export interface TaskRequirement {
  taskId: string;
  status: ReqStatus[];
}

export interface TraderRequirement {
  traderId: string;
  type: string; // 'level' | 'reputation'
  value: number;
}

export interface NeededKeys {
  /** null = the upstream did not say which map. */
  mapId: string | null;
  keys: string[];
}

export interface TaskMeta {
  minLevel: number;
  requires: TaskRequirement[];
  traderReqs: TraderRequirement[];
  /** null = available to both factions. */
  faction: Faction | null;
  kappa: boolean;
  lightkeeper: boolean;
  neededKeys: NeededKeys[];
  xp: number | null;
  objectives: Record<string, ObjectiveMeta>;
}

export interface StationItemReq {
  itemId: string;
  count: number;
  fir: boolean;
}

export interface StationLevel {
  /** tarkov.dev level id; TarkovTracker reports built levels by it. */
  id?: string;
  level: number;
  /** Construction time in seconds. */
  time: number;
  items: StationItemReq[];
  stations: { stationId: string; level: number }[];
  traders: { traderId: string; level: number }[];
  skills: { skill: string; level: number }[];
}

export interface Station {
  id: string;
  levels: StationLevel[];
}

export interface Craft {
  id: string;
  stationId: string;
  level: number;
  /** Seconds. */
  duration: number;
  inputs: { itemId: string; count: number; tool: boolean }[];
  output: { itemId: string; count: number };
}

export interface ItemPrice {
  base: number | null;
  /** Flea 24h average. */
  avg24h: number | null;
  /** Flea last lowest offer. */
  lastLow: number | null;
  /** Best trader buy-back price (RUB) and that trader. */
  sellTraderId: string | null;
  sellPrice: number | null;
  /** Cheapest trader offer (RUB), that trader and the loyalty level it needs. */
  buyTraderId: string | null;
  buyPrice: number | null;
  buyLevel: number | null;
  width: number;
  height: number;
  /** Banned from the flea market. */
  noFlea: boolean;
}

export interface ProgressionNames {
  items: Record<string, { name: string; short: string }>;
  questItems: Record<string, string>;
  stations: Record<string, string>;
  traders: Record<string, string>;
}

export interface ProgressionData {
  /** When the progression dataset was generated (ms), null if unknown. */
  generatedAt: number | null;
  /** When the prices were captured (ms). null = no prices available. */
  pricesAt: number | null;
  /** Where it came from — 'remote' = the repo's daily snapshot, 'bundled' = the copy inside the app. */
  source: 'remote' | 'bundled';
  tasks: Record<string, TaskMeta>;
  stations: Station[];
  crafts: Craft[];
  prices: Record<string, ItemPrice>;
  names: ProgressionNames;
}

// Currencies show up as hideout requirements; they are money, not loot.
export const CURRENCY_IDS = new Set([
  '5449016a4bdc2d6f028b456f', // Roubles
  '5696686a4bdc2da3298b456a', // Dollars
  '569668774bdc2da2298b4568', // Euros
]);
