// Runs the pairing (src/link/pairing.ts) on this PC: the ⋮ "Link" starts it,
// the dialog (PairDialog) asks for the code and then which PC has the game,
// and the choice sets both apps' link roles and links them.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSquad } from '../squad/useSquad';
import { useLink } from './useLink';
import { linkInvite } from './linkApi';
import { netLocalIps } from '../net/netApi';
import { LINK_PORT, pickLinkIp } from '../squad/linkOffer';
import { firstChoice, makeCode, makeId, PAIR_FOR_MS, sameStep } from './pairing';
import { PairingCtx, type PairStage } from './usePairing';
import type { PairMsg } from '../../shared/squadProtocol';

export function PairingProvider({ children }: { children: ReactNode }) {
  const squad = useSquad();
  const link = useLink();
  const [stage, setStage] = useState<PairStage | null>(null);
  /** Pairing this PC started: its id, who, the code shown here. */
  const started = useRef<{ id: string; with: string; code: string; at: number } | null>(null);
  const seen = useRef<Record<string, PairMsg>>({});
  const choice = useRef<{ game: string; at: number; by: string } | null>(null);
  const applied = useRef<string | null>(null);
  const selfId = squad.selfId;
  const { sendPair } = squad;

  const nameOf = useCallback((id: string) => squad.members.find((m) => m.id === id)?.name ?? '?', [squad.members]);

  // The choice is made: the game PC hosts and lets the other in; the other
  // becomes its extra screen and links to it.
  const apply = useCallback(
    async (game: string, other: string, id: string) => {
      const key = `${id}:${game}`;
      if (applied.current === key || !selfId) return;
      applied.current = key;
      const otherPc = squad.pcs?.[other];
      if (game === selfId) {
        link.setMode('game');
        await linkInvite(otherPc?.ips.map((x) => x.ip) ?? []).catch(() => undefined);
        setStage({ kind: 'done', with: other, name: nameOf(other), game: true });
      } else {
        link.setMode('screen');
        setStage({ kind: 'done', with: other, name: nameOf(other), game: false });
        const mine = await netLocalIps().catch(() => []);
        const ips = otherPc?.ips ?? [];
        const ip = pickLinkIp(ips, mine) ?? ips.find((x) => x.kind === 'radmin')?.ip ?? ips[0]?.ip;
        // A moment for the game PC to start hosting and let this one in.
        if (ip) window.setTimeout(() => void link.connect({ host: ip, port: LINK_PORT, name: otherPc?.name ?? nameOf(other) }), 2500);
      }
    },
    [selfId, squad.pcs, link, nameOf],
  );

  const decide = useCallback(
    (c: { game: string; at: number; by: string }, id: string, other: string) => {
      choice.current = firstChoice(c, choice.current);
      void apply(choice.current.game, choice.current.game === selfId ? other : choice.current.game, id);
    },
    [apply, selfId],
  );

  // Steps from the other PCs, addressed to this one (state follows messages
  // from outside, which is what an effect is for here).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!selfId) return;
    const now = Date.now();
    for (const [from, msg] of Object.entries(squad.pairs ?? {})) {
      if (msg.to !== selfId || sameStep(seen.current[from], msg)) continue;
      seen.current[from] = msg;
      const mine = started.current;
      switch (msg.step) {
        case 'invite':
          if (now - msg.at > PAIR_FOR_MS * 2) break;
          choice.current = null;
          applied.current = null;
          setStage({ kind: 'enter', id: msg.id, with: from, name: nameOf(from), wrong: false });
          break;
        case 'code':
          if (!mine || mine.id !== msg.id || mine.with !== from) break;
          if (Date.now() - mine.at > PAIR_FOR_MS) {
            sendPair({ id: msg.id, to: from, step: 'bad', at: Date.now() });
          } else if (msg.code === mine.code) {
            sendPair({ id: msg.id, to: from, step: 'ok', at: Date.now() });
            setStage({ kind: 'choose', id: msg.id, with: from, name: nameOf(from) });
          } else {
            sendPair({ id: msg.id, to: from, step: 'bad', try: msg.try, at: Date.now() });
          }
          break;
        case 'ok':
          setStage({ kind: 'choose', id: msg.id, with: from, name: nameOf(from) });
          break;
        case 'bad':
          setStage((s) => (s?.kind === 'enter' && s.id === msg.id ? { ...s, wrong: true } : s));
          break;
        case 'no':
          if (mine?.id === msg.id) setStage({ kind: 'declined', with: from, name: nameOf(from) });
          break;
        case 'game':
          if (msg.game) decide({ game: msg.game, at: msg.at, by: from }, msg.id, from);
          break;
      }
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [squad.pairs, selfId, nameOf, sendPair, decide]);

  const start = useCallback(
    (memberId: string) => {
      const p = { id: makeId(), with: memberId, code: makeCode(), at: Date.now() };
      started.current = p;
      choice.current = null;
      applied.current = null;
      sendPair({ id: p.id, to: memberId, step: 'invite', at: p.at });
      setStage({ kind: 'code', id: p.id, with: memberId, name: nameOf(memberId), code: p.code });
    },
    [sendPair, nameOf],
  );

  const tries = useRef(0);
  const submitCode = useCallback(
    (code: string) => {
      if (stage?.kind !== 'enter') return;
      tries.current += 1;
      setStage({ ...stage, wrong: false });
      sendPair({ id: stage.id, to: stage.with, step: 'code', code, try: tries.current, at: Date.now() });
    },
    [stage, sendPair],
  );

  const decline = useCallback(() => {
    if (stage?.kind === 'enter') sendPair({ id: stage.id, to: stage.with, step: 'no', at: Date.now() });
    setStage(null);
  }, [stage, sendPair]);

  const choose = useCallback(
    (gameIsMe: boolean) => {
      if (stage?.kind !== 'choose' || !selfId) return;
      const game = gameIsMe ? selfId : stage.with;
      const at = Date.now();
      sendPair({ id: stage.id, to: stage.with, step: 'game', game, at });
      decide({ game, at, by: selfId }, stage.id, stage.with);
    },
    [stage, selfId, sendPair, decide],
  );

  const close = useCallback(() => setStage(null), []);

  const api = useMemo(() => ({ stage, start, submitCode, decline, choose, close }), [stage, start, submitCode, decline, choose, close]);
  return <PairingCtx.Provider value={api}>{children}</PairingCtx.Provider>;
}
