// Hand-made 2D / 3D maps as the main map. Those pictures carry no game
// coordinates, so each one is calibrated once: the player clicks where 4
// known exits are on the picture, and a homography (a perspective mapping,
// which also covers the tilted 3D renders) takes game x/z to picture pixels.
// Every marker layer keeps working unchanged: the map's CRS does the mapping.
import { useSyncExternalStore } from 'react';

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface CalPoint {
  /** Game coordinates. */
  gx: number;
  gz: number;
  /** Picture pixels (y down). */
  px: number;
  py: number;
}

/** Solves A·x = b (n×n) by Gaussian elimination with partial pivoting; null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Homography game (x, z) → picture (px, py) from 4 or more point pairs (least
 * squares when more). Null when the points cannot define one (three in a line…).
 */
export function homography(points: CalPoint[]): Mat3 | null {
  if (points.length < 4) return null;
  // Normalize both sides (translate + scale) for a well-conditioned system.
  const norm = (xs: number[], ys: number[]) => {
    const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
    const my = ys.reduce((a, v) => a + v, 0) / ys.length;
    const d = xs.reduce((a, v, i) => a + Math.hypot(v - mx, ys[i] - my), 0) / xs.length || 1;
    const s = Math.SQRT2 / d;
    return { mx, my, s };
  };
  const g = norm(points.map((p) => p.gx), points.map((p) => p.gz));
  const q = norm(points.map((p) => p.px), points.map((p) => p.py));
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const p of points) {
    const x = (p.gx - g.mx) * g.s;
    const y = (p.gz - g.my) * g.s;
    const u = (p.px - q.mx) * q.s;
    const v = (p.py - q.my) * q.s;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  // Normal equations (exact for 4 points).
  const AtA = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => rows.reduce((a, r) => a + r[i] * r[j], 0)));
  const Atb = Array.from({ length: 8 }, (_, i) => rows.reduce((a, r, k) => a + r[i] * rhs[k], 0));
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // Undo the normalizations: H = Tq^-1 · Hn · Tg.
  const Tg: Mat3 = [g.s, 0, -g.s * g.mx, 0, g.s, -g.s * g.my, 0, 0, 1];
  const TqInv: Mat3 = [1 / q.s, 0, q.mx, 0, 1 / q.s, q.my, 0, 0, 1];
  const H = mul(TqInv, mul(Hn, Tg));
  if (H.some((v) => !Number.isFinite(v)) || Math.abs(det(H)) < 1e-18) return null;
  return H;
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function det(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

export function invert(m: Mat3): Mat3 | null {
  const d = det(m);
  if (Math.abs(d) < 1e-18) return null;
  const [a, b, c, e, f, g, h, i, j] = m;
  return [
    (f * j - g * i) / d, (c * i - b * j) / d, (b * g - c * f) / d,
    (g * h - e * j) / d, (a * j - c * h) / d, (c * e - a * g) / d,
    (e * i - f * h) / d, (b * h - a * i) / d, (a * f - b * e) / d,
  ];
}

export function apply(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/**
 * Extra rotation (degrees, CSS clockwise) for a heading arrow at game (x, z):
 * how much the picture turns the game's +x direction compared with the
 * vector map, whose own rotation is `mapRotation`.
 */
export function headingDelta(H: Mat3, x: number, z: number, mapRotation: number): number {
  const [x0, y0] = apply(H, x, z);
  const [x1, y1] = apply(H, x + 1, z);
  const art = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  const vector = -mapRotation; // vector map: +x drawn at -rotation degrees
  return art - vector;
}

// ---- saved calibrations and the map's active picture ------------------------

export interface ArtCalibration {
  key: string;
  points: CalPoint[];
  /** Picture size, pixels. */
  w: number;
  h: number;
  H: Mat3;
  Hinv: Mat3;
}

interface Store {
  cal: Record<string, ArtCalibration>;
  /** Map id → art key shown as the main map. */
  active: Record<string, string>;
}

const KEY = 'tc_art_maps_v1';

function load(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Store>;
    const cal: Record<string, ArtCalibration> = {};
    for (const [k, c] of Object.entries(raw.cal ?? {})) {
      if (!c || !Array.isArray(c.points) || typeof c.w !== 'number' || typeof c.h !== 'number') continue;
      const H = homography(c.points);
      const Hinv = H && invert(H);
      if (H && Hinv) cal[k] = { key: k, points: c.points, w: c.w, h: c.h, H, Hinv };
    }
    const active: Record<string, string> = {};
    for (const [m, k] of Object.entries(raw.active ?? {})) if (typeof k === 'string' && cal[k]) active[m] = k;
    return { cal, active };
  } catch {
    return { cal: {}, active: {} };
  }
}

let store = load();
const listeners = new Set<() => void>();

function save(next: Store) {
  store = next;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        cal: Object.fromEntries(Object.entries(next.cal).map(([k, c]) => [k, { points: c.points, w: c.w, h: c.h }])),
        active: next.active,
      }),
    );
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

/** Saves a calibration (null if the points do not define a mapping). */
export function saveCalibration(key: string, points: CalPoint[], w: number, h: number): ArtCalibration | null {
  const H = homography(points);
  const Hinv = H && invert(H);
  if (!H || !Hinv) return null;
  const cal: ArtCalibration = { key, points, w, h, H, Hinv };
  save({ ...store, cal: { ...store.cal, [key]: cal } });
  return cal;
}

export function setActiveArt(mapId: string, key: string | null): void {
  const active = { ...store.active };
  if (key && store.cal[key]) active[mapId] = key;
  else delete active[mapId];
  save({ ...store, active });
}

export function getCalibration(key: string): ArtCalibration | null {
  return store.cal[key] ?? null;
}

/** The calibrated picture shown as this map's main map, or null (vector / relief). */
export function activeArt(mapId: string): ArtCalibration | null {
  const k = store.active[mapId];
  return k ? store.cal[k] ?? null : null;
}

export function useArtStore(): Store {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => store,
  );
}

/**
 * Reference exits for calibrating: spread over the map (each the farthest
 * from the ones already picked), so the mapping holds everywhere.
 */
export function spreadPoints<T extends { x: number; z: number }>(items: T[], count: number): T[] {
  if (items.length === 0) return [];
  const cx = items.reduce((a, p) => a + p.x, 0) / items.length;
  const cz = items.reduce((a, p) => a + p.z, 0) / items.length;
  const first = items.reduce((best, p) => (Math.hypot(p.x - cx, p.z - cz) > Math.hypot(best.x - cx, best.z - cz) ? p : best));
  const out = [first];
  while (out.length < Math.min(count, items.length)) {
    let best: T | null = null;
    let bestD = -1;
    for (const p of items) {
      if (out.includes(p)) continue;
      const d = Math.min(...out.map((o) => Math.hypot(o.x - p.x, o.z - p.z)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) break;
    out.push(best);
  }
  return out;
}
