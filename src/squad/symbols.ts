// The symbol each player picks to mark themselves on the map. It rides along in
// the party's position messages (an optional field the relays pass through
// untouched), so squadmates see it too; an older MoA without it just keeps
// drawing the plain arrow. Icons: Phosphor (MIT), fill weight.
import { useSyncExternalStore } from 'react';
import crosshair from '@phosphor-icons/core/assets/fill/crosshair-fill.svg?raw';
import skull from '@phosphor-icons/core/assets/fill/skull-fill.svg?raw';
import lightning from '@phosphor-icons/core/assets/fill/lightning-fill.svg?raw';
import star from '@phosphor-icons/core/assets/fill/star-fill.svg?raw';
import shield from '@phosphor-icons/core/assets/fill/shield-fill.svg?raw';
import flame from '@phosphor-icons/core/assets/fill/flame-fill.svg?raw';
import ghost from '@phosphor-icons/core/assets/fill/ghost-fill.svg?raw';
import paw from '@phosphor-icons/core/assets/fill/paw-print-fill.svg?raw';
import diamond from '@phosphor-icons/core/assets/fill/diamond-fill.svg?raw';
import crown from '@phosphor-icons/core/assets/fill/crown-fill.svg?raw';
import target from '@phosphor-icons/core/assets/fill/target-fill.svg?raw';
import sword from '@phosphor-icons/core/assets/fill/sword-fill.svg?raw';
import bomb from '@phosphor-icons/core/assets/fill/bomb-fill.svg?raw';
import biohazard from '@phosphor-icons/core/assets/fill/biohazard-fill.svg?raw';
import radioactive from '@phosphor-icons/core/assets/fill/radioactive-fill.svg?raw';
import alien from '@phosphor-icons/core/assets/fill/alien-fill.svg?raw';
import rocket from '@phosphor-icons/core/assets/fill/rocket-fill.svg?raw';
import heart from '@phosphor-icons/core/assets/fill/heart-fill.svg?raw';
import spade from '@phosphor-icons/core/assets/fill/spade-fill.svg?raw';
import snowflake from '@phosphor-icons/core/assets/fill/snowflake-fill.svg?raw';
import moon from '@phosphor-icons/core/assets/fill/moon-fill.svg?raw';
import knife from '@phosphor-icons/core/assets/fill/knife-fill.svg?raw';
import fist from '@phosphor-icons/core/assets/fill/hand-fist-fill.svg?raw';
import anchor from '@phosphor-icons/core/assets/fill/anchor-fill.svg?raw';

export const PLAYER_SYMBOLS: { id: string; svg: string }[] = [
  { id: 'crosshair', svg: crosshair },
  { id: 'skull', svg: skull },
  { id: 'lightning', svg: lightning },
  { id: 'star', svg: star },
  { id: 'shield', svg: shield },
  { id: 'flame', svg: flame },
  { id: 'ghost', svg: ghost },
  { id: 'paw', svg: paw },
  { id: 'diamond', svg: diamond },
  { id: 'crown', svg: crown },
  { id: 'target', svg: target },
  { id: 'sword', svg: sword },
  { id: 'bomb', svg: bomb },
  { id: 'biohazard', svg: biohazard },
  { id: 'radioactive', svg: radioactive },
  { id: 'alien', svg: alien },
  { id: 'rocket', svg: rocket },
  { id: 'heart', svg: heart },
  { id: 'spade', svg: spade },
  { id: 'snowflake', svg: snowflake },
  { id: 'moon', svg: moon },
  { id: 'knife', svg: knife },
  { id: 'fist', svg: fist },
  { id: 'anchor', svg: anchor },
];

/** "arrow" = the classic heading arrow with no symbol. */
export const ARROW_SYMBOL = 'arrow';
export const DEFAULT_SYMBOL = 'crosshair';

const BY_ID = new Map(PLAYER_SYMBOLS.map((s) => [s.id, s.svg]));

/** A known symbol id, or null (unknown ids from other versions fall back to the arrow). */
export function knownSymbol(id: unknown): string | null {
  return typeof id === 'string' && (id === ARROW_SYMBOL || BY_ID.has(id)) ? id : null;
}

/** The symbol's SVG markup (trusted: bundled assets only), or null for the arrow. */
export function symbolSvg(id: string | null | undefined): string | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/**
 * Marker HTML shared by the player, squadmate and minimap markers: the heading
 * part (view cone + pointer, rotated by the caller through `.tc-mk__dir`) and an
 * upright disc with the symbol. With the arrow symbol it is the classic arrow.
 */
export function markerHtml(
  symbol: string | null | undefined,
  color: string,
  opts: { ping?: string; after?: string } = {},
): string {
  const svg = symbolSvg(symbol);
  const dir = svg
    ? '<div class="tc-mk__dir"><div class="tc-mk__cone"></div><div class="tc-mk__pointer"></div></div>'
    : '<div class="tc-mk__dir"><div class="tc-mk__cone"></div><svg class="tc-mk__arrow" viewBox="0 0 24 24"><path d="M12 2.2 20.8 21.2 12 16.4 3.2 21.2Z"/></svg></div>';
  const disc = svg ? `<div class="tc-mk__disc">${svg}</div>` : '';
  const ping = opts.ping ?? '<div class="tc-mk__ping"></div>';
  return `<div class="tc-mk${svg ? '' : ' tc-mk--arrow'}" style="--c:${color}">${ping}${dir}${disc}${opts.after ?? ''}</div>`;
}

// ---- This player's own choice (per PC) -------------------------------------
const KEY = 'tc_player_symbol_v1';

function load(): string {
  try {
    return knownSymbol(localStorage.getItem(KEY)) ?? DEFAULT_SYMBOL;
  } catch {
    return DEFAULT_SYMBOL;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSelfSymbol(): string {
  return current;
}

export function setSelfSymbol(id: string): void {
  const next = knownSymbol(id);
  if (!next || next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = load();
    for (const l of listeners) l();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSelfSymbol(): string {
  return useSyncExternalStore(subscribe, getSelfSymbol, getSelfSymbol);
}
