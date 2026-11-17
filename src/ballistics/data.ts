// Ballistics: every cartridge's numbers and the guns that fire it
// (data/snapshot/ammo.json, from tarkov.dev; names and prices from the other
// bundled snapshots). Pure helpers here; the panel is BallisticsPanel.tsx.

export interface AmmoStats {
  /** Caliber id ("Caliber556x45NATO"). */
  c: string;
  d?: number; // damage (per pellet for buckshot)
  p?: number; // penetration
  a?: number; // armor damage %
  f?: number; // fragmentation chance 0-1
  v?: number; // muzzle velocity m/s
  n?: number; // pellets (buckshot)
  t?: boolean; // tracer
  lb?: number; // light bleed modifier
  hb?: number; // heavy bleed modifier
  acc?: number;
  rec?: number;
  g?: boolean; // grenade / launcher round
}

export interface AmmoData {
  generatedAt: string;
  ammo: Record<string, AmmoStats>;
  weapons: Record<string, { c: string; ammo: string[] }>;
}

let dataPromise: Promise<AmmoData> | null = null;
export function loadAmmoData(): Promise<AmmoData> {
  dataPromise ??= import('../../data/snapshot/ammo.json').then((m) => (m as { default: AmmoData }).default);
  return dataPromise;
}

/** item id → [full name, short name] */
export type Names = Record<string, [string, string?] | string[]>;

/**
 * How well a cartridge goes through armor of class 1-6 (fresh armor), from
 * its penetration: the rule of thumb players use, not a full simulation.
 * 4 = goes through easily, 0 = barely or not at all.
 */
export function classEffect(pen: number | undefined, armorClass: number): 0 | 1 | 2 | 3 | 4 {
  const p = pen ?? 0;
  const t = armorClass * 10;
  if (p >= t + 10) return 4;
  if (p >= t) return 3;
  if (p >= t - 5) return 2;
  if (p >= t - 15) return 1;
  return 0;
}

/** "5.56x45mm M855" → "5.56x45mm": a readable caliber from its cartridges' names. */
export function caliberLabel(caliber: string, data: AmmoData, names: Names): string {
  const counts = new Map<string, number>();
  for (const [id, a] of Object.entries(data.ammo)) {
    if (a.c !== caliber) continue;
    const full = names[id]?.[0];
    const head = full?.split(' ')[0];
    if (head && /\d/.test(head)) counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  return best ?? caliber.replace(/^Caliber/, '');
}

/** Lower-case, no accents, only letters/digits/dots/x (so "5.56x45" survives). */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .trim();
}

export interface SearchHit {
  kind: 'weapon' | 'caliber' | 'ammo';
  id: string;
  label: string;
}

/** Weapons, calibers and cartridges whose names contain every word typed. */
export function search(query: string, data: AmmoData, names: Names, limit = 40): SearchHit[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const hit = (s: string) => {
    const n = norm(s);
    return words.every((w) => n.includes(w));
  };
  const out: SearchHit[] = [];
  const calibers = new Set<string>();
  for (const id of Object.keys(data.weapons)) {
    const [full, short] = names[id] ?? [];
    if (full && (hit(full) || (short && hit(short)))) out.push({ kind: 'weapon', id, label: full });
  }
  for (const [id, a] of Object.entries(data.ammo)) {
    const full = names[id]?.[0];
    if (!full) continue;
    const cal = caliberLabel(a.c, data, names);
    if (hit(cal) && !calibers.has(a.c)) {
      calibers.add(a.c);
      out.push({ kind: 'caliber', id: a.c, label: cal });
    }
    if (hit(full)) out.push({ kind: 'ammo', id, label: full });
  }
  const rank = { weapon: 0, caliber: 1, ammo: 2 };
  return out.sort((x, y) => rank[x.kind] - rank[y.kind] || x.label.localeCompare(y.label)).slice(0, limit);
}

/** The cartridges to list for a pick: a gun's accepted ones, a caliber's, or one cartridge's caliber. */
export function ammoFor(pick: SearchHit, data: AmmoData): string[] {
  if (pick.kind === 'weapon') return data.weapons[pick.id]?.ammo ?? [];
  const cal = pick.kind === 'caliber' ? pick.id : data.ammo[pick.id]?.c;
  return Object.entries(data.ammo)
    .filter(([, a]) => a.c === cal)
    .map(([id]) => id);
}

/** What one round costs: on the flea when it is sold there, else from the trader. */
export interface RoundPrice {
  price: number;
  source: 'flea' | 'trader' | null;
  trader?: string;
  level?: number;
  /** Your loyalty with that trader is too low to buy it (when you told MoA your levels). */
  locked: boolean;
}

export function roundPrice(
  p: { a?: number; l?: number; bt?: string; bp?: number; bl?: number; nf?: boolean } | undefined,
  traderLevels: Record<string, number> | null,
): RoundPrice {
  const flea = p && !p.nf ? (p.a ?? p.l ?? 0) : 0;
  const trader = p?.bp ?? 0;
  const locked = !!(traderLevels && p?.bt && (traderLevels[p.bt] ?? 0) < (p.bl ?? 1));
  // The trader when you can buy there and it is not dearer than the flea.
  if (trader > 0 && !locked && (flea <= 0 || trader <= flea)) return { price: trader, source: 'trader', trader: p!.bt, level: p!.bl, locked: false };
  if (flea > 0) return { price: flea, source: 'flea', locked: false };
  if (trader > 0) return { price: trader, source: 'trader', trader: p!.bt, level: p!.bl, locked: true };
  return { price: 0, source: null, locked: false };
}

export interface ValuePick {
  id: string;
  price: number;
}

/**
 * Best value against armor of `armorClass`: the cheapest cartridge (with a
 * market price) that goes through it ("3" or better on classEffect), and the
 * cheapest that goes through it easily ("4"), when that is a different one.
 * Cartridges with no market price (flea-banned, unknown) are left out.
 */
export function bestValue(
  ids: string[],
  data: AmmoData,
  priceOf: (id: string) => number,
  armorClass: number,
): { through: ValuePick | null; easily: ValuePick | null } {
  const cheapest = (min: number): ValuePick | null => {
    let best: ValuePick | null = null;
    for (const id of ids) {
      const a = data.ammo[id];
      const price = priceOf(id);
      if (!a || a.g || price <= 0 || classEffect(a.p, armorClass) < min) continue;
      // Cheaper wins; at the same price, the one that goes through better.
      if (!best || price < best.price || (price === best.price && (a.p ?? 0) > (data.ammo[best.id].p ?? 0))) best = { id, price };
    }
    return best;
  };
  const through = cheapest(3);
  const easily = cheapest(4);
  return { through, easily: easily && easily.id !== through?.id ? easily : null };
}

/**
 * Cartridges named on a screenshot (the flea market's ammo list, a stash…):
 * full names in the OCR'd lines, the longest one per line ("M855A1" before
 * "M855").
 */
export function ammoFromScreen(lines: string[], data: AmmoData, names: Names): string[] {
  const cands = Object.keys(data.ammo)
    .map((id) => ({ id, n: norm(names[id]?.[0] ?? '') }))
    .filter((c) => c.n.length >= 6)
    .sort((a, b) => b.n.length - a.n.length);
  const found: string[] = [];
  for (const line of lines) {
    const l = ` ${norm(line)} `;
    const c = cands.find((x) => l.includes(` ${x.n} `));
    if (c && !found.includes(c.id)) found.push(c.id);
  }
  return found;
}
