// Settings → Other PCs. On the game PC: let the player's other PCs link. On
// the extra screen: find the game PC and link to it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, HelpTip, Input, SectionLabel, Segmented, Toggle } from '../ui';
import { useLink } from './useLink';
import './link.css';
import { isNetworkIp, type FoundLink } from './linkApi';

export default function LinkSettings() {
  const { t } = useTranslation();
  const link = useLink();
  const [found, setFound] = useState<FoundLink[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [ip, setIp] = useState('');

  if (!link.available) return <p className="muted">{t('settings.desktopOnly')}</p>;

  const search = async () => {
    setSearching(true);
    setFound(await link.find());
    setSearching(false);
  };

  const c = link.client;
  const linkedOrTrying = c && c.state !== 'off' && c.state !== 'refused';
  const hostOn = link.role === 'game' && link.host?.hosting;
  const roleText =
    link.role === null
      ? t('link.mode.detecting')
      : link.role === 'off'
        ? t('link.mode.isOff')
        : t(link.role === 'game' ? 'link.mode.isGame' : 'link.mode.isScreen');

  return (
    <div className="link-settings">
      <SectionLabel
        help={`${roleText}${link.prefs.mode === 'auto' && link.hasGame !== null ? ` ${t(link.hasGame ? 'link.mode.whyGame' : 'link.mode.whyScreen')}` : ''}`}
      >
        {t('link.mode.title')}
      </SectionLabel>
      <Segmented
        fullWidth
        value={link.prefs.mode}
        onChange={(v) => link.setMode(v as 'auto' | 'game' | 'screen' | 'off')}
        options={[
          { id: 'auto', label: t('link.mode.auto') },
          { id: 'game', label: t('link.mode.game') },
          { id: 'screen', label: t('link.mode.screen') },
          { id: 'off', label: t('link.mode.off') },
        ]}
      />

      {link.role === 'game' && (
        <>
          <SectionLabel>{t('link.main.title')}</SectionLabel>
          <div className="settings-row">
            <div className="settings-row__text">
              <span>{t('link.main.autoAccept')}</span>
              <HelpTip>{t('link.main.autoAcceptHint')}</HelpTip>
            </div>
            <Toggle checked={link.prefs.autoAcceptLan} onChange={(on) => link.setAutoAcceptLan(on)} label={t('link.main.autoAccept')} />
          </div>
        </>
      )}
      {hostOn && link.host && (
        <>
          <p className="settings-row__hint">{t('link.main.thisPc', { name: link.host.name })}</p>
          {!link.host.firewall && <p className="settings-err">{t('link.main.firewallOff')}</p>}
          {link.host.devices.length === 0 ? (
            <p className="muted">{t('link.main.none')}</p>
          ) : (
            <ul className="link-list">
              {link.host.devices.map((d) => {
                const on = link.host!.connected.some((x) => x.device === d.device);
                return (
                  <li key={d.device} className="link-list__row">
                    <span className={`link-dot${on ? ' is-on' : ''}`} aria-hidden />
                    <span className="link-list__name">{d.name}</span>
                    <span className="link-list__state">{on ? t('link.main.connected') : t('link.main.away')}</span>
                    <Button size="sm" variant="ghost" onClick={() => void link.forget(d.device)}>
                      {t('link.main.forget')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {link.role === 'screen' && (
        <>
      <SectionLabel help={`${t('link.screen.hint')} ${t('link.screen.partyNote')}`}>{t('link.screen.title')}</SectionLabel>
      {linkedOrTrying ? (
        <div className={`link-status link-status--${c.state}`}>
          {c.state === 'pending' ? (
            <>
              <p>{t('link.screen.confirm', { host: link.prefs.target?.name ?? c.host })}</p>
              <p className="link-code" aria-label={t('link.screen.codeLabel')}>
                {c.code}
              </p>
            </>
          ) : (
            <p>
              {t(`link.screen.state.${c.state}`, { name: c.name ?? link.prefs.target?.name ?? c.host, host: c.host })}
            </p>
          )}
          <Button size="sm" variant="secondary" onClick={() => void link.disconnect()}>
            {t('link.screen.unlink')}
          </Button>
        </div>
      ) : (
        <>
          {c?.state === 'refused' && <p className="settings-err">{t('link.screen.refused')}</p>}
          <div className="modal-actions">
            <Button onClick={() => void search()} loading={searching}>
              {t('link.screen.search')}
            </Button>
          </div>
          {found && found.length === 0 && <p className="muted">{t('link.screen.noneFound')}</p>}
          {found && found.length > 0 && (
            <ul className="link-list">
              {found.map((f) => (
                <li key={f.host} className="link-list__row">
                  <span className="link-list__name">{f.name}</span>
                  <span className="link-list__state mono">{f.host}</span>
                  <Button size="sm" variant="primary" onClick={() => void link.connect(f)}>
                    {t('link.screen.link')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <SectionLabel>{t('link.screen.byIp')}</SectionLabel>
          <div className="squad-join-row">
            <Input
              mono
              value={ip}
              maxLength={15}
              placeholder="192.168.x.x"
              onChange={(e) => setIp(e.target.value.replace(/[^\d.]/g, ''))}
            />
            <Button disabled={!isNetworkIp(ip)} onClick={() => void link.connect({ host: ip.trim(), port: 8789, name: ip.trim() })}>
              {t('link.screen.link')}
            </Button>
          </div>
        </>
      )}
        </>
      )}
      {link.error && <p className="settings-err">{t(`link.error.${link.error}`, { defaultValue: t('link.error.other') })}</p>}
    </div>
  );
}
