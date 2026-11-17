// The raid route drawn on the map: a dashed line from the start through the
// numbered stops to the exit, bending where the style walks around (or into)
// the heat; the stretches through hot places in orange. Each stop's ring shows
// who needs it (one color per squadmate) and a ⚠ when it is hot when you get
// there. While choosing the start, every PMC spawn is a target; with "loot on
// the way", the loot worth a short detour is marked too.
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Marker, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { getGameToLatLng } from '../map/mapDefs';
import { heatAt, HOT } from './heat';
import type { Point } from './plan';
import type { RaidRoute } from './useRaidRoute';
import { shortNumber, stopDetail, stopHotReason, stopTitle } from './describe';

// The thermal scale (tokens.css): the route is the cold line, heat is orange, loot the hot yellow.
const LINE = '#8fe9ff';
const HOT_LINE = '#ff6f00';
const LOOT = '#ffd54f';

const iconCache = new Map<string, L.DivIcon>();
function stopIcon(n: number, colors: string[], hot: boolean, next = false): L.DivIcon {
  const key = `${n}|${colors.join(',')}|${hot}|${next}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  // One ring per person who needs the stop (a conic split for two or more).
  const ring =
    colors.length <= 1
      ? colors[0] ?? LINE
      : `conic-gradient(${colors.map((c, i) => `${c} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`).join(', ')})`;
  const icon = L.divIcon({
    className: `tc-route-stop${hot ? ' tc-route-stop--hot' : ''}${next ? ' tc-route-stop--next' : ''}`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div class="tc-route-stop__ring" style="background:${ring}"><span>${n}</span></div>${hot ? '<i class="tc-route-stop__warn">!</i>' : ''}`,
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

/** Points every ~8 m along a polyline (for finding its hot stretches). */
function densify(pts: Point[], step = 8): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

export default function RouteLayer({ mapId, route, names }: { mapId: string; route: RaidRoute; names: Record<string, string> }) {
  const { t, i18n } = useTranslation();
  const toLatLng = useMemo(() => getGameToLatLng(mapId), [mapId]);
  const { plan, start, heat, elapsed, raidSeconds } = route;

  // Each leg's way (bent for the non-direct styles), and the hot stretches of it.
  const legs = useMemo(() => {
    if (!plan || !start) return [];
    const ends: Point[] = [start, ...plan.stops, ...(plan.exit ? [plan.exit] : [])];
    return ends.slice(1).map((end, i) => plan.paths?.[i] ?? [ends[i], end]);
  }, [plan, start]);
  const hotRuns = useMemo(() => {
    if (!plan) return [];
    const runs: Point[][] = [];
    legs.forEach((way, i) => {
      // When the leg is walked: from the start, or after the previous stop's work.
      const at = i === 0 ? elapsed : (plan.arrivals[i - 1] ?? elapsed) + (plan.stops[i - 1]?.work ?? 0);
      let run: Point[] = [];
      for (const p of densify(way)) {
        if (heatAt(heat.sources, p, at, raidSeconds) >= HOT) run.push(p);
        else if (run.length) {
          if (run.length > 1) runs.push(run);
          run = [];
        }
      }
      if (run.length > 1) runs.push(run);
    });
    return runs;
  }, [legs, plan, heat.sources, elapsed, raidSeconds]);

  if (!toLatLng) return null;
  const ll = (pts: Point[]) => pts.map((p) => toLatLng(p.x, p.z));
  const line = legs.flatMap((way, i) => ll(i === 0 ? way : way.slice(1)));

  return (
    <>
      {line.length > 1 && (
        <>
          <Polyline positions={line} interactive={false} pathOptions={{ color: '#000', weight: 7, opacity: 0.45 }} />
          {/* A soft cold glow under the line. */}
          <Polyline positions={line} interactive={false} pathOptions={{ color: LINE, weight: 12, opacity: 0.16, className: 'tc-route-glow' }} />
          <Polyline positions={line} interactive={false} pathOptions={{ color: LINE, weight: 3.5, dashArray: '9 7', opacity: 0.95, className: 'tc-route-line' }} />
          {hotRuns.map((run, i) => (
            <Polyline key={i} positions={ll(run)} interactive={false} pathOptions={{ color: HOT_LINE, weight: 4, opacity: 0.95, className: 'tc-route-line tc-route-line--hot' }} />
          ))}
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
      {plan?.stops.map((s, i) => {
        const why = stopHotReason(plan, i, heat.sources, raidSeconds);
        return (
          <Marker
            key={s.id}
            position={toLatLng(s.x, s.z)}
            icon={stopIcon(i + 1, s.who.map((w) => w.color), why !== null, i === 0)}
            keyboard={false}
            zIndexOffset={950}
          >
            <Tooltip direction="top" offset={[0, -12]} className="tc-route-tip">
              {s.info ? (
                <>
                  <strong>{stopTitle(s, t)}</strong>
                  <span>{stopDetail(s, t, names)}</span>
                  {s.info.roubles ? <span>{t('route.worth.money', { value: shortNumber(s.info.roubles, i18n.language) })}</span> : null}
                  {s.info.key && <span>{t('route.loot.key', { key: s.info.key })}</span>}
                </>
              ) : (
                s.items.map((it) => (
                  <Fragment key={it.objective.id}>
                    <strong>{it.task.name}</strong>
                    {it.objective.description && <span>{it.objective.description}</span>}
                  </Fragment>
                ))
              )}
              {why && <span className="tc-route-tip__hot">⚠ {t(`route.hot.${why}`)}</span>}
              {s.who.length > 0 && <em>{s.who.map((w) => w.name).join(' · ')}</em>}
            </Tooltip>
          </Marker>
        );
      })}
      {plan?.exit && <Marker position={toLatLng(plan.exit.x, plan.exit.z)} icon={exitIcon} keyboard={false} zIndexOffset={950} interactive={false} />}
      {route.onWay.map(({ stop, extra }) => (
        <CircleMarker
          key={stop.id}
          center={toLatLng(stop.x, stop.z)}
          radius={6}
          pathOptions={{ color: '#000', weight: 1.5, fillColor: LOOT, fillOpacity: 0.95 }}
        >
          <Tooltip direction="top" offset={[0, -6]} className="tc-route-tip">
            <strong>{stopTitle(stop, t)}</strong>
            <span>{stopDetail(stop, t, names)}</span>
            <span>{t('route.onWay.extra', { s: Math.round(extra), value: shortNumber(stop.value ?? 0, i18n.language) })}</span>
          </Tooltip>
        </CircleMarker>
      ))}
      {route.picking &&
        route.spawns.map((p) => (
          <CircleMarker
            key={p.id}
            center={toLatLng(p.position.x, p.position.z)}
            radius={9}
            pathOptions={{ color: '#000', weight: 2, fillColor: LINE, fillOpacity: 0.85 }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                route.pickStart({ x: p.position.x, z: p.position.z });
              },
            }}
          />
        ))}
    </>
  );
}
