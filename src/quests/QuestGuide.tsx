// "Location screenshots" under a quest: the pictures from the quest's Guide on
// the Escape from Tarkov Wiki (src/quests/wikiGuide.ts), as a strip of
// thumbnails; a click opens the picture large, with its caption.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { Modal, Spinner } from '../ui';
import { fetchGuideImages, wikiPageOf, type GuideImage } from './wikiGuide';
import './questGuide.css';

type Load = { state: 'loading' } | { state: 'ok'; images: GuideImage[] } | { state: 'error' };

export default function QuestGuide({ wikiLink, questName }: { wikiLink: string; questName: string }) {
  const { t } = useTranslation();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetchGuideImages(wikiLink)
      .then((images) => alive && setLoad({ state: 'ok', images }))
      .catch(() => alive && setLoad({ state: 'error' }));
    return () => {
      alive = false;
    };
  }, [wikiLink]);

  const page = wikiPageOf(wikiLink)?.replace(/_/g, ' ') ?? questName;
  const credit = (
    <p className="quest-guide__credit">
      {t('quests.guide.credit')}{' '}
      <a href={wikiLink} target="_blank" rel="noreferrer">
        {page}
      </a>{' '}
      · CC BY-SA
    </p>
  );

  if (load.state === 'loading') {
    return (
      <div className="quest-guide quest-guide--msg">
        <Spinner size="sm" /> {t('quests.guide.loading')}
      </div>
    );
  }
  if (load.state === 'error') return <div className="quest-guide quest-guide--msg">{t('quests.guide.failed')}</div>;
  const images = load.images;
  if (images.length === 0) {
    return (
      <div className="quest-guide quest-guide--msg">
        {t('quests.guide.none')}
        {credit}
      </div>
    );
  }
  const shown = open !== null ? images[open] : null;
  return (
    <div className="quest-guide" onClick={(e) => e.stopPropagation()}>
      <div className="quest-guide__strip">
        {images.map((img, i) => (
          <button key={img.full} type="button" className="quest-guide__thumb" onClick={() => setOpen(i)} title={img.caption}>
            <img src={img.thumb} alt={img.caption} loading="lazy" referrerPolicy="no-referrer" />
            {img.caption && <span>{img.caption}</span>}
          </button>
        ))}
      </div>
      {credit}
      {shown && open !== null && (
        <Modal title={questName} onClose={() => setOpen(null)} size="lg">
          <figure className="quest-guide__big">
            <img src={shown.full} alt={shown.caption} referrerPolicy="no-referrer" />
            <figcaption>
              <button type="button" disabled={open === 0} onClick={() => setOpen(open - 1)} aria-label={t('quests.guide.prev')}>
                <CaretLeft weight="bold" />
              </button>
              <span>
                {shown.caption || '—'} <small>({open + 1}/{images.length})</small>
              </span>
              <button
                type="button"
                disabled={open === images.length - 1}
                onClick={() => setOpen(open + 1)}
                aria-label={t('quests.guide.next')}
              >
                <CaretRight weight="bold" />
              </button>
            </figcaption>
          </figure>
          {credit}
        </Modal>
      )}
    </div>
  );
}
