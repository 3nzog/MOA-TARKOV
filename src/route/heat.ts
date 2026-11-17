// Hot zones: where other players (and the dangerous AI) are likely to be, at a
// given moment of the raid. An ESTIMATE built from fixed map data — nobody's
// real position is known:
//
//   PMC spawns        busy in the first minutes, empty after ~8
//   loot hubs         rushed from the first minute to ~15, quieter later
//   exits / transits  quiet early, busy in the last third of the raid
//   boss areas        always (the boss, the guards, the players hunting them)
//   Scav snipers      always; the ones on the map's edge too (crossing it)
//   minefields        always, and the worst
//   mounted guns, BTR always, a little
//
// heatAt sums the sources around a point: 0 is quiet, 0.5 is hot (HOT),
// 0.9 very hot, 2 the most (inside a minefield).
import type { Poi } from '../poi/types';
import { sniperSpots } from '../poi/sniper';
import { cluster, type XZ } from './cluster';
import { containerIntel } from './lootIntel';
import type { ContainerSpot } from './lootData';

export type HeatKind = 'spawn' | 'loot' | 'boss' | 'extract' | 'transit' | 'sniper' | 'edge' | 'mine' | 'gun' | 'btr';

export interface HeatSource extends XZ {
  kind: HeatKind;
  /** Reach, metres. */
  r: number;
  /** Strength at the centre (before the time of the raid is applied). */
  w: number;
  label?: string;
  /** Minefields: the area itself. */
  outline?: XZ[];
}

/** From this level a place counts as hot (⚠, the sound, the % of the route). */
export const HOT = 0.5;
export const VERY_HOT = 0.9;
export const MAX_HEAT = 2;

const ROUBLE_SCALE = 400_000;
/** The busiest loot hubs of a map that count as hot. */
const LOOT_HUBS = 12;

/** How busy a kind of place is `t` seconds into a raid of `raid` seconds (0–1). */
export function timeFactor(kind: HeatKind, t: number, raid: number): number {
  const f = raid > 0 ? t / raid : 0;
  switch (kind) {
    case 'spawn':
      // Everyone leaves their spawn in the first minutes.
      return t <= 180 ? 1 : t >= 480 ? 0 : 1 - (t - 180) / 300;
    case 'loot':
      if (t < 60) return 0.6 + (0.4 * t) / 60;
      if (t <= 900) return 1;
      return t >= 1500 ? 0.35 : 1 - (0.65 * (t - 900)) / 600;
    case 'extract':
    case 'transit':
      if (f <= 0.4) return 0.2;
      return f >= 0.7 ? 1 : 0.2 + (0.8 * (f - 0.4)) / 0.3;
    default:
      return 1;
  }
}

/** The hot-zone sources of a map, from its POIs and (if loaded) its loot containers. */
export function heatSources(pois: Poi[], containers: ContainerSpot[] = []): HeatSource[] {
  const out: HeatSource[] = [];
  const at = (p: Poi) => ({ x: p.position.x, z: p.position.z, label: p.label });

  // PMC spawns come in groups: one source per group.
  const spawns = pois.filter((p) => p.category === 'spawn' && (p.subtype === 'pmc' || p.subtype === 'all')).map(at);
  for (const c of cluster(spawns, 50)) out.push({ kind: 'spawn', x: c.x, z: c.z, r: 60, w: 0.8 });

  // Loot hubs: the richest container clusters of the map.
  const hubs = cluster(containers, 30, (c) => containerIntel(c.kind).money)
    .sort((a, b) => b.w - a.w)
    .slice(0, LOOT_HUBS);
  const top = hubs[0]?.w ?? 1;
  for (const h of hubs) {
    if (h.w < ROUBLE_SCALE / 4) continue;
    out.push({ kind: 'loot', x: h.x, z: h.z, r: 40, w: 0.45 + 0.55 * (h.w / top) });
  }

  // Boss areas, weighted by the map's boss chance.
  const bosses = pois.filter((p) => p.category === 'boss');
  const chance = Math.max(
    0.3,
    ...bosses.flatMap((b) => ((b.meta as { roster?: { chance?: number }[] } | undefined)?.roster ?? []).map((r) => r.chance ?? 0)),
  );
  for (const c of cluster(bosses.map(at), 45)) out.push({ kind: 'boss', x: c.x, z: c.z, r: 55, w: 0.35 + 0.35 * Math.min(1, chance) });

  for (const p of pois) {
    const meta = (p.meta ?? {}) as { faction?: string; outline?: XZ[] };
    if (p.category === 'extract') {
      const scavOnly = String(meta.faction ?? '').toLowerCase() === 'scav';
      out.push({ kind: 'extract', ...at(p), r: 45, w: scavOnly ? 0.3 : 0.8 });
    } else if (p.category === 'transit') {
      out.push({ kind: 'transit', ...at(p), r: 40, w: 0.6 });
    } else if (p.category === 'minefield' && (meta.outline?.length ?? 0) >= 3) {
      out.push({ kind: 'mine', ...at(p), r: 15, w: MAX_HEAT, outline: meta.outline });
    } else if (p.category === 'stationary') {
      out.push({ kind: 'gun', ...at(p), r: 50, w: 0.5 });
    } else if (p.category === 'btr') {
      out.push({ kind: 'btr', ...at(p), r: 35, w: 0.3 });
    }
  }

  // Scav snipers: inside the map they cover a wide ring; on its edge they
  // guard the boundary.
  const sniperPois = new Map(pois.filter((p) => p.category === 'sniper').map((p) => [p.id, p]));
  for (const s of sniperSpots(pois)) {
    const inner = (sniperPois.get(s.id)?.meta as { inner?: boolean } | undefined)?.inner !== false;
    out.push(inner ? { kind: 'sniper', ...s.center, r: 90, w: 0.7 } : { kind: 'edge', ...s.center, r: 60, w: 1 });
  }
  return out;
}

function insidePolygon(p: XZ, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(p: XZ, poly: XZ[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + u * dx), p.z - (a.z + u * dz)));
  }
  return best;
}

/** One source's heat at `p` (time applied). */
function contribution(s: HeatSource, p: XZ, t: number, raid: number): number {
  if (s.outline) {
    if (insidePolygon(p, s.outline)) return s.w;
    const d = distanceToPolygon(p, s.outline);
    if (d >= s.r) return 0;
    const u = 1 - d / s.r;
    return s.w * u * u;
  }
  const dx = p.x - s.x;
  const dz = p.z - s.z;
  const d2 = dx * dx + dz * dz;
  const r2 = s.r * s.r;
  if (d2 >= r2) return 0;
  const u = 1 - d2 / r2;
  return s.w * u * u * timeFactor(s.kind, t, raid);
}

/**
 * Fixed dangers (mines, snipers, mounted guns, the BTR, the map's edge), as
 * opposed to where players go (spawns, loot, exits, boss areas). The
 * aggressive style seeks the players and still avoids the dangers.
 */
export const HAZARD_KINDS: ReadonlySet<HeatKind> = new Set<HeatKind>(['mine', 'edge', 'sniper', 'gun', 'btr']);
export const isHazard = (k: HeatKind): boolean => HAZARD_KINDS.has(k);
export const isTraffic = (k: HeatKind): boolean => !HAZARD_KINDS.has(k);

/** How hot `p` is `t` seconds into a raid of `raid` seconds (0 … MAX_HEAT), optionally only some kinds of source. */
export function heatAt(sources: HeatSource[], p: XZ, t: number, raid: number, only?: (k: HeatKind) => boolean): number {
  let h = 0;
  for (const s of sources) {
    if (only && !only(s.kind)) continue;
    h += contribution(s, p, t, raid);
    if (h >= MAX_HEAT) return MAX_HEAT;
  }
  return h;
}

/** What makes `p` hot (the strongest source), when it is. */
export function hotReason(sources: HeatSource[], p: XZ, t: number, raid: number): { kind: HeatKind; label?: string; level: number } | null {
  let best: HeatSource | null = null;
  let bestV = 0;
  for (const s of sources) {
    const v = contribution(s, p, t, raid);
    if (v > bestV) {
      bestV = v;
      best = s;
    }
  }
  const level = heatAt(sources, p, t, raid);
  return best && level >= HOT ? { kind: best.kind, label: best.label, level } : null;
}

/** The three moments a route is planned for: start, middle and end of the raid. */
export type RaidPhase = 0 | 1 | 2;
export const PHASES: readonly RaidPhase[] = [0, 1, 2];

/** A representative second of each phase, for the heat of that phase. */
export function phaseTime(phase: RaidPhase, raid: number): number {
  return phase === 0 ? 120 : phase === 1 ? 0.4 * raid : 0.85 * raid;
}

/** The phase a moment of the raid is in. */
export function phaseOf(t: number, raid: number): RaidPhase {
  const f = raid > 0 ? t / raid : 0;
  return f < 0.2 ? 0 : f < 0.65 ? 1 : 2;
}
