// The ⋮ menu by a party member's name. One thing only: link this PC with that
// member's PC. This PC shows a code, the other asks for it, then both ask
// which PC has the game (src/link/PairingProvider.tsx). No kicking from here.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DotsThreeVertical, Link as LinkIcon } from '@phosphor-icons/react';
import { usePairing } from '../link/usePairing';

export default function MemberMenu({ id, name }: { id: string; name: string }) {
  const { t } = useTranslation();
  const pairing = usePairing();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

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
            onClick={() => {
              pairing?.start(id);
              setOpen(false);
            }}
          >
            <LinkIcon weight="bold" />
            <span>{t('squad.link.action')}</span>
          </button>
          <p className="squad-more__note">{t('squad.link.help')}</p>
        </div>
      )}
    </div>
  );
}
