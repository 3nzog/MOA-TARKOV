import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE_PREFS, parseRoutePrefs } from './routePrefs';
import { hideoutNeedIds } from './routeData';
import type { ItemNeed } from '../progression/needs';

describe('parseRoutePrefs', () => {
  it('reads what the older version saved (on and party only) with the new defaults', () => {
    expect(parseRoutePrefs(JSON.stringify({ on: true, party: false }))).toEqual({ ...DEFAULT_ROUTE_PREFS, on: true, party: false });
  });

  it('keeps valid choices and drops broken ones', () => {
    const p = parseRoutePrefs(JSON.stringify({ goal: 'weapons', style: 'stealth', weaponKinds: ['ammo', 'nonsense'], heat: true, preferCar: true }));
    expect(p).toMatchObject({ goal: 'weapons', style: 'stealth', weaponKinds: ['ammo'], heat: true, preferCar: true });
    expect(parseRoutePrefs(JSON.stringify({ goal: 'nope', style: 'fast', weaponKinds: [] }))).toMatchObject({
      goal: 'quests',
      style: 'direct',
      weaponKinds: ['guns', 'ammo', 'parts'],
    });
    expect(parseRoutePrefs('{broken')).toEqual(DEFAULT_ROUTE_PREFS);
    expect(parseRoutePrefs(null)).toEqual(DEFAULT_ROUTE_PREFS);
  });
});

describe('hideoutNeedIds', () => {
  const need = (key: string, itemId: string | null, sources: ItemNeed['sources'], extra: Partial<ItemNeed> = {}): ItemNeed => ({
    key,
    itemId,
    alternatives: [],
    count: 2,
    fir: false,
    currency: false,
    sources,
    ...extra,
  });
  const hideout = [{ kind: 'hideout' as const, stationId: 's', level: 2, count: 2 }];
  const quest = [{ kind: 'quest' as const, taskId: 't', objectiveId: 'o', count: 2 }];

  it('keeps hideout items still missing, any of a group, and leaves out quest-only items, money and what is collected', () => {
    const ids = hideoutNeedIds(
      [
        need('bolts:any', 'bolts', hideout),
        need('wires:any', 'wires', hideout),
        need('obj:x', null, hideout, { alternatives: ['gpu', 'cpu'] }),
        need('salewa:any', 'salewa', quest),
        need('rub:any', 'roubles', hideout, { currency: true }),
      ],
      { 'wires:any': 2 },
    );
    expect([...ids].sort()).toEqual(['bolts', 'cpu', 'gpu']);
  });
});
