import type { ScanResult } from '../prices/scan';

/** Items read from an inventory screenshot, for the market tab's price list: ids (several when the name is shared) and how many cells. */
export type ScannedItems = { ids: string[]; count: number }[];

export function scannedItems(r: ScanResult): ScannedItems | null {
  if (!r) return null;
  return r.mode === 'inventory' ? r.items : r.items.map((i) => ({ ids: i.ids, count: 1 }));
}
