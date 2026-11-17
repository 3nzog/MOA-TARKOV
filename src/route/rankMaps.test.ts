import { describe, expect, it } from 'vitest';
import type { TarkovTask, TaskObjective } from '../api/types';
import type { DerivedQuestState } from '../quests/derive';
import type { Poi } from '../poi/types';
import { spreadPoints, stopsForMap } from './rankMaps';

describe('spreadPoints', () => {
  it('takes points far apart, first one first, all of them when few', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 100, z: 0 },
      { x: 50, z: 50 },
      { x: 2, z: 1 },
    ];
    expect(spreadPoints(pts, 2)).toEqual([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
    expect(spreadPoints(pts, 3)).toContainEqual({ x: 50, z: 50 });
    expect(spreadPoints(pts.slice(0, 2), 4)).toHaveLength(2);
  });
});

describe('stopsForMap', () => {
  const MAP = '56f40101d2720b2a4d8b45d6';
  const objective = (id: string, x: number): TaskObjective =>
    ({ id, type: 'visit', zones: [{ id: `z${id}`, map: { id: MAP, name: 'Customs' }, position: { x, y: 0, z: 0 } }] }) as TaskObjective;
  const task: TarkovTask = { id: 't', name: 'T', objectives: [objective('a', 0), objective('b', 300)] };
  const state = (objs: TaskObjective[]) => ({ availableObjectivesByMap: { [MAP]: objs.map((o) => ({ task, objective: o })) } }) as unknown as DerivedQuestState;
  const me = { id: 'me', name: 'Eu', color: '#fff' };
  const mate = { id: 'mate', name: 'Amigo', color: '#f00' };

  it('quests: everyone\'s objectives on the map, shared ones once with both', () => {
    const stops = stopsForMap('quests', MAP, [], [{ who: me, state: state([objective('a', 0)]) }, { who: mate, state: state([objective('a', 0), objective('b', 300)]) }], null, undefined, ['guns']);
    expect(stops).toHaveLength(2);
    expect(stops.find((s) => s.id === 'a')?.who.map((w) => w.id)).toEqual(['me', 'mate']);
  });

  it('loot goals need the loot data; Scavs need the map\'s bot spawns', () => {
    expect(stopsForMap('money', MAP, [], [{ who: me, state: null }], null, undefined, ['guns'])).toEqual([]);
    const bot = (id: string, x: number): Poi => ({ id, category: 'spawn', subtype: 'scav', mapId: MAP, position: { x, y: 0, z: 0 }, label: id, source: 'tarkov-dev', meta: { categories: ['bot'] } });
    expect(stopsForMap('scavs', MAP, [bot('s1', 0), bot('s2', 10)], [{ who: me, state: null }], null, undefined, ['guns'])).toHaveLength(1);
  });
});
