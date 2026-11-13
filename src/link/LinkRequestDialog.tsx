// On the game PC: "PC X wants to show this PC's game — allow?", with the code
// the other PC shows, so a stranger on the same network cannot slip in.
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '../ui';
import { useLink } from './useLink';

export default function LinkRequestDialog() {
  const { t } = useTranslation();
  const link = useLink();
  const req = link.requests[0];
  if (!req) return null;
  return (
    <Modal
      title={t('link.request.title')}
      onClose={() => void link.answer(req.id, false)}
      size="sm"
      footer={
        <>
          <Button variant="tertiary" onClick={() => void link.answer(req.id, false)}>
            {t('link.request.refuse')}
          </Button>
          <Button variant="primary" onClick={() => void link.answer(req.id, true)}>
            {t('link.request.allow')}
          </Button>
        </>
      }
    >
      <p>{t('link.request.body', { name: req.name, ip: req.ip })}</p>
      <p className="muted">{t('link.request.check')}</p>
      <p className="link-code">{req.code}</p>
    </Modal>
  );
}
