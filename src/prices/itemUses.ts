// What an item on a price screenshot is still good for, besides its price:
// the quests and hideout upgrades that still ask for it (what is left after
// what was already counted — the same numbers as Planner → Items) and the
// hideout crafts that use it (the ones your stations can run first).
import type { ItemNeed } from '../progression/needs';
import type { Craft } from '../progression/types';

export type ItemUse =
  | { kind: 'quest'; taskId: string; count: number; fir: boolean }
  | { kind: 'hideout'; stationId: string; level: number; count: number; fir: boolean }
  | { kind: 'craft'; stationId: string; level: number; outputId: string; count: number; ready: boolean };

/**
 * Uses by item id. `collected` is Planner → Items' counter (per need key): a
 * need already covered is left out. `stationLevels` puts the crafts you can
 * run now before the others.
 */
export function buildItemUses(
  needs: ItemNeed[],
  crafts: Craft[],
  collected: Record<string, number>,
  stationLevels: Record<string, number>,
): Map<string, ItemUse[]> {
  const out = new Map<string, ItemUse[]>();
  const push = (id: string, u: ItemUse) => {
    const list = out.get(id);
    if (list) list.push(u);
    else out.set(id, [u]);
  };
  for (const n of needs) {
    if (n.currency) continue;
    if (n.count - (collected[n.key] ?? 0) <= 0) continue;
    const ids = n.itemId ? [n.itemId] : n.alternatives;
    for (const id of ids) {
      for (const s of n.sources) {
        if (s.kind === 'quest') push(id, { kind: 'quest', taskId: s.taskId, count: s.count, fir: n.fir });
        else push(id, { kind: 'hideout', stationId: s.stationId, level: s.level, count: s.count, fir: n.fir });
      }
    }
  }
  for (const c of crafts) {
    for (const i of c.inputs) {
      if (i.tool) continue;
      push(i.itemId, {
        kind: 'craft',
        stationId: c.stationId,
        level: c.level,
        outputId: c.output.itemId,
        count: i.count,
        ready: (stationLevels[c.stationId] ?? 0) >= c.level,
      });
    }
  }
  // Quests, then hideout, then crafts (the ones you can run now first).
  const rank = (u: ItemUse) => (u.kind === 'quest' ? 0 : u.kind === 'hideout' ? 1 : u.ready ? 2 : 3);
  for (const list of out.values()) list.sort((a, b) => rank(a) - rank(b));
  return out;
}
