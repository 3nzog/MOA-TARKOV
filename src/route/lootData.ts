// Where the loot is on each map: data/snapshot/loot.json, written by
// scripts/fetch-loot.mjs from tarkov.dev. Loaded lazily, only when a loot
// route is asked for.
//
//   loose spots   a position and the items that CAN spawn there (the game
//                 picks one or none; the chance of each is not published)
//   containers    a position and the container's kind (safe, pc-block, …)
import { canonicalMapId } from '../map/canonicalMap';

/** The file as written (compact: index tables, positions in game metres). */
export interface LootSnapshot {
  generatedAt?: string;
  /** Container kinds (tarkov.dev normalizedName: "safe", "pc-block", …). */
  types: string[];
  /** Item ids the loose spots refer to by index. */
  items: string[];
  /** One letter per item: g = gun, m = weapon part, a = ammo, o = other. */
  kinds: string;
  maps: Record<string, { n: string; l: [number, number, number, number[]][]; c: [number, number, number, number][] }>;
}

export interface LooseSpot {
  x: number;
  z: number;
  y: number;
  /** Item ids that can spawn here. */
  items: string[];
}

export interface ContainerSpot {
  x: number;
  z: number;
  y: number;
  /** "safe", "pc-block", "toolbox", "weapon-box", … */
  kind: string;
}

export interface MapLoot {
  loose: LooseSpot[];
  containers: ContainerSpot[];
}

let loading: Promise<LootSnapshot | null> | null = null;

/** The bundled loot snapshot (null if it could not be loaded). */
export function loadLootSnapshot(): Promise<LootSnapshot | null> {
  loading ??= import('../../data/snapshot/loot.json')
    .then((m) => m.default as unknown as LootSnapshot)
    .catch(() => {
      loading = null;
      return null;
    });
  return loading;
}

/** This map's loot: its own entry, else the one of the map it is a variant of. */
export function lootForMap(snap: LootSnapshot, mapId: string): MapLoot {
  const raw = snap.maps[mapId] ?? snap.maps[canonicalMapId(mapId)];
  if (!raw) return { loose: [], containers: [] };
  return {
    loose: raw.l.map(([x, z, y, idx]) => ({ x, z, y, items: idx.map((i) => snap.items[i]).filter(Boolean) })),
    containers: raw.c.map(([x, z, y, t]) => ({ x, z, y, kind: snap.types[t] ?? 'other' })),
  };
}

/** What an item is, for the weapons goal (from the snapshot's kinds). */
export function itemKinds(snap: LootSnapshot): Map<string, 'g' | 'm' | 'a' | 'o'> {
  const out = new Map<string, 'g' | 'm' | 'a' | 'o'>();
  snap.items.forEach((id, i) => {
    const k = snap.kinds[i];
    out.set(id, k === 'g' || k === 'm' || k === 'a' ? k : 'o');
  });
  return out;
}
