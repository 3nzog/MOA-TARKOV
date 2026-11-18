// What an exit asks for, from the wiki's extraction table ("Requirements"
// column, in English): turned into short tags the app shows in the player's
// language (paracord, ice pick, no armour, no backpack, green flare, a code
// note, the minefield map, power, a lever, co-op, paying), with the wiki's
// own words kept for the details.
import { useEffect, useMemo, useState } from 'react';
import { fetchWikiExtracts, findWikiExtract, type WikiExtract } from './wikiExtracts';

export type ReqTag =
  | 'paracord'
  | 'redRebel'
  | 'noArmor'
  | 'noBackpack'
  | 'flareZone'
  | 'greenFlare'
  | 'redFlare'
  | 'codeNote'
  | 'minefieldMap'
  | 'coop'
  | 'pay'
  | 'power'
  | 'lever'
  | 'keyItem'
  | 'notAlways'
  | 'singleUse'
  | 'other';

export interface ExitReqs {
  tags: { tag: ReqTag; arg?: string }[];
  /** The wiki's words ("" when it lists nothing). */
  text: string;
}

const RULES: [RegExp, ReqTag][] = [
  [/paracord/i, 'paracord'],
  [/red rebel|ice pick/i, 'redRebel'],
  [/no (body )?armou?r/i, 'noArmor'],
  [/no backpack/i, 'noBackpack'],
  [/signal flare area|shoot a green flare/i, 'flareZone'],
  [/green flare/i, 'greenFlare'],
  [/red flare/i, 'redFlare'],
  [/minefield map/i, 'minefieldMap'],
  [/scav \+ pmc|co-?op/i, 'coop'],
  [/per player|roubles|₽|\bpay/i, 'pay'],
  [/\bpower\b/i, 'power'],
  [/lever|button|switch|urinal/i, 'lever'],
  [/keycard|\bkey\b|utility plan/i, 'keyItem'],
];

/** The tags for one exit's wiki row (pure, for tests). */
export function exitReqs(row: Pick<WikiExtract, 'requirements' | 'always' | 'singleUse'> | null): ExitReqs | null {
  if (!row) return null;
  const text = (row.requirements ?? '').trim();
  const real = text && text !== '-' ? text : '';
  const tags: ExitReqs['tags'] = [];
  const code = /code word ([\p{L}\p{N}-]+)/iu.exec(real);
  if (code) tags.push({ tag: 'codeNote', arg: code[1] });
  for (const [re, tag] of RULES) {
    // "Shoot a green flare … flare area" is the flare zone, not "green flare = open".
    if (tag === 'greenFlare' && tags.some((x) => x.tag === 'flareZone')) continue;
    if (re.test(real) && !tags.some((x) => x.tag === tag)) tags.push({ tag });
  }
  if (real && tags.length === 0) tags.push({ tag: 'other' });
  if (row.always === false) tags.push({ tag: 'notAlways' });
  if (row.singleUse === true) tags.push({ tag: 'singleUse' });
  return tags.length === 0 ? null : { tags, text: real };
}

/** The exits' requirements on a map (from the wiki, cached a few days); a lookup by any of an exit's names (null: no wiki row). */
export function useExitReqs(mapId: string | null): ((names: string[]) => ExitReqs | null) | null {
  const [rows, setRows] = useState<{ mapId: string; rows: WikiExtract[] } | null>(null);
  useEffect(() => {
    if (!mapId) return;
    let alive = true;
    fetchWikiExtracts(mapId)
      .then((r) => alive && setRows({ mapId, rows: r }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mapId]);
  // null: the wiki has no row for that exit; a row asking for nothing gives no tags.
  return useMemo(
    () =>
      rows && rows.mapId === mapId
        ? (names: string[]) => {
            const row = findWikiExtract(rows.rows, names);
            return row ? (exitReqs(row) ?? { tags: [], text: '' }) : null;
          }
        : null,
    [rows, mapId],
  );
}

/** The tags in the player's language (one short line per tag). */
export function reqLabels(reqs: ExitReqs | null, t: (key: string, opts?: Record<string, unknown>) => string): string[] {
  return reqs ? reqs.tags.map((x) => t(`exitReq.${x.tag}`, { arg: x.arg ?? '' })) : [];
}
