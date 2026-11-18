// Everything the PC's map draws, for the phone: exits, spawns, loot and the
// rest of the map intel the player has switched on, quest pins, danger zones,
// place names, the grid, custom markers, drawings, the party (squadmates,
// their markers, drawings and quest pins) and the hot zones. The phone draws
// it with the same layers as the PC, but only as a map: no location pictures,
// no wiki links (those live in the PC's cards, which the phone never opens).
//
// Sent on its own frame (`{"layers":…}`), only when it changes: the position
// and the clock go in the small, frequent map state.
import type { TarkovTask, TaskObjective } from '../api/types';
import type { Poi } from '../poi/types';
import type { HeatSource, RaidPhase } from '../route/heat';
import type { MemberPosition } from '../squad/SquadContext';
import type { DrawPayload, SquadMember, WireMarker } from '../../shared/squadProtocol';

/** A quest pin: just what the map needs to place and name it. */
export interface PhoneObjective {
  task: { id: string; name: string };
  objective: Pick<TaskObjective, 'id' | 'description' | 'zones' | 'possibleLocations'>;
}

/** The party as the map layers read it (the part of the squad that is data). */
export interface PhoneSquad {
  selfId: string | null;
  members: SquadMember[];
  positions: Record<string, MemberPosition>;
  markers: Record<string, WireMarker[]>;
  draws: Record<string, DrawPayload[]>;
  hiddenQuests: Record<string, boolean>;
}

export interface PhoneLayers {
  mapId: string;
  /** Map intel the player has switched on (already filtered). */
  pois: Poi[];
  /** Ids drawn faded (exits that are not yours this raid). */
  dimmed: string[];
  /** Ids highlighted on the PC. */
  selected: string[];
  sniperRange: number;
  sniperCone: boolean;
  /** Your quest pins (empty when you hid your own). */
  objectives: PhoneObjective[];
  /** Quests you can take but have not accepted (drawn dimmer); null = off. */
  upcoming: PhoneObjective[] | null;
  /** Quest ids two or more of the party have. */
  shared: string[];
  questNames: boolean;
  placeLabels: boolean;
  grid: boolean;
  /** Your own markers. */
  custom: Poi[];
  ownDraws: DrawPayload[];
  drawHex: string;
  squad: PhoneSquad | null;
  /** Squadmates' quest pins on this map, by member id. */
  squadQuests: Record<string, PhoneObjective[]>;
  /** Hot zones, when the route and its hot zones are on. */
  heat: { sources: HeatSource[]; phase: RaidPhase; raid: number } | null;
}

/** The objective's places on this map only (the rest of the quest stays on the PC). */
export function slimObjective(task: Pick<TarkovTask, 'id' | 'name'>, objective: TaskObjective, mapId: string): PhoneObjective {
  return {
    task: { id: task.id, name: task.name },
    objective: {
      id: objective.id,
      description: objective.description,
      zones: objective.zones?.filter((z) => z.map?.id === mapId),
      possibleLocations: objective.possibleLocations?.filter((l) => l.map?.id === mapId),
    },
  };
}

/** Biggest layers frame the phone takes. */
export const LAYERS_MAX = 4_000_000;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const okPoi = (p: unknown): p is Poi => {
  const q = p as Poi | null;
  return !!q && typeof q.id === 'string' && typeof q.category === 'string' && !!q.position && typeof q.position.x === 'number' && typeof q.position.z === 'number';
};

/** A layers frame from the PC, checked enough to draw (null = not one). */
export function parsePhoneLayers(raw: string): PhoneLayers | null {
  if (raw.length > LAYERS_MAX) return null;
  try {
    const v = (JSON.parse(raw) as { layers?: Partial<PhoneLayers> } | null)?.layers;
    if (!v || typeof v !== 'object' || typeof v.mapId !== 'string') return null;
    const sq = v.squad;
    return {
      mapId: v.mapId,
      pois: list<unknown>(v.pois).filter(okPoi),
      dimmed: strings(v.dimmed),
      selected: strings(v.selected),
      sniperRange: typeof v.sniperRange === 'number' ? v.sniperRange : 150,
      sniperCone: v.sniperCone === true,
      objectives: list<PhoneObjective>(v.objectives),
      upcoming: Array.isArray(v.upcoming) ? (v.upcoming as PhoneObjective[]) : null,
      shared: strings(v.shared),
      questNames: v.questNames === true,
      placeLabels: v.placeLabels === true,
      grid: v.grid === true,
      custom: list<unknown>(v.custom).filter(okPoi),
      ownDraws: list<DrawPayload>(v.ownDraws),
      drawHex: typeof v.drawHex === 'string' ? v.drawHex : '#ffffff',
      squad:
        sq && typeof sq === 'object' && Array.isArray(sq.members)
          ? {
              selfId: typeof sq.selfId === 'string' ? sq.selfId : null,
              members: sq.members,
              positions: sq.positions ?? {},
              markers: sq.markers ?? {},
              draws: sq.draws ?? {},
              hiddenQuests: sq.hiddenQuests ?? {},
            }
          : null,
      squadQuests: v.squadQuests && typeof v.squadQuests === 'object' ? v.squadQuests : {},
      heat: v.heat && Array.isArray(v.heat.sources) ? v.heat : null,
    };
  } catch {
    return null;
  }
}
