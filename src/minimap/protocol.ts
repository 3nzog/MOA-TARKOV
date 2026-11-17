// Contract between the main window and the minimap overlay window.
//
// The overlay owns no state of its own: the main window pushes everything it
// needs (map, last position fix, floor, a few points of interest, display
// settings) over a Tauri event whenever any of it changes, and again when the
// overlay announces it is ready. Kept dependency-free so it can be unit-tested.
import type { TaskObjective } from '../api/types';
import { canonicalMapId } from '../map/canonicalMap';
import type { Poi } from '../poi/types';

export const MINIMAP_LABEL = 'minimap';
export const EV_STATE = 'minimap-state';
export const EV_READY = 'minimap-ready';
export const EV_LOCK = 'minimap-lock';

export type MinimapShape = 'circle' | 'square';

export interface MinimapSettings {
  enabled: boolean;
  /** Show only while a raid is running (from the game logs); hide when it ends. */
  onlyInRaid: boolean;
  /** Locked = click-through: the game gets every click, the overlay none. */
  locked: boolean;
  /** Rotate the map so the direction you face is always up. */
  headingUp: boolean;
  /** Window side, logical px. */
  size: number;
  /** Leaflet zoom level used to frame the player. */
  zoom: number;
  /** 0.3 – 1. */
  opacity: number;
  shape: MinimapShape;
  /** Logical screen position of the window's top-left; null = default corner. */
  pos: { x: number; y: number } | null;
}

export const DEFAULT_MINIMAP: MinimapSettings = {
  enabled: false,
  onlyInRaid: true,
  locked: true,
  headingUp: true,
  size: 260,
  zoom: 2,
  opacity: 0.85,
  shape: 'circle',
  pos: null,
};

export const MINIMAP_SIZES = [200, 260, 340] as const;

export function parseMinimapSettings(raw: string | null): MinimapSettings {
  if (!raw) return { ...DEFAULT_MINIMAP };
  try {
    const p = JSON.parse(raw) as Partial<MinimapSettings>;
    const num = (v: unknown, lo: number, hi: number, d: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    const pos =
      p.pos && typeof p.pos.x === 'number' && typeof p.pos.y === 'number' && Number.isFinite(p.pos.x + p.pos.y)
        ? { x: Math.round(p.pos.x), y: Math.round(p.pos.y) }
        : null;
    return {
      enabled: p.enabled === true,
      onlyInRaid: p.onlyInRaid !== false,
      locked: p.locked !== false,
      headingUp: p.headingUp !== false,
      size: num(p.size, 140, 480, DEFAULT_MINIMAP.size),
      zoom: num(p.zoom, -1, 5, DEFAULT_MINIMAP.zoom),
      opacity: num(p.opacity, 0.3, 1, DEFAULT_MINIMAP.opacity),
      shape: p.shape === 'square' ? 'square' : 'circle',
      pos,
    };
  } catch {
    return { ...DEFAULT_MINIMAP };
  }
}

export interface MinimapPoint {
  x: number;
  z: number;
  kind: 'quest' | 'extract' | 'transit' | 'sniper' | 'route';
  /** The player's own exits carry a name; the overlay points to them from its edge. */
  label?: string;
  /** Not the player's (other side, or not in the O+O list): drawn faded, no name. */
  dim?: boolean;
}

const LABEL_MAX = 18;

/** Short enough for the edge of a small disc: no "(Co-op)"-style suffix, then an ellipsis. */
export function shortExitLabel(label: string): string {
  // "Pinewood Basement (Co-Op)" → "Pinewood Basement"; "Ground Zero 21+" → "Ground Zero".
  const s = label.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\d+\+\s*$/, '').trim() || label.trim();
  return s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1).trimEnd()}…` : s;
}

/** Where an off-screen exit's arrow sits on the rim, and which way it points. */
export interface EdgeMarker {
  /** Clockwise from up, degrees. */
  angle: number;
  /** Arrow position, px from the window's top-left. */
  x: number;
  y: number;
  /** Label anchor, inward from the arrow. */
  lx: number;
  ly: number;
  align: 'start' | 'middle' | 'end';
}

/**
 * Place a point given by its screen offset from the window center (px, after
 * the heading-up rotation). Null when it is inside the visible disc — it is
 * drawn on the map itself then.
 */
export function edgeMarker(dx: number, dy: number, size: number, margin = 14): EdgeMarker | null {
  const r = size / 2 - margin;
  const dist = Math.hypot(dx, dy);
  if (dist <= r) return null;
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const ux = dx / dist;
  const uy = dy / dist;
  const c = size / 2;
  const inward = r - 16;
  return {
    angle: Math.round(angle),
    x: c + ux * r,
    y: c + uy * r,
    lx: c + ux * inward,
    ly: c + uy * inward + 4,
    align: ux > 0.35 ? 'end' : ux < -0.35 ? 'start' : 'middle',
  };
}

export interface LabelBox {
  x: number;
  y: number;
  text: string;
  align: 'start' | 'middle' | 'end';
}

const LINE_H = 13;
/** Rough width of 11px semi-bold text; enough to keep labels apart. */
const textWidth = (t: string) => t.length * 6.2 + 4;

/**
 * Nudge labels up or down, a line at a time, so none overlaps one placed
 * before it. Returns the y to draw each at. Several exits in one direction
 * would otherwise print on top of each other.
 */
export function layoutLabels(labels: LabelBox[], size: number): number[] {
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const shifts = [0, LINE_H, -LINE_H, 2 * LINE_H, -2 * LINE_H, 3 * LINE_H, -3 * LINE_H];
  return labels.map((l) => {
    const w = textWidth(l.text);
    const x0 = l.align === 'start' ? l.x : l.align === 'end' ? l.x - w : l.x - w / 2;
    const x1 = x0 + w;
    let chosen = l.y;
    for (const s of shifts) {
      const y = l.y + s;
      if (y < LINE_H || y > size - 4) continue;
      const hit = placed.some((p) => x0 < p.x1 && x1 > p.x0 && y - LINE_H + 2 < p.y1 && y > p.y0);
      if (!hit) {
        chosen = y;
        break;
      }
    }
    placed.push({ x0, x1, y0: chosen - LINE_H + 2, y1: chosen });
    return chosen;
  });
}

/** Rotate a screen offset by `deg` clockwise (the CSS rotate of the map). */
export function rotateOffset(dx: number, dy: number, deg: number): { dx: number; dy: number } {
  const a = (deg * Math.PI) / 180;
  return { dx: dx * Math.cos(a) - dy * Math.sin(a), dy: dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Straight-line distance in game metres, rounded to 10 m. */
export function distanceLabel(from: { x: number; z: number } | null, to: { x: number; z: number }): string | null {
  if (!from) return null;
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  return `${Math.max(10, Math.round(d / 10) * 10)} m`;
}

export interface MinimapState {
  mapId: string | null;
  /** Last screenshot fix; ts = when it arrived (ms). */
  pos: { x: number; y: number; z: number; rotation: number; ts: number } | null;
  activeFloorId: string | null;
  points: MinimapPoint[];
  /** Your marker: the symbol you picked and your colour. */
  self?: { symbol: string; color?: string };
  /** Squadmates on this map (last known position), drawn like on the big map. */
  /** The raid's clock: ends at (PMC, time left) or only its start (time in raid). */
  raidClock?: { startedAt: number; endsAt: number | null } | null;
  mates?: { id: string; name: string; color: string; symbol: string | null; x: number; z: number; rotation: number; ts: number }[];
  /** The raid route: its line and the stops still ahead (the next one is also a named point). */
  route?: MinimapRoute | null;
  settings: Pick<MinimapSettings, 'locked' | 'headingUp' | 'zoom' | 'opacity' | 'shape'>;
  /** Localized strings, so the overlay needs no i18n bootstrapping of its own. */
  text: { waitingRaid: string; dragHint: string; lock: string; ago: string };
}

/** The route as the small map draws it. */
export interface MinimapRoute {
  /** The way from the start through the stops to the exit, game coordinates. */
  line: { x: number; z: number }[];
  /** The stops still ahead, in order. */
  stops: { x: number; z: number }[];
}

/** The colour of the route on every map. */
export const ROUTE_COLOR = '#4fd1ff';
const ROUTE_MAX_POINTS = 400;

/**
 * The route for the small maps: its line (thinned to at most 400 points) and
 * its stops; and the next stop as a named point, so it gets the rim arrow and
 * the distance like the exits.
 */
export function minimapRoute(
  start: { x: number; z: number },
  stops: { x: number; z: number }[],
  exit: { x: number; z: number } | null,
  paths: { x: number; z: number }[][] | undefined,
  nextLabel: string | null,
): { route: MinimapRoute; next: MinimapPoint | null } {
  const ends = [start, ...stops, ...(exit ? [exit] : [])];
  let line: { x: number; z: number }[] = [];
  for (let i = 1; i < ends.length; i++) {
    const way = paths?.[i - 1] ?? [ends[i - 1], ends[i]];
    line.push(...(i === 1 ? way : way.slice(1)));
  }
  if (line.length > ROUTE_MAX_POINTS) {
    // Every step-th point and always the last one (the exit): never more than the cap.
    const step = Math.ceil((line.length - 1) / (ROUTE_MAX_POINTS - 1));
    const last = line.length - 1;
    line = line.filter((_, i) => (i % step === 0 && i < last) || i === last);
  }
  const round = (p: { x: number; z: number }) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
  const first = stops[0] ?? exit;
  return {
    route: { line: line.map(round), stops: stops.map(round) },
    next: first && nextLabel ? { ...round(first), kind: 'route', label: shortExitLabel(nextLabel) } : null,
  };
}

/** A route received from the main window, checked enough to draw. */
export function parseMinimapRoute(raw: unknown): MinimapRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<MinimapRoute>;
  const pts = (v: unknown) =>
    Array.isArray(v) ? v.filter((p): p is { x: number; z: number } => !!p && Number.isFinite(p.x) && Number.isFinite(p.z)).slice(0, ROUTE_MAX_POINTS) : [];
  const line = pts(r.line);
  return line.length >= 2 ? { line, stops: pts(r.stops) } : null;
}

/**
 * Default spot: top-right corner of the monitor, clear of the in-game hotbar
 * (centered at the top) and the health/stance widgets (left side).
 */
export function defaultCorner(
  monitor: { x: number; y: number; width: number; height: number },
  size: number,
  margin = 24,
): { x: number; y: number } {
  return { x: Math.round(monitor.x + monitor.width - size - margin), y: Math.round(monitor.y + margin) };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the overlay goes after its size changes: a window in the right half of
 * the monitor keeps its right edge (it grows leftwards, like the default top-right
 * spot), and the result is clamped so the whole window stays on the monitor.
 */
export function fitInMonitor(
  pos: { x: number; y: number },
  size: number,
  monitor: Rect,
  prevSize: number | null = null,
): { x: number; y: number } {
  let { x } = pos;
  if (prevSize !== null && prevSize !== size && pos.x + prevSize / 2 > monitor.x + monitor.width / 2) {
    x = pos.x + prevSize - size;
  }
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    x: Math.round(clamp(x, monitor.x, monitor.x + monitor.width - size)),
    y: Math.round(clamp(pos.y, monitor.y, monitor.y + monitor.height - size)),
  };
}

/** Screen angle (deg, clockwise) the player faces on a north-up map of this map. */
export function headingAngle(rotation: number, mapRotation: number): number {
  return rotation + mapRotation;
}

/**
 * Points worth showing on a small map: active quest objectives on this map and
 * the exits read from this raid's O+O list. No O+O read yet means no exits:
 * the list is the only thing that says which exits are open for you this raid
 * (PMC or Scav, and which ones the game picked). Capped — a minimap crowded
 * with pins is no minimap.
 */
export function minimapPoints(
  mapId: string,
  objectives: Array<{ objective: TaskObjective }>,
  pois: Poi[],
  max = 60,
  /** Which exits are the player's (src/poi/exitTier.ts); null = no exits at all. */
  tierOf: ((p: Poi) => 'mine' | 'other' | null) | null = null,
  /** Also draw the others, faded. */
  showOthers = true,
  /** Scav sniper posts (src/poi/sniper.ts), drawn red. */
  snipers: { x: number; z: number }[] = [],
): MinimapPoint[] {
  const target = canonicalMapId(mapId);
  const out: MinimapPoint[] = [];
  for (const { objective } of objectives) {
    const zone = objective.zones?.find((z) => z.map && canonicalMapId(z.map.id) === target && z.position);
    const loc = objective.possibleLocations?.find(
      (l) => canonicalMapId(l.map.id) === target && l.positions && l.positions.length > 0,
    );
    const p = zone?.position ?? loc?.positions?.[0];
    if (p) out.push({ x: p.x, z: p.z, kind: 'quest' });
    if (out.length >= max) return out;
  }
  for (const s of snipers) {
    out.push({ x: s.x, z: s.z, kind: 'sniper' });
    if (out.length >= max) return out;
  }
  if (!tierOf) return out;
  const exits = pois.filter(
    (poi) => (poi.category === 'extract' || poi.category === 'transit') && canonicalMapId(poi.mapId) === target,
  );
  // The player's own first, so a full list never drops one of them.
  for (const want of ['mine', 'other'] as const) {
    if (want === 'other' && !showOthers) break;
    for (const poi of exits) {
      if (tierOf(poi) !== want) continue;
      const kind = poi.category === 'transit' ? 'transit' : 'extract';
      if (want === 'other') {
        out.push({ x: poi.position.x, z: poi.position.z, kind, dim: true });
      } else {
        const dest = (poi.meta as { destMapName?: string } | undefined)?.destMapName;
        out.push({ x: poi.position.x, z: poi.position.z, kind, label: shortExitLabel(poi.category === 'transit' && dest ? dest : poi.label) });
      }
      if (out.length >= max) return out;
    }
  }
  return out;
}
