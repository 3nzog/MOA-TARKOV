// Appearance preferences: theme, accent, the glass material, sizes and motion.
//
// Stored per PC in localStorage and applied as CSS custom properties + data
// attributes on <html>, so every stylesheet (and the minimap window, which
// shares the origin and so the storage) follows without prop drilling.

export type ThemeMode = 'dark' | 'light';
export type LayoutMode = 'floating' | 'docked';
export type Density = 'compact' | 'normal' | 'roomy';

export interface GlassSettings {
  /** Backdrop blur, px. */
  blur: number;
  /** Panel fill opacity over the map (0 = clear, 1 = solid). */
  opacity: number;
  /** Backdrop saturation multiplier. */
  saturation: number;
  /** Strength of the lit top edge and hairline (0–1). */
  edge: number;
  /** Tint mixed into the glass (#rrggbb). */
  tint: string;
}

export interface Appearance {
  theme: ThemeMode;
  accent: string;
  layout: LayoutMode;
  glass: GlassSettings;
  /** Text size multiplier. */
  fontScale: number;
  density: Density;
  /** Corner roundness multiplier (0 = square). */
  radius: number;
  animations: boolean;
  /** The glass logo reveal when the app opens. */
  intro: boolean;
  /** Player / squadmate marker size multiplier. */
  markerScale: number;
  /** View cone in front of player markers. */
  viewCone: boolean;
  /** Name / label size multiplier on the map. */
  labelScale: number;
  /** Map image brightness (dims bright map art behind the glass). */
  mapBrightness: number;
  /** Place names on the main map ("Big Red", "Dorms"…). Never on the minimap. */
  placeLabels: boolean;
  /** The quest's name under each quest pin on the main map. */
  questNames: boolean;
  /** Also pin quests the player can take but has not accepted yet (dimmer). */
  upcomingQuests: boolean;
  /** Exits that are not the player's this raid stay on the map, faded (else hidden). */
  otherExits: boolean;
}

export const ACCENTS: { id: string; hex: string }[] = [
  { id: 'mint', hex: '#7fd6ac' },
  { id: 'brass', hex: '#c9a86a' },
  { id: 'ice', hex: '#7cb8f2' },
  { id: 'violet', hex: '#a593ec' },
  { id: 'rose', hex: '#e58fb0' },
  { id: 'amber', hex: '#efa45a' },
  { id: 'red', hex: '#ec6a6a' },
  { id: 'white', hex: '#e9ece4' },
];

export const GLASS_PRESETS: { id: 'clear' | 'frosted' | 'solid'; glass: Omit<GlassSettings, 'tint'> }[] = [
  { id: 'clear', glass: { blur: 10, opacity: 0.32, saturation: 1.15, edge: 0.75 } },
  { id: 'frosted', glass: { blur: 22, opacity: 0.6, saturation: 1.3, edge: 0.5 } },
  { id: 'solid', glass: { blur: 30, opacity: 0.92, saturation: 1, edge: 0.3 } },
];

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'dark',
  accent: ACCENTS[0].hex,
  layout: 'floating',
  glass: { ...GLASS_PRESETS[1].glass, tint: '#ffffff' },
  fontScale: 1,
  density: 'normal',
  radius: 1,
  animations: true,
  intro: true,
  markerScale: 1,
  viewCone: true,
  labelScale: 1,
  mapBrightness: 1,
  placeLabels: true,
  questNames: true,
  upcomingQuests: true,
  otherExits: true,
};

export const APPEARANCE_KEY = 'tc_appearance_v1';

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const oneOf = <T extends string>(v: unknown, opts: readonly T[], fallback: T): T =>
  opts.includes(v as T) ? (v as T) : fallback;
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);

/** Clamp and fill in anything missing or out of range (old saves, hand edits). */
export function normalizeAppearance(raw: unknown): Appearance {
  const d = DEFAULT_APPEARANCE;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Appearance, unknown>>;
  const g = (r.glass && typeof r.glass === 'object' ? r.glass : {}) as Partial<Record<keyof GlassSettings, unknown>>;
  return {
    theme: oneOf(r.theme, ['dark', 'light'] as const, d.theme),
    accent: hex(r.accent, d.accent),
    layout: oneOf(r.layout, ['floating', 'docked'] as const, d.layout),
    glass: {
      blur: num(g.blur, 0, 40, d.glass.blur),
      opacity: num(g.opacity, 0.15, 1, d.glass.opacity),
      saturation: num(g.saturation, 0.5, 2, d.glass.saturation),
      edge: num(g.edge, 0, 1, d.glass.edge),
      tint: hex(g.tint, d.glass.tint),
    },
    fontScale: num(r.fontScale, 0.85, 1.3, d.fontScale),
    density: oneOf(r.density, ['compact', 'normal', 'roomy'] as const, d.density),
    radius: num(r.radius, 0, 2, d.radius),
    animations: typeof r.animations === 'boolean' ? r.animations : d.animations,
    intro: typeof r.intro === 'boolean' ? r.intro : d.intro,
    markerScale: num(r.markerScale, 0.6, 1.8, d.markerScale),
    viewCone: typeof r.viewCone === 'boolean' ? r.viewCone : d.viewCone,
    labelScale: num(r.labelScale, 0.8, 1.6, d.labelScale),
    mapBrightness: num(r.mapBrightness, 0.4, 1.2, d.mapBrightness),
    placeLabels: typeof r.placeLabels === 'boolean' ? r.placeLabels : d.placeLabels,
    questNames: typeof r.questNames === 'boolean' ? r.questNames : d.questNames,
    upcomingQuests: typeof r.upcomingQuests === 'boolean' ? r.upcomingQuests : d.upcomingQuests,
    otherExits: typeof r.otherExits === 'boolean' ? r.otherExits : d.otherExits,
  };
}

export function loadAppearance(): Appearance {
  try {
    const v = localStorage.getItem(APPEARANCE_KEY);
    return normalizeAppearance(v ? JSON.parse(v) : null);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable */
  }
}

/** Relative luminance of a #rrggbb colour (0 = black, 1 = white). */
export function luminance(color: string): number {
  const v = parseInt(color.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Text colour that reads on a filled accent: near-black on light accents, white on dark. */
export function inkFor(color: string): string {
  return luminance(color) > 0.35 ? '#10140f' : '#ffffff';
}

/** Mix a #rrggbb colour with black (keep = share of the colour kept), like CSS color-mix. */
export function darken(color: string, keep: number): string {
  const v = parseInt(color.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.round(c * keep));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

const DENSITY: Record<Density, number> = { compact: 0.8, normal: 1, roomy: 1.18 };

/** Write the preferences onto <html> as custom properties and data attributes. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  const s = root.style;
  s.setProperty('--accent-base', a.accent);
  // tokens.css darkens the accent in the light theme; pick the ink for what is shown.
  s.setProperty('--accent-ink', inkFor(a.theme === 'light' ? darken(a.accent, 0.68) : a.accent));
  s.setProperty('--glass-blur', `${a.glass.blur}px`);
  s.setProperty('--glass-opacity', String(a.glass.opacity));
  s.setProperty('--glass-sat', String(a.glass.saturation));
  s.setProperty('--glass-edge', String(a.glass.edge));
  s.setProperty('--glass-tint', a.glass.tint);
  s.setProperty('--font-scale', String(a.fontScale));
  s.setProperty('--density', String(DENSITY[a.density]));
  s.setProperty('--radius-scale', String(a.radius));
  s.setProperty('--marker-scale', String(a.markerScale));
  s.setProperty('--label-scale', String(a.labelScale));
  s.setProperty('--map-brightness', String(a.mapBrightness));
  root.dataset.theme = a.theme;
  root.dataset.layout = a.layout;
  root.dataset.motion = a.animations ? 'on' : 'off';
  root.dataset.cone = a.viewCone ? 'on' : 'off';
}
