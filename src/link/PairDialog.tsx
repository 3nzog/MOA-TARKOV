// The pairing windows (src/link/PairingProvider.tsx): the code shown on the PC
// that started it, the code to type on the other, then "which PC has the game?"
// on both — the first click decides.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal } from '../ui';
import { usePairing } from './usePairing';

export default function PairDialog() {
  const { t } = useTranslation();
  const pairing = usePairing();
  const [code, setCode] = useState('');
  const stage = pairing?.stage;
  if (!pairing || !stage) return null;

  if (stage.kind === 'code') {
    return (
      <Modal title={t('link.pair.title')} onClose={pairing.close} size="sm" footer={<Button onClick={pairing.close}>{t('common.close')}</Button>}>
        <p>{t('link.pair.showCode', { name: stage.name })}</p>
        <p className="link-code">{stage.code}</p>
        <p className="muted">{t('link.pair.waiting')}</p>
      </Modal>
    );
  }
  if (stage.kind === 'enter') {
    const ok = /^\d{4}$/.test(code);
    const send = () => {
      if (!ok) return;
      pairing.submitCode(code);
      setCode('');
    };
    return (
      <Modal
        title={t('link.pair.askTitle')}
        onClose={pairing.decline}
        size="sm"
        footer={
          <>
            <Button variant="tertiary" onClick={pairing.decline}>
              {t('link.pair.notNow')}
            </Button>
            <Button variant="primary" disabled={!ok} onClick={send}>
              {t('link.pair.link')}
            </Button>
          </>
        }
      >
        <p>{t('link.pair.askBody', { name: stage.name })}</p>
        <Input
          autoFocus
          inputMode="numeric"
          maxLength={4}
          value={code}
          placeholder="0000"
          aria-label={t('link.pair.codeLabel')}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        {stage.wrong && <p className="settings-err">{t('link.pair.wrong')}</p>}
      </Modal>
    );
  }
  if (stage.kind === 'choose') {
    return (
      <Modal
        title={t('link.pair.chooseTitle')}
        onClose={pairing.close}
        size="sm"
        footer={
          <>
            <Button onClick={() => pairing.choose(false)}>{t('link.pair.theirs', { name: stage.name })}</Button>
            <Button variant="primary" onClick={() => pairing.choose(true)}>
              {t('link.pair.mine')}
            </Button>
          </>
        }
      >
        <p>{t('link.pair.chooseBody', { name: stage.name })}</p>
      </Modal>
    );
  }
  return (
    <Modal title={t('link.pair.title')} onClose={pairing.close} size="sm" footer={<Button variant="primary" onClick={pairing.close}>{t('common.close')}</Button>}>
      <p>
        {stage.kind === 'declined'
          ? t('link.pair.declined', { name: stage.name })
          : stage.game
            ? t('link.pair.doneGame', { name: stage.name })
            : t('link.pair.doneScreen', { name: stage.name })}
      </p>
    </Modal>
  );
}
