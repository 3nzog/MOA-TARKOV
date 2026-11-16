// A calibrated hand-made map as the main map's picture (src/map/artCalibration.ts).
// The map's CRS maps game coordinates to the picture's pixels, so the picture
// is laid out by its pixel corners (an ImageOverlay would use the corners of a
// lat/lng box, which a perspective mapping does not keep).
import { useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { ArtCalibration } from './artCalibration';
import { gameAt } from './artCrs';

interface PixelOverlayOptions extends L.ImageOverlayOptions {
  tl: L.LatLng;
  br: L.LatLng;
}

// ImageOverlay positioned from two exact corners instead of a bounds box.
const PixelOverlay = L.ImageOverlay.extend({
  _reset(this: L.ImageOverlay & { _image: HTMLImageElement; _map: L.Map; options: PixelOverlayOptions }) {
    const tl = this._map.latLngToLayerPoint(this.options.tl);
    const br = this._map.latLngToLayerPoint(this.options.br);
    L.DomUtil.setPosition(this._image, tl);
    this._image.style.width = `${br.x - tl.x}px`;
    this._image.style.height = `${br.y - tl.y}px`;
  },
  _animateZoom(
    this: L.ImageOverlay & { _image: HTMLImageElement; _map: L.Map & { _latLngToNewLayerPoint: (ll: L.LatLng, z: number, c: L.LatLng) => L.Point }; options: PixelOverlayOptions },
    e: L.ZoomAnimEvent,
  ) {
    const scale = this._map.getZoomScale(e.zoom);
    const offset = this._map._latLngToNewLayerPoint(this.options.tl, e.zoom, e.center);
    L.DomUtil.setTransform(this._image, offset, scale);
  },
});

export default function ArtOverlay({ cal, url }: { cal: ArtCalibration; url: string }) {
  const map = useMap();
  useEffect(() => {
    const tl = gameAt(cal.Hinv, 0, 0);
    const br = gameAt(cal.Hinv, cal.w, cal.h);
    const layer = new (PixelOverlay as unknown as new (u: string, b: L.LatLngBounds, o: PixelOverlayOptions) => L.ImageOverlay)(
      url,
      L.latLngBounds(tl, br),
      { tl, br, interactive: false, crossOrigin: false },
    );
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, cal, url]);
  return null;
}
