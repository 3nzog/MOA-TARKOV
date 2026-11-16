// The extra turn a heading arrow needs on the main map: the map's own rotation,
// plus, on a calibrated hand-made map, how much that picture is turned.
import { canonicalMapId } from './canonicalMap';
import { getMapDef } from './mapDefs';
import { activeArt, headingDelta } from './artCalibration';

export function headingOffset(mapId: string, x: number, z: number): number {
  const rotation = getMapDef(mapId)?.rotation ?? 0;
  const art = activeArt(canonicalMapId(mapId));
  return art ? rotation + headingDelta(art.H, x, z, rotation) : rotation;
}
