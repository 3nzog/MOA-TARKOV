// Raid preparation for one map: keys the active quests need there, items to
// carry in (to plant, mark or use), quest items to pick up, and extracts that
// demand something before they open.
//
// Everything is derived from the active quests' data plus the map's POIs. What
// the player actually carries is unknowable to a passive reader, so "I have
// this" is a checkbox the player ticks, never a detection.
import type { TarkovTask } from '../api/types';
import { canonicalMapId } from '../map/canonicalMap';
import type { Poi } from '../poi/types';
import { collectObjectiveMaps } from '../quests/derive';
import type { TaskMeta } from './types';

export interface KeyNeed {
  /** Any of these opens it. */
  itemIds: string[];
  taskIds: string[];
}

export interface CarryItem {
  itemId: string;
  count: number;
  kind: 'plant' | 'mark' | 'use';
  taskId: string;
  objectiveId: string;
}

export interface QuestItemPickup {
  questItemId: string;
  taskId: string;
  objectiveId: string;
}

export interface ExtractRequirement {
  poiId: string;
  label: string;
  note: string;
  faction: string;
  kind: 'switch' | 'item' | 'transit';
}

export interface RaidPrep {
  tasks: TarkovTask[];
  keys: KeyNeed[];
  carry: CarryItem[];
  pickups: QuestItemPickup[];
  extracts: ExtractRequirement[];
}

export interface RaidPrepInput {
  mapId: string;
  /** The player's active quests on this map (questState.availableTasksByMap[mapId]). */
  tasks: TarkovTask[];
  meta: Record<string, TaskMeta>;
  checkedObjectives: ReadonlySet<string>;
  /** POIs of this map (extracts / transits). Empty when they could not be loaded. */
  pois: Poi[];
  /**
   * Only these objectives (the raid route's stops): keys, items to carry and to
   * pick up for the others are left out. Undefined: every active objective.
   */
  onlyObjectives?: ReadonlySet<string>;
}

const onMap = (mapIds: string[], mapId: string): boolean =>
  mapIds.length === 0 || mapIds.some((id) => canonicalMapId(id) === mapId);

export function buildRaidPrep(input: RaidPrepInput): RaidPrep {
  const mapId = canonicalMapId(input.mapId);
  const keys = new Map<string, KeyNeed>();
  const carry: CarryItem[] = [];
  const pickups: QuestItemPickup[] = [];

  const addKey = (itemIds: string[], taskId: string): void => {
    if (itemIds.length === 0) return;
    const k = [...itemIds].sort().join('|');
    const cur = keys.get(k);
    if (cur) {
      if (!cur.taskIds.includes(taskId)) cur.taskIds.push(taskId);
    } else {
      keys.set(k, { itemIds, taskIds: [taskId] });
    }
  };

  const only = input.onlyObjectives;
  for (const task of input.tasks) {
    const meta = input.meta[task.id];
    if (!meta) continue;
    // With the route's objectives only: a quest none of whose objectives is on the route needs nothing.
    if (only && !(task.objectives ?? []).some((o) => only.has(o.id))) continue;
    for (const nk of meta.neededKeys) {
      if (nk.mapId === null || canonicalMapId(nk.mapId) === mapId) {
        // neededKeys lists alternatives for one door per entry.
        addKey(nk.keys, task.id);
      }
    }
    for (const objective of task.objectives ?? []) {
      if (input.checkedObjectives.has(objective.id)) continue;
      if (only && !only.has(objective.id)) continue;
      const o = meta.objectives[objective.id];
      if (!o) continue;
      if (!onMap(collectObjectiveMaps(objective), mapId)) continue;
      for (const group of o.keys) addKey(group, task.id);
      if (o.type === 'plantItem' || o.type === 'useItem') {
        // plantItem lists alternatives; any one of them, `count` times.
        const itemId = o.items[0];
        if (itemId) {
          carry.push({
            itemId,
            count: o.count ?? 1,
            kind: o.type === 'plantItem' ? 'plant' : 'use',
            taskId: task.id,
            objectiveId: objective.id,
          });
        }
      }
      if (o.type === 'mark' && o.marker) {
        carry.push({ itemId: o.marker, count: o.count ?? 1, kind: 'mark', taskId: task.id, objectiveId: objective.id });
      }
      if (o.type === 'findQuestItem' && o.questItem) {
        pickups.push({ questItemId: o.questItem, taskId: task.id, objectiveId: objective.id });
      }
    }
  }

  const extracts: ExtractRequirement[] = [];
  for (const poi of input.pois) {
    if (canonicalMapId(poi.mapId) !== mapId) continue;
    const meta = (poi.meta ?? {}) as Record<string, unknown>;
    if (poi.category === 'extract' && (meta.requiresSwitch || meta.requiresItem)) {
      extracts.push({
        poiId: poi.id,
        label: poi.label,
        note: poi.note ?? '',
        faction: String(meta.faction ?? 'shared'),
        kind: meta.requiresSwitch ? 'switch' : 'item',
      });
    } else if (poi.category === 'transit' && typeof meta.conditions === 'string' && meta.conditions) {
      extracts.push({ poiId: poi.id, label: poi.label, note: meta.conditions, faction: 'pmc', kind: 'transit' });
    }
  }

  return { tasks: input.tasks, keys: Array.from(keys.values()), carry, pickups, extracts };
}
