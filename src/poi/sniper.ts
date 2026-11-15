// Scav snipers on the map: where they sit (tarkov.dev's "ScavRole/Marksman"
// zones and ZoneSnipe… spawns) and a 360° ring for how far they reach.
//
// Where a sniper aims is not in any game data: it turns and looks for targets
// during the raid. The ring is the honest answer (inside it you can be shot,
// whichever way it faces). The optional cone is an ESTIMATE: it points where
// most exits, loot and spawns around the sniper are, which is usually what a
// sniper post overlooks.
import type { Poi } from './types';

export interface XZ {
  x: number;
  z: number;
}

export interface SniperSpot {
  id: string;
  center: XZ;
  /** The zone's corners, when tarkov.dev has them. */
  outline: XZ[] | null;
}

const MERGE_M = 45;

/**
 * One spot per sniper post: zones as they are, and spawn points merged with
 * a zone or with each other when closer than ~45 m (several spawns of the
 * same post would otherwise stack their rings).
 */
export function sniperSpots(pois: Poi[]): SniperSpot[] {
  const snipers = pois.filter((p) => p.category === 'sniper');
  const spots: (SniperSpot & { n: number })[] = [];
  const zones = snipers.filter((p) => p.subtype === 'zone');
  const spawns = snipers.filter((p) => p.subtype !== 'zone');
  for (const z of zones) {
    const outline = ((z.meta as { outline?: XZ[] } | undefined)?.outline ?? []).filter(
      (o) => Number.isFinite(o.x) && Number.isFinite(o.z),
    );
    spots.push({ id: z.id, center: { x: z.position.x, z: z.position.z }, outline: outline.length >= 3 ? outline : null, n: 1 });
  }
  for (const s of spawns) {
    const near = spots.find((sp) => Math.hypot(sp.center.x - s.position.x, sp.center.z - s.position.z) <= MERGE_M);
    if (near) {
      // A spawn joins a zone without moving it; spawns alone average out.
      if (!near.outline) {
        near.center = {
          x: (near.center.x * near.n + s.position.x) / (near.n + 1),
          z: (near.center.z * near.n + s.position.z) / (near.n + 1),
        };
      }
      near.n += 1;
      continue;
    }
    spots.push({ id: s.id, center: { x: s.position.x, z: s.position.z }, outline: null, n: 1 });
  }
  return spots.map(({ id, center, outline }) => ({ id, center, outline }));
}

/** A circle (or arc) as polygon points around `c`, angles in radians on the game x/z plane. */
export function arcPoints(c: XZ, r: number, from = 0, to = Math.PI * 2, steps = 48): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r });
  }
  return out;
}

export interface AimEstimate {
  /** Radians on the game x/z plane (atan2(dz, dx)). */
  angle: number;
  /** 0–1: how much the points around agree on one direction. */
  confidence: number;
}

/**
 * Estimated facing: the average direction to what is around the post
 * (exits, loot, spawns) between 30 m and 1.6× the range. Null when there is
 * nothing around or no clear direction (things all around: no cone).
 */
export function estimateAim(center: XZ, around: XZ[], range: number): AimEstimate | null {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const p of around) {
    const dx = p.x - center.x;
    const dz = p.z - center.z;
    const d = Math.hypot(dx, dz);
    if (d < 30 || d > range * 1.6) continue;
    sx += dx / d;
    sz += dz / d;
    n += 1;
  }
  if (n < 3) return null;
  const confidence = Math.hypot(sx, sz) / n;
  if (confidence < 0.2) return null;
  return { angle: Math.atan2(sz, sx), confidence };
}

/** The cone's outline: apex at the post, `halfAngle` each side of `angle`. */
export function conePoints(c: XZ, angle: number, range: number, halfAngle = (35 * Math.PI) / 180): XZ[] {
  return [c, ...arcPoints(c, range, angle - halfAngle, angle + halfAngle, 16), c];
}
