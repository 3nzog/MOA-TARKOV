// The raid route drawn on the map: a dashed line from the start through the
// numbered stops to the exit. Each stop's ring shows who needs it (one color
// per squadmate). While choosing the start, every PMC spawn is a target.
import { Fragment, useMemo } from 'react';
import { CircleMarker, Marker, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { getGameToLatLng } from '../map/mapDefs';
import type { Poi } from '../poi/types';
import type { Point, RoutePlan } from './plan';

const LINE = '#4fd1ff';

const iconCache = new Map<string, L.DivIcon>();
function stopIcon(n: number, colors: string[]): L.DivIcon {
  const key = `${n}|${colors.join(',')}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  // One ring per person who needs the stop (a conic split for two or more).
  const ring =
    colors.length <= 1
      ? colors[0] ?? LINE
      : `conic-gradient(${colors.map((c, i) => `${c} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`).join(', ')})`;
  const icon = L.divIcon({
    className: 'tc-route-stop',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div class="tc-route-stop__ring" style="background:${ring}"><span>${n}</span></div>`,
  });
  iconCache.set(key, icon);
  return icon;
}

const exitIcon = L.divIcon({
  className: 'tc-route-stop tc-route-stop--exit',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  html: '<div class="tc-route-stop__ring"><span>⤴</span></div>',
});

export default function RouteLayer({
  mapId,
  plan,
  start,
  picking,
  spawns,
  onPick,
}: {
  mapId: string;
  plan: RoutePlan | null;
  start: Point | null;
  picking: boolean;
  spawns: Poi[];
  onPick: (p: Point) => void;
}) {
  const toLatLng = useMemo(() => getGameToLatLng(mapId), [mapId]);
  if (!toLatLng) return null;

  const line: L.LatLngExpression[] = [];
  if (plan && start) {
    line.push(toLatLng(start.x, start.z));
    for (const s of plan.stops) line.push(toLatLng(s.x, s.z));
    if (plan.exit) line.push(toLatLng(plan.exit.x, plan.exit.z));
  }

  return (
    <>
      {line.length > 1 && (
        <>
          <Polyline positions={line} interactive={false} pathOptions={{ color: '#000', weight: 7, opacity: 0.45 }} />
          <Polyline positions={line} interactive={false} pathOptions={{ color: LINE, weight: 3.5, dashArray: '9 7', opacity: 0.95 }} />
        </>
      )}
      {start && plan && (
        <CircleMarker
          center={toLatLng(start.x, start.z)}
          radius={7}
          interactive={false}
          pathOptions={{ color: '#000', weight: 2, fillColor: LINE, fillOpacity: 1 }}
        />
      )}
      {plan?.stops.map((s, i) => (
        <Marker
          key={s.id}
          position={toLatLng(s.x, s.z)}
          icon={stopIcon(i + 1, s.who.map((w) => w.color))}
          keyboard={false}
          zIndexOffset={950}
        >
          <Tooltip direction="top" offset={[0, -12]} className="tc-route-tip">
            {s.items.map((it) => (
              <Fragment key={it.objective.id}>
                <strong>{it.task.name}</strong>
                {it.objective.description && <span>{it.objective.description}</span>}
              </Fragment>
            ))}
            <em>{s.who.map((w) => w.name).join(' · ')}</em>
          </Tooltip>
        </Marker>
      ))}
      {plan?.exit && <Marker position={toLatLng(plan.exit.x, plan.exit.z)} icon={exitIcon} keyboard={false} zIndexOffset={950} interactive={false} />}
      {picking &&
        spawns.map((p) => (
          <CircleMarker
            key={p.id}
            center={toLatLng(p.position.x, p.position.z)}
            radius={9}
            pathOptions={{ color: '#000', weight: 2, fillColor: LINE, fillOpacity: 0.85 }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onPick({ x: p.position.x, z: p.position.z });
              },
            }}
          />
        ))}
    </>
  );
}
