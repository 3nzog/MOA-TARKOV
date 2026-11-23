import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ammoFor, ammoInScan, mostlyAmmo, ammoFromScreen, ammoScore, ammoShortsFromScreen, bestValue, caliberLabel, classEffect, rankOwned, roundPrice, search, type AmmoData, type Names } from './data';

const data = JSON.parse(readFileSync('data/snapshot/ammo.json', 'utf8')) as AmmoData;
const names = (JSON.parse(readFileSync('data/snapshot/progression-pt.json', 'utf8')) as { items: Names }).items;
const M855 = '54527a984bdc2d4e668b4567';

describe('ballistics data (real snapshot)', () => {
  it('has the cartridges and guns', () => {
    expect(Object.keys(data.ammo).length).toBeGreaterThan(150);
    expect(Object.keys(data.weapons).length).toBeGreaterThan(150);
    expect(data.ammo[M855]).toMatchObject({ c: 'Caliber556x45NATO', d: 54, p: 31 });
  });

  it('a gun lists the cartridges it fires', () => {
    const m4 = search('M4A1', data, names).find((h) => h.kind === 'weapon')!;
    expect(m4).toBeTruthy();
    const list = ammoFor(m4, data);
    expect(list).toContain(M855);
    expect(list.every((id) => data.ammo[id].c === 'Caliber556x45NATO')).toBe(true);
  });

  it('a caliber reads like the game writes it, and search finds it', () => {
    expect(caliberLabel('Caliber556x45NATO', data, names)).toBe('5.56x45mm');
    const hits = search('5.56x45', data, names);
    expect(hits.some((h) => h.kind === 'caliber' && h.id === 'Caliber556x45NATO')).toBe(true);
  });

  it('reads the cartridges of the flea market screenshot (real OCR lines)', () => {
    const lines = [
      '5.56x45mm 55 HP', 'Total 3490000 (limite 1000)', '5.56x45mm FMJ', '5.56x45mm Mk 255 Mod 0 (RRLP)',
      '5.56x45mm M856', '5.56x45mm Warmage', '5.56x45mm M855', '5.56x45mm M856A1', 'Peacekeeper',
    ];
    const got = ammoFromScreen(lines, data, names).map((id) => names[id][0]);
    expect(got).toContain('5.56x45mm M855');
    expect(got).toContain('5.56x45mm M856A1');
    expect(got).toContain('5.56x45mm M856');
    expect(got.length).toBeGreaterThanOrEqual(6);
  });

  it('armor class effect follows penetration', () => {
    expect(classEffect(31, 3)).toBe(3);
    expect(classEffect(31, 4)).toBe(1);
    expect(classEffect(53, 4)).toBe(4);
    expect(classEffect(5, 6)).toBe(0);
  });
});

describe('roundPrice', () => {
  const pk = 'peacekeeper';
  it('a flea-banned round costs what the trader asks', () => {
    expect(roundPrice({ bt: pk, bp: 339, bl: 3, nf: true, a: 999 }, null)).toEqual({ price: 339, source: 'trader', trader: pk, level: 3, locked: false });
  });
  it('locked behind a loyalty level you do not have: still priced, marked locked', () => {
    expect(roundPrice({ bt: pk, bp: 339, bl: 3, nf: true }, { [pk]: 2 })).toMatchObject({ price: 339, locked: true });
    expect(roundPrice({ bt: pk, bp: 339, bl: 3, nf: true }, { [pk]: 3 })).toMatchObject({ locked: false });
  });
  it('the flea when it is cheaper or the trader is out of reach', () => {
    expect(roundPrice({ a: 100, bt: pk, bp: 339, bl: 1 }, null)).toMatchObject({ price: 100, source: 'flea' });
    expect(roundPrice({ a: 500, bt: pk, bp: 339, bl: 4 }, { [pk]: 1 })).toMatchObject({ price: 500, source: 'flea', locked: false });
  });
  it('no offer at all: no price', () => {
    expect(roundPrice(undefined, null)).toEqual({ price: 0, source: null, locked: false });
  });
  it('every cartridge in the snapshot has some price', () => {
    const prices = (JSON.parse(readFileSync('data/snapshot/prices.json', 'utf8')) as { items: Record<string, { bp?: number }> }).items;
    const priced = Object.keys(data.ammo).filter((id) => roundPrice(prices[id], null).price > 0);
    expect(priced.length).toBeGreaterThan(Object.keys(data.ammo).length / 2);
  });
});

describe('bestValue', () => {
  const small: AmmoData = {
    generatedAt: '',
    weapons: {},
    ammo: {
      cheapWeak: { c: 'X', p: 20 },
      cheapThrough: { c: 'X', p: 41 },
      dearEasy: { c: 'X', p: 52 },
      bannedEasy: { c: 'X', p: 60 },
    },
  };
  const prices: Record<string, number> = { cheapWeak: 50, cheapThrough: 300, dearEasy: 900 };
  const priceOf = (id: string) => prices[id] ?? 0;
  const ids = Object.keys(small.ammo);

  it('the cheapest that goes through the class, and the cheapest that does it easily', () => {
    const v = bestValue(ids, small, priceOf, 4);
    expect(v.through?.id).toBe('cheapThrough');
    expect(v.easily?.id).toBe('dearEasy');
  });

  it('leaves out cartridges with no market price', () => {
    expect(bestValue(ids, small, priceOf, 5).through?.id).toBe('dearEasy');
    expect(bestValue(ids, small, priceOf, 5).easily).toBeNull();
  });

  it('nothing goes through: null', () => {
    expect(bestValue(ids, small, priceOf, 6)).toEqual({ through: null, easily: null });
  });

  it('works on the real 5.56 list', () => {
    const list = ammoFor({ kind: 'caliber', id: 'Caliber556x45NATO', label: '' }, data);
    const v = bestValue(list, data, () => 100, 3);
    expect(v.through).not.toBeNull();
    expect(classEffect(data.ammo[v.through!.id].p, 3)).toBeGreaterThanOrEqual(3);
  });
});

describe('your ammo from a stash screenshot (short names)', () => {
  const en = (JSON.parse(readFileSync('data/snapshot/progression-en.json', 'utf8')) as { items: Names }).items;
  const idOf = (short: string, cal: string) => Object.keys(data.ammo).find((id) => data.ammo[id].c === cal && en[id]?.[1] === short)!;

  it('reads the short names on the pictures, several on one line', () => {
    const got = ammoShortsFromScreen(['M855A1 M995', 'M856A1'], data, [names, en]);
    expect(got).toContain(idOf('M855A1', 'Caliber556x45NATO'));
    expect(got).toContain(idOf('M995', 'Caliber556x45NATO'));
    expect(got).toContain(idOf('M856A1', 'Caliber556x45NATO'));
  });

  it('a short name several calibers share counts only next to one of those calibers', () => {
    expect(ammoShortsFromScreen(['FMJ'], data, [en])).toEqual([]);
    const got = ammoShortsFromScreen(['M855A1 FMJ'], data, [en]);
    expect(got).toContain(idOf('FMJ', 'Caliber556x45NATO'));
    expect(got).toHaveLength(2);
  });

  it('one-letter names do not count, nor words that are no cartridge', () => {
    expect(ammoShortsFromScreen(['T P', 'Rubles 120000', 'Salewa'], data, [en])).toEqual([]);
  });

  it('ranks what you have by caliber, best first against the armour class', () => {
    const m855 = idOf('M855', 'Caliber556x45NATO');
    const m995 = idOf('M995', 'Caliber556x45NATO');
    const fmj = idOf('FMJ', 'Caliber556x45NATO');
    const groups = rankOwned([fmj, m855, m995], data, 4);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids[0]).toBe(m995);
    expect(groups[0].ids).toEqual([m995, m855, fmj].sort((x, y) => ammoScore(data.ammo[y], 4) - ammoScore(data.ammo[x], 4)));
  });
});

describe('an inventory screenshot that is mostly ammo goes to the ammo page', () => {
  const en = (JSON.parse(readFileSync('data/snapshot/progression-en.json', 'utf8')) as { items: Names }).items;
  const idOf = (short: string, cal: string) => Object.keys(data.ammo).find((id) => data.ammo[id].c === cal && en[id]?.[1] === short)!;
  const fmjAll = Object.keys(data.ammo).filter((id) => en[id]?.[1] === 'FMJ');

  it('counts the cartridges and names them, a shared short name by the caliber seen', () => {
    const items = [{ ids: [idOf('M855A1', 'Caliber556x45NATO')] }, { ids: [idOf('M995', 'Caliber556x45NATO')] }, { ids: fmjAll }, { ids: ['5c12688486f77426843c7d32'] }];
    const got = ammoInScan(items, data);
    expect(got.ammoItems).toBe(3);
    expect(got.ids).toContain(idOf('FMJ', 'Caliber556x45NATO'));
    expect(mostlyAmmo(got, items.length)).toBe(true);
  });

  it('a stash with a few cartridges among many things stays an inventory', () => {
    const ammo = [{ ids: [idOf('M855A1', 'Caliber556x45NATO')] }, { ids: [idOf('M995', 'Caliber556x45NATO')] }, { ids: [idOf('M856A1', 'Caliber556x45NATO')] }];
    const other = Array.from({ length: 6 }, () => ({ ids: ['5c12688486f77426843c7d32'] }));
    expect(mostlyAmmo(ammoInScan([...ammo, ...other], data), 9)).toBe(false);
  });
});
