// Points close together become one: a spawn group, a loot area, a sniper post.
// Greedy and deterministic (same input order, same clusters), which is what
// two squadmates' apps need to agree on.

export interface XZ {
  x: number;
  z: number;
}

export interface Cluster<T> extends XZ {
  members: T[];
  /** Sum of the members' weights (1 each when they have none). */
  w: number;
}

/**
 * Each point joins the first cluster whose centre is within `radius` metres,
 * else starts one. Centres are the weighted mean of their members.
 */
export function cluster<T extends XZ>(points: T[], radius: number, weight: (p: T) => number = () => 1): Cluster<T>[] {
  const out: Cluster<T>[] = [];
  const r2 = radius * radius;
  for (const p of points) {
    const w = Math.max(weight(p), 1e-6);
    let hit: Cluster<T> | null = null;
    for (const c of out) {
      const dx = c.x - p.x;
      const dz = c.z - p.z;
      if (dx * dx + dz * dz <= r2) {
        hit = c;
        break;
      }
    }
    if (!hit) {
      out.push({ x: p.x, z: p.z, members: [p], w });
      continue;
    }
    const total = hit.w + w;
    hit.x = (hit.x * hit.w + p.x * w) / total;
    hit.z = (hit.z * hit.w + p.z * w) / total;
    hit.w = total;
    hit.members.push(p);
  }
  return out;
}
