# Architecture

Tarkov MoA keeps a map in sync with what's happening in a game that offers no API,
no plugin surface, and no way to ask it anything. Everything below follows from
that one constraint.

## Shape

Three processes, two of them on the player's machine.

```
┌─ desktop app (Tauri 2) ──────────────────────────┐
│                                                  │
│  React + TypeScript          Rust core           │
│  ├─ map, quests, POIs   ◄──► ├─ log_watcher.rs   │
│  ├─ squad UI                 ├─ screenshots.rs   │
│  └─ i18n (6 locales)         ├─ eft_config.rs    │
│                              └─ game_lang.rs     │
└────────────┬─────────────────────────┬───────────┘
             │ HTTPS                   │ WSS
             ▼                         ▼
     tarkov.dev GraphQL         squad relay (Node)
     (quests, maps, POIs)       ├─ rooms.ts
                                ├─ analytics.ts
                                └─ feedback.ts
```

The Rust core owns everything that touches the filesystem and the OS. The React
layer owns all state the user can see. They talk over Tauri's command/event
bridge — the core *emits*, the UI *subscribes*; the UI never polls the disk.

`shared/squadProtocol.ts` is the single wire contract between the client and the
relay. It imports nothing, by rule, so the relay never takes a dependency on
client internals.

## Why Tauri and not Electron

Two reasons, in order of weight.

1. **Native filesystem work is the product.** Live state comes from tailing game
   logs and watching a screenshot directory — a long-running, truncation-safe
   file watcher. That belongs in a real systems language, not behind a Node
   shim.
2. **Size.** The installer is ~12 MB. An Electron build of the same app starts
   around 80 MB. For a free utility that people download on a friend's
   recommendation, download size is a conversion problem.

## Where live state comes from

The game exposes nothing on purpose, so the app reads only what the game already
writes to disk:

- **Quest state** — `push-notifications_*.log`. Trader-dialog notifications carry
  a `message.type` (10 accepted / 11 failed / 12 completed) and a `templateId`
  whose first token is the quest id. Progress is modelled as three **grow-only
  sets** — accepted, completed, failed — so replaying old log files in any order
  converges to the same state. A removal-based model would let file ordering
  resurrect finished quests, because the game re-logs old notifications in later
  sessions.
- **Player position** — the game encodes world coordinates and a rotation
  quaternion into screenshot *filenames*. A watcher parses the name, emits a
  position, and deletes the file.

**This is deliberately passive.** The app never reads or writes game memory and
never injects anything. It only reads files the game itself produced, which is
what lets it claim to be anti-cheat-safe without hand-waving. The cost of that
choice is real and stated below.

## Surviving the only upstream

tarkov.dev is the single source for quests, maps and POIs, and there is no
second vendor to fail over to — the data is community-curated and does not
exist anywhere else in this shape. So the app cannot remove the dependency; it
can only refuse to fail with it.

Each dataset resolves through four sources, best first:

| | Source | Covers |
|---|---|---|
| 1 | live tarkov.dev | the normal case |
| 2 | the user's own cache, **even when expired** | the API is down, you had data |
| 3 | a snapshot committed to this repo, refreshed daily by CI | the API is down, you had nothing |
| 4 | a snapshot compiled into the binary | no network at all, first launch |

Two rules make it work:

- **Expiry marks, it never deletes.** The original code dropped an entry the
  moment it passed 24h, *before* knowing whether a replacement was available.
  When tarkov.dev returned HTTP 422 for hours on 2026-08-17, every install past
  the mark discarded good data and then could not replace it. Only an explicit
  user-initiated wipe deletes now.
- **Fallback data is never cached.** Writing a snapshot into the cache would
  make it look fresh for 24h and stop the app retrying the real API on the next
  launch — turning a temporary outage into a sticky one.

The snapshot in tier 3 is deliberately narrower than the live queries: tasks and
map names only. POIs are the largest payload and the app degrades gracefully
without them, so leaving them out keeps a daily-committed file small. Tier 4
ships English only; a last-resort fallback with correct ids, positions and
requirements but English names is a fair trade against installer size.

## The planner: progression, raid prep, economy

The planner (rail section *Planner*) answers "what can I take, what do I hand
in, what do I bring" from two inputs only: tarkov.dev data and what the player
tells it.

- **Data.** `scripts/fetch-progression.mjs` writes `progression.json`
  (prerequisites, level/faction gates, objective items and keys, hideout,
  crafts), `progression-<lang>.json` (names) and `prices.json` (a dated price
  snapshot). It runs separately from the quest snapshot so a failure here can
  never put the file the app cannot start without at risk. The app reads the
  repo copy when it exists and is newer, else the copy compiled into the binary
  — lazily, the first time the planner opens.
- **Player input.** Level, faction, built hideout levels, ticked objectives,
  collected item counts and owned keys are entered by hand: none of it is in
  any file the game writes. Until level/faction are entered nothing is gated on
  them — the same rule as the removed level gate in `quests/derive.ts`.
- **Manual quest status** is an *override* layered over the grow-only log sets,
  never an edit of them, so replay convergence is untouched. A log event newer
  than the override (events now carry the log line's own timestamp) clears it.
- **One inference**: accepting a quest proves its "must be complete"
  prerequisites are complete. It is labelled *inferred* wherever it shows.
- **Raid history** records `raid-started` / `raid-ended` with their log
  timestamps, which is what makes a "Sync past logs" replay de-duplicable. The
  logs carry the map and the times — not survival, kills, loot or XP — so the
  stats stop there.
- **PMC or Scav** is told apart by the profile that enters the raid: the
  profileStatus line names it, and a PMC and its Scav are two profiles. The core
  sends only an FNV-1a fingerprint of the id, never the id. Which fingerprint is
  which is learned from squad notifications (they carry the side of the raid),
  by elimination (an account has exactly two), or from the player's own click.
  On every launch the core scans all logs on disk for raid starts, squad sides
  and raid ends (`scan_raid_sides`, about a megabyte) and the front end folds
  them into the history, so a fresh install or a new season's profiles are
  known without "Sync past logs".
- **Exits from O+O.** When a screenshot arrives, the core OCRs its top-right
  corner (Windows.Media.Ocr, the recognizer of the Windows display language)
  before deleting it, and emits the text lines if there are two or more. The
  front end matches names, not the row codes OCR garbles, against every map's
  extract names and transit destinations in all six languages (tarkov.dev's
  are the game's own strings; cached a week as `td_exit_aliases_v1`), so the
  game and app languages need not agree. The map with most matches wins (two
  needed), MoA switches to it, and the list applies to that raid and map only.
  OCR uses the game language's recognizer when Windows has it installed.
- **Compact mode** is an ordinary always-on-top window flag; **shortcuts** are
  in-app only. Neither touches the game.
- **TarkovTracker** (`src-tauri/src/tracker.rs`, `state/trackerSync.ts`,
  `app/useTracker.ts`). The API key is typed into a separate console window
  (`scripts/tarkovtracker-key.ps1`, also opened from Settings) and stored in
  Windows Credential Manager. Only the Rust core reads it, per request; no
  command returns it and the webview never holds it. The `/token` response
  echoes the key, so the core reduces it to permissions, mode and note.
  Pulled quests are a separate layer below the logs; objectives merge
  three-way against the last pull; hideout and level only go up. Pushes are
  live log events and the player's own changes, queued and coalesced, never a
  re-send of old log history (after a wipe that would refill a fresh tracker
  with the previous wipe). Polls every 5 min with an ETag.

The full audit, including what was not built and why, is in
[`docs/FEATURE-PARITY.md`](docs/FEATURE-PARITY.md).

## Appearance

`src/appearance/` keeps the player's look (theme, accent, glass material,
sizes, motion) in localStorage and writes it onto `<html>` as custom properties
and data attributes before the first paint, so the stylesheets follow without
prop drilling and the minimap window follows through the storage event. The
player's map symbol lives in `src/squad/symbols.ts`, which also builds the
marker HTML shared by the player, squadmate and minimap markers. The opening
animation is `src/intro/` (WebGL2, with a plain fade when WebGL2 is missing).

## Squad mode: a relay, not P2P

**Automatic party on a VPN LAN.** With Radmin VPN on, "Join party" needs no
server and no code: `src-tauri/src/party.rs` broadcasts a question on UDP 8788
over the Radmin network; a host answers with its room, and the app connects to
`ws://<host>:8787`. If nobody answers, the app hosts: it runs a Rust port of the
relay below (same protocol v2, join/peer-join/peer-leave, opaque fan-out with
`from` re-stamped, token-bucket rate limit, 64 KB frames), bound to loopback and
the Radmin addresses only, and answers discovery. Guests whose host vanishes
look again (one becomes host); two hosts that started together merge, the
higher address joining the lower. The first time a PC hosts, the app asks
Windows (UAC) for firewall rules limited to 26.0.0.0/8.

Squad mode shares live position, custom markers, and freehand drawings between
players in the same raid.

**Decision: a small fan-out relay keyed by room code, not WebRTC.** P2P would
save the server, but NAT traversal for a handful of players in a game session is
a large amount of failure surface for a feature that moves a few hundred bytes a
second. The relay is ~300 MB of Node at a thousand concurrent squads.

The design keeps the door open: every message is a **self-describing JSON
envelope**, and the relay only parses *control* messages (join / peer-join /
error). Data messages are forwarded **opaquely** — it never inspects a payload.
Swapping WebSocket for an `RTCDataChannel` is therefore a transport change, not a
redesign.

Hard limits live in code, not in a config nobody reads: 64 KB max frame, 15
messages/sec with a burst of 40 per socket, 200 concurrent connections, 500
rooms, 8 members per squad. Room codes come from `node:crypto`, not `Math.random`.

## How the relay is operated

The relay is **self-hosted**, exposed to the public internet through **Tailscale
Funnel** — so there is no port forwarding and no residential IP in DNS. It runs
under its own tailnet identity, isolated from the host's other services.

The container is hardened rather than trusted:

- non-root, **read-only root filesystem**, `cap_drop: ALL`, `no-new-privileges`
- Tailscale in **userspace mode** — no `NET_ADMIN`, no `/dev/net/tun`
- memory and pid limits, health checks on both containers
- the runtime image carries a single bundled `.mjs` — no `node_modules`, no
  source, no dev tooling
- `/stats` returns 404 unless a token is configured

The full runbook is in [`server/deploy/README.md`](server/deploy/README.md).

## What isn't trackable, and why

Worth stating plainly, because it's the boundary of the product.

**Story and Operational quests cannot be tracked passively.** This was
investigated to a conclusion, not abandoned:

- They emit **no** log events. Across 51 log files from real sessions, only Side
  quests ever produced a notification. Story quests use no trader dialog, so they
  bypass the notification channel entirely.
- Their state lives in HTTP response *bodies* (`getMainQuestsList`), and the game
  logs headers only — the body is always empty.
- Raising the log level to capture bodies **trips the game's file-integrity
  check** and triggers a repair prompt on next launch. That route is closed.
- The community data source (tarkov.dev) doesn't carry them either.

So the app tracks Side quests only, and says so in onboarding. The remaining
routes all require an HTTP proxy against a game with anti-cheat, which is not a
trade worth making for a map utility.

## Known limits

- **Position updates on screenshot, not continuously.** That's the price of
  staying out of game memory. Players bind the screenshot key to a spare mouse
  button; stale positions fade out rather than lying.
- **Objectives within a quest aren't reliably ordered.** The upstream schema has
  no ordering field, and neither tarkov.dev's own UI nor other trackers number
  them. Rendered as bullets rather than faking a sequence.
- **Windows only.** The log and screenshot paths are Windows-specific.

## Tests

`vitest` on both sides of the wire (client and relay suites) and 11
`#[test]` functions in the Rust core, covering the log-filename predicates,
the log timestamp prefix and the notification JSON shapes — the places where a
game patch breaks things silently. The planner's pure logic (status and
inference, item needs, raid prep, craft estimates, raid history, overrides,
shortcuts) has its own suites, plus one that checks the committed planner data
covers the committed quest snapshot. CI runs type-check, tests, and lint on every push; all three are
required.
