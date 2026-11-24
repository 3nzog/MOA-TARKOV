// The ⋮ menu by a party member's name. One thing only: link this PC to that
// member's game PC (this PC becomes its extra screen). The member's app tells
// the party where to reach it (src/squad/linkOffer.ts); the game PC still
// confirms the link on its own screen. No kicking from here.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, DotsThreeVertical, Link as LinkIcon } from '@phosphor-icons/react';
import { useLink } from '../link/useLink';
import { netLocalIps, type LocalIp } from '../net/netApi';
import { pickLinkIp } from './linkOffer';
import type { LinkOffer } from '../../shared/squadProtocol';

export default function MemberMenu({ name, offer }: { name: string; offer: LinkOffer | undefined }) {
  const { t } = useTranslation();
  const link = useLink();
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<LocalIp[] | null>(null);
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
  const note = !link.available
    ? null
    : !offer
      ? t('squad.link.noOffer')
      : mine && !ip
        ? t('squad.link.noNetwork')
        : linked
          ? t('squad.link.done')
          : waiting
            ? t('squad.link.waiting')
            : t('squad.link.help');

  const go = async () => {
    if (!offer || !ip) return;
    await link.connect({ host: ip, port: offer.port, name: offer.name });
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
            disabled={!offer || !ip || linked || waiting || !link.available}
            onClick={() => void go()}
          >
            {linked ? <CheckCircle weight="fill" /> : <LinkIcon weight="bold" />}
            <span>{t('squad.link.action')}</span>
          </button>
          {note && <p className="squad-more__note">{note}</p>}
        </div>
      )}
    </div>
  );
}
