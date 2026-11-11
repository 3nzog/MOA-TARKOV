// "What do I still have to hand in?" — items owed to quests and hideout
// upgrades, merged per item and per found-in-raid requirement.
//
// Only hand-over objectives count (giveItem). EFT pairs most of them with a
// findItem objective for the SAME items; counting both would double every
// number. Plant/mark objectives are things to carry INTO a raid and live in
// raidPrep.ts instead.
import type { TarkovTask } from '../api/types';
import type { QuestInfo } from './status';
import { CURRENCY_IDS, type Station, type TaskMeta } from './types';

export type NeedScope = 'active' | 'available' | 'all';

export type NeedSource =
  | { kind: 'quest'; taskId: string; objectiveId: string; count: number }
  | { kind: 'hideout'; stationId: string; level: number; count: number };

export interface ItemNeed {
  /** Stable key for the "collected" counter: `${itemId}:fir|any`, or `obj:${objectiveId}` for any-of groups. */
  key: string;
  /** null for an "any of these" group. */
  itemId: string | null;
  /** Item ids accepted by an any-of group. */
  alternatives: string[];
  /** For any-of groups: the objective text, since there is no single item name. */
  label?: string;
  count: number;
  fir: boolean;
  currency: boolean;
  sources: NeedSource[];
}

export interface NeedsInput {
  tasks: TarkovTask[];
  meta: Record<string, TaskMeta>;
  statuses: Map<string, QuestInfo>;
  scope: NeedScope;
  /** Objectives the player ticked off — already handed in. */
  checkedObjectives: ReadonlySet<string>;
  /** Include hideout upgrades above the built level. */
  includeHideout: boolean;
  stations: Station[];
  stationLevels: Record<string, number>;
}

function inScope(info: QuestInfo | undefined, scope: NeedScope): boolean {
  if (!info) return false;
  if (info.status === 'complete' || info.status === 'failed') return false;
  if (scope === 'active') return info.status === 'active';
  if (scope === 'available') return info.status === 'active' || info.status === 'available';
  return true;
}

export function aggregateNeeds(input: NeedsInput): ItemNeed[] {
  const byKey = new Map<string, ItemNeed>();
  const add = (
    key: string,
    base: Omit<ItemNeed, 'count' | 'sources' | 'key'>,
    source: NeedSource,
  ): void => {
    let need = byKey.get(key);
    if (!need) {
      need = { key, ...base, count: 0, sources: [] };
      byKey.set(key, need);
    }
    need.count += source.count;
    need.sources.push(source);
  };

  for (const task of input.tasks) {
    if (!inScope(input.statuses.get(task.id), input.scope)) continue;
    const meta = input.meta[task.id];
    if (!meta) continue;
    for (const objective of task.objectives ?? []) {
      const o = meta.objectives[objective.id];
      if (!o || o.type !== 'giveItem' || o.optional) continue;
      if (input.checkedObjectives.has(objective.id)) continue;
      if (o.items.length === 0) continue;
      const count = o.count ?? 1;
      const source: NeedSource = { kind: 'quest', taskId: task.id, objectiveId: objective.id, count };
      if (o.items.length === 1) {
        const itemId = o.items[0];
        add(
          `${itemId}:${o.fir ? 'fir' : 'any'}`,
          { itemId, alternatives: [], fir: o.fir, currency: CURRENCY_IDS.has(itemId) },
          source,
        );
      } else {
        add(
          `obj:${objective.id}`,
          {
            itemId: null,
            alternatives: o.items,
            label: objective.description,
            fir: o.fir,
            currency: false,
          },
          source,
        );
      }
    }
  }

  if (input.includeHideout) {
    for (const station of input.stations) {
      const built = input.stationLevels[station.id] ?? 0;
      for (const level of station.levels) {
        if (level.level <= built) continue;
        for (const req of level.items) {
          add(
            `${req.itemId}:${req.fir ? 'fir' : 'any'}`,
            { itemId: req.itemId, alternatives: [], fir: req.fir, currency: CURRENCY_IDS.has(req.itemId) },
            { kind: 'hideout', stationId: station.id, level: level.level, count: req.count },
          );
        }
      }
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => Number(a.currency) - Number(b.currency) || Number(b.fir) - Number(a.fir) || b.count - a.count,
  );
}

export interface StationStatus {
  stationId: string;
  built: number;
  max: number;
  /** The next level's requirement on another station, unmet at the entered levels. */
  blockedBy: { stationId: string; level: number }[];
}

export function stationStatus(station: Station, stationLevels: Record<string, number>): StationStatus {
  const built = stationLevels[station.id] ?? 0;
  const max = station.levels.reduce((m, l) => Math.max(m, l.level), 0);
  const next = station.levels.find((l) => l.level === built + 1);
  const blockedBy = (next?.stations ?? []).filter((s) => (stationLevels[s.stationId] ?? 0) < s.level);
  return { stationId: station.id, built, max, blockedBy };
}
