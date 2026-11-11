import { describe, expect, it } from 'vitest';
import { assignHotkey, comboFromEvent, DEFAULT_HOTKEYS, parseHotkeys } from './useHotkeys';

const ev = (code: string, key: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('hotkeys', () => {
  it('builds layout-independent combos and ignores bare modifiers', () => {
    expect(comboFromEvent(ev('KeyR', 'r', { altKey: true }))).toBe('Alt+R');
    // AZERTY: the "1" key types "&" but its code is still Digit1.
    expect(comboFromEvent(ev('Digit1', '&', { altKey: true }))).toBe('Alt+1');
    expect(comboFromEvent(ev('F5', 'F5', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+F5');
    expect(comboFromEvent(ev('AltLeft', 'Alt', { altKey: true }))).toBeNull();
  });

  it('parses stored maps leniently and keeps explicit unbinds', () => {
    expect(parseHotkeys(null)).toEqual(DEFAULT_HOTKEYS);
    expect(parseHotkeys('garbage')).toEqual(DEFAULT_HOTKEYS);
    const p = parseHotkeys(JSON.stringify({ quests: 'Ctrl+Q', grid: null, bogus: 'X' }));
    expect(p.quests).toBe('Ctrl+Q');
    expect(p.grid).toBeNull();
    expect(p.intel).toBe(DEFAULT_HOTKEYS.intel);
  });

  it('moving a combo to another action unbinds its old owner', () => {
    const next = assignHotkey(DEFAULT_HOTKEYS, 'grid', DEFAULT_HOTKEYS.quests);
    expect(next.grid).toBe('Alt+1');
    expect(next.quests).toBeNull();
  });
});
