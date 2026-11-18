// An inventory screenshot counts toward what quests and the hideout still
// need: the items seen in it fill the "set aside" counters of the needs list.
//
// - One picture shows only part of a stash, so a count only ever goes UP to
//   what was seen (never down: what scrolled out of the picture is still
//   there), and never past what is needed.
// - One item is counted once: a toolset seen twice is not two for the quest
//   AND two for the hideout. Found-in-raid needs are filled first (the
//   picture cannot tell found-in-raid apart, and those are the scarce ones).
import type { ItemNeed } from './needs';

/** Items read from the picture: candidate ids (a shared short name has several) and how many cells. */
export type SeenItems = { ids: string[]; count: number }[];

export interface CountLine {
  key: string;
  itemId: string | null;
  have: number;
  need: number;
}

export function countInventory(
  needs: ItemNeed[],
  seen: SeenItems,
  collected: Record<string, number>,
): { updates: Record<string, number>; lines: CountLine[] } {
  const left = seen.map((s) => s.count);
  const updates: Record<string, number> = {};
  const lines: CountLine[] = [];
  const order = needs.filter((n) => !n.currency).sort((a, b) => Number(b.fir) - Number(a.fir));
  for (const n of order) {
    const accepted = new Set(n.itemId ? [n.itemId] : n.alternatives);
    let got = 0;
    seen.forEach((s, i) => {
      if (got >= n.count || left[i] <= 0 || !s.ids.some((id) => accepted.has(id))) return;
      const take = Math.min(left[i], n.count - got);
      left[i] -= take;
      got += take;
    });
    const before = collected[n.key] ?? 0;
    if (got > before) {
      updates[n.key] = got;
      lines.push({ key: n.key, itemId: n.itemId, have: got, need: n.count });
    }
  }
  return { updates, lines };
}
