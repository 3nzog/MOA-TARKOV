// Patch notes shown in the in-app "Patch notes" modal. Newest entry first.
// To cut a release: prepend a new entry here (keep it short — a few bullets),
// then bump the version in ALL THREE of package.json, src-tauri/tauri.conf.json
// and src-tauri/Cargo.toml, and rebuild. Each has drifted at least once: the
// installer and the in-app version both come from tauri.conf.json, so a stale
// Cargo.toml is invisible to users and shows up only as a build log compiling a
// version you do not recognise.

export interface PatchNote {
  version: string;
  date: string; // ISO yyyy-mm-dd
  changes: string[];
  thanks?: string;
}

export const PATCH_NOTES: PatchNote[] = [
  {
    version: "0.11.0",
    date: "2026-11-18",
    changes: [
      "Starts with Windows, hidden: only an icon by the clock, no window, until Tarkov starts (seen in its logs) — then it comes up on its own. On a second PC linked to the game PC it comes up too, so both screens open together. Settings → General → Starting up.",
      "Exits: what each one asks for, in your language — paracord, Red Rebel ice pick, no armour vest, no backpack, green flare, the code-word note, the minefield map, co-op, paid, power, lever, key or keycard, not always open, single use — on the exit's hover text, its card, the route and the phone. Fixed: Customs' exits all said they needed the power switch.",
      "Bosses: each boss's chance on the map and where it appears, on its spots and in the route window, and a new route goal to hunt them (Discreet leaves the busy spots out). Fixed: a boss whose spawn zone is certain (the Goons) showed as 100%.",
      "An inventory screenshot counts toward what quests and the hideout still need (Planner → Items): counters only go up, to what was seen; one item counts once.",
      "Scav wait: a Scav raid's end starts the countdown (set its length once in Settings → General → Scav), shown at the bottom of the map, with a sound when the Scav is ready.",
      "Hideout timers: tap ▶ when you start an upgrade or a craft in Planner → Hideout; the time comes from the game data and can be corrected, and a sound plays when it is done (an upgrade also raises the station's level).",
      "Squad Mode: no change to the squad protocol; 0.10.x and 0.11.0 see each other.",
    ],
  },
  {
    version: "0.10.1",
    date: "2026-11-18",
    changes: [
      "The map on the phone shows everything the PC's map shows: the exits, spawns, loot and other map intel you have switched on, quest pins (with names), sniper and minefield zones, place names, the grid, your markers and drawings, the party's markers, drawings and quest pins, the hot zones, and the relief picture when the PC uses it. Only as a map: tapping shows a name, never location pictures or wiki links.",
      "The phone is faster: a screenshot's position goes straight to it (it used to wait for the app's window, which runs slowly behind the game, and the PC waited 150 ms before reading each screenshot), its Wi-Fi is kept awake while the map is on screen, and the map glides to you in 0.1 s. The bar shows how long a screenshot took to get there.",
      "The phone keeps its screen on while the map is open, and reconnects on its own if it stopped getting positions (it could, after its screen went off). Full screen: a button on Android; on iPhone, add the map to the home screen and it opens full screen, like an app. Fixed: the map on the phone could stay blank.",
      "Routes: the route button on the map opens and closes the route window; the \"Routes\" switch inside it (and in Settings → General) turns every route on or off. Off means off: nothing of them on the map, minimap or phone, and no route sounds (they used to play with the route off).",
      "Linking PCs: a PC outside your home network (Radmin, internet) that nobody clicked no longer pops up \"Link a PC?\" on yours; it is turned away quietly. A request made with a click still asks. Over Radmin, the PC that asks needs 0.10.1 too.",
      "Faster start: only your language is loaded (the other five come when you switch), which halves the main script.",
      "One file to install, update and open: \"Abrir Tarkov MoA.bat\". Run from anywhere it installs (into Documents\\Tarkov MoA); run inside the program's folder it updates and opens. \"Instalar Tarkov MoA.bat\" is gone.",
      "Squad Mode: no change to the squad protocol; 0.10.0 and 0.10.1 see each other.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-11-17",
    changes: [
      "New look: Thermal. The app as seen through a thermal sight — cold violet surfaces, heat in the thermal scale, your route as the cold line through it, springy animations. The light theme is the sight's black-hot mode. Animations stop with \"reduce motion\" or with animations off in Settings → Appearance.",
      "Raid route: pick the goal — quests, loot (money, hideout items or weapons) or Scavs — and compare four styles side by side: direct, balanced, discreet (walks around busy places) and aggressive (goes where players are, still avoids mines and snipers). It always starts from your latest screenshot.",
      "Hot zones: where players tend to be at each moment of the raid (spawns early, loot mid-raid, exits late), shown on the map, with a ⚠ on busy stops and an optional sound when you walk into one.",
      "The route on the in-game minimap and on the phone; loot worth a short detour; ending at the car exit for Fence reputation; \"Which map pays off\" and \"Only what the route needs\" in Planner → Raid.",
      "A screenshot of the game's Tasks screen marks the quests listed there as active when the logs missed them. Ammo shows the cheapest round that gets through a given armour class, at trader prices.",
      "Faster: the minimap window loads only its own code, panels load when first opened, and the raid clock no longer redraws the whole app every second. Fixed: quest and exit dots on the minimap could be hidden under the map art.",
      "Squad Mode: no change to the squad protocol; 0.9.0 and 0.10.0 still see each other.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-08-26",
    changes: [
      "Fixed: quests load again. If the app has been showing you an empty screen and a red error bar, this update is the fix.",
      "What went wrong: every quest, map and point of interest came from one place — tarkov.dev's API — and that API stopped answering on 21 July and has not come back. One source, no backup, so when it went down the app went down with it.",
      "Quest data now comes from a copy rebuilt every day and published alongside the app, with another copy built into the install itself. Quests only change when the game patches, so a daily rebuild loses you nothing — and it means the app no longer depends on any single server being awake at the moment you open it. Map intel (extracts, spawns, loot) is still fetched live.",
      "There are now four places to look instead of one, and you only see an error if all four come up empty. When you are on saved data the header tells you how old it is instead of claiming it just synced.",
      "Fixed: Reserve now shows quest markers. It never did — the app had one wrong character in that map's internal ID, so every Reserve objective was filed against a map the app did not recognise. 22 quests were affected.",
      "Fixed: Night Factory, Ground Zero 21+ and the Ground Zero tutorial had no map intel at all. Their extracts, spawns and loot containers now show up like every other map.",
      "Fixed: Ground Zero 21+ quests were hidden from you. The app was gating them on your player level but had no way to ever learn your level, so the gate stayed shut permanently — while your squadmates' markers for the same quests showed up fine.",
      "Squad Mode: everyone in a squad needs 0.9.0. Two of the map IDs changed in this release, and a 0.8.x client and a 0.9.0 client would silently stop seeing each other on those maps. You will now get a clear version-mismatch message instead of a teammate who appears connected but invisible.",
    ],
  },
  {
    version: "0.8.1",
    date: "2026-06-15",
    changes: [
      "New: Squad Mode is now online. Create or join a squad with a code and share your live position, markers, drawings and quests with friends anywhere — no setup, no network fiddling.",
      "Your squad data is relayed over a secure connection; nothing is stored, and your home network is never exposed.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-06-14",
    changes: [
      "New: Tarkov MoA now speaks 6 languages — English, Português (Brasil), Русский, 日本語, 中文 and Español. It picks your in-game language automatically, or you can choose your own under Settings → Language (also on the first-run welcome screen).",
      "Quest, map and point-of-interest names are translated too — they follow your game's language so they read exactly like they do in Tarkov.",
      "Improved: squad mode polish and a smoother, more reliable map experience under the hood.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-06-01",
    changes: [
      "New: multi-floor maps now cover Factory, Shoreline, Streets of Tarkov, Ground Zero, and The Lab — the map knows their upper floors, basements, tunnels, and garages too.",
      "New: stairs and ramps you can use to change floors are highlighted in gold on every multi-floor map.",
      "Improved: picking a floor now shows just the ground level plus that floor, cleanly — no more see-through layers stacking up and muddying the view.",
      "Improved: markers and quest points on a floor you're not viewing now fade out, so it's clearer what's actually on your level.",
      "Changed: the floor switcher reads top-to-bottom (highest floor down to basements) and drops the repeated “Floor” word for a cleaner list.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-05-31",
    changes: [
      "New: 7 more maps — Factory, Lighthouse, Shoreline, Reserve, Streets of Tarkov, The Lab, and Terminal.",
      "Fixed: Ground Zero no longer shows up multiple times in the map list (the 1-20, 21+, and tutorial versions are now one entry).",
      "New: multi-floor maps! On Interchange, Reserve, and Customs the map now knows about upper floors, tunnels, and bunkers.",
      "New: the map auto-follows your floor — take a screenshot underground and the map highlights that level, dimming the others. Markers on other floors fade so you can tell what's on your level.",
      "New: a floor switcher (top-right) with an “Auto” button — tap a floor to look around manually, tap “Auto” to snap back to following you.",
    ],
  },
  {
    version: "0.5.1",
    date: "2026-05-30",
    changes: [
      "Fixed: your player marker now shows your real in-game position — it was being mirrored to the opposite side of the map.",
      "Fixed: the player arrow now points the correct way.",
      "Fixed: removed a render loop that made the app stutter and burn CPU.",
      "Changed: the map now defaults to showing only PMC extractions, active quests, and your custom markers. Everything else is off by default (toggle anything back on under “Others”).",
      "Changed: hidden the placeholder level / faction display.",
      "Renamed the app to Tarkov MoA (Map of Action).",
    ],
    thanks: "Thanks to Gui for flagging the player-position bug! 🎯",
  },
];
