// How a route's stops and plans are put into words, shared by the card and the
// map: containers grouped by what they hold, roubles in short form, why a
// place is hot, and what a plan is worth to its goal.
import type { TFunction } from 'i18next';
import { hotReason, HOT, type HeatKind, type HeatSource } from './heat';
import type { RoutePlan, RouteStop } from './plan';
import type { RouteGoal } from './targets';

export type ContainerGroup = 'money' | 'tech' | 'military' | 'med' | 'food' | 'cache' | 'body' | 'bag';

const GROUP_OF: Record<string, ContainerGroup> = {
  'safe': 'money',
  'bank-safe': 'money',
  'cash-register': 'money',
  'bank-cash-register': 'money',
  'pc-block': 'tech',
  'technical-supply-crate': 'tech',
  'toolbox': 'tech',
  'weapon-box': 'military',
  'wooden-ammo-box': 'military',
  'grenade-box': 'military',
  'wooden-crate': 'military',
  'medcase': 'med',
  'medbag': 'med',
  'medical-supply-crate': 'med',
  'ration-supply-crate': 'food',
  'ground-cache': 'cache',
  'buried-barrel-cache': 'cache',
  'shturmans-stash': 'cache',
  'dead-scav': 'body',
  'scav-body': 'body',
  'pmc-body': 'body',
  'civilian-body': 'body',
  'lab-technician-body': 'body',
};

/** Containers counted by group, the biggest first. */
export function containerGroups(containers: Record<string, number> | undefined): { group: ContainerGroup; n: number }[] {
  const by = new Map<ContainerGroup, number>();
  for (const [kind, n] of Object.entries(containers ?? {})) {
    const g = GROUP_OF[kind] ?? 'bag';
    by.set(g, (by.get(g) ?? 0) + n);
  }
  return [...by.entries()].map(([group, n]) => ({ group, n })).sort((a, b) => b.n - a.n);
}

/** 420000 → "420 mil" / "420K", in the app's language. */
export function shortNumber(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

/** A stop's title: the quest's name, or the place of a loot or Scav area. */
export function stopTitle(s: RouteStop, t: TFunction): string {
  if (s.info?.kind === 'loot') return s.info.place ?? t('route.loot.area');
  if (s.info?.kind === 'scavs') return s.info.place ?? t('route.scavs.area');
  return s.items[0]?.task.name ?? '';
}

/** One line on what a loot or Scav area holds. */
export function stopDetail(s: RouteStop, t: TFunction, names: Record<string, string>): string {
  const info = s.info;
  if (!info) return '';
  if (info.kind === 'scavs') return t('route.scavs.spawns', { count: info.spawns ?? 0 }) + (info.boss ? ` · ${t('route.scavs.boss')}` : '');
  const parts = containerGroups(info.containers).map((g) => `${t(`route.cg.${g.group}`)} ${g.n}`);
  if (info.loose) parts.push(`${t('route.cg.loose')} ${info.loose}`);
  const items = (info.items ?? []).map((id) => names[id]).filter(Boolean).slice(0, 3);
  return [parts.join(' · '), items.length ? items.join(', ') : ''].filter(Boolean).join(' — ');
}

/** Why the i-th stop of a plan is hot when it is reached (null when it is not). */
export function stopHotReason(plan: RoutePlan, i: number, sources: HeatSource[], raid: number): HeatKind | null {
  if ((plan.stopHeat[i] ?? 0) < HOT) return null;
  const s = plan.stops[i];
  return hotReason(sources, s, plan.arrivals[i] ?? 0, raid)?.kind ?? null;
}

/** What a plan is worth to its goal, in words ("5 objetivos", "~420 mil ₽", "12 spawns"…). */
export function planWorth(plan: RoutePlan, goal: RouteGoal, t: TFunction, lang: string): string {
  if (goal === 'quests') return t('route.worth.quests', { count: plan.stops.reduce((n, s) => n + Math.max(1, s.items.length), 0) });
  if (goal === 'money') return t('route.worth.money', { value: shortNumber(plan.value, lang) });
  if (goal === 'scavs') return t('route.worth.scavs', { count: Math.round(plan.value) });
  return t('route.worth.areas', { count: plan.stops.length });
}

/** Share of the route's time spent in hot places, 0–100. */
export function hotShare(plan: RoutePlan): number {
  return plan.total > 0 ? Math.round((100 * Math.min(plan.hot, plan.total)) / plan.total) : 0;
}
