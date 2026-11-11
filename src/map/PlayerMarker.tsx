import { useEffect, useMemo, useRef } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { getGameToLatLng, getMapDef } from './mapDefs';
import { markerHtml } from '../squad/symbols';

export interface PlayerMarkerProps {
  position: { x: number; y: number; z: number; rotation: number } | null;
  mapId: string;
  /** The player's chosen symbol (src/squad/symbols.ts); "arrow" or none = classic arrow. */
  symbol?: string | null;
  /** Marker colour; defaults to the live green. */
  color?: string;
}

// The symbol sits upright in a disc; the view cone and pointer around it turn
// with the heading. Built once per symbol+colour; heading changes rotate the
// live element (never recreate the icon).
export default function PlayerMarker({ position, mapId, symbol, color = 'var(--live)' }: PlayerMarkerProps) {
  const markerRef = useRef<L.Marker | null>(null);
  const toLatLng = getGameToLatLng(mapId);
  // The custom CRS bakes the map's coordinateRotation into project/unproject,
  // so marker *positions* are already rotated. The heading, however, is a
  // plain screen-space CSS rotate() that bypasses the CRS — so it must add the
  // same map rotation by hand, else it reads 180° off on every current map.
  const mapRotation = getMapDef(mapId)?.rotation ?? 0;

  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'tc-player-marker',
        html: markerHtml(symbol, color),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    [symbol, color],
  );

  useEffect(() => {
    const el = markerRef.current?.getElement();
    if (!el || position == null) return;
    const dir = el.querySelector<HTMLElement>('.tc-mk__dir');
    if (dir) dir.style.transform = `rotate(${position.rotation + mapRotation}deg)`;
  }, [position, mapRotation, icon]);

  if (position == null || toLatLng == null) return null;
  // Player position uses the exact same un-negated pipeline as quest/POI/custom
  // markers (toLatLng(x, z) → CRS handles rotation/scale/margin).
  const latLng = toLatLng(position.x, position.z);

  return (
    <Marker
      ref={(m) => {
        markerRef.current = m;
      }}
      position={latLng}
      icon={icon}
      interactive={false}
      keyboard={false}
      zIndexOffset={1000}
    />
  );
}
