// Raid length per map, in minutes (tarkov.dev map data, regular PvP, 2026-11).
// A PMC's clock starts with the raid; a Scav joins one already running, with
// less time left, which the logs do not say, so for Scavs the app shows the
// time spent in the raid instead.
import { canonicalMapId } from './canonicalMap';

const MINUTES: Record<string, number> = {
  '55f2d3fd4bdc2d5f408b4567': 20, // Factory
  '59fc81d786f774390775787e': 25, // Night Factory
  '56f40101d2720b2a4d8b45d6': 35, // Customs
  '5704e3c2d2720bac5b8b4567': 35, // Woods
  '5704e4dad2720bb55b8b4567': 40, // Lighthouse
  '5704e554d2720bac5b8b456e': 45, // Shoreline
  '5704e5fad2720bc05b8b4567': 40, // Reserve
  '5714dbc024597771384a510d': 40, // Interchange
  '5714dc692459777137212e12': 40, // Streets of Tarkov
  '5b0fc42d86f7744a585f9105': 30, // The Lab
  '653e6760052c01c1c805532f': 30, // Ground Zero
  '65b8d6f5cdde2479cb2a3125': 30, // Ground Zero 21+
  '65cc8f81a9aac3e77d0cfd3e': 50, // Terminal
  '6733700029c367a3d40b02af': 30, // The Labyrinth
};

export function raidMinutes(mapId: string | null | undefined): number | null {
  if (!mapId) return null;
  return MINUTES[mapId] ?? MINUTES[canonicalMapId(mapId)] ?? null;
}

/** "mm:ss" (or "h:mm:ss") for a duration in ms; negative clamps to 0. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * What to show for the raid in progress: the time left for a PMC (the raid's
 * length from the moment it started), or the time already in the raid when
 * the side is Scav or unknown, or the length is not known for this map.
 */
export function raidClock(
  startedAt: number,
  mapId: string | null,
  side: 'pmc' | 'scav' | null,
  now: number,
): { kind: 'left' | 'elapsed'; ms: number } {
  const minutes = raidMinutes(mapId);
  if (side === 'pmc' && minutes) return { kind: 'left', ms: startedAt + minutes * 60_000 - now };
  return { kind: 'elapsed', ms: now - startedAt };
}
