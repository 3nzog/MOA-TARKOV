import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  darken,
  inkFor,
  normalizeAppearance,
} from './appearance';
import { ARROW_SYMBOL, knownSymbol, markerHtml, symbolSvg } from '../squad/symbols';

describe('normalizeAppearance', () => {
  it('fills in defaults for nothing saved', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it('clamps out-of-range numbers and drops bad values', () => {
    const a = normalizeAppearance({
      theme: 'neon',
      accent: 'red',
      glass: { blur: 400, opacity: -1, tint: '#ABCDEF' },
      fontScale: 9,
      density: 'huge',
      markerScale: 0,
    });
    expect(a.theme).toBe('dark');
    expect(a.accent).toBe(DEFAULT_APPEARANCE.accent);
    expect(a.glass.blur).toBe(40);
    expect(a.glass.opacity).toBe(0.15);
    expect(a.glass.tint).toBe('#abcdef');
    expect(a.glass.saturation).toBe(DEFAULT_APPEARANCE.glass.saturation);
    expect(a.fontScale).toBe(1.3);
    expect(a.density).toBe('normal');
    expect(a.markerScale).toBe(0.6);
  });
});

describe('colour helpers', () => {
  it('picks dark ink on light accents and white on dark ones', () => {
    expect(inkFor('#7fd6ac')).toBe('#10140f');
    expect(inkFor('#1a1c17')).toBe('#ffffff');
  });

  it('darkens like color-mix with black', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(darken('#7fd6ac', 1)).toBe('#7fd6ac');
  });
});

describe('applyAppearance', () => {
  it('writes the custom properties and data attributes', () => {
    const el = document.createElement('div');
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'light', viewCone: false, animations: false }, el);
    expect(el.style.getPropertyValue('--accent-base')).toBe(DEFAULT_APPEARANCE.accent);
    expect(el.style.getPropertyValue('--glass-blur')).toBe(`${DEFAULT_APPEARANCE.glass.blur}px`);
    expect(el.dataset.theme).toBe('light');
    expect(el.dataset.cone).toBe('off');
    expect(el.dataset.motion).toBe('off');
  });
});

describe('player symbols', () => {
  it('accepts known ids and the arrow, rejects the rest', () => {
    expect(knownSymbol('skull')).toBe('skull');
    expect(knownSymbol(ARROW_SYMBOL)).toBe(ARROW_SYMBOL);
    expect(knownSymbol('<img onerror=x>')).toBeNull();
    expect(knownSymbol(42)).toBeNull();
  });

  it('draws a symbol disc with a turning cone, or the classic arrow', () => {
    const withSymbol = markerHtml('skull', '#E09B4C');
    expect(withSymbol).toContain('tc-mk__disc');
    expect(withSymbol).toContain('tc-mk__pointer');
    expect(withSymbol).toContain('tc-mk__cone');
    expect(withSymbol).toContain('--c:#E09B4C');
    const arrow = markerHtml(ARROW_SYMBOL, '#fff');
    expect(arrow).toContain('tc-mk__arrow');
    expect(arrow).not.toContain('tc-mk__disc');
    expect(symbolSvg(ARROW_SYMBOL)).toBeNull();
  });
});
