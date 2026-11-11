// Price estimates from the prices snapshot. Every number here is an ESTIMATE
// frozen at ProgressionData.pricesAt: flea prices move by the minute, flea fees
// and trader loyalty are not modelled, and the UI says so next to each figure.
import type { Craft, ItemPrice } from './types';

/** Flea reference price: the 24h average, else the last low offer. */
export function fleaPrice(p: ItemPrice | undefined): number | null {
  if (!p || p.noFlea) return null;
  return p.avg24h ?? p.lastLow ?? null;
}

/** Cheapest known way to buy one: flea or a trader offer. */
export function unitBuyCost(p: ItemPrice | undefined): number | null {
  const options = [fleaPrice(p), p?.buyPrice ?? null].filter((v): v is number => v !== null);
  return options.length ? Math.min(...options) : null;
}

/** Best known way to sell one: flea or a trader buy-back. */
export function unitSellValue(p: ItemPrice | undefined): number | null {
  const options = [fleaPrice(p), p?.sellPrice ?? null].filter((v): v is number => v !== null);
  return options.length ? Math.max(...options) : null;
}

export interface CraftEstimate {
  craft: Craft;
  /** null when any consumed input has no known price. */
  cost: number | null;
  value: number | null;
  profit: number | null;
  profitPerHour: number | null;
  missingPrices: string[];
}

export function estimateCraft(craft: Craft, prices: Record<string, ItemPrice>): CraftEstimate {
  const missing: string[] = [];
  let cost = 0;
  for (const input of craft.inputs) {
    if (input.tool) continue; // tools are returned when the craft finishes
    const unit = unitBuyCost(prices[input.itemId]);
    if (unit === null) missing.push(input.itemId);
    else cost += unit * input.count;
  }
  const unitValue = unitSellValue(prices[craft.output.itemId]);
  if (unitValue === null) missing.push(craft.output.itemId);
  const value = unitValue === null ? null : unitValue * craft.output.count;
  const known = missing.length === 0 && value !== null;
  const profit = known ? value - cost : null;
  const hours = craft.duration / 3600;
  return {
    craft,
    cost: missing.some((id) => id !== craft.output.itemId) ? null : cost,
    value,
    profit,
    profitPerHour: profit !== null && hours > 0 ? profit / hours : null,
    missingPrices: missing,
  };
}

/** Price per inventory slot of the best sale — the usual "is it worth carrying" number. */
export function valuePerSlot(p: ItemPrice | undefined): number | null {
  const v = unitSellValue(p);
  if (v === null || !p) return null;
  return Math.round(v / Math.max(1, p.width * p.height));
}

const rub = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function formatRub(v: number | null): string {
  return v === null ? '—' : `₽${rub.format(Math.round(v))}`;
}
