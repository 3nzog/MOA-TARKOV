// Pairing two PCs from the party list (the ⋮ by a friend's name), in either
// direction:
//   1. PC A: "Link" → A shows a 4-digit code and sends B an invite.
//   2. PC B: "A wants to link with this computer — type the code on A's screen".
//   3. B types it; A checks it (the code never leaves A) and says ok / wrong.
//   4. Both: "Which PC has the game?" — the first click, on either PC, decides.
//   5. The game PC hosts and lets the other in; the other becomes its extra
//      screen and links to it (src/link).
// The steps travel over the party (with each app's quests: older apps ignore
// them). This file holds the pure rules; PairingProvider runs them.
import type { PairMsg } from '../../shared/squadProtocol';

/** How long an invite (and a typed code) stays good. */
export const PAIR_FOR_MS = 3 * 60_000;

export function makeCode(rand: () => number = Math.random): string {
  return String(Math.floor(rand() * 10_000)).padStart(4, '0');
}

export function makeId(rand: () => number = Math.random): string {
  return Math.floor(rand() * 2 ** 32).toString(16).padStart(8, '0') + Math.floor(rand() * 2 ** 32).toString(16).padStart(8, '0');
}

const STEPS = new Set<PairMsg['step']>(['invite', 'code', 'ok', 'bad', 'no', 'game']);

/** A step as it came over the party, checked; null = none or not usable. */
export function parsePairMsg(v: unknown): PairMsg | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<PairMsg>;
  if (typeof o.id !== 'string' || !/^[0-9a-f]{8,32}$/.test(o.id)) return null;
  if (typeof o.to !== 'string' || o.to.length === 0 || o.to.length > 64) return null;
  if (!o.step || !STEPS.has(o.step)) return null;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
  const msg: PairMsg = { id: o.id, to: o.to, step: o.step, at: o.at };
  if (typeof o.code === 'string' && /^\d{4}$/.test(o.code)) msg.code = o.code;
  if (typeof o.try === 'number' && Number.isInteger(o.try)) msg.try = o.try;
  if (typeof o.game === 'string' && o.game.length <= 64) msg.game = o.game;
  return msg;
}

/**
 * Both PCs clicked "this one has the game" at about the same time: the earlier
 * click wins (ties: the lower member id), the same answer on both PCs.
 */
export function firstChoice(a: { game: string; at: number; by: string }, b: { game: string; at: number; by: string } | null): { game: string; at: number; by: string } {
  if (!b) return a;
  if (a.at !== b.at) return a.at < b.at ? a : b;
  return a.by <= b.by ? a : b;
}

/** Same step from the same sender: nothing new to act on. */
export const sameStep = (a: PairMsg | undefined | null, b: PairMsg | undefined | null): boolean =>
  !!a && !!b && a.id === b.id && a.step === b.step && (a.try ?? 0) === (b.try ?? 0) && a.game === b.game;
