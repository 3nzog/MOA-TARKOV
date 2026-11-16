// Other looks for each map, from tarkov.dev's map list
// (github.com/the-hideout/tarkov-dev, src/data/maps.json; regenerate when it changes):
//  - tiles: the textured / relief picture of the interactive map. Same
//    coordinates as the vector map, so every marker sits on it.
//  - art: hand-made 2D and 3D maps by community artists, shown as pictures
//    (no coordinates: no markers) with their author credited.

export interface TileStyle {
  url: string;
  minZoom: number;
  maxZoom: number;
  tileSize: number;
  author: string;
  authorLink: string;
}

export interface ArtMap {
  /** Picture at https://tarkov.dev/maps/<key>.jpg */
  key: string;
  kind: '2D' | '3D';
  /** A part of the map only (e.g. "Dorms"), when the picture is not the whole map. */
  specific?: string;
  author: string;
  authorLink: string;
}

export const TILE_STYLES: Record<string, TileStyle> = {
  // ground-zero
  '653e6760052c01c1c805532f': { url: "https://assets.tarkov.dev/maps/groundzero/main_summer/{z}/{x}/{y}.png", minZoom: 1, maxZoom: 6, tileSize: 256, author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/" },
  // customs
  '56f40101d2720b2a4d8b45d6': { url: "https://assets.tarkov.dev/maps/customs_0.16/main/{z}/{x}/{y}.png", minZoom: 2, maxZoom: 6, tileSize: 256, author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/" },
  // factory
  '55f2d3fd4bdc2d5f408b4567': { url: "https://assets.tarkov.dev/maps/factory/main/{z}/{x}/{y}.png", minZoom: 1, maxZoom: 6, tileSize: 256, author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/" },
  // icebreaker
  '69af492a4819ea4ba10a69c5': { url: "https://assets.tarkov.dev/maps/icebreaker/06_infirmary/{z}/{x}/{y}.png", minZoom: 1, maxZoom: 5, tileSize: 256, author: "TarkovBOT.eu", authorLink: "https://tarkovbot.eu/" },
  // interchange
  '5714dbc024597771384a510d': { url: "https://assets.tarkov.dev/maps/interchange/main/{z}/{x}/{y}.png", minZoom: 1, maxZoom: 6, tileSize: 256, author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/" },
  // the-lab
  '5b0fc42d86f7744a585f9105': { url: "https://assets.tarkov.dev/maps/labs_v4/1st/{z}/{x}/{y}.png", minZoom: 2, maxZoom: 6, tileSize: 175, author: "Tarkov.dev", authorLink: "https://tarkov.dev" },
  // the-labyrinth
  '6733700029c367a3d40b02af': { url: "https://assets.tarkov.dev/maps/labyrinth/main/{z}/{x}/{y}.png", minZoom: 1, maxZoom: 6, tileSize: 256, author: "Tarkov.dev", authorLink: "https://tarkov.dev" },
  // reserve
  '5704e5fad2720bc05b8b4567': { url: "https://assets.tarkov.dev/maps/reserve/main/{z}/{x}/{y}.png", minZoom: 2, maxZoom: 6, tileSize: 256, author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/" },
  // shoreline
  '5704e554d2720bac5b8b456e': { url: "https://assets.tarkov.dev/maps/shoreline/main_summer/{z}/{x}/{y}.png", minZoom: 2, maxZoom: 6, tileSize: 256, author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/" },
  // woods
  '5704e3c2d2720bac5b8b4567': { url: "https://assets.tarkov.dev/maps/woods/main_0.16/{z}/{x}/{y}.png", minZoom: 2, maxZoom: 6, tileSize: 256, author: "Shebuka", authorLink: "https://github.com/the-hideout/tarkov-dev-svg-maps/" },
};

export const ART_MAPS: Record<string, ArtMap[]> = {
  '5714dc692459777137212e12': [
    { key: "streets-2d", kind: '2D', author: "Jindouz", authorLink: "https://www.reddit.com/user/Jindouz" },
    { key: "streets-3d", kind: '3D', author: "re3mr", authorLink: "https://reemr.se" },
    { key: "streets-3d-caches", kind: '3D', specific: "Caches", author: "re3mr", authorLink: "https://reemr.se" },
    { key: "streets-3d-lexos", kind: '3D', specific: "Lexos", author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '653e6760052c01c1c805532f': [
    { key: "ground-zero-2d", kind: '2D', author: "xTycho", authorLink: "https://www.reddit.com/user/Tychodelouw/" },
    { key: "ground-zero-3d", kind: '3D', author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '56f40101d2720b2a4d8b45d6': [
    { key: "customs-2d", kind: '2D', author: "monkimonkimonk", authorLink: "https://www.reddit.com/user/monkimonkimonk/" },
    { key: "customs-3d", kind: '3D', author: "re3mr", authorLink: "https://reemr.se" },
    { key: "customs-3d-dorms", kind: '3D', specific: "Dorms", author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '55f2d3fd4bdc2d5f408b4567': [
    { key: "factory-2d", kind: '2D', author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '69af492a4819ea4ba10a69c5': [
    { key: "icebreaker-2d", kind: '2D', author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '5714dbc024597771384a510d': [
    { key: "interchange-2d", kind: '2D', author: "Lorathor", authorLink: "https://www.reddit.com/user/Lorathor6/" },
    { key: "interchange-3d", kind: '3D', author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '5b0fc42d86f7744a585f9105': [
    { key: "labs-2d", kind: '2D', author: "monkimonkimonk", authorLink: "https://www.reddit.com/user/monkimonkimonk/" },
  ],
  '6733700029c367a3d40b02af': [
    { key: "labyrinth-2d", kind: '2D', author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '5704e4dad2720bb55b8b4567': [
    { key: "lighthouse-2d", kind: '2D', author: "Shebuka & Jindouz", authorLink: "" },
    { key: "lighthouse-2d-landscape", kind: '2D', author: "Jindouz", authorLink: "https://www.reddit.com/user/Jindouz" },
    { key: "lighthouse-3d", kind: '3D', author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '5704e5fad2720bc05b8b4567': [
    { key: "reserve-2d", kind: '2D', author: "Jindouz", authorLink: "https://www.reddit.com/user/Jindouz" },
    { key: "reserve-3d", kind: '3D', author: "re3mr", authorLink: "https://reemr.se" },
    { key: "reserve-3d-tunnels", kind: '3D', specific: "Tunnels", author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '5704e554d2720bac5b8b456e': [
    { key: "shoreline-2d", kind: '2D', author: "monkimonkimonk", authorLink: "https://www.reddit.com/user/monkimonkimonk/" },
    { key: "shoreline-3d", kind: '3D', author: "re3mr", authorLink: "https://reemr.se" },
    { key: "shoreline-3d-resort", kind: '3D', specific: "Resort", author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '65cc8f81a9aac3e77d0cfd3e': [
    { key: "terminal-2d", kind: '2D', author: "re3mr", authorLink: "https://reemr.se" },
  ],
  '5704e3c2d2720bac5b8b4567': [
    { key: "woods-2d", kind: '2D', author: "Jindouz", authorLink: "https://www.reddit.com/user/Jindouz" },
    { key: "woods-3d", kind: '3D', author: "re3mr", authorLink: "https://reemr.se" },
  ],
};

export const artMapUrl = (key: string) => `https://tarkov.dev/maps/${key}.jpg`;
