import { describe, expect, it } from 'vitest';
import type { TaskObjective } from '../api/types';
import { parsePhoneLayers, slimObjective } from './phoneLayers';

describe('phone layers', () => {
  it("a quest pin keeps only this map's places, and nothing of the quest the map does not draw", () => {
    const objective = {
      id: 'o1',
      description: 'Find the thing',
      type: 'visit',
      zones: [
        { id: 'z1', map: { id: 'customs' }, position: { x: 1, y: 2, z: 3 } },
        { id: 'z2', map: { id: 'woods' }, position: { x: 9, y: 9, z: 9 } },
      ],
      possibleLocations: [{ map: { id: 'woods' }, positions: [{ x: 5, y: 5, z: 5 }] }],
    } as unknown as TaskObjective;
    const task = { id: 't1', name: 'Quest', wikiLink: 'https://wiki', trader: { name: 'Prapor' } };
    const pin = slimObjective(task, objective, 'customs');
    expect(pin.task).toEqual({ id: 't1', name: 'Quest' });
    expect(pin.objective.zones).toHaveLength(1);
    expect(pin.objective.possibleLocations).toHaveLength(0);
    expect(JSON.stringify(pin)).not.toContain('wiki');
  });

  it('reads a layers frame and drops what is not a marker', () => {
    const l = parsePhoneLayers(
      JSON.stringify({
        layers: {
          mapId: 'customs',
          pois: [{ id: 'e1', category: 'extract', position: { x: 1, y: 0, z: 2 }, label: 'Exit' }, { id: 'bad' }],
          dimmed: ['e1', 3],
          placeLabels: true,
          squad: { selfId: 'me', members: [] },
        },
      }),
    );
    expect(l?.pois.map((p) => p.id)).toEqual(['e1']);
    expect(l?.dimmed).toEqual(['e1']);
    expect(l?.placeLabels).toBe(true);
    expect(l?.grid).toBe(false);
    expect(l?.squad?.markers).toEqual({});
    expect(l?.heat).toBeNull();
  });

  it('is not fooled by other frames', () => {
    expect(parsePhoneLayers('{"points":[]}')).toBeNull();
    expect(parsePhoneLayers('{"layers":{"pois":[]}}')).toBeNull();
    expect(parsePhoneLayers('{"layers":')).toBeNull();
  });
});
