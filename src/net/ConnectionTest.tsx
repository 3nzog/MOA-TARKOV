// "Test connection": runs every check a connection between two MoA PCs needs
// (src-tauri/src/diag.rs) and says, step by step, what works and what to do.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Info, WarningCircle, XCircle } from '@phosphor-icons/react';
import { Button, Input } from '../ui';
import { netDiagnose, netLogOpen, partyFirewallRequest, type DiagStep } from './netApi';
import '../link/link.css';

const ICON = {
  ok: <CheckCircle weight="fill" />,
  warn: <WarningCircle weight="fill" />,
  fail: <XCircle weight="fill" />,
  info: <Info weight="fill" />,
};

export default function ConnectionTest({ defaultTarget }: { defaultTarget?: string | null }) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(defaultTarget ?? '');
  const [steps, setSteps] = useState<DiagStep[] | null>(null);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const available = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!available) return <p className="muted">{t('settings.desktopOnly')}</p>;

  const run = async () => {
    setRunning(true);
    try {
      setSteps(await netDiagnose(target.trim() || null));
    } catch {
      setSteps([{ id: 'crashed', status: 'fail', args: {} }]);
    } finally {
      setRunning(false);
    }
  };

  const fixFirewall = async () => {
    setFixing(true);
    await partyFirewallRequest().catch(() => false);
    setFixing(false);
    await run();
  };

  return (
    <div className="conn-test">
      <p className="settings-row__hint">{t('net.test.hint')}</p>
      <div className="squad-join-row">
        <Input
          mono
          value={target}
          maxLength={15}
          placeholder={t('net.test.targetPlaceholder')}
          onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
        />
        <Button variant="primary" onClick={() => void run()} loading={running}>
          {t('net.test.run')}
        </Button>
      </div>
      {steps && (
        <ul className="conn-steps">
          {steps.map((s, i) => (
            <li key={`${s.id}-${i}`} className={`conn-step conn-step--${s.status}`}>
              <span className="conn-step__icon">{ICON[s.status]}</span>
              <div className="conn-step__text">
                <span>{t(`net.step.${s.id}.${s.status}`, { ...s.args, defaultValue: s.id })}</span>
                {(s.status === 'fail' || s.status === 'warn') && (
                  <span className="settings-row__hint">{t(`net.step.${s.id}.help`, { ...s.args, defaultValue: '' })}</span>
                )}
                {s.id === 'firewall' && s.status === 'warn' && (
                  <Button size="sm" onClick={() => void fixFirewall()} loading={fixing}>
                    {t('net.test.fixFirewall')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <Button size="sm" variant="ghost" onClick={() => void netLogOpen().catch(() => undefined)}>
          {t('net.test.openLog')}
        </Button>
      </div>
    </div>
  );
}
