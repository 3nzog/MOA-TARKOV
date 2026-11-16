// The card that opens over the map when a quest objective or an extraction is
// clicked: for a quest, its objective, the location screenshots from the wiki
// guide and a link to the quest's wiki page; for an extraction, its picture
// from the map's wiki page.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowSquareOut, CaretLeft, CaretRight, SignOut, Scroll, X } from '@phosphor-icons/react';
import { IconButton, Modal, Spinner } from '../ui';
import type { TarkovTask, TaskObjective } from '../api/types';
import type { Poi } from '../poi/types';
import QuestGuide from '../quests/QuestGuide';
import { useWikiLinks } from '../quests/wikiLinks';
import type { GuideImage } from '../quests/wikiGuide';
import { fetchWikiExtracts, findWikiExtract, wikiMapPage, wikiMapUrl } from './wikiExtracts';
import './mapInfoCard.css';

export type MapCard =
  | { kind: 'quest'; task: TarkovTask; objective: TaskObjective }
  | { kind: 'extract'; poi: Poi; names: string[] };

export default function MapInfoCard({ card, onClose }: { card: MapCard; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside className="map-card" role="dialog" aria-label={card.kind === 'quest' ? card.task.name : card.poi.label}>
      <header className="map-card__head">
        <span className={`map-card__icon map-card__icon--${card.kind}`}>{card.kind === 'quest' ? <Scroll weight="fill" /> : <SignOut weight="bold" />}</span>
        <div className="map-card__title">
          <strong>{card.kind === 'quest' ? card.task.name : card.poi.label}</strong>
          <small>{card.kind === 'quest' ? (card.task.trader?.name ?? t('mapCard.quest')) : t('mapCard.extract')}</small>
        </div>
        <IconButton size="sm" icon={<X />} label={t('common.close')} onClick={onClose} />
      </header>
      {card.kind === 'quest' ? <QuestBody key={card.objective.id} task={card.task} objective={card.objective} /> : <ExtractBody key={card.poi.id} poi={card.poi} names={card.names} />}
    </aside>
  );
}

function QuestBody({ task, objective }: { task: TarkovTask; objective: TaskObjective }) {
  const { t } = useTranslation();
  const links = useWikiLinks();
  const wikiLink = task.wikiLink ?? links[task.id];
  return (
    <div className="map-card__body">
      {objective.description && <p className="map-card__objective">{objective.description}</p>}
      {wikiLink ? (
        <>
          <QuestGuide wikiLink={wikiLink} questName={task.name} />
          <a className="map-card__wiki" href={wikiLink} target="_blank" rel="noreferrer">
            <ArrowSquareOut weight="bold" /> {t('mapCard.openWiki')}
          </a>
        </>
      ) : (
        <p className="map-card__muted">{t('mapCard.noWiki')}</p>
      )}
    </div>
  );
}

type Load = { state: 'loading' } | { state: 'ok'; images: GuideImage[] } | { state: 'error' };

function ExtractBody({ poi, names }: { poi: Poi; names: string[] }) {
  const { t } = useTranslation();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [open, setOpen] = useState<number | null>(null);
  const url = wikiMapUrl(poi.mapId);
  const key = names.join('|');

  useEffect(() => {
    let alive = true;
    fetchWikiExtracts(poi.mapId)
      .then((rows) => alive && setLoad({ state: 'ok', images: findWikiExtract(rows, key.split('|'))?.images ?? [] }))
      .catch(() => alive && setLoad({ state: 'error' }));
    return () => {
      alive = false;
    };
  }, [poi.mapId, key]);

  const faction = typeof poi.meta?.faction === 'string' ? poi.meta.faction : null;
  const shown = load.state === 'ok' && open !== null ? load.images[open] : null;
  return (
    <div className="map-card__body">
      {faction && <span className={`map-card__chip map-card__chip--${faction}`}>{t(`mapCard.faction.${faction}`, { defaultValue: faction })}</span>}
      {load.state === 'loading' ? (
        <p className="map-card__muted">
          <Spinner size="sm" /> {t('quests.guide.loading')}
        </p>
      ) : load.state === 'error' ? (
        <p className="map-card__muted">{t('quests.guide.failed')}</p>
      ) : load.images.length === 0 ? (
        <p className="map-card__muted">{t('mapCard.noPicture')}</p>
      ) : (
        <div className={`map-card__shots${load.images.length === 1 ? ' is-single' : ''}`}>
          {load.images.map((img, i) => (
            <button key={img.full} type="button" onClick={() => setOpen(i)} title={t('mapCard.enlarge')}>
              <img src={img.thumb} alt={img.caption} loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
      {url && (
        <a className="map-card__wiki" href={url} target="_blank" rel="noreferrer">
          <ArrowSquareOut weight="bold" /> {t('mapCard.openWiki')}
        </a>
      )}
      <p className="map-card__credit">
        {t('quests.guide.credit')}{' '}
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            {(wikiMapPage(poi.mapId) ?? '').replace(/_/g, ' ')}
          </a>
        )}{' '}
        · CC BY-SA
      </p>
      {shown && open !== null && load.state === 'ok' && (
        <Modal title={poi.label} onClose={() => setOpen(null)} size="lg">
          <figure className="quest-guide__big">
            <img src={shown.full} alt={shown.caption} referrerPolicy="no-referrer" />
            {load.images.length > 1 && (
              <figcaption>
                <button type="button" disabled={open === 0} onClick={() => setOpen(open - 1)} aria-label={t('quests.guide.prev')}>
                  <CaretLeft weight="bold" />
                </button>
                <span>
                  {open + 1}/{load.images.length}
                </span>
                <button type="button" disabled={open === load.images.length - 1} onClick={() => setOpen(open + 1)} aria-label={t('quests.guide.next')}>
                  <CaretRight weight="bold" />
                </button>
              </figcaption>
            )}
          </figure>
        </Modal>
      )}
    </div>
  );
}
