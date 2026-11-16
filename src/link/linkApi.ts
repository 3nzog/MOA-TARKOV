// Bridge to src-tauri/src/link.rs: a second PC of the same player that shows
// what the game PC reads, like another monitor.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const linkAvailable = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface LinkDevice {
  device: string;
  name: string;
}

export interface LinkHostStatus {
  hosting: boolean;
  /** This PC's name, as the other PC sees it. */
  name: string;
  connected: LinkDevice[];
  devices: LinkDevice[];
  firewall: boolean;
}

export interface FoundLink {
  host: string;
  port: number;
  name: string;
}

export type LinkClientState = 'connecting' | 'pending' | 'linked' | 'lost' | 'refused' | 'off';

export interface LinkClientStatus {
  state: LinkClientState;
  host: string;
  port: number;
  /** The 4 digits the game PC shows when asked. */
  code: string;
  /** The game PC's name, once linked. */
  name?: string;
  reason?: string;
}

export interface LinkRequest {
  id: string;
  name: string;
  code: string;
  ip: string;
}

export const linkHostStart = () => invoke<LinkHostStatus>('link_host_start');
export const linkHostStop = () => invoke<void>('link_host_stop');
export const linkHostStatus = () => invoke<LinkHostStatus>('link_host_status');
export const linkAnswer = (id: string, accept: boolean) => invoke<boolean>('link_answer', { id, accept });
export const linkForget = (device: string) => invoke<void>('link_forget', { device });
export const linkFind = (timeoutMs?: number) => invoke<FoundLink[]>('link_find', { timeoutMs: timeoutMs ?? null });
export const linkConnect = (host: string, port?: number) =>
  invoke<{ code: string }>('link_connect', { host, port: port ?? null });
export const linkDisconnect = () => invoke<void>('link_disconnect');
export const linkSetAutoAccept = (on: boolean) => invoke<void>('link_set_auto_accept', { on });
export const onLinkAuto = (cb: (r: { name: string; ip: string }) => void): Promise<UnlistenFn> =>
  listen<{ name: string; ip: string }>('link-auto', (e) => cb(e.payload));
/** Whether this PC has the game (its logs folder resolves): then it is the game PC. */
export const hasGameLogs = () =>
  invoke<string>('get_resolved_logs_dir').then(
    () => true,
    () => false,
  );

export const onLinkRequest = (cb: (r: LinkRequest) => void): Promise<UnlistenFn> =>
  listen<LinkRequest>('link-request', (e) => cb(e.payload));
export const onLinkRequestDone = (cb: (id: string) => void): Promise<UnlistenFn> =>
  listen<{ id: string }>('link-request-done', (e) => cb(e.payload.id));
export const onLinkChanged = (cb: (s: LinkHostStatus) => void): Promise<UnlistenFn> =>
  listen<LinkHostStatus>('link-changed', (e) => cb(e.payload));
export const onLinkClient = (cb: (s: LinkClientStatus) => void): Promise<UnlistenFn> =>
  listen<LinkClientStatus>('link-client', (e) => cb(e.payload));

// ---- saved choices -------------------------------------------------------------

const KEY = 'tc_link_v1';

/**
 * auto: the PC with the game (its logs) is the game PC and accepts links; a PC
 * without it looks for the game PC on the network and links on its own.
 */
export type LinkMode = 'auto' | 'game' | 'screen' | 'off';

export interface LinkPrefs {
  mode: LinkMode;
  /** PCs on the same home network link without a question (Radmin still asks). */
  autoAcceptLan: boolean;
  /** The game PC this one last showed (relinks to it, even if its IP changed). */
  target: FoundLink | null;
}

export const DEFAULT_PREFS: LinkPrefs = { mode: 'auto', autoAcceptLan: true, target: null };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Radmin (26.x) or a home-network address (10.x, 172.16-31.x, 192.168.x). */
export function isNetworkIp(ip: string): boolean {
  const m = IPV4.exec(ip.trim());
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  return o[0] === 26 || o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168);
}

export function normalizePrefs(raw: unknown): LinkPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
  const r = raw as Record<string, unknown>;
  const mode: LinkMode =
    r.mode === 'auto' || r.mode === 'game' || r.mode === 'screen' || r.mode === 'off'
      ? r.mode
      : // Saved by the version before modes: "allow links" meant the game PC.
        r.allowLinks === true
        ? 'game'
        : 'auto';
  const t = r.target as Record<string, unknown> | null | undefined;
  const target =
    t && typeof t.host === 'string' && isNetworkIp(t.host) && typeof t.port === 'number' && t.port > 0 && t.port < 65536
      ? { host: t.host, port: t.port, name: typeof t.name === 'string' ? t.name.slice(0, 24) : t.host }
      : null;
  return { mode, autoAcceptLan: r.autoAcceptLan !== false, target };
}

export function loadPrefs(): LinkPrefs {
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: LinkPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

// ---- "this PC shows another PC's game" -------------------------------------------
// Read outside React (the squad must not send the replayed position again: the
// game PC already does).

let viewer = false;
export const isLinkedViewer = (): boolean => viewer;
export function setLinkedViewer(on: boolean): void {
  viewer = on;
}
