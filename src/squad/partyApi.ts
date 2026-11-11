// Automatic party over a VPN LAN (Radmin VPN) — bridge to src-tauri/src/party.rs.
//
// "Join party" asks the Radmin network whether anyone is hosting; if so it
// connects to them, else this app hosts. No server to run, no code to share.
import { invoke } from '@tauri-apps/api/core';

export interface FoundParty {
  host: string;
  port: number;
  room: string;
}

export interface HostInfo {
  port: number;
  ips: string[];
  /** False when the player declined the firewall prompt: others may not reach this PC. */
  firewall: boolean;
}

export const partyAvailable = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const partyRadminIps = () => invoke<string[]>('party_radmin_ips');
export const partyFind = (hints: string[], timeoutMs?: number) =>
  invoke<FoundParty | null>('party_find', { hints, timeoutMs: timeoutMs ?? null });
export const partyHostStart = () => invoke<HostInfo>('party_host_start');
export const partyHostStop = () => invoke<void>('party_host_stop');

const LAST_HOST_KEY = 'tc_party_last_host_v1';

/** The last host we reached: asked directly too, in case a broadcast does not get through. */
export function lastPartyHosts(): string[] {
  try {
    const v = localStorage.getItem(LAST_HOST_KEY);
    return v && /^26\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? [v] : [];
  } catch {
    return [];
  }
}

export function rememberPartyHost(ip: string): void {
  try {
    localStorage.setItem(LAST_HOST_KEY, ip);
  } catch {
    /* storage unavailable */
  }
}

/** Numeric IPv4 order: when two players host at once, the higher address joins the lower. */
export function compareIpv4(a: string, b: string): number {
  const n = (ip: string) => ip.split('.').reduce((acc, p) => acc * 256 + (Number(p) || 0), 0);
  return n(a) - n(b);
}
