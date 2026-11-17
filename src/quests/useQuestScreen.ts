// A screenshot of the game's Tasks screen marks the quests listed there as
// "active" ones the logs missed (questScreen.ts reads it). Quests MoA already
// has as active are left alone; ones it thought done or failed are set active
// by hand (an override, which a later log event about them clears).
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { detectGameLang } from '../i18n';
import { subscribeScreenText } from '../services/tauriEvents';
import type { TarkovTask } from '../api/types';
import type { ScreenText } from '../prices/scan';
import { effectiveStatus, markQuestAccepted, setQuestOverride, type LocalProgress } from '../state/localProgress';
import { buildQuestNameIndex, MIN_QUESTS_ON_SCREEN, questsOnScreen, type QuestNameIndex } from './questScreen';

const localeModules = import.meta.glob<{ default: { tasks: Record<string, string> } }>('../../data/snapshot/locale-*.json');
async function localeTasks(lang: string): Promise<Record<string, string>> {
  const key = Object.keys(localeModules).find((k) => k.endsWith(`locale-${lang}.json`));
  return key ? (await localeModules[key]()).default.tasks : {};
}

let indexPromise: Promise<QuestNameIndex> | null = null;
function loadIndex(): Promise<QuestNameIndex> {
  indexPromise ??= (async () => {
    const game = (await detectGameLang()) ?? 'pt';
    const langs = [...new Set([game, 'en'])];
    return buildQuestNameIndex(...(await Promise.all(langs.map(localeTasks))));
  })();
  return indexPromise;
}

/** Quest ids the screen says are active and MoA does not; null when it is not the Tasks screen. */
export function questsToActivate(
  text: ScreenText,
  index: QuestNameIndex,
  tasks: TarkovTask[],
  progress: LocalProgress,
): { found: number; ids: string[] } | null {
  // The quests the app knows by name too (newer than the bundled names).
  const live: QuestNameIndex = new Map(index);
  const extra = buildQuestNameIndex(Object.fromEntries(tasks.map((t) => [`${t.id} name`, t.name])));
  for (const [k, ids] of extra) live.set(k, [...new Set([...(live.get(k) ?? []), ...ids])]);

  const onScreen = questsOnScreen(text, live);
  if (onScreen.length < MIN_QUESTS_ON_SCREEN) return null;
  const known = new Set(tasks.map((t) => t.id));
  const ids: string[] = [];
  for (const q of onScreen) {
    if (q.status !== 'active') continue;
    // Several quests with one name: those this game mode has.
    const pick = q.ids.filter((id) => known.has(id));
    for (const id of pick.length ? pick : q.ids) {
      if (effectiveStatus(progress, id) !== 'active' && !ids.includes(id)) ids.push(id);
    }
  }
  return { found: onScreen.filter((q) => q.status === 'active').length, ids };
}

export function useQuestScreen(o: {
  tasks: TarkovTask[];
  progress: LocalProgress;
  setProgress: Dispatch<SetStateAction<LocalProgress>>;
  notify: (message: string) => void;
}): void {
  const { t } = useTranslation();
  const latest = useRef(o);
  const tRef = useRef(t);
  useEffect(() => {
    latest.current = o;
    tRef.current = t;
  });

  useEffect(() => {
    let un: (() => void) | undefined;
    let alive = true;
    const handle = async (text: ScreenText) => {
      if (text.lines.length < MIN_QUESTS_ON_SCREEN) return;
      const index = await loadIndex();
      const { tasks, progress, setProgress, notify } = latest.current;
      const r = questsToActivate(text, index, tasks, progress);
      if (!alive || !r) return;
      const tr = tRef.current;
      if (r.ids.length === 0) {
        notify(tr('questScreen.allKnown', { count: r.found }));
        return;
      }
      setProgress((p) =>
        r.ids.reduce((acc, id) => {
          const st = effectiveStatus(acc, id);
          if (st === 'active') return acc;
          return st === 'none' ? markQuestAccepted(acc, id) : setQuestOverride(acc, id, 'active');
        }, p),
      );
      const names = r.ids.map((id) => tasks.find((x) => x.id === id)?.name).filter(Boolean);
      notify(`${tr('questScreen.added', { count: r.ids.length })} ${names.slice(0, 6).join(' · ')}${names.length > 6 ? ' …' : ''}`);
    };
    subscribeScreenText((text) => void handle(text).catch(() => undefined))
      .then((u) => {
        if (alive) un = u;
        else u();
      })
      .catch(() => undefined);
    // In development a page can feed a screen by hand
    // (window.dispatchEvent(new CustomEvent('quests-demo', { detail: screenText }))).
    const onDemo = (e: Event) => void handle((e as CustomEvent<ScreenText>).detail);
    if (import.meta.env.DEV) window.addEventListener('quests-demo', onDemo);
    return () => {
      alive = false;
      un?.();
      if (import.meta.env.DEV) window.removeEventListener('quests-demo', onDemo);
    };
  }, []);
}
