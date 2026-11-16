// Hand-made 2D and 3D maps (src/map/mapStyles.ts): a big picture to pan and
// zoom, one tab per version, with the artist credited. These pictures have no
// game coordinates, so markers are not drawn on them.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { ImageOverlay, MapContainer } from 'react-leaflet';
import { Modal, Segmented, Spinner } from '../ui';
import { artMapUrl, type ArtMap } from './mapStyles';

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

export default function ArtMapViewer({ maps, mapName, onClose }: { maps: ArtMap[]; mapName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState(maps[0]?.key ?? '');
  const current = maps.find((m) => m.key === key) ?? maps[0];
  const url = artMapUrl(current.key);
  const size = useImageSize(url);
  const label = (m: ArtMap) => (m.specific ? `${m.kind} · ${m.specific}` : m.kind);
  const bounds = useMemo<L.LatLngBoundsLiteral | null>(
    () => (size && size !== 'error' ? [[0, 0], [size.h, size.w]] : null),
    [size],
  );

  return (
    <Modal title={t('map.art.title', { map: mapName })} onClose={onClose} size="lg">
      {maps.length > 1 && (
        <Segmented
          value={current.key}
          onChange={(v) => setKey(v)}
          options={maps.map((m) => ({ id: m.key, label: label(m) }))}
        />
      )}
      <div className="art-map">
        {size === null && (
          <div className="art-map__msg">
            <Spinner size="lg" /> {t('map.art.loading')}
          </div>
        )}
        {size === 'error' && <div className="art-map__msg">{t('map.art.failed')}</div>}
        {bounds && (
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
          </MapContainer>
        )}
      </div>
      <p className="art-map__credit">
        {t('map.art.credit', { kind: label(current) })}{' '}
        <a href={current.authorLink} target="_blank" rel="noreferrer">
          {current.author}
        </a>{' '}
        · {t('map.art.via')}{' '}
        <a href="https://tarkov.dev" target="_blank" rel="noreferrer">
          tarkov.dev
        </a>
        . {t('map.art.noMarkers')}
      </p>
    </Modal>
  );
}
