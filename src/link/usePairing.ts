// The pairing context and its hook (split from PairingProvider.tsx so that
// file only exports a component, for fast refresh).
import { createContext, useContext } from 'react';

export type PairStage =
  /** This PC started it: show the code; the other PC types it. */
  | { kind: 'code'; id: string; with: string; name: string; code: string }
  /** The other PC started it: type the code shown there. */
  | { kind: 'enter'; id: string; with: string; name: string; wrong: boolean }
  /** Code right: which PC has the game? (first click, on either PC) */
  | { kind: 'choose'; id: string; with: string; name: string }
  | { kind: 'done'; with: string; name: string; game: boolean }
  | { kind: 'declined'; with: string; name: string };

export interface PairingApi {
  stage: PairStage | null;
  start: (memberId: string) => void;
  submitCode: (code: string) => void;
  decline: () => void;
  choose: (gameIsMe: boolean) => void;
  close: () => void;
}

export const PairingCtx = createContext<PairingApi | null>(null);

export function usePairing(): PairingApi | null {
  return useContext(PairingCtx);
}
