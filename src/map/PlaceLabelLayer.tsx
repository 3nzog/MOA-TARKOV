// Place names on the main map ("Big Red", "Dorms", "Scav Town"…), from
// tarkov.dev's map data (scripts/fetch-map-labels.mjs → data/snapshot/
// map-labels.json, loaded on first use). Never drawn on the minimap.
import { useEffect, useMemo, useState } from 'react';
import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { getGameToLatLng } from './mapDefs';
import { canonicalMapId } from './canonicalMap';

interface RawLabel {
  t: string;
  x: number;
  z: number;
  /** Degrees. */
  r?: number;
  /** Size, percent (100 = normal). */
  s?: number;
}

let labelsPromise: Promise<Record<string, RawLabel[]>> | null = null;
function loadLabels(): Promise<Record<string, RawLabel[]>> {
  labelsPromise ??= import('../../data/snapshot/map-labels.json')
    .then((m) => (m as unknown as { default: Record<string, RawLabel[]> }).default)
    .catch(() => ({}));
  return labelsPromise;
}

const iconCache = new Map<string, L.DivIcon>();
function labelIcon(l: RawLabel): L.DivIcon {
  const key = `${l.t}|${l.r ?? 0}|${l.s ?? 100}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const safe = l.t.replace(/[<>&"]/g, '');
    icon = L.divIcon({
      className: 'tc-place-label-marker',
      iconSize: [0, 0],
      html: `<span class="tc-place-label" style="--rot:${l.r ?? 0}deg;--size:${(l.s ?? 100) / 100}">${safe}</span>`,
    });
    iconCache.set(key, icon);
  }
  return icon;
}

export default function PlaceLabelLayer({ mapId, visible }: { mapId: string; visible: boolean }) {
  const [all, setAll] = useState<Record<string, RawLabel[]> | null>(null);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void loadLabels().then((d) => alive && setAll(d));
    return () => {
      alive = false;
    };
  }, [visible]);

  const toLatLng = useMemo(() => getGameToLatLng(mapId), [mapId]);
  const labels = all?.[canonicalMapId(mapId)] ?? [];
  if (!visible || !toLatLng || labels.length === 0) return null;
  return (
    <>
      {labels.map((l, i) => (
        <Marker
          key={`${i}-${l.t}`}
          position={toLatLng(l.x, l.z)}
          icon={labelIcon(l)}
          interactive={false}
          keyboard={false}
          zIndexOffset={-500}
        />
      ))}
    </>
  );
}
