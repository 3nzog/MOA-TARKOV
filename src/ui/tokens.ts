// Token values that have to leave CSS as literal strings.
//
// Leaflet writes path colors into SVG presentation attributes (stroke="…"),
// where var(--token) does not resolve, so the few tokens the map layer needs
// are mirrored here. tokens.test.ts reads tokens.css and fails if any value
// drifts, so tokens.css stays the single source of truth.
export const TOKEN_HEX = {
  accent: '#ff7a2f',
  textDim: '#a8a1c4',
  bgSunken: '#06040d',
} as const;
