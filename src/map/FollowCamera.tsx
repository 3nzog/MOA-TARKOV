// Centers the map on the player whenever a fresh screenshot-driven position
// lands (and after the map auto-switches, since MapContainer remounts per map
// and this effect re-runs with the latest fix). Gated by the user's
// "follow on update" setting; zoom comes from their slider.

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { getGameToLatLng } from "./mapDefs";

export interface LivePos {
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** App-side arrival time of the fix (Date.now()). */
  ts: number;
}

// Don't recenter on remounts carrying an old fix (e.g. reopening a map an hour
// later) — only a recent screenshot should move the camera.
const FRESH_WINDOW_MS = 20_000;

export default function FollowCamera({
  mapId,
  pos,
  zoom,
  enabled,
}: {
  mapId: string;
  pos: LivePos | null;
  zoom: number;
  enabled: boolean;
}) {
  const map = useMap();
  const lastCenteredTsRef = useRef(0);

  useEffect(() => {
    if (!enabled || !pos) return;
    if (pos.ts === lastCenteredTsRef.current) return; // this fix already centered
    if (Date.now() - pos.ts > FRESH_WINDOW_MS) return;
    const toLatLng = getGameToLatLng(mapId);
    if (!toLatLng) return;
    lastCenteredTsRef.current = pos.ts;
    // In the floating layout the rail covers part of the map: centre the player
    // in the part you can see (--chrome-w on .shell is how much is covered).
    const shell = map.getContainer().closest<HTMLElement>('.shell');
    const covered = shell ? parseFloat(getComputedStyle(shell).getPropertyValue('--chrome-w')) || 0 : 0;
    const shift = shell?.classList.contains('shell--right') ? covered / 2 : -covered / 2;
    const target = L.latLng(toLatLng(pos.x, pos.z) as [number, number]);
    const center = covered ? map.unproject(map.project(target, zoom).add([shift, 0]), zoom) : target;
    map.setView(center, zoom, {
      animate: true,
      duration: 0.5,
    });
  }, [map, mapId, pos, zoom, enabled]);

  return null;
}
