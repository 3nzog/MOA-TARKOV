// The way between two points that keeps out of (or, for the aggressive style,
// goes through) the hot zones. There is no data on walls or walkable ground,
// so this is an estimate on a grid of the map:
//
//   - "walkable" cells are the ones near something known to be inside the map
//     (loot, spawns, exits, quest spots); the way may cross other cells, at a
//     high price, so it stays off the sea and off the map's edge;
//   - each step costs its length × (1 + λ·avoided heat) / (1 + pull·sought
//     heat): the discreet style avoids all heat; the aggressive one is pulled
//     towards where players go and still avoids the fixed dangers (mines,
//     snipers…);
//   - the cell path is then pulled straight wherever that does not cut
//     through more heat, so it draws as a few clean bends, not a staircase.
import { HOT } from './heat';
import type { XZ } from './cluster';

export interface Grid {
  /** Game coordinates of cell (0, 0)'s corner. */
  x0: number;
  z0: number;
  /** Cell side, metres. */
  cell: number;
  w: number;
  h: number;
  /** 1 = near something known to be inside the map. */
  walk: Uint8Array;
}

/** Crossing a cell nobody is known to reach costs this many times more. */
const OFF_MAP = 4;

/** The heat of every cell, for one moment of the raid. */
export interface Fields {
  /** Everything: what the route's exposure is measured with. */
  all: Float32Array;
  /** Where players go (spawns, loot, exits, boss areas). */
  traffic: Float32Array;
  /** Fixed dangers (mines, snipers, mounted guns, BTR, the map's edge). */
  hazard: Float32Array;
}

/** How a style weighs the heat of a step. */
export interface Weighing {
  /** Which heat it avoids, and how much (0 = it does not care). */
  avoid: 'all' | 'hazard';
  lambda: number;
  /** How much it is drawn to where players go (0 = not at all). */
  pull: number;
}

/** A grid over everything known on the map, `reach` metres around each point counting as walkable. */
export function buildGrid(known: XZ[], cell = 10, reach = 45): Grid {
  if (known.length === 0) return { x0: 0, z0: 0, cell, w: 1, h: 1, walk: new Uint8Array(1) };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of known) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const x0 = minX - reach - cell;
  const z0 = minZ - reach - cell;
  const w = Math.ceil((maxX - x0 + reach + cell) / cell);
  const h = Math.ceil((maxZ - z0 + reach + cell) / cell);
  const walk = new Uint8Array(w * h);
  const rc = Math.ceil(reach / cell);
  const r2 = (reach / cell) ** 2;
  for (const p of known) {
    const cx = Math.floor((p.x - x0) / cell);
    const cz = Math.floor((p.z - z0) / cell);
    for (let dz = -rc; dz <= rc; dz++) {
      const z = cz + dz;
      if (z < 0 || z >= h) continue;
      for (let dx = -rc; dx <= rc; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= w || dx * dx + dz * dz > r2) continue;
        walk[z * w + x] = 1;
      }
    }
  }
  return { x0, z0, cell, w, h, walk };
}

/** The cell a point falls in (clamped to the grid). */
export function cellOf(g: Grid, p: XZ): number {
  const x = Math.min(g.w - 1, Math.max(0, Math.floor((p.x - g.x0) / g.cell)));
  const z = Math.min(g.h - 1, Math.max(0, Math.floor((p.z - g.z0) / g.cell)));
  return z * g.w + x;
}

export function centerOf(g: Grid, i: number): XZ {
  return { x: g.x0 + ((i % g.w) + 0.5) * g.cell, z: g.z0 + (Math.floor(i / g.w) + 0.5) * g.cell };
}

/** The heat of every cell (at its centre). */
export function heatField(g: Grid, heat: (p: XZ) => number): Float32Array {
  const out = new Float32Array(g.w * g.h);
  for (let i = 0; i < out.length; i++) out[i] = heat(centerOf(g, i));
  return out;
}

/** Fields from separate traffic and hazard heat (all = their sum, capped like heatAt). */
export function fieldsOf(g: Grid, traffic: (p: XZ) => number, hazard: (p: XZ) => number, cap = 2): Fields {
  const t = heatField(g, traffic);
  const h = heatField(g, hazard);
  const all = new Float32Array(t.length);
  for (let i = 0; i < all.length; i++) all[i] = Math.min(cap, t[i] + h[i]);
  return { all, traffic: t, hazard: h };
}

/** Fields where all the heat is one kind (tests, and maps with nothing to tell apart). */
export function plainFields(all: Float32Array): Fields {
  return { all, traffic: all, hazard: new Float32Array(all.length) };
}

/** Shortest-way tree from one point: cost, metres walked, heat met and hot metres, per cell. */
export interface Tree {
  from: XZ;
  cost: Float32Array;
  /** Metres walked. */
  len: Float32Array;
  /** Heat × metres. */
  heat: Float32Array;
  /** Metres walked in hot cells. */
  hot: Float32Array;
  prev: Int32Array;
}

/** A binary min-heap of cell indexes keyed by cost (typed arrays, no objects). */
class Heap {
  private ids: Int32Array;
  private keys: Float64Array;
  size = 0;
  constructor(capacity: number) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }
  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.ids.length * 2);
      ids.set(this.ids);
      const keys = new Float64Array(this.keys.length * 2);
      keys.set(this.keys);
      this.ids = ids;
      this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.ids[i] = this.ids[parent];
      this.keys[i] = this.keys[parent];
      i = parent;
    }
    this.ids[i] = id;
    this.keys[i] = key;
  }
  /** Removes the smallest; returns its id (call only when size > 0). */
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size];
    const lastKey = this.keys[this.size];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const c = r < this.size && this.keys[r] < this.keys[l] ? r : l;
      if (this.keys[c] >= lastKey) break;
      this.ids[i] = this.ids[c];
      this.keys[i] = this.keys[c];
      i = c;
    }
    this.ids[i] = lastId;
    this.keys[i] = lastKey;
    return top;
  }
}

const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** The cheapest ways from `from` to every cell, the heat weighed the style's way. */
export function dijkstra(g: Grid, fields: Fields, weighing: Weighing, from: XZ): Tree {
  const measure = fields.all;
  const avoid = weighing.avoid === 'all' ? fields.all : fields.hazard;
  const seek = fields.traffic;
  const { lambda, pull } = weighing;
  const n = g.w * g.h;
  const cost = new Float32Array(n).fill(Infinity);
  const len = new Float32Array(n);
  const heat = new Float32Array(n);
  const hot = new Float32Array(n);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap(Math.min(n, 4096));
  const start = cellOf(g, from);
  cost[start] = 0;
  heap.push(start, 0);
  while (heap.size > 0) {
    const a = heap.pop();
    if (done[a]) continue;
    done[a] = 1;
    const ax = a % g.w;
    const az = (a - ax) / g.w;
    for (const [dx, dz, unit] of STEPS) {
      const x = ax + dx;
      const z = az + dz;
      if (x < 0 || z < 0 || x >= g.w || z >= g.h) continue;
      const b = z * g.w + x;
      if (done[b]) continue;
      const step = unit * g.cell;
      const h = (measure[a] + measure[b]) / 2;
      let m = 1 + (lambda * (avoid[a] + avoid[b])) / 2;
      if (pull > 0) m /= 1 + (pull * Math.min(1, (seek[a] + seek[b]) / 2));
      if (!g.walk[b]) m *= OFF_MAP;
      const c = cost[a] + step * m;
      if (c < cost[b]) {
        cost[b] = c;
        len[b] = len[a] + step;
        heat[b] = heat[a] + step * h;
        hot[b] = hot[a] + (h >= HOT ? step : 0);
        prev[b] = a;
        heap.push(b, c);
      }
    }
  }
  return { from, cost, len, heat, hot, prev };
}

/** One way between two points: drawn bends, and what walking it means. */
export interface Way {
  pts: XZ[];
  /** Metres walked. */
  len: number;
  /** Heat × metres. */
  heat: number;
  /** Metres walked in hot cells. */
  hot: number;
}

/**
 * The style's way from `a` to `b` (A*: it only looks at the part of the map
 * between them), smoothed. The heuristic never overestimates: a step costs at
 * least its length / (1 + pull).
 */
export function shortestWay(g: Grid, fields: Fields, weighing: Weighing, a: XZ, b: XZ): Way {
  const measure = fields.all;
  const avoid = weighing.avoid === 'all' ? fields.all : fields.hazard;
  const seek = fields.traffic;
  const { lambda, pull } = weighing;
  const n = g.w * g.h;
  const start = cellOf(g, a);
  const goal = cellOf(g, b);
  const gx = goal % g.w;
  const gz = (goal - gx) / g.w;
  const hScale = g.cell / (1 + Math.max(0, pull));
  const cost = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap(1024);
  const guess = (i: number) => {
    const x = i % g.w;
    const z = (i - x) / g.w;
    return Math.hypot(x - gx, z - gz) * hScale;
  };
  cost[start] = 0;
  heap.push(start, guess(start));
  while (heap.size > 0) {
    const c = heap.pop();
    if (c === goal) break;
    if (done[c]) continue;
    done[c] = 1;
    const cx = c % g.w;
    const cz = (c - cx) / g.w;
    for (const [dx, dz, unit] of STEPS) {
      const x = cx + dx;
      const z = cz + dz;
      if (x < 0 || z < 0 || x >= g.w || z >= g.h) continue;
      const d = z * g.w + x;
      if (done[d]) continue;
      let m = 1 + (lambda * (avoid[c] + avoid[d])) / 2;
      if (pull > 0) m /= 1 + pull * Math.min(1, (seek[c] + seek[d]) / 2);
      if (!g.walk[d]) m *= OFF_MAP;
      const k = cost[c] + unit * g.cell * m;
      if (k < cost[d]) {
        cost[d] = k;
        prev[d] = c;
        heap.push(d, k + guess(d));
      }
    }
  }
  const cells: number[] = [];
  for (let c = goal, guard = n; c !== -1 && guard-- > 0; c = prev[c]) cells.push(c);
  cells.reverse();
  const raw = cells.length > 1 ? cells.map((i) => centerOf(g, i)) : [];
  if (raw.length > 1) {
    raw[0] = { x: a.x, z: a.z };
    raw[raw.length - 1] = { x: b.x, z: b.z };
  }
  const pts = raw.length > 1 ? smoothPath(g, fields, weighing, raw) : [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  let len = 0;
  let heat = 0;
  let hot = 0;
  for (let i = 1; i < pts.length; i++) {
    const s = straightCost(g, measure, pts[i - 1], pts[i]);
    len += s.len;
    heat += s.heat;
    hot += s.hot;
  }
  return { pts, len, heat, hot };
}

/** The way from the tree's origin to `to`, as cell centres (origin and target points at the ends). */
export function pathTo(g: Grid, tree: Tree, to: XZ): XZ[] {
  const cells: number[] = [];
  let c = cellOf(g, to);
  let guard = g.w * g.h;
  while (c !== -1 && guard-- > 0) {
    cells.push(c);
    c = tree.prev[c];
  }
  cells.reverse();
  const pts = cells.map((i) => centerOf(g, i));
  if (pts.length > 0) {
    pts[0] = { x: tree.from.x, z: tree.from.z };
    pts[pts.length - 1] = { x: to.x, z: to.z };
  } else {
    pts.push({ x: tree.from.x, z: tree.from.z }, { x: to.x, z: to.z });
  }
  return pts;
}

/** A straight segment's cost the style's way, and whether it leaves the walkable cells. */
function segment(g: Grid, fields: Fields, weighing: Weighing, a: XZ, b: XZ): { cost: number; offMap: boolean } {
  const avoid = weighing.avoid === 'all' ? fields.all : fields.hazard;
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / (g.cell / 2)));
  const step = d / n;
  let cost = 0;
  let offMap = false;
  for (let i = 0; i < n; i++) {
    const c = cellOf(g, { x: a.x + ((b.x - a.x) * (i + 0.5)) / n, z: a.z + ((b.z - a.z) * (i + 0.5)) / n });
    let m = 1 + weighing.lambda * avoid[c];
    if (weighing.pull > 0) m /= 1 + weighing.pull * Math.min(1, fields.traffic[c]);
    if (!g.walk[c]) {
      m *= OFF_MAP;
      offMap = true;
    }
    cost += step * m;
  }
  return { cost, offMap };
}

/** How far ahead a corner looks for a straight shortcut (cells). */
const LOOKAHEAD = 80;

/**
 * Pulls a cell path straight: from each corner, jump to the farthest later
 * point the straight line reaches without leaving the walkable cells and
 * without costing more — the style's own way — than the stretch it replaces.
 * So the discreet way is not straightened back into the heat, nor the
 * aggressive one out of it.
 */
export function smoothPath(g: Grid, fields: Fields, weighing: Weighing, pts: XZ[]): XZ[] {
  if (pts.length <= 2) return pts;
  const walkable = (p: XZ) => g.walk[cellOf(g, p)] === 1;
  // Cost of the cell path up to each point.
  const upTo = [0];
  for (let k = 1; k < pts.length; k++) upTo.push(upTo[k - 1] + segment(g, fields, weighing, pts[k - 1], pts[k]).cost);
  const out: XZ[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let next = i + 1;
    // Whether the way being replaced already left the walkable cells.
    let wayOff = !walkable(pts[i]) || !walkable(pts[i + 1]);
    for (let j = i + 2; j < pts.length && j <= i + LOOKAHEAD; j++) {
      wayOff ||= !walkable(pts[j]);
      const seg = segment(g, fields, weighing, pts[i], pts[j]);
      if (seg.offMap && !wayOff) break;
      if (seg.cost > (upTo[j] - upTo[i]) * 1.02 + 0.5) continue;
      next = j;
    }
    out.push(pts[next]);
    i = next;
  }
  return out;
}

/** Metres, heat × metres and hot metres along a straight segment (the direct style). */
export function straightCost(g: Grid, field: Float32Array, a: XZ, b: XZ): { len: number; heat: number; hot: number } {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / (g.cell / 2)));
  const step = len / n;
  let heat = 0;
  let hot = 0;
  for (let i = 0; i < n; i++) {
    const h = field[cellOf(g, { x: a.x + ((b.x - a.x) * (i + 0.5)) / n, z: a.z + ((b.z - a.z) * (i + 0.5)) / n })];
    heat += h * step;
    if (h >= HOT) hot += step;
  }
  return { len, heat, hot };
}
