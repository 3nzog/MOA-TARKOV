// The PC map's layers on the phone, drawn by the very same components as on
// the PC, read-only: nothing opens a card (no location pictures, no wiki
// links), nothing can be added or removed from the phone.
import { memo, useMemo } from 'react';
import type { TarkovTask, TaskObjective } from '../api/types';
import type { DerivedQuestState } from '../quests/derive';
import type { Poi } from '../poi/types';
import type { MapFloor } from '../map/floorClassify';
import { SquadCtx } from '../squad/useSquad';
import type { SquadApi } from '../squad/SquadContext';
import MarkerLayer from '../map/MarkerLayer';
import PlaceLabelLayer from '../map/PlaceLabelLayer';
import SquadQuestLayer from '../map/SquadQuestLayer';
import DangerZoneLayer from '../map/DangerZoneLayer';
import PoiLayer from '../map/PoiLayer';
import GridOverlay from '../map/GridOverlay';
import CustomMarkerLayer from '../map/CustomMarkerLayer';
import SquadMarkerLayer from '../map/SquadMarkerLayer';
import DrawLayer from '../map/DrawLayer';
import HeatLayer from '../route/HeatLayer';
import type { PhoneLayers, PhoneObjective } from './phoneLayers';

const always = () => true;
const noop = () => undefined;
type Pins = Array<{ task: TarkovTask; objective: TaskObjective }>;
const pins = (list: PhoneObjective[]) => list as unknown as Pins;

function PhoneMapLayers({ layers, floors, activeFloorId }: { layers: PhoneLayers; floors?: MapFloor[]; activeFloorId: string }) {
  const { mapId } = layers;
  const shared = useMemo(() => new Set(layers.shared), [layers.shared]);
  const selected = useMemo(() => new Set(layers.selected), [layers.selected]);
  const dimmed = useMemo(() => new Set(layers.dimmed), [layers.dimmed]);
  const isDimmed = useMemo(() => (p: Poi) => dimmed.has(p.id), [dimmed]);
  const describe = useMemo(() => (p: Poi) => layers.exitReqs[p.id] ?? null, [layers.exitReqs]);
  // The party as the layers read it; the phone never acts on it.
  const squad = useMemo(
    () =>
      ({
        selfId: layers.squad?.selfId ?? null,
        members: layers.squad?.members ?? [],
        positions: layers.squad?.positions ?? {},
        markers: layers.squad?.markers ?? {},
        draws: layers.squad?.draws ?? {},
        hiddenQuests: layers.squad?.hiddenQuests ?? {},
        quests: {},
        inSquad: !!layers.squad,
      }) as unknown as SquadApi,
    [layers.squad],
  );
  const squadQuests = useMemo(() => {
    const out: Record<string, DerivedQuestState> = {};
    for (const [id, list] of Object.entries(layers.squadQuests)) {
      out[id] = { availableObjectivesByMap: { [mapId]: pins(list) } } as unknown as DerivedQuestState;
    }
    return out;
  }, [layers.squadQuests, mapId]);

  return (
    <SquadCtx.Provider value={squad}>
      <MarkerLayer
        mapId={mapId}
        objectives={pins(layers.objectives)}
        floors={floors}
        activeFloorId={activeFloorId}
        sharedQuestIds={shared}
        upcoming={layers.upcoming ? pins(layers.upcoming) : undefined}
        showNames={layers.questNames}
      />
      <PlaceLabelLayer mapId={mapId} visible={layers.placeLabels} />
      {layers.squad && <SquadQuestLayer mapId={mapId} questStates={squadQuests} sharedQuestIds={shared} />}
      <DangerZoneLayer mapId={mapId} pois={layers.pois} isVisible={always} sniperRange={layers.sniperRange} sniperCone={layers.sniperCone} />
      <PoiLayer
        mapId={mapId}
        pois={layers.pois}
        isVisible={always}
        isDimmed={isDimmed}
        selectedPoiIds={selected}
        floors={floors}
        activeFloorId={activeFloorId}
        describe={describe}
      />
      <GridOverlay mapId={mapId} visible={layers.grid} />
      {layers.heat && <HeatLayer mapId={mapId} sources={layers.heat.sources} phase={layers.heat.phase} raid={layers.heat.raid} />}
      {layers.custom.length > 0 && <CustomMarkerLayer mapId={mapId} pois={layers.custom} />}
      {layers.squad && <SquadMarkerLayer mapId={mapId} />}
      <DrawLayer mapId={mapId} tool={null} color={layers.drawHex} ownDraws={layers.ownDraws} onCommit={noop} />
    </SquadCtx.Provider>
  );
}

// Positions come several times a second; the layers only redraw when they change.
export default memo(PhoneMapLayers);
