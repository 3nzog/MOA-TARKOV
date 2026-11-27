import { describe, expect, it } from 'vitest';
import { firstChoice, makeCode, makeId, parsePairMsg, sameStep } from './pairing';

describe('pairing two PCs over the party', () => {
  it('makes 4-digit codes and hex ids', () => {
    expect(makeCode(() => 0)).toBe('0000');
    expect(makeCode(() => 0.48219)).toBe('4821');
    expect(makeId(() => 0.5)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('keeps a usable step and drops anything else', () => {
    expect(parsePairMsg({ id: 'abcdef0123456789', to: 'm2', step: 'code', code: '4821', try: 2, at: 5 })).toEqual({
      id: 'abcdef0123456789',
      to: 'm2',
      step: 'code',
      code: '4821',
      try: 2,
      at: 5,
    });
    expect(parsePairMsg({ id: 'abcdef0123456789', to: 'm2', step: 'code', code: '48', at: 5 })).toEqual({ id: 'abcdef0123456789', to: 'm2', step: 'code', at: 5 });
    expect(parsePairMsg({ id: 'nothex!', to: 'm2', step: 'invite', at: 1 })).toBeNull();
    expect(parsePairMsg({ id: 'abcdef0123456789', to: 'm2', step: 'kick', at: 1 })).toBeNull();
    expect(parsePairMsg(null)).toBeNull();
  });

  it('the first click on "this PC has the game" wins, the same on both PCs', () => {
    const a = { game: 'A', at: 100, by: 'A' };
    const b = { game: 'B', at: 105, by: 'B' };
    expect(firstChoice(a, b).game).toBe('A');
    expect(firstChoice(b, a).game).toBe('A');
    const tieA = { game: 'A', at: 100, by: 'm1' };
    const tieB = { game: 'B', at: 100, by: 'm2' };
    expect(firstChoice(tieA, tieB)).toBe(firstChoice(tieB, tieA));
    expect(firstChoice(a, null)).toBe(a);
  });

  it('tells a new step from a repeat (a retyped code is new)', () => {
    const m = { id: 'abcdef0123456789', to: 'x', step: 'code' as const, code: '1111', try: 1, at: 1 };
    expect(sameStep(m, { ...m, at: 9 })).toBe(true);
    expect(sameStep(m, { ...m, try: 2 })).toBe(false);
    expect(sameStep(m, null)).toBe(false);
  });
});
