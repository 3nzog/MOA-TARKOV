// The stops of a raid route for each goal other than quests:
//
//   money     loot areas by estimated roubles: loose spots (the median price of
//             what can spawn there, times the chance something does) plus the
//             containers (lootIntel.ts)
//   hideout   loot areas by the hideout items still missing that can spawn
//             there, plus the containers that hold hideout materials
//   weapons   loot areas by guns, ammo and weapon parts (the chips pick which)
//   scavs     where AI Scavs spawn, by how many spawn points there are
//
// Loot points within ~20 m are one area (one stop). Ids come from the area's
// position, so the same data gives the same stops on every PC of the squad.
import type { Poi } from '../poi/types';
import { cluster } from './cluster';
import { containerIntel } from './lootIntel';
import type { MapLoot } from './lootData';
import type { RouteStop, RouteWho, StopInfo } from './plan';

export type RouteGoal = 'quests' | 'money' | 'hideout' | 'weapons' | 'scavs';
export const ROUTE_GOALS: readonly RouteGoal[] = ['quests', 'money', 'hideout', 'weapons', 'scavs'];
export type LootGoal = 'money' | 'hideout' | 'weapons';
export type WeaponKind = 'guns' | 'ammo' | 'parts';
export const WEAPON_KINDS: readonly WeaponKind[] = ['guns', 'ammo', 'parts'];

/** prices.json per item (only what the route uses). */
export interface ItemPrice {
  /** Flea 24 h average. */
  a?: number;
  /** Best trader sell price. */
  sp?: number;
}

/** A named place on the map (data/snapshot/map-labels.json). */
export interface PlaceLabel {
  t: string;
  x: number;
  z: number;
}

export interface LootContext {
  loot: MapLoot;
  prices: Record<string, ItemPrice>;
  /** Item ids the hideout still needs (hideout goal). */
  hideoutNeeds?: ReadonlySet<string>;
  /** Item kinds from the loot snapshot (g gun, m part, a ammo). */
  itemKinds?: ReadonlyMap<string, string>;
  weaponKinds?: readonly WeaponKind[];
  labels?: PlaceLabel[];
  /** Locked doors: where, and the key's name. */
  locks?: { x: number; z: number; key: string }[];
}

/** The chance that something spawns on a loose-loot spot (the game does not say; an estimate). */
export const LOOSE_CHANCE = 0.3;
/** Loot points this close are one area. */
const AREA_M = 20;
/** A container to search, a loose spot to look at: seconds. */
const SEARCH_S = 6;
const LOOK_S = 2;
const MAX_WORK_S = 120;
/** What an area is called: the nearest named place this close. */
const PLACE_M = 150;
/** A locked door this close to an area may be the way in. */
const LOCK_M = 12;
/** Value of a container that holds hideout materials (in "items" of the hideout goal). */
const CONTAINER_HIDEOUT = 0.5;

export const itemValue = (p: ItemPrice | undefined): number => Math.max(p?.a ?? 0, p?.sp ?? 0);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const WEAPON_LETTER: Record<WeaponKind, string> = { guns: 'g', ammo: 'a', parts: 'm' };

interface Scored {
  x: number;
  z: number;
  y: number;
  score: number;
  container?: string;
  /** Loose spot: the items that make its score, best first. */
  items?: string[];
}

/** One loot point's worth to a goal. */
function scorePoints(goal: LootGoal, ctx: LootContext): Scored[] {
  const out: Scored[] = [];
  const kinds = ctx.weaponKinds?.length ? ctx.weaponKinds : WEAPON_KINDS;
  const letters = new Set(kinds.map((k) => WEAPON_LETTER[k]));
  for (const s of ctx.loot.loose) {
    if (goal === 'money') {
      const priced = s.items.map((id) => ({ id, v: itemValue(ctx.prices[id]) })).filter((p) => p.v > 0);
      const score = LOOSE_CHANCE * median(priced.map((p) => p.v));
      if (score > 0) out.push({ x: s.x, z: s.z, y: s.y, score, items: priced.sort((a, b) => b.v - a.v).map((p) => p.id) });
    } else if (goal === 'hideout') {
      const needed = s.items.filter((id) => ctx.hideoutNeeds?.has(id));
      if (needed.length) out.push({ x: s.x, z: s.z, y: s.y, score: needed.length / s.items.length, items: needed });
    } else {
      const wanted = s.items.filter((id) => letters.has(ctx.itemKinds?.get(id) ?? 'o'));
      if (wanted.length) out.push({ x: s.x, z: s.z, y: s.y, score: wanted.length / s.items.length, items: wanted });
    }
  }
  for (const c of ctx.loot.containers) {
    const intel = containerIntel(c.kind);
    const score =
      goal === 'money'
        ? intel.money
        : goal === 'hideout'
          ? intel.hideout * CONTAINER_HIDEOUT
          : kinds.reduce((sum, k) => sum + intel[k], 0);
    if (score > 0) out.push({ x: c.x, z: c.z, y: c.y, score, container: c.kind });
  }
  return out;
}

function nearestPlace(labels: PlaceLabel[] | undefined, x: number, z: number): string | undefined {
  let best: PlaceLabel | undefined;
  let bestD = PLACE_M;
  for (const l of labels ?? []) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best?.t;
}

function nearLock(locks: LootContext['locks'], x: number, z: number): string | undefined {
  let best: string | undefined;
  let bestD = LOCK_M;
  for (const l of locks ?? []) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < bestD) {
      bestD = d;
      best = l.key;
    }
  }
  return best;
}

/** Stops of a loot goal: the `max` best areas of the map, worth something to it. */
export function lootStops(goal: LootGoal, ctx: LootContext, who: RouteWho[], max = 60): RouteStop[] {
  const scored = scorePoints(goal, ctx);
  const areas = cluster(scored, AREA_M, (p) => p.score)
    .map((a) => {
      const containers: Record<string, number> = {};
      let loose = 0;
      const items = new Map<string, number>();
      for (const m of a.members) {
        if (m.container) containers[m.container] = (containers[m.container] ?? 0) + 1;
        else loose += 1;
        m.items?.slice(0, 3).forEach((id, rank) => items.set(id, (items.get(id) ?? 0) + m.score / (rank + 1)));
      }
      const nContainers = Object.values(containers).reduce((s, n) => s + n, 0);
      const info: StopInfo = {
        kind: 'loot',
        containers,
        loose,
        items: [...items.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4).map(([id]) => id),
        place: nearestPlace(ctx.labels, a.x, a.z),
        key: nearLock(ctx.locks, a.x, a.z),
        roubles: goal === 'money' ? Math.round(a.w) : undefined,
      };
      const stop: RouteStop = {
        id: `loot:${Math.round(a.x)}:${Math.round(a.z)}`,
        x: a.x,
        y: median(a.members.map((m) => m.y)),
        z: a.z,
        items: [],
        who,
        work: Math.min(MAX_WORK_S, nContainers * SEARCH_S + loose * LOOK_S),
        value: a.w,
        info,
      };
      return stop;
    })
    .sort((p, q) => (q.value ?? 0) - (p.value ?? 0))
    .slice(0, max);
  return areas.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

/** Where AI Scavs spawn: bot spawn points (Scav snipers left out), grouped. */
export function scavStops(pois: Poi[], who: RouteWho[], labels?: PlaceLabel[], max = 40): RouteStop[] {
  const bots = pois.filter((p) => {
    if (p.category !== 'spawn' && p.category !== 'boss') return false;
    const cats = ((p.meta as { categories?: string[] } | undefined)?.categories ?? []).map((c) => c.toLowerCase());
    return cats.includes('bot') && !cats.includes('sniper');
  });
  const groups = cluster(
    bots.map((p) => ({ x: p.position.x, z: p.position.z, y: p.position.y, boss: p.category === 'boss' })),
    40,
  );
  return groups
    .map((g) => ({
      id: `scavs:${Math.round(g.x)}:${Math.round(g.z)}`,
      x: g.x,
      y: median(g.members.map((m) => m.y)),
      z: g.z,
      items: [],
      who,
      work: 45,
      value: g.members.length,
      info: { kind: 'scavs', spawns: g.members.length, boss: g.members.some((m) => m.boss), place: nearestPlace(labels, g.x, g.z) } as StopInfo,
    }))
    .sort((p, q) => q.value - p.value)
    .slice(0, max)
    .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}
