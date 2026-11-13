// The minimap overlay window: a small, transparent, always-on-top, click-through
// window that shows the map centered on the player and (optionally) turned so
// the direction they face is always up.
//
// It is an ordinary OS window above the game — nothing is drawn INTO the game
// and nothing is read from it. It shows only what the main window already has:
// the last screenshot position fix. So it moves when a screenshot is taken, not
// continuously; a fix that is getting old fades out instead of lying.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, ImageOverlay, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Lock } from '@phosphor-icons/react';
import { MAPS, getGameToLatLng, getMapDef, leafletBounds, makeCRS } from '../map/mapDefs';
import { canonicalMapId } from '../map/canonicalMap';
import FloorVisualOverlay from '../map/FloorVisualOverlay';
import { ALL_FLOORS } from '../map/FloorSwitcher';
import PlayerMarker from '../map/PlayerMarker';
import { markerHtml } from '../squad/symbols';
import { clock } from '../map/raidDuration';
import { TOKEN_HEX } from '../ui/tokens';
import { MARKER_COLORS } from '../poi/registry';
import {
  EV_LOCK,
  EV_READY,
  EV_STATE,
  distanceLabel,
  edgeMarker,
  headingAngle,
  layoutLabels,
  rotateOffset,
  type LabelBox,
  type MinimapPoint,
  type MinimapState,
} from './protocol';
import '../App.css';
import './minimap.css';

// A fix older than this is shown dimmed with its age; one much older is hidden.
const STALE_MS = 90_000;
const DEAD_MS = 10 * 60_000;

function Follow({ mapId, pos, zoom }: { mapId: string; pos: MinimapState['pos']; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    const toLatLng = getGameToLatLng(mapId);
    if (!pos || !toLatLng) return;
    // No animation: a minimap that glides lags behind the fix it shows.
    map.setView(toLatLng(pos.x, pos.z), zoom, { animate: false });
  }, [map, mapId, pos, zoom]);
  return null;
}

type Offset = { dx: number; dy: number };

/**
 * Screen offsets (px, from the map's center, before the heading-up rotation)
 * of the exits that carry a name — the ones read from the O+O list. Recomputed
 * whenever the view moves, so the edge arrows follow the map.
 */
function ProjectExits({
  mapId,
  points,
  onChange,
}: {
  mapId: string;
  points: MinimapPoint[];
  onChange: (offsets: Offset[]) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const toLatLng = getGameToLatLng(mapId);
    if (!toLatLng) return;
    const update = () => {
      const size = map.getSize();
      onChange(
        points.map((p) => {
          const cp = map.latLngToContainerPoint(toLatLng(p.x, p.z));
          return { dx: cp.x - size.x / 2, dy: cp.y - size.y / 2 };
        }),
      );
    };
    update();
    map.on('moveend zoomend resize viewreset', update);
    return () => {
      map.off('moveend zoomend resize viewreset', update);
    };
  }, [map, mapId, points, onChange]);
  return null;
}

/** The overlay's own drawn size (px), for placing arrows on its rim. */
function useBoxSize(el: HTMLDivElement | null): number {
  const [size, setSize] = useState(0);
  useEffect(() => {
    if (!el) return;
    const measure = () => setSize(Math.min(el.clientWidth, el.clientHeight));
    // Measured once right after mount and again on every resize.
    const t = window.setTimeout(measure, 0);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
    };
  }, [el]);
  return size;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** The raid clock in a corner: time left for a PMC, time in raid otherwise. */
function RaidClock({ c }: { c: NonNullable<MinimapState['raidClock']> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = c.endsAt !== null ? c.endsAt - now : null;
  return (
    <div className={`minimap__clock mono${left !== null && left < 5 * 60_000 ? ' is-low' : ''}`}>
      {left !== null ? clock(left) : `+${clock(now - c.startedAt)}`}
    </div>
  );
}

/** A squadmate on the minimap: same marker as the big map, smaller, fading with age. */
function MateMarker({ mate, at, heading }: { mate: NonNullable<MinimapState['mates']>[number]; at: [number, number]; heading: number }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'tc-player-marker minimap__mate',
        html: markerHtml(mate.symbol, mate.color, { ping: '' }),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    [mate.symbol, mate.color],
  );
  const [el, setEl] = useState<L.Marker | null>(null);
  useEffect(() => {
    const dir = el?.getElement()?.querySelector<HTMLElement>('.tc-mk__dir');
    if (dir) dir.style.transform = `rotate(${heading}deg)`;
    const root = el?.getElement();
    if (root) root.style.opacity = Date.now() - mate.ts > 30_000 ? '0.35' : '1';
  }, [el, heading, mate.ts, icon]);
  return <Marker ref={setEl} position={at} icon={icon} interactive={false} keyboard={false} zIndexOffset={900} />;
}

export default function MinimapApp() {
  const [state, setState] = useState<MinimapState | null>(null);
  const now = useNow(5000);
  // The element only exists once a state arrived, so it is tracked as state, not a ref.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const box = useBoxSize(rootEl);
  const [exitOffsets, setExitOffsets] = useState<Offset[]>([]);
  // Same offsets → same state object, so a map event does not re-render for nothing.
  const updateExitOffsets = useCallback(
    (next: Offset[]) =>
      setExitOffsets((cur) =>
        cur.length === next.length &&
        cur.every((o, i) => Math.abs(o.dx - next[i].dx) < 0.5 && Math.abs(o.dy - next[i].dy) < 0.5)
          ? cur
          : next,
      ),
    [],
  );
  // Stable between pushes from the main window, so the projection effect runs only when points change.
  const named = useMemo(() => (state?.points ?? []).filter((p) => p.label), [state?.points]);

  useEffect(() => {
    document.documentElement.classList.add('minimap-root');
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { listen, emit } = await import('@tauri-apps/api/event');
        const u = await listen<MinimapState>(EV_STATE, (ev) => setState(ev.payload));
        if (cancelled) u();
        else unlisten = u;
        await emit(EV_READY);
      } catch {
        // Outside Tauri. In development only, a page can feed a state by hand
        // (window.dispatchEvent(new CustomEvent('minimap-demo', { detail }))) to
        // check the drawing in a browser.
        if (import.meta.env.DEV && !cancelled) {
          const onDemo = (e: Event) => setState((e as CustomEvent<MinimapState>).detail);
          window.addEventListener('minimap-demo', onDemo);
          unlisten = () => window.removeEventListener('minimap-demo', onDemo);
        }
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const mapId = state?.mapId ? canonicalMapId(state.mapId) : null;
  const def = mapId ? MAPS[mapId] : undefined;
  const crs = useMemo(() => (def ? makeCRS(def) : null), [def]);
  const settings = state?.settings;
  const pos = state?.pos ?? null;
  const age = pos ? now - pos.ts : Infinity;

  const startDrag = async (e: React.MouseEvent) => {
    if (!settings || settings.locked || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch {
      /* outside Tauri */
    }
  };

  const lockNow = async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(EV_LOCK);
    } catch {
      /* outside Tauri */
    }
  };

  if (!state || !settings) return null;

  const heading = pos && mapId ? headingAngle(pos.rotation, getMapDef(mapId)?.rotation ?? 0) : 0;
  const turn = settings.headingUp && pos ? -heading : 0;
  const shapeCls = settings.shape === 'circle' ? 'minimap--circle' : 'minimap--square';
  const toLatLng = mapId ? getGameToLatLng(mapId) : null;
  const colorOf = (p: MinimapPoint) =>
    p.kind === 'quest' ? MARKER_COLORS.Y : p.kind === 'transit' ? MARKER_COLORS.O : MARKER_COLORS.G;

  return (
    <div
      ref={setRootEl}
      className={`minimap ${shapeCls}${settings.locked ? '' : ' minimap--unlocked'}`}
      style={{ opacity: settings.opacity }}
      onMouseDown={(e) => void startDrag(e)}
    >
      {!def || !crs ? (
        <div className="minimap__msg">{state.text.waitingRaid}</div>
      ) : (
        <>
          <div
            className="minimap__rotor"
            style={{ transform: `rotate(${turn}deg)`, opacity: age > STALE_MS ? 0.55 : 1, '--counter': `${-turn}deg` } as React.CSSProperties}
          >
            <MapContainer
              key={mapId}
              crs={crs}
              bounds={leafletBounds(def)}
              style={{ width: '100%', height: '100%', background: 'transparent' }}
              zoomControl={false}
              attributionControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              touchZoom={false}
              boxZoom={false}
              keyboard={false}
              zoomSnap={0.25}
              minZoom={-3}
              maxZoom={7}
              fadeAnimation={false}
              zoomAnimation={false}
              markerZoomAnimation={false}
            >
              {def.svgUrl.endsWith('.svg') ? (
                <FloorVisualOverlay
                  svgUrl={def.svgUrl}
                  bounds={leafletBounds(def)}
                  floors={def.floors}
                  activeFloorId={state.activeFloorId ?? ALL_FLOORS}
                  extraSvgUrls={def.extraSvgUrls}
                />
              ) : (
                <ImageOverlay url={def.svgUrl} bounds={leafletBounds(def)} />
              )}
              {toLatLng &&
                state.points.map((p, i) => (
                  <CircleMarker
                    key={i}
                    center={toLatLng(p.x, p.z)}
                    radius={p.kind === 'quest' ? 5 : p.dim ? 3 : 4}
                    interactive={false}
                    pathOptions={{
                      color: TOKEN_HEX.bgSunken,
                      weight: p.dim ? 1 : 1.5,
                      opacity: p.dim ? 0.45 : 1,
                      // Same roles as the main map: quest gold, PMC-extract green.
                      fillColor: colorOf(p),
                      fillOpacity: p.dim ? 0.35 : 1,
                    }}
                  />
                ))}
              {named.length > 0 && <ProjectExits mapId={mapId!} points={named} onChange={updateExitOffsets} />}
              {toLatLng &&
                (state.mates ?? []).map((m) => (
                  <MateMarker key={m.id} mate={m} at={toLatLng(m.x, m.z)} heading={headingAngle(m.rotation, getMapDef(mapId!)?.rotation ?? 0)} />
                ))}
              {age < DEAD_MS && (
                <PlayerMarker position={pos} mapId={mapId!} symbol={state.self?.symbol} color={state.self?.color} />
              )}
              <Follow mapId={mapId!} pos={pos} zoom={settings.zoom} />
            </MapContainer>
          </div>
          {box > 0 && named.length > 0 && exitOffsets.length === named.length && (
            <svg className="minimap__exits" viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
              {(() => {
                // On screen: the dot is on the map, so it just gets a name above it.
                // Off screen: an arrow on the rim and "name · distance" inward of it.
                const items = named.map((p, i) => {
                  const o = rotateOffset(exitOffsets[i].dx, exitOffsets[i].dy, turn);
                  const edge = edgeMarker(o.dx, o.dy, box);
                  const dist = distanceLabel(pos, p);
                  const label: LabelBox = edge
                    ? { x: edge.lx, y: edge.ly, text: dist ? `${p.label} · ${dist}` : p.label!, align: edge.align }
                    : { x: box / 2 + o.dx, y: box / 2 + o.dy - 9, text: p.label!, align: 'middle' };
                  return { p, edge, label };
                });
                const ys = layoutLabels(items.map((it) => it.label), box);
                return items.map(({ p, edge, label }, i) => (
                  <g key={i}>
                    {edge && (
                      <path
                        d="M0,-8 L7,5 L-7,5 Z"
                        transform={`translate(${edge.x} ${edge.y}) rotate(${edge.angle})`}
                        fill={colorOf(p)}
                        stroke={TOKEN_HEX.bgSunken}
                        strokeWidth={1}
                      />
                    )}
                    <text x={label.x} y={ys[i]} textAnchor={label.align} fill={colorOf(p)}>
                      {label.text}
                    </text>
                  </g>
                ));
              })()}
            </svg>
          )}
          {state.raidClock && <RaidClock c={state.raidClock} />}
          {settings.headingUp && pos && (
            <div className="minimap__north" style={{ transform: `rotate(${turn}deg)` }}>
              <span>N</span>
            </div>
          )}
          {pos && age > STALE_MS ? (
            <div className="minimap__badge mono">
              {state.text.ago.replace('{{min}}', String(Math.max(1, Math.round(age / 60_000))))}
            </div>
          ) : null}
        </>
      )}
      {!settings.locked && (
        <div className="minimap__edit">
          <span>{state.text.dragHint}</span>
          <button type="button" onClick={() => void lockNow()} aria-label={state.text.lock} title={state.text.lock}>
            <Lock weight="bold" />
          </button>
        </div>
      )}
    </div>
  );
}
