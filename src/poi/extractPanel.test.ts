import { describe, expect, it } from 'vitest';
import { findPanelMap, matchExtractPanel, normalizeText } from './extractPanel';
import type { Poi } from './types';

const ex = (id: string, label: string, faction = 'pmc'): Poi => ({
  id: `extract:${id}`,
  category: 'extract',
  mapId: 'm',
  position: { x: 0, y: 0, z: 0 },
  label,
  source: 'tarkov-dev',
  meta: { faction },
});
const tr = (id: string, dest: string): Poi => ({
  id: `transit:${id}`,
  category: 'transit',
  mapId: 'm',
  position: { x: 0, y: 0, z: 0 },
  label: `Transit → ${dest}`,
  source: 'tarkov-dev',
  meta: { destMapName: dest },
});

// Lines exactly as Windows OCR returned them for the two sample screenshots.
const GROUND_ZERO_OCR = [
  'EXFILOI Police Cordon V-Ex',
  'EXFlL02 Scav Checkpoint (Co-op)',
  'EXFlL03 Nakatani Basement Stairs',
  'EXFIL04 Mira Ave',
  'TRANSI TOI Viajar para Streets of Tarkov',
];
const STREETS_OCR = [
  'SAIRM',
  'SAIRD2',
  'SAIRE',
  'SAIRD4',
  'Entrada para Catacumbas',
  'Poço de ventilação',
  'Esgoto',
  'Pinewood Basement (Co-Op)',
  'TRANSI TOI Viajar para Ground Zero',
  'TRANSI T 02 Viajar para Interchange',
];

describe('O+O extract panel matching', () => {
  it('normalizes accents, case and punctuation', () => {
    expect(normalizeText('Poço de ventilação')).toBe('poco de ventilacao');
    expect(normalizeText('Scav Checkpoint (Co-op)')).toBe('scav checkpoint co op');
  });

  it('matches the Ground Zero sample, leaving exits not listed out', () => {
    const pois = [
      ex('a', 'Police Cordon V-Ex'),
      ex('b', 'Scav Checkpoint (Co-op)', 'shared'),
      ex('c', 'Nakatani Basement Stairs'),
      ex('d', 'Mira Ave'),
      ex('e', 'Emercom Checkpoint'),
      tr('s', 'Streets of Tarkov'),
    ];
    const m = matchExtractPanel(GROUND_ZERO_OCR, pois)!;
    expect([...m.ids].sort()).toEqual(['extract:a', 'extract:b', 'extract:c', 'extract:d', 'transit:s']);
    expect(m.unmatched).toEqual([]);
  });

  it('matches the Streets sample in Portuguese with codes garbled', () => {
    const pois = [
      ex('cat', 'Entrada para Catacumbas'),
      ex('vent', 'Poço de ventilação'),
      ex('sew', 'Esgoto'),
      ex('pine', 'Pinewood Basement (Co-Op)', 'shared'),
      ex('other', 'Klimov Street'),
      tr('gz', 'Ground Zero'),
      tr('ic', 'Interchange'),
      tr('lh', 'Lighthouse'),
    ];
    const m = matchExtractPanel(STREETS_OCR, pois)!;
    expect([...m.ids].sort()).toEqual([
      'extract:cat',
      'extract:pine',
      'extract:sew',
      'extract:vent',
      'transit:gz',
      'transit:ic',
    ]);
  });

  it('tolerates a small OCR slip in a longer name', () => {
    const pois = [ex('a', 'Nakatani Basement Stairs'), ex('b', 'Mira Ave')];
    expect(matchExtractPanel(['EXFIL03 Nakatanl Basernent Stairs', 'EXFIL04 Mira Ave'], pois)!.ids.size).toBe(2);
  });

  it('returns null for a screenshot without the list (or of another map)', () => {
    const pois = [ex('a', 'Police Cordon V-Ex'), ex('b', 'Mira Ave')];
    expect(matchExtractPanel(['Incursão #1', 'Dia 06 05:21:55 PM'], pois)).toBeNull();
    expect(matchExtractPanel(STREETS_OCR, pois)).toBeNull();
    // A single stray hit is not a list.
    expect(matchExtractPanel(['Mira Ave'], pois)).toBeNull();
  });
});

describe('O+O list in another language, and finding its map', () => {
  const streets = [
    { ...ex('cat', 'Catacombs Entrance') },
    { ...ex('sew', 'Sewer River') },
    { ...ex('other', 'Klimov Street') },
    tr('gz', 'Ground Zero'),
  ];
  const groundZero = [ex('a', 'Police Cordon V-Ex'), ex('d', 'Mira Ave'), tr('s', 'Streets of Tarkov')];
  // The app runs in English; the game, in Portuguese.
  const aliases = {
    'extract:cat': ['Catacombs Entrance', 'Entrada para Catacumbas', 'Вход в катакомбы'],
    'extract:sew': ['Sewer River', 'Esgoto'],
    'transit:gz': ['Ground Zero', 'Граунд Зиро'],
  };
  it('matches names in the game language even when the app uses another', () => {
    const m = matchExtractPanel(['SAIRM', 'Entrada para Catacumbas', 'Esgoto', 'TRANSI TOI Viajar para Ground Zero'], streets, aliases)!;
    expect([...m.ids].sort()).toEqual(['extract:cat', 'extract:sew', 'transit:gz']);
    expect(matchExtractPanel(['Вход в катакомбы', 'Переход Граунд Зиро'], streets, aliases)!.ids.size).toBe(2);
  });
  it('finds the map the list belongs to, whatever map is shown', () => {
    const found = findPanelMap(['Entrada para Catacumbas', 'Esgoto'], { streets, groundZero }, aliases, 'groundZero')!;
    expect(found.mapId).toBe('streets');
    expect(findPanelMap(['nothing here', 'at all'], { streets, groundZero }, aliases, null)).toBeNull();
  });
});

describe('transit destinations with a variant suffix', () => {
  it('matches "Viajar para Ground Zero" to a transit into Ground Zero 21+', () => {
    const pois = [ex('a', 'Esgoto'), tr('gz', 'Ground Zero 21+'), tr('lab', 'The Lab (Dark)')];
    const m = matchExtractPanel(['Esgoto', 'TRANSI TOI Viajar para Ground Zero', 'TRANSIT02 Viajar para The Lab'], pois)!;
    expect([...m.ids].sort()).toEqual(['extract:a', 'transit:gz', 'transit:lab']);
  });
});
