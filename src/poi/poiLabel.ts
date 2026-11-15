// The name a POI shows. tarkov.dev names (exits, keys, containers) are
// already in the app's language; the generic ones ("Sniper Scav",
// "Minefield"…) carry a labelKey and are translated here.
import { i18n } from '../i18n';
import type { Poi } from './types';

export function poiLabel(poi: Poi): string {
  const key = (poi.meta as { labelKey?: string } | undefined)?.labelKey;
  if (key && i18n.isInitialized) {
    const s = i18n.t(key);
    if (s && s !== key) return s;
  }
  return poi.label;
}
