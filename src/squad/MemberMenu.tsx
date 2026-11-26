// The ⋮ menu by a party member's name. One thing only: link this PC and that
// member's PC, whichever side has the game. On an extra screen it links to the
// member's game PC (the member's app says where it is, src/squad/linkOffer.ts;
// the game PC confirms). On the game PC it lets the member's PC in: that PC,
// linking on its own every few seconds, is accepted instead of ignored (the
// click is the consent). No kicking from here.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, DotsThreeVertical, Link as LinkIcon } from '@phosphor-icons/react';
import { useLink } from '../link/useLink';
import { isLanIp, linkInvite } from '../link/linkApi';
import { netLocalIps, type LocalIp } from '../net/netApi';
import { pickLinkIp } from './linkOffer';
import type { LinkOffer, PcInfo } from '../../shared/squadProtocol';

export default function MemberMenu({ name, offer, pc }: { name: string; offer: LinkOffer | undefined; pc?: PcInfo }) {
  const { t } = useTranslation();
  const link = useLink();
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<LocalIp[] | null>(null);
  /** What the last click did, when it could not link the usual way. */
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  // This PC's networks, to pick the game PC's address on one of them.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    netLocalIps()
      .then((ips) => alive && setMine(ips))
      .catch(() => alive && setMine([]));
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const ip = offer && mine ? pickLinkIp(offer.ips, mine) : null;
  const client = link.client;
  const toThis = !!ip && client?.host === ip;
  const linked = toThis && client?.state === 'linked';
  const waiting = toThis && (client?.state === 'connecting' || client?.state === 'pending');
  // This PC has the game and the member's does not offer one: let theirs in.
  const gameSide = link.role === 'game' && !offer;
  const linkedHere = gameSide && !!pc && (link.host?.connected ?? []).some((d) => d.name === pc.name);
  const note = !link.available
    ? null
    : gameSide
      ? msg ?? (linkedHere ? t('squad.link.done') : t('squad.link.letInHelp'))
      : busy
      ? t('squad.link.searching')
      : msg
        ? msg
        : linked
          ? t('squad.link.done')
          : waiting
            ? t('squad.link.waiting')
            : !offer
              ? t('squad.link.noOffer')
              : mine && !ip
                ? t('squad.link.noNetwork')
                : t('squad.link.help');

  // Always clickable: the address the friend's app gave on a network both PCs
  // share; else the first one it gave anyway (Radmin first); else whatever
  // game PC answers on this PC's networks (an older app gives no address).
  const go = async () => {
    if (!link.available || linked || busy) return;
    setMsg(null);
    if (gameSide) {
      const names = await linkInvite(pc?.ips.map((x) => x.ip) ?? []).catch(() => [] as string[]);
      setMsg(
        names.length > 0
          ? t('squad.link.letInNow', { names: names.join(', ') })
          : pc
            ? t('squad.link.letInSoon')
            : t('squad.link.letInWait'),
      );
      return;
    }
    let to: { host: string; port: number; name: string } | null = null;
    if (offer) {
      const any = ip ?? offer.ips.find((x) => x.kind === 'radmin')?.ip ?? offer.ips[0]?.ip ?? null;
      if (any) to = { host: any, port: offer.port, name: offer.name };
    }
    if (!to) {
      setBusy(true);
      const found = await link.find().catch(() => []);
      setBusy(false);
      const pick = found.length === 1 ? found[0] : (found.find((f) => isLanIp(f.host)) ?? found[0]);
      if (!pick) {
        setMsg(t('squad.link.notFound'));
        return;
      }
      to = pick;
    }
    await link.connect(to);
    // This PC is the extra screen from now on (even if it has the game too).
    if (link.prefs.mode !== 'screen') link.setMode('screen');
  };

  return (
    <div className="squad-more" ref={root}>
      <button
        type="button"
        className={`squad-more__btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('squad.link.menu', { name })}
        title={t('squad.link.menu', { name })}
      >
        <DotsThreeVertical weight="bold" />
      </button>
      {open && (
        <div className="squad-more__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="squad-more__item"
            onClick={() => void go()}
          >
            {linked || linkedHere ? <CheckCircle weight="fill" /> : <LinkIcon weight="bold" />}
            <span>{t('squad.link.action')}</span>
          </button>
          {note && <p className="squad-more__note">{note}</p>}
        </div>
      )}
    </div>
  );
}
