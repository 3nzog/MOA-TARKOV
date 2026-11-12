/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WeaponData } from './data';
import { buildStats, conflictsWith, equip, factoryBuild, missingRequired, slotTree } from './build';
import { availability, effectiveAccess, maxLevelFor } from './availability';
import { readShareCode, shareCode } from './presets';

const GUN = 'a'.repeat(24);
const GRIP = 'b'.repeat(24);
const GRIP2 = 'c'.repeat(24);
const RAIL = 'd'.repeat(24);
const SCOPE = 'e'.repeat(24);
const BIPOD = 'f'.repeat(24);
const PK = 'peacekeeper';

const data: WeaponData = {
  generatedAt: '',
  fleaMinLevel: 15,
  traders: [{ id: PK, key: 'peacekeeper', levels: [[1, 0], [2, 14], [3, 22], [4, 33]] }],
  weapons: {
    [GUN]: {
      e: 50,
      rv: 100,
      rh: 200,
      w: 3,
      s: [
        { n: 'mod_pistol_grip', q: 1, i: [GRIP, GRIP2] },
        { n: 'mod_handguard', i: [RAIL] },
      ],
      d: [RAIL, GRIP],
    },
  },
  mods: {
    [GRIP]: { e: 5, w: 0.1 },
    [GRIP2]: { e: 8, r: -0.02, w: 0.1 },
    [RAIL]: { e: -2, r: -0.05, w: 0.3, s: [{ n: 'mod_scope', i: [SCOPE] }, { n: 'mod_bipod', i: [BIPOD] }] },
    [SCOPE]: { e: -3, w: 0.4, c: [BIPOD] },
    [BIPOD]: { e: -1, w: 0.2 },
  },
  src: {
    [GRIP]: { o: [[PK, 1, 5000, 0]], f: 4000 },
    [SCOPE]: { o: [[PK, 3, 30000, 0]], b: [[PK, 2, [[GRIP, 2]], 'quest1']] },
    [BIPOD]: { c: [['workbench', 2]] },
  },
};

describe('weapon builds', () => {
  it('slots the factory parts into the tree, nested ones included', () => {
    const b = factoryBuild(data, GUN);
    expect(b.parts).toEqual({ mod_pistol_grip: GRIP, mod_handguard: RAIL });
    const rows = slotTree(data, b);
    expect(rows.map((r) => [r.path, r.depth, r.itemId])).toEqual([
      ['mod_pistol_grip', 0, GRIP],
      ['mod_handguard', 0, RAIL],
      ['mod_handguard/mod_scope', 1, null],
      ['mod_handguard/mod_bipod', 1, null],
    ]);
  });

  it('sums ergonomics and scales recoil by the parts', () => {
    const b = equip(data, factoryBuild(data, GUN), 'mod_pistol_grip', GRIP2);
    const s = buildStats(data, b);
    expect(s.ergonomics).toBe(50 + 8 - 2);
    expect(s.recoilVertical).toBe(Math.round(100 * (1 - 0.07)));
    expect(s.recoilHorizontal).toBe(Math.round(200 * (1 - 0.07)));
    expect(s.weight).toBeCloseTo(3.4);
  });

  it('removes what hangs below a replaced part, and what conflicts', () => {
    let b = factoryBuild(data, GUN);
    b = equip(data, b, 'mod_handguard/mod_bipod', BIPOD);
    expect(conflictsWith(data, b, SCOPE)).toEqual([BIPOD]);
    b = equip(data, b, 'mod_handguard/mod_scope', SCOPE);
    expect(b.parts['mod_handguard/mod_bipod']).toBeUndefined();
    expect(b.parts['mod_handguard/mod_scope']).toBe(SCOPE);
    b = equip(data, b, 'mod_handguard', null);
    expect(Object.keys(b.parts)).toEqual(['mod_pistol_grip']);
    b = equip(data, b, 'mod_pistol_grip', null);
    expect(missingRequired(data, b).map((r) => r.path)).toEqual(['mod_pistol_grip']);
  });
});

describe('availability for this player', () => {
  const taskDone = (id: string) => id === 'quest1';
  it('opens offers by loyalty level and quest, and the flea by level', () => {
    const access = { traderLevels: { [PK]: 2 }, flea: false, taskDone };
    const scope = availability(data, SCOPE, access);
    expect(scope.open.map((s) => s.kind)).toEqual(['barter']);
    expect(scope.locked).toEqual([
      { source: { kind: 'trader', trader: PK, level: 3, price: 30000, task: null }, reason: { why: 'level', need: 3, have: 2 } },
    ]);
    const grip = availability(data, GRIP, access);
    expect(grip.cash).toBe(5000);
    expect(grip.locked.map((l) => l.reason.why)).toEqual(['flea']);
    expect(availability(data, GRIP, { ...access, flea: true }).cash).toBe(4000);
    expect(availability(data, BIPOD, access).open).toEqual([{ kind: 'craft', station: 'workbench', level: 2 }]);
  });

  it('estimates levels from the player level until the player sets them', () => {
    expect(maxLevelFor(data.traders[0], 20)).toBe(2);
    const est = effectiveAccess(data, { levels: {}, flea: null, set: false }, 20, taskDone);
    expect(est).toMatchObject({ traderLevels: { [PK]: 2 }, flea: true });
    const own = effectiveAccess(data, { levels: { [PK]: 4 }, flea: false, set: true }, 20, taskDone);
    expect(own).toMatchObject({ traderLevels: { [PK]: 4 }, flea: false });
  });
});

describe('share codes', () => {
  it('round-trips a preset and rejects anything else', () => {
    const b = factoryBuild(data, GUN);
    const code = shareCode('Meta M4 — ção', b);
    expect(code.startsWith('MOA1:')).toBe(true);
    expect(readShareCode(code)).toEqual({ name: 'Meta M4 — ção', build: b });
    expect(readShareCode('hello')).toBeNull();
    expect(readShareCode('MOA1:!!!')).toBeNull();
  });
});

describe('the real weapon snapshot', () => {
  const real = JSON.parse(readFileSync(resolve(process.cwd(), 'data/snapshot/weapons.json'), 'utf8')) as WeaponData;
  it('builds the M4A1 factory preset completely, with sane stats', () => {
    const m4 = '5447a9cd4bdc2dbd208b4567';
    const b = factoryBuild(real, m4);
    expect(Object.keys(b.parts).length).toBe(real.weapons[m4].d!.length);
    expect(missingRequired(real, b)).toEqual([]);
    const s = buildStats(real, b);
    expect(s.ergonomics).toBeGreaterThan(30);
    expect(s.recoilVertical).toBeGreaterThan(30);
    expect(s.recoilVertical).toBeLessThan(real.weapons[m4].rv! * 1.2);
  });
});
