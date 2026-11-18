// The map on a phone (opened from the QR code, ?view=phone&k=…): a full-screen
// map fed live by the PC over the home Wi-Fi. It only shows; nothing on the
// phone changes anything on the PC.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, ImageOverlay, MapContainer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CornersIn, CornersOut, Crosshair, WifiHigh, WifiSlash } from '@phosphor-icons/react';
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
import type { PhoneState } from './phoneApi';
import { usePhoneFeed, type LinkStats } from './usePhoneFeed';
import PhoneMapLayers from './PhoneMapLayers';
import '../App.css';
import './phone.css';

const STALE_MS = 90_000;

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
    // A short glide: the map keeps up with the screenshot instead of trailing it.
    map.setView(toLatLng(pos.x, pos.z), z, { animate: true, duration: 0.1 });
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

/** How fast the link is: screenshot → here for a recent one, else the Wi-Fi round trip. */
function LinkSpeed({ link }: { link: RefObject<LinkStats> }) {
  const [text, setText] = useState<{ key: 'phone.lag' | 'phone.rtt'; ms: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const l = link.current;
      const next =
        l.lag !== null && Date.now() - l.lagAt < 20_000
          ? { key: 'phone.lag' as const, ms: Math.round(l.lag) }
          : l.rtt !== null
            ? { key: 'phone.rtt' as const, ms: Math.round(l.rtt) }
            : null;
      setText((cur) => (cur?.key === next?.key && cur?.ms === next?.ms ? cur : next));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [link]);
  const { t } = useTranslation();
  if (!text) return null;
  return <span className={`phone-bar__speed mono${text.ms > 300 ? ' is-slow' : ''}`}>{t(text.key, { ms: text.ms })}</span>;
}

/** Full screen: hides the browser's address bar (and the phone's bars, on Android). */
function FullscreenButton() {
  const { t } = useTranslation();
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  // iPhone Safari has no full screen for a page: no button there.
  if (!document.fullscreenEnabled) return null;
  const toggle = () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    void p.catch(() => undefined);
  };
  const label = t(full ? 'phone.exitFullscreen' : 'phone.fullscreen');
  return (
    <button type="button" className="phone-bar__btn" onClick={toggle} aria-label={label} title={label}>
      {full ? <CornersIn weight="bold" /> : <CornersOut weight="bold" />}
    </button>
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
  const { state, layers: allLayers, conn, link } = usePhoneFeed();
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
  // Everything the PC's map draws, for the map shown (an older PC sends none:
  // then the few dots of the state stand in).
  const layers = allLayers && mapId && canonicalMapId(allLayers.mapId) === mapId ? allLayers : null;
  const floor = state?.activeFloorId ?? ALL_FLOORS;

  return (
    <div className="phone">
      <header className="phone-bar">
        <span className={`phone-bar__conn is-${conn}`}>
          {conn === 'live' ? <WifiHigh weight="bold" /> : <WifiSlash weight="bold" />}
          {t(`phone.conn.${conn}`)}
        </span>
        {conn === 'live' && <LinkSpeed link={link} />}
        <strong className="phone-bar__map">{state?.mapName ?? (mapId ? SUPPORTED_MAP_NAMES[mapId] : null) ?? t('phone.noMap')}</strong>
        {state?.raidClock && <RaidClock c={state.raidClock} />}
        <FullscreenButton />
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
              activeFloorId={floor}
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
          {layers && <PhoneMapLayers layers={layers} floors={def.floors} activeFloorId={floor} />}
          {toLatLng &&
            state!.points.filter((p) => !layers || p.kind === 'route').map((p, i) => (
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
