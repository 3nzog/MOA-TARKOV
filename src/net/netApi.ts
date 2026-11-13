// Bridge to src-tauri/src/net.rs and diag.rs: this PC's networks, the
// connection test and the connection log.
import { invoke } from '@tauri-apps/api/core';

export interface LocalIp {
  ip: string;
  kind: 'radmin' | 'lan';
  /** Windows calls this network Public: the party stays off it. */
  public: boolean;
}

export type StepStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface DiagStep {
  id: string;
  status: StepStatus;
  args: Record<string, string>;
}

export const netLocalIps = () => invoke<LocalIp[]>('net_local_ips');
export const netDiagnose = (target: string | null) => invoke<DiagStep[]>('net_diagnose', { target });
export const netLogOpen = () => invoke<void>('net_log_open');
export const partyFirewallRequest = () => invoke<boolean>('party_firewall_request');

/** One line in conexao.log; never throws (outside the desktop app there is no log). */
export function netLog(line: string): void {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  void invoke('net_log_write', { line: line.slice(0, 300) }).catch(() => undefined);
}
