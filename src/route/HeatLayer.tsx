// The hot zones on the map, for one phase of the raid (now, in a raid): each
// source as soft concentric rings, stronger where it is busier at that moment.
// Orange where players go, red for fixed dangers. Drawn in game coordinates,
// like the sniper rings, so it lines up on every map whatever its rotation.
import { useMemo } from 'react';
import { Polygon } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { getGameToLatLng } from '../map/mapDefs';
import { arcPoints } from '../poi/sniper';
import { isHazard, phaseTime, timeFactor, type HeatSource, type RaidPhase } from './heat';

const TRAFFIC = '#ff8a3d';
const HAZARD = '#ff3b3b';
/** Rings per source, inner to outer, as a share of its reach. */
const RINGS = [0.35, 0.65, 1];

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
      const color = isHazard(s.kind) ? HAZARD : TRAFFIC;
      if (s.outline) {
        out.push({ key: `${i}`, positions: ll(s.outline), color, opacity: 0.3 });
        return;
      }
      RINGS.forEach((share, k) =>
        out.push({ key: `${i}:${k}`, positions: ll(arcPoints(s, s.r * share, 0, Math.PI * 2, 32)), color, opacity: 0.09 * strength }),
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
