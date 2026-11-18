import { describe, expect, it } from 'vitest';
import type { ItemNeed } from './needs';
import { countInventory } from './inventoryCount';

const need = (key: string, itemId: string, count: number, fir: boolean, extra: Partial<ItemNeed> = {}): ItemNeed => ({
  key,
  itemId,
  alternatives: [],
  count,
  fir,
  currency: false,
  sources: [],
  ...extra,
});

describe('an inventory screenshot counts toward the needs', () => {
  it('fills a counter up to what was seen, never past what is needed', () => {
    const r = countInventory([need('bolts:fir', 'bolts', 2, true)], [{ ids: ['bolts'], count: 5 }], {});
    expect(r.updates).toEqual({ 'bolts:fir': 2 });
    expect(r.lines).toEqual([{ key: 'bolts:fir', itemId: 'bolts', have: 2, need: 2 }]);
  });

  it('never lowers what was counted before (the rest of the stash is out of the picture)', () => {
    const r = countInventory([need('bolts:any', 'bolts', 4, false)], [{ ids: ['bolts'], count: 1 }], { 'bolts:any': 3 });
    expect(r.updates).toEqual({});
  });

  it('counts one item once: found-in-raid needs first, the rest after', () => {
    const r = countInventory(
      [need('tool:any', 'tool', 2, false), need('tool:fir', 'tool', 2, true)],
      [{ ids: ['tool'], count: 3 }],
      {},
    );
    expect(r.updates).toEqual({ 'tool:fir': 2, 'tool:any': 1 });
  });

  it('an "any of these" need takes any of its items; money is never counted', () => {
    const r = countInventory(
      [
        need('obj:x', 'ignored', 2, false, { itemId: null, alternatives: ['a', 'b'] }),
        need('rub:any', 'rub', 1000, false, { currency: true }),
      ],
      [
        { ids: ['b'], count: 1 },
        { ids: ['rub'], count: 1 },
        { ids: ['a', 'zz'], count: 1 },
      ],
      {},
    );
    expect(r.updates).toEqual({ 'obj:x': 2 });
  });
});
