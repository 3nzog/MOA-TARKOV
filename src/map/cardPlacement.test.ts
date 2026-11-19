import { describe, expect, it } from 'vitest';
import { CARD_GAP, CARD_MARGIN, placeCard } from './cardPlacement';

const box = { w: 1200, h: 900 };
const card = { w: 380, h: 300 };

describe('placeCard', () => {
  it('opens above the marker, centred on it, when there is room', () => {
    const p = placeCard({ x: 600, y: 500 }, card, box);
    expect(p).toEqual({ side: 'above', left: 600 - 190, top: 500 - CARD_GAP - 300 });
  });

  it('opens below a marker near the top', () => {
    const p = placeCard({ x: 600, y: 120 }, card, box);
    expect(p.side).toBe('below');
    expect(p.top).toBe(120 + CARD_GAP);
  });

  it('goes to a side when neither above nor below fits', () => {
    const tall = { w: 380, h: 600 };
    expect(placeCard({ x: 300, y: 450 }, tall, box).side).toBe('right');
    expect(placeCard({ x: 1000, y: 450 }, tall, box)).toMatchObject({ side: 'left', left: 1000 - CARD_GAP - 380 });
  });

  it('stays inside the map near an edge, without covering the marker', () => {
    const p = placeCard({ x: 1180, y: 860 }, card, box);
    expect(p.side).toBe('above');
    expect(p.left).toBe(box.w - CARD_MARGIN - card.w);
    expect(p.top + card.h).toBeLessThan(860);
  });

  it('in a window too small for any side, keeps the card inside the map', () => {
    const p = placeCard({ x: 200, y: 200 }, { w: 380, h: 380 }, { w: 420, h: 420 });
    expect(p.left).toBeGreaterThanOrEqual(CARD_MARGIN);
    expect(p.top).toBeGreaterThanOrEqual(CARD_MARGIN);
  });
});
