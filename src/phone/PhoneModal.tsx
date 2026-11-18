// "Map on the phone": turn it on, scan the QR code with the phone's camera.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowsClockwise, Copy, Globe, ShieldCheck } from '@phosphor-icons/react';
import { Button, HelpTip, Modal, Toggle } from '../ui';
import { partyFirewallRequest } from '../net/netApi';
import { phoneRemoteFirewall, type PhoneQr, type PhoneStatus } from './phoneApi';
import type { PhoneShare } from './usePhoneShare';
import './phone.css';

/** The QR code as crisp SVG squares (quiet zone included). */
function QrCode({ qr }: { qr: PhoneQr }) {
  const q = 4;
  const n = qr.size + q * 2;
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.cells[y * qr.size + x] === '1') d += `M${x + q} ${y + q}h1v1h-1z`;
    }
  }
  return (
    <svg className="phone-qr" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

export default function PhoneModal({ share, onClose }: { share: PhoneShare; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [fixing, setFixing] = useState(false);
  const { status, refresh } = share;

  // Phones connected, kept fresh while the window is open.
  useEffect(() => {
    if (!share.on) return;
    const id = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(id);
  }, [share.on, refresh]);

  const url = status?.urls[0] ?? null;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const fixFirewall = async () => {
    setFixing(true);
    await partyFirewallRequest().catch(() => false);
    await refresh();
    setFixing(false);
  };

  return (
    <Modal title={t('phone.title')} onClose={onClose} size="sm">
      <div className="phone-modal">
        <div className="settings-row">
          <div className="settings-row__text">
            <span>{t('phone.toggle')}</span>
            <HelpTip>{t('phone.help')}</HelpTip>
          </div>
          <Toggle checked={share.on} onChange={(v) => void share.setOn(v)} label={t('phone.toggle')} />
        </div>

        {share.error && <p className="settings-err">{t(`phone.err.${share.error}`, { defaultValue: t('phone.err.other') })}</p>}

        {share.on && status?.running && (
          <>
            {status.qr && url ? (
              <>
                <QrCode qr={status.qr} />
                <p className="phone-modal__scan">{t('phone.scan')}</p>
                <div className="phone-modal__url">
                  <code>{url.replace(/k=[^&]+/, 'k=…')}</code>
                  <Button size="sm" variant="tertiary" icon={<Copy />} onClick={() => void copy()}>
                    {copied ? t('phone.copied') : t('phone.copy')}
                  </Button>
                </div>
              </>
            ) : (
              <p className="settings-err">{t('phone.noWifi')}</p>
            )}
            <p className={status.clients > 0 ? 'settings-ok' : 'phone-modal__muted'}>
              {status.clients > 0 ? t('phone.clients', { count: status.clients }) : t('phone.noClients')}
            </p>
            {!status.firewall && (
              <div className="phone-modal__warn">
                <span>{t('phone.firewall')}</span>
                <Button size="sm" icon={<ShieldCheck />} loading={fixing} onClick={() => void fixFirewall()}>
                  {t('phone.fixFirewall')}
                </Button>
              </div>
            )}
            <RemoteSection status={status} refresh={refresh} />
            <div className="phone-modal__actions">
              <Button size="sm" variant="tertiary" icon={<ArrowsClockwise />} onClick={() => void share.newKey()}>
                {t('phone.newKey')}
              </Button>
              <HelpTip>{t('phone.newKeyHelp')}</HelpTip>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Away from home (4G/5G): the map over Tailscale, or how to get it. */
function RemoteSection({ status, refresh }: { status: PhoneStatus; refresh: () => Promise<void> }) {
  const { t } = useTranslation();
  const [fixing, setFixing] = useState(false);
  const [open, setOpen] = useState(false);
  const fix = async () => {
    setFixing(true);
    await phoneRemoteFirewall().catch(() => false);
    await refresh();
    setFixing(false);
  };
  return (
    <div className="phone-modal__remote">
      <button type="button" className="phone-modal__remote-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Globe weight="bold" />
        <span>{t('phone.remote.title')}</span>
        <span className="phone-modal__muted">{status.remoteUrl ? t('phone.remote.on') : t('phone.remote.off')}</span>
      </button>
      {open &&
        (status.remoteUrl && status.remoteQr ? (
          <>
            <QrCode qr={status.remoteQr} />
            <p className="phone-modal__scan">{t('phone.remote.scan')}</p>
            {!status.remoteFirewall && (
              <div className="phone-modal__warn">
                <span>{t('phone.remote.firewall')}</span>
                <Button size="sm" icon={<ShieldCheck />} loading={fixing} onClick={() => void fix()}>
                  {t('phone.fixFirewall')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <ol className="phone-modal__steps">
            <li>{t('phone.remote.step1')}</li>
            <li>{t('phone.remote.step2')}</li>
            <li>{t('phone.remote.step3')}</li>
          </ol>
        ))}
    </div>
  );
}
