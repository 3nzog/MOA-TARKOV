import { describe, expect, it } from 'vitest';
import { exitTier, sideFromPanel } from './exitTier';
import type { Poi } from './types';

const M = '56f40101d2720b2a4d8b45d6';
const ex = (id: string, faction: string, label = id): Poi => ({
  id,
  category: 'extract',
  mapId: M,
  position: { x: 0, y: 0, z: 0 },
  label,
  source: 'tarkov-dev',
  meta: { faction },
});
const transit: Poi = { id: 't', category: 'transit', mapId: M, position: { x: 0, y: 0, z: 0 }, label: 'T', source: 'tarkov-dev' };
const loot: Poi = { id: 'l', category: 'loot', mapId: M, position: { x: 0, y: 0, z: 0 }, label: 'Safe', source: 'tarkov-dev' };

const pmc = ex('p1', 'pmc', 'ZB-1011');
const scav = ex('s1', 'scav', 'Old Gas Station');
const shared = ex('sh', 'shared', 'Smuggler Boat (Co-op)');

describe('exitTier', () => {
  it('the O+O list wins over everything', () => {
    const ids = new Set(['s1']);
    expect(exitTier(scav, 'pmc', ids, true)).toBe('mine');
    expect(exitTier(pmc, 'pmc', ids, true)).toBe('other');
    expect(exitTier(transit, 'pmc', ids, true)).toBe('other');
  });

  it('by side: that side, shared exits and transits are mine; the rest fade', () => {
    expect(exitTier(pmc, 'pmc', null, true)).toBe('mine');
    expect(exitTier(shared, 'pmc', null, true)).toBe('mine');
    expect(exitTier(transit, 'pmc', null, true)).toBe('mine');
    expect(exitTier(scav, 'pmc', null, true)).toBe('other');
    expect(exitTier(scav, 'scav', null, true)).toBe('mine');
    expect(exitTier(pmc, 'scav', null, true)).toBe('other');
  });

  it('side unknown: all faded in a raid, all normal when planning', () => {
    expect(exitTier(pmc, null, null, true)).toBe('other');
    expect(exitTier(scav, null, null, true)).toBe('other');
    expect(exitTier(pmc, null, null, false)).toBe('mine');
  });

  it('is not about other POIs', () => {
    expect(exitTier(loot, 'pmc', null, true)).toBeNull();
  });
});

describe('sideFromPanel', () => {
  const pois = [pmc, ex('p2', 'pmc', 'Crossroads'), scav, ex('s2', 'scav', 'Crossroads'), shared, transit];

  it('a PMC-only exit in the list means PMC, a Scav-only one Scav', () => {
    expect(sideFromPanel(new Set(['p1', 'sh', 't']), pois)).toBe('pmc');
    expect(sideFromPanel(new Set(['s1', 'sh']), pois)).toBe('scav');
  });

  it('names both sides have prove nothing; shared exits and transits neither', () => {
    expect(sideFromPanel(new Set(['p2']), pois)).toBeNull();
    expect(sideFromPanel(new Set(['s2', 'sh', 't']), pois)).toBeNull();
  });

  it('a name shared only in another language still proves nothing (Customs "Crossroads")', () => {
    const cruz = ex('pc', 'pmc', 'Cruzamento');
    const encr = ex('sc', 'scav', 'Encruzilhada');
    const gate = ex('og', 'scav', 'Old Road Gate');
    const aliases = { pc: ['Crossroads', 'Cruzamento'], sc: ['Crossroads', 'Encruzilhada'], og: ['Old Road Gate'] };
    // OCR read "Crossroads" and it landed on the PMC one: no proof from it, the gate decides.
    expect(sideFromPanel(new Set(['pc', 'og']), [cruz, encr, gate], aliases)).toBe('scav');
    expect(sideFromPanel(new Set(['pc']), [cruz, encr, gate], aliases)).toBeNull();
    // Without the aliases the two look different, and the list would look mixed.
    expect(sideFromPanel(new Set(['pc', 'og']), [cruz, encr, gate])).toBeNull();
  });

  it('both sides at once is a misread: no answer', () => {
    expect(sideFromPanel(new Set(['p1', 's1']), pois)).toBeNull();
  });
});
