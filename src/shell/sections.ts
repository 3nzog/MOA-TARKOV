import type { RailSection } from './Spine';

/** Sections that are a whole page in the map's place (planner, weapon bench, ammo), not a side panel. */
export const PAGE_SECTIONS: readonly RailSection[] = ['planner', 'gunsmith', 'ballistics'];

export const isPageSection = (s: RailSection | null): boolean => s !== null && PAGE_SECTIONS.includes(s);
