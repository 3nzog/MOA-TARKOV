import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getRelayOverride, getRelayUrl, normalizeRelayInput, RELAY_URL, setRelayOverride } from '../squad/config';
import { Button, Input } from '../ui';

/** A relay on this machine (loopback), shown as "this PC" rather than a technical address. */
const isThisPc = (url: string) => /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(url);

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'fail' };

/** Open a WebSocket to the relay and close it again: reachable or not, in at most 5 s. */
function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let ws: WebSocket;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), 5000);
    try {
      ws = new WebSocket(url);
      ws.onopen = () => finish(true);
      ws.onerror = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

// Settings → Squad server. For a party over a VPN LAN (Radmin, ZeroTier…):
// one player runs the relay ("Hospedar party MoA.bat") and everyone enters the
// host's VPN address here. Changing it reloads the window, which reconnects.
export default function SquadServerSettings() {
  const { t } = useTranslation();
  const saved = getRelayOverride();
  const [value, setValue] = useState(saved ?? '');
  const [invalid, setInvalid] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  const normalized = value.trim() ? normalizeRelayInput(value) : null;

  const test = async () => {
    const url = value.trim() ? normalized : RELAY_URL;
    if (!url) {
      setInvalid(true);
      return;
    }
    setCheck({ state: 'checking' });
    setCheck({ state: (await probe(url)) ? 'ok' : 'fail' });
  };

  const save = () => {
    if (value.trim() && !normalized) {
      setInvalid(true);
      return;
    }
    setRelayOverride(normalized);
    window.location.reload();
  };

  return (
    <>
      <p className="settings-row__hint">
        {t('settings.squadServer.current')}{' '}
        {isThisPc(getRelayUrl()) ? <strong>{t('settings.squadServer.thisPc')}</strong> : <code>{getRelayUrl()}</code>}
      </p>
      <div className="settings-row">
        <Input
          mono
          invalid={invalid}
          style={{ flex: 1, minWidth: 0 }}
          value={value}
          placeholder={t('settings.squadServer.placeholder')}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value);
            setInvalid(false);
            setCheck({ state: 'idle' });
          }}
        />
      </div>
      {invalid && <p className="settings-err">{t('settings.squadServer.invalid')}</p>}
      {normalized && normalized !== value.trim() && (
        <p className="settings-row__hint">
          {t('settings.squadServer.willUse')} <code>{normalized}</code>
        </p>
      )}
      <div className="settings-row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
        <Button variant="ghost" onClick={() => void test()} disabled={check.state === 'checking'}>
          {check.state === 'checking' ? t('settings.squadServer.checking') : t('settings.squadServer.test')}
        </Button>
        {saved && (
          <Button
            variant="ghost"
            onClick={() => {
              setRelayOverride(null);
              window.location.reload();
            }}
          >
            {t('settings.squadServer.reset')}
          </Button>
        )}
        <Button variant="primary" onClick={save}>
          {t('settings.squadServer.save')}
        </Button>
      </div>
      {check.state === 'ok' && <p className="settings-ok">{t('settings.squadServer.ok')}</p>}
      {check.state === 'fail' && <p className="settings-err">{t('settings.squadServer.fail')}</p>}
    </>
  );
}
