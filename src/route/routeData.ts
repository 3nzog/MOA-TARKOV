// What the route needs beyond the map's POIs, loaded once and only when the
// route is turned on: where the loot is, item prices, and the map's place
// names. All bundled snapshots (data/snapshot), so it works offline.
import type { ItemNeed } from '../progression/needs';
import { loadLootSnapshot, type LootSnapshot } from './lootData';
import type { ItemPrice, PlaceLabel } from './targets';

export interface RouteData {
  loot: LootSnapshot | null;
  prices: Record<string, ItemPrice>;
  /** Place names by map id. */
  labels: Record<string, PlaceLabel[]>;
}

let loading: Promise<RouteData> | null = null;

export function loadRouteData(): Promise<RouteData> {
  loading ??= Promise.all([
    loadLootSnapshot(),
    import('../../data/snapshot/prices.json')
      .then((m) => (m.default as unknown as { items: Record<string, ItemPrice> }).items ?? {})
      .catch(() => ({})),
    import('../../data/snapshot/map-labels.json')
      .then((m) => m.default as unknown as Record<string, PlaceLabel[]>)
      .catch(() => ({})),
  ]).then(([loot, prices, labels]) => ({ loot, prices, labels }));
  return loading;
}

/**
 * The item ids the hideout still needs: hideout needs (not money) not yet
 * collected, any of an "any of these" group counting.
 */
export function hideoutNeedIds(needs: ItemNeed[], collected: Record<string, number>): Set<string> {
  const out = new Set<string>();
  for (const n of needs) {
    if (n.currency || !n.sources.some((s) => s.kind === 'hideout')) continue;
    if ((collected[n.key] ?? 0) >= n.count) continue;
    if (n.itemId) out.add(n.itemId);
    for (const id of n.alternatives) out.add(id);
  }
  return out;
}
