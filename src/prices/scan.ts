// Price check from a screenshot. The Rust side OCRs the whole picture and
// sends every line with its words' positions; this file finds item names in it:
//
//  - Hovered item: the tooltip writes the item's FULL name. A line (or a run of
//    words) that is exactly an item's full name means "this item".
//  - Inventory: every cell shows the item's SHORT name. Runs of 1-3 words that
//    are exactly a short name are counted.
//
// Precision first: names must match exactly once OCR's usual mix-ups are
// folded (5/S, 0/O, 1/I/l, 8/B), and a name several items share is reported as
// uncertain with all its candidates instead of guessed.
import { normalizeText } from '../poi/extractPanel';

export interface ScreenWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ScreenLine {
  text: string;
  words: ScreenWord[];
}
export interface ScreenText {
  width: number;
  height: number;
  lines: ScreenLine[];
}

/** item id → [full name, short name] */
export type ItemNames = Record<string, [string] | [string, string]>;

export interface ItemIndex {
  full: Map<string, string[]>;
  short: Map<string, string[]>;
}

// OCR mix-ups on the game's font, folded to one form on both sides.
const FOLD: Record<string, string> = { '0': 'o', '1': 'i', l: 'i', '5': 's', '8': 'b', '|': 'i' };

/** Comparable form: accents and case gone, look-alike characters folded, no spaces. */
export function skeleton(s: string): string {
  return normalizeText(s)
    .replace(/[0158l|]/g, (c) => FOLD[c] ?? c)
    .replace(/\s+/g, '');
}

function add(map: Map<string, string[]>, key: string, id: string) {
  const list = map.get(key);
  if (!list) map.set(key, [id]);
  else if (!list.includes(id)) list.push(id);
}

/** Index item names from one or more languages (the game's, plus English, which the game leaves on many items). */
export function buildIndex(...langs: ItemNames[]): ItemIndex {
  const full = new Map<string, string[]>();
  const short = new Map<string, string[]>();
  for (const names of langs) {
    for (const [id, n] of Object.entries(names)) {
      const f = skeleton(n[0]);
      if (f.length >= 6) add(full, f, id);
      const s = skeleton(n[1] ?? n[0]);
      // Two-letter short names collide with stray UI text too easily.
      if (s.length >= 3) add(short, s, id);
    }
  }
  return { full, short };
}

export interface Found {
  /** One id when certain; several when the name is shared (uncertain). */
  ids: string[];
  x: number;
  y: number;
}

/** Runs of `min..max` consecutive words of a line, longest first. */
function* windows(line: ScreenLine, min: number, max: number) {
  const n = line.words.length;
  for (let len = Math.min(max, n); len >= min; len--) {
    for (let i = 0; i + len <= n; i++) yield { i, len, words: line.words.slice(i, i + len) };
  }
}

/** Items whose full name is written somewhere on the screen (the hovered item's tooltip). */
export function findHovered(text: ScreenText, index: ItemIndex): Found[] {
  const out: Found[] = [];
  const seen = new Set<string>();
  // A full name that is also a cell's short name ("Paracord") proves nothing.
  const full = (key: string) => (index.short.has(key) ? undefined : index.full.get(key));
  for (const line of text.lines) {
    const whole = full(skeleton(line.text));
    const hits: { ids: string[]; at: ScreenWord }[] = [];
    if (whole && line.words[0]) hits.push({ ids: whole, at: line.words[0] });
    else {
      const used = new Set<number>();
      for (const w of windows(line, 2, 10)) {
        if (w.words.some((_, k) => used.has(w.i + k))) continue;
        const ids = full(skeleton(w.words.map((x) => x.text).join(' ')));
        if (!ids) continue;
        for (let k = 0; k < w.len; k++) used.add(w.i + k);
        hits.push({ ids, at: w.words[0] });
      }
    }
    for (const h of hits) {
      const key = h.ids.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ids: h.ids, x: h.at.x, y: h.at.y });
    }
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** The ids of every key, merged; null when they are too many to call it a read. */
function merge(index: ItemIndex, keys: string[], max = 3): string[] | null {
  const ids = [...new Set(keys.flatMap((k) => index.short.get(k) ?? []))];
  return ids.length > 0 && ids.length <= max ? ids : null;
}

/**
 * What a run of words on a cell is, most certain first:
 *  1. exactly a short name;
 *  2. the start of one (the game cuts long names to fit the cell: "Analgésic");
 *  3. one character off (OCR misread one glyph: "EXPSS" for EXPS3).
 * 2 and 3 only for 5+ characters, and only when the candidates are few.
 */
export function matchShort(index: ItemIndex, raw: string): string[] | null {
  const k = skeleton(raw);
  if (k.length < 3) return null;
  const exact = index.short.get(k);
  if (exact) return exact;
  if (k.length < 5) return null;
  const keys = [...index.short.keys()];
  const prefix = keys.filter((key) => key.length > k.length && key.startsWith(k));
  if (prefix.length > 0) return merge(index, prefix);
  const near = keys.filter((key) => Math.abs(key.length - k.length) <= 1 && levenshtein(key, k) === 1);
  return near.length > 0 ? merge(index, near) : null;
}

/**
 * Short names on the screen (inventory cells): each occurrence counts once.
 * Left to right, the longest run of words that reads as a name wins, so
 * "Leite con" (cut) is not taken as a shorter name it starts with.
 */
export function findShortNames(text: ScreenText, index: ItemIndex): Found[] {
  const out: Found[] = [];
  // The game's menu bars (top tabs, bottom buttons such as "MANUAL") are not items.
  const inMenus = (y: number) => text.height > 0 && (y < text.height * 0.045 || y > text.height * 0.955);
  for (const line of text.lines) {
    const ws = line.words.filter((w) => !inMenus(w.y));
    for (let i = 0; i < ws.length; ) {
      let step = 1;
      for (let len = Math.min(3, ws.length - i); len >= 1; len--) {
        const ids = matchShort(index, ws.slice(i, i + len).map((x) => x.text).join(' '));
        if (!ids) continue;
        out.push({ ids, x: ws[i].x, y: ws[i].y });
        step = len;
        break;
      }
      i += step;
    }
  }
  return out;
}

/** How many separate rows the hits sit on (rows closer than `gap` px merge). */
export function rowCount(found: Found[], gap = 24): number {
  const ys = found.map((f) => f.y).sort((a, b) => a - b);
  let rows = 0;
  let last = -Infinity;
  for (const y of ys) {
    if (y - last > gap) rows++;
    last = y;
  }
  return rows;
}

export type ScanResult =
  | { mode: 'hovered'; items: Found[] }
  | { mode: 'inventory'; items: { ids: string[]; count: number }[]; total: number }
  | null;

/**
 * What the screenshot was: a hovered item (its full name is on screen), an
 * inventory (short names on 2+ rows; the in-raid hotbar is a single row and
 * would otherwise open a list on every map screenshot), or neither.
 */
export function scanScreen(text: ScreenText, index: ItemIndex, tradable?: (id: string) => boolean): ScanResult {
  // A shared name narrows to the variants that are actually bought and sold;
  // if one is left, it is that one.
  const narrow = (f: Found): Found => {
    if (!tradable || f.ids.length < 2) return f;
    const real = f.ids.filter(tradable);
    return real.length > 0 ? { ...f, ids: real } : f;
  };
  const hovered = findHovered(text, index).map(narrow);
  if (hovered.length > 0 && hovered.length <= 3) return { mode: 'hovered', items: hovered };
  const shorts = findShortNames(text, index).map(narrow);
  if (shorts.length < 2 || rowCount(shorts) < 2) return null;
  const byKey = new Map<string, { ids: string[]; count: number }>();
  for (const f of shorts) {
    const key = f.ids.join(',');
    const cur = byKey.get(key);
    if (cur) cur.count++;
    else byKey.set(key, { ids: f.ids, count: 1 });
  }
  return { mode: 'inventory', items: [...byKey.values()], total: shorts.length };
}
