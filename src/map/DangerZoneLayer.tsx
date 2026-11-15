// Areas drawn under the markers: Scav sniper posts in bright red (the zone's
// real outline, a 360° reach ring, and, if turned on, an estimated aim cone)
// and minefields with their outline. See src/poi/sniper.ts for what is data
// and what is estimated.
import { Fragment, useMemo } from 'react';
import { Polygon, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { useTranslation } from 'react-i18next';
import type { Poi } from '../poi/types';
import { getGameToLatLng } from './mapDefs';
import { arcPoints, conePoints, estimateAim, sniperSpots, type XZ } from '../poi/sniper';
import { MARKER_COLORS } from '../poi/registry';

export interface DangerZoneLayerProps {
  mapId: string;
  /** This map's POIs (all of them: the aim estimate looks at what is around). */
  pois: Poi[];
  isVisible: (poi: Poi) => boolean;
  /** Ring radius, metres. */
  sniperRange: number;
  sniperCone: boolean;
}

const RED = MARKER_COLORS.SNIPER;
const MINE = MARKER_COLORS.MINE;

export default function DangerZoneLayer({ mapId, pois, isVisible, sniperRange, sniperCone }: DangerZoneLayerProps) {
  const { t } = useTranslation();
  const toLatLng = getGameToLatLng(mapId);
  const visible = useMemo(() => pois.filter(isVisible), [pois, isVisible]);
  const spots = useMemo(() => sniperSpots(visible), [visible]);
  const around = useMemo<XZ[]>(
    () =>
      pois
        .filter((p) => p.category === 'extract' || p.category === 'transit' || p.category === 'loot' || (p.category === 'spawn' && p.subtype === 'pmc'))
        .map((p) => ({ x: p.position.x, z: p.position.z })),
    [pois],
  );
  const mines = useMemo(
    () =>
      visible
        .filter((p) => p.category === 'minefield')
        .map((p) => ({ id: p.id, outline: ((p.meta as { outline?: XZ[] } | undefined)?.outline ?? []) }))
        .filter((m) => m.outline.length >= 3),
    [visible],
  );
  if (!toLatLng) return null;
  const ll = (pts: XZ[]): LatLngExpression[] => pts.map((p) => toLatLng(p.x, p.z) as LatLngExpression);

  return (
    <>
      {mines.map((m) => (
        <Polygon
          key={m.id}
          positions={ll(m.outline)}
          interactive={false}
          pathOptions={{ color: MINE, weight: 2, dashArray: '6 5', fillColor: MINE, fillOpacity: 0.16, className: 'tc-zone-mine' }}
        />
      ))}
      {spots.map((s) => {
        const aim = sniperCone ? estimateAim(s.center, around, sniperRange) : null;
        return (
          <Fragment key={s.id}>
            {/* 360° reach: a soft outer ring and a stronger inner one, so it fades with distance. */}
            <Polygon
              positions={ll(arcPoints(s.center, sniperRange))}
              interactive={false}
              pathOptions={{ color: RED, weight: 1.5, dashArray: '4 6', fillColor: RED, fillOpacity: 0.07, className: 'tc-zone-sniper-ring' }}
            />
            <Polygon
              positions={ll(arcPoints(s.center, sniperRange * 0.5))}
              interactive={false}
              pathOptions={{ stroke: false, fillColor: RED, fillOpacity: 0.08 }}
            />
            {aim && (
              <Polygon
                positions={ll(conePoints(s.center, aim.angle, sniperRange))}
                interactive={false}
                pathOptions={{ color: RED, weight: 1.5, dashArray: '2 5', fillColor: RED, fillOpacity: 0.12 + 0.12 * aim.confidence }}
              />
            )}
            {s.outline && (
              <Polygon
                positions={ll(s.outline)}
                pathOptions={{ color: RED, weight: 2.5, fillColor: RED, fillOpacity: 0.35, className: 'tc-zone-sniper' }}
              >
                <Tooltip direction="top" sticky className="tc-poi-tip">
                  {t('map.sniper.zone', { m: Math.round(sniperRange) })}
                  {aim && (
                    <>
                      <br />
                      <small>{t('map.sniper.cone')}</small>
                    </>
                  )}
                </Tooltip>
              </Polygon>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
