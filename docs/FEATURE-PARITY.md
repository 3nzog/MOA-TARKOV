# Feature parity audit — planner, raid prep, economy

An audit of the companion-app features players commonly expect, checked
against this codebase, and what was built to close the gaps. Behaviour was
taken from ordinary use of such tools only; no other app's code, text or assets
were consulted or copied. All data comes from tarkov.dev (see
`scripts/fetch-progression.mjs`) and from the files the game already writes.

Status legend: **done** · **partial** · **missing** · **not feasible** (needs
data a passive reader cannot get).

## Map and in-raid

| Feature | Before | Now | Where |
|---|---|---|---|
| Player position on the map | done (screenshot filenames) | done | `src-tauri/src/screenshots.rs`, `src/map/PlayerMarker.tsx` |
| Compact / always-on-top window | missing | **done** — compact mode hides the rail and keeps the window on top (Tauri `setAlwaysOnTop`); exclusive fullscreen cannot be drawn over | `src/app/useCompactMode.ts` |
| Second monitor | done (ordinary window) | done | — |
| Phone / tablet view | missing | **missing** — see "Not built" below | — |
| Layers and filters (extracts, spawns, loot, hazards, objectives) | done | done | `src/map/PoiFilterPanel.tsx`, `src/poi/` |
| Your exits this raid (O+O) | missing | **done** — a screenshot taken with the O+O list open is read by Windows OCR (top-right corner only, before the file is deleted); the names are matched to every map's extracts and transits in all six languages (whatever language the game or app uses), the list's own map is picked and switched to, and the map, minimap and Raid tab then show only those exits for that raid. On the minimap each one is named, and those outside the view get an arrow on the rim with name and straight-line distance (transits in orange). OCR uses the game language's recognizer when Windows has it installed | `src-tauri/src/extract_panel.rs`, `src/poi/extractPanel.ts` |
| Extract requirements | partial (tooltip note only) | **done** — listed per map in Raid prep (switch / item / transit conditions) | `src/progression/raidPrep.ts` |
| Keys useful for the raid | missing | **done** — keys required by active quests on the map, with "I have it" ticks | `src/progression/raidPrep.ts`, `src/planner/RaidPrepTab.tsx` |
| Custom markers | done | done | `src/map/CustomMarkerLayer.tsx` |
| Configurable keyboard shortcuts | partial (Esc only) | **done, in-app** — rebindable in Settings; fire only while the MoA window has focus | `src/app/useHotkeys.ts`, `src/components/HotkeySettings.tsx` |
| Item identification by Shift+click in game | missing | **not feasible** — it needs a global mouse hook or screen reading while the game has focus. Replacement: item price search in Planner → Market | `src/planner/MarketTab.tsx` |

## Quests and progression

| Feature | Before | Now | Where |
|---|---|---|---|
| Automatic quest sync from logs | done (Side quests) | done; log events now carry their timestamp | `src-tauri/src/log_watcher.rs` |
| Quest list with status, tickable objectives | partial (active-on-map only, no ticks) | **done** — every quest, filterable by status / trader / map / Kappa / text, objectives tickable, manual status override (labelled, reversible, expired by a newer log event) | `src/planner/QuestBoard.tsx`, `src/state/localProgress.ts` |
| Prerequisite tree, what is doable at my level / faction | missing | **done** — prerequisite tree, unlocks, lock reasons; level/faction gates apply only once the player enters them | `src/progression/status.ts` |
| Quests by map + what to bring | partial (quests by map) | **done** — Raid prep tab | `src/planner/RaidPrepTab.tsx` |
| Items for future quests incl. found-in-raid | missing | **done** — hand-in items merged per item and FIR flag, scope active / available / all future, own collected counter | `src/progression/needs.ts`, `src/planner/NeedsTab.tsx` |
| TarkovTracker sync | missing (a dead client for the old `tarkovtracker.io` API, unused) | **done** — import quests, objectives, hideout levels, level and faction; send live quest events, manual statuses, objective ticks and level (needs a key with write). Key kept in Windows Credential Manager, entered in a separate console window, read only by the Rust core | `src-tauri/src/tracker.rs`, `src/state/trackerSync.ts`, `src/app/useTracker.ts`, `scripts/tarkovtracker-key.ps1` |
| Completion inference | — | **new** — accepting a quest proves its "must be complete" prerequisites are done; shown as *inferred*, with a one-click fix for quests the logs left "active" | `src/progression/status.ts` |

## Hideout, items, economy

| Feature | Before | Now | Where |
|---|---|---|---|
| Hideout station tracker | missing | **done** — built level per station (entered by the player), next-level requirements, station prerequisites checked | `src/planner/HideoutTab.tsx` |
| Craft planner with cost / profit | missing | **done (estimates)** — cost, value, profit, profit/hour from a dated price snapshot; flea fees not modelled | `src/progression/economy.ts`, `src/planner/MarketTab.tsx` |
| Trader / flea prices | missing | **done (estimates)** — flea 24h avg and last low, best trader buy-back, cheapest trader offer, value per slot; snapshot date always shown | `src/planner/MarketTab.tsx` |

## Stats

| Feature | Before | Now | Where |
|---|---|---|---|
| Raid history and wipe stats | missing | **partial** — map, start, end and duration per raid, raids per map, quests completed; filter from a wipe start date. Survival, kills, loot and XP are not in any file the app can read | `src/state/raidHistory.ts`, `src/planner/SummaryTab.tsx` |
| PMC / Scav per raid | missing | **done** — from the raid profile fingerprint, learned via squad notifications / elimination / manual; drives extracts shown and per-side stats | `src-tauri/src/log_watcher.rs`, `src/state/raidHistory.ts` |
| Progress summary and next-quest suggestion | missing | **done** — counts, Kappa progress, suggestions ranked by downstream unlocks (labelled as a heuristic) | `src/planner/SummaryTab.tsx` |

## Squad

| Feature | Before | Now | Where |
|---|---|---|---|
| Shared positions, markers, drawings | done | done | `src/squad/`, `server/` |
| What each teammate needs to bring / find | missing | **done** — per teammate on the selected map: keys, items to plant/mark, FIR hand-ins; derived locally from the quest ids already shared, no protocol change | `src/planner/RaidPrepTab.tsx` |
| Party over a VPN LAN (Radmin) | missing (relay address fixed at build time) | **done, automatic** — one "Join party" button: the app asks the Radmin network (UDP broadcast on 8788) whether anyone hosts; if so it connects, else it hosts the squad relay itself (ported to Rust, nothing to install) and answers the next player. No code, no IP to type. If the host leaves, the others look again and one of them hosts; two simultaneous hosts merge (the higher address joins the lower). The relay listens on loopback and the Radmin addresses only; the first time a PC hosts, Windows asks to allow TCP 8787 / UDP 8788 from 26.0.0.0/8 only. Settings → Squad server stays for a relay of your own | `src-tauri/src/party.rs`, `src/squad/partyApi.ts`, `src/squad/SquadContext.tsx`, `scripts/party-firewall.ps1` |
| Shared raid plan (map, supplies) | partial (shared quests by map) | **partial** — every teammate sees the others' needs per map; there is no explicit "planned map" message yet | — |

## Not built, and why

- **Phone / tablet access.** It needs either a local HTTP server inside the app
  (a new network surface that must be authenticated and LAN-scoped) or a hosted
  web build that joins the squad relay as a viewer. Both are real projects with
  security trade-offs; neither was started.
- **System-wide hotkeys.** Windows' `RegisterHotKey` takes the key away from the
  game. Shortcuts are in-app only.
- **Shift+click item identification.** See above — would need a hook.
- **Trader loyalty, skills, player level, stash, hideout levels.** Not written
  to any file a passive reader can see, so they are entered by the player.

## TarkovTracker limits

- The **key decides the game mode** (PvP, PvE or season). The logs do not say
  which mode a raid was, so MoA cannot warn about a key of the wrong mode.
- **Hideout** and **faction** have no write endpoint: they are import-only.
- The free tier allows 100 writes and 1000 reads a day. Objective ticks have
  no batch endpoint, so each tick is one write; a flush sends at most 20.
- Old log history is **not sent automatically**. "Send N differences" in
  Settings sends what MoA knows and TarkovTracker does not, after a
  confirmation, because after a wipe that list can be the previous wipe.
- Hideout import needs the level ids added to `progression.json` in this
  change. A remote snapshot published without them would make hideout import
  do nothing until CI republishes; today no remote snapshot exists, so the
  bundled copy (with ids) is used.

## Data limits worth knowing

- tarkov.dev lists ~300 of ~500 quests with **no prerequisite**. In game some of
  those are also gated by trader loyalty or events the data does not encode, so
  "Available" means "no unmet prerequisite in the data". The UI says so.
- **Prices** are a daily snapshot, never live. Every price view shows its date.
- The progression snapshot is read from this repository on GitHub when present
  there, otherwise from the copy compiled into the app. Until CI publishes the
  new files upstream, the bundled copy is used.
