// The linked-PC context object and its hook (split from LinkProvider.tsx so
// that file only exports a component, for fast refresh).
import { createContext, useContext } from 'react';
import type { FoundLink, LinkClientStatus, LinkHostStatus, LinkMode, LinkPrefs, LinkRequest } from './linkApi';

export interface LinkApi {
  available: boolean;
  prefs: LinkPrefs;
  /** What this PC is now (in "auto": the one with the game is the game PC). null until known. */
  role: 'game' | 'screen' | 'off' | null;
  /** This PC has the game (its logs folder). null until known. */
  hasGame: boolean | null;
  /** As the game PC: who may link and who is linked now (null until known). */
  host: LinkHostStatus | null;
  /** As the extra screen: the link to the game PC (null when not linking). */
  client: LinkClientStatus | null;
  /** PCs asking to link right now (answered in a dialog). */
  requests: LinkRequest[];
  /** A short error code from the last action ("port_busy", "bad_ip"…). */
  error: string | null;
  setMode: (mode: LinkMode) => void;
  setAutoAcceptLan: (on: boolean) => void;
  setAllowLinks: (on: boolean) => Promise<void>;
  find: () => Promise<FoundLink[]>;
  connect: (to: FoundLink) => Promise<void>;
  disconnect: () => Promise<void>;
  answer: (id: string, accept: boolean) => Promise<void>;
  forget: (device: string) => Promise<void>;
}

export const LinkCtx = createContext<LinkApi | null>(null);

export function useLink(): LinkApi {
  const ctx = useContext(LinkCtx);
  if (!ctx) throw new Error('useLink must be used within <LinkProvider>');
  return ctx;
}
