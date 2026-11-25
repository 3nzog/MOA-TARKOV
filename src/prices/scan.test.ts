/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIndex, findShortNames, rowCount, scanScreen, skeleton, type ItemNames, type ScreenLine, type ScreenText } from './scan';

const load = (lang: string) =>
  (JSON.parse(readFileSync(resolve(process.cwd(), `data/snapshot/progression-${lang}.json`), 'utf8')) as { items: ItemNames }).items;
const index = buildIndex(load('pt'), load('en'));

// A line the way the Rust OCR sends it: words with their boxes.
const line = (text: string, x: number, y: number): ScreenLine => ({
  text,
  words: text.split(' ').map((w, i) => ({ text: w, x: x + i * 60, y, w: 50, h: 12 })),
});
const screen = (...lines: ScreenLine[]): ScreenText => ({ width: 1920, height: 1080, lines });

const SALEWA = '544fb45d4bdc2dee738b4568';
const AI2 = '5755356824597772cb798962';
const SA58 = '5b0bbe4e5acfc40dc528a72d';
const MP5K = '5d2f0d8048f0356c925bc3b0';
const CMS = '5d02778e86f774203e7dedbe';

describe('OCR look-alikes', () => {
  it('folds 5/S, 0/O, 1/I/l and 8/B', () => {
    expect(skeleton('SA-S8')).toBe(skeleton('SA-58'));
    expect(skeleton('MPSK-N')).toBe(skeleton('MP5K-N'));
    expect(skeleton('Al-2')).toBe(skeleton('AI-2'));
  });
});

describe('short names, from the real hotbar OCR of your screenshots', () => {
  // Lines exactly as Windows OCR read the hotbar (1080p, 2x upscale).
  const hotbar = screen(
    line('Al-2', 1050, 81),
    line('A-2607', 663, 81),
    line('MPSK-N', 809, 81),
    line('Analgésicos Salewa', 956, 80),
    line('SA-S8', 814, 81),
    line('CMS', 1124, 81),
  );
  it('reads the garbled names right, and flags a shared one as uncertain', () => {
    const found = findShortNames(hotbar, index);
    const ids = found.map((f) => f.ids);
    expect(ids).toContainEqual([AI2]);
    expect(ids).toContainEqual([MP5K]);
    // "SA-58" is both the rifle and its grip: both candidates, not a guess.
    expect(ids.find((x) => x.includes(SA58))).toHaveLength(2);
    expect(ids).toContainEqual([SALEWA]);
    expect(ids).toContainEqual([CMS]);
    // Two different knives are both "A-2607": not guessed either.
    expect(ids.find((x) => x.includes('57e26ea924597715ca604a09'))).toHaveLength(2);
  });
  it('ignores a single row (the hotbar) as an inventory', () => {
    expect(rowCount(findShortNames(hotbar, index))).toBe(1);
    expect(scanScreen(hotbar, index)).toBeNull();
  });
});

describe('screens', () => {
  it('counts an inventory spread over rows', () => {
    const r = scanScreen(screen(line('Salewa CMS', 100, 200), line('Salewa', 100, 264), line('AI-2', 164, 264)), index);
    expect(r?.mode).toBe('inventory');
    if (r?.mode !== 'inventory') return;
    expect(r.items.find((i) => i.ids[0] === SALEWA)?.count).toBe(2);
    expect(r.total).toBe(4);
  });
  it('finds the hovered item from its full name in the tooltip', () => {
    const r = scanScreen(screen(line('Kit de primeiros socorros Salewa', 900, 500), line('Salewa', 880, 540)), index);
    expect(r).toEqual({ mode: 'hovered', items: [{ ids: [SALEWA], x: 900, y: 500 }] });
  });
  it('finds a full name inside a longer line too', () => {
    const r = scanScreen(screen(line('Examinar Kit médico AI-2 0.2kg', 900, 500)), index);
    expect(r?.mode).toBe('hovered');
  });
});

describe('your stash screenshot (1080p, Portuguese, read by Windows OCR at 2x)', () => {
  const stash = JSON.parse(readFileSync(resolve(process.cwd(), 'src/prices/__fixtures__/stash-pt-1080p.json'), 'utf8')) as ScreenText;
  const prices = (JSON.parse(readFileSync(resolve(process.cwd(), 'data/snapshot/prices.json'), 'utf8')) as {
    items: Record<string, { a?: number; sp?: number }>;
  }).items;
  const tradable = (id: string) => Math.max(prices[id]?.a ?? 0, prices[id]?.sp ?? 0) > 0;
  const pt = load('pt');
  const r = scanScreen(stash, index, tradable);
  const names = r?.mode === 'inventory' ? r.items.filter((i) => i.ids.length === 1).map((i) => pt[i.ids[0]][1] ?? pt[i.ids[0]][0]) : [];

  it('reads it as an inventory, not a hovered item', () => {
    expect(r?.mode).toBe('inventory');
  });
  it('reads most cells, cut names and OCR slips included', () => {
    expect(r?.mode === 'inventory' && r.total).toBeGreaterThanOrEqual(80);
    for (const n of ['Salewa', 'CMS', 'AI-2', 'Analgésicos', 'Augmentin', 'Medicamentos', 'EXPS3', 'Mk.16 5.56', 'TANGO6T', 'BRAVO4', 'Zarya']) {
      expect(names).toContain(n);
    }
  });
  it('does not take the game menu for items', () => {
    expect(names).not.toContain('Manual');
  });
});

describe('a screenshot of ammo', () => {
  const ammo = (JSON.parse(readFileSync(resolve(process.cwd(), 'data/snapshot/ammo.json'), 'utf8')) as { ammo: Record<string, { g?: boolean }> }).ammo;
  const isRound = (id: string) => !!ammo[id] && !ammo[id].g;
  const M855 = '54527a984bdc2d4e668b4567';
  const M855A1 = '54527ac44bdc2d36668b4567';

  it('"M855" read as written is the cartridge (or its pack), not the MBSS backpack it folds into', () => {
    const [m855] = findShortNames(screen(line('M855', 100, 100)), index);
    expect(m855.ids).toContain(M855);
    expect(m855.ids.some((id) => /mbss/i.test(load('en')[id]?.[0] ?? ''))).toBe(false);
  });

  it('a name the cartridge shares with its ammo pack reads as the cartridge', () => {
    const r = scanScreen(screen(line('M855A1 M855', 100, 100), line('M855A1', 100, 180)), index, undefined, isRound);
    expect(r?.mode).toBe('inventory');
    const ids = r && r.mode === 'inventory' ? r.items.map((i) => i.ids) : [];
    expect(ids).toContainEqual([M855A1]);
    expect(ids).toContainEqual([M855]);
  });
});

describe('your 2026-11-25 stash prints (as Windows OCR read them)', () => {
  const names = (...ls: ScreenLine[]) => findShortNames(screen(...ls), index).map((f) => f.ids.map((id) => load('pt')[id]?.[1] ?? load('pt')[id]?.[0]));
  it('reads names two glyphs off, "rn" for "m", and a name split in two', () => {
    expect(names(line('Sahnnete', 1654, 775))).toEqual([['Sabonete']]);
    expect(names(line('F sfaros', 1658, 397))).toEqual([['Fósforos', 'Fósforos']]);
    expect(names(line('Shrñaska', 1720, 460))).toEqual([['Shmaska']]);
    const split = (t: string, x: number, w: number): ScreenLine => ({ text: t, words: [{ text: t, x, y: 460, w, h: 8 }] });
    expect(names(split('P', 1784, 6), split('ndrlve', 1797, 34))[0]).toContain('Pendrive');
  });
  it('does not take the preset name for an item', () => {
    expect(names(line('NEW PRESET 1', 245, 82))).toEqual([]);
  });
});
