// Matches the text read from an O+O screenshot (see src-tauri/src/extract_panel.rs)
// against the map's extract and transit POIs. The game lists exactly the exits
// open to this player in this raid, so a match narrows the map to those.
//
// OCR mangles the row codes ("EXFIL01" → "EXFILOI", "SAIR01" → "SAIRM") but
// reads the names well, and tarkov.dev's localized names are the game's own
// strings, so names are matched and codes ignored. Small OCR slips are allowed
// for by a similarity threshold on longer names.
import { canonicalMapId } from '../map/canonicalMap';
import type { Poi } from './types';

/** Names of each exit in every language, keyed by Poi id (see getExitAliases). */
export type ExitAliases = Record<string, string[]>;

/** Lower-case, accents off, anything but letters/digits → single spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

const MIN_FUZZY_LENGTH = 6;
const MIN_SIMILARITY = 0.82;

/** Does this OCR line carry `name` (both normalized)? Exact containment, else a close suffix. */
function lineHasName(line: string, name: string): boolean {
  if (!name) return false;
  if (` ${line} `.includes(` ${name} `)) return true;
  if (name.length < MIN_FUZZY_LENGTH) return false;
  // The name sits at the end of its row, after the code. Compare it with the
  // line's tail of the same word count (and one word either side, for OCR
  // splitting or merging a word).
  const words = line.split(' ');
  const n = name.split(' ').length;
  for (const k of [n, n - 1, n + 1]) {
    if (k < 1 || k > words.length) continue;
    const tail = words.slice(words.length - k).join(' ');
    const sim = 1 - levenshtein(tail, name) / Math.max(tail.length, name.length);
    if (sim >= MIN_SIMILARITY) return true;
  }
  return false;
}

export interface PanelMatch {
  /** POI ids of the exits listed (extracts and transits). */
  ids: Set<string>;
  /** OCR lines that matched nothing (shown for transparency, never guessed at). */
  unmatched: string[];
}

/**
 * Match OCR lines to the map's extract / transit POIs. Returns null when fewer
 * than two exits matched: every raid has at least two, so fewer means the
 * screenshot was not of the O+O list (or of a different map).
 */
export function matchExtractPanel(lines: string[], pois: Poi[], aliases: ExitAliases = {}): PanelMatch | null {
  // Keep line indexes aligned with `lines` (empty lines just never match).
  const norm = lines.map(normalizeText);
  const extracts = pois.filter((p) => p.category === 'extract');
  const transits = pois.filter((p) => p.category === 'transit');
  const ids = new Set<string>();
  const used = new Set<number>();
  const namesOf = (p: Poi, own: string): string[] =>
    [...new Set([own, ...(aliases[p.id] ?? [])].map(normalizeText).filter((n) => n.length > 0))];

  // Longest names first, so "Scav Checkpoint (Co-op)" is not eaten by a shorter name it contains.
  const candidates = extracts
    .map((p) => ({ p, names: namesOf(p, p.label) }))
    .sort((a, b) => Math.max(0, ...b.names.map((n) => n.length)) - Math.max(0, ...a.names.map((n) => n.length)));
  for (const { p, names } of candidates) {
    const hit = norm.findIndex((l, i) => !used.has(i) && l.length > 0 && names.some((n) => lineHasName(l, n)));
    if (hit >= 0) {
      ids.add(p.id);
      used.add(hit);
    }
  }
  // Transit rows read "<travel to> <map name>"; the destination's name identifies them.
  for (const p of transits) {
    const raw = [String((p.meta as { destMapName?: string } | undefined)?.destMapName ?? ''), ...(aliases[p.id] ?? [])];
    // The game writes the plain map name: "Ground Zero", not "Ground Zero 21+";
    // "The Lab", not "The Lab (Dark)".
    const plain = raw.map((n) => n.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\d+\+\s*$/, ''));
    const dests = [...new Set([...raw, ...plain].map(normalizeText).filter((n) => n.length > 0))];
    if (dests.length === 0) continue;
    const hit = norm.findIndex((l, i) => !used.has(i) && dests.some((d) => ` ${l} `.includes(` ${d} `)));
    if (hit >= 0) {
      ids.add(p.id);
      used.add(hit);
    }
  }
  if (ids.size < 2) return null;
  const unmatched = lines.filter((_, i) => !used.has(i) && normalizeText(lines[i]).split(' ').length > 1);
  return { ids, unmatched };
}

/**
 * Which map the O+O list belongs to: every map is tried and the one with the
 * most exits matched wins; on a tie, `prefer` (the raid's or the shown map).
 */
export function findPanelMap(
  lines: string[],
  poisByMapId: Record<string, Poi[]>,
  aliases: ExitAliases,
  prefer: string | null,
): { mapId: string; match: PanelMatch } | null {
  const preferred = prefer ? canonicalMapId(prefer) : null;
  let best: { mapId: string; match: PanelMatch } | null = null;
  for (const [mapId, pois] of Object.entries(poisByMapId)) {
    const match = matchExtractPanel(lines, pois, aliases);
    if (!match) continue;
    const better =
      !best ||
      match.ids.size > best.match.ids.size ||
      (match.ids.size === best.match.ids.size && canonicalMapId(mapId) === preferred);
    if (better) best = { mapId, match };
  }
  return best;
}

