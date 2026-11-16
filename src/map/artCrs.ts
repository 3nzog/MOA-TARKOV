// The map CRS and bounds for a calibrated hand-made map (see ArtOverlay.tsx).
import L from 'leaflet';
import { apply, type ArtCalibration, type Mat3 } from './artCalibration';

/** Leaflet CRS: game [z, x] → picture pixels through the homography. */
export function makeArtCRS(cal: ArtCalibration): L.CRS {
  const projection: L.Projection = {
    bounds: L.bounds([-1e7, -1e7], [1e7, 1e7]),
    project: (ll: L.LatLng) => {
      const [px, py] = apply(cal.H, ll.lng, ll.lat);
      return L.point(px, py);
    },
    unproject: (p: L.Point) => {
      const [x, z] = apply(cal.Hinv, p.x, p.y);
      return L.latLng(z, x);
    },
  };
  return L.Util.extend({}, L.CRS.Simple, {
    projection,
    transformation: new L.Transformation(1, 0, 1, 0),
  }) as L.CRS;
}

export const gameAt = (m: Mat3, px: number, py: number): L.LatLng => {
  const [x, z] = apply(m, px, py);
  return L.latLng(z, x);
};

/** The picture's area in game coordinates (for fitting the view). */
export function artBounds(cal: ArtCalibration): L.LatLngBounds {
  return L.latLngBounds([
    gameAt(cal.Hinv, 0, 0),
    gameAt(cal.Hinv, cal.w, 0),
    gameAt(cal.Hinv, 0, cal.h),
    gameAt(cal.Hinv, cal.w, cal.h),
  ]);
}

