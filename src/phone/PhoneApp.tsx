// The map on a phone (opened from the QR code, ?view=phone&k=…): a full-screen
// map fed live by the PC over the home Wi-Fi. It only shows; nothing on the
// phone changes anything on the PC.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, ImageOverlay, MapContainer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, WifiHigh, WifiSlash } from '@phosphor-icons/react';
import { MAPS, SUPPORTED_MAP_NAMES, getGameToLatLng, getMapDef, leafletBounds, makeCRS } from '../map/mapDefs';
import { canonicalMapId } from '../map/canonicalMap';
import FloorVisualOverlay from '../map/FloorVisualOverlay';
import { ALL_FLOORS } from '../map/FloorSwitcher';
import PlayerMarker from '../map/PlayerMarker';
import { markerHtml } from '../squad/symbols';
import { clock } from '../map/raidDuration';
import { TOKEN_HEX } from '../ui/tokens';
import { MARKER_COLORS } from '../poi/registry';
import { headingAngle, ROUTE_COLOR, type MinimapPoint } from '../minimap/protocol';
import { parsePhoneState, phoneSocketUrl, type PhoneState } from './phoneApi';
import '../App.css';
import './phone.css';

const STALE_MS = 90_000;
const RETRY_MS = 2500;

type Conn = 'connecting' | 'live' | 'down' | 'nokey';

const colorOf = (p: MinimapPoint) =>
  p.kind === 'route'
    ? ROUTE_COLOR
    : p.kind === 'quest'
      ? MARKER_COLORS.Y
      : p.kind === 'sniper'
        ? MARKER_COLORS.SNIPER
        : p.kind === 'transit'
          ? MARKER_COLORS.O
          : MARKER_COLORS.G;

/** The PC's state over the socket, reconnecting on its own. */
function usePhoneFeed(): { state: PhoneState | null; conn: Conn } {
  const [state, setState] = useState<PhoneState | null>(null);
  const [conn, setConn] = useState<Conn>(() => (phoneSocketUrl(window.location) ? 'connecting' : 'nokey'));
  useEffect(() => {
    const url = phoneSocketUrl(window.location);
    // In development a page can feed a state by hand
    // (window.dispatchEvent(new CustomEvent('phone-demo', { detail: JSON.stringify(state) }))).
    const onDemo = (e: Event) => {
      const s = parsePhoneState((e as CustomEvent<string>).detail);
      if (s) {
        setState(s);
        setConn('live');
      }
    };
    if (import.meta.env.DEV) window.addEventListener('phone-demo', onDemo);
    if (!url) {
      return () => {
        if (import.meta.env.DEV) window.removeEventListener('phone-demo', onDemo);
      };
    }
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let alive = true;
    const open = () => {
      if (!alive) return;
      setConn((c) => (c === 'live' ? 'down' : c));
      ws = new WebSocket(url);
      ws.onopen = () => alive && setConn('live');
      ws.onmessage = (ev) => {
        const s = parsePhoneState(ev.data);
        if (s && alive) setState(s);
      };
      ws.onclose = () => {
        if (!alive) return;
        setConn('down');
        timer = window.setTimeout(open, RETRY_MS);
      };
    };
    open();
    // Back from the lock screen: reconnect at once instead of waiting.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && ws && ws.readyState > WebSocket.OPEN) {
        window.clearTimeout(timer);
        open();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (import.meta.env.DEV) window.removeEventListener('phone-demo', onDemo);
      ws?.close();
    };
  }, []);
  return { state, conn };
}

/** Keeps the player centered while "follow" is on; a drag with the finger turns it off. */
function Follow({ mapId, pos, on, onDrag }: { mapId: string; pos: PhoneState['pos']; on: boolean; onDrag: () => void }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    const h = () => onDrag();
    map.on('dragstart', h);
    return () => {
      map.off('dragstart', h);
    };
  }, [map, onDrag]);
  useEffect(() => {
    const toLatLng = getGameToLatLng(mapId);
    if (!on || !pos || !toLatLng) return;
    const z = first.current ? Math.max(map.getZoom(), 2.5) : map.getZoom();
    first.current = false;
    map.setView(toLatLng(pos.x, pos.z), z, { animate: true });
  }, [map, mapId, pos, on]);
  return null;
}

function MateMarker({ mate, at, heading }: { mate: NonNullable<PhoneState['mates']>[number]; at: [number, number]; heading: number }) {
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'tc-player-marker',
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
  }, [el, heading, icon]);
  return (
    <Marker ref={setEl} position={at} icon={icon} interactive={false} keyboard={false} zIndexOffset={900}>
      <Tooltip direction="bottom" offset={[0, 14]} permanent className="phone-mate-label">
        {mate.name}
      </Tooltip>
    </Marker>
  );
}

function RaidClock({ c }: { c: NonNullable<PhoneState['raidClock']> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = c.endsAt !== null ? c.endsAt - now : null;
  return <span className={`phone-bar__clock mono${left !== null && left < 5 * 60_000 ? ' is-low' : ''}`}>{left !== null ? clock(left) : `+${clock(now - c.startedAt)}`}</span>;
}

export default function PhoneApp() {
  const { t } = useTranslation();
  const { state, conn } = usePhoneFeed();
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    document.documentElement.classList.add('phone-root');
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const mapId = state?.mapId ? canonicalMapId(state.mapId) : null;
  const def = mapId ? MAPS[mapId] : undefined;
  const crs = useMemo(() => (def ? makeCRS(def) : null), [def]);
  const toLatLng = mapId ? getGameToLatLng(mapId) : null;
  const route = state?.route ?? null;
  const pos = state?.pos ?? null;
  const age = pos ? now - pos.ts : Infinity;
  const mapRot = mapId ? (getMapDef(mapId)?.rotation ?? 0) : 0;

  return (
    <div className="phone">
      <header className="phone-bar">
        <span className={`phone-bar__conn is-${conn}`}>
          {conn === 'live' ? <WifiHigh weight="bold" /> : <WifiSlash weight="bold" />}
          {t(`phone.conn.${conn}`)}
        </span>
        <strong className="phone-bar__map">{state?.mapName ?? (mapId ? SUPPORTED_MAP_NAMES[mapId] : null) ?? t('phone.noMap')}</strong>
        {state?.raidClock && <RaidClock c={state.raidClock} />}
      </header>

      {conn === 'nokey' ? (
        <div className="phone-msg">{t('phone.nokey')}</div>
      ) : !def || !crs ? (
        <div className="phone-msg">{state ? t('phone.waitingMap') : t('phone.waitingPc')}</div>
      ) : (
        <MapContainer
          key={mapId}
          crs={crs}
          bounds={leafletBounds(def)}
          className="phone-map"
          zoomControl={false}
          attributionControl={false}
          zoomSnap={0.25}
          minZoom={-3}
          maxZoom={7}
        >
          {def.svgUrl.endsWith('.svg') ? (
            <FloorVisualOverlay
              svgUrl={def.svgUrl}
              bounds={leafletBounds(def)}
              floors={def.floors}
              activeFloorId={state?.activeFloorId ?? ALL_FLOORS}
              extraSvgUrls={def.extraSvgUrls}
            />
          ) : (
            <ImageOverlay url={def.svgUrl} bounds={leafletBounds(def)} />
          )}
          {toLatLng && route && (
            <>
              <Polyline positions={route.line.map((p) => toLatLng(p.x, p.z))} interactive={false} pathOptions={{ color: '#000', weight: 7, opacity: 0.4 }} />
              <Polyline
                positions={route.line.map((p) => toLatLng(p.x, p.z))}
                interactive={false}
                pathOptions={{ color: ROUTE_COLOR, weight: 3.5, dashArray: '9 7', opacity: 0.95 }}
              />
              {route.stops.map((p, i) => (
                <CircleMarker
                  key={`r${i}`}
                  center={toLatLng(p.x, p.z)}
                  radius={i === 0 ? 8 : 5}
                  interactive={false}
                  pathOptions={{ color: TOKEN_HEX.bgSunken, weight: 2, fillColor: ROUTE_COLOR, fillOpacity: i === 0 ? 1 : 0.75 }}
                />
              ))}
            </>
          )}
          {toLatLng &&
            state!.points.map((p, i) => (
              <CircleMarker
                key={`${p.kind}-${i}-${p.x}-${p.z}`}
                center={toLatLng(p.x, p.z)}
                radius={p.kind === 'quest' || p.kind === 'sniper' ? 7 : p.dim ? 4 : 7}
                interactive={false}
                pathOptions={{
                  color: TOKEN_HEX.bgSunken,
                  weight: p.dim ? 1 : 2,
                  opacity: p.dim ? 0.45 : 1,
                  fillColor: colorOf(p),
                  fillOpacity: p.dim ? 0.35 : 1,
                }}
              >
                {p.label && (
                  <Tooltip direction="top" offset={[0, -6]} permanent className="phone-exit-label">
                    {p.label}
                  </Tooltip>
                )}
              </CircleMarker>
            ))}
          {toLatLng &&
            (state!.mates ?? []).map((m) => <MateMarker key={m.id} mate={m} at={toLatLng(m.x, m.z)} heading={headingAngle(m.rotation, mapRot)} />)}
          <PlayerMarker position={pos} mapId={mapId!} symbol={state?.self?.symbol} color={state?.self?.color} />
          <Follow mapId={mapId!} pos={pos} on={follow} onDrag={() => setFollow(false)} />
        </MapContainer>
      )}

      {pos && age > STALE_MS && (
        <div className="phone-badge mono">{t('phone.ago', { min: Math.max(1, Math.round(age / 60_000)) })}</div>
      )}
      {def && (
        <button type="button" className={`phone-follow${follow ? ' is-on' : ''}`} onClick={() => setFollow(true)} aria-label={t('phone.follow')}>
          <Crosshair weight="bold" />
          <span>{t('phone.follow')}</span>
        </button>
      )}
    </div>
  );
}
