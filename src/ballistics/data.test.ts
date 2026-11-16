import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ammoFor, ammoFromScreen, caliberLabel, classEffect, search, type AmmoData, type Names } from './data';

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
