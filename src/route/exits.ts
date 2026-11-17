// The exits a route can end at, as the planner needs them: the extra time a
// condition takes (the car's wait, a switch, an item) and the car's price.
import { ROUBLES } from '../poi/fromTarkovDev';
import type { Poi } from '../poi/types';
import type { RouteExit } from './plan';

export const factionOf = (p: Poi): string => String((p.meta as { faction?: string } | undefined)?.faction ?? 'shared').toLowerCase();

export function exitOf(p: Poi): RouteExit {
  const m = (p.meta ?? {}) as { isCar?: boolean; requiresSwitch?: boolean; requiresItem?: boolean; payItem?: string; payCount?: number };
  const car = m.isCar === true;
  return {
    id: p.id,
    label: p.label,
    x: p.position.x,
    z: p.position.z,
    // The car leaves about a minute after you pay; a switch or an item takes a while too
    // (V-Ex on Customs needs both the power switch and the payment).
    penalty: (car ? 60 : 0) + (m.requiresSwitch ? 90 : 0) + (m.requiresItem && !car ? 60 : 0),
    note: p.note,
    car,
    price: m.payItem === ROUBLES && typeof m.payCount === 'number' ? m.payCount : undefined,
  };
}

/** A PMC's exits on a map (its own and the shared ones). */
export function pmcExits(pois: Poi[]): RouteExit[] {
  return pois.filter((p) => p.category === 'extract' && factionOf(p) !== 'scav').map(exitOf);
}
