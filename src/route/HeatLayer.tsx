// The hot zones on the map, for one phase of the raid (now, in a raid): each
// source as soft concentric rings in the thermal scale, hotter towards the
// middle (magenta → orange → yellow where players go; violet → magenta → white
// for fixed dangers), stronger where it is busier at that moment. Drawn in game
// coordinates, like the sniper rings, so it lines up on every map whatever its
// rotation.
import { useMemo } from 'react';
import { Polygon } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { getGameToLatLng } from '../map/mapDefs';
import { arcPoints } from '../poi/sniper';
import { isHazard, phaseTime, timeFactor, type HeatSource, type RaidPhase } from './heat';

/** Rings per source, inner to outer: share of its reach and colour (the thermal scale in tokens.css). */
const TRAFFIC_RINGS: [number, string, number][] = [
  [0.35, '#ffd54f', 0.15],
  [0.65, '#ff6f00', 0.12],
  [1, '#c2185b', 0.1],
];
const HAZARD_RINGS: [number, string, number][] = [
  [0.35, '#ffffff', 0.14],
  [0.65, '#c2185b', 0.13],
  [1, '#5b1a8c', 0.12],
];

export default function HeatLayer({ mapId, sources, phase, raid }: { mapId: string; sources: HeatSource[]; phase: RaidPhase; raid: number }) {
  const toLatLng = useMemo(() => getGameToLatLng(mapId), [mapId]);
  const shapes = useMemo(() => {
    if (!toLatLng) return [];
    const t = phaseTime(phase, raid);
    const ll = (pts: { x: number; z: number }[]): LatLngExpression[] => pts.map((p) => toLatLng(p.x, p.z) as LatLngExpression);
    const out: { key: string; positions: LatLngExpression[]; color: string; opacity: number }[] = [];
    sources.forEach((s, i) => {
      const strength = Math.min(1, s.w * timeFactor(s.kind, t, raid));
      if (strength < 0.05) return;
      const rings = isHazard(s.kind) ? HAZARD_RINGS : TRAFFIC_RINGS;
      if (s.outline) {
        out.push({ key: `${i}`, positions: ll(s.outline), color: '#c2185b', opacity: 0.32 });
        return;
      }
      // Outer ring first, so the hotter middle is drawn on top of it.
      [...rings].reverse().forEach(([share, color, alpha], k) =>
        out.push({ key: `${i}:${k}`, positions: ll(arcPoints(s, s.r * share, 0, Math.PI * 2, 32)), color, opacity: alpha * strength }),
      );
    });
    return out;
  }, [toLatLng, sources, phase, raid]);

  return (
    <>
      {shapes.map((s) => (
        <Polygon
          key={s.key}
          positions={s.positions}
          interactive={false}
          pathOptions={{ stroke: false, fillColor: s.color, fillOpacity: s.opacity, className: 'tc-heat' }}
        />
      ))}
    </>
  );
}
