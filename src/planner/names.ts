// Name lookups over the progression data, with id-safe fallbacks: a missing
// translation must never put a 24-hex MongoId on screen.
import type { TarkovTask } from '../api/types';
import { mapIdFromLogLocation } from '../map/logLocationMap';
import { SUPPORTED_MAP_NAMES } from '../map/mapDefs';
import type { ProgressionData } from '../progression/types';

export interface Names {
  item: (id: string) => string;
  itemShort: (id: string) => string;
  trader: (id: string | null) => string;
  station: (id: string) => string;
  questItem: (id: string) => string;
  task: (id: string) => string;
  map: (id: string) => string;
  /** A log location token ("bigmap") as a map name, or the token itself. */
  logLocation: (token: string | null) => string;
}

export function makeNames(data: ProgressionData | null, tasks: TarkovTask[], unknown: string): Names {
  const taskNames = new Map(tasks.map((t) => [t.id, t.name]));
  const mapNames = new Map<string, string>(Object.entries(SUPPORTED_MAP_NAMES));
  for (const t of tasks) {
    if (t.map?.id && t.map.name && !mapNames.has(t.map.id)) mapNames.set(t.map.id, t.map.name);
  }
  const map = (id: string) => mapNames.get(id) ?? unknown;
  return {
    item: (id) => data?.names.items[id]?.name ?? unknown,
    itemShort: (id) => data?.names.items[id]?.short ?? data?.names.items[id]?.name ?? unknown,
    trader: (id) => (id ? data?.names.traders[id] ?? unknown : unknown),
    station: (id) => data?.names.stations[id] ?? unknown,
    questItem: (id) => data?.names.questItems[id] ?? unknown,
    task: (id) => taskNames.get(id) ?? unknown,
    map,
    logLocation: (token) => {
      if (!token) return unknown;
      const id = mapIdFromLogLocation(token);
      return id ? map(id) : token;
    },
  };
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function formatSeconds(s: number): string {
  return formatDuration(s * 1000);
}
