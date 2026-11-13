// Which exits are the player's own in this raid, for the map and the minimap:
// "mine" draws as usual, "other" (the other side's, or not in the O+O list)
// draws faded, or not at all if the player turned the others off.
//
// What decides, strongest first:
//  1. The O+O list read this raid: exactly those exits are mine.
//  2. The side (PMC / Scav): shared exits, transits and that side's exits.
//  3. In a raid with the side still unknown: nothing is sure, all faded.
//  Outside a raid (planning): all mine, as on any map.
import { normalizeText, type ExitAliases } from './extractPanel';
import type { Poi } from './types';

export type ExitTier = 'mine' | 'other';
export type RaidSide = 'pmc' | 'scav';

const factionOf = (p: Poi): string =>
  String((p.meta as { faction?: string } | undefined)?.faction ?? 'shared').toLowerCase();

export function exitTier(
  p: Poi,
  side: RaidSide | null,
  panelIds: ReadonlySet<string> | null,
  inRaid: boolean,
): ExitTier | null {
  if (p.category !== 'extract' && p.category !== 'transit') return null;
  if (panelIds) return panelIds.has(p.id) ? 'mine' : 'other';
  if (side) {
    if (p.category === 'transit') return 'mine';
    const f = factionOf(p);
    return f === 'shared' || f === side ? 'mine' : 'other';
  }
  return inRaid ? 'other' : 'mine';
}

/**
 * The side an O+O list proves: PMC-only and Scav-only exits never appear in
 * the other side's list. Only exits whose name no exit of the other side on
 * the same map shares, in any language, count: an OCR line that could be
 * either proves nothing. (Customs: the PMC "Cruzamento" and the Scav
 * "Encruzilhada" are both "Crossroads" in English.) Both kinds found (a
 * misread): no answer.
 */
export function sideFromPanel(ids: ReadonlySet<string>, mapPois: Poi[], aliases: ExitAliases = {}): RaidSide | null {
  const extracts = mapPois.filter((p) => p.category === 'extract');
  const clean = (n: string) => normalizeText(n).replace(/\s*co op$/, '');
  const namesOf = new Map(extracts.map((p) => [p.id, new Set([p.label, ...(aliases[p.id] ?? [])].map(clean).filter(Boolean))]));
  let pmc = 0;
  let scav = 0;
  for (const p of extracts) {
    if (!ids.has(p.id)) continue;
    const f = factionOf(p);
    if (f !== 'pmc' && f !== 'scav') continue;
    const mine = namesOf.get(p.id)!;
    const ambiguous = extracts.some(
      (o) => o.id !== p.id && factionOf(o) !== f && [...namesOf.get(o.id)!].some((n) => mine.has(n)),
    );
    if (ambiguous) continue;
    if (f === 'pmc') pmc += 1;
    else scav += 1;
  }
  if (pmc > 0 && scav === 0) return 'pmc';
  if (scav > 0 && pmc === 0) return 'scav';
  return null;
}
