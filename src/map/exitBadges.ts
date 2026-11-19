// Small pictures next to an exit's name on the map for what it asks for: the
// item itself (paracord, the Red Rebel ice pick, a green or red flare — the
// item's own picture from tarkov.dev, without background) or a plain glyph for
// the rest (a key, power, a lever, paying, co-op, a code note, the minefield
// map, no armour, no backpack). Only things to bring or do: "not always open"
// and "single use" stay in the exit's card.
import keySvg from '@phosphor-icons/core/assets/fill/key-fill.svg?raw';
import lightningSvg from '@phosphor-icons/core/assets/fill/lightning-fill.svg?raw';
import toggleSvg from '@phosphor-icons/core/assets/fill/toggle-right-fill.svg?raw';
import rubSvg from '@phosphor-icons/core/assets/fill/currency-rub-fill.svg?raw';
import handshakeSvg from '@phosphor-icons/core/assets/fill/handshake-fill.svg?raw';
import noteSvg from '@phosphor-icons/core/assets/fill/note-fill.svg?raw';
import mapSvg from '@phosphor-icons/core/assets/fill/map-trifold-fill.svg?raw';
import shieldSlashSvg from '@phosphor-icons/core/assets/fill/shield-slash-fill.svg?raw';
import backpackSvg from '@phosphor-icons/core/assets/fill/backpack-fill.svg?raw';
import type { ExitReqs, ReqTag } from './extractReqs';

/** The item a tag asks for (tarkov.dev item id). */
const ITEM: Partial<Record<ReqTag, string>> = {
  paracord: '5c12688486f77426843c7d32',
  redRebel: '5c0126f40db834002a125382',
  greenFlare: '6217726288ed9f0845317459',
  flareZone: '6217726288ed9f0845317459',
  redFlare: '62178c4d4ecf221597654e3d',
};

type Glyph = 'key' | 'power' | 'lever' | 'pay' | 'coop' | 'note' | 'map' | 'noArmor' | 'noBackpack';

const GLYPH: Partial<Record<ReqTag, Glyph>> = {
  keyItem: 'key',
  power: 'power',
  lever: 'lever',
  pay: 'pay',
  coop: 'coop',
  codeNote: 'note',
  minefieldMap: 'map',
  noArmor: 'noArmor',
  noBackpack: 'noBackpack',
};

const SVG: Record<Glyph, string> = {
  key: keySvg,
  power: lightningSvg,
  lever: toggleSvg,
  pay: rubSvg,
  coop: handshakeSvg,
  note: noteSvg,
  map: mapSvg,
  noArmor: shieldSlashSvg,
  noBackpack: backpackSvg,
};

export type ExitBadge = ({ item: string } | { glyph: Glyph }) & { tag: ReqTag; arg?: string };

/** The pictures for an exit's requirements, once each, in the wiki's order (pure, for tests). */
export function exitBadges(reqs: ExitReqs | null): ExitBadge[] {
  const out: ExitBadge[] = [];
  const seen = new Set<string>();
  for (const { tag, arg } of reqs?.tags ?? []) {
    const item = ITEM[tag];
    const glyph = GLYPH[tag];
    const key = item ?? glyph;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item ? { tag, item, ...(arg ? { arg } : {}) } : { tag, glyph: glyph!, ...(arg ? { arg } : {}) });
  }
  return out;
}

export const itemPicture = (id: string): string => `https://assets.tarkov.dev/${id}-base-image.webp`;

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The badges as markup for a map label; `title` names each one in the player's language. */
export function exitBadgesHtml(badges: ExitBadge[], title: (tag: ReqTag, arg: string) => string): string {
  if (badges.length === 0) return '';
  const parts = badges.map((b) => {
    const name = escapeAttr(title(b.tag, b.arg ?? ''));
    return 'item' in b
      ? `<img class="tc-exit-req tc-exit-req--item tc-exit-req--${b.tag}" src="${itemPicture(b.item)}" alt="${name}" title="${name}" loading="lazy" referrerpolicy="no-referrer" />`
      : `<span class="tc-exit-req tc-exit-req--${b.glyph}" title="${name}">${SVG[b.glyph]}</span>`;
  });
  return `<span class="tc-exit-reqs">${parts.join('')}</span>`;
}
