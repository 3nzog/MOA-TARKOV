// Relay endpoint. Defaults to the local dev relay; override at build time with
// VITE_SQUAD_RELAY_URL to point at a deployed relay (see server/deploy/README.md).
// Read defensively so the same module also works under node/tsx, where
// import.meta.env is absent.
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

export const RELAY_URL: string = env?.VITE_SQUAD_RELAY_URL ?? "ws://localhost:8787";

// The player can point the squad at another relay at runtime — e.g. one a
// friend runs on their PC over a VPN LAN such as Radmin. Kept in localStorage;
// the build-time default applies when nothing is set.
const RELAY_KEY = "tc_squad_relay_v1";
export const DEFAULT_RELAY_PORT = 8787;

/**
 * "26.10.20.30", "26.10.20.30:9000", "ws://host:port" or "wss://host" → a
 * ws(s) URL, or null when it is not an address. No paths, no credentials.
 */
export function normalizeRelayInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^wss?:\/\//i.test(raw) ? raw : `ws://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
  if (u.username || u.password || (u.pathname && u.pathname !== "/") || u.search || u.hash) return null;
  if (!/^[a-z0-9.-]+$|^\[[0-9a-f:]+\]$/i.test(u.hostname)) return null;
  const port = u.port || (u.protocol === "ws:" ? String(DEFAULT_RELAY_PORT) : "");
  return `${u.protocol}//${u.hostname}${port ? `:${port}` : ""}`;
}

/** The relay chosen in Settings, or null for the default. */
export function getRelayOverride(): string | null {
  try {
    const v = localStorage.getItem(RELAY_KEY);
    return v ? normalizeRelayInput(v) : null;
  } catch {
    return null;
  }
}

export function setRelayOverride(url: string | null): void {
  try {
    if (url) localStorage.setItem(RELAY_KEY, url);
    else localStorage.removeItem(RELAY_KEY);
  } catch {
    // storage unavailable — the default relay keeps working
  }
}

/** The relay the squad connects to. */
export function getRelayUrl(): string {
  return getRelayOverride() ?? RELAY_URL;
}

// The relay also hosts the anonymous feedback intake over HTTP(S) — same host,
// ws:// → http:// (and wss:// → https:// in production).
export const FEEDBACK_URL: string = RELAY_URL.replace(/^ws/, "http") + "/feedback";

// A squadmate's dot is only as fresh as their last in-game screenshot. Past this
// age we visibly fade it; the SquadCard also shows a relative "last seen".
export const POSITION_STALE_MS = 90_000;

// How long the SquadCard flashes a member row when a fresh position lands.
export const FRESH_FLASH_MS = 1500;
