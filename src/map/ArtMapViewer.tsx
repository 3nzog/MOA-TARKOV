// Hand-made 2D and 3D maps (src/map/mapStyles.ts): a big picture to pan and
// zoom, one tab per version, with the artist credited. Any of them can become
// the main map: the player clicks where 4 known exits are on it (once), and
// every marker is drawn on the picture from then on (src/map/artCalibration.ts).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { CircleMarker, ImageOverlay, MapContainer, useMapEvents } from 'react-leaflet';
import { Button, Modal, Segmented, Select, Spinner } from '../ui';
import { artMapUrl, type ArtMap } from './mapStyles';
import {
  activeArt,
  getCalibration,
  saveCalibration,
  setActiveArt,
  spreadPoints,
  useArtStore,
  type CalPoint,
} from './artCalibration';

export interface ArtRef {
  label: string;
  x: number;
  z: number;
}

function useImageSize(url: string): { w: number; h: number } | 'error' | null {
  const [size, setSize] = useState<{ url: string; v: { w: number; h: number } | 'error' } | null>(null);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => alive && setSize({ url, v: { w: img.naturalWidth, h: img.naturalHeight } });
    img.onerror = () => alive && setSize({ url, v: 'error' });
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return size && size.url === url ? size.v : null;
}

/** Clicks on the picture, as picture pixels (y down). */
function ClickCatcher({ h, onPick }: { h: number; onPick: (px: number, py: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lng, h - e.latlng.lat),
  });
  return null;
}

const NEEDED = 4;

export default function ArtMapViewer({
  maps,
  mapId,
  mapName,
  refs,
  onClose,
}: {
  maps: ArtMap[];
  mapId: string;
  mapName: string;
  /** Known exits on this map (names as the pictures write them), for calibrating. */
  refs: ArtRef[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useArtStore();
  const activeKey = activeArt(mapId)?.key ?? null;
  const [key, setKey] = useState(activeKey ?? maps[0]?.key ?? '');
  const current = maps.find((m) => m.key === key) ?? maps[0];
  const url = artMapUrl(current.key);
  const size = useImageSize(url);
  const label = (m: ArtMap) => (m.specific ? `${m.kind} · ${m.specific}` : m.kind);
  const bounds = useMemo<L.LatLngBoundsLiteral | null>(
    () => (size && size !== 'error' ? [[0, 0], [size.h, size.w]] : null),
    [size],
  );

  // Calibration: the exits to click, spread over the map, in order.
  const order = useMemo(() => spreadPoints(refs, refs.length), [refs]);
  const [calibrating, setCalibrating] = useState(false);
  const [points, setPoints] = useState<CalPoint[]>([]);
  // Exits already used, and the one picked for the next click (the most spread by default).
  const [used, setUsed] = useState<number[]>([]);
  const [choice, setChoice] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const calibrated = !!getCalibration(current.key);
  const isMain = activeKey === current.key;
  const remaining = order.map((_, i) => i).filter((i) => !used.includes(i));
  const targetIndex = choice !== null && remaining.includes(choice) ? choice : remaining[0];
  const target = targetIndex !== undefined ? order[targetIndex] : undefined;

  const startCalibration = () => {
    setPoints([]);
    setUsed([]);
    setChoice(null);
    setMsg(null);
    setCalibrating(true);
  };

  const pick = (px: number, py: number) => {
    if (!calibrating || !target || !size || size === 'error') return;
    const next = [...points, { gx: target.x, gz: target.z, px, py }];
    setPoints(next);
    if (targetIndex !== undefined) setUsed((u) => [...u, targetIndex]);
    setChoice(null);
    if (next.length < NEEDED) return;
    const cal = saveCalibration(current.key, next, size.w, size.h);
    setCalibrating(false);
    if (!cal) {
      setMsg(t('map.art.calFailed'));
      return;
    }
    setActiveArt(mapId, current.key);
    setMsg(t('map.art.calDone'));
  };

  const skip = () => {
    if (targetIndex !== undefined) setUsed((u) => [...u, targetIndex]);
    setChoice(null);
  };
  const outOfRefs = calibrating && !target;

  return (
    <Modal title={t('map.art.title', { map: mapName })} onClose={onClose} size="lg">
      {maps.length > 1 && !calibrating && (
        <Segmented value={current.key} onChange={(v) => setKey(v)} options={maps.map((m) => ({ id: m.key, label: label(m) }))} />
      )}
      {calibrating && (
        <div className="art-cal">
          {target ? (
            <>
              <span>{t('map.art.clickWhere')}</span>
              <Select
                aria-label={t('map.art.clickWhere')}
                value={String(targetIndex)}
                onChange={(e) => setChoice(Number(e.target.value))}
              >
                {remaining.map((i) => (
                  <option key={i} value={i}>
                    {order[i].label}
                  </option>
                ))}
              </Select>
              <small>
                ({points.length + 1} / {NEEDED})
              </small>
              <Button size="sm" variant="ghost" onClick={skip}>
                {t('map.art.skip')}
              </Button>
            </>
          ) : (
            <span>{t('map.art.noMoreRefs')}</span>
          )}
          <Button size="sm" variant="tertiary" onClick={() => setCalibrating(false)}>
            {t('common.cancel', { defaultValue: 'Cancelar' })}
          </Button>
        </div>
      )}
      <div className={`art-map${calibrating ? ' art-map--picking' : ''}`}>
        {size === null && (
          <div className="art-map__msg">
            <Spinner size="lg" /> {t('map.art.loading')}
          </div>
        )}
        {size === 'error' && <div className="art-map__msg">{t('map.art.failed')}</div>}
        {bounds && size && size !== 'error' && (
          <MapContainer
            key={current.key}
            crs={L.CRS.Simple}
            bounds={bounds}
            maxBounds={bounds}
            minZoom={-5}
            maxZoom={2}
            zoomSnap={0.25}
            zoomDelta={0.5}
            attributionControl={false}
            style={{ height: '100%', width: '100%', background: '#0b0c0a' }}
          >
            <ImageOverlay url={url} bounds={bounds} />
            <ClickCatcher h={size.h} onPick={pick} />
            {points.map((p, i) => (
              <CircleMarker
                key={i}
                center={[size.h - p.py, p.px]}
                radius={7}
                pathOptions={{ color: '#101208', weight: 2, fillColor: '#7fd6ac', fillOpacity: 1 }}
              />
            ))}
          </MapContainer>
        )}
      </div>
      {!calibrating && (
        <div className="art-actions">
          {isMain ? (
            <Button variant="secondary" onClick={() => setActiveArt(mapId, null)}>
              {t('map.art.backToNormal')}
            </Button>
          ) : calibrated ? (
            <Button variant="primary" onClick={() => setActiveArt(mapId, current.key)}>
              {t('map.art.useAsMain')}
            </Button>
          ) : (
            <Button variant="primary" onClick={startCalibration} disabled={order.length < NEEDED || !bounds}>
              {t('map.art.useAsMain')}
            </Button>
          )}
          {calibrated && (
            <Button variant="ghost" onClick={startCalibration} disabled={!bounds}>
              {t('map.art.recalibrate')}
            </Button>
          )}
          <span className="settings-row__hint">{calibrated ? t('map.art.calibratedHint') : t('map.art.calHint')}</span>
        </div>
      )}
      {msg && <p className="settings-row__hint">{msg}</p>}
      {outOfRefs && <p className="settings-err">{t('map.art.noMoreRefs')}</p>}
      <p className="art-map__credit">
        {t('map.art.credit', { kind: label(current) })}{' '}
        <a href={current.authorLink} target="_blank" rel="noreferrer">
          {current.author}
        </a>{' '}
        · {t('map.art.via')}{' '}
        <a href="https://tarkov.dev" target="_blank" rel="noreferrer">
          tarkov.dev
        </a>
        .
      </p>
    </Modal>
  );
}
