// The map on a phone on the same Wi-Fi (src-tauri/src/phone.rs): this PC
// serves the page and streams the map state; the QR code carries the address
// and the key.
import { invoke } from '@tauri-apps/api/core';
import { parseMinimapRoute, type MinimapState } from '../minimap/protocol';

export interface PhoneQr {
  size: number;
  /** Row by row, '1' = dark. */
  cells: string;
}

export interface PhoneStatus {
  running: boolean;
  urls: string[];
  qr: PhoneQr | null;
  clients: number;
  firewall: boolean;
  /** Away from home (4G/5G) over Tailscale, when this PC is on Tailscale. */
  remoteUrl?: string | null;
  remoteQr?: PhoneQr | null;
  /** The firewall lets Tailscale reach the map. */
  remoteFirewall?: boolean;
}

/** What a phone receives: the minimap's state plus the map's name. */
export type PhoneState = Omit<MinimapState, 'settings' | 'text'> & { mapName: string | null; sentAt: number };

export const phoneAvailable = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const phoneStart = () => invoke<PhoneStatus>('phone_start');
export const phoneStop = () => invoke<void>('phone_stop');
export const phoneStatus = () => invoke<PhoneStatus>('phone_status');
export const phoneNewKey = () => invoke<PhoneStatus>('phone_new_key');
/** Lets Tailscale reach the map (Windows asks for admin rights). */
export const phoneRemoteFirewall = () => invoke<boolean>('phone_remote_firewall');
export const phonePublish = (state: PhoneState) => invoke<boolean>('phone_publish', { state: JSON.stringify(state) });
/** The map's layers, already as the `{"layers":…}` frame. */
export const phonePublishLayers = (frame: string) => invoke<boolean>('phone_publish_layers', { layers: frame });

const KEY = 'tc_phone_v1';

/** "Map on the phone" stays on across restarts once turned on. */
export function loadPhoneOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function savePhoneOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
}

/** The phone page's socket, from its own address: ws://<pc>:8791/ws?k=<key>. */
export function phoneSocketUrl(loc: { host: string; search: string }): string | null {
  const k = new URLSearchParams(loc.search).get('k');
  if (!k || !/^[A-Za-z0-9]{16,64}$/.test(k)) return null;
  return `ws://${loc.host}/ws?k=${k}`;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A screenshot's position sent on its own (`{"pos":{…}}`), ahead of the next map state. */
export function parsePosFrame(raw: string): NonNullable<PhoneState['pos']> | null {
  try {
    const p = (JSON.parse(raw) as { pos?: Record<string, unknown> } | null)?.pos;
    if (!p || !num(p.x) || !num(p.y) || !num(p.z) || !num(p.rotation) || !num(p.ts) || !num(p.seq)) return null;
    return { x: p.x, y: p.y, z: p.z, rotation: p.rotation, ts: p.ts, seq: p.seq };
  } catch {
    return null;
  }
}

/** A frame from the PC, checked enough to draw (anything else is ignored). */
export function parsePhoneState(raw: unknown): PhoneState | null {
  if (typeof raw !== 'string' || raw.length > 600_000) return null;
  try {
    const v = JSON.parse(raw) as Partial<PhoneState>;
    if (!v || typeof v !== 'object' || !Array.isArray(v.points)) return null;
    return {
      mapId: typeof v.mapId === 'string' ? v.mapId : null,
      mapName: typeof v.mapName === 'string' ? v.mapName : null,
      pos: v.pos && typeof v.pos.x === 'number' && typeof v.pos.z === 'number' ? v.pos : null,
      activeFloorId: typeof v.activeFloorId === 'string' ? v.activeFloorId : null,
      points: v.points.filter((p) => p && typeof p.x === 'number' && typeof p.z === 'number'),
      self: v.self,
      mates: Array.isArray(v.mates) ? v.mates : [],
      raidClock: v.raidClock ?? null,
      route: parseMinimapRoute(v.route),
      sentAt: typeof v.sentAt === 'number' ? v.sentAt : Date.now(),
    };
  } catch {
    return null;
  }
}
