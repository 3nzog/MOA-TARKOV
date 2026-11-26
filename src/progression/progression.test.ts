import { describe, expect, it } from 'vitest';
import type { TarkovTask } from '../api/types';
import { adaptProgression, adaptTaskMeta } from '../api/progression';
import { computeQuestStatuses, requirementTree, suggestNext, type BaseStatus } from './status';
import { aggregateNeeds, stationStatus } from './needs';
import { buildRaidPrep } from './raidPrep';
import { estimateCraft, unitBuyCost, unitSellValue } from './economy';
import type { ItemPrice, Station, TaskMeta } from './types';
import type { Poi } from '../poi/types';
import baseSnapshot from '../../data/snapshot/base.json';
import progressionSnapshot from '../../data/snapshot/progression.json';

const CUSTOMS = '56f40101d2720b2a4d8b45d6';
const WOODS = '5704e3c2d2720bac5b8b4567';

const task = (id: string, objectives: TarkovTask['objectives'] = []): TarkovTask => ({
  id,
  name: id,
  objectives,
});

const meta = (partial: Partial<TaskMeta> = {}): TaskMeta => ({
  minLevel: 0,
  requires: [],
  traderReqs: [],
  faction: null,
  kappa: false,
  lightkeeper: false,
  neededKeys: [],
  xp: null,
  objectives: {},
  ...partial,
});

const statusesOf = (
  tasks: TarkovTask[],
  m: Record<string, TaskMeta>,
  base: Record<string, BaseStatus>,
  profile = { level: null as number | null, faction: null as 'USEC' | 'BEAR' | null },
  manual: string[] = [],
) =>
  computeQuestStatuses({
    tasks,
    meta: m,
    baseStatus: (id) => base[id] ?? 'none',
    isManual: (id) => manual.includes(id),
    profile,
  });

describe('adaptTaskMeta', () => {
  it('reads the compact snapshot shape', () => {
    const m = adaptTaskMeta({
      lvl: 10,
      req: [['a', ['complete']], ['b', ['active', 'bogus']]],
      fac: 'BEAR',
      kappa: true,
      keys: [[CUSTOMS, ['k1']], [null, []]],
      obj: { o1: { type: 'giveItem', count: 3, items: ['i1'], fir: true } },
    });
    expect(m.minLevel).toBe(10);
    expect(m.requires).toEqual([
      { taskId: 'a', status: ['complete'] },
      { taskId: 'b', status: ['active'] },
    ]);
    expect(m.faction).toBe('BEAR');
    expect(m.neededKeys).toEqual([{ mapId: CUSTOMS, keys: ['k1'] }]);
    expect(m.objectives.o1).toMatchObject({ type: 'giveItem', count: 3, items: ['i1'], fir: true, optional: false });
  });

  it('returns null for an empty progression document', () => {
    expect(adaptProgression({ tasks: {} }, null, null, 'bundled')).toBeNull();
    expect(adaptProgression(null, null, null, 'bundled')).toBeNull();
  });
});

describe('computeQuestStatuses', () => {
  const tasks = [task('a'), task('b'), task('c'), task('d')];
  const m = {
    a: meta(),
    b: meta({ requires: [{ taskId: 'a', status: ['complete'] }] }),
    c: meta({ requires: [{ taskId: 'b', status: ['complete'] }], minLevel: 20 }),
    d: meta({ faction: 'USEC' }),
  };

  it('locks a quest behind an unfinished prerequisite and names it', () => {
    const s = statusesOf(tasks, m, {});
    expect(s.get('a')!.status).toBe('available');
    expect(s.get('b')!.status).toBe('locked');
    expect(s.get('b')!.lockReasons).toEqual([{ kind: 'prereq', taskId: 'a', need: ['complete'] }]);
  });

  it('does not gate on level or faction until the player sets them', () => {
    const unknown = statusesOf(tasks, m, { b: 'complete' });
    expect(unknown.get('c')!.status).toBe('available');
    expect(unknown.get('d')!.status).toBe('available');
    const known = statusesOf(tasks, m, { b: 'complete' }, { level: 15, faction: 'BEAR' });
    expect(known.get('c')!.lockReasons).toEqual([{ kind: 'level', need: 20 }]);
    expect(known.get('d')!.lockReasons).toEqual([{ kind: 'faction', need: 'USEC' }]);
  });

  it('infers completed prerequisites from a later accepted quest, flagged', () => {
    const s = statusesOf(tasks, m, { c: 'active', a: 'active' });
    expect(s.get('b')).toMatchObject({ status: 'complete', inferred: true, staleActive: false });
    // 'a' is still "active" in the logs, but c's acceptance proves it is done.
    expect(s.get('a')).toMatchObject({ status: 'complete', inferred: true, staleActive: true });
  });

  it('never infers over a manual override or a recorded failure', () => {
    const s = statusesOf(tasks, m, { c: 'active', b: 'none', a: 'failed' }, undefined, ['b']);
    expect(s.get('b')!.status).not.toBe('complete');
    expect(s.get('a')!.status).toBe('failed');
  });

  it('suggests available quests that unlock the most', () => {
    const s = statusesOf(tasks, m, {});
    expect(suggestNext(s, m)[0]).toMatchObject({ taskId: 'a', downstream: 2 });
  });

  it('builds a de-duplicated prerequisite tree', () => {
    const diamond = {
      top: meta({ requires: [{ taskId: 'l', status: ['complete'] }, { taskId: 'r', status: ['complete'] }] }),
      l: meta({ requires: [{ taskId: 'root', status: ['complete'] }] }),
      r: meta({ requires: [{ taskId: 'root', status: ['complete'] }] }),
      root: meta(),
    };
    const tree = requirementTree('top', diamond);
    expect(tree.map((n) => n.taskId)).toEqual(['l', 'r']);
    expect(tree[0].children[0]).toMatchObject({ taskId: 'root', repeated: false });
    expect(tree[1].children[0]).toMatchObject({ taskId: 'root', repeated: true, children: [] });
  });
});

describe('aggregateNeeds', () => {
  const tasks = [
    task('q1', [
      { id: 'find', type: 'findItem' },
      { id: 'give', type: 'giveItem', description: 'Hand over 2 salewa' },
      { id: 'any', type: 'giveItem', description: 'Hand over 3 food' },
    ]),
    task('q2', [{ id: 'give2', type: 'giveItem' }]),
  ];
  const m = {
    q1: meta({
      objectives: {
        find: { type: 'findItem', items: ['salewa'], count: 2, fir: true, keys: [], optional: false },
        give: { type: 'giveItem', items: ['salewa'], count: 2, fir: true, keys: [], optional: false },
        any: { type: 'giveItem', items: ['tushonka', 'crackers'], count: 3, fir: false, keys: [], optional: false },
      },
    }),
    q2: meta({
      objectives: { give2: { type: 'giveItem', items: ['salewa'], count: 1, fir: true, keys: [], optional: false } },
    }),
  };
  const stations: Station[] = [
    {
      id: 'med',
      levels: [
        { level: 1, time: 0, items: [{ itemId: 'salewa', count: 1, fir: true }], stations: [], traders: [], skills: [] },
        { level: 2, time: 0, items: [{ itemId: 'rub', count: 5000, fir: false }], stations: [{ stationId: 'gen', level: 1 }], traders: [], skills: [] },
      ],
    },
  ];

  const run = (overrides: Partial<Parameters<typeof aggregateNeeds>[0]> = {}) =>
    aggregateNeeds({
      tasks,
      meta: m,
      statuses: statusesOf(tasks, m, { q1: 'active' }),
      scope: 'available',
      checkedObjectives: new Set(),
      includeHideout: false,
      stations,
      stationLevels: {},
      ...overrides,
    });

  it('counts hand-overs only (not the paired findItem) and merges per item + FIR', () => {
    const needs = run();
    const salewa = needs.find((n) => n.key === 'salewa:fir')!;
    expect(salewa.count).toBe(3); // 2 (q1) + 1 (q2), not 5
    expect(salewa.sources).toHaveLength(2);
    const any = needs.find((n) => n.key === 'obj:any')!;
    expect(any).toMatchObject({ itemId: null, alternatives: ['tushonka', 'crackers'], count: 3 });
  });

  it('respects scope and ticked objectives', () => {
    expect(run({ scope: 'active' }).find((n) => n.key === 'salewa:fir')!.count).toBe(2);
    expect(run({ checkedObjectives: new Set(['give']) }).find((n) => n.key === 'salewa:fir')!.count).toBe(1);
  });

  it('adds hideout levels above the built one', () => {
    expect(run({ includeHideout: true }).find((n) => n.key === 'salewa:fir')!.count).toBe(4);
    expect(run({ includeHideout: true, stationLevels: { med: 1 } }).find((n) => n.key === 'salewa:fir')!.count).toBe(3);
  });

  it("counts a quest BEAR and USEC each have a copy of once (your side's, or one when the side is unknown)", () => {
    const give = (id: string) => ({ [id]: { type: 'giveItem' as const, items: ['paracord'], count: 3, fir: true, keys: [], optional: false } });
    const twins = [
      { id: 'tb', name: 'Textile - Part 1', objectives: [{ id: 'gb', type: 'giveItem' }] },
      { id: 'tu', name: 'Textile - Part 1', objectives: [{ id: 'gu', type: 'giveItem' }] },
    ] as TarkovTask[];
    const tm = { tb: meta({ faction: 'BEAR', objectives: give('gb') }), tu: meta({ faction: 'USEC', objectives: give('gu') }) };
    const count = (faction: 'USEC' | 'BEAR' | null) =>
      aggregateNeeds({
        tasks: twins,
        meta: tm,
        statuses: statusesOf(twins, tm, {}, { level: null, faction }),
        scope: 'all',
        checkedObjectives: new Set(),
        includeHideout: false,
        stations: [],
        stationLevels: {},
      }).find((n) => n.key === 'paracord:fir');
    expect(count(null)).toMatchObject({ count: 3 });
    expect(count('BEAR')?.sources).toEqual([expect.objectContaining({ taskId: 'tb' })]);
    expect(count('USEC')?.sources).toEqual([expect.objectContaining({ taskId: 'tu' })]);
  });

  it('reports a station blocked by another station level', () => {
    expect(stationStatus(stations[0], { med: 1 })).toMatchObject({
      built: 1,
      max: 2,
      blockedBy: [{ stationId: 'gen', level: 1 }],
    });
  });
});

describe('buildRaidPrep', () => {
  const tasks = [
    task('q', [
      { id: 'plant', type: 'plantItem', maps: [{ id: CUSTOMS, name: 'Customs' }] },
      { id: 'mark', type: 'mark', maps: [{ id: WOODS, name: 'Woods' }] },
      { id: 'pick', type: 'findQuestItem', maps: [{ id: CUSTOMS, name: 'Customs' }] },
    ]),
  ];
  const m = {
    q: meta({
      neededKeys: [
        { mapId: CUSTOMS, keys: ['dorm-314'] },
        { mapId: WOODS, keys: ['woods-key'] },
      ],
      objectives: {
        plant: { type: 'plantItem', items: ['wifi-cam'], count: 2, fir: false, keys: [['marked-a', 'marked-b']], optional: false },
        mark: { type: 'mark', items: [], marker: 'ms2000', count: 1, fir: false, keys: [], optional: false },
        pick: { type: 'findQuestItem', items: [], questItem: 'docs', fir: false, keys: [], optional: false },
      },
    }),
  };
  const pois: Poi[] = [
    { id: 'extract:1', category: 'extract', mapId: CUSTOMS, position: { x: 0, y: 0, z: 0 }, label: 'ZB-1011', note: 'needs switch', source: 'tarkov-dev', meta: { requiresSwitch: true, faction: 'pmc' } },
    { id: 'extract:2', category: 'extract', mapId: CUSTOMS, position: { x: 0, y: 0, z: 0 }, label: 'Crossroads', source: 'tarkov-dev', meta: {} },
  ];

  it('lists keys, carry items, pickups and gated extracts for this map only', () => {
    const prep = buildRaidPrep({ mapId: CUSTOMS, tasks, meta: m, checkedObjectives: new Set(), pois });
    expect(prep.keys.map((k) => k.itemIds)).toEqual([['dorm-314'], ['marked-a', 'marked-b']]);
    expect(prep.carry).toEqual([{ itemId: 'wifi-cam', count: 2, kind: 'plant', taskId: 'q', objectiveId: 'plant' }]);
    expect(prep.pickups).toEqual([{ questItemId: 'docs', taskId: 'q', objectiveId: 'pick' }]);
    expect(prep.extracts.map((e) => e.label)).toEqual(['ZB-1011']);
  });

  it('drops objectives the player ticked off', () => {
    const prep = buildRaidPrep({ mapId: CUSTOMS, tasks, meta: m, checkedObjectives: new Set(['plant']), pois: [] });
    expect(prep.carry).toEqual([]);
    expect(prep.keys.map((k) => k.itemIds)).toEqual([['dorm-314']]);
  });

  it("with the route's objectives only, leaves out what the other objectives need", () => {
    const onlyPick = buildRaidPrep({ mapId: CUSTOMS, tasks, meta: m, checkedObjectives: new Set(), pois: [], onlyObjectives: new Set(['pick']) });
    expect(onlyPick.carry).toEqual([]);
    expect(onlyPick.pickups.map((p) => p.objectiveId)).toEqual(['pick']);
    const nothing = buildRaidPrep({ mapId: CUSTOMS, tasks, meta: m, checkedObjectives: new Set(), pois: [], onlyObjectives: new Set(['not-on-this-map']) });
    expect(nothing.keys).toEqual([]);
    expect(nothing.carry).toEqual([]);
    expect(nothing.pickups).toEqual([]);
  });
});

describe('economy', () => {
  const price = (p: Partial<ItemPrice>): ItemPrice => ({
    base: null, avg24h: null, lastLow: null, sellTraderId: null, sellPrice: null,
    buyTraderId: null, buyPrice: null, buyLevel: null, width: 1, height: 1, noFlea: false, ...p,
  });
  const prices = {
    a: price({ avg24h: 100, buyPrice: 80 }),
    b: price({ avg24h: 50, noFlea: true, buyPrice: 60 }),
    out: price({ avg24h: 1000, sellPrice: 700 }),
  };

  it('takes the cheaper buy and the better sale, ignoring flea when banned', () => {
    expect(unitBuyCost(prices.a)).toBe(80);
    expect(unitBuyCost(prices.b)).toBe(60);
    expect(unitSellValue(prices.out)).toBe(1000);
  });

  it('estimates craft profit, excluding tools, and refuses to guess missing prices', () => {
    const est = estimateCraft(
      {
        id: 'c', stationId: 's', level: 1, duration: 7200,
        inputs: [{ itemId: 'a', count: 2, tool: false }, { itemId: 'b', count: 1, tool: true }],
        output: { itemId: 'out', count: 1 },
      },
      prices,
    );
    expect(est).toMatchObject({ cost: 160, value: 1000, profit: 840, profitPerHour: 420 });
    const missing = estimateCraft(
      { id: 'c', stationId: 's', level: 1, duration: 60, inputs: [{ itemId: 'zzz', count: 1, tool: false }], output: { itemId: 'out', count: 1 } },
      prices,
    );
    expect(missing.profit).toBeNull();
    expect(missing.missingPrices).toEqual(['zzz']);
  });
});

describe('committed snapshot', () => {
  it('covers every quest of the quest snapshot', () => {
    const data = adaptProgression(progressionSnapshot as never, null, null, 'bundled');
    expect(data).not.toBeNull();
    const questIds = Object.keys((baseSnapshot as { tasks: Record<string, unknown> }).tasks);
    const missing = questIds.filter((id) => !data!.tasks[id]);
    // A handful may lag a day behind each other; a mismatch beyond that means
    // the two scripts are reading different upstreams.
    expect(missing.length).toBeLessThan(questIds.length * 0.05);
    expect(data!.stations.length).toBeGreaterThan(10);
    expect(data!.crafts.length).toBeGreaterThan(50);
  });
});

describe('inferFaction', () => {
  const tasks = [task('bear'), task('usec'), task('both')];
  const m = { bear: meta({ faction: 'BEAR' }), usec: meta({ faction: 'USEC' }), both: meta() };
  it('tells your side from the side-only quests you took, and does not guess on a mix', async () => {
    const { inferFaction } = await import('./status');
    expect(inferFaction(tasks, m, (id) => (id === 'bear' ? 'complete' : 'none'))).toBe('BEAR');
    expect(inferFaction(tasks, m, (id) => (id === 'both' ? 'active' : 'none'))).toBeNull();
    expect(inferFaction(tasks, m, (id) => (id === 'both' ? 'none' : 'active'))).toBeNull();
  });
});
