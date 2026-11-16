import { describe, expect, it } from 'vitest';
import { levelFromScreen } from './levelFromScreen';
import type { ScreenText } from './scan';

const screen = (...lines: string[]): ScreenText => ({ width: 1920, height: 1080, lines: lines.map((text) => ({ text, words: [] })) });

describe('player level from a screenshot', () => {
  it('reads the flea market line in each language', () => {
    expect(levelFromScreen(screen('+ ADD OFERTA', 'Nível atual: 12'))).toBe(12);
    expect(levelFromScreen(screen('Nivel atual 12'))).toBe(12);
    expect(levelFromScreen(screen('Current level: 37'))).toBe(37);
    expect(levelFromScreen(screen('Nivel actual: 5'))).toBe(5);
    expect(levelFromScreen(screen('Текущий уровень: 21'))).toBe(21);
  });

  it('fixes OCR slips in the number', () => {
    expect(levelFromScreen(screen('Nível atual: l2'))).toBe(12);
    expect(levelFromScreen(screen('Current level: 2O'))).toBe(20);
  });

  it('reads the season / profile card of the main menu (real OCR of it)', () => {
    const menu = screen('Temporada PVP 0', 'TEMPORADA | DIA(S)', '3squ1n@x | 12', '• Personagem temporário em Tarkov', 'PMCs Experientes');
    expect(levelFromScreen(menu)).toBe(12);
    // Without a menu word, a "name | n" line is not trusted.
    expect(levelFromScreen(screen('Algo | 3', 'Outra coisa'))).toBeNull();
  });

  it('reads the enlarged crop of the flea market line', () => {
    expect(levelFromScreen({ ...screen('MERCADO', '+ ADD OFERTA'), levelLines: ['Nível atual: 12'] })).toBe(12);
  });

  it('ignores other levels on the screen and nonsense', () => {
    expect(levelFromScreen(screen('A compra e a listagem de ofertas ficam disponíveis no nível 15'))).toBeNull();
    expect(levelFromScreen(screen('Nível atual: 99'))).toBeNull();
    expect(levelFromScreen(screen('Nível atual: 0'))).toBeNull();
    expect(levelFromScreen(null)).toBeNull();
  });
});
