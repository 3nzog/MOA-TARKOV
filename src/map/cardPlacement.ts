// Where the map's info card goes: next to the marker that was clicked instead
// of a fixed corner (where it covered the route window). Above the marker
// first, then below, then to the right or the left — the first side where the
// whole card fits — and never over the marker itself.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Side = 'above' | 'below' | 'right' | 'left';

export interface Placement {
  left: number;
  top: number;
  side: Side;
}

/** Space between the marker and the card, so the marker stays in sight. */
export const CARD_GAP = 22;
/** Space kept to the edges of the map. */
export const CARD_MARGIN = 10;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * The card's top-left corner inside a map of size `box`, for a click at `at`
 * (both in the map's own pixels).
 */
export function placeCard(at: Point, card: Size, box: Size, gap = CARD_GAP, margin = CARD_MARGIN): Placement {
  const centerX = clamp(at.x - card.w / 2, margin, box.w - margin - card.w);
  const centerY = clamp(at.y - card.h / 2, margin, box.h - margin - card.h);
  const room: Record<Side, number> = {
    above: at.y - gap - margin,
    below: box.h - margin - (at.y + gap),
    right: box.w - margin - (at.x + gap),
    left: at.x - gap - margin,
  };
  const spots: Record<Side, Placement> = {
    above: { side: 'above', left: centerX, top: at.y - gap - card.h },
    below: { side: 'below', left: centerX, top: at.y + gap },
    right: { side: 'right', left: at.x + gap, top: centerY },
    left: { side: 'left', left: at.x - gap - card.w, top: centerY },
  };
  const order: Side[] = ['above', 'below', 'right', 'left'];
  const need = (s: Side) => (s === 'above' || s === 'below' ? card.h : card.w);
  const fits = order.find((s) => room[s] >= need(s));
  if (fits) return spots[fits];

  // Nowhere it fits whole (a small window): the side with the most room,
  // kept inside the map.
  const best = order.reduce((a, b) => (room[b] / need(b) > room[a] / need(a) ? b : a));
  const p = spots[best];
  return {
    side: best,
    left: clamp(p.left, margin, box.w - margin - card.w),
    top: clamp(p.top, margin, box.h - margin - card.h),
  };
}
