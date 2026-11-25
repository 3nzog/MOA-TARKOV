import { describe, expect, it } from 'vitest';
import { buildItemUses } from './itemUses';
import type { ItemNeed } from '../progression/needs';
import type { Craft } from '../progression/types';

const need = (over: Partial<ItemNeed>): ItemNeed => ({ key: 'k', itemId: 'gas', alternatives: [], count: 2, fir: true, currency: false, sources: [], ...over });

describe('what an item on a price card is still good for', () => {
  const needs: ItemNeed[] = [
    need({ key: 'gas:fir', sources: [{ kind: 'quest', taskId: 'q1', objectiveId: 'o1', count: 2 }] }),
    need({ key: 'gas:any', fir: false, count: 1, sources: [{ kind: 'hideout', stationId: 'lav', level: 2, count: 1 }] }),
    need({ key: 'done:fir', itemId: 'done', count: 1, sources: [{ kind: 'quest', taskId: 'q2', objectiveId: 'o2', count: 1 }] }),
    need({ key: 'rub:any', itemId: 'rub', currency: true, count: 1000, sources: [{ kind: 'quest', taskId: 'q3', objectiveId: 'o3', count: 1000 }] }),
  ];
  const crafts: Craft[] = [
    { id: 'c1', stationId: 'wb', level: 3, duration: 60, inputs: [{ itemId: 'gas', count: 1, tool: false }], output: { itemId: 'out1', count: 1 } },
    { id: 'c2', stationId: 'wb', level: 1, duration: 60, inputs: [{ itemId: 'gas', count: 2, tool: false }, { itemId: 'pliers', count: 1, tool: true }], output: { itemId: 'out2', count: 1 } },
  ];
  const uses = buildItemUses(needs, crafts, { 'done:fir': 1 }, { wb: 1 });

  it('lists quests, then hideout, then the crafts your stations can run before the others', () => {
    expect(uses.get('gas')?.map((u) => u.kind + (u.kind === 'craft' ? (u.ready ? ':ready' : ':locked') : ''))).toEqual(['quest', 'hideout', 'craft:ready', 'craft:locked']);
  });

  it('leaves out what is already handed in, money, and tools', () => {
    expect(uses.has('done')).toBe(false);
    expect(uses.has('rub')).toBe(false);
    expect(uses.has('pliers')).toBe(false);
  });
});
