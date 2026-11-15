import { describe, expect, it } from 'vitest';
import { parseSquadSnapshot } from './squadSnapshot';
import { normalizeProgress } from '../state/localProgress';
import { normalizeCustomPois } from '../poi/customPoi';

describe('state a linked game PC sends', () => {
  it('a party snapshot keeps members, positions and markers; junk is dropped', () => {
    const r = parseSquadSnapshot({
      code: 'ABCD2345',
      selfId: 'me',
      members: [{ id: 'me', name: 'Eu', colorId: 'red' }, { id: 'f1', name: 'Amigo', colorId: 'cyan' }, 'junk', null],
      positions: { f1: { mapId: 'm', x: 1, z: 2 } },
      markers: { f1: [{ id: 'k', x: 1, z: 1 }] },
      draws: [],
    });
    expect(r?.snap?.members.map((m) => m.id)).toEqual(['me', 'f1']);
    expect(r?.snap?.selfId).toBe('me');
    expect(r?.snap?.status).toBe('connected');
    expect(Object.keys(r?.snap?.positions ?? {})).toEqual(['f1']);
    expect(r?.snap?.draws).toEqual({});
  });

  it('null means the game PC left its party; anything else unknown is ignored', () => {
    expect(parseSquadSnapshot(null)).toEqual({ snap: null });
    expect(parseSquadSnapshot('x')).toBeNull();
    expect(parseSquadSnapshot({ members: 'no' })).toBeNull();
  });

  it('progress and markers are normalized like saved ones', () => {
    const p = normalizeProgress({ completedQuestIds: ['a'], playerLevel: 42, faction: 'BEAR', junk: 1 });
    expect(p.completedQuestIds).toEqual(['a']);
    expect(p.playerLevel).toBe(42);
    expect(p.faction).toBe('BEAR');
    expect(normalizeProgress('nope').playerLevel).toBe(1);
    const markers = normalizeCustomPois([
      { id: 'u1', category: 'custom', mapId: 'm', position: { x: 1, y: 0, z: 2 }, label: 'Aqui', source: 'user' },
      { id: 'x', category: 'loot' },
      'junk',
    ]);
    expect(markers.map((m) => m.id)).toEqual(['u1']);
    expect(normalizeCustomPois({})).toEqual([]);
  });
});
